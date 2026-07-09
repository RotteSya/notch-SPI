import AppKit
import CoreGraphics

// First-launch onboarding v2 — the product's opening scene. A borderless obsidian window over a
// live aurora shader, five pages, zero technical vocabulary (no API / CLI / Key / Token):
//
//   1. Welcome        — brand moment + language choice (applies live)
//   2. How it works   — hotkey → screen → answer, in three illustrated beats
//   3. Screen access  — why we need it, one-click grant, live green check
//   4. The gift       — silent device registration + the 180-question counter + confetti
//   5. Try it         — the hotkey as physical keycaps; finish
//
// Every step is skippable and failure never blocks: registration re-runs on first capture, and
// the capture path already explains a missing screen-recording permission. Power users find the
// custom-key / CLI channels later in 设置 → 高级.

// MARK: - Window

/// Borderless, rounded, draggable panel that can become key (buttons + pills need clicks).
final class OnboardingWindow: NSWindow {
    init(contentViewController: NSViewController) {
        super.init(
            contentRect: NSRect(origin: .zero, size: OnboardingViewController.contentSize),
            styleMask: [.borderless, .fullSizeContentView],
            backing: .buffered, defer: false)
        self.contentViewController = contentViewController
        isOpaque = false
        backgroundColor = .clear
        hasShadow = true
        isMovableByWindowBackground = true
        isReleasedWhenClosed = false
        sharingType = ScreenShareGuard.windowSharingType
        level = .floating
    }

    override var canBecomeKey: Bool { true }

    override func cancelOperation(_ sender: Any?) {
        // Esc = "let me out" — close without blocking; onboarding won't nag again.
        (contentViewController as? OnboardingViewController)?.finish()
    }
}

// MARK: - Page base

/// One onboarding page. Subclasses lay out in a flipped coordinate space sized to `pageSize`.
private class OnboardingPage: NSView {
    override var isFlipped: Bool { true }
    /// Called each time the page becomes the visible one.
    func pageDidAppear() {}
    /// Called when the page is being left (stop timers etc.).
    func pageWillDisappear() {}
    /// Re-render all strings after a language switch.
    func rebuildStrings() {}
}

private func onboardingLabel(_ text: String = "", size: CGFloat, weight: NSFont.Weight,
                             color: NSColor, align: NSTextAlignment = .center) -> NSTextField {
    let f = NSTextField(wrappingLabelWithString: text)
    f.font = .systemFont(ofSize: size, weight: weight)
    f.textColor = color
    f.alignment = align
    f.isSelectable = false
    return f
}

// MARK: - View controller

final class OnboardingViewController: NSViewController {
    /// Called after onboarding completes (refresh header labels, drop the window).
    var onFinished: (() -> Void)?

    static let contentSize = NSSize(width: 580, height: 470)
    fileprivate static let pageSize = NSSize(width: 580, height: 386)

    private let aurora = AuroraBackgroundView()
    private let pageHost = OnboardingFlippedView()
    private let dots = StepDotsView()
    private let backButton = GlowButton(title: "", style: .ghost)
    private let nextButton = GlowButton(title: "", style: .primary)

    private var pages: [OnboardingPage] = []
    private var index = 0
    private var animating = false
    private var langObserver: NSObjectProtocol?

    private var reduceMotion: Bool { NSWorkspace.shared.accessibilityDisplayShouldReduceMotion }

    override func loadView() {
        let root = OnboardingFlippedView(frame: NSRect(origin: .zero, size: Self.contentSize))
        root.wantsLayer = true
        root.layer?.cornerRadius = 22
        root.layer?.masksToBounds = true
        root.layer?.backgroundColor = NSColor(srgbRed: 0.02, green: 0.02, blue: 0.05, alpha: 1).cgColor

        aurora.frame = root.bounds
        aurora.autoresizingMask = [.width, .height]
        root.addSubview(aurora)

        pageHost.frame = NSRect(x: 0, y: 0, width: Self.pageSize.width, height: Self.pageSize.height)
        root.addSubview(pageHost)

        pages = [WelcomePage(), HowItWorksPage(), PermissionPage(), GiftPage(), TryItPage()]
        dots.count = pages.count

        // Bottom bar: [back ghost] [dots] [continue primary]
        let barY = Self.contentSize.height - 34 - 26
        backButton.onClick = { [weak self] in self?.go(-1) }
        backButton.frame = NSRect(x: 28, y: barY, width: 90, height: 34)
        root.addSubview(backButton)

        dots.frame = NSRect(x: (Self.contentSize.width - dots.intrinsicContentSize.width) / 2,
                            y: barY + 14, width: dots.intrinsicContentSize.width, height: 6)
        root.addSubview(dots)

        nextButton.onClick = { [weak self] in self?.advance() }
        root.addSubview(nextButton)

        view = root

        var startPage = 0
        #if DEBUG
        // Visual-QA hook: `--qa-onboarding-page N` jumps straight to page N for screenshots.
        let args = ProcessInfo.processInfo.arguments
        if let i = args.firstIndex(of: "--qa-onboarding-page"), i + 1 < args.count,
           let n = Int(args[i + 1]), (0..<pages.count).contains(n) {
            startPage = n
        }
        #endif
        showPage(startPage, direction: 0)

        // Warm up the account in the background so the gift page usually has the number ready.
        if Settings.shared.serviceMode == ServiceMode.official {
            Task { await OfficialAPI.registerIfNeeded() }
        }

        langObserver = NotificationCenter.default.addObserver(
            forName: L10n.languageDidChange, object: nil, queue: .main
        ) { [weak self] _ in
            self?.pages.forEach { $0.rebuildStrings() }
            self?.updateChrome()
        }
    }

    deinit {
        if let langObserver { NotificationCenter.default.removeObserver(langObserver) }
    }

    // MARK: Navigation

    private func advance() {
        if index == pages.count - 1 { finish() } else { go(+1) }
    }

    private func go(_ delta: Int) {
        let target = index + delta
        guard !animating, target >= 0, target < pages.count else { return }
        showPage(target, direction: delta)
    }

    private func showPage(_ newIndex: Int, direction: Int) {
        let old = pageHost.subviews.first as? OnboardingPage
        let page = pages[newIndex]
        index = newIndex
        updateChrome()

        page.frame = pageHost.bounds
        old?.pageWillDisappear()

        guard let old, direction != 0, !reduceMotion else {
            old?.removeFromSuperview()
            pageHost.addSubview(page)
            page.pageDidAppear()
            return
        }

        // Horizontal slide + crossfade, both pages moving as one strip.
        animating = true
        let w = pageHost.bounds.width
        page.frame.origin.x = CGFloat(direction) * w
        page.alphaValue = 0
        pageHost.addSubview(page)
        NSAnimationContext.runAnimationGroup({ ctx in
            ctx.duration = 0.34
            ctx.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
            page.animator().frame.origin.x = 0
            page.animator().alphaValue = 1
            old.animator().frame.origin.x = CGFloat(-direction) * w * 0.55
            old.animator().alphaValue = 0
        }, completionHandler: { [weak self] in
            old.removeFromSuperview()
            old.alphaValue = 1
            self?.animating = false
            page.pageDidAppear()
        })
    }

    /// Bottom-bar state for the current page (labels follow the live language).
    private func updateChrome() {
        dots.current = index
        backButton.title = L10n.back
        backButton.isHidden = index == 0
        let last = index == pages.count - 1
        nextButton.title = last
            ? L10n.t("开始使用", "使いはじめる", "Start Using")
            : (index == 0 ? L10n.t("开始", "はじめる", "Get Started") : L10n.next)
        let size = nextButton.intrinsicContentSize
        let barY = Self.contentSize.height - 34 - 26
        nextButton.frame = NSRect(x: Self.contentSize.width - 28 - size.width, y: barY,
                                  width: size.width, height: 34)
        nextButton.needsDisplay = true
        backButton.needsDisplay = true
    }

    fileprivate func finish() {
        Settings.shared.onboardingDone = true
        onFinished?()
        view.window?.close()
    }
}

private final class OnboardingFlippedView: NSView {
    override var isFlipped: Bool { true }
}

// MARK: - Page 1 · Welcome

private final class WelcomePage: OnboardingPage {
    private let rose = RoseLoaderView()
    private let title = onboardingLabel(size: 30, weight: .bold, color: .white)
    private let tagline = onboardingLabel(size: 14, weight: .regular, color: NSColor(white: 1, alpha: 0.65))
    private var pills: [LanguagePill] = []

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        let size = OnboardingViewController.pageSize

        rose.color = .white
        rose.frame = NSRect(x: size.width / 2 - 36, y: 58, width: 72, height: 72)
        addSubview(rose)

        title.frame = NSRect(x: 40, y: 150, width: size.width - 80, height: 40)
        addSubview(title)

        tagline.frame = NSRect(x: 60, y: 196, width: size.width - 120, height: 44)
        addSubview(tagline)

        // Language pills — preselected from the system, applied live on click.
        let choices: [AppLanguage] = [.zhHans, .ja, .en]
        var totalW: CGFloat = 0
        for lang in choices {
            let pill = LanguagePill(language: lang)
            pill.onPick = { [weak self] picked in
                L10n.setting = picked // fires languageDidChange → whole flow re-renders
                self?.refreshPills()
            }
            pills.append(pill)
            totalW += pill.intrinsicContentSize.width
        }
        totalW += CGFloat(pills.count - 1) * 10
        var x = (size.width - totalW) / 2
        for pill in pills {
            let w = pill.intrinsicContentSize.width
            pill.frame = NSRect(x: x, y: 268, width: w, height: 28)
            addSubview(pill)
            x += w + 10
        }

        rebuildStrings()
        refreshPills()
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    private func refreshPills() {
        let resolved = L10n.lang
        for pill in pills {
            let matches: Bool
            switch (pill.language, resolved) {
            case (.zhHans, .zh), (.ja, .ja), (.en, .en): matches = true
            default: matches = false
            }
            pill.isChosen = matches
        }
    }

    override func rebuildStrings() {
        title.stringValue = "NotchSPI"
        tagline.stringValue = L10n.t(
            "藏在刘海里的解题助手 — 一按快捷键，答案悄悄浮现。",
            "ノッチにひそむ解答アシスタント — ショートカットひとつで、答えがそっと現れる。",
            "The answer assistant hiding in your notch — one hotkey, and the answer quietly appears.")
        refreshPills()
    }
}

// MARK: - Page 2 · How it works

private final class HowItWorksPage: OnboardingPage {
    private struct Row {
        let icon: NSImageView
        let iconCircle: CircleIconView
        let title: NSTextField
        let desc: NSTextField
    }

    private let heading = onboardingLabel(size: 21, weight: .bold, color: .white)
    private var rows: [Row] = []
    private var rowContainers: [NSView] = []

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        let size = OnboardingViewController.pageSize

        heading.frame = NSRect(x: 40, y: 44, width: size.width - 80, height: 30)
        addSubview(heading)

        let icons = ["keyboard", "text.viewfinder", "sparkles"]
        var y: CGFloat = 104
        for name in icons {
            let container = OnboardingFlippedView(frame: NSRect(x: 76, y: y, width: size.width - 152, height: 74))

            let circle = CircleIconView(symbolName: name)
            circle.frame = NSRect(x: 0, y: 8, width: 46, height: 46)
            container.addSubview(circle)

            let t = onboardingLabel(size: 14.5, weight: .semibold, color: .white, align: .left)
            t.frame = NSRect(x: 66, y: 6, width: container.bounds.width - 66, height: 20)
            container.addSubview(t)

            let d = onboardingLabel(size: 12, weight: .regular, color: NSColor(white: 1, alpha: 0.6), align: .left)
            d.frame = NSRect(x: 66, y: 28, width: container.bounds.width - 66, height: 34)
            container.addSubview(d)

            addSubview(container)
            rowContainers.append(container)
            rows.append(Row(icon: NSImageView(), iconCircle: circle, title: t, desc: d))
            y += 84
        }
        rebuildStrings()
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func rebuildStrings() {
        heading.stringValue = L10n.t("三步，答案到手", "3ステップで答えが手に入る", "Three beats to an answer")
        let hotkey = Settings.displayString(Settings.shared.captureCombo)
        let texts: [(String, String)] = [
            (L10n.t("按下 \(hotkey)", "\(hotkey) を押す", "Press \(hotkey)"),
             L10n.t("在任何题目界面按下快捷键 — 网页、PDF、题库软件都可以。",
                    "問題が表示されている画面ならどこでも — Web、PDF、テストアプリでもOK。",
                    "On any screen with a question — web pages, PDFs, quiz apps, anything.")),
            (L10n.t("屏幕被轻轻读取", "画面をそっと読み取る", "Your screen is read, gently"),
             L10n.t("NotchSPI 截取当前画面并识别其中的题目，全程无需复制粘贴。",
                    "NotchSPI が画面を読み取り問題を認識。コピー&ペーストは不要。",
                    "NotchSPI captures the screen and reads the question — no copy-paste, ever.")),
            (L10n.t("答案从刘海流出", "ノッチから答えが流れ出す", "The answer flows from the notch"),
             L10n.t("讲解在刘海下方逐字浮现，且不会出现在录屏和共享画面里。",
                    "解説がノッチの下に少しずつ現れます。画面録画や共有には映りません。",
                    "The explanation streams in below the notch — invisible to recordings and screen shares.")),
        ]
        for (i, row) in rows.enumerated() {
            row.title.stringValue = texts[i].0
            row.desc.stringValue = texts[i].1
        }
    }

    override func pageDidAppear() {
        guard !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion else { return }
        // Staggered rise-in for the three beats.
        for (i, container) in rowContainers.enumerated() {
            let finalY = container.frame.origin.y
            container.alphaValue = 0
            container.frame.origin.y = finalY + 14
            DispatchQueue.main.asyncAfter(deadline: .now() + Double(i) * 0.12) {
                NSAnimationContext.runAnimationGroup { ctx in
                    ctx.duration = 0.4
                    ctx.timingFunction = CAMediaTimingFunction(name: .easeOut)
                    container.animator().alphaValue = 1
                    container.animator().frame.origin.y = finalY
                }
            }
        }
    }
}

/// A soft glass circle holding a tinted SF Symbol — the "how it works" iconography.
private final class CircleIconView: NSView {
    private let symbolName: String

    init(symbolName: String) {
        self.symbolName = symbolName
        super.init(frame: .zero)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func draw(_ dirtyRect: NSRect) {
        let circle = NSBezierPath(ovalIn: bounds.insetBy(dx: 1, dy: 1))
        NotchPalette.accent.withAlphaComponent(0.14).setFill()
        circle.fill()
        circle.lineWidth = 1
        NotchPalette.accentHi.withAlphaComponent(0.35).setStroke()
        circle.stroke()
        if let img = notchTintedSymbol(symbolName, pointSize: 19, weight: .medium, color: NotchPalette.accentHi) {
            let s = img.size
            img.draw(in: NSRect(x: bounds.midX - s.width / 2, y: bounds.midY - s.height / 2,
                                width: s.width, height: s.height))
        }
    }
}

// MARK: - Page 3 · Screen access

private final class PermissionPage: OnboardingPage {
    private let icon = CircleIconView(symbolName: "rectangle.inset.filled.badge.record")
    private let heading = onboardingLabel(size: 21, weight: .bold, color: .white)
    private let body = onboardingLabel(size: 13, weight: .regular, color: NSColor(white: 1, alpha: 0.65))
    private let grantButton = GlowButton(title: "", style: .primary)
    private let statusLabel = onboardingLabel(size: 13, weight: .medium, color: NotchPalette.accentHi)
    private var pollTimer: Timer?

    private var granted: Bool { CGPreflightScreenCaptureAccess() }

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        let size = OnboardingViewController.pageSize

        icon.frame = NSRect(x: size.width / 2 - 30, y: 48, width: 60, height: 60)
        addSubview(icon)

        heading.frame = NSRect(x: 40, y: 126, width: size.width - 80, height: 30)
        addSubview(heading)

        body.frame = NSRect(x: 78, y: 162, width: size.width - 156, height: 62)
        addSubview(body)

        grantButton.onClick = { [weak self] in self?.grantTapped() }
        addSubview(grantButton)

        statusLabel.frame = NSRect(x: 40, y: 292, width: size.width - 80, height: 22)
        addSubview(statusLabel)

        rebuildStrings()
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func rebuildStrings() {
        heading.stringValue = L10n.t("允许 NotchSPI 看到屏幕", "画面へのアクセスを許可", "Let NotchSPI see your screen")
        body.stringValue = L10n.t(
            "为了读取屏幕上的题目，需要你在系统设置里勾选「屏幕录制」权限。截图只在按下快捷键的那一刻发生，用完即删。",
            "画面上の問題を読み取るために、システム設定で「画面収録」の許可が必要です。撮影はショートカットを押した瞬間だけ。使用後は即座に削除されます。",
            "To read questions on your screen, macOS asks you to allow Screen Recording. A capture happens only at the moment you press the hotkey, and is deleted right after use.")
        layoutButton()
        refreshStatus(animated: false)
    }

    private func layoutButton() {
        grantButton.title = granted
            ? L10n.t("已授权", "許可済み", "Access granted")
            : L10n.t("去授权", "許可する", "Grant Access")
        let w = grantButton.intrinsicContentSize.width
        grantButton.frame = NSRect(x: (OnboardingViewController.pageSize.width - w) / 2, y: 244, width: w, height: 34)
        grantButton.needsDisplay = true
    }

    private func grantTapped() {
        guard !granted else { return }
        // First call triggers the system prompt; later calls open System Settings directly.
        if !CGRequestScreenCaptureAccess() {
            let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")!
            NSWorkspace.shared.open(url)
        }
    }

    private func refreshStatus(animated: Bool) {
        if granted {
            statusLabel.textColor = NSColor(srgbRed: 0.45, green: 0.85, blue: 0.60, alpha: 1)
            statusLabel.stringValue = L10n.t("✓ 已授权，一切就绪", "✓ 許可されました。準備完了", "✓ Granted — all set")
            pollTimer?.invalidate()
            pollTimer = nil
            if animated, !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion {
                statusLabel.alphaValue = 0
                NSAnimationContext.runAnimationGroup { ctx in
                    ctx.duration = 0.5
                    statusLabel.animator().alphaValue = 1
                }
            }
        } else {
            statusLabel.textColor = NSColor(white: 1, alpha: 0.45)
            statusLabel.stringValue = L10n.t("尚未授权 — 也可以稍后在需要时再开", "未許可 — あとで必要になったときでもOK", "Not granted yet — you can also do this later")
        }
        layoutButton()
    }

    override func pageDidAppear() {
        refreshStatus(animated: false)
        guard !granted, pollTimer == nil else { return }
        // Live-poll while the user is off in System Settings; the green check appears by itself.
        pollTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            guard let self else { return }
            if self.granted { self.refreshStatus(animated: true) }
        }
    }

    override func pageWillDisappear() {
        pollTimer?.invalidate()
        pollTimer = nil
    }

    deinit { pollTimer?.invalidate() }
}

// MARK: - Page 4 · The gift

private final class GiftPage: OnboardingPage {
    private let heading = onboardingLabel(size: 21, weight: .bold, color: .white)
    private let counter = RollingCounterView()
    private let note = onboardingLabel(size: 13, weight: .regular, color: NSColor(white: 1, alpha: 0.65))
    private let confetti = ConfettiView()
    private var celebrated = false

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        let size = OnboardingViewController.pageSize

        heading.frame = NSRect(x: 40, y: 58, width: size.width - 80, height: 30)
        addSubview(heading)

        counter.frame = NSRect(x: 40, y: 108, width: size.width - 80, height: 90)
        counter.color = .white
        counter.onFinished = { [weak self] in
            guard let self, !self.celebrated else { return }
            self.celebrated = true
            self.confetti.burst()
        }
        addSubview(counter)

        note.frame = NSRect(x: 70, y: 218, width: size.width - 140, height: 60)
        addSubview(note)

        confetti.frame = bounds
        confetti.autoresizingMask = [.width, .height]
        addSubview(confetti)

        rebuildStrings()
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func rebuildStrings() {
        heading.stringValue = L10n.t("你的见面礼", "はじめましての贈りもの", "A little welcome gift")
        counter.suffix = L10n.t("题", "問", "questions")
        updateNote(registered: OfficialAPI.deviceToken != nil)
    }

    private func updateNote(registered: Bool) {
        note.stringValue = registered
            ? L10n.t("免费额度已到账。每答一题消耗 1 题，失败不扣。",
                     "無料枠が届きました。1回の回答につき1問消費。失敗時は消費されません。",
                     "Your free questions have arrived. Each answer costs one; failures are never charged.")
            : L10n.t("免费额度将在首次使用时自动到账（需要联网）。",
                     "無料枠は初回利用時に自動で届きます(ネット接続が必要)。",
                     "Your free questions will arrive automatically on first use (network required).")
    }

    override func pageDidAppear() {
        celebrated = false
        if let balance = OfficialAPI.balanceQuestions, OfficialAPI.deviceToken != nil {
            updateNote(registered: true)
            counter.roll(to: balance)
        } else {
            // Registration may still be in flight from the welcome page; try once more here.
            counter.set(0)
            Task { @MainActor in
                _ = await OfficialAPI.registerIfNeeded()
                let registered = OfficialAPI.deviceToken != nil
                self.updateNote(registered: registered)
                if registered {
                    self.counter.roll(to: OfficialAPI.balanceQuestions ?? 180)
                }
            }
        }
    }
}

// MARK: - Page 5 · Try it

private final class TryItPage: OnboardingPage {
    private let heading = onboardingLabel(size: 21, weight: .bold, color: .white)
    private let keycaps = KeycapChipView(keys: [], capSize: 46)
    private let hint = onboardingLabel(size: 13, weight: .regular, color: NSColor(white: 1, alpha: 0.65))
    private let subHint = onboardingLabel(size: 12, weight: .regular, color: NSColor(white: 1, alpha: 0.45))

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        let size = OnboardingViewController.pageSize

        heading.frame = NSRect(x: 40, y: 62, width: size.width - 80, height: 30)
        addSubview(heading)

        keycaps.wantsLayer = true
        addSubview(keycaps)

        hint.frame = NSRect(x: 70, y: 226, width: size.width - 140, height: 40)
        addSubview(hint)

        subHint.frame = NSRect(x: 70, y: 280, width: size.width - 140, height: 36)
        addSubview(subHint)

        rebuildStrings()
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func rebuildStrings() {
        heading.stringValue = L10n.t("现在就试试", "さっそく試してみよう", "Try it right now")
        keycaps.keys = KeycapChipView.caps(from: Settings.shared.captureCombo)
        let w = keycaps.intrinsicContentSize.width
        keycaps.frame = NSRect(x: (OnboardingViewController.pageSize.width - w) / 2, y: 120,
                               width: w, height: keycaps.intrinsicContentSize.height)
        hint.stringValue = L10n.t(
            "打开任意一道题，按下这个组合键 — 答案会从屏幕顶部的刘海里浮现。",
            "問題を開いてこのキーを押すと、画面上部のノッチから答えが現れます。",
            "Open any question and press these keys — the answer appears from the notch at the top of your screen.")
        subHint.stringValue = L10n.t(
            "想调整快捷键、语言或外观？都在刘海右侧的 ⚙ 设置里。",
            "ショートカットや言語、外観の変更は、ノッチ右側の ⚙ 設定からどうぞ。",
            "Hotkeys, language, appearance — everything lives in ⚙ Settings, at the right edge of the notch.")
    }

    override func pageDidAppear() {
        guard !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion,
              let layer = keycaps.layer else { return }
        // A gentle "press me" pulse on the keycaps.
        let pulse = CABasicAnimation(keyPath: "transform.scale")
        pulse.fromValue = 1.0
        pulse.toValue = 0.96
        pulse.duration = 0.9
        pulse.autoreverses = true
        pulse.repeatCount = .infinity
        pulse.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
        layer.anchorPoint = CGPoint(x: 0.5, y: 0.5)
        layer.position = CGPoint(x: keycaps.frame.midX, y: keycaps.frame.midY)
        layer.add(pulse, forKey: "pressPulse")
    }

    override func pageWillDisappear() {
        keycaps.layer?.removeAnimation(forKey: "pressPulse")
    }
}
