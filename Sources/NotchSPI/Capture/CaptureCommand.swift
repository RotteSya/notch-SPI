import Foundation

/// A killable alternative to system callbacks that may never return. Only one child
/// runs at a time, and cancellation/deadline waits for its exit before files are read.
@MainActor
final class CaptureCommand {
    enum Failure: Error { case exited(Int32) }
    private(set) var isRunning = false

    func run(executable: URL, arguments: [String], timeout: Duration = .seconds(5),
             launch: (Process) throws -> Void = { try $0.run() }) async throws {
        try Task.checkCancellation()
        guard !isRunning else { throw CaptureSystemOperationError.busy }
        isRunning = true
        defer { isRunning = false }
        let process = Process()
        process.executableURL = executable
        process.arguments = arguments
        process.standardInput = FileHandle.nullDevice
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        var stopError: Error?
        try await withTaskCancellationHandler {
            try Task.checkCancellation()
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                let deadline = Task { @MainActor in
                    do { try await Task.sleep(for: timeout) } catch { return }
                    guard process.isRunning else { return }
                    stopError = CaptureSystemOperationError.timedOut
                    kill(process.processIdentifier, SIGKILL)
                }
                process.terminationHandler = { child in
                    Task { @MainActor in
                        deadline.cancel()
                        if let error = stopError { continuation.resume(throwing: error) }
                        else if child.terminationStatus == 0 { continuation.resume() }
                        else { continuation.resume(throwing: Failure.exited(child.terminationStatus)) }
                    }
                }
                do { try launch(process) }
                catch {
                    process.terminationHandler = nil
                    deadline.cancel()
                    continuation.resume(throwing: error)
                }
            }
            try Task.checkCancellation()
        } onCancel: {
            Task { @MainActor in
                guard process.isRunning else { return }
                stopError = CancellationError()
                kill(process.processIdentifier, SIGKILL)
            }
        }
    }
}
