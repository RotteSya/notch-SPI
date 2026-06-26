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
    private var personaVC: PersonaSettingsViewController?

    private let expandedWidth: CGFloat = 600

    override init() {
        panel = NotchPanel(contentRect: .zero)
        super.init()
        model.cliLabel = Settings.label(forCLI: Settings.shared.cli)
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

    /// Push the active mode + persona name into the model so the notch header reflects them.
    private func refreshModeLabels() {
        let m = Settings.shared.mode
        model.mode = m
        model.modeLabel = Settings.label(forMode: m)
        model.personaLabel = Settings.shared.personaName.trimmingCharacters(in: .whitespacesAndNewlines)
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

        let cliHeader = NSMenuItem(title: "后端 (CLI)", action: nil, keyEquivalent: "")
        cliHeader.isEnabled = false
        menu.addItem(cliHeader)
        for (id, label) in [("codex", "Codex"), ("claude", "Claude")] {
            let item = NSMenuItem(title: label, action: #selector(pickCLI(_:)), keyEquivalent: "")
            item.target = self
            item.representedObject = id
            item.state = (Settings.shared.cli == id) ? .on : .off
            menu.addItem(item)
        }
        menu.addItem(.separator())

        let modeHeader = NSMenuItem(title: "模式", action: nil, keyEquivalent: "")
        modeHeader.isEnabled = false
        menu.addItem(modeHeader)
        for id in Settings.modeCycle {
            let item = NSMenuItem(title: Settings.label(forMode: id), action: #selector(pickMode(_:)), keyEquivalent: "")
            item.target = self
            item.representedObject = id
            item.state = (Settings.shared.mode == id) ? .on : .off
            menu.addItem(item)
        }
        let persona = NSMenuItem(title: "编辑人物像…", action: #selector(openPersonaMenu), keyEquivalent: "")
        persona.target = self
        menu.addItem(persona)
        menu.addItem(.separator())

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
        model.cliLabel = Settings.label(forCLI: id)
    }

    @objc private func pickDepth(_ sender: NSMenuItem) {
        guard let id = sender.representedObject as? String else { return }
        Settings.shared.depth = id
        model.depthLabel = Settings.label(forDepth: id)
    }

    @objc private func pickMode(_ sender: NSMenuItem) {
        guard let id = sender.representedObject as? String else { return }
        Settings.shared.mode = id
        refreshModeLabels()
        // Switching into personality mode is the moment to capture the target persona.
        if id == "personality" { openPersonaWindow() }
    }

    @objc private func openPersonaMenu() { openPersonaWindow() }

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
            w.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
            return
        }
        let vc = PersonaSettingsViewController()
        vc.onChange = { [weak self] in self?.refreshModeLabels() }
        personaVC = vc
        let w = NSWindow(contentViewController: vc)
        w.title = "性格测试 · 人物像"
        w.styleMask = [.titled, .closable]
        w.sharingType = ScreenShareGuard.windowSharingType // keep the persona out of screen capture too
        w.isReleasedWhenClosed = false
        w.setContentSize(NSSize(width: 440, height: 360))
        w.center()
        personaWindow = w
        w.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    // MARK: - Geometry (NSScreen coords are bottom-left origin)

    private var screen: NSScreen { NSScreen.main ?? NSScreen.screens.first! }

    private var notchWidth: CGFloat {
        let s = screen
        if let l = s.auxiliaryTopLeftArea?.width, let r = s.auxiliaryTopRightArea?.width, l > 0, r > 0 {
            return max(150, s.frame.width - l - r)
        }
        return 200
    }

    private var notchHeight: CGFloat { max(28, screen.safeAreaInsets.top) }

    private func frame(expanded: Bool) -> NSRect {
        let s = screen.frame
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
        model.cliLabel = Settings.label(forCLI: Settings.shared.cli)
        setExpanded(true) // expands to a small empty panel; grows as the answer streams

        Task { @MainActor in
            let cliId = Settings.shared.cli
            let det = await CLIRunner.detect()
            guard let info = det[cliId], info.installed, let binPath = info.path else {
                self.finishError("未找到 \(cliId)，请安装并登录后重试。")
                return
            }
            if info.loggedIn == false {
                let cmd = cliId == "codex" ? "`codex login`" : "`claude`"
                self.finishError("\(cliId) 未登录。请在终端运行 \(cmd) 后重试。")
                return
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
            CLIRunner.run(
                cliId: cliId, binPath: binPath, imagePath: shot.path, depth: Settings.shared.depth,
                mode: mode,
                personaName: Settings.shared.personaName,
                personaText: Settings.shared.personaText,
                onDelta: { [weak self] delta in
                    guard let self else { return }
                    self.model.answer += delta
                    self.model.status = .streaming
                    self.model.statusText = "\(verb)中…"
                    self.resizeToFit()
                },
                onDone: { [weak self] ok, stderr in
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
                    self.resizeToFit()
                    self.running = false
                    self.pinned = false
                    try? FileManager.default.removeItem(atPath: shot.path)
                    if !self.hovering { self.scheduleCollapse(after: 9) }
                }
            )
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
