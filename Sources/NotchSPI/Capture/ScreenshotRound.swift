import Foundation

/// One local intake round. All times are monotonic seconds; animation never owns a deadline.
/// A capture token fences late picker/file callbacks after cancellation or a new round.
struct ScreenshotRound<Item> {
    static var limit: Int { 4 } // Existing official-service image contract.
    private(set) var id = UUID()
    private(set) var items: [Item] = []
    private(set) var captureToken: UUID?
    private(set) var deadline: TimeInterval?
    private(set) var pausedRemaining: TimeInterval?
    private(set) var previewing = false
    var isActive: Bool { !items.isEmpty || captureToken != nil }

    mutating func beginCapture(now: TimeInterval) -> UUID? {
        guard captureToken == nil, items.count < Self.limit else { return nil }
        if !previewing { pausedRemaining = deadline.map { max(0, $0 - now) } }
        deadline = nil
        let token = UUID()
        captureToken = token
        return token
    }

    @discardableResult
    mutating func finishCapture(token: UUID, item: Item?, now: TimeInterval) -> Bool {
        guard captureToken == token else { return false }
        captureToken = nil
        if let item {
            items.append(item)
            deadline = items.count >= 2 && !previewing ? now + 4 : nil
        } else {
            deadline = previewing ? nil : pausedRemaining.map { now + $0 }
        }
        pausedRemaining = nil
        return true
    }

    func remaining(now: TimeInterval) -> TimeInterval? {
        pausedRemaining ?? deadline.map { max(0, $0 - now) }
    }

    /// Clear before returning the immutable batch: reentrant ticks cannot submit it twice.
    mutating func takeDue(now: TimeInterval) -> [Item]? {
        guard !previewing, captureToken == nil, let deadline, now >= deadline, items.count >= 2 else { return nil }
        let batch = items
        cancel()
        return batch
    }

    mutating func setPreviewing(_ value: Bool, now: TimeInterval) {
        guard value != previewing else { return }
        previewing = value
        if value { deadline = nil; pausedRemaining = nil }
        else if captureToken == nil { deadline = items.count >= 2 ? now + 4 : nil }
    }

    mutating func remove(at index: Int, now: TimeInterval) -> Item? {
        guard captureToken == nil, items.indices.contains(index) else { return nil }
        let item = items.remove(at: index)
        deadline = items.count >= 2 && !previewing ? now + 4 : nil
        pausedRemaining = nil
        return item
    }

    mutating func restore(_ item: Item, at index: Int, now: TimeInterval) -> Bool {
        guard captureToken == nil, items.count < Self.limit else { return false }
        items.insert(item, at: min(max(0, index), items.count))
        deadline = items.count >= 2 && !previewing ? now + 4 : nil
        return true
    }

    mutating func takeNow() -> [Item]? {
        guard captureToken == nil, items.count >= 2 else { return nil }
        let batch = items
        cancel()
        return batch
    }

    mutating func cancel() {
        id = UUID()
        items = []
        captureToken = nil
        deadline = nil
        pausedRemaining = nil
        previewing = false
    }
}
