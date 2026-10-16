import Foundation

/// The server receipt is the sole authority. Local onboarding completion grants no rights.
struct FreeTrialSnapshot: Codable, Equatable {
    enum Status: String, Codable { case eligible, active, expired, ineligible }
    let status: Status
    let policyVersion: String
    let dailyLimit: Int
    let activatedAt: String?
    let expiresAt: String?
    let resetsAt: String?
    let dailyUsed: Int
    let dailyHeld: Int
    let dailyRemaining: Int
    let serverTime: String
    enum CodingKeys: String, CodingKey {
        case status, policyVersion = "policy_version", dailyLimit = "daily_limit"
        case activatedAt = "activated_at", expiresAt = "expires_at", resetsAt = "resets_at"
        case dailyUsed = "daily_used", dailyHeld = "daily_held", dailyRemaining = "daily_remaining", serverTime = "server_time"
    }
    private func date(_ value: String?) -> Date? {
        guard let value, value.count <= 32 else { return nil }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: value)
    }
    var isValid: Bool {
        guard policyVersion == "trial3d400-2026-10-16", dailyLimit == 400,
              let now = date(serverTime), [dailyUsed, dailyHeld, dailyRemaining].allSatisfy({ (0...400).contains($0) }) else { return false }
        switch status {
        case .eligible, .ineligible:
            return activatedAt == nil && expiresAt == nil && resetsAt == nil && dailyUsed + dailyHeld + dailyRemaining == 0
        case .active, .expired:
            guard let start = date(activatedAt), let end = date(expiresAt), end.timeIntervalSince(start) == 72 * 3600, now >= start else { return false }
            if status == .expired { return now >= end && resetsAt == nil && dailyUsed + dailyHeld + dailyRemaining == 0 }
            return now < end && date(resetsAt).map { $0 > now && $0.timeIntervalSince(now) <= 86400 } == true
                && dailyUsed + dailyHeld + dailyRemaining == 400
        }
    }
    var expirationLabel: String? {
        guard let end = date(expiresAt) else { return nil }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: L10n.t("zh_CN", "ja_JP", "en_US"))
        formatter.dateFormat = "yyyy-MM-dd HH:mm"
        return formatter.string(from: end)
    }
    var dailyNotice: String? {
        guard status == .active, dailyUsed + dailyHeld >= 360 else { return nil }
        return L10n.t("今日免费剩余 \(dailyRemaining)/400 次 · 北京时间 00:00 重置",
                      "本日の無料枠：残り\(dailyRemaining)/400回 · 北京時間00:00にリセット",
                      "\(dailyRemaining)/400 free solves left today · resets at 00:00 Beijing time")
    }
    var exhaustedNotice: String? {
        guard status == .active, dailyRemaining == 0 else { return nil }
        if let end = date(expiresAt), let reset = date(resetsAt), end <= reset {
            return L10n.t("本次体验的免费额度已用完，可使用已购题数继续。", "体験期間の無料枠を使い切りました。購入済み残高で続けられます。", "Your trial’s free allowance is used up. You can continue with purchased credits.")
        }
        return L10n.t("今日 400 次免费额度已用完，北京时间 00:00 恢复。也可使用已购题数继续。", "本日の無料枠400回を使い切りました。北京時間00:00にリセットされます。購入済み残高でも続けられます。", "Today’s 400 free solves are used up. They reset at 00:00 Beijing time. You can also continue with purchased credits.")
    }
}

extension OfficialAPI {
    static var freeTrial: FreeTrialSnapshot? {
        guard let data = accountState.value("freeTrial") as? Data else { return nil }
        return try? JSONDecoder().decode(FreeTrialSnapshot.self, from: data)
    }

    /// A device-bound, server-idempotent mutation. A lost response can be retried safely.
    static func claimFreeTrial(environment: AccountEnvironment = .live, expectedAccount: CaptureAccount? = nil) async -> Result<FreeTrialSnapshot, OfficialAPIError> {
        do {
            try Task.checkCancellation()
            let ticket = try environment.state.prepareRefresh()
            guard expectedAccount == nil || expectedAccount == ticket.account else { throw OfficialAccountFailure.changed }
            var request = makeAccountRequest(baseURL: ticket.account.baseURL, deviceToken: ticket.account.token)
            request.url = endpointURL(base: ticket.account.baseURL, path: "v1/free-trial/claim")
            request.httpMethod = "POST"
            request.httpBody = Data("{}".utf8)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            let (code, data) = try await readAccountHTTP(request, session: environment.session)
            return try await MainActor.run {
                try Task.checkCancellation()
                guard environment.state.matches(ticket.account) else { throw OfficialAccountFailure.changed }
                guard code == 200 else {
                    return .failure(.init(message: localizedErrorBody(data, statusCode: code),
                        code: code == 404 || code == 503 ? "trial_unavailable" : code == 403 ? "trial_ineligible" : nil))
                }
                let account = try JSONDecoder().decode(OfficialAccountResponse.self, from: data)
                guard let trial = account.freeTrial, trial.isValid, [.active, .expired].contains(trial.status) else {
                    throw OfficialAccountFailure.invalidResponse
                }
                try environment.state.acceptRefresh(account, ticket: ticket)
                guard let stored = environment.state.value("freeTrial") as? Data,
                      let current = try? JSONDecoder().decode(FreeTrialSnapshot.self, from: stored), current.isValid,
                      [.active, .expired].contains(current.status) else { throw OfficialAccountFailure.invalidResponse }
                return .success(current)
            }
        } catch {
            return .failure(.init(message: L10n.t("暂时无法确认领取结果，请稍后重试。", "受け取り結果を確認できません。しばらくしてからお試しください。", "Unable to confirm your trial. Please try again shortly.")))
        }
    }
}
