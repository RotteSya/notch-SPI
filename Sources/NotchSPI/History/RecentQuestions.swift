import Foundation

/// Local, completed answers only. No credentials, prompts, telemetry or network operations.
struct RecentQuestion: Codable, Equatable, Identifiable {
    let id: UUID
    let createdAt: Date
    var answer: String
    var explanation: String
    var needsReview: Bool
    let imageCount: Int

    var conclusion: String { AnswerComposer.clipboardAnswer(answer) ?? answer }
    var detail: String {
        let parsed = AnswerComposer.parse(answer, streaming: false)
        let body = [parsed.working, parsed.overflow].filter { !$0.isEmpty }.joined(separator: "\n\n")
        let extra = AnswerComposer.parse(explanation, streaming: false)
        return [body, extra.working, extra.final, extra.overflow]
            .compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: "\n\n")
    }
}

/// All disk work is serialized off the main thread. Retaining the snapshot keeps temporary
/// images alive until their independent history copies have been committed.
final class RecentQuestionStore: @unchecked Sendable {
    static let changed = Notification.Name("RecentQuestionStore.changed")
    static let shared = RecentQuestionStore(directory: defaultDirectory)
    static var defaultDirectory: URL {
        if ProcessInfo.processInfo.environment["NSPI_QA_EPHEMERAL"] == "1" {
            return FileManager.default.temporaryDirectory.appendingPathComponent("notchspi-history-qa-\(ProcessInfo.processInfo.processIdentifier)")
        }
        return FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("NotchSPI/RecentQuestions", isDirectory: true)
    }
    let directory: URL
    private let queue = DispatchQueue(label: "NotchSPI.recentQuestions", qos: .utility)
    private let limit: Int
    private let lifetime: TimeInterval
    private let byteLimit: Int
    private let now: () -> Date
    private var records: [RecentQuestion] = []
    private var loaded = false
    private var failure = false

    init(directory: URL, limit: Int = 100, lifetime: TimeInterval = 30 * 86400,
         byteLimit: Int = 200 * 1024 * 1024, now: @escaping () -> Date = Date.init) {
        self.directory = directory; self.limit = limit; self.lifetime = lifetime
        self.byteLimit = byteLimit; self.now = now
    }

    func imageURL(for record: RecentQuestion, index: Int) -> URL {
        folder(record.id).appendingPathComponent("\(index).jpg")
    }
    private func folder(_ id: UUID) -> URL { directory.appendingPathComponent(id.uuidString, isDirectory: true) }
    private func metadata(_ id: UUID) -> URL { folder(id).appendingPathComponent("record.json") }

    func list(_ completion: @escaping ([RecentQuestion], Bool) -> Void) {
        queue.async {
            self.perform(resetFailure: false) { try self.load(); try self.prune() }
            let values = self.records, failed = self.failure
            DispatchQueue.main.async { completion(values, failed) }
        }
    }

    func flush() async {
        await withCheckedContinuation { continuation in queue.async { continuation.resume() } }
    }

    func save(snapshot: QuestionCaptureSnapshot, answer: String, needsReview: Bool) {
        // A partial stream, retake or failed request must never arrive here.
        guard !answer.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              !snapshot.assets.isEmpty, snapshot.assets.count <= 4 else { return }
        queue.async {
            defer { withExtendedLifetime(snapshot) {} }
            self.perform {
                try self.load()
                if let index = self.records.firstIndex(where: { $0.id == snapshot.captureID }) {
                    var record = self.records[index]
                    if record.answer != answer { record.explanation = "" }
                    record.answer = answer; record.needsReview = needsReview
                    try self.write(record, to: self.metadata(record.id))
                    self.records[index] = record
                } else {
                    let record = RecentQuestion(id: snapshot.captureID, createdAt: self.now(),
                        answer: answer, explanation: "", needsReview: needsReview, imageCount: snapshot.assets.count)
                    let staging = self.directory.appendingPathComponent("pending-\(UUID().uuidString)")
                    try FileManager.default.createDirectory(at: staging, withIntermediateDirectories: true,
                                                           attributes: [.posixPermissions: 0o700])
                    defer { try? FileManager.default.removeItem(at: staging) }
                    for (index, asset) in snapshot.assets.enumerated() {
                        let destination = staging.appendingPathComponent("\(index).jpg")
                        try FileManager.default.copyItem(at: asset.file.url, to: destination)
                        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: destination.path)
                    }
                    try self.write(record, to: staging.appendingPathComponent("record.json"))
                    try FileManager.default.moveItem(at: staging, to: self.folder(record.id))
                    self.records.insert(record, at: 0)
                }
                try self.prune()
            }
            self.publish()
        }
    }

    func updateExplanation(id: UUID, text: String) {
        queue.async {
            self.perform {
                try self.load(); try self.prune()
                // Deleting a record wins over a late explanation completion.
                guard let index = self.records.firstIndex(where: { $0.id == id }) else { return }
                var record = self.records[index]; record.explanation = text
                try self.write(record, to: self.metadata(id)); self.records[index] = record
                try self.prune()
            }
            self.publish()
        }
    }

    func delete(id: UUID?) {
        queue.async {
            self.perform {
                try self.load()
                for record in self.records where id == nil || record.id == id {
                    try FileManager.default.removeItem(at: self.folder(record.id))
                    self.records.removeAll { $0.id == record.id }
                }
            }
            self.publish()
        }
    }

    private func write(_ record: RecentQuestion, to url: URL) throws {
        try JSONEncoder().encode(record).write(to: url, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    }

    private func load() throws {
        guard !loaded else { return }
        let fm = FileManager.default
        try fm.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        var found: [RecentQuestion] = []
        for url in try fm.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) {
            if url.lastPathComponent.hasPrefix("pending-") { try fm.removeItem(at: url); continue }
            guard let id = UUID(uuidString: url.lastPathComponent) else { continue }
            guard let data = try? Data(contentsOf: url.appendingPathComponent("record.json")),
                  let record = try? JSONDecoder().decode(RecentQuestion.self, from: data), record.id == id,
                  (1...4).contains(record.imageCount),
                  (0..<record.imageCount).allSatisfy({ fm.fileExists(atPath: imageURL(for: record, index: $0).path) }) else {
                try fm.removeItem(at: url); continue
            }
            found.append(record)
        }
        records = found.sorted { $0.createdAt > $1.createdAt }; loaded = true
    }

    private func prune() throws {
        var bytes = 0
        for (index, record) in records.enumerated() {
            let files = try FileManager.default.contentsOfDirectory(at: folder(record.id), includingPropertiesForKeys: [.fileSizeKey])
            bytes += try files.reduce(0) { try $0 + ($1.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0) }
            if index >= limit || now().timeIntervalSince(record.createdAt) >= lifetime || bytes > byteLimit {
                try FileManager.default.removeItem(at: folder(record.id))
                records.removeAll { $0.id == record.id }
            }
        }
    }
    private func perform(resetFailure: Bool = true, _ work: () throws -> Void) {
        do { try work(); if resetFailure { failure = false } }
        catch { failure = true } // Never replace a successful live answer with a history I/O error.
    }
    private func publish() {
        DispatchQueue.main.async { NotificationCenter.default.post(name: Self.changed, object: self) }
    }
}
