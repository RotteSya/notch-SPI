import XCTest
@testable import NotchSPI

final class SharedPersonalityParserTests: XCTestCase {
    func testSharedCompositionFixtures() throws {
        struct Scenario: Decodable {
            let id: String, raw: String, streaming: Bool
            let expected: PersonalityAnswerComposition
        }
        let url = try XCTUnwrap(Bundle.module.url(forResource: "cases", withExtension: "json",
                                                subdirectory: "Fixtures/personality-parser"))
        let cases = try JSONDecoder().decode([Scenario].self, from: Data(contentsOf: url))
        XCTAssertFalse(cases.isEmpty)
        for scenario in cases {
            XCTAssertEqual(PersonalityAnswer.compose(raw: scenario.raw, streaming: scenario.streaming),
                           scenario.expected, scenario.id)
        }
    }
}
