import Foundation

/// Ordinary single-image lookup. A ready result is presented here.
/// A miss warms the model path once, with the same image.
@MainActor
final class LocalCaptureSession {
    var banks: () -> QuestionBankServing = { QuestionBankRuntime.shared }
    var selectionID: () -> String = { "" }
    var depth: () -> String = { Settings.shared.depth }
    var onPresent: (LocalAnswer, [ContextAsset], CaptureLatency) -> Void = { _, _, _ in }
    var onModel: (String, [ContextAsset], CaptureLatency) -> Void = { _, _, _ in }
    var onWarm: () -> Void = {}
    var onIdle: (String) -> Void = { _ in }
    var captureOne: (() async -> ContextAsset?)?

    private(set) var isActive = false
    private var generation: UInt64 = 0
    private var task: Task<Void, Never>?
    private var review: QuestionMatchReviewController?
    private var frozenSelection = ""
    private var frozenDepth = ""
    private var assets: [ContextAsset] = []
    private var latency: CaptureLatency?
    private var mode = "tutor"

    func cancel() {
        generation &+= 1
        task?.cancel()
        task = nil
        review?.dismiss()
        review = nil
        isActive = false
    }

    func start(mode: String, assets: [ContextAsset], latency: CaptureLatency) {
        generation &+= 1
        let token = generation
        task?.cancel()
        review?.dismiss()
        review = nil
        self.mode = mode
        self.assets = assets
        self.latency = latency
        frozenSelection = selectionID()
        frozenDepth = depth()
        isActive = true
        latency.mark(.bankLookupStarted)
        task = Task { [weak self] in
            await self?.run(token)
        }
    }

    private func fresh(_ token: UInt64) -> Bool {
        token == generation && selectionID() == frozenSelection && depth() == frozenDepth
    }

    private func run(_ token: UInt64) async {
        if assets.count != 1 {
            guard assets.isEmpty, let captured = await captureOne?(), fresh(token) else {
                stop(token, model: false)
                return
            }
            assets = [captured]
        }
        guard let asset = assets.first else { stop(token, model: false); return }
        let url = asset.file.url
        let data = await Task.detached(priority: .userInitiated) { try? Data(contentsOf: url) }.value
        guard let data, fresh(token) else { stop(token, model: false); return }
        let scope = AliasScope(imageDigests: [asset.sha256], targetID: asset.targetFingerprint, crop: "full")
        let service = banks()
        let deadline = ProcessInfo.processInfo.systemUptime + QuestionBankLimits.lookupBudget
        let outcome = await QuestionBankDeadline.run(until: deadline, fallback: LocalLookupOutcome.unavailable("timeout")) { [self] in
            let result = await service.lookup(image: data, scope: scope) { name in
                Task { @MainActor [weak self] in
                    guard let self, self.fresh(token) else { return }
                    self.markOCR(name)
                }
            }
            guard self.fresh(token), ProcessInfo.processInfo.systemUptime < deadline else { return .miss }
            if case .ready(let answer) = result {
                guard let shown = await service.requalify(answer, automatic: true) else { return .miss }
                return .ready(shown)
            }
            return result
        }
        guard fresh(token) else { return }
        latency?.mark(.bankLookupCompleted)
        switch outcome {
        case .ready(let answer):
            present(answer, token)
        case .candidates(let items, let options):
            showReview(items, options: options, conflict: false, scope: scope, token: token)
        case .conflict(let items, let options):
            showReview(items, options: options, conflict: true, scope: scope, token: token)
        case .miss, .unavailable:
            continueModel(token)
        }
    }

    private func markOCR(_ name: String) {
        if name == "ocrStarted" { latency?.mark(.ocrStarted) }
        if name == "ocrCompleted" { latency?.mark(.ocrCompleted) }
    }

    private func showReview(_ items: [LocalCandidate], options: [ExtractedOption], conflict: Bool, scope: AliasScope, token: UInt64) {
        guard fresh(token), !items.isEmpty else { continueModel(token); return }
        let panel = QuestionMatchReviewController()
        panel.onConfirm = { [weak self] candidate, labelMap in
            self?.confirm(candidate, labelMap: labelMap, scope: scope, token: token)
        }
        panel.onUseModel = { [weak self] in self?.continueModel(token) }
        panel.onCancel = { [weak self] in self?.stop(token, model: false) }
        review = panel
        task = nil
        panel.present(imageURL: assets.first?.file.url, candidates: items, currentOptions: options, conflict: conflict)
    }

    private func confirm(_ candidate: LocalCandidate, labelMap: [String: String], scope: AliasScope, token: UInt64) {
        Task { [weak self] in
            guard let self, self.fresh(token) else { return }
            let result = await self.banks().confirm(candidate: candidate, scope: scope, labelMap: labelMap)
            guard self.fresh(token) else { return }
            let requalified: LocalAnswer?
            if case .success(let answer) = result {
                requalified = await self.banks().requalify(answer, automatic: false)
            } else {
                requalified = nil
            }
            guard self.fresh(token) else { return }
            switch Self.confirmationEffect(result, requalified: requalified) {
            case .present(let shown):
                self.present(shown, token)
            case .questionChanged:
                self.stop(token, model: false, changed: true)
            case .canceled:
                self.stop(token, model: false, changed: false)
            }
        }
    }

    private func present(_ answer: LocalAnswer, _ token: UInt64) {
        guard fresh(token), let latency else { return }
        let shownAssets = assets
        generation &+= 1
        review?.dismiss()
        review = nil
        task = nil
        isActive = false
        latency.route = "local_bank"
        latency.complete(success: true)
        onPresent(answer, shownAssets, latency)
    }

    private func continueModel(_ token: UInt64) {
        guard fresh(token), let latency else { return }
        let shownAssets = assets
        let shownMode = mode
        generation &+= 1
        review?.dismiss()
        review = nil
        task = nil
        isActive = false
        onWarm()
        onModel(shownMode, shownAssets, latency)
    }

    private func stop(_ token: UInt64, model: Bool, changed: Bool = false) {
        guard token == generation else { return }
        if model { continueModel(token); return }
        generation &+= 1
        review?.dismiss()
        review = nil
        task = nil
        isActive = false
        let message = changed
            ? L10n.t("题目已变化，这次核对已关闭。", "問題が変わったため、この確認を閉じました。", "The question changed, so this check was closed.")
            : L10n.t("已取消本地核对。", "ローカル確認をキャンセルしました。", "Local check canceled.")
        onIdle(message)
    }

    static func confirmationEffect(_ result: Result<LocalAnswer, QuestionBankError>, requalified: LocalAnswer?) -> LocalConfirmationEffect {
        switch result {
        case .failure(.stale), .failure(.notFound):
            return .questionChanged
        case .failure:
            return .canceled
        case .success:
            if let requalified { return .present(requalified) }
            return .canceled
        }
    }
}

enum LocalConfirmationEffect: Equatable {
    case present(LocalAnswer)
    case questionChanged
    case canceled
}
