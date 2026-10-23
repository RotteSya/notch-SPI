import XCTest
@testable import NotchSPI

final class SharedProductTests: XCTestCase {
    func testSharedCountdownDrivesRealMacIntake() throws {
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let data = try Data(contentsOf: root.appendingPathComponent("shared/product.json"))
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let capture = try XCTUnwrap(json["capture"] as? [String: Any])
        let delay = try XCTUnwrap(capture["submitDelay"] as? Double)
        var round = ScreenshotRound<String>()
        let first = try XCTUnwrap(round.beginCapture(now: 0))
        round.finishCapture(token: first, item: "first", now: 0)
        XCTAssertNil(round.deadline)
        let second = try XCTUnwrap(round.beginCapture(now: 1))
        round.finishCapture(token: second, item: "second", now: 1)
        XCTAssertEqual(round.deadline, 1 + delay)
        XCTAssertNil(round.takeDue(now: delay))
        XCTAssertEqual(round.takeDue(now: 1 + delay), ["first", "second"])
        XCTAssertEqual(Settings.reasoningEffortCycle, json["reasoningEfforts"] as? [String])
    }
}
