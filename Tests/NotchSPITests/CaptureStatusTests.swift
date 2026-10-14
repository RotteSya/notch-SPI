import XCTest
@testable import NotchSPI

final class CaptureStatusTests: XCTestCase {
    @MainActor func testCountdownHasOneVisualSummaryWithoutChangingTimer() {
        let model = TutorModel()
        model.screenshotRoundActive = true
        model.screenshotRemaining = 2.4
        model.screenshotStatus = "Detailed countdown message"
        XCTAssertEqual(model.captureHeading, L10n.t("3 秒后查题", "3秒後に送信", "Asking in 3s"))
        XCTAssertTrue(model.screenshotHint.isEmpty)
        XCTAssertEqual(model.captureStatusDetail, "Detailed countdown message")
        XCTAssertEqual(model.screenshotRemaining, 2.4)
        model.screenshotRemaining = 0
        XCTAssertEqual(model.captureHeading, L10n.t("等待提交", "送信待ち", "Queued"))
    }
    @MainActor func testPreviewAndCaptureHavePriorityAndKeepExistingShortcutHint() {
        let model = TutorModel()
        model.screenshotRoundActive = true
        XCTAssertTrue(model.screenshotHint.contains(Settings.displayString(Settings.shared.contextCombo)))
        model.screenshotPreviewing = true
        XCTAssertEqual(model.captureHeading, L10n.t("已暂停", "一時停止", "Paused"))
        XCTAssertTrue(model.screenshotHint.isEmpty)
        model.screenshotCapturing = true
        XCTAssertEqual(model.captureHeading, L10n.t("截图中", "撮影中", "Capturing"))
        model.screenshotCapturing = false; model.screenshotPreviewing = false
        XCTAssertFalse(model.screenshotHint.isEmpty)
    }
    @MainActor func testWarningsAndRecoveryDetailsRemainAvailable() {
        let model = TutorModel()
        model.screenshotRoundActive = true; model.screenshotRemaining = 3
        model.screenshotNotice = "目标已变化，请返回原窗口或取消本轮"
        XCTAssertEqual(model.screenshotHint, model.screenshotNotice)
        XCTAssertEqual(model.captureStatusDetail, model.screenshotNotice)
        model.screenshotRoundActive = false; model.status = .running; model.recoveryAttempted = true
        model.statusText = "正在恢复本次答案 · 不另扣题"
        XCTAssertEqual(model.captureHeading, L10n.t("恢复中", "復元中", "Recovering"))
        XCTAssertEqual(model.captureStatusDetail, model.statusText)
        model.status = .error; model.captureFeedback = "连接已中断，请重新截图。"
        XCTAssertEqual(model.displayedAnswer, model.captureFeedback)
        XCTAssertEqual(model.captureStatusDetail, model.captureFeedback)
        model.captureFeedback = ""; model.status = .idle; model.statusText = "完成 · 剩余 864 题"
        XCTAssertEqual(model.captureHeading, model.statusText)
    }
}
