import AppKit

/// A small, resolution-independent model of the product. It is deliberately quiet:
/// the question and its destination are the only luminous objects in the scene.
/// No timer runs while the user is reading, and decorative content never enters AX.
final class OnboardingIllustration: NSView {
    private(set) var step: NotchOnboardingStep = .welcome
    private(set) var permissionGranted = false
    // Keep a single miniature screen alive across pages. Retarget from the *visible* pose,
    // including partially revealed leaves, so a quick Back never rewinds the illustration.
    private struct Pose {
        var paper: CGFloat = 1
        var multiple: CGFloat = 0
        var shield: CGFloat = 0
        var granted: CGFloat = 0
        var focus: CGFloat = 0
        var leaves: [CGFloat] = [0, 0, 0]
        static func destination(_ step: NotchOnboardingStep, granted: Bool) -> Pose {
            Pose(paper: step == .permission || step == .trial ? 0 : 1,
                 multiple: [.multiple, .multiCapture].contains(step) ? 1 : 0,
                 shield: step == .permission ? 1 : 0, granted: granted ? 1 : 0,
                 focus: [.capture, .multiCapture].contains(step) ? 1 : 0,
                 leaves: Array(repeating: step == .trial ? 1 : 0, count: 3))
        }
        func blended(to target: Pose, progress: CGFloat) -> Pose {
            func mix(_ a: CGFloat, _ b: CGFloat, delay: CGFloat = 0) -> CGFloat {
                let t = min(1, max(0, (progress - delay) / 0.70))
                let eased = t * t * t * (t * (t * 6 - 15) + 10)
                return a + (b - a) * eased
            }
            return Pose(paper: mix(paper, target.paper), multiple: mix(multiple, target.multiple),
                        shield: mix(shield, target.shield), granted: mix(granted, target.granted),
                        focus: mix(focus, target.focus),
                        leaves: leaves.indices.map { mix(leaves[$0], target.leaves[$0], delay: CGFloat($0) * 0.065) })
        }
    }
    private var origin = Pose()
    private var destination = Pose()
    private var hasPresented = false
    private lazy var motion = DisplayTween(host: self, value: 1)
    private var pose: Pose { origin.blended(to: destination, progress: motion.value) }
    private var accessibilityObserver: NSObjectProtocol?

    override init(frame: NSRect) {
        super.init(frame: frame)
        motion.ease = { $0 }
        motion.onChange = { [weak self] _ in self?.needsDisplay = true }
        accessibilityObserver = NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.accessibilityDisplayOptionsDidChangeNotification, object: nil, queue: .main
        ) { [weak self] _ in
            if onboardingReduceMotion() { self?.motion.set(1) }
        }
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    deinit {
        if let accessibilityObserver { NSWorkspace.shared.notificationCenter.removeObserver(accessibilityObserver) }
    }

    func present(step: NotchOnboardingStep, granted: Bool, animated: Bool) {
        guard !hasPresented || self.step != step || permissionGranted != granted else { return }
        origin = hasPresented ? pose : Pose(paper: 0)
        hasPresented = true
        destination = .destination(step, granted: granted)
        self.step = step; permissionGranted = granted
        guard animated, !onboardingReduceMotion(), window?.isVisible == true, !isHiddenOrHasHiddenAncestor else {
            motion.set(1)
            return
        }
        motion.set(0)
        motion.animate(to: 1, duration: onboardingMotionDuration(0.86))
    }
    override var isHidden: Bool {
        didSet { if isHidden { motion.set(1) } }
    }
    override func viewDidHide() { super.viewDidHide(); motion.set(1) }
    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        if window == nil { motion.set(1) }
    }
    override var isFlipped: Bool { true }
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
    override func isAccessibilityElement() -> Bool { false }

    override func draw(_ dirtyRect: NSRect) {
        guard let context = NSGraphicsContext.current?.cgContext else { return }
        context.saveGState()
        context.translateBy(x: bounds.midX - 142, y: bounds.midY - 52)
        let accent = NotchPalette.accent
        let pose = pose
        let trial = pose.leaves.reduce(0, +) / 3
        // A confined wash gives the illustration depth without washing out the copy.
        let glow = notchGradient([(accent.withAlphaComponent(0.16), 0), (accent.withAlphaComponent(0), 1)])
        context.drawRadialGradient(glow, startCenter: CGPoint(x: 142, y: 48), startRadius: 0,
            endCenter: CGPoint(x: 142, y: 48), endRadius: 126, options: [])

        context.saveGState()
        context.setAlpha(1 - trial)
        context.translateBy(x: 0, y: -4 * trial)
        let display = NSRect(x: 40, y: 4, width: 204, height: 94)
        let displayPath = NSBezierPath(roundedRect: display, xRadius: 12, yRadius: 12)
        NSColor(white: 0.07, alpha: 1).setFill(); displayPath.fill()
        let glass = notchGradient([(NSColor(white: 0.14, alpha: 1), 0), (NSColor(white: 0.075, alpha: 1), 1)])
        context.saveGState(); displayPath.addClip()
        context.drawLinearGradient(glass, start: CGPoint(x: 142, y: 4), end: CGPoint(x: 142, y: 98), options: [])
        if motion.isAnimating {
            // One low-contrast reflection traverses the glass during a handoff. It is clipped
            // to this 204-point screen and disappears entirely at rest.
            let x = 15 + 250 * motion.value
            let reflection = notchGradient([(NSColor(white: 1, alpha: 0), 0),
                (NSColor(white: 1, alpha: 0.055 * sin(.pi * motion.value)), 0.5),
                (NSColor(white: 1, alpha: 0), 1)])
            context.drawLinearGradient(reflection, start: .init(x: x - 30, y: 20), end: .init(x: x + 30, y: 65), options: [])
        }
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
        let arrival = sin(.pi * min(1, max(0, (motion.value - 0.58) / 0.42)))
        pill(NSRect(x: 116, y: 15, width: 37 + 3 * arrival, height: 3), color: accent.withAlphaComponent(0.70 + 0.25 * arrival))
        pill(NSRect(x: 158, y: 15, width: 10, height: 3), color: NSColor(white: 1, alpha: 0.55))

        context.saveGState()
        context.setAlpha((1 - trial) * pose.paper)
        context.translateBy(x: 0, y: 6 * (1 - pose.paper))
        if pose.paper > 0 {
            context.saveGState()
            context.setAlpha((1 - trial) * pose.paper * pose.multiple)
            paper(NSRect(x: 143 + 17 * pose.multiple, y: 43 + 5 * (1 - pose.multiple), width: 50, height: 44), accent: accent, second: true)
            context.restoreGState()
            let paperRect = NSRect(x: 113 - 29 * pose.multiple, y: 42, width: 58, height: 44)
            paper(paperRect, accent: accent, second: false)
            focusCorners(paperRect.insetBy(dx: -5 - 3 * (1 - pose.focus), dy: -5 - 3 * (1 - pose.focus)),
                         color: accent.withAlphaComponent(pose.focus))
            let link = NSBezierPath()
            link.move(to: CGPoint(x: paperRect.midX, y: 39))
            link.curve(to: CGPoint(x: 142, y: 32), controlPoint1: CGPoint(x: paperRect.midX, y: 30), controlPoint2: CGPoint(x: 142, y: 40))
            accent.withAlphaComponent(0.35).setStroke(); link.lineWidth = 0.75; link.stroke()
            // A single bead follows the exact Bézier into the notch, then settles to silence.
            let t = min(1, max(0, (motion.value - 0.18) / 0.62)), u = 1 - t
            let point = CGPoint(x: (u*u*u + 3*u*u*t) * paperRect.midX + (3*u*t*t + t*t*t) * 142,
                                y: u*u*u*39 + 3*u*u*t*30 + 3*u*t*t*40 + t*t*t*32)
            let energy = sin(.pi * t)
            context.saveGState()
            context.setShadow(offset: .zero, blur: 5, color: accent.withAlphaComponent(energy * 0.7).cgColor)
            accent.withAlphaComponent(energy).setFill()
            NSBezierPath(ovalIn: NSRect(x: point.x - 1.5, y: point.y - 1.5, width: 3, height: 3)).fill()
            context.restoreGState()
        }
        context.restoreGState()
        context.saveGState()
        // NSImage supplies its own alpha when drawing; pass the full scene weight in its
        // fraction instead of relying on the surrounding CGContext alpha.
        context.setAlpha(1)
        context.translateBy(x: 0, y: 5 * (1 - pose.shield))
        drawPermission(granted: false, accent: accent, opacity: (1 - trial) * pose.shield * (1 - pose.granted))
        drawPermission(granted: true, accent: accent, opacity: (1 - trial) * pose.shield * pose.granted)
        context.restoreGState()
        // Short rails ground the floating screen, with no extra instructional text.
        pill(NSRect(x: 14, y: 51, width: 16, height: 1), color: NSColor(white: 1, alpha: 0.13))
        pill(NSRect(x: 254, y: 51, width: 16, height: 1), color: NSColor(white: 1, alpha: 0.13))
        context.restoreGState()
        drawTrial(accent: accent, leaves: pose.leaves)
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
        color.setStroke(); path.stroke()
    }

    private func drawPermission(granted: Bool, accent: NSColor, opacity: CGFloat) {
        guard opacity > 0 else { return }
        let symbol = granted ? "checkmark.shield" : "lock.shield"
        let image = NSImage(systemSymbolName: symbol, accessibilityDescription: nil)?
            .withSymbolConfiguration(.init(pointSize: 33, weight: .light))?
            .withSymbolConfiguration(.init(paletteColors: [accent]))
        NSGraphicsContext.saveGraphicsState()
        let rect = NSRect(x: 124, y: 43, width: 36, height: 39)
        image?.draw(in: rect, from: .zero, operation: .sourceOver, fraction: opacity, respectFlipped: true, hints: nil)
        NSGraphicsContext.restoreGraphicsState()
    }

    private func drawTrial(accent: NSColor, leaves: [CGFloat]) {
        // Three calendar leaves make the duration legible without another line of copy.
        for index in 0..<3 {
            guard leaves[index] > 0 else { continue }
            NSGraphicsContext.saveGraphicsState()
            NSGraphicsContext.current?.cgContext.setAlpha(leaves[index])
            NSGraphicsContext.current?.cgContext.translateBy(x: 0, y: 12 * (1 - leaves[index]))
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
            NSGraphicsContext.restoreGraphicsState()
        }
    }

    #if DEBUG
    func qaUseManualClock() { motion.qaManualTime = 0 }
    func qaAdvance(by interval: TimeInterval) { motion.qaAdvance(by: interval) }
    var qaIsAnimating: Bool { motion.isAnimating }
    var qaPose: [CGFloat] {
        let p = pose
        return [p.paper, p.multiple, p.shield, p.granted, p.focus] + p.leaves
    }
    #endif
}
