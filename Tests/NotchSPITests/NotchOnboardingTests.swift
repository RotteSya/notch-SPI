import AppKit
import XCTest
@testable import NotchSPI

final class NotchOnboardingTests: XCTestCase {
    @MainActor func testImmediateAnimationReversalCancelsPreviousDestination() {
        let host = NSView()
        let tween = DisplayTween(host: host)
        tween.animate(to: 1, duration: 0.4)
        XCTAssertTrue(tween.isAnimating)
        tween.animate(to: 0, duration: 0.4)
        XCTAssertFalse(tween.isAnimating)
        XCTAssertEqual(tween.value, 0)
    }

    private var suites: [String] = []
    private func defaults() -> UserDefaults {
        let name = "NotchOnboardingTests." + UUID().uuidString
        suites.append(name)
        return UserDefaults(suiteName: name)!
    }
    override func tearDown() {
        for name in suites { UserDefaults.standard.removePersistentDomain(forName: name) }
        super.tearDown()
    }

    func testDismissIsNotCompletionAndResumesCheckpoint() {
        let progress = NotchOnboardingProgress(defaults: defaults())
        XCTAssertTrue(progress.shouldPresent)
        progress.save(.permission)
        progress.dismiss()
        XCTAssertFalse(progress.shouldPresent)
        XCTAssertFalse(progress.isComplete)
        XCTAssertEqual(progress.resumeStep, .permission)
    }

    func testInterruptedCaptureRestoresInstructionsAndCompletionPersists() {
        let d = defaults()
        let progress = NotchOnboardingProgress(defaults: d)
        for step in [NotchOnboardingStep.working, .success] {
            progress.save(step)
            XCTAssertEqual(NotchOnboardingProgress(defaults: d).resumeStep, .capture)
            XCTAssertFalse(progress.isComplete)
        }
        progress.complete()
        XCTAssertTrue(progress.isComplete)
        XCTAssertFalse(progress.shouldPresent)
        XCTAssertTrue(d.bool(forKey: "onboarding.v3.firstSuccess"))
    }

    func testLegacyCompletedInstallIsNotInterrupted() {
        let d = defaults()
        d.set(true, forKey: "onboardingDone")
        let progress = NotchOnboardingProgress(defaults: d)
        XCTAssertFalse(progress.shouldPresent)
        progress.save(.permission); progress.dismiss()
        XCTAssertTrue(progress.isComplete)
    }

    @MainActor func testBackAndMissingPermissionNeverCaptureOrComplete() {
        let d = defaults()
        let controller = NotchController(activateServices: false, onboardingDefaults: d)
        let savedMode = Settings.shared.mode
        defer { controller.prepareForTermination(); Settings.shared.mode = savedMode }
        controller.qaOnboardingPermission = { false }
        controller.qaPresentOnboarding(.welcome)
        controller.qaAdvanceOnboarding()
        XCTAssertEqual(controller.model.onboardingStep, .permission)
        controller.qaBackOnboarding()
        XCTAssertEqual(controller.model.onboardingStep, .welcome)
        controller.qaPresentOnboarding(.capture)
        controller.qaAdvanceOnboarding()
        XCTAssertEqual(controller.model.onboardingStep, .permission)
        XCTAssertFalse(controller.model.screenshotCapturing)
        XCTAssertFalse(d.bool(forKey: "onboardingDone"))
    }

    @MainActor func testDismissRejectsLateSuccessAndRepeatedCaptureIsSingleFlight() async throws {
        let controller = NotchController(activateServices: false, onboardingDefaults: defaults())
        let savedMode = Settings.shared.mode
        defer { controller.prepareForTermination(); Settings.shared.mode = savedMode }
        controller.qaOnboardingPermission = { true }
        var calls = 0
        var pending: CheckedContinuation<Result<ScreenCapture.Shot, CaptureError>, Never>?
        controller.qaScreenshotCapture = {
            calls += 1
            return await withCheckedContinuation { pending = $0 }
        }
        controller.qaPresentOnboarding(.capture)
        controller.qaAdvanceOnboarding()
        for _ in 0..<50 where pending == nil { try await Task.sleep(for: .milliseconds(10)) }
        XCTAssertNotNil(pending)
        controller.qaAdvanceOnboarding()
        XCTAssertEqual(calls, 1)
        XCTAssertEqual(controller.model.onboardingStep, .working)
        controller.qaDismissOnboarding()
        controller.qaFinishOnboardingCapture(success: true)
        XCTAssertNil(controller.model.onboardingStep)
        pending?.resume(returning: .failure(.captureFailed))
        try await Task.sleep(for: .milliseconds(50))
        XCTAssertNil(controller.model.onboardingStep)
    }

    @MainActor func testFailureCanRetryAndOnlyActualSuccessEnablesCompletion() async throws {
        let d = defaults()
        let controller = NotchController(activateServices: false, onboardingDefaults: d)
        let savedMode = Settings.shared.mode
        defer { controller.prepareForTermination(); Settings.shared.mode = savedMode }
        controller.qaOnboardingPermission = { true }
        var calls = 0
        controller.qaScreenshotCapture = { calls += 1; return .failure(.captureFailed) }
        controller.qaPresentOnboarding(.capture)
        controller.qaAdvanceOnboarding()
        for _ in 0..<50 where controller.model.screenshotCapturing { try await Task.sleep(for: .milliseconds(10)) }
        XCTAssertEqual(controller.model.status, .error)
        XCTAssertEqual(controller.model.onboardingStep, .working)
        XCTAssertFalse(d.bool(forKey: "onboardingDone"))
        controller.qaAdvanceOnboarding()
        for _ in 0..<50 where controller.model.screenshotCapturing { try await Task.sleep(for: .milliseconds(10)) }
        XCTAssertEqual(calls, 2)
        controller.qaFinishOnboardingCapture(success: true)
        XCTAssertEqual(controller.model.onboardingStep, .success)
        controller.qaAdvanceOnboarding()
        XCTAssertNil(controller.model.onboardingStep)
        XCTAssertTrue(d.bool(forKey: "onboardingDone"))
    }

    @MainActor func testInterruptedIntakeReturnsToInstructionsAndRejectsLateSuccess() async throws {
        let d = defaults()
        let controller = NotchController(activateServices: false, onboardingDefaults: d)
        let savedMode = Settings.shared.mode
        defer { controller.prepareForTermination(); Settings.shared.mode = savedMode }
        controller.qaOnboardingPermission = { true }
        var pending: CheckedContinuation<Result<ScreenCapture.Shot, CaptureError>, Never>?
        controller.qaScreenshotCapture = { await withCheckedContinuation { pending = $0 } }
        controller.qaPresentOnboarding(.capture)
        controller.qaAdvanceOnboarding()
        for _ in 0..<50 where pending == nil { try await Task.sleep(for: .milliseconds(10)) }
        XCTAssertNotNil(pending)
        controller.qaCancelScreenshotRound()
        XCTAssertEqual(controller.model.onboardingStep, .capture)
        pending?.resume(returning: .failure(.captureFailed))
        try await Task.sleep(for: .milliseconds(50))
        controller.qaFinishOnboardingCapture(success: true)
        XCTAssertEqual(controller.model.onboardingStep, .capture)
        XCTAssertFalse(d.bool(forKey: "onboardingDone"))
    }

    @MainActor func testGuideOwnsRecoveryControlsUntilHandoff() {
        let model = TutorModel()
        model.status = .error
        XCTAssertTrue(model.showMaterialStrip)
        model.onboardingStep = .working
        XCTAssertFalse(model.showMaterialStrip)
        XCTAssertEqual(model.materialStripHeight, 0)
        model.onboardingStep = nil
        XCTAssertTrue(model.showMaterialStrip)
    }

    @MainActor func testTabLoopSkipsHiddenStepsAndCanReverseWithoutSystemKeyboardSetting() {
        let panel = NotchPanel(contentRect: NSRect(x: 0, y: 0, width: 600, height: 354))
        panel.onboardingActive = true
        let view = NotchOnboardingView(frame: panel.contentView!.bounds)
        panel.contentView = view
        view.update(step: .welcome, granted: true, denied: false, failed: false)
        panel.makeFirstResponder(view.primary)
        view.moveKeyboardFocus(backwards: false)
        XCTAssertFalse(panel.firstResponder === view.primary)
        XCTAssertEqual((panel.firstResponder as? NSView)?.accessibilityRole(), .button)
        view.moveKeyboardFocus(backwards: true)
        XCTAssertTrue(panel.firstResponder === view.primary)
    }

    @MainActor func testPanelOnlyAcceptsKeyboardDuringGuide() {
        let panel = NotchPanel(contentRect: .zero)
        XCTAssertFalse(panel.canBecomeKey)
        panel.onboardingActive = true
        XCTAssertTrue(panel.canBecomeKey)
        var dismissed = false
        panel.onCancelOnboarding = { dismissed = true }
        panel.cancelOperation(nil)
        XCTAssertTrue(dismissed)
        panel.onboardingActive = false
        XCTAssertFalse(panel.canBecomeKey)
    }
}
