import XCTest
@testable import NotchSPI

final class MonthPassTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_792_000_000)

    func testSubscriptionExpiresExactlyAtEndOfPeriod() {
        let pass = MonthPassSnapshot(activatedAt: now.addingTimeInterval(-30 * 86_400), expiresAt: now)
        XCTAssertEqual(pass.state(at: now), .expired)
        XCTAssertEqual(pass.state(at: now.addingTimeInterval(-1)), .active)
    }

    func testPreviewStatesReflectSubscriptionDatesOnly() {
        XCTAssertEqual(MonthPassPreview.fixture(0, now: now).state(at: now), .active)
        XCTAssertEqual(MonthPassPreview.fixture(1, now: now).state(at: now), .inactive)
        XCTAssertEqual(MonthPassPreview.fixture(2, now: now).state(at: now), .expired)
    }

    func testFutureOrMissingActivationIsNeverShownAsActive() {
        let future = MonthPassSnapshot(activatedAt: now.addingTimeInterval(1), expiresAt: now.addingTimeInterval(86_400))
        XCTAssertEqual(future.state(at: now), .inactive)
        XCTAssertEqual(MonthPassSnapshot(activatedAt: now, expiresAt: nil).state(at: now), .inactive)
        XCTAssertFalse(MonthPassPreview.isEnabled)
    }
}

extension MonthPassTests {
    func testReminderAndLimitBoundariesPreserveActiveSubscription() {
        let now = ISO8601DateFormatter().date(from: "2026-10-13T15:59:59Z")!
        for (used, status) in [(359, MonthPassSnapshot.DailyStatus.normal), (360, .nearLimit), (399, .nearLimit), (400, .exhausted), (401, .exhausted)] {
            let pass = MonthPassSnapshot(activatedAt: now, expiresAt: now.addingTimeInterval(86400), dailySolvesUsed: used, usageRecordedAt: now)
            XCTAssertEqual(pass.dailyStatus(at: now), status)
            XCTAssertEqual(pass.state(at: now), .active)
            XCTAssertEqual(pass.dailyNotice(at: now) == nil, used < 360)
            XCTAssertEqual(pass.nextReset(at: now), now.addingTimeInterval(1))
            XCTAssertEqual(pass.usedToday(at: now.addingTimeInterval(1)), 0)
            XCTAssertEqual(pass.dailyStatus(at: now.addingTimeInterval(1)), .normal)
            XCTAssertNil(pass.dailyNotice(at: now.addingTimeInterval(1)))
        }
    }

    func testExpirySuppressesDailyWarning() {
        let now = Date()
        let pass = MonthPassSnapshot(activatedAt: now.addingTimeInterval(-86400), expiresAt: now, dailySolvesUsed: 400, usageRecordedAt: now)
        XCTAssertEqual(pass.state(at: now), .expired)
        XCTAssertNil(pass.dailyNotice(at: now))
    }
}
