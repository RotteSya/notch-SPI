import AppKit
import ScreenCaptureKit

enum CapturePermission {
    /// Call only from an explicit capture/start action, never background prefetch or polling.
    @MainActor static func requestAccess(
        preflight: () -> Bool = CGPreflightScreenCaptureAccess,
        request: () -> Bool = CGRequestScreenCaptureAccess
    ) -> Bool {
        preflight() || request()
    }

    @MainActor static func withAccess<Value>(
        preflight: () -> Bool = CGPreflightScreenCaptureAccess,
        request: () -> Bool = CGRequestScreenCaptureAccess,
        operation: () async -> Result<Value, CaptureError>
    ) async -> Result<Value, CaptureError> {
        guard !Task.isCancelled else { return .failure(.captureFailed) }
        let granted = requestAccess(preflight: preflight, request: request)
        guard !Task.isCancelled else { return .failure(.captureFailed) }
        guard granted else { return .failure(.noPermission) }
        return await operation()
    }

    static func failure(for error: Error, hasAccess: Bool) -> CaptureError {
        if error is CancellationError { return .captureFailed }
        let systemError = error as NSError
        if !hasAccess || (systemError.domain == SCStreamErrorDomain
            && systemError.code == SCStreamError.Code.userDeclined.rawValue) {
            return .noPermission
        }
        if error is CaptureSystemOperationError { return .captureTimedOut }
        return (error as? CaptureError) ?? .captureFailed
    }
}
