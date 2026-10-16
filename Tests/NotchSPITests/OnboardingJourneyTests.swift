import AppKit
import XCTest
@testable import NotchSPI

final class OnboardingJourneyTests: XCTestCase {
    @MainActor func testTrialUnavailableNeverClaimsAndCanBeSkippedWithoutGrant() {
        let name = "guide-trial-unavailable-\(UUID())"
        let d = UserDefaults(suiteName: name)!
        let controller = NotchController(activateServices: false, onboardingDefaults: d)
        defer { controller.prepareForTermination(); d.removePersistentDomain(forName: name) }
        controller.qaPresentOnboarding(.success)
        controller.qaAdvanceOnboarding()
        controller.qaAdvanceOnboarding()
        XCTAssertEqual(controller.model.onboardingStep, .trial)
        XCTAssertEqual(controller.model.onboardingTrialState, .unavailable)
        XCTAssertFalse(d.bool(forKey: "onboardingDone"))
        controller.qaOnboardingSecondary()
        XCTAssertNil(controller.model.onboardingStep)
        XCTAssertTrue(d.bool(forKey: "onboardingDone"))
        XCTAssertEqual(controller.model.onboardingTrialState, .unavailable)
    }

    @MainActor func testTrialClaimIsSingleFlightCanRetryAndRejectsLateCompletionAfterLeaving() async throws {
        let name = "guide-trial-claim-\(UUID())"
        let d = UserDefaults(suiteName: name)!
        let controller = NotchController(activateServices: false, onboardingDefaults: d)
        defer { controller.prepareForTermination(); d.removePersistentDomain(forName: name) }
        var calls = 0
        var pending: CheckedContinuation<Bool, Never>?
        controller.qaOnboardingClaimTrial = {
            calls += 1
            return await withCheckedContinuation { pending = $0 }
        }
        controller.model.onboardingTrialState = .available
        controller.qaPresentOnboarding(.trial)
        controller.qaAdvanceOnboarding()
        try await settle { pending != nil }
        controller.qaAdvanceOnboarding()
        controller.qaOnboardingSecondary()
        XCTAssertEqual(calls, 1)
        XCTAssertEqual(controller.model.onboardingStep, .trial)
        pending?.resume(returning: false); pending = nil
        try await settle { controller.model.onboardingTrialState == .failed }
        XCTAssertFalse(d.bool(forKey: "onboardingDone"))
        controller.qaAdvanceOnboarding()
        try await settle { pending != nil }
        XCTAssertEqual(calls, 2)
        controller.qaDismissOnboarding()
        XCTAssertEqual(NotchOnboardingProgress(defaults: d).resumeStep, .trial)
        pending?.resume(returning: true)
        try await Task.sleep(for: .milliseconds(30))
        XCTAssertNil(controller.model.onboardingStep)
        XCTAssertFalse(d.bool(forKey: "onboardingDone"))
        XCTAssertEqual(controller.model.onboardingTrialState, .available)
    }

    @MainActor func testChangingShortcutRefreshesGuideAndPracticeWithoutCapturingOrAdvancing() async throws {
        let saved = Settings.shared.captureCombo
        let controller = NotchController(activateServices: false)
        defer {
            controller.prepareForTermination()
            Settings.shared.captureCombo = saved
            HotKeyCenter.shared.unregisterAll()
        }
        var captures = 0, openedHTML: String?
        controller.qaScreenshotCapture = { captures += 1; return .failure(.captureFailed) }
        controller.qaOpenPracticePage = { url in
            openedHTML = try? String(contentsOf: url, encoding: .utf8)
            return openedHTML != nil
        }
        controller.qaPresentOnboarding(.capture)
        try await settle { controller.qaOnboardingShortcut == Settings.displayString(saved) }
        controller.openSettings(page: .hotkeys)
        let settings = try XCTUnwrap(controller.qaSettingsWindow)
        Settings.shared.captureCombo = .init(keyCode: 49, modifiers: saved.modifiers, label: "Space")
        settings.onHotkeysChanged?()
        let expected = Settings.displayString(Settings.shared.captureCombo)
        try await settle { controller.qaOnboardingShortcut == expected }
        XCTAssertNil(openedHTML, "Wait until settings closes before reopening practice")
        settings.close()
        XCTAssertTrue(try XCTUnwrap(openedHTML).contains("<kbd>\(expected)</kbd>"))
        XCTAssertEqual(controller.model.onboardingStep, .capture)
        XCTAssertEqual(captures, 0)
        XCTAssertTrue(controller.model.screenshots.isEmpty)
    }

    @MainActor func testCaptureLessonsRejectClicksAndWrongShortcutBeforeAcceptingMatchingHotkey() async throws {
        let mode = Settings.shared.mode
        defer { Settings.shared.mode = mode }
        for (step, multiple) in [(NotchOnboardingStep.capture, false), (.multiCapture, true), (.collecting, true), (.working, false)] {
            let controller = NotchController(activateServices: false)
            defer { controller.prepareForTermination() }
            controller.qaOnboardingPermission = { true }
            var captures = 0
            controller.qaScreenshotCapture = { captures += 1; return .failure(.captureFailed) }
            controller.qaPresentOnboarding(step)
            controller.model.status = .error
            controller.qaAdvanceOnboarding()
            controller.qaTriggerCapture()
            controller.qaPressScreenshot(multiple: !multiple)
            await Task.yield()
            XCTAssertEqual(captures, 0, "Buttons and the other lesson's shortcut cannot capture")
            XCTAssertEqual(controller.model.onboardingStep, step)
            controller.qaPressScreenshot(multiple: multiple)
            try await settle { captures == 1 && !controller.model.screenshotCapturing }
            XCTAssertEqual(captures, 1)
        }
    }

    @MainActor func testCapturePromptsArePassiveUseCurrentBindingAndKeepRetryMode() {
        let locale = L10n.setting, single = Settings.shared.captureCombo, multi = Settings.shared.contextCombo
        defer { L10n.setting = locale; Settings.shared.captureCombo = single; Settings.shared.contextCombo = multi }
        Settings.shared.captureCombo = .init(keyCode: 49, modifiers: single.modifiers, label: "Space")
        Settings.shared.contextCombo = .init(keyCode: 124, modifiers: multi.modifiers, label: "→")
        for language in [AppLanguage.zhHans, .ja, .en] {
            L10n.setting = language
            let view = NotchOnboardingView(frame: .init(x: 0, y: 0, width: 600, height: 480))
            var actions = 0
            view.onPrimary = { actions += 1 }
            for (step, multiple) in [(NotchOnboardingStep.capture, false), (.multiCapture, true), (.collecting, true), (.working, false), (.working, true)] {
                view.update(step: step, granted: true, denied: false, failed: true, multiple: multiple)
                view.layoutSubtreeIfNeeded()
                XCTAssertTrue(view.primary.isHidden)
                XCTAssertFalse(view.primary.isEnabled)
                view.primary.onClick?()
                XCTAssertEqual(actions, 0)
                XCTAssertFalse(view.shortcutPrompt.isHidden)
                XCTAssertEqual(view.shortcutPrompt.displayString, Settings.displayString(multiple ? Settings.shared.contextCombo : Settings.shared.captureCombo))
                XCTAssertNil(view.shortcutPrompt.hitTest(.zero))
                for button in view.subviews.compactMap({ $0 as? GlowButton }) where !button.isHidden {
                    XCTAssertFalse(button.frame.intersects(view.shortcutPrompt.frame))
                }
                let html = OnboardingPractice.html(multiple: multiple)
                XCTAssertTrue(html.contains("<kbd>\(view.shortcutPrompt.displayString)</kbd>"))
            }
        }
    }

    @MainActor private func shot() throws -> ScreenCapture.Shot {
        let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 160, pixelsHigh: 100,
            bitsPerSample: 8, samplesPerPixel: 3, hasAlpha: false, isPlanar: false,
            colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
        memset(rep.bitmapData!, 180, rep.bytesPerRow * rep.pixelsHigh)
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".jpg")
        try rep.representation(using: .jpeg, properties: [:])!.write(to: url)
        return .init(path: url.path, blank: false, targetFingerprint: "practice")
    }
    @MainActor private func settle(_ condition: () -> Bool) async throws {
        for _ in 0..<100 { if condition() { return }; try await Task.sleep(for: .milliseconds(10)) }
        XCTFail("Guide intake failed to settle")
    }
    @MainActor func testTwoImageLessonUsesRealCountdownPreviewAndCompletionCleanup() async throws {
        let d = UserDefaults(suiteName: "guide-journey-\(UUID())")!
        let controller = NotchController(activateServices: false, onboardingDefaults: d)
        let mode = Settings.shared.mode
        defer { controller.prepareForTermination(); Settings.shared.mode = mode }
        controller.qaOnboardingPermission = { true }
        controller.qaOpenPracticePage = { _ in true }
        controller.qaScreenshotCapture = { [self] in .success(try! shot()) }
        var now: Double = 0, submissions = 0
        controller.qaScreenshotClock = { now }
        controller.qaScreenshotSubmit = { _, _ in submissions += 1 }
        controller.qaPresentOnboarding(.firstAnswer)
        controller.model.answer = "FINAL: B. 60 km/h"
        controller.qaAdvanceOnboarding()
        XCTAssertEqual(controller.model.onboardingStep, .multiCapture)
        XCTAssertTrue(controller.model.answer.isEmpty)
        controller.qaPressScreenshot(multiple: true)
        try await settle { controller.model.screenshots.count == 1 }
        now = 100; controller.qaTickScreenshotRound()
        XCTAssertEqual(submissions, 0)
        controller.qaPressScreenshot(multiple: true)
        try await settle { controller.model.screenshots.count == 2 }
        XCTAssertEqual(controller.model.onboardingStep, .collecting)
        controller.qaPreviewScreenshots(true)
        now = 200; controller.qaTickScreenshotRound()
        XCTAssertEqual(submissions, 0)
        controller.qaPreviewScreenshots(false)
        now = 203.99; controller.qaTickScreenshotRound()
        XCTAssertEqual(submissions, 0)
        now = 204; controller.qaTickScreenshotRound()
        XCTAssertEqual(submissions, 1)
        XCTAssertEqual(controller.model.onboardingStep, .working)
        XCTAssertEqual(NotchOnboardingProgress(defaults: d).resumeStep, .multiple)
        controller.qaFinishOnboardingCapture(success: true)
        XCTAssertEqual(controller.model.onboardingStep, .success)
        XCTAssertFalse(d.bool(forKey: "onboardingDone"))
        controller.model.answer = "FINAL: B. 60 km/h"
        controller.qaAdvanceOnboarding()
        XCTAssertEqual(controller.model.onboardingStep, .trial)
        XCTAssertEqual(NotchOnboardingProgress(defaults: d).resumeStep, .trial)
        XCTAssertFalse(d.bool(forKey: "onboardingDone"))
        XCTAssertTrue(controller.model.answer.isEmpty)
        XCTAssertTrue(controller.model.screenshots.isEmpty)
        controller.model.onboardingTrialState = .available
        controller.qaOnboardingClaimTrial = { true }
        controller.qaAdvanceOnboarding()
        try await settle { controller.model.onboardingTrialState == .claimed }
        controller.qaAdvanceOnboarding()
        XCTAssertTrue(d.bool(forKey: "onboardingDone"))
        XCTAssertNil(controller.model.onboardingStep)
        XCTAssertTrue(controller.model.answer.isEmpty)
        XCTAssertTrue(controller.model.screenshots.isEmpty)
        XCTAssertFalse(controller.model.expanded)
    }
    @MainActor func testLeavingCollectionCancelsTimerAndPermissionReturnDoesNotCapture() async throws {
        let controller = NotchController(activateServices: false)
        let mode = Settings.shared.mode
        defer { controller.prepareForTermination(); Settings.shared.mode = mode }
        var allowed = false, calls = 0, submissions = 0, now: Double = 0
        controller.qaOnboardingPermission = { allowed }
        controller.qaScreenshotClock = { now }
        controller.qaScreenshotCapture = { [self] in calls += 1; return .success(try! shot()) }
        controller.qaScreenshotSubmit = { _, _ in submissions += 1 }
        controller.qaPresentOnboarding(.collecting)
        controller.qaPressScreenshot(multiple: true)
        XCTAssertEqual(controller.model.onboardingStep, .permission)
        XCTAssertEqual(calls, 0)
        allowed = true; controller.qaAdvanceOnboarding()
        XCTAssertEqual(controller.model.onboardingStep, .multiCapture)
        XCTAssertEqual(calls, 0)
        controller.qaPressScreenshot(multiple: true)
        try await settle { controller.model.screenshots.count == 1 }
        controller.qaPressScreenshot(multiple: true)
        try await settle { controller.model.screenshots.count == 2 }
        controller.qaDismissOnboarding()
        now = 100; controller.qaTickScreenshotRound()
        XCTAssertNil(controller.model.onboardingStep)
        XCTAssertEqual(submissions, 0)
        XCTAssertTrue(controller.model.screenshots.isEmpty)
    }
    @MainActor func testMultiPracticeFailureAndOneImageCannotClaimMultiCompletion() async throws {
        let d = UserDefaults(suiteName: "guide-recovery-\(UUID())")!
        let controller = NotchController(activateServices: false, onboardingDefaults: d)
        let mode = Settings.shared.mode
        defer { controller.prepareForTermination(); Settings.shared.mode = mode }
        controller.qaOnboardingPermission = { true }
        controller.qaOpenPracticePage = { _ in false }
        controller.qaPresentOnboarding(.firstAnswer)
        controller.qaAdvanceOnboarding()
        XCTAssertEqual(controller.model.onboardingStep, .multiple)
        XCTAssertTrue(controller.model.onboardingPracticeFailed)
        controller.qaOpenPracticePage = { _ in true }
        controller.qaAdvanceOnboarding()
        XCTAssertEqual(controller.model.onboardingStep, .multiCapture)
        controller.qaScreenshotCapture = { [self] in .success(try! shot()) }
        controller.qaScreenshotSubmit = { _, _ in }
        controller.qaPressScreenshot(multiple: true)
        try await settle { controller.model.screenshots.count == 1 }
        controller.qaSubmitScreenshotRound()
        controller.qaFinishOnboardingCapture(success: true)
        XCTAssertEqual(controller.model.onboardingStep, .collecting)
        XCTAssertFalse(d.bool(forKey: "onboardingDone"))
    }
    @MainActor func testPracticeLanguagesAndCustomShortcutEscaping() {
        let old = L10n.setting
        defer { L10n.setting = old }
        for (language, marker) in [(AppLanguage.zhHans, "zh-Hans"), (.ja, "ja"), (.en, "en")] {
            L10n.setting = language
            for multiple in [false, true] {
                let html = OnboardingPractice.html(multiple: multiple)
                XCTAssertTrue(html.contains("lang=\"\(marker)\""))
                XCTAssertTrue(html.contains("120")); XCTAssertTrue(html.contains("60 km/h"))
                XCTAssertFalse(html.contains("FINAL:"))
                XCTAssertEqual(html.contains("id=\"question\" hidden"), multiple)
                XCTAssertEqual(html.contains("aria-pressed=\"true\""), multiple)
            }
        }
    }
}
