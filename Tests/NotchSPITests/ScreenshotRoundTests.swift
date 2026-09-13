import XCTest
@testable import NotchSPI

final class ScreenshotRoundTests: XCTestCase {
    private func add(_ value: Int, at now: Double, to round: inout ScreenshotRound<Int>) throws {
        let token = try XCTUnwrap(round.beginCapture(now: now))
        XCTAssertTrue(round.finishCapture(token: token, item: value, now: now))
    }

    func testOneImageWaitsIndefinitelyThenSecondStartsFourSeconds() throws {
        var round = ScreenshotRound<Int>()
        try add(1, at: 0, to: &round)
        XCTAssertNil(round.deadline)
        XCTAssertNil(round.takeDue(now: 86_400))
        try add(2, at: 86_400, to: &round)
        XCTAssertNil(round.takeDue(now: 86_403.999))
        XCTAssertEqual(round.takeDue(now: 86_404), [1, 2])
        XCTAssertNil(round.takeDue(now: 86_405))
        XCTAssertFalse(round.isActive)
    }

    func testThirdAndFourthResetFromSuccessfulIntakeNotCaptureStart() throws {
        var round = ScreenshotRound<Int>()
        try add(1, at: 0, to: &round); try add(2, at: 1, to: &round)
        let third = try XCTUnwrap(round.beginCapture(now: 4))
        XCTAssertNil(round.takeDue(now: 100))
        XCTAssertTrue(round.finishCapture(token: third, item: 3, now: 100))
        XCTAssertEqual(round.deadline, 104)
        try add(4, at: 103.9, to: &round)
        XCTAssertEqual(round.deadline, 107.9)
        XCTAssertNil(round.beginCapture(now: 104)) // Service limit does not corrupt the deadline.
        XCTAssertEqual(round.takeDue(now: 108), [1, 2, 3, 4])
    }

    func testCanceledOrFailedCaptureResumesExactRemainingTime() throws {
        var round = ScreenshotRound<Int>()
        try add(1, at: 0, to: &round); try add(2, at: 1, to: &round)
        let token = try XCTUnwrap(round.beginCapture(now: 3.25))
        XCTAssertEqual(round.remaining(now: 30), 1.75)
        XCTAssertNil(round.takeDue(now: 30))
        XCTAssertTrue(round.finishCapture(token: token, item: nil, now: 40))
        XCTAssertEqual(round.deadline, 41.75)
        XCTAssertNil(round.takeDue(now: 41.749))
        XCTAssertEqual(round.takeDue(now: 41.75), [1, 2])
    }

    func testCanceledFirstAndSecondCapturesNeverStartCountdown() throws {
        var round = ScreenshotRound<Int>()
        let first = try XCTUnwrap(round.beginCapture(now: 0))
        round.finishCapture(token: first, item: nil, now: 10)
        XCTAssertFalse(round.isActive)
        try add(1, at: 20, to: &round)
        let second = try XCTUnwrap(round.beginCapture(now: 30))
        round.finishCapture(token: second, item: nil, now: 40)
        XCTAssertNil(round.deadline)
        XCTAssertNil(round.takeDue(now: 1000))
        XCTAssertEqual(round.items, [1])
    }

    func testRapidPressesAndDuplicateCallbacksCannotReorderOrDuplicateImages() throws {
        var round = ScreenshotRound<Int>()
        let token = try XCTUnwrap(round.beginCapture(now: 0))
        XCTAssertNil(round.beginCapture(now: 0.01))
        round.finishCapture(token: token, item: 1, now: 0.02)
        XCTAssertFalse(round.finishCapture(token: token, item: 999, now: 0.03))
        try add(2, at: 0.04, to: &round)
        XCTAssertEqual(round.takeDue(now: 4.04), [1, 2])
        try add(3, at: 4.05, to: &round)
        XCTAssertEqual(round.items, [3])
        XCTAssertNil(round.takeDue(now: 100))
    }

    func testCancelInvalidatesPendingDeadlineAndLateCapture() throws {
        var round = ScreenshotRound<Int>()
        try add(1, at: 0, to: &round); try add(2, at: 1, to: &round)
        let oldID = round.id
        let token = try XCTUnwrap(round.beginCapture(now: 2))
        round.cancel()
        XCTAssertNotEqual(round.id, oldID)
        XCTAssertNil(round.deadline); XCTAssertNil(round.pausedRemaining)
        XCTAssertNil(round.takeDue(now: 100))
        try add(3, at: 101, to: &round)
        XCTAssertFalse(round.finishCapture(token: token, item: 999, now: 102))
        XCTAssertEqual(round.items, [3])
        XCTAssertNil(round.deadline)
    }

    func testCaptureAtDeadlinePausesBeforeTimerCanClaimBatch() throws {
        var round = ScreenshotRound<Int>()
        try add(1, at: 0, to: &round); try add(2, at: 0, to: &round)
        let token = try XCTUnwrap(round.beginCapture(now: 4))
        XCTAssertNil(round.takeDue(now: 4))
        round.finishCapture(token: token, item: nil, now: 10)
        XCTAssertEqual(round.takeDue(now: 10), [1, 2])
    }
}
