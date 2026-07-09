import Foundation
import Security

/// Minimal Keychain wrapper for the app's secrets (自定义 API Key、官方服务设备令牌).
/// Generic-password items keyed by account name, user-local and non-synchronizable —
/// unlike UserDefaults they are not a plaintext plist readable by every process under
/// the same user, and they stay out of ordinary backups.
enum KeychainStore {
    private static let service = "com.rottesya.notchspi"

    #if DEBUG
    /// Visual-QA escape hatch: with NSPI_QA_EPHEMERAL=1 all secrets live in this in-process
    /// dictionary only. The real Keychain service is SHARED with the packaged app, so QA runs
    /// must never read or write the user's actual device token / API keys.
    private static var ephemeral: [String: String]? =
        ProcessInfo.processInfo.environment["NSPI_QA_EPHEMERAL"] == "1" ? [:] : nil
    #endif

    static func read(_ account: String) -> String? {
        #if DEBUG
        if ephemeral != nil { return ephemeral?[account] }
        #endif
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data,
              let value = String(data: data, encoding: .utf8), !value.isEmpty
        else { return nil }
        return value
    }

    /// Upsert; nil or empty deletes the item. Delete-then-add keeps it idempotent.
    static func write(_ value: String?, account: String) {
        #if DEBUG
        if ephemeral != nil {
            ephemeral?[account] = (value?.isEmpty ?? true) ? nil : value
            return
        }
        #endif
        let base: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(base as CFDictionary)
        guard let value, !value.isEmpty, let data = value.data(using: .utf8) else { return }
        var add = base
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(add as CFDictionary, nil)
    }
}
