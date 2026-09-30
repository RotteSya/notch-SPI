import AppKit

/// Durable checkpoints are separate from presentation. Closing never invents a first success;
/// an interrupted request resumes at the instructions, not at an orphaned spinner.
enum NotchOnboardingStep: String {
    case welcome, permission, practice, capture, working, success
    var checkpoint: String { self == .working || self == .success ? "capture" : rawValue }
    var showsLiveContent: Bool { self == .working || self == .success }
    var motionOrder: Int {
        switch self {
        case .welcome: return 0
        case .permission: return 1
        case .practice: return 2
        case .capture: return 3
        case .working: return 4
        case .success: return 5
        }
    }
    var height: CGFloat {
        switch self {
        case .welcome: return 220
        case .permission: return 248
        case .practice: return 220
        case .capture: return 220
        case .working: return 194
        case .success: return 194
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
    private let copyPlate = OnboardingCopyPlate()
    private var practiceFailed = false
    private var outgoingCopy: NSImageView?
    private let shortcut = label(11, .medium, .init(white: 1, alpha: 0.58))
    private let eyebrow = label(10, .semibold, .init(white: 1, alpha: 0.62))
    private let heading = label(27, .semibold, .white)
    private let detail = label(13, .regular, .init(white: 1, alpha: 0.72))
    private let note = label(11, .regular, .init(white: 1, alpha: 0.62))
    let primary = GlowButton(title: "")
    private let secondary = GlowButton(title: "", style: .ghost)
    private let back = GlowButton(title: "", style: .ghost)
    private let closeButton = GlowButton(title: "", style: .ghost)
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
        addSubview(copyPlate)
        [heading, detail, note, illustration].forEach(copyPlate.addSubview)
        [eyebrow, primary, secondary, back, closeButton, languages, shortcut].forEach(addSubview)
        [primary, secondary, back, closeButton].forEach { $0.ignoresRepeatedClicks = true }
        primary.onClick = { [weak self] in self?.onPrimary?() }
        secondary.onClick = { [weak self] in self?.onSecondary?() }
        back.onClick = { [weak self] in self?.onBack?() }
        closeButton.onClick = { [weak self] in self?.onDismiss?() }
        languages.addItems(withTitles: ["简体中文", "日本語", "English"])
        languages.target = self; languages.action = #selector(pickLanguage)
        languages.setAccessibilityLabel("Language / 语言 / 言語")
        languages.font = .systemFont(ofSize: 11)
        languages.appearance = NSAppearance(named: .darkAqua)
        primary.nextKeyView = secondary; secondary.nextKeyView = back
        back.nextKeyView = closeButton; closeButton.nextKeyView = languages
        languages.nextKeyView = primary
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
        let controls: [NSControl] = [primary, secondary, back, closeButton, languages]
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

    func update(step: NotchOnboardingStep, granted: Bool, denied: Bool, failed: Bool,
                practiceFailed: Bool = false) {
        let changed = self.step != step || self.failed != failed
            || self.granted != granted || self.denied != denied || self.practiceFailed != practiceFailed
        let previous = self.step
        let backwards = previous.map { step.motionOrder < $0.motionOrder } ?? false
        if changed, previous != nil { transitionCopy(backwards: backwards) }
        self.practiceFailed = practiceFailed
        self.step = step; self.granted = granted; self.denied = denied; self.failed = failed
        let t = L10n.t
        closeButton.title = t("稍后继续", "あとで", "Later")
        closeButton.toolTip = t("收起引导 · 可在刘海菜单中继续", "閉じる・ノッチメニューで再開", "Close · resume from the notch menu")
        back.title = t("返回", "戻る", "Back")
        back.isHidden = step == .welcome || step == .success || (step == .working && !failed)
        languages.isHidden = step != .welcome
        languages.selectItem(at: L10n.setting == .ja ? 1 : L10n.setting == .en ? 2 : 0)
        illustration.isHidden = step != .welcome
        illustration.phase = step
        note.isHidden = step.showsLiveContent || step == .welcome || step == .practice || step == .capture
        detail.isHidden = step == .welcome
        shortcut.isHidden = true
        primary.isEnabled = step != .working || failed
        secondary.isHidden = step != .permission || granted
        secondary.isEnabled = true
        heading.font = .systemFont(ofSize: step.showsLiveContent ? 22 : 24, weight: .semibold)
        eyebrow.stringValue = step == .welcome ? "NOTCHSPI / " + t("开始", "はじめに", "START")
            : step == .permission ? t("准备 · 连接屏幕", "準備 · 画面に接続", "SETUP · SCREEN ACCESS")
            : step == .practice ? t("第一步 · 打开练习题", "ステップ1 · 練習問題", "STEP 1 · OPEN PRACTICE")
            : step == .capture ? t("第二步 · 截图查题", "ステップ2 · 撮影して質問", "STEP 2 · CAPTURE & ASK")
            : step == .success ? t("完成 · 第一份答案", "完了 · 最初の答え", "DONE · YOUR FIRST ANSWER")
            : t("动手试试 · 第一次查题", "試してみる · 最初の質問", "TRY IT · YOUR FIRST QUESTION")
        switch step {
        case .welcome:
            heading.stringValue = t("每道题，抬眸尽收眼底。", "問題を撮ると、答えはノッチに。", "Capture a question. Answer up here.")
            detail.stringValue = ""
            primary.title = t("准备开始查题！", "質問を始めましょう！", "Get ready to ask!")
            note.stringValue = t("一次捕获 → 一份答案 → 继续你的学习", "キャプチャ → 答え → 学習を続ける", "Capture → Answer → Keep learning")
        case .permission:
            heading.stringValue = granted ? t("屏幕已连接。", "画面に接続しました。", "Your screen is connected.") : t("先允许读取屏幕上的题。", "画面の問題を読み取る許可を。", "Allow access to your question.")
            let target = captureTargetLabel
            detail.stringValue = t("当前捕获目标：\(target)", "キャプチャ対象：\(target)", "Capture target: \(target)")
            primary.title = granted ? t("继续", "続ける", "Continue") : denied ? t("打开系统设置", "システム設定を開く", "Open System Settings") : t("允许屏幕访问", "画面へのアクセスを許可", "Allow screen access")
            secondary.title = t("暂时跳过", "今はスキップ", "Skip for now")
            note.stringValue = denied && !granted ? t("尚未授权。开启权限后返回；若系统要求，请重启应用。", "未許可です。設定後に戻ってください。必要ならアプリを再起動。", "Not granted yet. Return after enabling access; relaunch if macOS asks.") : t("下一步会在浏览器中打开练习题。", "次にブラウザで練習問題を開きます。", "Next, a practice question opens in your browser.")
        case .practice:
            heading.stringValue = practiceFailed ? t("练习题没有打开。", "練習問題を開けませんでした。", "Practice didn’t open.") : t("先打开一道练习题。", "まず練習問題を開きます。", "First, open a practice question.")
            detail.stringValue = practiceFailed ? t("请再试一次；打开成功后会回到下一步。", "もう一度お試しください。開いたら次のステップへ進みます。", "Try again. Once it opens, you’ll move to the next step.") : t("我们准备好了一道题，会在默认浏览器中打开。", "用意した問題をデフォルトのブラウザで開きます。", "We prepared one for you. It opens in your default browser.")
            primary.title = practiceFailed ? t("重新打开练习题 ↗", "練習問題をもう一度開く ↗", "Open practice again ↗") : t("打开练习题 ↗", "練習問題を開く ↗", "Open practice ↗")
            note.stringValue = ""
        case .capture:
            heading.stringValue = t("练习题已打开。", "練習問題を開きました。", "Practice is open.")
            detail.stringValue = t("按快捷键，或点击右侧按钮。答案会在下方出现。", "ショートカット、または右のボタンを押してください。答えは下に表示されます。", "Use the shortcut or click the button. Your answer appears below.")
            primary.title = t("按下⌘⇧1 或 点击查题", "⌘⇧1 またはクリックで質問", "Press ⌘⇧1 or click to ask")
        case .working:
            heading.stringValue = failed ? t("这次还没完成。再试一次。", "まだ完了していません。もう一度。", "Not there yet. Try again.") : t("正在查题，答案会在下方出现。", "回答中です。答えはこの下に。", "Working. Your answer appears below.")
            detail.stringValue = failed ? t("查看下方原因，调整后重新捕获。", "下の内容を確認し、もう一度キャプチャ。", "Check the message below, then capture again.") : t("截图、回答，都留在这里。", "画像も答えも、ここに残ります。", "Your capture and answer stay here.")
            primary.title = failed ? t("重新捕获", "再キャプチャ", "Capture again") : t("正在查题…", "回答中…", "Working…")
            secondary.title = t("检查设置", "設定を確認", "Check settings")
            secondary.isHidden = !failed
        case .success:
            heading.stringValue = t("答案到了。可以继续做题了。", "答えが届きました。次の問題へ。", "Answer ready. Keep going.")
            detail.stringValue = t("下次用 \(Settings.displayString(Settings.shared.captureCombo)) 查题。点击刘海可再看答案。", "次の質問は \(Settings.displayString(Settings.shared.captureCombo))。ノッチをクリックすると答えを再表示。", "Use \(Settings.displayString(Settings.shared.captureCombo)) for the next question. Click the notch to revisit this answer.")
            primary.title = t("完成，收起引导", "完了・ノッチに戻る", "Done — back to the notch")
            closeButton.title = t("收起", "閉じる", "Collapse")
        }
        primary.toolTip = step == .practice ? t("在默认浏览器中打开内置练习题", "デフォルトのブラウザで練習問題を開きます", "Open the built-in practice question in your default browser")
            : step == .capture ? t("截取当前目标并立即查题", "対象画面を撮影して質問します", "Capture the selected target and ask immediately") : nil
        needsLayout = true
        if changed { NSAccessibility.post(element: heading, notification: .valueChanged) }
    }

    override func layout() {
        super.layout()
        guard let step else { return }
        let w = bounds.width, inset: CGFloat = 30
        copyPlate.frame = bounds
        eyebrow.frame = .init(x: 44, y: 12, width: 270, height: 18)
        closeButton.frame = .init(x: w - 115, y: 6, width: 96, height: 28)
        heading.frame = .init(x: inset, y: 47, width: w - inset * 2, height: 38)
        // The same target stays under the pointer across every step and the practice handoff.
        primary.frame = .init(x: w - inset - 232, y: 98, width: 232, height: 40)
        secondary.frame = .init(x: 80, y: 101,
                                width: min(secondary.intrinsicContentSize.width, 220), height: 34)
        back.frame = .init(x: 18, y: 101, width: 62, height: 34)
        shortcut.frame = .init(x: 104, y: 112, width: max(0, w - 376), height: 20)
        languages.frame = .init(x: inset, y: 104, width: 115, height: 28)
        detail.frame = .init(x: inset, y: 158, width: w - inset * 2, height: step.showsLiveContent ? 32 : 54)
        illustration.frame = .init(x: inset, y: step == .welcome ? 164 : 218,
                                   width: w - inset * 2, height: 28)
        note.frame = .init(x: inset, y: step.height - 40, width: w - inset * 2, height: 36)
        if step == .permission {
            detail.frame.size.height = 36
            note.frame = .init(x: inset, y: 198, width: w - inset * 2, height: 40)
        }
    }

    private var captureTargetLabel: String {
        guard let id = Settings.shared.captureTargetBundleID else {
            return L10n.t("整个屏幕", "画面全体", "Entire screen")
        }
        let name = Settings.shared.captureTargetName ?? ""
        return name.isEmpty ? id : name
    }

    private func transitionCopy(backwards: Bool) {
        outgoingCopy?.removeFromSuperview()
        outgoingCopy = nil
        guard !onboardingReduceMotion(), window != nil, !copyPlate.isHidden else {
            copyPlate.layer?.removeAllAnimations()
            return
        }
        // Preserve one outgoing image, never a stack of abandoned pages. It cannot intercept input.
        // The welcome diagram shares space with the next step's practice link. Retire it
        // immediately so outgoing decoration never competes with a newly active control.
        let illustrationWasHidden = illustration.isHidden
        illustration.isHidden = true
        defer { illustration.isHidden = illustrationWasHidden }
        if copyPlate.layer?.animation(forKey: "arrive") == nil,
           let bitmap = copyPlate.bitmapImageRepForCachingDisplay(in: copyPlate.bounds) {
            copyPlate.cacheDisplay(in: copyPlate.bounds, to: bitmap)
            let image = NSImage(size: copyPlate.bounds.size)
            image.addRepresentation(bitmap)
            let old = OnboardingCopyImage(frame: copyPlate.frame)
            old.image = image; old.imageScaling = .scaleNone; old.wantsLayer = true
            addSubview(old, positioned: .above, relativeTo: copyPlate)
            outgoingCopy = old
            let fade = CABasicAnimation(keyPath: "opacity")
            fade.fromValue = 1; fade.toValue = 0; fade.duration = onboardingMotionDuration(0.09)
            old.layer?.opacity = 0
            old.layer?.add(fade, forKey: "leave")
            DispatchQueue.main.asyncAfter(deadline: .now() + onboardingMotionDuration(0.10)) { [weak self, weak old] in
                old?.removeFromSuperview()
                if self?.outgoingCopy === old { self?.outgoingCopy = nil }
            }
        }
        let move = CABasicAnimation(keyPath: "transform.translation.y")
        move.fromValue = backwards ? -6 : 6; move.toValue = 0
        let fade = CABasicAnimation(keyPath: "opacity")
        fade.fromValue = 0; fade.toValue = 1
        let arrive = CAAnimationGroup()
        arrive.animations = [move, fade]; arrive.duration = onboardingMotionDuration(0.22)
        arrive.beginTime = CACurrentMediaTime() + onboardingMotionDuration(0.10)
        arrive.fillMode = .backwards
        arrive.timingFunction = CAMediaTimingFunction(controlPoints: 0.22, 0.8, 0.25, 1)
        copyPlate.layer?.add(arrive, forKey: "arrive")
    }

    private static func label(_ size: CGFloat, _ weight: NSFont.Weight, _ color: NSColor) -> NSTextField {
        let field = NSTextField(wrappingLabelWithString: "")
        field.font = .systemFont(ofSize: size, weight: weight); field.textColor = color
        field.maximumNumberOfLines = 3
        return field
    }
}

/// A quiet, noninteractive welcome diagram. No looping decoration.
private final class OnboardingRouteView: NSView {
    var phase: NotchOnboardingStep = .welcome { didSet { needsDisplay = true } }
    override var isFlipped: Bool { true }
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
    override func draw(_ dirtyRect: NSRect) {
        let t = L10n.t
        let labels = [t("打开题目", "問題を開く", "Open a question"), t("截图查题", "撮影して質問", "Capture & ask"), t("答案留在刘海", "答えはノッチに", "Answer up here")]
        let symbols = ["doc.text", "viewfinder", "text.alignleft"]
        let stride = bounds.width / 3
        for i in 0..<3 {
            let x = CGFloat(i) * stride
            let image = NSImage(systemSymbolName: symbols[i], accessibilityDescription: nil)
            let config = NSImage.SymbolConfiguration(pointSize: 14, weight: .regular)
                .applying(.init(paletteColors: [NSColor(white: 1, alpha: 0.55)]))
            image?.withSymbolConfiguration(config)?.draw(in: .init(x: x, y: 8, width: 17, height: 17))
            (labels[i] as NSString).draw(at: .init(x: x + 27, y: 9), withAttributes: [
                .font: NSFont.systemFont(ofSize: 12), .foregroundColor: NSColor(white: 1, alpha: 0.62)])
        }
    }
}

private final class OnboardingCopyPlate: NSView {
    override var isFlipped: Bool { true }
    override init(frame: NSRect) { super.init(frame: frame); wantsLayer = true }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
}

private final class OnboardingCopyImage: NSImageView {
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
    override func isAccessibilityElement() -> Bool { false }
}
