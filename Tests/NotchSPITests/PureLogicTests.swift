import XCTest
@testable import NotchSPI

/// Unit tests for the app's pure, UI-free logic: GitHub-release version comparison and
/// system-prompt selection. These need no display, no AppKit windows, and no network.
final class UpdateCheckerVersionTests: XCTestCase {
    func testNormalizeStripsPrefixAndWhitespace() {
        XCTAssertEqual(UpdateChecker.normalize("v1.6"), "1.6")
        XCTAssertEqual(UpdateChecker.normalize(" V2.0 "), "2.0")
        XCTAssertEqual(UpdateChecker.normalize("1.5"), "1.5")
    }

    func testIsNewerIsNumericNotLexicographic() {
        XCTAssertTrue(UpdateChecker.isNewer("1.10", than: "1.9"))  // 10 > 9, not "1" vs "9"
        XCTAssertTrue(UpdateChecker.isNewer("2.0", than: "1.9"))
    }

    func testIsNewerTreatsMissingComponentsAsZero() {
        XCTAssertFalse(UpdateChecker.isNewer("1.5", than: "1.5.0"))
        XCTAssertTrue(UpdateChecker.isNewer("1.5.1", than: "1.5"))
    }

    func testIsNewerFalseForEqualOrOlder() {
        XCTAssertFalse(UpdateChecker.isNewer("1.6", than: "1.6"))
        XCTAssertFalse(UpdateChecker.isNewer("1.9", than: "1.10"))
    }
}

final class PromptsSelectionTests: XCTestCase {
    func testBriefDepthReturnsBriefPrompt() {
        XCTAssertEqual(Prompts.tutorText("brief"), Prompts.briefPrompt)
    }

    func testDepthClausesAreApplied() {
        XCTAssertTrue(Prompts.tutorText("full").contains("FULL WORKED SOLUTION"))
        XCTAssertTrue(Prompts.tutorText("hint").contains("HINTS ONLY"))
    }

    func testUnknownDepthFallsBackToGuided() {
        XCTAssertTrue(Prompts.tutorText("nonsense").contains("GUIDED WALKTHROUGH"))
    }

    func testSystemTextRoutesByMode() {
        let persona = Prompts.systemText(
            mode: "personality", depth: "guided",
            personaName: "A社", personaText: "creative and bold")
        XCTAssertTrue(persona.contains("creative and bold"))
        XCTAssertTrue(persona.contains("A社"))

        let tutor = Prompts.systemText(
            mode: "tutor", depth: "brief", personaName: "", personaText: "")
        XCTAssertEqual(tutor, Prompts.briefPrompt)
    }

    func testTaskInstructionDiffersByMode() {
        XCTAssertNotEqual(
            Prompts.taskInstruction(mode: "personality"),
            Prompts.taskInstruction(mode: "tutor"))
        XCTAssertTrue(Prompts.taskInstruction(mode: "tutor").contains("tutor"))
    }
}
