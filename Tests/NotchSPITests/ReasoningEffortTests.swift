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
        for (effort, mapped) in [("low", "low"), ("high", "medium"), ("max", "high")] {
            defaults.set(effort, forKey: "reasoningEffort") // Existing user's persisted value.
            XCTAssertEqual(Settings(defaults: defaults).reasoningEffort, effort)
            XCTAssertEqual(APIKeyRunner.terraReasoningEffort(Settings(defaults: defaults).reasoningEffort), mapped)
            XCTAssertEqual(defaults.string(forKey: "reasoningEffort"), effort)
        }
        defaults.set("invalid", forKey: "reasoningEffort")
        XCTAssertEqual(settings.reasoningEffort, "low")
    }

    func testTerraThreeSlotsSingleAndMultipleImagesPreserveTheBusinessInput() throws {
        let prompt = CapturePrompt(system: "unchanged system", task: "unchanged task")
        for (selection, expected) in [("low", "low"), ("high", "medium"), ("max", "high")] {
            for images in [["AA=="], ["AA==", "BB==", "CC==", "DD=="]] {
                let request = try XCTUnwrap(APIKeyRunner.makeRequest(proto: .openai, endpoint: APIKeyRunner.openAIEndpoint,
                    apiKey: "offline", model: APIKeyRunner.terraModel, prompt: prompt, imagesBase64: images,
                    disableThinking: true, temperature: 0, reasoningEffort: selection))
                let body = try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(request.httpBody)) as? [String: Any])
                XCTAssertEqual(body["model"] as? String, "gpt-6.1-terra")
                XCTAssertEqual(body["reasoning_effort"] as? String, expected)
                XCTAssertEqual(body["max_completion_tokens"] as? Int, 8192)
                XCTAssertEqual(body["service_tier"] as? String, "default")
                XCTAssertNil(body["thinking"]); XCTAssertNil(body["temperature"])
                let messages = try XCTUnwrap(body["messages"] as? [[String: Any]])
                XCTAssertEqual(messages[0]["role"] as? String, "developer")
                XCTAssertEqual(messages[0]["content"] as? String, prompt.system)
                let content = try XCTUnwrap(messages[1]["content"] as? [[String: Any]])
                XCTAssertEqual(content.count, images.count + 1)
                for (part, bytes) in zip(content.dropFirst(), images) {
                    XCTAssertEqual(part["image_url"] as? [String: String], ["url": "data:image/jpeg;base64,\(bytes)", "detail": "high"])
                }
                XCTAssertEqual(request.timeoutInterval, 120)
            }
        }
        XCTAssertEqual(APIKeyRunner.terraReasoningEffort(nil), "low")
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
