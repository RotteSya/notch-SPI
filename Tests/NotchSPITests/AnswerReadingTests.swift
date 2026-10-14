import AppKit
import XCTest
@testable import NotchSPI

final class AnswerReadingTests: XCTestCase {
    private func expanded(answer: String, explanation: String) -> ExpandedAnswerContent {
        .init(id: UUID(), assets: [], answer: answer, explanation: explanation, needsReview: true,
              explaining: false, canExplain: false, explanationFailed: false)
    }
    func testAllReadersUseIdenticalFullTextWithoutDuplicatingUnmarkedAnswers() {
        for answer in ["**B**，60 km/h", "第一步\nFINAL: **B**\n（2）60 km/h\n（3）最大值 2"] {
            let explanation = "解释第一步\nFINAL: B"
            let reader = expanded(answer: answer, explanation: explanation)
            let history = RecentQuestion(id: UUID(), createdAt: Date(), answer: answer,
                explanation: explanation, needsReview: true, imageCount: 0)
            XCTAssertEqual(reader.conclusion, history.conclusion)
            XCTAssertEqual(reader.detail, history.detail)
            XCTAssertEqual(reader.copyText, history.copyText)
            XCTAssertFalse(reader.copyText.contains("FINAL:"))
        }
        let value = AnswerReadingContent(answer: "**B**，60 km/h", explanation: "")
        XCTAssertEqual(value.copyAnswer, "B，60 km/h")
        XCTAssertEqual(value.copyAll, value.copyAnswer)
        XCTAssertTrue(value.detail.isEmpty)
    }
    @MainActor func testExplanationDoesNotRemoveOriginalStepsOrSubquestionsInNotch() {
        let model = TutorModel()
        model.answer = "原解题步骤\nFINAL: **（1）B**\n（2）60 km/h\n（3）最大值 2"
        model.explanation = "新增解释\nFINAL: B"
        let parsed = AnswerComposer.parse(model.renderedAnswer, streaming: false)
        XCTAssertEqual(parsed.final, "**（1）B**")
        XCTAssertTrue(parsed.working.contains("原解题步骤"))
        XCTAssertTrue(parsed.working.contains("新增解释"))
        XCTAssertEqual(parsed.overflow, "（2）60 km/h\n（3）最大值 2")
        let visible = NotchType.answerString(model.renderedAnswer,
            presentation: .init(mode: "tutor", depth: "brief", finished: true, revealed: true))
        for text in ["（1）B", "（2）60 km/h", "（3）最大值 2", "原解题步骤", "新增解释"] {
            XCTAssertTrue(visible.string.contains(text))
        }
        XCTAssertFalse(visible.string.contains("FINAL:"))
    }
    func testMathCharactersSurviveDisplayAndCopyIncludingMarkdownAroundMath() {
        let formula = #"\(\frac{x_1^2}{8}+\frac{y_2^2}{2}=1\)"#
        let raw = "**答案：\(formula)**\n（2）`60 km/h`\n（3）$a_1 + b_2$"
        let plain = AnswerText.plain(raw)
        XCTAssertEqual(plain, "答案：\(formula)\n（2）60 km/h\n（3）$a_1 + b_2$")
        XCTAssertEqual(AnswerComposer.clipboardAnswer("FINAL: " + raw), "答案：" + formula)
        let label = AnswerText.label(raw, size: 15)
        XCTAssertEqual(AnswerMath.sourceText(label.attributedStringValue), plain)
        let font = label.attributedStringValue.attribute(.font, at: 0, effectiveRange: nil) as? NSFont
        XCTAssertTrue(font.map { NSFontManager.shared.traits(of: $0).contains(.boldFontMask) } ?? false)
        XCTAssertFalse(plain.contains("NSPIMATHPLACEHOLDER"))
    }
    func testMathInsideCodeAndRepeatedMathDoNotLoseDelimitersOrBackslashes() {
        for value in [#"`\(x_1\)`"#, #"\[x_1=\sqrt{2}\]"#, "$$a_1\n+b_2$$", #"\(x\) 和 \(x\)"#] {
            XCTAssertEqual(AnswerText.plain(value), value.replacingOccurrences(of: "`", with: ""))
        }
        XCTAssertEqual(AnswerText.plain("NSPIMATHPLACEHOLDER0END **B**"), "NSPIMATHPLACEHOLDER0END B")
    }

    @MainActor func testLongReaderTextReflowsAtMinimumWindowWidthWithoutClipping() throws {
        let longText = String(repeating: "**解释步骤**：保留题号、单位与完整的长句。The result is 60 km/h. ", count: 30) + "\n\n解释结束。"
        let reader = ExpandedAnswerWindowController(content: expanded(answer: "FINAL: B", explanation: longText))
        defer { reader.close() }
        let window = try XCTUnwrap(reader.window)
        window.setContentSize(NSSize(width: 800, height: 600))
        let root = try XCTUnwrap(window.contentView)
        root.layoutSubtreeIfNeeded()
        let scroll = try XCTUnwrap(root.subviews.compactMap { $0 as? NSScrollView }.last)
        let stack = try XCTUnwrap(scroll.documentView as? NSStackView)
        let label = try XCTUnwrap(stack.arrangedSubviews.compactMap { $0 as? NSTextField }.first {
            $0.stringValue.contains("The result")
        })
        let measured = label.attributedStringValue.boundingRect(with: NSSize(width: label.bounds.width - 4, height: 100_000),
            options: [.usesLineFragmentOrigin, .usesFontLeading]).height
        XCTAssertGreaterThanOrEqual(label.frame.height + 3, measured)
        let cellHeight = try XCTUnwrap(label.cell).cellSize(forBounds: NSRect(x: 0, y: 0, width: label.bounds.width, height: 100_000)).height
        XCTAssertGreaterThanOrEqual(label.frame.height, cellHeight)
        XCTAssertLessThanOrEqual(window.frame.width, 801)
        XCTAssertGreaterThan(stack.frame.height, scroll.frame.height)
    }
}
