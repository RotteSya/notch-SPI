import AppKit
import XCTest
@testable import NotchSPI

final class HardwareNotchLayoutTests: XCTestCase {
    private func screen(top: CGFloat = 38, origin: CGPoint = .zero, scale: CGFloat = 2,
                        auxiliary: Bool = true) -> NotchScreenLayout {
        let frame = CGRect(origin: origin, size: CGSize(width: 1512, height: 982))
        return .init(frame: frame, visibleFrame: frame.insetBy(dx: 0, dy: 40), scale: scale,
            safeTop: top,
            auxiliaryLeft: top > 0 && auxiliary ? CGRect(x: frame.minX, y: frame.maxY - top, width: 660, height: top) : nil,
            auxiliaryRight: top > 0 && auxiliary ? CGRect(x: frame.minX + 852, y: frame.maxY - top, width: 660, height: top) : nil)
    }

    func testHardwareAndDecorativeMetricsAreIndependent() {
        for scale: CGFloat in [1, 2] {
            for origin in [CGPoint.zero, CGPoint(x: -1512, y: 400), CGPoint(x: 700, y: -982)] {
                let hardware = screen(top: 37.25, origin: origin, scale: scale)
                XCTAssertGreaterThanOrEqual(hardware.contentInset, 37.25)
                XCTAssertEqual(hardware.metrics.notchWidth, 192)
                XCTAssertEqual(hardware.cutout?.midX, hardware.frame.midX)
                let collapsed = hardware.collapsed(sideExtension: 60)
                XCTAssertEqual(collapsed.minX + 60, hardware.cutout!.minX)
                XCTAssertEqual(hardware.contentTop(in: collapsed), hardware.contentInset)
                let plain = screen(top: 0, origin: origin, scale: scale)
                XCTAssertNil(plain.cutout)
                XCTAssertEqual(plain.contentInset, 0)
                XCTAssertEqual(plain.metrics.notchWidth, 200)
                let missing = screen(origin: origin, scale: scale, auxiliary: false)
                XCTAssertLessThanOrEqual(missing.collapsed(sideExtension: 60).maxY, missing.cutout!.minY)
            }
        }
    }

    func testExpandedFrameRespectsVisibleBoundsAndPreservesContentHeight() {
        for top: CGFloat in [0, 32, 44] {
            var layout = screen(top: top)
            let expanded = layout.expanded(contentHeight: 460)
            XCTAssertEqual(expanded.height - NotchMetrics.shadowMarginBottom, 460)
            XCTAssertEqual(expanded.maxY, layout.frame.maxY)
            layout.visibleFrame = CGRect(x: 720, y: 100, width: 700, height: 842)
            let constrained = layout.expanded(contentHeight: 2000)
            XCTAssertGreaterThanOrEqual(constrained.minX, layout.visibleFrame.minX)
            XCTAssertLessThanOrEqual(constrained.maxX, layout.visibleFrame.maxX)
            XCTAssertGreaterThanOrEqual(constrained.minY, layout.visibleFrame.minY)
        }
    }

    func testCollapsedBottomIgnoresMenuBarChromeAndAutoHide() {
        for scale: CGFloat in [1, 2] {
            var layout = screen(top: 32, scale: scale)
            for chrome: CGFloat in [0, 32, 33, 40] {
                layout.visibleFrame.size.height = layout.frame.height - chrome
                layout.visibleFrame.origin.y = layout.frame.minY
                let collapsed = layout.collapsed(sideExtension: 60)
                XCTAssertEqual(collapsed.height, 32)
                XCTAssertEqual(collapsed.minY, layout.frame.maxY - 32)
                XCTAssertEqual(collapsed.maxY, layout.frame.maxY)
            }
            layout.safeTop = 32.25
            XCTAssertLessThanOrEqual(layout.collapsed(sideExtension: 60).height, layout.safeTop,
                "Paint must round inward while text safety rounds outward")
        }
    }

    @MainActor func testCollapsedSurfaceIsBlackAndDoesNotRepaintPhysicalRightContour() throws {
        let scale: CGFloat = 2
        let width = 520, height = 80
        let context = try XCTUnwrap(CGContext(data: nil, width: width, height: height,
            bitsPerComponent: 8, bytesPerRow: width * 4, space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
        let surface = NotchSurfaceView(frame: CGRect(x: 0, y: 0, width: 260, height: 40))
        surface.cardRect = CGRect(x: 0, y: 0, width: 245, height: 32)
        surface.topRadius = 6
        surface.bottomRadius = 14
        surface.hardwareContourCutoff = 152.5
        // Even stale material settings must not leave a glow, stroke, or shadow at rest.
        surface.depth = 0.2
        surface.shadowStrength = 0.2
        NSGraphicsContext.saveGraphicsState()
        defer { NSGraphicsContext.restoreGraphicsState() }
        NSGraphicsContext.current = NSGraphicsContext(cgContext: context, flipped: true)
        // Reproduce the flipped view's actual drawing transform in the raw bitmap.
        context.translateBy(x: 0, y: CGFloat(height))
        context.scaleBy(x: scale, y: -scale)
        surface.draw(surface.bounds)
        let pixels = try XCTUnwrap(context.data).assumingMemoryBound(to: UInt8.self)
        var painted = 0
        var colored = 0
        var outside = 0
        for y in 0..<height {
            for x in 0..<width {
                let offset = (y * width + x) * 4
                if pixels[offset + 3] > 0 { painted += 1 }
                if pixels[offset] > 0 || pixels[offset + 1] > 0 || pixels[offset + 2] > 0 { colored += 1 }
                if (y >= 64 || x >= 305) && pixels[offset + 3] > 0 { outside += 1 }
            }
        }
        XCTAssertGreaterThan(painted, 1000, "The left extension must still be drawn")
        XCTAssertEqual(colored, 0, "No highlight or dither remains at rest")
        XCTAssertEqual(outside, 0, "No painted pixel below the hardware bottom or over its original right-hand contour")
    }

    @MainActor func testReducedMotionKeepsPlainScreenLayoutAndUsesBothHardwareWings() throws {
        let old = ProcessInfo.processInfo.environment["NSPI_QA_REDUCE_MOTION"]
        setenv("NSPI_QA_REDUCE_MOTION", "1", 1)
        defer {
            if let old { setenv("NSPI_QA_REDUCE_MOTION", old, 1) }
            else { unsetenv("NSPI_QA_REDUCE_MOTION") }
        }
        func descendants(_ root: NSView) -> [NSView] { [root] + root.subviews.flatMap(descendants) }
        for top: CGFloat in [0, 32, 38, 44] {
            let layout = screen(top: top)
            let model = TutorModel()
            let expanded = layout.expanded(contentHeight: 300)
            let collapsed = layout.collapsed(sideExtension: 60)
            let panel = NotchPanel(contentRect: collapsed)
            defer { panel.close() }
            let view = NotchView(model: model, frameProvider: { $0 ? expanded : collapsed },
                onHover: { _ in }, onCycleDepth: {}, onEditPersona: {}, onSettings: {},
                onToggleReasoning: {}, onCopyAnswer: {}, onStopAuto: {})
            panel.contentView = view
            view.screenLayout = layout
            view.resetScreenFrames(collapsed: collapsed, expanded: expanded)
            model.mode = "personality"
            model.personaLabel = String(repeating: "Long persona name", count: 20)
            model.statusText = "完成 · 剩余 864 题"
            model.expanded = true
            view.refreshScreenshotTray()
            let all = descendants(view)
            let brand = try XCTUnwrap(all.compactMap { $0 as? NSTextField }.first { $0.stringValue == "NotchSPI" })
            let pill = try XCTUnwrap(all.first { String(describing: type(of: $0)) == "NotchCapsuleButton" })
            XCTAssertEqual(pill.toolTip, model.personaLabel)
            XCTAssertFalse(pill.isHiddenOrHasHiddenAncestor)
            let scroll = try XCTUnwrap(all.compactMap { $0 as? NSScrollView }.first)
            XCTAssertEqual(scroll.frame.minY, 48)
            if let cutout = layout.cutout {
                let brandFrame = panel.convertToScreen(brand.convert(brand.bounds, to: nil))
                let pillFrame = panel.convertToScreen(pill.convert(pill.bounds, to: nil))
                XCTAssertLessThanOrEqual(brandFrame.maxX, cutout.minX)
                XCTAssertGreaterThanOrEqual(pillFrame.minX, cutout.maxX)
                XCTAssertGreaterThan(brandFrame.maxY, cutout.minY)
                XCTAssertGreaterThan(pillFrame.maxY, cutout.minY)
            } else {
                XCTAssertEqual(brand.frame.midY, NotchLayout.headerRowCenterY)
                XCTAssertEqual(pill.frame.midY, NotchLayout.headerRowCenterY)
            }
        }
    }

    @MainActor func testClosingBottomCatchesUpWithoutReversalAndSharesFinalFrame() throws {
        let previous = ProcessInfo.processInfo.environment["NSPI_QA_REDUCE_MOTION"]
        setenv("NSPI_QA_REDUCE_MOTION", "0", 1)
        defer {
            if let previous { setenv("NSPI_QA_REDUCE_MOTION", previous, 1) }
            else { unsetenv("NSPI_QA_REDUCE_MOTION") }
        }
        for step: NotchOnboardingStep? in [nil, .success] {
            for height: CGFloat in [200, 600] {
                let layout = screen()
                let model = TutorModel()
                model.onboardingStep = step; model.expanded = true
                let expanded = layout.expanded(contentHeight: height)
                let collapsed = layout.collapsed(sideExtension: 60)
                let panel = NotchPanel(contentRect: expanded)
                defer { panel.close() }
                let view = NotchView(model: model, frameProvider: { $0 ? expanded : collapsed },
                    onHover: { _ in }, onCycleDepth: {}, onEditPersona: {}, onSettings: {},
                    onToggleReasoning: {}, onCopyAnswer: {}, onStopAuto: {})
                panel.contentView = view
                view.screenLayout = layout
                view.resetScreenFrames(collapsed: collapsed, expanded: expanded)
                view.qaUseManualMorphClock()
                model.expanded = false; view.refreshScreenshotTray()
                let duration = step == nil ? NotchPalette.morphDuration : onboardingMotionDuration(0.26)
                var previousFrame = panel.frame
                for sample in 1...20 {
                    view.qaAdvanceMorph(by: duration / 20)
                    let t = CGFloat(sample) / 20
                    let progress = NotchMotion.close(t)
                    let frame = panel.frame
                    for (start, end, current) in [(expanded.minX, collapsed.minX, frame.minX),
                                                  (expanded.maxX, collapsed.maxX, frame.maxX)] {
                        // AppKit rounds the displayed NSWindow frame to whole points.
                        XCTAssertEqual(current, notchLerp(start, end, progress), accuracy: 1.01)
                    }
                    let expected = NotchMotion.closingFrame(from: expanded, to: collapsed,
                        progress: progress, startingExpansion: 1)
                    XCTAssertEqual(frame.minY, expected.minY, accuracy: 1.01)
                    XCTAssertGreaterThanOrEqual(frame.minY, notchLerp(expanded.minY, collapsed.minY, progress) - 1.01)
                    if sample >= 16 {
                        // Check the actual painted body, not only the window's shadow bounds.
                        let card = panel.convertToScreen(view.qaPaintedCardFrame)
                        let bottomRemaining = max(0, collapsed.minY - card.minY)
                        let sidesRemaining = (abs(card.minX - collapsed.minX) + abs(card.maxX - collapsed.maxX)) / 2
                        XCTAssertLessThanOrEqual(bottomRemaining, sidesRemaining + 1.5)
                    }
                    XCTAssertEqual(frame.maxY, expanded.maxY, accuracy: 0.5)
                    XCTAssertLessThanOrEqual(frame.width, previousFrame.width, "A concealed edge must not emerge again")
                    XCTAssertLessThanOrEqual(frame.height, previousFrame.height, "The bottom must never bounce outward")
                    previousFrame = frame
                    // Subpixel spring motion may round to the resting frame before the
                    // deadline; it must never cross inward through the hardware boundary.
                    XCTAssertGreaterThanOrEqual(frame.width, collapsed.width)
                    XCTAssertGreaterThanOrEqual(frame.height, collapsed.height)
                }
                XCTAssertEqual(panel.frame, collapsed)
            }
        }
        XCTAssertEqual(NotchMotion.close(0), 0)
        XCTAssertEqual(NotchMotion.close(1), 1)
        // Motion may soften near rest, but must never reverse after approaching the
        // physical notch. Verify continuity as well as monotonic progress.
        for time: CGFloat in [0.5, 0.62, 0.7, 0.76] {
            let h: CGFloat = 0.0001
            let left = (NotchMotion.close(time) - NotchMotion.close(time - h)) / h
            let right = (NotchMotion.close(time + h) - NotchMotion.close(time)) / h
            XCTAssertEqual(left, right, accuracy: 0.01)
        }
        XCTAssertEqual((NotchMotion.close(1) - NotchMotion.close(0.9999)) / 0.0001, 0, accuracy: 0.001)
        var previousProgress: CGFloat = 0
        for sample in 0...1000 {
            let progress = NotchMotion.close(CGFloat(sample) / 1000)
            XCTAssertGreaterThanOrEqual(progress, previousProgress, "No late outward bounce")
            previousProgress = progress
            XCTAssertGreaterThanOrEqual(progress, 0)
            XCTAssertLessThanOrEqual(progress, 1, "Never contract inside the hardware cutout")
            if sample < 1000 { XCTAssertLessThan(progress, 1, "Do not land early and leave a tail") }
        }
    }

    @MainActor func testActualViewsAvoidHardwareDuringMorphAndDisplayChanges() throws {
        let model = TutorModel()
        var layout = screen()
        func frames(_ expanded: Bool) -> CGRect {
            expanded ? layout.expanded(contentHeight: 460 + layout.bodyAdjustment(onboarding: model.onboardingStep != nil))
                : layout.collapsed(sideExtension: 60)
        }
        let panel = NotchPanel(contentRect: frames(false))
        defer { panel.close() }
        let view = NotchView(model: model, frameProvider: frames,
            onHover: { _ in }, onCycleDepth: {}, onEditPersona: {}, onSettings: {},
            onToggleReasoning: {}, onCopyAnswer: {}, onStopAuto: {})
        panel.contentView = view
        view.screenLayout = layout
        view.resetScreenFrames(collapsed: frames(false), expanded: frames(true))
        view.qaUseManualMorphClock()
        func descendants(_ root: NSView) -> [NSView] { [root] + root.subviews.flatMap(descendants) }
        func assertSafe(file: StaticString = #filePath, line: UInt = #line) {
            view.layoutSubtreeIfNeeded()
            guard let cutout = layout.cutout else { return }
            for child in descendants(view) where child is NSControl || child is RoseLoaderView {
                guard !child.isHiddenOrHasHiddenAncestor else { continue }
                let rect = panel.convertToScreen(child.convert(child.bounds, to: nil))
                XCTAssertFalse(rect.intersects(cutout), "\(type(of: child)): \(rect) intersects \(cutout)", file: file, line: line)
            }
        }
        for step: NotchOnboardingStep? in [nil, .welcome, .permission, .practice, .capture, .working, .success] {
            model.onboardingStep = step
            model.mode = "personality"
            model.personaLabel = String(repeating: "超长人物名称Long persona", count: 20)
            model.statusText = String(repeating: "动态状态", count: 40)
            model.answer = String(repeating: "FINAL: B. Long answer\n", count: 50)
            model.expanded = true
            view.refreshScreenshotTray()
            for _ in 0..<40 { view.qaAdvanceMorph(by: 0.02); assertSafe() }
            if step == nil {
                let labels = descendants(view).compactMap { $0 as? NSTextField }
                let brand = try XCTUnwrap(labels.first { $0.stringValue == "NotchSPI" })
                let pill = try XCTUnwrap(descendants(view).first { String(describing: type(of: $0)) == "NotchCapsuleButton" })
                for child in [brand, pill] {
                    let rect = panel.convertToScreen(child.convert(child.bounds, to: nil))
                    XCTAssertGreaterThan(rect.maxY, layout.cutout!.minY, "Both wings must remain occupied beside the hardware, not shifted below it")
                    XCTAssertFalse(child.isHiddenOrHasHiddenAncestor)
                }
                let scroll = try XCTUnwrap(descendants(view).compactMap { $0 as? NSScrollView }.first)
                XCTAssertEqual(scroll.frame.minY, NotchLayout.headerHeight, "The body must retain its original top")
            }
            model.expanded = false
            view.refreshScreenshotTray()
            for _ in 0..<40 { view.qaAdvanceMorph(by: 0.02); assertSafe() }
            let surface = try XCTUnwrap(descendants(view).compactMap { $0 as? NotchSurfaceView }.first)
            XCTAssertNotNil(surface.hardwareContourCutoff)
            XCTAssertEqual(surface.shadowStrength, 0)
            XCTAssertEqual(surface.materialOpacity, 0)
            XCTAssertEqual(panel.frame, frames(false), "The closing animation must land on the exact hardware height")
        }
        // Change scale/origin/safe area while opening, then reverse immediately.
        model.onboardingStep = nil
        model.expanded = true
        view.refreshScreenshotTray()
        view.qaAdvanceMorph(by: 0.1)
        model.expanded = false
        view.refreshScreenshotTray()
        view.qaAdvanceMorph(by: 0.04)
        assertSafe()
        model.expanded = true
        view.refreshScreenshotTray()
        view.qaAdvanceMorph(by: 0.04)
        assertSafe()
        for next in [screen(top: 0, origin: CGPoint(x: -1512, y: 350), scale: 1),
                     screen(top: 44, origin: CGPoint(x: 200, y: -982)), screen(auxiliary: false)] {
            layout = next
            view.screenLayout = layout
            view.resetScreenFrames(collapsed: frames(false), expanded: frames(true))
            XCTAssertEqual(panel.frame, frames(model.expanded))
            assertSafe()
            model.expanded.toggle()
            view.refreshScreenshotTray()
            for _ in 0..<40 { view.qaAdvanceMorph(by: 0.02); assertSafe() }
        }
    }
}
