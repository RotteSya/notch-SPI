import AppKit
import CoreText
import QuartzCore
import XCTest
@testable import NotchSPI

final class AnswerLayoutTests: XCTestCase {
    @MainActor func testFirstAnswerCardReservesInsetsOutsideCoreText() {
        let presentation = AnswerPresentation(mode: "tutor", depth: "brief", finished: true, revealed: false)
        for answer in ["FINAL: B. 60 km/h", "FINAL: " + Array(repeating: "60 km/h", count: 30).joined(separator: "；")] {
            for width: CGFloat in [280, 560] {
                let attr = NotchType.answerString(answer, presentation: presentation)
                let setter = CTFramesetterCreateWithAttributedString(attr)
                let textHeight = CTFramesetterSuggestFrameSizeWithConstraints(setter, .init(location: 0, length: 0), nil,
                    .init(width: width, height: .greatestFiniteMagnitude), nil).height
                let measured = NotchType.answerHeight(answer, presentation: presentation, width: width)
                XCTAssertGreaterThanOrEqual(measured - ceil(textHeight), NotchType.cardPadV * 2,
                    "First paragraph spacing is ignored by Core Text; both painted card edges need explicit space.")
                XCTAssertEqual(measured, StreamingAnswerView.measure(attr, width: width))
            }
        }
    }

    @MainActor func testScrollBarAndAccessibilityScrollingRefreshEdgeFade() throws {
        let old = ProcessInfo.processInfo.environment["NSPI_QA_REDUCE_MOTION"]
        setenv("NSPI_QA_REDUCE_MOTION", "1", 1)
        defer {
            if let old { setenv("NSPI_QA_REDUCE_MOTION", old, 1) }
            else { unsetenv("NSPI_QA_REDUCE_MOTION") }
        }
        let model = TutorModel()
        let panel = NotchPanel(contentRect: .init(x: 0, y: 0, width: 644, height: 488))
        let view = NotchView(model: model,
            frameProvider: { .init(x: 0, y: 0, width: $0 ? 644 : 200, height: $0 ? 488 : 32) },
            onHover: { _ in }, onCycleDepth: {}, onEditPersona: {}, onSettings: {},
            onToggleReasoning: {}, onCopyAnswer: {}, onStopAuto: {})
        panel.contentView = view
        model.answer = Array(repeating: "Explanation with enough lines to require scrolling.", count: 80).joined(separator: "\n")
        model.status = .idle
        model.expanded = true
        view.refreshScreenshotTray()
        func scrollView(in root: NSView) -> NSScrollView? {
            if let scroll = root as? NSScrollView { return scroll }
            return root.subviews.compactMap { scrollView(in: $0) }.first
        }
        let scroll = try XCTUnwrap(scrollView(in: view))
        let fade = try XCTUnwrap(scroll.layer?.mask as? CAGradientLayer)
        let initial = try XCTUnwrap(fade.colors as? [CGColor])
        XCTAssertLessThan(try XCTUnwrap(initial.last).alpha, 1)
        // AX actions and scrollbar dragging change the clip bounds without scrollWheel.
        let bottom = try XCTUnwrap(scroll.documentView).frame.height - scroll.contentView.bounds.height
        XCTAssertGreaterThan(bottom, 0)
        scroll.contentView.setBoundsOrigin(.init(x: 0, y: bottom))
        scroll.reflectScrolledClipView(scroll.contentView)
        let atBottom = try XCTUnwrap(fade.colors as? [CGColor])
        XCTAssertEqual(try XCTUnwrap(atBottom.last).alpha, 1, accuracy: 0.001)
        XCTAssertEqual(try XCTUnwrap(atBottom.first).alpha, 0, accuracy: 0.001)
    }

    @MainActor func testSubmittedScreenshotsKeepQuestionGeometryWithoutHidingAnswer() {
        let model = TutorModel()
        model.screenshotRoundActive = true
        model.answer = "FINAL: B"
        XCTAssertTrue(model.hidesAnswer, "A prior answer must remain hidden while collecting a new question.")
        let collectionHeight = model.screenshotTrayHeight
        model.screenshots = [.init(id: UUID(), sessionID: UUID(),
            file: QuestionAssetFile(url: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)),
            sha256: "fixture", width: 640, height: 400, byteCount: 0, targetFingerprint: "fixture", capturedAt: Date())]
        model.screenshotRoundActive = false
        XCTAssertFalse(model.hidesAnswer)
        XCTAssertEqual(model.screenshotTrayHeight, collectionHeight, "Submission must not move or shrink the question gallery.")
        model.screenshots = []
        XCTAssertEqual(model.screenshotTrayHeight, 0)
    }
    @MainActor func testQuestionGalleryStaysAboveAnswerAndAllFourSlotsStayInBounds() throws {
        let model = TutorModel()
        let panel = NotchPanel(contentRect: .init(x: 0, y: 0, width: 644, height: 488))
        let view = NotchView(model: model,
            frameProvider: { .init(x: 0, y: 0, width: $0 ? 644 : 200, height: $0 ? 488 : 32) },
            onHover: { _ in }, onCycleDepth: {}, onEditPersona: {}, onSettings: {},
            onToggleReasoning: {}, onCopyAnswer: {}, onStopAuto: {})
        panel.contentView = view
        model.expanded = true
        model.answer = "FINAL: B"
        func descendant<T: NSView>(_ type: T.Type, in root: NSView) -> T? {
            if let match = root as? T { return match }
            return root.subviews.compactMap { descendant(type, in: $0) }.first
        }
        for count in 1...4 {
            model.screenshots.append(.init(id: UUID(), sessionID: UUID(),
                file: QuestionAssetFile(url: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)),
                sha256: "fixture", width: count == 2 ? 400 : 640, height: count == 2 ? 700 : 400,
                byteCount: 0, targetFingerprint: "fixture", capturedAt: Date()))
            model.screenshotRoundActive = true
            view.refreshScreenshotTray()
            let gallery = try XCTUnwrap(descendant(ScreenshotTray.self, in: view))
            gallery.layoutSubtreeIfNeeded()
            let scroll = try XCTUnwrap(descendant(NSScrollView.self, in: view))
            XCTAssertLessThanOrEqual(gallery.frame.maxY, scroll.frame.minY)
            let before = try model.screenshots.map { try XCTUnwrap(gallery.screenFrame(for: $0.id)) }
            let galleryOnScreen = panel.convertToScreen(gallery.convert(gallery.bounds, to: nil))
            for frame in before { XCTAssertTrue(galleryOnScreen.contains(frame)) }
            for pair in zip(before, before.dropFirst()) { XCTAssertLessThan(pair.0.maxX, pair.1.minX) }
            model.screenshotRoundActive = false
            view.refreshScreenshotTray()
            gallery.layoutSubtreeIfNeeded()
            let after = try model.screenshots.map { try XCTUnwrap(gallery.screenFrame(for: $0.id)) }
            XCTAssertEqual(before, after, "Finishing a question must preserve every source image's position and size.")
            XCTAssertLessThanOrEqual(gallery.frame.maxY, scroll.frame.minY)
        }
    }

}
