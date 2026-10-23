import Darwin
import Foundation
import TestNetworkIsolation
import XCTest
@testable import NotchSPI

final class NetworkIsolationTests: XCTestCase {
    func testSandboxIsInstalledBeforeTestsRun() {
        XCTAssertEqual(nspi_test_network_isolated(), 1)
    }

    func testPublicSocketIsDeniedByTheKernel() throws {
        // TEST-NET has no service dependency. A missing sandbox would return
        // EINPROGRESS here; EPERM proves denial before any packet is sent.
        assertConnectionDenied(host: "192.0.2.1", port: 443)
    }

    func testConfiguredLoopbackProxyCannotForwardPublicTraffic() throws {
        let port = nspi_test_blocked_proxy_port()
        guard port > 0 else { throw XCTSkip("No proxy configured on this host") }
        assertConnectionDenied(host: "127.0.0.1", port: UInt16(port))
    }

    private func assertConnectionDenied(host: String, port: UInt16, file: StaticString = #filePath, line: UInt = #line) {
        let descriptor = socket(AF_INET, SOCK_STREAM, 0)
        XCTAssertGreaterThanOrEqual(descriptor, 0)
        guard descriptor >= 0 else { return }
        defer { close(descriptor) }
        XCTAssertEqual(fcntl(descriptor, F_SETFL, O_NONBLOCK), 0)
        var address = sockaddr_in()
        address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        address.sin_family = sa_family_t(AF_INET)
        address.sin_port = port.bigEndian
        XCTAssertEqual(inet_pton(AF_INET, host, &address.sin_addr), 1)
        let result = withUnsafePointer(to: &address) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                connect(descriptor, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        let failure = errno
        XCTAssertEqual(result, -1, file: file, line: line)
        XCTAssertEqual(failure, EPERM, file: file, line: line)
    }

    func testOfficialServiceDefaultsStayLocalUnderXCTest() {
        XCTAssertTrue(DevelopmentIsolation.isRunningTests)
        XCTAssertNotNil(DevelopmentIsolation.agreedLoopback(OfficialAPI.baseURL))
        XCTAssertEqual(DevelopmentIsolation.testServiceAddress(OfficialAPI.defaultBaseURL, runningTests: true), "http://127.0.0.1:9")
        XCTAssertEqual(DevelopmentIsolation.testServiceAddress(OfficialAPI.defaultBaseURL, runningTests: false), OfficialAPI.defaultBaseURL)
        for address in ["https://example.com", "http://127.0.0.1.example.com:8080", "http://localhost:8080", "http://127.0.0.1:8080@192.0.2.1/"] {
            XCTAssertFalse(DevelopmentIsolation.permitsTestRequest(URL(string: address), runningTests: true), address)
        }
        XCTAssertTrue(DevelopmentIsolation.permitsTestRequest(URL(string: "http://127.0.0.1:8080/v1/account"), runningTests: true))
        XCTAssertTrue(DevelopmentIsolation.permitsTestRequest(URL(string: OfficialAPI.defaultBaseURL), runningTests: false))
    }

    func testAccountHTTPRejectsPublicRegistrationBeforeURLSession() async {
        var request = URLRequest(url: URL(string: "https://192.0.2.1/v1/devices")!)
        request.httpMethod = "POST"
        do {
            _ = try await OfficialAPI.readAccountHTTP(request, session: .shared)
            XCTFail("Public registration must be rejected before transport")
        } catch {
            XCTAssertEqual((error as? URLError)?.code, .unsupportedURL)
        }
    }

    func testChildProcessInheritsNetworkDenial() throws {
        let child = Process()
        child.executableURL = URL(fileURLWithPath: "/usr/bin/python3")
        child.arguments = ["-c", """
        import errno, socket, sys
        with socket.socket() as connection:
            connection.setblocking(False)
            result = connection.connect_ex(('192.0.2.1', 443))
            print(result)
            sys.exit(0 if result == errno.EPERM else 1)
        """]
        let output = Pipe()
        child.standardError = output
        child.standardOutput = output
        try child.run()
        child.waitUntilExit()
        let message = String(decoding: output.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
        XCTAssertEqual(child.terminationStatus, 0, message)
        XCTAssertEqual(message.trimmingCharacters(in: .whitespacesAndNewlines), String(EPERM))
    }

    @MainActor
    func testLoopbackHTTPRedirectCannotEscapeToPublicNetwork() async throws {
        var reachedLoopback = false
        let server = try CaptureHTTPServer { _, reply in
            reachedLoopback = true
            reply.start(status: 302, extra: "Location: http://192.0.2.1/blocked\r\n")
            reply.finish()
        }
        defer { server.stop() }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.connectionProxyDictionary = [:]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        var request = URLRequest(url: URL(string: try await server.start())!)
        request.timeoutInterval = 2
        do {
            _ = try await session.data(for: request)
            XCTFail("The public redirect must fail inside the sandbox")
        } catch {
            XCTAssertNotEqual((error as? URLError)?.code, .timedOut)
        }
        XCTAssertTrue(reachedLoopback, "Loopback HTTP must remain available")
    }
}
