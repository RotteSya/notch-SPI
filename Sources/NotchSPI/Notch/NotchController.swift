import AppKit
import Carbon.HIToolbox

final class NotchController: NSObject {
    let model = TutorModel()
    private let panel: NotchPanel
    private var hovering = false
    private var pinned = false
    private var running = false
    private var visible = true
    private var collapseWork: DispatchWorkItem?
    private var settingsController: MainSettingsWindowController?
    private var onboardingWindow: NSWindow?
    private var observers: [NSObjectProtocol] = []

    private let expandedWidth: CGFloat = 600

    override init() {
        panel = NotchPanel(contentRect: .zero)
        super.init()
        refreshCLILabel()
        model.statusText = L10n.statusReady
        model.depthLabel = L10n.depthLabel(Settings.shared.depth)

        let view = NotchView(
            model: model,
            onHover: { [weak self] in self?.hover($0) },
            onCycleDepth: { [weak self] in self?.cycleDepth() },
            onEditPersona: { [weak self] in self?.openSettings(page: .personas) },
            onSettings: { [weak self] in self?.showSettings() }
        )
        view.autoresizingMask = [.width, .height]
        panel.contentView = view
        panel.setFrame(frame(expanded: false), display: true)

        refreshModeLabels()
        registerHotkeys()

        // Language / theme switches re-render the always-visible notch immediately.
        observers.append(NotificationCenter.default.addObserver(
            forName: L10n.languageDidChange, object: nil, queue: .main
        ) { [weak self] _ in self?.refreshAfterLanguageChange() })
        observers.append(NotificationCenter.default.addObserver(
            forName: Appearance.themeDidChange, object: nil, queue: .main
        ) { [weak self] _ in self?.refreshAppearance() })
    }

    deinit { observers.forEach(NotificationCenter.default.removeObserver) }

    /// The channel the NEXT capture will use, resolved from the current settings.
    private func currentChannel() -> ServiceChannel {
        ServiceRouting.resolve(
            mode: Settings.shared.serviceMode,
            customKey: Settings.shared.apiKey(for: Settings.shared.cli)
        )
    }

    /// Reflect the active channel (官方服务 / 自定义 Key / CLI) in the notch header.
    private func refreshCLILabel() {
        model.cliLabel = ServiceRouting.headerLabel(channel: currentChannel(), backend: Settings.shared.cli)
    }

    private func refreshAfterLanguageChange() {
        refreshCLILabel()
        refreshModeLabels()
        model.depthLabel = L10n.depthLabel(Settings.shared.depth)
        if !running { model.statusText = L10n.statusReady }
    }

    private func refreshAppearance() {
        model.depthLabel = L10n.depthLabel(Settings.shared.depth) // depth may change from settings too
        panel.contentView?.needsDisplay = true
        panel.contentView?.subviews.forEach { $0.needsDisplay = true }
        // Poke the model so NotchView re-reads fonts/colors for the answer text.
        model.objectWillChange.send()
    }

    // MARK: - Onboarding (first launch only)

    /// Present the first-launch onboarding. `bootstrapFirstRunState()` (run at the very top of
    /// launch, before PersonaStore's migration can write keys) already marked existing installs
    /// as done — so reaching here with `onboardingDone == false` means a genuinely fresh install.
    func showOnboardingIfNeeded() {
        Settings.shared.bootstrapFirstRunState() // defensive; no-op after AppDelegate ran it
        var forceForQA = false
        #if DEBUG
        // Visual-QA hook: `--qa-onboarding` shows the flow regardless of onboardingDone (pair
        // with NSPI_QA_EPHEMERAL=1 so no real account state is touched).
        forceForQA = ProcessInfo.processInfo.arguments.contains("--qa-onboarding")
        #endif
        guard !Settings.shared.onboardingDone || forceForQA else { return }
        let vc = OnboardingViewController()
        vc.onFinished = { [weak self] in
            self?.refreshCLILabel()
            self?.onboardingWindow = nil // one-shot window; don't keep it retained for the app's lifetime
        }
        let w = OnboardingWindow(contentViewController: vc)
        w.center()
        onboardingWindow = w
        w.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    /// Push the active mode + persona name into the model so the notch header reflects them.
    /// Reads the active persona from `PersonaStore` (which also keeps `Settings` mirrored for the
    /// capture pipeline). Touching the store here on launch performs the one-time legacy migration.
    private func refreshModeLabels() {
        let m = Settings.shared.mode
        model.mode = m
        model.modeLabel = L10n.modeLabel(m)
        model.personaLabel = PersonaStore.shared.active?.name.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    }

    func show() { panel.orderFrontRegardless() }

    private func registerHotkeys() {
        HotKeyCenter.shared.unregisterAll()
        let cap = Settings.shared.captureCombo
        let persona = Settings.shared.personalityCombo
        let tog = Settings.shared.toggleCombo
        HotKeyCenter.shared.register(keyCode: cap.keyCode, modifiers: cap.modifiers) { [weak self] in
            self?.runTapped(mode: "tutor")
        }
        HotKeyCenter.shared.register(keyCode: persona.keyCode, modifiers: persona.modifiers) { [weak self] in
            self?.runTapped(mode: "personality")
        }
        HotKeyCenter.shared.register(keyCode: tog.keyCode, modifiers: tog.modifiers) { [weak self] in
            self?.toggleVisibility()
        }
    }

    private func toggleVisibility() {
        visible.toggle()
        if visible { panel.orderFrontRegardless() } else { panel.orderOut(nil) }
    }

    private func cycleDepth() {
        let cur = Settings.shared.depth
        let idx = Settings.depthCycle.firstIndex(of: cur) ?? 1
        let next = Settings.depthCycle[(idx + 1) % Settings.depthCycle.count]
        Settings.shared.depth = next
        model.depthLabel = L10n.depthLabel(next)
    }

    // MARK: - Gear menu (quick actions only — everything else lives in 设置)

    private func showSettings() {
        buildQuickMenu().popUp(positioning: nil, at: NSEvent.mouseLocation, in: nil)
    }

    private func buildQuickMenu() -> NSMenu {
        let menu = NSMenu()

        // Quota at a glance + one-tap top-up (official channel only).
        if Settings.shared.serviceMode == ServiceMode.official {
            let balanceTitle = OfficialAPI.balanceQuestions.map { L10n.questionsLeft($0) } ?? L10n.quotaUnknown
            let balance = NSMenuItem(title: balanceTitle, action: #selector(openAccount), keyEquivalent: "")
            balance.target = self
            if let img = NSImage(systemSymbolName: "circle.dotted.circle", accessibilityDescription: nil) {
                balance.image = img
            }
            menu.addItem(balance)
            let topUp = NSMenuItem(title: L10n.topUp, action: #selector(topUpTapped), keyEquivalent: "")
            topUp.target = self
            menu.addItem(topUp)
            menu.addItem(.separator())
        }

        // Depth only applies to tutor mode; hide it in personality mode.
        if Settings.shared.mode != "personality" {
            let depthHeader = NSMenuItem(title: L10n.t("讲解深度", "解説の詳しさ", "Explanation Depth"),
                                         action: nil, keyEquivalent: "")
            depthHeader.isEnabled = false
            menu.addItem(depthHeader)
            for id in Settings.depthCycle {
                let item = NSMenuItem(title: L10n.depthLabel(id), action: #selector(pickDepth(_:)), keyEquivalent: "")
                item.target = self
                item.representedObject = id
                item.state = (Settings.shared.depth == id) ? .on : .off
                menu.addItem(item)
            }
            menu.addItem(.separator())
        }

        let savedID = Settings.shared.captureTargetBundleID
        let savedName = Settings.shared.captureTargetName ?? savedID ?? ""
        let targetItem = NSMenuItem(
            title: L10n.t("截图目标：", "キャプチャ対象：", "Capture target: ")
                + (savedID == nil ? L10n.t("整个屏幕", "画面全体", "Entire screen") : savedName),
            action: nil, keyEquivalent: ""
        )
        // Submenu fills lazily in menuNeedsUpdate when it opens, keeping window
        // enumeration off the popUp path entirely.
        let targetMenu = NSMenu()
        targetMenu.delegate = self
        targetItem.submenu = targetMenu
        menu.addItem(targetItem)

        // Persona quick-switch (only when personas exist).
        let personas = PersonaStore.shared.all
        if !personas.isEmpty {
            let switchItem = NSMenuItem(title: L10n.t("切换人物像", "人物像を切替", "Switch Persona"),
                                        action: nil, keyEquivalent: "")
            let sub = NSMenu()
            for p in personas {
                let it = NSMenuItem(
                    title: p.name.isEmpty ? L10n.t("未命名人物像", "無題の人物像", "Untitled persona") : p.name,
                    action: #selector(pickPersona(_:)), keyEquivalent: "")
                it.target = self
                it.representedObject = p.id
                it.state = (PersonaStore.shared.activeID == p.id) ? .on : .off
                sub.addItem(it)
            }
            switchItem.submenu = sub
            menu.addItem(switchItem)
        }

        menu.addItem(.separator())

        let settings = NSMenuItem(title: L10n.openSettings, action: #selector(openSettingsGeneral), keyEquivalent: ",")
        settings.target = self
        menu.addItem(settings)

        let quit = NSMenuItem(title: L10n.quitApp, action: #selector(quitApp), keyEquivalent: "")
        quit.target = self
        menu.addItem(quit)

        return menu
    }

    @objc private func pickTarget(_ sender: NSMenuItem) {
        if let app = sender.representedObject as? ScreenCapture.AppInfo {
            Settings.shared.captureTargetBundleID = app.bundleID
            Settings.shared.captureTargetName = app.name
        } else {
            Settings.shared.captureTargetBundleID = nil
            Settings.shared.captureTargetName = nil
        }
    }

    @objc private func pickDepth(_ sender: NSMenuItem) {
        guard let id = sender.representedObject as? String else { return }
        Settings.shared.depth = id
        model.depthLabel = L10n.depthLabel(id)
    }

    @objc private func pickPersona(_ sender: NSMenuItem) {
        guard let id = sender.representedObject as? String else { return }
        PersonaStore.shared.setActive(id)
        refreshModeLabels()
    }

    @objc private func openAccount() { openSettings(page: .account) }
    @objc private func openSettingsGeneral() { openSettings(page: .general) }

    @objc private func topUpTapped() {
        guard let url = OfficialAPI.topUpURL(
            baseURL: OfficialAPI.baseURL, deviceToken: OfficialAPI.deviceToken,
            lang: OfficialAPI.topUpLang) else { return }
        NSWorkspace.shared.open(url)
    }

    @objc private func quitApp() {
        NSApp.terminate(nil)
    }

    // MARK: - Settings window

    func openSettings(page: MainSettingsWindowController.Page) {
        if settingsController == nil {
            let c = MainSettingsWindowController()
            c.onHotkeysChanged = { [weak self] in self?.registerHotkeys() }
            c.onAnythingChanged = { [weak self] in
                self?.refreshCLILabel()
                self?.refreshModeLabels()
                self?.model.depthLabel = L10n.depthLabel(Settings.shared.depth)
            }
            settingsController = c
        }
        settingsController?.open(page: page)
    }

    // MARK: - Geometry (NSScreen coords are bottom-left origin)

    private var screen: NSScreen? { NSScreen.main ?? NSScreen.screens.first }

    private var notchWidth: CGFloat {
        guard let s = screen else { return 200 }
        if let l = s.auxiliaryTopLeftArea?.width, let r = s.auxiliaryTopRightArea?.width, l > 0, r > 0 {
            return max(150, s.frame.width - l - r)
        }
        return 200
    }

    private var notchHeight: CGFloat { max(28, screen?.safeAreaInsets.top ?? 0) }

    private func frame(expanded: Bool) -> NSRect {
        // No display (truly headless) — nothing sensible to place; a harmless default avoids a crash.
        guard let s = screen?.frame else { return NSRect(x: 0, y: 0, width: expandedWidth, height: 100) }
        if expanded {
            // The visible card is `expandedWidth × expandedCardHeight`; the panel is grown by a
            // transparent margin (sides + bottom, never the top) so the obsidian card can cast a
            // soft drop shadow without it being clipped at the panel edge.
            let mH = NotchMetrics.shadowMarginH
            let mB = NotchMetrics.shadowMarginBottom
            let cardW = expandedWidth
            let cardH = expandedCardHeight()
            let w = cardW + mH * 2
            let h = cardH + mB
            return NSRect(x: (s.midX - cardW / 2 - mH).rounded(), y: (s.maxY - h).rounded(),
                          width: w.rounded(), height: h.rounded())
        }
        // Collapsed: within the menu-bar height; extend to the LEFT of the notch so the
        // rose shows in the visible menu-bar space beside the (non-display) notch cutout.
        let sideExt: CGFloat = 60
        let w = notchWidth + sideExt
        let h = notchHeight
        let x = s.midX - notchWidth / 2 - sideExt // right edge at the notch's right; extend left
        return NSRect(x: x.rounded(), y: (s.maxY - h).rounded(), width: w.rounded(), height: h.rounded())
    }

    private func setFrame(expanded: Bool, animate: Bool) {
        let f = frame(expanded: expanded)
        if animate {
            NSAnimationContext.runAnimationGroup { ctx in
                ctx.duration = 0.28
                ctx.timingFunction = CAMediaTimingFunction(name: .easeOut)
                panel.animator().setFrame(f, display: true)
            }
        } else {
            panel.setFrame(f, display: true)
        }
    }

    // Auto-size the expanded panel to its content (clamped), so a short answer
    // doesn't leave a big empty blob and a long one scrolls.
    private let minExpandedHeight: CGFloat = 76
    private let maxExpandedHeight: CGFloat = 460

    private func expandedCardHeight() -> CGFloat {
        // Measure the SAME string the view renders, with the SAME typography (NotchType), so the
        // panel height always matches the drawn answer — no last-line clip, no trailing gap.
        let width = expandedWidth - NotchLayout.contentInsetH * 2
        let answerH = NotchType.answerHeight(model.answer, mode: model.mode, width: width)
        let total = NotchLayout.headerHeight + answerH + NotchLayout.answerBottomPad
        return min(max(total, minExpandedHeight), maxExpandedHeight)
    }

    private func resizeToFit() {
        guard model.expanded else { return }
        let target = frame(expanded: true)
        if abs(panel.frame.height - target.height) >= 2 {
            panel.setFrame(target, display: true)
        }
    }

    // MARK: - Expand / collapse

    func setExpanded(_ on: Bool) {
        guard model.expanded != on else { return }
        model.expanded = on
        setFrame(expanded: on, animate: true)
    }

    private func hover(_ inside: Bool) {
        hovering = inside
        if inside {
            collapseWork?.cancel()
            setExpanded(true)
        } else if !pinned {
            scheduleCollapse(after: 0.45)
        }
    }

    private func scheduleCollapse(after delay: TimeInterval) {
        collapseWork?.cancel()
        let work = DispatchWorkItem { [weak self] in
            guard let self else { return }
            if !self.pinned && !self.hovering { self.setExpanded(false) }
        }
        collapseWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: work)
    }

    /// Post-answer linger from 设置 → 外观. 0 = stay expanded until the mouse leaves.
    private func scheduleCollapseAfterAnswer() {
        guard !hovering else { return }
        let delay = Appearance.collapseDelay
        guard delay > 0 else { return }
        scheduleCollapse(after: delay)
    }

    // MARK: - Pipeline: capture → channel → stream

    private func runTapped(mode: String) {
        guard !running else { return }
        // The hotkey selects the mode for this capture, so the user never switches modes by hand:
        // ⌘⇧1 → tutor, ⌘⇧2 → personality. Set it first so every downstream read agrees.
        if Settings.shared.mode != mode {
            Settings.shared.mode = mode
            refreshModeLabels()
        }
        // Personality mode needs a target persona to answer toward.
        if Settings.shared.mode == "personality",
           Settings.shared.personaText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            if !visible { visible = true; panel.orderFrontRegardless() }
            setExpanded(true)
            finishError(L10n.t(
                "性格测试模式还没有人物像。请在设置 →「人物像」里写下这次要贴合的形象。",
                "性格検査モードにはまだ人物像がありません。設定→「人物像」で目指す人物像を書いてください。",
                "Personality mode needs a target persona. Describe one in Settings → Personas."))
            openSettings(page: .personas)
            return
        }
        running = true
        pinned = true
        if !visible { visible = true; panel.orderFrontRegardless() }
        model.answer = ""
        model.status = .running
        model.statusText = L10n.statusPreparing
        refreshCLILabel()
        setExpanded(true) // expands to a small empty panel; grows as the answer streams

        Task { @MainActor in
            let cliId = Settings.shared.cli
            // Routing: the chosen 答题通道 decides the channel. Official (question quota) is the
            // default for fresh installs; custom key and CLI behave exactly as before.
            let channel = self.currentChannel()

            // 额度鉴权拦截：QuotaGate 只可能拦下官方通道 —— 自定义 Key / CLI 直接放行，
            // 不读取任何账户或额度状态（见 QuotaGate.preflight 的第一行守卫）。
            if case .official = channel {
                if OfficialAPI.deviceToken == nil {
                    self.model.statusText = L10n.t("正在准备服务…", "サービスを準備中…", "Getting things ready…")
                    _ = await OfficialAPI.registerIfNeeded()
                }
                let verdict = QuotaGate.preflight(
                    channel: channel,
                    hasDeviceToken: OfficialAPI.deviceToken != nil,
                    balanceQuestions: OfficialAPI.balanceQuestions
                )
                if case .deny(let reason) = verdict {
                    self.finishError(reason)
                    self.openSettings(page: .account)
                    return
                }
            }

            // CLI mode is the only channel that needs a local binary; detection is untouched.
            var binPath: String?
            if case .cli = channel {
                let det = await CLIRunner.detect()
                guard let info = det[cliId], info.installed, let path = info.path else {
                    self.finishError(L10n.t(
                        "未找到 \(cliId) 命令行。请安装并登录后重试，或在设置 →「高级」切换回官方服务。",
                        "\(cliId) CLI が見つかりません。インストール後に再試行するか、設定→「詳細」で公式サービスに切り替えてください。",
                        "The \(cliId) CLI wasn't found. Install and sign in, or switch back to the official service in Settings → Advanced."))
                    return
                }
                if info.loggedIn == false {
                    let cmd = cliId == "codex" ? "`codex login`" : "`claude`"
                    self.finishError(L10n.t(
                        "\(cliId) 未登录。请在终端运行 \(cmd) 后重试，或在设置 →「高级」切换回官方服务。",
                        "\(cliId) が未ログインです。ターミナルで \(cmd) を実行後に再試行するか、設定→「詳細」で公式サービスへ。",
                        "\(cliId) isn't signed in. Run \(cmd) in a terminal and retry, or switch back to the official service in Settings → Advanced."))
                    return
                }
                binPath = path
            }

            // Hide the panel only for full-screen shots, so it isn't in its own
            // screenshot; a target window can't contain our panel.
            let target = Settings.shared.captureTarget
            if target == .fullScreen {
                self.panel.orderOut(nil)
                try? await Task.sleep(nanoseconds: 130_000_000)
            }
            let result = await ScreenCapture.capture(target: target)
            self.panel.orderFrontRegardless()

            let shot: ScreenCapture.Shot
            switch result {
            case .success(let s):
                if s.blank {
                    try? FileManager.default.removeItem(atPath: s.path)
                    self.finishError(L10n.t(
                        "画面为空，通常是缺少屏幕录制权限。请在「系统设置 → 隐私与安全性 → 屏幕录制」勾选 NotchSPI 并重启应用。",
                        "画面が空です。多くの場合、画面収録の許可がありません。「システム設定→プライバシーとセキュリティ→画面収録」で NotchSPI を有効にして再起動してください。",
                        "The capture came back empty — usually missing Screen Recording permission. Enable NotchSPI under System Settings → Privacy & Security → Screen Recording, then relaunch."))
                    return
                }
                shot = s
            case .failure(let error):
                self.finishError(Self.message(for: error))
                return
            }

            let mode = Settings.shared.mode
            let statusVerb = mode == "personality" ? L10n.statusAnswering : L10n.statusExplaining

            // Shared by both channels so CLI mode and direct-API mode render identically.
            let onDelta: (String) -> Void = { [weak self] delta in
                guard let self else { return }
                self.model.answer += delta
                self.model.status = .streaming
                self.model.statusText = statusVerb
                self.resizeToFit()
            }
            let onDone: (Bool, String) -> Void = { [weak self] ok, stderr in
                guard let self else { return }
                if self.model.answer.isEmpty {
                    self.model.answer = ok
                        ? L10n.noOutput
                        : L10n.t("出错了：", "エラー：", "Something went wrong:") + "\n\n```\n\(String(stderr.suffix(600)))\n```"
                    self.model.status = ok ? .idle : .error
                } else {
                    self.model.status = .idle
                }
                self.model.statusText = ok ? L10n.statusDone : L10n.statusError
                if case .official = channel {
                    if ok, let balance = OfficialAPI.balanceQuestions {
                        // 让用户对额度心里有数：完成时直接显示剩余题数。
                        self.model.statusText = L10n.statusDone + " · " + L10n.questionsLeft(balance)
                        if balance <= OfficialAPI.lowQuotaThreshold {
                            self.model.statusText += L10n.t(" · 额度即将用完", " · 残りわずか", " · running low")
                        }
                    } else if !ok, let balance = OfficialAPI.balanceQuestions, balance <= 0 {
                        // 截屏中途遇到 402：直接打开账户页引导充值，而不是让用户自己找入口。
                        self.openSettings(page: .account)
                    }
                }
                self.resizeToFit()
                self.running = false
                self.pinned = false
                try? FileManager.default.removeItem(atPath: shot.path)
                self.scheduleCollapseAfterAnswer()
            }

            switch channel {
            case .cli:
                guard let binPath else {
                    onDone(false, "internal error: CLI path missing")
                    return
                }
                CLIRunner.run(
                    cliId: cliId, binPath: binPath, imagePath: shot.path, depth: Settings.shared.depth,
                    mode: mode,
                    personaName: Settings.shared.personaName,
                    personaText: Settings.shared.personaText,
                    onDelta: onDelta, onDone: onDone
                )
            case .customKey(let apiKey):
                APIKeyRunner.run(
                    cliId: cliId, apiKey: apiKey, imagePath: shot.path, depth: Settings.shared.depth,
                    mode: mode,
                    personaName: Settings.shared.personaName,
                    personaText: Settings.shared.personaText,
                    onDelta: onDelta, onDone: onDone
                )
            case .official:
                OfficialAPI.run(
                    imagePath: shot.path, depth: Settings.shared.depth,
                    mode: mode,
                    personaName: Settings.shared.personaName,
                    personaText: Settings.shared.personaText,
                    onDelta: onDelta, onDone: onDone
                )
            }
        }
    }

    private static func message(for error: CaptureError) -> String {
        switch error {
        case .noPermission:
            return L10n.t(
                "截屏失败。请在「系统设置 → 隐私与安全性 → 屏幕录制」勾选 NotchSPI，然后重启应用。",
                "キャプチャに失敗しました。「システム設定→プライバシーとセキュリティ→画面収録」で NotchSPI を有効にして再起動してください。",
                "Capture failed. Enable NotchSPI under System Settings → Privacy & Security → Screen Recording, then relaunch.")
        case .appNotRunning(let name):
            return L10n.t(
                "截图目标「\(name)」未在运行。请先打开它，或在设置中切回「整个屏幕」。",
                "キャプチャ対象「\(name)」が起動していません。先に起動するか、設定で「画面全体」に戻してください。",
                "The capture target \"\(name)\" isn't running. Open it first, or switch back to \"Entire screen\" in Settings.")
        case .noCapturableWindow(let name):
            return L10n.t("「\(name)」当前没有可截取的窗口。",
                          "「\(name)」にキャプチャ可能なウィンドウがありません。",
                          "\"\(name)\" has no capturable window right now.")
        case .captureFailed:
            return L10n.t("截屏失败，目标窗口可能刚被关闭，请重试。",
                          "キャプチャに失敗しました。対象ウィンドウが閉じられた可能性があります。再試行してください。",
                          "Capture failed — the target window may have just closed. Please try again.")
        }
    }

    private func finishError(_ msg: String) {
        model.answer = msg
        model.status = .error
        model.statusText = L10n.statusError
        resizeToFit()
        running = false
        pinned = false
        if !hovering {
            let delay = Appearance.collapseDelay
            scheduleCollapse(after: delay > 0 ? max(delay, 14) : 14) // errors always linger long enough to read
        }
    }
}

// MARK: - Capture-target submenu (lazily populated as it opens)

extension NotchController: NSMenuDelegate {
    func menuNeedsUpdate(_ menu: NSMenu) {
        menu.removeAllItems()
        let savedID = Settings.shared.captureTargetBundleID

        let full = NSMenuItem(title: L10n.t("整个屏幕", "画面全体", "Entire screen"),
                              action: #selector(pickTarget(_:)), keyEquivalent: "")
        full.target = self
        full.state = savedID == nil ? .on : .off
        menu.addItem(full)
        menu.addItem(.separator())

        let apps = ScreenCapture.capturableApps()
        for app in apps {
            let item = NSMenuItem(title: app.name, action: #selector(pickTarget(_:)), keyEquivalent: "")
            item.target = self
            item.representedObject = app
            item.state = (app.bundleID == savedID) ? .on : .off
            if let icon = app.icon?.copy() as? NSImage {
                icon.size = NSSize(width: 16, height: 16)
                item.image = icon
            }
            menu.addItem(item)
        }
        if let savedID, !apps.contains(where: { $0.bundleID == savedID }) {
            let gone = NSMenuItem(
                title: (Settings.shared.captureTargetName ?? savedID) + L10n.t("（未运行）", "（未起動）", " (not running)"),
                action: nil, keyEquivalent: ""
            )
            gone.isEnabled = false
            gone.state = .on
            menu.addItem(gone)
        }
    }
}
