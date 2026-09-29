import AppKit
import XCTest
@testable import NotchSPI

final class CaptureExperienceTests: XCTestCase {
    @MainActor func testCollectingHidesPreviousAnswerAndRecoveryActionsUntilRoundEnds() {
        let model = TutorModel()
        model.answer = "Previous answer\nFINAL: A"
        model.explanationAvailable = true
        model.screenshotRoundActive = true
        XCTAssertTrue(model.hidesAnswer)
        XCTAssertFalse(model.showMaterialStrip)
        XCTAssertEqual(model.materialAreaHeight, CaptureStyle.trayHeight)
        model.screenshotCapturing = true
        XCTAssertFalse(model.captureHeading.isEmpty)
        model.screenshotRoundActive = false
        XCTAssertFalse(model.hidesAnswer)
        XCTAssertTrue(model.showMaterialStrip)
        XCTAssertEqual(model.displayedAnswer, model.answer)
    }

    @MainActor func testPersonalityCancellationAndErrorStayReadableWithoutEnteringProtocol() {
        let model = TutorModel()
        model.mode = "personality"
        model.answer = ""
        for state: TutorModel.Status in [.idle, .error] {
            model.status = state
            model.captureFeedback = "Capture canceled. Select again."
            let visible = NotchType.answerString(model.displayedAnswer, presentation: NotchType.presentation(for: model))
            XCTAssertEqual(visible.string, model.captureFeedback)
            XCTAssertTrue(model.answer.isEmpty)
            XCTAssertFalse(model.hidesAnswer)
        }
    }

    @MainActor func testInvalidPersonalityResponseShowsRecoveryInsteadOfRawProtocol() {
        let model = TutorModel()
        model.mode = "personality"; model.status = .error
        model.answer = "NSPI_CONTEXT_V1: {broken-json}"
        XCTAssertFalse(model.displayedAnswer.contains("NSPI_CONTEXT"))
        XCTAssertFalse(model.displayedAnswer.isEmpty)
        XCTAssertEqual(model.answer, "NSPI_CONTEXT_V1: {broken-json}")
    }

    @MainActor func testQuickMenuUsesTheThreeCaptureActionsWithoutSecondKeyBindings() {
        let controller = NotchController(activateServices: false)
        defer { controller.prepareForTermination() }
        let menu = controller.qaScreenshotMenu()
        let entries = Array(menu.items.prefix(3))
        XCTAssertEqual(entries.count, 3)
        for (item, action) in zip(entries, CaptureAction.allCases) {
            XCTAssertTrue(item.title.contains(action.title))
            XCTAssertTrue(item.title.contains(Settings.displayString(action.combo)))
            XCTAssertEqual(item.keyEquivalent, "", "Carbon exclusively owns shortcut delivery")
            XCTAssertNotNil(item.action)
        }
        XCTAssertEqual(Set(entries.compactMap(\.action)).count, 3)
    }
}
