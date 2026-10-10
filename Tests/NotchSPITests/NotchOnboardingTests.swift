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

    @MainActor func testPrimaryTargetStaysFixedWithinSetupAndWithinLiveAnswerAcrossLanguages() {
        let language = L10n.setting
        defer { L10n.setting = language }
        let view = NotchOnboardingView(frame: .init(x: 0, y: 0, width: 600, height: 420))
        var anchors: [Bool: NSRect] = [:]
        for locale in [AppLanguage.zhHans, .ja, .en] {
            L10n.setting = locale
            for step in [NotchOnboardingStep.welcome, .permission, .practice, .capture, .working, .success] {
                view.update(step: step, granted: true, denied: false, failed: false)
                view.layoutSubtreeIfNeeded()
                if let anchor = anchors[step.showsLiveContent] { XCTAssertEqual(view.primary.frame, anchor) }
                else { anchors[step.showsLiveContent] = view.primary.frame }
                XCTAssertGreaterThanOrEqual(view.primary.frame.width, view.primary.intrinsicContentSize.width)
                XCTAssertFalse(view.primary.isHidden)
            }
        }
    }

    @MainActor func testVisibleActionsDoNotOverlapIncludingFailureRecovery() {
        let language = L10n.setting
        defer { L10n.setting = language }
        let view = NotchOnboardingView(frame: .init(x: 0, y: 0, width: 600, height: 400))
        for locale in [AppLanguage.zhHans, .ja, .en] {
            L10n.setting = locale
            for step in [NotchOnboardingStep.welcome, .permission, .practice, .capture, .working, .success] {
                view.update(step: step, granted: false, denied: true, failed: true, practiceFailed: true)
                view.layoutSubtreeIfNeeded()
                let actions = view.subviews.filter { ($0 is GlowButton || $0 is NSPopUpButton) && !$0.isHidden }
                for (index, action) in actions.enumerated() {
                    for other in actions.dropFirst(index + 1) {
                        XCTAssertFalse(action.frame.intersects(other.frame), "Overlapping actions in \(locale) / \(step)")
                    }
                }
            }
        }
    }

    @MainActor func testPracticeAndCaptureAreSeparateSizedSteps() {
        let model = TutorModel()
        model.onboardingStep = .practice
        XCTAssertEqual(model.onboardingContentHeight, NotchOnboardingStep.practice.height)
        model.onboardingStep = .capture
        XCTAssertEqual(model.onboardingContentHeight, NotchOnboardingStep.capture.height)
        XCTAssertEqual(NotchOnboardingStep.practice.height, NotchOnboardingStep.capture.height)
        model.onboardingStep = .working
        XCTAssertEqual(model.onboardingContentHeight, NotchOnboardingStep.working.height)
        model.onboardingStep = nil
        XCTAssertNil(model.onboardingContentHeight)
    }

    @MainActor func testGuideButtonRejectsSecondMouseUpOfDoubleClick() {
        let button = GlowButton(title: "Continue")
        button.ignoresRepeatedClicks = true
        button.frame = .init(x: 0, y: 0, width: 200, height: 40)
        var activations = 0
        button.onClick = { activations += 1 }
        for count in [1, 2] {
            let event = NSEvent.mouseEvent(with: .leftMouseUp, location: .init(x: 20, y: 20),
                modifierFlags: [], timestamp: 0, windowNumber: 0, context: nil,
                eventNumber: count, clickCount: count, pressure: 0)!
            button.mouseUp(with: event)
        }
        XCTAssertEqual(activations, 1)
    }

    @MainActor func testClosingPreservesCompositionAndInterruptedReopenUsesDailyLayout() {
        let previous = ProcessInfo.processInfo.environment["NSPI_QA_REDUCE_MOTION"]
        setenv("NSPI_QA_REDUCE_MOTION", "0", 1)
        defer {
            if let previous { setenv("NSPI_QA_REDUCE_MOTION", previous, 1) }
            else { unsetenv("NSPI_QA_REDUCE_MOTION") }
        }
        let model = TutorModel()
        let panel = NotchPanel(contentRect: NSRect(x: 0, y: 0, width: 600, height: 400))
        let view = NotchView(model: model,
            frameProvider: { NSRect(x: 0, y: 0, width: $0 ? 600 : 200, height: $0 ? 400 : 32) },
            onHover: { model.expanded = $0 }, onCycleDepth: {}, onEditPersona: {}, onSettings: {},
            onToggleReasoning: {}, onCopyAnswer: {}, onStopAuto: {})
        view.qaUseManualMorphClock()
        panel.contentView = view
        panel.orderFront(nil)
        defer { panel.orderOut(nil) }
        model.answer = "Retained answer"
        model.onboardingStep = .success
        model.expanded = true
        view.refreshScreenshotTray()
        view.qaAdvanceMorph(by: 0.4)
        let guideFrame = view.onboarding.frame
        XCTAssertFalse(view.onboarding.isHidden)
        model.expanded = false
        model.onboardingStep = nil
        view.refreshScreenshotTray()
        view.qaAdvanceMorph(by: 0.04)
        XCTAssertFalse(view.onboarding.isHidden)
        XCTAssertEqual(view.onboarding.frame, guideFrame)
        let click = NSEvent.mouseEvent(with: .leftMouseUp, location: .init(x: 100, y: 16),
            modifierFlags: [], timestamp: 0, windowNumber: panel.windowNumber, context: nil,
            eventNumber: 0, clickCount: 1, pressure: 0)!
        view.mouseUp(with: click)
        XCTAssertTrue(model.expanded)
        view.refreshScreenshotTray()
        view.qaAdvanceMorph(by: 0.08)
        XCTAssertTrue(view.onboarding.isHidden)
        XCTAssertEqual(model.answer, "Retained answer")
        panel.orderOut(nil)
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
        progress.save(.practice)
        XCTAssertEqual(progress.resumeStep, .practice)
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
        controller.qaBackOnboarding()
        XCTAssertEqual(controller.model.onboardingStep, .capture)
        XCTAssertFalse(controller.model.screenshotCapturing)
        XCTAssertFalse(d.bool(forKey: "onboardingDone"))
    }

    @MainActor func testExistingPermissionOpensPracticeBeforeCaptureAndBacktracksInOrder() {
        let controller = NotchController(activateServices: false, onboardingDefaults: defaults())
        defer { controller.prepareForTermination() }
        controller.qaOnboardingPermission = { true }
        controller.qaOpenPracticePage = { _ in true }
        controller.qaPresentOnboarding(.welcome)
        controller.qaAdvanceOnboarding()
        XCTAssertEqual(controller.model.onboardingStep, .practice)
        XCTAssertFalse(controller.model.screenshotCapturing)
        controller.qaBackOnboarding()
        XCTAssertEqual(controller.model.onboardingStep, .welcome)
        controller.qaAdvanceOnboarding()
        controller.qaAdvanceOnboarding()
        XCTAssertEqual(controller.model.onboardingStep, .capture)
        controller.qaBackOnboarding()
        XCTAssertEqual(controller.model.onboardingStep, .practice)
    }

    @MainActor func testPracticeFailureStaysAtPracticeAndRetryAdvancesToCapture() {
        let controller = NotchController(activateServices: false, onboardingDefaults: defaults())
        defer { controller.prepareForTermination() }
        controller.qaOnboardingPermission = { true }
        var opens = 0
        controller.qaOpenPracticePage = { _ in opens += 1; return opens > 1 }
        controller.qaPresentOnboarding(.practice)
        controller.qaAdvanceOnboarding()
        XCTAssertEqual(controller.model.onboardingStep, .practice)
        XCTAssertTrue(controller.model.onboardingPracticeFailed)
        controller.qaAdvanceOnboarding()
        XCTAssertFalse(controller.model.onboardingPracticeFailed)
        XCTAssertEqual(controller.model.onboardingStep, .capture)
        XCTAssertEqual(opens, 2)
        controller.qaBackOnboarding()
        XCTAssertEqual(controller.model.onboardingStep, .practice)
        XCTAssertEqual(opens, 2)
    }

    @MainActor func testRetargetDuringExpansionAndReversalDoesNotJumpWindow() {
        let previous = ProcessInfo.processInfo.environment["NSPI_QA_REDUCE_MOTION"]
        setenv("NSPI_QA_REDUCE_MOTION", "0", 1)
        defer {
            if let previous { setenv("NSPI_QA_REDUCE_MOTION", previous, 1) }
            else { unsetenv("NSPI_QA_REDUCE_MOTION") }
        }
        let model = TutorModel()
        let collapsed = NSRect(x: 200, y: 700, width: 200, height: 32)
        var destination = NSRect(x: 0, y: 400, width: 600, height: 332)
        let panel = NotchPanel(contentRect: collapsed)
        let view = NotchView(model: model, frameProvider: { $0 ? destination : collapsed },
            onHover: { _ in }, onCycleDepth: {}, onEditPersona: {}, onSettings: {},
            onToggleReasoning: {}, onCopyAnswer: {}, onStopAuto: {})
        view.qaUseManualMorphClock()
        panel.contentView = view
        panel.orderFront(nil)
        defer { panel.orderOut(nil) }
        model.onboardingStep = .welcome; model.expanded = true
        view.refreshScreenshotTray()
        view.qaAdvanceMorph(by: 0.11)
        let before = panel.frame
        destination = NSRect(x: 0, y: 232, width: 600, height: 500)
        view.retargetExpandedFrame(destination)
        XCTAssertEqual(panel.frame, before, "Retarget itself must never rewrite the displayed frame")
        view.refreshScreenshotTray()
        view.qaAdvanceMorph(by: 0.025)
        XCTAssertLessThan(abs(panel.frame.height - before.height), 130)
        model.expanded = false
        view.refreshScreenshotTray()
        view.qaAdvanceMorph(by: 0.045)
        model.expanded = true
        view.refreshScreenshotTray()
        view.qaAdvanceMorph(by: 0.45)
        XCTAssertEqual(panel.frame.height, destination.height, accuracy: 1)
        XCTAssertEqual(panel.frame.maxY, collapsed.maxY, accuracy: 1)
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
        XCTAssertFalse(controller.model.expanded)
        XCTAssertTrue(d.bool(forKey: "onboardingDone"))
    }

    @MainActor func testCompletionAndSuccessDismissalClearPracticeAndReopenIdle() throws {
        for dismiss in [false, true] {
            let d = defaults()
            let controller = NotchController(activateServices: false, onboardingDefaults: d)
            defer { controller.prepareForTermination() }
            controller.qaPresentOnboarding(.success)
            let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            try Data("practice".utf8).write(to: url)
            let asset = ContextAsset(id: UUID(), sessionID: UUID(), file: QuestionAssetFile(url: url),
                sha256: "practice", width: 160, height: 100, byteCount: 8,
                targetFingerprint: "practice", capturedAt: Date())
            let model = controller.model
            model.screenshots = [asset]; model.screenshotImages[asset.id] = NSImage(size: NSSize(width: 160, height: 100))
            model.answer = "FINAL: B. 60 km/h"
            model.status = .ready
            model.explanation = "Practice explanation"; model.explanationAvailable = true
            model.recoveryAvailable = true
            model.captureFeedback = "practice"; model.materials = [asset]
            if dismiss { controller.qaDismissOnboarding() } else { controller.qaAdvanceOnboarding() }
            XCTAssertTrue(d.bool(forKey: "onboardingDone"))
            XCTAssertNil(model.onboardingStep); XCTAssertFalse(model.expanded)
            XCTAssertEqual(model.status, .idle); XCTAssertEqual(model.statusText, L10n.statusReady)
            XCTAssertTrue(model.answer.isEmpty); XCTAssertTrue(model.explanation.isEmpty)
            XCTAssertTrue(model.screenshots.isEmpty); XCTAssertTrue(model.screenshotImages.isEmpty)
            XCTAssertTrue(model.materials.isEmpty); XCTAssertTrue(model.captureFeedback.isEmpty)
            XCTAssertFalse(model.explanationAvailable); XCTAssertFalse(model.recoveryAvailable)
            XCTAssertNil(model.resultReason); XCTAssertEqual(model.materialAreaHeight, 0)
            controller.setExpanded(true)
            XCTAssertTrue(model.displayedAnswer.isEmpty); XCTAssertFalse(model.showScreenshotTray)
        }
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
        // AppKit may restore the window responder while the busy primary is disabled.
        panel.makeFirstResponder(nil)
        panel.onMoveOnboardingFocus = { [weak view] in view?.moveKeyboardFocus(backwards: $0) }
        let tab = NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: [],
            timestamp: 0, windowNumber: panel.windowNumber, context: nil,
            characters: "\t", charactersIgnoringModifiers: "\t", isARepeat: false, keyCode: 48)!
        panel.keyDown(with: tab)
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
