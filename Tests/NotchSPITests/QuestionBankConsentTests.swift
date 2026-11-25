import AppKit
import XCTest
@testable import NotchSPI

/// 帮助改进答题: when a request may carry `question_bank_v1`, and the setting behind it.
final class QuestionBankConsentTests: XCTestCase {
    private func config(_ fields: String) throws -> NotchClientConfig {
        let json = """
        {"schema_version":1,"revision":"qb","objective_result_v1":{"variant":"control","protocol":null,"prompt_variant":"legacy"},
         "telemetry":{"enabled":true,"max_batch_size":50,"max_queue_age_days":7}\(fields)}
        """
        return try JSONDecoder().decode(NotchClientConfig.self, from: Data(json.utf8))
    }

    func testOnlyABooleanTrueInTheRemoteConfigTurnsTheFlagOn() throws {
        let missing = try config("")
        XCTAssertNil(missing.questionBankV1, "an older service sends no field")
        XCTAssertFalse(missing.sendsQuestionBank(mode: "tutor", official: true, localEnabled: true))
        XCTAssertFalse(try config(#","question_bank_v1":false"#).sendsQuestionBank(mode: "tutor", official: true, localEnabled: true))
        XCTAssertTrue(try config(#","question_bank_v1":true"#).sendsQuestionBank(mode: "tutor", official: true, localEnabled: true))
        XCTAssertFalse(NotchClientConfig.base.sendsQuestionBank(mode: "tutor", official: true, localEnabled: true), "the fallback config is off")
        // A non-boolean value does not decode at all, so the cached or base config (off) stays in use.
        XCTAssertThrowsError(try config(#","question_bank_v1":"true""#))
        XCTAssertThrowsError(try config(#","question_bank_v1":1"#))
    }

    func testAllFourConditionsAreRequired() throws {
        let on = try config(#","question_bank_v1":true"#), off = try config("")
        for mode in ["tutor", "personality"] {
            for official in [true, false] {
                for local in [true, false] {
                    for remote in [on, off] {
                        let expected = mode == "tutor" && official && local && remote.questionBankV1 == true
                        XCTAssertEqual(remote.sendsQuestionBank(mode: mode, official: official, localEnabled: local), expected,
                                       "\(mode) official=\(official) local=\(local) remote=\(String(describing: remote.questionBankV1))")
                    }
                }
            }
        }
    }

    func testTheRequestBodyCarriesTheFlagOnlyWhenAsked() throws {
        func body(_ flag: Bool?) throws -> [String: Any] {
            let request = flag.map {
                OfficialAPI.makeCaptureRequest(baseURL: "https://example.com", deviceToken: "dev_test",
                                               prompt: CapturePrompt(system: "S", task: "T"), imagesBase64: ["QUJD"], questionBankV1: $0)
            } ?? OfficialAPI.makeCaptureRequest(baseURL: "https://example.com", deviceToken: "dev_test",
                                                prompt: CapturePrompt(system: "S", task: "T"), imagesBase64: ["QUJD"])
            return try XCTUnwrap(try JSONSerialization.jsonObject(with: XCTUnwrap(request.httpBody)) as? [String: Any])
        }
        XCTAssertEqual(try body(true)["question_bank_v1"] as? Bool, true)
        XCTAssertNil(try body(false)["question_bank_v1"])
        XCTAssertNil(try body(nil)["question_bank_v1"], "callers that do not ask, such as recovery, never send it")
        let with = try body(true), without = try body(false)
        XCTAssertEqual(Set(with.keys).subtracting(without.keys), ["question_bank_v1"], "nothing else in the request changes")
    }

    @MainActor func testTheSettingIsOnUntilTurnedOffAndStaysOff() throws {
        let suite = "notchspi.test.questionbank." + UUID().uuidString
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        XCTAssertNil(defaults.object(forKey: Settings.questionBankSharingKey))
        XCTAssertTrue(Settings(defaults: defaults).questionBankSharingEnabled, "new installs and upgrades start on")
        Settings(defaults: defaults).questionBankSharingEnabled = false
        XCTAssertFalse(Settings(defaults: defaults).questionBankSharingEnabled)
        XCTAssertNotEqual(Settings.questionBankSharingKey, ProductTelemetry.sharingKey, "a consent of its own")
    }

    @MainActor func testTheGeneralPageToggleWritesTheSettingAndResynchronizes() throws {
        let previous = Settings.shared.questionBankSharingEnabled
        defer { Settings.shared.questionBankSharingEnabled = previous }
        Settings.shared.questionBankSharingEnabled = true
        let controller = MainSettingsWindowController()
        defer { controller.close() }
        controller.open(page: .general)
        let page = try XCTUnwrap(controller.qaVisiblePage)
        let toggle = try XCTUnwrap(descendants(page).first { $0.identifier?.rawValue == "settings.questionBank" } as? SettingsToggleButton)
        XCTAssertEqual(toggle.state, .on)
        XCTAssertTrue(toggle.accessibilityPerformPress())
        XCTAssertFalse(Settings.shared.questionBankSharingEnabled)
        Settings.shared.questionBankSharingEnabled = true
        controller.show(page: .hotkeys)
        controller.show(page: .general)
        XCTAssertEqual(toggle.state, .on, "returning to the page reads the stored value")
        let telemetry = try XCTUnwrap(descendants(page).compactMap { $0 as? SettingsToggleButton }.first {
            $0.title == L10n.t("共享匿名可靠性数据", "匿名の信頼性データを共有", "Share anonymous reliability data")
        })
        XCTAssertLessThan(telemetry.frame.minY, toggle.frame.minY, "placed right after reliability sharing")
    }

    private func descendants(_ view: NSView) -> [NSView] {
        view.subviews + view.subviews.flatMap(descendants)
    }
}
