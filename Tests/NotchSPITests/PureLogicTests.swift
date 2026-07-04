import XCTest
@testable import NotchSPI

/// Unit tests for the app's pure, UI-free logic: GitHub-release version comparison and
/// system-prompt selection. These need no display, no AppKit windows, and no network.
final class UpdateCheckerVersionTests: XCTestCase {
    func testNormalizeStripsPrefixAndWhitespace() {
        XCTAssertEqual(UpdateChecker.normalize("v1.6"), "1.6")
        XCTAssertEqual(UpdateChecker.normalize(" V2.0 "), "2.0")
        XCTAssertEqual(UpdateChecker.normalize("1.5"), "1.5")
    }

    func testIsNewerIsNumericNotLexicographic() {
        XCTAssertTrue(UpdateChecker.isNewer("1.10", than: "1.9"))  // 10 > 9, not "1" vs "9"
        XCTAssertTrue(UpdateChecker.isNewer("2.0", than: "1.9"))
    }

    func testIsNewerTreatsMissingComponentsAsZero() {
        XCTAssertFalse(UpdateChecker.isNewer("1.5", than: "1.5.0"))
        XCTAssertTrue(UpdateChecker.isNewer("1.5.1", than: "1.5"))
    }

    func testIsNewerFalseForEqualOrOlder() {
        XCTAssertFalse(UpdateChecker.isNewer("1.6", than: "1.6"))
        XCTAssertFalse(UpdateChecker.isNewer("1.9", than: "1.10"))
    }
}

final class PromptsSelectionTests: XCTestCase {
    func testBriefDepthReturnsBriefPrompt() {
        XCTAssertEqual(Prompts.tutorText("brief"), Prompts.briefPrompt)
    }

    func testDepthClausesAreApplied() {
        XCTAssertTrue(Prompts.tutorText("full").contains("FULL WORKED SOLUTION"))
        XCTAssertTrue(Prompts.tutorText("hint").contains("HINTS ONLY"))
    }

    func testUnknownDepthFallsBackToGuided() {
        XCTAssertTrue(Prompts.tutorText("nonsense").contains("GUIDED WALKTHROUGH"))
    }

    func testSystemTextRoutesByMode() {
        let persona = Prompts.systemText(
            mode: "personality", depth: "guided",
            personaName: "A社", personaText: "creative and bold")
        XCTAssertTrue(persona.contains("creative and bold"))
        XCTAssertTrue(persona.contains("A社"))

        let tutor = Prompts.systemText(
            mode: "tutor", depth: "brief", personaName: "", personaText: "")
        XCTAssertEqual(tutor, Prompts.briefPrompt)
    }

    func testTaskInstructionDiffersByMode() {
        XCTAssertNotEqual(
            Prompts.taskInstruction(mode: "personality"),
            Prompts.taskInstruction(mode: "tutor"))
        XCTAssertTrue(Prompts.taskInstruction(mode: "tutor").contains("tutor"))
    }
}

/// The direct-API channel's pure request-building and SSE-parsing logic. No network, no keychain.
final class APIKeyRunnerTests: XCTestCase {
    func testAnthropicRequestShape() {
        let req = APIKeyRunner.makeRequest(
            cliId: "claude", apiKey: "sk-ant-test", model: "claude-opus-4-8",
            systemText: "SYS", taskText: "tutor me on the problem it shows.", imageBase64: "QUJD")
        XCTAssertEqual(req.url?.absoluteString, APIKeyRunner.anthropicEndpoint)
        XCTAssertEqual(req.value(forHTTPHeaderField: "x-api-key"), "sk-ant-test")
        XCTAssertEqual(req.value(forHTTPHeaderField: "anthropic-version"), "2023-06-01")
        let body = try! JSONSerialization.jsonObject(with: req.httpBody!) as! [String: Any]
        XCTAssertEqual(body["model"] as? String, "claude-opus-4-8")
        XCTAssertEqual(body["system"] as? String, "SYS")
        XCTAssertEqual(body["stream"] as? Bool, true)
    }

    func testOpenAIRequestShape() {
        let req = APIKeyRunner.makeRequest(
            cliId: "codex", apiKey: "sk-oai-test", model: "gpt-5",
            systemText: "SYS", taskText: "answer.", imageBase64: "QUJD")
        XCTAssertEqual(req.url?.absoluteString, APIKeyRunner.openAIEndpoint)
        XCTAssertEqual(req.value(forHTTPHeaderField: "Authorization"), "Bearer sk-oai-test")
        let body = try! JSONSerialization.jsonObject(with: req.httpBody!) as! [String: Any]
        XCTAssertEqual(body["model"] as? String, "gpt-5")
    }

    func testAnthropicDeltaParsing() {
        let line = #"data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"你好"}}"#
        XCTAssertEqual(APIKeyRunner.parseDelta(cliId: "claude", line: line), "你好")
        XCTAssertNil(APIKeyRunner.parseDelta(cliId: "claude", line: "event: ping"))
        let stop = #"data: {"type":"message_stop"}"#
        XCTAssertNil(APIKeyRunner.parseDelta(cliId: "claude", line: stop))
    }

    func testOpenAIDeltaParsing() {
        let line = #"data: {"choices":[{"delta":{"content":"hi"}}]}"#
        XCTAssertEqual(APIKeyRunner.parseDelta(cliId: "codex", line: line), "hi")
        XCTAssertNil(APIKeyRunner.parseDelta(cliId: "codex", line: "data: [DONE]"))
    }

    func testStreamErrorParsing() {
        let line = #"data: {"type":"error","error":{"type":"overloaded_error","message":"boom"}}"#
        XCTAssertEqual(APIKeyRunner.parseStreamError(line), "boom")
        XCTAssertNil(APIKeyRunner.parseStreamError(#"data: {"type":"content_block_delta"}"#))
    }

    func testErrorMessageFromBody() {
        let data = #"{"error":{"message":"invalid x-api-key"}}"#.data(using: .utf8)!
        XCTAssertTrue(APIKeyRunner.errorMessage(from: data, statusCode: 401).contains("invalid x-api-key"))
        XCTAssertTrue(APIKeyRunner.errorMessage(from: Data(), statusCode: 500).contains("500"))
    }
}

/// The CLI ↔ custom-key coexistence: labels and routing gates read from Settings.
final class ChannelRoutingTests: XCTestCase {
    func testLabelReflectsChannel() {
        XCTAssertEqual(Settings.label(forCLI: "claude", usingCustomKey: false), "Claude")
        XCTAssertEqual(Settings.label(forCLI: "claude", usingCustomKey: true), "Claude · API")
        XCTAssertEqual(Settings.label(forCLI: "codex", usingCustomKey: true), "Codex · API")
    }

    func testCustomKeyGateAndModelDefault() {
        let s = Settings.shared
        let originalKey = s.apiKey(for: "claude")
        let originalModel = UserDefaults.standard.string(forKey: "apiModel.claude") ?? ""
        defer {
            s.setAPIKey(originalKey, for: "claude")
            UserDefaults.standard.set(originalModel, forKey: "apiModel.claude")
        }

        s.setAPIKey("  ", for: "claude") // whitespace only ⇒ still CLI mode
        XCTAssertFalse(s.usesCustomKey(for: "claude"))
        s.setAPIKey("sk-ant-xyz", for: "claude")
        XCTAssertTrue(s.usesCustomKey(for: "claude"))

        s.setAPIModel("", for: "claude") // empty ⇒ per-backend default
        XCTAssertEqual(s.apiModel(for: "claude"), Settings.defaultAPIModels["claude"])
        s.setAPIModel("claude-sonnet-5", for: "claude")
        XCTAssertEqual(s.apiModel(for: "claude"), "claude-sonnet-5")
    }
}

/// Direct-API channel: SSE parsing, request building, and channel labeling. All pure logic —
/// no network, no UserDefaults. Verifies "CLI 模式" and "自定义 Key 模式" route and render
/// distinctly without touching each other's code paths.
final class APIKeyRunnerTests: XCTestCase {

    // MARK: - SSE line parsing

    func testAnthropicTextDeltaIsEx
