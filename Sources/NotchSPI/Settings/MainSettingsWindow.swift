import AppKit
import ServiceManagement

// The unified settings window (统一设置): a sidebar of five pages replacing what used to be four
// scattered mini-windows plus an overstuffed gear menu. Native styling (system light/dark),
// fixed-frame layout in flipped containers, live-commit controls — the codebase's house style.
//
//   通用 General    — language, reasoning effort, capture target, launch at login
//   快捷键 Hotkeys  — the recordable combos (embedded HotkeySettingsViewController)
//   账户 Account    — subscription, quota, question packs, device identity
//   人物像 Personas — the persona library (embedded PersonaManagerViewController)
//   高级 Advanced   — service channel, custom API keys, updates

// MARK: - Window controller

final class MainSettingsWindowController: NSWindowController, NSWindowDelegate {
    enum Page: Int, CaseIterable {
        case general, hotkeys, account, personas, advanced

        /// Existing payment return links resolve to the single account destination.
        static var plus: Page { .account }

        var symbolName: String {
            switch self {
            case .general: return "gearshape"
            case .hotkeys: return "keyboard"
            case .account: return "creditcard"
            case .personas: return "person.text.rectangle"
            case .advanced: return "wrench.and.screwdriver"
            }
        }

        var localizedTitle: String {
            switch self {
            case .general: return L10n.t("通用", "一般", "General")
            case .hotkeys: return L10n.t("快捷键", "ショートカット", "Hotkeys")
            case .account: return L10n.t("账户与订阅", "アカウントとプラン", "Account & plan")
            case .personas: return L10n.t("人物像", "人物像", "Personas")
            case .advanced: return L10n.t("服务与模型", "サービスとモデル", "Service & models")
            }
        }
    }

    static let contentSize = NSSize(width: 850, height: 620)
    static let sidebarWidth: CGFloat = 210
    static var pageSize: NSSize { NSSize(width: contentSize.width - sidebarWidth, height: contentSize.height) }

    /// Wired by NotchController so hotkey edits re-register and menu labels refresh.
    var onHotkeysChanged: (() -> Void)?
    var onAnythingChanged: (() -> Void)?
    var onStartQuestion: (() -> Void)?

    private let sidebar = SettingsFlippedView()
    private let sidebarSubtitle = captionLabel("", size: 11)
    private let contentHost = SettingsFlippedView()
    private var rowButtons: [SidebarRowButton] = []
    private var pageControllers: [Page: NSViewController] = [:]
    private var current: Page = .general
    private var observers: [NSObjectProtocol] = []
    /// One shared selection surface. Reveal at the destination instead of crossing unrelated rows.
    private let selectionPill = CALayer()
    /// The page view currently on screen (kept during a transition so an interrupted hand-off
    /// can be cleaned up deterministically).
    private weak var displayedPageView: NSView?

    private var reduceMotion: Bool { onboardingReduceMotion() }

    /// Navigation timing. DEBUG-only NSPI_QA_SLOW_NAV=1 stretches it for frame-by-frame QA.
    private static var navTimeScale: CFTimeInterval {
        #if DEBUG
        if ProcessInfo.processInfo.environment["NSPI_QA_SLOW_NAV"] == "1" { return 6 }
        #endif
        return 1
    }

    init() {
        let window = NSWindow(
            contentRect: NSRect(origin: .zero, size: Self.contentSize),
            styleMask: [.titled, .closable, .miniaturizable, .fullSizeContentView],
            backing: .buffered, defer: false)
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.sharingType = ScreenShareGuard.windowSharingType
        window.isReleasedWhenClosed = false
        window.autorecalculatesKeyViewLoop = true
        super.init(window: window)
        window.delegate = self
        buildChrome()
        show(page: .general)

        observers.append(NotificationCenter.default.addObserver(
            forName: L10n.languageDidChange, object: nil, queue: .main
        ) { [weak self] _ in self?.rebuildAfterLanguageChange() })
        // Accent theme switches restyle the live chrome (pill tint, row icons) immediately.
        observers.append(NotificationCenter.default.addObserver(
            forName: Appearance.themeDidChange, object: nil, queue: .main
        ) { [weak self] _ in self?.restyleChrome() })
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    deinit { observers.forEach(NotificationCenter.default.removeObserver) }

    private func buildChrome() {
        guard let window, let root = window.contentView else { return }

        // Sidebar with the standard translucent material.
        let effect = NSVisualEffectView(frame: NSRect(x: 0, y: 0, width: Self.sidebarWidth,
                                                      height: Self.contentSize.height))
        effect.material = .sidebar
        effect.blendingMode = .behindWindow
        effect.state = .active
        effect.autoresizingMask = [.height]
        root.addSubview(effect)

        sidebar.appearanceDidChange = { [weak self] in self?.restyleChrome() }
        sidebar.frame = effect.bounds
        sidebar.autoresizingMask = [.width, .height]
        effect.addSubview(sidebar)

        contentHost.frame = NSRect(x: Self.sidebarWidth, y: 0,
                                   width: Self.pageSize.width, height: Self.pageSize.height)
        contentHost.autoresizingMask = [.width, .height]
        contentHost.wantsLayer = true
        root.addSubview(contentHost)

        let brand = NSTextField(labelWithString: "NotchSPI")
        brand.font = .systemFont(ofSize: 17, weight: .semibold)
        brand.frame = NSRect(x: 26, y: 48, width: 160, height: 26)
        sidebar.addSubview(brand)
        let subtitle = sidebarSubtitle
        subtitle.stringValue = L10n.t("设置", "設定", "Settings")
        subtitle.frame = NSRect(x: 26, y: 77, width: 160, height: 18)
        sidebar.addSubview(subtitle)
        let version = captionLabel("NotchSPI · " + UpdateChecker.currentVersion, size: 11)
        version.frame = NSRect(x: 26, y: Self.contentSize.height - 40, width: 160, height: 18)
        sidebar.addSubview(version)
        buildSidebarRows()
    }

    private func buildSidebarRows() {
        rowButtons.forEach { $0.removeFromSuperview() }
        rowButtons = []
        // The pill lives on the sidebar's own layer, added before any row subview so it stays
        // beneath every row's hover chip and content.
        sidebar.wantsLayer = true
        if selectionPill.superlayer == nil {
            selectionPill.cornerRadius = 8
            sidebar.layer?.addSublayer(selectionPill)
        }
        var y: CGFloat = 120
        for page in Page.allCases {
            let row = SidebarRowButton(page: page) { [weak self] in self?.show(page: $0) }
            row.onNavigate = { [weak self] direction in
                guard let self else { return }
                let index = page.rawValue + direction
                guard let next = Page(rawValue: index),
                      let target = self.rowButtons.first(where: { $0.page == next }) else { return }
                self.window?.makeFirstResponder(target)
                self.show(page: next)
            }
            row.frame = NSRect(x: 14, y: y, width: Self.sidebarWidth - 28, height: 38)
            sidebar.addSubview(row)
            rowButtons.append(row)
            y += page == .hotkeys || page == .personas ? 58 : 44
        }
        restyleChrome()
        movePill(to: current, animated: false)
        highlightRows()
        window?.initialFirstResponder = rowButtons.first(where: { $0.page == current })
    }

    private func highlightRows() {
        for row in rowButtons { row.isChosen = row.page == current }
    }

    /// Re-tint the accent-following chrome after a theme switch (rows redraw; the pill re-fills).
    private func restyleChrome() {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        selectionPill.backgroundColor = NSColor.labelColor.withAlphaComponent(0.075).cgColor
        CATransaction.commit()
        rowButtons.forEach { $0.needsDisplay = true }
    }

    /// Reveal the destination immediately; never suggest selection of an intermediate row.
    private func movePill(to page: Page, animated: Bool) {
        guard let row = rowButtons.first(where: { $0.page == page }) else { return }
        let target = row.frame
        guard animated, !reduceMotion, selectionPill.frame.height > 0 else {
            selectionPill.removeAnimation(forKey: "glide")
            CATransaction.begin()
            CATransaction.setDisableActions(true)
            selectionPill.frame = target
            CATransaction.commit()
            return
        }
        selectionPill.removeAllAnimations()
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        selectionPill.frame = target
        CATransaction.commit()
        let reveal = CABasicAnimation(keyPath: "opacity")
        reveal.fromValue = 0.35; reveal.toValue = 1
        reveal.duration = 0.14 * Self.navTimeScale
        reveal.timingFunction = CAMediaTimingFunction(name: .easeOut)
        selectionPill.add(reveal, forKey: "glide")
    }

    /// A short reading transition with one active page; cached controls and scroll positions
    /// survive navigation without old outgoing animations leaking into a return visit.
    func show(page: Page) {
        let vc = pageControllers[page] ?? makeController(for: page)
        pageControllers[page] = vc

        // Already the visible page (a re-click on the current row): just settle the chrome.
        if vc.view === displayedPageView, vc.view.superview != nil {
            current = page
            movePill(to: page, animated: true)
            highlightRows()
            window?.title = page.localizedTitle
            return
        }

        (pageControllers[current] as? SettingsPage)?.pageWillHide()
        let isInitial = displayedPageView == nil
        current = page
        movePill(to: page, animated: !isInitial)
        highlightRows()
        window?.title = page.localizedTitle

        let incoming = vc.view
        incoming.frame = contentHost.bounds
        let outgoing = displayedPageView
        if let focused = window?.firstResponder as? NSView, let outgoing, focused.isDescendant(of: outgoing),
           let row = rowButtons.first(where: { $0.page == page }) {
            window?.makeFirstResponder(row)
        }
        // An interrupted hand-off may have left a mid-flight page behind — clear it instantly.
        for v in contentHost.subviews where v !== outgoing && v !== incoming { v.removeFromSuperview() }
        displayedPageView = incoming
        contentHost.addSubview(incoming)
        (vc as? SettingsPage)?.pageDidShow()

        // Cached pages must never bring an old fade/translation back when navigation
        // is reversed. Only the active page remains hittable and in the accessibility tree.
        incoming.wantsLayer = true
        incoming.layer?.removeAllAnimations()
        incoming.alphaValue = 1
        outgoing?.layer?.removeAllAnimations()
        outgoing?.removeFromSuperview()
        guard !isInitial, !reduceMotion else { return }
        let fade = CABasicAnimation(keyPath: "opacity")
        fade.fromValue = 0.65; fade.toValue = 1
        fade.duration = 0.12 * Self.navTimeScale
        fade.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
        incoming.layer?.add(fade, forKey: "page-reveal")
    }

    func windowWillClose(_ notification: Notification) {
        (pageControllers[current] as? SettingsPage)?.pageWillHide()
    }

    #if DEBUG
    var qaVisiblePageCount: Int { contentHost.subviews.count }
    var qaVisiblePage: NSView? { displayedPageView }
    var qaSubscriptionPage: PlusSubscriptionPage? { pageControllers[.account]?.children.compactMap { $0 as? PlusSubscriptionPage }.first }
    #endif

    private func makeController(for page: Page) -> NSViewController {
        switch page {
        case .general: return GeneralPageController()
        case .hotkeys:
            let vc = HotkeysPageController()
            vc.onChange = { [weak self] in self?.onHotkeysChanged?() }
            return vc
        case .account:
            let vc = AccountPageController()
            vc.onStartQuestion = { [weak self] in self?.onStartQuestion?() }
            return vc
        case .personas: return PersonasPageController(onChange: { [weak self] in self?.onAnythingChanged?() })
        case .advanced:
            let vc = AdvancedPageController()
            vc.onChange = { [weak self] in self?.onAnythingChanged?() }
            return vc
        }
    }

    /// Language switch: throw away every built page (they hold baked-in strings) and rebuild.
    private func rebuildAfterLanguageChange() {
        let focusedID = (window?.firstResponder as? NSView)?.identifier
        (pageControllers[current] as? SettingsPage)?.pageWillHide()
        sidebarSubtitle.stringValue = L10n.t("设置", "設定", "Settings")
        pageControllers.removeAll()
        buildSidebarRows()
        show(page: current)
        func findFocus(in view: NSView) -> NSView? {
            if view.identifier == focusedID, focusedID != nil { return view }
            return view.subviews.lazy.compactMap { findFocus(in: $0) }.first
        }
        if focusedID != nil, let page = displayedPageView, let replacement = findFocus(in: page) {
            window?.makeFirstResponder(replacement)
            replacement.scrollToVisible(replacement.bounds.insetBy(dx: 0, dy: -12))
        } else if let row = rowButtons.first(where: { $0.page == current }) {
            window?.makeFirstResponder(row)
        }
        onAnythingChanged?()
    }

    func open(page: Page) {
        show(page: page)
        if let row = rowButtons.first(where: { $0.page == page }) { window?.makeFirstResponder(row) }
        if window?.isVisible != true { window?.center() }
        window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        #if DEBUG
        // Visual-QA: print the window number so a shot can target THIS window by id
        // (screencapture -l <id>), grabbing only the app's own pixels — never the whole screen.
        if let n = window?.windowNumber { fputs("[NotchSPI] QA: settings windowNumber \(n)\n", stderr) }
        #endif
    }
}

// MARK: - Sidebar row

private final class SidebarRowButton: NSControl {
    let page: MainSettingsWindowController.Page
    var isChosen = false {
        didSet {
            needsDisplay = true
            if isChosen != oldValue { NSAccessibility.post(element: self, notification: .valueChanged) }
        }
    }
    var onNavigate: ((Int) -> Void)?
    private let onPick: (MainSettingsWindowController.Page) -> Void
    private var hovering = false { didSet { needsDisplay = true } }
    private var trackingAreaRef: NSTrackingArea?
    private var keyboardFocusVisible = false

    init(page: MainSettingsWindowController.Page, onPick: @escaping (MainSettingsWindowController.Page) -> Void) {
        self.page = page
        self.onPick = onPick
        super.init(frame: .zero)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override var isFlipped: Bool { true }
    override var acceptsFirstResponder: Bool { isEnabled && !isHiddenOrHasHiddenAncestor }
    override var canBecomeKeyView: Bool { acceptsFirstResponder }
    override func isAccessibilityElement() -> Bool { true }
    override func accessibilityRole() -> NSAccessibility.Role? { .radioButton }
    override func accessibilityLabel() -> String? { page.localizedTitle }
    override func accessibilityValue() -> Any? { isChosen ? 1 : 0 }
    override func isAccessibilityEnabled() -> Bool { isEnabled }
    override func accessibilityPerformPress() -> Bool {
        guard acceptsFirstResponder else { return false }
        keyboardFocusVisible = true
        window?.makeFirstResponder(self)
        onPick(page)
        return true
    }
    override func keyDown(with event: NSEvent) {
        guard acceptsFirstResponder else { return }
        keyboardFocusVisible = true; needsDisplay = true
        switch event.keyCode {
        case 36, 49, 76: _ = accessibilityPerformPress()
        case 125: onNavigate?(1)
        case 126: onNavigate?(-1)
        default: super.keyDown(with: event)
        }
    }
    override func becomeFirstResponder() -> Bool {
        if NSApp.currentEvent?.type == .keyDown { keyboardFocusVisible = true }
        needsDisplay = true; return super.becomeFirstResponder()
    }
    override func resignFirstResponder() -> Bool { needsDisplay = true; return super.resignFirstResponder() }

    override func draw(_ dirtyRect: NSRect) {
        // The chosen backdrop is the window's shared selection pill;
        // a row only paints its own transient hover chip.
        if hovering && !isChosen {
            let path = NSBezierPath(roundedRect: bounds, xRadius: 8, yRadius: 8)
            NSColor.labelColor.withAlphaComponent(0.04).setFill()
            path.fill()
        }
        let tint: NSColor = isChosen ? .labelColor : .secondaryLabelColor
        if let img = notchTintedSymbol(page.symbolName, pointSize: 14, weight: .medium, color: tint) {
            let s = img.size
            img.draw(in: NSRect(x: 12, y: bounds.midY - s.height / 2, width: s.width, height: s.height))
        }
        let attrs: [NSAttributedString.Key: Any] = [
            .font: NSFont.systemFont(ofSize: 13, weight: isChosen ? .semibold : .regular),
            .foregroundColor: isChosen ? NSColor.labelColor : NSColor.labelColor.withAlphaComponent(0.85),
        ]
        let title = page.localizedTitle as NSString
        let ts = title.size(withAttributes: attrs)
        title.draw(at: NSPoint(x: 38, y: bounds.midY - ts.height / 2), withAttributes: attrs)
        if window?.firstResponder === self && window?.isKeyWindow == true && keyboardFocusVisible {
            NSColor.keyboardFocusIndicatorColor.setStroke()
            let ring = NSBezierPath(roundedRect: bounds.insetBy(dx: 1, dy: 1), xRadius: 12, yRadius: 12)
            ring.lineWidth = 2
            ring.stroke()
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

    override func mouseEntered(with event: NSEvent) { hovering = true }
    override func mouseExited(with event: NSEvent) { hovering = false }
    override func mouseUp(with event: NSEvent) {
        if bounds.contains(convert(event.locationInWindow, from: nil)) {
            _ = accessibilityPerformPress()
            keyboardFocusVisible = false; needsDisplay = true
        }
    }
}

// MARK: - Page plumbing

final class SettingsFlippedView: NSView {
    var appearanceDidChange: (() -> Void)?
    override func viewDidChangeEffectiveAppearance() { super.viewDidChangeEffectiveAppearance(); appearanceDidChange?() }
    override var isFlipped: Bool { true }
}

/// Shared card geometry. Decorative surfaces never steal clicks from their controls.
final class SettingsCardView: NSView {
    var separators: [CGFloat] = []
    override func viewDidChangeEffectiveAppearance() { super.viewDidChangeEffectiveAppearance(); needsDisplay = true }
    override var isFlipped: Bool { true }
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
    override func draw(_ dirtyRect: NSRect) {
        let path = NSBezierPath(roundedRect: bounds.insetBy(dx: 0.5, dy: 0.5), xRadius: 12, yRadius: 12)
        NSColor.textBackgroundColor.withAlphaComponent(0.85).setFill()
        path.fill()
        NSColor.labelColor.withAlphaComponent(NSWorkspace.shared.accessibilityDisplayShouldIncreaseContrast ? 0.5 : 0.10).setStroke()
        path.lineWidth = 0.5
        path.stroke()
        for y in separators {
            let line = NSBezierPath()
            line.move(to: NSPoint(x: 16, y: y))
            line.line(to: NSPoint(x: bounds.width - 16, y: y))
            line.lineWidth = 0.5
            line.stroke()
        }
    }
}

/// Shared grouped surface; it stays behind controls and never participates in hit testing.
@discardableResult
func settingsGroupSurface(in root: NSView, frame: NSRect, separators: [CGFloat] = []) -> SettingsCardView {
    let surface = SettingsCardView(frame: frame)
    surface.separators = separators
    root.addSubview(surface, positioned: .below, relativeTo: root.subviews.first)
    return surface
}

private func settingsCard(_ root: NSView, y: CGFloat, height: CGFloat, separators: [CGFloat] = []) {
    let card = SettingsCardView(frame: NSRect(x: 36, y: y, width: 568, height: height))
    card.separators = separators
    root.addSubview(card, positioned: .below, relativeTo: root.subviews.first)
}

@MainActor
protocol SettingsPage {
    func pageDidShow()
    func pageWillHide()
}

extension SettingsPage { func pageWillHide() {} }

func pageTitleLabel(_ text: String) -> NSTextField {
    let f = NSTextField(labelWithString: text)
    f.font = InformationHierarchy.pageTitle
    f.textColor = .labelColor
    return f
}

func captionLabel(_ text: String, size: CGFloat = InformationHierarchy.metadataSize) -> NSTextField {
    let f = NSTextField(wrappingLabelWithString: text)
    f.font = .systemFont(ofSize: size)
    f.textColor = .secondaryLabelColor
    f.isSelectable = false
    return f
}

private func rowLabel(_ text: String) -> NSTextField {
    let f = NSTextField(labelWithString: text)
    f.font = InformationHierarchy.rowTitle
    f.textColor = .labelColor
    return f
}


private func settingsDescription(_ text: String, in root: NSView) {
    let description = captionLabel(text, size: 12)
    description.frame = NSRect(x: 36, y: 79, width: 568, height: 20)
    root.addSubview(description)
}

// MARK: - 通用 General

private final class GeneralPageController: NSViewController, SettingsPage {
    private let sizeSlider = SettingsSlider()
    private let sizeReadout = NSTextField(labelWithString: "")
    private let sizeSample = NSTextField(labelWithString: "")
    private let delaySlider = SettingsSlider()
    private let delayReadout = NSTextField(labelWithString: "")
    private let stayCheckbox = SettingsToggleButton()
    private let revealCheckbox = SettingsToggleButton()

    private let languagePopup = SettingsPopupButton()
    private var effortButtons: [SettingsEffortButton] = []
    private let targetPopup = SettingsPopupButton()
    private let autoCapPopup = SettingsPopupButton()
    private let loginCheckbox = SettingsToggleButton()
    private let loginCaption = captionLabel("")
    private let telemetryCheckbox = SettingsToggleButton()
    private let autoCopyCheckbox = SettingsToggleButton()

    private static let autoCapChoices = [5, 10, 20, 30, 50, 100, AutoSessionEngine.unlimitedQuestions]

    private let contentWidth: CGFloat = 536

    override func loadView() {
        let shell = SettingsFlippedView(frame: NSRect(origin: .zero, size: MainSettingsWindowController.pageSize))
        let root = SettingsFlippedView(frame: NSRect(x: 0, y: 0, width: MainSettingsWindowController.pageSize.width, height: 840))
        let scroll = NSScrollView(frame: NSRect(x: 0, y: 114, width: MainSettingsWindowController.pageSize.width, height: 488))
        scroll.hasVerticalScroller = true
        scroll.scrollerStyle = .overlay
        scroll.drawsBackground = false
        scroll.documentView = root
        scroll.autoresizingMask = [.width, .height]
        shell.addSubview(scroll)
        let title = pageTitleLabel(L10n.t("通用", "一般", "General"))
        title.frame = NSRect(x: 36, y: 42, width: 568, height: 32); shell.addSubview(title)
        let intro = captionLabel(L10n.t("你的节奏，你的工作方式。", "自分のペース、自分の使い方。", "Your pace. Your way of working."), size: 12)
        intro.frame = NSRect(x: 36, y: 79, width: 568, height: 20); shell.addSubview(intro)
        func section(_ number: String, _ title: String, _ y: CGFloat) {
            root.addSubview(SettingsSectionRule(number: number, title: title, frame: NSRect(x: 36, y: y, width: 568, height: 28)))
        }
        section("01", L10n.t("作答方式", "回答の設定", "Answering"), 0)
        let details = [L10n.t("更快得到答案", "すばやく回答", "Quicker answers"), L10n.t("多一点推敲", "もう一歩深く", "More deliberation"), L10n.t("充分展开推理", "じっくり考える", "Fuller reasoning")]
        for (index, effort) in Settings.reasoningEffortCycle.enumerated() {
            let button = SettingsEffortButton()
            button.title = L10n.reasoningEffortName(effort); button.detail = details[index]
            button.setAccessibilityLabel(button.title); button.setAccessibilityHelp(details[index])
            button.tag = index; button.target = self; button.action = #selector(reasoningEffortPicked(_:))
            button.frame = NSRect(x: 52 + CGFloat(index) * 181, y: 40, width: 174, height: 52)
            root.addSubview(button); effortButtons.append(button)
        }
        func label(_ text: String, x: CGFloat, y: CGFloat, width: CGFloat = 272) {
            let field = rowLabel(text); field.frame = NSRect(x: x, y: y, width: width, height: 20); root.addSubview(field)
        }
        label(L10n.t("截图目标", "キャプチャ対象", "Capture target"), x: 52, y: 114)
        targetPopup.frame = NSRect(x: 380, y: 108, width: 208, height: 32)
        targetPopup.setAccessibilityLabel(L10n.t("截图目标", "キャプチャ対象", "Capture target"))
        targetPopup.target = self; targetPopup.action = #selector(targetPicked); root.addSubview(targetPopup)
        label(L10n.t("自动连答上限", "自動連続回答の上限", "Auto session cap"), x: 52, y: 158)
        autoCapPopup.frame = NSRect(x: 380, y: 152, width: 208, height: 32)
        for cap in Self.autoCapChoices { autoCapPopup.addItem(withTitle: cap == AutoSessionEngine.unlimitedQuestions ? L10n.t("无限", "無制限", "Unlimited") : L10n.questions(cap)); autoCapPopup.lastItem?.representedObject = cap }
        autoCapPopup.selectItem(at: Self.autoCapChoices.firstIndex(of: Settings.shared.autoModeMaxQuestions) ?? 2)
        autoCapPopup.setAccessibilityLabel(L10n.t("自动连答上限", "自動連続回答の上限", "Auto session cap"))
        autoCapPopup.target = self; autoCapPopup.action = #selector(autoCapPicked); root.addSubview(autoCapPopup)
        let capHint = captionLabel(L10n.t("达到上限后自动停止；更改从下一次会话生效。", "上限に達すると自動停止。変更は次回から適用。", "Stops at the limit. Changes apply to your next session."))
        capHint.frame = NSRect(x: 52, y: 190, width: 536, height: 20); root.addSubview(capHint)
        autoCopyCheckbox.identifier = NSUserInterfaceItemIdentifier("settings.autoCopy")
        autoCopyCheckbox.title = L10n.t("答完后自动复制答案", "回答後に答えを自動コピー", "Copy answers to clipboard automatically")
        autoCopyCheckbox.target = self; autoCopyCheckbox.action = #selector(autoCopyToggled)
        autoCopyCheckbox.frame = NSRect(x: 52, y: 218, width: 536, height: 30); root.addSubview(autoCopyCheckbox)
        section("02", L10n.t("答案呈现", "回答の表示", "Answer presentation"), 280)
        let sizeLabel = rowLabel(L10n.t("答案字号", "回答の文字サイズ", "Answer text size"))
        sizeLabel.frame = NSRect(x: 52, y: 330, width: 180, height: 20); root.addSubview(sizeLabel)
        sizeSlider.setAccessibilityLabel(sizeLabel.stringValue)
        sizeSlider.minValue = Double(Appearance.answerFontRange.lowerBound); sizeSlider.maxValue = Double(Appearance.answerFontRange.upperBound)
        sizeSlider.doubleValue = Double(Appearance.answerFontSize)
        sizeSlider.numberOfTickMarks = Int(Appearance.answerFontRange.upperBound - Appearance.answerFontRange.lowerBound) + 1
        sizeSlider.allowsTickMarkValuesOnly = true; sizeSlider.target = self; sizeSlider.action = #selector(sizeChanged)
        sizeSlider.frame = NSRect(x: 320, y: 325, width: 180, height: 30); root.addSubview(sizeSlider)
        sizeReadout.font = .monospacedDigitSystemFont(ofSize: 12, weight: .medium)
        sizeReadout.alignment = .right; sizeReadout.frame = NSRect(x: 494, y: 330, width: 94, height: 20); root.addSubview(sizeReadout)
        sizeSample.frame = NSRect(x: 320, y: 362, width: 284, height: 30); root.addSubview(sizeSample)
        let delayLabel = rowLabel(L10n.t("答完后收起", "回答後にたたむ", "Fold after answering"))
        delayLabel.frame = NSRect(x: 52, y: 490, width: 190, height: 20); root.addSubview(delayLabel)
        stayCheckbox.identifier = NSUserInterfaceItemIdentifier("settings.stayExpanded")
        revealCheckbox.identifier = NSUserInterfaceItemIdentifier("settings.revealReasoning")
        delaySlider.setAccessibilityLabel(delayLabel.stringValue)
        delaySlider.minValue = Appearance.collapseSecondsRange.lowerBound; delaySlider.maxValue = Appearance.collapseSecondsRange.upperBound
        delaySlider.doubleValue = Appearance.collapseSeconds; delaySlider.target = self; delaySlider.action = #selector(delayChanged)
        delaySlider.frame = NSRect(x: 320, y: 485, width: 180, height: 30); root.addSubview(delaySlider)
        delayReadout.font = .monospacedDigitSystemFont(ofSize: 12, weight: .regular)
        delayReadout.alignment = .right; delayReadout.frame = NSRect(x: 494, y: 490, width: 94, height: 20); root.addSubview(delayReadout)
        let rows: [(SettingsToggleButton, String, Selector, Bool)] = [
            (stayCheckbox, L10n.t("保持展开，直到移开鼠标", "マウスを離すまで開いたまま", "Keep expanded until the mouse leaves"), #selector(stayToggled), Appearance.stayExpanded),
            (revealCheckbox, L10n.t("答完后默认展开「推理过程」", "回答後に「考え方」を最初から開く", "Show the reasoning unfolded by default"), #selector(revealToggled), Appearance.revealReasoningByDefault)
        ]
        for (index, row) in rows.enumerated() {
            row.0.title = row.1; row.0.target = self; row.0.action = row.2; row.0.state = row.3 ? .on : .off
            row.0.frame = NSRect(x: 52, y: index == 0 ? 438 : 396, width: 536, height: 30); root.addSubview(row.0)
        }
        section("03", L10n.t("应用偏好", "アプリの設定", "App preferences"), 562)
        label(L10n.t("界面语言", "表示言語", "Interface language"), x: 52, y: 612)
        languagePopup.identifier = NSUserInterfaceItemIdentifier("settings.language")
        languagePopup.frame = NSRect(x: 380, y: 606, width: 208, height: 32)
        for lang in AppLanguage.allCases { languagePopup.addItem(withTitle: lang.pickerLabel); languagePopup.lastItem?.representedObject = lang.rawValue }
        languagePopup.selectItem(at: AppLanguage.allCases.firstIndex(of: L10n.setting) ?? 0)
        languagePopup.setAccessibilityLabel(L10n.t("界面语言", "表示言語", "Interface language"))
        languagePopup.target = self; languagePopup.action = #selector(languagePicked); root.addSubview(languagePopup)
        loginCheckbox.title = L10n.t("登录时自动启动", "ログイン時に自動起動", "Launch at login")
        loginCheckbox.target = self; loginCheckbox.action = #selector(loginToggled)
        loginCheckbox.frame = NSRect(x: 52, y: 650, width: 536, height: 30); root.addSubview(loginCheckbox)
        loginCaption.frame = NSRect(x: 52, y: 684, width: 536, height: 20); root.addSubview(loginCaption)
        telemetryCheckbox.title = L10n.t("共享匿名可靠性数据", "匿名の信頼性データを共有", "Share anonymous reliability data")
        telemetryCheckbox.target = self; telemetryCheckbox.action = #selector(telemetryToggled)
        telemetryCheckbox.frame = NSRect(x: 52, y: 720, width: 536, height: 30); root.addSubview(telemetryCheckbox)
        let privacy = captionLabel(L10n.t("共享状态、场景、耗时、操作与数据缺失记录，不含截图、题目、答案或提示词。关闭后清空待传数据；计费记录保留。", "状態・用途・時間・操作・データ欠落を共有。画像・問題・回答・プロンプトは対象外。停止時は送信待ちを削除し、課金記録は保持。", "Shares status, profiles, timing, actions and data gaps; never screenshots, questions, answers or prompts. Turning this off clears pending diagnostics; billing records remain."))
        privacy.frame = NSRect(x: 52, y: 758, width: 536, height: 40); root.addSubview(privacy)
        settingsCard(root, y: 28, height: 230, separators: [120, 182])
        settingsCard(root, y: 308, height: 228, separators: [166])
        settingsCard(root, y: 590, height: 228, separators: [52, 118])
        view = shell; syncSizeUI(); syncDelayUI()
    }

    @objc private func autoCopyToggled() { Appearance.autoCopyAnswer = (autoCopyCheckbox.state == .on) }

    func pageDidShow() {
        stayCheckbox.state = Appearance.stayExpanded ? .on : .off
        revealCheckbox.state = Appearance.revealReasoningByDefault ? .on : .off
        syncSizeUI(); syncDelayUI()
        autoCopyCheckbox.state = Appearance.autoCopyAnswer ? .on : .off
        for (index, button) in effortButtons.enumerated() { button.state = Settings.reasoningEffortCycle[index] == Settings.shared.reasoningEffort ? .on : .off; button.needsDisplay = true }
        autoCapPopup.selectItem(at: Self.autoCapChoices.firstIndex(of: Settings.shared.autoModeMaxQuestions) ?? 2)
        reloadTargets()
        reloadLoginState()
        telemetryCheckbox.state = ProductTelemetry.shared.sharingEnabled ? .on : .off
    }

    // MARK: Answer size

    @objc private func sizeChanged() {
        Appearance.answerFontSize = CGFloat(sizeSlider.doubleValue)
        syncSizeUI()
    }

    private func syncSizeUI() {
        sizeSlider.doubleValue = Double(Appearance.answerFontSize)
        sizeReadout.stringValue = Appearance.fontSizeReadout(Appearance.answerFontSize)
        restyleSample()
    }

    /// Mirror the notch's answer-card headline (body size + 4, semibold) at the chosen size.
    private func restyleSample() {
        let pt = Appearance.answerFontSize
        sizeSample.font = .systemFont(ofSize: pt + 4, weight: .semibold)
        sizeSample.textColor = .labelColor
        sizeSample.stringValue = L10n.t("答案 A = −30", "答え A = −30", "Answer  A = −30")
    }

    // MARK: Collapse

    @objc private func delayChanged() {
        Appearance.collapseSeconds = delaySlider.doubleValue
        syncDelayUI()
    }

    @objc private func stayToggled() {
        Appearance.stayExpanded = (stayCheckbox.state == .on)
        syncDelayUI()
    }

    private func syncDelayUI() {
        let stay = Appearance.stayExpanded
        delaySlider.isEnabled = !stay
        delaySlider.doubleValue = Appearance.collapseSeconds
        delayReadout.textColor = stay ? .tertiaryLabelColor : .secondaryLabelColor
        delayReadout.stringValue = Appearance.collapseReadout(stay: stay, seconds: Appearance.collapseSeconds)
    }

    @objc private func revealToggled() {
        Appearance.revealReasoningByDefault = (revealCheckbox.state == .on)
    }

    private func reloadTargets() {
        targetPopup.removeAllItems()
        targetPopup.addItem(withTitle: L10n.t("整个屏幕", "画面全体", "Entire screen"))
        targetPopup.lastItem?.representedObject = nil as String?
        let savedID = Settings.shared.captureTargetBundleID
        var matched = savedID == nil
        for app in ScreenCapture.capturableApps() {
            targetPopup.addItem(withTitle: app.name)
            targetPopup.lastItem?.representedObject = app
            if app.bundleID == savedID {
                targetPopup.select(targetPopup.lastItem)
                matched = true
            }
        }
        if !matched, let savedID {
            let gone = Settings.shared.captureTargetName ?? savedID
            targetPopup.addItem(withTitle: gone + L10n.t("（未运行）", "（未起動）", " (not running)"))
            targetPopup.select(targetPopup.lastItem)
        }
    }

    private func reloadLoginState() {
        if Bundle.main.bundleIdentifier != nil {
            loginCheckbox.isEnabled = true
            loginCheckbox.state = SMAppService.mainApp.status == .enabled ? .on : .off
            loginCaption.stringValue = L10n.t("开机后 NotchSPI 安静地待在刘海旁。",
                                              "起動後、NotchSPI はノッチの横で静かに待機します。",
                                              "After login, NotchSPI waits quietly beside the notch.")
        } else {
            // Unbundled `swift run` dev binary — SMAppService needs a real .app.
            loginCheckbox.isEnabled = false
            loginCaption.stringValue = L10n.t("（开发版不支持；打包后的 App 可用）",
                                              "（開発ビルドでは利用不可）",
                                              "(Unavailable in the dev build)")
        }
    }

    @objc private func languagePicked() {
        guard let raw = languagePopup.selectedItem?.representedObject as? String,
              let lang = AppLanguage(rawValue: raw) else { return }
        L10n.setting = lang
    }

    @objc private func reasoningEffortPicked(_ sender: NSButton) {
        let index = sender.tag
        guard Settings.reasoningEffortCycle.indices.contains(index) else { return }
        Settings.shared.reasoningEffort = Settings.reasoningEffortCycle[index]
        for (i, button) in effortButtons.enumerated() { button.state = i == index ? .on : .off; button.needsDisplay = true }
        NotificationCenter.default.post(name: Appearance.themeDidChange, object: nil)
    }

    @objc private func targetPicked() {
        if let app = targetPopup.selectedItem?.representedObject as? ScreenCapture.AppInfo {
            Settings.shared.captureTargetBundleID = app.bundleID
            Settings.shared.captureTargetName = app.name
        } else {
            Settings.shared.captureTargetBundleID = nil
            Settings.shared.captureTargetName = nil
        }
    }

    @objc private func autoCapPicked() {
        guard let cap = autoCapPopup.selectedItem?.representedObject as? Int else { return }
        Settings.shared.autoModeMaxQuestions = cap
    }

    @objc private func loginToggled() {
        do {
            if loginCheckbox.state == .on {
                try SMAppService.mainApp.register()
            } else {
                try SMAppService.mainApp.unregister()
            }
        } catch {
            reloadLoginState() // revert the checkbox; the OS said no
        }
    }

    @objc private func telemetryToggled() {
        ProductTelemetry.shared.sharingEnabled = telemetryCheckbox.state == .on
    }
}

// MARK: - 快捷键 Hotkeys (embeds the recorder rows)

private final class HotkeysPageController: NSViewController, SettingsPage {
    var onChange: (() -> Void)?
    private let embedded = HotkeySettingsViewController()

    override func loadView() {
        let root = SettingsFlippedView(frame: NSRect(origin: .zero, size: MainSettingsWindowController.pageSize))

        let title = pageTitleLabel(L10n.t("快捷键", "ショートカット", "Hotkeys"))
        title.frame = NSRect(x: 36, y: 42, width: 568, height: 32)
        root.addSubview(title)

        embedded.onChange = { [weak self] in self?.onChange?() }
        addChild(embedded)
        embedded.view.frame = NSRect(x: 36, y: 114, width: 568, height: 488)
        root.addSubview(embedded.view)

        settingsDescription(L10n.t("常用操作，触手可及。", "よく使う操作を、すぐ手元に。", "Your most-used actions, one shortcut away."), in: root)
        view = root
    }

    func pageDidShow() {}
    func pageWillHide() { embedded.cancelRecording() }
}

// MARK: - 账户 Account

private final class AccountPageController: NSViewController, SettingsPage {
    var onStartQuestion: (() -> Void)?
    private let packsButton = SettingsPopupButton()
    private let quotaLabel = captionLabel("", size: 12)
    private let quotaNote = captionLabel("")
    private var legacyQuotaNote = ""
    private var packIDs: [String] = []
    private var busy = false
    private let recovery = PurchaseRecoveryStore()
    private var polling: Task<Void, Never>?
    private var activeObserver: NSObjectProtocol?
    private let ring = QuotaRingView()
    private let usageLabel = captionLabel("", size: 12)
    private let tokensLabel = captionLabel("")
    private let deviceLabel = captionLabel("")
    private let statusLabel = captionLabel("", size: 12)
    private let topUpButton = SettingsActionButton()
    private let refreshButton = SettingsActionButton()
    private let claimButton = SettingsActionButton()
    private let resetButton = SettingsActionButton()
    private let copyCodeButton = SettingsActionButton()
    private var observer: NSObjectProtocol?

    private let subscription = PlusSubscriptionPage()
    private var subscriptionLayoutHeight: CGFloat = 292
    private let spendPacks = SettingsToggleButton()
    private let balances = SettingsBalanceStrip(frame: NSRect(x: 36, y: 142, width: 568, height: 56))
    private let overview = NSTextField(labelWithString: "")
    private let recoveryHelp = captionLabel("")


    override func loadView() {
        let root = SettingsFlippedView(frame: NSRect(origin: .zero, size: MainSettingsWindowController.pageSize))
        let title = pageTitleLabel(MainSettingsWindowController.Page.account.localizedTitle)
        title.frame = NSRect(x: 36, y: 42, width: 568, height: 32)
        root.addSubview(title)
        let subtitle = captionLabel(L10n.t("你的计划、用量与支付，尽在此处。", "プラン、利用状況、お支払いをひとつに。", "Your plan, usage and billing, together."))
        subtitle.frame = NSRect(x: 36, y: 78, width: 568, height: 22)
        root.addSubview(subtitle)

        let scroll = NSScrollView(frame: NSRect(x: 0, y: 112, width: 640, height: 508))
        scroll.hasVerticalScroller = true
        scroll.autohidesScrollers = true
        scroll.drawsBackground = false
        let document = SettingsFlippedView(frame: NSRect(x: 0, y: 0, width: 640, height: 1030))
        scroll.documentView = document
        root.addSubview(scroll)
        addChild(subscription)
        subscription.view.frame = NSRect(x: 36, y: 242, width: 568, height: 292)

        document.addSubview(SettingsSectionRule(number: "01", title: L10n.t("你的体验", "あなたの利用状況", "Your access"), frame: NSRect(x: 36, y: 0, width: 568, height: 28)))
        overview.stringValue = L10n.t("当前使用状态", "現在の利用状況", "Your access")
        overview.font = .systemFont(ofSize: 13, weight: .semibold)
        overview.frame = NSRect(x: 60, y: 20, width: 280, height: 22)
        overview.isHidden = true
        ring.frame = NSRect(x: 60, y: 426, width: 152, height: 152)
        ring.isHidden = true
        document.addSubview(ring)
        usageLabel.frame = NSRect(x: 36, y: 42, width: 568, height: 38)
        usageLabel.font = .systemFont(ofSize: 21, weight: .semibold)
        usageLabel.textColor = .labelColor
        document.addSubview(usageLabel)
        quotaLabel.frame = NSRect(x: 36, y: 88, width: 568, height: 44)
        document.addSubview(quotaLabel)
        document.addSubview(balances)
        // Token counts are implementation details; the account shows useful answer counts.
        tokensLabel.isHidden = true
        func button(_ control: NSButton, _ text: String, _ action: Selector, _ frame: NSRect) {
            control.title = text; control.bezelStyle = .rounded
            control.font = .systemFont(ofSize: 12, weight: .medium)
            control.target = self; control.action = action; control.frame = frame
            document.addSubview(control)
        }
        button(refreshButton, L10n.refresh, #selector(refreshTapped), NSRect(x: 492, y: 0, width: 112, height: 24))
        button(claimButton, L10n.t("开始 3 天免费体验", "3日間の無料体験を開始", "Start your 3-day trial"), #selector(claimTapped), NSRect(x: 36, y: 148, width: 244, height: 34))
        claimButton.prominent = true
        button(resetButton, L10n.t("重置服务凭证", "認証情報をリセット", "Reset credential"), #selector(resetTapped), claimButton.frame)
        resetButton.isHidden = true
        spendPacks.title = L10n.t("每日额度用完后，允许使用已购题包", "毎日の枠の終了後、購入パックを使う", "Allow purchased packs after daily allowances run out")
        spendPacks.frame = NSRect(x: 36, y: 666, width: 568, height: 30)
        spendPacks.target = self; spendPacks.action = #selector(spendPacksChanged)
        statusLabel.frame = NSRect(x: 36, y: 202, width: 568, height: 32)
        document.addSubview(statusLabel)
        document.addSubview(subscription.view)

        document.addSubview(SettingsSectionRule(number: "03", title: L10n.t("额外用量", "追加の利用枠", "Additional usage"), frame: NSRect(x: 36, y: 558, width: 568, height: 28)))
        let packsTitle = rowLabel(L10n.t("一次性题包", "追加パック", "One-time question packs"))
        let packsHint = captionLabel(L10n.t("按需补充 · 余额长期有效 · 不自动续费", "必要な分だけ追加・有効期限なし・自動更新なし", "Top up as needed. No expiry. No automatic renewal."))
        packsHint.frame = NSRect(x: 36, y: 596, width: 568, height: 22)
        document.addSubview(packsHint)
        packsButton.font = .systemFont(ofSize: 12)
        packsButton.frame = NSRect(x: 36, y: 626, width: 326, height: 32)
        packsButton.setAccessibilityLabel(packsTitle.stringValue)
        document.addSubview(packsButton)
        button(topUpButton, L10n.topUp, #selector(topUpTapped), NSRect(x: 382, y: 626, width: 222, height: 32))

        document.addSubview(spendPacks)

        legacyQuotaNote = L10n.t(
            "免费体验、Plus、题包按顺序使用。成功获得可用答案计 1 次，失败不扣次。每日额度按北京时间 00:00 重置，不累计。",
            "無料体験、Plus、購入パックの順に使用。回答成功時のみ1回消費。毎日北京時間00:00にリセットし、繰り越しはありません。",
            "Trial, Plus, then purchased credits are used in order. Only usable answers count. Daily allowances reset at midnight Beijing time, with no rollover.")
        quotaNote.stringValue = legacyQuotaNote
        quotaNote.frame = NSRect(x: 36, y: 706, width: 568, height: 58)
        document.addSubview(quotaNote)
        document.addSubview(SettingsSectionRule(number: "04", title: L10n.t("账户与恢复", "アカウントと復元", "Account & recovery"), frame: NSRect(x: 36, y: 786, width: 568, height: 28)))
        deviceLabel.frame = NSRect(x: 36, y: 826, width: 568, height: 24)
        document.addSubview(deviceLabel)
        button(copyCodeButton, L10n.t("复制设备码", "デバイスコードをコピー", "Copy device code"), #selector(copyCodeTapped), NSRect(x: 36, y: 860, width: 274, height: 32))
        button(SettingsActionButton(), L10n.t("恢复已有账户", "アカウントを復元", "Restore an account"), #selector(restoreAccountTapped), NSRect(x: 330, y: 860, width: 274, height: 32))
        recoveryHelp.stringValue = L10n.t("账户凭证保存在本机钥匙串。恢复码可在重装或换电脑时找回同一账户，不会合并两个账户的余额。请像密码一样保管，不要发给他人。没有恢复码时，请凭付款记录联系客服；不要重置已购账户。", "認証情報はキーチェーンに保存されます。復元コードで再インストール・別のMacでも同じアカウントを利用できます。残高は統合されません。コードは秘密に保管してください。紛失時は購入記録でサポートにお問い合わせください。", "Your credential is saved in Keychain. Keep a recovery code to access the same account after reinstalling or on another Mac. Accounts and balances are not merged. Treat the code as a password. If it is lost, contact support with payment records; do not reset a paid account.")
        recoveryHelp.frame = NSRect(x: 36, y: 908, width: 568, height: 92)
        document.addSubview(recoveryHelp)
        // Keep a full section gap after the access summary, including its status line.
        for child in document.subviews where child.frame.minY >= 242 { child.frame.origin.y += 16 }
        document.frame.size.height += 16
        settingsGroupSurface(in: document, frame: NSRect(x: 20, y: 28, width: 600, height: 210))
        let membershipSurface = settingsGroupSurface(in: document, frame: NSRect(x: 20, y: 286, width: 600, height: 264))
        settingsGroupSurface(in: document, frame: NSRect(x: 20, y: 602, width: 600, height: 184))
        settingsGroupSurface(in: document, frame: NSRect(x: 20, y: 830, width: 600, height: 200))
        view = root
        subscription.onHeightChange = { [weak self, weak document] height in
            guard let self, let document else { return }
            let oldBottom = self.subscription.view.frame.minY + self.subscriptionLayoutHeight
            let delta = height - self.subscriptionLayoutHeight
            guard delta != 0 else { return }
            for child in document.subviews where child !== self.subscription.view && child.frame.minY >= oldBottom {
                child.frame.origin.y += delta
            }
            membershipSurface.frame.size.height = height - 28
            self.subscription.view.frame.size.height = height
            document.frame.size.height += delta
            self.subscriptionLayoutHeight = height
        }
        subscription.onHeightChange?(subscription.preferredHeight)
        reload()
        observer = NotificationCenter.default.addObserver(forName: OfficialAPI.accountDidChange, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.reload()
                self?.subscription.refreshIfAccountChanged()
                if let self, self.view.window != nil, OfficialAPI.deviceToken != nil, OfficialAPI.accountState.value("allowanceSources") == nil, OfficialAPI.accountState.value("spendingPolicySupported") as? Bool == true, !OfficialAPI.credentialRejected { self.refreshTapped() }
            }
        }
    }

    deinit {
        polling?.cancel()
        if let activeObserver { NotificationCenter.default.removeObserver(activeObserver) }
        if let observer { NotificationCenter.default.removeObserver(observer) }
    }

    /// Visual-QA: NSPI_QA_BALANCE=N renders the page as a registered device holding N questions
    /// — no Keychain, no network (pair with NSPI_QA_EPHEMERAL). Always nil in release.
    private static var qaBalance: Int? {
        #if DEBUG
        return ProcessInfo.processInfo.environment["NSPI_QA_BALANCE"].flatMap(Int.init)
        #else
        return nil
        #endif
    }

    func pageDidShow() {
        reload()
        subscription.pageDidShow()
        guard Self.qaBalance == nil else { return }
        if activeObserver == nil {
            activeObserver = NotificationCenter.default.addObserver(forName: NSApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in self?.refreshTapped() }
        }
        if OfficialAPI.deviceToken == nil { claimTapped() } else { refreshTapped(); startPolling() }
        Task { @MainActor [weak self] in
            await ClientConfigService.shared.refresh()?.value
            self?.reload()
        }
    }

    private func reload() {
        defer { renderOverview(); subscription.refreshUsage() }
        #if DEBUG
        if let n = Self.qaBalance {
            ring.setBalance(n, animated: true)
            usageLabel.stringValue = L10n.t("累计已答 \(OfficialAPI.totalQuestions) 题",
                                            "これまでに\(OfficialAPI.totalQuestions)問回答",
                                            "\(OfficialAPI.totalQuestions) questions answered so far")
            quotaLabel.stringValue = L10n.t("题包剩余 \(n) 题", "パック残高：\(n)問", "\(n) purchased questions remaining")
            packsButton.removeAllItems()
            packsButton.addItem(withTitle: L10n.t("100 题 · ¥19", "100問 · ¥19", "100 questions · CNY 19"))
            deviceLabel.stringValue = L10n.t("设备 ID：", "デバイスID：", "Device ID: ") + "nspi-••••••••Q4"
            claimButton.isHidden = true
            resetButton.isHidden = true
            copyCodeButton.isHidden = false
            topUpButton.title = L10n.t("购买所选题包", "選択したパックを購入", "Buy selected pack")
            topUpButton.isEnabled = true
            refreshButton.isEnabled = true
            return
        }
        #endif
        let registered = OfficialAPI.deviceToken != nil
        // Credential kept but rejected by the server (401): a distinct state from "not registered".
        let rejected = registered && OfficialAPI.credentialRejected
        // A cached balance without a live/accepted token is stale — show the empty ring, not a
        // number nobody can spend.
        let balance = (registered && !rejected) ? OfficialAPI.balanceQuestions : nil
        ring.setBalance(balance, animated: true)
        usageLabel.stringValue = L10n.t("累计已答 \(OfficialAPI.totalQuestions) 题",
                                        "これまでに\(OfficialAPI.totalQuestions)問回答",
                                        "\(OfficialAPI.totalQuestions) questions answered so far")
        let tk = OfficialAPI.accumulateUsage(OfficialAPI.totalInputTokens, OfficialAPI.totalOutputTokens)
        tokensLabel.stringValue = tk > 0 ? "· \(tk) tokens" : ""
        deviceLabel.stringValue = registered
            ? L10n.t("设备 ID：", "デバイスID：", "Device ID: ") + OfficialAPI.truncatedToken(OfficialAPI.deviceToken ?? "")
            : L10n.t("尚未领取免费额度。", "まだ無料枠を受け取っていません。", "Free questions not claimed yet.")
        let trial = registered && !rejected ? OfficialAPI.freeTrial : nil
        claimButton.isHidden = rejected || (registered && trial?.status != .eligible)
        claimButton.title = trial?.status == .eligible ? L10n.t("开始 3 天免费体验", "3日間の無料体験を始める", "Start 3-day free trial") : L10n.t("连接账户", "アカウントに接続", "Connect account")
        claimButton.isEnabled = !busy
        resetButton.isHidden = true
        copyCodeButton.isHidden = !registered
        // A rejected credential can't be spent or topped up until it's reset or re-accepted.
        let payments = ClientConfigService.shared.current.payments
        let pending = OfficialAPI.accountState.account.flatMap { recovery.pending($0) }
        let packs = pending?.packSnapshot.map { [$0] } ?? payments?.packs.sorted { $0.questions < $1.questions } ?? []
        let currency = pending?.currency ?? payments?.currency
        let selected = packsButton.indexOfSelectedItem
        let previousID = packIDs.indices.contains(selected) ? packIDs[selected] : nil
        packsButton.removeAllItems(); packIDs = packs.map(\.id)
        for pack in packs {
            let formatter = NumberFormatter(); formatter.numberStyle = .currency
            formatter.currencyCode = currency
            let exponent = formatter.maximumFractionDigits
            let value = Decimal(pack.amountMinor) / pow(Decimal(10), exponent)
            let price = formatter.string(from: NSDecimalNumber(decimal: value)) ?? "—"
            packsButton.addItem(withTitle: (pack.names?[OfficialAPI.topUpLang].map { $0 + " · " } ?? "") + L10n.t("\(pack.questions) 题", "\(pack.questions) 問", "\(pack.questions) questions") + " · " + price)
        }
        if let id = pending?.packID ?? previousID, let index = packIDs.firstIndex(of: id) { packsButton.selectItem(at: index) }
        else if packs.count > 1 { packsButton.selectItem(at: 1) }
        packsButton.isEnabled = !busy && pending == nil
        topUpButton.title = pending == nil ? L10n.t("购买所选题包", "選択したパックを購入", "Buy selected pack") : L10n.t("继续原订单", "元の注文を再開", "Resume order")
        copyCodeButton.title = pending == nil ? L10n.t("保存账户恢复码", "復元コードを保存", "Save recovery code") : L10n.t("复制订单号", "注文番号をコピー", "Copy order ID")
        refreshButton.title = pending == nil ? L10n.refresh : L10n.t("查询到账", "反映を確認", "Check payment")
        topUpButton.isEnabled = registered && !rejected && !busy && payments?.purchaseSessions == true && !packs.isEmpty
        refreshButton.isEnabled = registered && !busy
        let initial = OfficialAPI.accountState.value("initialGrant") as? Int
        let breakdown = OfficialAPI.accountState.value("quotaBreakdown") as? [String: Int]
        quotaLabel.stringValue = ""
        if let initial, registered && !rejected {
            quotaLabel.stringValue = L10n.t("首次已获 \(initial) 题", "初回付与 \(initial) 問", "Initial grant: \(initial)")
            if let free = breakdown?["trial"], let paid = breakdown?["paid"] {
                quotaLabel.stringValue += L10n.t(" · 免费剩余 \(free) · 付费剩余 \(paid)", " · 無料残高 \(free) · 購入残高 \(paid)", " · Free left: \(free) · Paid left: \(paid)")
            }
        }
        quotaNote.stringValue = legacyQuotaNote
        if let trial {
            if trial.status == .eligible {
                quotaLabel.stringValue = L10n.t("72 小时体验尚未开始 · 可随时领取", "72時間の体験は未開始 · いつでも受け取れます", "Your 72-hour trial hasn’t started · claim whenever you’re ready")
            } else if trial.status == .active {
                quotaLabel.stringValue = L10n.t("今日免费剩余 \(trial.dailyRemaining)/400 次", "本日の無料枠：残り\(trial.dailyRemaining)/400回", "Free solves today: \(trial.dailyRemaining)/400")
                    + (trial.expirationLabel.map { L10n.t(" · 至 ", " · 期限 ", " · Until ") + $0 } ?? "")
            } else if trial.status == .expired {
                quotaLabel.stringValue = L10n.t("3 天免费体验已结束", "3日間の無料体験は終了しました", "Your 3-day free trial has ended")
            }
            if trial.status != .ineligible {
                quotaNote.stringValue = L10n.t("免费体验从领取起持续 72 小时，每天 400 次，北京时间 00:00 重置，不累计。成功解答计 1 次，失败不计。免费额度用完或体验到期后可继续使用已购题数，题包不自动续费。", "無料体験は開始から72時間。毎日400回、北京時間00:00にリセット、繰り越しなし。成功した回答のみ1回と数えます。無料枠の終了後は購入済み残高を利用でき、パックは自動更新されません。", "The trial lasts 72 hours from claiming, with 400 solves per Beijing day and no rollover. Successful answers count once; failures don’t. Purchased credits remain available after the daily limit or trial ends. Packs don’t auto-renew.")
            }
        }
        // Surface the rejection without clobbering a transient status message already on screen.
        if rejected && statusLabel.stringValue.isEmpty {
            statusLabel.stringValue = L10n.t(
                "本机服务凭证已失效。若只是临时网络/服务波动，请先点「刷新」重试；确认失效后再「重置服务凭证」（不影响已购买的题数入账记录）。",
                "このデバイスの認証情報が無効になりました。一時的な不具合の場合はまず「更新」を試し、無効が確実な場合のみ「認証情報をリセット」してください(購入済みの記録には影響しません)。",
                "This device's credential was rejected. If it's just a temporary hiccup, hit Refresh first; only Reset once you're sure — your purchase records are unaffected.")
        }
    }

    private func renderOverview() {
        let external = Settings.shared.serviceMode != ServiceMode.official && (Settings.shared.serviceMode != ServiceMode.cli || OfficialAPI.cliEnabled)
        var sources = OfficialAPI.accountState.value("allowanceSources") as? [String: Int]
        if let n = Self.qaBalance { sources = ["trial": 0, "plus": 388, "purchased": n, "other": 0] }
        let summary = AccountOverview(sources: sources, trial: OfficialAPI.freeTrial,
            registered: Self.qaBalance != nil || OfficialAPI.deviceToken != nil, rejected: OfficialAPI.credentialRejected,
            allowPurchased: Settings.shared.allowPurchasedCredits, externalService: external)
        usageLabel.stringValue = summary.heading
        balances.update(sources)
        let trialEligible = OfficialAPI.freeTrial?.status == .eligible
        let hasBreakdown = sources != nil && !external && !OfficialAPI.credentialRejected && !trialEligible
        balances.isHidden = !hasBreakdown
        quotaLabel.frame = NSRect(x: 36, y: 88, width: 568, height: 44)
        quotaLabel.stringValue = sources != nil && !external && !OfficialAPI.credentialRejected ? summary.detail.components(separatedBy: "\n").dropFirst(2).joined(separator: "\n") : summary.detail
        if trialEligible && !external {
            usageLabel.stringValue = L10n.t("3 天，体验 notchSPI。", "3日間、notchSPI を体験。", "3 days with notchSPI.")
            quotaLabel.stringValue = L10n.t("每天 400 次成功求解。准备好后再开始，72 小时从此刻计时。\n无需订阅，不会自动续费。", "毎日400回の解答。開始した時点から72時間。\n登録不要・自動更新なし。", "400 successful solves daily. Your 72 hours begin when you start.\nNo subscription. No automatic renewal.")
        } else if OfficialAPI.freeTrial?.status == .active && !external {
            usageLabel.stringValue = L10n.t("notchSPI 体验进行中", "notchSPI を体験中", "Your notchSPI trial")
        }
        quotaNote.stringValue = L10n.t("使用顺序：免费额度 → Plus → 其他余额 → 已购题包。只有成功获得可用答案才计次；解释和失败不额外扣次。题包不自动续费，长期有效。", "無料枠 → Plus → その他の残高 → 購入パックの順。回答成功時のみ消費。解説・失敗は追加消費なし。パックは自動更新・期限なし。", "Order: free allowance → Plus → other credits → purchased packs. Only usable answers count; explanations and failures cost no extra. Packs do not expire or auto-renew.")
        if !Settings.shared.allowPurchasedCredits { quotaNote.stringValue += L10n.t(" 当前已关闭题包自动使用。", " パック自動利用はオフです。", " Pack spending is currently off.") }
        spendPacks.state = Settings.shared.allowPurchasedCredits ? .on : .off
        spendPacks.isEnabled = !external && !busy
        if Self.qaBalance != nil { copyCodeButton.title = L10n.t("保存账户恢复码", "復元コードを保存", "Save recovery code") }
    }

    @objc private func spendPacksChanged() {
        Settings.shared.allowPurchasedCredits = spendPacks.state == .on
        renderOverview()
        statusLabel.stringValue = spendPacks.state == .off
            ? L10n.t("已暂停使用题包。每日额度恢复后可继续，也可随时重新开启此选项。", "パックを保護しました。毎日の枠のリセットを待つか、この設定をオンにしてください。", "Pack spending is paused. Wait for daily allowances to reset, or turn this option back on.")
            : L10n.t("每日权益用完后将自动使用题包，每次成功解答扣 1 题。", "毎日の枠の終了後、回答成功ごとにパックを1問消費します。", "After daily allowances, each successful answer uses one purchased question.")
    }

    @objc private func restoreAccountTapped() {
        guard !busy, let window = view.window else { return }
        let alert = NSAlert()
        alert.messageText = L10n.t("恢复已有账户", "アカウントを復元", "Restore an account")
        alert.informativeText = L10n.t("输入原账户恢复码。验证成功后切换账户，当前余额不会合并；请先保存当前恢复码。", "復元コードを入力してください。検証後に切り替えます。残高は統合されません。現在のコードを先に保存してください。", "Enter your recovery code. After verification, this switches accounts without merging balances. Save your current recovery code first.")
        let field = NSSecureTextField(frame: NSRect(x: 0, y: 0, width: 360, height: 28))
        field.placeholderString = L10n.t("账户恢复码", "復元コード", "Recovery code")
        field.setAccessibilityLabel(field.placeholderString)
        alert.accessoryView = field
        alert.addButton(withTitle: L10n.cancel)
        alert.addButton(withTitle: L10n.t("验证并恢复", "検証して復元", "Verify and restore"))
        alert.beginSheetModal(for: window) { [weak self] response in
            guard let self, response == .alertSecondButtonReturn else { return }
            let code = field.stringValue; field.stringValue = ""
            guard Self.qaBalance == nil else {
                self.statusLabel.stringValue = L10n.t("离线样例不会导入真实账户。", "オフライン例では復元しません。", "Offline preview does not import real accounts."); return
            }
            self.busy = true; self.reload()
            Task { @MainActor in
                let result = await OfficialAPI.restoreAccount(code: code)
                self.busy = false
                switch result {
                case .success: self.statusLabel.stringValue = L10n.t("账户已恢复。", "復元しました。", "Account restored.")
                case .failure(let error): self.statusLabel.stringValue = error.message
                }
                self.reload(); self.subscription.refreshIfAccountChanged()
            }
        }
    }


    @objc private func topUpTapped() {
        guard !busy, let account = OfficialAPI.accountState.account,
              let payments = ClientConfigService.shared.current.payments, payments.purchaseSessions,
              packIDs.indices.contains(packsButton.indexOfSelectedItem) else { return }
        let pending = recovery.pending(account) ?? PendingPurchase(id: UUID(), packID: packIDs[packsButton.indexOfSelectedItem], catalogVersion: payments.catalogVersion,
            packSnapshot: payments.packs.first { $0.id == packIDs[packsButton.indexOfSelectedItem] }, currency: payments.currency)
        // Recovery is advertised by the server before this client feature is enabled.
        // Older services retain their existing browser flow without a permanently locked pending order.
        if payments.purchaseRecovery == true { recovery.save(pending, for: account) }
        busy = true; reload()
        Task { @MainActor in
            defer { busy = false; reload() }
            do {
                if payments.purchaseRecovery == true, let progress = try await OfficialAPI.purchaseProgress(pending) {
                    guard OfficialAPI.accountState.matches(account) else { return }
                    if progress.state != .ready {
                        await applyProgress(progress, pending: pending, account: account, resume: true)
                        startPolling()
                        return
                    }
                }
                statusLabel.stringValue = L10n.t("正在打开付款页…", "決済画面を開いています…", "Opening payment…")
                let handoff = try await OfficialAPI.createPurchaseSession(packID: pending.packID, catalogVersion: pending.catalogVersion, purchaseID: pending.id)
                guard handoff.belongs() else { return }
                if NSWorkspace.shared.open(handoff.purchaseURL) {
                    statusLabel.stringValue = L10n.t("已打开付款页。返回后自动查询；关闭页面也可继续原订单。", "決済画面を開きました。戻ると自動確認します。閉じても元の注文を再開できます。", "Payment opened. Return for an automatic check, or resume this order after closing the page.")
                    if payments.purchaseRecovery != true {
                        statusLabel.stringValue = L10n.t("已打开付款页。此服务暂不支持订单查询；付款后请刷新余额，未到账请联系客服。", "決済画面を開きました。注文照会には未対応です。決済後に残高を更新し、未反映ならサポートへ。", "Payment opened. This service does not support order lookup; refresh after payment and contact support if credits are missing.")
                    }
                    startPolling()
                } else { statusLabel.stringValue = L10n.t("浏览器未打开，请点继续原订单重试。", "ブラウザを開けません。元の注文を再開してください。", "Browser did not open. Resume this order to retry.") }
            } catch {
                if (error as? OfficialAPIError)?.code == "idempotency_conflict", payments.purchaseRecovery == true {
                    do {
                        if try await OfficialAPI.purchaseProgress(pending) == nil, OfficialAPI.accountState.matches(account) {
                            // A catalog rejection created no order. Require a new, visible selection at the current price.
                            recovery.save(nil, for: account)
                            await ClientConfigService.shared.refresh()?.value
                        }
                    } catch { /* Keep the recovery identity when the lookup is inconclusive. */ }
                }
                showPurchaseError(error)
            }
        }
    }

    private func showPurchaseError(_ error: Error) {
        statusLabel.stringValue = (error as? OfficialAPIError)?.message ?? L10n.t("暂未确认，请查询或继续原订单。不要重复付款。", "未確認です。元の注文を確認・再開してください。重複決済は不要です。", "Not confirmed. Check or resume this order; do not pay again.")
    }

    private func applyProgress(_ progress: PurchaseProgress, pending: PendingPurchase, account: OfficialAPI.CaptureAccount, resume: Bool) async {
        guard OfficialAPI.accountState.matches(account) else { return }
        switch progress.state {
        case .credited:
            let result = await OfficialAPI.refreshAccount()
            guard OfficialAPI.accountState.matches(account) else { return }
            if case .failure(let error) = result { showPurchaseError(error); return }
            recovery.save(nil, for: account)
            statusLabel.stringValue = L10n.t("\(progress.questions) 题已到账。", "\(progress.questions)問が反映されました。", "\(progress.questions) questions credited.")
        case .expired:
            recovery.save(nil, for: account)
            statusLabel.stringValue = L10n.t("原订单已过期且未付款，可重新选择题包。", "元の注文は未決済で期限切れです。パックを選び直せます。", "The unpaid order expired. You can select a pack again.")
        case .unpaid:
            statusLabel.stringValue = L10n.t("原订单尚未付款。取消或失败后可继续同一付款页。", "元の注文は未決済です。キャンセル・失敗後も同じ決済を再開できます。", "Order is unpaid. Resume the same checkout after cancellation or failure.")
            if resume, let url = progress.checkoutURL, !NSWorkspace.shared.open(url) { showPurchaseError(OfficialAccountFailure.invalidResponse) }
        case .review:
            statusLabel.stringValue = L10n.t("此订单需客服核对，请勿再次付款。订单号：", "サポートの確認が必要です。再決済しないでください。注文：", "This order needs support review. Do not pay again. Order: ") + pending.id.uuidString
        case .pending:
            statusLabel.stringValue = L10n.t("支付仍在确认，请稍后查询到账，无需再次付款。", "決済を確認中です。後ほど確認してください。再決済は不要です。", "Payment is processing. Check again shortly; no new payment is needed.")
        case .ready:
            statusLabel.stringValue = L10n.t("订单已保留，可继续付款。", "注文を保存しました。決済を続けられます。", "Order saved. You can continue payment.")
        }
    }

    private func startPolling() {
        polling?.cancel()
        polling = Task { @MainActor [weak self] in
            for _ in 0..<12 {
                do { try await Task.sleep(nanoseconds: 5_000_000_000) } catch { return }
                guard let self, let account = OfficialAPI.accountState.account, self.recovery.pending(account) != nil else { return }
                self.refreshTapped()
            }
        }
    }

    @objc private func refreshTapped() {
        guard !busy else { return }
        subscription.pageDidShow()
        busy = true; reload()
        statusLabel.stringValue = L10n.t("正在同步…", "同期中…", "Syncing…")
        Task { @MainActor in
            defer { busy = false; reload() }
            switch await OfficialAPI.refreshAccount() {
            case .success: statusLabel.stringValue = ""
            case .failure(let error): statusLabel.stringValue = error.message; return
            }
            await ClientConfigService.shared.refresh()?.value
            if let account = OfficialAPI.accountState.account, let pending = recovery.pending(account) {
                if ClientConfigService.shared.current.payments?.purchaseRecovery == true {
                    do {
                        if let progress = try await OfficialAPI.purchaseProgress(pending) {
                            await applyProgress(progress, pending: pending, account: account, resume: false)
                        } else { statusLabel.stringValue = L10n.t("购买尚未创建，可继续原订单重试。", "購入は未作成です。元の注文を再開してください。", "Purchase was not created. Resume the original order to retry.") }
                    } catch { showPurchaseError(error) }
                } else {
                    statusLabel.stringValue = L10n.t("此服务暂不支持订单查询。如已付款但未到账，请联系客服，勿重复付款。", "注文照会に未対応です。決済済みで未反映ならサポートへ。再決済は不要です。", "Order lookup is unavailable on this service. Contact support if payment is missing; do not pay again.")
                }
            }
        }
    }

    @objc private func claimTapped() {
        guard !busy else { return }
        let trialAccount = OfficialAPI.freeTrial?.status == .eligible ? OfficialAPI.accountState.account : nil
        let startedWithFocus = view.window?.firstResponder === claimButton
        busy = true; claimButton.isEnabled = false
        statusLabel.stringValue = L10n.t("正在核对免费额度…", "無料枠を確認中…", "Checking free questions…")
        Task { @MainActor in
            defer {
                busy = false; claimButton.isEnabled = true; reload()
                // Disabling the action while awaiting the server can move focus to the window.
                // Restore it only if the user has not navigated to another page or control.
                if startedWithFocus, let window = view.window,
                   window.firstResponder === window || window.firstResponder === claimButton {
                    window.makeFirstResponder(claimButton.isHidden ? refreshButton : claimButton)
                }
            }
            if let trialAccount {
                switch await OfficialAPI.claimFreeTrial(expectedAccount: trialAccount) {
                case .success(let trial):
                    statusLabel.stringValue = trial.status == .active
                        ? L10n.t("3 天免费体验已开启。", "3日間の無料体験が始まりました。", "Your 3-day free trial is active.")
                        : L10n.t("免费体验已结束。", "無料体験は終了しました。", "Your free trial has ended.")
                case .failure(let error): statusLabel.stringValue = error.message
                }
                return
            }
            switch await OfficialAPI.registerIfNeeded() {
            case .success:
                if case .failure(let error) = await OfficialAPI.refreshAccount() { statusLabel.stringValue = error.message; return }
                await ClientConfigService.shared.refresh()?.value
                statusLabel.stringValue = L10n.t("账户已同步。", "アカウントを同期しました。", "Account synced.")
            case .failure(let error): statusLabel.stringValue = error.message
            }
        }
    }

    @objc private func copyCodeTapped() {
        if let account = OfficialAPI.accountState.account, let pending = recovery.pending(account) {
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(pending.id.uuidString, forType: .string)
            statusLabel.stringValue = L10n.t("订单号已复制，可用于联系客服核对。", "注文番号をコピーしました。サポートへの確認に使えます。", "Order ID copied for support to check this purchase.")
            return
        }
        guard let token = OfficialAPI.deviceToken, let window = view.window else { return }
        let alert = NSAlert()
        alert.messageText = L10n.t("保存账户恢复码", "復元コードを保存", "Save your recovery code")
        alert.informativeText = L10n.t("此码可以访问你的账户和权益。请保存到密码管理器，不要发送给客服或他人。", "このコードでアカウントを利用できます。パスワード管理アプリに保存し、他人に送らないでください。", "This code grants access to your account. Save it in a password manager; do not send it to support or other people.")
        let field = NSTextField(string: token)
        field.isEditable = false; field.isSelectable = true
        field.frame = NSRect(x: 0, y: 0, width: 420, height: 28)
        alert.accessoryView = field
        alert.addButton(withTitle: L10n.t("完成", "完了", "Done"))
        alert.beginSheetModal(for: window) { _ in field.stringValue = "" }

    }

    @objc private func resetTapped() {
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = L10n.t("重置服务凭证？", "認証情報をリセットしますか？",
                                   "Reset service credential?")
        alert.informativeText = L10n.t(
            "仅在确认本机凭证确实失效时才重置。重置会丢弃当前设备码并领取一份新的免费额度；如果只是临时网络或服务波动，请改点「刷新」。已购买题包或 Plus 请先复制设备码联系客服再重置。重置本机凭证不会取消 Plus 自动续费。",
            "認証情報が確実に無効な場合のみリセットしてください。現在のデバイスコードを破棄して新しい無料枠を取得します。一時的な不具合の場合は「更新」をお使いください。購入済みパックや Plus がある場合は、先にデバイスコードをコピーしてサポートにご連絡ください。認証情報のリセットでは Plus の自動更新は停止しません。",
            "Only reset if you're sure the credential is truly invalid. This discards the current device code and claims a fresh free allowance. If it's a temporary hiccup, use Refresh instead. If you have purchased credits or Plus, copy the device code and contact support before resetting. Resetting this credential does not cancel Plus renewal.")
        alert.addButton(withTitle: L10n.t("重置并重新领取", "リセットして再取得", "Reset & re-claim"))
        alert.addButton(withTitle: L10n.cancel)
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        guard OfficialAPI.resetCredential() else {
            statusLabel.stringValue = L10n.t("凭证未能重置，请解锁钥匙串后重试。", "リセットできません。キーチェーンを解除して再試行してください。",
                                            "The credential could not be reset. Unlock Keychain and retry.")
            return
        }
        statusLabel.stringValue = ""
        reload()
        claimTapped() // mint and register a fresh device token
    }
}

/// The quota at a glance: a true conic-gradient arc (proportion of the fixed 30-question grant,
/// capped at full) around a live rolling number. The arc lands on a soft spring and the number
/// counts to its new value — one glance says both "how much" and "which way it just moved".
/// Amber when running low, so "time to top up" is felt before it's read.
final class QuotaRingView: NSView {
    private var displayedFraction: CGFloat = 0   // 0…1 arc sweep currently drawn
    private var displayedNumber: CGFloat = 0     // rolling count-up value
    private var balance: Int?
    private var arcTween: DisplayTween?
    private var numberTween: DisplayTween?

    override func isAccessibilityElement() -> Bool { true }
    override func accessibilityRole() -> NSAccessibility.Role? { .staticText }
    override func accessibilityLabel() -> String? {
        guard let balance else { return L10n.t("剩余额度尚未获取", "残りの利用枠は未取得です", "Remaining quota unavailable") }
        return L10n.t("\(balance) 题可用", "\(balance)問利用可能", "\(balance) questions left")
    }

    /// The progress ring: a conic gradient sheet masked to a round-capped arc whose strokeEnd is
    /// the live sweep. CG has no conic API, so the gradient rides a CAGradientLayer above the
    /// view's own drawing (track + number), which is exactly the right stacking anyway.
    private let conic = CAGradientLayer()
    private let arcMask = CAShapeLayer()

    private var reduceMotion: Bool { onboardingReduceMotion() }

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true
        conic.type = .conic
        conic.startPoint = CGPoint(x: 0.5, y: 0.5)
        conic.endPoint = CGPoint(x: 0.5, y: 1)     // gradient's 0-angle points at the arc's top start
        arcMask.fillColor = nil
        arcMask.strokeColor = NSColor.black.cgColor
        arcMask.lineWidth = 12
        arcMask.lineCap = .round
        arcMask.strokeEnd = 0
        conic.mask = arcMask
        layer?.addSublayer(conic)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func setBalance(_ newBalance: Int?, animated: Bool) {
        let changed = balance != newBalance
        balance = newBalance
        if changed { NSAccessibility.post(element: self, notification: .valueChanged) }
        let target = CGFloat(min(1, max(0, Double(newBalance ?? 0) / 30.0)))
        if arcTween == nil {
            arcTween = DisplayTween(host: self, value: 0)
            arcTween?.ease = NotchMotion.springSettle   // the arc lands with a soft breath past target
            arcTween?.onChange = { [weak self] v in
                self?.displayedFraction = v
                self?.applyRing()
            }
            numberTween = DisplayTween(host: self, value: 0)
            numberTween?.onChange = { [weak self] v in
                self?.displayedNumber = v
                self?.needsDisplay = true
            }
        }
        let number = CGFloat(newBalance ?? 0)
        if animated && !reduceMotion {
            arcTween?.animate(to: target, duration: 0.9)
            numberTween?.animate(to: number, duration: 0.9)
        } else {
            arcTween?.set(target)
            numberTween?.set(number)
        }
        applyRing()
    }

    override func layout() {
        super.layout()
        let center = CGPoint(x: bounds.midX, y: bounds.midY)
        let radius = min(bounds.width, bounds.height) / 2 - 10
        // One full clockwise-from-top turn; strokeEnd exposes the live sweep.
        let arc = CGMutablePath()
        arc.addArc(center: center, radius: radius,
                   startAngle: .pi / 2, endAngle: .pi / 2 - 2 * .pi, clockwise: true)
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        conic.frame = bounds
        arcMask.frame = bounds
        arcMask.path = arc
        CATransaction.commit()
        applyRing()
    }

    /// Push the tweened sweep into the layers: strokeEnd plus gradient stops pinned so the
    /// accent sits at the arc's start and the highlight rides its head. The conic sweep runs
    /// counterclockwise in this y-up geometry while the arc runs clockwise, so arc position s
    /// samples the gradient at location 1 − s.
    private func applyRing() {
        let low = (balance ?? Int.max) <= OfficialAPI.lowQuotaThreshold
        let accent = low ? AccentTheme.amber.accent : NotchPalette.accent
        let accentHi = low ? AccentTheme.amber.accentHi : NotchPalette.accentHi
        let f = min(1, max(0, displayedFraction))
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        arcMask.strokeEnd = f
        conic.colors = [accentHi.cgColor, accentHi.cgColor, accent.cgColor]
        conic.locations = [0, NSNumber(value: Double(1 - f)), 1]
        conic.isHidden = f <= 0.004
        CATransaction.commit()
        needsDisplay = true
    }

    override func draw(_ dirtyRect: NSRect) {
        guard let ctx = NSGraphicsContext.current?.cgContext else { return }
        let low = (balance ?? Int.max) <= OfficialAPI.lowQuotaThreshold

        let center = CGPoint(x: bounds.midX, y: bounds.midY)
        let radius = min(bounds.width, bounds.height) / 2 - 10
        let lineWidth: CGFloat = 12

        // Track (the conic progress rides above as a sublayer).
        ctx.setStrokeColor(NSColor.labelColor.withAlphaComponent(0.10).cgColor)
        ctx.setLineWidth(lineWidth)
        ctx.setLineCap(.round)
        ctx.addArc(center: center, radius: radius, startAngle: 0, endAngle: 2 * .pi, clockwise: false)
        ctx.strokePath()

        // Number + unit in the middle. The number itself goes amber when the quota is low —
        // at zero there is no arc left to carry the warning color.
        let numberText = balance == nil ? "—" : String(Int(displayedNumber.rounded()))
        let numberAttrs: [NSAttributedString.Key: Any] = [
            .font: NSFont.monospacedDigitSystemFont(ofSize: 34, weight: .bold),
            .foregroundColor: (low && balance != nil) ? AccentTheme.amber.accent : NSColor.labelColor,
        ]
        let unitAttrs: [NSAttributedString.Key: Any] = [
            .font: NSFont.systemFont(ofSize: 12, weight: .medium),
            .foregroundColor: NSColor.secondaryLabelColor,
        ]
        let n = numberText as NSString
        let ns = n.size(withAttributes: numberAttrs)
        n.draw(at: NSPoint(x: center.x - ns.width / 2, y: center.y - ns.height / 2 + 7), withAttributes: numberAttrs)
        let unit = L10n.t("题可用", "問利用可能", "questions left") as NSString
        let us = unit.size(withAttributes: unitAttrs)
        unit.draw(at: NSPoint(x: center.x - us.width / 2, y: center.y - ns.height / 2 - us.height + 4), withAttributes: unitAttrs)
    }
}

// MARK: - 人物像 Personas (embeds the library manager)

private final class PersonasPageController: NSViewController, SettingsPage {
    private let embedded = PersonaManagerViewController()
    private let onChange: () -> Void

    init(onChange: @escaping () -> Void) {
        self.onChange = onChange
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func loadView() {
        let root = SettingsFlippedView(frame: NSRect(origin: .zero, size: MainSettingsWindowController.pageSize))
        let title = pageTitleLabel(L10n.t("人物像", "人物像", "Personas"))
        title.frame = NSRect(x: 36, y: 42, width: 568, height: 32)
        root.addSubview(title)
        let hint = captionLabel(L10n.t("性格测试作答时，答案会尽量贴合当前选中的人物像。",
                                       "性格検査の回答は、選択中の人物像に沿うように選ばれます。",
                                       "Personality-test answers lean toward the selected persona."))
        hint.frame = NSRect(x: 36, y: 79, width: 568, height: 30)
        root.addSubview(hint)
        embedded.onChange = { [weak self] in self?.onChange() }
        addChild(embedded)
        embedded.view.frame = NSRect(x: 0, y: 114, width: 640, height: 504)
        root.addSubview(embedded.view)
        view = root
    }

    func pageDidShow() { embedded.reloadFromStore() }
}

// MARK: - 高级 Advanced

private final class AdvancedPageController: NSViewController, SettingsPage, NSTextFieldDelegate {
    var onChange: (() -> Void)?

    private var modeRadios: [NSButton] = []
    private let backendPopup = SettingsPopupButton()   // CLI-mode engine (codex / claude)
    private let providerPopup = SettingsPopupButton()  // custom-key third-party provider
    private let apiKeyField = SettingsSecureTextField()
    private let apiModelField = SettingsTextField()
    private let baseURLField = SettingsTextField()      // custom provider only
    private let versionLabel = captionLabel("")
    /// The CLI-switch state the page was last built with; a mismatch (客服 flipped it and an
    /// account sync landed) triggers a rebuild so the CLI radio appears/disappears live.
    private var builtWithCLIEnabled = false
    private var accountObserver: NSObjectProtocol?

    deinit {
        if let o = accountObserver { NotificationCenter.default.removeObserver(o) }
    }

    override func loadView() {
        let shell = SettingsFlippedView(frame: NSRect(origin: .zero, size: MainSettingsWindowController.pageSize))
        let title = pageTitleLabel(MainSettingsWindowController.Page.advanced.localizedTitle)
        title.frame = NSRect(x: 36, y: 42, width: 568, height: 32); shell.addSubview(title)
        settingsDescription(L10n.t("选择回答来源，管理连接与更新。", "回答元・接続・アップデートを管理。", "Choose your service and manage connections and updates."), in: shell)
        let scroll = NSScrollView(frame: NSRect(x: 0, y: 114, width: 640, height: MainSettingsWindowController.pageSize.height - 114))
        scroll.drawsBackground = false
        scroll.automaticallyAdjustsContentInsets = false
        scroll.contentInsets = .init()
        scroll.hasVerticalScroller = true
        scroll.autohidesScrollers = true
        scroll.documentView = document
        shell.addSubview(scroll)
        view = shell
        populate()
        accountObserver = NotificationCenter.default.addObserver(
            forName: OfficialAPI.accountDidChange, object: nil, queue: .main
        ) { [weak self] _ in self?.rebuildIfCLISwitchChanged() }
    }

    private func rebuildIfCLISwitchChanged() {
        guard isViewLoaded, builtWithCLIEnabled != OfficialAPI.cliEnabled else { return }
        populate()
    }

    /// (Re)build the whole page. Idempotent so the CLI-switch observer can call it again.
    private let document = SettingsFlippedView()

    private func populate() {
        let root = document
        root.subviews.forEach { $0.removeFromSuperview() }
        modeRadios.removeAll()
        let cliEnabled = OfficialAPI.cliEnabled
        builtWithCLIEnabled = cliEnabled

        var y: CGFloat = 0

        // 答题通道 (service channel). The CLI radio exists only on devices where the operator
        // has flipped the per-device switch (镜像自官方服务的 cli_enabled) — everyone else sees
        // just official / custom key, and routing reroutes any stale cli mode to official.
        root.addSubview(SettingsSectionRule(number: "01", title: L10n.t("答题通道", "回答チャネル", "Answering channel"), frame: NSRect(x: 36, y: y, width: 568, height: 28)))
        y += 44

        let descs: [String: String] = [
            ServiceMode.official: L10n.t("默认。开箱即用，按题数额度计费。", "デフォルト。設定不要、質問数制。", "Default. Zero setup, question-quota billing."),
            ServiceMode.customKey: L10n.t("用你自己的第三方 API Key 直连，费用走你的账户。", "自分の外部 API キーで直接接続。", "Use your own third-party API key; costs go to your account."),
            ServiceMode.cli: L10n.t("驱动本机已登录的 codex / claude 命令行。", "ローカルの codex / claude CLI を利用。", "Drive the locally installed codex / claude CLIs."),
        ]
        let visibleModes = cliEnabled ? ServiceMode.all : ServiceMode.all.filter { $0 != ServiceMode.cli }
        // With the CLI hidden, a stored cli mode resolves to official — show that honestly.
        var selectedMode = Settings.shared.serviceMode
        if !cliEnabled && selectedMode == ServiceMode.cli { selectedMode = ServiceMode.official }
        for (index, mode) in visibleModes.enumerated() {
            let radio = SettingsEffortButton()
            radio.title = L10n.serviceModeLabel(mode); radio.detail = descs[mode] ?? ""
            radio.target = self; radio.action = #selector(modePicked(_:)); radio.tag = index
            radio.setAccessibilityLabel(radio.title); radio.setAccessibilityHelp(radio.detail)
            radio.frame = NSRect(x: 36, y: y, width: 568, height: 68)
            radio.identifier = NSUserInterfaceItemIdentifier(mode); radio.state = selectedMode == mode ? .on : .off
            root.addSubview(radio); modeRadios.append(radio); y += 78
        }
        y += 20
        if selectedMode != ServiceMode.official {
            root.addSubview(SettingsSectionRule(number: "02", title: L10n.t("连接配置", "接続設定", "Connection"), frame: NSRect(x: 36, y: y, width: 568, height: 28)))
            y += 40
        }

        // Custom-key mode: pick a third-party provider, then paste that vendor's key + (optionally)
        // a model. Everything routes through APIProvider — presets fill endpoint/model, and the
        // "Custom" entry exposes a Base URL field for any OpenAI-compatible service.
        if selectedMode == ServiceMode.customKey {
            let provider = Settings.shared.activeProvider

            // 厂商
            let providerLabel = rowLabel(L10n.t("厂商", "プロバイダ", "Provider"))
            providerLabel.frame = NSRect(x: 36, y: y + 4, width: 136, height: 18)
            root.addSubview(providerLabel)
            providerPopup.setAccessibilityLabel(providerLabel.stringValue)
            providerPopup.removeAllItems()
            for p in APIProvider.all {
                providerPopup.addItem(withTitle: p.isCustom
                    ? L10n.t("自定义 · OpenAI 兼容", "カスタム · OpenAI 互換", "Custom · OpenAI-compatible")
                    : p.name)
                providerPopup.lastItem?.representedObject = p.id
            }
            providerPopup.selectItem(at: APIProvider.all.firstIndex { $0.id == provider.id } ?? 0)
            providerPopup.target = self
            providerPopup.action = #selector(providerPicked)
            providerPopup.frame = NSRect(x: 200, y: y, width: 260, height: 32)
            root.addSubview(providerPopup)
            if provider.consoleURL != nil {
                let getKey = SettingsActionButton(title: L10n.t("获取 Key ↗", "キーを取得 ↗", "Get key ↗"),
                                      target: self, action: #selector(openConsole))
                getKey.bezelStyle = .recessed
                getKey.controlSize = .small
                getKey.frame = NSRect(x: 472, y: y, width: 132, height: 32)
                root.addSubview(getKey)
            }
            y += 40

            // Base URL — custom provider only.
            if provider.isCustom {
                let urlLabel = rowLabel("Base URL")
                urlLabel.frame = NSRect(x: 36, y: y + 4, width: 136, height: 18)
                root.addSubview(urlLabel)
                baseURLField.setAccessibilityLabel("Base URL")
                baseURLField.placeholderString = "https://api.example.com/v1"
                baseURLField.font = .monospacedSystemFont(ofSize: 11.5, weight: .regular)
                baseURLField.bezelStyle = .roundedBezel
                baseURLField.frame = NSRect(x: 200, y: y, width: 404, height: 32)
                baseURLField.delegate = self
                baseURLField.identifier = NSUserInterfaceItemIdentifier("apiBaseURL")
                root.addSubview(baseURLField)
                y += 44
            }

            // API Key
            let keyLabel = rowLabel("API Key")
            keyLabel.frame = NSRect(x: 36, y: y + 4, width: 136, height: 18)
            root.addSubview(keyLabel)
            apiKeyField.setAccessibilityLabel("API Key")
            apiKeyField.placeholderString = provider.keyPlaceholder
            apiKeyField.font = .monospacedSystemFont(ofSize: 11.5, weight: .regular)
            apiKeyField.bezelStyle = .roundedBezel
            apiKeyField.frame = NSRect(x: 200, y: y, width: 404, height: 32)
            apiKeyField.delegate = self
            apiKeyField.identifier = NSUserInterfaceItemIdentifier("apiKey")
            root.addSubview(apiKeyField)
            y += 44

            // 模型
            let modelLabel = rowLabel(L10n.t("模型", "モデル", "Model"))
            modelLabel.frame = NSRect(x: 36, y: y + 4, width: 136, height: 18)
            root.addSubview(modelLabel)
            apiModelField.setAccessibilityLabel(modelLabel.stringValue)
            apiModelField.placeholderString = provider.defaultModel.isEmpty
                ? L10n.t("必填（需支持视觉）", "必須（視覚対応）", "required (vision-capable)")
                : provider.defaultModel
            apiModelField.font = .monospacedSystemFont(ofSize: 11.5, weight: .regular)
            apiModelField.bezelStyle = .roundedBezel
            apiModelField.frame = NSRect(x: 200, y: y, width: 404, height: 32)
            apiModelField.delegate = self
            apiModelField.identifier = NSUserInterfaceItemIdentifier("apiModel")
            root.addSubview(apiModelField)
            y += 44

            // The empty-key fallback differs with the CLI switch: unlocked → CLI (the pre-official
            // behavior), locked → the official service. Say the truth for this device.
            let keyHint = captionLabel(cliEnabled
                ? L10n.t("Key 只存本机钥匙串；截图会直接发给所选厂商（模型需支持视觉）。留空则回退到 CLI。",
                         "キーはこのMacのキーチェーンにのみ保存。スクショは選択したプロバイダに送信（視覚対応モデルが必要）。空欄ならCLIへフォールバック。",
                         "Keys stay in your local Keychain; the screenshot goes straight to the chosen provider (model must support vision). Empty → CLI fallback.")
                : L10n.t("Key 只存本机钥匙串；截图会直接发给所选厂商（模型需支持视觉）。留空则使用官方服务。",
                         "キーはこのMacのキーチェーンにのみ保存。スクショは選択したプロバイダに送信（視覚対応モデルが必要）。空欄なら公式サービスを利用。",
                         "Keys stay in your local Keychain; the screenshot goes straight to the chosen provider (model must support vision). Empty → the official service."))
            keyHint.frame = NSRect(x: 36, y: y, width: 568, height: 48)
            root.addSubview(keyHint)
            y += 52
        } else if selectedMode == ServiceMode.cli {
            // 引擎 — which locally-installed CLI to drive. Only reachable when the operator has
            // unlocked the CLI channel for this device (cliEnabled); there's no key to infer it
            // from, so the picker stays here (persistent popup ⇒ clear it before repopulating).
            let backendLabel = rowLabel(L10n.t("引擎", "エンジン", "Engine"))
            backendLabel.frame = NSRect(x: 36, y: y + 4, width: 136, height: 18)
            root.addSubview(backendLabel)
            backendPopup.removeAllItems()
            for (id, label) in [("codex", "Codex"), ("claude", "Claude")] {
                backendPopup.addItem(withTitle: label)
                backendPopup.lastItem?.representedObject = id
            }
            backendPopup.selectItem(at: Settings.shared.cli == "claude" ? 1 : 0)
            backendPopup.target = self
            backendPopup.action = #selector(backendPicked)
            backendPopup.frame = NSRect(x: 200, y: y, width: 220, height: 32)
            root.addSubview(backendPopup)
            y += 42

            let cliHint = captionLabel(L10n.t(
                "驱动本机已安装并登录的对应命令行。",
                "ローカルにインストール・ログイン済みの対応 CLI を利用します。",
                "Drives the matching local CLI (must be installed and signed in)."))
            cliHint.frame = NSRect(x: 36, y: y, width: 568, height: 32)
            root.addSubview(cliHint)
            y += 28
        }

        if selectedMode != ServiceMode.official {
            y += 24
        }
        root.addSubview(SettingsSectionRule(number: selectedMode == ServiceMode.official ? "02" : "03", title: L10n.t("软件更新", "アップデート", "Software updates"), frame: NSRect(x: 36, y: y, width: 568, height: 28)))
        y += 40
        // Updates + version
        let updateButton = SettingsActionButton(title: L10n.t("检查更新…", "アップデートを確認…", "Check for Updates…"),
                                    target: self, action: #selector(checkUpdates))
        updateButton.bezelStyle = .rounded
        updateButton.frame = NSRect(x: 36, y: y, width: 170, height: 30)
        root.addSubview(updateButton)
        versionLabel.stringValue = "NotchSPI \(UpdateChecker.currentVersion)"
        versionLabel.frame = NSRect(x: 216, y: y + 7, width: 200, height: 16)
        root.addSubview(versionLabel)

        let sections = root.subviews.compactMap { $0 as? SettingsSectionRule }.sorted { $0.frame.minY < $1.frame.minY }
        for (index, section) in sections.enumerated() {
            let top = section.frame.maxY
            let bottom = index + 1 < sections.count ? sections[index + 1].frame.minY - 16 : y + 46
            settingsGroupSurface(in: root, frame: NSRect(x: 20, y: top, width: 600, height: bottom - top))
        }
        reloadKeys()
        root.setFrameSize(NSSize(width: 640, height: max(MainSettingsWindowController.pageSize.height - 114, y + 80)))
    }

    /// Fill the custom-key fields from the active provider's stored key / model / base URL. A model
    /// equal to the provider's default shows blank so the placeholder carries the default.
    private func reloadKeys() {
        let p = Settings.shared.activeProvider
        apiKeyField.stringValue = Settings.shared.apiKey(for: p.storageKey)
        let m = Settings.shared.apiModel(for: p.storageKey)
        apiModelField.stringValue = (!p.defaultModel.isEmpty && m == p.defaultModel) ? "" : m
        baseURLField.stringValue = Settings.shared.apiCustomBaseURL
    }

    func controlTextDidChange(_ obj: Notification) {
        guard let field = obj.object as? NSTextField,
              let id = field.identifier?.rawValue else { return }
        let storageKey = Settings.shared.activeProvider.storageKey
        switch id {
        case "apiKey": Settings.shared.setAPIKey(field.stringValue, for: storageKey)
        case "apiModel": Settings.shared.setAPIModel(field.stringValue, for: storageKey)
        case "apiBaseURL": Settings.shared.apiCustomBaseURL = field.stringValue
        default: return
        }
        onChange?()
    }

    /// Custom-key provider picker: switch the active third-party provider, then rebuild so the
    /// key/model placeholders and the Base URL row (custom only) match.
    @objc private func providerPicked() {
        guard let id = providerPopup.selectedItem?.representedObject as? String else { return }
        Settings.shared.apiProvider = id
        populate()
        view.window?.makeFirstResponder(providerPopup)
        onChange?()
    }

    /// Open the active provider's API-key console in the browser.
    @objc private func openConsole() {
        guard let url = Settings.shared.activeProvider.consoleURL.flatMap(URL.init(string:)) else { return }
        NSWorkspace.shared.open(url)
    }

    @objc private func modePicked(_ sender: NSButton) {
        guard let mode = sender.identifier?.rawValue else { return }
        Settings.shared.serviceMode = mode
        // Rebuild so the per-channel fields (custom-key rows, or the CLI engine picker) appear/
        // disappear to match the chosen channel; populate() recreates the radios selected right.
        populate()
        if let selected = modeRadios.first(where: { $0.identifier?.rawValue == mode }) { view.window?.makeFirstResponder(selected) }
        onChange?()
    }

    /// CLI-mode engine picker: choose which local CLI (codex / claude) captures drive.
    @objc private func backendPicked() {
        guard let id = backendPopup.selectedItem?.representedObject as? String else { return }
        Settings.shared.cli = id
        onChange?()
    }

    @objc private func checkUpdates() { UpdateChecker.checkForUpdatesManually() }

    func pageDidShow() {
        rebuildIfCLISwitchChanged()
        reloadKeys()
        // Pull the authoritative account so a just-flipped server-side CLI switch shows up the
        // moment 高级 opens — without the user having to visit 账户与额度 first. A successful
        // refresh whose cli_enabled differs posts accountDidChange, and the observer above
        // rebuilds the page. Only meaningful for the official channel (needs a device token).
        if OfficialAPI.deviceToken != nil {
            Task { @MainActor in _ = await OfficialAPI.refreshAccount() }
        }
    }
}
