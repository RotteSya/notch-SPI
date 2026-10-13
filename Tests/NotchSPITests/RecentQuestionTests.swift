import AppKit
import XCTest
@testable import NotchSPI

final class RecentQuestionTests: XCTestCase {
    private var directory: URL!
    override func setUpWithError() throws {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent("history-test-\(UUID())")
    }
    override func tearDownWithError() throws { try? FileManager.default.removeItem(at: directory) }
    private func snapshot(id: UUID = UUID(), count: Int = 1) throws -> QuestionCaptureSnapshot {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let assets = try (0..<count).map { index -> ContextAsset in
            let url = directory.appendingPathComponent("source-\(UUID()).jpg")
            try Data(repeating: UInt8(index), count: 128).write(to: url)
            return .init(id: UUID(), sessionID: UUID(), file: QuestionAssetFile(url: url), sha256: "test",
                width: 100, height: 100, byteCount: 128, targetFingerprint: "test", capturedAt: Date())
        }
        return .init(captureID: id, sessionID: UUID(), generation: 0, assets: assets, expiresAt: Date().addingTimeInterval(900))
    }
    private var historyDirectory: URL { directory.appendingPathComponent("history") }
    private func list(_ store: RecentQuestionStore) async -> [RecentQuestion] {
        await withCheckedContinuation { continuation in store.list { values, _ in continuation.resume(returning: values) } }
    }
    func testRestartPreservesImagesOrderAndExplanationWithoutOriginalFiles() async throws {
        let store = RecentQuestionStore(directory: historyDirectory)
        let capture = try snapshot(count: 4)
        store.save(snapshot: capture, answer: "步骤\nFINAL: **B**", needsReview: true)
        store.updateExplanation(id: capture.captureID, text: "解释\nFINAL: B")
        await store.flush()
        for asset in capture.assets { try FileManager.default.removeItem(at: asset.file.url) }
        let restarted = RecentQuestionStore(directory: historyDirectory)
        let items = await list(restarted)
        let item = try XCTUnwrap(items.first)
        XCTAssertEqual(items.count, 1); XCTAssertEqual(item.conclusion, "B"); XCTAssertTrue(item.needsReview)
        XCTAssertEqual(item.detail, "步骤\n\n解释\n\nB")
        for index in 0..<4 {
            XCTAssertEqual(try Data(contentsOf: restarted.imageURL(for: item, index: index)), Data(repeating: UInt8(index), count: 128))
        }
        let permissions = try FileManager.default.attributesOfItem(atPath: historyDirectory.path)[.posixPermissions] as? Int
        XCTAssertEqual(permissions, 0o700)
    }
    func testDuplicateCompletionUpdatesOneRecordAndDeletionWinsOverExplanation() async throws {
        let store = RecentQuestionStore(directory: historyDirectory)
        let capture = try snapshot()
        store.save(snapshot: capture, answer: "FINAL: A", needsReview: false)
        store.save(snapshot: capture, answer: "FINAL: B", needsReview: true)
        let values = await list(store)
        XCTAssertEqual(values.count, 1); XCTAssertEqual(values.first?.conclusion, "B")
        store.delete(id: capture.captureID)
        store.updateExplanation(id: capture.captureID, text: "late explanation")
        let deleted = await list(store)
        XCTAssertTrue(deleted.isEmpty)
        XCTAssertFalse(FileManager.default.fileExists(atPath: historyDirectory.appendingPathComponent(capture.captureID.uuidString).path))
    }
    func testCountAndTimeRetentionDeleteImagesAndMetadata() async throws {
        let date = Date()
        let store = RecentQuestionStore(directory: historyDirectory, limit: 2, now: { date })
        let captures = try (0..<3).map { _ in try snapshot() }
        for capture in captures { store.save(snapshot: capture, answer: "FINAL: A", needsReview: false) }
        let values = await list(store)
        XCTAssertEqual(values.map(\.id), Array(captures.reversed().prefix(2)).map(\.captureID))
        let old = RecentQuestionStore(directory: historyDirectory, now: { date.addingTimeInterval(31 * 86400) })
        let expired = await list(old)
        XCTAssertTrue(expired.isEmpty)
        XCTAssertTrue(try FileManager.default.contentsOfDirectory(atPath: historyDirectory.path).isEmpty)
    }
    func testDiskBudgetAndIncompleteWritesCannotAppearAsAnswers() async throws {
        let store = RecentQuestionStore(directory: historyDirectory, byteLimit: 1)
        store.save(snapshot: try snapshot(), answer: "FINAL: A", needsReview: false)
        let values = await list(store)
        XCTAssertTrue(values.isEmpty)
        let broken = try snapshot()
        try FileManager.default.removeItem(at: broken.assets[0].file.url)
        store.save(snapshot: broken, answer: "FINAL: B", needsReview: false)
        await store.flush()
        XCTAssertTrue(try FileManager.default.contentsOfDirectory(atPath: historyDirectory.path).isEmpty)
    }
    func testClearAllAndCorruptRecordStartupCleanup() async throws {
        let store = RecentQuestionStore(directory: historyDirectory)
        store.save(snapshot: try snapshot(), answer: "FINAL: A", needsReview: false)
        store.save(snapshot: try snapshot(), answer: "FINAL: B", needsReview: false)
        store.delete(id: nil)
        await store.flush()
        let corrupt = historyDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: corrupt, withIntermediateDirectories: true)
        try Data("broken".utf8).write(to: corrupt.appendingPathComponent("record.json"))
        let restart = RecentQuestionStore(directory: historyDirectory)
        let values = await list(restart)
        XCTAssertTrue(values.isEmpty); XCTAssertFalse(FileManager.default.fileExists(atPath: corrupt.path))
    }
    @MainActor func testGearMenuHasIndependentHistoryActionWithNoHotkeyAndNoLiveStateMutation() throws {
        let store = RecentQuestionStore(directory: historyDirectory)
        let controller = NotchController(activateServices: false, recentQuestions: store)
        defer { controller.prepareForTermination() }
        controller.model.answer = "FINAL: C"; controller.model.status = .streaming
        let item = try XCTUnwrap(controller.qaScreenshotMenu().items.first { $0.action == #selector(NotchController.openRecentQuestions) })
        XCTAssertEqual(item.keyEquivalent, "")
        controller.openRecentQuestions()
        XCTAssertEqual(controller.model.answer, "FINAL: C")
        XCTAssertEqual(controller.model.status, .streaming)
        XCTAssertEqual(controller.qaModelInvocations, 0)
        for window in NSApp.windows where window is NSPanel == false && window.title == L10n.t("最近查题", "最近の問題", "Recent Questions") { window.close() }
    }

    @MainActor func testCompletionHookIsPassiveAndRejectsFailuresPracticeAndRetakes() async throws {
        let store = RecentQuestionStore(directory: historyDirectory)
        let controller = NotchController(activateServices: false, recentQuestions: store)
        defer { controller.prepareForTermination() }
        controller.model.answer = "FINAL: B"; controller.model.status = .idle
        let count = NSApp.windows.filter(\.isVisible).count
        let capture = try snapshot()
        controller.recordRecentQuestion(capture, succeeded: false, mode: "tutor", resultProtocol: nil, composition: nil)
        controller.model.onboardingStep = .practice
        controller.recordRecentQuestion(capture, succeeded: true, mode: "tutor", resultProtocol: nil, composition: nil)
        controller.model.onboardingStep = nil
        controller.recordRecentQuestion(capture, succeeded: true, mode: "personality", resultProtocol: nil, composition: nil)
        let retake = ObjectiveResultComposition(visibleText: "请重拍", finalAnswer: nil, result: nil,
            state: .retake, parserPath: .v1, violations: [])
        controller.recordRecentQuestion(capture, succeeded: true, mode: "tutor", resultProtocol: "objective_v1", composition: retake)
        let rejected = await list(store)
        XCTAssertTrue(rejected.isEmpty)
        controller.recordRecentQuestion(capture, succeeded: true, mode: "tutor", resultProtocol: nil, composition: nil)
        let accepted = await list(store)
        XCTAssertEqual(accepted.count, 1)
        XCTAssertEqual(controller.model.answer, "FINAL: B")
        XCTAssertEqual(NSApp.windows.filter(\.isVisible).count, count)
        XCTAssertEqual(controller.qaModelInvocations, 0)
    }

    @MainActor func testHistoryWindowKeepsReadableViewportWithLongContent() async throws {
        let store = RecentQuestionStore(directory: historyDirectory)
        let capture = try snapshot()
        let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 2000, pixelsHigh: 1400,
            bitsPerSample: 8, samplesPerPixel: 3, hasAlpha: false, isPlanar: false,
            colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
        memset(bitmap.bitmapData!, 180, bitmap.bytesPerRow * bitmap.pixelsHigh)
        try XCTUnwrap(bitmap.representation(using: .jpeg, properties: [:])).write(to: capture.assets[0].file.url)
        store.save(snapshot: capture, answer: "FINAL: B", needsReview: false)
        store.updateExplanation(id: capture.captureID, text: String(repeating: "Long explanation words with multiple lines.\n", count: 50))
        await store.flush()
        let controller = RecentQuestionsWindowController(store: store)
        defer { controller.close() }
        controller.present()
        _ = await list(store)
        let window = try XCTUnwrap(controller.window)
        window.contentView?.layoutSubtreeIfNeeded()
        XCTAssertGreaterThan(window.frame.height, 480)
        XCTAssertLessThan(window.frame.width, 1100)
        let scrolls = try XCTUnwrap(window.contentView).subviews.compactMap { $0 as? NSScrollView }
        XCTAssertEqual(scrolls.count, 2)
        XCTAssertTrue(scrolls.allSatisfy { $0.frame.height >= 300 })
    }
}
