import AppKit
import XCTest
@testable import NotchSPI

final class GhostIndicatorTests: XCTestCase {
    @MainActor func testThinkingLoopStartsAndSettlesAfterCompletion() {
        let ghost = GhostIndicatorView(frame: .init(x: 0, y: 0, width: 20, height: 20))
        ghost.busy = true
        for _ in 0..<10 { ghost.qaAdvance(0.05) }
        XCTAssertGreaterThan(ghost.qaThinkingBlend, 0.95)
        let first = ghost.qaThinkingPose
        for _ in 0..<7 { ghost.qaAdvance(0.05) }
        if !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion {
            XCTAssertGreaterThan(abs(ghost.qaThinkingPose.y - first.y), 2)
        }
        ghost.busy = false
        for _ in 0..<20 { ghost.qaAdvance(0.05) }
        XCTAssertLessThan(ghost.qaThinkingBlend, 0.001)
    }

    @MainActor func testThinkingTracksRequestRatherThanScreenshotCollection() throws {
        let model = TutorModel()
        let view = NotchView(model: model, frameProvider: { _ in .init(x: 0, y: 0, width: 600, height: 300) },
            onHover: { _ in }, onCycleDepth: {}, onEditPersona: {}, onSettings: {},
            onToggleReasoning: {}, onCopyAnswer: {}, onStopAuto: {})
        let ghost = try XCTUnwrap(view.subviews.compactMap { $0 as? GhostIndicatorView }.first)
        model.screenshotRoundActive = true
        model.status = .ready
        view.refreshScreenshotTray()
        XCTAssertFalse(ghost.busy)
        for status: TutorModel.Status in [.running, .streaming, .idle, .error, .ready] {
            model.status = status
            view.refreshScreenshotTray()
            XCTAssertEqual(ghost.busy, status == .running || status == .streaming)
        }
    }

    @MainActor func testCompletionIsOneShotAndRejectsUnsuccessfulEnds() throws {
        let model = TutorModel()
        let view = NotchView(model: model, frameProvider: { _ in .init(x: 0, y: 0, width: 600, height: 300) },
            onHover: { _ in }, onCycleDepth: {}, onEditPersona: {}, onSettings: {},
            onToggleReasoning: {}, onCopyAnswer: {}, onStopAuto: {})
        let ghost = try XCTUnwrap(view.subviews.compactMap { $0 as? GhostIndicatorView }.first)
        for terminal: TutorModel.Status in [.idle, .error, .ready] {
            model.resultState = nil
            model.answer = "FINAL: B"
            model.status = .running; view.refreshScreenshotTray()
            ghost.qaAdvance(0.5)
            model.status = terminal; view.refreshScreenshotTray()
            XCTAssertEqual(ghost.qaCompletionActive, terminal == .idle && !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion)
            ghost.qaAdvance(0.35)
            let time = ghost.qaCompletionTime
            view.refreshScreenshotTray()
            XCTAssertEqual(ghost.qaCompletionTime, time, "Refresh must not replay completion")
            ghost.qaAdvance(1.5)
            XCTAssertFalse(ghost.qaCompletionActive)
        }
        for answer in ["", L10n.noOutput] {
            model.answer = answer
            model.status = .running; view.refreshScreenshotTray()
            model.status = .idle; view.refreshScreenshotTray()
            XCTAssertFalse(ghost.qaCompletionActive)
        }
        model.answer = "Retake"
        model.status = .streaming; view.refreshScreenshotTray()
        model.resultState = .retake
        model.status = .idle; view.refreshScreenshotTray()
        XCTAssertFalse(ghost.qaCompletionActive)
        ghost.acknowledgeCompletion()
        ghost.busy = true
        XCTAssertFalse(ghost.qaCompletionActive, "A new request cancels the old acknowledgement")
    }

    @MainActor func testCompletionStartsWithoutAPoseJump() {
        let ghost = GhostIndicatorView(frame: .init(x: 0, y: 0, width: 16, height: 16))
        ghost.busy = true; ghost.qaAdvance(0.4)
        ghost.busy = false
        let before = ghost.qaThinkingPose
        ghost.acknowledgeCompletion()
        let after = ghost.qaThinkingPose
        XCTAssertEqual(before.y, after.y)
        XCTAssertEqual(before.pitch, after.pitch)
        XCTAssertEqual(before.roll, after.roll)
        XCTAssertEqual(ghost.frame, NSRect(x: 0, y: 0, width: 16, height: 16))
    }

    @MainActor func testGhostInkStaysInsideExistingSlotsThroughoutMotion() throws {
        let output = ProcessInfo.processInfo.environment["NSPI_GUIDE_SNAPSHOTS"].map { URL(fileURLWithPath: $0) }
        for size: CGFloat in [14.5, 16, 20, 96] {
            let ghost = GhostIndicatorView(frame: NSRect(x: 0, y: 0, width: size, height: size))
            ghost.hero = size == 96
            XCTAssertNil(ghost.hitTest(NSPoint(x: size / 2, y: size / 2)))
            for phase in 0..<3 {
                let busy = phase == 1
                ghost.busy = busy
                if phase == 2 { ghost.acknowledgeCompletion() }
                ghost.color = busy ? NotchPalette.accent : .white
                for frame in 0..<120 {
                    ghost.qaAdvance(0.1)
                    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(ceil(size * 2)),
                        pixelsHigh: Int(ceil(size * 2)), bitsPerSample: 8, samplesPerPixel: 4,
                        hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
                    rep.size = NSSize(width: size, height: size)
                    NSGraphicsContext.saveGraphicsState()
                    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
                    ghost.draw(ghost.bounds)
                    NSGraphicsContext.restoreGraphicsState()
                    var ink = 0
                    var touchesEdge = false
                    for y in 0..<rep.pixelsHigh {
                        for x in 0..<rep.pixelsWide {
                            if rep.colorAt(x: x, y: y)!.alphaComponent > 0.1 {
                                ink += 1
                                touchesEdge = touchesEdge || x == 0 || y == 0 || x == rep.pixelsWide - 1 || y == rep.pixelsHigh - 1
                            }
                        }
                    }
                    XCTAssertFalse(touchesEdge, "Ghost touches slot edge: size \(size), busy \(busy), frame \(frame)")
                    XCTAssertGreaterThan(ink, Int(size * size * 0.6), "Ghost must actually render")
                    if frame == 5, let output {
                        try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
                        try rep.representation(using: .png, properties: [:])!.write(to: output.appendingPathComponent("ghost-\(size)-phase\(phase).png"))
                    }
                }
            }
        }
    }
}
