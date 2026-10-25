import XCTest
@testable import NotchSPI

final class ObservationJournalParityTests: XCTestCase {
    func testSharedDesktopObservationScenarios() throws {
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("desktop/test/fixtures/observation-journal.json")
        let cases = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [[String: Any]]
        for scenario in cases {
            var now = Date(timeIntervalSince1970: 1_800_000_000)
            var journal = ObservationJournal(sharingEnabled: true, now: now)
            var proof: ObservationCoverage?
            for step in scenario["steps"] as! [[String: Any]] {
                now.addTimeInterval(1)
                switch step["op"] as! String {
                case "append":
                    for _ in 0..<(step["count"] as! Int) {
                        let capture = step["capture"] as? Bool ?? false
                        let event = ProductTelemetryEvent(eventID: UUID(), captureID: capture ? UUID() : nil,
                            occurredAt: now.addingTimeInterval(step["offset"] as? Double ?? 0),
                            eventName: capture ? "capture_started" : "answer_action")
                        journal.append(event, now: now)
                    }
                case "ackEvents": journal.acknowledgeEvents(journal.queue, rejected: step["rejected"] as? Int ?? 0)
                case "prepare":
                    let next = journal.prepareCoverage(now: now)
                    if let old = proof, let next { XCTAssertEqual(old.observationID, next.observationID) }
                    proof = next
                    XCTAssertEqual(proof?.coverageStatus, step["status"] as? String, scenario["name"] as! String)
                    if let reason = step["reason"] as? String { XCTAssertEqual(proof?.gapReason, reason) }
                    if let from = step["from"] as? Int { XCTAssertEqual(proof?.sequenceFrom, from) }
                    if let to = step["to"] as? Int { XCTAssertEqual(proof?.sequenceTo, to) }
                    if let drops = step["drops"] as? Int { XCTAssertEqual(proof?.queueDropCount, drops) }
                case "ackCoverage": journal.acknowledgeCoverage(try XCTUnwrap(proof)); proof = nil
                case "gap": journal.gap(step["reason"] as! String)
                case "shutdown": journal.prepareShutdown()
                case "resume":
                    journal = try JSONDecoder().decode(ObservationJournal.self, from: JSONEncoder().encode(journal))
                    journal.resume(now: now)
                case "optOut":
                    journal.setSharing(false, now: now); proof = nil
                    XCTAssertTrue(journal.openCaptures.isEmpty); XCTAssertTrue(journal.queue.isEmpty)
                default: XCTFail("Unknown fixture")
                }
            }
        }
    }
}
