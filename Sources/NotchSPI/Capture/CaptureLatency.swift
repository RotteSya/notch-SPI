import Foundation

/// One user action, including screenshot intake, registration and the first draw of the
/// completed answer. Monotonic offsets cannot jump when the wall clock is adjusted.
@MainActor
final class CaptureLatency {
    enum Entry: String { case single, multiple, direct, automatic }
    enum Stage: String {
        case triggered, captureReady, materialsReady, submitted, firstDelta, receiptApplied, responseCompleted, completed, renderStarted, failed
    }
    let id = UUID()
    let entry: Entry
    let channel: String
    let mode: String
    private let now: () -> TimeInterval
    private let startedAt: TimeInterval
    private(set) var offsets: [Stage: Double] = [.triggered: 0]
    private(set) var succeeded = false
    var needsCompletedDraw: Bool { succeeded && offsets[.renderStarted] == nil }
    var elapsedMS: Int { Int(max(0, (now() - startedAt) * 1_000)) }

    init(entry: Entry, channel: ServiceChannel = .official, mode: String = "tutor", triggeredAt: TimeInterval? = nil, now: @escaping () -> TimeInterval = { ProcessInfo.processInfo.systemUptime }) {
        self.entry = entry
        switch channel {
        case .official: self.channel = "official"
        case .customKey: self.channel = "custom"
        case .cli: self.channel = "cli"
        }
        self.mode = mode == "personality" ? "personality" : "tutor"
        self.now = now
        startedAt = triggeredAt ?? now()
        trace(.triggered, milliseconds: 0)
    }

    func mark(_ stage: Stage) {
        guard offsets[stage] == nil, offsets[.failed] == nil else { return }
        if stage == .renderStarted, !succeeded { return }
        let milliseconds = max(0, (now() - startedAt) * 1_000)
        offsets[stage] = milliseconds
        trace(stage, milliseconds: milliseconds)
    }

    func complete(success: Bool) {
        guard offsets[.completed] == nil, offsets[.failed] == nil else { return }
        succeeded = success
        mark(success ? .completed : .failed)
    }

    private func trace(_ stage: Stage, milliseconds: Double) {
        #if DEBUG
        // Local, explicitly enabled QA only; no new anonymous event or user content.
        guard ProcessInfo.processInfo.environment["NSPI_LATENCY_TRACE"] == "1",
              ProcessInfo.processInfo.environment["NSPI_QA_EPHEMERAL"] == "1" else { return }
        let record: [String: Any] = ["id": id.uuidString, "entry": entry.rawValue,
            "stage": stage.rawValue, "elapsed_ms": milliseconds, "channel": channel, "mode": mode, "route": "model"]
        if let json = try? JSONSerialization.data(withJSONObject: record, options: [.sortedKeys]) {
            FileHandle.standardError.write(Data("[CaptureLatency] ".utf8) + json + Data("\n".utf8))
        }
        #endif
    }
}
