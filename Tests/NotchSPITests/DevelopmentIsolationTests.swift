import XCTest
@testable import NotchSPI

private final class MemoryAccess {
    private(set) var reads = 0
    private(set) var writes = 0
    private var values: [String: String]
    init(_ values: [String: String] = [:]) { self.values = values }
    var access: KeychainStore.Access {
        KeychainStore.Access(
            read: { [self] account in
                self.reads += 1
                guard let value = self.values[account] else { return .missing }
                return .value(value)
            },
            write: { [self] value, account in
                self.writes += 1
                if let value, !value.isEmpty { self.values[account] = value }
                else { self.values.removeValue(forKey: account) }
                return true
            }
        )
    }
}

final class DevelopmentIsolationTests: XCTestCase {
    private let dev = DevelopmentIsolation.devBundleID
    private let production = "com.rottesya.notchspi"
    private let productionAddress = OfficialAPI.defaultBaseURL

    private func access(bundleID: String, environment: [String: String], system: MemoryAccess, ephemeral: MemoryAccess) -> KeychainStore.Access {
        DevelopmentIsolation.credentialAccess(
            ephemeral: DevelopmentIsolation.forcesEphemeralCredentials(bundleID: bundleID, environment: environment),
            ephemeralStore: ephemeral.access,
            systemStore: system.access
        )
    }

    func testDevBundleUsesEphemeralCredentialsWithoutTheIsolationVariable() {
        let system = MemoryAccess(["official.deviceToken": "production-token"])
        let ephemeral = MemoryAccess()
        let chosen = access(bundleID: dev, environment: [:], system: system, ephemeral: ephemeral)
        XCTAssertEqual(chosen.read("official.deviceToken"), .missing)
        XCTAssertTrue(chosen.write("launch-token", "official.deviceToken"))
        XCTAssertEqual(system.reads, 0)
        XCTAssertEqual(system.writes, 0)
        XCTAssertEqual(ephemeral.reads, 1)
        XCTAssertEqual(ephemeral.writes, 1)
    }

    func testDevBundleStaysOffProductionCredentialsWhenTheVariableIsZero() {
        let system = MemoryAccess(["official.deviceToken": "production-token", "apiKey.codex": "sk-live"])
        let ephemeral = MemoryAccess()
        let chosen = access(
            bundleID: dev,
            environment: ["NSPI_QA_EPHEMERAL": "0"],
            system: system,
            ephemeral: ephemeral
        )
        XCTAssertEqual(chosen.read("official.deviceToken"), .missing)
        XCTAssertEqual(chosen.read("apiKey.codex"), .missing)
        XCTAssertEqual(system.reads, 0)
        XCTAssertEqual(ephemeral.reads, 2)
    }

    func testDevBundleWithoutALocalAddressMakesNoProductionRequest() {
        let arguments = ["/NotchSPI Dev"]
        let message = DevelopmentIsolation.refusal(bundleID: dev, arguments: arguments)
        XCTAssertEqual(message, DevelopmentIsolation.missingAddressMessage)
        XCTAssertTrue(message?.contains("bootstrap.sh --run") == true)
        var requested: [String] = []
        DevelopmentIsolation.deliver(
            bundleID: dev,
            arguments: arguments,
            persisted: productionAddress,
            production: productionAddress,
            request: { requested.append($0) }
        )
        XCTAssertEqual(requested, [])
        XCTAssertEqual(
            DevelopmentIsolation.resolvedServiceAddress(
                bundleID: dev,
                arguments: arguments,
                persisted: productionAddress,
                production: productionAddress
            ),
            ""
        )
        let endpoint = DevelopmentIsolation.endpoint(
            bundleID: dev, base: "", path: "v1/account", production: productionAddress)
        XCTAssertEqual(endpoint.host, "127.0.0.1")
        XCTAssertFalse(endpoint.absoluteString.contains("vercel.app"))
    }

    func testDevBundleRejectsPublicMalformedAndSpoofedLoopbackAddresses() {
        let rejected = [
            "https://notchspi-api.vercel.app",
            "http://example.com:8787",
            "http://127.0.0.1.example.com",
            "http://127.0.0.1.example.com:8787",
            "http://127.0.0.1",
            "http://localhost:8787",
            "http://[::1]:8787",
            "127.0.0.1:8787",
            "http://127.0.0.1:8787/extra",
            "http://user:secret@127.0.0.1:8787",
            "not a url",
            "",
        ]
        for raw in rejected {
            let arguments = ["/NotchSPI Dev", "-official.baseURL", raw]
            XCTAssertEqual(
                DevelopmentIsolation.refusal(bundleID: dev, arguments: arguments),
                DevelopmentIsolation.rejectedAddressMessage,
                raw
            )
            var requested: [String] = []
            DevelopmentIsolation.deliver(
                bundleID: dev,
                arguments: arguments,
                persisted: raw,
                production: productionAddress,
                request: { requested.append($0) }
            )
            XCTAssertEqual(requested, [], raw)
            let endpoint = DevelopmentIsolation.endpoint(
                bundleID: dev, base: raw, path: "v1/captures", production: productionAddress)
            XCTAssertNotEqual(endpoint.host, "notchspi-api.vercel.app", raw)
            XCTAssertFalse(endpoint.absoluteString.hasPrefix(productionAddress), raw)
        }
    }

    func testIsolatedLaunchKeepsTheOfficialLocalServiceOverSavedChannels() {
        for saved in [ServiceMode.cli, ServiceMode.customKey] {
            let arguments = [
                "/NotchSPI Dev",
                "-official.baseURL", "http://127.0.0.1:8787",
                "-serviceMode", ServiceMode.official,
            ]
            XCTAssertNil(DevelopmentIsolation.refusal(bundleID: dev, arguments: arguments), saved)
            let mode = DevelopmentIsolation.resolveServiceMode(
                bundleID: dev,
                arguments: arguments,
                persisted: saved,
                fallback: { ServiceMode.cli }
            )
            XCTAssertEqual(mode, ServiceMode.official, saved)
            var requested: [String] = []
            DevelopmentIsolation.deliver(
                bundleID: dev,
                arguments: arguments,
                persisted: saved == ServiceMode.cli ? "https://cli.example" : productionAddress,
                production: productionAddress,
                request: { requested.append($0) }
            )
            XCTAssertEqual(requested, ["http://127.0.0.1:8787"], saved)
        }
    }

    func testPersistedLoopbackDoesNotReplaceTheLaunchArgument() {
        let arguments = ["/NotchSPI Dev"]
        XCTAssertEqual(
            DevelopmentIsolation.resolvedServiceAddress(
                bundleID: dev,
                arguments: arguments,
                persisted: "http://127.0.0.1:8787",
                production: productionAddress
            ),
            ""
        )
        XCTAssertNotNil(DevelopmentIsolation.refusal(bundleID: dev, arguments: arguments))
    }

    func testProductionBundleKeepsCredentialAndChannelRouting() {
        for environment in [[String: String](), ["NSPI_QA_EPHEMERAL": "0"]] {
            let system = MemoryAccess(["official.deviceToken": "production-token"])
            let ephemeral = MemoryAccess()
            let chosen = access(bundleID: production, environment: environment, system: system, ephemeral: ephemeral)
            XCTAssertEqual(chosen.read("official.deviceToken"), .value("production-token"))
            XCTAssertEqual(system.reads, 1)
            XCTAssertEqual(ephemeral.reads, 0)
            XCTAssertNil(DevelopmentIsolation.refusal(bundleID: production, arguments: ["/NotchSPI"]))
            let mode = DevelopmentIsolation.resolveServiceMode(
                bundleID: production,
                arguments: ["/NotchSPI", "-serviceMode", ServiceMode.official],
                persisted: ServiceMode.cli,
                fallback: { ServiceMode.official }
            )
            XCTAssertEqual(mode, ServiceMode.cli)
            XCTAssertEqual(
                DevelopmentIsolation.resolvedServiceAddress(
                    bundleID: production,
                    arguments: ["/NotchSPI"],
                    persisted: "",
                    production: productionAddress
                ),
                productionAddress
            )
            XCTAssertEqual(
                DevelopmentIsolation.resolvedServiceAddress(
                    bundleID: production,
                    arguments: ["/NotchSPI"],
                    persisted: "https://staging.example/api/",
                    production: productionAddress
                ),
                "https://staging.example/api"
            )
            let endpoint = DevelopmentIsolation.endpoint(
                bundleID: production, base: "http://[", path: "v1/account", production: productionAddress)
            XCTAssertTrue(endpoint.absoluteString.hasPrefix(productionAddress), endpoint.absoluteString)
        }
        XCTAssertTrue(DevelopmentIsolation.forcesEphemeralCredentials(
            bundleID: production, environment: ["NSPI_QA_EPHEMERAL": "1"]))
    }
}
