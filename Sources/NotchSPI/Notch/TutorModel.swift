import Combine
import Foundation
import AppKit

/// Observable state the notch renders. Mutated on the main thread by the controller's pipeline.
/// `ObservableObject` / `@Published` are Combine types — the notch is pure AppKit and observes
/// this via `objectWillChange`, no SwiftUI involved.
@MainActor
final class TutorModel: ObservableObject {
    @Published var onboardingStep: NotchOnboardingStep?
    @Published var onboardingPermissionGranted = false
    @Published var onboardingPermissionDenied = false

    enum Status {
        case idle, ready, running, streaming, error
    }

    // Display strings start empty and are populated by NotchController from L10n on init,
    // so no hardcoded-language defaults can ever flash on screen.
    @Published var explanation = ""
    @Published var explanationAvailable = false
    @Published var explanationAttempted = false
    @Published var explanationLoading = false
    @Published var recoveryAvailable = false
    @Published var recoveryAttempted = false
    var renderedAnswer: String {
        guard !explanation.isEmpty, let final = AnswerComposer.parse(answer, streaming: false).final else { return answer }
        return explanation + "\nFINAL: " + final
    }
    @Published var screenshots: [ContextAsset] = []
    var screenshotImages: [UUID: NSImage] = [:]
    @Published var flyingScreenshots: Set<UUID> = []
    @Published var screenshotStatus = ""
    @Published var screenshotRemaining: TimeInterval?
    @Published var screenshotRoundActive = false
    var showScreenshotTray: Bool { screenshotRoundActive || !screenshots.isEmpty }
    @Published var screenshotCapturing = false
    @Published var screenshotNotice = ""
    @Published var captureFeedback = ""
    // Keep the preceding answer alive for its request, but never present it as this round's answer.
    var hidesAnswer: Bool { screenshotRoundActive || (showScreenshotTray && answer.isEmpty && captureFeedback.isEmpty) }
    var displayedAnswer: String {
        if !captureFeedback.isEmpty { return captureFeedback }
        if mode == "personality", status == .error {
            let choices = PersonalityAnswer.compose(raw: answer, streaming: false).visibleChoices
            return choices.isEmpty
                ? L10n.t("未收到可用选项。请确认截图包含完整题目和选项，再重新截图。", "有効な選択肢がありません。問題と選択肢全体を含めて再度撮影してください。", "No usable choices returned. Capture the complete question and all its options again.")
                : choices
        }
        return renderedAnswer
    }
    var materialStripHeight: CGFloat { showMaterialStrip ? (materials.isEmpty ? CaptureStyle.actionHeight : 74) : 0 }
    var materialAreaHeight: CGFloat { (showScreenshotTray ? CaptureStyle.trayHeight : 0) + materialStripHeight }
    var captureHeading: String {
        if screenshotRoundActive {
            if screenshotCapturing { return L10n.t("正在捕获", "キャプチャ中", "Capturing") }
            if screenshotRemaining != nil { return L10n.t("即将提问", "まもなく送信", "Asking soon") }
            return L10n.t("等待下一张", "次の画像を待機", "Waiting for next image")
        }
        if !captureFeedback.isEmpty { return status == .error ? L10n.t("未能完成", "完了できませんでした", "Could not complete") : L10n.t("已取消", "キャンセル済み", "Canceled") }
        return statusText
    }
    @Published var materials: [ContextAsset] = []
    var showMaterialStrip: Bool { onboardingStep == nil && !screenshotRoundActive && (!materials.isEmpty || resultState == .retake || status == .error || (mode == "tutor" && explanationAvailable)) }
    @Published var expanded = false
    @Published var status: Status = .ready
    @Published var statusText = ""
    @Published var answer = "" // streamed markdown text
    @Published var cliLabel = ""
    @Published var depthLabel = ""
    @Published var answerDepth = "guided" // depth the CURRENT answer was captured with (frozen per run)
    @Published var reasoningRevealed = false // brief mode: the folded scratch work is open
    @Published var resultState: ObjectiveResultState?
    @Published var resultReason: ObjectiveResultReason?
    @Published var parserPath: ObjectiveParserPath = .none
    @Published var mode = "tutor"        // active mode id: "tutor" | "personality"
    @Published var personaLabel = ""      // current persona name (empty = not set)
    @Published var autoActive = false    // an auto session is live (any phase)
    @Published var autoProgress = ""     // "3/20" while autoActive; capsule + status suffix
}
