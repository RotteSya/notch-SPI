import XCTest
@testable import NotchSPI

final class ReasoningEffortTests: XCTestCase {
    func testPreferenceDefaultsToLowIndependentlyOfOldExplanationDepth() {
        let suite = "ReasoningEffortTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        defaults.set("full", forKey: "depth")
        let settings = Settings(defaults: defaults)
        XCTAssertEqual(settings.reasoningEffort, "low")
        for effort in ["low", "high", "max"] {
            settings.reasoningEffort = effort
            XCTAssertEqual(Settings(defaults: defaults).reasoningEffort, effort)
        }
        defaults.set("invalid", forKey: "reasoningEffort")
        XCTAssertEqual(settings.reasoningEffort, "low")
    }

    func testOfficialAndDirectDeepSeekRequestsCarrySelectedEffort() throws {
        let prompt = CapturePrompt(system: "system", task: "task")
        for effort in ["low", "high", "max"] {
            let official = OfficialAPI.makeCaptureRequest(baseURL: "https://example.com", deviceToken: "test",
                prompt: prompt, imagesBase64: ["AA=="], reasoningEffort: effort)
            let officialBody = try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(official.httpBody)) as? [String: Any])
            XCTAssertEqual(officialBody["reasoning_effort"] as? String, effort)
            let direct = try XCTUnwrap(APIKeyRunner.makeRequest(proto: .openai, endpoint: "https://example.com/chat/completions",
                apiKey: "test", model: "deepseek", prompt: prompt, imagesBase64: ["AA=="],
                disableThinking: true, temperature: 0, reasoningEffort: effort))
            let body = try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(direct.httpBody)) as? [String: Any])
            XCTAssertEqual(body["reasoning_effort"] as? String, effort)
            XCTAssertEqual((body["thinking"] as? [String: String])?["type"], "enabled")
            XCTAssertNil(body["temperature"])
        }
    }
}
