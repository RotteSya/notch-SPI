import AppKit
import XCTest
@testable import NotchSPI

final class SettingsNavigationAccessibilityTests: XCTestCase {
    @MainActor func testExtendedAutoCapsPersistAcrossPageRecreation() throws {
        let previous = Settings.shared.autoModeMaxQuestions
        defer { Settings.shared.autoModeMaxQuestions = previous }
        for cap in [100, AutoSessionEngine.unlimitedQuestions] {
            Settings.shared.autoModeMaxQuestions = cap
            let controller = MainSettingsWindowController()
            controller.open(page: .general)
            let page = try XCTUnwrap(controller.qaVisiblePage)
            let popup = try XCTUnwrap(descendants(page).compactMap { $0 as? NSPopUpButton }.first {
                $0.itemArray.contains { ($0.representedObject as? Int) == AutoSessionEngine.unlimitedQuestions }
            })
            XCTAssertEqual(popup.selectedItem?.representedObject as? Int, cap)
            XCTAssertEqual(popup.itemArray.compactMap { $0.representedObject as? Int }, [5, 10, 20, 30, 50, 100, -1])
            controller.show(page: .account)
            controller.show(page: .general)
            XCTAssertEqual(popup.selectedItem?.representedObject as? Int, cap)
            controller.close()
            XCTAssertEqual(Settings.shared.autoModeMaxQuestions, cap)
        }
    }

    @MainActor func testRapidPageReversalKeepsOneLivePageAndPreservesWindowPosition() async throws {
        let controller = MainSettingsWindowController()
        defer { controller.close() }
        controller.open(page: .general)
        let general = try XCTUnwrap(controller.qaVisiblePage)
        let window = try XCTUnwrap(controller.window)
        window.setFrameOrigin(NSPoint(x: 80, y: 100))
        let position = window.frame.origin
        for _ in 0..<8 {
            controller.show(page: .hotkeys)
            controller.show(page: .account)
            controller.open(page: .general)
            XCTAssertEqual(controller.qaVisiblePageCount, 1)
            XCTAssertTrue(controller.qaVisiblePage === general)
            XCTAssertEqual(window.frame.origin, position)
            XCTAssertNil(general.layer?.animation(forKey: "fadeOut"))
            XCTAssertNil(general.layer?.animation(forKey: "slideOut"))
        }
        try await Task.sleep(nanoseconds: 800_000_000)
        XCTAssertEqual(controller.qaVisiblePageCount, 1)
        XCTAssertTrue(controller.qaVisiblePage === general)
        XCTAssertNotNil(general.superview)
    }

    @MainActor func testAutoCopyLivesInGeneralAndPreservesExistingPreference() throws {
        let previous = Appearance.autoCopyAnswer
        defer { Appearance.autoCopyAnswer = previous }
        Appearance.autoCopyAnswer = true
        let controller = MainSettingsWindowController()
        defer { controller.close() }
        controller.open(page: .general)
        XCTAssertEqual(MainSettingsWindowController.Page.allCases.count, 5)
        controller.show(page: .general)
        let page = try XCTUnwrap(controller.qaVisiblePage)
        let toggle = try XCTUnwrap(descendants(page).first { $0.identifier?.rawValue == "settings.autoCopy" } as? SettingsToggleButton)
        XCTAssertEqual(toggle.state, .on)
        XCTAssertTrue(toggle.accessibilityPerformPress())
        XCTAssertFalse(Appearance.autoCopyAnswer)
        controller.show(page: .hotkeys)
        controller.show(page: .general)
        XCTAssertEqual(toggle.state, .off)
    }

    @MainActor func testAccountAndPaymentReturnShareOnePageAndPreserveScroll() throws {
        let previous = ProcessInfo.processInfo.environment["NSPI_QA_BALANCE"]
        setenv("NSPI_QA_BALANCE", "120", 1)
        defer {
            if let previous { setenv("NSPI_QA_BALANCE", previous, 1) } else { unsetenv("NSPI_QA_BALANCE") }
        }
        let controller = MainSettingsWindowController()
        defer { controller.close() }
        controller.open(page: .account)
        let account = try XCTUnwrap(controller.qaVisiblePage)
        let scroll = try XCTUnwrap(descendants(account).compactMap { $0 as? NSScrollView }.first)
        scroll.contentView.scroll(to: NSPoint(x: 0, y: 200))
        controller.show(page: .general)
        controller.open(page: .plus)
        XCTAssertTrue(controller.qaVisiblePage === account)
        XCTAssertEqual(scroll.contentView.bounds.origin.y, 200)
        XCTAssertEqual(MainSettingsWindowController.Page.allCases.count, 5)
        let buttons = descendants(account).compactMap { $0 as? NSButton }
        XCTAssertTrue(buttons.allSatisfy { $0.keyEquivalent != "\r" }, "Account actions must not purchase on Return")
    }

    @MainActor private func descendants(_ view: NSView) -> [NSView] {
        [view] + view.subviews.flatMap { descendants($0) }
    }

    @MainActor func testSidebarActionsAndArrowKeysNavigateTheActualWindow() throws {
        let controller = MainSettingsWindowController()
        let window = try XCTUnwrap(controller.window)
        defer { window.close() }
        let root = try XCTUnwrap(window.contentView)
        let pageTitles = Set(MainSettingsWindowController.Page.allCases.map(\.localizedTitle))
        let rows = descendants(root).filter { $0.accessibilityRole() == .radioButton && pageTitles.contains($0.accessibilityLabel() ?? "") }
        XCTAssertEqual(rows.count, MainSettingsWindowController.Page.allCases.count)
        XCTAssertEqual(rows.compactMap { $0.accessibilityLabel() },
                       MainSettingsWindowController.Page.allCases.map(\.localizedTitle))
        XCTAssertTrue(rows[1].accessibilityPerformPress())
        XCTAssertEqual(window.title, MainSettingsWindowController.Page.hotkeys.localizedTitle)
        XCTAssertTrue(window.firstResponder === rows[1])
        XCTAssertEqual(rows[1].accessibilityValue() as? Int, 1)
        XCTAssertEqual(rows[0].accessibilityValue() as? Int, 0)

        let down = try XCTUnwrap(NSEvent.keyEvent(with: .keyDown, location: .zero,
            modifierFlags: [], timestamp: 0, windowNumber: window.windowNumber, context: nil,
            characters: "\u{F701}", charactersIgnoringModifiers: "\u{F701}", isARepeat: false, keyCode: 125))
        rows[1].keyDown(with: down)
        XCTAssertEqual(window.title, MainSettingsWindowController.Page.account.localizedTitle)
        XCTAssertTrue(window.firstResponder === rows[2])
        XCTAssertEqual(rows[2].accessibilityValue() as? Int, 1)
        XCTAssertEqual(rows[1].accessibilityValue() as? Int, 0)

        let disabled = try XCTUnwrap(rows[0] as? NSControl)
        disabled.isEnabled = false
        XCTAssertFalse(disabled.accessibilityPerformPress())
        XCTAssertFalse(disabled.canBecomeKeyView)
        XCTAssertEqual(window.title, MainSettingsWindowController.Page.account.localizedTitle)
    }
}

extension SettingsNavigationAccessibilityTests {
    @MainActor func testGeneralThinkingChoicesCommitAndFitInAllLanguages() throws {
        let language = L10n.setting, effort = Settings.shared.reasoningEffort
        defer { L10n.setting = language; Settings.shared.reasoningEffort = effort }
        for lang in [AppLanguage.zhHans, .ja, .en] {
            L10n.setting = lang
            let controller = MainSettingsWindowController()
            controller.open(page: .general)
            let page = try XCTUnwrap(controller.qaVisiblePage)
            let choices = descendants(page).compactMap { $0 as? SettingsEffortButton }
            XCTAssertEqual(choices.count, 3)
            for (index, button) in choices.enumerated() {
                button.performClick(nil)
                XCTAssertEqual(Settings.shared.reasoningEffort, Settings.reasoningEffortCycle[index])
                XCTAssertEqual(choices.filter { $0.state == .on }.count, 1)
                XCTAssertTrue(page.bounds.contains(button.frame))
            }
            for text in page.subviews.compactMap({ $0 as? NSTextField }) {
                let needed = text.cell?.cellSize(forBounds: NSRect(x: 0, y: 0, width: text.frame.width, height: 10000)).height ?? 0
                XCTAssertLessThanOrEqual(needed, text.frame.height + 2, "Clipped: \(text.stringValue)")
            }
            controller.close()
        }
    }
    @MainActor func testAccountHasGroupedSurfacesWithoutCaptureAction() throws {
        let controller = MainSettingsWindowController()
        controller.open(page: .account)
        defer { controller.close() }
        let page = try XCTUnwrap(controller.qaVisiblePage)
        func all(_ view: NSView) -> [NSView] { [view] + view.subviews.flatMap(all) }
        XCTAssertEqual(all(page).compactMap { $0 as? SettingsCardView }.count, 4)
        let actions = all(page).compactMap { $0 as? NSButton }
        XCTAssertFalse(actions.contains { $0.title.contains("截图查题") || $0.title == "Capture a question" })
    }
}

@MainActor private final class SettingsControlActionProbe: NSObject {
    var calls = 0
    @objc func changed(_ sender: Any?) { calls += 1 }
}

extension SettingsNavigationAccessibilityTests {
    @MainActor func testCustomTogglePreservesSwitchSemanticsAndDisabledProtection() throws {
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 400, height: 100), styleMask: [.titled], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        defer { window.close() }
        let toggle = SettingsToggleButton(frame: NSRect(x: 10, y: 10, width: 360, height: 30))
        let probe = SettingsControlActionProbe()
        toggle.title = "Purchased packs"; toggle.target = probe; toggle.action = #selector(SettingsControlActionProbe.changed(_:))
        window.contentView?.addSubview(toggle)
        XCTAssertEqual(toggle.accessibilityRole(), .checkBox)
        XCTAssertTrue(toggle.accessibilityPerformPress())
        XCTAssertEqual(toggle.state, .on); XCTAssertEqual(probe.calls, 1)
        XCTAssertTrue(window.firstResponder === toggle)
        let space = try XCTUnwrap(NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: [], timestamp: 0, windowNumber: window.windowNumber, context: nil, characters: " ", charactersIgnoringModifiers: " ", isARepeat: false, keyCode: 49))
        toggle.keyDown(with: space)
        XCTAssertEqual(toggle.state, .off); XCTAssertEqual(probe.calls, 2)
        toggle.isEnabled = false
        XCTAssertFalse(toggle.accessibilityPerformPress()); toggle.keyDown(with: space)
        XCTAssertEqual(probe.calls, 2); XCTAssertFalse(toggle.canBecomeKeyView)
    }

    @MainActor func testControlHoverChangesRenderingWithoutChangingSelection() throws {
        let event = try XCTUnwrap(NSEvent.enterExitEvent(with: .mouseEntered, location: .zero, modifierFlags: [], timestamp: 0, windowNumber: 0, context: nil, eventNumber: 0, trackingNumber: 0, userData: nil))
        let controls: [NSButton] = [SettingsEffortButton(), SettingsActionButton(), SettingsToggleButton(), SettingsPopupButton()]
        for appearance in [NSAppearance.Name.aqua, .darkAqua] {
            for control in controls {
                control.frame = NSRect(x: 0, y: 0, width: 272, height: 68)
                control.title = "Test option"
                control.appearance = NSAppearance(named: appearance)
                if let popup = control as? NSPopUpButton { popup.addItems(withTitles: ["First", "Second"]); popup.selectItem(at: 1) }
                func pixels() throws -> Data {
                    let bitmap = try XCTUnwrap(control.bitmapImageRepForCachingDisplay(in: control.bounds))
                    control.cacheDisplay(in: control.bounds, to: bitmap)
                    return try XCTUnwrap(bitmap.representation(using: .png, properties: [:]))
                }
                let normal = try pixels(), state = control.state
                control.mouseEntered(with: event)
                XCTAssertNotEqual(try pixels(), normal, "Missing hover: \(type(of: control)) \(appearance)")
                XCTAssertEqual(control.state, state)
                control.mouseExited(with: event)
                XCTAssertEqual(try pixels(), normal)
            }
        }
    }
}

extension SettingsNavigationAccessibilityTests {
    @MainActor func testLeavingHotkeysCancelsRecordingAndAllPagesRemainSingle() throws {
        let controller = MainSettingsWindowController()
        defer { controller.close() }
        controller.open(page: .hotkeys)
        let page = try XCTUnwrap(controller.qaVisiblePage)
        let recorder = try XCTUnwrap(descendants(page).compactMap { $0 as? HotkeyRecorderControl }.first)
        XCTAssertTrue(recorder.accessibilityPerformPress()); XCTAssertTrue(recorder.isRecording)
        for destination in MainSettingsWindowController.Page.allCases {
            controller.show(page: destination)
            XCTAssertEqual(controller.qaVisiblePageCount, 1)
        }
        XCTAssertFalse(recorder.isRecording)
        controller.show(page: .hotkeys)
        XCTAssertFalse(recorder.isRecording)
    }

    @MainActor func testAppearanceStayOpenDisablesDelayAndRestoresIt() throws {
        let before = Appearance.stayExpanded
        defer { Appearance.stayExpanded = before }
        Appearance.stayExpanded = false
        let controller = MainSettingsWindowController(); controller.open(page: .general)
        defer { controller.close() }
        let page = try XCTUnwrap(controller.qaVisiblePage)
        let sliders = descendants(page).compactMap { $0 as? NSSlider }
        let switches = descendants(page).compactMap { $0 as? SettingsToggleButton }
        XCTAssertEqual(sliders.count, 2); XCTAssertEqual(switches.count, 5)
        let delay = try XCTUnwrap(sliders.last), stay = try XCTUnwrap(switches.first { $0.identifier?.rawValue == "settings.stayExpanded" })
        XCTAssertTrue(delay.isEnabled)
        stay.performClick(nil); XCTAssertFalse(delay.isEnabled)
        stay.performClick(nil); XCTAssertTrue(delay.isEnabled)
    }

    @MainActor func testGroupedGeneralAndRemainingPagesFitThreeLanguages() throws {
        let language = L10n.setting
        defer { L10n.setting = language }
        for lang in [AppLanguage.zhHans, .ja, .en] {
            L10n.setting = lang
            let controller = MainSettingsWindowController()
            defer { controller.close() }
            for destination in [MainSettingsWindowController.Page.hotkeys, .general, .personas, .advanced] {
                controller.open(page: destination)
                let page = try XCTUnwrap(controller.qaVisiblePage)
                XCTAssertEqual(descendants(page).compactMap { $0 as? SettingsCardView }.count, destination == .general ? 3 : 2)
                for field in descendants(page).compactMap({ $0 as? NSTextField }) where !field.isEditable && !field.isHiddenOrHasHiddenAncestor && !(field.superview is NSTableCellView) {
                    let height = field.cell?.cellSize(forBounds: NSRect(x: 0, y: 0, width: field.frame.width, height: 10000)).height ?? 0
                    XCTAssertLessThanOrEqual(height, field.frame.height + 2, "\(destination) / \(lang): \(field.stringValue)")
                }
            }
        }
    }
}

extension SettingsNavigationAccessibilityTests {
    @MainActor func testServiceChoiceRebuildRetainsFocusAndConnectionFieldsStayInsideDocument() throws {
        let previous = Settings.shared.serviceMode
        defer { Settings.shared.serviceMode = previous }
        Settings.shared.serviceMode = ServiceMode.official
        let controller = MainSettingsWindowController(); controller.open(page: .advanced)
        defer { controller.close() }
        let page = try XCTUnwrap(controller.qaVisiblePage)
        let choice = try XCTUnwrap(descendants(page).compactMap { $0 as? SettingsEffortButton }.first { $0.identifier?.rawValue == ServiceMode.customKey })
        XCTAssertTrue(choice.accessibilityPerformPress())
        XCTAssertEqual(Settings.shared.serviceMode, ServiceMode.customKey)
        let replacement = try XCTUnwrap(descendants(page).compactMap { $0 as? SettingsEffortButton }.first { $0.identifier?.rawValue == ServiceMode.customKey })
        XCTAssertTrue(controller.window?.firstResponder === replacement)
        XCTAssertEqual(replacement.state, .on)
        let scroll = try XCTUnwrap(descendants(page).compactMap { $0 as? NSScrollView }.first)
        let document = try XCTUnwrap(scroll.documentView)
        for control in document.subviews.compactMap({ $0 as? NSControl }) {
            XCTAssertTrue(document.bounds.contains(control.frame), "Out of bounds: \(type(of: control))")
        }
    }
}

extension SettingsNavigationAccessibilityTests {
    @MainActor func testLanguageRebuildRetainsLanguagePickerFocusAndWindowPosition() throws {
        let old = L10n.setting
        defer { L10n.setting = old }
        let controller = MainSettingsWindowController(); controller.open(page: .general)
        defer { controller.close() }
        let page = try XCTUnwrap(controller.qaVisiblePage)
        let popup = try XCTUnwrap(descendants(page).compactMap { $0 as? NSPopUpButton }.first { $0.itemTitles.contains("English") })
        controller.window?.makeFirstResponder(popup)
        let origin = controller.window?.frame.origin
        L10n.setting = old == .en ? .ja : .en
        let newPage = try XCTUnwrap(controller.qaVisiblePage)
        let newPopup = try XCTUnwrap(descendants(newPage).compactMap { $0 as? NSPopUpButton }.first { $0.itemTitles.contains("English") })
        XCTAssertTrue(controller.window?.firstResponder === newPopup)
        XCTAssertEqual(controller.window?.frame.origin, origin)
        XCTAssertEqual(controller.qaVisiblePageCount, 1)
    }

    @MainActor func testReturningToGeneralResynchronizesAllPersistedControls() throws {
        let oldSize = Appearance.answerFontSize, oldStay = Appearance.stayExpanded
        let oldReason = Appearance.revealReasoningByDefault, oldCopy = Appearance.autoCopyAnswer
        defer { Appearance.answerFontSize = oldSize; Appearance.stayExpanded = oldStay; Appearance.revealReasoningByDefault = oldReason; Appearance.autoCopyAnswer = oldCopy }
        let controller = MainSettingsWindowController(); controller.open(page: .general)
        defer { controller.close() }
        controller.show(page: .hotkeys)
        Appearance.answerFontSize = 19; Appearance.stayExpanded = !oldStay
        Appearance.revealReasoningByDefault = !oldReason; Appearance.autoCopyAnswer = !oldCopy
        controller.show(page: .general)
        let page = try XCTUnwrap(controller.qaVisiblePage)
        let controls = descendants(page)
        XCTAssertEqual(controls.compactMap { $0 as? NSSlider }.first?.doubleValue, 19)
        XCTAssertEqual(controls.compactMap { $0 as? SettingsToggleButton }.filter { ["settings.stayExpanded", "settings.revealReasoning"].contains($0.identifier?.rawValue ?? "") }.map { $0.state == .on }, [!oldStay, !oldReason])
    }

    @MainActor func testSettingsMatrixLongLabelsAndControlBounds() throws {
        let language = L10n.setting, mode = Settings.shared.serviceMode
        defer { L10n.setting = language; Settings.shared.serviceMode = mode }
        for lang in [AppLanguage.zhHans, .en, .ja] {
            L10n.setting = lang
            for theme in [NSAppearance.Name.aqua, .darkAqua] {
                let controller = MainSettingsWindowController()
                controller.window?.appearance = NSAppearance(named: theme)
                for pageID in MainSettingsWindowController.Page.allCases {
                    controller.open(page: pageID)
                    let page = try XCTUnwrap(controller.qaVisiblePage)
                    for view in descendants(page) where !view.isHiddenOrHasHiddenAncestor {
                        if let toggle = view as? SettingsToggleButton {
                            let width = (toggle.title as NSString).size(withAttributes: [.font: NSFont.systemFont(ofSize: 13, weight: .medium)]).width
                            XCTAssertLessThanOrEqual(width, toggle.bounds.width - 50, "\(lang)/\(pageID): \(toggle.title)")
                        }
                        if let button = view as? SettingsActionButton {
                            let width = (button.title as NSString).size(withAttributes: [.font: button.font ?? NSFont.systemFont(ofSize: 12, weight: .medium)]).width
                            XCTAssertLessThanOrEqual(width, button.bounds.width - 20, "\(lang)/\(pageID): \(button.title)")
                        }
                        if let text = view as? NSTextField, !text.isEditable, !(text.superview is NSTableCellView) {
                            let needed = text.cell?.cellSize(forBounds: NSRect(x: 0, y: 0, width: text.frame.width, height: 10000)).height ?? 0
                            XCTAssertLessThanOrEqual(needed, text.frame.height + 2, "\(lang)/\(pageID): \(text.stringValue)")
                        }
                    }
                    XCTAssertEqual(controller.qaVisiblePageCount, 1)
                }
                controller.close()
            }
        }
    }
}


extension SettingsNavigationAccessibilityTests {
    @MainActor func testProviderRebuildAndPageSwitchKeepFocusAttached() throws {
        let mode = Settings.shared.serviceMode, provider = Settings.shared.apiProvider
        defer { Settings.shared.serviceMode = mode; Settings.shared.apiProvider = provider }
        Settings.shared.serviceMode = ServiceMode.customKey
        let controller = MainSettingsWindowController(); controller.open(page: .advanced)
        defer { controller.close() }
        let page = try XCTUnwrap(controller.qaVisiblePage)
        let popup = try XCTUnwrap(descendants(page).compactMap { $0 as? NSPopUpButton }.first { $0.itemArray.contains { $0.representedObject as? String == provider } })
        controller.window?.makeFirstResponder(popup)
        popup.selectItem(at: (popup.indexOfSelectedItem + 1) % popup.numberOfItems)
        popup.sendAction(popup.action, to: popup.target)
        XCTAssertTrue(controller.window?.firstResponder === popup)
        XCTAssertNotNil(popup.window)
        for destination in MainSettingsWindowController.Page.allCases {
            controller.show(page: destination)
            let focused = try XCTUnwrap(controller.window?.firstResponder as? NSView)
            XCTAssertTrue(focused.window === controller.window)
            XCTAssertEqual(controller.qaVisiblePageCount, 1)
        }
    }
}

extension SettingsNavigationAccessibilityTests {
    @MainActor func testGeneralScrollSurvivesPageSwitchAndRevealsKeyboardFocus() throws {
        let controller = MainSettingsWindowController(); controller.open(page: .general)
        defer { controller.close() }
        let page = try XCTUnwrap(controller.qaVisiblePage)
        let scroll = try XCTUnwrap(descendants(page).compactMap { $0 as? NSScrollView }.first)
        let document = try XCTUnwrap(scroll.documentView)
        let language = try XCTUnwrap(descendants(page).first { $0.identifier?.rawValue == "settings.language" })
        controller.window?.makeFirstResponder(language)
        XCTAssertTrue(scroll.documentVisibleRect.contains(document.convert(language.bounds, from: language)))
        let offset = scroll.contentView.bounds.origin
        controller.show(page: .hotkeys); controller.show(page: .general)
        XCTAssertEqual(scroll.contentView.bounds.origin, offset)
        XCTAssertTrue(controller.qaVisiblePage === page)
        XCTAssertGreaterThan(offset.y, 0)
        for view in document.subviews { XCTAssertTrue(document.bounds.contains(view.frame), "Out of document: \(type(of: view))") }
    }
}
