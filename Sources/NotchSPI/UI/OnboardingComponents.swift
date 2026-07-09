import AppKit
import QuartzCore

// Small custom controls shared by the onboarding flow (and reusable elsewhere). All are pure
// AppKit in the codebase's house style: flipped where stacking matters, first-mouse friendly,
// drawn in draw(_:) so there is no layer ordering to fight.

// MARK: - Primary / secondary capsule button

/// A capsule action button on the dark aurora field. `.primary` fills with the accent gradient
/// and glows gently on hover; `.secondary` is a hairline glass outline; `.ghost` is bare text.
final class GlowButton: NSControl {
    enum Style { case primary, secondary, ghost }

    var title: String { didSet { needsDisplay = true; invalidateIntrinsicContentSize() } }
    var style: Style { didSet { needsDisplay = true } }
    var onClick: (() -> Void)?

    private var hovering = false { didSet { if hovering != oldValue { needsDisplay = true } } }
    private var pressed = false { didSet { if pressed != oldValue { needsDisplay = true } } }
    private var trackingAreaRef: NSTrackingArea?

    init(title: String, style: Style = .primary, action: (() -> Void)? = nil) {
        self.title = title
        self.style = style
        self.onClick = action
        super.init(frame: .zero)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override var acceptsFirstResponder: Bool { false }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    private var titleFont: NSFont { .systemFont(ofSize: 13.5, weight: style == .primary ? .semibold : .medium) }

    override var intrinsicContentSize: NSSize {
        let s = (title as NSString).size(withAttributes: [.font: titleFont])
        let hPad: CGFloat = style == .ghost ? 10 : 22
        return NSSize(width: ceil(s.width) + hPad * 2, height: 34)
    }

    override func draw(_ dirtyRect: NSRect) {
        guard let ctx = NSGraphicsContext.current?.cgContext else { return }
        let b = bounds
        let scale: CGFloat = pressed ? 0.97 : 1
        ctx.saveGState()
        ctx.translateBy(x: b.midX, y: b.midY)
        ctx.scaleBy(x: scale, y: scale)
        ctx.translateBy(x: -b.midX, y: -b.midY)

        let r = b.insetBy(dx: 1, dy: 1)
        let capsule = NSBezierPath(roundedRect: r, xRadius: r.height / 2, yRadius: r.height / 2)
        let textColor: NSColor

        switch style {
        case .primary:
            // Accent gradient body with a hover glow halo.
            if hovering {
                ctx.setShadow(offset: .zero, blur: 14,
                              color: NotchPalette.accent.withAlphaComponent(0.55).cgColor)
            }
            let g = NSGradient(starting: NotchPalette.accentHi, ending: NotchPalette.accent)
            g?.draw(in: capsule, angle: -90)
            ctx.setShadow(offset: .zero, blur: 0, color: nil)
            textColor = NSColor(srgbRed: 0.04, green: 0.05, blue: 0.10, alpha: 1)
        case .secondary:
            NSColor(white: 1, alpha: hovering ? 0.12 : 0.06).setFill()
            capsule.fill()
            capsule.lineWidth = 1
            NSColor(white: 1, alpha: hovering ? 0.35 : 0.22).setStroke()
            capsule.stroke()
            textColor = NSColor(white: 1, alpha: 0.92)
        case .ghost:
            textColor = NSColor(white: 1, alpha: hovering ? 0.85 : 0.55)
        }

        let attrs: [NSAttributedString.Key: Any] = [.font: titleFont, .foregroundColor: textColor]
        let ts = (title as NSString).size(withAttributes: attrs)
        (title as NSString).draw(
            at: NSPoint(x: b.midX - ts.width / 2, y: b.midY - ts.height / 2), withAttributes: attrs)
        ctx.restoreGState()
    }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let t = trackingAreaRef { removeTrackingArea(t) }
        let t = NSTrackingArea(rect: bounds, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect],
                               owner: self, userInfo: nil)
        addTrackingArea(t)
        trackingAreaRef = t
    }

    override func mouseEntered(with event: NSEvent) { hovering = true }
    override func mouseExited(with event: NSEvent) { hovering = false; pressed = false }
    override func mouseDown(with event: NSEvent) { pressed = true }
    override func mouseDragged(with event: NSEvent) {
        pressed = bounds.contains(convert(event.locationInWindow, from: nil))
    }
    override func mouseUp(with event: NSEvent) {
        let inside = bounds.contains(convert(event.locationInWindow, from: nil))
        pressed = false
        if inside { onClick?() }
    }
}

// MARK: - Language pill (welcome page)

/// One selectable language pill. The page owns the exclusive-selection behavior.
final class LanguagePill: NSControl {
    let language: AppLanguage
    var isChosen = false { didSet { needsDisplay = true } }
    var onPick: ((AppLanguage) -> Void)?

    private var hovering = false { didSet { needsDisplay = true } }
    private var trackingAreaRef: NSTrackingArea?

    init(language: AppLanguage) {
        self.language = language
        super.init(frame: .zero)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    override var intrinsicContentSize: NSSize {
        let s = (language.pickerLabel as NSString).size(withAttributes: [.font: NSFont.systemFont(ofSize: 12.5, weight: .medium)])
        return NSSize(width: ceil(s.width) + 30, height: 28)
    }

    override func draw(_ dirtyRect: NSRect) {
        let r = bounds.insetBy(dx: 1, dy: 1)
        let capsule = NSBezierPath(roundedRect: r, xRadius: r.height / 2, yRadius: r.height / 2)
        if isChosen {
            NotchPalette.accent.withAlphaComponent(0.22).setFill()
            capsule.fill()
            capsule.lineWidth = 1
            NotchPalette.accentHi.withAlphaComponent(0.8).setStroke()
            capsule.stroke()
        } else {
            NSColor(white: 1, alpha: hovering ? 0.10 : 0.05).setFill()
            capsule.fill()
            capsule.lineWidth = 1
            NSColor(white: 1, alpha: 0.14).setStroke()
            capsule.stroke()
        }
        let color = isChosen ? NotchPalette.accentHi : NSColor(white: 1, alpha: 0.8)
        let attrs: [NSAttributedString.Key: Any] = [
            .font: NSFont.systemFont(ofSize: 12.5, weight: .medium), .foregroundColor: color,
        ]
        let ts = (language.pickerLabel as NSString).size(withAttributes: attrs)
        (language.pickerLabel as NSString).draw(
            at: NSPoint(x: bounds.midX - ts.width / 2, y: bounds.midY - ts.height / 2), withAttributes: attrs)
    }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let t = trackingAreaRef { removeTrackingArea(t) }
        let t = NSTrackingArea(rect: bounds, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect],
                               owner: self, userInfo: nil)
        addTrackingArea(t)
        trackingAreaRef = t
    }

    override func mouseEntered(with event: NSEvent) { hovering = true }
    override func mouseExited(with event: NSEvent) { hovering = false }
    override func mouseUp(with event: NSEvent) {
        if bounds.contains(convert(event.locationInWindow, from: nil)) { onPick?(language) }
    }
}

// MARK: - Keycap chip

/// A hotkey rendered as physical keycaps (one cap per symbol): soft top-lit gradient, hairline
/// rim, baked shadow — the visual language of a real keyboard, so "press this" needs no words.
final class KeycapChipView: NSView {
    var keys: [String] { didSet { needsDisplay = true; invalidateIntrinsicContentSize() } }
    var capSize: CGFloat

    init(keys: [String], capSize: CGFloat = 40) {
        self.keys = keys
        self.capSize = capSize
        super.init(frame: .zero)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    private var gap: CGFloat { capSize * 0.22 }

    override var intrinsicContentSize: NSSize {
        let n = CGFloat(keys.count)
        return NSSize(width: n * capSize + max(0, n - 1) * gap, height: capSize + 6)
    }

    override func draw(_ dirtyRect: NSRect) {
        guard let ctx = NSGraphicsContext.current?.cgContext else { return }
        var x: CGFloat = 0
        for key in keys {
            let r = NSRect(x: x, y: 3, width: capSize, height: capSize)
            let path = NSBezierPath(roundedRect: r, xRadius: capSize * 0.24, yRadius: capSize * 0.24)

            // drop shadow seating the cap
            ctx.saveGState()
            ctx.setShadow(offset: CGSize(width: 0, height: -2), blur: 4,
                          color: NSColor.black.withAlphaComponent(0.5).cgColor)
            NSColor(white: 0.16, alpha: 1).setFill()
            path.fill()
            ctx.restoreGState()

            // top-lit face
            NSGradient(starting: NSColor(white: 0.30, alpha: 1), ending: NSColor(white: 0.17, alpha: 1))?
                .draw(in: path, angle: -90)
            path.lineWidth = 1
            NSColor(white: 1, alpha: 0.16).setStroke()
            path.stroke()

            let attrs: [NSAttributedString.Key: Any] = [
                .font: NSFont.systemFont(ofSize: capSize * 0.45, weight: .medium),
                .foregroundColor: NSColor(white: 1, alpha: 0.95),
            ]
            let ts = (key as NSString).size(withAttributes: attrs)
            (key as NSString).draw(
                at: NSPoint(x: r.midX - ts.width / 2, y: r.midY - ts.height / 2), withAttributes: attrs)
            x += capSize + gap
        }
    }

    /// Split a display string like "⌘⇧1" or "⌘⇧Space" into per-cap symbols: leading modifier
    /// glyphs each get their own cap, and whatever remains is the key label.
    static func caps(from combo: HotkeyCombo) -> [String] {
        var out: [String] = []
        var label = Settings.displayString(combo)
        while let first = label.first, ["⌃", "⌥", "⇧", "⌘"].contains(String(first)) {
            out.append(String(first))
            label.removeFirst()
        }
        if !label.isEmpty { out.append(label) }
        return out
    }
}

// MARK: - Rolling counter

/// A number that rolls up from 0 with an ease-out curve — the "180 questions arrived" moment.
final class RollingCounterView: NSView {
    var suffix: String = "" { didSet { needsDisplay = true } }
    var fontSize: CGFloat = 56
    var color: NSColor = .white

    private(set) var value: Int = 0
    private var target: Int = 0
    private var from: Int = 0
    private var startTime: CFTimeInterval = 0
    private var duration: CFTimeInterval = 1.2
    private var link: CADisplayLink?
    var onFinished: (() -> Void)?

    private var reduceMotion: Bool { NSWorkspace.shared.accessibilityDisplayShouldReduceMotion }

    override func hitTest(_ point: NSPoint) -> NSView? { nil }

    func roll(to newTarget: Int, duration: CFTimeInterval = 1.2) {
        target = newTarget
        guard !reduceMotion else {
            value = newTarget
            needsDisplay = true
            onFinished?()
            return
        }
        from = value
        self.duration = max(0.01, duration)
        startTime = CACurrentMediaTime()
        if link == nil {
            let l = displayLink(target: self, selector: #selector(tick))
            l.add(to: .main, forMode: .common)
            link = l
        }
        link?.isPaused = false
    }

    func set(_ v: Int) {
        link?.isPaused = true
        value = v
        target = v
        needsDisplay = true
    }

    @objc private func tick() {
        let t = min(1, max(0, (CACurrentMediaTime() - startTime) / duration))
        let eased = 1 - pow(1 - t, 3)
        value = from + Int((Double(target - from) * eased).rounded())
        needsDisplay = true
        if t >= 1 {
            value = target
            link?.isPaused = true
            needsDisplay = true
            onFinished?()
        }
    }

    override func draw(_ dirtyRect: NSRect) {
        let numberAttrs: [NSAttributedString.Key: Any] = [
            .font: NSFont.monospacedDigitSystemFont(ofSize: fontSize, weight: .bold),
            .foregroundColor: color,
        ]
        let suffixAttrs: [NSAttributedString.Key: Any] = [
            .font: NSFont.systemFont(ofSize: fontSize * 0.38, weight: .semibold),
            .foregroundColor: color.withAlphaComponent(0.75),
        ]
        let s = NSMutableAttributedString(string: "\(value)", attributes: numberAttrs)
        if !suffix.isEmpty {
            s.append(NSAttributedString(string: " " + suffix, attributes: suffixAttrs))
        }
        let size = s.size()
        s.draw(at: NSPoint(x: bounds.midX - size.width / 2, y: bounds.midY - size.height / 2))
    }

    deinit { link?.invalidate() }
}

// MARK: - Confetti

/// A short celebratory burst (CAEmitterLayer) in the brand palette. Fire-and-forget:
/// `burst()` emits for ~0.9s and the particles fade on their own. Skipped under Reduce Motion.
final class ConfettiView: NSView {
    private var emitter: CAEmitterLayer?

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func hitTest(_ point: NSPoint) -> NSView? { nil }

    func burst() {
        guard !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion else { return }
        emitter?.removeFromSuperlayer()

        let e = CAEmitterLayer()
        e.frame = bounds
        e.emitterPosition = CGPoint(x: bounds.midX, y: bounds.midY - 10)
        e.emitterShape = .point
        e.birthRate = 1

        let colors: [NSColor] = [
            NotchPalette.accent, NotchPalette.accentHi,
            NSColor(srgbRed: 0.95, green: 0.72, blue: 0.35, alpha: 1),   // amber
            NSColor(srgbRed: 0.93, green: 0.55, blue: 0.70, alpha: 1),   // sakura
            NSColor(srgbRed: 0.45, green: 0.85, blue: 0.70, alpha: 1),   // matcha
        ]
        e.emitterCells = colors.flatMap { color in
            [Self.cell(color: color, shape: .rect), Self.cell(color: color, shape: .dot)]
        }
        layer?.addSublayer(e)
        emitter = e

        // Stop emitting shortly after the burst; remove the layer once everything has faded.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.9) { [weak e] in e?.birthRate = 0 }
        DispatchQueue.main.asyncAfter(deadline: .now() + 3.5) { [weak self, weak e] in
            e?.removeFromSuperlayer()
            if self?.emitter === e { self?.emitter = nil }
        }
    }

    private enum Shape { case rect, dot }

    private static func cell(color: NSColor, shape: Shape) -> CAEmitterCell {
        let c = CAEmitterCell()
        c.contents = particleImage(color: color, shape: shape)
        c.birthRate = 14
        c.lifetime = 2.6
        c.lifetimeRange = 0.6
        c.velocity = 240
        c.velocityRange = 110
        c.emissionRange = .pi * 2
        c.yAcceleration = -320 // flipped-y AppKit layer: negative pulls particles downward
        c.spin = 3.2
        c.spinRange = 4
        c.scale = 0.5
        c.scaleRange = 0.25
        c.alphaSpeed = -0.42
        return c
    }

    private static func particleImage(color: NSColor, shape: Shape) -> CGImage? {
        let size = CGSize(width: 12, height: shape == .rect ? 8 : 12)
        guard let ctx = CGContext(
            data: nil, width: Int(size.width), height: Int(size.height),
            bitsPerComponent: 8, bytesPerRow: 0,
            space: CGColorSpace(name: CGColorSpace.sRGB)!,
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        ctx.setFillColor(color.cgColor)
        switch shape {
        case .rect:
            ctx.fill(CGRect(origin: .zero, size: size))
        case .dot:
            ctx.fillEllipse(in: CGRect(origin: .zero, size: size))
        }
        return ctx.makeImage()
    }
}

// MARK: - Step dots

/// The onboarding progress indicator: small dots, the current one stretched into a lozenge.
final class StepDotsView: NSView {
    var count: Int = 5 { didSet { needsDisplay = true } }
    var current: Int = 0 { didSet { needsDisplay = true } }

    override func hitTest(_ point: NSPoint) -> NSView? { nil }

    override var intrinsicContentSize: NSSize {
        NSSize(width: CGFloat(count - 1) * 16 + 22, height: 6)
    }

    override func draw(_ dirtyRect: NSRect) {
        var x: CGFloat = 0
        for i in 0..<count {
            let isCurrent = i == current
            let w: CGFloat = isCurrent ? 22 : 6
            let r = NSRect(x: x, y: bounds.midY - 3, width: w, height: 6)
            let path = NSBezierPath(roundedRect: r, xRadius: 3, yRadius: 3)
            (isCurrent ? NotchPalette.accentHi : NSColor(white: 1, alpha: 0.22)).setFill()
            path.fill()
            x += w + 10
        }
    }
}
