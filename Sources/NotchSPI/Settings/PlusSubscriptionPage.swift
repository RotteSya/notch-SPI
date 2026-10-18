import AppKit

@MainActor
final class PlusSubscriptionPage: NSViewController, SettingsPage {
    private let terms = NSTextField(wrappingLabelWithString: "")
    private let price = NSTextField(wrappingLabelWithString: "")
    private let headline = NSTextField(wrappingLabelWithString: "")
    private let usage = NSTextField(wrappingLabelWithString: "")
    private let message = NSTextField(wrappingLabelWithString: "")
    private let buy = SettingsActionButton()
    private let cancel = SettingsActionButton()
    private let manage = SettingsActionButton()
    private let refresh = SettingsActionButton()
    private let allowance = SubscriptionAllowanceBar()
    #if DEBUG
    var qaSnapshot: PlusSubscription?
    func qaSetMessage(_ text: String) { message.stringValue = text; render() }
    #endif
    private var snapshot: PlusSubscription?
    private var busy = false
    private var task: Task<Void, Never>?
    private var observer: NSObjectProtocol?
    private var owner: OfficialAPI.CaptureAccount?
    private(set) var preferredHeight: CGFloat = 292
    var onHeightChange: ((CGFloat) -> Void)?

    override func loadView() {
        let root = SubscriptionSurface(frame: NSRect(x: 0, y: 0, width: 568, height: 292))
        func text(_ title: String, y: CGFloat, height: CGFloat, size: CGFloat = 13, weight: NSFont.Weight = .regular) {
            let label = NSTextField(wrappingLabelWithString: title)
            label.frame = NSRect(x: 0, y: y, width: 384, height: height)
            label.font = .systemFont(ofSize: size, weight: weight)
            root.addSubview(label)
        }
        root.addSubview(SettingsSectionRule(number: "02", title: L10n.t("订阅计划", "サブスクリプション", "Membership"), frame: NSRect(x: 0, y: 0, width: 568, height: 28)))
        text("notchSPI Plus", y: 40, height: 30, size: 20, weight: .semibold)
        price.frame = NSRect(x: 0, y: 72, width: 568, height: 28)
        price.font = .systemFont(ofSize: 15, weight: .medium)
        root.addSubview(price)
        headline.frame = NSRect(x: 0, y: 106, width: 568, height: 28)
        headline.font = .systemFont(ofSize: 14, weight: .medium)
        usage.frame = NSRect(x: 0, y: 138, width: 568, height: 24)
        usage.font = .monospacedDigitSystemFont(ofSize: 12, weight: .regular)
        usage.textColor = .secondaryLabelColor
        allowance.frame = NSRect(x: 0, y: 164, width: 568, height: 4)
        allowance.setAccessibilityLabel(L10n.t("今日 Plus 剩余额度", "本日の Plus 残り利用枠", "Plus allowance remaining today"))
        root.addSubview(allowance)
        for field in [headline, usage, message] { root.addSubview(field) }
        func button(_ control: NSButton, _ title: String, x: CGFloat, y: CGFloat, width: CGFloat, action: Selector) {
            control.title = title; control.bezelStyle = .rounded; control.target = self; control.action = action
            control.font = .systemFont(ofSize: 12, weight: .medium)
            control.frame = NSRect(x: x, y: y, width: width, height: 32); root.addSubview(control)
        }
        button(buy, L10n.t("订阅 Plus", "Plus に登録", "Subscribe to Plus"), x: 0, y: 168, width: 236, action: #selector(purchase))
        buy.prominent = true
        button(refresh, L10n.refresh, x: 456, y: 34, width: 112, action: #selector(refreshTapped))
        button(manage, L10n.t("管理账单与支付方式", "請求・支払方法を管理", "Manage billing"), x: 0, y: 168, width: 236, action: #selector(manageTapped))
        button(cancel, L10n.t("取消自动续费", "自動更新を停止", "Cancel renewal"), x: 252, y: 168, width: 316, action: #selector(cancelTapped))
        message.frame = NSRect(x: 0, y: 206, width: 568, height: 34)
        message.font = .systemFont(ofSize: 12)
        message.textColor = .secondaryLabelColor
        terms.frame = NSRect(x: 0, y: 242, width: 568, height: 44)
        terms.font = .systemFont(ofSize: 11)
        terms.textColor = .secondaryLabelColor
        root.addSubview(terms)
        view = root
        #if DEBUG
        if ProcessInfo.processInfo.environment["NSPI_QA_BALANCE"] != nil {
            qaSnapshot = PlusSubscription(available: true, status: "active", billingStatus: "active", priceCents: 6900,
                currency: "CNY", dailyLimit: 400, paidUntil: "2026-11-17T12:00:00.000Z", cancelAtPeriodEnd: false,
                dailyUsed: 12, dailyHeld: 0, dailyRemaining: 388, resetsAt: nil, canManage: true, syncFailed: false,
                serverTime: "2026-10-17T12:00:00.000Z")
        }
        #endif
        render()
    }

    func refreshIfAccountChanged() {
        guard isViewLoaded, !busy, owner != OfficialAPI.accountState.account else { return }
        render()
        if OfficialAPI.deviceToken != nil { refreshTapped() }
    }
    func pageDidShow() {
        render()
        if observer == nil {
            observer = NotificationCenter.default.addObserver(forName: NSApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
                Task { @MainActor [weak self] in self?.refreshTapped() }
            }
        }
        refreshTapped()
    }
    deinit { task?.cancel(); if let observer { NotificationCenter.default.removeObserver(observer) } }
    func refreshUsage() { render() }

    private func render() {
        guard isViewLoaded else { return }
        let previousFocus = view.window?.firstResponder as? NSView
        view.needsDisplay = true
        buy.prominent = true
        if owner != OfficialAPI.accountState.account { snapshot = nil }
        #if DEBUG
        if let qaSnapshot { snapshot = qaSnapshot }
        #endif
        let active = snapshot?.status == "active"
        var remaining = (OfficialAPI.accountState.value("allowanceSources") as? [String: Int])?["plus"] ?? snapshot?.dailyRemaining ?? 0
        #if DEBUG
        if let qaSnapshot { remaining = qaSnapshot.dailyRemaining }
        #endif
        terms.stringValue = snapshot?.cancelAtPeriodEnd == true
            ? L10n.t("自动续费已关闭，当前已付款周期内仍可使用。\n每日额度于北京时间 00:00 重置，不累计。失败不扣次。", "自動更新は停止済み。支払済み期間は利用できます。\n北京時間00:00にリセット。繰り越し・失敗時の消費なし。", "Automatic renewal is off. Access continues through your paid period.\nDaily allowances reset at midnight Beijing time. No rollover; failures don’t count.")
            : L10n.t("按月自动续费，可随时取消，已付款周期内仍可使用。\n每日额度于北京时间 00:00 重置，不累计。失败不扣次。", "毎月自動更新。いつでも解約でき、支払済み期間は利用可能。\n北京時間00:00にリセット。繰り越しなし。失敗は消費なし。", "Renews monthly. Cancel anytime; keep access through the paid period.\nResets at midnight Beijing time. No rollover. Failed answers don’t count.")
        price.stringValue = active
            ? L10n.t("每日 400 次 · ¥69 / 月", "毎日400回 · 69人民元 / 月", "400 solves daily · CNY 69 / month")
            : L10n.t("¥69 / 月 · 每日 400 次成功求解", "69人民元 / 月 · 毎日400回の解答", "CNY 69 / month · 400 successful solves daily")
        allowance.isHidden = !active
        usage.isHidden = !active
        allowance.doubleValue = Double(remaining)
        buy.isHidden = snapshot?.canManage == true && !["canceled", "incomplete_expired", "checkout_expired"].contains(snapshot?.billingStatus ?? "")
        manage.isHidden = !buy.isHidden
        cancel.isHidden = snapshot?.canManage != true || snapshot?.cancelAtPeriodEnd == true || snapshot?.billingStatus == "canceled"
        headline.stringValue = active
            ? L10n.t("有效至 ", "有効期限：", "Paid through ") + (snapshot?.expirationLabel ?? "")
            : snapshot?.status == "pending" ? L10n.t("等待付款确认", "決済確認待ち", "Awaiting payment confirmation")
            : snapshot?.status == "expired" ? L10n.t("当前权益已到期", "現在の利用期間は終了しました", "Your paid period has ended")
            : L10n.t("尚未开通 Plus", "Plus 未登録", "No active Plus plan")
        if active, snapshot?.cancelAtPeriodEnd == true {
            headline.stringValue = L10n.t("已取消续费 · 可用至 ", "自動更新停止 · 利用期限：", "Renewal canceled · access until ") + (snapshot?.expirationLabel ?? "—")
        } else if active {
            headline.stringValue = L10n.t("预计续费日：", "次回更新予定：", "Expected renewal: ") + (snapshot?.expirationLabel ?? "—")
        }
        if ["past_due", "unpaid", "incomplete"].contains(snapshot?.billingStatus ?? "") {
            headline.stringValue = L10n.t("付款需要处理 · 请更新支付方式", "お支払い方法を確認してください", "Payment needs attention · update your payment method")
        }
        if snapshot == nil {
            headline.stringValue = busy ? L10n.t("正在同步订阅…", "プランを同期中…", "Syncing your plan…") : L10n.t("订阅状态尚未获取", "プラン情報は未取得です", "Plan status not yet available")
        }
        usage.stringValue = active ? L10n.t("今日剩余 \(remaining)/400 次", "本日の残り：\(remaining)/400回", "\(remaining)/400 solves remaining today") : ""
        buy.isEnabled = !busy && snapshot?.available == true && (snapshot?.canManage != true || ["canceled", "incomplete_expired", "checkout_expired"].contains(snapshot?.billingStatus ?? ""))
        buy.title = snapshot?.status == "pending" ? L10n.t("继续原付款", "決済を再開", "Resume payment") : L10n.t("订阅 Plus", "Plus に登録", "Subscribe to Plus")
        cancel.isEnabled = !busy && snapshot?.canManage == true && snapshot?.cancelAtPeriodEnd == false && snapshot?.billingStatus != "canceled"
        manage.isEnabled = !busy && snapshot?.canManage == true
        manage.title = ["past_due", "unpaid", "incomplete"].contains(snapshot?.billingStatus ?? "")
            ? L10n.t("更新支付方式", "支払方法を更新", "Update payment method")
            : L10n.t("管理订阅与账单", "プラン・請求を管理", "Manage plan & billing")
        refresh.isEnabled = !busy
        refresh.title = busy ? L10n.t("同步中…", "同期中…", "Syncing…") : L10n.refresh
        // Hidden state rows take no space. Keep actions and legal details together.
        let actionY: CGFloat = active ? 184 : 148
        for button in [buy, manage, cancel] { button.frame.origin.y = actionY }
        let hasMessage = !message.stringValue.isEmpty
        message.isHidden = !hasMessage
        message.frame.origin.y = actionY + 38
        terms.frame.origin.y = actionY + (hasMessage ? 90 : 50)
        (view as? SubscriptionSurface)?.dividerY = terms.frame.minY - 8
        let height = terms.frame.maxY + 16
        if preferredHeight != height {
            preferredHeight = height
            view.setFrameSize(NSSize(width: 568, height: height))
            onHeightChange?(height)
        }
        // A live account refresh can replace the focused purchase/cancel action.
        // Keep keyboard navigation on an available control within this same section.
        if let previousFocus, previousFocus.isDescendant(of: view),
           previousFocus.isHiddenOrHasHiddenAncestor || (previousFocus as? NSControl)?.isEnabled == false {
            if let replacement = [manage, buy, refresh].first(where: { !$0.isHidden && $0.isEnabled }) {
                view.window?.makeFirstResponder(replacement)
            }
        }
    }
    private func perform(_ action: OfficialAPI.PlusAction) {
        #if DEBUG
        if qaSnapshot != nil { return }
        #endif
        guard !busy else { return }
        guard OfficialAPI.deviceToken != nil else {
            message.stringValue = L10n.t("正在连接账户。连接完成后会自动同步订阅。", "接続後、プランを自動で同期します。", "Your plan will sync automatically once your account connects.")
            render(); return
        }
        let actionFocus = (view.window?.firstResponder as? NSControl).flatMap { $0.isDescendant(of: view) ? $0 : nil }
        busy = true; message.stringValue = L10n.t("正在核对…", "確認中…", "Checking…"); render()
        task = Task { @MainActor [weak self] in
            guard let self else { return }
            defer {
                busy = false; render()
                if let actionFocus, let window = view.window,
                   window.firstResponder === window || window.firstResponder === actionFocus {
                    let replacement = !actionFocus.isHiddenOrHasHiddenAncestor && actionFocus.isEnabled
                        ? actionFocus : [manage, buy, refresh].first { !$0.isHidden && $0.isEnabled }
                    if let replacement { window.makeFirstResponder(replacement) }
                }
            }
            do {
                let account = OfficialAPI.accountState.account
                let data = try await OfficialAPI.plusRequest(action)
                guard account == OfficialAPI.accountState.account else { throw OfficialAccountFailure.changed }
                owner = account
                if action == .checkout || action == .portal {
                    let url = try OfficialAPI.plusDestination(data)
                    guard NSWorkspace.shared.open(url) else { throw OfficialAccountFailure.invalidResponse }
                    if action == .checkout {
                        snapshot = try OfficialAPI.plusSnapshot(await OfficialAPI.plusRequest(.status))
                    }
                    message.stringValue = L10n.t("在浏览器中完成操作，返回后自动核对。付款返回页不代表已到账。", "ブラウザで操作を完了してください。戻ると自動確認します。", "Complete the action in your browser. We’ll check again when you return; the return page alone does not confirm payment.")
                } else {
                    snapshot = try OfficialAPI.plusSnapshot(data)
                    message.stringValue = snapshot?.syncFailed == true
                        ? L10n.t("暂时无法核对最新付款状态，请稍后刷新。", "最新の決済状態を確認できません。後で更新してください。", "Could not verify the latest billing status. Please refresh later.")
                        : snapshot?.available == false ? L10n.t("Plus 暂未开放购买。已有订阅仍可管理。", "Plus の新規購入は現在できません。既存の契約は管理できます。", "Plus enrollment is not currently available. Existing subscriptions can still be managed.") : ""
                    _ = await OfficialAPI.refreshAccount()
                }
            } catch {
                message.stringValue = OfficialAPI.deviceToken == nil
                    ? L10n.t("请在下方连接官方账户，然后重试。", "先にアカウント画面で接続してください。", "Connect your account below, then retry.") : error.localizedDescription
            }
        }
    }
    @objc private func refreshTapped() { perform(.status) }
    @objc private func purchase() { perform(.checkout) }
    @objc private func manageTapped() { perform(.portal) }
    @objc private func cancelTapped() {
        let alert = NSAlert()
        alert.messageText = L10n.t("取消 Plus 自动续费？", "Plus の自動更新を停止しますか？", "Cancel Plus renewal?")
        alert.informativeText = L10n.t("已付款周期内仍可使用，到期后不再自动扣款。", "支払済み期間は利用できます。次回の自動請求を停止します。", "Keep access through your paid period. You will not be charged automatically at renewal.")
        alert.addButton(withTitle: L10n.t("保留订阅", "プランを維持", "Keep subscription"))
        alert.addButton(withTitle: L10n.t("取消续费", "自動更新を停止", "Cancel renewal"))
        guard let window = view.window else { return }
        alert.beginSheetModal(for: window) { [weak self] response in
            guard let self else { return }
            if let window = self.view.window { window.makeFirstResponder(self.cancel) }
            if response == .alertSecondButtonReturn { self.perform(.cancel) }
        }
    }
}

/// A quiet, resolution-independent material; redraws with system appearance and contrast.
private final class SubscriptionSurface: NSView {
    var dividerY: CGFloat = 232 { didSet { needsDisplay = true } }
    override var isFlipped: Bool { true }
    override func viewDidChangeEffectiveAppearance() { super.viewDidChangeEffectiveAppearance(); needsDisplay = true }
    override func draw(_ dirtyRect: NSRect) {
        let divider = NSBezierPath()
        divider.move(to: NSPoint(x: 0, y: dividerY)); divider.line(to: NSPoint(x: bounds.width, y: dividerY))
        NSColor.labelColor.withAlphaComponent(0.10).setStroke()
        divider.lineWidth = 0.5; divider.stroke()
    }
}

/// The allowance inherits the chosen accent instead of introducing a second system color.
private final class SubscriptionAllowanceBar: NSView {
    var doubleValue: Double = 0 { didSet { needsDisplay = true } }
    override func isAccessibilityElement() -> Bool { true }
    override func accessibilityRole() -> NSAccessibility.Role? { .progressIndicator }
    override func accessibilityValue() -> Any? { "\(Int(doubleValue)) / 400" }
    override func viewDidChangeEffectiveAppearance() { super.viewDidChangeEffectiveAppearance(); needsDisplay = true }
    override func draw(_ dirtyRect: NSRect) {
        NSColor.labelColor.withAlphaComponent(0.10).setFill()
        NSBezierPath(roundedRect: bounds, xRadius: 2, yRadius: 2).fill()
        let remaining = bounds.width * CGFloat(min(1, max(0, doubleValue / 400)))
        guard remaining > 0 else { return }
        let fill = NSBezierPath(roundedRect: NSRect(x: 0, y: 0, width: remaining, height: bounds.height), xRadius: 2, yRadius: 2)
        NotchPalette.accent.setFill(); fill.fill()
    }
}
