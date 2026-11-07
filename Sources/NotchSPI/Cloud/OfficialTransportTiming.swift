import Foundation

/// Opt-in local QA only. Does not change the session, connection pool, request or response.
/// Server wait includes transit/queueing/model work; it is deliberately NOT named model time.
final class OfficialTransportTiming: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    enum Stage: String { case runStarted, requestReady, responseHeaders, firstEvent, firstDeliveredDelta, streamFinished }
    private let captureID: UUID
    private let started = ProcessInfo.processInfo.systemUptime
    private let lock = NSLock()
    private var marked = Set<Stage>()

    static func make(captureID: UUID) -> OfficialTransportTiming? {
        #if DEBUG
        if ProcessInfo.processInfo.environment["NSPI_LATENCY_TRACE"] == "1",
           ProcessInfo.processInfo.environment["NSPI_QA_EPHEMERAL"] == "1" {
            return OfficialTransportTiming(captureID: captureID)
        }
        #endif
        return nil
    }

    private init(captureID: UUID) {
        self.captureID = captureID
        super.init()
        mark(.runStarted)
    }

    func mark(_ stage: Stage) {
        lock.lock(); defer { lock.unlock() }
        guard marked.insert(stage).inserted else { return }
        let observedAt = ProcessInfo.processInfo.systemUptime
        emit(["stage": stage.rawValue, "elapsed_ms": max(0, (observedAt - started) * 1_000),
              "uptime_ms": observedAt * 1_000])
    }

    func recordResponse(_ response: HTTPURLResponse) {
        guard let id = Self.platformRequestID(response.value(forHTTPHeaderField: "x-vercel-id")) else { return }
        lock.lock(); defer { lock.unlock() }
        emit(["stage": "responseCorrelation", "platform_request_id": id])
    }

    // Use the constructed request's contract, never infer it from the preferred profile.
    // Unknown protocol strings are redacted rather than copied into diagnostics.
    static func requestContract(screenQuery: Bool, resultProtocol: String?) -> [String: String] {
        ["response_contract": screenQuery ? "screen_query_v1" : "legacy",
         "result_protocol": resultProtocol == nil ? "absent" :
            (resultProtocol == "objective_v1" ? "objective_v1" : "other")]
    }

    func recordRequestContract(screenQuery: Bool, resultProtocol: String?) {
        lock.lock(); defer { lock.unlock() }
        var fields = Self.requestContract(screenQuery: screenQuery, resultProtocol: resultProtocol)
        fields["stage"] = "requestContract"
        emit(fields)
    }

    static func platformRequestID(_ value: String?) -> String? {
        guard let value, !value.isEmpty, value.utf8.count <= 160,
              value.range(of: "^[A-Za-z0-9:._-]+$", options: .regularExpression) != nil else { return nil }
        return value
    }

    static func milliseconds(_ start: Date?, _ end: Date?) -> Double? {
        guard let start, let end, end >= start else { return nil }
        return end.timeIntervalSince(start) * 1_000
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didFinishCollecting metrics: URLSessionTaskMetrics) {
        let transactions: [[String: Any]] = metrics.transactionMetrics.map { item in
            var record: [String: Any] = ["reused_connection": item.isReusedConnection,
                                         "proxy_connection": item.isProxyConnection]
            let intervals: [(String, Date?, Date?)] = [
                ("dns_ms", item.domainLookupStartDate, item.domainLookupEndDate),
                ("connect_including_tls_ms", item.connectStartDate, item.connectEndDate),
                ("tls_ms", item.secureConnectionStartDate, item.secureConnectionEndDate),
                ("request_send_ms", item.requestStartDate, item.requestEndDate),
                ("response_wait_ms", item.requestEndDate, item.responseStartDate),
                ("response_receive_ms", item.responseStartDate, item.responseEndDate)
            ]
            for (key, start, end) in intervals { if let value = Self.milliseconds(start, end) { record[key] = value } }
            return record
        }
        lock.lock(); defer { lock.unlock() }
        emit(["stage": "taskMetrics", "transactions": transactions, "redirect_count": metrics.redirectCount])
    }

    private func emit(_ fields: [String: Any]) {
        var record = fields
        record["capture_id"] = captureID.uuidString.lowercased()
        if let data = try? JSONSerialization.data(withJSONObject: record, options: [.sortedKeys]) {
            FileHandle.standardError.write(Data("[OfficialTransportTiming] ".utf8) + data + Data("\n".utf8))
        }
    }
}
