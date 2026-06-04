import Foundation

struct CLIInfo {
    var installed: Bool
    var path: String?
    var version: String?
    var loggedIn: Bool? // nil = unknown
}

enum CLIRunner {
    private static let home = FileManager.default.homeDirectoryForCurrentUser.path

    // MARK: - Detection

    static func candidateDirs() -> [String] {
        var dirs = [
            "/opt/homebrew/bin", "/opt/homebrew/sbin",
            "/usr/local/bin", "/usr/local/sbin", "/usr/bin", "/bin",
            "\(home)/.local/bin", "\(home)/.npm-global/bin",
            "\(home)/.cargo/bin", "\(home)/.bun/bin", "\(home)/.deno/bin",
            "\(home)/.volta/bin", "\(home)/.asdf/shims",
            "/opt/homebrew/lib/node_modules/.bin", "/usr/local/lib/node_modules/.bin",
            // Desktop-app bundle that ships a usable macOS codex CLI:
            "/Applications/Codex.app/Contents/Resources",
            "\(home)/Applications/Codex.app/Contents/Resources",
            "\(home)/.claude/local",
        ]
        let nvm = "\(home)/.nvm/versions/node"
        if let vers = try? FileManager.default.contentsOfDirectory(atPath: nvm) {
            for v in vers { dirs.append("\(nvm)/\(v)/bin") }
        }
        return dirs
    }

    static func augmentedEnv() -> [String: String] {
        var env = ProcessInfo.processInfo.environment
        let extra = candidateDirs().joined(separator: ":")
        env["PATH"] = extra + ":" + (env["PATH"] ?? "")
        return env
    }

    /// An isolated empty dir to run the CLIs in, so the agentic tools never crawl
    /// the user's current project (e.g. a huge node_modules).
    static func workDir() -> String {
        let dir = NSTemporaryDirectory() + "notch-tutor-work"
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        return dir
    }

    private static func findInDirs(_ bin: String) -> String? {
        let fm = FileManager.default
        for d in candidateDirs() {
            let p = "\(d)/\(bin)"
            if fm.isExecutableFile(atPath: p) { return p }
        }
        return nil
    }

    private static func findViaLoginShell(_ bins: [String]) -> [String: String] {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: ProcessInfo.processInfo.environment["SHELL"] ?? "/bin/zsh")
        p.arguments = ["-lic", "command -v \(bins.joined(separator: " ")) 2>/dev/null"]
        let pipe = Pipe()
        p.standardOutput = pipe
        p.standardError = FileHandle.nullDevice
        p.standardInput = FileHandle.nullDevice
        do { try p.run() } catch { return [:] }
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        p.waitUntilExit()
        var map: [String: String] = [:]
        if let s = String(data: data, encoding: .utf8) {
            for line in s.split(separator: "\n") {
                let path = line.trimmingCharacters(in: .whitespaces)
                if path.hasPrefix("/") {
                    let base = (path as NSString).lastPathComponent
                    if map[base] == nil { map[base] = path }
                }
            }
        }
        return map
    }

    @discardableResult
    private static func runCapture(_ binPath: String, _ args: [String]) -> (code: Int32, out: String, err: String) {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: binPath)
        p.arguments = args
        p.environment = augmentedEnv()
        let o = Pipe()
        let e = Pipe()
        p.standardOutput = o
        p.standardError = e
        p.standardInput = FileHandle.nullDevice
        do { try p.run() } catch { return (-1, "", "\(error)") }
        let out = String(data: o.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
        let err = String(data: e.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
        p.waitUntilExit()
        return (p.terminationStatus, out, err)
    }

    private static func detectOne(bin: String, versionArgs: [String], auth: (String) -> Bool?) -> CLIInfo {
        var path = findInDirs(bin)
        if path == nil { path = findViaLoginShell([bin])[bin] }
        guard let p = path else { return CLIInfo(installed: false, path: nil, version: nil, loggedIn: nil) }
        let v = runCapture(p, versionArgs)
        let version = (v.out + "\n" + v.err).split(separator: "\n").first.map { String($0).trimmingCharacters(in: .whitespaces) }
        return CLIInfo(installed: true, path: p, version: version, loggedIn: auth(p))
    }

    private static func matches(_ text: String, _ pattern: String) -> Bool {
        text.range(of: pattern, options: [.regularExpression, .caseInsensitive]) != nil
    }

    static func detect() async -> [String: CLIInfo] {
        await withCheckedContinuation { cont in
            DispatchQueue.global(qos: .userInitiated).async {
                var result: [String: CLIInfo] = [:]
                result["claude"] = detectOne(bin: "claude", versionArgs: ["--version"]) { path in
                    let r = runCapture(path, ["auth", "status"])
                    let t = r.out + "\n" + r.err
                    if r.code == 0 && matches(t, "logged in|account|subscription|plan|@") { return true }
                    if matches(t, "not logged in|unauthenti|please (run )?log ?in") { return false }
                    return nil
                }
                result["codex"] = detectOne(bin: "codex", versionArgs: ["--version"]) { path in
                    let r = runCapture(path, ["login", "status"])
                    let t = r.out + "\n" + r.err
                    if r.code == 0 && matches(t, "logged in") { return true }
                    if matches(t, "not logged in") { return false }
                    return nil
                }
                cont.resume(returning: result)
            }
        }
    }

    // MARK: - Run (streaming)

    /// Spawn the chosen CLI read-only and stream text via onDelta. Callbacks fire
    /// on the main queue. A safety timeout kills a stuck process after 120s.
    static func run(
        cliId: String,
        binPath: String,
        imagePath: String,
        depth: String,
        onDelta: @escaping (String) -> Void,
        onDone: @escaping (_ ok: Bool, _ stderr: String) -> Void
    ) {
        let sys = Prompts.tutorText(depth)
        let isClaude = (cliId == "claude")
        let args: [String]
        if isClaude {
            let prompt = sys + "\n\nThe screenshot is saved at this path: \(imagePath)\nOpen and read that image file, then tutor me on the problem it shows."
            args = ["-p", prompt,
                    "--allowedTools", "Read",
                    "--disallowedTools", "Edit,Write,Bash,WebFetch,WebSearch",
                    "--permission-mode", "dontAsk",
                    "--output-format", "stream-json", "--verbose", "--include-partial-messages"]
        } else {
            let prompt = sys + "\n\nAnalyze the attached screenshot image, then tutor me on the problem it shows."
            // Prompt BEFORE -i: --image is variadic and would otherwise eat the prompt.
            args = ["exec", "--sandbox", "read-only", "--skip-git-repo-check", prompt, "-i", imagePath]
        }

        let wd = workDir()
        let p = Process()
        p.executableURL = URL(fileURLWithPath: binPath)
        p.arguments = args
        p.environment = augmentedEnv()
        p.currentDirectoryURL = URL(fileURLWithPath: wd) // isolated empty dir
        print("[NotchTutor] run \(cliId) cwd=\(wd) argc=\(args.count)")
        let o = Pipe()
        let e = Pipe()
        p.standardOutput = o
        p.standardError = e
        p.standardInput = FileHandle.nullDevice // immediate EOF — codex exec hangs otherwise

        var stderrBuf = ""
        var lineBuf = ""
        var sawText = false
        var resultText = ""
        var finished = false
        let lock = NSLock()

        func finish(_ ok: Bool) {
            lock.lock(); defer { lock.unlock() }
            if finished { return }
            finished = true
            o.fileHandleForReading.readabilityHandler = nil
            e.fileHandleForReading.readabilityHandler = nil
            if !sawText && !resultText.isEmpty {
                let r = resultText
                DispatchQueue.main.async { onDelta(r) }
            }
            DispatchQueue.main.async { onDone(ok, stderrBuf) }
        }

        o.fileHandleForReading.readabilityHandler = { h in
            let data = h.availableData
            if data.isEmpty { return }
            guard let chunk = String(data: data, encoding: .utf8) else { return }
            if isClaude {
                lineBuf += chunk
                while let nl = lineBuf.firstIndex(of: "\n") {
                    let line = String(lineBuf[..<nl])
                    lineBuf.removeSubrange(lineBuf.startIndex...nl)
                    if let t = parseClaudeDelta(line) {
                        sawText = true
                        DispatchQueue.main.async { onDelta(t) }
                    } else if let r = parseClaudeResult(line) {
                        resultText = r
                    }
                }
            } else {
                sawText = true
                DispatchQueue.main.async { onDelta(chunk) }
            }
        }
        e.fileHandleForReading.readabilityHandler = { h in
            if let s = String(data: h.availableData, encoding: .utf8) { stderrBuf += s }
        }
        p.terminationHandler = { proc in
            print("[NotchTutor] \(cliId) exited \(proc.terminationStatus) sawText=\(sawText) stderrLen=\(stderrBuf.count)")
            if proc.terminationStatus != 0 {
                print("[NotchTutor] stderr tail: \(String(stderrBuf.suffix(500)))")
            }
            finish(proc.terminationStatus == 0 || sawText)
        }

        do {
            try p.run()
        } catch {
            DispatchQueue.main.async { onDone(false, "spawn failed: \(error)") }
            return
        }

        // Safety timeout
        DispatchQueue.global().asyncAfter(deadline: .now() + 120) {
            if p.isRunning { p.terminate() }
        }
    }

    private static func parseClaudeDelta(_ line: String) -> String? {
        guard let data = line.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return nil }
        if obj["type"] as? String == "stream_event",
           let event = obj["event"] as? [String: Any],
           let delta = event["delta"] as? [String: Any],
           delta["type"] as? String == "text_delta",
           let text = delta["text"] as? String {
            return text
        }
        return nil
    }

    private static func parseClaudeResult(_ line: String) -> String? {
        guard let data = line.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return nil }
        if obj["type"] as? String == "result", let r = obj["result"] as? String { return r }
        return nil
    }
}
