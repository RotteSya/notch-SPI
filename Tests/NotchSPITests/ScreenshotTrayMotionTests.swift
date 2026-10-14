import AppKit
import XCTest
@testable import NotchSPI

final class ScreenshotTrayMotionTests: XCTestCase {
    private func asset() -> ContextAsset {
        .init(id: UUID(), sessionID: UUID(),
              file: QuestionAssetFile(url: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".png")),
              sha256: "fixture", width: 640, height: 400, byteCount: 0,
              targetFingerprint: "fixture", capturedAt: Date())
    }

    @MainActor func testDeleteUndoMotionUsesLiveHitFramesAndStopsBeforeCompactLayout() throws {
        _ = NSApplication.shared
        let tray = ScreenshotTray(frame: .init(x: 0, y: 0, width: 560, height: 156))
        let panel = NSPanel(contentRect: tray.frame, styleMask: [.borderless], backing: .buffered, defer: false)
        panel.contentView = tray
        tray.qaUseManualReorderClock()
        let assets = (0..<4).map { _ in asset() }
        func update(_ list: [ContextAsset], compact: Bool = false) {
            tray.update(assets: list, images: [:], flying: [], message: "", remaining: 4,
                        cancellable: !compact, compact: compact)
            tray.layoutSubtreeIfNeeded()
        }
        update(assets)
        let original = try XCTUnwrap(tray.screenFrame(for: assets[2].id))
        update(Array(assets.dropFirst()))
        tray.qaAdvanceReorder(by: 0.11)
        let middle = try XCTUnwrap(tray.screenFrame(for: assets[2].id))
        XCTAssertLessThan(middle.minX, original.minX)
        XCTAssertEqual(middle.minY, original.minY, accuracy: 0.01)
        tray.qaAdvanceReorder(by: 1)
        let end = try XCTUnwrap(tray.screenFrame(for: assets[2].id))
        XCTAssertLessThanOrEqual(end.minX, middle.minX)
        update(assets) // undo during the same round
        tray.qaAdvanceReorder(by: 0.08)
        update(assets, compact: true)
        let compactFrame = try XCTUnwrap(tray.screenFrame(for: assets[2].id))
        tray.qaAdvanceReorder(by: 1)
        XCTAssertEqual(tray.screenFrame(for: assets[2].id), compactFrame,
                       "Old collection motion must never overwrite the answer shelf")
        panel.orderOut(nil)
    }

    @MainActor func testSwitchingPreviewsKeepsOnePausedIntervalAndCloseOnlyResumesOnce() throws {
        _ = NSApplication.shared
        let tray = ScreenshotTray(frame: .init(x: 0, y: 0, width: 560, height: 156))
        let assets = [asset(), asset()]
        tray.update(assets: assets, images: [:], flying: [], message: "", remaining: 4, cancellable: true)
        var changes: [Bool] = []
        tray.onPreviewChanged = { changes.append($0) }
        tray.showPreview(assets[0].id)
        let old = try XCTUnwrap(tray.qaPreview)
        tray.showPreview(assets[1].id)
        XCTAssertEqual(changes, [true])
        old.close()
        XCTAssertEqual(changes, [true])
        let current = try XCTUnwrap(tray.qaPreview)
        current.close(); current.close()
        XCTAssertEqual(changes, [true, false])
        XCTAssertNil(tray.qaPreview)
    }
}
