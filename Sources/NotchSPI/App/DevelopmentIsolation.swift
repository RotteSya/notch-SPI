import Foundation

/// Launch rules for the DEBUG development bundle. The decision is pure so tests can
/// supply a bundle id, environment, and arguments without opening Keychain or the network.
enum DevelopmentIsolation {
    static let devBundleID = "com.rottesya.notchspi.dev"
    static let launchAddressFlag = "-official.baseURL"
    static let launchChannelFlag = "-serviceMode"

    static var isRunningTests: Bool {
        Bundle.main.bundleIdentifier == "com.apple.dt.xctest.tool"
            || Bundle.allBundles.contains { $0.bundleURL.pathExtension == "xctest" }
    }

    static func testServiceAddress(_ address: String, runningTests: Bool) -> String {
        guard runningTests else { return address }
        return agreedLoopback(address) ?? "http://127.0.0.1:9"
    }

    static func permitsTestRequest(_ url: URL?, runningTests: Bool) -> Bool {
        guard runningTests else { return true }
        guard let url, let scheme = url.scheme, ["http", "https"].contains(scheme),
              let host = url.host, ["127.0.0.1", "::1", "[::1]"].contains(host),
              let port = url.port, (1...65535).contains(port), url.user == nil, url.password == nil else { return false }
        return true
    }

    static let missingAddressMessage = """
    开发包需要通过 ./scripts/bootstrap.sh --run 启动。
    当前进程没有合法的本机服务地址 http://127.0.0.1:<端口>，已停止初始化。
    """

    static let rejectedAddressMessage = """
    开发包需要通过 ./scripts/bootstrap.sh --run 启动。
    当前进程的服务地址不是约定的 http://127.0.0.1:<端口>，已停止初始化。
    """

    static func forcesEphemeralCredentials(bundleID: String?, environment: [String: String]) -> Bool {
        if bundleID == devBundleID { return true }
        return environment["NSPI_QA_EPHEMERAL"] == "1"
    }

    /// `[:]` selects the in-process dictionary. `nil` selects the existing Keychain service.
    static func ephemeralStorage(bundleID: String?, environment: [String: String]) -> [String: String]? {
        forcesEphemeralCredentials(bundleID: bundleID, environment: environment) ? [:] : nil
    }

    static func credentialAccess(
        ephemeral: Bool,
        ephemeralStore: KeychainStore.Access,
        systemStore: KeychainStore.Access
    ) -> KeychainStore.Access {
        ephemeral ? ephemeralStore : systemStore
    }

    static func launchArgument(_ flag: String, arguments: [String]) -> String? {
        var found: String?
        var index = 0
        while index < arguments.count {
            if arguments[index] == flag {
                let next = index + 1
                if next < arguments.count, !arguments[next].hasPrefix("-") {
                    found = arguments[next]
                }
            }
            index += 1
        }
        return found
    }

    /// The bootstrap launch address: `http://127.0.0.1:<port>`, parsed as a URL.
    /// Returns the canonical base without a trailing slash, or nil when the value is not that address.
    static func agreedLoopback(_ raw: String) -> String? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let components = URLComponents(string: trimmed) else { return nil }
        guard components.scheme?.lowercased() == "http" else { return nil }
        guard components.user == nil, components.password == nil else { return nil }
        guard components.host == "127.0.0.1", components.percentEncodedHost == "127.0.0.1" else { return nil }
        guard let port = components.port, (1...65535).contains(port) else { return nil }
        let path = components.percentEncodedPath
        guard path.isEmpty || path == "/" else { return nil }
        guard components.query == nil, components.fragment == nil else { return nil }
        return "http://127.0.0.1:\(port)"
    }

    static func refusal(bundleID: String?, arguments: [String]) -> String? {
        guard bundleID == devBundleID else { return nil }
        guard let raw = launchArgument(launchAddressFlag, arguments: arguments) else {
            return missingAddressMessage
        }
        return agreedLoopback(raw) == nil ? rejectedAddressMessage : nil
    }

    /// Development launches read the current process arguments. Every other bundle keeps the
    /// persisted address, then the production address.
    static func resolvedServiceAddress(
        bundleID: String?,
        arguments: [String],
        persisted: String,
        production: String
    ) -> String {
        if bundleID == devBundleID {
            guard let raw = launchArgument(launchAddressFlag, arguments: arguments),
                  let agreed = agreedLoopback(raw) else { return "" }
            return agreed
        }
        var stored = persisted.trimmingCharacters(in: .whitespacesAndNewlines)
        while stored.hasSuffix("/") { stored.removeLast() }
        return stored.isEmpty ? production : stored
    }

    static func launchChannel(bundleID: String?, arguments: [String]) -> String? {
        guard bundleID == devBundleID,
              let forced = launchArgument(launchChannelFlag, arguments: arguments),
              ServiceMode.all.contains(forced) else { return nil }
        return forced
    }

    static func resolveServiceMode(
        bundleID: String?,
        arguments: [String],
        persisted: String?,
        fallback: () -> String
    ) -> String {
        if let launch = launchChannel(bundleID: bundleID, arguments: arguments) { return launch }
        if let persisted, ServiceMode.all.contains(persisted) { return persisted }
        return fallback()
    }

    static func endpoint(bundleID: String?, base: String, path: String, production: String) -> URL {
        let clean = path.hasPrefix("/") ? String(path.dropFirst()) : path
        if bundleID == devBundleID {
            guard let agreed = agreedLoopback(base), let url = URL(string: agreed) else {
                return URL(string: "http://127.0.0.1:9/")!.appendingPathComponent(clean)
            }
            return url.appendingPathComponent(clean)
        }
        let url = URL(string: base) ?? URL(string: production)!
        return url.appendingPathComponent(clean)
    }

    /// Issues a request only after the development bundle has an agreed loopback address.
    static func deliver(
        bundleID: String?,
        arguments: [String],
        persisted: String,
        production: String,
        request: (String) -> Void
    ) {
        guard refusal(bundleID: bundleID, arguments: arguments) == nil else { return }
        let address = resolvedServiceAddress(
            bundleID: bundleID,
            arguments: arguments,
            persisted: persisted,
            production: production
        )
        guard !address.isEmpty else { return }
        request(address)
    }
}
