import AppKit
import Combine

/// The notch's content, in pure AppKit. A flipped `NSView` hosting the obsidian surface, a
/// collapsed menu-bar bar (just the Rose indicator beside the cutout), and an expanded card
/// (header + scrollable answer), crossfading between the two as the controller drives
/// `model.expanded`. The slab radii + content opacity tween on a display clock matched to the
/// controller's panel-frame animation, so frame and contents arrive as one body.
final class NotchView: NSView {
    private let model: TutorModel
    private let onHover: (Bool) -> Void
    private let onCycleDepth: () -> Void
    private let onEditPersona: () -> Void
    private let onSettings: () -> Void

    // Surface (fills the whole panel incl. the transparent shadow margin).
    private let surface = NotchSurfaceView()

    // Collapsed bar — the Rose sits in the menu-bar space to the left of the notch.
    private let collapsedBar = FlippedContainer()
    private let roseCollapsed = RoseLoaderView()

    // Expanded card.
    private let expandedContent = FlippedContainer()
    private let roseHeader = RoseLoaderView()
    private let modeLabel = NotchView.makeLabel(size: 12.5, weight: .semibold, color: NotchPalette.primary)
    private let statusText = NotchView.makeLabel(size: 11, weight: .regular, color: NotchPalette.secondary)
    private let capsule = NotchCapsuleButton()
    private lazy var gearButton = NotchControlButton(
        systemName: "gearshape", tint: NotchPalette.secondary, label: L10n.settingsTitle,
        action: { [weak self] in self?.onSettings() })
    private let answerScroll = NSScrollView()
    private let answerText = NSTextView()

    private lazy var morph = DisplayTween(host: self, value: 0)
    private var wasExpanded = false
    private var hovering = false
    private var trackingAreaRef: NSTrackingArea?
    private var cancellables = Set<AnyCancellable>()

    private var reduceMotion: Bool { NSWorkspace.shared.accessibilityDisplayShouldReduceMotion }

    init(model: TutorModel,
         onHover: @escaping (Bool) -> Void,
         onCycleDepth: @escaping () -> Void,
         onEditPersona: @escaping () -> Void,
         onSettings: @escaping () -> Void) {
        self.model = model
        self.onHover = onHover
        self.onCycleDepth = onCycleDepth
        self.onEditPersona = onEditPersona
        self.onSettings = onSettings
        super.init(frame: .zero)
        build()
        observe()
        refresh()
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override var isFlipped: Bool { true }

    // MARK: Build

    private func build() {
        addSubview(surface)

        collapsedBar.addSubview(roseCollapsed)
        addSubview(collapsedBar)

        configureAnswerArea()
        [roseHeader, modeLabel, statusText, capsule, gearButton, answerScroll].forEach { expandedContent.addSubview($0) }
        addSubview(expandedContent)
        expandedContent.alphaValue = 0

        // The capsule dispatches by the active mode: cycle depth (tutor) / edit persona (personality).
        capsule.onClick = { [weak self] in
            guard let self else { return }
            if self.model.mode == "personality" { self.onEditPersona() } else { self.onCycleDepth() }
        }

        morph.onChange = { [weak self] _ in self?.applyLayout() }
    }

    private func configureAnswerArea() {
        answerScroll.drawsBackground = false
        answerScroll.hasVerticalScroller = true
        answerScroll.autohidesScrollers = true
        answerScroll.scrollerStyle = .overlay
        answerScroll.borderType = .noBorder
        answerScroll.horizontalScrollElasticity = .none

        answerText.isEditable = false
        answerText.isSelectable = true
        answerText.drawsBackground = false
        answerText.backgroundColor = .clear
        answerText.textContainerInset = NSSize(width: 0, height: 0)
        answerText.textContainer?.lineFragmentPadding = 0
        answerText.isVerticallyResizable = true
        answerText.isHorizontallyResizable = false
        answerText.textContainer?.widthTracksTextView = true
        answerText.minSize = .zero
        answerText.maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
        answerText.autoresizingMask = [.width]
        answerScroll.documentView = answerText
    }

    private func observe() {
        // Any model change → refresh content + re-evaluate the morph after @Published commits.
        model.objectWillChange
            .sink { [weak self] in DispatchQueue.main.async { self?.refresh() } }
            .store(in: &cancellables)
    }

    // MARK: Refresh (content from model)

    private func refresh() {
        let tint = roseTint()
        roseCollapsed.color = tint
        roseHeader.color = tint

        modeLabel.stringValue = model.modeLabel
        statusText.stringValue = model.statusText

        let isPersona = model.mode == "personality"
        capsule.title = isPersona
            ? (model.personaLabel.isEmpty ? L10n.t("设置人物像", "人物像を設定", "Set persona") : model.personaLabel)
                                   : model.depthLabel

        answerText.textStorage?.setAttributedString(NotchType.answerString(model.answer, mode: model.mode))

        // Drive the morph from the model's expand state.
        if model.expanded != wasExpanded {
            wasExpanded = model.expanded
            if reduceMotion { morph.set(model.expanded ? 1 : 0) }
            else { morph.animate(to: model.expanded ? 1 : 0, duration: NotchPalette.morphDuration) }
        }
        applyLayout()
    }

    /// Rose tint by state — white at rest (no "camera-in-use" green dot), accent while working,
    /// red on error. Mirrors the original SwiftUI `roseColor`.
    private func roseTint() -> NSColor {
        switch model.status {
        case .running, .streaming: return NotchPalette.accent
        case .error: return NotchPalette.error
        default: return .white
        }
    }

    // MARK: Layout (morph-driven)

    override func layout() {
        super.layout()
        applyLayout()
    }

    private func applyLayout() {
        let b = bounds
        guard b.width > 1 else { return }
        let p = max(0, min(1, morph.value))

        // Card inset: the transparent shadow margin grows in only as we expand (top stays flush).
        let mH = NotchMetrics.shadowMarginH * p
        let mB = NotchMetrics.shadowMarginBottom * p
        let card = CGRect(x: mH, y: 0, width: b.width - mH * 2, height: b.height - mB)

        surface.frame = b
        surface.cardRect = card
        surface.topRadius = notchLerp(6, 8, p)
        surface.bottomRadius = notchLerp(14, 22, p)
        surface.depth = p
        surface.showShadow = p > 0.001

        collapsedBar.frame = card
        expandedContent.frame = card
        collapsedBar.alphaValue = 1 - p
        expandedContent.alphaValue = p
        collapsedBar.isHidden = p >= 0.999
        expandedContent.isHidden = p <= 0.001

        if !collapsedBar.isHidden { layoutCollapsed(card.size) }
        if !expandedContent.isHidden { layoutExpanded(card.size) }
    }

    private func layoutCollapsed(_ size: CGSize) {
        let cy = size.height / 2
        roseCollapsed.frame = CGRect(x: 14, y: cy - 10, width: 20, height: 20)
    }

    private func layoutExpanded(_ size: CGSize) {
        let inset = NotchLayout.contentInsetH
        let cy = NotchLayout.headerRowCenterY

        roseHeader.frame = CGRect(x: inset, y: cy - 8, width: 16, height: 16)

        let gearX = size.width - inset - 28
        gearButton.frame = CGRect(x: gearX, y: cy - 12, width: 28, height: 24)

        let cap = capsule.intrinsicContentSize
        let capX = gearX - 8 - cap.width
        capsule.frame = CGRect(x: capX, y: cy - cap.height / 2, width: cap.width, height: cap.height)

        var x = inset + 16 + 8
        // Size the label by asking its cell (NSString measurement misses the cell's own
        // horizontal padding, which clipped "学习辅导" to "学习…" in the header).
        let modeW = ceil(modeLabel.sizeThatFits(
            NSSize(width: 300, height: 24)).width) + 4
        let modeH = modeLabel.intrinsicContentSize.height
        modeLabel.frame = CGRect(x: x, y: cy - modeH / 2, width: modeW, height: modeH)
        x += modeW + 6
        let statusW = max(0, capX - 8 - x)
        let statusH = statusText.intrinsicContentSize.height
        statusText.frame = CGRect(x: x, y: cy - statusH / 2, width: statusW, height: statusH)

        // Answer fills below the header; the panel height is sized by the controller, so a long
        // answer scrolls within this fixed region and a short one hugs it.
        let top = NotchLayout.headerHeight
        let h = max(0, size.height - top - NotchLayout.answerBottomPad)
        answerScroll.frame = CGRect(x: inset, y: top, width: max(0, size.width - inset * 2), height: h)
    }

    // MARK: Hover

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let t = trackingAreaRef { removeTrackingArea(t) }
        let t = NSTrackingArea(rect: bounds, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect],
                               owner: self, userInfo: nil)
        addTrackingArea(t)
        trackingAreaRef = t
    }

    override func mouseEntered(with event: NSEvent) { setHovering(true) }
    override func mouseExited(with event: NSEvent) { setHovering(false) }

    private func setHovering(_ on: Bool) {
        guard hovering != on else { return }
        hovering = on
        onHover(on)
    }

    // MARK: Factories

    private static func makeLabel(size: CGFloat, weight: NSFont.Weight, color: NSColor) -> NSTextField {
        let f = NSTextField(labelWithString: "")
        f.font = .systemFont(ofSize: size, weight: weight)
        f.textColor = color
        f.backgroundColor = .clear
        f.drawsBackground = false
        f.isBordered = false
        f.isEditable = false
        f.lineBreakMode = .byTruncatingTail
        f.cell?.truncatesLastVisibleLine = true
        return f
    }
}

// MARK: - Containers

/// A top-left-origin container so child frames laid out with `y` growing downward match the
/// flipped `NotchView` (a plain NSView is bottom-left, which would invert the stacked rows).
private final class FlippedContainer: NSView {
    override var isFlipped: Bool { true }
}

// MARK: - Capsule button

/// The header pill — shows the depth (tutor mode) or the persona name (personality mode) and acts
/// on click. A soft white capsule that brightens on hover; first-mouse so it works inside the
/// non-activating panel.
private final class NotchCapsuleButton: NSControl {
    var onClick: (() -> Void)?
    var title: String = "" {
        didSet {
            attr = NSAttributedString(string: title, attributes: [
                .font: NSFont.systemFont(ofSize: 11),
                .foregroundColor: NotchPalette.secondary,
            ])
            invalidateIntrinsicContentSize()
            needsDisplay = true
        }
    }

    private var attr = NSAttributedString()
    private let hPad: CGFloat = 8, vPad: CGFloat = 3
    private var hovering = false { didSet { if hovering != oldValue { needsDisplay = true } } }
    private var trackingAreaRef: NSTrackingArea?

    override var isFlipped: Bool { true }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    override var intrinsicContentSize: NSSize {
        let s = attr.size()
        return NSSize(width: ceil(s.width) + hPad * 2, height: ceil(s.height) + vPad * 2)
    }

    override func draw(_ dirtyRect: NSRect) {
        let r = bounds
        let radius = r.height / 2
        let cap = NSBezierPath(roundedRect: r, xRadius: radius, yRadius: radius)
        NSColor(white: 1, alpha: hovering ? 0.16 : 0.10).setFill()
        cap.fill()
        let s = attr.size()
        attr.draw(in: CGRect(x: (r.width - s.width) / 2, y: (r.height - s.height) / 2,
                             width: s.width, height: s.height))
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
        let p = convert(event.locationInWindow, from: nil)
        if bounds.contains(p) { onClick?() }
    }
}
