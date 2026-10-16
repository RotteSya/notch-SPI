import AppKit
import XCTest
@testable import NotchSPI

final class ManualCollapseHoverTests: XCTestCase {
    @MainActor func testClosingRejectsOldButtonHoverAndImmediatelyAcceptsCompactReentry() {
        let model = TutorModel()
        let compact = NSRect(x: 400, y: 568, width: 200, height: 32)
        let expanded = NSRect(x: 200, y: 300, width: 600, height: 300)
        var enters = 0
        let view = NotchView(model: model, frameProvider: { $0 ? expanded : compact },
            onHover: { inside in if inside { enters += 1; model.expanded = true } },
            onCycleDepth: {}, onEditPersona: {}, onSettings: {}, onToggleReasoning: {}, onCopyAnswer: {}, onStopAuto: {})
        for _ in 0..<20 {
            model.expanded = true
            view.trackPointer(at: NSPoint(x: 740, y: 570))
            view.prepareForManualCollapse()
            model.expanded = false
            let before = enters
            // Obsolete tracking events at the old button cannot undo the close.
            for _ in 0..<3 { view.trackPointer(at: NSPoint(x: 740, y: 570)) }
            XCTAssertFalse(model.expanded)
            XCTAssertEqual(enters, before)
            // No timeout or animation completion is needed for a fresh entry.
            view.trackPointer(at: NSPoint(x: 430, y: 580))
            XCTAssertTrue(model.expanded)
            XCTAssertEqual(enters, before + 1)
        }
        view.updateTrackingAreas()
        let tracking = view.trackingAreas.first { $0.options.contains(.mouseMoved) }
        for _ in 0..<20 { view.updateTrackingAreas() }
        XCTAssertEqual(view.trackingAreas.filter { $0.options.contains(.mouseMoved) }.count, 1)
        XCTAssertTrue(view.trackingAreas.first { $0.options.contains(.mouseMoved) } === tracking)
    }

    @MainActor func testAnimatedWindowFramesDoNotCreateHoverExits() {
        let model = TutorModel()
        let compact = NSRect(x: 400, y: 568, width: 200, height: 32)
        let expanded = NSRect(x: 200, y: 300, width: 600, height: 300)
        var changes: [Bool] = []
        let view = NotchView(model: model, frameProvider: { $0 ? expanded : compact },
            onHover: { inside in changes.append(inside); if inside { model.expanded = true } },
            onCycleDepth: {}, onEditPersona: {}, onSettings: {}, onToggleReasoning: {}, onCopyAnswer: {}, onStopAuto: {})
        let panel = NotchPanel(contentRect: compact)
        defer { panel.close() }
        panel.contentView = view
        view.trackPointer(at: NSPoint(x: 430, y: 600))
        XCTAssertTrue(model.expanded, "The screen top edge is a valid entry")
        for step in 0...20 {
            let progress = CGFloat(step) / 20
            panel.setFrame(NSRect(x: 400 - progress * 200, y: 568 - progress * 268,
                                  width: 200 + progress * 400, height: 32 + progress * 268), display: false)
            // Move into the destination body before the opening frame catches up.
            view.trackPointer(at: NSPoint(x: 430, y: 550))
            view.trackPointer(at: NSPoint(x: 430, y: 600), allowsExpansion: false)
        }
        XCTAssertEqual(changes, [true], "Morph-generated exits cannot collapse a hovered card")
        view.trackPointer(at: NSPoint(x: 430, y: 250), allowsExpansion: false)
        XCTAssertEqual(changes, [true, false])
        view.prepareForManualCollapse()
        model.expanded = false
        view.trackPointer(at: NSPoint(x: 430, y: 580), allowsExpansion: false)
        XCTAssertFalse(model.expanded, "Exit cannot reopen the closed card")
        view.trackPointer(at: NSPoint(x: 430, y: 580))
        XCTAssertTrue(model.expanded, "A genuine entry reopens without a cooldown")
    }

    @MainActor func testManualCloseIgnoresStationaryEventsAndRearmsOnMovement() {
        let model = TutorModel()
        let compact = NSRect(x: 400, y: 568, width: 200, height: 32)
        let expanded = NSRect(x: 200, y: 300, width: 600, height: 300)
        let view = NotchView(model: model, frameProvider: { $0 ? expanded : compact },
            onHover: { inside in if inside { model.expanded = true } },
            onCycleDepth: {}, onEditPersona: {}, onSettings: {}, onToggleReasoning: {}, onCopyAnswer: {}, onStopAuto: {})
        let clickPoint = NSPoint(x: 430, y: 580)
        for _ in 0..<50 {
            model.expanded = true
            view.prepareForManualCollapse(at: clickPoint)
            model.expanded = false
            for _ in 0..<3 { view.trackPointer(at: clickPoint) }
            XCTAssertFalse(model.expanded)
            view.expandFromClick(at: NSPoint(x: 740, y: 570))
            XCTAssertFalse(model.expanded, "A second click on the closing body cannot reopen it")
            view.trackPointer(at: NSPoint(x: 431, y: 580))
            XCTAssertTrue(model.expanded)
        }
    }

    @MainActor func testClickExpansionAndMissedAnimationExitReachController() throws {
        let controller = NotchController(activateServices: false)
        controller.qaClickCompact()
        XCTAssertTrue(controller.model.expanded)
        controller.qaTrackPointer(NSPoint(x: -10000, y: -10000), allowsExpansion: false)
        let work = try XCTUnwrap(controller.qaPendingCollapse)
        work.perform()
        XCTAssertFalse(controller.model.expanded, "Click expansion must track the subsequent exit")
        XCTAssertNil(controller.qaPendingCollapse)
    }

    @MainActor func testProgrammaticExpansionInvalidatesOldCollapseEvenWhenAlreadyOpen() throws {
        let controller = NotchController(activateServices: false)
        controller.qaClickCompact()
        controller.qaTrackPointer(NSPoint(x: -10000, y: -10000), allowsExpansion: false)
        let stale = try XCTUnwrap(controller.qaPendingCollapse)
        controller.setExpanded(true)
        XCTAssertNil(controller.qaPendingCollapse)
        stale.perform()
        XCTAssertTrue(controller.model.expanded)
        controller.collapseByUser()
    }

    @MainActor func testRapidControllerEntriesExitsAndButtonCollapse() throws {
        let controller = NotchController(activateServices: false)
        let compact = controller.qaHoverFrame(expanded: false)
        let inside = NSPoint(x: compact.midX, y: compact.midY)
        let outside = NSPoint(x: -10000, y: -10000)
        for _ in 0..<50 {
            controller.qaTrackPointer(inside)
            XCTAssertTrue(controller.model.expanded)
            controller.qaTrackPointer(outside, allowsExpansion: false)
            let stale = try XCTUnwrap(controller.qaPendingCollapse)
            controller.qaTrackPointer(inside)
            stale.perform()
            XCTAssertTrue(controller.model.expanded)
            XCTAssertNil(controller.qaPendingCollapse)
            controller.qaTrackPointer(outside, allowsExpansion: false)
            let beforeButton = try XCTUnwrap(controller.qaPendingCollapse)
            controller.collapseByUser()
            beforeButton.perform()
            XCTAssertFalse(controller.model.expanded)
            controller.qaTrackPointer(inside, allowsExpansion: false)
            XCTAssertFalse(controller.model.expanded)
            controller.qaTrackPointer(inside)
            XCTAssertTrue(controller.model.expanded)
            controller.qaTrackPointer(outside, allowsExpansion: false)
            try XCTUnwrap(controller.qaPendingCollapse).perform()
            XCTAssertFalse(controller.model.expanded)
        }
    }

    @MainActor func testRealDelayedCollapseIsCancelledByReentry() async throws {
        let previous = ProcessInfo.processInfo.environment["NSPI_QA_REDUCE_MOTION"]
        defer {
            if let previous { setenv("NSPI_QA_REDUCE_MOTION", previous, 1) }
            else { unsetenv("NSPI_QA_REDUCE_MOTION") }
        }
        for reduced in ["0", "1"] {
            setenv("NSPI_QA_REDUCE_MOTION", reduced, 1)
            let controller = NotchController(activateServices: false)
            // Control presentation and pointer input, retaining the real 450ms dispatch timer.
            controller.qaUseManualHoverAnimation()
            let compact = controller.qaHoverFrame(expanded: false)
            let inside = NSPoint(x: compact.midX, y: compact.midY)
            let outside = NSPoint(x: -10000, y: -10000)
            controller.qaTrackPointer(inside)
            controller.qaTrackPointer(outside, allowsExpansion: false)
            XCTAssertTrue(controller.model.expanded, "Exit retains the existing grace period")
            XCTAssertNotNil(controller.qaPendingCollapse)
            controller.qaTrackPointer(inside)
            controller.qaAdvanceHoverAnimation(by: 1)
            XCTAssertNil(controller.qaPendingCollapse, "Completion must sample the reentered pointer")
            try await Task.sleep(nanoseconds: 650_000_000)
            XCTAssertTrue(controller.model.expanded, "Old deadline cannot close a reentered card; Reduce Motion=\(reduced)")
            controller.qaTrackPointer(outside, allowsExpansion: false)
            try await Task.sleep(nanoseconds: 650_000_000)
            XCTAssertFalse(controller.model.expanded, "A sustained exit must collapse; Reduce Motion=\(reduced)")
        }
    }

    @MainActor func testSettledMorphReconcilesExitMissedDuringGrowth() {
        let model = TutorModel()
        let frame = NSRect(x: 100, y: 100, width: 200, height: 100)
        var changes: [Bool] = []
        let view = NotchView(model: model, frameProvider: { _ in frame },
            onHover: { inside in changes.append(inside); if inside { model.expanded = true } },
            onCycleDepth: {}, onEditPersona: {}, onSettings: {}, onToggleReasoning: {}, onCopyAnswer: {}, onStopAuto: {})
        view.trackPointer(at: NSPoint(x: 150, y: 150))
        view.reconcileHoverAfterMorph(at: NSPoint(x: 0, y: 0))
        XCTAssertEqual(changes, [true, false])
        view.prepareForManualCollapse(at: NSPoint(x: 150, y: 150))
        model.expanded = false
        view.reconcileHoverAfterMorph(at: NSPoint(x: 150, y: 150))
        XCTAssertFalse(model.expanded)
        XCTAssertEqual(changes, [true, false])
    }

    @MainActor func testHeaderControlDoesNotRequireKeyPanelAndActsOnFirstClick() throws {
        var calls = 0
        let button = NotchControlButton(systemName: "chevron.up", tint: .white, label: "Collapse") { calls += 1 }
        let panel = NotchPanel(contentRect: NSRect(x: 0, y: 0, width: 28, height: 24))
        defer { panel.close() }
        panel.contentView = button
        XCTAssertFalse(panel.canBecomeKey)
        XCTAssertFalse(button.needsPanelToBecomeKey)
        for _ in 0..<10 {
            let down = try XCTUnwrap(NSEvent.mouseEvent(with: .leftMouseDown, location: NSPoint(x: 14, y: 12),
                modifierFlags: [], timestamp: 0, windowNumber: panel.windowNumber, context: nil,
                eventNumber: 0, clickCount: 1, pressure: 1))
            let up = try XCTUnwrap(NSEvent.mouseEvent(with: .leftMouseUp, location: NSPoint(x: 14, y: 12),
                modifierFlags: [], timestamp: 0.1, windowNumber: panel.windowNumber, context: nil,
                eventNumber: 1, clickCount: 1, pressure: 0))
            button.mouseDown(with: down); button.mouseUp(with: up)
        }
        XCTAssertEqual(calls, 10)
    }
}
