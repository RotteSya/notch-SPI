import AppKit
import Combine
import XCTest
@testable import NotchSPI

/// Real controller intake/composition, with only image acquisition and provider transport gated.
/// No model, user credentials, system sleep or real network configuration is involved.
final class CaptureFlowStabilityTests: XCTestCase {
    @MainActor private func withController(questionNow: @escaping () -> Date = Date.init,
                                          recentQuestions: RecentQuestionStore? = nil,
                                          _ body: (NotchController, StreamGate) async throws -> Void) async throws {
        let settings = Settings.shared
        let service = settings.serviceMode, provider = settings.apiProvider, mode = settings.mode
        let oldKey = settings.apiKey(for: APIProvider.byID("openai").storageKey)
        let copy = Appearance.autoCopyAnswer
        settings.serviceMode = ServiceMode.customKey; settings.apiProvider = "openai"; settings.mode = "tutor"
        settings.setAPIKey("offline-test-key", for: settings.activeProvider.storageKey)
        Appearance.autoCopyAnswer = false
        let controller = NotchController(activateServices: false, recentQuestions: recentQuestions, questionNow: questionNow)
        let gate = StreamGate()
        controller.qaAnswerStream = { delta, done in gate.callbacks.append((delta, done)) }
        controller.qaScreenshotCapture = {
            let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 160, pixelsHigh: 100,
                bitsPerSample: 8, samplesPerPixel: 3, hasAlpha: false, isPlanar: false,
                colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
            gate.captures += 1
            memset(bitmap.bitmapData!, Int32(180 + gate.captures % 50), bitmap.bytesPerRow * bitmap.pixelsHigh)
            let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".jpg")
            try! bitmap.representation(using: .jpeg, properties: [:])!.write(to: url)
            return .success(.init(path: url.path, blank: false, targetFingerprint: "stability-window"))
        }
        defer {
            controller.qaExpandedAnswerWindow?.close()
            controller.qaRecentQuestionsWindow?.close()
            controller.prepareForTermination()
            settings.setAPIKey(oldKey, for: APIProvider.byID("openai").storageKey)
            settings.serviceMode = service; settings.apiProvider = provider; settings.mode = mode
            Appearance.autoCopyAnswer = copy
        }
        do { try await body(controller, gate) }
        catch { await recentQuestions?.flush(); throw error }
        await recentQuestions?.flush()
    }
    @MainActor private final class StreamGate {
        var captures = 0
        var callbacks: [((String) -> Void, (Bool, String) -> Void)] = []
        func finish(_ index: Int, answer: String = "A", success: Bool = true, error: String = "") {
            callbacks[index].0("FINAL: \(answer)")
            if success {
                let result = ObjectiveResultV1(v: 1, kind: .singleChoice, state: .ready, answer: answer, reason: .none)
                let payload = String(decoding: try! JSONEncoder().encode(result), as: UTF8.self)
                callbacks[index].0("\nNSPI_RESULT_V1: \(payload)")
            }
            callbacks[index].1(success, error)
        }
    }
    private enum WaitFailure: Error { case timeout }
    @MainActor private func waitFor(_ stage: String = "capture state", file: StaticString = #filePath,
                                    line: UInt = #line, state: () -> String = { "" },
                                    _ predicate: () -> Bool) async throws {
        for _ in 0..<200 {
            if predicate() { return }
            try await Task.sleep(for: .milliseconds(10))
        }
        XCTFail("Capture flow did not reach \(stage). \(state())", file: file, line: line)
        throw WaitFailure.timeout
    }

    @MainActor func testSingleShortcutShowsOpenAnswerReviewAndRetakeWithOneRequestEach() async throws {
        let savedLanguage = L10n.setting
        L10n.setting = .zhHans
        defer { L10n.setting = savedLanguage }
        try await withController { controller, gate in
            let replies = [
                "合并两个相同的项。\nFINAL: 2x\nNSPI_RESULT_V1: {\"v\":1,\"kind\":\"other\",\"state\":\"ready\",\"answer\":\"2x\",\"reason\":\"none\"}",
                "两种分组会产生不同结果。\nFINAL: 6 或 10\nNSPI_RESULT_V1: {\"v\":1,\"kind\":\"other\",\"state\":\"review\",\"answer\":\"6 或 10\",\"reason\":\"ambiguous_question\"}",
                "NSPI_RESULT_V1: {\"v\":1,\"kind\":\"other\",\"state\":\"retake\",\"answer\":null,\"reason\":\"missing_context\"}",
            ]
            for (index, reply) in replies.enumerated() {
                controller.qaPressScreenshot(multiple: false)
                try await waitFor { gate.callbacks.count == index + 1 }
                gate.callbacks[index].0(reply)
                gate.callbacks[index].1(true, "")
                XCTAssertFalse(controller.qaRequestRunning)
                XCTAssertEqual(gate.callbacks.count, index + 1)
                XCTAssertFalse(controller.model.displayedAnswer.contains("NSPI_RESULT_V1"))
                if index == 0 {
                    XCTAssertEqual(controller.model.resultState, .ready)
                    XCTAssertTrue(controller.model.reasoningRevealed)
                    XCTAssertTrue(controller.model.displayedAnswer.contains("2x"))
                } else if index == 1 {
                    XCTAssertEqual(controller.model.captureHeading, "需核对")
                    XCTAssertTrue(controller.model.displayedAnswer.contains("6 或 10"))
                } else {
                    XCTAssertEqual(controller.model.captureHeading, "需要重拍")
                    XCTAssertTrue(controller.model.displayedAnswer.contains("缺少关键材料"))
                    XCTAssertNil(AnswerComposer.parse(controller.model.answer, streaming: false).final)
                }
            }
        }
    }

    @MainActor func testIdleExpiryPreservesCompletedReadingAndNextShortcutUsesFreshCapture() async throws {
        var now = Date()
        let history = RecentQuestionStore(directory: FileManager.default.temporaryDirectory
            .appendingPathComponent("notchspi-expiry-history-\(UUID())"))
        defer { try? FileManager.default.removeItem(at: history.directory) }
        try await withController(questionNow: { now }, recentQuestions: history) { controller, gate in
            // Exercise the first capture after a full day without any existing question.
            now.addTimeInterval(24 * 3600)
            controller.qaMaintainIdleState()
            controller.qaPressScreenshot(multiple: false)
            try await waitFor("first callback", state: {
                "callbacks=\(gate.callbacks.count), running=\(controller.qaRequestRunning), status=\(controller.model.status), images=\(controller.model.screenshots.count)"
            }) { gate.callbacks.count == 1 }
            gate.finish(0, answer: "A")
            // The history writer intentionally owns this snapshot until its independent copy
            // is committed. File-expiry assertions must not race that legitimate owner.
            await history.flush()
            controller.model.explanation = "Completed explanation stays readable."
            controller.model.explanationAvailable = true
            let answer = controller.model.answer
            let paths = controller.model.screenshots.map { $0.file.url.path }
            weak var fileOwner = controller.model.screenshots.first?.file
            defer { fileOwner = nil }
            XCTAssertFalse(paths.isEmpty)
            now.addTimeInterval(QuestionSessionStore.lifetime + 1)
            controller.qaMaintainIdleState()
            XCTAssertEqual(controller.model.answer, answer)
            XCTAssertEqual(controller.model.explanation, "Completed explanation stays readable.")
            XCTAssertFalse(controller.model.explanationAvailable, "Expired material cannot start a new explanation")
            XCTAssertTrue(controller.model.canExpandAnswer)
            XCTAssertTrue(controller.model.screenshots.isEmpty)
            XCTAssertTrue(controller.model.screenshotImages.isEmpty)
            var publications = 0
            let observation = controller.model.objectWillChange.sink { publications += 1 }
            // Advance multiple idle days; empty sessions must not repeatedly clear/redraw.
            for _ in 0..<96 {
                now.addTimeInterval(3600)
                controller.qaMaintainIdleState()
            }
            XCTAssertEqual(publications, 0)
            observation.cancel()
            XCTAssertEqual(gate.callbacks.count, 1)
            gate.callbacks[0].0("stale result")
            XCTAssertEqual(controller.model.answer, answer)
            // The transport test double owns the old callback lease until released.
            gate.callbacks[0] = ({ _ in }, { _, _ in })
            try await waitFor("last expired file owner released", state: {
                "remaining=\(paths.filter { FileManager.default.fileExists(atPath: $0) }.count), ownerAlive=\(fileOwner != nil), running=\(controller.qaRequestRunning), images=\(controller.model.screenshots.count)"
            }) { fileOwner == nil }
            await QuestionAssetFile.finishPendingRemovals()
            XCTAssertTrue(paths.allSatisfy { !FileManager.default.fileExists(atPath: $0) }, "Completed deletion must remove every expired file")
            controller.qaPressScreenshot(multiple: false)
            try await waitFor("fresh callback", state: {
                "callbacks=\(gate.callbacks.count), running=\(controller.qaRequestRunning), status=\(controller.model.status), images=\(controller.model.screenshots.count)"
            }) { gate.callbacks.count == 2 }
            gate.finish(1, answer: "B")
            XCTAssertEqual(controller.model.status, .idle)
            XCTAssertTrue(controller.model.answer.contains("B"))
            XCTAssertFalse(controller.qaRequestRunning)
        }
    }

    @MainActor func testGhostKeepsAnimatingAtIdleWithoutRetainingDetachedView() async throws {
        weak var releasedGhost: GhostIndicatorView?
        autoreleasepool {
            let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 30, height: 30),
                styleMask: .borderless, backing: .buffered, defer: false)
            let ghost = GhostIndicatorView(frame: NSRect(x: 0, y: 0, width: 24, height: 24))
            releasedGhost = ghost
            window.contentView = ghost
            XCTAssertEqual(ghost.qaClockActive, !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion)
            for _ in 0..<50 {
                ghost.busy = true
                XCTAssertEqual(ghost.qaClockActive, !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion)
                ghost.busy = false
                XCTAssertEqual(ghost.qaClockActive, !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion)
            }
            ghost.hero = true
            XCTAssertEqual(ghost.qaClockActive, !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion)
            window.contentView = nil
            XCTAssertFalse(ghost.qaClockActive)
        }
        try await waitFor { releasedGhost == nil }
    }

    @MainActor func testMaintenanceStopsOnTerminationAndRestartsIfQuitIsCancelled() {
        let controller = NotchController(activateServices: false)
        XCTAssertTrue(controller.qaMaintenanceTimerActive)
        controller.prepareForTermination()
        XCTAssertFalse(controller.qaMaintenanceTimerActive)
        controller.model.answer = "unchanged after shutdown"
        controller.qaMaintainIdleState()
        XCTAssertEqual(controller.model.answer, "unchanged after shutdown")
        controller.cancelTermination()
        XCTAssertTrue(controller.qaMaintenanceTimerActive)
        controller.cancelTermination()
        XCTAssertTrue(controller.qaMaintenanceTimerActive)
        controller.prepareForTermination()
        XCTAssertFalse(controller.qaMaintenanceTimerActive)
    }

    @MainActor func testPartialAnswerFailureCannotBecomeCompletedOrOpenReaderAndNextShortcutWorks() async throws {
        try await withController { controller, gate in
            controller.qaPressScreenshot(multiple: false)
            try await waitFor { gate.callbacks.count == 1 }
            gate.finish(0, success: false, error: "Output limit; no charge")
            XCTAssertEqual(controller.model.status, .error)
            XCTAssertEqual(controller.model.statusText, "Output limit; no charge")
            XCTAssertFalse(controller.model.canExpandAnswer)
            XCTAssertFalse(controller.model.explanationAvailable)
            XCTAssertFalse(controller.qaRequestRunning)
            controller.openExpandedAnswer()
            XCTAssertNil(controller.qaExpandedAnswerWindow)
            controller.qaPressScreenshot(multiple: false)
            try await waitFor { gate.callbacks.count == 2 }
            gate.finish(1, answer: "B")
            XCTAssertEqual(controller.model.status, .idle)
            XCTAssertTrue(controller.model.answer.contains("B"))
            XCTAssertTrue(controller.model.canExpandAnswer)
        }
    }

    @MainActor func testCompletedStreamIgnoresDuplicateCompletionAndLateDelta() async throws {
        try await withController { controller, gate in
            controller.qaPressScreenshot(multiple: false)
            try await waitFor { gate.callbacks.count == 1 }
            gate.finish(0)
            let answer = controller.model.answer, status = controller.model.statusText
            gate.callbacks[0].0("LATE OLD CONTENT")
            gate.callbacks[0].1(false, "late failure")
            XCTAssertEqual(controller.model.answer, answer)
            XCTAssertEqual(controller.model.statusText, status)
            XCTAssertEqual(controller.model.status, .idle)
        }
    }

    @MainActor func testGuideCompletionOmitsMultiImageMetadataAndDailyCompletionKeepsIt() async throws {
        for guiding in [true, false] {
            try await withController { controller, gate in
                if guiding {
                    controller.qaOnboardingPermission = { true }
                    controller.qaPresentOnboarding(.multiCapture)
                }
                for count in 1...2 {
                    controller.qaPressScreenshot(multiple: true)
                    try await waitFor { controller.model.screenshots.count == count && !controller.model.screenshotCapturing }
                }
                controller.qaSubmitScreenshotRound()
                try await waitFor { gate.callbacks.count == 1 }
                gate.finish(0)
                XCTAssertEqual(controller.model.statusText.contains(L10n.statusContextAttached), !guiding)
                if guiding { XCTAssertEqual(controller.model.statusText, L10n.statusDone) }
                XCTAssertTrue(controller.model.answer.contains("FINAL: A"))
            }
        }
    }

    @MainActor func testSingleShortcutReplacesThinkingAndStreamingRunsAndRejectsLateCallbacks() async throws {
        try await withController { controller, gate in
            let effort = Settings.shared.reasoningEffort
            defer { Settings.shared.reasoningEffort = effort }
            Settings.shared.reasoningEffort = "low"
            controller.qaPressScreenshot(multiple: false)
            try await waitFor { gate.callbacks.count == 1 }
            XCTAssertEqual(controller.qaRunReasoningEffort, "low")
            Settings.shared.reasoningEffort = "high"
            XCTAssertEqual(controller.model.status, .running)
            let firstID = controller.qaCaptureRunID
            let firstImage = try Data(contentsOf: XCTUnwrap(controller.model.screenshots.first).file.url)
            controller.qaPressScreenshot(multiple: false)
            // The old provider deliberately never acknowledges cancellation.
            gate.finish(0, answer: "STALE BEFORE CAPTURE")
            XCTAssertFalse(controller.model.answer.contains("STALE"))
            try await waitFor { gate.callbacks.count == 2 }
            XCTAssertEqual(gate.captures, 2)
            XCTAssertEqual(controller.qaRunReasoningEffort, "high")
            XCTAssertNotEqual(controller.qaCaptureRunID, firstID)
            XCTAssertEqual(controller.model.screenshots.count, 1)
            XCTAssertNotEqual(try Data(contentsOf: XCTUnwrap(controller.model.screenshots.first).file.url), firstImage)
            gate.callbacks[0].0("STALE DELTA")
            gate.callbacks[0].1(false, "STALE ERROR")
            XCTAssertTrue(controller.qaRequestRunning)
            XCTAssertEqual(controller.model.status, .running)
            XCTAssertFalse(controller.model.answer.contains("STALE"))
            gate.callbacks[1].0("partial second answer")
            XCTAssertEqual(controller.model.status, .streaming)
            controller.qaPressScreenshot(multiple: false)
            try await waitFor { gate.callbacks.count == 3 }
            XCTAssertEqual(gate.captures, 3)
            XCTAssertEqual(controller.model.answer, "")
            gate.finish(1, answer: "STALE SECOND")
            XCTAssertTrue(controller.qaRequestRunning)
            gate.finish(2, answer: "C")
            let answer = controller.model.answer
            gate.finish(0, answer: "STALE AFTER COMPLETION")
            gate.callbacks[1].1(false, "STALE ERROR")
            XCTAssertFalse(controller.qaRequestRunning)
            XCTAssertEqual(controller.model.status, .idle)
            XCTAssertEqual(controller.model.answer, answer)
            XCTAssertTrue(answer.contains("C"))
            XCTAssertFalse(answer.contains("STALE"))
        }
    }

    @MainActor func testSingleShortcutDoesNotInterruptActiveMultipleImageAnswer() async throws {
        try await withController { controller, gate in
            for count in 1...2 {
                controller.qaPressScreenshot(multiple: true)
                try await waitFor { controller.model.screenshots.count == count && !controller.model.screenshotCapturing }
            }
            controller.qaSubmitScreenshotRound()
            try await waitFor { gate.callbacks.count == 1 }
            let id = controller.qaCaptureRunID
            controller.qaPressScreenshot(multiple: false)
            XCTAssertEqual(controller.qaCaptureRunID, id)
            XCTAssertTrue(controller.qaRequestRunning)
            XCTAssertEqual(gate.captures, 2)
            gate.finish(0)
            XCTAssertEqual(controller.model.status, .idle)
            XCTAssertEqual(gate.callbacks.count, 1)
        }
    }

    @MainActor func testQueuedMultipleScreenshotsSubmitOnceAfterEarlierAnswerWithoutClick() async throws {
        try await withController { controller, gate in
            var clock = 0.0
            controller.qaScreenshotClock = { clock }
            controller.qaPressScreenshot(multiple: false)
            try await waitFor { gate.callbacks.count == 1 }
            for count in 1...2 {
                controller.qaPressScreenshot(multiple: true)
                try await waitFor { controller.model.screenshots.count == count && !controller.model.screenshotCapturing }
            }
            clock = 5; controller.qaTickScreenshotRound()
            XCTAssertEqual(gate.callbacks.count, 1)
            gate.finish(0)
            try await waitFor { gate.callbacks.count == 2 }
            XCTAssertEqual(controller.model.screenshots.count, 2)
            controller.qaTickScreenshotRound()
            XCTAssertEqual(gate.callbacks.count, 2)
            gate.finish(1, answer: "B")
            XCTAssertFalse(controller.qaRequestRunning)
        }
    }

    @MainActor func testSleepInterruptsActiveStreamRejectsLateCallbacksAndAllowsNextShortcut() async throws {
        try await withController { controller, gate in
            controller.qaPressScreenshot(multiple: false)
            try await waitFor { gate.callbacks.count == 1 }
            gate.callbacks[0].0("partial")
            NSWorkspace.shared.notificationCenter.post(name: NSWorkspace.willSleepNotification, object: nil)
            XCTAssertFalse(controller.qaRequestRunning)
            XCTAssertEqual(controller.model.status, .error)
            let interrupted = controller.model.answer
            gate.finish(0)
            XCTAssertEqual(controller.model.answer, interrupted)
            controller.qaPressScreenshot(multiple: false)
            try await waitFor { gate.callbacks.count == 2 }
            gate.finish(1, answer: "B")
            XCTAssertEqual(controller.model.status, .idle)
        }
    }

    @MainActor func testSleepCancelsPendingCountdownButPreservesCompletedReader() async throws {
        try await withController { controller, gate in
            var clock = 0.0
            controller.qaScreenshotClock = { clock }
            controller.qaPressScreenshot(multiple: false)
            try await waitFor { gate.callbacks.count == 1 }
            gate.finish(0)
            controller.openExpandedAnswer()
            let reader = try XCTUnwrap(controller.qaExpandedAnswerWindow)
            let answer = reader.content?.answer
            controller.qaSuspendCaptureWork()
            XCTAssertEqual(controller.model.status, .idle)
            for count in 1...2 {
                controller.qaPressScreenshot(multiple: true)
                try await waitFor { controller.model.screenshots.count == count && !controller.model.screenshotCapturing }
            }
            controller.qaSuspendCaptureWork()
            clock = 100; controller.qaTickScreenshotRound()
            XCTAssertEqual(gate.callbacks.count, 1)
            XCTAssertFalse(controller.model.screenshotRoundActive)
            XCTAssertEqual(reader.content?.answer, answer)
            XCTAssertFalse(reader.content?.canExplain ?? true)
        }
    }

    @MainActor func testSpaceAndWakeNotificationsCoalesceWithoutReplacingActiveQuestionOrFocus() async throws {
        try await withController { controller, gate in
            controller.qaPressScreenshot(multiple: false)
            try await waitFor { gate.callbacks.count == 1 }
            gate.callbacks[0].0("streaming text")
            let answer = controller.model.answer
            let focus = NSApp.keyWindow
            let initial = controller.qaScreenRefreshCount
            for _ in 0..<5 {
                NSWorkspace.shared.notificationCenter.post(name: NSWorkspace.activeSpaceDidChangeNotification, object: nil)
                NotificationCenter.default.post(name: NSApplication.didChangeScreenParametersNotification, object: nil)
            }
            XCTAssertTrue(controller.qaScreenRecheckPending)
            let immediate = controller.qaScreenRefreshCount
            XCTAssertGreaterThan(immediate, initial)
            try await Task.sleep(for: .milliseconds(900))
            XCTAssertFalse(controller.qaScreenRecheckPending)
            XCTAssertEqual(controller.qaScreenRefreshCount, immediate + 1)
            XCTAssertEqual(controller.model.answer, answer)
            XCTAssertTrue(controller.qaRequestRunning)
            XCTAssertEqual(gate.callbacks.count, 1)
            XCTAssertTrue(NSApp.keyWindow === focus)
            NSWorkspace.shared.notificationCenter.post(name: NSWorkspace.willSleepNotification, object: nil)
            XCTAssertFalse(controller.qaRequestRunning)
            NSWorkspace.shared.notificationCenter.post(name: NSWorkspace.didWakeNotification, object: nil)
            gate.finish(0, answer: "stale sleeping result")
            XCTAssertFalse(controller.model.answer.contains("stale sleeping result"))
            controller.qaPressScreenshot(multiple: false)
            try await waitFor { gate.callbacks.count == 2 }
            gate.finish(1, answer: "B")
            XCTAssertEqual(controller.model.status, .idle)
        }
    }

    @MainActor func testSleepAndTerminationCancelPendingDisplayRechecks() async throws {
        let controller = NotchController(activateServices: false)
        NSWorkspace.shared.notificationCenter.post(name: NSWorkspace.didWakeNotification, object: nil)
        XCTAssertTrue(controller.qaScreenRecheckPending)
        NSWorkspace.shared.notificationCenter.post(name: NSWorkspace.willSleepNotification, object: nil)
        XCTAssertFalse(controller.qaScreenRecheckPending)
        NSWorkspace.shared.notificationCenter.post(name: NSWorkspace.activeSpaceDidChangeNotification, object: nil)
        XCTAssertTrue(controller.qaScreenRecheckPending)
        controller.prepareForTermination()
        let count = controller.qaScreenRefreshCount
        try await Task.sleep(for: .milliseconds(900))
        XCTAssertFalse(controller.qaScreenRecheckPending)
        XCTAssertEqual(controller.qaScreenRefreshCount, count)
    }

    @MainActor func testReaderAndHistoryStayOnOldQuestionThroughDisplayChangeAndNextCapture() async throws {
        try await withController { controller, gate in
            controller.qaPressScreenshot(multiple: false)
            try await waitFor { gate.callbacks.count == 1 }
            gate.finish(0)
            controller.openExpandedAnswer(); controller.openRecentQuestions()
            let reader = try XCTUnwrap(controller.qaExpandedAnswerWindow)
            let history = try XCTUnwrap(controller.qaRecentQuestionsWindow)
            let original = reader.content?.id, answer = reader.content?.answer
            let keyWindow = NSApp.keyWindow
            for index in 1...20 {
                controller.qaPressScreenshot(multiple: false)
                try await waitFor { gate.callbacks.count == index + 1 }
                NotificationCenter.default.post(name: NSApplication.didChangeScreenParametersNotification, object: nil)
                await Task.yield()
                XCTAssertTrue(controller.qaRequestRunning)
                gate.finish(index, answer: "B")
                XCTAssertEqual(controller.model.status, .idle)
                XCTAssertEqual(reader.content?.id, original)
                XCTAssertEqual(reader.content?.answer, answer)
                XCTAssertFalse(reader.content?.canExplain ?? true)
                XCTAssertTrue(controller.qaRecentQuestionsWindow === history)
                XCTAssertTrue(history.window?.isVisible == true)
                XCTAssertTrue(NSApp.keyWindow === keyWindow)
            }
        }
    }
}
