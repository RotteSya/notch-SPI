import AppKit

/// Uses NSButton's keyboard, accessibility and target/action behavior with a quiet,
/// consistent surface. No bitmap assets or continuous animation are needed.
class SettingsInteractiveButton: NSButton {
    override func viewDidMoveToWindow() { super.viewDidMoveToWindow(); focusRingType = .none }
    private(set) var hovered = false { didSet { needsDisplay = true } }
    private var tracking: NSTrackingArea?
    override func viewDidChangeEffectiveAppearance() { super.viewDidChangeEffectiveAppearance(); needsDisplay = true }
    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let tracking { removeTrackingArea(tracking) }
        let area = NSTrackingArea(rect: bounds, options: [.mouseEnteredAndExited, .activeInKeyWindow, .inVisibleRect], owner: self)
        tracking = area; addTrackingArea(area)
    }
    override func mouseEntered(with event: NSEvent) { hovered = true }
    override func mouseExited(with event: NSEvent) { hovered = false }
    override var acceptsFirstResponder: Bool { isEnabled }
    override var canBecomeKeyView: Bool { isEnabled && !isHiddenOrHasHiddenAncestor }
    override func becomeFirstResponder() -> Bool {
        let accepted = super.becomeFirstResponder()
        needsDisplay = true
        if accepted { scrollToVisible(bounds.insetBy(dx: 0, dy: -12)) }
        return accepted
    }
    override func resignFirstResponder() -> Bool { needsDisplay = true; return super.resignFirstResponder() }
    override func accessibilityPerformPress() -> Bool {
        guard isEnabled else { return false }
        window?.makeFirstResponder(self); performClick(nil); return true
    }
    override func keyDown(with event: NSEvent) {
        guard isEnabled else { return }
        if [UInt16(36), 49, 76].contains(event.keyCode) { performClick(nil) }
        else { super.keyDown(with: event) }
    }
}

final class SettingsActionButton: SettingsInteractiveButton {
    var prominent = false { didSet { needsDisplay = true } }
    override func draw(_ dirtyRect: NSRect) {
        let rect = bounds.insetBy(dx: 1, dy: 1)
        let shape = NSBezierPath(roundedRect: rect, xRadius: 5, yRadius: 5)
        let opacity: CGFloat = isEnabled ? 1 : 0.42
        let fill = prominent ? NSColor.labelColor : NSColor.labelColor.withAlphaComponent(isHighlighted ? 0.13 : hovered ? 0.08 : 0.045)
        fill.withAlphaComponent(prominent ? opacity * (isHighlighted ? 0.72 : hovered ? 0.88 : 1) : (isEnabled ? fill.alphaComponent : 0.025)).setFill()
        shape.fill()
        if !prominent {
            NSColor.labelColor.withAlphaComponent(NSWorkspace.shared.accessibilityDisplayShouldIncreaseContrast ? 0.5 : 0.10).setStroke()
            shape.lineWidth = 1 / (window?.backingScaleFactor ?? 2); shape.stroke()
        }
        let color = prominent ? NSColor.windowBackgroundColor : NSColor.labelColor
        let style = NSMutableParagraphStyle(); style.alignment = .center; style.lineBreakMode = .byTruncatingTail
        let attributes: [NSAttributedString.Key: Any] = [.font: font ?? NSFont.systemFont(ofSize: 12, weight: .medium), .foregroundColor: color.withAlphaComponent(opacity), .paragraphStyle: style]
        let height = (title as NSString).size(withAttributes: attributes).height
        (title as NSString).draw(in: NSRect(x: 10, y: (bounds.height - height) / 2, width: bounds.width - 20, height: height), withAttributes: attributes)
        if window?.firstResponder === self && window?.isKeyWindow == true {
            NSColor.keyboardFocusIndicatorColor.setStroke(); shape.lineWidth = 2; shape.stroke()
        }
    }
}

/// Disjoint ledger balances, aligned on common baselines and accessible as text.
final class SettingsBalanceStrip: NSView {
    override var isFlipped: Bool { true }
    private var values: [NSTextField] = []
    override init(frame: NSRect) {
        super.init(frame: frame)
        let titles = [L10n.t("免费额度", "無料枠", "Free"), L10n.t("Plus 今日", "Plus 本日", "Plus today"), L10n.t("长期题包", "購入パック", "Purchased"), L10n.t("其他余额", "その他", "Other")]
        for (index, title) in titles.enumerated() {
            let x = CGFloat(index) * 129
            let value = NSTextField(labelWithString: "—")
            value.font = .monospacedDigitSystemFont(ofSize: 25, weight: .medium)
            value.frame = NSRect(x: x, y: 0, width: 119, height: 32)
            let label = captionLabel(title, size: 11)
            label.frame = NSRect(x: x, y: 36, width: 119, height: 18)
            addSubview(value); addSubview(label); values.append(value)
        }
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    func update(_ sources: [String: Int]?) {
        for (index, key) in ["trial", "plus", "purchased", "other"].enumerated() {
            values[index].stringValue = sources.map { String($0[key, default: 0]) } ?? "—"
        }
    }
}

/// Numbered editorial sections share one baseline and a rule, rather than nested cards.
final class SettingsSectionRule: NSView {
    override var isFlipped: Bool { true }
    init(number: String, title: String, frame: NSRect) {
        super.init(frame: frame)
        let titleLabel = NSTextField(labelWithString: title)
        titleLabel.font = .systemFont(ofSize: 12, weight: .semibold)
        titleLabel.textColor = .secondaryLabelColor
        titleLabel.frame = NSRect(x: 0, y: 2, width: frame.width, height: 20)
        addSubview(titleLabel)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

}

final class SettingsEffortButton: SettingsInteractiveButton {
    var detail = ""
    override func keyDown(with event: NSEvent) {
        guard isEnabled else { return }
        if [UInt16(36), 49, 76].contains(event.keyCode) { performClick(nil); return }
        if event.keyCode == 123 || event.keyCode == 124 {
            let next = tag + (event.keyCode == 124 ? 1 : -1)
            if let button = superview?.subviews.compactMap({ $0 as? SettingsEffortButton }).first(where: { $0.tag == next }) {
                window?.makeFirstResponder(button); button.performClick(nil)
            }
            return
        }
        super.keyDown(with: event)
    }
    override func becomeFirstResponder() -> Bool {
        let accepted = super.becomeFirstResponder()
        needsDisplay = true
        if accepted { scrollToVisible(bounds.insetBy(dx: 0, dy: -12)) }
        return accepted
    }
    override func resignFirstResponder() -> Bool { needsDisplay = true; return super.resignFirstResponder() }
    override var isFlipped: Bool { true }
    override func accessibilityRole() -> NSAccessibility.Role? { .radioButton }
    override func accessibilityValue() -> Any? { state == .on ? 1 : 0 }
    override func draw(_ dirtyRect: NSRect) {
        let selected = state == .on
        let shape = NSBezierPath(roundedRect: bounds.insetBy(dx: 1, dy: 1), xRadius: 5, yRadius: 5)
        (selected ? NSColor.textBackgroundColor : NSColor.labelColor.withAlphaComponent(isHighlighted ? 0.12 : hovered && isEnabled ? 0.065 : 0.025)).setFill(); shape.fill()
        if selected && isEnabled && (hovered || isHighlighted) { NSColor.labelColor.withAlphaComponent(isHighlighted ? 0.09 : 0.04).setFill(); shape.fill() }
        (selected ? NSColor.labelColor : NSWorkspace.shared.accessibilityDisplayShouldIncreaseContrast ? NSColor.labelColor.withAlphaComponent(0.5) : NSColor.separatorColor).setStroke()
        shape.lineWidth = selected ? 1.2 : 0.5; shape.stroke()
        (title as NSString).draw(at: NSPoint(x: 14, y: bounds.height < 60 ? 7 : 12), withAttributes: [.font: NSFont.systemFont(ofSize: 13, weight: .semibold), .foregroundColor: NSColor.labelColor])
        (detail as NSString).draw(at: NSPoint(x: 14, y: bounds.height < 60 ? 29 : 39), withAttributes: [.font: NSFont.systemFont(ofSize: 11), .foregroundColor: NSColor.secondaryLabelColor])
        if selected {
            NSColor.labelColor.setFill()
            NSBezierPath(ovalIn: NSRect(x: bounds.width - 21, y: 17, width: 5, height: 5)).fill()
        }
        if window?.firstResponder === self && window?.isKeyWindow == true {
            NSColor.keyboardFocusIndicatorColor.setStroke(); shape.lineWidth = 2; shape.stroke()
        }
    }
}

/// Keep AppKit's menu selection, type-to-select and accessibility behavior; only the closed surface is custom.
final class SettingsPopupButton: NSPopUpButton {
    private var hovered = false { didSet { needsDisplay = true } }
    private var tracking: NSTrackingArea?
    override func viewDidMoveToWindow() { super.viewDidMoveToWindow(); focusRingType = .none }
    override func viewDidChangeEffectiveAppearance() { super.viewDidChangeEffectiveAppearance(); needsDisplay = true }
    override var acceptsFirstResponder: Bool { isEnabled }
    override var canBecomeKeyView: Bool { isEnabled && !isHiddenOrHasHiddenAncestor }
    override func becomeFirstResponder() -> Bool {
        let accepted = super.becomeFirstResponder()
        needsDisplay = true
        if accepted { scrollToVisible(bounds.insetBy(dx: 0, dy: -12)) }
        return accepted
    }
    override func resignFirstResponder() -> Bool { needsDisplay = true; return super.resignFirstResponder() }
    override func accessibilityPerformPress() -> Bool {
        guard isEnabled else { return false }
        window?.makeFirstResponder(self)
        return super.accessibilityPerformPress()
    }
    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let tracking { removeTrackingArea(tracking) }
        let area = NSTrackingArea(rect: bounds, options: [.mouseEnteredAndExited, .activeInKeyWindow, .inVisibleRect], owner: self)
        tracking = area; addTrackingArea(area)
    }
    override func mouseEntered(with event: NSEvent) { hovered = true }
    override func mouseExited(with event: NSEvent) { hovered = false }
    override func draw(_ dirtyRect: NSRect) {
        let shape = NSBezierPath(roundedRect: bounds.insetBy(dx: 1, dy: 1), xRadius: 5, yRadius: 5)
        NSColor.labelColor.withAlphaComponent(isHighlighted ? 0.12 : hovered && isEnabled ? 0.065 : 0.025).setFill(); shape.fill()
        NSColor.labelColor.withAlphaComponent(NSWorkspace.shared.accessibilityDisplayShouldIncreaseContrast ? 0.5 : 0.16).setStroke()
        shape.lineWidth = 1 / (window?.backingScaleFactor ?? 2); shape.stroke()
        let style = NSMutableParagraphStyle(); style.lineBreakMode = .byTruncatingTail
        let color = NSColor.labelColor.withAlphaComponent(isEnabled ? 1 : 0.4)
        let attrs: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: 12, weight: .medium), .foregroundColor: color, .paragraphStyle: style]
        let text = (titleOfSelectedItem ?? "—") as NSString
        let height = text.size(withAttributes: attrs).height
        text.draw(in: NSRect(x: 12, y: (bounds.height - height) / 2, width: bounds.width - 42, height: height), withAttributes: attrs)
        let chevron = NSBezierPath(); let x = bounds.width - 18, y = bounds.midY
        chevron.move(to: NSPoint(x: x - 3, y: y - 1.5)); chevron.line(to: NSPoint(x: x, y: y + 1.5)); chevron.line(to: NSPoint(x: x + 3, y: y - 1.5))
        color.setStroke(); chevron.lineWidth = 1.3; chevron.lineCapStyle = .round; chevron.lineJoinStyle = .round; chevron.stroke()
        if window?.firstResponder === self && window?.isKeyWindow == true {
            NSColor.keyboardFocusIndicatorColor.setStroke(); shape.lineWidth = 2; shape.stroke()
        }
    }
}

/// Whole-row switch, with an explicit tick as well as position/color for the on state.
final class SettingsToggleButton: SettingsInteractiveButton {
    override func accessibilityRole() -> NSAccessibility.Role? { .checkBox }
    override func accessibilityValue() -> Any? { state == .on ? 1 : 0 }
    override var isFlipped: Bool { true }
    override init(frame: NSRect) { super.init(frame: frame); setButtonType(.switch) }
    required init?(coder: NSCoder) { super.init(coder: coder); setButtonType(.switch) }
    override func draw(_ dirtyRect: NSRect) {
        let row = NSBezierPath(roundedRect: bounds.insetBy(dx: 1, dy: 1), xRadius: 5, yRadius: 5)
        if isEnabled && (hovered || isHighlighted) { NSColor.labelColor.withAlphaComponent(isHighlighted ? 0.09 : 0.04).setFill(); row.fill() }
        let alpha: CGFloat = isEnabled ? 1 : 0.4
        let style = NSMutableParagraphStyle(); style.lineBreakMode = .byTruncatingTail
        let attrs: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: 13, weight: .medium), .foregroundColor: NSColor.labelColor.withAlphaComponent(alpha), .paragraphStyle: style]
        let height = (title as NSString).size(withAttributes: attrs).height
        (title as NSString).draw(in: NSRect(x: 4, y: (bounds.height - height) / 2, width: bounds.width - 50, height: height), withAttributes: attrs)
        let track = NSRect(x: bounds.width - 38, y: bounds.midY - 8, width: 34, height: 16)
        let on = state == .on
        let shape = NSBezierPath(roundedRect: track, xRadius: 8, yRadius: 8)
        (on ? NSColor.labelColor.withAlphaComponent(alpha) : NSColor.labelColor.withAlphaComponent(0.14 * alpha)).setFill(); shape.fill()
        NSColor.labelColor.withAlphaComponent(0.2 * alpha).setStroke(); shape.lineWidth = 0.5; shape.stroke()
        let knob = NSRect(x: on ? track.maxX - 14 : track.minX + 2, y: track.minY + 2, width: 12, height: 12)
        NSColor.windowBackgroundColor.setFill(); NSBezierPath(ovalIn: knob).fill()
        if on {
            let tick = NSBezierPath(); tick.move(to: NSPoint(x: track.minX + 6, y: track.midY)); tick.line(to: NSPoint(x: track.minX + 8, y: track.midY + 2)); tick.line(to: NSPoint(x: track.minX + 12, y: track.midY - 2))
            NSColor.windowBackgroundColor.setStroke(); tick.lineWidth = 1.2; tick.lineCapStyle = .round; tick.stroke()
        }
        if window?.firstResponder === self && window?.isKeyWindow == true {
            NSColor.keyboardFocusIndicatorColor.setStroke(); row.lineWidth = 2; row.stroke()
        }
    }
}

/// Native slider tracking and keyboard increments, with the same restrained control surface.
final class SettingsSlider: NSSlider {
    private(set) var hovered = false { didSet { needsDisplay = true } }
    private var tracking: NSTrackingArea?
    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let tracking { removeTrackingArea(tracking) }
        let area = NSTrackingArea(rect: bounds, options: [.mouseEnteredAndExited, .activeInKeyWindow, .inVisibleRect], owner: self)
        tracking = area; addTrackingArea(area)
    }
    override func mouseEntered(with event: NSEvent) { hovered = true }
    override func mouseExited(with event: NSEvent) { hovered = false }

    override init(frame: NSRect) { super.init(frame: frame); cell = SettingsSliderCell(); focusRingType = .none }
    required init?(coder: NSCoder) { super.init(coder: coder); cell = SettingsSliderCell(); focusRingType = .none }
    override func becomeFirstResponder() -> Bool {
        let accepted = super.becomeFirstResponder()
        needsDisplay = true
        if accepted { scrollToVisible(bounds.insetBy(dx: 0, dy: -12)) }
        return accepted
    }
    override func resignFirstResponder() -> Bool { needsDisplay = true; return super.resignFirstResponder() }
    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        if window?.firstResponder === self && window?.isKeyWindow == true {
            NSColor.keyboardFocusIndicatorColor.setStroke()
            let ring = NSBezierPath(roundedRect: bounds.insetBy(dx: 1, dy: 1), xRadius: 5, yRadius: 5)
            ring.lineWidth = 2; ring.stroke()
        }
    }
}
private final class SettingsSliderCell: NSSliderCell {
    override func drawBar(inside rect: NSRect, flipped: Bool) {
        let track = NSRect(x: rect.minX, y: rect.midY - 2, width: rect.width, height: 4)
        NSColor.labelColor.withAlphaComponent(isEnabled ? 0.13 : 0.06).setFill()
        NSBezierPath(roundedRect: track, xRadius: 2, yRadius: 2).fill()
        let fraction = CGFloat((doubleValue - minValue) / max(1, maxValue - minValue))
        NSColor.labelColor.withAlphaComponent(isEnabled ? 0.72 : 0.18).setFill()
        NSBezierPath(roundedRect: NSRect(x: track.minX, y: track.minY, width: max(4, track.width * fraction), height: 4), xRadius: 2, yRadius: 2).fill()
    }
    override func drawKnob(_ knobRect: NSRect) {
        let shape = NSBezierPath(ovalIn: NSRect(x: knobRect.midX - 7, y: knobRect.midY - 7, width: 14, height: 14))
        let engaged = isEnabled && ((controlView as? SettingsSlider)?.hovered == true || isHighlighted)
        (engaged ? NSColor.labelColor : NSColor.windowBackgroundColor).setFill(); shape.fill()
        NSColor.labelColor.withAlphaComponent(isEnabled ? 0.85 : 0.22).setStroke(); shape.lineWidth = 1.5; shape.stroke()
    }
    override func drawTickMarks() {}
}

final class SettingsEditorSurface: NSView {
    override func draw(_ dirtyRect: NSRect) {
        let path = NSBezierPath(roundedRect: bounds.insetBy(dx: 0.5, dy: 0.5), xRadius: 5, yRadius: 5)
        NSColor.labelColor.withAlphaComponent(0.025).setFill(); path.fill()
        NSColor.separatorColor.setStroke(); path.lineWidth = 0.5; path.stroke()
    }
}

private func drawSettingsInput(_ frame: NSRect, in view: NSView) {
    let path = NSBezierPath(roundedRect: frame.insetBy(dx: 1, dy: 1), xRadius: 5, yRadius: 5)
    NSColor.labelColor.withAlphaComponent(0.025).setFill(); path.fill()
    let editing = (view as? NSTextField)?.currentEditor() != nil
    (editing ? NSColor.keyboardFocusIndicatorColor : NSColor.separatorColor).setStroke()
    path.lineWidth = editing ? 2 : 0.5; path.stroke()
}
private final class SettingsInputCell: NSTextFieldCell {
    override func draw(withFrame frame: NSRect, in controlView: NSView) {
        drawSettingsInput(frame, in: controlView)
        drawInterior(withFrame: frame, in: controlView)
    }
}
private final class SettingsSecureInputCell: NSSecureTextFieldCell {
    override func draw(withFrame frame: NSRect, in controlView: NSView) {
        drawSettingsInput(frame, in: controlView)
        drawInterior(withFrame: frame, in: controlView)
    }
}
final class SettingsTextField: NSTextField {
    override init(frame: NSRect) { super.init(frame: frame); cell = SettingsInputCell(textCell: ""); isBezeled = true; isEditable = true; isSelectable = true; focusRingType = .none }
    required init?(coder: NSCoder) { super.init(coder: coder) }
}
final class SettingsSecureTextField: NSSecureTextField {
    override init(frame: NSRect) { super.init(frame: frame); cell = SettingsSecureInputCell(textCell: ""); isBezeled = true; isEditable = true; isSelectable = true; focusRingType = .none }
    required init?(coder: NSCoder) { super.init(coder: coder) }
}
