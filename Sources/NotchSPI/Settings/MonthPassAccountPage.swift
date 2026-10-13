import AppKit

/// Reusable monthly-pass presentation; all account data and actions are injected.
/// The current build wires this only to the isolated local preview.
@MainActor
final class MonthPassAccountPage: NSViewController, SettingsPage {
    var snapshot = MonthPassPreview.fixture(0)
    var onStatusChange: ((String) -> Void)?
    private var expanded = false
    private var selectedState = 0
    private var actionMessage = ""
    private let scroll = NSScrollView()
    private let content = PassFlippedView()

    override func loadView() {
        view = PassFlippedView(frame: NSRect(origin: .zero, size: MainSettingsWindowController.pageSize))
        scroll.frame = view.bounds
        scroll.autoresizingMask = [.width, .height]
        scroll.drawsBackground = false
        scroll.hasVerticalScroller = true
        scroll.documentView = content
        view.addSubview(scroll)
        render()
    }

    func pageDidShow() { render() }

    private func label(_ text: String, x: CGFloat = 56, y: CGFloat, width: CGFloat = 528,
                       height: CGFloat = 24, size: CGFloat = 13, bold: Bool = false,
                       secondary: Bool = false) {
        let field = NSTextField(wrappingLabelWithString: text)
        field.frame = NSRect(x: x, y: y, width: width, height: height)
        field.font = .systemFont(ofSize: size, weight: bold ? .semibold : .regular)
        field.textColor = secondary ? .secondaryLabelColor : .labelColor
        content.addSubview(field)
    }

    private func card(y: CGFloat, height: CGFloat, accent: Bool = false) {
        let card = PassCardView(frame: NSRect(x: 36, y: y, width: 568, height: height))
        card.accent = accent
        content.addSubview(card)
    }

    private func button(_ title: String, x: CGFloat, y: CGFloat, width: CGFloat,
                        action: Selector, enabled: Bool = true) {
        let button = NSButton(title: title, target: self, action: action)
        button.bezelStyle = .rounded
        button.frame = NSRect(x: x, y: y, width: width, height: 32)
        button.isEnabled = enabled
        content.addSubview(button)
    }

    private func render() {
        guard isViewLoaded else { return }
        content.subviews.forEach { $0.removeFromSuperview() }
        let now = Date()
        let state = snapshot.state(at: now)
        let active = state == .active
        let exhausted = active && snapshot.dailyStatus(at: now) == .exhausted
        label(L10n.t("账户与订阅", "アカウントとプラン", "Account & subscription"), x: 36, y: 46, height: 32, size: 23, bold: true)
        label(L10n.t("本地预览 · 示例账户", "プレビュー · サンプル", "Preview · sample account"), x: 404, y: 57, width: 200, height: 20, size: 10, secondary: true)
        card(y: 100, height: 218, accent: true)
        label(L10n.t("NotchSPI Plus", "NotchSPI Plus", "NotchSPI Plus"), y: 120, size: 14, bold: true)
        label(L10n.t("69 元 / 月", "69人民元 / 月", "CNY 69 / month"), x: 430, y: 120, width: 150, size: 12, secondary: true)
        label(snapshot.headline(), y: 157, height: 38, size: state == .inactive ? 24 : 27, bold: true)
        let subtitle: String
        switch state {
        case .inactive: subtitle = L10n.t("69 元 / 月 · 思考与解释已包含", "69人民元 / 月 · 思考・解説込み", "CNY 69 / month · reasoning and explanations included")
        case .expired: subtitle = L10n.t("重新开通后开始新的 30 天。已有记录仍可查看。", "再購入で新しい30日間が始まります。保存済みの回答は閲覧できます。", "Start a new 30-day period. Saved answers remain available.")
        case .active: subtitle = L10n.t("可使用求解、思考和解释。", "解答・思考・解説を利用できます。", "Solving, reasoning and explanations included.")
        }
        label(snapshot.dailyNotice(at: now) ?? subtitle, y: 207, height: 42, bold: snapshot.dailyNotice(at: now) != nil, secondary: snapshot.dailyNotice(at: now) == nil)
        button(exhausted ? L10n.t("等待每日重置", "リセット待ち", "Await daily reset") : active ? L10n.t("开始练习", "練習を始める", "Start practicing") : L10n.t("获取 Plus", "Plus を入手", "Get Plus"),
               x: 52, y: 265, width: 156, action: active ? #selector(practice) : #selector(purchase), enabled: !exhausted)
        button(L10n.t("订阅方案", "プランを見る", "View plan"), x: 220, y: 265, width: 150, action: #selector(purchase))
        label(L10n.t("一次付款 · 不自动续费", "一回払い · 自動更新なし", "One payment · no auto-renewal"), x: 386, y: 274, width: 204, size: 11, secondary: true)

        card(y: 334, height: expanded ? 174 : 58)
        let disclosure = NSButton(title: (expanded ? "▾  " : "▸  ") + L10n.t("订阅详情", "プランの詳細", "Subscription details"), target: self, action: #selector(toggleDetails))
        disclosure.isBordered = false
        disclosure.alignment = .left
        disclosure.font = .systemFont(ofSize: 13, weight: .medium)
        disclosure.frame = NSRect(x: 52, y: 348, width: 532, height: 28)
        disclosure.setAccessibilityValue(expanded ? "expanded" : "collapsed")
        content.addSubview(disclosure)
        if expanded {
            label(L10n.t("每天 600 次成功求解", "1日600回の解答", "600 successful solves per day"), y: 394, bold: true)
            label(L10n.t("low / high / max 共用；解释、失败及系统重试不额外计次。\n北京时间每日 00:00 重置，不累计。", "low / high / max 共通。解説・失敗・自動再試行は追加消費なし。\n北京時間の毎日00:00にリセット。繰り越しなし。", "Shared by low / high / max. Explanations, failures and automatic retries add no extra count.\nResets daily at 00:00 Beijing time; no rollover."), y: 426, height: 44, size: 11, secondary: true)
            if let expiresAt = snapshot.expiresAt {
                label(L10n.t("到期时间：", "終了時刻：", "Expires: ") + snapshot.dateLabel(expiresAt, includeTime: true) + L10n.t("（本地时间）", "（現地時間）", " (local time)"), y: 473, height: 20, size: 11, secondary: true)
            }
        }
        let rulesY: CGFloat = expanded ? 524 : 408
        card(y: rulesY, height: 162)
        label(L10n.t("使用说明", "利用について", "Usage notes"), y: rulesY + 16, bold: true)
        label(L10n.t("答案和解释可反复查看，失败可重试。\n仅限本人使用，不支持账号共享或脚本批量请求。\n异常请求可能短暂限流或要求验证，误判可申请复核。", "保存済みの回答・解説は再閲覧できます。失敗時は再試行できます。\n本人の対策用。共有・自動一括呼び出しは対象外です。\n異常なリクエストは一時制限・確認の対象です。再審査を申請できます。", "Revisit saved answers and explanations; retry failed requests.\nPersonal interactive study only; no sharing or automated bulk requests.\nUnusual requests may be throttled or require verification. Review is available."), y: rulesY + 48, height: 99, size: 12, secondary: true)
        let previewY = rulesY + 181
        label(L10n.t("本地设计预览 · 示例账户 · 不会付款或调用模型", "ローカルプレビュー · サンプル · 決済・モデル呼び出しなし", "Local preview · sample account · no payments or model calls"), x: 36, y: previewY, width: 568, size: 11, secondary: true)
        let selector = NSPopUpButton(frame: NSRect(x: 32, y: previewY + 29, width: 222, height: 30))
        selector.addItems(withTitles: [L10n.t("预览：使用中", "利用中", "Preview: active"), L10n.t("预览：未开通", "未購入", "Preview: not activated"), L10n.t("预览：已到期", "期限切れ", "Preview: expired"), L10n.t("预览：接近每日上限", "上限に近い", "Preview: near daily limit"), L10n.t("预览：今日已用完", "本日上限に到達", "Preview: daily limit reached")])
        selector.selectItem(at: selectedState)
        selector.target = self; selector.action = #selector(changeState(_:))
        content.addSubview(selector)
        label(actionMessage, x: 36, y: previewY + 70, width: 568, height: 40, size: 11, secondary: true)
        content.frame = NSRect(x: 0, y: 0, width: 640, height: previewY + 125)
        onStatusChange?(snapshot.headline())
    }

    @objc private func toggleDetails() { expanded.toggle(); render() }
    @objc private func changeState(_ sender: NSPopUpButton) {
        selectedState = sender.indexOfSelectedItem
        snapshot = MonthPassPreview.fixture(selectedState)
        actionMessage = ""
        render()
    }
    @objc private func purchase() {
        guard MonthPassPreview.isEnabled else { return }
        var components = URLComponents(url: MonthPassPreview.purchaseURL, resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "lang", value: L10n.t("zh", "ja", "en"))]
        if let url = components.url { NSWorkspace.shared.open(url) }
    }
    @objc private func practice() {
        guard snapshot.state(at: Date()) == .active, snapshot.dailyStatus(at: Date()) != .exhausted else { render(); return }
        actionMessage = L10n.t("预览模式：这里会开始截图练习。本次不会截图或调用模型。", "プレビュー：ここから練習を開始します。撮影・モデル呼び出しは行いません。", "Preview: this starts a practice capture. No screenshot or model call is made here.")
        render()
    }
}

private final class PassFlippedView: NSView { override var isFlipped: Bool { true } }

private final class PassCardView: NSView {
    var accent = false
    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        let path = NSBezierPath(roundedRect: bounds.insetBy(dx: 0.5, dy: 0.5), xRadius: 16, yRadius: 16)
        (accent ? NSColor.controlAccentColor.withAlphaComponent(0.07) : NSColor.controlBackgroundColor.withAlphaComponent(0.5)).setFill()
        path.fill()
        NSColor.separatorColor.withAlphaComponent(0.35).setStroke()
        path.lineWidth = 1; path.stroke()
    }
}
