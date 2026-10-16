import AppKit
import XCTest
@testable import NotchSPI

final class OnboardingMotionTests: XCTestCase {
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
