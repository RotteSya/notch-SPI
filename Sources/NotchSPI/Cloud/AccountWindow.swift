import AppKit

/// A top-left-origin container so rows lay out with y growing downward (same pattern as the
/// other settings views; the original is file-private in SettingsWindow.swift).
private final class AccountFlippedView: NSView {
    override var isFlipped: Bool { true }
}

/// 账户与额度管理: balance at a glance, one-click top-up (opens the web payment page),
/// lifetime token usage, and a retry path for a failed device registration. Read-only over
/// the official account — it never touches the custom-key or CLI configuration.
final class AccountViewController: NSViewController {
    private let balanceLabel = NSTextField(labelWithString: "—")
    private let statusLabel = NSTextField(labelWithString: "")
    private let usageLabel = NSTextField(labelWithString: "")
    private let deviceLabel = NSTextField(labelWithString: "")
    private let modeLabel = NSTextField(labelWithString: "")
    private let initButton = NSButton()
    private let refreshButton = NSButton()
    private let topUpButton = NSButton()
    private var observer: NSObjectProtocol?

    private static let width: CGFloat = 420
    private static let height: CGFloat = 316

    static var contentSize: NSSize { NSSize(width: width, height: height) }

    override func loadView() {
        let root = AccountFlippedView(frame: NSRect(x: 0, y: 0, width: Self.width, height: Self.height))

        let title = Self.makeLabel("账户与额度", size: 15, weight: .semibold, color: .labelColor)
        title.frame = NSRect(x: 20, y: 18, width: 380, height: 20)
        root.addSubview(title)

        let balanceCaption = Self.makeLabel("当前余额", size: 11, weight: .regular, color: .secondaryLabelColor)
        balanceCaption.frame = NSRect(x: 20, y: 50, width: 200, height: 16)
        root.addSubview(balanceCaption)

        balanceLabel.font = .monospacedDigitSystemFont(ofSize: 30, weight: .semibold)
        balanceLabel.textColor = .labelColor
        balanceLabel.frame = NSRect(x: 20, y: 68, width: 240, height: 38)
        root.addSubview(balanceLabel)

        refreshButton.title = "刷新"
        refreshButton.bezelStyle = .rounded
        refreshButton.target = self
        refreshButton.action = #selector(refreshTapped)
        refreshButton.frame = NSRect(x: 260, y: 74, width: 64, height: 28)
        root.addSubview(refreshButton)

        topUpButton.title = "充值…"
        topUpButton.bezelStyle = .rounded
        topUpButton.keyEquivalent = "\r"
        topUpButton.target = self
        topUpButton.action = #selector(topUpTapped)
        topUpButton.frame = NSRect(x: 330, y: 74, width: 70, height: 28)
        root.addSubview(topUpButton)

        statusLabel.font = .systemFont(ofSize: 11)
        statusLabel.textColor = .secondaryLabelColor
        statusLabel.frame = NSRect(x: 20, y: 112, width: 380, height: 32)
        statusLabel.maximumNumberOfLines = 2
        statusLabel.lineBreakMode = .byWordWrapping
        root.addSubview(statusLabel)

        let divider = NSBox(frame: NSRect(x: 20, y: 152, width: 380, height: 1))
        divider.boxType = .separator
        root.addSubview(divider)

        usageLabel.font = .systemFont(ofSize: 12)
        usageLabel.textColor = .labelColor
        usageLabel.frame = NSRect(x: 20, y: 166, width: 380, height: 18)
        root.addSubview(usageLabel)

        deviceLabel.font = .monospacedSystemFont(ofSize: 10.5, weight: .regular)
        deviceLabel.textColor = .tertiaryLabelColor
        deviceLabel.frame = NSRect(x: 20, y: 190, width: 380, height: 16)
        deviceLabel.lineBreakMode = .byTruncatingMiddle
        root.addSubview(deviceLabel)

        modeLabel.font = .systemFont(ofSize: 11)
        modeLabel.textColor = .secondaryLabelColor
        modeLabel.frame = NSRect(x: 20, y: 214, width: 380, height: 32)
        modeLabel.maximumNumberOfLines = 2
        modeLabel.lineBreakMode = .byWordWrapping
        root.addSubview(modeLabel)

        initButton.title = "初始化账户（领取试用额度）"
        initButton.bezelStyle = .rounded
        initButton.target = self
        initButton.action = #selector(initTapped)
        initButton.frame = NSRect(x: 20, y: 254, width: 230, height: 30)
        root.addSubview(initButton)

        view = root
        reload()

        observer = NotificationCenter.default.addObserver(
            forName: OfficialAPI.accountDidChange, object: nil, queue: .main
        ) { [weak self] _ in self?.reload() }
    }

    override func viewDidAppear() {
        super.viewDidAppear()
        if OfficialAPI.deviceToken != nil { refreshTapped() }
    }

    deinit {
        if let observer { NotificationCenter.default.removeObserver(observer) }
    }

    /// Re-render everything from the local account mirror.
    private func reload() {
        let registered = OfficialAPI.deviceToken != nil
        balanceLabel.stringValue = OfficialAPI.formatBalance(
            cents: OfficialAPI.balanceCents, currency: OfficialAPI.currency)
        usageLabel.stringValue = "累计用量：输入 \(OfficialAPI.totalInputTokens) tokens · 输出 \(OfficialAPI.totalOutputTokens) tokens"
        deviceLabel.stringValue = registered
            ? "设备 ID：\(Self.truncatedToken(OfficialAPI.deviceToken ?? ""))"
            : "设备尚未注册 — 点击下方按钮领取试用额度"
        let mode = Settings.shared.serviceMode
        modeLabel.stringValue = mode == ServiceMode.official
            ? "当前使用官方服务，每次截屏按实际 Token 用量从余额扣费。"
            : "当前使用「\(Settings.label(forServiceMode: mode))」，不产生官方服务扣费。可在齿轮菜单切回官方服务。"
        initButton.isHidden = registered
        // Re-enable whenever the button is shown again — after a 401 clears the token, the
        // button reappears and must be clickable (it was left disabled by a prior initTapped).
        if !registered { initButton.isEnabled = true }
        refreshButton.isEnabled = registered
        topUpButton.isEnabled = registered
    }

    @objc private func refreshTapped() {
        statusLabel.stringValue = "正在同步余额…"
        statusLabel.textColor = .secondaryLabelColor
        Task { @MainActor in
            switch await OfficialAPI.refreshAccount() {
            case .success:
                self.statusLabel.stringValue = "余额已同步。"
                self.statusLabel.textColor = .secondaryLabelColor
            case .failure(let error):
                self.statusLabel.stringValue = error.message
                self.statusLabel.textColor = .systemOrange
            }
            self.reload()
        }
    }

    @objc private func topUpTapped() {
        guard let url = OfficialAPI.topUpURL(
            baseURL: OfficialAPI.baseURL, deviceToken: OfficialAPI.deviceToken) else { return }
        NSWorkspace.shared.open(url)
        statusLabel.stringValue = "已在浏览器打开充值页面，完成后点「刷新」同步余额。"
        statusLabel.textColor = .secondaryLabelColor
    }

    @objc private func initTapped() {
        initButton.isEnabled = false
        statusLabel.stringValue = "正在注册设备…"
        statusLabel.textColor = .secondaryLabelColor
        Task { @MainActor in
            switch await OfficialAPI.registerIfNeeded() {
            case .success:
                self.statusLabel.stringValue = "注册成功，试用额度已到账。"
                self.statusLabel.textColor = .systemGreen
            case .failure(let error):
                self.statusLabel.stringValue = error.message
                self.statusLabel.textColor = .systemOrange
                self.initButton.isEnabled = true
            }
            self.reload()
        }
    }

    /// The device token is a bearer credential — show just enough to identify it in support
    /// requests, never the whole thing (shoulder-surfing / third-party screenshot tools).
    static func truncatedToken(_ token: String) -> String {
        guard token.count > 14 else { return token }
        return "\(token.prefix(8))…\(token.suffix(4))"
    }

    private static func makeLabel(_ text: String, size: CGFloat, weight: NSFont.Weight, color: NSColor) -> NSTextField {
        let f = NSTextField(labelWithString: text)
        f.font = .systemFont(ofSize: size, weight: weight)
        f.textColor = color
        return f
    }
}
