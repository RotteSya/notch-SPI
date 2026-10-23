import XCTest
@testable import NotchSPI

final class SharedStreamTests: XCTestCase {
    func testSharedWireSequences() throws {
        struct Scenario: Decodable {
            let id: String, captureID: UUID, operation: String, bytes: String, content: String
            let complete: Bool, receipts: Int, serviceError: Bool
        }
        let url = try XCTUnwrap(Bundle.module.url(
            forResource: "cases", withExtension: "json", subdirectory: "Fixtures/official-stream"))
        let cases = try JSONDecoder().decode([Scenario].self, from: Data(contentsOf: url))
        XCTAssertFalse(cases.isEmpty)
        for scenario in cases {
            var decoder = OfficialStreamDecoder(captureID: scenario.captureID, screenQuery: true, operation: scenario.operation)
            var content = "", receipts = 0, complete = false, serviceError = false
            do {
                for byte in try XCTUnwrap(Data(base64Encoded: scenario.bytes)) {
                    if let event = try decoder.append(byte) {
                        switch event {
                        case .delta(let text): content += text
                        case .usage: receipts += 1
                        case .error: serviceError = true
                        case .done: break
                        }
                    }
                    if decoder.isDone { break }
                }
                _ = try decoder.finish()
                complete = true
            } catch {}
            XCTAssertEqual(complete, scenario.complete, scenario.id)
            XCTAssertEqual(receipts, scenario.receipts, scenario.id)
            XCTAssertEqual(content, scenario.content, scenario.id)
            XCTAssertEqual(serviceError, scenario.serviceError, scenario.id)
        }
    }
}
