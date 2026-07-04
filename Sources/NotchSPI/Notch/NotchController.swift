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
    private var settingsWindow: NSWindow?
    private var settingsVC: HotkeySettingsViewController?
    private var personaWindow: NSWindow?
    private var personaVC: PersonaManagerViewController?
    private var apiKeyWindow: NSWindow?
    private var apiKeyVC: APIKeySettingsViewController?
    private var accountWindow: NSWindow?
    private var accountVC: AccountViewController?
    private var onboardingWindow: NSWindow?

    private let expandedWidth: CGFloat = 600

    override init() {
        panel = NotchPanel(contentRect: .zero)
        super.init()
        refreshCLILabel()
        model.depthLabel = Settings.label(forDepth: Settings.shared.depth)

        let view = NotchView(
            model: model,
            onHover: { [weak self] in self?.hover($0) },
            onCycleDepth: { [weak self] in self?.cycleDepth() },
            onEditPersona: { [weak self] in self?.openPersonaWindow() },
            onSettings: { [weak self] in self?.showSettings() }
        )
        view.autoresizingMask = [.width, .height]
        panel.contentView = view
        panel.setFrame(frame(expanded: false), display: true)

        refreshModeLabels()
        registerHotkeys()
    }

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

    // MARK: - Onboarding (first launch only)

    /// Present the first-launch onboarding. `bootstrapFirstRunState()` (run at the very top of
    /// launch, before PersonaStore's migration can write keys) already marked existing installs
    /// as done — so reaching here with `onboardingDone == false` means a genuinely fresh install.
    func showOnboardingIfNeeded() {
        Settings.shared.bootstrapFirstRunState() // defensive; no-op after AppDelegate ran it
        guard !Settings.shared.onboardingDone else { return }
        let vc = OnboardingViewController()
        vc.onFinished = { [weak self] in
            self?.refreshCLILabel()
            self?.onboardingWindow = nil // one-shot window; don't keep it retained for the app's lifetime
        }
        vc.onOpenCustomKeySettings = { [weak self] in self?.openAPIKeyWindow() }
        let w = NSWindow(contentViewController: vc)
        w.title = "欢迎"
        w.styleMask = [.titled, .closable]
        w.sharingType = ScreenShareGuard.windowSharingType
        w.isReleasedWhenClosed = false
        w.setContentSize(OnboardingViewController.contentSize)
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
        model.modeLabel = Settings.label(forMode: m)
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
        model.depthLabel = Settings.label(forDepth: next)
    }

    private func showSettings() {
        buildSettingsMenu().popUp(positioning: nil, at: NSEvent.mouseLocation, in: nil)
    }

    private func buildSettingsMenu() -> NSMenu {
        let menu = NSMenu()

        // 服务模式：官方按量计费（默认）/ 自定义 Key / 本机 CLI，三种并存、自由切换。
        let modeHeader = NSMenuItem(title: "服务模式", action: nil, keyEquivalent: "")
        modeHeader.isEnabled = false
        menu.addItem(modeHeader)
        for id in ServiceMode.all {
            let item = NSMenuItem(
                title: Settings.label(forServiceMode: id),
                action: #selector(pickServiceMode(_:)), keyEquivalent: ""
            )
            item.target = self
            item.representedObject = id
            item.state = (Settings.shared.serviceMode == id) ? .on : .off
            menu.addItem(item)
        }

        let accountItem = NSMenuItem(title: "账户与额度…", action: #selector(openAccountMenu), keyEquivalent: "")
        accountItem.target = self
        menu.addItem(accountItem)

        let apiKeyItem = NSMenuItem(title: "自定义 API Key…", action: #selector(openAPIKeyMenu), keyEquivalent: "")
        apiKeyItem.target = self
        menu.addItem(apiKeyItem)
        menu.addItem(.separator())

        // 后端选择只影响自定义 Key / CLI 两种模式；官方模式下由服务端选择模型，故隐藏。
        if Settings.shared.serviceMode != ServiceMode.official {
            let cliHeader = NSMenuItem(title: "后端 (CLI)", action: nil, keyEquivalent: "")
            cliHeader.isEnabled = false
            menu.addItem(cliHeader)
            for (id, label) in [("codex", "Codex"), ("claude", "Claude")] {
                let usesKey = Settings.shared.usesCustomKey(for: id)
                let item = NSMenuItem(
                    title: usesKey ? "\(label)（API Key 直连）" : label,
                    action: #selector(pickCLI(_:)), keyEquivalent: ""
                )
                item.target = self
                item.representedObject = id
                item.state = (Settings.shared.cli == id) ? .on : .off
                menu.addItem(item)
            }
            menu.addItem(.separator())
        }

        // Mode (学习辅导 / 性格测试) is chosen by which hotkey you press — ⌘⇧1 vs ⌘⇧2 — so it isn't a
        // manual menu choice; the hotkey hint row below shows the bindings. The persona switch +
        // manage entries are grouped together at the bottom near 快捷键设置.

        // Depth only applies to tutor mode; hide it in personality mode.
        if Settings.shared.mode != "personality" {
            let depthHeader = NSMenuItem(title: "讲解深度", action: nil, keyEquivalent: "")
            depthHeader.isEnabled = false
            menu.addItem(depthHeader)
            for id in Settings.depthCycle {
                let item = NSMenuItem(title: Settings.label(forDepth: id), action: #selector(pickDepth(_:)), keyEquivalent: "")
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
            title: "截图目标：\(savedID == nil ? "整个屏幕" : savedName)",
            action: nil, keyEquivalent: ""
        )
        // Submenu fills lazily in menuNeedsUpdate when it opens, keeping window
        // enumeration off the popUp path entirely.
        let targetMenu = NSMenu()
        targetMenu.delegate = self
        targetItem.submenu = targetMenu
        menu.addItem(targetItem)
        menu.addItem(.separator())

        let capStr = Settings.displayString(Settings.shared.captureCombo)
        let perStr = Settings.displayString(Settings.shared.personalityCombo)
        let togStr = Settings.displayString(Settings.shared.toggleCombo)
        let hint = NSMenuItem(title: "讲题 \(capStr)    性格作答 \(perStr)    显示/隐藏 \(togStr)", action: nil, keyEquivalent: "")
        hint.isEnabled = false
        menu.addItem(hint)
        menu.addItem(.separator())

        let hk = NSMenuItem(title: "快捷键设置…", action: #selector(openSettingsMenu), keyEquivalent: "")
        hk.target = self
        menu.addItem(hk)

        // Persona quick-switch (only when personas exist) + manage, grouped here at the bottom.
        let personas = PersonaStore.shared.all
        if !personas.isEmpty {
            let switchItem = NSMenuItem(title: "切换人物像", action: nil, keyEquivalent: "")
            let sub = NSMenu()
            for p in personas {
                let it = NSMenuItem(title: p.name.isEmpty ? "未命名人物像" : p.name, action: #selector(pickPersona(_:)), keyEquivalent: "")
                it.target = self
                it.representedObject = p.id
                it.state = (PersonaStore.shared.activeID == p.id) ? .on : .off
                sub.addItem(it)
            }
            switchItem.submenu = sub
            menu.addItem(switchItem)
        }

        let persona = NSMenuItem(title: "管理人物像…", action: #selector(openPersonaMenu), keyEquivalent: "")
        persona.target = self
        menu.addItem(persona)

        menu.addItem(.separator())

        let update = NSMenuItem(title: "检查更新…", action: #selector(checkForUpdates), keyEquivalent: "")
        update.target = self
        menu.addItem(update)

        let quit = NSMenuItem(title: "退出 NotchSPI", action: #selector(quitApp), keyEquivalent: "")
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

    @objc private func pickCLI(_ sender: NSMenuItem) {
        guard let id = sender.representedObject as? String else { return }
        Settings.shared.cli = id
        refreshCLILabel()
    }

    @objc private func pickServiceMode(_ sender: NSMenuItem) {
        guard let id = sender.representedObject as? String else { return }
        Settings.shared.serviceMode = id
        refreshCLILabel()
    }

    @objc private func openAccountMenu() { openAccountWindow() }

    private func openAccountWindow() {
        if let w = accountWindow {
            w.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
            return
        }
        let vc = AccountViewController()
        accountVC = vc
        let w = NSWindow(contentViewController: vc)
        w.title = "账户与额度"
        w.styleMask = [.titled, .closable]
        w.sharingType = ScreenShareGuard.windowSharingType // keep account info out of screen capture
        w.isReleasedWhenClosed = false
        w.setContentSize(AccountViewController.contentSize)
        w.center()
        accountWindow = w
        w.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    @objc private func openAPIKeyMenu() { openAPIKeyWindow() }

    private func openAPIKeyWindow() {
        if let w = apiKeyWindow {
            w.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
            return
        }
        let vc = APIKeySettingsViewController()
        vc.onChange = { [weak self] in self?.refreshCLILabel() }
        apiKeyVC = vc
        let w = NSWindow(contentViewController: vc)
        w.title = "自定义 API Key"
        w.styleMask = [.titled, .closable]
        w.sharingType = ScreenShareGuard.windowSharingType // keep keys out of screen capture too
        w.isReleasedWhenClosed = false
        w.setContentSize(APIKeySettingsViewController.contentSize)
        w.center()
        apiKeyWindow = w
        w.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    @objc private func pickDepth(_ sender: NSMenuItem) {
        guard let id = sender.representedObject as? String else { return }
        Settings.shared.depth = id
        model.depthLabel = Settings.label(forDepth: id)
    }

    @objc private func pickPersona(_ sender: NSMenuItem) {
        guard let id = sender.representedObject as? String else { return }
        PersonaStore.shared.setActive(id)
        refreshModeLabels()
        personaVC?.reloadFromStore() // keep an open manager window in sync
    }

    @objc private func openPersonaMenu() { openPersonaWindow() }

    @objc private func checkForUpdates() { UpdateChecker.checkForUpdatesManually() }

    @objc private func quitApp() {
        NSApp.terminate(nil)
    }

    @objc private func openSettingsMenu() {
        openSettingsWindow()
    }

    private func openSettingsWindow() {
        if let w = settingsWindow {
            w.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
            return
        }
        let vc = HotkeySettingsViewController()
        vc.onChange = { [weak self] in self?.registerHotkeys() }
        settingsVC = vc
        let w = NSWindow(contentViewController: vc)
        w.title = "NotchSPI 设置"
        w.styleMask = [.titled, .closable]
        w.sharingType = ScreenShareGuard.windowSharingType // keep settings out of screen capture too
        w.isReleasedWhenClosed = false
        w.setContentSize(NSSize(width: 380, height: 232))
        w.center()
        settingsWindow = w
        w.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    private func openPersonaWindow() {
        if let w = personaWindow {
            personaVC?.reloadFromStore() // resync in case the gear menu switched personas while closed
            w.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
            return
        }
        let vc = PersonaManagerViewController()
        vc.onChange = { [weak self] in self?.refreshModeLabels() }
        personaVC = vc
        let w = NSWindow(contentViewController: vc)
        w.title = "性格测试 · 人物像"
        w.styleMask = [.titled, .closable]
        w.sharingType = ScreenShareGuard.windowSharingType // keep the persona out of screen capture too
        w.isReleasedWhenClosed = false
        w.setContentSize(NSSize(width: 640, height: 450))
        w.center()
        personaWindow = w
        w.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
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

    // MARK: - Pipeline: capture → CLI (read-only) → stream

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
            finishError("性格测试模式还没有人物像。请在齿轮菜单 →「编辑人物像…」填写本次要贴合的人物像。")
            openPersonaWindow()
            return
        }
        running = true
        pinned = true
        if !visible { visible = true; panel.orderFrontRegardless() }
        model.answer = ""
        model.status = .running
        model.statusText = "正在准备…"
        refreshCLILabel()
        setExpanded(true) // expands to a small empty panel; grows as the answer streams

        Task { @MainActor in
            let cliId = Settings.shared.cli
            // Routing: the chosen 服务模式 decides the channel. Official (pay-as-you-go) is the
            // default for fresh installs; custom key and CLI behave exactly as before.
            let channel = self.currentChannel()

            // 计费鉴权拦截：BillingGate 只可能拦下官方通道 —— 自定义 Key / CLI 直接放行，
            // 不读取任何账户或余额状态（见 BillingGate.preflight 的第一行守卫）。
            if case .official = channel {
                if OfficialAPI.deviceToken == nil {
                    self.model.statusText = "正在初始化官方服务…"
                    _ = await OfficialAPI.registerIfNeeded()
                }
                let verdict = BillingGate.preflight(
                    channel: channel,
                    hasDeviceToken: OfficialAPI.deviceToken != nil,
                    balanceCents: OfficialAPI.balanceCents
                )
                if case .deny(let reason) = verdict {
                    self.finishError(reason)
                    self.openAccountWindow()
                    return
                }
            }

            // CLI mode is the only channel that needs a local binary; detection is untouched.
            var binPath: String?
            if case .cli = channel {
                let det = await CLIRunner.detect()
                guard let info = det[cliId], info.installed, let path = info.path else {
                    self.finishError("未找到 \(cliId)，请安装并登录后重试；也可以在齿轮菜单切换到官方服务或自定义 API Key。")
                    return
                }
                if info.loggedIn == false {
                    let cmd = cliId == "codex" ? "`codex login`" : "`claude`"
                    self.finishError("\(cliId) 未登录。请在终端运行 \(cmd) 后重试；也可以在齿轮菜单切换到官方服务或自定义 API Key。")
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
                    self.finishError("画面为空，通常是缺少屏幕录制权限。请在「系统设置 → 隐私与安全性 → 屏幕录制」勾选 NotchSPI 并重启应用。")
                    return
                }
                shot = s
            case .failure(let error):
                self.finishError(Self.message(for: error))
                return
            }

            let mode = Settings.shared.mode
            let verb = mode == "personality" ? "作答" : "讲解"
            self.model.statusText = "正在用 \(self.model.cliLabel) \(verb)…"

            // Shared by both channels so CLI mode and direct-API mode render identically.
            let onDelta: (String) -> Void = { [weak self] delta in
                guard let self else { return }
                self.model.answer += delta
                self.model.status = .streaming
                self.model.statusText = "\(verb)中…"
                self.resizeToFit()
            }
            let onDone: (Bool, String) -> Void = { [weak self] ok, stderr in
                guard let self else { return }
                if self.model.answer.isEmpty {
                    self.model.answer = ok
                        ? "（没有输出）"
                        : "出错了：\n\n```\n\(String(stderr.suffix(600)))\n```"
                    self.model.status = ok ? .idle : .error
                } else {
                    self.model.status = .idle
                }
                self.model.statusText = ok ? "完成" : "出错"
                if case .official = channel {
                    if ok, let cost = OfficialAPI.lastCaptureCostCents {
                        // 让用户对"按量计费"心里有数：完成时直接显示本次消耗。
                        self.model.statusText = "完成 · 本次 \(OfficialAPI.formatBalance(cents: cost, currency: OfficialAPI.currency))"
                    } else if !ok, let balance = OfficialAPI.balanceCents, balance <= 0 {
                        // 截屏中途遇到 402：直接打开账户面板引导充值，而不是让用户自己找入口。
                        self.openAccountWindow()
                    }
                }
                self.resizeToFit()
                self.running = false
                self.pinned = false
                try? FileManager.default.removeItem(atPath: shot.path)
                if !self.hovering { self.scheduleCollapse(after: 9) }
            }

            switch channel {
            case .cli:
                guard let binPath else {
                    onDone(false, "内部错误：CLI 路径缺失")
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
            return "截屏失败。请在「系统设置 → 隐私与安全性 → 屏幕录制」勾选 NotchSPI，然后重启应用。"
        case .appNotRunning(let name):
            return "截图目标「\(name)」未在运行。请先打开它，或在设置中切回「整个屏幕」。"
        case .noCapturableWindow(let name):
            return "「\(name)」当前没有可截取的窗口。"
        case .captureFailed:
            return "截屏失败，目标窗口可能刚被关闭，请重试。"
        }
    }

    private func finishError(_ msg: String) {
        model.answer = msg
        model.status = .error
        model.statusText = "出错"
        resizeToFit()
        running = false
        pinned = false
        if !hovering { scheduleCollapse(after: 14) }
    }
}

// MARK: - Capture-target submenu (lazily populated as it opens)

extension NotchController: NSMenuDelegate {
    func menuNeedsUpdate(_ menu: NSMenu) {
        menu.removeAllItems()
        let savedID = Settings.shared.captureTargetBundleID

        let full = NSMenuItem(title: "整个屏幕", action: #selector(pickTarget(_:)), keyEquivalent: "")
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
                title: "\(Settings.shared.captureTargetName ?? savedID)（未运行）",
                action: nil, keyEquivalent: ""
            )
            gone.isEnabled = false
            gone.state = .on
            menu.addItem(gone)
        }
    }
}
