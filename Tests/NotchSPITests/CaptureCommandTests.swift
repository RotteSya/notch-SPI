import XCTest
@testable import NotchSPI

final class CaptureCommandTests: XCTestCase {
    private let shell = URL(fileURLWithPath: "/bin/sh")

    @MainActor func testNonzeroExitAndLaunchFailureReleaseSlot() async throws {
        let command = CaptureCommand()
        do { try await command.run(executable: shell, arguments: ["-c", "exit 7"]); XCTFail("expected error") }
        catch CaptureCommand.Failure.exited(let status) { XCTAssertEqual(status, 7) }
        do { try await command.run(executable: URL(fileURLWithPath: "/nonexistent/notchspi"), arguments: []); XCTFail("expected error") }
        catch { }
        try await command.run(executable: shell, arguments: ["-c", "exit 0"])
        XCTAssertFalse(command.isRunning)
    }

    @MainActor func testDeadlineKillsUncooperativeChildBeforeReturningAndAllowsRetry() async throws {
        let command = CaptureCommand()
        var child: Process?
        do {
            try await command.run(executable: shell, arguments: ["-c", "trap '' TERM; while :; do :; done"],
                                  timeout: .milliseconds(80)) { child = $0; try $0.run() }
            XCTFail("expected timeout")
        } catch CaptureSystemOperationError.timedOut { }
        XCTAssertEqual(child?.isRunning, false)
        try await command.run(executable: shell, arguments: ["-c", "exit 0"])
    }

    @MainActor func testCancellationStopsChildAndConcurrentRequestDoesNotLaunch() async throws {
        let command = CaptureCommand()
        let started = expectation(description: "child started")
        var child: Process?
        let task = Task {
            try await command.run(executable: shell, arguments: ["-c", "exec /bin/sleep 30"]) {
                child = $0
                try $0.run()
                started.fulfill()
            }
        }
        await fulfillment(of: [started], timeout: 2)
        do {
            try await command.run(executable: shell, arguments: []) { _ in XCTFail("overlapping child") }
            XCTFail("expected busy")
        } catch CaptureSystemOperationError.busy { }
        task.cancel()
        do { try await task.value; XCTFail("expected cancellation") } catch is CancellationError { }
        XCTAssertEqual(child?.isRunning, false)
        XCTAssertFalse(command.isRunning)
    }

    @MainActor func testAlreadyCancelledRequestDoesNotLaunch() async {
        let command = CaptureCommand()
        let task = Task {
            try await command.run(executable: shell, arguments: []) { _ in XCTFail("cancelled child started") }
        }
        task.cancel()
        do { try await task.value; XCTFail("expected cancellation") } catch is CancellationError { }
        catch { XCTFail("unexpected error: \(error)") }
        XCTAssertFalse(command.isRunning)
    }
}
