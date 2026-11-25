import XCTest
@testable import NotchSPI

/// Regression for "several screenshots submitted, one answer shown".
///
/// Root cause: the multi-image task line told the model to answer "the problem shown in the LAST
/// image" and to treat every earlier image as reference material. Independent problems in the
/// earlier images were therefore dropped before any parsing or rendering happened. The first
/// half of this file pins the corrected task contract on every channel; the second half proves
/// that a complete answer list is never reduced to one item by the parser, the answer card, the
/// clipboard or the saved history.
final class MultiQuestionAnswerTests: XCTestCase {
    private struct Scenario: Decodable {
        let id: String
        let images: Int
        let `protocol`: Bool
        let raw: String
        let path: String
        let state: String?
        let final: String
        let items: [String]
    }

    private func scenarios() throws -> [Scenario] {
        let url = try XCTUnwrap(Bundle.module.url(
            forResource: "cases", withExtension: "json", subdirectory: "Fixtures/answer-coverage"))
        return try JSONDecoder().decode([Scenario].self, from: Data(contentsOf: url))
    }

    /// What a reader sees in the answer card, as separate answers.
    private func items(_ final: String) -> [String] {
        final.components(separatedBy: CharacterSet(charactersIn: ";；"))
            .map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
    }

    // MARK: - Request: the task no longer narrows a multi-image run to one image

    func testMultiImageTaskAnswersEveryIndependentProblem() {
        let task = Prompts.contextTask
        // The defect itself: naming the last image as the only target.
        XCTAssertFalse(task.contains("problem shown in the LAST image"))
        XCTAssertFalse(task.contains("The earlier images are reference material"))
        for required in [
            "tutor me on every problem they show",
            "capture order",
            // Several images, one problem: still one answer.
            "is context for the problem it belongs to",
            "are still one problem, so answer it once",
            // A single problem keeps its usual unlabelled answer.
            "exactly as you would for a single image and without a label",
            // Several independent problems: one labelled answer each, none dropped.
            "do not answer only the last image's",
            "answer every one of them in capture order",
            "label each result with its on-screen question number",
            "put all labelled results in that single line, separated by semicolons",
            "never silently drop one",
            // An unreadable image is listed, not skipped.
            "Account for every image before you answer",
            "still counts as a problem",
            "instead of guessing or skipping it",
            // One unreadable problem keeps the others and is never presented as complete.
            "still answer the others",
            "needs retake",
            "Such a partial result needs review: it is never ready or complete",
            "it is a retake only when not a single problem can be answered",
        ] {
            XCTAssertTrue(task.contains(required), required)
        }
    }

    func testSingleImageTaskIsUnchanged() {
        let prompt = Prompts.capturePrompt(
            mode: "tutor", depth: "brief", personaName: "", personaText: "", sessionContext: "")
        XCTAssertEqual(prompt.task, "tutor me on the problem it shows.")
        XCTAssertEqual(Prompts.analyzeTaskText(prompt.task, imageCount: 1),
                       "Analyze the attached screenshot image, then tutor me on the problem it shows.")
        let objective = Prompts.capturePrompt(
            mode: "tutor", depth: "brief", personaName: "", personaText: "", sessionContext: "",
            objectiveProtocolEnabled: true)
        XCTAssertEqual(objective.task, Prompts.objectiveTask)
        XCTAssertFalse(Prompts.analyzeTaskText(objective.task, imageCount: 1).contains("every problem they show"))
    }

    func testEveryChannelSendsTheMultiImageContract() throws {
        let prompt = CapturePrompt(system: "SYS", task: Prompts.contextTask)
        for count in 2...4 {
            let expected = Prompts.analyzeTaskText(Prompts.contextTask, imageCount: count)
            XCTAssertTrue(expected.hasPrefix(
                "Analyze the \(count) attached screenshot images in order, then tutor me on every problem they show."))

            let official = OfficialAPI.makeCaptureRequest(
                baseURL: "https://example.com", deviceToken: "device", prompt: prompt,
                imagesBase64: Array(repeating: "QUJD", count: count))
            let officialBody = try XCTUnwrap(
                JSONSerialization.jsonObject(with: try XCTUnwrap(official.httpBody)) as? [String: Any])
            XCTAssertEqual(officialBody["task"] as? String, expected)
            XCTAssertEqual((officialBody["images_base64"] as? [String])?.count, count)

            let direct = try XCTUnwrap(APIKeyRunner.makeRequest(
                proto: .anthropic, endpoint: APIKeyRunner.anthropicEndpoint, apiKey: "key", model: "model",
                prompt: prompt, imagesBase64: Array(repeating: "QUJD", count: count)))
            let directBody = try XCTUnwrap(
                JSONSerialization.jsonObject(with: try XCTUnwrap(direct.httpBody)) as? [String: Any])
            let content = try XCTUnwrap((directBody["messages"] as? [[String: Any]])?.first?["content"] as? [[String: Any]])
            XCTAssertEqual(content.compactMap { $0["text"] as? String }, [expected])
            XCTAssertEqual(content.count, count + 1)

            let paths = (1...count).map { "/tmp/shot-\($0).jpg" }
            let codex = CLIRunner.makeArguments(cliId: "codex", prompt: prompt, imagePaths: paths)
            XCTAssertTrue(codex.contains { $0.hasSuffix(expected) })
            let claude = CLIRunner.makeArguments(cliId: "claude", prompt: prompt, imagePaths: paths)
            XCTAssertTrue(claude.contains {
                $0.contains("Open and read those image files in order, then " + Prompts.contextTask)
            })
        }
    }

    // MARK: - Response: every answer item survives parsing, card, clipboard and history

    func testSharedScenariosCoverTheFourQuestionShapes() throws {
        let cases = try scenarios()
        let byID = Dictionary(uniqueKeysWithValues: cases.map { ($0.id, $0) })
        // One question → one answer; three thumbnails of one question → still one answer.
        XCTAssertEqual(byID["single-question"]?.items.count, 1)
        XCTAssertEqual(byID["one-question-across-images"]?.images, 3)
        XCTAssertEqual(byID["one-question-across-images"]?.items.count, 1)
        // One question with sub-questions, and independent questions, keep one item each.
        XCTAssertEqual(byID["subparts-one-question"]?.items.count, 3)
        XCTAssertEqual(byID["independent-questions-one-image"]?.items.count, 4)
        XCTAssertEqual(byID["independent-questions-across-images"]?.images, 4)
        XCTAssertEqual(byID["independent-questions-across-images"]?.items.count, 6)
        XCTAssertEqual(byID["one-unreadable-among-independent"]?.state, "review")
    }

    func testEveryAnswerItemSurvivesParsingCardClipboardAndHistory() throws {
        for scenario in try scenarios() {
            let parsed = ObjectiveResultParser.compose(raw: scenario.raw, protocolEnabled: scenario.protocol)
            XCTAssertEqual(parsed.parserPath.rawValue, scenario.path, scenario.id)
            XCTAssertEqual(parsed.state?.rawValue, scenario.state, scenario.id)
            XCTAssertEqual(parsed.finalAnswer, scenario.final, scenario.id)
            XCTAssertFalse(parsed.visibleText.contains(ObjectiveResultParser.marker), scenario.id)

            // The answer card: the whole list, in order, nothing demoted below the card.
            let card = AnswerComposer.parse(parsed.visibleText, streaming: false)
            XCTAssertEqual(card.final, scenario.final, scenario.id)
            XCTAssertEqual(card.overflow, "", scenario.id)
            XCTAssertEqual(items(card.final ?? ""), scenario.items, scenario.id)

            // Clipboard, expanded reader and saved history read the same conclusion.
            XCTAssertEqual(AnswerComposer.clipboardAnswer(parsed.visibleText), scenario.final, scenario.id)
            let reading = AnswerReadingContent(answer: parsed.visibleText, explanation: "")
            XCTAssertEqual(reading.conclusion, scenario.final, scenario.id)
            XCTAssertEqual(reading.copyAnswer, scenario.final, scenario.id)
            let history = RecentQuestion(
                id: UUID(), createdAt: Date(), answer: parsed.visibleText, explanation: "",
                needsReview: parsed.state == .review, imageCount: scenario.images)
            XCTAssertEqual(items(history.conclusion), scenario.items, scenario.id)
            XCTAssertTrue(history.copyText.hasPrefix(scenario.final), scenario.id)
        }
    }

    /// A partly unreadable set keeps the readable answers but is never a clean "ready" result.
    func testPartialResultIsPresentedAsNeedingReview() throws {
        let scenario = try XCTUnwrap(try scenarios().first { $0.id == "one-unreadable-among-independent" })
        let parsed = ObjectiveResultParser.compose(raw: scenario.raw)
        XCTAssertEqual(parsed.state, .review)
        XCTAssertEqual(parsed.result?.reason, .missingContext)
        XCTAssertEqual(items(parsed.finalAnswer ?? ""), ["Q1: A", "Q2: needs retake", "Q3: B"])
        // Review answers are not auto-copied as if they were complete.
        XCTAssertFalse(SharedVisual.canCopyAnswer(
            mode: "tutor", busy: false, resultState: parsed.state?.rawValue, hasAnswer: true,
            automatic: true, autoCopyEnabled: true))
    }

    /// Streamed character by character, the card only ever shows a prefix of the full list and
    /// ends on all of it — it never settles on the first or the last item alone.
    func testStreamedAnswerListEndsCompleteAtEveryChunkBoundary() throws {
        for scenario in try scenarios() where scenario.protocol {
            var filter = ObjectiveResultStreamFilter()
            var visible = ""
            for character in scenario.raw {
                visible = filter.append(String(character))
                XCTAssertFalse(visible.contains("NSPI_RESULT_V1"), scenario.id)
                if let shown = AnswerComposer.parse(visible, streaming: true).final {
                    XCTAssertTrue(scenario.final.hasPrefix(shown), "\(scenario.id): \(shown)")
                }
            }
            XCTAssertEqual(AnswerComposer.parse(visible, streaming: true).final, scenario.final, scenario.id)
            let finished = filter.finish()
            XCTAssertEqual(finished.finalAnswer, scenario.final, scenario.id)
            XCTAssertEqual(items(AnswerComposer.parse(finished.visibleText, streaming: false).final ?? ""),
                           scenario.items, scenario.id)
        }
    }

    // MARK: - A reply that breaks the one-FINAL-line contract is never a clean result

    private func machineLine(kind: String, answer: String) -> String {
        #"NSPI_RESULT_V1: {"v":1,"kind":"\#(kind)","state":"ready","answer":"\#(answer)","reason":"none"}"#
    }

    /// One FINAL line per question: the card can only show the last one, so the result is marked
    /// for review and the earlier answers stay readable instead of passing as a complete answer.
    func testOneFinalLinePerQuestionNeedsReviewAndKeepsEveryAnswerReadable() {
        let raw = "Q1 work\nFINAL: A\nQ2 work\nFINAL: C\nQ3 work\nFINAL: B\n"
            + machineLine(kind: "single_choice", answer: "B")
        var filter = ObjectiveResultStreamFilter()
        for character in raw { _ = filter.append(String(character)) }
        let parsed = filter.finish()
        XCTAssertEqual(parsed.parserPath, .legacyFallback)
        XCTAssertEqual(parsed.state, .review)
        XCTAssertTrue(parsed.violations.contains(.finalMismatch))
        let reading = AnswerReadingContent(answer: parsed.visibleText, explanation: "")
        XCTAssertEqual(reading.conclusion, "B")
        let detailLines = reading.detail.components(separatedBy: "\n")
        XCTAssertTrue(detailLines.contains("A") && detailLines.contains("C"), reading.detail)
        XCTAssertFalse(SharedVisual.canCopyAnswer(
            mode: "tutor", busy: false, resultState: parsed.state?.rawValue, hasAnswer: true,
            automatic: true, autoCopyEnabled: true))
    }

    /// Answers continued on the lines after FINAL: the card shows the first line only, so the
    /// result is marked for review and the remaining lines stay below the card.
    func testAnswersContinuedAfterFinalNeedReviewAndStayBelowTheCard() {
        let raw = "FINAL: Q1: A\nQ2: C\nQ3: B\n" + machineLine(kind: "other", answer: "Q1: A")
        let parsed = ObjectiveResultParser.compose(raw: raw)
        XCTAssertEqual(parsed.parserPath, .legacyFallback)
        XCTAssertEqual(parsed.state, .review)
        let card = AnswerComposer.parse(parsed.visibleText, streaming: false)
        XCTAssertEqual(card.final, "Q1: A")
        XCTAssertEqual(card.overflow, "Q2: C\nQ3: B")
        XCTAssertEqual(AnswerReadingContent(answer: parsed.visibleText, explanation: "").detail, "Q2: C\nQ3: B")
    }

    /// The same conclusion stated twice is not a conflict and stays a clean result.
    func testRepeatedIdenticalFinalStaysReady() {
        let parsed = ObjectiveResultParser.compose(
            raw: "FINAL: B\n\nFINAL: **b**\n" + machineLine(kind: "single_choice", answer: "B"))
        XCTAssertEqual(parsed.parserPath, .v1)
        XCTAssertEqual(parsed.state, .ready)
        XCTAssertEqual(parsed.finalAnswer, "B")
    }
}
