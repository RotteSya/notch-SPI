import Foundation

struct OfficialUsageReceipt: Decodable, Equatable {
    let inputTokens: Int
    let outputTokens: Int
    let questionsCharged: Int
    let balanceQuestions: Int
    let captureID: UUID?
    let settlementStatus: String?
    let balanceVersion: String?
    let operation: String?
    var accountTotals: OfficialAccountTotals? = nil
    var explanationAvailable: Bool? = nil

    enum CodingKeys: String, CodingKey {
        case inputTokens = "input_tokens", outputTokens = "output_tokens"
        case questionsCharged = "questions_charged", balanceQuestions = "balance_questions"
        case captureID = "capture_id", settlementStatus = "settlement_status"
        case balanceVersion = "balance_version", operation
        case accountTotals = "account_totals"
        case explanationAvailable = "explanation_available"
    }
}

/// Bounded byte framing and semantic validation for the official POST SSE contract.
/// A valid settlement receipt and a fully delivered answer are independent facts.
struct OfficialStreamDecoder {
    enum Failure: Error { case invalidEncoding, invalidEvent, invalidOrder, tooLarge, incomplete }
    struct ServiceError: Decodable, Equatable { let message: String; let code: String? }
    enum Event: Equatable {
        case delta(String), usage(OfficialUsageReceipt), error(ServiceError), done
    }
    struct Outcome: Equatable {
        let hasContent: Bool
        let serviceError: ServiceError?
    }
    private struct Envelope: Decodable { let type: String }
    private struct Delta: Decodable { let text: String }
    private struct ErrorEnvelope: Decodable { let error: ServiceError?; let message: String?; let code: String? }

    let captureID: UUID
    let screenQuery: Bool
    let operation: String
    private var line: [UInt8] = []
    private var dataLines: [String] = []
    private var dataBytes = 0
    private var totalBytes = 0
    private var contentBytes = 0
    private var skipLF = false
    private var firstLine = true
    private var receipt: OfficialUsageReceipt?
    private var serviceError: ServiceError?
    private var hasContent = false
    private(set) var isDone = false

    init(captureID: UUID, screenQuery: Bool, operation: String = "solve") {
        self.captureID = captureID; self.screenQuery = screenQuery; self.operation = operation
    }

    mutating func append(_ byte: UInt8) throws -> Event? {
        guard !isDone else { throw Failure.invalidOrder }
        totalBytes += 1
        guard totalBytes <= 4 * 1024 * 1024 else { throw Failure.tooLarge }
        if skipLF { skipLF = false; if byte == 10 { return nil } }
        if byte == 13 { skipLF = true; return try finishLine() }
        if byte == 10 { return try finishLine() }
        guard line.count < 512 * 1024 else { throw Failure.tooLarge }
        line.append(byte)
        return nil
    }

    func finish() throws -> Outcome {
        guard isDone, receipt != nil else { throw Failure.incomplete }
        return .init(hasContent: hasContent, serviceError: serviceError)
    }

    private mutating func finishLine() throws -> Event? {
        guard var value = String(bytes: line, encoding: .utf8) else { throw Failure.invalidEncoding }
        line.removeAll(keepingCapacity: true)
        if firstLine { firstLine = false; if value.hasPrefix("\u{FEFF}") { value.removeFirst() } }
        if value.isEmpty {
            guard !dataLines.isEmpty else { return nil }
            let payload = dataLines.joined(separator: "\n")
            dataLines.removeAll(keepingCapacity: true); dataBytes = 0
            return try parse(payload)
        }
        if value.hasPrefix(":") { return nil }
        let separator = value.firstIndex(of: ":") ?? value.endIndex
        guard value[..<separator] == "data" else { return nil }
        var data = separator == value.endIndex ? "" : String(value[value.index(after: separator)...])
        if data.hasPrefix(" ") { data.removeFirst() }
        dataBytes += data.utf8.count + 1
        guard dataBytes <= 512 * 1024 else { throw Failure.tooLarge }
        dataLines.append(data)
        return nil
    }

    private mutating func parse(_ payload: String) throws -> Event {
        if payload == "[DONE]" {
            guard receipt != nil else { throw Failure.invalidOrder }
            isDone = true; return .done
        }
        let data = Data(payload.utf8), decoder = JSONDecoder()
        guard let envelope = try? decoder.decode(Envelope.self, from: data) else { throw Failure.invalidEvent }
        switch envelope.type {
        case "delta":
            guard receipt == nil, serviceError == nil else { throw Failure.invalidOrder }
            guard let delta = try? decoder.decode(Delta.self, from: data) else { throw Failure.invalidEvent }
            contentBytes += delta.text.utf8.count
            guard contentBytes <= 64 * 1024 else { throw Failure.tooLarge }
            hasContent = hasContent || !delta.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            return .delta(delta.text)
        case "error":
            guard receipt == nil, serviceError == nil else { throw Failure.invalidOrder }
            guard let value = try? decoder.decode(ErrorEnvelope.self, from: data),
                  let error = value.error ?? value.message.map({ ServiceError(message: $0, code: value.code) }),
                  !error.message.isEmpty else { throw Failure.invalidEvent }
            serviceError = error; return .error(error)
        case "usage":
            guard receipt == nil else { throw Failure.invalidOrder }
            guard let value = try? decoder.decode(OfficialUsageReceipt.self, from: data),
                  value.inputTokens >= 0, value.outputTokens >= 0, (0...1).contains(value.questionsCharged),
                  value.balanceQuestions >= 0, value.captureID == nil || value.captureID == captureID,
                  value.operation == nil || value.operation == operation,
                  value.balanceVersion == nil || value.balanceVersion.flatMap(BalanceVersion.canonical) != nil,
                  value.accountTotals == nil || (value.accountTotals!.isValid && value.balanceVersion != nil),
                  ["solve", "explain", "recover"].contains(operation),
                  operation == "solve" || value.questionsCharged == 0 else { throw Failure.invalidEvent }
            let expected = value.questionsCharged == 1 ? "settled" : operation == "solve" ? "released" : "not_required"
            guard value.settlementStatus == nil || value.settlementStatus == expected else { throw Failure.invalidEvent }
            if screenQuery {
                guard let terminal = try? decoder.decode(SettlementSnapshot.self, from: data),
                      terminal.captureID == captureID, terminal.isTerminal,
                      !terminal.usableResult || (hasContent && serviceError == nil) else { throw Failure.invalidEvent }
            }
            if value.explanationAvailable == true {
                guard screenQuery, operation != "explain",
                      let terminal = try? decoder.decode(SettlementSnapshot.self, from: data),
                      terminal.isTerminal, terminal.usableResult else { throw Failure.invalidEvent }
            }
            guard value.questionsCharged == 0 || (hasContent && serviceError == nil) else { throw Failure.invalidEvent }
            receipt = value; return .usage(value)
        default: throw Failure.invalidEvent
        }
    }

    static func consume<S: AsyncSequence>(_ bytes: S, captureID: UUID, screenQuery: Bool, operation: String = "solve",
                                         onEvent: (Event) async throws -> Void) async throws -> Outcome where S.Element == UInt8 {
        var decoder = Self(captureID: captureID, screenQuery: screenQuery, operation: operation)
        for try await byte in bytes {
            try Task.checkCancellation()
            if let event = try decoder.append(byte) { try await onEvent(event) }
            if decoder.isDone { return try decoder.finish() }
        }
        return try decoder.finish()
    }

    /// Keep framing off the UI delivery path. Adjacent deltas that arrive while the
    /// consumer is busy are joined without waiting for a timer or another network byte.
    /// The decoder still validates every event, and receipts retain their original order.
    static func consumeBuffered<S: AsyncSequence & Sendable>(
        _ bytes: S, captureID: UUID, screenQuery: Bool, operation: String = "solve",
        onEvent: (Event) async throws -> Void
    ) async throws -> Outcome where S.Element == UInt8 {
        let buffer = OfficialStreamEventBuffer()
        let reader = Task {
            do {
                let outcome = try await consume(bytes, captureID: captureID, screenQuery: screenQuery,
                                                operation: operation) { await buffer.append($0) }
                await buffer.finish()
                return outcome
            } catch {
                await buffer.finish(error: error)
                throw error
            }
        }
        defer { reader.cancel() }
        return try await withTaskCancellationHandler {
            while let event = try await buffer.next() {
                try Task.checkCancellation()
                try await onEvent(event)
            }
            try Task.checkCancellation()
            return try await reader.value
        } onCancel: {
            reader.cancel()
            Task { await buffer.cancel() }
        }
    }
}

/// Only already-validated events enter this queue. A stream has at most one pending
/// text span, error, receipt and DONE; text is bounded by the decoder's 64 KiB limit.
private actor OfficialStreamEventBuffer {
    private var pending: [OfficialStreamDecoder.Event] = []
    private var waiter: CheckedContinuation<OfficialStreamDecoder.Event?, Error>?
    private var terminal: Result<Void, Error>?

    func append(_ event: OfficialStreamDecoder.Event) {
        guard terminal == nil else { return }
        if let waiter {
            self.waiter = nil
            waiter.resume(returning: event)
        } else if case .delta(let text) = event, case .delta(let previous) = pending.last {
            pending[pending.count - 1] = .delta(previous + text)
        } else {
            pending.append(event)
        }
    }

    func finish(error: Error? = nil) {
        guard terminal == nil else { return }
        terminal = error.map(Result.failure) ?? .success(())
        if let waiter {
            self.waiter = nil
            if let error { waiter.resume(throwing: error) }
            else { waiter.resume(returning: nil) }
        }
    }

    func cancel() {
        pending.removeAll()
        // Cancellation also overrides an already-completed producer's buffered output.
        terminal = nil
        finish(error: CancellationError())
    }

    func next() async throws -> OfficialStreamDecoder.Event? {
        if !pending.isEmpty { return pending.removeFirst() }
        if let terminal { try terminal.get(); return nil }
        return try await withCheckedThrowingContinuation { waiter = $0 }
    }
}
