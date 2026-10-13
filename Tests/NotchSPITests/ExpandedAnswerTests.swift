import AppKit
import XCTest
@testable import NotchSPI

final class ExpandedAnswerTests: XCTestCase {
    private func content(id: UUID = UUID(), explanation: String = "", explaining: Bool = false) -> ExpandedAnswerContent {
        .init(id: id, assets: [], answer: "步骤\nFINAL: **B**\n第二空：60", explanation: explanation,
              needsReview: false, explaining: explaining, canExplain: true, explanationFailed: false)
    }
    func testFullContentPreservesOverflowAndStripsMarkers() {
        let value = content(explanation: "解释\nFINAL: B")
        XCTAssertEqual(value.conclusion, "B")
        XCTAssertEqual(value.detail, "步骤\n\n第二空：60\n\n解释\n\nB")
        XCTAssertFalse(value.copyText.contains("FINAL:"))
    }
    @MainActor func testEntryOnlyForCompletedAnswers() {
        let model = TutorModel(); model.answer = "FINAL: B"
        for status in [TutorModel.Status.ready, .running, .streaming, .error] {
            model.status = status; XCTAssertFalse(model.canExpandAnswer)
        }
        model.status = .idle; XCTAssertTrue(model.canExpandAnswer)
        model.screenshotRoundActive = true; XCTAssertFalse(model.canExpandAnswer)
        model.screenshotRoundActive = false; model.onboardingStep = .practice; XCTAssertFalse(model.canExpandAnswer)
        model.onboardingStep = nil; model.resultState = .retake; XCTAssertFalse(model.canExpandAnswer)
        model.resultState = nil; model.mode = "personality"; XCTAssertFalse(model.canExpandAnswer)
    }
    @MainActor func testReaderUpdatesOnlyOriginalQuestionAndDetachesIncompleteStream() {
        _ = NSApplication.shared
        let first = content()
        let reader = ExpandedAnswerWindowController(content: first)
        reader.update(content(id: first.id, explanation: "partial", explaining: true))
        XCTAssertEqual(reader.content?.explanation, "partial")
        reader.update(content(explanation: "different question"))
        XCTAssertEqual(reader.content?.id, first.id)
        reader.detachFromCurrentQuestion()
        XCTAssertEqual(reader.content?.canExplain, false)
        XCTAssertEqual(reader.content?.explanationFailed, true)
        reader.update(content(id: first.id, explanation: "late callback"))
        XCTAssertEqual(reader.content?.explanation, "partial")
        reader.close(); XCTAssertNil(reader.content)
    }
    @MainActor func testOpeningIsOptionalPassiveAndNextCaptureKeepsReader() throws {
        let controller = NotchController(activateServices: false)
        defer { controller.qaExpandedAnswerWindow?.close(); controller.prepareForTermination() }
        let capture = QuestionCaptureSnapshot(captureID: UUID(), sessionID: UUID(), generation: 0, assets: [], expiresAt: Date().addingTimeInterval(900))
        controller.qaSeedExpandedAnswer(capture)
        controller.model.answer = "FINAL: B"; controller.model.status = .idle
        controller.qaRefreshScreenshotLayout()
        XCTAssertNil(controller.qaExpandedAnswerWindow)
        let item = try XCTUnwrap(controller.qaScreenshotMenu().items.first { $0.action == #selector(NotchController.openExpandedAnswer) })
        XCTAssertEqual(item.keyEquivalent, "")
        controller.openExpandedAnswer()
        let reader = try XCTUnwrap(controller.qaExpandedAnswerWindow)
        XCTAssertEqual(reader.content?.id, capture.captureID)
        XCTAssertEqual(controller.qaModelInvocations, 0)
        XCTAssertEqual(controller.model.answer, "FINAL: B")
        controller.model.screenshotRoundActive = true
        controller.qaRefreshScreenshotLayout()
        XCTAssertTrue(controller.qaExpandedAnswerWindow === reader)
        XCTAssertEqual(reader.content?.id, capture.captureID)
        XCTAssertFalse(reader.content?.canExplain ?? true)
        XCTAssertEqual(controller.qaModelInvocations, 0)
    }
    @MainActor func testLongAnswerHasScrollableDocumentWithoutGrowingWindow() throws {
        _ = NSApplication.shared
        let reader = ExpandedAnswerWindowController(content: content(explanation: String(repeating: "Long explanation with units 120 km / 2 h.\n\n", count: 100)))
        defer { reader.close() }
        let window = try XCTUnwrap(reader.window)
        window.contentView?.layoutSubtreeIfNeeded()
        XCTAssertLessThanOrEqual(window.frame.width, 1061)
        let scrolls = try XCTUnwrap(window.contentView).subviews.compactMap { $0 as? NSScrollView }
        XCTAssertEqual(scrolls.count, 2)
        XCTAssertGreaterThan(scrolls[1].documentView?.frame.height ?? 0, scrolls[1].frame.height)
        XCTAssertGreaterThan(scrolls[1].frame.height, 300)
    }
}
