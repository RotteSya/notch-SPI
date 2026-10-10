#if DEBUG
import AppKit

/// Offline visual fixtures. No service activation, hotkeys, account, or capture requests.
/// Requires the ephemeral vault and lives in its own QA application bundle.
@MainActor
enum DesignVisualQA {
    static func start(_ scenario: String) -> NotchController {
        let defaults = UserDefaults(suiteName: "com.rottesya.notchspi.design-fixtures")!
        let controller = NotchController(activateServices: false, onboardingDefaults: defaults)
        controller.qaOnboardingPermission = { true }
        // Retry controls exercise failure recovery without capturing the user's screen.
        controller.qaScreenshotCapture = { .failure(.captureFailed) }
        controller.qaScreenshotSubmit = { _, _ in }
        controller.qaOpenPracticePage = { _ in false }
        controller.qaPinDesignPreview()
        controller.show()
        if scenario == "intake-review" {
            ScreenshotVisualQA.start(controller, localService: false, inspection: true)
            return controller
        }
        let model = controller.model
        model.answerDepth = "brief"
        model.depthLabel = L10n.depthLabel("brief")
        model.statusText = L10n.statusDone + " · " + L10n.questionsLeft(864)
        model.status = .idle
        model.answer = "FINAL: B. 60 km/h"
        let collectionCount = scenario.hasPrefix("collecting-") ? Int(scenario.suffix(1)) : nil
        let count = collectionCount ?? (["multiple", "collecting", "mixed"].contains(scenario) ? 4 : 1)
        for index in 0..<count {
            let size = scenario == "mixed" && index == 1 ? NSSize(width: 400, height: 700)
                : scenario == "mixed" && index == 2 ? NSSize(width: 1100, height: 300) : NSSize(width: 640, height: 400)
            let image = NSImage(size: size)
            image.lockFocus()
            NSColor(white: 0.96, alpha: 1).setFill()
            NSRect(origin: .zero, size: size).fill()
            let titles = ["READING / 01", "QUESTION / 02", "CHOICES / 03", "DETAIL / 04"]
            (titles[index] as NSString).draw(at: NSPoint(x: 30, y: size.height - 60),
                withAttributes: [.font: NSFont.monospacedSystemFont(ofSize: 22, weight: .medium), .foregroundColor: NSColor.darkGray])
            let contents = ["A train travels 120 km in 2 hours.\nIts speed is constant throughout the journey.",
                "What is the train’s average speed?\nExpress your answer in km/h.",
                "A. 40 km/h\nB. 60 km/h\nC. 80 km/h\nD. 120 km/h",
                "Average speed = distance ÷ time\nDistance: 120 km\nTime: 2 hours"]
            (contents[index] as NSString).draw(in: NSRect(x: 30, y: 25, width: size.width - 60, height: size.height - 110),
                withAttributes: [.font: NSFont.systemFont(ofSize: 24), .foregroundColor: NSColor.black])
            image.unlockFocus()
            if let tiff = image.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
               let data = rep.representation(using: .png, properties: [:]) {
                let url = FileManager.default.temporaryDirectory.appendingPathComponent("notchspi-design-\(UUID()).png")
                try? data.write(to: url)
                let asset = ContextAsset(id: UUID(), sessionID: UUID(), file: QuestionAssetFile(url: url),
                    sha256: "visual-fixture", width: Int(size.width), height: Int(size.height), byteCount: data.count,
                    targetFingerprint: "offline-visual-fixture", capturedAt: Date())
                model.screenshots.append(asset)
                model.screenshotImages[asset.id] = image
            }
        }
        model.screenshotStatus = L10n.t("已提交 \(model.screenshots.count) 张截图", "画像 \(model.screenshots.count) 枚を送信済み", "\(model.screenshots.count) screenshot(s) submitted")
        switch scenario {
        case "ready":
            model.screenshots = []; model.screenshotImages = [:]
            model.answer = ""; model.status = .ready; model.statusText = L10n.statusReady
        case "success": controller.qaPresentOnboarding(.success)
        case "welcome": controller.qaPresentOnboarding(.welcome)
        case "permission": controller.qaOnboardingPermission = { false }; controller.qaPresentOnboarding(.permission)
        case "working":
            model.answer = ""; model.status = .running
            controller.qaPresentOnboarding(.working)
        case "failure":
            model.answer = ""; model.status = .error
            model.captureFeedback = L10n.t("截图失败，请确认目标窗口仍然打开后重试。", "対象ウィンドウを確認し、もう一度お試しください。", "Check that the target window is still open, then try again.")
            controller.qaPresentOnboarding(.working)
        case "long":
            model.answerDepth = "guided"
            model.answer = Array(repeating: "**解题过程**\n平均速度等于路程除以时间。`120 ÷ 2 = 60`。请注意路程与时间的单位一致。", count: 16).joined(separator: "\n\n") + "\nFINAL: B. 60 km/h"
        case "multiline":
            model.answer = "FINAL: 第一空：60 km/h\n第二空：120 km\n第三空：2 h"
        case "collecting", "collecting-1", "collecting-2", "collecting-3", "collecting-4":
            model.answer = ""; model.screenshotRoundActive = true
            model.screenshotRemaining = count > 1 ? 3 : nil
            model.screenshotStatus = count == 1
                ? L10n.t("按 ⌘⇧2 继续截图 · 1 张不会自动提交", "⌘⇧2 で追加 · 1枚では自動送信しません", "Press ⌘⇧2 to add an image · one image waits for you")
                : L10n.t("已添加 \(count)/4 张 · 3 秒后自动查题", "画像 \(count)/4 枚 · 3秒後に送信", "\(count)/4 images · asking automatically in 3 seconds")
        case "reasoning":
            model.answer = "平均速度 = 路程 ÷ 时间，因此 `120 km ÷ 2 h = 60 km/h`。\nFINAL: B. 60 km/h"
        default: break
        }
        controller.setExpanded(true)
        controller.qaRefreshScreenshotLayout()
        if scenario == "motion-review" {
            let menu = NSMenu(title: "动画验收")
            for (title, action, key) in [
                ("复位展开", #selector(NotchController.qaResetMotionReview), "r"),
                ("开始收起", #selector(NotchController.qaCloseMotionReview), "b"),
                ("前进一帧（16毫秒）", #selector(NotchController.qaStepMotionReview), "n")
            ] {
                let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
                item.keyEquivalentModifierMask = [.command, .option]
                item.target = controller
                menu.addItem(item)
            }
            let item = NSMenuItem(title: "动画验收", action: nil, keyEquivalent: "")
            item.submenu = menu
            NSApp.mainMenu?.addItem(item)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { controller.qaResetMotionReview() }
        }
        if scenario == "multi-flow" {
            ScreenshotVisualQA.start(controller, localService: false)
            DispatchQueue.main.asyncAfter(deadline: .now() + 13) { [weak controller] in
                controller?.qaPressScreenshot(multiple: true)
            }
        }
        return controller
    }
}
#endif
