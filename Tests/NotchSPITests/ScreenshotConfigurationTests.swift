import XCTest
import ScreenCaptureKit
@testable import NotchSPI

final class ScreenshotConfigurationTests: XCTestCase {
    func testScreenshotKeepsDimensionsCursorAndSubwindowPolicyWithoutWritingEarly() throws {
        #if compiler(>=6.2)
        guard #available(macOS 26.0, *) else { throw XCTSkip("Dedicated screenshot API requires macOS 26") }
        let stream = SCStreamConfiguration()
        stream.width = 1568; stream.height = 1066
        for include in [false, true] {
            stream.includeChildWindows = include; stream.showsCursor = include
            let screenshot = ScreenCapture.screenshotConfiguration(from: stream, style: .window)
            XCTAssertEqual(screenshot.width, 1568); XCTAssertEqual(screenshot.height, 1066)
            XCTAssertEqual(screenshot.showsCursor, include)
            XCTAssertEqual(screenshot.includeChildWindows, include)
            XCTAssertEqual(screenshot.dynamicRange, .sdr)
            XCTAssertEqual(screenshot.displayIntent, .local)
            XCTAssertNil(screenshot.fileURL, "Cancelled or late captures must never create a system-owned file")
        }
        #else
        throw XCTSkip("Dedicated screenshot API requires the Xcode 26 SDK")
        #endif
    }

    func testWindowAndDisplayShadowAndClippingPoliciesRemainIndependent() throws {
        #if compiler(>=6.2)
        guard #available(macOS 26.0, *) else { throw XCTSkip("Dedicated screenshot API requires macOS 26") }
        let stream = SCStreamConfiguration()
        for window in [false, true] {
            stream.ignoreShadowsSingleWindow = window
            stream.ignoreGlobalClipSingleWindow = !window
            stream.ignoreShadowsDisplay = !window
            stream.ignoreGlobalClipDisplay = window
            let shot = ScreenCapture.screenshotConfiguration(from: stream, style: .window)
            let display = ScreenCapture.screenshotConfiguration(from: stream, style: .display)
            XCTAssertEqual(shot.ignoreShadows, window)
            XCTAssertEqual(shot.ignoreClipping, !window)
            XCTAssertEqual(display.ignoreShadows, !window)
            XCTAssertEqual(display.ignoreClipping, window)
        }
        #else
        throw XCTSkip("Dedicated screenshot API requires the Xcode 26 SDK")
        #endif
    }
}
