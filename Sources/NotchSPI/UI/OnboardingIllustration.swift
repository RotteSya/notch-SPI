import AppKit

/// A small, resolution-independent model of the product. It is deliberately quiet:
/// the question and its destination are the only luminous objects in the scene.
/// No timer runs while the user is reading, and decorative content never enters AX.
final class OnboardingIllustration: NSView {
    var step: NotchOnboardingStep = .welcome { didSet { needsDisplay = true } }
    var permissionGranted = false { didSet { needsDisplay = true } }
    private lazy var reveal = DisplayTween(host: self, value: 1)
    func present(step: NotchOnboardingStep, granted: Bool, animated: Bool) {
        self.step = step; permissionGranted = granted
        reveal.onChange = { [weak self] _ in self?.needsDisplay = true }
        guard animated, !onboardingReduceMotion(), window?.isVisible == true else {
            reveal.set(1)
            return
        }
        reveal.set(0)
        reveal.ease = { NotchMotion.outCubic($0) }
        reveal.animate(to: 1, duration: onboardingMotionDuration(0.56))
    }
    override var isFlipped: Bool { true }
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
    override func isAccessibilityElement() -> Bool { false }

    override func draw(_ dirtyRect: NSRect) {
        guard let context = NSGraphicsContext.current?.cgContext else { return }
        context.saveGState()
        context.translateBy(x: bounds.midX - 142, y: bounds.midY - 52)
        let accent = NotchPalette.accent
        // A confined wash gives the illustration depth without washing out the copy.
        let glow = notchGradient([(accent.withAlphaComponent(0.16), 0), (accent.withAlphaComponent(0), 1)])
        context.drawRadialGradient(glow, startCenter: CGPoint(x: 142, y: 48), startRadius: 0,
            endCenter: CGPoint(x: 142, y: 48), endRadius: 126, options: [])

        if step == .trial {
            context.setAlpha(0.25 + 0.75 * reveal.value)
            context.translateBy(x: 0, y: 7 * (1 - reveal.value))
            drawTrial(accent: accent)
            context.restoreGState()
            return
        }

        let display = NSRect(x: 40, y: 4, width: 204, height: 94)
        let displayPath = NSBezierPath(roundedRect: display, xRadius: 12, yRadius: 12)
        NSColor(white: 0.07, alpha: 1).setFill(); displayPath.fill()
        let glass = notchGradient([(NSColor(white: 0.14, alpha: 1), 0), (NSColor(white: 0.075, alpha: 1), 1)])
        context.saveGState(); displayPath.addClip()
        context.drawLinearGradient(glass, start: CGPoint(x: 142, y: 4), end: CGPoint(x: 142, y: 98), options: [])
        context.restoreGState()
        NSColor(white: 1, alpha: 0.18).setStroke(); displayPath.lineWidth = 0.75; displayPath.stroke()

        // The notch's top edge is flush with the miniature screen, just like the real panel.
        let notch = NSBezierPath()
        notch.move(to: CGPoint(x: 96, y: 4)); notch.line(to: CGPoint(x: 188, y: 4))
        notch.line(to: CGPoint(x: 188, y: 20))
        notch.curve(to: CGPoint(x: 179, y: 29), controlPoint1: CGPoint(x: 188, y: 26), controlPoint2: CGPoint(x: 185, y: 29))
        notch.line(to: CGPoint(x: 105, y: 29))
        notch.curve(to: CGPoint(x: 96, y: 20), controlPoint1: CGPoint(x: 99, y: 29), controlPoint2: CGPoint(x: 96, y: 26))
        notch.close(); NSColor.black.setFill(); notch.fill()
        pill(NSRect(x: 116, y: 15, width: 37, height: 3), color: accent.withAlphaComponent(0.35 + 0.6 * reveal.value))
        pill(NSRect(x: 158, y: 15, width: 10, height: 3), color: NSColor(white: 1, alpha: 0.55))

        context.saveGState()
        context.setAlpha(0.25 + 0.75 * reveal.value)
        context.translateBy(x: 0, y: 7 * (1 - reveal.value))
        if step == .permission {
            drawPermission(granted: permissionGranted, accent: accent)
        } else {
            let multiple = step == .multiple || step == .multiCapture
            if multiple { paper(NSRect(x: 160, y: 43, width: 50, height: 44), accent: accent, second: true) }
            let paperRect = NSRect(x: multiple ? 84 : 113, y: 42, width: 58, height: 44)
            paper(paperRect, accent: accent, second: false)
            if step == .capture || step == .multiCapture { focusCorners(paperRect.insetBy(dx: -5, dy: -5), color: accent) }
            let link = NSBezierPath()
            link.move(to: CGPoint(x: paperRect.midX, y: 39))
            link.curve(to: CGPoint(x: 142, y: 32), controlPoint1: CGPoint(x: paperRect.midX, y: 30), controlPoint2: CGPoint(x: 142, y: 40))
            accent.withAlphaComponent(0.65).setStroke(); link.lineWidth = 1; link.stroke()
        }
        context.restoreGState()
        // Short rails ground the floating screen, with no extra instructional text.
        pill(NSRect(x: 14, y: 51, width: 16, height: 1), color: NSColor(white: 1, alpha: 0.13))
        pill(NSRect(x: 254, y: 51, width: 16, height: 1), color: NSColor(white: 1, alpha: 0.13))
        context.restoreGState()
    }

    private func pill(_ rect: NSRect, color: NSColor) {
        color.setFill(); NSBezierPath(roundedRect: rect, xRadius: rect.height / 2, yRadius: rect.height / 2).fill()
    }

    private func paper(_ rect: NSRect, accent: NSColor, second: Bool) {
        let shadow = NSShadow(); shadow.shadowColor = NSColor.black.withAlphaComponent(0.28)
        shadow.shadowBlurRadius = 8; shadow.shadowOffset = NSSize(width: 0, height: -3)
        NSGraphicsContext.saveGraphicsState(); shadow.set()
        let path = NSBezierPath(roundedRect: rect, xRadius: 5, yRadius: 5)
        NSColor(white: second ? 0.8 : 0.96, alpha: 1).setFill(); path.fill()
        NSGraphicsContext.restoreGraphicsState()
        let ink = NSColor(white: 0.16, alpha: 0.7)
        pill(NSRect(x: rect.minX + 9, y: rect.minY + 10, width: rect.width - 22, height: 2.5), color: ink)
        pill(NSRect(x: rect.minX + 9, y: rect.minY + 17, width: rect.width - 18, height: 2), color: ink.withAlphaComponent(0.25))
        pill(NSRect(x: rect.minX + 9, y: rect.minY + 23, width: rect.width - 27, height: 2), color: ink.withAlphaComponent(0.25))
        for i in 0..<3 {
            pill(NSRect(x: rect.minX + 9 + CGFloat(i) * 11, y: rect.minY + 32, width: 6, height: 3),
                color: i == 1 ? accent : ink.withAlphaComponent(0.15))
        }
    }

    private func focusCorners(_ rect: NSRect, color: NSColor) {
        let path = NSBezierPath(); path.lineWidth = 1.25; path.lineCapStyle = .round; path.lineJoinStyle = .round
        for (x, y, dx, dy) in [(rect.minX, rect.minY, 1.0, 1.0), (rect.maxX, rect.minY, -1, 1),
                                (rect.minX, rect.maxY, 1, -1), (rect.maxX, rect.maxY, -1, -1)] {
            path.move(to: CGPoint(x: x, y: y + dy * 5)); path.line(to: CGPoint(x: x, y: y))
            path.line(to: CGPoint(x: x + dx * 5, y: y))
        }
        color.withAlphaComponent(0.9).setStroke(); path.stroke()
    }

    private func drawPermission(granted: Bool, accent: NSColor) {
        let symbol = granted ? "checkmark.shield" : "lock.shield"
        let image = NSImage(systemSymbolName: symbol, accessibilityDescription: nil)?
            .withSymbolConfiguration(.init(pointSize: 33, weight: .light))?
            .withSymbolConfiguration(.init(paletteColors: [accent]))
        NSGraphicsContext.saveGraphicsState()
        let rect = NSRect(x: 124, y: 43, width: 36, height: 39)
        image?.draw(in: rect)
        NSGraphicsContext.restoreGraphicsState()
    }

    private func drawTrial(accent: NSColor) {
        // Three calendar leaves make the duration legible without another line of copy.
        for index in 0..<3 {
            let rect = NSRect(x: 48 + CGFloat(index) * 64, y: index == 1 ? 9 : 17, width: 60, height: 76)
            let path = NSBezierPath(roundedRect: rect, xRadius: 10, yRadius: 10)
            NSColor(white: index == 1 ? 0.12 : 0.085, alpha: 1).setFill(); path.fill()
            (index == 1 ? accent.withAlphaComponent(0.6) : NSColor(white: 1, alpha: 0.16)).setStroke()
            path.lineWidth = 0.75; path.stroke()
            for offset in [18.0, 42.0] {
                pill(NSRect(x: rect.minX + offset - 1, y: rect.minY - 3, width: 2, height: 8),
                     color: NSColor(white: 1, alpha: 0.4))
            }
            pill(NSRect(x: rect.minX + 11, y: rect.minY + 17, width: 38, height: 1),
                 color: NSColor(white: 1, alpha: 0.1))
            let number = NSAttributedString(string: "\(index + 1)", attributes: [
                .font: NSFont.monospacedDigitSystemFont(ofSize: 29, weight: .light),
                .foregroundColor: index == 1 ? accent : NSColor(white: 1, alpha: 0.78),
            ])
            let size = number.size()
            number.draw(at: NSPoint(x: rect.midX - size.width / 2, y: rect.minY + 25))
            pill(NSRect(x: rect.midX - 6, y: rect.maxY - 10, width: 12, height: 2),
                 color: accent.withAlphaComponent(index == 1 ? 0.8 : 0.28))
        }
    }
}
