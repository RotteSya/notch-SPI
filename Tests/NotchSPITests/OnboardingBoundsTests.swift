import AppKit
import Carbon
import XCTest
@testable import NotchSPI

final class OnboardingBoundsTests: XCTestCase {
    @MainActor func testLongTargetAndCustomShortcutRemainComplete() throws {
        let locale = L10n.setting, combo = Settings.shared.captureCombo
        let target = Settings.shared.captureTargetBundleID, name = Settings.shared.captureTargetName
        defer {
            L10n.setting = locale; Settings.shared.captureCombo = combo
            Settings.shared.captureTargetBundleID = target; Settings.shared.captureTargetName = name
        }
        Settings.shared.captureTargetBundleID = "invalid.bounds.fixture"
        Settings.shared.captureTargetName = String(repeating: "练习窗口 Study application 日本語 ", count: 6)
        Settings.shared.captureCombo = HotkeyCombo(keyCode: 124, modifiers: UInt32(cmdKey | shiftKey | optionKey | controlKey), label: "")
        for language in [AppLanguage.zhHans, .ja, .en] {
            L10n.setting = language
            let model = TutorModel(); model.onboardingStep = .permission
            let view = NotchOnboardingView(frame: NSRect(x: 0, y: 0, width: 600, height: model.onboardingContentHeight!))
            view.update(step: .permission, granted: false, denied: true, failed: false)
            view.layoutSubtreeIfNeeded()
            let fields = (view.subviews + view.subviews.flatMap(\.subviews)).compactMap { $0 as? NSTextField }
            let detail = try XCTUnwrap(fields.first { $0.stringValue.contains("Study application") })
            let measurement = NSTextField(wrappingLabelWithString: detail.stringValue)
            measurement.font = detail.font; measurement.maximumNumberOfLines = 0
            let needed = ceil(measurement.sizeThatFits(NSSize(width: detail.frame.width, height: 10000)).height)
            XCTAssertGreaterThanOrEqual(detail.frame.height, needed)
            XCTAssertTrue(view.bounds.contains(detail.convert(detail.bounds, to: view)))
            for other in fields where other !== detail && !other.isHiddenOrHasHiddenAncestor {
                XCTAssertFalse(detail.convert(detail.bounds, to: view).intersects(other.convert(other.bounds, to: view)))
            }
            view.update(step: .capture, granted: true, denied: false, failed: false)
            view.layoutSubtreeIfNeeded()
            XCTAssertTrue(view.primary.isHidden)
            XCTAssertEqual(view.shortcutPrompt.displayString, Settings.displayString(Settings.shared.captureCombo))
            XCTAssertTrue(view.shortcutPrompt.accessibilityLabel()?.contains(Settings.displayString(Settings.shared.captureCombo)) == true)
            XCTAssertTrue(view.bounds.contains(view.shortcutPrompt.frame))
            XCTAssertNil(view.shortcutPrompt.hitTest(.zero))
        }
    }

    @MainActor func testGuideUsesDailyCardMarginsAndMaterial() throws {
        for step in NotchOnboardingStep.allCases {
            let height = NotchOnboardingView.contentHeight(for: step, width: 600)
            let view = NotchOnboardingView(frame: NSRect(x: 0, y: 0, width: 600, height: height))
            view.update(step: step, granted: false, denied: true, failed: true)
            view.layoutSubtreeIfNeeded()
            let surface = try XCTUnwrap(view.subviews.first { $0 is AnswerShelfView })
            if step.showsLiveContent {
                XCTAssertTrue(surface.isHidden)
                XCTAssertGreaterThanOrEqual(view.primary.frame.minY, NotchLayout.headerHeight)
                continue
            }
            XCTAssertEqual(surface.frame, NotchLayout.shelfFrame(width: 600, top: NotchLayout.headerHeight,
                height: height - NotchLayout.headerHeight - (step.showsLiveContent ? 8 : NotchLayout.answerBottomPad)))
            XCTAssertEqual(surface.layer?.cornerRadius, 18)
            XCTAssertEqual(surface.layer?.borderWidth, 0.5)
            for child in view.subviews.flatMap(\.subviews).compactMap({ $0 as? NSTextField }) where !child.isHiddenOrHasHiddenAncestor {
                XCTAssertTrue(surface.frame.contains(child.convert(child.bounds, to: view)), "\(step): \(child.stringValue)")
            }
        }
    }

    @MainActor func testGuideTextFitsAcrossLanguagesAndStates() {
        let old = L10n.setting
        defer { L10n.setting = old }
        for language in [AppLanguage.zhHans, .ja, .en] {
            L10n.setting = language
            for step in NotchOnboardingStep.allCases {
                for failure in [false, true] {
                    let view = NotchOnboardingView(frame: NSRect(x: 0, y: 0, width: 600, height: NotchOnboardingView.contentHeight(for: step, width: 600)))
                    view.update(step: step, granted: !failure, denied: failure, failed: failure, practiceFailed: failure)
                    view.layoutSubtreeIfNeeded()
                    let fields = (view.subviews + view.subviews.flatMap(\.subviews)).compactMap { $0 as? NSTextField }
                    for field in fields where !field.isHiddenOrHasHiddenAncestor && !field.stringValue.isEmpty {
                        // Header intentionally truncates to its safe wing, with a tooltip.
                        if field.maximumNumberOfLines == 1 { continue }
                        let required = field.sizeThatFits(NSSize(width: field.frame.width, height: 10000))
                        XCTAssertGreaterThanOrEqual(field.frame.height, ceil(required.height), "\(language) / \(step) / \(field.stringValue)")
                        XCTAssertTrue(view.bounds.contains(field.convert(field.bounds, to: view)), "\(language) / \(step)")
                    }
                }
            }
        }
    }
}
