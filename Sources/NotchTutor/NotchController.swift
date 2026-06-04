import AppKit
import SwiftUI
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
    private var settingsVM: SettingsViewModel?

    private let expandedSize = CGSize(width: 600, height: 420)

    override init() {
        panel = NotchPanel(contentRect: .zero)
        super.init()
        model.cliLabel = Settings.label(forCLI: Settings.shared.cli)
        model.depthLabel = Settings.label(forDepth: Settings.shared.depth)

        let view = NotchView(
            model: model,
            onHover: { [weak self] in self?.hover($0) },
            onCycleDepth: { [weak self] in self?.cycleDepth() },
            onSettings: { [weak self] in self?.showSettings() }
        )
        let host = NSHostingView(rootView: view)
        host.layer?.backgroundColor = .clear
        panel.contentView = host
        panel.setFrame(frame(expanded: false), display: true)

        registerHotkeys()
    }

    func show() { panel.orderFrontRegardless() }

    private func registerHotkeys() {
        HotKeyCenter.shared.unregisterAll()
        let cap = Settings.shared.captureCombo
        let tog = Settings.shared.toggleCombo
        HotKeyCenter.shared.register(keyCode: cap.keyCode, modifiers: cap.modifiers) { [weak self] in
            self?.runTapped()
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

        let hint = NSMenuItem(title: "截屏讲题  ⌘⇧1      显示/隐藏  ⌘⇧Space", action: nil, keyEquivalent: "")
        hint.isEnabled = false
        menu.addItem(hint)
        menu.addItem(.separator())

        let hk = NSMenuItem(title: "快捷键设置…", action: #selector(openSettingsMenu), keyEquivalent: "")
        hk.target = self
        menu.addItem(hk)

        let quit = NSMenuItem(title: "退出 NotchTutor", action: #selector(quitApp), keyEquivalent: "")
        quit.target = self
        menu.addItem(quit)

        menu.popUp(positioning: nil, at: NSEvent.mouseLocation, in: nil)
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
        let vm = SettingsViewModel()
        vm.onChange = { [weak self] in self?.registerHotkeys() }
        settingsVM = vm
        let host = NSHostingController(rootView: HotkeySettingsView(vm: vm))
        let w = NSWindow(contentViewController: host)
        w.title = "NotchTutor 设置"
        w.styleMask = [.titled, .closable]
        w.isReleasedWhenClosed = false
        w.setContentSize(NSSize(width: 380, height: 200))
        w.center()
        settingsWindow = w
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
            let w = expandedSize.width
            let h = expandedHeight()
            return NSRect(x: (s.midX - w / 2).rounded(), y: (s.maxY - h).rounded(),
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

    private func expandedHeight() -> CGFloat {
        let width = expandedSize.width - 32
        let text = model.answer.isEmpty ? "按 ⌘⇧1 截屏讲题 · 悬停展开" : model.answer
        let attr = NSAttributedString(string: text, attributes: [.font: NSFont.systemFont(ofSize: 13)])
        let rect = attr.boundingRect(
            with: NSSize(width: width, height: .greatestFiniteMagnitude),
            options: [.usesLineFragmentOrigin, .usesFontLeading]
        )
        let total = ceil(rect.height) + 44 /* header */ + 28 /* paddings */
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

    private func runTapped() {
        guard !running else { return }
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

            // Hide the panel so it isn't in its own screenshot, then capture.
            self.panel.orderOut(nil)
            try? await Task.sleep(nanoseconds: 130_000_000)
            let shot = await ScreenCapture.capture()
            self.panel.orderFrontRegardless()

            guard let shot else {
                self.finishError("截屏失败。请在「系统设置 → 隐私与安全性 → 屏幕录制」勾选 NotchTutor，然后重启应用。")
                return
            }
            if shot.blank {
                try? FileManager.default.removeItem(atPath: shot.path)
                self.finishError("画面为空，通常是缺少屏幕录制权限。请在「系统设置 → 隐私与安全性 → 屏幕录制」勾选 NotchTutor 并重启应用。")
                return
            }

            self.model.statusText = "正在用 \(self.model.cliLabel) 讲解…"
            CLIRunner.run(
                cliId: cliId, binPath: binPath, imagePath: shot.path, depth: Settings.shared.depth,
                onDelta: { [weak self] delta in
                    guard let self else { return }
                    self.model.answer += delta
                    self.model.status = .streaming
                    self.model.statusText = "讲解中…"
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
