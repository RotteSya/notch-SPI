import AppKit
import XCTest
@testable import NotchSPI

final class OnboardingAccessibilityTests: XCTestCase {
    @MainActor func testActionAndConfirmationExposeDifferentSemantics() {
        var clicks = 0
        let button = GlowButton(title: "Continue", action: { clicks += 1 })
        XCTAssertTrue(button.isAccessibilityElement())
        XCTAssertEqual(button.accessibilityRole(), .button)
        XCTAssertEqual(button.accessibilityLabel(), "Continue")
        XCTAssertTrue(button.acceptsFirstResponder)
        XCTAssertTrue(button.accessibilityPerformPress())
        XCTAssertEqual(clicks, 1)
        button.isEnabled = false
        XCTAssertFalse(button.accessibilityPerformPress())
        button.isEnabled = true
        button.style = .confirm
        XCTAssertEqual(button.accessibilityRole(), .staticText)
        XCTAssertFalse(button.acceptsFirstResponder)
        XCTAssertFalse(button.accessibilityPerformPress())
        button.style = .primary
        button.isHidden = true
        XCTAssertFalse(button.accessibilityPerformPress())
        XCTAssertEqual(clicks, 1)
    }

    @MainActor func testWelcomeLanguagePopupExposesTheThreeLocales() {
        let previous = L10n.setting
        defer { L10n.setting = previous }
        L10n.setting = .zhHans
        let view = NotchOnboardingView(frame: .init(x: 0, y: 0, width: 600, height: 420))
        view.update(step: .welcome, granted: false, denied: false, failed: false)
        let popup = view.subviews.compactMap { $0 as? NSPopUpButton }.first
        XCTAssertNotNil(popup)
        guard let popup else { return }
        XCTAssertFalse(popup.isHidden)
        XCTAssertEqual(popup.accessibilityLabel(), "Language / 语言 / 言語")
        XCTAssertEqual(popup.itemTitles, ["简体中文", "日本語", "English"])
        let locales: [AppLanguage] = [.zhHans, .ja, .en]
        for (index, locale) in locales.enumerated() {
            popup.selectItem(at: index)
            XCTAssertTrue(popup.sendAction(popup.action, to: popup.target))
            XCTAssertEqual(L10n.setting, locale)
        }
        view.update(step: .trial, granted: false, denied: false, failed: false, trial: .available)
        XCTAssertTrue(popup.isHidden)
    }

    @MainActor func testTrialClaimStatesExposeActionSemantics() {
        let previous = L10n.setting
        defer { L10n.setting = previous }
        L10n.setting = .zhHans
        let view = NotchOnboardingView(frame: .init(x: 0, y: 0, width: 600, height: 420))
        func show(_ trial: OnboardingTrialState) {
            view.update(step: .trial, granted: false, denied: false, failed: false, trial: trial)
        }
        show(.available)
        XCTAssertEqual(view.primary.accessibilityRole(), .button)
        XCTAssertEqual(view.primary.accessibilityLabel(), "领取免费体验")
        XCTAssertEqual(view.primary.title, "领取免费体验")
        XCTAssertTrue(view.primary.isEnabled)
        show(.loading)
        XCTAssertEqual(view.primary.title, "正在检查…")
        XCTAssertFalse(view.primary.isEnabled)
        XCTAssertFalse(view.primary.accessibilityPerformPress())
        show(.claiming)
        XCTAssertEqual(view.primary.title, "正在领取…")
        XCTAssertFalse(view.primary.isEnabled)
        show(.failed)
        XCTAssertEqual(view.primary.accessibilityLabel(), "重新领取")
        XCTAssertTrue(view.primary.isEnabled)
        show(.claimed)
        XCTAssertEqual(view.primary.accessibilityRole(), .button)
        XCTAssertEqual(view.primary.accessibilityLabel(), "开始使用")
        XCTAssertEqual(view.primary.title, "开始使用")
        XCTAssertTrue(view.primary.isEnabled)
        show(.unavailable)
        XCTAssertFalse(view.primary.isEnabled)
    }

    @MainActor func testReduceMotionOverrideIsVisibleToTheGuide() {
        let previous = ProcessInfo.processInfo.environment["NSPI_QA_REDUCE_MOTION"]
        setenv("NSPI_QA_REDUCE_MOTION", "1", 1)
        defer {
            if let previous { setenv("NSPI_QA_REDUCE_MOTION", previous, 1) }
            else { unsetenv("NSPI_QA_REDUCE_MOTION") }
        }
        XCTAssertTrue(onboardingReduceMotion())
    }
}
