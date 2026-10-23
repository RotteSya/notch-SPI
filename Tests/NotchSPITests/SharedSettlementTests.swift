import XCTest
@testable import NotchSPI

final class SharedSettlementTests: XCTestCase {
    func testSharedTerminalSnapshots() throws {
        let url = try XCTUnwrap(Bundle.module.url(
            forResource: "cases", withExtension: "json", subdirectory: "Fixtures/settlement"))
        let cases = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [[String: Any]])
        XCTAssertFalse(cases.isEmpty)
        for scenario in cases {
            let id = try XCTUnwrap(scenario["id"] as? String)
            let expected = try XCTUnwrap(scenario["valid"] as? Bool)
            let data = try JSONSerialization.data(withJSONObject: XCTUnwrap(scenario["snapshot"]))
            let snapshot = try? JSONDecoder().decode(SettlementSnapshot.self, from: data)
            XCTAssertEqual(snapshot?.isTerminal ?? false, expected, id)
        }
    }
}
