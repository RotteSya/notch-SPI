import Foundation
import CryptoKit

enum OfficialCaptureDeadline {
    static let total: TimeInterval = 120
    static let inactivity: TimeInterval = 8
    static let recovery: TimeInterval = 20
    static let generation: TimeInterval = 90
    static let retention: TimeInterval = 900
}

/// Short-lived restart journal. The request (including images) is encrypted with an
/// account-bound key; no credential is written to disk. Explicit cancellation deletes it.
final class PendingCaptureStore: @unchecked Sendable {
    struct Entry: Codable, Equatable {
        let id: UUID
        let createdAt: Date
        let body: Data
        let mode: String
        let structured: Bool
        let screenQuery: Bool
    }
    static let shared = PendingCaptureStore(directory: RecentQuestionStore.defaultDirectory
        .deletingLastPathComponent().appendingPathComponent("PendingCaptures", isDirectory: true))
    let directory: URL
    private let lock = NSLock()
    private var terminating = false
    var preservesCancellation: Bool { lock.lock(); defer { lock.unlock() }; return terminating }
    func preserveForTermination(_ value: Bool) { lock.lock(); terminating = value; lock.unlock() }
    init(directory: URL) { self.directory = directory }
    private func key(_ account: OfficialAPI.CaptureAccount) -> SymmetricKey {
        SymmetricKey(data: SHA256.hash(data: Data(("NotchSPI/pending/v1/" + account.baseURL + "/" + account.token).utf8)))
    }
    private func owner(_ account: OfficialAPI.CaptureAccount) -> String {
        SHA256.hash(data: Data((account.baseURL + "/" + account.token).utf8)).map { String(format: "%02x", $0) }.joined()
    }
    private func url(_ id: UUID, _ account: OfficialAPI.CaptureAccount) -> URL {
        directory.appendingPathComponent(owner(account) + "-" + id.uuidString + ".pending")
    }
    func save(_ entry: Entry, account: OfficialAPI.CaptureAccount) throws {
        lock.lock(); defer { lock.unlock() }
        guard entry.body.count <= OfficialCaptureMaterials.requestBodyLimit else { throw URLError(.dataLengthExceedsMaximum) }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let encrypted = try AES.GCM.seal(JSONEncoder().encode(entry), using: key(account)).combined!
        let path = url(entry.id, account)
        try encrypted.write(to: path, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: path.path)
    }
    func pending(account: OfficialAPI.CaptureAccount, now: Date = Date()) -> [Entry] {
        lock.lock(); defer { lock.unlock() }
        let files = (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.contentModificationDateKey])) ?? []
        var entries: [Entry] = []
        for path in files where path.pathExtension == "pending" {
            let modified = (try? path.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
            if now.timeIntervalSince(modified) >= OfficialCaptureDeadline.retention { try? FileManager.default.removeItem(at: path); continue }
            guard path.lastPathComponent.hasPrefix(owner(account) + "-") else { continue }
            guard let data = try? Data(contentsOf: path), data.count <= OfficialCaptureMaterials.requestBodyLimit * 2,
                  let box = try? AES.GCM.SealedBox(combined: data),
                  let plain = try? AES.GCM.open(box, using: key(account)),
                  let entry = try? JSONDecoder().decode(Entry.self, from: plain),
                  url(entry.id, account).lastPathComponent == path.lastPathComponent else { continue }
            if now.timeIntervalSince(entry.createdAt) >= OfficialCaptureDeadline.retention { try? FileManager.default.removeItem(at: path); continue }
            entries.append(entry)
        }
        return entries.sorted { $0.createdAt > $1.createdAt }
    }
    func remove(_ id: UUID, account: OfficialAPI.CaptureAccount) {
        lock.lock(); defer { lock.unlock() }
        try? FileManager.default.removeItem(at: url(id, account))
    }
}
