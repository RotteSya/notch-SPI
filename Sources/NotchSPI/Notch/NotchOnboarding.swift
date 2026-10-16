import AppKit

/// Presentation only. The existing question quota does not prove a time-based trial grant.
enum OnboardingTrialState { case unavailable, loading, available, claiming, claimed, failed, ineligible, expired }

/// Durable checkpoints are separate from presentation. Closing never invents a first success;
/// an interrupted request resumes at the instructions, not at an orphaned spinner.
enum NotchOnboardingStep: String, CaseIterable {
    case welcome, permission, practice, capture, working, firstAnswer, multiple, multiCapture, collecting, success, trial
    var checkpoint: String {
        switch self {
        case .working: return "capture"
        case .success: return "trial"
        case .firstAnswer, .multiCapture, .collecting: return "multiple"
        default: return rawValue
        }
    }
    var showsLiveContent: Bool { [.working, .firstAnswer, .collecting, .success].contains(self) }
    var motionOrder: Int { Self.allCases.firstIndex(of: self) ?? 0 }
    var height: CGFloat { showsLiveContent ? 164 : 260 }
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
    func save(_ step: NotchOnboardingStep, multiple: Bool = false) {
        defaults.set(multiple && [.working, .permission].contains(step) ? "multiple" : step.checkpoint, forKey: "onboarding.v3.step")
    }
    func dismiss() { defaults.set(true, forKey: "onboarding.v3.dismissed") }
    func complete() {
        defaults.set(true, forKey: "onboardingDone")
        defaults.set(true, forKey: "onboarding.v3.firstSuccess")
        defaults.removeObject(forKey: "onboarding.v3.step")
    }
}

/// Header + instructional card before capture; a passive overlay with a footer during use.
/// Live answers retain the daily renderer and receive the first content position.
final class NotchOnboardingView: NSView {
    static let headerRowCenterY: CGFloat = 20
    // The rose occupies about two thirds of its canvas; match its visible ink to 12pt capitals.
    static let headerIndicatorSize: CGFloat = 14.5
    var onPrimary: (() -> Void)?
    var onBack: (() -> Void)?
    var onDismiss: (() -> Void)?
    var onSecondary: (() -> Void)?
    var onChangeTarget: (() -> Void)?
    private let targetButton = GlowButton(title: "", style: .ghost)
    private let copyPlate = OnboardingCopyPlate()
    private let surface = AnswerShelfView(frame: .zero)
    private let illustration = OnboardingIllustration(frame: .zero)
    private let footerRule = OnboardingRuleView(frame: .zero)
    private let eyebrow = label(12, .medium, .init(white: 1, alpha: 0.62))
    private let heading = label(25, .semibold, .init(white: 1, alpha: 0.96))
    private let detail = bodyLabel()
    private let note = bodyLabel()
    let primary = GlowButton(title: "")
    let shortcutPrompt = OnboardingShortcutView(frame: .zero)
    private let secondary = GlowButton(title: "", style: .ghost)
    private let back = GlowButton(title: "", style: .ghost)
    private let closeButton = GlowButton(title: "", style: .ghost)
    private let languages = NSPopUpButton(frame: .zero, pullsDown: false)
    private var step: NotchOnboardingStep?
    private var topCutout: CGRect?
    private var availableTopWidth: CGFloat = .greatestFiniteMagnitude
    private var headerInset: CGFloat = 0
    private var bodyAdjustment: CGFloat = 0
    private var presentationHeight: CGFloat?
    private struct MeasurementKey: Equatable {
        let step: NotchOnboardingStep
        let width: CGFloat
        let title: String
        let body: String
        let note: String
    }
    private var measuredKey: MeasurementKey?
    private var measuredCopy = (title: CGFloat(0), body: CGFloat(0), note: CGFloat(0), height: CGFloat(0))
    override var isFlipped: Bool { true }
    override var acceptsFirstResponder: Bool { true }

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        addSubview(surface); addSubview(copyPlate)
        [illustration, heading, detail, note].forEach(copyPlate.addSubview)
        addSubview(footerRule)
        [primary, secondary, back, targetButton].forEach { $0.onboardingChrome = true }
        primary.font = .systemFont(ofSize: 13, weight: .semibold)
        secondary.font = .systemFont(ofSize: 12, weight: .medium)
        addSubview(shortcutPrompt)
        back.font = .systemFont(ofSize: 12, weight: .medium)
        targetButton.font = .systemFont(ofSize: 12, weight: .medium)
        [eyebrow, primary, secondary, back, closeButton, languages, targetButton].forEach(addSubview)
        [primary, secondary, back, closeButton, targetButton].forEach { $0.ignoresRepeatedClicks = true }
        targetButton.onClick = { [weak self] in self?.onChangeTarget?() }
        primary.onClick = { [weak self] in
            guard let self, !self.primary.isHidden, self.primary.isEnabled else { return }
            self.onPrimary?()
        }
        secondary.onClick = { [weak self] in self?.onSecondary?() }
        back.onClick = { [weak self] in self?.onBack?() }
        closeButton.font = .systemFont(ofSize: 12, weight: .medium)
        closeButton.onClick = { [weak self] in self?.onDismiss?() }
        languages.addItems(withTitles: ["简体中文", "日本語", "English"])
        languages.target = self; languages.action = #selector(pickLanguage)
        languages.setAccessibilityLabel("Language / 语言 / 言語")
        languages.font = .systemFont(ofSize: 12)
        languages.isBordered = false
        languages.contentTintColor = NSColor(white: 1, alpha: 0.65)
        languages.appearance = NSAppearance(named: .darkAqua)
        eyebrow.stringValue = "NOTCHSPI"
        eyebrow.maximumNumberOfLines = 1; eyebrow.lineBreakMode = .byTruncatingTail
        eyebrow.cell?.truncatesLastVisibleLine = true
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    // The full-size overlay must never intercept answer scrolling or screenshot controls.
    override func hitTest(_ point: NSPoint) -> NSView? {
        let hit = super.hitTest(point)
        return hit === self ? nil : hit
    }
    override func keyDown(with event: NSEvent) {
        if event.keyCode == 48, event.modifierFlags.intersection([.command, .control, .option]).isEmpty {
            moveKeyboardFocus(backwards: event.modifierFlags.contains(.shift))
        } else { super.keyDown(with: event) }
    }
    func moveKeyboardFocus(backwards: Bool) {
        func descendants(_ view: NSView) -> [NSView] { view.subviews + view.subviews.flatMap(descendants) }
        let tray = superview?.subviews.first { $0 is ScreenshotTray }
        let imageControls = step?.showsLiveContent == true ? tray.map { descendants($0).compactMap { $0 as? NSControl } } ?? [] : []
        let controls: [NSControl] = [primary] + imageControls + [secondary, targetButton, back, closeButton, languages]
        let available = controls.filter { !$0.isHiddenOrHasHiddenAncestor && $0.isEnabled && $0.acceptsFirstResponder }
        guard let window, !available.isEmpty else { return }
        let current = available.firstIndex { window.firstResponder === $0 }
        let index = current.map { ($0 + (backwards ? available.count - 1 : 1)) % available.count }
            ?? (backwards ? available.count - 1 : 0)
        window.makeFirstResponder(available[index])
    }
    @objc private func pickLanguage() { L10n.setting = [AppLanguage.zhHans, .ja, .en][languages.indexOfSelectedItem] }

    private struct Copy {
        var title: String
        var body: String
        var action: String
        var note: String = ""
    }
    private static func copy(_ step: NotchOnboardingStep, granted: Bool = false, denied: Bool = false,
                             failed: Bool = false, count: Int = 0, multiple: Bool = false, trial: OnboardingTrialState = .unavailable, trialExpiration: String? = nil) -> Copy {
        let t = L10n.t
        switch step {
        case .welcome:
            return Copy(title: t("欢迎使用NotchSPI！", "NotchSPIへようこそ！", "Welcome to NotchSPI!"),
                body: t("每道题，抬眸尽收眼底。你在做的题，解答将会出现在这里。", "どんな問題も、顔を上げればすぐそこに。取り組んでいる問題の解答が、ここに表示されます。", "Every question, a glance away. Answers to the question you’re working on will appear right here."),
                action: t("试一道题", "練習してみる", "Try a question"))
        case .permission:
            return Copy(title: granted ? t("已允许屏幕录制。", "画面収録が許可されました。", "Screen recording allowed.") : t("允许截取这道题。", "問題を撮影するための許可。", "Allow question capture."),
                body: permissionDetailText,
                action: granted ? t("返回练习", "練習に戻る", "Back to practice") : denied ? t("打开系统设置", "システム設定を開く", "Open System Settings") : t("允许屏幕录制", "画面収録を許可", "Allow screen recording"),
                note: denied && !granted ? t("在系统设置中允许后返回；若系统要求，请重启应用。", "システム設定で許可してから戻ってください。必要な場合はアプリを再起動してください。", "Allow access in System Settings, then return. Relaunch the app if macOS asks.") : t("用于截取题目。授权后返回练习，再按快捷键开始截图。", "問題の撮影に使います。許可後は練習に戻り、ショートカットで撮影してください。", "Used to capture questions. After allowing access, return to the practice and press the shortcut."))
        case .practice:
            return Copy(title: failed ? t("练习题没有打开。", "練習問題を開けませんでした。", "Practice didn’t open.") : t("从一道练习题开始。", "練習問題から始めましょう。", "Start with a practice question."),
                body: failed ? t("请确认已设置默认浏览器，然后重新打开练习题。", "デフォルトのブラウザを設定してから、もう一度開いてください。", "Check that a default browser is set, then open the practice again.") : t("练习题会在默认浏览器中打开。", "練習問題をデフォルトのブラウザで開きます。", "The practice opens in your default browser."),
                action: t("打开练习题", "練習問題を開く", "Open practice"))
        case .capture:
            return Copy(title: t("现在，截下这道题。", "この問題を撮ってみましょう。", "Now capture the question."),
                body: t("让题目和选项完整显示，按下方快捷键截图。答案会出现在这里。", "問題と選択肢をすべて表示し、下のショートカットで撮影します。答えはここに届きます。", "Keep the question and choices visible. Press the shortcut below; your answer will appear here."),
                action: "")
        case .multiple, .multiCapture:
            return Copy(title: failed ? t("多图练习没有打开。", "複数画像の練習を開けませんでした。", "Multi-image practice didn’t open.") : t("一道题，也可以分开截。", "長い問題は、分けて撮影。", "One question. Multiple captures."),
                body: failed ? t("请确认默认浏览器可用，再重新打开练习。", "ブラウザを確認して、練習をもう一度開いてください。", "Check your default browser, then reopen the practice.") : t("先按下方快捷键截取“材料”，再切到“问题”按一次。", "下のショートカットで「資料」を撮影。\n「問題」に切り替え、同じキーをもう一度押します。", "Press the shortcut below to capture Passage. Switch to Question, then press it again."),
                action: failed ? t("重新打开练习", "練習を開き直す", "Reopen practice") : step == .multiCapture ? "" : t("打开多图练习", "複数画像の練習を開く", "Open multi-image practice"),
                note: failed ? "" : t("多图模式最多可以截4张图，每张图之间有4秒等待时间。", "複数画像モードでは最大4枚まで撮影でき、各画像の間に4秒の待ち時間があります。", "Multiple-image mode supports up to 4 captures, with a 4-second waiting period between captures."))
        case .collecting:
            return Copy(title: "", body: count == 0
                ? t("按下方快捷键，截取练习的“材料”页。", "下のショートカットで練習の「資料」を撮影します。", "Press the shortcut below to capture Passage.")
                : count < 2 ? t("切到练习的“问题”页，再按一次快捷键。只有一张时不会自动提交。", "練習の「問題」に切り替え、もう一度ショートカットを押します。1枚だけでは自動送信されません。", "Switch to Question and press the shortcut again. One image won’t auto-send.")
                : t("停顿 4 秒自动查题。点题图可预览并暂停倒计时，也可以删除重截。", "4秒後に自動送信。画像を開くとカウントを一時停止でき、削除して撮り直すこともできます。", "A 4-second pause sends the images. Preview an image to pause; remove and recapture if needed."),
                action: "")
        case .working:
            let retry = multiple
                ? t("请重新截取“材料”和“问题”两页，每页按一次下方快捷键。", "「資料」と「問題」を開き、各ページで下のショートカットを押して撮り直してください。", "Capture Passage and Question again. Press the shortcut below once on each page.")
                : t("请让题目和选项完整显示，再按下方快捷键重新截图。", "問題と選択肢をすべて表示し、下のショートカットでもう一度撮影してください。", "Show the full question and choices, then press the shortcut below to retry.")
            return Copy(title: "", body: failed ? retry : t("正在读取题目…", "問題を読み取っています…", "Reading your question…"), action: "")
        case .firstAnswer:
            return Copy(title: "", body: t("成功了！接下来试试多图模式，用于那些题目和选项一张图截不完的情况。", "できました！次は、問題と選択肢が1枚に収まらないときに使う複数画像モードを試してみましょう。", "You did it! Next, try multiple-image mode for questions and choices that don’t fit in a single capture."), action: t("试试多图模式", "複数画像モードを試す", "Try multiple-image mode"))
        case .success:
            return Copy(title: "", body: t("成功了！除此之外还有自动模式和性格测试模式，欢迎您自行探索。", "できました！自動モードや性格テストモードも、ぜひお試しください。", "You did it! There’s also auto mode and personality test mode. Feel free to explore them."), action: t("继续", "次へ", "Continue"))
        case .trial:
            let rules = t("每天可免费求解 400 次，北京时间 00:00 重置，失败不计次数。", "毎日400回まで無料。北京時間00:00にリセットされ、失敗したリクエストはカウントされません。", "400 free solves per day, resetting at 00:00 Beijing time. Failed requests don’t count.")
            if trial == .claimed {
                return Copy(title: t("免费体验已开启。", "無料体験が始まりました。", "Your free trial is ready."),
                    body: rules,
                    action: t("开始使用", "使い始める", "Start using NotchSPI"),
                    note: trialExpiration.map { t("有效至 ", "有効期限：", "Valid until ") + $0 } ?? "")
            }
            if trial == .ineligible || trial == .expired {
                return Copy(title: trial == .expired ? t("免费体验已结束。", "無料体験が終了しました。", "Your free trial has ended.") : t("当前账户无法领取。", "このアカウントは対象外です。", "This account isn’t eligible."),
                    body: trial == .expired ? t("感谢体验。已购买的题数仍然可以继续使用。", "ご利用ありがとうございました。購入済みの問題数は引き続き使えます。", "Thanks for trying NotchSPI. Your purchased questions are still available.") : t("免费体验面向新注册用户。你可以继续使用当前账户。", "無料体験は新規登録の方が対象です。現在のアカウントは引き続きご利用いただけます。", "The free trial is for newly registered users. You can continue using your current account."),
                    action: t("开始使用", "使い始める", "Start using NotchSPI"))
            }
            return Copy(title: t("领取 3 天免费体验。", "3日間の無料体験をどうぞ。", "Enjoy 3 days on us."),
                body: t("每位新用户都可以免费体验 3 天，从领取时开始计算。", "初めてご利用の方は、受け取り時から3日間無料でお試しいただけます。", "Every new user gets a 3-day free trial, starting when you claim it."),
                action: trial == .loading ? t("正在检查…", "確認中…", "Checking…")
                    : trial == .claiming ? t("正在领取…", "受け取り中…", "Claiming…")
                    : trial == .failed ? t("重新领取", "もう一度試す", "Try again")
                    : t("领取免费体验", "無料体験を始める", "Claim free trial"),
                note: trial == .unavailable ? t("3 天免费体验暂未开放。", "3日間の無料体験は、まだご利用いただけません。", "The 3-day free trial is not available yet.")
                    : trial == .failed ? t("暂时无法确认领取结果，请稍后重试。", "受け取り結果を確認できません。しばらくしてからお試しください。", "Unable to confirm your trial. Please try again shortly.") : rules)
        }
    }

    func update(step: NotchOnboardingStep, granted: Bool, denied: Bool, failed: Bool,
                practiceFailed: Bool = false, screenshotCount: Int = 0, capturing: Bool = false, previewing: Bool = false, multiple: Bool = false,
                trial: OnboardingTrialState = .unavailable, trialExpiration: String? = nil) {
        let changed = self.step != step
        let shouldTransition = changed && self.step != nil
        self.step = step
        let t = L10n.t
        let copy = Self.copy(step, granted: granted, denied: denied,
                             failed: step == .practice || step == .multiple ? practiceFailed : failed, count: screenshotCount, multiple: multiple, trial: trial, trialExpiration: trialExpiration)
        heading.stringValue = copy.title; detail.stringValue = copy.body; note.stringValue = copy.note
        primary.title = copy.action
        if step == .collecting, screenshotCount >= 4 {
            detail.stringValue = t("已达 4 张上限。停顿 4 秒自动查题，或删除一张后按快捷键重截。", "上限の4枚です。4秒後に自動送信します。撮り直すには1枚削除してショートカットを押します。", "Four-image limit reached. A 4-second pause sends them; remove an image before capturing again.")
        }
        if step == .collecting, previewing {
            detail.stringValue = t("正在预览，自动提交已暂停。关闭预览后，会重新开始 4 秒倒计时。", "プレビュー中は自動送信を停止します。閉じると4秒のカウントが再開します。", "Preview pauses auto-send. Close the preview to restart the 4-second countdown.")
            if screenshotCount < 2 { detail.stringValue = t("正在预览。关闭后可继续截图，至少两张才会自动查题。", "プレビュー中です。閉じて撮影を続けられます。自動送信には2枚以上必要です。", "Previewing. Close it to keep capturing; auto-send needs at least two images.") }
        }
        primary.style = step.showsLiveContent && step != .success && step != .firstAnswer ? .secondary : .primary
        if changed || step == .permission { illustration.present(step: step, granted: granted, animated: changed && !step.showsLiveContent) }
        illustration.isHidden = step.showsLiveContent
        heading.alignment = .center
        detail.alignment = step.showsLiveContent || step == .permission ? .left : .center
        note.alignment = step == .permission ? .left : .center
        let captureStep = [.capture, .multiCapture, .collecting].contains(step) || (step == .working && failed)
        primary.isHidden = [.capture, .multiCapture, .collecting, .working].contains(step)
        primary.isEnabled = !primary.isHidden && !capturing && !(step == .trial && [.unavailable, .loading, .claiming].contains(trial))
        shortcutPrompt.combo = multiple || [.multiCapture, .collecting].contains(step) ? Settings.shared.contextCombo : Settings.shared.captureCombo
        shortcutPrompt.isHidden = !captureStep || capturing || previewing || (step == .collecting && screenshotCount >= 4)
        if capturing { detail.stringValue = t("正在截图…", "撮影中…", "Capturing…") }
        if primary.isHidden, window?.firstResponder === primary { window?.makeFirstResponder(self) }
        surface.isHidden = step.showsLiveContent
        heading.isHidden = step.showsLiveContent
        note.isHidden = copy.note.isEmpty
        Self.applyBodyStyle(to: detail)
        Self.applyBodyStyle(to: note)
        back.title = t("返回", "戻る", "Back")
        back.isHidden = ![.permission, .practice, .capture, .multiple, .multiCapture].contains(step) && !(step == .working && failed)
        secondary.title = step == .trial ? t("暂不领取", "今はスキップ", "Skip for now") : t("修改快捷键", "ショートカット設定", "Change shortcut")
        secondary.isHidden = step == .trial ? [.loading, .claiming, .claimed, .expired, .ineligible].contains(trial) : !captureStep || capturing || previewing
        closeButton.title = step == .trial && trial == .claimed ? t("完成", "完了", "Finish") : t("稍后继续", "あとで", "Later")
        closeButton.toolTip = step == .trial && trial == .claimed ? t("完成引导", "ガイドを完了", "Finish setup") : t("收起引导 · 可在刘海菜单中继续", "閉じる・ノッチメニューで再開", "Close · resume from the notch menu")
        languages.isHidden = step != .welcome
        languages.selectItem(at: L10n.setting == .ja ? 1 : L10n.setting == .en ? 2 : 0)
        targetButton.isHidden = step != .permission
        targetButton.title = t("更改截图目标", "撮影対象を変更", "Change target")
        primary.shortcut = nil
        primary.showsForwardArrow = !primary.isHidden && step != .permission
        needsLayout = true
        if shouldTransition { transitionCopy() }
        if changed { NSAccessibility.post(element: self, notification: .layoutChanged) }
    }

    func configureTopLayout(cutout: CGRect?, availableWidth: CGFloat, headerInset: CGFloat, bodyAdjustment: CGFloat) {
        guard topCutout != cutout || availableTopWidth != availableWidth || self.headerInset != headerInset || self.bodyAdjustment != bodyAdjustment else { return }
        topCutout = cutout; availableTopWidth = availableWidth; self.headerInset = headerInset; self.bodyAdjustment = bodyAdjustment
        needsLayout = true; layoutSubtreeIfNeeded()
    }
    /// Page changes resize the real panel on its display-link spring. The action row follows
    /// that same visible edge, instead of teleporting to a destination outside the window.
    func followPresentationHeight(_ height: CGFloat?) {
        let aligned = height.map { NotchGeometry.pixelAlign($0, scale: window?.backingScaleFactor ?? 2) }
        guard presentationHeight != aligned else { return }
        presentationHeight = aligned
        needsLayout = true
        layoutSubtreeIfNeeded()
    }
    private static let bodySize: CGFloat = 13
    private static let bodyColor = NSColor(white: 1, alpha: 0.72)
    private static let bodyLineSpacing: CGFloat = 3
    private static let paragraphGap: CGFloat = 12
    private static let footerTopInset: CGFloat = 16
    private static let footerCopyHeight: CGFloat = 42
    private static let actionHeight: CGFloat = 38
    static func footerHeight(for step: NotchOnboardingStep) -> CGFloat {
        footerTopInset + footerCopyHeight + paragraphGap + actionHeight + 18
    }
    private static let illustrationHeight: CGFloat = 104
    private static let titleSize: CGFloat = 25
    private static func copyWidth(_ width: CGFloat, step: NotchOnboardingStep) -> CGFloat {
        min(width - 2 * (NotchLayout.contentInsetH + NotchType.cardPadH), step == .permission ? 480 : 464)
    }
    private static func measured(_ text: String, size: CGFloat, width: CGFloat, weight: NSFont.Weight = .regular, alignment: NSTextAlignment = .left, lineSpacing: CGFloat = 0) -> CGFloat {
        let field = NSTextField(wrappingLabelWithString: text)
        field.font = .systemFont(ofSize: size, weight: weight); field.maximumNumberOfLines = 0
        field.alignment = alignment
        let paragraph = NSMutableParagraphStyle()
        paragraph.alignment = alignment
        paragraph.lineSpacing = lineSpacing
        field.attributedStringValue = NSAttributedString(string: text,
            attributes: [.font: field.font!, .paragraphStyle: paragraph])
        return ceil(field.sizeThatFits(.init(width: max(1, width), height: 10000)).height)
    }
    private static func measuredBody(_ text: String, width: CGFloat, alignment: NSTextAlignment) -> CGFloat {
        measured(text, size: bodySize, width: width, alignment: alignment, lineSpacing: bodyLineSpacing)
    }
    static func contentHeight(for step: NotchOnboardingStep, width: CGFloat) -> CGFloat {
        if step.showsLiveContent { return NotchLayout.headerHeight + footerHeight(for: step) }
        let textWidth = copyWidth(width, step: step)
        // Every variation has the same action baseline, including failed browser launches.
        let variants = [copy(step), copy(step, granted: true), copy(step, denied: true, failed: true),
                        copy(step, trial: .claimed, trialExpiration: "2026-10-19 12:00"), copy(step, trial: .failed),
                        copy(step, trial: .available), copy(step, trial: .ineligible), copy(step, trial: .expired)]
        let alignment: NSTextAlignment = step == .permission ? .left : .center
        let title = variants.map { measured($0.title, size: titleSize, width: textWidth, weight: .semibold, alignment: .center) }.max() ?? 30
        let body = variants.map { measuredBody($0.body, width: textWidth, alignment: alignment) }.max() ?? 32
        let note = variants.map { $0.note.isEmpty ? 0 : measuredBody($0.note, width: textWidth, alignment: alignment) + paragraphGap }.max() ?? 0
        let target: CGFloat = step == .permission ? 34 : 0
        let copyHeight = title + paragraphGap + body + note + target
        return NotchLayout.headerHeight + 16 + illustrationHeight + 16 + copyHeight + 28 + 64 + NotchLayout.answerBottomPad
    }
    override func layout() {
        super.layout()
        guard let step else { return }
        let w = bounds.width, inset = NotchLayout.contentInsetH + NotchType.cardPadH
        let textWidth = Self.copyWidth(w, step: step)
        let textX = (w - textWidth) / 2
        copyPlate.frame = bounds
        copyPlate.alphaValue = 1
        detail.alphaValue = 1
        note.alphaValue = 1
        let headerTextHeight = ceil(eyebrow.sizeThatFits(.init(width: 270, height: 100)).height)
        eyebrow.frame = .init(x: 44, y: Self.headerRowCenterY + headerInset - headerTextHeight / 2, width: 270, height: headerTextHeight)
        closeButton.frame = .init(x: w - 115, y: Self.headerRowCenterY + headerInset - 14, width: 96, height: 28)
        eyebrow.toolTip = eyebrow.stringValue; eyebrow.isHidden = false; closeButton.isHidden = false
        if let cutout = topCutout {
            let liveWidth = min(w, availableTopWidth)
            eyebrow.frame.size.width = max(0, min(liveWidth - 20, cutout.minX - 8) - eyebrow.frame.minX)
            closeButton.frame.origin.x = liveWidth - 115
            eyebrow.isHidden = eyebrow.frame.width < 24
            closeButton.isHidden = closeButton.frame.minX < cutout.maxX + 8
        }
        let buttonWidth = max(166, primary.intrinsicContentSize.width)
        if step.showsLiveContent {
            let top = (presentationHeight ?? bounds.height) - Self.footerHeight(for: step)
            detail.frame = .init(x: inset, y: top + Self.footerTopInset, width: w - 2 * inset, height: Self.footerCopyHeight)
            let actionY = detail.frame.maxY + Self.paragraphGap
            primary.frame = .init(x: w - inset - buttonWidth, y: actionY, width: buttonWidth, height: Self.actionHeight)
            back.frame = .init(x: inset - 8, y: actionY, width: back.intrinsicContentSize.width, height: Self.actionHeight)
            layoutShortcutRow(y: actionY, width: w, inset: inset, live: true)
            footerRule.isHidden = true
            return
        }
        footerRule.isHidden = false
        // Resizing changes only the card and action row. Measure text once per actual copy
        // or width change, rather than allocating text cells on every display-link frame.
        let key = MeasurementKey(step: step, width: w, title: heading.stringValue, body: detail.stringValue, note: note.stringValue)
        if measuredKey != key {
            measuredKey = key
            measuredCopy = (
                Self.measured(heading.stringValue, size: Self.titleSize, width: textWidth, weight: .semibold, alignment: heading.alignment),
                Self.measuredBody(detail.stringValue, width: textWidth, alignment: detail.alignment),
                note.isHidden ? 0 : Self.measuredBody(note.stringValue, width: textWidth, alignment: note.alignment),
                Self.contentHeight(for: step, width: w))
        }
        let height = measuredCopy.height
        surface.frame = NotchLayout.shelfFrame(width: w, top: NotchLayout.headerHeight + bodyAdjustment,
            height: (presentationHeight.map { $0 - bodyAdjustment } ?? height) - NotchLayout.headerHeight - NotchLayout.answerBottomPad)
        illustration.frame = .init(x: inset, y: surface.frame.minY + 16, width: w - 2 * inset, height: Self.illustrationHeight)
        var y = illustration.frame.maxY + 16
        let titleH = measuredCopy.title
        heading.frame = .init(x: textX, y: y, width: textWidth, height: titleH); y += titleH + Self.paragraphGap
        let bodyH = measuredCopy.body
        detail.frame = .init(x: textX, y: y, width: textWidth, height: bodyH); y += bodyH
        if !note.isHidden {
            y += Self.paragraphGap
            let noteH = measuredCopy.note
            note.frame = .init(x: textX, y: y, width: textWidth, height: noteH); y += noteH
        }
        targetButton.frame = .init(x: textX - 8, y: y + 4, width: targetButton.intrinsicContentSize.width, height: 28)
        let actionY = surface.frame.maxY - 52
        footerRule.frame = .init(x: inset, y: actionY - 13, width: w - 2 * inset, height: 1)
        primary.frame = .init(x: w - inset - buttonWidth, y: actionY, width: buttonWidth, height: 38)
        back.frame = .init(x: inset - 8, y: actionY, width: back.intrinsicContentSize.width, height: 38)
        layoutShortcutRow(y: actionY, width: w, inset: inset, live: false)
        if step == .trial { secondary.frame.origin.x = inset - 8 }
        languages.frame = .init(x: inset - 6, y: actionY + 5, width: 116, height: 28)
        // Taller permission copy enters only once it has room above the moving action row.
        // This also prevents invisible controls from intercepting the primary action mid-resize.
        let copyBottom = step == .permission ? targetButton.frame.maxY : y
        let clearance = footerRule.frame.minY - copyBottom
        // Keep the illustration and heading present throughout the handoff. Only copy that
        // would collide with the action row waits for space; the entire page never goes blank.
        detail.alphaValue = min(1, max(0, (footerRule.frame.minY - detail.frame.maxY - 4) / 12))
        note.alphaValue = min(1, max(0, (footerRule.frame.minY - note.frame.maxY - 4) / 12))
        targetButton.isHidden = step != .permission || clearance < 4
    }
    private func layoutShortcutRow(y: CGFloat, width: CGFloat, inset: CGFloat, live: Bool) {
        let size = shortcutPrompt.intrinsicContentSize
        shortcutPrompt.frame = NSRect(x: live && back.isHidden ? inset : (width - size.width) / 2, y: y, width: size.width, height: size.height)
        let helpWidth = secondary.intrinsicContentSize.width
        secondary.frame = NSRect(x: width - inset - helpWidth + 8, y: y, width: helpWidth, height: 38)
    }

    private static var permissionDetailText: String {
        L10n.t("截图目标：", "撮影対象：", "Capture target: ") + captureTargetLabel + "\n" + CaptureProcessing.channelNote
    }
    private static var captureTargetLabel: String {
        guard let id = Settings.shared.captureTargetBundleID else { return L10n.t("整个屏幕", "画面全体", "Entire screen") }
        let name = Settings.shared.captureTargetName ?? ""
        return (name.isEmpty ? id : name) + (NSRunningApplication.runningApplications(withBundleIdentifier: id).isEmpty
            ? L10n.t("（未运行，请先打开）", "（未起動）", " (not running; open it first)") : "")
    }
    private func transitionCopy() {
        // Core Animation retains the previous rendered contents for this crossfade. Keeping
        // one plate avoids individual labels blinking or drifting at different times.
        copyPlate.layer?.removeAnimation(forKey: "page-handoff")
        primary.layer?.removeAnimation(forKey: "page-handoff")
        guard !onboardingReduceMotion(), window != nil else { return }
        let fade = CATransition()
        fade.type = .fade
        fade.duration = onboardingMotionDuration(0.24)
        fade.timingFunction = CAMediaTimingFunction(controlPoints: 0.22, 0.68, 0, 1)
        copyPlate.layer?.add(fade, forKey: "page-handoff")
        primary.layer?.add(fade, forKey: "page-handoff")
    }
    private static func label(_ size: CGFloat, _ weight: NSFont.Weight, _ color: NSColor) -> NSTextField {
        let field = NSTextField(wrappingLabelWithString: "")
        field.font = .systemFont(ofSize: size, weight: weight); field.textColor = color; field.maximumNumberOfLines = 0
        return field
    }
    private static func bodyLabel() -> NSTextField { label(bodySize, .regular, bodyColor) }
    private static func applyBodyStyle(to field: NSTextField) {
        let paragraph = NSMutableParagraphStyle()
        paragraph.alignment = field.alignment
        paragraph.lineSpacing = bodyLineSpacing
        field.attributedStringValue = NSAttributedString(string: field.stringValue, attributes: [
            .font: NSFont.systemFont(ofSize: bodySize), .foregroundColor: bodyColor, .paragraphStyle: paragraph,
        ])
    }
}

private final class OnboardingCopyPlate: NSView {
    override var isFlipped: Bool { true }
    override init(frame: NSRect) { super.init(frame: frame); wantsLayer = true }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
}

private final class OnboardingRuleView: NSView {
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
    override func draw(_ dirtyRect: NSRect) {
        NSColor(white: 1, alpha: 0.08).setFill()
        let scale = window?.backingScaleFactor ?? 2
        NSRect(x: 0, y: 0, width: bounds.width, height: 1 / scale).fill()
    }
}
