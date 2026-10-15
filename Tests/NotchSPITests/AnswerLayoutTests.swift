import AppKit
import CoreText
import QuartzCore
import XCTest
@testable import NotchSPI

final class AnswerLayoutTests: XCTestCase {
    @MainActor func testReadyShelfKeepsShortcutColumnsAndYieldsToCapture() throws {
        let model = TutorModel()
        model.status = .ready
        XCTAssertTrue(model.usesReadyShelf)
        let presentation = NotchType.presentation(for: model)
        let original = NotchType.answerString("", presentation: presentation)
        let shelf = NotchType.answerString("", presentation: presentation, inShelf: true)
        XCTAssertEqual(original.string, shelf.string)
        let before = try XCTUnwrap(original.attribute(.paragraphStyle, at: 0, effectiveRange: nil) as? NSParagraphStyle)
        let after = try XCTUnwrap(shelf.attribute(.paragraphStyle, at: 0, effectiveRange: nil) as? NSParagraphStyle)
        XCTAssertEqual(after.headIndent - before.headIndent, NotchType.cardPadH)
        XCTAssertEqual(try XCTUnwrap(after.tabStops.first).location - (try XCTUnwrap(before.tabStops.first).location), NotchType.cardPadH)
        for width: CGFloat in [320, 560] {
            XCTAssertEqual(NotchType.answerHeight("", presentation: presentation, width: width, inShelf: true),
                           StreamingAnswerView.measure(shelf, width: width) + NotchLayout.statusInsetV * 2)
        }
        model.screenshotCapturing = true
        XCTAssertFalse(model.usesReadyShelf)
        model.screenshotCapturing = false; model.screenshotRoundActive = true
        XCTAssertFalse(model.usesReadyShelf)
        model.screenshotRoundActive = false; model.status = .running
        XCTAssertFalse(model.usesReadyShelf)
    }

    @MainActor func testConclusionIsImmediatelyReadableIncludingEmojiAndMultilineUpdates() throws {
        let view = StreamingAnswerView()
        for text in ["FINAL: ✅ B. 60 km/h", "FINAL: ✅ B. 60 km/h\n第二空：120 km\n第三空：2 h"] {
            let attr = NotchType.answerString(text,
                presentation: .init(mode: "tutor", depth: "brief", finished: false, revealed: false), inShelf: true)
            let before = CACurrentMediaTime()
            view.setAnswer(attr, isPlaceholder: false)
            XCTAssertEqual(view.qaGlyphBirths.count, attr.length)
            var conclusionLength = 0
            attr.enumerateAttribute(.nspiAnswerCard, in: NSRange(location: 0, length: attr.length)) { value, range, _ in
                guard value != nil else { return }
                conclusionLength += range.length
                for offset in range.location..<NSMaxRange(range) {
                    XCTAssertLessThan(view.qaGlyphBirths[offset], before - 0.18,
                                      "Answer glyphs must not wait behind the explanation animation")
                }
            }
            XCTAssertGreaterThan(conclusionLength, 0)
            XCTAssertFalse((view.accessibilityValue() as? String ?? "").contains("FINAL:"))
        }
    }

    @MainActor func testDisplayedTextMeasurementUpdatesForStyleWidthAndContentChanges() {
        let view = StreamingAnswerView(frame: .zero)
        let text = Array(repeating: "Long answer wraps across the available width.", count: 5).joined(separator: " ")
        let small = NSAttributedString(string: text, attributes: [.font: NSFont.systemFont(ofSize: 12)])
        view.setAnswer(small, isPlaceholder: false)
        let initial = view.measuredHeight(width: 500)
        XCTAssertEqual(view.measuredHeight(width: 500), initial)
        XCTAssertGreaterThan(view.measuredHeight(width: 200), initial)
        let large = NSAttributedString(string: text, attributes: [.font: NSFont.systemFont(ofSize: 28)])
        view.setAnswer(large, isPlaceholder: false)
        XCTAssertGreaterThan(view.measuredHeight(width: 500), initial, "Changing only typography must invalidate measurement")
        view.setAnswer(NSAttributedString(string: ""), isPlaceholder: true)
        XCTAssertEqual(view.measuredHeight(width: 500), 0, "A new capture must not retain the previous answer's height")
    }

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

    @MainActor func testAnswerShelfWaitsForFlightsAndKeepsNewCaptureIsolated() {
        let model = TutorModel()
        model.screenshotRoundActive = true
        model.answer = "FINAL: B"
        XCTAssertTrue(model.hidesAnswer, "A prior answer must remain hidden while collecting a new question.")
        let collectionHeight = CaptureStyle.trayHeight
        model.screenshots = [.init(id: UUID(), sessionID: UUID(),
            file: QuestionAssetFile(url: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)),
            sha256: "fixture", width: 640, height: 400, byteCount: 0, targetFingerprint: "fixture", capturedAt: Date())]
        model.screenshotRoundActive = false
        XCTAssertFalse(model.hidesAnswer)
        XCTAssertEqual(model.screenshotTrayHeight, CaptureStyle.referenceHeight)
        let id = model.screenshots[0].id
        model.flyingScreenshots = [id]
        XCTAssertEqual(model.screenshotTrayHeight, collectionHeight, "An in-flight screenshot must retain its original landing slot")
        model.flyingScreenshots = []
        model.answer = ""
        XCTAssertEqual(model.screenshotTrayHeight, collectionHeight, "Waiting must not masquerade as a finished answer")
        model.answer = "FINAL: B"
        XCTAssertTrue(model.usesAnswerShelf)
        model.screenshotRoundActive = true
        XCTAssertFalse(model.usesAnswerShelf)
        XCTAssertTrue(model.hidesAnswer)
        model.screenshotRoundActive = false
        model.screenshots = []
        XCTAssertEqual(model.screenshotTrayHeight, 0)
    }
    @MainActor func testAnswerPrecedesCompactReferencesAndAllFourPreviewsRemainAvailable() throws {
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
            XCTAssertLessThanOrEqual(scroll.frame.maxY, gallery.frame.minY)
            let compactOnScreen = panel.convertToScreen(gallery.convert(gallery.bounds, to: nil))
            for frame in after { XCTAssertTrue(compactOnScreen.contains(frame)) }
            for pair in zip(after, after.dropFirst()) { XCTAssertLessThan(pair.0.maxX, pair.1.minX) }
            XCTAssertLessThan(after[0].height, before[0].height)
            XCTAssertEqual(model.answer, "FINAL: B")
        }
    }

    @MainActor func testShelfExplanationSharesPaddingAndMeasurementWithAnswer() {
        let p = AnswerPresentation(mode: "tutor", depth: "guided", finished: true, revealed: true)
        let answer = String(repeating: "**步骤**：长解释保留阅读边距。\n", count: 20) + "FINAL: B"
        let text = NotchType.answerString(answer, presentation: p, inShelf: true)
        text.enumerateAttribute(.paragraphStyle, in: NSRange(location: 0, length: text.length)) { value, _, _ in
            guard let paragraph = value as? NSParagraphStyle else { return }
            XCTAssertGreaterThanOrEqual(paragraph.headIndent, NotchType.cardPadH)
            XCTAssertLessThanOrEqual(paragraph.tailIndent, -NotchType.cardPadH)
        }
        for width: CGFloat in [280, 560] {
            XCTAssertEqual(NotchType.answerHeight(answer, presentation: p, width: width, inShelf: true),
                           StreamingAnswerView.measure(text, width: width))
        }
    }

    @MainActor func testStatusShelfKeepsFailureSemanticsAndSafeTextMeasurement() {
        let model = TutorModel()
        for state in [TutorModel.Status.error, .idle] {
            model.status = state
            model.resultState = state == .idle ? .retake : nil
            model.answer = "请重新截取完整题干和选项。"
            XCTAssertTrue(model.usesStatusShelf)
            XCTAssertTrue(model.usesContentShelf)
            XCTAssertFalse(model.usesAnswerShelf)
            XCTAssertFalse(model.canExpandAnswer)
            let presentation = NotchType.presentation(for: model)
            XCTAssertTrue(presentation.failed)
            let text = NotchType.answerString(model.displayedAnswer, presentation: presentation, inShelf: true)
            XCTAssertNil(text.attribute(.nspiAnswerCard, at: 0, effectiveRange: nil))
            let paragraph = text.attribute(.paragraphStyle, at: 0, effectiveRange: nil) as? NSParagraphStyle
            XCTAssertGreaterThanOrEqual(paragraph?.headIndent ?? 0, NotchType.cardPadH)
            XCTAssertEqual(NotchType.answerHeight(model.displayedAnswer, presentation: presentation, width: 280, inShelf: true), StreamingAnswerView.measure(text, width: 280) + NotchLayout.statusInsetV * 2)
            model.screenshotCapturing = true
            XCTAssertFalse(model.usesStatusShelf)
            model.screenshotCapturing = false
            model.onboardingStep = .working
            XCTAssertTrue(model.usesStatusShelf)
            model.onboardingStep = .permission
            XCTAssertFalse(model.usesStatusShelf)
            model.onboardingStep = nil
        }
    }

    @MainActor func testStatusTitlePreservesDetailedReasonAndFeedbackOverridesOldAnswer() {
        let model = TutorModel()
        model.answer = "FINAL: previous answer"
        model.status = .error
        model.statusText = "网络断开，连接超时。"
        model.captureFeedback = "截图失败，请重新截取题目。"
        XCTAssertEqual(model.displayedAnswer, model.captureFeedback)
        XCTAssertEqual(model.captureStatusDetail, model.captureFeedback)
        XCTAssertNotEqual(model.captureHeading, model.captureFeedback)
        XCTAssertTrue(model.usesStatusShelf)
        model.screenshotRoundActive = true
        XCTAssertTrue(model.hidesAnswer)
        XCTAssertFalse(model.usesContentShelf)
    }

    @MainActor func testProtocolOnlyRetakeAndInterruptedAnswerExposeReasonInContentCard() {
        let model = TutorModel()
        model.resultState = .retake
        model.answer = L10n.noOutput
        model.statusText = "题目模糊，请重新截取完整题干和选项。"
        XCTAssertEqual(model.displayedAnswer, model.statusText)
        XCTAssertTrue(model.usesStatusShelf)
        XCTAssertFalse(model.canExpandAnswer)
        let retakeHeading = model.captureHeading
        model.captureFeedback = "本轮已取消。按快捷键开始新的截图。"
        XCTAssertEqual(model.displayedAnswer, model.captureFeedback)
        XCTAssertNotEqual(model.captureHeading, retakeHeading)
        model.captureFeedback = ""
        model.resultState = nil
        model.status = .error
        model.answer = "FINAL: partial answer"
        model.statusText = "答案未完整接收，可按原快捷键继续。"
        XCTAssertEqual(model.displayedAnswer, model.statusText)
        XCTAssertTrue(model.usesStatusShelf)
        // A new capture still suppresses the preceding message immediately.
        model.screenshotRoundActive = true
        XCTAssertTrue(model.hidesAnswer)
        XCTAssertFalse(model.usesStatusShelf)
    }

    @MainActor func testRecoveryAndSetupInstructionsNeverUseAnswerShelf() {
        let model = TutorModel()
        model.answer = "FINAL: B"
        XCTAssertTrue(model.usesAnswerShelf)
        model.status = .error
        XCTAssertFalse(model.usesAnswerShelf)
        model.status = .idle; model.resultState = .retake
        XCTAssertFalse(model.usesAnswerShelf)
        model.resultState = nil; model.captureFeedback = "Capture interrupted"
        XCTAssertFalse(model.usesAnswerShelf)
        model.captureFeedback = ""; model.onboardingStep = .welcome
        XCTAssertFalse(model.usesAnswerShelf)
        model.onboardingStep = nil; model.mode = "personality"
        XCTAssertFalse(model.usesAnswerShelf)
    }
}
