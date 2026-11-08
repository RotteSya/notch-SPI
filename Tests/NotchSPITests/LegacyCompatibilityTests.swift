import AppKit
import XCTest
@testable import NotchSPI
@testable import BotAvatarsKit

final class LegacyCompatibilityTests: XCTestCase {
    private final class TickTarget: NSObject {
        var ticks = 0
        @objc func tick() { ticks += 1 }
    }

    @MainActor func testLegacyAnimationTimerPausesAndInvalidates() async throws {
        let target = TickTarget()
        let link = CompatibleDisplayLink(view: NSView(), target: target,
            selector: #selector(TickTarget.tick), prefersNative: false)
        defer { link.invalidate() }
        link.add(to: .main, forMode: .common)
        try await Task.sleep(nanoseconds: 150_000_000)
        XCTAssertGreaterThan(target.ticks, 0)
        link.isPaused = true
        let pausedCount = target.ticks
        try await Task.sleep(nanoseconds: 80_000_000)
        XCTAssertEqual(target.ticks, pausedCount)
        link.isPaused = false
        try await Task.sleep(nanoseconds: 80_000_000)
        XCTAssertGreaterThan(target.ticks, pausedCount)
        link.invalidate()
        let stoppedCount = target.ticks
        link.isPaused = false
        try await Task.sleep(nanoseconds: 80_000_000)
        XCTAssertEqual(target.ticks, stoppedCount)
    }

    func testLegacyAvatarColorParsingKeepsAllSupportedFormats() {
        for input in ["#f00", "#FF0000", "rgb(255, 0, 0)", "rgba(255, 0, 0, 1)", "hsl(0, 100%, 50%)"] {
            let color = parseColor(input)
            XCTAssertEqual(color?.0, 255, input)
            XCTAssertEqual(color?.1, 0, input)
            XCTAssertEqual(color?.2, 0, input)
        }
        XCTAssertNil(parseColor("invalid"))
    }

    func testLegacyCaptureExcludesEveryOwnWindowAndExplicitPanel() {
        let windows: [NSDictionary] = [
            [kCGWindowNumber: UInt32(10), kCGWindowOwnerPID: Int32(42)],
            [kCGWindowNumber: UInt32(11), kCGWindowOwnerPID: Int32(42)],
            [kCGWindowNumber: UInt32(12), kCGWindowOwnerPID: Int32(90)],
            [kCGWindowNumber: UInt32(13), kCGWindowOwnerPID: Int32(91)],
            [kCGWindowNumber: UInt32(14)],
            [kCGWindowOwnerPID: Int32(92)]
        ]
        XCTAssertEqual(ScreenCapture.legacyWindowIDs(windows, ownPID: 42, excludingWindowID: 12), [13])
        XCTAssertEqual(ScreenCapture.legacyWindowIDs(windows, ownPID: 42, excludingWindowID: nil), [12, 13])
        XCTAssertEqual(ScreenCapture.legacyWindowIDs([], ownPID: 42, excludingWindowID: nil), [])
    }

    func testIntelUsesItsOwnUpdateChannel() {
        #if arch(x86_64)
        XCTAssertTrue(UpdateChecker.supportsCurrentUpdateChannel)
        XCTAssertTrue(UpdateChecker.downloadURL.path.hasSuffix("/dl/intel"))
        #else
        if #available(macOS 14.0, *) { XCTAssertTrue(UpdateChecker.supportsCurrentUpdateChannel) }
        XCTAssertTrue(UpdateChecker.downloadURL.path.hasSuffix("/dl"))
        #endif
    }
}
