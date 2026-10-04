import Foundation
import CryptoKit

/// Durable retry identity, scoped to the service and credential. Never stores bearer tokens or browser secrets.
struct PendingPurchase: Codable, Equatable {
    let id: UUID
    let packID: String
    let catalogVersion: String
    var packSnapshot: PaymentPackRemoteConfig? = nil
    var currency: String? = nil
}
struct PurchaseProgress: Decodable {
    enum State: String, Decodable { case ready, unpaid, pending, credited, expired, review }
    let state: State
    let questions: Int
    let checkoutURL: URL?
    enum CodingKeys: String, CodingKey { case state, questions; case checkoutURL = "checkout_url" }
}
struct PurchaseRecoveryStore {
    var defaults: UserDefaults = .standard
    private func key(_ account: OfficialAPI.CaptureAccount) -> String {
        let fields = [account.baseURL, account.token].map { "\($0.utf8.count):\($0)" }.joined()
        return "official.purchase." + SHA256.hash(data: Data(fields.utf8)).map { String(format: "%02x", $0) }.joined()
    }
    func pending(_ account: OfficialAPI.CaptureAccount) -> PendingPurchase? {
        guard let data = defaults.data(forKey: key(account)) else { return nil }
        return try? JSONDecoder().decode(PendingPurchase.self, from: data)
    }
    func save(_ purchase: PendingPurchase?, for account: OfficialAPI.CaptureAccount) {
        defaults.set(purchase.flatMap { try? JSONEncoder().encode($0) }, forKey: key(account))
    }
}
extension OfficialAPI {
    static func purchaseProgress(_ purchase: PendingPurchase, environment: AccountEnvironment = .live) async throws -> PurchaseProgress? {
        let account = try environment.state.prepareRefresh().account
        var request = URLRequest(url: endpointURL(base: account.baseURL, path: "v1/purchase-sessions/" + purchase.id.uuidString.lowercased()))
        request.setValue("Bearer \(account.token)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 20
        let (code, data) = try await readAccountHTTP(request, session: environment.session)
        guard environment.state.matches(account) else { throw OfficialAccountFailure.changed }
        // No server record: retry creation using exactly the same durable identity.
        if code == 404 { return nil }
        guard code == 200 else { throw OfficialAPIError(message: localizedErrorBody(data, statusCode: code)) }
        let result = try JSONDecoder().decode(PurchaseProgress.self, from: data)
        guard result.questions > 0 else { throw OfficialAccountFailure.invalidResponse }
        if let url = result.checkoutURL {
            guard url.scheme == "https", url.host != nil, url.user == nil, url.password == nil else { throw OfficialAccountFailure.invalidResponse }
        }
        return result
    }
}
