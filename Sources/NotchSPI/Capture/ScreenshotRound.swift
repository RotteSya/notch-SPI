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
    var isActive: Bool { !items.isEmpty || captureToken != nil }

    mutating func beginCapture(now: TimeInterval) -> UUID? {
        guard captureToken == nil, items.count < Self.limit else { return nil }
        pausedRemaining = deadline.map { max(0, $0 - now) }
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
            deadline = items.count >= 2 ? now + 4 : nil
        } else {
            deadline = pausedRemaining.map { now + $0 }
        }
        pausedRemaining = nil
        return true
    }

    func remaining(now: TimeInterval) -> TimeInterval? {
        pausedRemaining ?? deadline.map { max(0, $0 - now) }
    }

    /// Clear before returning the immutable batch: reentrant ticks cannot submit it twice.
    mutating func takeDue(now: TimeInterval) -> [Item]? {
        guard captureToken == nil, let deadline, now >= deadline, items.count >= 2 else { return nil }
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
    }
}
