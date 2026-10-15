import AppKit
import XCTest
@testable import NotchSPI

final class ScreenshotIntakeTests: XCTestCase {
    @MainActor func testTrayFooterCollapsesWithoutMovingCaptureSlots() throws {
        let model = TutorModel()
        model.screenshotRoundActive = true
        model.screenshotRemaining = 3
        model.screenshots = (0..<4).map { _ in
            .init(id: UUID(), sessionID: UUID(),
                  file: QuestionAssetFile(url: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)),
                  sha256: "layout", width: 640, height: 400, byteCount: 0,
                  targetFingerprint: "fixture", capturedAt: Date())
        }
        let tray = ScreenshotTray(frame: .init(x: 0, y: 0, width: 560, height: model.screenshotTrayHeight))
        func refresh() {
            tray.frame.size.height = model.screenshotTrayHeight
            tray.update(assets: model.screenshots, images: [:], flying: [], message: model.screenshotHint,
                        remaining: model.screenshotRemaining, cancellable: true, notice: model.screenshotNotice,
                        undoAvailable: model.screenshotUndoAvailable)
            tray.layoutSubtreeIfNeeded()
        }
        refresh()
        let shortHeight = tray.frame.height
        let cards = tray.subviews.compactMap { $0 as? NotchActionButton }.filter { $0.subviews.contains { $0 is NSImageView } }
        XCTAssertEqual(cards.count, 4)
        let frames = cards.map(\.frame)
        for card in cards {
            XCTAssertGreaterThanOrEqual(card.frame.minX, NotchType.cardPadH)
            XCTAssertLessThanOrEqual(card.frame.maxX, tray.bounds.maxX - NotchType.cardPadH)
            XCTAssertLessThan(card.frame.maxY, shortHeight)
        }
        model.screenshotNotice = "目标已变化，请返回原窗口。"
        model.screenshotUndoAvailable = true
        refresh()
        XCTAssertGreaterThan(tray.frame.height, shortHeight)
        XCTAssertEqual(cards.map(\.frame), frames, "Footer hints must not move screenshot landing slots")
        let hint = try XCTUnwrap(tray.subviews.compactMap { $0 as? NSTextField }.first { $0.stringValue == model.screenshotNotice })
        XCTAssertLessThanOrEqual(hint.frame.maxY, tray.bounds.maxY)
        model.screenshotNotice = ""; model.screenshotUndoAvailable = false
        refresh()
        XCTAssertEqual(tray.frame.height, shortHeight)
        XCTAssertEqual(cards.map(\.frame), frames)
    }

    @MainActor private func fixture() throws -> ScreenCapture.Shot {
        let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 160, pixelsHigh: 100,
            bitsPerSample: 8, samplesPerPixel: 3, hasAlpha: false, isPlanar: false,
            colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
        memset(bitmap.bitmapData!, 180, bitmap.bytesPerRow * bitmap.pixelsHigh)
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".jpg")
        try bitmap.representation(using: .jpeg, properties: [:])!.write(to: url)
        return .init(path: url.path, blank: false, targetFingerprint: "fixture-window")
    }

    @MainActor private func settle(_ predicate: () -> Bool) async throws {
        for _ in 0..<100 {
            if predicate() { return }
            try await Task.sleep(for: .milliseconds(10))
        }
        XCTFail("Intake did not reach the expected state")
    }

    @MainActor private func makeController() -> NotchController {
        let controller = NotchController(activateServices: false)
        controller.qaScreenshotCapture = { [self] in .success(try! fixture()) }
        return controller
    }

    @MainActor func testIntakeSubmitsOrderedBatchOnceAndNextRoundHasNewOwnership() async throws {
        let savedMode = Settings.shared.mode
        defer { Settings.shared.mode = savedMode }
        let controller = makeController()
        defer { controller.prepareForTermination() }
        var clock: Double = 0, batches: [[ContextAsset]] = []
        controller.qaScreenshotClock = { clock }
        controller.qaScreenshotSubmit = { assets, mode in
            XCTAssertEqual(mode, "tutor"); batches.append(assets)
        }
        controller.qaPressScreenshot(multiple: true)
        try await settle { controller.model.screenshots.count == 1 }
        let first = controller.model.screenshots[0]
        clock = 1000; controller.qaTickScreenshotRound()
        XCTAssertTrue(batches.isEmpty)
        controller.qaPressScreenshot(multiple: true)
        try await settle { controller.model.screenshots.count == 2 }
        let ids = controller.model.screenshots.map(\.id)
        clock = 1003.99; controller.qaTickScreenshotRound()
        XCTAssertTrue(batches.isEmpty)
        clock = 1004; controller.qaTickScreenshotRound(); controller.qaTickScreenshotRound()
        XCTAssertEqual(batches.count, 1)
        XCTAssertEqual(batches.first?.map(\.id), ids)
        XCTAssertFalse(controller.model.screenshotRoundActive)
        controller.qaPressScreenshot(multiple: true)
        try await settle { controller.model.screenshots.count == 1 }
        XCTAssertNotEqual(controller.model.screenshots[0].sessionID, first.sessionID)
        XCTAssertTrue(FileManager.default.fileExists(atPath: first.file.url.path), "Submitted batches keep their own files")
        controller.qaCancelScreenshotRound()
        clock = 2000; controller.qaTickScreenshotRound()
        XCTAssertEqual(batches.count, 1)
        XCTAssertTrue(controller.model.screenshots.isEmpty)
    }

    @MainActor func testFullRoundNoticeClearsAtSubmissionWithoutChangingDeadlineOrBatch() async throws {
        let savedMode = Settings.shared.mode
        defer { Settings.shared.mode = savedMode }
        let controller = makeController()
        defer { controller.prepareForTermination() }
        var clock: Double = 0
        var batches: [[UUID]] = []
        controller.qaScreenshotClock = { clock }
        controller.qaScreenshotSubmit = { assets, _ in
            batches.append(assets.map(\.id))
            XCTAssertTrue(controller.model.screenshotNotice.isEmpty)
        }
        for count in 1...4 {
            controller.qaPressScreenshot(multiple: true)
            try await settle { controller.model.screenshots.count == count && !controller.model.screenshotCapturing }
        }
        let ids = controller.model.screenshots.map(\.id)
        controller.qaPressScreenshot(multiple: true)
        XCTAssertFalse(controller.model.screenshotNotice.isEmpty)
        clock = 3.99; controller.qaTickScreenshotRound()
        XCTAssertTrue(batches.isEmpty)
        clock = 4; controller.qaTickScreenshotRound(); controller.qaTickScreenshotRound()
        XCTAssertEqual(batches, [ids])
        XCTAssertTrue(controller.model.screenshotNotice.isEmpty)
        controller.model.flyingScreenshots = []
        controller.model.answer = "FINAL: B"; controller.model.status = .idle
        XCTAssertTrue(controller.model.usesAnswerShelf)
    }

    @MainActor func testCapturePausesAndCancelResumesWhilePreviousRequestIsRunning() async throws {
        let savedMode = Settings.shared.mode
        defer { Settings.shared.mode = savedMode }
        let controller = makeController()
        defer { controller.prepareForTermination() }
        var clock: Double = 0, submissions = 0
        controller.qaScreenshotClock = { clock }
        controller.qaScreenshotSubmit = { _, _ in submissions += 1 }
        for count in 1...2 {
            controller.qaPressScreenshot(multiple: true)
            try await settle { controller.model.screenshots.count == count }
        }
        var captureCompletion: CheckedContinuation<Result<ScreenCapture.Shot, CaptureError>, Never>?
        controller.qaScreenshotCapture = { await withCheckedContinuation { captureCompletion = $0 } }
        clock = 2.5
        controller.qaPressScreenshot(multiple: true)
        try await settle { captureCompletion != nil }
        controller.qaPressScreenshot(multiple: true) // Repeated shortcut cannot open another capture.
        clock = 20; controller.qaTickScreenshotRound()
        XCTAssertEqual(submissions, 0)
        XCTAssertEqual(controller.model.screenshotRemaining, 1.5)
        captureCompletion?.resume(returning: .failure(.captureFailed))
        try await settle { controller.model.screenshotRemaining == 1.5 && controller.model.screenshotStatus.contains("2/4") }
        controller.qaSetRequestRunning(true)
        clock = 22; controller.qaTickScreenshotRound()
        XCTAssertEqual(submissions, 0)
        controller.qaSetRequestRunning(false)
        controller.qaTickScreenshotRound()
        XCTAssertEqual(submissions, 1)
    }

    @MainActor func testCancelDuringCaptureRejectsLateSuccessfulCallback() async throws {
        let savedMode = Settings.shared.mode
        defer { Settings.shared.mode = savedMode }
        let controller = makeController()
        defer { controller.prepareForTermination() }
        var captureCompletion: CheckedContinuation<Result<ScreenCapture.Shot, CaptureError>, Never>?
        var submissions = 0
        controller.qaScreenshotSubmit = { _, _ in submissions += 1 }
        controller.qaScreenshotCapture = { await withCheckedContinuation { captureCompletion = $0 } }
        controller.qaPressScreenshot(multiple: true)
        try await settle { captureCompletion != nil }
        controller.qaCancelScreenshotRound()
        captureCompletion?.resume(returning: .success(try fixture()))
        try await Task.sleep(for: .milliseconds(60))
        XCTAssertTrue(controller.model.screenshots.isEmpty)
        XCTAssertTrue(controller.model.flyingScreenshots.isEmpty)
        XCTAssertFalse(controller.model.screenshotRoundActive)
        XCTAssertEqual(submissions, 0)
    }

    @MainActor func testPersonalityShortcutKeepsItsModeAndUsesTheSameSuccessfulIntake() async throws {
        let savedMode = Settings.shared.mode, savedText = Settings.shared.personaText
        defer { Settings.shared.mode = savedMode; Settings.shared.personaText = savedText }
        let controller = makeController()
        defer { controller.prepareForTermination() }
        Settings.shared.personaText = "QA persona: cooperative and thoughtful"
        var submissions = 0
        controller.qaScreenshotSubmit = { assets, mode in
            XCTAssertEqual(mode, "personality")
            XCTAssertEqual(assets.count, 1)
            submissions += 1
        }
        controller.qaPressScreenshot(mode: "personality", multiple: false)
        try await settle { submissions == 1 }
        XCTAssertEqual(controller.model.mode, "personality")
        XCTAssertEqual(controller.model.screenshots.count, 1)
        XCTAssertFalse(controller.model.screenshotRoundActive)
    }

    @MainActor func testSingleCaptureSubmitsWithoutWaitingAndFailureAddsNothing() async throws {
        let savedMode = Settings.shared.mode
        defer { Settings.shared.mode = savedMode }
        let controller = makeController()
        defer { controller.prepareForTermination() }
        var submissions = 0
        controller.qaScreenshotSubmit = { assets, mode in
            XCTAssertEqual(assets.count, 1); XCTAssertEqual(mode, "tutor"); submissions += 1
        }
        controller.qaPressScreenshot(multiple: false)
        try await settle { submissions == 1 }
        XCTAssertEqual(controller.model.screenshots.count, 1)
        controller.qaScreenshotCapture = { .failure(.captureFailed) }
        controller.qaPressScreenshot(multiple: false)
        try await settle { controller.model.status == .error }
        XCTAssertTrue(controller.model.screenshots.isEmpty)
        XCTAssertTrue(controller.model.flyingScreenshots.isEmpty)
        XCTAssertEqual(submissions, 1)
    }
    @MainActor func testSwitchingModesAdoptsNewScopeBeforeCaptureYields() async throws {
        let savedMode = Settings.shared.mode, savedText = Settings.shared.personaText
        defer { Settings.shared.mode = savedMode; Settings.shared.personaText = savedText }
        Settings.shared.mode = "tutor"
        Settings.shared.personaText = "QA persona: thoughtful"
        let controller = makeController()
        defer { controller.prepareForTermination() }
        controller.qaSynchronizeCaptureScope()
        var captureCompletion: CheckedContinuation<Result<ScreenCapture.Shot, CaptureError>, Never>?
        var modes: [String] = []
        controller.qaScreenshotCapture = { await withCheckedContinuation { captureCompletion = $0 } }
        controller.qaScreenshotSubmit = { _, mode in modes.append(mode) }
        for mode in ["personality", "tutor"] {
            captureCompletion = nil
            controller.qaPressScreenshot(mode: mode, multiple: false)
            try await settle { captureCompletion != nil }
            controller.qaSynchronizeCaptureScope() // Same observer as the one-second timer.
            XCTAssertTrue(controller.model.screenshotRoundActive)
            XCTAssertTrue(controller.model.screenshotCapturing)
            captureCompletion?.resume(returning: .success(try fixture()))
            try await settle { modes.last == mode }
            XCTAssertEqual(controller.model.screenshots.count, 1)
        }
        XCTAssertEqual(modes, ["personality", "tutor"])
    }

    @MainActor func testCompleteCapturedFileIsAdoptedWithoutCropOrPicker() async throws {
        let controller = makeController()
        defer { controller.prepareForTermination() }
        let shot = try fixture()
        let bytes = try Data(contentsOf: URL(fileURLWithPath: shot.path))
        controller.qaScreenshotCapture = { .success(shot) }
        var submitted: ContextAsset?
        controller.qaScreenshotSubmit = { assets, _ in submitted = assets.first }
        controller.qaPressScreenshot(multiple: false)
        try await settle { submitted != nil }
        let asset = try XCTUnwrap(submitted)
        XCTAssertEqual(asset.width, 160); XCTAssertEqual(asset.height, 100)
        XCTAssertEqual(try Data(contentsOf: asset.file.url), bytes, "No crop or second JPEG encoding")
        XCTAssertFalse(NSApp.windows.contains { $0.windowController is QuestionRegionPicker })
    }

    @MainActor func testWarmupStartsBeforeCaptureAndLatencyIncludesIntake() async throws {
        let controller = makeController()
        defer { controller.prepareForTermination() }
        var clock = 100.0
        var order: [String] = []
        controller.qaScreenshotClock = { clock }
        controller.qaScreenshotWarmUp = { order.append("warm") }
        controller.qaScreenshotCapture = { [self] in
            order.append("capture")
            clock += 0.45
            return .success(try! fixture())
        }
        controller.qaScreenshotSubmit = { _, _ in order.append("submit") }
        controller.qaPressScreenshot(multiple: false)
        try await settle { order.last == "submit" }
        XCTAssertEqual(order, ["warm", "capture", "submit"])
        let trace = try XCTUnwrap(controller.qaSubmittedLatency)
        XCTAssertEqual(trace.entry, .single)
        XCTAssertEqual(try XCTUnwrap(trace.offsets[.captureReady]), 450, accuracy: 0.001)
        clock += 1.6
        trace.complete(success: true); trace.mark(.renderStarted)
        XCTAssertEqual(try XCTUnwrap(trace.offsets[.renderStarted]), 2050, accuracy: 0.001,
            "The 450ms spent before runTapped must remain in the end-to-end total")
        controller.qaPressScreenshot(multiple: false)
        try await settle { order.count == 6 }
        XCTAssertNotEqual(controller.qaSubmittedLatency?.id, trace.id)
    }

}
