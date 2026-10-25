import AppKit
import XCTest
@testable import NotchSPI

final class DailyPresentationParityTests: XCTestCase {
    @MainActor func testSharedCollectionHeadingsMatchNativePriorityInThreeLanguages() {
        let previous = L10n.setting
        defer { L10n.setting = previous }
        for (locale, code) in [(AppLanguage.zhHans, "zh"), (.ja, "ja"), (.en, "en")] {
            L10n.setting = locale
            for capturing in [false, true] {
                for previewing in [false, true] {
                    for remaining: Double? in [nil, 0, 2.4] {
                        let model = TutorModel()
                        model.screenshotRoundActive = true
                        model.screenshotCapturing = capturing
                        model.screenshotPreviewing = previewing
                        model.screenshotRemaining = remaining
                        let input: [String: Any] = ["images": [0, 1], "collecting": true, "capturing": capturing,
                            "preview": previewing, "remaining": remaining as Any? ?? NSNull(), "status": "collecting"]
                        let result = SharedVisual.call("dailyPresentation", [input, code]).toDictionary()
                        XCTAssertEqual(result?["heading"] as? String, model.captureHeading)
                    }
                }
            }
        }
    }
    @MainActor func testErrorAndCancellationTakePriorityOverRetainedAnswer() {
        let model = TutorModel()
        model.answer = "FINAL: stale answer"
        model.status = .error
        model.statusText = "Connection interrupted"
        XCTAssertEqual(model.displayedAnswer, "Connection interrupted")
        model.captureFeedback = "Round canceled"
        XCTAssertEqual(model.displayedAnswer, "Round canceled")
        for status in ["error", "canceled", "retake", "empty"] {
            let input: [String: Any] = ["images": [], "mode": "tutor", "status": status, "answer": "stale answer"]
            XCTAssertEqual(SharedVisual.call("dailyPresentation", [input, "en"]).toDictionary()?["messageFirst"] as? Bool, true)
        }
    }
}
