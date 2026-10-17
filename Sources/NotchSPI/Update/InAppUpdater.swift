import AppKit
import Security

/// Owns one download through installation. AppKit state lives on the main queue;
/// mounting, copying and signature validation run on the download delegate queue.
final class InAppUpdater: NSObject, URLSessionDownloadDelegate, NSWindowDelegate {
    static let shared = InAppUpdater()
    private(set) var isRunning = false
    private var session: URLSession?
    private var download: URLSessionDownloadTask?
    private var window: NSWindow?
    private let status = NSTextField(wrappingLabelWithString: "")
    private let progress = NSProgressIndicator()
    private var expectedVersion = ""

    func start(_ release: UpdateChecker.Release) {
        if isRunning { window?.makeKeyAndOrderFront(nil); return }
        expectedVersion = release.version
        isRunning = true
        let panel = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 440, height: 160),
                             styleMask: [.titled, .miniaturizable], backing: .buffered, defer: false)
        panel.title = L10n.t("更新 NotchSPI", "NotchSPI を更新", "Update NotchSPI")
        panel.isReleasedWhenClosed = false
        panel.delegate = self
        status.frame = NSRect(x: 24, y: 80, width: 392, height: 52)
        progress.frame = NSRect(x: 24, y: 48, width: 392, height: 20)
        progress.style = .bar
        progress.minValue = 0
        progress.maxValue = 1
        panel.contentView?.addSubview(status)
        panel.contentView?.addSubview(progress)
        window = panel
        panel.center()
        panel.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        show(L10n.t("正在下载更新…", "更新をダウンロード中…", "Downloading update…"))
        do {
            try Self.validateDestination(Bundle.main.bundleURL)
            guard UpdateChecker.permitsDownload(UpdateChecker.downloadURL) else { throw UpdateError.invalidDownload }
            let configuration = URLSessionConfiguration.ephemeral
            configuration.timeoutIntervalForRequest = 60
            configuration.timeoutIntervalForResource = 1800
            let session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
            self.session = session
            let task = session.downloadTask(with: UpdateChecker.downloadURL)
            download = task
            task.resume()
        } catch { fail(error) }
    }

    private func show(_ text: String, fraction: Double? = nil) {
        status.stringValue = text
        progress.isIndeterminate = fraction == nil
        if let fraction { progress.stopAnimation(nil); progress.doubleValue = fraction }
        else { progress.startAnimation(nil) }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(request.url.map(UpdateChecker.permitsDownload) == true ? request : nil)
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask,
                    didWriteData bytesWritten: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        let received = ByteCountFormatter.string(fromByteCount: totalBytesWritten, countStyle: .file)
        let total = totalBytesExpectedToWrite > 0 ? ByteCountFormatter.string(fromByteCount: totalBytesExpectedToWrite, countStyle: .file) : ""
        DispatchQueue.main.async {
            self.show(L10n.t("正在下载更新", "更新をダウンロード中", "Downloading update") + " · " + received + (total.isEmpty ? "" : " / " + total),
                      fraction: totalBytesExpectedToWrite > 0 ? Double(totalBytesWritten) / Double(totalBytesExpectedToWrite) : nil)
        }
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        do {
            guard (downloadTask.response as? HTTPURLResponse)?.statusCode == 200 else { throw UpdateError.invalidDownload }
            DispatchQueue.main.async { self.show(L10n.t("正在验证并准备安装…", "検証してインストールを準備中…", "Verifying and preparing installation…")) }
            let destination = Bundle.main.bundleURL
            let staging = try Self.prepare(image: location, destination: destination, version: expectedVersion)
            DispatchQueue.main.async {
                do {
                    try Self.launchInstaller(staging: staging, destination: destination)
                    self.show(L10n.t("即将自动重启以完成更新…", "更新を完了するため再起動します…", "Restarting to finish the update…"))
                    // terminateLater enters AppKit's nested event loop. Calling terminate
                    // inside a main DispatchQueue block prevents the delegate's MainActor
                    // save/cleanup task from running. Enter from a run-loop callback instead.
                    RunLoop.main.perform { NSApp.terminate(nil) }
                } catch {
                    try? FileManager.default.removeItem(at: staging)
                    self.fail(error)
                }
            }
        } catch { DispatchQueue.main.async { self.fail(error) } }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        session.finishTasksAndInvalidate()
        if let error { DispatchQueue.main.async { self.fail(error) } }
    }

    private func fail(_ error: Error) {
        isRunning = false
        session?.invalidateAndCancel()
        session = nil
        download = nil
        window?.close()
        window = nil
        let alert = NSAlert()
        alert.messageText = L10n.t("更新未完成", "更新が完了しませんでした", "Update did not complete")
        alert.informativeText = error.localizedDescription
        alert.addButton(withTitle: L10n.ok)
        alert.runModal()
    }

    enum UpdateError: LocalizedError {
        case destination, invalidDownload, identity, command(String)
        var errorDescription: String? {
            switch self {
            case .destination: return L10n.t("请将应用安装到有写入权限的应用程序目录后重试更新。", "書き込み可能なアプリケーションフォルダにインストールして再試行してください。", "Install the app in a writable Applications folder and retry.")
            case .invalidDownload: return L10n.t("更新包下载失败，请稍后重试。", "ダウンロードに失敗しました。再試行してください。", "The update could not be downloaded. Please retry.")
            case .identity: return L10n.t("更新包验证未通过，已保留当前版本。", "更新の検証に失敗しました。現在のバージョンは保持されています。", "Update verification failed. Your current version is unchanged.")
            case .command(let tool): return L10n.t("更新准备失败（\(tool)），请重试。", "更新の準備に失敗しました（\(tool)）。再試行してください。", "Update preparation failed (\(tool)). Please retry.")
            }
        }
    }

    static func validateDestination(_ app: URL) throws {
        let path = app.resolvingSymlinksInPath().path
        guard app.pathExtension == "app", !path.hasPrefix("/Volumes/"), !path.contains("/AppTranslocation/"),
              FileManager.default.isWritableFile(atPath: app.deletingLastPathComponent().path),
              FileManager.default.isWritableFile(atPath: app.path) else { throw UpdateError.destination }
    }

    @discardableResult
    private static func run(_ executable: String, _ arguments: [String]) throws -> Data {
        let process = Process()
        let pipe = Pipe()
        process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = arguments
        process.standardOutput = pipe
        process.standardError = FileHandle.nullDevice
        process.standardInput = FileHandle.nullDevice
        try process.run()
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        guard process.terminationStatus == 0 else { throw UpdateError.command(URL(fileURLWithPath: executable).lastPathComponent) }
        return data
    }

    static func validateCandidate(_ candidate: URL, current: URL, version: String) throws {
        guard let before = Bundle(url: current), let after = Bundle(url: candidate),
              before.bundleIdentifier == "com.rottesya.notchspi", after.bundleIdentifier == before.bundleIdentifier,
              let actual = after.infoDictionary?["CFBundleShortVersionString"] as? String,
              !UpdateChecker.isNewer(version, than: actual),
              UpdateChecker.isNewer(actual, than: before.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0") else { throw UpdateError.identity }
        var oldCode: SecStaticCode?
        var newCode: SecStaticCode?
        var requirement: SecRequirement?
        var signing: CFDictionary?
        guard SecStaticCodeCreateWithPath(current as CFURL, [], &oldCode) == errSecSuccess, let oldCode,
              SecCodeCopySigningInformation(oldCode, SecCSFlags(rawValue: kSecCSSigningInformation), &signing) == errSecSuccess,
              let team = (signing as? [String: Any])?[kSecCodeInfoTeamIdentifier as String] as? String, !team.isEmpty,
              SecCodeCopyDesignatedRequirement(oldCode, [], &requirement) == errSecSuccess, let requirement,
              SecStaticCodeCreateWithPath(candidate as CFURL, [], &newCode) == errSecSuccess, let newCode,
              SecStaticCodeCheckValidity(newCode, SecCSFlags(rawValue: kSecCSCheckAllArchitectures | kSecCSStrictValidate | kSecCSCheckNestedCode), requirement) == errSecSuccess else { throw UpdateError.identity }
        try run("/usr/sbin/spctl", ["--assess", "--type", "execute", candidate.path])
    }

    private static func prepare(image: URL, destination: URL, version: String) throws -> URL {
        let fm = FileManager.default
        let work = fm.temporaryDirectory.appendingPathComponent("NotchSPI-update-" + UUID().uuidString)
        try fm.createDirectory(at: work, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        defer { try? fm.removeItem(at: work) }
        let disk = work.appendingPathComponent("update.dmg")
        try fm.moveItem(at: image, to: disk)
        let mount = work.appendingPathComponent("mount")
        try run("/usr/bin/hdiutil", ["attach", disk.path, "-readonly", "-nobrowse", "-noautoopen", "-mountpoint", mount.path])
        defer { _ = try? run("/usr/bin/hdiutil", ["detach", mount.path]) }
        let source = mount.appendingPathComponent("NotchSPI.app")
        let staging = destination.deletingLastPathComponent().appendingPathComponent(".NotchSPI-update-" + UUID().uuidString)
        try fm.createDirectory(at: staging, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        do {
            let candidate = staging.appendingPathComponent("NotchSPI.app")
            try run("/usr/bin/ditto", [source.path, candidate.path])
            try validateCandidate(candidate, current: destination, version: version)
            return staging
        } catch { try? fm.removeItem(at: staging); throw error }
    }

    /// Positional arguments avoid interpolating filesystem paths into shell source. The
    /// replacement is staged on the same volume; a failed rename/launch restores the old app.
    static let installerScript = #"""
    parent="$1"
    destination="$2"
    staging="$3"
    count=0
    while /bin/kill -0 "$parent" 2>/dev/null; do
        count=$((count + 1))
        if [ "$count" -ge 60 ]; then exit 75; fi
        /bin/sleep 1
    done
    if ! /bin/mv "$destination" "$staging/previous.app"; then
        /usr/bin/open "$destination"
        exit 1
    fi
    if ! /bin/mv "$staging/NotchSPI.app" "$destination"; then
        /bin/mv "$staging/previous.app" "$destination"
        /usr/bin/open "$destination"
        exit 1
    fi
    if ! /usr/bin/open "$destination"; then
        /bin/mv "$destination" "$staging/failed.app"
        /bin/mv "$staging/previous.app" "$destination"
        /usr/bin/open "$destination"
        exit 1
    fi
    /bin/rm -rf "$staging"
    """#

    private static func launchInstaller(staging: URL, destination: URL) throws {
        let helper = Process()
        helper.executableURL = URL(fileURLWithPath: "/bin/sh")
        helper.arguments = ["-c", installerScript, "notchspi-updater", String(ProcessInfo.processInfo.processIdentifier), destination.path, staging.path]
        helper.standardInput = FileHandle.nullDevice
        helper.standardOutput = FileHandle.nullDevice
        helper.standardError = FileHandle.nullDevice
        helper.terminationHandler = { process in
            DispatchQueue.main.async {
                // If normal app termination was refused, leave the running bundle intact.
                if process.terminationStatus == 75 {
                    try? FileManager.default.removeItem(at: staging)
                    shared.fail(UpdateError.command("restart"))
                }
            }
        }
        try helper.run()
    }
}
