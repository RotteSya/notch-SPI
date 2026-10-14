import AppKit
import XCTest
@testable import NotchSPI

final class ContinuousReadingTests: XCTestCase {
    private func content(_ id: UUID, _ explanation: String, explaining: Bool = true) -> ExpandedAnswerContent {
        .init(id: id, assets: [], answer: "FINAL: B", explanation: explanation, needsReview: false,
              explaining: explaining, canExplain: true, explanationFailed: false)
    }
    @MainActor private func labels(_ reader: ExpandedAnswerWindowController) throws -> [NSTextField] {
        let root = try XCTUnwrap(reader.window?.contentView)
        root.layoutSubtreeIfNeeded()
        let scroll = try XCTUnwrap(root.subviews.compactMap { $0 as? NSScrollView }.last)
        return try XCTUnwrap(scroll.documentView as? NSStackView).arrangedSubviews.compactMap { $0 as? NSTextField }
    }
    @MainActor func testContinuousExplanationUpdatesBeforeStreamPausesAndKeepsConclusionView() async throws {
        let id = UUID()
        let base = String(repeating: "Long explanation with units 60 km/h.\n\n", count: 60)
        let active = ExpandedAnswerWindowController(content: content(id, base + "initial"))
        defer { active.close() }
        let conclusion = try XCTUnwrap(try labels(active).first { $0.stringValue == "B" })
        let scroll = try XCTUnwrap(active.window?.contentView?.subviews.compactMap { $0 as? NSScrollView }.last)
        scroll.contentView.scroll(to: NSPoint(x: 0, y: 300))
        let readingY = scroll.contentView.bounds.minY
        let host = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 300, height: 150),
            styleMask: [.titled], backing: .buffered, defer: false)
        host.isReleasedWhenClosed = false
        let typing = NSTextView(frame: NSRect(x: 0, y: 0, width: 300, height: 150))
        host.contentView = typing
        host.makeKeyAndOrderFront(nil)
        XCTAssertTrue(host.makeFirstResponder(typing))
        defer { host.close() }
        var sawIntermediate = false
        for i in 1...20 {
            active.update(content(id, base + "stream step \(i)"))
            try await Task.sleep(nanoseconds: 20_000_000)
            if try labels(active).contains(where: { $0.stringValue.contains("stream step") }) { sawIntermediate = true }
        }
        XCTAssertTrue(sawIntermediate, "Continuous chunks must not postpone every display update")
        try await Task.sleep(nanoseconds: 120_000_000)
        XCTAssertTrue(try labels(active).contains { $0.stringValue == base + "stream step 20" })
        XCTAssertTrue(try labels(active).contains { $0 === conclusion }, "Unchanged selectable text must survive refreshes")
        XCTAssertEqual(scroll.contentView.bounds.minY, readingY, accuracy: 1)
        XCTAssertTrue(host.firstResponder === typing)
        XCTAssertFalse(active.window?.isKeyWindow ?? true)
    }
    @MainActor func testHistoryInsertionPreservesSelectedDetailScrollAndVisibleListAnchor() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let store = RecentQuestionStore(directory: directory)
        let reader = RecentQuestionsWindowController(store: store)
        defer { reader.close(); try? FileManager.default.removeItem(at: directory) }
        await store.flush()
        try await Task.sleep(nanoseconds: 30_000_000)
        let emptyRoot = try XCTUnwrap(reader.window?.contentView)
        let emptyDetail = try XCTUnwrap(emptyRoot.subviews.compactMap { $0 as? NSScrollView }.last?.documentView as? NSStackView)
        XCTAssertFalse(emptyDetail.arrangedSubviews.isEmpty, "Empty history must retain its helpful empty state")
        let text = String(repeating: "Explanation with units and readable formula \\(x_1^2+2=4\\).\n\n", count: 60)
        var records = (0..<40).map { RecentQuestion(id: UUID(), createdAt: Date(), answer: "FINAL: Answer \($0)", explanation: text, needsReview: false, imageCount: 0) }
        reader.applyRecords(records, failed: false)
        let root = try XCTUnwrap(reader.window?.contentView)
        root.layoutSubtreeIfNeeded()
        let scrolls = root.subviews.compactMap { $0 as? NSScrollView }
        let list = try XCTUnwrap(scrolls.first), detail = try XCTUnwrap(scrolls.last)
        let table = try XCTUnwrap(list.documentView as? NSTableView)
        table.selectRowIndexes(IndexSet(integer: 12), byExtendingSelection: false)
        root.layoutSubtreeIfNeeded()
        list.contentView.scroll(to: NSPoint(x: 0, y: table.rect(ofRow: 10).minY + 5))
        detail.contentView.scroll(to: NSPoint(x: 0, y: 350))
        let y = detail.contentView.bounds.minY
        let visibleID = records[table.row(at: list.contentView.bounds.origin)].id
        let oldViews = try XCTUnwrap(detail.documentView as? NSStackView).arrangedSubviews
        let focus = reader.window?.firstResponder
        records.insert(.init(id: UUID(), createdAt: Date(), answer: "FINAL: New", explanation: "", needsReview: false, imageCount: 0), at: 0)
        reader.applyRecords(records, failed: false)
        root.layoutSubtreeIfNeeded()
        XCTAssertEqual(table.selectedRow, 13)
        XCTAssertEqual(detail.contentView.bounds.minY, y, accuracy: 1)
        XCTAssertEqual(records[table.row(at: list.contentView.bounds.origin)].id, visibleID)
        let current = try XCTUnwrap(detail.documentView as? NSStackView).arrangedSubviews
        XCTAssertEqual(current.count, oldViews.count)
        XCTAssertTrue(zip(current, oldViews).allSatisfy { $0 === $1 })
        XCTAssertTrue(reader.window?.firstResponder === focus)
        records[13].explanation += "\nNew explanation detail"
        reader.applyRecords(records, failed: false)
        root.layoutSubtreeIfNeeded()
        XCTAssertEqual(detail.contentView.bounds.minY, y, accuracy: 1)
    }
    @MainActor func testHistorySwitchRestoresEachRecordAndClampsShortenedContent() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let store = RecentQuestionStore(directory: directory)
        let reader = RecentQuestionsWindowController(store: store)
        defer { reader.close(); try? FileManager.default.removeItem(at: directory) }
        await store.flush()
        try await Task.sleep(nanoseconds: 30_000_000)
        let text = String(repeating: "Long explanation keeps the reading location.\n\n", count: 100)
        var records = (0..<2).map { RecentQuestion(id: UUID(), createdAt: Date(), answer: "FINAL: Answer \($0)", explanation: text, needsReview: false, imageCount: 0) }
        reader.applyRecords(records, failed: false)
        let root = try XCTUnwrap(reader.window?.contentView)
        root.layoutSubtreeIfNeeded()
        let scrolls = root.subviews.compactMap { $0 as? NSScrollView }
        let table = try XCTUnwrap(scrolls.first?.documentView as? NSTableView)
        let detail = try XCTUnwrap(scrolls.last)
        detail.contentView.scroll(to: NSPoint(x: 0, y: 300))
        table.selectRowIndexes(IndexSet(integer: 1), byExtendingSelection: false)
        root.layoutSubtreeIfNeeded()
        XCTAssertEqual(detail.contentView.bounds.minY, 0, accuracy: 1)
        detail.contentView.scroll(to: NSPoint(x: 0, y: 500))
        table.selectRowIndexes(IndexSet(integer: 0), byExtendingSelection: false)
        root.layoutSubtreeIfNeeded()
        XCTAssertEqual(detail.contentView.bounds.minY, 300, accuracy: 1)
        table.selectRowIndexes(IndexSet(integer: 1), byExtendingSelection: false)
        root.layoutSubtreeIfNeeded()
        XCTAssertEqual(detail.contentView.bounds.minY, 500, accuracy: 1)
        records[1].explanation = "Short explanation."
        reader.applyRecords(records, failed: false)
        root.layoutSubtreeIfNeeded()
        XCTAssertEqual(detail.contentView.bounds.minY, 0, accuracy: 1)
        XCTAssertEqual(detail.layer?.cornerRadius, 18)
    }

    @MainActor func testRepeatedReaderCreationAndPendingUpdatesReleaseControllers() async throws {
        weak var last: ExpandedAnswerWindowController?
        let long = String(repeating: "Long explanation \\(\\frac{x_1^2}{2}+1\\).\n", count: 50)
        let started = CFAbsoluteTimeGetCurrent()
        for _ in 0..<30 {
            autoreleasepool {
                let id = UUID()
                let reader = ExpandedAnswerWindowController(content: content(id, long))
                last = reader
                reader.update(content(id, long + "next"))
                reader.detachFromCurrentQuestion()
                reader.close()
            }
        }
        try await Task.sleep(nanoseconds: 120_000_000)
        XCTAssertNil(last)
        print("Continuous reading: 30 long-formula reader lifecycles in \(CFAbsoluteTimeGetCurrent() - started)s; final controller released")
    }
}
