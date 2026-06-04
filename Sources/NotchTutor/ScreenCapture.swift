import AppKit
import ScreenCaptureKit

enum ScreenCapture {
    struct Shot {
        let path: String
        let blank: Bool
    }

    /// Capture the main display to a temp JPEG (downscaled to ~1568px long edge).
    /// Returns nil on permission/error; `blank == true` means the frame looked
    /// empty/black (screen-recording permission not granted).
    static func capture(maxLongEdge: CGFloat = 1568) async -> Shot? {
        do {
            let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
            let mainID = CGMainDisplayID()
            guard let display = content.displays.first(where: { $0.displayID == mainID }) ?? content.displays.first
            else { return nil }

            let filter = SCContentFilter(display: display, excludingApplications: [], exceptingWindows: [])
            let config = SCStreamConfiguration()
            let scale = NSScreen.main?.backingScaleFactor ?? 2
            config.width = Int(CGFloat(display.width) * scale)
            config.height = Int(CGFloat(display.height) * scale)
            config.showsCursor = false

            let cg = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
            return encode(cg, maxLongEdge: maxLongEdge)
        } catch {
            return nil
        }
    }

    private static func encode(_ cg: CGImage, maxLongEdge: CGFloat) -> Shot? {
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
        let blank = jpg.count < 9000
        let file = NSTemporaryDirectory() + "notch-tutor-\(UUID().uuidString).jpg"
        do {
            try jpg.write(to: URL(fileURLWithPath: file))
        } catch {
            return nil
        }
        return Shot(path: file, blank: blank)
    }
}
