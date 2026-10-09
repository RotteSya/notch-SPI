#if DEBUG
import AppKit

/// Opt-in fixture capture at the I/O boundary; the production intake, timer and flight
/// still run. A loopback-only switch exercises the real submission against dev.sh's mock.
@MainActor
enum ScreenshotVisualQA {
    static func start(_ controller: NotchController, localService: Bool) {
        guard ProcessInfo.processInfo.environment["NSPI_QA_EPHEMERAL"] == "1" else { return }
        let args = CommandLine.arguments
        let single = args.contains("--qa-screenshot-single")
        let personality = args.contains("--qa-screenshot-personality")
        var ordinal = 0
        if !args.contains("--qa-screenshot-live") { controller.qaScreenshotCapture = {
            if args.contains("--qa-screenshot-failure") { return .failure(.captureFailed) }
            ordinal += 1
            let image = NSImage(size: NSSize(width: 640, height: 400))
            image.lockFocus()
            NSColor(calibratedWhite: 0.97, alpha: 1).setFill()
            NSRect(x: 0, y: 0, width: 640, height: 400).fill()
            let title = ["READING  /  01", "QUESTION  /  02", "DETAIL  /  03"][(ordinal - 1) % 3]
            (title as NSString).draw(at: NSPoint(x: 44, y: 312), withAttributes: [
                .font: NSFont.monospacedSystemFont(ofSize: 25, weight: .bold), .foregroundColor: NSColor.darkGray])
            ("A train travels 120 km in 2 hours.\nWhat is its average speed?\n\nA. 40 km/h     B. 60 km/h     C. 80 km/h" as NSString)
                .draw(in: NSRect(x: 44, y: 80, width: 560, height: 180), withAttributes: [
                    .font: NSFont.systemFont(ofSize: 22), .foregroundColor: NSColor.black])
            image.unlockFocus()
            guard let tiff = image.tiffRepresentation,
                  let rep = NSBitmapImageRep(data: tiff),
                  let data = rep.representation(using: .jpeg, properties: [.compressionFactor: 0.9]) else {
                return .failure(.captureFailed)
            }
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("notchspi-qa-" + UUID().uuidString + ".jpg")
            do { try data.write(to: url); return .success(.init(path: url.path, blank: false, targetFingerprint: "qa-fixture", sourceFrame: NSScreen.main?.frame)) }
            catch { return .failure(.captureFailed) }
        }
        }
        if !localService || URL(string: OfficialAPI.baseURL)?.host != "127.0.0.1" {
            controller.qaScreenshotSubmit = { [weak controller] assets, mode in
                controller?.model.status = .idle
                controller?.model.statusText = "QA · simulated answer"
                controller?.model.screenshotStatus = "QA · \(assets.count) images submitted"
                controller?.model.answer = mode == "personality" ? "1. 当てはまる\n2. やや当てはまる" : "120 ÷ 2 = 60 km/h\nFINAL: B. 60 km/h"
                controller?.qaRefreshScreenshotLayout()
            }
        }
        let offset = args.firstIndex(of: "--qa-screenshot-delay").flatMap {
            $0 + 1 < args.count ? Double(args[$0 + 1]) : nil
        } ?? 0
        var delays = single || personality || args.contains("--qa-screenshot-waiting") ? [1.0] : [1.0, 9.0, 11.0]
        if !single, !personality, args.contains("--qa-screenshot-four") { delays.append(13.0) }
        for delay in delays {
            DispatchQueue.main.asyncAfter(deadline: .now() + delay + max(0, offset)) { [weak controller] in
                controller?.qaPressScreenshot(mode: personality ? "personality" : "tutor", multiple: !single && !personality)
            }
        }
    }
}
#endif
