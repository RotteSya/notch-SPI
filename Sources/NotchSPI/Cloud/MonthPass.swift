import Foundation

/// Presentation contract for the proposed pass. Does not grant or settle an entitlement.
struct MonthPassSnapshot: Equatable {
    static let priceCNY = 69
    static let durationDays = 30
    static let dailySolveLimit = 600
    static let dailyWarningThreshold = 540

    let activatedAt: Date?
    let expiresAt: Date?
    var dailySolvesUsed: Int = 0
    var usageRecordedAt: Date? = nil

    private var quotaCalendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Shanghai")!
        return calendar
    }

    func usedToday(at now: Date) -> Int {
        guard let usageRecordedAt, quotaCalendar.isDate(usageRecordedAt, inSameDayAs: now) else { return 0 }
        return max(0, dailySolvesUsed)
    }

    func nextReset(at now: Date) -> Date {
        quotaCalendar.date(byAdding: .day, value: 1, to: quotaCalendar.startOfDay(for: now))!
    }

    enum DailyStatus { case normal, nearLimit, exhausted }
    func dailyStatus(at now: Date) -> DailyStatus {
        let used = usedToday(at: now)
        if used >= Self.dailySolveLimit { return .exhausted }
        return used >= Self.dailyWarningThreshold ? .nearLimit : .normal
    }

    func dailyNotice(at now: Date) -> String? {
        guard state(at: now) == .active else { return nil }
        let remaining = max(0, Self.dailySolveLimit - usedToday(at: now))
        switch dailyStatus(at: now) {
        case .normal: return nil
        case .nearLimit:
            return L10n.t("今日还可求解 \(remaining) 次 · 北京时间次日 00:00 重置", "本日はあと\(remaining)回 · 北京時間の翌日00:00にリセット", "\(remaining) solves left today · resets at 00:00 Beijing time")
        case .exhausted:
            return L10n.t("今日已达 600 次 · 北京时间次日 00:00 重置，已有内容仍可查看", "本日の600回に到達 · 北京時間の翌日00:00にリセット。保存済み内容は閲覧できます", "Daily limit reached · resets at 00:00 Beijing time. Saved content stays available.")
        }
    }

    enum State { case inactive, active, expired }

    func state(at now: Date) -> State {
        guard let activatedAt, let expiresAt, activatedAt <= now else { return .inactive }
        if now >= expiresAt { return .expired }
        return .active
    }


    func dateLabel(_ date: Date, includeTime: Bool = false) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: L10n.t("zh_CN", "ja_JP", "en_US"))
        formatter.dateFormat = includeTime ? "yyyy-MM-dd HH:mm" : "yyyy-MM-dd"
        return formatter.string(from: date)
    }

    func headline(at now: Date = Date()) -> String {
        switch state(at: now) {
        case .inactive: return L10n.t("尚未订阅", "未契約", "No active subscription")
        case .expired: return L10n.t("订阅已到期", "サブスクリプションの有効期限が切れました", "Your subscription has expired")
        case .active:
            return L10n.t("有效至 ", "有効期限 ", "Valid until ") + dateLabel(expiresAt!)
        }
    }
}

/// Only the isolated, offline DEBUG app can select fixtures. No production defaults,
/// Keychain credentials, payment sessions, or quotas are read or changed here.
enum MonthPassPreview {
    static var isEnabled: Bool {
        #if DEBUG
        return ProcessInfo.processInfo.environment["NSPI_QA_EPHEMERAL"] == "1"
            && CommandLine.arguments.contains("month-pass")
        #else
        return false
        #endif
    }
    static let purchaseURL = URL(string: "http://127.0.0.1:43069/month-pass?lang=zh")!

    static func fixture(_ index: Int, now: Date = Date()) -> MonthPassSnapshot {
        let start = now.addingTimeInterval(-5 * 86_400)
        return .init(activatedAt: index == 1 ? nil : start,
                     expiresAt: index == 1 ? nil : index == 2 ? now.addingTimeInterval(-86_400) : start.addingTimeInterval(30 * 86_400),
                     dailySolvesUsed: index == 3 ? 540 : index == 4 ? 600 : 126,
                     usageRecordedAt: now)
    }
}
