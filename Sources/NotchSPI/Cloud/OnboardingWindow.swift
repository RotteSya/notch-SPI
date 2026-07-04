import AppKit

/// A top-left-origin container so rows lay out with y growing downward (same pattern as the
/// other settings views; the original is file-private in SettingsWindow.swift).
private final class OnboardingFlippedView: NSView {
    override var isFlipped: Bool { true }
}

/// First-launch onboarding: pick who generates the answers. The official pay-as-you-go
/// service is the recommended default (one click, auto-registers the device, trial credits
/// arrive server-side); the custom-key and CLI modes are offered right beside it so the
/// choice always stays with the user. Existing installs never see this window — the caller
/// (`NotchController.showOnboardingIfNeeded`) skips it for any pre-existing setup.
final class OnboardingViewController: NSViewController {
    /// Called after a mode is chosen and persisted (refresh header labels, etc.).
    var onFinished: (() -> Void)?
    /// Called when the user picked custom-key mode, so the key window opens next.
    var onOpenCustomKeySettings: (() -> Void)?

    private let officialButton = NSButton()
    private let statusLabel = NSTextField(labelWithString: "")

    private static let width: CGFloat = 470
    private static let height: CGFloat = 388

    static var contentSize: NSSize { NSSize(width: width, height: height) }

    override func loadView() {
        let root = OnboardingFlippedView(frame: NSRect(x: 0, y: 0, width: Self.width, height: Self.height))

        let title = Self.makeLabel("欢迎使用 NotchSPI", size: 17, weight: .semibold, color: .labelColor)
        title.frame = NSRect(x: 24, y: 22, width: 422, height: 22)
        root.addSubview(title)

        let subtitle = Self.makeLabel(
            "按下 ⌘⇧1 即可截屏讲题。先选择答案由谁来生成 —— 之后随时可以在齿轮菜单里切换：",
            size: 12, weight: .regular, color: .secondaryLabelColor)
        subtitle.frame = NSRect(x: 24, y: 52, width: 422, height: 34)
        subtitle.maximumNumberOfLines = 2
        subtitle.lineBreakMode = .byWordWrapping
        root.addSubview(subtitle)

        var y: CGFloat = 100
        y = addOption(
            into: root, y: y,
            button: officialButton,
            title: "官方服务（推荐 · 按量计费）",
            desc: "开箱即用，无需任何配置。首次使用自动注册并赠送试用额度，之后按实际用量计费，余额随时可查、可充值。",
            action: #selector(chooseOfficial), isDefault: true)
        y = addOption(
            into: root, y: y,
            button: NSButton(),
            title: "使用自定义 API Key",
            desc: "已有 Anthropic / OpenAI 的 API Key？直连官方 API，费用走你自己的账户。",
            action: #selector(chooseCustomKey), isDefault: false)
        _ = addOption(
            into: root, y: y,
            button: NSButton(),
            title: "使用本机 CLI",
            desc: "已安装并登录 codex / claude 命令行？继续免 Key 的本机模式。",
            action: #selector(chooseCLI), isDefault: false)

        statusLabel.font = .systemFont(ofSize: 11)
        statusLabel.textColor = .secondaryLabelColor
        statusLabel.frame = NSRect(x: 24, y: Self.height - 34, width: 422, height: 18)
        statusLabel.maximumNumberOfLines = 1
        statusLabel.lineBreakMode = .byTruncatingTail
        root.addSubview(statusLabel)

        view = root
    }

    /// One choice row: full-width button + explanation beneath. Returns the y below the row.
    private func addOption(into root: NSView, y: CGFloat, button: NSButton,
                           title: String, desc: String, action: Selector, isDefault: Bool) -> CGFloat {
        button.title = title
        button.bezelStyle = .rounded
        button.controlSize = .large
        button.font = .systemFont(ofSize: 13, weight: isDefault ? .semibold : .regular)
        button.target = self
        button.action = action
        if isDefault { button.keyEquivalent = "\r" }
        button.frame = NSRect(x: 24, y: y, width: 422, height: 34)
        root.addSubview(button)

        let descLabel = Self.makeLabel(desc, size: 11, weight: .regular, color: .secondaryLabelColor)
        descLabel.frame = NSRect(x: 28, y: y + 38, width: 414, height: 30)
        descLabel.maximumNumberOfLines = 2
        descLabel.lineBreakMode = .byWordWrapping
        root.addSubview(descLabel)

        return y + 38 + 34 + 12
    }

    // MARK: - Choices

    @objc private func chooseOfficial() {
        officialButton.isEnabled = false
        statusLabel.stringValue = "正在初始化官方服务账户…"
        statusLabel.textColor = .secondaryLabelColor
        Task { @MainActor in
            let result = await OfficialAPI.registerIfNeeded()
            switch result {
            case .success:
                self.finish(mode: ServiceMode.official)
            case .failure(let message):
                // Keep the choice — the account panel / first capture can retry registration.
                // Surface the problem so the user isn't left wondering.
                self.statusLabel.stringValue = "初始化未完成（\(message)）。已选择官方服务，可稍后在「账户与额度」中重试。"
                self.statusLabel.textColor = .systemOrange
                self.officialButton.isEnabled = true
                self.officialButton.title = "重试并继续使用官方服务"
                self.officialButton.action = #selector(self.chooseOfficialAnyway)
            }
        }
    }

    /// Second attempt: even if registration keeps failing (e.g. offline first launch), commit
    /// the choice and move on — registration re-runs automatically on the first capture.
    @objc private func chooseOfficialAnyway() {
        Task { @MainActor in
            _ = await OfficialAPI.registerIfNeeded()
            self.finish(mode: ServiceMode.official)
        }
    }

    @objc private func chooseCustomKey() {
        finish(mode: ServiceMode.customKey)
        onOpenCustomKeySettings?()
    }

    @objc private func chooseCLI() {
        finish(mode: ServiceMode.cli)
    }

    private func finish(mode: String) {
        Settings.shared.serviceMode = mode
        Settings.shared.onboardingDone = true
        onFinished?()
        view.window?.close()
    }

    private static func makeLabel(_ text: String, size: CGFloat, weight: NSFont.Weight, color: NSColor) -> NSTextField {
        let f = NSTextField(labelWithString: text)
        f.font = .systemFont(ofSize: size, weight: weight)
        f.textColor = color
        return f
    }
}
