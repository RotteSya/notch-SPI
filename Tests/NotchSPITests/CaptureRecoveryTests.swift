import XCTest
@testable import NotchSPI

final class CaptureRecoveryTests: XCTestCase {
    @MainActor func testTimeoutFallsBackAndSubsequentCapturesAvoidServiceUntilCooldownExpires() async throws {
        var time: TimeInterval = 100
        let recovery = CaptureRecovery(now: { time })
        var primaryCalls = 0
        var fallbackCalls = 0
        for _ in 0..<3 {
            let value = await recovery.run {
                primaryCalls += 1
                return Result<Int, CaptureError>.failure(.captureTimedOut)
            } fallback: {
                fallbackCalls += 1
                return .success(fallbackCalls)
            }
            XCTAssertEqual(try value.get(), fallbackCalls, "every capture must produce a fresh result")
        }
        XCTAssertEqual(primaryCalls, 1)
        XCTAssertEqual(fallbackCalls, 3)
        time = 161
        let recovered = await recovery.run { .success(42) } fallback: {
            XCTFail("healthy service should be used after cooldown")
            return .success(-1)
        }
        XCTAssertEqual(try recovered.get(), 42)
        XCTAssertFalse(recovery.usesFallback)
    }

    @MainActor func testPermissionAndTargetErrorsDoNotFallBack() async {
        for error in [CaptureError.noPermission, .appNotRunning(name: "app"),
                      .noCapturableWindow(name: "app"), .captureFailed, .panelNotExcludable] {
            let recovery = CaptureRecovery()
            let result: Result<Int, CaptureError> = await recovery.run { .failure(error) } fallback: {
                XCTFail("non-timeout errors must keep their original meaning")
                return .success(1)
            }
            if case .success = result { XCTFail("unexpected success") }
            XCTAssertFalse(recovery.usesFallback)
        }
    }

    @MainActor func testPanelExclusionSignalKeepsFallbackSelectedForHiddenPanelRetry() async throws {
        let recovery = CaptureRecovery()
        let first: Result<Int, CaptureError> = await recovery.run { .failure(.captureTimedOut) } fallback: {
            .failure(.panelNotExcludable)
        }
        guard case .failure(.panelNotExcludable) = first else { return XCTFail("controller must hide panel first") }
        let retry = await recovery.run {
            XCTFail("hidden-panel retry must not reenter stalled enumeration")
            return .success(-1)
        } fallback: { .success(7) }
        XCTAssertEqual(try retry.get(), 7)
    }

    @MainActor func testCancellationAfterPrimaryNeverStartsFallback() async {
        let recovery = CaptureRecovery()
        let started = expectation(description: "started")
        var callback: CheckedContinuation<Void, Never>?
        let task = Task {
            await recovery.run {
                await withCheckedContinuation { callback = $0; started.fulfill() }
                return Result<Int, CaptureError>.failure(.captureTimedOut)
            } fallback: {
                XCTFail("cancelled capture must not start a subprocess")
                return .success(1)
            }
        }
        await fulfillment(of: [started], timeout: 2)
        task.cancel()
        callback?.resume()
        let result = await task.value
        guard case .failure(.captureFailed) = result else { return XCTFail("expected cancellation") }
        XCTAssertFalse(recovery.usesFallback)
    }
}
