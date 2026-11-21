import AppKit
import XCTest
@testable import NotchSPI

/// Expand/collapse as a reader experiences it: one clock, interruptible at any frame, with
/// nothing on screen jumping when the direction, the content or the display geometry changes.
final class MotionContinuityTests: XCTestCase {
    @MainActor private func makeNotch(layout: NotchScreenLayout? = nil, expandedHeight: CGFloat = 300)
        -> (model: TutorModel, view: NotchView, panel: NotchPanel, collapsed: CGRect, expanded: CGRect) {
        let model = TutorModel()
        let collapsed = layout?.collapsed(sideExtension: 60) ?? CGRect(x: 400, y: 568, width: 245, height: 32)
        let expanded = layout?.expanded(contentHeight: expandedHeight) ?? CGRect(x: 200, y: 300, width: 644, height: 300)
        let panel = NotchPanel(contentRect: collapsed)
        let view = NotchView(model: model, frameProvider: { $0 ? expanded : collapsed },
            onHover: { _ in }, onCycleDepth: {}, onEditPersona: {}, onSettings: {},
            onToggleReasoning: {}, onCopyAnswer: {}, onStopAuto: {})
        panel.contentView = view
        if let layout { view.screenLayout = layout }
        view.resetScreenFrames(collapsed: collapsed, expanded: expanded)
        view.qaUseManualMorphClock()
        return (model, view, panel, collapsed, expanded)
    }

    @MainActor private func withFullMotion(_ body: @MainActor () throws -> Void) rethrows {
        let previous = ProcessInfo.processInfo.environment["NSPI_QA_REDUCE_MOTION"]
        setenv("NSPI_QA_REDUCE_MOTION", "0", 1)
        defer {
            if let previous { setenv("NSPI_QA_REDUCE_MOTION", previous, 1) } else { unsetenv("NSPI_QA_REDUCE_MOTION") }
        }
        try body()
    }

    @MainActor func testOpeningLeavesRestGentlyAndLandsExactly() throws {
        withFullMotion {
            let notch = makeNotch()
            defer { notch.panel.close() }
            notch.model.expanded = true; notch.view.refreshScreenshotTray()
            let frames = 40
            var heights: [CGFloat] = [notch.panel.frame.height]
            for _ in 0..<frames {
                notch.view.qaAdvanceMorph(by: NotchPalette.morphDuration / Double(frames))
                heights.append(notch.panel.frame.height)
            }
            let travel = notch.expanded.height - notch.collapsed.height
            // The body accelerates out of the notch: the first frame is a small step, not the
            // largest one, and no single frame covers a tenth of the way.
            let steps = zip(heights, heights.dropFirst()).map { $1 - $0 }
            XCTAssertGreaterThan(steps[0], 0, "The first frame must already respond to the pointer")
            XCTAssertLessThan(steps[0], steps.max()! * 0.5, "The opening must not start at full speed")
            XCTAssertLessThan(steps.max()!, travel * 0.1 + 1)
            // A soft landing: a little past the target, never far, and exact at rest.
            XCTAssertLessThanOrEqual(heights.max()!, notch.expanded.height + travel * 0.04 + 1)
            XCTAssertEqual(notch.panel.frame, notch.expanded)
            XCTAssertEqual(notch.view.qaMotionSample.contentAlpha, 1)
        }
    }

    @MainActor func testReversingAtAnyFrameContinuesFromTheDisplayedFrame() throws {
        withFullMotion {
            let notch = makeNotch()
            defer { notch.panel.close() }
            let tick = NotchPalette.morphDuration / 24
            for interruption in [1, 3, 6, 10, 15, 22] {
                for opening in [true, false] {
                    // Settle at the opposite pose, start the morph, interrupt it mid-flight.
                    notch.model.expanded = !opening; notch.view.refreshScreenshotTray()
                    for _ in 0..<30 { notch.view.qaAdvanceMorph(by: tick) }
                    notch.model.expanded = opening; notch.view.refreshScreenshotTray()
                    for _ in 0..<interruption { notch.view.qaAdvanceMorph(by: tick) }
                    let displayed = notch.panel.frame
                    let alpha = notch.view.qaMotionSample.contentAlpha
                    notch.model.expanded = !opening; notch.view.refreshScreenshotTray()
                    XCTAssertEqual(notch.panel.frame, displayed, "Reversing must not move the panel before the next frame")
                    XCTAssertEqual(notch.view.qaMotionSample.contentAlpha, alpha, accuracy: 0.001,
                                   "Reversing must not reset the content's visible opacity")
                    var previous = displayed
                    for step in 0..<30 {
                        notch.view.qaAdvanceMorph(by: tick)
                        let frame = notch.panel.frame
                        XCTAssertEqual(frame.maxY, displayed.maxY, accuracy: 0.5, "The top edge stays on the display edge")
                        // After turning back toward the notch the body only ever shrinks.
                        if opening {
                            XCTAssertLessThanOrEqual(frame.width, previous.width, "interruption \(interruption) step \(step)")
                            XCTAssertLessThanOrEqual(frame.height, previous.height, "interruption \(interruption) step \(step)")
                        }
                        // One frame never covers more than a sixth of the remaining distance budget.
                        XCTAssertLessThan(abs(frame.height - previous.height), (notch.expanded.height - notch.collapsed.height) / 6 + 1)
                        previous = frame
                    }
                    XCTAssertEqual(notch.panel.frame, opening ? notch.collapsed : notch.expanded)
                }
            }
        }
    }

    @MainActor func testEveryAnimationFrameLaysTheNotchOutOnce() throws {
        withFullMotion {
            let notch = makeNotch()
            defer { notch.panel.close() }
            for target in [true, false, true] {
                notch.model.expanded = target; notch.view.refreshScreenshotTray()
                for _ in 0..<20 {
                    let before = notch.view.qaLayoutPasses
                    notch.view.qaAdvanceMorph(by: NotchPalette.morphDuration / 20)
                    XCTAssertEqual(notch.view.qaLayoutPasses - before, 1,
                                   "Frame, radii, light field and content are laid out together, once per frame")
                }
                XCTAssertEqual(notch.panel.frame, target ? notch.expanded : notch.collapsed)
            }
        }
    }

    @MainActor func testHeaderGroupsDissolveInsteadOfTruncatingWhileTheWingsClose() throws {
        try withFullMotion {
            let frame = CGRect(x: 0, y: 0, width: 1512, height: 982)
            let layout = NotchScreenLayout(frame: frame, visibleFrame: frame.insetBy(dx: 0, dy: 40), scale: 2, safeTop: 32,
                auxiliaryLeft: CGRect(x: 0, y: 950, width: 663, height: 32),
                auxiliaryRight: CGRect(x: 848, y: 950, width: 664, height: 32))
            XCTAssertTrue(layout.usesHeaderWings)
            let notch = makeNotch(layout: layout)
            defer { notch.panel.close() }
            notch.model.statusText = "Ready"
            notch.model.depthLabel = "Low"
            notch.model.expanded = true; notch.view.refreshScreenshotTray()
            for _ in 0..<40 { notch.view.qaAdvanceMorph(by: 0.02) }
            func descendants(_ root: NSView) -> [NSView] { [root] + root.subviews.flatMap(descendants) }
            let brand = try XCTUnwrap(descendants(notch.view).compactMap { $0 as? NSTextField }.first { $0.stringValue == "NotchSPI" })
            let pill = try XCTUnwrap(descendants(notch.view).first { String(describing: type(of: $0)) == "NotchCapsuleButton" })
            let settledBrand = brand.frame.width, settledPill = pill.frame.width
            XCTAssertEqual(brand.alphaValue, 1); XCTAssertEqual(pill.alphaValue, 1)
            XCTAssertGreaterThanOrEqual(settledBrand, brand.sizeThatFits(NSSize(width: 300, height: 24)).width)

            notch.model.expanded = false; notch.view.refreshScreenshotTray()
            var sawDissolve = false
            for _ in 0..<32 {
                notch.view.qaAdvanceMorph(by: NotchPalette.morphDuration / 32)
                for (view, settled, needed) in [(brand as NSView, settledBrand, brand.sizeThatFits(NSSize(width: 300, height: 24)).width),
                                                (pill, settledPill, settledPill)] where !view.isHiddenOrHasHiddenAncestor {
                    // Whatever is still fully visible is still whole: no "Notch…", no "Lo".
                    if view.alphaValue >= 0.99 { XCTAssertGreaterThanOrEqual(view.frame.width, min(settled, needed) - 0.5) }
                    if view.alphaValue < 0.99 { sawDissolve = true }
                    if view.alphaValue > 0.01 {
                        XCTAssertGreaterThanOrEqual(view.frame.width, min(settled, needed) - 12.5,
                            "A group fades within its last few points; it is never squeezed further while visible")
                    }
                }
            }
            XCTAssertTrue(sawDissolve)
            // Reopening restores every group at full strength.
            notch.model.expanded = true; notch.view.refreshScreenshotTray()
            for _ in 0..<40 { notch.view.qaAdvanceMorph(by: 0.02) }
            XCTAssertEqual(brand.alphaValue, 1); XCTAssertEqual(pill.alphaValue, 1)
            XCTAssertEqual(brand.frame.width, settledBrand); XCTAssertEqual(pill.frame.width, settledPill)
        }
    }

    @MainActor func testConclusionArrivingAboveTheWorkingDoesNotReplayItsEntrance() throws {
        try withFullMotion {
            let view = StreamingAnswerView(frame: CGRect(x: 0, y: 0, width: 560, height: 200))
            let streaming = AnswerPresentation(mode: "tutor", depth: "guided", finished: false, revealed: false)
            let working = "平均速度 = 路程 ÷ 时间，因此 120 km ÷ 2 h = 60 km/h。"
            view.setAnswer(NotchType.answerString(working, presentation: streaming), isPlaceholder: false)
            let born = view.qaGlyphBirths
            XCTAssertEqual(born.count, (working as NSString).length)
            XCTAssertNil(view.takeInsertionDistance(), "Plain growth displaces nothing")
            let top = try XCTUnwrap(view.qaDisplayedTop(of: 0))

            // The marker lands, then the conclusion streams in character by character — every
            // one of those tokens arrives AHEAD of the working that is already being read.
            var pushed: CGFloat = 0
            for conclusion in ["", "B", "B. 60", "B. 60 km/h"] {
                let text = NotchType.answerString(working + "\nFINAL: " + conclusion, presentation: streaming)
                let before = CACurrentMediaTime()
                view.setAnswer(text, isPlaceholder: false)
                let offset = (text.string as NSString).range(of: working).location
                XCTAssertNotEqual(offset, NSNotFound)
                XCTAssertGreaterThan(offset, 0, "The card precedes the working")
                for index in 0..<born.count {
                    XCTAssertEqual(view.qaGlyphBirths[offset + index], born[index], accuracy: 0.0001,
                                   "\"\(conclusion)\": glyph \(index) was already on screen and must not fade in again")
                }
                for index in 0..<offset - 1 {
                    XCTAssertLessThan(view.qaGlyphBirths[index], before, "The conclusion itself is readable at once")
                }
                // Each time the card takes more room, the view reports how far the working moved,
                // and drawing it lifted by that much leaves it exactly where it was.
                pushed += view.takeInsertionDistance() ?? 0
                XCTAssertNil(view.takeInsertionDistance(), "The distance is reported once")
                view.contentLift = pushed
                XCTAssertEqual(try XCTUnwrap(view.qaDisplayedTop(of: offset)), top, accuracy: 0.5,
                               "\"\(conclusion)\": the working must not jump when the card changes above it")
            }
            XCTAssertGreaterThan(pushed, 40, "A label and a conclusion line were inserted above the working")
            view.contentLift = 0
            XCTAssertEqual(try XCTUnwrap(view.qaDisplayedTop(of: (view.accessibilityValue() as? String ?? "").count - 1)), top + pushed, accuracy: 0.5)
        }
    }

    @MainActor func testWorkingSlidesDownWithThePanelWhenTheConclusionIsInserted() throws {
        let working = "平均速度 = 路程 ÷ 时间，因此 120 km ÷ 2 h = 60 km/h。"
        @MainActor func stream(reduced: Bool) throws -> (lifts: [CGFloat], tops: [CGFloat], before: CGFloat, rest: CGFloat) {
            let previous = ProcessInfo.processInfo.environment["NSPI_QA_REDUCE_MOTION"]
            setenv("NSPI_QA_REDUCE_MOTION", reduced ? "1" : "0", 1)
            defer {
                if let previous { setenv("NSPI_QA_REDUCE_MOTION", previous, 1) } else { unsetenv("NSPI_QA_REDUCE_MOTION") }
            }
            let model = TutorModel()
            let collapsed = CGRect(x: 400, y: 568, width: 245, height: 32)
            var expanded = CGRect(x: 200, y: 440, width: 644, height: 160)
            let panel = NotchPanel(contentRect: collapsed)
            defer { panel.close() }
            let view = NotchView(model: model, frameProvider: { $0 ? expanded : collapsed },
                onHover: { _ in }, onCycleDepth: {}, onEditPersona: {}, onSettings: {},
                onToggleReasoning: {}, onCopyAnswer: {}, onStopAuto: {})
            panel.contentView = view
            view.resetScreenFrames(collapsed: collapsed, expanded: expanded)
            view.qaUseManualMorphClock()
            model.answerDepth = "brief"
            model.status = .streaming
            model.answer = working
            model.expanded = true; view.refreshScreenshotTray()
            for _ in 0..<40 { view.qaAdvanceMorph(by: 0.02) }
            func descendants(_ root: NSView) -> [NSView] { [root] + root.subviews.flatMap(descendants) }
            let text = try XCTUnwrap(descendants(view).compactMap { $0 as? StreamingAnswerView }.first)
            let before = try XCTUnwrap(text.qaDisplayedTop(of: 0))

            model.answer = working + "\nFINAL: B. 60 km/h"
            view.refreshScreenshotTray()
            expanded = CGRect(x: 200, y: 360, width: 644, height: 240)   // the controller sizes the panel for the card
            view.retargetExpandedFrame(expanded)
            let index = ((text.accessibilityValue() as? String ?? "") as NSString).range(of: working).location
            XCTAssertNotEqual(index, NSNotFound)
            var lifts = [text.contentLift], tops = [try XCTUnwrap(text.qaDisplayedTop(of: index))]
            for _ in 0..<120 {
                view.qaStepReading(by: 1.0 / 120)
                lifts.append(text.contentLift)
                tops.append(try XCTUnwrap(text.qaDisplayedTop(of: index)))
            }
            text.contentLift = 0
            return (lifts, tops, before, try XCTUnwrap(text.qaDisplayedTop(of: index)))
        }

        let moving = try stream(reduced: false)
        XCTAssertGreaterThan(moving.rest - moving.before, 40)
        XCTAssertEqual(moving.tops[0], moving.before, accuracy: 0.5, "The working starts from where it was being read")
        for (earlier, later) in zip(moving.tops, moving.tops.dropFirst()) {
            XCTAssertGreaterThanOrEqual(later, earlier - 0.01, "It only moves down")
            XCTAssertLessThan(later - earlier, 12, "and never by a jump")
        }
        XCTAssertEqual(moving.tops.last!, moving.rest, accuracy: 0.01)
        XCTAssertEqual(moving.lifts.last!, 0)

        let still = try stream(reduced: true)
        XCTAssertTrue(still.lifts.allSatisfy { $0 == 0 }, "Without motion the working is simply at its new place")
        XCTAssertEqual(still.tops[0], still.rest, accuracy: 0.01)
    }

    @MainActor func testReferenceHandoffLaysThePictureOutInsideItsCardThroughout() throws {
        try withFullMotion {
            _ = NSApplication.shared
            let tray = ScreenshotTray(frame: CGRect(x: 0, y: 0, width: 560, height: 156))
            let panel = NSPanel(contentRect: tray.frame, styleMask: [.borderless], backing: .buffered, defer: false)
            defer { panel.close() }
            panel.contentView = tray
            let asset = ContextAsset(id: UUID(), sessionID: UUID(),
                file: QuestionAssetFile(url: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".png")),
                sha256: "fixture", width: 640, height: 400, byteCount: 0, targetFingerprint: "fixture", capturedAt: Date())
            @MainActor func update(compact: Bool) {
                tray.update(assets: [asset], images: [:], flying: [], message: "", remaining: nil, cancellable: false, compact: compact)
                tray.layoutSubtreeIfNeeded()
            }
            tray.qaUseManualHandoffClock()
            update(compact: false)
            func descendants(_ root: NSView) -> [NSView] { [root] + root.subviews.flatMap(descendants) }
            let picture = try XCTUnwrap(descendants(tray).compactMap { $0 as? NSImageView }.first)
            let card = try XCTUnwrap(picture.superview)
            let large = card.frame
            update(compact: true)
            // The first frame of the handoff is exactly what was on screen.
            XCTAssertEqual(card.frame, large)
            var previous = card.frame
            for _ in 0..<8 {
                tray.qaAdvanceHandoff(by: NotchPalette.referenceDuration / 8)
                // The picture is laid out inside its card at every size on the way; the card's
                // backing never shows as an empty block around an already-small image.
                XCTAssertEqual(picture.frame, card.bounds.insetBy(dx: 3, dy: 3))
                XCTAssertLessThanOrEqual(card.frame.width, previous.width)
                XCTAssertLessThanOrEqual(card.frame.height, previous.height)
                previous = card.frame
                update(compact: true)   // streamed tokens re-lay the strip mid-handoff
                XCTAssertEqual(card.frame, previous, "A relayout must not skip the handoff ahead")
            }
            XCTAssertEqual(card.frame.height, CaptureStyle.referenceThumbnail.height)
            XCTAssertLessThan(card.frame.width, large.width)
            // Interrupting lands on the strip immediately.
            update(compact: false); update(compact: true)
            tray.qaAdvanceHandoff(by: NotchPalette.referenceDuration / 4)
            tray.stopReferenceMotion()
            XCTAssertEqual(card.frame, previous)
        }
    }

    @MainActor func testWhatSitsBelowTheAnswerTravelsWithThePanelEdge() throws {
        try withFullMotion {
            let model = TutorModel()
            let collapsed = CGRect(x: 400, y: 568, width: 245, height: 32)
            var expanded = CGRect(x: 200, y: 400, width: 644, height: 200)
            let panel = NotchPanel(contentRect: collapsed)
            defer { panel.close() }
            let view = NotchView(model: model, frameProvider: { $0 ? expanded : collapsed },
                onHover: { _ in }, onCycleDepth: {}, onEditPersona: {}, onSettings: {},
                onToggleReasoning: {}, onCopyAnswer: {}, onStopAuto: {})
            panel.contentView = view
            view.resetScreenFrames(collapsed: collapsed, expanded: expanded)
            view.qaUseManualMorphClock()
            model.answer = "平均速度 = 路程 ÷ 时间。\nFINAL: B. 60 km/h"
            model.status = .idle
            model.screenshots = [ContextAsset(id: UUID(), sessionID: UUID(),
                file: QuestionAssetFile(url: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".png")),
                sha256: "fixture", width: 640, height: 400, byteCount: 0, targetFingerprint: "fixture", capturedAt: Date())]
            XCTAssertTrue(model.usesAnswerShelf)
            model.expanded = true; view.refreshScreenshotTray()
            for _ in 0..<40 { view.qaAdvanceMorph(by: 0.02) }
            XCTAssertEqual(panel.frame, expanded)
            func descendants(_ root: NSView) -> [NSView] { [root] + root.subviews.flatMap(descendants) }
            let strip = try XCTUnwrap(descendants(view).compactMap { $0 as? ScreenshotTray }.first)
            @MainActor func edge() -> CGFloat { panel.frame.height - NotchMetrics.shadowMarginBottom }   // the card's lower edge
            // The strip has only just arrived below the answer; that handoff owns its motion
            // for its own short duration (wall clock).
            RunLoop.current.run(until: Date() + NotchPalette.referenceDuration + 0.05)
            let before = strip.frame
            let clearance = edge() - before.maxY
            XCTAssertGreaterThan(clearance, 0)

            // The answer gains three lines: everything below it is re-laid 60 pt lower.
            expanded = CGRect(x: 200, y: 340, width: 644, height: 260)
            view.retargetExpandedFrame(expanded)
            XCTAssertEqual(panel.frame.height, 200, "Retargeting alone does not move the panel")
            XCTAssertEqual(strip.frame.minY, before.minY, accuracy: 0.01, "The strip starts from where it was shown")
            var previous = strip.frame.minY
            for step in 0..<120 {
                view.qaStepReading(by: 1.0 / 120)
                XCTAssertGreaterThanOrEqual(strip.frame.minY, previous - 0.01, "step \(step): the strip only moves down")
                XCTAssertEqual(edge() - strip.frame.maxY, clearance, accuracy: 1.5,
                               "step \(step): the strip keeps its place above the lower edge instead of waiting beyond it")
                previous = strip.frame.minY
            }
            XCTAssertEqual(panel.frame, expanded)
            XCTAssertEqual(strip.frame.minY, before.minY + 60, accuracy: 0.01)

            // A row appended below the strip makes the panel taller without moving the strip.
            let settled = strip.frame
            model.explanationAvailable = true
            let rowHeight = model.materialStripHeight(width: 560)
            XCTAssertGreaterThan(rowHeight, 0)
            view.refreshScreenshotTray()
            expanded = CGRect(x: 200, y: 340 - rowHeight, width: 644, height: 260 + rowHeight)
            view.retargetExpandedFrame(expanded)
            XCTAssertEqual(strip.frame, settled, "What is above a new row stays exactly where it is")
            for _ in 0..<120 {
                view.qaStepReading(by: 1.0 / 120)
                XCTAssertEqual(strip.frame, settled)
            }
            XCTAssertEqual(panel.frame, expanded)

            // Collapsing mid-growth hands the panel to the morph with the block at rest.
            expanded = CGRect(x: 200, y: 300 - rowHeight, width: 644, height: 300 + rowHeight)
            view.retargetExpandedFrame(expanded)
            for _ in 0..<5 { view.qaStepReading(by: 1.0 / 120) }
            XCTAssertLessThan(strip.frame.minY, settled.minY + 40)
            model.expanded = false; view.refreshScreenshotTray()
            // The closing plate is the panel as displayed, with nothing still in transit on it.
            let closing = strip.frame
            view.qaStepReading(by: 1.0 / 120)
            XCTAssertEqual(strip.frame, closing, "The morph owns the panel; the growth springs are at rest")
        }
    }

    @MainActor func testEveryFlightSharesOneOverlayThatLeavesWhenTheLastOneLands() throws {
        let flights = ScreenshotFlight()
        flights.qaManualClock = true; flights.qaReduceMotion = false
        defer { flights.cancelAll() }
        let picture = NSImage(size: NSSize(width: 80, height: 50))
        flights.prepare()
        let overlay = try XCTUnwrap(flights.qaOverlay)
        XCTAssertFalse(overlay.isVisible, "Built ahead of the first capture, shown only while something flies")
        var landed = 0
        let first = UUID(), second = UUID()
        let slot = CGRect(x: 400, y: 900, width: 128, height: 80)
        flights.fly(id: first, image: picture, from: CGRect(x: 0, y: 0, width: 800, height: 500), destination: { slot }, landed: { landed += 1 })
        XCTAssertTrue(flights.qaOverlay === overlay)
        XCTAssertTrue(overlay.isVisible)
        flights.qaAdvance(by: ScreenshotFlightGeometry.duration / 2)
        flights.fly(id: second, image: picture, from: CGRect(x: 0, y: 0, width: 800, height: 500), destination: { slot }, landed: { landed += 1 })
        XCTAssertTrue(flights.qaOverlay === overlay, "A second picture joins the same overlay")
        flights.qaAdvance(by: ScreenshotFlightGeometry.duration * 0.6)
        XCTAssertEqual(landed, 1)
        XCTAssertNil(flights.qaSnapshot(first))
        XCTAssertNotNil(flights.qaSnapshot(second))
        XCTAssertTrue(overlay.isVisible, "The overlay stays while another picture is still on its way")
        flights.qaAdvance(by: ScreenshotFlightGeometry.duration)
        XCTAssertEqual(landed, 2)
        XCTAssertFalse(overlay.isVisible)
        XCTAssertEqual(overlay.contentView?.layer?.sublayers?.count ?? 0, 0, "Landed pictures leave nothing behind")
        // The next round reuses it; cancelling hides it at once.
        flights.fly(id: UUID(), image: picture, from: nil, destination: { slot }, landed: { landed += 1 })
        XCTAssertTrue(flights.qaOverlay === overlay)
        flights.cancelAll()
        XCTAssertFalse(overlay.isVisible)
        XCTAssertEqual(landed, 2, "A cancelled flight never reports an arrival")
    }

    @MainActor func testWorkDeferredUntilOpenedRunsOnceTheCardLandsAndNeverAfterAClose() {
        withFullMotion {
            let notch = makeNotch()
            defer { notch.panel.close() }
            var runs = 0
            let tick = NotchPalette.morphDuration / 20
            // Requested while the card still has to open: it waits for the last frame.
            notch.model.expanded = true
            notch.view.whenOpened { runs += 1 }
            notch.view.refreshScreenshotTray()
            for _ in 0..<19 {
                notch.view.qaAdvanceMorph(by: tick)
                XCTAssertEqual(runs, 0, "Nothing may interrupt the opening")
            }
            notch.view.qaAdvanceMorph(by: tick * 2)
            XCTAssertEqual(notch.panel.frame, notch.expanded)
            XCTAssertEqual(runs, 1)
            notch.view.qaAdvanceMorph(by: 1)
            XCTAssertEqual(runs, 1, "It runs once")
            // Already open and still: there is nothing to wait for.
            notch.view.whenOpened { runs += 1 }
            XCTAssertEqual(runs, 2)
            // The card closes before it finished opening: the work belongs to a card that is gone.
            notch.model.expanded = false; notch.view.refreshScreenshotTray()
            for _ in 0..<30 { notch.view.qaAdvanceMorph(by: tick) }
            notch.model.expanded = true
            notch.view.whenOpened { runs += 1 }
            notch.view.refreshScreenshotTray()
            for _ in 0..<8 { notch.view.qaAdvanceMorph(by: tick) }
            notch.model.expanded = false; notch.view.refreshScreenshotTray()
            for _ in 0..<30 { notch.view.qaAdvanceMorph(by: tick) }
            notch.model.expanded = true; notch.view.refreshScreenshotTray()
            for _ in 0..<30 { notch.view.qaAdvanceMorph(by: tick) }
            XCTAssertEqual(runs, 2, "A later, unrelated opening must not run it either")
        }
        // Without motion there is no opening to protect: it runs as soon as the card is placed.
        let previous = ProcessInfo.processInfo.environment["NSPI_QA_REDUCE_MOTION"]
        setenv("NSPI_QA_REDUCE_MOTION", "1", 1)
        defer {
            if let previous { setenv("NSPI_QA_REDUCE_MOTION", previous, 1) } else { unsetenv("NSPI_QA_REDUCE_MOTION") }
        }
        let notch = makeNotch()
        defer { notch.panel.close() }
        var runs = 0
        notch.model.expanded = true
        notch.view.whenOpened { runs += 1 }
        XCTAssertEqual(runs, 0)
        notch.view.refreshScreenshotTray()
        XCTAssertEqual(runs, 1)
    }

    @MainActor func testGuidePageHeightIsMeasuredOncePerStepWidthAndLanguage() {
        let previous = L10n.setting
        defer { L10n.setting = previous }
        for language in [AppLanguage.zhHans, .ja, .en] {
            L10n.setting = language
            for step in NotchOnboardingStep.allCases {
                let first = NotchOnboardingView.contentHeight(for: step, width: 600)
                XCTAssertEqual(NotchOnboardingView.contentHeight(for: step, width: 600), first)
                XCTAssertGreaterThan(first, NotchLayout.headerHeight)
                // A narrower card wraps more text; the remembered height is not reused for it.
                if !step.showsLiveContent {
                    XCTAssertGreaterThanOrEqual(NotchOnboardingView.contentHeight(for: step, width: 420), first)
                }
            }
        }
        // Languages wrap differently: a remembered height never crosses a language switch.
        L10n.setting = .en
        let english = NotchOnboardingView.contentHeight(for: .multiple, width: 420)
        L10n.setting = .zhHans
        let chinese = NotchOnboardingView.contentHeight(for: .multiple, width: 420)
        L10n.setting = .en
        XCTAssertEqual(NotchOnboardingView.contentHeight(for: .multiple, width: 420), english)
        L10n.setting = .zhHans
        XCTAssertEqual(NotchOnboardingView.contentHeight(for: .multiple, width: 420), chinese)
    }

    @MainActor func testReducedMotionAppliesToEveryMovingPartOfTheNotch() throws {
        let previous = ProcessInfo.processInfo.environment["NSPI_QA_REDUCE_MOTION"]
        setenv("NSPI_QA_REDUCE_MOTION", "1", 1)
        defer {
            if let previous { setenv("NSPI_QA_REDUCE_MOTION", previous, 1) } else { unsetenv("NSPI_QA_REDUCE_MOTION") }
        }
        let notch = makeNotch()
        defer { notch.panel.close() }
        notch.model.expanded = true; notch.view.refreshScreenshotTray()
        XCTAssertEqual(notch.panel.frame, notch.expanded, "No travel: the panel is simply at its destination")
        XCTAssertFalse(notch.view.qaMotionSample.morphing)
        XCTAssertEqual(notch.view.qaMotionSample.contentAlpha, 1)
        let ghost = try XCTUnwrap(notch.view.subviews.compactMap { $0 as? GhostIndicatorView }.first)
        ghost.busy = true
        XCTAssertFalse(ghost.qaClockActive, "The indicator holds a still pose instead of running its clock")
        ghost.busy = false
        ghost.acknowledgeCompletion()
        XCTAssertFalse(ghost.qaCompletionActive)
        // Streamed glyphs are simply present.
        let stream = StreamingAnswerView(frame: CGRect(x: 0, y: 0, width: 400, height: 100))
        let before = CACurrentMediaTime()
        stream.setAnswer(NSAttributedString(string: "Answer text", attributes: [.font: NSFont.systemFont(ofSize: 13)]), isPlaceholder: false)
        XCTAssertTrue(stream.qaGlyphBirths.allSatisfy { $0 < before })
        notch.model.expanded = false; notch.view.refreshScreenshotTray()
        XCTAssertEqual(notch.panel.frame, notch.collapsed)
    }
}
