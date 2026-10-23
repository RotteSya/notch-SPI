import XCTest
@testable import NotchSPI

@MainActor
final class SharedPersonalityCompletionTests: XCTestCase {
    func testSharedCompletionPolicies() throws {
        struct Scenario: Decodable {
            let id: String, raw: String, primary: String, mutation: String, status: String
            let transportOK: Bool, stale: Bool, scopeChanged: Bool
            let count: Int, summaries: [String]
        }
        let url = try XCTUnwrap(Bundle.module.url(forResource: "cases", withExtension: "json",
                                                subdirectory: "Fixtures/personality-completion"))
        let cases = try JSONDecoder().decode([Scenario].self, from: Data(contentsOf: url))
        XCTAssertFalse(cases.isEmpty)
        let scope = PersonalitySessionScope(personaID: "a", personaName: "Name", personaText: "Text",
                                            captureTargetID: "screen", channelID: "official")
        for scenario in cases {
            let session = PersonalitySession()
            let seed = session.begin(scope: scope)
            let item = PersonalityContextItem(ordinal: "1", summary: "seed", choice: "A")
            XCTAssertTrue(session.record(.init(last: item, referenceable: [item]), token: seed))
            let token = session.begin(scope: scope)
            let prompt = Prompts.capturePrompt(mode: "personality", depth: "guided", personaName: "Name",
                                               personaText: "Text", sessionContext: token.contextBlock)
            let run = PersonalityCaptureRun(token: token, prompt: prompt)
            run.append(scenario.raw, to: TutorModel())
            if scenario.stale { _ = session.begin(scope: scope) }
            let changed = PersonalitySessionScope(personaID: "b", personaName: "Name", personaText: "Text",
                                                  captureTargetID: "screen", channelID: "official")
            let result = run.complete(session: session, currentScope: scenario.scopeChanged ? changed : scope,
                                      transportOK: scenario.transportOK)
            XCTAssertEqual(result.primary.rawValue, scenario.primary, scenario.id)
            XCTAssertEqual(result.sessionMutation.rawValue, scenario.mutation, scenario.id)
            XCTAssertEqual(session.recordCount, scenario.count, scenario.id)
            let json = session.contextBlock().components(separatedBy: "\n")[1]
            let value = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any])
            let immediate = try XCTUnwrap(value["immediate_previous"] as? [String: Any])
            let older = try XCTUnwrap(value["older_referenceable"] as? [[String: Any]])
            XCTAssertEqual(immediate["status"] as? String, scenario.status, scenario.id)
            XCTAssertEqual(older.compactMap { $0["summary"] as? String }, scenario.summaries, scenario.id)
        }
    }
}
