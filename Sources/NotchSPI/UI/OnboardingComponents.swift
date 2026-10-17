import AppKit
import QuartzCore

// Small custom controls shared by the onboarding flow (and reusable elsewhere). All are pure
// AppKit in the codebase's house style: flipped where stacking matters, first-mouse friendly,
// drawn in draw(_:) so there is no layer ordering to fight. Motion rides Core Animation on the
// backing layer (transform springs, implicit morphs) so pixels never tear mid-gesture.

/// Reduce-Motion check for onboarding surfaces, with a DEBUG env override so visual QA can
/// verify the reduced experience without touching the user's system settings.
func onboardingReduceMotion() -> Bool {
    #if DEBUG
    if let override = ProcessInfo.processInfo.environment["NSPI_QA_REDUCE_MOTION"] {
        if override == "1" { return true }
        if override == "0" { return false }
    }
    #endif
    return NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
}

/// Slow the real display-linked / layer transitions for visual inspection. No release override.
func onboardingMotionDuration(_ seconds: TimeInterval) -> TimeInterval {
    #if DEBUG
    if ProcessInfo.processInfo.environment["NSPI_QA_EPHEMERAL"] == "1",
       let raw = ProcessInfo.processInfo.environment["NSPI_QA_MOTION_SCALE"],
       let scale = Double(raw), scale.isFinite {
        return seconds * min(8, max(1, scale))
    }
    #endif
    return seconds
}

// MARK: - Primary / secondary capsule button

/// Capsule action used by the notch guide and settings. `.primary` is a flat accent fill that
/// brightens a step on hover; `.secondary` is a hairline glass outline; `.ghost` is bare text;
/// `.confirm` is a quiet green state chip (a settled fact, not a call to action — it doesn't
/// react, so it never fakes an affordance). No halos: elevation comes from color and motion.
final class GlowButton: NSControl {
    enum Style { case primary, secondary, ghost, confirm }

    var title: String { didSet { needsDisplay = true; invalidateIntrinsicContentSize() } }
    var style: Style {
        didSet {
            needsDisplay = true
            invalidateIntrinsicContentSize()
            window?.invalidateCursorRects(for: self)
        }
    }
    var onClick: (() -> Void)?
    var shortcut: String? { didSet { needsDisplay = true; invalidateIntrinsicContentSize() } }
    var ignoresRepeatedClicks = false
    /// Confined to the in-notch guide; existing account and settings actions retain their style.
    var onboardingChrome = false { didSet { needsDisplay = true } }
    var showsForwardArrow = false { didSet { needsDisplay = true; invalidateIntrinsicContentSize() } }

    private var hovering = false {
        didSet { if hovering != oldValue { needsDisplay = true } }
    }
    private var pressed = false {
        didSet { if pressed != oldValue { setDepressed(pressed) } }
    }
    private var trackingAreaRef: NSTrackingArea?

    init(title: String, style: Style = .primary, action: (() -> Void)? = nil) {
        self.title = title
        self.style = style
        self.onClick = action
        super.init(frame: .zero)
        wantsLayer = true
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override var acceptsFirstResponder: Bool { isEnabled && isActionable }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    override func isAccessibilityElement() -> Bool { true }
    override func accessibilityRole() -> NSAccessibility.Role? { style == .confirm ? .staticText : .button }
    override func accessibilityLabel() -> String? { shortcut.map { title + " · " + $0 } ?? title }
    override func isAccessibilityEnabled() -> Bool { isEnabled }
    override func accessibilityPerformPress() -> Bool {
        guard isEnabled, isActionable, !isHiddenOrHasHiddenAncestor else { return false }
        if ignoresRepeatedClicks {
            window?.makeKey()
            window?.makeFirstResponder(self)
            setDepressed(true)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.075) { [weak self] in self?.setDepressed(false) }
        }
        onClick?()
        return true
    }
    override func keyDown(with event: NSEvent) {
        if [UInt16(36), 49, 76].contains(event.keyCode) {
            if !ignoresRepeatedClicks || !event.isARepeat { _ = accessibilityPerformPress() }
        }
        else { super.keyDown(with: event) }
    }
    override func becomeFirstResponder() -> Bool { needsDisplay = true; return super.becomeFirstResponder() }
    override func resignFirstResponder() -> Bool { needsDisplay = true; return super.resignFirstResponder() }

    /// `.confirm` is state, not a control — no pointer, no press, no glow.
    private var isActionable: Bool { style != .confirm && isEnabled }

    private var titleFont: NSFont { font ?? .systemFont(ofSize: 13.5, weight: style == .primary ? .semibold : .medium) }

    private var shortcutFont: NSFont { .systemFont(ofSize: 12, weight: .medium) }
    private var shortcutWidth: CGFloat {
        shortcut.map { ceil(($0 as NSString).size(withAttributes: [.font: shortcutFont]).width) + 30 } ?? (showsForwardArrow ? 25 : 0)
    }
    override var intrinsicContentSize: NSSize {
        let s = (title as NSString).size(withAttributes: [.font: titleFont])
        let hPad: CGFloat = style == .ghost ? 10 : 22
        return NSSize(width: ceil(s.width) + hPad * 2 + shortcutWidth, height: 34)
    }

    override func resetCursorRects() {
        if isActionable { addCursorRect(bounds, cursor: .pointingHand) }
    }

    // MARK: Motion (press spring on the backing layer)

    /// Press spring: squash around the button's own center (matrix-baked so the default AppKit
    /// anchor point can't drift it), release with a lively settle.
    private func setDepressed(_ down: Bool) {
        guard (!down || isActionable), let layer else { return }
        var m = CATransform3DIdentity
        if down {
            let c = CGPoint(x: bounds.midX, y: bounds.midY)
            m = CATransform3DTranslate(m, c.x, c.y, 0)
            let scale: CGFloat = ignoresRepeatedClicks ? 0.982 : 0.955
            m = CATransform3DScale(m, scale, scale, 1)
            m = CATransform3DTranslate(m, -c.x, -c.y, 0)
        }
        if onboardingReduceMotion() {
            layer.removeAnimation(forKey: "press")
            layer.transform = CATransform3DIdentity
            needsDisplay = true
            return
        }
        if ignoresRepeatedClicks {
            let feedback = CABasicAnimation(keyPath: "transform")
            feedback.fromValue = NSValue(caTransform3D: layer.presentation()?.transform ?? layer.transform)
            feedback.toValue = NSValue(caTransform3D: m)
            feedback.duration = down ? 0.075 : 0.16
            feedback.timingFunction = CAMediaTimingFunction(controlPoints: 0.2, 0.75, 0.25, 1)
            layer.transform = m
            layer.add(feedback, forKey: "press")
            return
        }
        let s = CASpringAnimation(keyPath: "transform")
        s.fromValue = NSValue(caTransform3D: layer.presentation()?.transform ?? layer.transform)
        s.toValue = NSValue(caTransform3D: m)
        s.mass = 1
        s.stiffness = down ? 600 : 380
        s.damping = down ? 40 : 22
        s.duration = s.settlingDuration
        layer.transform = m
        layer.add(s, forKey: "press")
    }

    // MARK: Drawing

    override func draw(_ dirtyRect: NSRect) {
        let b = bounds
        let r = b.insetBy(dx: 1, dy: 1)
        let radius = onboardingChrome ? min(11, r.height / 2) : r.height / 2
        let capsule = NSBezierPath(roundedRect: r, xRadius: radius, yRadius: radius)
        let textColor: NSColor

        switch style {
        case .primary:
            // Flat accent fill; hover lifts it one step toward the highlight tint. Color does
            // the work — no gradient body, no glow.
            let fill = hovering
                ? (NotchPalette.accent.blended(withFraction: 0.35, of: NotchPalette.accentHi) ?? NotchPalette.accent)
                : NotchPalette.accent
            (isEnabled ? fill : NSColor(white: 1, alpha: 0.07)).setFill()
            capsule.fill()
            if onboardingChrome && isEnabled {
                NSColor(white: 1, alpha: hovering ? 0.32 : 0.2).setStroke()
                capsule.lineWidth = 0.5; capsule.stroke()
            }
            textColor = isEnabled ? NSColor(srgbRed: 0.04, green: 0.05, blue: 0.10, alpha: 1) : NotchPalette.secondary
        case .secondary:
            NSColor(white: 1, alpha: hovering ? 0.12 : 0.06).setFill()
            capsule.fill()
            capsule.lineWidth = 1
            NSColor(white: 1, alpha: hovering ? 0.35 : 0.22).setStroke()
            capsule.stroke()
            textColor = NSColor(white: 1, alpha: isEnabled ? 0.92 : 0.4)
        case .ghost:
            textColor = NSColor(white: 1, alpha: hovering ? 0.85 : 0.55)
        case .confirm:
            let mint = NSColor(srgbRed: 0.45, green: 0.85, blue: 0.60, alpha: 1)
            mint.withAlphaComponent(0.13).setFill()
            capsule.fill()
            capsule.lineWidth = 1
            mint.withAlphaComponent(0.45).setStroke()
            capsule.stroke()
            textColor = NSColor(srgbRed: 0.72, green: 0.95, blue: 0.80, alpha: 1)
        }

        let attrs: [NSAttributedString.Key: Any] = [.font: titleFont, .foregroundColor: textColor]
        let ts = (title as NSString).size(withAttributes: attrs)
        (title as NSString).draw(
            at: NSPoint(x: b.midX - (ts.width + shortcutWidth) / 2, y: b.midY - ts.height / 2), withAttributes: attrs)
        if let shortcut {
            let start = b.midX + (ts.width - shortcutWidth) / 2 + 15
            let divider = NSBezierPath()
            divider.move(to: NSPoint(x: start, y: b.midY - 8))
            divider.line(to: NSPoint(x: start, y: b.midY + 8))
            textColor.withAlphaComponent(0.22).setStroke(); divider.lineWidth = 1; divider.stroke()
            let keyAttrs: [NSAttributedString.Key: Any] = [.font: shortcutFont, .foregroundColor: textColor.withAlphaComponent(0.8)]
            let keySize = (shortcut as NSString).size(withAttributes: keyAttrs)
            (shortcut as NSString).draw(at: NSPoint(x: start + 15, y: b.midY - keySize.height / 2), withAttributes: keyAttrs)
        } else if showsForwardArrow {
            let x = b.midX + (ts.width - shortcutWidth) / 2 + 15
            let arrow = NSBezierPath()
            arrow.move(to: NSPoint(x: x, y: b.midY)); arrow.line(to: NSPoint(x: x + 9, y: b.midY))
            arrow.move(to: NSPoint(x: x + 5, y: b.midY - 3.5))
            arrow.line(to: NSPoint(x: x + 9, y: b.midY)); arrow.line(to: NSPoint(x: x + 5, y: b.midY + 3.5))
            arrow.lineWidth = 1.25; arrow.lineCapStyle = .round; arrow.lineJoinStyle = .round
            textColor.withAlphaComponent(0.75).setStroke(); arrow.stroke()
        }
        if window?.firstResponder === self {
            NSColor.keyboardFocusIndicatorColor.setStroke()
            capsule.lineWidth = 2
            capsule.stroke()
        }
    }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let t = trackingAreaRef { removeTrackingArea(t) }
        let t = NSTrackingArea(rect: bounds, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect],
                               owner: self, userInfo: nil)
        addTrackingArea(t)
        trackingAreaRef = t
    }

    override func mouseEntered(with event: NSEvent) { if isActionable { hovering = true } }
    override func mouseExited(with event: NSEvent) { hovering = false; pressed = false }
    override func mouseDown(with event: NSEvent) {
        if isActionable {
            if ignoresRepeatedClicks { window?.makeFirstResponder(self) }
            pressed = true
        }
    }
    override func mouseDragged(with event: NSEvent) {
        pressed = isActionable && bounds.contains(convert(event.locationInWindow, from: nil))
    }
    override func mouseUp(with event: NSEvent) {
        let inside = bounds.contains(convert(event.locationInWindow, from: nil))
        pressed = false
        if inside && (!ignoresRepeatedClicks || event.clickCount <= 1) { _ = accessibilityPerformPress() }
    }
}

// MARK: - Keycap chip

/// A hotkey rendered as physical keycaps (one cap per symbol) in the product's own material:
/// indigo glass, top-lit, hairline rim, seated by a tight shadow — the visual language of a
/// real keyboard in this world's palette, so "press this" needs no words.
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
        let radius = capSize * 0.24
        var x: CGFloat = 0
        for key in keys {
            let r = NSRect(x: x, y: 3, width: capSize, height: capSize)
            let path = NSBezierPath(roundedRect: r, xRadius: radius, yRadius: radius)

            // tight drop shadow seating the cap on the glass
            ctx.saveGState()
            ctx.setShadow(offset: CGSize(width: 0, height: -1.5), blur: 3,
                          color: NSColor.black.withAlphaComponent(0.45).cgColor)
            NSColor(srgbRed: 0.10, green: 0.12, blue: 0.22, alpha: 1).setFill()
            path.fill()
            ctx.restoreGState()

            // top-lit indigo-glass face (the world's material, not neutral gray)
            NSGradient(starting: NSColor(srgbRed: 0.21, green: 0.24, blue: 0.40, alpha: 1),
                       ending: NSColor(srgbRed: 0.11, green: 0.13, blue: 0.25, alpha: 1))?
                .draw(in: path, angle: -90)

            // upper-edge highlight: light falls from above
            ctx.saveGState()
            path.addClip()
            let hi = notchGradient([
                (NSColor(white: 1, alpha: 0.20), 0),
                (NSColor(white: 1, alpha: 0.0), 1),
            ])
            ctx.drawLinearGradient(hi, start: CGPoint(x: r.midX, y: r.maxY),
                                   end: CGPoint(x: r.midX, y: r.maxY - capSize * 0.45), options: [])
            ctx.restoreGState()

            path.lineWidth = 1
            NSColor(white: 1, alpha: 0.17).setStroke()
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
