import XCTest
@testable import NotchSPI

final class SharedFreeTrialTests: XCTestCase {
    func testSharedTrialSnapshots() throws {
        let url = try XCTUnwrap(Bundle.module.url(forResource: "cases", withExtension: "json", subdirectory: "Fixtures/free-trial"))
        let cases = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [[String: Any]])
        XCTAssertFalse(cases.isEmpty)
        for scenario in cases {
            let id = try XCTUnwrap(scenario["id"] as? String)
            let valid = try XCTUnwrap(scenario["valid"] as? Bool)
            let data = try JSONSerialization.data(withJSONObject: XCTUnwrap(scenario["snapshot"]))
            let value = try? JSONDecoder().decode(FreeTrialSnapshot.self, from: data)
            XCTAssertEqual(value?.isValid ?? false, valid, id)
        }
    }
}
