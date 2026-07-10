import AppKit
import ServiceManagement

// The unified settings window (统一设置): a sidebar of six pages replacing what used to be four
// scattered mini-windows plus an overstuffed gear menu. Native styling (system light/dark),
// fixed-frame layout in flipped containers, live-commit controls — the codebase's house style.
//
//   通用 General    — language, default depth, capture target, launch at login
//   快捷键 Hotkeys  — the three recordable combos (embedded HotkeySettingsViewController)
//   外观 Appearance — accent theme, answer text size, auto-collapse delay
//   账户 Account    — quota ring, top-up, lifetime usage, device id
//   人物像 Personas — the persona library (embedded PersonaManagerViewController)
//   高级 Advanced   — service channel, custom API keys, backend, updates

// MARK: - Window controller

final class MainSettingsWindowController: NSWindowController, NSWindowDelegate {
    enum Page: Int, CaseIterable {
        case general, hotkeys, appearance, account, personas, advanced

        var symbolName: String {
            switch self {
            case .general: return "gearshape"
            case .hotkeys: return "keyboard"
            case .appearance: return "paintpalette"
            case .account: return "creditcard"
            case .personas: return "person.text.rectangle"
            case .advanced: return "wrench.and.screwdriver"
            }
        }

        var localizedTitle: String {
            switch self {
            case .general: return L10n.t("通用", "一般", "General")
            case .hotkeys: return L10n.t("快捷键", "ショートカット", "Hotkeys")
            case .appearance: return L10n.t("外观", "外観", "Appearance")
            case .account: return L10n.t("账户与额度", "アカウントと残高", "Account")
            case .personas: return L10n.t("人物像", "人物像", "Personas")
            case .advanced: return L10n.t("高级", "詳細", "Advanced")
            }
        }
    }

    static let contentSize = NSSize(width: 830, height: 540)
    static let sidebarWidth: CGFloat = 190
    static var pageSize: NSSize { NSSize(width: contentSize.width - sidebarWidth, height: contentSize.height) }

    /// Wired by NotchController so hotkey edits re-register and menu labels refresh.
    var onHotkeysChanged: (() -> Void)?
    var onAnythingChanged: (() -> Void)?

    private let sidebar = SettingsFlippedView()
    private let contentHost = SettingsFlippedView()
    private var rowButtons: [SidebarRowButton] = []
    private var pageControllers: [Page: NSViewController] = [:]
    private var current: Page = .general
    private var observers: [NSObjectProtocol] = []

    init() {
        let window = NSWindow(
            contentRect: NSRect(origin: .zero, size: Self.contentSize),
            styleMask: [.titled, .closable, .miniaturizable, .fullSizeContentView],
            backing: .buffered, defer: false)
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.sharingType = ScreenShareGuard.windowSharingType
        window.isReleasedWhenClosed = false
        super.init(window: window)
        window.delegate = self
        buildChrome()
        show(page: .general)

        observers.append(NotificationCenter.default.addObserver(
            forName: L10n.languageDidChange, object: nil, queue: .main
        ) { [weak self] _ in self?.rebuildAfterLanguageChange() })
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

        sidebar.frame = effect.bounds
        sidebar.autoresizingMask = [.width, .height]
        effect.addSubview(sidebar)

        contentHost.frame = NSRect(x: Self.sidebarWidth, y: 0,
                                   width: Self.pageSize.width, height: Self.pageSize.height)
        contentHost.autoresizingMask = [.width, .height]
        root.addSubview(contentHost)

        buildSidebarRows()
    }

    private func buildSidebarRows() {
        rowButtons.forEach { $0.removeFromSuperview() }
        rowButtons = []
        var y: CGFloat = 52 // clear the (hidden-title) titlebar / traffic lights
        for page in Page.allCases {
            let row = SidebarRowButton(page: page) { [weak self] in self?.show(page: $0) }
            row.frame = NSRect(x: 10, y: y, width: Self.sidebarWidth - 20, height: 34)
            sidebar.addSubview(row)
            rowButtons.append(row)
            y += 38
        }
        highlightRows()
    }

    private func highlightRows() {
        for row in rowButtons { row.isChosen = row.page == current }
    }

    func show(page: Page) {
        current = page
        highlightRows()
        window?.title = page.localizedTitle

        contentHost.subviews.forEach { $0.removeFromSuperview() }
        let vc = pageControllers[page] ?? makeController(for: page)
        pageControllers[page] = vc
        vc.view.frame = contentHost.bounds
        contentHost.addSubview(vc.view)
        (vc as? SettingsPage)?.pageDidShow()
    }

    private func makeController(for page: Page) -> NSViewController {
        switch page {
        case .general: return GeneralPageController()
        case .hotkeys:
            let vc = HotkeysPageController()
            vc.onChange = { [weak self] in self?.onHotkeysChanged?() }
            return vc
        case .appearance: return AppearancePageController()
        case .account: return AccountPageController()
        case .personas: return PersonasPageController(onChange: { [weak self] in self?.onAnythingChanged?() })
        case .advanced:
            let vc = AdvancedPageController()
            vc.onChange = { [weak self] in self?.onAnythingChanged?() }
            return vc
        }
    }

    /// Language switch: throw away every built page (they hold baked-in strings) and rebuild.
    private func rebuildAfterLanguageChange() {
        pageControllers.removeAll()
        buildSidebarRows()
        show(page: current)
        onAnythingChanged?()
    }

    func open(page: Page) {
        show(page: page)
        window?.center()
        window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }
}

// MARK: - Sidebar row

private final class SidebarRowButton: NSControl {
    let page: MainSettingsWindowController.Page
    var isChosen = false { didSet { needsDisplay = true } }
    private let onPick: (MainSettingsWindowController.Page) -> Void
    private var hovering = false { didSet { needsDisplay = true } }
    private var trackingAreaRef: NSTrackingArea?

    init(page: MainSettingsWindowController.Page, onPick: @escaping (MainSettingsWindowController.Page) -> Void) {
        self.page = page
        self.onPick = onPick
        super.init(frame: .zero)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override var isFlipped: Bool { true }

    override func draw(_ dirtyRect: NSRect) {
        if isChosen || hovering {
            let path = NSBezierPath(roundedRect: bounds, xRadius: 8, yRadius: 8)
            (isChosen ? NotchPalette.accent.withAlphaComponent(0.22)
                      : NSColor.labelColor.withAlphaComponent(0.06)).setFill()
            path.fill()
        }
        let tint: NSColor = isChosen ? NotchPalette.accent : .secondaryLabelColor
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
        if bounds.contains(convert(event.locationInWindow, from: nil)) { onPick(page) }
    }
}

// MARK: - Page plumbing

final class SettingsFlippedView: NSView {
    override var isFlipped: Bool { true }
}

private protocol SettingsPage {
    func pageDidShow()
}

private func pageTitleLabel(_ text: String) -> NSTextField {
    let f = NSTextField(labelWithString: text)
    f.font = .systemFont(ofSize: 20, weight: .bold)
    f.textColor = .labelColor
    return f
}

private func captionLabel(_ text: String, size: CGFloat = 11) -> NSTextField {
    let f = NSTextField(wrappingLabelWithString: text)
    f.font = .systemFont(ofSize: size)
    f.textColor = .secondaryLabelColor
    f.isSelectable = false
    return f
}

private func rowLabel(_ text: String) -> NSTextField {
    let f = NSTextField(labelWithString: text)
    f.font = .systemFont(ofSize: 13)
    f.textColor = .labelColor
    return f
}

// MARK: - 通用 General

private final class GeneralPageController: NSViewController, SettingsPage {
    private let languagePopup = NSPopUpButton()
    private let depthPopup = NSPopUpButton()
    private let targetPopup = NSPopUpButton()
    private let loginCheckbox = NSButton(checkboxWithTitle: "", target: nil, action: nil)
    private let loginCaption = captionLabel("")

    private let contentWidth: CGFloat = 560

    override func loadView() {
        let root = SettingsFlippedView(frame: NSRect(origin: .zero, size: MainSettingsWindowController.pageSize))

        let title = pageTitleLabel(L10n.t("通用", "一般", "General"))
        title.frame = NSRect(x: 36, y: 46, width: 300, height: 26)
        root.addSubview(title)

        var y: CGFloat = 100

        // 语言
        addRow(root, y: y, label: L10n.t("语言", "言語", "Language"), control: languagePopup, controlWidth: 200)
        for lang in AppLanguage.allCases {
            languagePopup.addItem(withTitle: lang.pickerLabel)
            languagePopup.lastItem?.representedObject = lang.rawValue
        }
        languagePopup.selectItem(at: AppLanguage.allCases.firstIndex(of: L10n.setting) ?? 0)
        languagePopup.target = self
        languagePopup.action = #selector(languagePicked)
        y += 44

        // 讲解深度
        addRow(root, y: y, label: L10n.t("讲解深度", "解説の詳しさ", "Explanation depth"),
               control: depthPopup, controlWidth: 200)
        for id in Settings.depthCycle {
            depthPopup.addItem(withTitle: L10n.depthLabel(id))
            depthPopup.lastItem?.representedObject = id
        }
        depthPopup.selectItem(at: Settings.depthCycle.firstIndex(of: Settings.shared.depth) ?? 2)
        depthPopup.target = self
        depthPopup.action = #selector(depthPicked)
        let depthHint = captionLabel(L10n.t(
            "简略只给答案；提示不剧透；引导带你一步步走；完整包含全部推导。也可以在刘海上点击胶囊快速切换。",
            "「簡潔」は答えのみ、「ヒント」はネタバレなし、「ガイド」は一歩ずつ、「詳細」は全過程つき。ノッチのカプセルからも切替可能。",
            "Brief gives just the answer; Hints avoid spoilers; Guided walks you through; Full shows every step. You can also cycle via the capsule on the notch."))
        depthHint.frame = NSRect(x: 36 + 160, y: y + 30, width: contentWidth - 160, height: 42)
        root.addSubview(depthHint)
        y += 86

        // 截图目标
        addRow(root, y: y, label: L10n.t("截图目标", "キャプチャ対象", "Capture target"),
               control: targetPopup, controlWidth: 260)
        targetPopup.target = self
        targetPopup.action = #selector(targetPicked)
        y += 44

        // 开机自启
        loginCheckbox.title = L10n.t("登录时自动启动", "ログイン時に自動起動", "Launch at login")
        loginCheckbox.target = self
        loginCheckbox.action = #selector(loginToggled)
        loginCheckbox.frame = NSRect(x: 36 + 160, y: y, width: 300, height: 20)
        root.addSubview(loginCheckbox)
        loginCaption.frame = NSRect(x: 36 + 160, y: y + 24, width: contentWidth - 160, height: 30)
        root.addSubview(loginCaption)

        view = root
    }

    private func addRow(_ root: NSView, y: CGFloat, label: String, control: NSControl, controlWidth: CGFloat) {
        let l = rowLabel(label)
        l.alignment = .right
        l.frame = NSRect(x: 36, y: y + 3, width: 148, height: 18)
        root.addSubview(l)
        control.frame = NSRect(x: 36 + 160, y: y, width: controlWidth, height: 26)
        root.addSubview(control)
    }

    func pageDidShow() {
        reloadTargets()
        reloadLoginState()
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

    @objc private func depthPicked() {
        guard let id = depthPopup.selectedItem?.representedObject as? String else { return }
        Settings.shared.depth = id
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
}

// MARK: - 快捷键 Hotkeys (embeds the recorder rows)

private final class HotkeysPageController: NSViewController, SettingsPage {
    var onChange: (() -> Void)?
    private let embedded = HotkeySettingsViewController()

    override func loadView() {
        let root = SettingsFlippedView(frame: NSRect(origin: .zero, size: MainSettingsWindowController.pageSize))

        let title = pageTitleLabel(L10n.t("快捷键", "ショートカット", "Hotkeys"))
        title.frame = NSRect(x: 36, y: 46, width: 300, height: 26)
        root.addSubview(title)

        embedded.onChange = { [weak self] in self?.onChange?() }
        addChild(embedded)
        embedded.view.frame = NSRect(x: 36, y: 92, width: 420, height: 190)
        root.addSubview(embedded.view)

        view = root
    }

    func pageDidShow() {}
}

// MARK: - 外观 Appearance

private final class AppearancePageController: NSViewController, SettingsPage {
    private var swatches: [AccentSwatch] = []
    private let sizeControl = NSSegmentedControl()
    private let delayPopup = NSPopUpButton()

    override func loadView() {
        let root = SettingsFlippedView(frame: NSRect(origin: .zero, size: MainSettingsWindowController.pageSize))

        let title = pageTitleLabel(L10n.t("外观", "外観", "Appearance"))
        title.frame = NSRect(x: 36, y: 46, width: 300, height: 26)
        root.addSubview(title)

        var y: CGFloat = 100

        // 强调色 swatches
        let accentLabel = rowLabel(L10n.t("强调色", "アクセントカラー", "Accent color"))
        accentLabel.alignment = .right
        accentLabel.frame = NSRect(x: 36, y: y + 12, width: 148, height: 18)
        root.addSubview(accentLabel)
        var x: CGFloat = 36 + 160
        for theme in AccentTheme.all {
            let swatch = AccentSwatch(theme: theme) { [weak self] picked in
                Appearance.setTheme(picked.id)
                self?.refreshSwatches()
            }
            swatch.frame = NSRect(x: x, y: y, width: 56, height: 56)
            root.addSubview(swatch)
            swatches.append(swatch)
            x += 64
        }
        let accentHint = captionLabel(L10n.t("Rose 指示器、刘海边缘的光、按钮都会跟随这个颜色。",
                                             "Rose インジケーター、ノッチの光、ボタンがこの色に染まります。",
                                             "The Rose, the notch's edge light, and every button follow this color."))
        accentHint.frame = NSRect(x: 36 + 160, y: y + 62, width: 380, height: 32)
        root.addSubview(accentHint)
        y += 112

        // 答案字号
        let sizeLabel = rowLabel(L10n.t("答案字号", "回答の文字サイズ", "Answer text size"))
        sizeLabel.alignment = .right
        sizeLabel.frame = NSRect(x: 36, y: y + 4, width: 148, height: 18)
        root.addSubview(sizeLabel)
        sizeControl.segmentCount = Appearance.answerSizeIDs.count
        for (i, id) in Appearance.answerSizeIDs.enumerated() {
            sizeControl.setLabel(Appearance.answerSizeLabel(id), forSegment: i)
            sizeControl.setWidth(70, forSegment: i)
        }
        sizeControl.selectedSegment = Appearance.answerSizeIDs.firstIndex(of: Appearance.answerSizeID) ?? 1
        sizeControl.target = self
        sizeControl.action = #selector(sizePicked)
        sizeControl.frame = NSRect(x: 36 + 160, y: y, width: 220, height: 26)
        root.addSubview(sizeControl)
        y += 48

        // 收起时长
        let delayLabel = rowLabel(L10n.t("答完后", "回答後", "After answering"))
        delayLabel.alignment = .right
        delayLabel.frame = NSRect(x: 36, y: y + 4, width: 148, height: 18)
        root.addSubview(delayLabel)
        for v in Appearance.collapseDelayChoices {
            delayPopup.addItem(withTitle: Appearance.collapseDelayLabel(v))
            delayPopup.lastItem?.representedObject = v
        }
        if let idx = Appearance.collapseDelayChoices.firstIndex(of: Appearance.collapseDelay) {
            delayPopup.selectItem(at: idx)
        }
        delayPopup.target = self
        delayPopup.action = #selector(delayPicked)
        delayPopup.frame = NSRect(x: 36 + 160, y: y, width: 260, height: 26)
        root.addSubview(delayPopup)
        y += 56

        let liveHint = captionLabel(L10n.t("所有更改即时生效 — 抬头看看刘海。",
                                           "変更はすぐ反映されます — ノッチを見てみて。",
                                           "Everything applies instantly — glance up at the notch."))
        liveHint.frame = NSRect(x: 36 + 160, y: y, width: 380, height: 20)
        root.addSubview(liveHint)

        view = root
        refreshSwatches()
    }

    private func refreshSwatches() {
        for s in swatches { s.isChosen = s.theme.id == Appearance.theme.id }
    }

    @objc private func sizePicked() {
        let idx = max(0, min(sizeControl.selectedSegment, Appearance.answerSizeIDs.count - 1))
        Appearance.answerSizeID = Appearance.answerSizeIDs[idx]
    }

    @objc private func delayPicked() {
        if let v = delayPopup.selectedItem?.representedObject as? TimeInterval {
            Appearance.collapseDelay = v
        }
    }

    func pageDidShow() { refreshSwatches() }
}

/// One accent color dot with its name beneath; a ring marks the chosen one.
private final class AccentSwatch: NSControl {
    let theme: AccentTheme
    var isChosen = false { didSet { needsDisplay = true } }
    private let onPick: (AccentTheme) -> Void
    private var hovering = false { didSet { needsDisplay = true } }
    private var trackingAreaRef: NSTrackingArea?

    init(theme: AccentTheme, onPick: @escaping (AccentTheme) -> Void) {
        self.theme = theme
        self.onPick = onPick
        super.init(frame: .zero)
        toolTip = theme.localizedName
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override var isFlipped: Bool { true }

    override func draw(_ dirtyRect: NSRect) {
        let dotRect = NSRect(x: bounds.midX - 14, y: 2, width: 28, height: 28)
        if isChosen || hovering {
            let ring = NSBezierPath(ovalIn: dotRect.insetBy(dx: -4, dy: -4))
            ring.lineWidth = 2
            (isChosen ? theme.accent : NSColor.tertiaryLabelColor).setStroke()
            ring.stroke()
        }
        NSGradient(starting: theme.accentHi, ending: theme.accent)?
            .draw(in: NSBezierPath(ovalIn: dotRect), angle: -90)

        let attrs: [NSAttributedString.Key: Any] = [
            .font: NSFont.systemFont(ofSize: 10),
            .foregroundColor: isChosen ? NSColor.labelColor : NSColor.secondaryLabelColor,
        ]
        let name = theme.localizedName as NSString
        let ts = name.size(withAttributes: attrs)
        name.draw(at: NSPoint(x: bounds.midX - ts.width / 2, y: 40), withAttributes: attrs)
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
        if bounds.contains(convert(event.locationInWindow, from: nil)) { onPick(theme) }
    }
}

// MARK: - 账户 Account

private final class AccountPageController: NSViewController, SettingsPage {
    private let ring = QuotaRingView()
    private let usageLabel = captionLabel("", size: 12)
    private let tokensLabel = captionLabel("")
    private let deviceLabel = captionLabel("")
    private let statusLabel = captionLabel("", size: 12)
    private let topUpButton = NSButton()
    private let refreshButton = NSButton()
    private let claimButton = NSButton()
    private var observer: NSObjectProtocol?

    override func loadView() {
        let root = SettingsFlippedView(frame: NSRect(origin: .zero, size: MainSettingsWindowController.pageSize))

        let title = pageTitleLabel(L10n.t("账户与额度", "アカウントと残高", "Account"))
        title.frame = NSRect(x: 36, y: 46, width: 300, height: 26)
        root.addSubview(title)

        ring.frame = NSRect(x: 60, y: 104, width: 170, height: 170)
        root.addSubview(ring)

        var y: CGFloat = 116
        usageLabel.frame = NSRect(x: 270, y: y, width: 320, height: 20)
        root.addSubview(usageLabel)
        y += 26
        tokensLabel.frame = NSRect(x: 270, y: y, width: 320, height: 18)
        root.addSubview(tokensLabel)
        y += 30

        topUpButton.title = L10n.topUp
        topUpButton.bezelStyle = .rounded
        topUpButton.keyEquivalent = "\r"
        topUpButton.target = self
        topUpButton.action = #selector(topUpTapped)
        topUpButton.frame = NSRect(x: 268, y: y, width: 110, height: 30)
        root.addSubview(topUpButton)

        refreshButton.title = L10n.refresh
        refreshButton.bezelStyle = .rounded
        refreshButton.target = self
        refreshButton.action = #selector(refreshTapped)
        refreshButton.frame = NSRect(x: 384, y: y, width: 84, height: 30)
        root.addSubview(refreshButton)
        y += 40

        claimButton.title = L10n.t("领取 180 题免费额度", "180問の無料枠を受け取る", "Claim 180 free questions")
        claimButton.bezelStyle = .rounded
        claimButton.target = self
        claimButton.action = #selector(claimTapped)
        claimButton.frame = NSRect(x: 268, y: y, width: 220, height: 30)
        root.addSubview(claimButton)

        statusLabel.frame = NSRect(x: 270, y: y + 40, width: 320, height: 40)
        root.addSubview(statusLabel)

        deviceLabel.frame = NSRect(x: 36, y: 300, width: 560, height: 18)
        root.addSubview(deviceLabel)

        let note = captionLabel(L10n.t(
            "每成功答一题消耗 1 题；出错不扣。额度与本机绑定，无需注册账号。",
            "回答が成功するたびに1問消費。エラー時は消費されません。残高はこのMacに紐づき、アカウント登録は不要です。",
            "Each successful answer costs one question; errors are free. Credits are tied to this Mac — no account needed."))
        note.frame = NSRect(x: 36, y: 330, width: 560, height: 36)
        root.addSubview(note)

        view = root
        reload()

        observer = NotificationCenter.default.addObserver(
            forName: OfficialAPI.accountDidChange, object: nil, queue: .main
        ) { [weak self] _ in self?.reload() }
    }

    deinit {
        if let observer { NotificationCenter.default.removeObserver(observer) }
    }

    func pageDidShow() {
        reload()
        if OfficialAPI.deviceToken != nil { refreshTapped() }
    }

    private func reload() {
        let registered = OfficialAPI.deviceToken != nil
        // A cached balance without a live token is stale (e.g. the token was invalidated) —
        // show the unclaimed state, not a number nobody can spend.
        let balance = registered ? OfficialAPI.balanceQuestions : nil
        ring.setBalance(balance, animated: true)
        usageLabel.stringValue = L10n.t("累计已答 \(OfficialAPI.totalQuestions) 题",
                                        "これまでに\(OfficialAPI.totalQuestions)問回答",
                                        "\(OfficialAPI.totalQuestions) questions answered so far")
        let tk = OfficialAPI.totalInputTokens + OfficialAPI.totalOutputTokens
        tokensLabel.stringValue = tk > 0 ? "· \(tk) tokens" : ""
        deviceLabel.stringValue = registered
            ? L10n.t("设备 ID：", "デバイスID：", "Device ID: ") + OfficialAPI.truncatedToken(OfficialAPI.deviceToken ?? "")
            : L10n.t("尚未领取免费额度。", "まだ無料枠を受け取っていません。", "Free questions not claimed yet.")
        claimButton.isHidden = registered
        topUpButton.isEnabled = registered
        refreshButton.isEnabled = registered
    }

    @objc private func topUpTapped() {
        guard let url = OfficialAPI.topUpURL(
            baseURL: OfficialAPI.baseURL, deviceToken: OfficialAPI.deviceToken,
            lang: OfficialAPI.topUpLang) else { return }
        NSWorkspace.shared.open(url)
        statusLabel.stringValue = L10n.t("已在浏览器打开充值页面，完成后点「刷新」。",
                                         "ブラウザでチャージページを開きました。完了後「更新」を押してください。",
                                         "Top-up page opened in your browser — hit Refresh when done.")
    }

    @objc private func refreshTapped() {
        statusLabel.stringValue = L10n.t("正在同步…", "同期中…", "Syncing…")
        Task { @MainActor in
            switch await OfficialAPI.refreshAccount() {
            case .success:
                self.statusLabel.stringValue = ""
            case .failure(let error):
                self.statusLabel.stringValue = error.message
            }
            self.reload()
        }
    }

    @objc private func claimTapped() {
        claimButton.isEnabled = false
        statusLabel.stringValue = L10n.t("正在领取…", "受け取り中…", "Claiming…")
        Task { @MainActor in
            switch await OfficialAPI.registerIfNeeded() {
            case .success:
                self.statusLabel.stringValue = L10n.t("已到账 🎉", "受け取りました 🎉", "Arrived 🎉")
            case .failure(let error):
                self.statusLabel.stringValue = error.message
                self.claimButton.isEnabled = true
            }
            self.reload()
        }
    }
}

/// The quota at a glance: an animated gradient arc (proportion of the 180-question grant, capped
/// at full) around the live number. Amber when running low, so "time to top up" is felt before
/// it's read.
final class QuotaRingView: NSView {
    private var displayed: CGFloat = 0 // 0…1 arc fraction currently drawn
    private var balance: Int?
    private var tween: DisplayTween?

    func setBalance(_ newBalance: Int?, animated: Bool) {
        balance = newBalance
        let target = CGFloat(min(1, max(0, Double(newBalance ?? 0) / 180.0)))
        if tween == nil { tween = DisplayTween(host: self, value: 0) }
        tween?.onChange = { [weak self] v in
            self?.displayed = v
            self?.needsDisplay = true
        }
        if animated && !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion {
            tween?.animate(to: target, duration: 0.8)
        } else {
            tween?.set(target)
        }
    }

    override func draw(_ dirtyRect: NSRect) {
        guard let ctx = NSGraphicsContext.current?.cgContext else { return }
        let low = (balance ?? Int.max) <= OfficialAPI.lowQuotaThreshold
        let accent = low ? AccentTheme.amber.accent : NotchPalette.accent
        let accentHi = low ? AccentTheme.amber.accentHi : NotchPalette.accentHi

        let center = CGPoint(x: bounds.midX, y: bounds.midY)
        let radius = min(bounds.width, bounds.height) / 2 - 10
        let lineWidth: CGFloat = 12

        // Track.
        ctx.setStrokeColor(NSColor.labelColor.withAlphaComponent(0.10).cgColor)
        ctx.setLineWidth(lineWidth)
        ctx.setLineCap(.round)
        ctx.addArc(center: center, radius: radius, startAngle: 0, endAngle: 2 * .pi, clockwise: false)
        ctx.strokePath()

        // Progress arc, top-anchored, clockwise; gradient along the sweep approximated by
        // stroking in short segments.
        if displayed > 0.004 {
            let start = CGFloat.pi / 2
            let sweep = displayed * 2 * .pi
            let steps = max(2, Int(60 * displayed))
            for i in 0..<steps {
                let f0 = CGFloat(i) / CGFloat(steps)
                let f1 = CGFloat(i + 1) / CGFloat(steps) + 0.004
                let t = f0
                let c0 = accent.usingColorSpace(.sRGB) ?? accent
                let c1 = accentHi.usingColorSpace(.sRGB) ?? accentHi
                let mix = NSColor(
                    srgbRed: c0.redComponent + (c1.redComponent - c0.redComponent) * t,
                    green: c0.greenComponent + (c1.greenComponent - c0.greenComponent) * t,
                    blue: c0.blueComponent + (c1.blueComponent - c0.blueComponent) * t,
                    alpha: 1)
                ctx.setStrokeColor(mix.cgColor)
                ctx.setLineWidth(lineWidth)
                ctx.setLineCap(.round)
                ctx.addArc(center: center, radius: radius,
                           startAngle: start - sweep * f0, endAngle: start - sweep * f1, clockwise: true)
                ctx.strokePath()
            }
        }

        // Number + unit in the middle. The number itself goes amber when the quota is low —
        // at zero there is no arc left to carry the warning color.
        let numberText = balance.map(String.init) ?? "—"
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
        title.frame = NSRect(x: 36, y: 46, width: 300, height: 26)
        root.addSubview(title)
        let hint = captionLabel(L10n.t("性格测试作答时，答案会尽量贴合当前选中的人物像。",
                                       "性格検査の回答は、選択中の人物像に沿うように選ばれます。",
                                       "Personality-test answers lean toward the selected persona."))
        hint.frame = NSRect(x: 36, y: 74, width: 560, height: 18)
        root.addSubview(hint)
        embedded.onChange = { [weak self] in self?.onChange() }
        addChild(embedded)
        embedded.view.frame = NSRect(x: 0, y: 96, width: 640, height: 440)
        root.addSubview(embedded.view)
        view = root
    }

    func pageDidShow() { embedded.reloadFromStore() }
}

// MARK: - 高级 Advanced

private final class AdvancedPageController: NSViewController, SettingsPage, NSTextFieldDelegate {
    var onChange: (() -> Void)?

    private var modeRadios: [NSButton] = []
    private let backendPopup = NSPopUpButton()
    private let claudeKeyField = NSSecureTextField()
    private let openaiKeyField = NSSecureTextField()
    private let claudeModelField = NSTextField()
    private let openaiModelField = NSTextField()
    private let versionLabel = captionLabel("")

    override func loadView() {
        let root = SettingsFlippedView(frame: NSRect(origin: .zero, size: MainSettingsWindowController.pageSize))

        let title = pageTitleLabel(L10n.t("高级", "詳細", "Advanced"))
        title.frame = NSRect(x: 36, y: 46, width: 300, height: 26)
        root.addSubview(title)

        var y: CGFloat = 92

        // 答题通道 (service channel)
        let channelLabel = rowLabel(L10n.t("答题通道", "回答チャネル", "Answering channel"))
        channelLabel.frame = NSRect(x: 36, y: y, width: 200, height: 18)
        root.addSubview(channelLabel)
        y += 26

        let descs: [String: String] = [
            ServiceMode.official: L10n.t("默认。开箱即用，按题数额度计费。", "デフォルト。設定不要、質問数制。", "Default. Zero setup, question-quota billing."),
            ServiceMode.customKey: L10n.t("用你自己的 Anthropic / OpenAI API Key 直连，费用走你的账户。", "自分の Anthropic / OpenAI API キーで直接接続。", "Use your own Anthropic / OpenAI API key; costs go to your account."),
            ServiceMode.cli: L10n.t("驱动本机已登录的 codex / claude 命令行。", "ローカルの codex / claude CLI を利用。", "Drive the locally installed codex / claude CLIs."),
        ]
        for mode in ServiceMode.all {
            let radio = NSButton(radioButtonWithTitle: L10n.serviceModeLabel(mode), target: self,
                                 action: #selector(modePicked(_:)))
            radio.frame = NSRect(x: 40, y: y, width: 220, height: 18)
            radio.identifier = NSUserInterfaceItemIdentifier(mode)
            radio.state = Settings.shared.serviceMode == mode ? .on : .off
            root.addSubview(radio)
            modeRadios.append(radio)
            let d = captionLabel(descs[mode] ?? "")
            d.frame = NSRect(x: 262, y: y + 1, width: 330, height: 30)
            root.addSubview(d)
            y += 30
        }
        y += 8

        // 后端 (only meaningful for customKey / cli)
        let backendLabel = rowLabel(L10n.t("引擎", "エンジン", "Engine"))
        backendLabel.frame = NSRect(x: 40, y: y + 4, width: 100, height: 18)
        root.addSubview(backendLabel)
        for (id, label) in [("codex", "Codex"), ("claude", "Claude")] {
            backendPopup.addItem(withTitle: label)
            backendPopup.lastItem?.representedObject = id
        }
        backendPopup.selectItem(at: Settings.shared.cli == "claude" ? 1 : 0)
        backendPopup.target = self
        backendPopup.action = #selector(backendPicked)
        backendPopup.frame = NSRect(x: 150, y: y, width: 140, height: 26)
        root.addSubview(backendPopup)
        y += 42

        // API keys (compact, live-commit, Keychain-backed)
        y = addKeySection(root, y: y, header: "Claude · Anthropic API Key",
                          keyField: claudeKeyField, modelField: claudeModelField,
                          cliId: "claude", placeholder: "sk-ant-…")
        y = addKeySection(root, y: y, header: "Codex · OpenAI API Key",
                          keyField: openaiKeyField, modelField: openaiModelField,
                          cliId: "codex", placeholder: "sk-…")

        let keyHint = captionLabel(L10n.t("Key 只保存在本机钥匙串。填写后该引擎自动直连官方 API；留空则回退到 CLI。",
                                          "キーはこのMacのキーチェーンにのみ保存。入力するとAPIに直接接続、空欄ならCLIへフォールバック。",
                                          "Keys live only in your local Keychain. Filled → direct API; empty → CLI fallback."))
        keyHint.frame = NSRect(x: 40, y: y, width: 552, height: 30)
        root.addSubview(keyHint)
        y += 40

        // Updates + version
        let updateButton = NSButton(title: L10n.t("检查更新…", "アップデートを確認…", "Check for Updates…"),
                                    target: self, action: #selector(checkUpdates))
        updateButton.bezelStyle = .rounded
        updateButton.frame = NSRect(x: 36, y: y, width: 170, height: 30)
        root.addSubview(updateButton)
        versionLabel.stringValue = "NotchSPI \(UpdateChecker.currentVersion)"
        versionLabel.frame = NSRect(x: 216, y: y + 7, width: 200, height: 16)
        root.addSubview(versionLabel)

        view = root
        reloadKeys()
    }

    private func addKeySection(_ root: NSView, y: CGFloat, header: String,
                               keyField: NSSecureTextField, modelField: NSTextField,
                               cliId: String, placeholder: String) -> CGFloat {
        var y = y
        let h = rowLabel(header)
        h.font = .systemFont(ofSize: 12, weight: .semibold)
        h.frame = NSRect(x: 40, y: y, width: 300, height: 16)
        root.addSubview(h)
        y += 20
        keyField.placeholderString = placeholder
        keyField.font = .monospacedSystemFont(ofSize: 11.5, weight: .regular)
        keyField.frame = NSRect(x: 40, y: y, width: 340, height: 24)
        keyField.delegate = self
        keyField.identifier = NSUserInterfaceItemIdentifier("key.\(cliId)")
        root.addSubview(keyField)
        modelField.placeholderString = Settings.defaultAPIModels[cliId]
        modelField.font = .monospacedSystemFont(ofSize: 11.5, weight: .regular)
        modelField.frame = NSRect(x: 388, y: y, width: 204, height: 24)
        modelField.delegate = self
        modelField.identifier = NSUserInterfaceItemIdentifier("model.\(cliId)")
        modelField.toolTip = L10n.t("模型（留空用默认）", "モデル（空欄でデフォルト）", "Model (empty = default)")
        root.addSubview(modelField)
        return y + 34
    }

    private func reloadKeys() {
        claudeKeyField.stringValue = Settings.shared.apiKey(for: "claude")
        openaiKeyField.stringValue = Settings.shared.apiKey(for: "codex")
        let cm = Settings.shared.apiModel(for: "claude")
        claudeModelField.stringValue = cm == Settings.defaultAPIModels["claude"] ? "" : cm
        let om = Settings.shared.apiModel(for: "codex")
        openaiModelField.stringValue = om == Settings.defaultAPIModels["codex"] ? "" : om
    }

    func controlTextDidChange(_ obj: Notification) {
        guard let field = obj.object as? NSTextField,
              let id = field.identifier?.rawValue else { return }
        switch id {
        case "key.claude": Settings.shared.setAPIKey(field.stringValue, for: "claude")
        case "key.codex": Settings.shared.setAPIKey(field.stringValue, for: "codex")
        case "model.claude": Settings.shared.setAPIModel(field.stringValue, for: "claude")
        case "model.codex": Settings.shared.setAPIModel(field.stringValue, for: "codex")
        default: return
        }
        onChange?()
    }

    @objc private func modePicked(_ sender: NSButton) {
        guard let mode = sender.identifier?.rawValue else { return }
        Settings.shared.serviceMode = mode
        for r in modeRadios { r.state = r === sender ? .on : .off }
        onChange?()
    }

    @objc private func backendPicked() {
        guard let id = backendPopup.selectedItem?.representedObject as? String else { return }
        Settings.shared.cli = id
        onChange?()
    }

    @objc private func checkUpdates() { UpdateChecker.checkForUpdatesManually() }

    func pageDidShow() { reloadKeys() }
}
