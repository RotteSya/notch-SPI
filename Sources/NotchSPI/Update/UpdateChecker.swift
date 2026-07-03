import AppKit

/// Lightweight "check for updates" against the GitHub Releases API.
///
/// NotchSPI ships as a notarized `NotchSPI.dmg` attached to GitHub releases tagged `vX.Y`, so the
/// newest release's tag is the canonical latest version. That makes a plain JSON GET enough — no
/// Sparkle, no appcast, no EdDSA keys, no extra dependency or hosting. We compare the latest tag to
/// the running app's `CFBundleShortVersionString` and, if newer, send the user to the release page.
enum UpdateChecker {
    static let repo = "RotteSya/notch-SPI"
    private static let latestURL = URL(string: "https://api.github.com/repos/\(repo)/releases/latest")!
    /// Fallback page if the API is unreachable or a release has no `html_url`.
    static let releasesPage = URL(string: "https://github.com/\(repo)/releases/latest")!

    private static let lastCheckKey = "lastUpdateCheckAt"
    private static let skipVersionKey = "skipUpdateVersion"
    private static let autoCheckInterval: TimeInterval = 24 * 60 * 60

    /// Guards against stacking alerts if the menu item is clicked twice while a check is in flight.
    private static var inFlight = false

    /// Running app version from the bundle's Info.plist (`CFBundleShortVersionString`), e.g. "1.5".
    /// Unbundled `swift run` has no Info.plist, so fall back to `devFallbackVersion`.
    static var currentVersion: String {
        (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String) ?? devFallbackVersion
    }

    /// Dev-only fallback for `swift run` (the real .app reads its Info.plist). Keep roughly in sync
    /// with `VERSION` in `scripts/make-dmg.sh`, which is the source of truth for releases.
    private static let devFallbackVersion = "1.7"

    struct Release {
        let version: String   // normalized numeric core, e.g. "1.6"
        let tag: String       // raw tag, e.g. "v1.6"
        let pageURL: URL      // release html_url
        let notes: String     // release body / changelog
    }

    enum CheckResult {
        case upToDate(current: String)
        case updateAvailable(Release)
        case failed(String)
    }

    // MARK: - Entry points

    /// Gear-menu "检查更新…": always reports back (up to date / update / error).
    static func checkForUpdatesManually() {
        guard !inFlight else { return }
        inFlight = true
        check { result in
            inFlight = false
            switch result {
            case .updateAvailable(let r): presentUpdate(r, manual: true)
            case .upToDate(let v): presentUpToDate(v)
            case .failed(let msg): presentFailure(msg)
            }
        }
    }

    /// Silent launch check: runs at most once per day and only shows UI when an update is available
    /// and that version hasn't been skipped. Failures are swallowed (the menu item is always there).
    static func autoCheckIfDue() {
        guard !inFlight else { return }
        let now = Date().timeIntervalSince1970
        let last = UserDefaults.standard.double(forKey: lastCheckKey)
        if last > 0, now - last < autoCheckInterval { return }
        UserDefaults.standard.set(now, forKey: lastCheckKey) // record the attempt, so we don't retry on every launch

        inFlight = true
        check { result in
            inFlight = false
            guard case .updateAvailable(let r) = result else { return }
            if r.version == UserDefaults.standard.string(forKey: skipVersionKey) { return }
            presentUpdate(r, manual: false)
        }
    }

    // MARK: - Network

    /// Fetch the latest release and compare to the running version. `completion` runs on the main thread.
    static func check(completion: @escaping (CheckResult) -> Void) {
        var req = URLRequest(url: latestURL)
        req.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        req.setValue("NotchSPI", forHTTPHeaderField: "User-Agent") // GitHub rejects requests without a UA
        req.timeoutInterval = 15
        req.cachePolicy = .reloadIgnoringLocalCacheData

        URLSession.shared.dataTask(with: req) { data, response, error in
            let finish: (CheckResult) -> Void = { r in DispatchQueue.main.async { completion(r) } }

            if let error { finish(.failed(error.localizedDescription)); return }
            guard let http = response as? HTTPURLResponse else { finish(.failed("无网络响应")); return }
            guard http.statusCode == 200, let data else {
                finish(.failed("GitHub 返回 HTTP \(http.statusCode)")); return
            }
            guard
                let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
                let tag = obj["tag_name"] as? String
            else { finish(.failed("无法解析更新信息")); return }

            let latest = normalize(tag)
            let pageURL = (obj["html_url"] as? String).flatMap(URL.init(string:)) ?? releasesPage
            let notes = (obj["body"] as? String) ?? ""
            if isNewer(latest, than: normalize(currentVersion)) {
                finish(.updateAvailable(Release(version: latest, tag: tag, pageURL: pageURL, notes: notes)))
            } else {
                finish(.upToDate(current: currentVersion))
            }
        }.resume()
    }

    // MARK: - Version comparison

    /// Strip a leading "v"/"V" and surrounding whitespace, leaving the dotted numeric core.
    static func normalize(_ raw: String) -> String {
        var s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.hasPrefix("v") || s.hasPrefix("V") { s.removeFirst() }
        return s
    }

    /// Numeric, component-wise comparison so "1.10" > "1.9" and "1.5" == "1.5.0".
    static func isNewer(_ a: String, than b: String) -> Bool {
        let pa = a.split(separator: ".").map { Int($0) ?? 0 }
        let pb = b.split(separator: ".").map { Int($0) ?? 0 }
        for i in 0..<max(pa.count, pb.count) {
            let x = i < pa.count ? pa[i] : 0
            let y = i < pb.count ? pb[i] : 0
            if x != y { return x > y }
        }
        return false
    }

    // MARK: - Presentation (main thread)

    /// App logo used as the alert icon, so the alert shows the NotchSPI mark instead of the generic
    /// executable icon. Released `.app`: the bundled `NotchSPI.icns`. Dev (`swift run`, no bundle):
    /// straight from the source `Resources/`. `nil` → NSAlert keeps its default icon.
    private static let appLogo: NSImage? = {
        if let url = Bundle.main.url(forResource: "NotchSPI", withExtension: "icns"),
           let img = NSImage(contentsOf: url) { return img }
        let devURL = URL(fileURLWithPath: #filePath)   // Sources/NotchSPI/Update/UpdateChecker.swift
            .deletingLastPathComponent()                // Sources/NotchSPI/Update
            .deletingLastPathComponent()                // Sources/NotchSPI
            .deletingLastPathComponent()                // Sources
            .deletingLastPathComponent()                // package root
            .appendingPathComponent("Resources/NotchSPI.png")
        return NSImage(contentsOf: devURL)
    }()

    private static func presentUpdate(_ r: Release, manual: Bool) {
        NSApp.activate(ignoringOtherApps: true)
        let alert = NSAlert()
        if let appLogo { alert.icon = appLogo }
        alert.alertStyle = .informational
        alert.messageText = "发现新版本 NotchSPI \(r.version)"
        var info = "当前版本 \(currentVersion)，最新版本 \(r.version)。是否前往下载页面更新？"
        let notes = r.notes.trimmingCharacters(in: .whitespacesAndNewlines)
        if !notes.isEmpty { info += "\n\n更新内容：\n\(notes)" }
        alert.informativeText = String(info.prefix(800))
        alert.addButton(withTitle: "前往下载")      // .alertFirstButtonReturn
        alert.addButton(withTitle: "稍后")           // .alertSecondButtonReturn
        if !manual { alert.addButton(withTitle: "跳过此版本") } // .alertThirdButtonReturn

        switch alert.runModal() {
        case .alertFirstButtonReturn:
            NSWorkspace.shared.open(r.pageURL)
        case .alertThirdButtonReturn:
            UserDefaults.standard.set(r.version, forKey: skipVersionKey)
        default:
            break
        }
    }

    private static func presentUpToDate(_ version: String) {
        NSApp.activate(ignoringOtherApps: true)
        let alert = NSAlert()
        if let appLogo { alert.icon = appLogo }
        alert.alertStyle = .informational
        alert.messageText = "已是最新版本"
        alert.informativeText = "NotchSPI \(version) 已是最新版本。"
        alert.addButton(withTitle: "好")
        alert.runModal()
    }

    private static func presentFailure(_ message: String) {
        NSApp.activate(ignoringOtherApps: true)
        let alert = NSAlert()
        if let appLogo { alert.icon = appLogo }
        alert.alertStyle = .warning
        alert.messageText = "检查更新失败"
        alert.informativeText = "无法获取更新信息：\(message)\n\n你也可以直接打开发布页查看。"
        alert.addButton(withTitle: "打开发布页")
        alert.addButton(withTitle: "好")
        if alert.runModal() == .alertFirstButtonReturn {
            NSWorkspace.shared.open(releasesPage)
        }
    }
}
