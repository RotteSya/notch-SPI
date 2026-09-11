import AppKit
import XCTest
@testable import NotchSPI

final class CaptureFallbackSmokeTests: XCTestCase {
    @MainActor func testLivePublicCapturePathCompletesThreeCaptures() async throws {
        guard ProcessInfo.processInfo.environment["NSPI_RUN_CAPTURE_SMOKE"] == "1" else {
            throw XCTSkip("Opt-in live capture on an authorized Mac only.")
        }
        for _ in 0..<3 {
            let start = ProcessInfo.processInfo.systemUptime
            // Exercise the same panel-exclusion signal used by the controller. A missing
            // panel must lead to the hidden-panel retry without losing fallback state.
            var result = await ScreenCapture.capture(target: .fullScreen, excludingWindowID: CGWindowID.max)
            if case .failure(.panelNotExcludable) = result {
                result = await ScreenCapture.capture(target: .fullScreen)
            }
            let shot = try result.get()
            defer { try? FileManager.default.removeItem(atPath: shot.path) }
            XCTAssertTrue(FileManager.default.fileExists(atPath: shot.path))
            print("[CaptureLiveSmoke] success elapsed=\(ProcessInfo.processInfo.systemUptime - start)")
        }
    }

    @MainActor func testFullScreenFallbackRequiresPanelHiddenBeforeTakingAnImage() async {
        // This guard runs before permissions or launching the command, so CI needs no screen access.
        let result = await ScreenCapture.captureUsingSystemCommand(target: .fullScreen, maxLongEdge: 1568,
                                                                   excludingWindowID: 123)
        guard case .failure(.panelNotExcludable) = result else { return XCTFail("must request panel hiding") }
    }

    @MainActor func testRealSystemFallbackCapturesThreeFreshImagesAndCleansIntermediateFiles() async throws {
        guard ProcessInfo.processInfo.environment["NSPI_RUN_CAPTURE_SMOKE"] == "1" else {
            throw XCTSkip("Opt-in capture on an authorized Mac only; images are deleted after validation.")
        }
        XCTAssertTrue(CGPreflightScreenCaptureAccess())
        let temporary = FileManager.default.temporaryDirectory
        let before = Set(try FileManager.default.contentsOfDirectory(atPath: temporary.path)
            .filter { $0.hasPrefix("notchspi-command-") })
        let recovery = CaptureRecovery()
        var primaryCalls = 0
        var paths = Set<String>()
        for _ in 0..<3 {
            let start = ProcessInfo.processInfo.systemUptime
            let result = await recovery.run {
                primaryCalls += 1
                return Result<ScreenCapture.Shot, CaptureError>.failure(.captureTimedOut)
            } fallback: {
                await ScreenCapture.captureUsingSystemCommand(target: .fullScreen, maxLongEdge: 1568,
                                                              excludingWindowID: nil)
            }
            let shot = try result.get()
            defer { try? FileManager.default.removeItem(atPath: shot.path) }
            let rep = try XCTUnwrap(NSBitmapImageRep(data: Data(contentsOf: URL(fileURLWithPath: shot.path))))
            XCTAssertEqual(max(rep.pixelsWide, rep.pixelsHigh), 1568)
            XCTAssertTrue(paths.insert(shot.path).inserted)
            XCTAssertTrue(shot.targetFingerprint.hasPrefix("display:"))
            print("[CaptureFallbackSmoke] success elapsed=\(ProcessInfo.processInfo.systemUptime - start)")
        }
        XCTAssertEqual(primaryCalls, 1)
        let after = Set(try FileManager.default.contentsOfDirectory(atPath: temporary.path)
            .filter { $0.hasPrefix("notchspi-command-") })
        XCTAssertEqual(before, after)
        XCTAssertTrue(paths.allSatisfy { !FileManager.default.fileExists(atPath: $0) })
    }
}
