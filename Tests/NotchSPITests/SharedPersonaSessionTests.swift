import XCTest
@testable import NotchSPI

@MainActor
final class SharedPersonaSessionTests: XCTestCase {
    func testSharedSessionTimelines() throws {
        struct Step: Decodable {
            let action: String
            let time: Double?, scope: String?, valid: Bool?, status: String?
            let sequence: Int?, older: [Int]?, tokenIndex: Int?
        }
        struct Scenario: Decodable { let id: String; let steps: [Step] }
        let url = try XCTUnwrap(Bundle.module.url(
            forResource: "cases", withExtension: "json", subdirectory: "Fixtures/persona-session"))
        let cases = try JSONDecoder().decode([Scenario].self, from: Data(contentsOf: url))
        XCTAssertFalse(cases.isEmpty)
        let item = PersonalityContextItem(ordinal: "1", summary: "scene", choice: "A")
        for scenario in cases {
            var time = Date(timeIntervalSince1970: 0)
            let session = PersonalitySession(now: { time })
            var token: PersonalitySessionToken?
            var tokens: [PersonalitySessionToken] = []
            for step in scenario.steps {
                if let milliseconds = step.time { time = Date(timeIntervalSince1970: milliseconds / 1000) }
                switch step.action {
                case "begin":
                    token = session.begin(scope: .init(personaID: try XCTUnwrap(step.scope), personaName: "Name",
                        personaText: "Text", captureTargetID: "screen", channelID: "official"))
                    tokens.append(try XCTUnwrap(token))
                case "finish":
                    let current = try XCTUnwrap(step.tokenIndex.map { tokens[$0] } ?? token)
                    if step.valid == true {
                        let recorded = session.record(.init(last: item, referenceable: [item]), token: current)
                        if step.tokenIndex == nil { XCTAssertTrue(recorded, scenario.id) }
                    } else { session.markPreviousUnavailable(token: current) }
                case "reset": session.reset(reason: .manual)
                case "check":
                    let line = session.contextBlock().components(separatedBy: "\n")[1]
                    let value = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any])
                    let immediate = try XCTUnwrap(value["immediate_previous"] as? [String: Any])
                    let older = try XCTUnwrap(value["older_referenceable"] as? [[String: Any]])
                    XCTAssertEqual(immediate["status"] as? String, step.status, scenario.id)
                    XCTAssertEqual(immediate["capture_sequence"] as? Int, step.sequence, scenario.id)
                    XCTAssertEqual(older.compactMap { $0["capture_sequence"] as? Int }, step.older, scenario.id)
                default: XCTFail("Unknown action: \(step.action)")
                }
            }
        }
    }
}
