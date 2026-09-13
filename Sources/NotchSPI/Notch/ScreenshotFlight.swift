import AppKit
import ImageIO
import QuartzCore

enum ScreenshotThumbnail {
    static func load(_ url: URL, maxPixelSize: Int = 480) -> NSImage? {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
              let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceThumbnailMaxPixelSize: maxPixelSize,
                kCGImageSourceCreateThumbnailWithTransform: true
              ] as CFDictionary) else { return nil }
        return NSImage(cgImage: image, size: NSSize(width: image.width, height: image.height))
    }
}

/// Image aspect is preserved in both the global flight and the tray's reserved slot.
enum ScreenshotFlightGeometry {
    static func cardFrame(image: CGSize, in slot: CGRect) -> CGRect {
        guard image.width > 0, image.height > 0, slot.width > 8, slot.height > 8 else { return slot }
        let scale = min((slot.width - 8) / image.width, (slot.height - 8) / image.height)
        let size = CGSize(width: image.width * scale + 8, height: image.height * scale + 8)
        return CGRect(x: slot.midX - size.width / 2, y: slot.midY - size.height / 2, width: size.width, height: size.height)
    }
    static func frame(source: CGRect, destination: CGRect, progress: CGFloat, reduced: Bool) -> CGRect {
        if reduced { return destination }
        let t = max(0, min(1, progress))
        let p = 1 - pow(1 - t, 3)
        let control = CGPoint(x: source.midX + (destination.midX - source.midX) * 0.3,
                              y: max(source.midY, destination.midY) + 40)
        let center = CGPoint(x: pow(1-p, 2)*source.midX + 2*(1-p)*p*control.x + p*p*destination.midX,
                             y: pow(1-p, 2)*source.midY + 2*(1-p)*p*control.y + p*p*destination.midY)
        let size = CGSize(width: source.width + (destination.width-source.width)*p,
                          height: source.height + (destination.height-source.height)*p)
        return CGRect(x: center.x-size.width/2, y: center.y-size.height/2, width: size.width, height: size.height)
    }
}

/// Independent, click-through flights. Each follows its own stable thumbnail ID, so another
/// screenshot can enter while an earlier one is still settling. No file or request ownership.
@MainActor
final class ScreenshotFlight {
    private var flights: [UUID: Flight] = [:]

    func fly(id: UUID, image: NSImage, from source: NSRect?,
             destination: @escaping () -> NSRect?, landed: @escaping () -> Void) {
        let flight = Flight(image: image, source: source, destination: destination)
        flights[id] = flight
        flight.start { [weak self] in
            self?.flights.removeValue(forKey: id)
            landed()
        }
    }

    func cancelAll() {
        for flight in flights.values { flight.stop() }
        flights.removeAll()
    }

    @MainActor
    private final class Flight {
        let panel: NotchPanel
        let card: NSView
        let source: NSRect?
        let imageSize: NSSize
        let destination: () -> NSRect?
        var tween: DisplayTween!
        var completed = false

        init(image: NSImage, source: NSRect?, destination: @escaping () -> NSRect?) {
            self.source = source
            self.imageSize = image.size
            self.destination = destination
            let desktop = NSScreen.screens.reduce(NSRect.null) { $0.union($1.frame) }
            panel = NotchPanel(contentRect: desktop.isNull ? (source ?? .zero) : desktop)
            panel.ignoresMouseEvents = true
            panel.level = NSWindow.Level(rawValue: NSWindow.Level.statusBar.rawValue + 1)
            let root = NSView(frame: NSRect(origin: .zero, size: panel.frame.size))
            root.wantsLayer = true
            panel.contentView = root
            card = NSView(frame: NSRect(origin: .zero, size: CaptureStyle.cardSize))
            let picture = NSImageView(frame: card.bounds.insetBy(dx: 4, dy: 4))
            picture.image = image
            picture.imageScaling = .scaleProportionallyUpOrDown
            picture.autoresizingMask = [.width, .height]
            card.addSubview(picture)
            card.wantsLayer = true
            card.layer?.backgroundColor = NSColor(calibratedWhite: 0.12, alpha: 1).cgColor
            card.layer?.cornerRadius = CaptureStyle.cardRadius
            card.layer?.borderWidth = 1
            card.layer?.borderColor = NSColor.white.withAlphaComponent(0.28).cgColor
            card.shadow = NSShadow()
            card.shadow?.shadowColor = NSColor.black.withAlphaComponent(0.38)
            card.shadow?.shadowBlurRadius = 22
            card.shadow?.shadowOffset = NSSize(width: 0, height: -8)
            root.addSubview(card)
            tween = DisplayTween(host: root)
            tween.ease = { $0 } // Position, scale and opacity have separate continuous curves.
        }

        func start(completion: @escaping () -> Void) {
            let reduced = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
            tween.onChange = { [weak self] t in
                guard let self, !self.completed else { return }
                guard let end = self.destination() else { self.stop(); completion(); return }
                let origin = self.source.map { ScreenshotFlightGeometry.cardFrame(image: self.imageSize, in: $0) } ?? end
                let frame = ScreenshotFlightGeometry.frame(source: origin, destination: end, progress: t, reduced: reduced || self.source == nil)
                let p = max(0, min(1, t))
                CATransaction.begin(); CATransaction.setDisableActions(true)
                self.card.frame = frame.offsetBy(dx: -self.panel.frame.minX, dy: -self.panel.frame.minY)
                self.card.alphaValue = min(1, t / (reduced ? 1 : 0.08))
                self.card.layer?.shadowRadius = 22 - 13 * p
                self.card.layer?.shadowOffset = CGSize(width: 0, height: -8 + 5 * p)
                CATransaction.commit()
                if t >= 1 { self.stop(); completion() }
            }
            panel.orderFrontRegardless()
            tween.set(0)
            tween.animate(to: 1, duration: reduced ? 0.18 : 0.86)
        }

        func stop() {
            guard !completed else { return }
            completed = true
            tween.onChange = nil
            tween.set(1)
            panel.orderOut(nil)
        }
    }
}
