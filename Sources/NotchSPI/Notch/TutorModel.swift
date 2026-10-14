import Combine
import Foundation
import AppKit

/// Observable state the notch renders. Mutated on the main thread by the controller's pipeline.
/// `ObservableObject` / `@Published` are Combine types — the notch is pure AppKit and observes
/// this via `objectWillChange`, no SwiftUI involved.
@MainActor
final class TutorModel: ObservableObject {
    @Published var onboardingStep: NotchOnboardingStep?
    @Published var onboardingPracticeFailed = false
    var onboardingContentHeight: CGFloat? {
        guard let step = onboardingStep else { return nil }
        return step.height
    }
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
    @Published var explanationFailed = false
    @Published var recoveryAvailable = false
    @Published var recoveryAttempted = false
    var renderedAnswer: String {
        AnswerReadingContent(answer: answer, explanation: explanation).notchText
    }
    var canExpandAnswer: Bool {
        mode == "tutor" && onboardingStep == nil && status == .idle && !hidesAnswer
            && !screenshotCapturing && captureFeedback.isEmpty && resultState != .retake
            && !answer.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && answer != L10n.noOutput
    }
    @Published var screenshots: [ContextAsset] = []
    var screenshotImages: [UUID: NSImage] = [:]
    @Published var flyingScreenshots: Set<UUID> = []
    @Published var screenshotStatus = ""
    @Published var screenshotRemaining: TimeInterval?
    @Published var screenshotRoundActive = false
    @Published var screenshotUndoAvailable = false
    @Published var materialUndoAvailable = false
    var showScreenshotTray: Bool { screenshotRoundActive || !screenshots.isEmpty }
    @Published var screenshotPreviewing = false
    @Published var screenshotCapturing = false
    @Published var screenshotNotice = ""
    @Published var captureFeedback = ""
    // Keep the preceding answer alive for its request, but never present it as this round's answer.
    var hidesAnswer: Bool { screenshotRoundActive || (showScreenshotTray && answer.isEmpty && !isStatusMessage) }
    var displayedAnswer: String {
        if !captureFeedback.isEmpty { return captureFeedback }
        if mode == "personality", status == .error {
            let choices = PersonalityAnswer.compose(raw: answer, streaming: false).visibleChoices
            return choices.isEmpty
                ? L10n.t("未收到可用选项。请确认截图包含完整题目和选项，再重新截图。", "有効な選択肢がありません。問題と選択肢全体を含めて再度撮影してください。", "No usable choices returned. Capture the complete question and all its options again.")
                : choices
        }
        // A protocol-only retake has no answer text. Its actionable reason lives in
        // statusText; the compact heading alone cannot explain what needs fixing.
        if (resultState == .retake || status == .error),
           !statusText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return statusText
        }
        return renderedAnswer
    }
    var materialStripHeight: CGFloat {
        guard showMaterialStrip else { return 0 }
        let base: CGFloat = materials.isEmpty ? CaptureStyle.actionHeight : 74
        return base + (materialUndoAvailable ? 30 : 0)
    }
    /// Presentation only: preserve capture slots until the last flight lands, then
    /// keep readable content above a compact reference strip throughout streaming.
    var usesAnswerShelf: Bool {
        mode == "tutor" && (onboardingStep == nil || onboardingStep?.showsLiveContent == true) && !screenshotRoundActive
            && !screenshotCapturing && flyingScreenshots.isEmpty && !hidesAnswer
            && captureFeedback.isEmpty && screenshotNotice.isEmpty && !screenshotUndoAvailable
            && status != .error && resultState != .retake
            && !answer.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
    /// Message semantics stay separate from successful answer semantics.
    var isStatusMessage: Bool { status == .error || resultState == .retake || !captureFeedback.isEmpty }
    var usesStatusShelf: Bool {
        mode == "tutor" && (onboardingStep == nil || onboardingStep?.showsLiveContent == true) && !screenshotRoundActive
            && !screenshotCapturing && flyingScreenshots.isEmpty && !hidesAnswer
            && screenshotNotice.isEmpty && !screenshotUndoAvailable && isStatusMessage
            && !displayedAnswer.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
    var usesContentShelf: Bool { usesAnswerShelf || usesStatusShelf }
    var showsWaitingSurface: Bool {
        mode == "tutor" && (onboardingStep == nil || onboardingStep?.showsLiveContent == true) && !screenshotRoundActive
            && !screenshotCapturing && flyingScreenshots.isEmpty && showScreenshotTray
            && answer.isEmpty && captureFeedback.isEmpty && status == .running
    }
    var screenshotTrayHeight: CGFloat {
        guard showScreenshotTray else { return 0 }
        return usesContentShelf ? CaptureStyle.referenceHeight : CaptureStyle.trayHeight
    }
    var materialAreaHeight: CGFloat { screenshotTrayHeight + materialStripHeight }
    /// Compact visual status; detailed service messages remain available to accessibility.
    var captureHeading: String {
        if screenshotRoundActive {
            if screenshotCapturing { return L10n.t("截图中", "撮影中", "Capturing") }
            if screenshotPreviewing { return L10n.t("已暂停", "一時停止", "Paused") }
            if let remaining = screenshotRemaining {
                if remaining <= 0 { return L10n.t("等待提交", "送信待ち", "Queued") }
                let seconds = Int(ceil(remaining))
                return L10n.t("\(seconds) 秒后查题", "\(seconds)秒後に送信", "Asking in \(seconds)s")
            }
            return L10n.t("等待下一张", "次の画像待ち", "Next image")
        }
        if !captureFeedback.isEmpty { return status == .error ? L10n.t("未完成", "未完了", "Incomplete") : L10n.t("已取消", "キャンセル済み", "Canceled") }
        if resultState == .retake { return L10n.t("需要重拍", "再撮影が必要", "Retake needed") }
        if status == .error { return L10n.t("未完成", "未完了", "Incomplete") }
        if explanationLoading { return L10n.t("解释中", "解説中", "Explaining") }
        if recoveryAttempted && status == .running { return L10n.t("恢复中", "復元中", "Recovering") }
        return statusText
    }
    var captureStatusDetail: String {
        if screenshotRoundActive { return screenshotNotice.isEmpty ? screenshotStatus : screenshotNotice }
        return captureFeedback.isEmpty ? statusText : captureFeedback
    }
    var screenshotHint: String {
        if !screenshotNotice.isEmpty { return screenshotNotice }
        guard screenshotRoundActive, !screenshotCapturing, !screenshotPreviewing, screenshotRemaining == nil else { return "" }
        let key = Settings.displayString(Settings.shared.contextCombo)
        return L10n.t("\(key) 继续截图", "\(key) で追加", "\(key) to add")
    }
    @Published var materials: [ContextAsset] = []
    var showMaterialStrip: Bool { onboardingStep == nil && !screenshotRoundActive && (materialUndoAvailable || !materials.isEmpty || resultState == .retake || status == .error || (mode == "tutor" && explanationAvailable)) }
    @Published var expanded = false
    @Published var status: Status = .ready
    @Published var statusText = ""
    var answerLatency: CaptureLatency?
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
