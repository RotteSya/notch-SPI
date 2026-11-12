import Foundation

/// A short-lived child waits for our normal cleanup/termination before reopening this exact app.
/// No launch agent, installed helper or persistent script is needed.
enum PermissionRelaunch {
    enum Failure: Error { case notApplicationBundle }

    static let script = """
    attempts=0
    while kill -0 "$1" 2>/dev/null; do
        attempts=$((attempts + 1))
        [ "$attempts" -lt 300 ] || exit 1
        /bin/sleep 0.1
    done
    /bin/sleep 0.3
    exec "$3" "$2"
    """

    @discardableResult
    static func schedule(appURL: URL = Bundle.main.bundleURL,
                         processID: Int32 = ProcessInfo.processInfo.processIdentifier,
                         opener: String = "/usr/bin/open") throws -> Process {
        guard appURL.isFileURL, appURL.pathExtension == "app", processID > 0 else {
            throw Failure.notApplicationBundle
        }
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/sh")
        // Paths are positional arguments, never interpolated into shell code. Without -n,
        // open also reuses an instance already relaunched by macOS's permission dialog.
        process.arguments = ["-c", script, "permission-relaunch", String(processID), appURL.path, opener]
        process.standardInput = FileHandle.nullDevice
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        try process.run()
        return process
    }
}
