import AppKit
import XCTest
@testable import NotchSPI

final class AnswerMathTests: XCTestCase {
    private func render(_ raw: String) -> NSAttributedString { AnswerText.label(raw, size: 20).attributedStringValue }
    func testCommonMathRendersAndPreservesCopySource() throws {
        for raw in [#"\(x=\frac{-b\pm\sqrt{b^2-4ac}}{2a}\)"#,
                    #"$x_1^2 + y_2^2 = 1$"#, #"\[\sum_{i=1}^n i = \frac{n(n+1)}{2}\]"#,
                    #"$$\int_0^1 x^2\,dx = \frac{1}{3}$$"#,
                    #"\(\begin{pmatrix}a&b\\c&d\end{pmatrix}\)"#] {
            let text = render(raw)
            let attachment = try XCTUnwrap(text.attribute(.attachment, at: 0, effectiveRange: nil) as? NSTextAttachment, raw)
            XCTAssertGreaterThan(attachment.bounds.height, 15)
            XCTAssertNotNil(attachment.image)
            XCTAssertEqual(AnswerMath.sourceText(text), raw)
            XCTAssertEqual(AnswerText.plain(raw), raw)
            XCTAssertGreaterThan(StreamingAnswerView.measure(text, width: 300), 15)
        }
    }
    func testIncompleteUnsupportedAndCodeFormulasRemainReadable() {
        for raw in [#"\(\frac{x_1}{"#, #"\[x_1+"#, #"$$\sqrt{x_1}"#, #"\(\unknowncommand{x}\)"#] {
            XCTAssertEqual(render(raw).string, raw)
            XCTAssertEqual(AnswerText.plain(raw), raw)
        }
        let code = #"`\(x_1\)`"#
        XCTAssertEqual(render(code).string, #"\(x_1\)"#)
    }
    func testWideFormulaFitsBothReadersAndNotchWithoutLosingSource() throws {
        let raw = "\\(" + Array(repeating: "x_1^2", count: 30).joined(separator: "+") + "\\)"
        let original = render(raw)
        for width: CGFloat in [180, 320, 540] {
            let fitted = AnswerMath.fitting(original, width: width)
            let attachment = try XCTUnwrap(fitted.attribute(.attachment, at: 0, effectiveRange: nil) as? NSTextAttachment)
            XCTAssertLessThanOrEqual(attachment.bounds.width, width)
            XCTAssertGreaterThan(attachment.bounds.height, 40, "Long sums should wrap, not shrink to unreadable text")
            XCTAssertEqual(AnswerMath.sourceText(fitted), raw)
            XCTAssertGreaterThan(StreamingAnswerView.measure(fitted, width: width), 0)
        }
    }
    @MainActor func testSelectedFormulaCopiesSourceAndHasAccessibleText() {
        let raw = #"答案：\(x_1=\frac{1}{2}\)"#
        let label = AnswerText.label(raw, size: 20)
        XCTAssertEqual(label.accessibilityValue(), raw)
        let editor = AnswerReadingFieldEditor()
        editor.textStorage?.setAttributedString(label.attributedStringValue)
        editor.setSelectedRange(NSRange(location: 0, length: label.attributedStringValue.length))
        let board = NSPasteboard.withUniqueName()
        defer { board.releaseGlobally() }
        XCTAssertTrue(editor.writeSelection(to: board, types: [.string]))
        XCTAssertEqual(board.string(forType: .string), raw)
    }
    func testEveryStreamingPrefixKeepsFormulaSource() {
        let formula = #"\(x_1=\frac{-b+\sqrt{b^2-4ac}}{2a}\)"#
        for length in 2...formula.count {
            let prefix = String(formula.prefix(length))
            XCTAssertEqual(AnswerMath.sourceText(render(prefix)), prefix)
        }
    }
}
