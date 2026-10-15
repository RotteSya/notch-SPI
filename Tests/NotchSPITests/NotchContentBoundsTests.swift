import AppKit
import CoreText
import XCTest
@testable import NotchSPI

final class NotchContentBoundsTests: XCTestCase {
    @MainActor func testScreenshotOrdinalsFitExtremeCropsAndAreRemovedWithAssets() throws {
        let assets: [ContextAsset] = [(1, 8000), (8000, 1), (640, 400), (400, 640)].map { width, height in
            .init(id: UUID(), sessionID: UUID(),
                  file: QuestionAssetFile(url: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)),
                  sha256: "bounds", width: width, height: height, byteCount: 0,
                  targetFingerprint: "fixture", capturedAt: Date())
        }
        for width: CGFloat in [320, 560] {
            let tray = ScreenshotTray(frame: NSRect(x: 0, y: 0, width: width, height: CaptureStyle.trayDetailHeight))
            for compact in [false, true, false] {
                tray.update(assets: assets, images: [:], flying: [], message: "", remaining: 3, cancellable: !compact, compact: compact)
                tray.layoutSubtreeIfNeeded()
                let badges = (tray.subviews + tray.subviews.flatMap(\.subviews)).compactMap { $0 as? NSTextField }.filter { Int($0.stringValue) != nil }
                XCTAssertEqual(badges.count, 4)
                for badge in badges {
                    let ordinal = try XCTUnwrap(Int(badge.stringValue))
                    let cards = tray.subviews.compactMap { $0 as? NotchActionButton }.filter { $0.subviews.contains { $0 is NSImageView } }
                    if compact {
                        XCTAssertTrue(badge.superview === cards[ordinal - 1], "Compact badge follows the card animation")
                    } else {
                        XCTAssertGreaterThan(try XCTUnwrap(tray.subviews.firstIndex(of: badge)),
                                             try XCTUnwrap(tray.subviews.firstIndex(of: cards[ordinal - 1])))
                    }
                    XCTAssertNil(badge.hitTest(badge.frame.origin), "Ordinal overlays must pass preview clicks through")
                    XCTAssertTrue(tray.bounds.contains(badge.convert(badge.bounds, to: tray)))
                    XCTAssertGreaterThanOrEqual(badge.frame.width, badge.intrinsicContentSize.width)
                    XCTAssertGreaterThanOrEqual(badge.frame.height, badge.intrinsicContentSize.height)
                }
            }
            tray.update(assets: assets, images: [:], flying: Set(assets.map(\.id)), message: "", remaining: 3, cancellable: true)
            XCTAssertTrue(tray.subviews.compactMap { $0 as? NSTextField }.filter { Int($0.stringValue) != nil }.allSatisfy { $0.alphaValue == 0 })
            tray.update(assets: [], images: [:], flying: [], message: "", remaining: nil, cancellable: false)
            XCTAssertFalse(tray.subviews.compactMap { $0 as? NSTextField }.contains { Int($0.stringValue) != nil })
        }
    }

    @MainActor func testStatusAndAnswerLinesFitMeasuredTextHeight() {
        let samples = ["截屏失败，请重新截图。", "网络等待中，请稍候。", "题目不清晰，请重新拍摄完整题目。",
                       "**答案：B**\n\n解释：第一行。\n第二行包含中文、English 与 123。",
                       Array(repeating: "长答案：检查每一行上下边界。", count: 40).joined(separator: "\n")]
        for failed in [false, true] {
            for sample in samples {
                let presentation = AnswerPresentation(mode: "tutor", depth: "full", finished: true, revealed: true, failed: failed)
                let text = NotchType.answerString(sample, presentation: presentation, inShelf: true)
                for width: CGFloat in [320, 568] {
                    let fitted = AnswerMath.fitting(text, width: width)
                    let height = StreamingAnswerView.measure(text, width: width)
                    let frame = CTFramesetterCreateFrame(CTFramesetterCreateWithAttributedString(fitted), CFRange(location: 0, length: 0),
                        CGPath(rect: CGRect(x: 0, y: 0, width: width, height: 100_000), transform: nil), nil)
                    let lines = CTFrameGetLines(frame) as! [CTLine]
                    var origins = [CGPoint](repeating: .zero, count: lines.count)
                    CTFrameGetLineOrigins(frame, CFRange(location: 0, length: 0), &origins)
                    for (i, line) in lines.enumerated() {
                        var ascent: CGFloat = 0, descent: CGFloat = 0
                        _ = CTLineGetTypographicBounds(line, &ascent, &descent, nil)
                        let baseline = 100_000 - origins[i].y + StreamingAnswerView.topInset(fitted)
                        XCTAssertGreaterThanOrEqual(baseline - ascent, -0.01)
                        XCTAssertLessThanOrEqual(baseline + descent, height + 0.01)
                    }
                }
            }
        }
    }
}
