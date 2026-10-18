import Foundation

struct PlusSubscription: Decodable, Equatable {
    let available: Bool
    let status: String
    let billingStatus: String
    let priceCents: Int
    let currency: String
    let dailyLimit: Int
    let paidUntil: String?
    let cancelAtPeriodEnd: Bool
    let dailyUsed: Int
    let dailyHeld: Int
    let dailyRemaining: Int
    let resetsAt: String?
    let canManage: Bool
    let syncFailed: Bool
    let serverTime: String
    enum CodingKeys: String, CodingKey {
        case available, status, currency
        case billingStatus = "billing_status", priceCents = "price_cents", dailyLimit = "daily_limit"
        case paidUntil = "paid_until", cancelAtPeriodEnd = "cancel_at_period_end"
        case dailyUsed = "daily_used", dailyHeld = "daily_held", dailyRemaining = "daily_remaining"
        case resetsAt = "resets_at", canManage = "can_manage", syncFailed = "sync_failed", serverTime = "server_time"
    }
    var isValid: Bool {
        priceCents == 6900 && currency == "CNY" && dailyLimit == 400
            && ["active", "inactive", "expired", "pending"].contains(status)
            && Self.parseDate(serverTime) != nil
            && (paidUntil == nil || Self.parseDate(paidUntil!) != nil)
            && (resetsAt == nil || Self.parseDate(resetsAt!) != nil)
            && [dailyUsed, dailyHeld, dailyRemaining].allSatisfy { (0...400).contains($0) }
            && (status != "active" || (paidUntil != nil && dailyUsed + dailyHeld + dailyRemaining == 400))
    }
    private static func parseDate(_ value: String) -> Date? {
        let parser = ISO8601DateFormatter()
        parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = parser.date(from: value) { return date }
        parser.formatOptions = [.withInternetDateTime]
        return parser.date(from: value)
    }
    var expirationLabel: String? {
        guard let paidUntil else { return nil }
        guard let date = Self.parseDate(paidUntil) else { return nil }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: L10n.t("zh_CN", "ja_JP", "en_US"))
        formatter.dateStyle = .medium; formatter.timeStyle = .short
        return formatter.string(from: date)
    }
}

extension OfficialAPI {
    enum PlusAction { case status, checkout, cancel, portal }
    static func plusRequest(_ action: PlusAction, environment: AccountEnvironment = .live) async throws -> Data {
        switch action {
        case .status: return try await plusStatusData(environment: environment)
        case .checkout: return try await plusCheckoutData(environment: environment)
        case .cancel: return try await plusCancelData(environment: environment)
        case .portal: return try await plusPortalData(environment: environment)
        }
    }
    private static func plusStatusData(environment: AccountEnvironment) async throws -> Data {
        let ticket = try environment.state.prepareRefresh()
        var request = URLRequest(url: endpointURL(base: ticket.account.baseURL, path: "v1/plus"))
        request.httpMethod = "GET"
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("Bearer " + ticket.account.token, forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 25
        let (code, data) = try await readAccountHTTP(request, session: environment.session)
        try Task.checkCancellation()
        guard environment.state.matches(ticket.account) else { throw OfficialAccountFailure.changed }
        guard code == 200 else {
            throw NSError(domain: "NotchSPI.Plus", code: code, userInfo: [NSLocalizedDescriptionKey: localizedErrorBody(data, statusCode: code)])
        }
        return data
    }
    private static func plusCheckoutData(environment: AccountEnvironment) async throws -> Data {
        let ticket = try environment.state.prepareRefresh()
        var request = URLRequest(url: endpointURL(base: ticket.account.baseURL, path: "v1/plus/checkout"))
        request.httpMethod = "POST"
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("Bearer " + ticket.account.token, forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 25
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = Data("{}".utf8)
        let (code, data) = try await readAccountHTTP(request, session: environment.session)
        try Task.checkCancellation()
        guard environment.state.matches(ticket.account) else { throw OfficialAccountFailure.changed }
        guard code == 200 else {
            throw NSError(domain: "NotchSPI.Plus", code: code, userInfo: [NSLocalizedDescriptionKey: localizedErrorBody(data, statusCode: code)])
        }
        return data
    }
    private static func plusCancelData(environment: AccountEnvironment) async throws -> Data {
        let ticket = try environment.state.prepareRefresh()
        var request = URLRequest(url: endpointURL(base: ticket.account.baseURL, path: "v1/plus/cancel"))
        request.httpMethod = "POST"
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("Bearer " + ticket.account.token, forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 25
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = Data("{}".utf8)
        let (code, data) = try await readAccountHTTP(request, session: environment.session)
        try Task.checkCancellation()
        guard environment.state.matches(ticket.account) else { throw OfficialAccountFailure.changed }
        guard code == 200 else {
            throw NSError(domain: "NotchSPI.Plus", code: code, userInfo: [NSLocalizedDescriptionKey: localizedErrorBody(data, statusCode: code)])
        }
        return data
    }
    private static func plusPortalData(environment: AccountEnvironment) async throws -> Data {
        let ticket = try environment.state.prepareRefresh()
        var request = URLRequest(url: endpointURL(base: ticket.account.baseURL, path: "v1/plus/portal"))
        request.httpMethod = "POST"
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("Bearer " + ticket.account.token, forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 25
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = Data("{}".utf8)
        let (code, data) = try await readAccountHTTP(request, session: environment.session)
        try Task.checkCancellation()
        guard environment.state.matches(ticket.account) else { throw OfficialAccountFailure.changed }
        guard code == 200 else {
            throw NSError(domain: "NotchSPI.Plus", code: code, userInfo: [NSLocalizedDescriptionKey: localizedErrorBody(data, statusCode: code)])
        }
        return data
    }
    static func plusSnapshot(_ data: Data) throws -> PlusSubscription {
        let value = try JSONDecoder().decode(PlusSubscription.self, from: data)
        guard value.isValid else { throw OfficialAccountFailure.invalidResponse }
        return value
    }
    static func plusDestination(_ data: Data) throws -> URL {
        struct Destination: Decodable { let url: String }
        let value = try JSONDecoder().decode(Destination.self, from: data)
        #if DEBUG
        if Bundle.main.bundleIdentifier == DevelopmentIsolation.devBundleID,
           let url = URL(string: value.url), url.scheme == "http", url.host == "127.0.0.1", url.port == 43182,
           url.user == nil, url.password == nil, url.path.hasPrefix("/preview/") { return url }
        #endif
        guard let url = URL(string: value.url), url.scheme == "https", url.user == nil, url.password == nil,
              ["checkout.stripe.com", "billing.stripe.com"].contains(url.host ?? "") else { throw OfficialAccountFailure.invalidResponse }
        return url
    }
}
