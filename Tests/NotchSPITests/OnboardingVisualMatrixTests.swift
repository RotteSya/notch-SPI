import AppKit
import Carbon
import XCTest
@testable import NotchSPI

final class OnboardingVisualMatrixTests: XCTestCase {
    @MainActor func testAllLanguagesStatesAndLiveContentBoundaries() throws {
        let previous = L10n.setting, single = Settings.shared.captureCombo, multiple = Settings.shared.contextCombo
        let target = Settings.shared.captureTargetBundleID, targetName = Settings.shared.captureTargetName
        defer { L10n.setting = previous; Settings.shared.captureCombo = single; Settings.shared.contextCombo = multiple; Settings.shared.captureTargetBundleID = target; Settings.shared.captureTargetName = targetName }
        Settings.shared.captureCombo = .init(keyCode: 18, modifiers: UInt32(cmdKey | shiftKey), label: "1")
        Settings.shared.contextCombo = .init(keyCode: 19, modifiers: UInt32(cmdKey | shiftKey), label: "2")
        Settings.shared.captureTargetBundleID = nil; Settings.shared.captureTargetName = nil
        let cases: [(String, NotchOnboardingStep, Int)] = [
            ("welcome", .welcome, 0), ("permission", .permission, 0), ("permission-denied", .permission, 0),
            ("permission-granted", .permission, 0), ("practice", .practice, 0), ("practice-failed", .practice, 0),
            ("capture", .capture, 0), ("working", .working, 1), ("working-failed", .working, 1),
            ("single-retake", .working, 1), ("multi-retake", .working, 2),
            ("first-answer", .firstAnswer, 1), ("multiple", .multiple, 0), ("multiple-failed", .multiple, 0),
            ("multi-capture", .multiCapture, 0), ("collecting-one", .collecting, 1), ("collecting-two", .collecting, 2),
            ("collecting-four", .collecting, 4), ("collecting-preview", .collecting, 2), ("collecting-failed", .collecting, 1),
            ("success", .success, 2), ("collecting-empty", .collecting, 0), ("collecting-capturing", .collecting, 1),
            ("collecting-undo", .collecting, 1), ("collecting-preview-one", .collecting, 1), ("capture-cancelled", .working, 0),
            ("trial", .trial, 0), ("trial-claiming", .trial, 0), ("trial-claimed", .trial, 0),
            ("trial-failed", .trial, 0), ("trial-unavailable", .trial, 0), ("trial-loading", .trial, 0),
            ("trial-expired", .trial, 0), ("trial-ineligible", .trial, 0)
        ]
        let output = ProcessInfo.processInfo.environment["NSPI_GUIDE_SNAPSHOTS"].map { URL(fileURLWithPath: $0) }
        if let output { try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true) }
        for (language, name) in [(AppLanguage.zhHans, "zh"), (.ja, "ja"), (.en, "en")] {
            L10n.setting = language
            var rendered: [(String, NSImage)] = []
            if let output {
                for multi in [false, true] { try OnboardingPractice.html(multiple: multi).write(to: output.appendingPathComponent("practice-\(name)-\(multi ? "multi" : "single").html"), atomically: true, encoding: .utf8) }
            }
            for (scenario, step, count) in cases {
                let model = TutorModel()
                model.onboardingStep = step
                if step == .trial {
                    model.onboardingTrialState = scenario == "trial-claiming" ? .claiming
                        : scenario == "trial-claimed" ? .claimed : scenario == "trial-failed" ? .failed
                        : scenario == "trial-unavailable" ? .unavailable : scenario == "trial-loading" ? .loading
                        : scenario == "trial-expired" ? .expired : scenario == "trial-ineligible" ? .ineligible : .available
                    model.onboardingTrialExpiration = "2026-10-19 11:30"
                }
                model.onboardingMultiple = [.multiple, .multiCapture, .collecting, .success].contains(step) || scenario == "multi-retake"
                model.onboardingPermissionGranted = scenario == "permission-granted"
                model.onboardingPermissionDenied = scenario == "permission-denied"
                model.onboardingPracticeFailed = scenario.hasSuffix("failed")
                model.status = step == .working ? .running : .idle
                if [.firstAnswer, .success].contains(step) { model.answer = "FINAL: B. 60 km/h" }
                model.screenshotRoundActive = step == .collecting
                model.screenshotPreviewing = scenario.hasPrefix("collecting-preview")
                model.screenshotCapturing = scenario == "collecting-capturing"
                model.screenshotUndoAvailable = scenario == "collecting-undo"
                model.screenshotRemaining = count >= 2 && step == .collecting && !model.screenshotPreviewing ? 4 : nil
                model.screenshotStatus = L10n.t("已添加 \(count)/4 张", "\(count)/4枚追加済み", "\(count)/4 images added")
                if scenario == "capture-cancelled" {
                    model.status = .idle
                    model.captureFeedback = L10n.t("截图已取消。按快捷键重新截图。", "撮影をキャンセルしました。ショートカットで撮り直せます。", "Capture canceled. Use the shortcut to capture again.")
                }
                if scenario == "working-failed" {
                    model.status = .error
                    model.captureFeedback = L10n.t("截图失败。请确认练习窗口仍然打开，再重新截图。", "撮影できませんでした。練習ウィンドウを確認し、撮り直してください。", "Capture failed. Check that the practice window is open, then capture again.")
                }
                if scenario.hasSuffix("retake") {
                    model.status = .idle; model.resultState = .retake; model.resultReason = .missingContext
                    let key = Settings.displayString(model.onboardingMultiple ? Settings.shared.contextCombo : Settings.shared.captureCombo)
                    model.statusText = L10n.t("缺少关键上下文，请补全画面后按 \(key) 重试。", "重要な文脈が不足しています。画面を含めて \(key) で再試行してください。", "Critical context is missing. Include it and press \(key) again.")
                }
                if scenario == "collecting-failed" { model.screenshotNotice = L10n.t("截图未录入，请重试。", "画像を追加できません。もう一度お試しください。", "Image not added. Please try again.") }
                for index in 0..<count {
                    let asset = ContextAsset(id: UUID(), sessionID: UUID(), file: QuestionAssetFile(url: URL(fileURLWithPath: "/tmp/guide-matrix-\(index).png")), sha256: "fixture", width: 320, height: 180, byteCount: 0, targetFingerprint: "practice", capturedAt: Date())
                    let image = NSImage(size: NSSize(width: 320, height: 180))
                    image.lockFocus(); NSColor(white: 0.95, alpha: 1).setFill(); NSRect(x: 0, y: 0, width: 320, height: 180).fill()
                    ("120 km / 2 h" as NSString).draw(at: NSPoint(x: 24, y: 90), withAttributes: [.font: NSFont.systemFont(ofSize: 22), .foregroundColor: NSColor.black])
                    image.unlockFocus()
                    model.screenshots.append(asset); model.screenshotImages[asset.id] = image
                }
                let width: CGFloat = 600
                let base = NotchOnboardingView.contentHeight(for: step, width: width)
                let answerH = model.hidesAnswer ? 0 : NotchType.answerHeight(model.displayedAnswer, presentation: NotchType.presentation(for: model), width: 560, inShelf: model.usesContentShelf)
                let height = step.showsLiveContent ? base + model.screenshotTrayHeight + (model.hidesAnswer ? 0 : max(50, answerH)) + NotchLayout.answerBottomPad : base
                let rect = NSRect(x: 0, y: 0, width: width + NotchMetrics.shadowMarginH * 2, height: height + NotchMetrics.shadowMarginBottom)
                let panel = NotchPanel(contentRect: rect)
                let view = NotchView(model: model, frameProvider: { _ in rect }, onHover: { _ in }, onCycleDepth: {}, onEditPersona: {}, onSettings: {}, onToggleReasoning: {}, onCopyAnswer: {}, onStopAuto: {})
                panel.contentView = view
                panel.onboardingActive = true
                view.qaUseManualMorphClock()
                model.expanded = true; view.refreshScreenshotTray(); view.qaAdvanceMorph(by: 1)
                view.layoutSubtreeIfNeeded(); view.onboarding.layoutSubtreeIfNeeded()
                let guide = view.onboarding
                let fields = (guide.subviews + guide.subviews.flatMap(\.subviews)).compactMap { $0 as? NSTextField }.filter { !$0.isHiddenOrHasHiddenAncestor && !$0.stringValue.isEmpty }
                for field in fields where field.maximumNumberOfLines != 1 {
                    XCTAssertGreaterThanOrEqual(field.frame.height, ceil(field.sizeThatFits(.init(width: field.frame.width, height: 10000)).height), "\(name)/\(scenario): \(field.stringValue)")
                    XCTAssertTrue(guide.bounds.contains(field.convert(field.bounds, to: guide)), "\(name)/\(scenario)")
                }
                let buttons = guide.subviews.filter { ($0 is GlowButton || $0 is NSPopUpButton) && !$0.isHiddenOrHasHiddenAncestor }
                for (i, button) in buttons.enumerated() {
                    for other in buttons.dropFirst(i + 1) { XCTAssertFalse(button.frame.intersects(other.frame), "\(name)/\(scenario) controls overlap") }
                    for field in fields where !field.isDescendant(of: button) { XCTAssertFalse(button.frame.intersects(field.convert(field.bounds, to: guide)), "\(name)/\(scenario) text overlaps control") }
                }
                if step.showsLiveContent {
                    func descendants(_ root: NSView) -> [NSView] { root.subviews + root.subviews.flatMap(descendants) }
                    let answer = try XCTUnwrap(descendants(view).first { $0 is NSScrollView }).frame
                    XCTAssertEqual(answer.minY, NotchLayout.headerHeight + (model.usesContentShelf ? 0 : model.screenshotTrayHeight) + (model.usesStatusShelf ? NotchLayout.statusInsetV : 0), accuracy: 0.1)
                    let footerTop = height - NotchOnboardingView.footerHeight(for: step)
                    XCTAssertLessThanOrEqual(answer.maxY, footerTop)
                }
                if scenario == "collecting-one" {
                    panel.makeFirstResponder(guide)
                    guide.moveKeyboardFocus(backwards: false)
                    let tray = try XCTUnwrap(guide.superview?.subviews.first { $0 is ScreenshotTray })
                    XCTAssertTrue((panel.firstResponder as? NSView)?.isDescendant(of: tray) == true, "Keyboard must reach screenshot actions during the lesson")
                }
                if let output, let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds) {
                    view.cacheDisplay(in: view.bounds, to: rep)
                    let data = try XCTUnwrap(rep.representation(using: .png, properties: [:]))
                    try data.write(to: output.appendingPathComponent("\(name)-\(scenario).png"))
                    rendered.append((scenario, NSImage(data: data)!))
                }
                panel.orderOut(nil)
            }
            if let output {
                for index in stride(from: 0, to: rendered.count, by: 3) {
                    let row = Array(rendered[index..<min(index + 3, rendered.count)])
                    let height = row.map { $0.1.size.height * 600 / $0.1.size.width }.max()! + 36
                    let sheet = NSImage(size: .init(width: 1800, height: height))
                    sheet.lockFocus(); NSColor(white: 0.12, alpha: 1).setFill(); NSRect(x: 0, y: 0, width: 1800, height: height).fill()
                    for (column, item) in row.enumerated() {
                        ("\(name) · \(item.0)" as NSString).draw(at: .init(x: column * 600 + 16, y: Int(height) - 25), withAttributes: [.font: NSFont.systemFont(ofSize: 14), .foregroundColor: NSColor.white])
                        item.1.draw(in: NSRect(x: CGFloat(column * 600), y: height - 36 - item.1.size.height * 600 / item.1.size.width, width: 600, height: item.1.size.height * 600 / item.1.size.width))
                    }
                    sheet.unlockFocus()
                    let rep = NSBitmapImageRep(data: sheet.tiffRepresentation!)!
                    try rep.representation(using: .png, properties: [:])!.write(to: output.appendingPathComponent("sheet-\(name)-\(index / 3).png"))
                }
            }
        }
    }
}
