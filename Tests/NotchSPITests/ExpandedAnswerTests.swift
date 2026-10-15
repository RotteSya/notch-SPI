import AppKit
import XCTest
@testable import NotchSPI

final class ExpandedAnswerTests: XCTestCase {
    private func content(id: UUID = UUID(), explanation: String = "", explaining: Bool = false) -> ExpandedAnswerContent {
        .init(id: id, assets: [], answer: "步骤\nFINAL: **B**\n第二空：60", explanation: explanation,
              needsReview: false, explaining: explaining, canExplain: true, explanationFailed: false)
    }
    func testFullContentPreservesOverflowAndStripsMarkers() {
        let value = content(explanation: "解释\nFINAL: B")
        XCTAssertEqual(value.conclusion, "B")
        XCTAssertEqual(value.detail, "步骤\n\n第二空：60\n\n解释\n\nB")
        XCTAssertFalse(value.copyText.contains("FINAL:"))
    }
    @MainActor func testEntryOnlyForCompletedAnswers() {
        let model = TutorModel(); model.answer = "FINAL: B"
        for status in [TutorModel.Status.ready, .running, .streaming, .error] {
            model.status = status; XCTAssertFalse(model.canExpandAnswer)
        }
        model.status = .idle; XCTAssertTrue(model.canExpandAnswer)
        model.screenshotRoundActive = true; XCTAssertFalse(model.canExpandAnswer)
        model.screenshotRoundActive = false; model.onboardingStep = .practice; XCTAssertFalse(model.canExpandAnswer)
        model.onboardingStep = nil; model.resultState = .retake; XCTAssertFalse(model.canExpandAnswer)
        model.resultState = nil; model.mode = "personality"; XCTAssertFalse(model.canExpandAnswer)
    }
    @MainActor func testReaderUpdatesOnlyOriginalQuestionAndDetachesIncompleteStream() {
        _ = NSApplication.shared
        let first = content()
        let reader = ExpandedAnswerWindowController(content: first)
        reader.update(content(id: first.id, explanation: "partial", explaining: true))
        XCTAssertEqual(reader.content?.explanation, "partial")
        reader.update(content(explanation: "different question"))
        XCTAssertEqual(reader.content?.id, first.id)
        reader.detachFromCurrentQuestion()
        XCTAssertEqual(reader.content?.canExplain, false)
        XCTAssertEqual(reader.content?.explanationFailed, true)
        reader.update(content(id: first.id, explanation: "late callback"))
        XCTAssertEqual(reader.content?.explanation, "partial")
        reader.close(); XCTAssertNil(reader.content)
    }
    @MainActor func testLegacyQAReaderHasNoMenuEntryAndNextCaptureKeepsReader() throws {
        let controller = NotchController(activateServices: false)
        defer { controller.qaExpandedAnswerWindow?.close(); controller.prepareForTermination() }
        let capture = QuestionCaptureSnapshot(captureID: UUID(), sessionID: UUID(), generation: 0, assets: [], expiresAt: Date().addingTimeInterval(900))
        controller.qaSeedExpandedAnswer(capture)
        controller.model.answer = "FINAL: B"; controller.model.status = .idle
        controller.qaRefreshScreenshotLayout()
        XCTAssertNil(controller.qaExpandedAnswerWindow)
        XCTAssertNil(controller.qaScreenshotMenu().items.first { $0.action == #selector(NotchController.openExpandedAnswer) })
        controller.openExpandedAnswer()
        let reader = try XCTUnwrap(controller.qaExpandedAnswerWindow)
        XCTAssertEqual(reader.content?.id, capture.captureID)
        XCTAssertEqual(controller.qaModelInvocations, 0)
        XCTAssertEqual(controller.model.answer, "FINAL: B")
        controller.model.screenshotRoundActive = true
        controller.qaRefreshScreenshotLayout()
        XCTAssertTrue(controller.qaExpandedAnswerWindow === reader)
        XCTAssertEqual(reader.content?.id, capture.captureID)
        XCTAssertFalse(reader.content?.canExplain ?? true)
        XCTAssertEqual(controller.qaModelInvocations, 0)
    }
    @MainActor func testShortReaderUsesSingleColumnAndDoesNotResizeOnStream() async throws {
        _ = NSApplication.shared
        let id = UUID()
        let short = ExpandedAnswerContent(id: id, assets: [], answer: "FINAL: B. 60 km/h", explanation: "",
            needsReview: false, explaining: false, canExplain: true, explanationFailed: false)
        let reader = ExpandedAnswerWindowController(content: short)
        defer { reader.close() }
        let window = try XCTUnwrap(reader.window)
        let root = try XCTUnwrap(window.contentView)
        root.layoutSubtreeIfNeeded()
        let scrolls = root.subviews.compactMap { $0 as? NSScrollView }
        XCTAssertTrue(scrolls[0].isHidden)
        XCTAssertEqual(scrolls[1].frame.minX, 24, accuracy: 1)
        XCTAssertEqual(scrolls[1].frame.width, root.bounds.width - 48, accuracy: 1)
        XCTAssertLessThanOrEqual(root.bounds.height, 420)
        let originalFrame = window.frame
        reader.update(.init(id: id, assets: [], answer: short.answer,
            explanation: String(repeating: "Long explanation with units and steps.\n", count: 100),
            needsReview: false, explaining: true, canExplain: true, explanationFailed: false))
        try await Task.sleep(nanoseconds: 150_000_000)
        root.layoutSubtreeIfNeeded()
        XCTAssertEqual(window.frame, originalFrame, "Live text must not move the user's reading window")
        XCTAssertGreaterThan(scrolls[1].documentView?.frame.height ?? 0, scrolls[1].frame.height)
    }

    @MainActor func testReaderUsesImageColumnOnlyForReadableFiles() throws {
        _ = NSApplication.shared
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".png")
        defer { try? FileManager.default.removeItem(at: url) }
        let bitmap = try XCTUnwrap(NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 640, pixelsHigh: 400,
            bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
            bytesPerRow: 0, bitsPerPixel: 0))
        try XCTUnwrap(bitmap.representation(using: .png, properties: [:])).write(to: url)
        let asset = ContextAsset(id: UUID(), sessionID: UUID(), file: QuestionAssetFile(url: url),
            sha256: "fixture", width: 640, height: 400, byteCount: 0, targetFingerprint: "fixture", capturedAt: Date())
        let value = ExpandedAnswerContent(id: UUID(), assets: [asset], answer: "FINAL: B", explanation: "",
            needsReview: false, explaining: false, canExplain: false, explanationFailed: false)
        for readable in [true, false] {
            if !readable { try FileManager.default.removeItem(at: url) }
            let reader = ExpandedAnswerWindowController(content: value)
            let root = try XCTUnwrap(reader.window?.contentView)
            root.layoutSubtreeIfNeeded()
            let scrolls = root.subviews.compactMap { $0 as? NSScrollView }
            XCTAssertEqual(scrolls[0].isHidden, !readable)
            XCTAssertGreaterThan(scrolls[1].frame.width, 300)
            if readable { XCTAssertLessThan(scrolls[0].frame.maxX, scrolls[1].frame.minX) }
            reader.close()
        }
    }

    @MainActor func testLongAnswerHasScrollableDocumentWithoutGrowingWindow() throws {
        _ = NSApplication.shared
        let reader = ExpandedAnswerWindowController(content: content(explanation: String(repeating: "Long explanation with units 120 km / 2 h.\n\n", count: 100)))
        defer { reader.close() }
        let window = try XCTUnwrap(reader.window)
        window.contentView?.layoutSubtreeIfNeeded()
        XCTAssertLessThanOrEqual(window.frame.width, 1061)
        let scrolls = try XCTUnwrap(window.contentView).subviews.compactMap { $0 as? NSScrollView }
        XCTAssertEqual(scrolls.count, 2)
        XCTAssertGreaterThan(scrolls[1].documentView?.frame.height ?? 0, scrolls[1].frame.height)
        XCTAssertGreaterThan(scrolls[1].frame.height, 300)
    }
}
