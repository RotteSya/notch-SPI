import AppKit
import Carbon.HIToolbox
import XCTest
@testable import NotchSPI

final class UXOptimizationTests: XCTestCase {
    @MainActor private func image() throws -> URL {
        let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 160, pixelsHigh: 100,
            bitsPerSample: 8, samplesPerPixel: 3, hasAlpha: false, isPlanar: false,
            colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
        memset(bitmap.bitmapData!, 180, bitmap.bytesPerRow * bitmap.pixelsHigh)
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".jpg")
        try bitmap.representation(using: .jpeg, properties: [:])!.write(to: url)
        return url
    }
    @MainActor private func asset() throws -> ContextAsset {
        .init(id: UUID(), sessionID: UUID(), file: QuestionAssetFile(url: try image()), sha256: "fixture",
              width: 160, height: 100, byteCount: 1000, targetFingerprint: "fixture", capturedAt: Date())
    }
    @MainActor private func settle(_ check: () -> Bool) async throws {
        for _ in 0..<100 {
            if check() { return }
            try await Task.sleep(for: .milliseconds(10))
        }
        XCTFail("Expected state not reached")
    }

    @MainActor func testControllerPreviewRemovalUndoAndManualSubmissionUseCurrentImagesOnce() async throws {
        let controller = NotchController(activateServices: false)
        defer { controller.prepareForTermination() }
        controller.qaPreserveSettings = true
        controller.qaScreenshotCapture = { .success(.init(path: try! self.image().path, blank: false, targetFingerprint: "fixture")) }
        var clock: Double = 0, batches: [[UUID]] = []
        controller.qaScreenshotClock = { clock }
        controller.qaScreenshotSubmit = { images, _ in batches.append(images.map(\.id)) }
        for count in 1...3 {
            controller.qaPressScreenshot(multiple: true)
            try await settle { controller.model.screenshots.count == count }
        }
        let original = controller.model.screenshots.map(\.id)
        clock = 3.9; controller.qaPreviewScreenshots(true)
        clock = 14; controller.qaTickScreenshotRound()
        XCTAssertTrue(batches.isEmpty)
        controller.qaRemoveScreenshot(original[1])
        XCTAssertEqual(controller.model.screenshots.map(\.id), [original[0], original[2]])
        controller.qaUndoScreenshot()
        XCTAssertEqual(controller.model.screenshots.map(\.id), original)
        controller.qaPreviewScreenshots(false)
        clock = 17.9; controller.qaTickScreenshotRound()
        XCTAssertTrue(batches.isEmpty)
        controller.qaSubmitScreenshotRound(); controller.qaSubmitScreenshotRound()
        XCTAssertEqual(batches, [original])
        XCTAssertFalse(controller.model.screenshotUndoAvailable)
        controller.qaTickScreenshotRound()
        XCTAssertEqual(batches.count, 1)
    }

    @MainActor func testPreparedScreenshotEntersModelWithoutRecapturing() async throws {
        let controller = NotchController(activateServices: false)
        defer { controller.prepareForTermination() }
        controller.qaPreserveSettings = true
        let original = try asset()
        controller.qaCaptureModelPrep = { _ in }
        controller.qaScreenshotCapture = { XCTFail("Must not capture again"); return .failure(.captureFailed) }
        controller.qaStartPrepared([original])
        try await settle { controller.qaModelInvocations == 1 }
        XCTAssertEqual(controller.qaModelInvocations, 1)
    }

    @MainActor func testMaterialPreviewIsSeparateFromDeletionAndRetainedDeleteButtonDoesNotOwnTheFile() throws {
        let original = try asset()
        let strip = QuestionMaterialStrip(frame: .init(x: 0, y: 0, width: 600, height: 74))
        var removed: [UUID] = []
        strip.onRemove = { removed.append($0) }
        strip.update([original], explanationAvailable: false)
        strip.layoutSubtreeIfNeeded()
        let buttons = strip.subviews.compactMap { $0 as? NSButton }
        let preview = try XCTUnwrap(buttons.first { $0.title == "1" })
        let deletion = try XCTUnwrap(buttons.first { $0.title == "×" })
        XCTAssertNotEqual(preview.accessibilityLabel(), deletion.accessibilityLabel())
        XCTAssertTrue(preview.accessibilityPerformPress()); XCTAssertTrue(removed.isEmpty)
        XCTAssertTrue(deletion.accessibilityPerformPress()); XCTAssertEqual(removed, [original.id])
        strip.update([], explanationAvailable: false)
        XCTAssertNil(deletion.superview)
    }

    @MainActor func testUndoMaterialPreservesFileAndOrderThenExpiresAndCannotCrossSessions() async throws {
        var clock = Date(timeIntervalSince1970: 1_000_000)
        let store = QuestionSessionStore(now: { clock })
        store.begin(scope: "fixture", newQuestionGroup: true)
        for _ in 0..<3 { _ = try await store.adopt(path: image().path, targetFingerprint: "fixture", asReference: true) }
        let ids = store.references.map(\.id)
        let path = store.references[1].file.url.path
        store.removeReference(ids[1])
        XCTAssertTrue(FileManager.default.fileExists(atPath: path)); XCTAssertTrue(store.canUndoRemoval)
        XCTAssertTrue(store.undoRemoval()); XCTAssertEqual(store.references.map(\.id), ids)
        store.removeReference(ids[1]); clock.addTimeInterval(9)
        XCTAssertFalse(store.undoRemoval())
        store.removeReference(ids[0]); store.clear()
        XCTAssertFalse(store.undoRemoval())
    }

    @MainActor func testOnboardingExplainsTargetUsesCurrentShortcutAndHasChangeTargetAction() throws {
        let language = L10n.setting, combo = Settings.shared.captureCombo
        let target = Settings.shared.captureTargetBundleID, name = Settings.shared.captureTargetName
        defer { L10n.setting = language; Settings.shared.captureCombo = combo; Settings.shared.captureTargetBundleID = target; Settings.shared.captureTargetName = name }
        L10n.setting = .zhHans
        Settings.shared.captureCombo = HotkeyCombo(keyCode: 18, modifiers: UInt32(cmdKey | optionKey), label: "")
        Settings.shared.captureTargetBundleID = "invalid.not.running"; Settings.shared.captureTargetName = "练习应用"
        let view = NotchOnboardingView(frame: .init(x: 0, y: 0, width: 600, height: 276))
        view.update(step: .permission, granted: false, denied: true, failed: false)
        view.layoutSubtreeIfNeeded()
        let text = collect(view)
        XCTAssertTrue(text.contains("练习应用")); XCTAssertTrue(text.contains("未运行")); XCTAssertTrue(text.contains("题图"))
        let fields = descendants(view).compactMap { $0 as? NSTextField }
        let scope = try XCTUnwrap(fields.first { $0.stringValue.contains("当前捕获目标") })
        let recovery = try XCTUnwrap(fields.first { $0.stringValue.contains("尚未授权") })
        XCTAssertFalse(scope.frame.intersects(recovery.frame), "Permission scope and recovery must remain readable")
        XCTAssertLessThanOrEqual(recovery.frame.maxY, view.bounds.maxY)
        XCTAssertTrue(view.subviews.contains { ($0 as? GlowButton)?.title == "更改截图目标" && !$0.isHidden })
        view.update(step: .capture, granted: true, denied: false, failed: false)
        XCTAssertTrue(view.primary.title.contains(Settings.displayString(Settings.shared.captureCombo)))
    }
    @MainActor private func collect(_ view: NSView) -> String {
        (view as? NSTextField)?.stringValue ?? view.subviews.map { collect($0) }.joined(separator: "\n")
    }
    @MainActor private func descendants(_ view: NSView) -> [NSView] {
        view.subviews.flatMap { [$0] + descendants($0) }
    }
}
