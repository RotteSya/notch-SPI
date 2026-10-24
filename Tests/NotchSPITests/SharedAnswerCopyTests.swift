import XCTest
@testable import NotchSPI

final class SharedAnswerCopyTests: XCTestCase {
    func testSharedCopyEligibility() throws {
        struct Input: Decodable {
            let mode: String, resultState: String?
            let busy: Bool, hasAnswer: Bool, automatic: Bool, autoCopyEnabled: Bool
        }
        struct Scenario: Decodable { let id: String, input: Input, allowed: Bool }
        let url = try XCTUnwrap(Bundle.module.url(forResource: "cases", withExtension: "json",
                                                subdirectory: "Fixtures/answer-copy"))
        let cases = try JSONDecoder().decode([Scenario].self, from: Data(contentsOf: url))
        XCTAssertFalse(cases.isEmpty)
        for scenario in cases {
            let input = scenario.input
            XCTAssertEqual(SharedVisual.canCopyAnswer(mode: input.mode, busy: input.busy,
                resultState: input.resultState, hasAnswer: input.hasAnswer, automatic: input.automatic,
                autoCopyEnabled: input.autoCopyEnabled), scenario.allowed, scenario.id)
        }
    }
}
