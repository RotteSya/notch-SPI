import AppKit
import XCTest
@testable import NotchSPI

final class CaptureLatencyTests: XCTestCase {
    @MainActor func testRepeatedShortAnswersRenderAfterCollapseAndReopen() async throws {
        _ = NSApplication.shared
        let model = TutorModel()
        model.answerDepth = "brief"
        let panel = NotchPanel(contentRect: .init(x: 0, y: 0, width: 600, height: 400))
        let view = NotchView(model: model,
            frameProvider: { .init(x: 0, y: 0, width: $0 ? 600 : 200, height: $0 ? 400 : 32) },
            onHover: { _ in }, onCycleDepth: {}, onEditPersona: {}, onSettings: {},
            onToggleReasoning: {}, onCopyAnswer: {}, onStopAuto: {})
        view.qaUseManualMorphClock()
        panel.contentView = view
        panel.orderFrontRegardless()
        defer { panel.orderOut(nil) }
        func answerView(in parent: NSView) -> StreamingAnswerView? {
            if let answer = parent as? StreamingAnswerView { return answer }
            return parent.subviews.lazy.compactMap { answerView(in: $0) }.first
        }
        let answer = try XCTUnwrap(answerView(in: view))
        for iteration in 0..<3 {
            let trace = CaptureLatency(entry: .single)
            model.answerLatency = trace
            model.answer = ""
            model.status = .running
            model.expanded = true
            view.refreshScreenshotTray()
            view.qaAdvanceMorph(by: 0.5)
            model.status = .streaming
            model.answer = "Reasoning.\nFINAL: C"
            try await Task.sleep(for: .milliseconds(25))
            view.displayIfNeeded()
            XCTAssertNil(trace.offsets[.renderStarted])
            // The completed response need not change the text already drawn by streaming.
            model.status = .idle
            trace.complete(success: true)
            // Wait for the scheduled model refresh, not an arbitrary frame deadline.
            for _ in 0..<100 where answer.completedCapture !== trace {
                try await Task.sleep(for: .milliseconds(5))
            }
            XCTAssertTrue(answer.completedCapture === trace)
            view.displayIfNeeded()
            XCTAssertNotNil(trace.offsets[.renderStarted], "Completed answer was not drawn in round \(iteration)")
            model.expanded = false
            view.refreshScreenshotTray()
            view.qaAdvanceMorph(by: 0.5)
        }
    }

    @MainActor func testCompleteAnswerRequiresSuccessfulCompletionAndDraw() {
        var now = 100.0
        let trace = CaptureLatency(entry: .single, now: { now })
        now += 0.3; trace.mark(.captureReady)
        now += 0.4; trace.mark(.firstDelta)
        trace.mark(.renderStarted)
        XCTAssertNil(trace.offsets[.renderStarted], "Streaming tokens are not a completed answer")
        now += 1.2; trace.complete(success: true)
        XCTAssertTrue(trace.needsCompletedDraw)
        now += 0.05; trace.mark(.renderStarted)
        XCTAssertEqual(trace.offsets[.renderStarted]!, 1950, accuracy: 0.001)
        now += 3; trace.mark(.renderStarted)
        XCTAssertEqual(trace.offsets[.renderStarted]!, 1950, accuracy: 0.001, "Redraws must not move the endpoint")
        XCTAssertFalse(trace.needsCompletedDraw)
    }

    @MainActor func testFailureCannotBecomeSuccessfulLatencySample() {
        let trace = CaptureLatency(entry: .single)
        trace.complete(success: false)
        trace.complete(success: true)
        trace.mark(.renderStarted)
        XCTAssertFalse(trace.succeeded)
        XCTAssertNil(trace.offsets[.completed])
        XCTAssertNil(trace.offsets[.renderStarted])
    }

    @MainActor func testCompletedAnswerCountsAtActualVisibleDrawNotSetAnswer() throws {
        _ = NSApplication.shared
        var now = 10.0
        let trace = CaptureLatency(entry: .single, now: { now })
        let view = StreamingAnswerView(frame: .init(x: 0, y: 0, width: 320, height: 100))
        let panel = NSPanel(contentRect: view.frame, styleMask: [.borderless], backing: .buffered, defer: false)
        panel.isReleasedWhenClosed = false
        defer { panel.orderOut(nil); panel.close() }
        panel.contentView = view
        view.completedCapture = trace
        view.setAnswer(NSAttributedString(string: "FINAL: B", attributes: [.font: NSFont.systemFont(ofSize: 16)]), isPlaceholder: false)
        now += 1.8; trace.complete(success: true)
        XCTAssertNil(trace.offsets[.renderStarted])
        let bitmap = try XCTUnwrap(view.bitmapImageRepForCachingDisplay(in: view.bounds))
        view.cacheDisplay(in: view.bounds, to: bitmap)
        XCTAssertNil(trace.offsets[.renderStarted], "Offscreen rendering cannot satisfy user-visible latency")
        panel.orderFrontRegardless()
        view.isHidden = true
        view.cacheDisplay(in: view.bounds, to: bitmap)
        XCTAssertNil(trace.offsets[.renderStarted])
        view.isHidden = false
        now += 0.1
        view.needsDisplay = true
        view.displayIfNeeded()
        XCTAssertEqual(try XCTUnwrap(trace.offsets[.renderStarted]), 1900, accuracy: 0.001)
    }
}
