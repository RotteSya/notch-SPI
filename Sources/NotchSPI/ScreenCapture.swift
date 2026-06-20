import AppKit
import ScreenCaptureKit

/// What the hotkey screenshot covers.
enum CaptureTarget: Equatable {
    case fullScreen
    case app(bundleID: String)
}

enum CaptureError: Error {
    case noPermission
    case appNotRunning(name: String)
    case noCapturableWindow(name: String)
    case captureFailed
}

enum ScreenCapture {
    struct Shot {
        let path: String
        let blank: Bool
    }

    /// A running app that currently owns at least one capturable window.
    struct AppInfo {
        let bundleID: String
        let name: String
        let icon: NSImage?
    }

    // MARK: - Window enumeration

    /// Regular (Dock) apps owning at least one normal-layer window, minimized included.
    /// Synchronous and in-process, needs no screen-recording permission (window names
    /// are never read). Agent/status-bar apps (activationPolicy != .regular) are
    /// excluded, which also makes per-window size filtering unnecessary here.
    static func capturableApps() -> [AppInfo] {
        // Toll-free [NSDictionary] cast: deep-bridging thousands of CF dictionaries
        // to [String: Any] costs more than the WindowServer IPC itself.
        let windows = CGWindowListCopyWindowInfo([.excludeDesktopElements], kCGNullWindowID)
            as? [NSDictionary] ?? []
        var owners = Set<pid_t>()
        for w in windows {
            guard let layer = w[kCGWindowLayer] as? Int, layer == 0,
                  let pid = w[kCGWindowOwnerPID] as? pid_t
            else { continue }
            owners.insert(pid)
        }

        let selfPID = NSRunningApplication.current.processIdentifier
        return NSWorkspace.shared.runningApplications
            .compactMap { app -> AppInfo? in
                guard app.activationPolicy == .regular,
                      app.processIdentifier != selfPID,
                      owners.contains(app.processIdentifier),
                      let bundleID = app.bundleIdentifier
                else { return nil }
                return AppInfo(bundleID: bundleID, name: app.localizedName ?? bundleID, icon: app.icon)
            }
            .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    /// Anything smaller is chrome (status items, tooltips), not real content.
    private static let minContentSize = CGSize(width: 80, height: 60)

    /// Normal document windows only: layer 0, big enough to hold real content.
    private static func isCapturable(_ w: SCWindow) -> Bool {
        w.windowLayer == 0 && w.frame.width >= minContentSize.width && w.frame.height >= minContentSize.height
    }

    // MARK: - Capture

    /// Capture the chosen target to a temp JPEG (downscaled to ~1568px long edge).
    static func capture(target: CaptureTarget, maxLongEdge: CGFloat = 1568) async -> Result<Shot, CaptureError> {
        let content: SCShareableContent
        do {
            // App targets enumerate off-screen windows too, so minimized ones are found.
            content = target == .fullScreen
                ? try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
                : try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: false)
        } catch {
            return .failure(.noPermission)
        }

        let config = SCStreamConfiguration()
        config.showsCursor = false
        let filter: SCContentFilter
        // Blank-frame heuristic only makes sense for full screen; a small window's
        // JPEG can legitimately be tiny.
        var blankThreshold = 0

        switch target {
        case .fullScreen:
            let mainID = CGMainDisplayID()
            guard let display = content.displays.first(where: { $0.displayID == mainID }) ?? content.displays.first
            else { return .failure(.captureFailed) }
            filter = SCContentFilter(display: display, excludingApplications: [], exceptingWindows: [])
            let scale = NSScreen.main?.backingScaleFactor ?? 2
            config.width = Int(CGFloat(display.width) * scale)
            config.height = Int(CGFloat(display.height) * scale)
            blankThreshold = 9000

        case .app(let bundleID):
            let running = NSRunningApplication.runningApplications(withBundleIdentifier: bundleID)
            let name = running.first?.localizedName ?? bundleID
            let owned = content.windows.filter {
                $0.owningApplication?.bundleIdentifier == bundleID && isCapturable($0)
            }
            guard !owned.isEmpty else {
                return .failure(running.isEmpty ? .appNotRunning(name: name) : .noCapturableWindow(name: name))
            }
            // SCShareableContent lists windows front-to-back: the first on-screen one
            // is the app's frontmost. Fall back to the largest off-screen (minimized) window.
            guard let window = owned.first(where: { $0.isOnScreen })
                ?? owned.max(by: { $0.frame.width * $0.frame.height < $1.frame.width * $1.frame.height })
            else { return .failure(.noCapturableWindow(name: name)) }

            // Window-server composited: unaffected by occlusion, Space, or which display it's on.
            filter = SCContentFilter(desktopIndependentWindow: window)
            let scale = CGFloat(filter.pointPixelScale)
            config.width = Int(filter.contentRect.width * scale)
            config.height = Int(filter.contentRect.height * scale)
            config.ignoreShadowsSingleWindow = true
        }

        do {
            let cg = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
            guard let shot = encode(cg, maxLongEdge: maxLongEdge, blankThreshold: blankThreshold)
            else { return .failure(.captureFailed) }
            return .success(shot)
        } catch {
            // Window vanished mid-capture (closed / app quit), or capture was refused.
            return .failure(.captureFailed)
        }
    }

    private static func encode(_ cg: CGImage, maxLongEdge: CGFloat, blankThreshold: Int) -> Shot? {
        var image = cg
        let w = CGFloat(cg.width)
        let h = CGFloat(cg.height)
        let longEdge = max(w, h)
        if longEdge > maxLongEdge {
            let f = maxLongEdge / longEdge
            let nw = Int(w * f)
            let nh = Int(h * f)
            if let ctx = CGContext(
                data: nil, width: nw, height: nh, bitsPerComponent: 8, bytesPerRow: 0,
                space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
            ) {
                ctx.interpolationQuality = .medium
                ctx.draw(cg, in: CGRect(x: 0, y: 0, width: nw, height: nh))
                if let scaled = ctx.makeImage() { image = scaled }
            }
        }

        let rep = NSBitmapImageRep(cgImage: image)
        guard let jpg = rep.representation(using: .jpeg, properties: [.compressionFactor: 0.8]) else {
            return nil
        }
        let blank = jpg.count < blankThreshold
        let file = NSTemporaryDirectory() + "notch-tutor-\(UUID().uuidString).jpg"
        do {
            try jpg.write(to: URL(fileURLWithPath: file))
        } catch {
            return nil
        }
        return Shot(path: file, blank: blank)
    }
}
