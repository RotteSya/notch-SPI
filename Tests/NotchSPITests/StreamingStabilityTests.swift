import AppKit
import XCTest
@testable import NotchSPI

/// What a reader sees while a reply streams. Half-written markup must never appear and then
/// vanish, and text that is already on screen must never move within its string.
final class StreamingStabilityTests: XCTestCase {
    private func visible(_ raw: String, depth: String = "guided", finished: Bool = false) -> String {
        NotchType.answerString(raw, presentation: .init(mode: "tutor", depth: depth, finished: finished, revealed: false)).string
    }

    func testVisibleTextOnlyGrowsWhileInlineMarkupAndFormulasArrive() {
        continueAfterFailure = false
        let fixtures = [
            "**思路**　先把 `f(x) = x² − 4x + 3` 配方成顶点式，最值*一眼*可见。\n**配方**　`f(x) = (x − 2)² − 1`，顶点在 `(2, −1)`。",
            #"由求根公式 \(x = \frac{-b \pm \sqrt{b^2-4ac}}{2a}\)，代入 \(a=1\)、\(b=-4\)。"# + "\n\n" + #"判别式：\[\Delta = b^2 - 4ac = 4\]"# + "\n所以 $x_1 = 3$，$x_2 = 1$。",
            "Speed is ~~wrong~~ **60 km/h**: `120 / 2`. Cost is $5 and 3 * 4 = 12, a_b_c stays.",
            "$$\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}$$ then **bold `code` inside** and *em **strong** em* end",
        ]
        for fixture in fixtures {
            let characters = Array(fixture)
            for chunk in [1, 2, 3, 5, 7] {
                var previous = ""
                var offset = 0
                while offset < characters.count {
                    offset = min(characters.count, offset + chunk)
                    let shown = visible(String(characters[..<offset]))
                    XCTAssertTrue(shown.hasPrefix(previous),
                        "chunk \(chunk): visible text was rewritten\n  before: \(previous.suffix(40))\n  after:  \(shown.suffix(40))")
                    XCTAssertFalse(shown.contains("**"), "An open strong span must not print its asterisks: \(shown.suffix(30))")
                    XCTAssertFalse(shown.contains("`"), "An open code span must not print its backtick: \(shown.suffix(30))")
                    XCTAssertFalse(shown.contains("\\("), "An unfinished formula must wait to be typeset: \(shown.suffix(30))")
                    XCTAssertFalse(shown.contains("\\["), "An unfinished formula must wait to be typeset: \(shown.suffix(30))")
                    previous = shown
                }
                // Completion is not a second rewrite: the finished reply reads exactly as it streamed.
                XCTAssertEqual(visible(fixture, finished: true), previous, "chunk \(chunk)")
            }
        }
    }

    func testOpenSpansAreStyledFromTheirFirstCharacter() throws {
        let attributed = NotchType.answerString("结论是 **60 km",
            presentation: .init(mode: "tutor", depth: "guided", finished: false, revealed: false))
        XCTAssertEqual(attributed.string, "结论是 60 km")
        let font = try XCTUnwrap(attributed.attribute(.font, at: attributed.length - 1, effectiveRange: nil) as? NSFont)
        XCTAssertTrue(font.fontDescriptor.symbolicTraits.contains(.bold))
        // Measurement and drawing share this composition, so the panel height follows what is shown.
        XCTAssertEqual(NotchType.answerHeight("结论是 **60 km", presentation: .init(mode: "tutor", depth: "guided",
            finished: false, revealed: false), width: 400), StreamingAnswerView.measure(attributed, width: 400))
    }

    func testProseAroundLiteralSymbolsIsNeverWithheld() {
        // Currency, multiplication, list bullets and identifiers are text, not markup.
        for text in ["Total: $5", "3 * 4", "* item one", "snake_case_name", "a ~ b", "2 ** 3 "] {
            XCTAssertEqual(AnswerText.settledForStreaming(text), text)
        }
        // A stray formula opener followed by a long passage is prose and stays readable.
        let stray = "see \\( " + String(repeating: "long passage ", count: 40)
        XCTAssertEqual(AnswerText.settledForStreaming(stray), stray)
        // The finished reply is never altered, even with unbalanced markup.
        XCTAssertEqual(visible("unbalanced **bold", finished: true), "unbalanced **bold")
    }
}
