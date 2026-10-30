import XCTest
import Network
@testable import NotchSPI

/// Real loopback HTTP chunking exercises URLSession.AsyncBytes, with no app credentials or model calls.
private final class LocalStreamServer: @unchecked Sendable {
    private let listener: NWListener
    private let queue = DispatchQueue(label: "test.official-stream.http")
    private var connections: [NWConnection] = []
    private let chunks: [Data]
    private let complete: Bool
    private let holdOpen: Bool
    private let bodyDelay: TimeInterval
    private var bodyBytes = 0
    var receivedBodyBytes: Int { queue.sync { bodyBytes } }

    init(bytes: Data, complete: Bool, holdOpen: Bool = false, bodyDelay: TimeInterval = 0) throws {
        let parameters = NWParameters.tcp
        parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: .any)
        listener = try NWListener(using: parameters)
        self.complete = complete
        self.holdOpen = holdOpen
        self.bodyDelay = bodyDelay
        chunks = stride(from: 0, to: bytes.count, by: 3).map { Data(bytes[$0..<min($0 + 3, bytes.count)]) }
    }
    func start() async throws -> URL {
        try await withCheckedThrowingContinuation { continuation in
            listener.stateUpdateHandler = { [weak self] state in
                guard let self else { return }
                switch state {
                case .ready:
                    self.listener.stateUpdateHandler = nil
                    guard let port = self.listener.port else { continuation.resume(throwing: URLError(.cannotConnectToHost)); return }
                    continuation.resume(returning: URL(string: "http://127.0.0.1:\(port.rawValue)/v1/captures")!)
                case .failed(let error): self.listener.stateUpdateHandler = nil; continuation.resume(throwing: error)
                default: break
                }
            }
            listener.newConnectionHandler = { [weak self] connection in
                guard let self else { connection.cancel(); return }
                self.connections.append(connection); connection.start(queue: self.queue)
                self.receive(connection, accumulated: Data())
            }
            listener.start(queue: queue)
        }
    }
    private func receive(_ connection: NWConnection, accumulated: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 65_536) { [weak self] bytes, _, ended, error in
            guard let self, error == nil, let bytes else { connection.cancel(); return }
            let request = accumulated + bytes
            guard request.count <= 65_536 else { connection.cancel(); return }
            if let boundary = request.range(of: Data("\r\n\r\n".utf8)) {
                let headers = String(decoding: request[..<boundary.lowerBound], as: UTF8.self)
                let lengthLine = headers.components(separatedBy: "\r\n").first { $0.lowercased().hasPrefix("content-length:") }
                let bodyLength = lengthLine.flatMap { Int($0.dropFirst("content-length:".count).trimmingCharacters(in: .whitespaces)) } ?? 0
                guard bodyLength >= 0, boundary.upperBound + bodyLength <= 65_536 else { connection.cancel(); return }
                guard request.count >= boundary.upperBound + bodyLength else {
                    if ended { connection.cancel() } else { self.receive(connection, accumulated: request) }
                    return
                }
                self.bodyBytes = bodyLength
                let header = Data("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream; charset=utf-8\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n".utf8)
                connection.send(content: header, completion: .contentProcessed { [weak self] error in
                    if error != nil { connection.cancel() }
                    else if let self {
                        self.queue.asyncAfter(deadline: .now() + self.bodyDelay) { self.send(connection, index: 0) }
                    }
                })
            } else if ended { connection.cancel() }
            else { self.receive(connection, accumulated: request) }
        }
    }
    private func send(_ connection: NWConnection, index: Int) {
        if index == chunks.count {
            if holdOpen { return }
            // Finish the TCP write side rather than cancelling queued bytes. The incomplete
            // case still omits the HTTP terminator and DONE, while delivering its usage event.
            connection.send(content: complete ? Data("0\r\n\r\n".utf8) : nil,
                            contentContext: .finalMessage, isComplete: true,
                            completion: .contentProcessed { error in if error != nil { connection.cancel() } })
            return
        }
        let chunk = chunks[index], packet = Data((String(chunk.count, radix: 16) + "\r\n").utf8) + chunk + Data("\r\n".utf8)
        connection.send(content: packet, completion: .contentProcessed { [weak self] error in
            if error != nil { connection.cancel() } else { self?.send(connection, index: index + 1) }
        })
    }
    func stop() {
        queue.sync {
            listener.newConnectionHandler = nil; listener.stateUpdateHandler = nil
            connections.forEach { $0.cancel() }; connections.removeAll(); listener.cancel()
        }
    }
}

final class OfficialStreamTransportTests: XCTestCase {
    /// Separates AsyncBytes response delivery from the first body byte without an external service.
    func testRequestContractDiagnosticsDistinguishLegacyAndRedactUnknownValues() {
        XCTAssertEqual(OfficialTransportTiming.requestContract(screenQuery: false, resultProtocol: "objective_v1"),
                       ["response_contract": "legacy", "result_protocol": "objective_v1"])
        XCTAssertEqual(OfficialTransportTiming.requestContract(screenQuery: true, resultProtocol: "objective_v1"),
                       ["response_contract": "screen_query_v1", "result_protocol": "objective_v1"])
        XCTAssertEqual(OfficialTransportTiming.requestContract(screenQuery: false, resultProtocol: nil)["result_protocol"], "absent")
        XCTAssertEqual(OfficialTransportTiming.requestContract(screenQuery: false, resultProtocol: "private content")["result_protocol"], "other")
    }

    func testDelayedBodyIsDeliveredBeforeConnectionClosesWithAndWithoutTiming() async throws {
        for traced in [false, true] {
            let server = try LocalStreamServer(bytes: Data("data: first\n\n".utf8), complete: false,
                                               holdOpen: true, bodyDelay: 1)
            defer { server.stop() }
            var request = URLRequest(url: try await server.start()); request.timeoutInterval = 4
            let session = URLSession(configuration: .ephemeral)
            defer { session.invalidateAndCancel() }
            let timing = traced ? OfficialTransportTiming.make(captureID: UUID()) : nil
            if traced { try XCTSkipIf(timing == nil, "Enable local QA latency tracing to test the actual timing delegate") }
            let start = ProcessInfo.processInfo.systemUptime
            let (bytes, response) = try await session.bytes(for: request, delegate: timing)
            let headers = ProcessInfo.processInfo.systemUptime - start
            XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
            var iterator = bytes.makeAsyncIterator()
            let first = try await iterator.next()
            let delivered = ProcessInfo.processInfo.systemUptime - start
            bytes.task.cancel()
            XCTAssertEqual(first, UInt8(ascii: "d"))
            XCTAssertGreaterThanOrEqual(delivered, 0.9)
            XCTAssertLessThan(delivered, 2.5, "A held-open stream must not wait for EOF")
            print("[LoopbackDelivery] traced=\(traced) response_ms=\(headers * 1000) first_byte_ms=\(delivered * 1000)")
        }
    }

    func testTransportCorrelationAcceptsOnlyBoundedPlatformIdentifiers() {
        XCTAssertNil(OfficialTransportTiming.platformRequestID(nil))
        XCTAssertNil(OfficialTransportTiming.platformRequestID("Bearer secret\n"))
        XCTAssertNil(OfficialTransportTiming.platformRequestID(String(repeating: "a", count: 161)))
        XCTAssertEqual(OfficialTransportTiming.platformRequestID("hnd1::sample-123"), "hnd1::sample-123")
    }

    func testTransportIntervalsDoNotInventMissingOrNegativeDurations() {
        let start = Date(timeIntervalSince1970: 100)
        XCTAssertNil(OfficialTransportTiming.milliseconds(nil, start))
        XCTAssertNil(OfficialTransportTiming.milliseconds(start, nil))
        XCTAssertNil(OfficialTransportTiming.milliseconds(start, start.addingTimeInterval(-1)))
        XCTAssertEqual(OfficialTransportTiming.milliseconds(start, start.addingTimeInterval(0.25)), 250)
    }

    private func response(id: UUID, done: Bool) throws -> Data {
        let usage: [String: Any] = ["type": "usage", "input_tokens": 2, "output_tokens": 1, "questions_charged": 1,
            "capture_id": id.uuidString, "operation": "solve", "terminal_state": "usable", "settlement_status": "settled",
            "usable_result": true, "balance_questions": 29, "held_questions": 0, "balance_version": "2", "can_retry": false, "can_recover": true]
        let terminal = String(decoding: try JSONSerialization.data(withJSONObject: usage), as: UTF8.self)
        return Data(("data: {\"type\":\"delta\",\"text\":\"中文 🔎 FINAL: B\"}\n\ndata: " + terminal + "\n\n" + (done ? "data: [DONE]\n\n" : "")).utf8)
    }
    func testRealHTTPChunkBoundariesPreserveUnicodeAndOneSettlement() async throws {
        let id = UUID(), server = try LocalStreamServer(bytes: response(id: id, done: true), complete: true)
        defer { server.stop() }
        var request = URLRequest(url: try await server.start()); request.httpMethod = "POST"
        request.httpBody = Data(repeating: 32, count: 32_768); request.timeoutInterval = 5
        let session = URLSession(configuration: .ephemeral); defer { session.invalidateAndCancel() }
        let timing = OfficialTransportTiming.make(captureID: id)
        let (bytes, response) = try await session.bytes(for: request, delegate: timing)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        var text = "", receipts = 0
        let outcome = try await OfficialStreamDecoder.consume(bytes, captureID: id, screenQuery: true) { event in
            if case .delta(let chunk) = event { text += chunk }; if case .usage = event { receipts += 1 }
        }
        XCTAssertEqual(text, "中文 🔎 FINAL: B"); XCTAssertEqual(receipts, 1); XCTAssertTrue(outcome.hasContent)
        XCTAssertEqual(server.receivedBodyBytes, 32_768)
    }
    func testRealSocketCloseAfterSettlementCannotCompleteAnswerDelivery() async throws {
        let id = UUID(), server = try LocalStreamServer(bytes: response(id: id, done: false), complete: false)
        defer { server.stop() }
        var request = URLRequest(url: try await server.start()); request.timeoutInterval = 5
        let session = URLSession(configuration: .ephemeral); defer { session.invalidateAndCancel() }
        let (bytes, _) = try await session.bytes(for: request)
        var receipts = 0
        do {
            _ = try await OfficialStreamDecoder.consume(bytes, captureID: id, screenQuery: true) { if case .usage = $0 { receipts += 1 } }
            XCTFail("An interrupted response was accepted")
        } catch { XCTAssertTrue(error is OfficialStreamDecoder.Failure || error is URLError) }
        XCTAssertEqual(receipts, 1)
    }
}

final class DirectAPIStreamTransportTests: XCTestCase {
    @MainActor func testCancelStopsAnOpenHTTPStreamWithoutLateCallbacks() async throws {
        let bytes = Data((#"data: {"choices":[{"delta":{"content":"FINAL: B"}}]}"# + "\n\n").utf8)
        let server = try LocalStreamServer(bytes: bytes, complete: false, holdOpen: true)
        let url = try await server.start()
        defer { server.stop() }
        let first = expectation(description: "first delta")
        let stopped = expectation(description: "canceled task returned")
        var task: Task<Void, Never>?
        var deltas = 0
        task = APIKeyRunner.run(proto: .openai, endpoint: url.absoluteString, apiKey: "offline", model: "offline",
            imagePaths: [], prompt: .init(system: "offline", task: "offline"),
            onDelta: { _ in deltas += 1; task?.cancel(); first.fulfill() },
            onDone: { _, _ in XCTFail("Canceled request delivered completion") })
        await fulfillment(of: [first], timeout: 5)
        let running = try XCTUnwrap(task)
        Task { await running.value; stopped.fulfill() }
        await fulfillment(of: [stopped], timeout: 2)
        XCTAssertTrue(running.isCancelled)
        XCTAssertEqual(deltas, 1)
    }

    @MainActor func testRealHTTPTruncationAndEOFRejectPlausibleFinalWhileNormalStopCompletes() async throws {
        for proto in [APIWireProtocol.openai, .anthropic] {
            for reason in ["length", "stop", "missing"] {
                let text = (proto == .openai
                    ? #"data: {"choices":[{"delta":{"content":"FINAL: (1) 3; (2) 48 km/h"}}]}"#
                    : #"data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"FINAL: (1) 3; (2) 48 km/h"}}"#) + "\n\n"
                let ending: String
                if reason == "missing" { ending = "" }
                else if proto == .openai {
                    ending = "data: {\"choices\":[{\"finish_reason\":\"\(reason)\",\"delta\":{}}]}\n\ndata: [DONE]\n\n"
                } else {
                    let stop = reason == "length" ? "max_tokens" : "end_turn"
                    ending = "data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"\(stop)\"}}\n\ndata: {\"type\":\"message_stop\"}\n\n"
                }
                let server = try LocalStreamServer(bytes: Data((text + ending).utf8), complete: true)
                let url = try await server.start()
                let finished = expectation(description: reason)
                var received = "", succeeded = false, failure = ""
                APIKeyRunner.run(proto: proto, endpoint: url.absoluteString, apiKey: "offline-test", model: "offline",
                    imagePaths: [], prompt: .init(system: "offline", task: "offline"),
                    onDelta: { received += $0 }, onDone: { ok, error in succeeded = ok; failure = error; finished.fulfill() })
                await fulfillment(of: [finished], timeout: 5)
                server.stop()
                XCTAssertEqual(received, "FINAL: (1) 3; (2) 48 km/h")
                XCTAssertEqual(succeeded, reason == "stop")
                XCTAssertEqual(failure.isEmpty, reason == "stop")
            }
        }
    }
}
