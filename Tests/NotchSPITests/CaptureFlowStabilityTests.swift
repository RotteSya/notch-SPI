import AppKit
import XCTest
@testable import NotchSPI

/// Real controller intake/composition, with only image acquisition and provider transport gated.
/// No model, user credentials, system sleep or real network configuration is involved.
final class CaptureFlowStabilityTests: XCTestCase {
    @MainActor private func withController(_ body: (NotchController, StreamGate) async throws -> Void) async throws {
        let settings = Settings.shared
        let service = settings.serviceMode, provider = settings.apiProvider, mode = settings.mode
        let oldKey = settings.apiKey(for: APIProvider.byID("openai").storageKey)
        let copy = Appearance.autoCopyAnswer
        settings.serviceMode = ServiceMode.customKey; settings.apiProvider = "openai"; settings.mode = "tutor"
        settings.setAPIKey("offline-test-key", for: settings.activeProvider.storageKey)
        Appearance.autoCopyAnswer = false
        let controller = NotchController(activateServices: false)
        let gate = StreamGate()
        controller.qaAnswerStream = { delta, done in gate.callbacks.append((delta, done)) }
        controller.qaScreenshotCapture = {
            let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 160, pixelsHigh: 100,
                bitsPerSample: 8, samplesPerPixel: 3, hasAlpha: false, isPlanar: false,
                colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
            memset(bitmap.bitmapData!, 180, bitmap.bytesPerRow * bitmap.pixelsHigh)
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
        try await body(controller, gate)
    }
    @MainActor private final class StreamGate {
        var callbacks: [((String) -> Void, (Bool, String) -> Void)] = []
        func finish(_ index: Int, answer: String = "A", success: Bool = true, error: String = "") {
            callbacks[index].0("FINAL: \(answer)")
            callbacks[index].1(success, error)
        }
    }
    @MainActor private func waitFor(_ predicate: () -> Bool) async throws {
        for _ in 0..<200 {
            if predicate() { return }
            try await Task.sleep(for: .milliseconds(10))
        }
        XCTFail("Capture flow did not reach expected state")
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

    @MainActor func testRepeatedSingleShortcutDuringAnswerDoesNotDuplicateAndOldStreamCannotOverwriteNext() async throws {
        try await withController { controller, gate in
            controller.qaPressScreenshot(multiple: false)
            try await waitFor { gate.callbacks.count == 1 }
            controller.qaPressScreenshot(multiple: false)
            XCTAssertEqual(gate.callbacks.count, 1)
            gate.finish(0)
            controller.qaPressScreenshot(multiple: false)
            try await waitFor { gate.callbacks.count == 2 }
            gate.callbacks[0].0("STALE")
            gate.callbacks[0].1(false, "STALE")
            XCTAssertTrue(controller.qaRequestRunning)
            XCTAssertFalse(controller.model.answer.contains("STALE"))
            gate.finish(1, answer: "B")
            XCTAssertFalse(controller.qaRequestRunning)
            XCTAssertTrue(controller.model.answer.contains("B"))
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
