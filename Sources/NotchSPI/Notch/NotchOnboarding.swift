import AppKit

/// Durable checkpoints are separate from presentation. Closing never invents a first success;
/// an interrupted request resumes at the instructions, not at an orphaned spinner.
enum NotchOnboardingStep: String {
    case welcome, permission, capture, working, success
    var checkpoint: String { self == .working || self == .success ? "capture" : rawValue }
    var showsLiveContent: Bool { self == .working || self == .success }
    var height: CGFloat {
        switch self {
        case .welcome: return 354
        case .permission: return 404
        case .capture: return 354
        case .working: return 160
        case .success: return 160
        }
    }
}

struct NotchOnboardingProgress {
    let defaults: UserDefaults
    var isComplete: Bool { defaults.bool(forKey: "onboardingDone") }
    var shouldPresent: Bool {
        !defaults.bool(forKey: "onboardingDone") && !defaults.bool(forKey: "onboarding.v3.dismissed")
    }
    var resumeStep: NotchOnboardingStep {
        let step = NotchOnboardingStep(rawValue: defaults.string(forKey: "onboarding.v3.step") ?? "") ?? .welcome
        return step.showsLiveContent ? .capture : step
    }
    func save(_ step: NotchOnboardingStep) { defaults.set(step.checkpoint, forKey: "onboarding.v3.step") }
    func dismiss() { defaults.set(true, forKey: "onboarding.v3.dismissed") }
    func complete() {
        defaults.set(true, forKey: "onboardingDone")
        defaults.set(true, forKey: "onboarding.v3.firstSuccess")
        defaults.removeObject(forKey: "onboarding.v3.step")
    }
}

/// A content plate inside the real notch. The host owns the silhouette and animation clock.
/// Only this plate changes between learning and doing; answers keep their normal renderer.
final class NotchOnboardingView: NSView {
    var onPrimary: (() -> Void)?
    var onBack: (() -> Void)?
    var onDismiss: (() -> Void)?
    var onSecondary: (() -> Void)?
    var onPrivacy: (() -> Void)?
    private let eyebrow = label(10, .semibold, .init(white: 1, alpha: 0.62))
    private let heading = label(27, .semibold, .white)
    private let detail = label(13, .regular, .init(white: 1, alpha: 0.72))
    private let privacyNote = label(11, .regular, .init(white: 1, alpha: 0.62))
    private let note = label(11, .regular, .init(white: 1, alpha: 0.62))
    let primary = GlowButton(title: "")
    private let secondary = GlowButton(title: "", style: .ghost)
    private let back = GlowButton(title: "", style: .ghost)
    private let closeButton = GlowButton(title: "", style: .ghost)
    private let privacy = GlowButton(title: "", style: .ghost)
    private let illustration = OnboardingRouteView()
    private let languages = NSPopUpButton(frame: .zero, pullsDown: false)
    private var step: NotchOnboardingStep?
    private var denied = false
    private var granted = false
    private var failed = false
    override var isFlipped: Bool { true }

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        [eyebrow, heading, detail, note, privacyNote, illustration, primary, secondary, back, closeButton, privacy, languages].forEach(addSubview)
        primary.onClick = { [weak self] in self?.onPrimary?() }
        secondary.onClick = { [weak self] in self?.onSecondary?() }
        back.onClick = { [weak self] in self?.onBack?() }
        closeButton.onClick = { [weak self] in self?.onDismiss?() }
        privacy.onClick = { [weak self] in self?.onPrivacy?() }
        languages.addItems(withTitles: ["简体中文", "日本語", "English"])
        languages.target = self; languages.action = #selector(pickLanguage)
        languages.setAccessibilityLabel("Language / 语言 / 言語")
        languages.font = .systemFont(ofSize: 11)
        languages.appearance = NSAppearance(named: .darkAqua)
        primary.nextKeyView = secondary; secondary.nextKeyView = back
        back.nextKeyView = closeButton; closeButton.nextKeyView = languages
        languages.nextKeyView = privacy; privacy.nextKeyView = primary
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func keyDown(with event: NSEvent) {
        if event.keyCode == 48, event.modifierFlags.intersection([.command, .control, .option]).isEmpty {
            moveKeyboardFocus(backwards: event.modifierFlags.contains(.shift))
        } else { super.keyDown(with: event) }
    }

    // AppKit's default key-view traversal can skip custom NSControls when Full Keyboard
    // Access is off. This local loop keeps the guide operable without changing system settings.
    func moveKeyboardFocus(backwards: Bool) {
        let controls: [NSControl] = [primary, secondary, back, closeButton, languages, privacy]
        let available = controls.filter { !$0.isHiddenOrHasHiddenAncestor && $0.isEnabled && $0.acceptsFirstResponder }
        guard let window, !available.isEmpty else { return }
        let current = available.firstIndex { window.firstResponder === $0 }
        let index = current.map { ($0 + (backwards ? available.count - 1 : 1)) % available.count }
            ?? (backwards ? available.count - 1 : 0)
        window.makeFirstResponder(available[index])
    }

    @objc private func pickLanguage() {
        L10n.setting = [AppLanguage.zhHans, .ja, .en][languages.indexOfSelectedItem]
    }

    func update(step: NotchOnboardingStep, granted: Bool, denied: Bool, failed: Bool) {
        let changed = self.step != step
        self.step = step; self.granted = granted; self.denied = denied; self.failed = failed
        let t = L10n.t
        closeButton.title = t("稍后继续", "あとで", "Later")
        closeButton.toolTip = t("收起引导 · 可在刘海菜单中继续", "閉じる・ノッチメニューで再開", "Close · resume from the notch menu")
        back.title = t("返回", "戻る", "Back")
        back.isHidden = step == .welcome || step.showsLiveContent
        languages.isHidden = step != .welcome
        languages.selectItem(at: L10n.setting == .ja ? 1 : L10n.setting == .en ? 2 : 0)
        privacy.title = t("匿名可靠性数据 · 设置", "匿名の信頼性データ・設定", "Anonymous reliability data · Settings")
        privacy.isHidden = step != .permission
        privacyNote.isHidden = step != .permission
        privacyNote.stringValue = t("匿名可靠性数据仅记录操作、耗时、结果与数据缺失，用于改进交付。\n不含截图、题目、答案或提示词；可在设置中关闭并清空待传数据。", "匿名データは操作・時間・結果・欠落のみを記録し、配信の改善に使います。\n画像・問題・回答・プロンプトは含みません。設定で停止・未送信分を削除できます。", "Anonymous data records actions, timings, outcomes and gaps to improve delivery.\nIt excludes images, questions, answers and prompts. Disable it in Settings to clear pending data.")
        illustration.isHidden = step.showsLiveContent
        illustration.phase = step
        note.isHidden = step.showsLiveContent
        primary.isEnabled = step != .working || failed
        secondary.isHidden = step == .welcome || step == .success
        secondary.isEnabled = true
        heading.font = .systemFont(ofSize: step.showsLiveContent ? 20 : 27, weight: .semibold)
        eyebrow.stringValue = step == .welcome ? "01 / 03   ·   NotchSPI" : step == .permission ? t("02 / 03   ·   连接屏幕", "02 / 03   ·   画面に接続", "02 / 03   ·   CONNECT") : t("03 / 03   ·   第一次查题", "03 / 03   ·   最初の質問", "03 / 03   ·   YOUR FIRST QUESTION")
        switch step {
        case .welcome:
            heading.stringValue = t("答案，就在抬眼之间。", "答えは、すぐそこに。", "A glance away from an answer.")
            detail.stringValue = t("打开一道题，捕获当前画面。\n答案在这里展开，你留在原来的思路里。", "問題を開いて、画面をキャプチャ。\n答えはここに。考えの流れはそのまま。", "Open a question. Capture your screen.\nYour answer unfolds here, keeping you in your flow.")
            primary.title = t("试一次真实查题", "実際に試してみる", "Try a real question")
            note.stringValue = t("一次捕获 → 一份答案 → 继续你的学习", "キャプチャ → 答え → 学習を続ける", "Capture → Answer → Keep learning")
        case .permission:
            heading.stringValue = granted ? t("屏幕已连接。", "画面に接続しました。", "Your screen is connected.") : t("让它看见你要问的题。", "質問したい問題を見せて。", "Let it see your question.")
            detail.stringValue = t("手动查题时读取已配置的屏幕或应用，并发送给所选 AI 服务。\n请先收好无关的私人内容。引导不会开启自动捕获。", "手動で質問すると、選択した画面やアプリをAIサービスへ送信します。\n個人情報を隠してから操作してください。自動撮影は開始しません。", "Manual capture sends the configured screen or app to your AI service.\nPut away private content first. This guide does not start automatic capture.")
            primary.title = granted ? t("继续，试一题", "続けて試す", "Continue to a question") : denied ? t("打开系统设置", "システム設定を開く", "Open System Settings") : t("允许屏幕访问", "画面へのアクセスを許可", "Allow screen access")
            secondary.title = t("暂时跳过", "今はスキップ", "Skip for now")
            note.stringValue = denied && !granted ? t("尚未授权。开启权限后返回；若系统要求，请重启应用。", "未許可です。設定後に戻ってください。必要ならアプリを再起動。", "Not granted yet. Return after enabling access; relaunch if macOS asks.") : t("权限由 macOS 管理，随时可以撤回。", "許可はmacOSでいつでも取り消せます。", "macOS manages this permission. You can revoke it anytime.")
        case .capture:
            heading.stringValue = t("把第一道题带到这里。", "最初の問題を、ここへ。", "Bring your first question here.")
            detail.stringValue = t("在网页或 PDF 中打开一道完整题目，再按下方快捷键。\n也可以用练习页开始，或点「捕获当前画面」。", "WebやPDFで問題全体を表示し、下のキーを押してください。\n練習ページやキャプチャボタンでも始められます。", "Open a complete question in a web page or PDF, then use the shortcut.\nOr open the practice page and use the capture button.")
            primary.title = t("捕获当前画面", "今の画面をキャプチャ", "Capture this screen")
            secondary.title = t("打开练习题 ↗", "練習問題を開く ↗", "Open practice question ↗")
            let target = Settings.shared.captureTargetName ?? t("整个屏幕", "画面全体", "Entire screen")
            note.stringValue = t("目标：\(target) · 官方服务成功回答消耗 1 题，失败不扣。", "対象：\(target)・公式サービスは回答1回で1問消費。失敗時は消費なし。", "Target: \(target) · Official answers cost 1 question; failures are not charged.")
        case .working:
            heading.stringValue = failed ? t("这次还没完成。再试一次。", "まだ完了していません。もう一度。", "Not there yet. Try again.") : t("正在把答案带回来。", "答えを、ここに。", "Bringing your answer back.")
            detail.stringValue = failed ? t("查看下方原因，调整后重新捕获。", "下の内容を確認し、もう一度キャプチャ。", "Check the message below, then capture again.") : t("真实截图和回答会显示在下方。", "キャプチャと回答が下に表示されます。", "Your real capture and answer appear below.")
            primary.title = failed ? t("重新捕获", "再キャプチャ", "Capture again") : t("正在查题…", "回答中…", "Working…")
            secondary.title = t("检查设置", "設定を確認", "Check settings")
            secondary.isHidden = !failed
        case .success:
            heading.stringValue = t("第一次成功。以后，也在这里。", "できました。次も、ここで。", "Your first answer. Always here.")
            detail.stringValue = t("答案会留下。下次用 \(Settings.displayString(Settings.shared.captureCombo))，或移到刘海查看。", "答えは残ります。次回は \(Settings.displayString(Settings.shared.captureCombo))、またはノッチへ。", "Your answer stays. Next time, use \(Settings.displayString(Settings.shared.captureCombo)) or hover here.")
            primary.title = t("完成，保留答案", "完了・答えを残す", "Done — keep my answer")
            closeButton.title = t("收起", "閉じる", "Collapse")
        }
        needsLayout = true
        if changed {
            // Keyed animations replace any interrupted transition; model pose is always final.
            layer?.removeAnimation(forKey: "step")
            if !onboardingReduceMotion() {
                let animation = CABasicAnimation(keyPath: "opacity")
                animation.fromValue = 0.25; animation.toValue = 1
                animation.duration = 0.18
                layer?.add(animation, forKey: "step")
            }
            NSAccessibility.post(element: heading, notification: .valueChanged)
        }
    }

    override func layout() {
        super.layout()
        guard let step else { return }
        let w = bounds.width, inset: CGFloat = 30
        eyebrow.frame = .init(x: 44, y: 12, width: 200, height: 18)
        closeButton.frame = .init(x: w - 115, y: 6, width: 96, height: 28)
        heading.frame = .init(x: inset, y: 52, width: w - inset * 2, height: 38)
        detail.frame = .init(x: inset, y: step.showsLiveContent ? 87 : 100, width: w - inset * 2, height: step.showsLiveContent ? 22 : 48)
        let actionY = step.showsLiveContent ? 116.0 : step.height - 76
        primary.frame = .init(x: w - inset - primary.intrinsicContentSize.width, y: actionY, width: primary.intrinsicContentSize.width, height: 34)
        secondary.frame = .init(x: step.showsLiveContent ? inset : 85, y: actionY, width: secondary.intrinsicContentSize.width, height: 34)
        back.frame = .init(x: 18, y: actionY, width: 62, height: 34)
        illustration.frame = .init(x: inset, y: 161, width: w - inset * 2, height: 88)
        note.frame = .init(x: inset, y: step.height - 38, width: w - inset * 2, height: 32)
        privacyNote.frame = .init(x: inset, y: 234, width: w - inset * 2, height: 48)
        privacy.frame = .init(x: inset - 10, y: 282, width: privacy.intrinsicContentSize.width, height: 26)
        if step == .permission { illustration.frame.size.height = 66 }
        languages.frame = .init(x: inset, y: actionY + 3, width: 115, height: 28)
    }

    private static func label(_ size: CGFloat, _ weight: NSFont.Weight, _ color: NSColor) -> NSTextField {
        let field = NSTextField(wrappingLabelWithString: "")
        field.font = .systemFont(ofSize: size, weight: weight); field.textColor = color
        field.maximumNumberOfLines = 3
        return field
    }
}

/// A quiet diagram becomes the actual shortcut at the action step. No looping decoration.
private final class OnboardingRouteView: NSView {
    var phase: NotchOnboardingStep = .welcome { didSet { needsDisplay = true } }
    override var isFlipped: Bool { true }
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
    override func draw(_ dirtyRect: NSRect) {
        let t = L10n.t
        if phase == .capture {
            let text = Settings.displayString(Settings.shared.captureCombo)
            let box = NSRect(x: 0, y: 6, width: bounds.width, height: 68)
            NSColor(white: 1, alpha: 0.045).setFill()
            NSBezierPath(roundedRect: box, xRadius: 13, yRadius: 13).fill()
            (text as NSString).draw(at: .init(x: 22, y: 19), withAttributes: [.font: NSFont.monospacedSystemFont(ofSize: 27, weight: .medium), .foregroundColor: NSColor.white])
            (t("你的查题快捷键", "質問のショートカット", "Your capture shortcut") as NSString).draw(at: .init(x: 195, y: 31), withAttributes: [.font: NSFont.systemFont(ofSize: 12), .foregroundColor: NSColor(white: 1, alpha: 0.65)])
            return
        }
        let labels = phase == .permission
            ? [t("手动触发", "手動操作", "You choose"), t("所选 AI", "選択したAI", "Your AI"), t("随时撤回", "いつでも解除", "Revocable")]
            : [t("捕获题目", "キャプチャ", "Capture"), t("带回答案", "答えが届く", "Answer"), t("继续学习", "学習を続ける", "Continue")]
        let symbols = phase == .permission ? ["cursorarrow.click", "sparkle", "lock.shield"] : ["viewfinder", "text.alignleft", "arrow.turn.down.right"]
        let stride = bounds.width / 3
        for i in 0..<3 {
            let x = CGFloat(i) * stride
            let box = NSRect(x: x, y: 0, width: stride - 18, height: bounds.height - 5)
            NSColor(white: 1, alpha: i == 1 ? 0.08 : 0.035).setFill()
            NSBezierPath(roundedRect: box, xRadius: 12, yRadius: 12).fill()
            let image = NSImage(systemSymbolName: symbols[i], accessibilityDescription: nil)
            let config = NSImage.SymbolConfiguration(pointSize: 19, weight: .medium).applying(.init(paletteColors: [i == 1 ? NotchPalette.accentHi : .white]))
            image?.withSymbolConfiguration(config)?.draw(in: .init(x: x + 15, y: 17, width: 22, height: 22))
            (labels[i] as NSString).draw(at: .init(x: x + 48, y: 20), withAttributes: [.font: NSFont.systemFont(ofSize: 12, weight: .medium), .foregroundColor: NSColor.white])
            if phase == .welcome {
                (String(format: "%02d", i + 1) as NSString).draw(at: .init(x: x + 16, y: 56), withAttributes: [.font: NSFont.monospacedSystemFont(ofSize: 10, weight: .medium), .foregroundColor: NSColor(white: 1, alpha: 0.35)])
            }
        }
    }
}
