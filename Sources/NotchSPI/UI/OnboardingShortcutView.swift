import AppKit

/// Keyboard instructions, never an action target. Long key names get their own measured width.
final class OnboardingShortcutView: NSView {
    var combo = Settings.shared.captureCombo {
        didSet { needsDisplay = true; invalidateIntrinsicContentSize(); updateAccessibility() }
    }
    var displayString: String { Settings.displayString(combo) }
    private let font = NSFont.systemFont(ofSize: 16, weight: .medium)
    private lazy var arrival = DisplayTween(host: self, value: 1)
    func present(animated: Bool) {
        arrival.onChange = { [weak self] _ in self?.needsDisplay = true }
        guard animated, !onboardingReduceMotion(), window?.isVisible == true else { arrival.set(1); return }
        // Do not restart a cue still in flight when capture state updates arrive together.
        guard !arrival.isAnimating else { return }
        arrival.ease = { $0 }
        arrival.set(0)
        arrival.animate(to: 1, duration: onboardingMotionDuration(0.62))
    }
    override func viewDidHide() { super.viewDidHide(); arrival.set(1) }
    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        if window == nil { arrival.set(1) }
    }
    private var caps: [String] { KeycapChipView.caps(from: combo) }
    private func width(_ key: String) -> CGFloat {
        max(30, ceil((key as NSString).size(withAttributes: [.font: font]).width) + 18)
    }
    override var intrinsicContentSize: NSSize {
        NSSize(width: caps.reduce(0) { $0 + width($1) } + CGFloat(max(0, caps.count - 1)) * 6, height: 38)
    }
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
    override func isAccessibilityElement() -> Bool { true }
    override func accessibilityRole() -> NSAccessibility.Role? { .staticText }
    private func updateAccessibility() {
        setAccessibilityLabel(L10n.t("按 \(displayString) 截图", "\(displayString) で撮影", "Press \(displayString) to capture"))
    }
    override func draw(_ dirtyRect: NSRect) {
        var x: CGFloat = 0
        for (index, key) in caps.enumerated() {
            let t = onboardingReduceMotion() ? 1 : min(1, max(0, (arrival.value - CGFloat(index) * 0.09) / 0.58))
            let touch = pow(sin(.pi * t), 2)
            let rect = NSRect(x: x + 0.5, y: 3.5 - touch * 1.5, width: width(key) - 1, height: 30)
            let path = NSBezierPath(roundedRect: rect, xRadius: 6, yRadius: 6)
            NSColor(white: 1, alpha: 0.055 + 0.035 * touch).setFill(); path.fill()
            NSColor(white: 1, alpha: 0.22 + 0.14 * touch).setStroke(); path.lineWidth = 0.5; path.stroke()
            let seat = NSBezierPath()
            seat.move(to: .init(x: rect.minX + 6, y: rect.minY + 2))
            seat.line(to: .init(x: rect.maxX - 6, y: rect.minY + 2))
            NSColor(white: 1, alpha: 0.08 * (1 - touch)).setStroke(); seat.lineWidth = 0.5; seat.stroke()
            let attributes: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: NSColor(white: 1, alpha: 0.92)]
            let size = (key as NSString).size(withAttributes: attributes)
            (key as NSString).draw(at: NSPoint(x: rect.midX - size.width / 2, y: rect.midY - size.height / 2), withAttributes: attributes)
            x += width(key) + 6
        }
    }
}
