import Foundation

/// Give a stalled ScreenCaptureKit service a quiet interval before probing it again.
/// The alternate backend captures a fresh image for every request; it never reuses a shot.
@MainActor
final class CaptureRecovery {
    private let now: () -> TimeInterval
    private var fallbackUntil: TimeInterval = 0
    var usesFallback: Bool { now() < fallbackUntil }

    init(now: @escaping () -> TimeInterval = { ProcessInfo.processInfo.systemUptime }) {
        self.now = now
    }

    func run<Value>(
        primary: () async -> Result<Value, CaptureError>,
        fallback: () async -> Result<Value, CaptureError>
    ) async -> Result<Value, CaptureError> {
        guard !Task.isCancelled else { return .failure(.captureFailed) }
        if usesFallback { return await fallback() }
        let result = await primary()
        guard !Task.isCancelled else { return .failure(.captureFailed) }
        guard case .failure(.captureTimedOut) = result else { return result }
        fallbackUntil = now() + 60
        return await fallback()
    }
}
