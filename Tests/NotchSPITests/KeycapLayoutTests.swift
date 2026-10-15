import AppKit
import CoreText
import XCTest
@testable import NotchSPI

final class KeycapLayoutTests: XCTestCase {
    @MainActor func testEveryShortcutRowStrokeFitsDocument() throws {
        let model = TutorModel()
        model.status = .ready
        for shelf in [false, true] {
            let original = NotchType.answerString("", presentation: NotchType.presentation(for: model), inShelf: shelf)
            for scale: CGFloat in [0.8, 1, 1.5, 2] {
                let text = NSMutableAttributedString(attributedString: original)
                original.enumerateAttribute(.font, in: NSRange(location: 0, length: original.length)) { value, range, _ in
                    if let font = value as? NSFont {
                        text.addAttribute(.font, value: NSFontManager.shared.convert(font, toSize: font.pointSize * scale), range: range)
                    }
                }
                for width: CGFloat in [320, 568, 760] {
                    let fitted = AnswerMath.fitting(text, width: width)
                    let height = StreamingAnswerView.measure(text, width: width)
                    let frame = CTFramesetterCreateFrame(CTFramesetterCreateWithAttributedString(fitted),
                        CFRange(location: 0, length: 0),
                        CGPath(rect: CGRect(x: 0, y: 0, width: width, height: 100_000), transform: nil), nil)
                    let lines = CTFrameGetLines(frame) as! [CTLine]
                    var origins = [CGPoint](repeating: .zero, count: lines.count)
                    CTFrameGetLineOrigins(frame, CFRange(location: 0, length: 0), &origins)
                    var rows = Set<Int>()
                    for (i, line) in lines.enumerated() {
                        for run in CTLineGetGlyphRuns(line) as! [CTRun] {
                            let attrs = CTRunGetAttributes(run) as NSDictionary
                            guard attrs[NSAttributedString.Key.nspiKeycap.rawValue] != nil else { continue }
                            rows.insert(i)
                            var ascent: CGFloat = 0, descent: CGFloat = 0
                            let w = CGFloat(CTRunGetTypographicBounds(run, CFRange(location: 0, length: 0), &ascent, &descent, nil))
                            var position = CGPoint.zero
                            CTRunGetPositions(run, CFRange(location: 0, length: 1), &position)
                            let baseline = 100_000 - origins[i].y + StreamingAnswerView.topInset(fitted)
                            let context = "row=\(i), width=\(width), scale=\(scale), shelf=\(shelf)"
                            XCTAssertGreaterThanOrEqual(baseline - ascent - 2.5, 0, context)
                            XCTAssertLessThanOrEqual(baseline + descent + 2.5, height, context)
                            XCTAssertGreaterThanOrEqual(origins[i].x + position.x - 5, 0, context)
                            XCTAssertLessThanOrEqual(origins[i].x + position.x + w + 5, width, context)
                        }
                    }
                    XCTAssertGreaterThanOrEqual(rows.count, 4)
                }
            }
        }
    }
}
