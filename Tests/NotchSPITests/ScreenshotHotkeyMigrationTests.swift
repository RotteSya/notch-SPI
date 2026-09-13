import XCTest
import Carbon.HIToolbox
@testable import NotchSPI

final class ScreenshotHotkeyMigrationTests: XCTestCase {
    private func isolated(_ body: (Settings) -> Void) {
        let suite = "ScreenshotHotkeysTests." + UUID().uuidString
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        body(Settings(defaults: defaults))
    }

    func testDefaultsAreOneTwoNineWithCommandShift() {
        isolated { settings in
            settings.migrateScreenshotHotkeys()
            XCTAssertEqual(settings.captureCombo.keyCode, UInt32(kVK_ANSI_1))
            XCTAssertEqual(settings.contextCombo.keyCode, UInt32(kVK_ANSI_2))
            XCTAssertEqual(settings.personalityCombo.keyCode, UInt32(kVK_ANSI_9))
            for combo in [settings.captureCombo, settings.contextCombo, settings.personalityCombo] {
                XCTAssertEqual(combo.modifiers, UInt32(cmdKey | shiftKey))
            }
        }
    }

    func testOldPersonalityOnTwoMovesToNineAndConflictingToggleMovesToSpace() {
        isolated { settings in
            settings.personalityCombo = settings.contextCombo
            settings.toggleCombo = settings.captureCombo
            settings.migrateScreenshotHotkeys()
            XCTAssertEqual(settings.personalityCombo.keyCode, UInt32(kVK_ANSI_9))
            XCTAssertEqual(settings.contextCombo.keyCode, UInt32(kVK_ANSI_2))
            XCTAssertEqual(settings.toggleCombo.keyCode, UInt32(kVK_Space))
        }
    }

    func testNonconflictingCustomBindingSurvivesAndMigrationOnlyRunsOnce() {
        isolated { settings in
            let custom = HotkeyCombo(keyCode: UInt32(kVK_F15), modifiers: UInt32(controlKey), label: "F15")
            settings.contextCombo = custom
            settings.migrateScreenshotHotkeys()
            XCTAssertEqual(settings.contextCombo, custom)
            settings.personalityCombo = settings.captureCombo
            settings.migrateScreenshotHotkeys()
            XCTAssertEqual(settings.personalityCombo, settings.captureCombo)
        }
    }
}
