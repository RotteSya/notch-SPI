import XCTest
@testable import NotchSPI

final class InAppUpdaterTests: XCTestCase {
    func testAcceptanceOriginIsExplicitLoopbackOnly() {
        XCTAssertNotNil(UpdateChecker.acceptanceBase(arguments: ["app", "--update-test-base-url", "http://127.0.0.1:43123"]))
        for address in ["http://example.com:80", "http://127.0.0.1.example.com:80", "http://user@127.0.0.1:80", "http://127.0.0.1:80/path", "file:///tmp/test", "http://127.0.0.1"] {
            XCTAssertNil(UpdateChecker.acceptanceBase(arguments: ["app", "--update-test-base-url", address]))
        }
        XCTAssertFalse(UpdateChecker.permitsDownload(URL(string: "http://example.com/dl")!))
        XCTAssertFalse(UpdateChecker.permitsDownload(URL(string: "http://127.0.0.1:43123/dl")!))
        XCTAssertTrue(UpdateChecker.permitsDownload(URL(string: "https://example.com/dl")!))
    }

    func testRejectsUnbundledAndDiskImageDestinations() {
        XCTAssertThrowsError(try InAppUpdater.validateDestination(URL(fileURLWithPath: "/Volumes/NotchSPI/NotchSPI.app")))
        XCTAssertThrowsError(try InAppUpdater.validateDestination(URL(fileURLWithPath: "/tmp/not-an-app")))
    }

    func testRejectsUnsignedCandidate() throws {
        let root = try temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let old = try bundle(root.appendingPathComponent("old.app"), version: "2.1")
        let new = try bundle(root.appendingPathComponent("new.app"), version: "2.2")
        XCTAssertThrowsError(try InAppUpdater.validateCandidate(new, current: old, version: "2.2"))
        XCTAssertThrowsError(try InAppUpdater.validateCandidate(old, current: new, version: "2.2"))
    }

    func testInstallerReplacesBundleWithQuotedPaths() throws {
        try exerciseInstaller(candidateExists: true, launchSucceeds: true)
    }

    func testInstallerRestoresOldBundleIfReplacementFails() throws {
        try exerciseInstaller(candidateExists: false, launchSucceeds: true)
    }

    func testInstallerRestoresOldBundleIfLaunchFails() throws {
        try exerciseInstaller(candidateExists: true, launchSucceeds: false)
    }

    func testInstallerDoesNotReplaceAnAppThatRefusesToQuit() throws {
        let root = try temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let destination = root.appendingPathComponent("running.app")
        try FileManager.default.createDirectory(at: destination, withIntermediateDirectories: true)
        let script = InAppUpdater.installerScript
            .replacingOccurrences(of: "/bin/kill", with: "/usr/bin/true")
            .replacingOccurrences(of: "/bin/sleep", with: "/usr/bin/true")
            .replacingOccurrences(of: "-ge 60", with: "-ge 2")
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/sh")
        process.arguments = ["-c", script, "test-updater", "0", destination.path, root.appendingPathComponent("staging").path]
        try process.run()
        process.waitUntilExit()
        XCTAssertEqual(process.terminationStatus, 75)
        XCTAssertTrue(FileManager.default.fileExists(atPath: destination.path))
    }

    private func exerciseInstaller(candidateExists: Bool, launchSucceeds: Bool) throws {
        let fm = FileManager.default
        let root = try temporaryDirectory()
        defer { try? fm.removeItem(at: root) }
        let destination = root.appendingPathComponent("App ' $ literal.app")
        let staging = root.appendingPathComponent("staging")
        try fm.createDirectory(at: destination, withIntermediateDirectories: true)
        try fm.createDirectory(at: staging, withIntermediateDirectories: true)
        try Data("old".utf8).write(to: destination.appendingPathComponent("marker"))
        if candidateExists {
            let candidate = staging.appendingPathComponent("NotchSPI.app")
            try fm.createDirectory(at: candidate, withIntermediateDirectories: true)
            try Data("new".utf8).write(to: candidate.appendingPathComponent("marker"))
        }
        let launcher = root.appendingPathComponent("launch-stub")
        try "#!/bin/sh\nif [ \"$1\" = \"-W\" ]; then printf ready > \"$6\"; fi\nexit 0\n".write(to: launcher, atomically: true, encoding: .utf8)
        try fm.setAttributes([.posixPermissions: 0o700], ofItemAtPath: launcher.path)
        // Replace only OS lifecycle commands; the production filesystem transaction runs verbatim.
        let script = InAppUpdater.installerScript
            .replacingOccurrences(of: "while /bin/kill -0 \"$parent\"", with: "while /usr/bin/false")
            .replacingOccurrences(of: "/usr/bin/open", with: launchSucceeds ? "\"" + launcher.path + "\"" : "/usr/bin/false")
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/sh")
        process.arguments = ["-c", script, "test-updater", "0", destination.path, staging.path]
        process.standardError = FileHandle.nullDevice
        try process.run()
        process.waitUntilExit()
        let success = candidateExists && launchSucceeds
        XCTAssertEqual(process.terminationStatus, success ? 0 : 1)
        XCTAssertEqual(try String(contentsOf: destination.appendingPathComponent("marker")), success ? "new" : "old")
    }

    private func temporaryDirectory() throws -> URL {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        return root
    }

    private func bundle(_ url: URL, version: String) throws -> URL {
        let contents = url.appendingPathComponent("Contents")
        try FileManager.default.createDirectory(at: contents, withIntermediateDirectories: true)
        let data = try PropertyListSerialization.data(fromPropertyList: ["CFBundleIdentifier": "com.rottesya.notchspi", "CFBundleShortVersionString": version], format: .xml, options: 0)
        try data.write(to: contents.appendingPathComponent("Info.plist"))
        return url
    }
}
