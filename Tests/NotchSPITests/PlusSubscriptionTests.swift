import XCTest
@testable import NotchSPI

final class PlusSubscriptionTests: XCTestCase {
    private func payload(_ changes: [String: Any] = [:]) throws -> Data {
        var object: [String: Any] = ["available": true, "status": "active", "billing_status": "active", "price_cents": 6900,
            "currency": "CNY", "daily_limit": 400, "paid_until": "2026-11-17T12:00:00.000Z", "cancel_at_period_end": false,
            "daily_used": 10, "daily_held": 1, "daily_remaining": 389, "resets_at": "2026-10-17T16:00:00.000Z",
            "can_manage": true, "sync_failed": false, "server_time": "2026-10-17T12:00:00.000Z"]
        for (key, value) in changes { object[key] = value }
        return try JSONSerialization.data(withJSONObject: object)
    }
    func testSignedInAccountPresentationRejectsInvalidQuotaOrPrice() throws {
        let value = try OfficialAPI.plusSnapshot(payload())
        XCTAssertEqual(value.dailyRemaining, 389)
        XCTAssertNotNil(value.expirationLabel)
        XCTAssertThrowsError(try OfficialAPI.plusSnapshot(payload(["daily_remaining": 400])))
        XCTAssertThrowsError(try OfficialAPI.plusSnapshot(payload(["price_cents": 1])))
        XCTAssertThrowsError(try OfficialAPI.plusSnapshot(payload(["daily_limit": 600])))
        XCTAssertThrowsError(try OfficialAPI.plusSnapshot(payload(["daily_used": -1])))
    }
    func testSubscriptionDatesRejectMalformedValuesAndAcceptWholeSeconds() throws {
        for key in ["paid_until", "resets_at", "server_time"] {
            XCTAssertThrowsError(try OfficialAPI.plusSnapshot(payload([key: "not-a-date"])))
        }
        let value = try OfficialAPI.plusSnapshot(payload(["paid_until": "2026-11-17T12:00:00Z"]))
        XCTAssertNotNil(value.expirationLabel)
    }
    func testCancelAtPeriodEndDoesNotHidePaidEntitlement() throws {
        let value = try OfficialAPI.plusSnapshot(payload(["cancel_at_period_end": true]))
        XCTAssertEqual(value.status, "active")
        XCTAssertTrue(value.cancelAtPeriodEnd)
        XCTAssertEqual(value.dailyRemaining, 389)
    }
    func testCheckoutAndPortalDestinationsRejectUnexpectedHostsAndCredentials() throws {
        for address in ["https://checkout.stripe.com/pay", "https://billing.stripe.com/session"] {
            let data = try JSONSerialization.data(withJSONObject: ["url": address])
            XCTAssertEqual(try OfficialAPI.plusDestination(data).absoluteString, address)
        }
        for address in ["http://checkout.stripe.com/pay", "https://checkout.stripe.com.evil.test/pay", "https://user@checkout.stripe.com/pay", "file:///tmp/billing"] {
            let data = try JSONSerialization.data(withJSONObject: ["url": address])
            XCTAssertThrowsError(try OfficialAPI.plusDestination(data))
        }
    }
}

import AppKit
extension PlusSubscriptionTests {
    @MainActor func testPlusPageFitsThreeLanguagesAndBothAppearances() throws {
        let saved = L10n.setting
        defer { L10n.setting = saved }
        for language in [AppLanguage.zhHans, .ja, .en] {
            L10n.setting = language
            for dark in [false, true] {
                for state in ["active", "inactive", "pending", "expired", "canceled-renewal", "unavailable"] {
                    let active = state == "active" || state == "canceled-renewal"
                    let page = PlusSubscriptionPage()
                    page.qaSnapshot = try OfficialAPI.plusSnapshot(payload(active ? ["cancel_at_period_end": state == "canceled-renewal"] : ["status": state == "unavailable" ? "inactive" : state, "available": state != "unavailable", "daily_used": 0, "daily_held": 0, "daily_remaining": 0, "can_manage": false]))
                    let content = page.view
                    content.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
                    let window = NSWindow(contentRect: content.bounds, styleMask: [.titled], backing: .buffered, defer: false)
                    window.isReleasedWhenClosed = false
                    window.contentView = content
                    content.layoutSubtreeIfNeeded()
                    for subview in content.subviews {
                        XCTAssertTrue(content.bounds.contains(subview.frame), "\(language): \(subview.frame)")
                        if let field = subview as? NSTextField, let cell = field.cell {
                            let needed = cell.cellSize(forBounds: NSRect(x: 0, y: 0, width: field.frame.width, height: 10000))
                            XCTAssertLessThanOrEqual(needed.height, field.frame.height + 2, "\(language): \(field.stringValue)")
                        }
                    }
                    window.close()
                }
            }
        }
    }
}


extension PlusSubscriptionTests {
    @MainActor func testPlanStateReflowsWithoutOverlappingVisibleControls() throws {
        let page = PlusSubscriptionPage()
        page.qaSnapshot = try OfficialAPI.plusSnapshot(payload())
        _ = page.view
        let activeHeight = page.preferredHeight
        var heights: [CGFloat] = []
        page.onHeightChange = { heights.append($0) }
        page.qaSnapshot = try OfficialAPI.plusSnapshot(payload(["status": "inactive", "can_manage": false]))
        page.refreshUsage()
        XCTAssertLessThan(page.preferredHeight, activeHeight)
        XCTAssertEqual(heights.last, page.preferredHeight)
        let visible = page.view.subviews.filter { !$0.isHidden }
        for (index, first) in visible.enumerated() {
            for second in visible.dropFirst(index + 1) {
                XCTAssertFalse(first.frame.intersects(second.frame), "Overlapping plan controls: \(first) and \(second)")
            }
        }
        page.qaSnapshot = try OfficialAPI.plusSnapshot(payload())
        page.refreshUsage()
        XCTAssertEqual(page.preferredHeight, activeHeight)
        XCTAssertEqual(heights.count, 2)
    }
}


extension PlusSubscriptionTests {
    @MainActor func testAccountCardsReflowAcrossRepeatedPlanStatesAndMessages() throws {
        let saved = L10n.setting
        defer { L10n.setting = saved }
        for language in [AppLanguage.zhHans, .ja, .en] {
            L10n.setting = language
            for theme in [NSAppearance.Name.aqua, .darkAqua] {
                let controller = MainSettingsWindowController()
                controller.open(page: .account)
                controller.window?.appearance = NSAppearance(named: theme)
                defer { controller.close() }
                let page = try XCTUnwrap(controller.qaSubscriptionPage)
                let document = try XCTUnwrap(page.view.superview)
                let cards = document.subviews.compactMap { $0 as? SettingsCardView }.sorted { $0.frame.minY < $1.frame.minY }
                XCTAssertEqual(cards.count, 4)
                let sectionGap = cards[2].frame.minY - cards[1].frame.maxY
                let recoveryGap = cards[3].frame.minY - cards[2].frame.maxY
                var initialHeight: CGFloat?
                for state in ["inactive", "active", "pending", "past_due", "canceled-renewal", "expired", "active", "inactive"] {
                    let active = ["active", "past_due", "canceled-renewal"].contains(state)
                    page.qaSnapshot = try OfficialAPI.plusSnapshot(payload([
                        "status": active ? "active" : state,
                        "billing_status": state == "past_due" ? "past_due" : active ? "active" : "canceled",
                        "can_manage": active, "cancel_at_period_end": state == "canceled-renewal"
                    ]))
                    page.qaSetMessage(state == "past_due" ? String(repeating: "Payment update required. ", count: 3) : "")
                    page.refreshUsage()
                    XCTAssertEqual(cards[1].frame.maxY, page.view.frame.maxY, accuracy: 0.1)
                    XCTAssertEqual(cards[2].frame.minY - cards[1].frame.maxY, sectionGap, accuracy: 0.1)
                    XCTAssertEqual(cards[3].frame.minY - cards[2].frame.maxY, recoveryGap, accuracy: 0.1)
                    XCTAssertGreaterThanOrEqual(sectionGap, 24)
                    XCTAssertTrue(document.bounds.contains(cards[3].frame))
                    for child in page.view.subviews where !child.isHidden {
                        XCTAssertTrue(page.view.bounds.contains(child.frame))
                    }
                    if state == "inactive" {
                        if let initialHeight { XCTAssertEqual(document.frame.height, initialHeight, accuracy: 0.1) }
                        else { initialHeight = document.frame.height }
                    }
                }
            }
        }
    }

    @MainActor func testFocusedPlanActionMovesWhenAccountStateHidesIt() throws {
        let page = PlusSubscriptionPage()
        page.qaSnapshot = try OfficialAPI.plusSnapshot(payload(["status": "inactive", "can_manage": false]))
        let window = NSWindow(contentRect: page.view.bounds, styleMask: [.titled], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false; window.contentView = page.view
        defer { window.close() }
        let buy = try XCTUnwrap(page.view.subviews.compactMap { $0 as? NSButton }.first { !$0.isHidden && $0.isEnabled && ($0 as? SettingsActionButton)?.prominent == true })
        window.makeFirstResponder(buy)
        page.qaSnapshot = try OfficialAPI.plusSnapshot(payload())
        page.refreshUsage()
        XCTAssertTrue(buy.isHidden)
        let focused = try XCTUnwrap(window.firstResponder as? NSControl)
        XCTAssertFalse(focused.isHiddenOrHasHiddenAncestor)
        XCTAssertTrue(focused.isEnabled)
        XCTAssertTrue(focused.isDescendant(of: page.view))
        let cancel = try XCTUnwrap(page.view.subviews.compactMap { $0 as? NSButton }.first { $0.title == L10n.t("取消自动续费", "自動更新を停止", "Cancel renewal") })
        window.makeFirstResponder(cancel)
        page.qaSnapshot = try OfficialAPI.plusSnapshot(payload(["cancel_at_period_end": true]))
        page.refreshUsage()
        XCTAssertTrue(cancel.isHidden)
        let afterCancel = try XCTUnwrap(window.firstResponder as? NSControl)
        XCTAssertFalse(afterCancel.isHiddenOrHasHiddenAncestor)
        XCTAssertTrue(afterCancel.isEnabled)
    }
}
