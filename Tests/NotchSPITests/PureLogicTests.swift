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

/// Three-mode routing (official / customKey / cli) and the billing gate. The single most
/// important invariant: the billing interceptor can NEVER stop a custom-key or CLI capture.
final class ServiceRoutingTests: XCTestCase {
    func testResolveMatrix() {
        XCTAssertEqual(ServiceRouting.resolve(mode: "official", customKey: ""), .official)
        XCTAssertEqual(ServiceRouting.resolve(mode: "official", customKey: "sk-x"), .official)
        XCTAssertEqual(ServiceRouting.resolve(mode: "cli", customKey: "sk-x"), .cli)
        XCTAssertEqual(ServiceRouting.resolve(mode: "customKey", customKey: "sk-x"), .customKey("sk-x"))
        // customKey mode without a key falls back to the CLI — the pre-official behavior.
        XCTAssertEqual(ServiceRouting.resolve(mode: "customKey", customKey: "   "), .cli)
        // Unknown/corrupt mode strings resolve to the default.
        XCTAssertEqual(ServiceRouting.resolve(mode: "banana", customKey: ""), .official)
    }

    func testBillingGateNeverBlocksNonOfficialChannels() {
        // Even with the worst possible account state (no token, zero balance), custom-key
        // and CLI captures must pass through untouched.
        for balance in [nil, 0, -500] as [Int?] {
            XCTAssertEqual(
                BillingGate.preflight(channel: .customKey("sk-x"), hasDeviceToken: false, balanceCents: balance),
                .allow)
            XCTAssertEqual(
                BillingGate.preflight(channel: .cli, hasDeviceToken: false, balanceCents: balance),
                .allow)
        }
    }

    func testBillingGateOfficialChannel() {
        // No device token → deny with guidance.
        if case .allow = BillingGate.preflight(channel: .official, hasDeviceToken: false, balanceCents: nil) {
            XCTFail("un-registered official capture must be denied")
        }
        // Zero / negative balance → deny.
        if case .allow = BillingGate.preflight(channel: .official, hasDeviceToken: true, balanceCents: 0) {
            XCTFail("zero balance must be denied")
        }
        // Positive balance → allow.
        XCTAssertEqual(BillingGate.preflight(channel: .official, hasDeviceToken: true, balanceCents: 500), .allow)
        // Unknown balance → allow; the server (402) is the source of truth.
        XCTAssertEqual(BillingGate.preflight(channel: .official, hasDeviceToken: true, balanceCents: nil), .allow)
    }

    func testDefaultModeMigration() {
        // Fresh installs land on the official service.
        XCTAssertEqual(ServiceRouting.defaultMode(isExistingInstall: false, hasCustomKey: false), "official")
        XCTAssertEqual(ServiceRouting.defaultMode(isExistingInstall: false, hasCustomKey: true), "official")
        // Existing installs keep their previous behavior — never silently rerouted.
        XCTAssertEqual(ServiceRouting.defaultMode(isExistingInstall: true, hasCustomKey: true), "customKey")
        XCTAssertEqual(ServiceRouting.defaultMode(isExistingInstall: true, hasCustomKey: false), "cli")
    }

    func testHeaderLabels() {
        XCTAssertEqual(ServiceRouting.headerLabel(channel: .official, backend: "claude"), "官方服务")
        XCTAssertEqual(ServiceRouting.headerLabel(channel: .customKey("k"), backend: "claude"), "Claude · API")
        XCTAssertEqual(ServiceRouting.headerLabel(channel: .cli, backend: "codex"), "Codex")
    }
}

/// The official service's SSE protocol and account helpers.
final class OfficialAPITests: XCTestCase {
    func testStreamEventParsing() {
        XCTAssertEqual(
            OfficialAPI.parseStreamLine(#"data: {"type":"delta","text":"你好"}"#),
            .delta("你好"))
        XCTAssertEqual(
            OfficialAPI.parseStreamLine(#"data: {"type":"usage","input_tokens":120,"output_tokens":45,"cost_cents":3,"balance_cents":497}"#),
            .usage(inputTokens: 120, outputTokens: 45, costCents: 3, balanceCents: 497))
        XCTAssertEqual(
            OfficialAPI.parseStreamLine(#"data: {"type":"error","error":{"message":"boom"}}"#),
            .error("boom"))
        XCTAssertEqual(OfficialAPI.parseStreamLine("data: [DONE]"), .done)
        XCTAssertNil(OfficialAPI.parseStreamLine("event: ping"))
        XCTAssertNil(OfficialAPI.parseStreamLine(""))
    }

    func testBalanceFormatting() {
        XCTAssertEqual(OfficialAPI.formatBalance(cents: 1234, currency: "CNY"), "¥12.34")
        XCTAssertEqual(OfficialAPI.formatBalance(cents: 500, currency: "USD"), "$5.00")
        XCTAssertEqual(OfficialAPI.formatBalance(cents: nil, currency: "CNY"), "—")
    }

    func testTopUpURL() {
        let url = OfficialAPI.topUpURL(baseURL: "https://api.notchspi.app", deviceToken: "dev_123")
        XCTAssertEqual(url?.absoluteString, "https://api.notchspi.app/topup?device=dev_123")
    }

    func testCaptureRequestShape() {
        let req = OfficialAPI.makeCaptureRequest(
            baseURL: "https://api.notchspi.app", deviceToken: "dev_123",
            systemText: "SYS", taskText: "tutor me.", imageBase64: "QUJD")
        XCTAssertEqual(req.url?.absoluteString, "https://api.notchspi.app/v1/captures")
        XCTAssertEqual(req.value(forHTTPHeaderField: "Authorization"), "Bearer dev_123")
        let body = try! JSONSerialization.jsonObject(with: req.httpBody!) as! [String: Any]
        XCTAssertEqual(body["system"] as? String, "SYS")
        XCTAssertEqual(body["stream"] as? Bool, true)
        XCTAssertEqual(body["image_media_type"] as? String, "image/jpeg")
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
