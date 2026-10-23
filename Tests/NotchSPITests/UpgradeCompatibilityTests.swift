import XCTest
import Security
import CryptoKit
import Carbon.HIToolbox
@testable import NotchSPI

/// Frozen 2.17 storage names, checked against tag v2.17 (677f1f7).
/// Synthetic defaults and a separate Keychain service; never touches a paid account.
final class UpgradeCompatibilityTests: XCTestCase {
    private func fixture(_ body: (UserDefaults, KeychainStore.Access, String) throws -> Void) rethrows {
        let suite = "notchspi.upgrade.test." + UUID().uuidString
        let defaults = UserDefaults(suiteName: suite)!
        let secrets = KeychainStore.Access.system(service: suite)
        defer {
            defaults.removePersistentDomain(forName: suite)
            for key in ["official.deviceToken", "official.registrationAttempt", "apiKey.codex"] {
                XCTAssertTrue(secrets.write(nil, key))
            }
        }
        try body(defaults, secrets, suite)
    }

    func test217SettingsAccountBalanceAndHotkeysSurviveRepeatedStartup() throws {
        for mode in ServiceMode.all {
            try fixture { d, secrets, suite in
                let token = "dev_upgrade_paid_fixture_217"
                XCTAssertTrue(secrets.write(token, "official.deviceToken"))
                XCTAssertTrue(secrets.write("fixture-custom-key", "apiKey.codex"))
                let binding = SHA256.hash(data: Data((OfficialAPI.defaultBaseURL + "\n" + token).utf8)).map { String(format: "%02x", $0) }.joined()
                let legacy: [String: Any] = [
                    "serviceMode": mode, "cli": "codex", "depth": "guided", "mode": "tutor",
                    "onboardingDone": true, "onboarding.v3.step": "success", "screenshotHotkeysV1": true,
                    "captureKeyCode": 18, "captureMods": Int(cmdKey | shiftKey), "captureLabel": "1",
                    "contextKeyCode": Int(kVK_F15), "contextMods": Int(controlKey), "contextLabel": "F15",
                    "captureTargetBundleID": "com.google.Chrome", "captureTargetName": "Google Chrome",
                    "apiProvider": "openai", "apiModel.codex": "user-chosen-model",
                    "apiCustomBaseURL": "https://example.invalid/v1", "appLanguage": "ja",
                    "answerFontSizePt": 17.0, "accentTheme": "violet", "collapseStay": true,
                    "collapseSeconds": 12.0, "autoCopyAnswer": true, "revealReasoning": true,
                    "personaName": "Saved persona", "personaText": "Original target description",
                    "personaLibrary": Data(#"{"personas":[{"id":"saved-217","name":"Saved persona","text":"Original target description","updatedAt":0}],"activeID":"saved-217"}"#.utf8),
                    "official.balanceQuestions": 130, "official.balanceVersion": "9",
                    "official.accountBinding": binding, "official.cliEnabled": true,
                    "official.totalQuestions": 27, "official.totalInputTokens": 12000,
                    "official.totalOutputTokens": 4000, "official.quotaBreakdown": ["trial": 30, "paid": 100]
                ]
                d.setPersistentDomain(legacy, forName: suite)
                for _ in 0..<3 {
                    let reopened = try XCTUnwrap(UserDefaults(suiteName: suite))
                    let settings = Settings(defaults: reopened, secrets: secrets)
                    settings.bootstrapFirstRunState(); settings.migrateScreenshotHotkeys()
                    let personas = PersonaStore(defaults: reopened)
                    XCTAssertEqual(personas.activeID, "saved-217")
                    XCTAssertEqual(personas.active?.text, "Original target description")
                    // Preserve the frozen production identity in this storage-only fixture;
                    // XCTest's live service address is deliberately isolated to loopback.
                    let account = OfficialAccountState(defaults: reopened, secrets: secrets,
                        baseURL: { OfficialAPI.defaultBaseURL })
                    guard case .existing(let existing) = try account.prepareRegistration() else {
                        return XCTFail("An upgrade must reuse the paid identity, never register another account")
                    }
                    XCTAssertEqual(existing, token)
                    XCTAssertEqual(account.value("balanceQuestions") as? Int, 130)
                    XCTAssertEqual(account.value("balanceVersion") as? String, "9")
                    XCTAssertEqual(settings.serviceMode, mode)
                    XCTAssertEqual(settings.apiKey(for: "codex"), "fixture-custom-key")
                    XCTAssertEqual(settings.apiModel(for: "codex"), "user-chosen-model")
                    XCTAssertEqual(settings.contextCombo.keyCode, UInt32(kVK_F15))
                    XCTAssertEqual(settings.captureCombo.keyCode, UInt32(kVK_ANSI_1))
                    XCTAssertEqual(settings.captureTargetBundleID, "com.google.Chrome")
                    XCTAssertEqual(settings.reasoningEffort, "low")
                    XCTAssertFalse(NotchOnboardingProgress(defaults: reopened).shouldPresent)
                    XCTAssertTrue(NSDictionary(dictionary: try XCTUnwrap(reopened.persistentDomain(forName: suite))).isEqual(to: legacy))
                }
            }
        }
    }

    func testTemporarilyUnavailableKeychainNeverMigratesStaleCustomKeyOrReRegisters() throws {
        try fixture { d, real, _ in
            XCTAssertTrue(real.write("dev_original_paid_217", "official.deviceToken"))
            XCTAssertTrue(real.write("current-custom-key", "apiKey.codex"))
            d.set("stale-legacy-key", forKey: "apiKey.codex")
            d.set(ServiceMode.customKey, forKey: "serviceMode")
            d.set(130, forKey: "official.balanceQuestions")
            var unavailable = true, writes = 0
            let access = KeychainStore.Access(read: { unavailable ? .unavailable(errSecInteractionNotAllowed) : real.read($0) },
                write: { value, key in writes += 1; return real.write(value, key) })
            let settings = Settings(defaults: d, secrets: access)
            let state = OfficialAccountState(defaults: d, secrets: access)
            settings.bootstrapFirstRunState()
            XCTAssertEqual(settings.apiKey(for: "codex"), "")
            XCTAssertThrowsError(try state.prepareRegistration())
            XCTAssertEqual(writes, 0)
            XCTAssertEqual(d.integer(forKey: "official.balanceQuestions"), 130)
            XCTAssertEqual(settings.serviceMode, ServiceMode.customKey)
            unavailable = false
            XCTAssertEqual(settings.apiKey(for: "codex"), "current-custom-key")
            guard case .existing(let token) = try state.prepareRegistration() else { return XCTFail("must reuse account") }
            XCTAssertEqual(token, "dev_original_paid_217")
            XCTAssertEqual(writes, 0)
        }
    }

    func testUpgradeVersionAndExistingGuideStatesStayCompatible() {
        XCTAssertTrue(UpdateChecker.isNewer("3.0", than: "2.17"))
        XCTAssertFalse(UpdateChecker.isNewer("2.17", than: "3.0"))
        fixture { d, secrets, _ in
            let settings = Settings(defaults: d, secrets: secrets)
            settings.bootstrapFirstRunState()
            XCTAssertTrue(NotchOnboardingProgress(defaults: d).shouldPresent)
            d.set(true, forKey: "onboarding.v3.dismissed")
            settings.bootstrapFirstRunState()
            XCTAssertFalse(NotchOnboardingProgress(defaults: d).shouldPresent)
            d.set(true, forKey: "onboardingDone")
            d.set(false, forKey: "onboarding.v3.dismissed")
            settings.bootstrapFirstRunState()
            XCTAssertFalse(NotchOnboardingProgress(defaults: d).shouldPresent)
        }
    }

    func testLegacyKeyMigrationFailureKeepsRecoveryCopyAndRetriesSafely() {
        fixture { d, real, _ in
            d.set("legacy-custom-key", forKey: "apiKey.codex")
            let denied = KeychainStore.Access(read: real.read, write: { _, _ in false })
            XCTAssertEqual(Settings(defaults: d, secrets: denied).apiKey(for: "codex"), "legacy-custom-key")
            XCTAssertEqual(d.string(forKey: "apiKey.codex"), "legacy-custom-key")
            XCTAssertEqual(Settings(defaults: d, secrets: real).apiKey(for: "codex"), "legacy-custom-key")
            XCTAssertNil(d.object(forKey: "apiKey.codex"))
            XCTAssertEqual(real.read("apiKey.codex"), .value("legacy-custom-key"))
        }
    }
}
