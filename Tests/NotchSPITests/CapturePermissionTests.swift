import XCTest
import ScreenCaptureKit
@testable import NotchSPI

final class CapturePermissionTests: XCTestCase {
    @MainActor func testGrantContinuesTheSameCaptureWithoutSwitchingTarget() async throws {
        var requested = false
        let selectedTarget = CaptureTarget.app(bundleID: "com.google.Chrome")
        let result = await CapturePermission.withAccess(preflight: { false }, request: {
            requested = true
            return true
        }) {
            XCTAssertTrue(requested)
            return .success(selectedTarget)
        }
        XCTAssertEqual(try result.get(), selectedTarget)
    }

    @MainActor func testDeniedPermissionNeverStartsEnumerationOrRecovery() async {
        let result: Result<Int, CaptureError> = await CapturePermission.withAccess(
            preflight: { false }, request: { false }
        ) {
            XCTFail("denied capture must not enter the system timeout/recovery path")
            return .success(1)
        }
        guard case .failure(.noPermission) = result else { return XCTFail("expected permission guidance") }
    }

    @MainActor func testGrantedAccessDoesNotRequestAgain() async throws {
        let result = await CapturePermission.withAccess(preflight: { true }, request: {
            XCTFail("must not prompt again after switching targets with access granted")
            return false
        }) { .success(1) }
        XCTAssertEqual(try result.get(), 1)
    }

    @MainActor func testCancelledCaptureDoesNotPrompt() async {
        let task = Task {
            await CapturePermission.withAccess(preflight: {
                XCTFail("cancelled request must not check or request access")
                return false
            }, request: { XCTFail("cancelled prompt"); return false }) {
                Result<Int, CaptureError>.success(1)
            }
        }
        task.cancel()
        let result = await task.value
        guard case .failure(.captureFailed) = result else { return XCTFail("expected cancellation") }
    }

    func testMissingOrDeclinedAccessIsNotReportedAsSystemTimeout() {
        let timeout = CapturePermission.failure(for: CaptureSystemOperationError.timedOut, hasAccess: false)
        guard case .noPermission = timeout else { return XCTFail("missing access is not a service timeout") }
        let declined = NSError(domain: SCStreamErrorDomain, code: SCStreamError.Code.userDeclined.rawValue)
        guard case .noPermission = CapturePermission.failure(for: declined, hasAccess: true)
        else { return XCTFail("explicit system denial overrides preflight") }
    }

    func testAuthorizedServiceErrorsKeepTheirMeaning() {
        guard case .captureTimedOut = CapturePermission.failure(for: CaptureSystemOperationError.timedOut, hasAccess: true)
        else { return XCTFail("real timeout must still be recoverable") }
        let systemError = NSError(domain: SCStreamErrorDomain, code: SCStreamError.Code.internalError.rawValue)
        guard case .captureFailed = CapturePermission.failure(for: systemError, hasAccess: true)
        else { return XCTFail("service failures must not all be reported as missing permission") }
    }
}
