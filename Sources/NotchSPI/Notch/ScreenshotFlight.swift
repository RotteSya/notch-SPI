import AppKit
import ImageIO
import QuartzCore

enum ScreenshotThumbnail {
    static func loadPixels(_ url: URL, maxPixelSize: Int = 480) -> CGImage? {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
              let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceThumbnailMaxPixelSize: maxPixelSize,
                kCGImageSourceCreateThumbnailWithTransform: true
              ] as CFDictionary) else { return nil }
        return image
    }

    @MainActor
    static func load(_ url: URL, maxPixelSize: Int = 480) -> NSImage? {
        guard let image = loadPixels(url, maxPixelSize: maxPixelSize) else { return nil }
        return NSImage(cgImage: image, size: NSSize(width: image.width, height: image.height))
    }
}

/// Image aspect is preserved in both the global flight and the tray's reserved slot.
enum ScreenshotFlightGeometry {
    static let duration = SharedVisual.number("flightStyle.duration")
    static func sourceFrame(image: CGSize, in area: CGRect) -> CGRect {
        SharedVisual.nativeRect(SharedVisual.call("fit", [["width": image.width, "height": image.height], SharedVisual.rect(area)]))
    }
    static func travelProgress(_ progress: CGFloat) -> CGFloat { SharedVisual.call("travel", [progress]).toDouble() }
    static func photoInset(progress: CGFloat) -> CGFloat { 4 * travelProgress(progress) }
    static func cardFrame(image: CGSize, in slot: CGRect) -> CGRect {
        SharedVisual.nativeRect(SharedVisual.call("fit", [["width":image.width,"height":image.height], SharedVisual.rect(slot), 4]))
    }
    static func avoidingCutouts(_ frame: CGRect, angle: CGFloat, cutouts: [CGRect]) -> CGRect {
        SharedVisual.nativeRect(SharedVisual.call("avoidCutouts", [SharedVisual.rect(frame), -angle, cutouts.map { SharedVisual.rect($0) }]))
    }
    static func frame(source: CGRect, destination: CGRect, progress: CGFloat, reduced: Bool) -> CGRect {
        SharedVisual.nativeRect(SharedVisual.call("flightFrame", [SharedVisual.rect(source), SharedVisual.rect(destination), progress, reduced]))
    }
}

/// Independent, click-through flights. Each follows its own stable thumbnail ID, so another
/// screenshot can enter while an earlier one is still settling. No file or request ownership.
@MainActor
final class ScreenshotFlight {
    private var flights: [UUID: Flight] = [:]

    #if DEBUG
    var qaManualClock = false
    var qaReduceMotion: Bool?
    func qaAdvance(by interval: CFTimeInterval) {
        for flight in Array(flights.values) { flight.tween.qaAdvance(by: interval) }
    }
    func qaSnapshot(_ id: UUID) -> (frame: CGRect, inset: CGFloat, angle: CGFloat, opacity: Float)? {
        guard let flight = flights[id] else { return nil }
        let card = flight.card
        let frame = CGRect(x: card.position.x - card.bounds.width / 2 + flight.panel.frame.minX,
                           y: card.position.y - card.bounds.height / 2 + flight.panel.frame.minY,
                           width: card.bounds.width, height: card.bounds.height)
        let transform = card.affineTransform()
        return (frame, flight.picture.frame.minX, atan2(transform.b, transform.a), card.opacity)
    }
    #endif

    func fly(id: UUID, image: NSImage, from source: NSRect?,
             destination: @escaping () -> NSRect?, landed: @escaping () -> Void) {
        let flight = Flight(image: image, source: source, destination: destination)
        #if DEBUG
        if qaManualClock { flight.tween.qaManualTime = 0 }
        flight.qaReduceMotion = qaReduceMotion
        #endif
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
        let card = CALayer()
        let picture = CALayer()
        let source: NSRect?
        let imageSize: NSSize
        let destination: () -> NSRect?
        var tween: DisplayTween!
        var completed = false
        #if DEBUG
        var qaReduceMotion: Bool?
        #endif

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
            picture.contents = image.cgImage(forProposedRect: nil, context: nil, hints: nil)
            picture.contentsGravity = .resizeAspect
            picture.masksToBounds = true
            card.borderColor = NSColor.white.withAlphaComponent(0.14).cgColor
            card.shadowColor = NSColor.black.cgColor
            card.addSublayer(picture)
            root.layer?.addSublayer(card)
            card.contentsScale = panel.backingScaleFactor
            picture.contentsScale = panel.backingScaleFactor
            tween = DisplayTween(host: root)
            tween.ease = { $0 } // Position, scale and opacity have separate continuous curves.
        }

        func start(completion: @escaping () -> Void) {
            var reduced = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
            #if DEBUG
            reduced = qaReduceMotion ?? reduced
            #endif
            reduced = reduced || source == nil
            tween.onChange = { [weak self] t in
                guard let self, !self.completed else { return }
                guard let end = self.destination() else { self.stop(); completion(); return }
                let origin = self.source.map { ScreenshotFlightGeometry.sourceFrame(image: self.imageSize, in: $0) } ?? end
                let frame = ScreenshotFlightGeometry.frame(source: origin, destination: end, progress: t, reduced: reduced)
                let p = reduced ? 1 : ScreenshotFlightGeometry.travelProgress(t)
                let inset = 4 * p
                let radius = CaptureStyle.cardRadius * p
                let direction: CGFloat = end.midX < origin.midX ? -1 : 1
                let angle = reduced ? 0 : sin(.pi * p) * 2.2 * direction * .pi / 180
                let cutouts = NSScreen.screens.compactMap { screen in
                    NotchScreenLayout(frame: screen.frame, visibleFrame: screen.visibleFrame,
                        scale: screen.backingScaleFactor, safeTop: screen.safeAreaInsets.top,
                        auxiliaryLeft: screen.auxiliaryTopLeftArea, auxiliaryRight: screen.auxiliaryTopRightArea).cutout
                }
                let safeFrame = ScreenshotFlightGeometry.avoidingCutouts(frame, angle: angle, cutouts: cutouts)
                let local = safeFrame.offsetBy(dx: -self.panel.frame.minX, dy: -self.panel.frame.minY)
                CATransaction.begin(); CATransaction.setDisableActions(true)
                self.card.bounds = CGRect(origin: .zero, size: local.size)
                self.card.position = CGPoint(x: local.midX, y: local.midY)
                self.card.setAffineTransform(CGAffineTransform(rotationAngle: angle))
                self.card.opacity = Float(min(1, t / (reduced ? 1 : 0.04)))
                self.card.backgroundColor = NSColor(calibratedWhite: 0.14, alpha: p).cgColor
                self.card.cornerRadius = radius
                self.card.borderWidth = 0.5 * p
                self.card.shadowOpacity = Float(0.3 * p)
                self.card.shadowRadius = 12 - 9 * p
                self.card.shadowOffset = CGSize(width: 0, height: -8 + 5 * p)
                self.card.shadowPath = CGPath(roundedRect: self.card.bounds, cornerWidth: radius,
                                              cornerHeight: radius, transform: nil)
                self.picture.frame = self.card.bounds.insetBy(dx: inset, dy: inset)
                self.picture.cornerRadius = max(0, radius - inset)
                CATransaction.commit()
                if t >= 1 { self.stop(); completion() }
            }
            panel.orderFrontRegardless()
            tween.set(0)
            var duration = ScreenshotFlightGeometry.duration
            #if DEBUG
            // Inspection only: stretch the same curve, never the capture/submission timers.
            if ProcessInfo.processInfo.environment["NSPI_SLOW_SCREENSHOT_FLIGHT"] == "1" { duration = 2.4 }
            #endif
            tween.animate(to: 1, duration: reduced ? 0.18 : duration)
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
