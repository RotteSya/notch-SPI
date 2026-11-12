import AppKit
import XCTest
@testable import NotchSPI

final class OnboardingMotionTests: XCTestCase {
    @MainActor func testIllustrationEveryPoseIsBoundedAndSettles() throws {
        let previous = ProcessInfo.processInfo.environment["NSPI_QA_REDUCE_MOTION"]
        setenv("NSPI_QA_REDUCE_MOTION", "0", 1)
        defer {
            if let previous { setenv("NSPI_QA_REDUCE_MOTION", previous, 1) }
            else { unsetenv("NSPI_QA_REDUCE_MOTION") }
        }
        let output = ProcessInfo.processInfo.environment["NSPI_GUIDE_ILLUSTRATION_FRAMES"].map { URL(fileURLWithPath: $0) }
        if let output { try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true) }
        let window = NSWindow(contentRect: .init(x: -500, y: -500, width: 340, height: 140),
                              styleMask: .borderless, backing: .buffered, defer: false)
        let illustration = OnboardingIllustration(frame: .init(x: 0, y: 0, width: 340, height: 140))
        window.contentView = illustration; window.orderFront(nil)
        defer { window.orderOut(nil) }
        illustration.qaUseManualClock()
        illustration.present(step: .welcome, granted: false, animated: false)
        let stages: [(NotchOnboardingStep, Bool)] = [(.welcome, false), (.permission, false), (.permission, true),
                                                    (.capture, true), (.multiple, true), (.multiCapture, true),
                                                    (.trial, true), (.welcome, false)]
        var frame = 0
        for (step, granted) in stages {
            illustration.present(step: step, granted: granted, animated: true)
            for _ in 0..<42 {
                illustration.qaAdvance(by: 1.0 / 30)
                XCTAssertTrue(illustration.qaPose.allSatisfy { $0.isFinite && (0...1).contains($0) })
                if let output, let rep = illustration.bitmapImageRepForCachingDisplay(in: illustration.bounds) {
                    illustration.cacheDisplay(in: illustration.bounds, to: rep)
                    try XCTUnwrap(rep.representation(using: .png, properties: [:])).write(
                        to: output.appendingPathComponent(String(format: "%04d.png", frame)))
                }
                frame += 1
            }
            XCTAssertFalse(illustration.qaIsAnimating, "\(step) must settle before the next interaction")
        }
    }

    @MainActor func testIllustrationRetargetsVisiblePoseAndStopsWhenSettledOrDetached() throws {
        let previous = ProcessInfo.processInfo.environment["NSPI_QA_REDUCE_MOTION"]
        setenv("NSPI_QA_REDUCE_MOTION", "0", 1)
        defer {
            if let previous { setenv("NSPI_QA_REDUCE_MOTION", previous, 1) }
            else { unsetenv("NSPI_QA_REDUCE_MOTION") }
        }
        let window = NSWindow(contentRect: .init(x: -500, y: -500, width: 340, height: 140),
                              styleMask: .borderless, backing: .buffered, defer: false)
        let illustration = OnboardingIllustration(frame: .init(x: 0, y: 0, width: 340, height: 140))
        window.contentView = illustration; window.orderFront(nil)
        defer { window.orderOut(nil) }
        illustration.qaUseManualClock()
        illustration.present(step: .welcome, granted: false, animated: false)
        illustration.present(step: .multiple, granted: false, animated: true)
        illustration.qaAdvance(by: 0.22)
        let interrupted = illustration.qaPose
        XCTAssertGreaterThan(interrupted[1], 0)
        XCTAssertLessThan(interrupted[1], 1)
        illustration.present(step: .permission, granted: false, animated: true)
        XCTAssertEqual(illustration.qaPose, interrupted, "Back must preserve the currently visible geometry")
        illustration.qaAdvance(by: 0.15)
        let secondInterruption = illustration.qaPose
        illustration.present(step: .trial, granted: false, animated: true)
        XCTAssertEqual(illustration.qaPose, secondInterruption)
        illustration.qaAdvance(by: 1)
        XCTAssertFalse(illustration.qaIsAnimating, "Reading a page must not keep a display link ticking")
        let settled = illustration.qaPose
        illustration.qaAdvance(by: 10)
        XCTAssertEqual(illustration.qaPose, settled)
        illustration.present(step: .permission, granted: false, animated: true)
        illustration.qaAdvance(by: 1)
        illustration.present(step: .permission, granted: true, animated: true)
        illustration.qaAdvance(by: 0.25)
        let granting = illustration.qaPose
        XCTAssertGreaterThan(granting[3], 0)
        XCTAssertLessThan(granting[3], 1)
        illustration.present(step: .permission, granted: true, animated: true)
        XCTAssertEqual(illustration.qaPose, granting, "Repeated model refreshes must not restart the acknowledgement")
        illustration.removeFromSuperview()
        XCTAssertFalse(illustration.qaIsAnimating)
        XCTAssertEqual(illustration.qaPose[3], 1)
    }

    @MainActor func testReduceMotionSettlesAnInFlightIllustrationAndHiddenAncestorStopsIt() {
        let previous = ProcessInfo.processInfo.environment["NSPI_QA_REDUCE_MOTION"]
        setenv("NSPI_QA_REDUCE_MOTION", "0", 1)
        defer {
            if let previous { setenv("NSPI_QA_REDUCE_MOTION", previous, 1) }
            else { unsetenv("NSPI_QA_REDUCE_MOTION") }
        }
        let window = NSWindow(contentRect: .init(x: -500, y: -500, width: 340, height: 140),
                              styleMask: .borderless, backing: .buffered, defer: false)
        let host = NSView(frame: .init(x: 0, y: 0, width: 340, height: 140))
        let illustration = OnboardingIllustration(frame: host.bounds)
        host.addSubview(illustration); window.contentView = host; window.orderFront(nil)
        defer { window.orderOut(nil) }
        illustration.qaUseManualClock()
        illustration.present(step: .trial, granted: false, animated: true)
        XCTAssertTrue(illustration.qaIsAnimating)
        setenv("NSPI_QA_REDUCE_MOTION", "1", 1)
        NSWorkspace.shared.notificationCenter.post(name: NSWorkspace.accessibilityDisplayOptionsDidChangeNotification, object: nil)
        XCTAssertFalse(illustration.qaIsAnimating)
        XCTAssertEqual(Array(illustration.qaPose.suffix(3)), [1, 1, 1])
        illustration.present(step: .multiple, granted: false, animated: true)
        XCTAssertFalse(illustration.qaIsAnimating)
        setenv("NSPI_QA_REDUCE_MOTION", "0", 1)
        illustration.present(step: .trial, granted: false, animated: true)
        host.isHidden = true
        XCTAssertFalse(illustration.qaIsAnimating)
    }

    @MainActor func testMouseReleaseActivatesOnceWithoutASecondCompression() throws {
        let window = NSWindow(contentRect: .init(x: -500, y: -500, width: 240, height: 80),
                              styleMask: .borderless, backing: .buffered, defer: false)
        let button = GlowButton(title: "Continue")
        button.frame = .init(x: 20, y: 20, width: 180, height: 38)
        button.onboardingChrome = true; button.ignoresRepeatedClicks = true
        var clicks = 0
        button.onClick = { clicks += 1 }
        window.contentView?.addSubview(button)
        func event(_ type: NSEvent.EventType, inside: Bool = true, count: Int = 1) throws -> NSEvent {
            try XCTUnwrap(NSEvent.mouseEvent(with: type, location: inside ? .init(x: 80, y: 38) : .init(x: 230, y: 70),
                modifierFlags: [], timestamp: 0, windowNumber: window.windowNumber, context: nil,
                eventNumber: 1, clickCount: count, pressure: 1))
        }
        button.mouseUp(with: try event(.leftMouseUp))
        XCTAssertEqual(clicks, 0, "An unarmed release cannot invoke an action")
        button.mouseDown(with: try event(.leftMouseDown))
        button.mouseDragged(with: try event(.leftMouseDragged, inside: false))
        button.mouseUp(with: try event(.leftMouseUp, inside: false))
        XCTAssertEqual(clicks, 0)
        button.mouseDown(with: try event(.leftMouseDown))
        button.mouseUp(with: try event(.leftMouseUp))
        XCTAssertEqual(clicks, 1)
        XCTAssertEqual(try XCTUnwrap(button.layer).transform.m11, 1, accuracy: 0.0001,
                       "Mouse up must settle, not schedule a second synthetic press")
        button.mouseDown(with: try event(.leftMouseDown, count: 2))
        button.mouseUp(with: try event(.leftMouseUp, count: 2))
        XCTAssertEqual(clicks, 1)
        XCTAssertTrue(button.accessibilityPerformPress())
        XCTAssertEqual(clicks, 2, "AX and keyboard activation retain the same action")
        button.isEnabled = false
        XCTAssertEqual(try XCTUnwrap(button.layer).transform.m11, 1, accuracy: 0.0001)
        XCTAssertNil(button.layer?.animation(forKey: "press"))
    }

    @MainActor func testPageResizeKeepsActionsInsideEveryPresentedFrame() throws {
        let previous = ProcessInfo.processInfo.environment["NSPI_QA_REDUCE_MOTION"]
        setenv("NSPI_QA_REDUCE_MOTION", "0", 1)
        defer {
            if let previous { setenv("NSPI_QA_REDUCE_MOTION", previous, 1) }
            else { unsetenv("NSPI_QA_REDUCE_MOTION") }
        }
        let language = L10n.setting
        defer { L10n.setting = language }
        let root = ProcessInfo.processInfo.environment["NSPI_GUIDE_MOTION_FRAMES"].map { URL(fileURLWithPath: $0) }
        if let root { try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true) }
        for locale in [AppLanguage.zhHans, .ja, .en] {
            L10n.setting = locale
            let model = TutorModel()
            model.onboardingStep = .welcome
            let collapsed = NSRect(x: 200, y: 800, width: 200, height: 32)
            func destination() -> NSRect {
                let height = NotchOnboardingView.contentHeight(for: model.onboardingStep!, width: 600) + 28
                return NSRect(x: 0, y: 832 - height, width: 644, height: height)
            }
            let panel = NotchPanel(contentRect: collapsed)
            let view = NotchView(model: model, frameProvider: { $0 ? destination() : collapsed },
                onHover: { _ in }, onCycleDepth: {}, onEditPersona: {}, onSettings: {},
                onToggleReasoning: {}, onCopyAnswer: {}, onStopAuto: {})
            panel.contentView = view; view.qaUseManualMorphClock()
            model.expanded = true; view.refreshScreenshotTray(); view.qaAdvanceMorph(by: 1)
            for (page, step) in [NotchOnboardingStep.permission, .capture, .multiple, .permission, .welcome, .success, .trial].enumerated() {
                model.onboardingStep = step
                view.retargetExpandedFrame(destination()); view.refreshScreenshotTray()
                for frame in 0..<32 {
                    view.qaStepReading(by: 1.0 / 60)
                    view.layoutSubtreeIfNeeded(); view.onboarding.layoutSubtreeIfNeeded()
                    let action = try XCTUnwrap(view.onboarding.primary.isHidden
                        ? view.onboarding.subviews.compactMap { $0 as? GlowButton }.first { !$0.isHidden && $0.title == L10n.t("修改快捷键", "ショートカット設定", "Change shortcut") }
                        : view.onboarding.primary)
                    let button = action.convert(action.bounds, to: view)
                    // A moving action must remain entirely visible, including its focus ring.
                    XCTAssertTrue(view.bounds.insetBy(dx: 0, dy: 1).contains(button), "\(locale) \(step) frame \(frame): \(button) / \(view.bounds)")
                    let hitPoint = view.convert(NSPoint(x: button.midX, y: button.midY), to: view.superview)
                    XCTAssertTrue(view.hitTest(hitPoint) === action,
                        "The moving action must remain clickable: \(locale) \(step) frame \(frame)")
                    XCTAssertEqual(panel.frame.maxY, collapsed.maxY, accuracy: 0.5)
                    let illustration = try XCTUnwrap(view.onboarding.subviews.flatMap(\.subviews).first { $0 is OnboardingIllustration })
                    XCTAssertEqual(illustration.superview?.alphaValue, 1, "The stage must never flash empty while the panel grows")
                    if let root, locale == .zhHans, frame.isMultiple(of: 2),
                       let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds) {
                        view.cacheDisplay(in: view.bounds, to: rep)
                        try XCTUnwrap(rep.representation(using: .png, properties: [:])).write(to: root.appendingPathComponent("page-\(page)-frame-\(String(format: "%02d", frame)).png"))
                    }
                }
            }
            panel.orderOut(nil)
        }
    }
}
