#if DEBUG
import AppKit

/// Offline visual fixtures. No service activation, hotkeys, account, or capture requests.
/// Requires the ephemeral vault and lives in its own QA application bundle.
@MainActor
enum DesignVisualQA {
    static func start(_ scenario: String) -> NotchController {
        let defaults = UserDefaults(suiteName: "com.rottesya.notchspi.design-fixtures")!
        let history = RecentQuestionStore(directory: FileManager.default.temporaryDirectory.appendingPathComponent("notchspi-history-preview-\(UUID())"))
        let controller = NotchController(activateServices: false, onboardingDefaults: defaults, recentQuestions: history)
        controller.qaOnboardingPermission = { true }
        // Retry controls exercise failure recovery without capturing the user's screen.
        controller.qaScreenshotCapture = { .failure(.captureFailed) }
        controller.qaScreenshotSubmit = { _, _ in }
        controller.qaOpenPracticePage = { _ in false }
        controller.qaPinDesignPreview()
        controller.show()
        if scenario == "month-pass" {
            controller.model.answer = ""
            controller.model.status = .ready
            controller.model.statusText = MonthPassPreview.fixture(0).headline()
            controller.setExpanded(true)
            controller.openSettings(page: .account)
            return controller
        }
        if scenario == "settings" {
            controller.openSettings(page: .general)
            return controller
        }
        if scenario == "intake-review" {
            ScreenshotVisualQA.start(controller, localService: false, inspection: true)
            return controller
        }
        let model = controller.model
        model.answerDepth = "brief"
        model.depthLabel = L10n.reasoningEffortLabel("low")
        model.statusText = L10n.statusDone + " · " + L10n.questionsLeft(864)
        model.status = .idle
        model.answer = "FINAL: B. 60 km/h"
        let collectionCount = scenario.hasPrefix("collecting-") ? Int(scenario.suffix(1)) : nil
        let count = collectionCount ?? (["expanded-answer", "history", "multiple", "collecting", "mixed"].contains(scenario) ? 4 : 1)
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
        if scenario == "reading-consistency" || scenario == "math-reading" || scenario == "reading-stability" {
            let capture = QuestionCaptureSnapshot(captureID: UUID(), sessionID: UUID(), generation: 0,
                assets: model.screenshots, expiresAt: Date().addingTimeInterval(900))
            model.answer = "**计算步骤**：平均速度 = 路程 ÷ 时间。\nFINAL: **（1）B. 60 km/h**\n（2）120 km ÷ 2 h = 60 km/h\n（3）公式：\\(v_1 = \\frac{s_1}{t_1}\\)"
            model.explanation = "**解释**\n保留题号、单位和换行。`120 / 2 = 60`\n\n" + String(repeating: "换算时检查 km 与 h，结论始终与原题一起核对。\n", count: 18) + "\n解释结束。"
            if scenario == "math-reading" || scenario == "reading-stability" {
                model.answer = #"FINAL: \(x = \frac{-b \pm \sqrt{b^2-4ac}}{2a}\)"#
                model.explanation = #"椭圆：\(\frac{x_1^2}{8}+\frac{y_2^2}{2}=1\)"# + "\n\n" + #"概率：$P(A \mid B)=\frac{P(A \cap B)}{P(B)}$"# + "\n\n" + #"\[\sum_{i=1}^{n} i = \frac{n(n+1)}{2}\]"# + "\n\n" + #"\[\int_0^1 x^2\,dx = \frac{1}{3}\]"#
            }
            if scenario == "math-reading" || scenario == "reading-stability" {
                model.explanation += "\n\n长公式：\\(" + Array(repeating: "x_1^2", count: 30).joined(separator: "+") + "\\)"
            }
            model.resultState = .review
            model.statusText = AnswerReadingContent.reviewMessage
            model.reasoningRevealed = true
            controller.qaSeedExpandedAnswer(capture)
            history.save(snapshot: capture, answer: model.answer, needsReview: true)
            history.updateExplanation(id: capture.captureID, text: model.explanation)
            controller.setExpanded(true); controller.qaRefreshScreenshotLayout()
            controller.openExpandedAnswer(); controller.openRecentQuestions()
            if scenario == "reading-stability" {
                let initial = model.explanation + "\n\n" + String(repeating: "连续阅读测试：保留当前阅读位置，不切换题目。\n", count: 40)
                model.explanation = initial
                history.updateExplanation(id: capture.captureID, text: initial)
                for index in 1...400 {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 20 + Double(index) * 0.04) { [weak controller] in
                        guard let controller else { return }
                        controller.model.explanation = initial + "\n实时解释进度：\(index) / 400"
                        if let reader = controller.qaExpandedAnswerWindow, let old = reader.content {
                            reader.update(.init(id: old.id, assets: old.assets, answer: old.answer,
                                explanation: controller.model.explanation, needsReview: old.needsReview,
                                explaining: index < 400, canExplain: false, explanationFailed: false))
                        }
                        if index % 40 == 0 {
                            history.save(snapshot: .init(captureID: UUID(), sessionID: UUID(), generation: 0,
                                assets: capture.assets, expiresAt: capture.expiresAt),
                                answer: "FINAL: 后台新题 \(index / 40)", needsReview: false)
                        }
                    }
                }
            }
            return controller
        }
        if scenario == "expanded-answer" {
            controller.qaSeedExpandedAnswer(.init(captureID: UUID(), sessionID: UUID(), generation: 0,
                assets: model.screenshots, expiresAt: Date().addingTimeInterval(900)))
            model.explanation = Array(repeating: "平均速度 = 总路程 ÷ 总时间。\n\n已知路程 120 km，时间 2 h，所以 120 ÷ 2 = 60 km/h。注意检查题目给出的单位，并与选项核对。", count: 14).joined(separator: "\n\n") + "\n\n解释结束。"
            controller.setExpanded(true)
            controller.qaRefreshScreenshotLayout()
            controller.openExpandedAnswer()
            return controller
        }
        if scenario == "history" || scenario == "history-empty" {
            if scenario == "history" {
                for index in 0..<4 {
                    let id = UUID()
                    history.save(snapshot: .init(captureID: id, sessionID: UUID(), generation: 0,
                        assets: Array(model.screenshots.prefix(index + 1)), expiresAt: Date().addingTimeInterval(900)),
                        answer: index == 2 ? "FINAL: A、C（请核对第二张图的条件）" : "FINAL: B. 60 km/h", needsReview: index == 2)
                    if index == 3 {
                        history.updateExplanation(id: id, text: "平均速度 = 路程 ÷ 时间。\n\n已知路程 120 km，时间 2 h，所以 120 ÷ 2 = 60 km/h。\n\n注意：这里使用的是总路程与总时间，单位一致。")
                    }
                }
            }
            controller.openRecentQuestions()
            return controller
        }
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
