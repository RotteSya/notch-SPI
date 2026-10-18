import Foundation

/// Presentation consumes the server's disjoint ledger sources, never subtracts separately fetched totals.
struct AccountOverview {
    let heading: String
    let detail: String
    let canSolve: Bool

    init(sources: [String: Int]?, trial: FreeTrialSnapshot?, registered: Bool, rejected: Bool,
         allowPurchased: Bool, externalService: Bool) {
        if externalService {
            heading = L10n.t("当前使用自定义服务", "外部サービスを利用中", "Using your own service")
            detail = L10n.t("当前求解不消耗官方额度。Plus 的订阅与自动续费仍独立生效。", "公式の枠は消費しません。Plus の契約・自動更新は継続します。", "Answers do not use official credits. Your Plus subscription and renewal remain independent.")
            canSolve = true; return
        }
        if rejected {
            heading = L10n.t("账户暂时无法验证", "アカウントを確認できません", "Account needs verification")
            detail = L10n.t("请先刷新重试，或用已保存的恢复码恢复账户。不会自动清除你的权益。", "更新するか、保存した復元コードをお使いください。", "Retry refresh or restore with your saved recovery code. Your entitlement is not automatically removed.")
            canSolve = false; return
        }
        guard registered, let sources else {
            heading = L10n.t("正在核对可用权益", "利用枠を確認中", "Checking your available access")
            detail = L10n.t("连接后展示每日额度与长期余额；同步失败时可点刷新重试。", "接続後、毎日の枠とパック残高を表示します。", "Daily allowances and lasting credits appear after syncing. Use Refresh to retry.")
            canSolve = false; return
        }
        let free = sources["trial", default: 0], plus = sources["plus", default: 0]
        let paid = sources["purchased", default: 0], other = sources["other", default: 0]
        let next: String
        if free > 0 { next = trial?.status == .active ? L10n.t("免费体验", "無料体験", "free trial") : L10n.t("免费赠送额度", "無料枠", "free grant") }
        else if plus > 0 { next = "Plus" }
        else if other > 0 { next = L10n.t("其他可用余额", "その他の残高", "other credits") }
        else if paid > 0 && allowPurchased { next = L10n.t("已购题包", "購入パック", "purchased packs") }
        else { next = "" }
        canSolve = !next.isEmpty
        heading = canSolve ? L10n.t("下一题使用：", "次の回答：", "Next answer uses: ") + next
            : paid > 0 && !allowPurchased ? L10n.t("题包已保护，暂不自动使用", "パックの自動利用はオフ", "Pack spending is paused")
            : L10n.t("当前额度已用完", "利用枠を使い切りました", "No questions available right now")
        var lines = [L10n.t("免费剩余 \(free) 次 · Plus 今日 \(plus) 次", "無料 \(free) 回 · Plus 本日 \(plus) 回", "Free: \(free) · Plus today: \(plus)"),
                     L10n.t("长期题包 \(paid) 题 · 其他余额 \(other) 题", "購入パック \(paid) 問 · その他 \(other) 問", "Lasting packs: \(paid) · Other credits: \(other)")]
        if trial?.status == .eligible {
            lines.append(L10n.t("3 天体验尚未开始；领取后开始 72 小时计时。", "3日間の体験は未開始。受け取った時点から72時間。", "Your 3-day trial starts its 72-hour timer only when claimed."))
        } else if trial?.status == .active, let end = trial?.expirationLabel {
            lines.append(L10n.t("体验至 ", "体験期限：", "Trial ends ") + end)
        }
        lines.append(L10n.t("每日额度：北京时间 00:00 重置，不累计。", "毎日の枠は北京時間00:00にリセット。繰り越しなし。", "Daily allowances reset at midnight Beijing time; no rollover."))
        detail = lines.joined(separator: "\n")
    }
}
