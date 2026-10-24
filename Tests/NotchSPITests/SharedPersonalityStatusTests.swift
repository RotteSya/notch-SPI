import XCTest
@testable import NotchSPI

final class SharedPersonalityStatusTests: XCTestCase {
    func testSharedCompletionTextAndSuffixes() throws {
        struct Scenario: Decodable {
            let id: String, primary: PersonalityCompletionPrimary, language: String, text: String
            let contextWasCleared: Bool, questionsRemaining: Int?, quotaRunningLow: Bool, copied: Bool
        }
        let url = try XCTUnwrap(Bundle.module.url(forResource: "cases", withExtension: "json",
                                                subdirectory: "Fixtures/personality-status"))
        let cases = try JSONDecoder().decode([Scenario].self, from: Data(contentsOf: url))
        XCTAssertFalse(cases.isEmpty)
        for scenario in cases {
            let outcome = PersonalityCompletionOutcome(primary: scenario.primary,
                composition: PersonalityAnswer.compose(raw: "1. A", streaming: false), sessionMutation: .none)
            let suffixes = PersonalityCompletionSuffixes(contextWasCleared: scenario.contextWasCleared,
                questionsRemaining: scenario.questionsRemaining, quotaRunningLow: scenario.quotaRunningLow,
                copied: scenario.copied)
            XCTAssertEqual(outcome.statusText(suffixes: suffixes, language: scenario.language), scenario.text, scenario.id)
        }
        XCTAssertEqual(OfficialAPI.lowQuotaThreshold, Int(SharedVisual.number("personalityLowQuotaThreshold")))
    }
}
