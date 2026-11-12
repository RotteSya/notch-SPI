import AppKit
import XCTest
@testable import NotchSPI

final class PermissionRelaunchTests: XCTestCase {
    @MainActor func testFreshGrantRestartsWhenCurrentProcessPreflightStaysDenied() async throws {
        let name = "permission-fresh-\(UUID())"
        let defaults = UserDefaults(suiteName: name)!
        let controller = NotchController(activateServices: false, onboardingDefaults: defaults)
        defer { controller.prepareForTermination(); defaults.removePersistentDomain(forName: name) }
        var freshGranted = false, probes = 0, restarts = 0
        controller.qaOnboardingPermission = { false }
        controller.qaRequestOnboardingPermission = { false }
        controller.qaFreshOnboardingPermission = { probes += 1; return freshGranted }
        controller.qaOnboardingRelaunch = { restarts += 1; XCTAssertFalse(controller.qaOnboardingPanelVisible) }
        controller.qaPresentOnboarding(.permission)
        controller.qaCheckOnboardingPermission()
        await Task.yield()
        XCTAssertEqual(probes, 0, "Do not probe before the explicit permission action")
        controller.qaAdvanceOnboarding()
        controller.qaCheckOnboardingPermission()
        controller.qaCheckOnboardingPermission()
        try await Task.sleep(for: .milliseconds(30))
        XCTAssertEqual(probes, 1, "Only one probe may be in flight")
        XCTAssertEqual(restarts, 0, "Denied probes must not cause restart loops")
        freshGranted = true
        controller.qaCheckOnboardingPermission()
        try await Task.sleep(for: .milliseconds(30))
        controller.qaCheckOnboardingPermission()
        XCTAssertEqual(restarts, 1)
        XCTAssertFalse(controller.qaOnboardingPanelVisible)
        XCTAssertEqual(NotchOnboardingProgress(defaults: defaults).permissionResumeMultiple, false)
    }

    @MainActor func testLatePermissionProbeCannotRestartAfterLeavingOrTerminating() async throws {
        for terminate in [false, true] {
            let name = "permission-probe-cancel-\(UUID())"
            let defaults = UserDefaults(suiteName: name)!
            let controller = NotchController(activateServices: false, onboardingDefaults: defaults)
            defer { controller.prepareForTermination(); defaults.removePersistentDomain(forName: name) }
            var completion: CheckedContinuation<Bool, Never>?
            controller.qaOnboardingPermission = { false }
            controller.qaRequestOnboardingPermission = { false }
            controller.qaFreshOnboardingPermission = { await withCheckedContinuation { completion = $0 } }
            controller.qaOnboardingRelaunch = { XCTFail("A late probe cannot restart an inactive guide") }
            controller.qaPresentOnboarding(.permission)
            controller.qaAdvanceOnboarding()
            controller.qaCheckOnboardingPermission()
            try await Task.sleep(for: .milliseconds(30))
            XCTAssertNotNil(completion)
            if terminate { controller.prepareForTermination() } else { controller.qaDismissOnboarding() }
            completion?.resume(returning: true)
            try await Task.sleep(for: .milliseconds(30))
        }
    }

    @MainActor func testFreshProbeFailsClosedWithoutAValidSuccessfulExecutable() async {
        let allowed = await PermissionRelaunch.hasFreshPermission(executable: URL(fileURLWithPath: "/usr/bin/true"))
        let denied = await PermissionRelaunch.hasFreshPermission(executable: URL(fileURLWithPath: "/usr/bin/false"))
        let missing = await PermissionRelaunch.hasFreshPermission(executable: nil)
        XCTAssertTrue(allowed)
        XCTAssertFalse(denied)
        XCTAssertFalse(missing)
    }

    @MainActor func testPermissionActionHidesBeforeRequestAndPollingNeverReopensPanel() async throws {
        let name = "permission-hidden-\(UUID())"
        let defaults = UserDefaults(suiteName: name)!
        let controller = NotchController(activateServices: false, onboardingDefaults: defaults)
        defer { controller.prepareForTermination(); defaults.removePersistentDomain(forName: name) }
        var granted = false, requests = 0, settings = 0, restarts = 0
        controller.qaOnboardingPermission = { granted }
        controller.qaOnboardingRelaunch = { restarts += 1; XCTAssertFalse(controller.qaOnboardingPanelVisible) }
        controller.qaRequestOnboardingPermission = {
            requests += 1
            XCTAssertFalse(controller.qaOnboardingPanelVisible)
            XCTAssertFalse(controller.qaOnboardingPanelKey)
            return false
        }
        controller.qaOpenOnboardingPermissionSettings = {
            settings += 1
            XCTAssertFalse(controller.qaOnboardingPanelVisible)
            return true
        }
        controller.qaPresentOnboarding(.permission)
        controller.qaAdvanceOnboarding()
        await Task.yield() // Deferred initial focus must not revive the just-hidden panel.
        XCTAssertEqual(requests, 1)
        XCTAssertEqual(controller.model.onboardingStep, .permission)
        controller.qaCheckOnboardingPermission()
        controller.show()
        controller.qaStartAutoMode()
        controller.setExpanded(true)
        XCTAssertFalse(controller.qaOnboardingPanelVisible)
        XCTAssertEqual(restarts, 0)
        controller.resumeHiddenOnboardingPermission()
        XCTAssertTrue(controller.qaOnboardingPanelVisible)
        controller.qaAdvanceOnboarding()
        XCTAssertEqual(settings, 1)
        XCTAssertFalse(controller.qaOnboardingPanelVisible)
        granted = true
        controller.qaCheckOnboardingPermission()
        controller.qaCheckOnboardingPermission()
        XCTAssertEqual(restarts, 1)
        XCTAssertFalse(controller.qaOnboardingPanelVisible)
        XCTAssertEqual(NotchOnboardingProgress(defaults: defaults).permissionResumeMultiple, false)
    }

    @MainActor func testImmediateGrantRestartsHiddenAndSettingsOpenFailureCanRecover() {
        let name = "permission-immediate-\(UUID())"
        let defaults = UserDefaults(suiteName: name)!
        let controller = NotchController(activateServices: false, onboardingDefaults: defaults)
        defer { controller.prepareForTermination(); defaults.removePersistentDomain(forName: name) }
        controller.qaOnboardingPermission = { false }
        controller.qaPresentOnboarding(.permission)
        controller.model.onboardingPermissionDenied = true
        controller.qaOpenOnboardingPermissionSettings = { false }
        controller.qaAdvanceOnboarding()
        XCTAssertTrue(controller.qaOnboardingPanelVisible)
        XCTAssertFalse(controller.model.captureFeedback.isEmpty)
        controller.model.onboardingPermissionDenied = false
        controller.qaRequestOnboardingPermission = {
            XCTAssertFalse(controller.qaOnboardingPanelVisible)
            return true
        }
        var restarts = 0
        controller.qaOnboardingRelaunch = { restarts += 1; XCTAssertFalse(controller.qaOnboardingPanelVisible) }
        controller.qaAdvanceOnboarding()
        XCTAssertEqual(restarts, 1)
        XCTAssertFalse(controller.qaOnboardingPanelVisible)
    }

    @MainActor func testGrantSchedulesOnceAndNextLaunchRestoresBothLessonsWithoutCapture() throws {
        for multiple in [false, true] {
            let name = "permission-resume-\(UUID())"
            let defaults = UserDefaults(suiteName: name)!
            let before = NotchController(activateServices: false, onboardingDefaults: defaults)
            let after = NotchController(activateServices: false, onboardingDefaults: defaults)
            defer {
                before.prepareForTermination(); after.prepareForTermination()
                defaults.removePersistentDomain(forName: name)
            }
            var allowed = false, relaunches = 0, opens = 0, captures = 0
            before.qaOnboardingPermission = { allowed }
            before.qaOnboardingRelaunch = { relaunches += 1 }
            before.qaPresentOnboarding(multiple ? .multiCapture : .capture)
            before.qaPressScreenshot(multiple: multiple)
            XCTAssertEqual(before.model.onboardingStep, .permission)
            XCTAssertEqual(NotchOnboardingProgress(defaults: defaults).permissionResumeMultiple, multiple)
            before.qaCheckOnboardingPermission()
            XCTAssertEqual(relaunches, 0)
            allowed = true
            before.qaCheckOnboardingPermission()
            before.qaCheckOnboardingPermission()
            before.qaAdvanceOnboarding()
            XCTAssertEqual(relaunches, 1)
            before.prepareForTermination()
            after.qaOnboardingPermission = { true }
            after.qaOnboardingRelaunch = { XCTFail("A restored process must not restart again") }
            after.qaOpenPracticePage = { url in
                opens += 1
                XCTAssertEqual(url.lastPathComponent, multiple ? "NotchSPI-Multiple-Practice.html" : "NotchSPI-Practice.html")
                return true
            }
            after.qaScreenshotCapture = { captures += 1; return .failure(.captureFailed) }
            after.showOnboardingIfNeeded()
            XCTAssertEqual(after.model.onboardingStep, multiple ? .multiCapture : .capture)
            XCTAssertEqual(opens, 1)
            XCTAssertEqual(captures, 0)
            XCTAssertNil(NotchOnboardingProgress(defaults: defaults).permissionResumeMultiple)
            XCTAssertFalse(defaults.bool(forKey: "onboardingDone"))
            after.qaCheckOnboardingPermission()
            XCTAssertEqual(relaunches, 1)
        }
    }

    @MainActor func testSystemRelaunchBeforeGrantPollStillRestoresPractice() {
        let name = "permission-system-relaunch-\(UUID())"
        let defaults = UserDefaults(suiteName: name)!
        let progress = NotchOnboardingProgress(defaults: defaults)
        progress.preparePermissionResume(multiple: true)
        let controller = NotchController(activateServices: false, onboardingDefaults: defaults)
        defer { controller.prepareForTermination(); defaults.removePersistentDomain(forName: name) }
        controller.qaOnboardingPermission = { true }
        controller.qaOpenPracticePage = { _ in true }
        controller.qaOnboardingRelaunch = { XCTFail("System has already relaunched the app") }
        controller.showOnboardingIfNeeded()
        XCTAssertEqual(controller.model.onboardingStep, .multiCapture)
        XCTAssertNil(progress.permissionResumeMultiple)
    }

    @MainActor func testDeniedRelaunchDoesNotLoopAndHelperFailurePreservesProgress() {
        let name = "permission-denied-\(UUID())"
        let defaults = UserDefaults(suiteName: name)!
        let progress = NotchOnboardingProgress(defaults: defaults)
        progress.preparePermissionResume(multiple: true)
        let controller = NotchController(activateServices: false, onboardingDefaults: defaults)
        defer { controller.prepareForTermination(); defaults.removePersistentDomain(forName: name) }
        var granted = false, attempts = 0
        controller.qaOnboardingPermission = { granted }
        controller.qaOnboardingRelaunch = { attempts += 1; throw PermissionRelaunch.Failure.notApplicationBundle }
        controller.showOnboardingIfNeeded()
        controller.qaCheckOnboardingPermission()
        XCTAssertEqual(attempts, 0)
        XCTAssertEqual(controller.model.onboardingStep, .permission)
        XCTAssertTrue(controller.model.onboardingMultiple)
        granted = true
        controller.qaCheckOnboardingPermission()
        controller.qaCheckOnboardingPermission()
        XCTAssertEqual(attempts, 1)
        XCTAssertEqual(progress.permissionResumeMultiple, true)
        XCTAssertFalse(controller.model.captureFeedback.isEmpty)
        controller.qaAdvanceOnboarding()
        XCTAssertEqual(attempts, 2, "Only an explicit action retries a failed restart")
        controller.qaOnboardingRelaunch = { attempts += 1 }
        controller.qaAdvanceOnboarding()
        controller.qaCheckOnboardingPermission()
        controller.qaAdvanceOnboarding()
        XCTAssertEqual(attempts, 3, "Successful retry clears failure state and cannot schedule twice")
        XCTAssertTrue(controller.model.captureFeedback.isEmpty)
    }

    func testHelperWaitsForExitAndTreatsApplicationPathAsLiteralArgument() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("permission-relaunch-\(UUID())")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let app = directory.appendingPathComponent("Notch SPI ' $literal ;.app")
        let parent = Process()
        parent.executableURL = URL(fileURLWithPath: "/bin/sleep")
        parent.arguments = ["1"]
        try parent.run()
        defer { if parent.isRunning { parent.terminate() } }
        // touch is a harmless stand-in for open: it records the exact argument after parent exit.
        let helper = try PermissionRelaunch.schedule(appURL: app, processID: parent.processIdentifier, opener: "/usr/bin/touch")
        defer { if helper.isRunning { helper.terminate() } }
        try await Task.sleep(for: .milliseconds(100))
        XCTAssertTrue(parent.isRunning)
        XCTAssertFalse(FileManager.default.fileExists(atPath: app.path))
        for _ in 0..<150 where helper.isRunning { try await Task.sleep(for: .milliseconds(20)) }
        XCTAssertFalse(helper.isRunning)
        XCTAssertEqual(helper.terminationStatus, 0)
        XCTAssertTrue(FileManager.default.fileExists(atPath: app.path))
    }

    func testUnbundledExecutableCannotScheduleRelaunch() {
        XCTAssertThrowsError(try PermissionRelaunch.schedule(appURL: URL(fileURLWithPath: "/tmp/NotchSPI")))
    }
}
