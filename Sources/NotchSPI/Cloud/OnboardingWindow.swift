import AppKit
import CoreGraphics

// First-launch onboarding v2 — the product's opening scene. A borderless obsidian window over a
// live aurora shader, five pages, zero technical vocabulary (no API / CLI / Key / Token):
//
//   1. Welcome        — brand moment + language choice (applies live)
//   2. How it works   — hotkey → screen → answer, in three illustrated beats
//   3. Screen access  — why we need it, one-click grant, live green check
//   4. The gift       — tap the sealed medallion to claim a randomly-granted free balance (reveal)
//   5. Try it         — a printed sample question + the hotkey as physical keycaps; finish
//
// Every step is skippable and failure never blocks: registration re-runs on first capture, and
// the capture path already explains a missing screen-recording permission. Power users find the
// custom-key / CLI channels later in 设置 → 高级.

// DEBUG visual-QA: when a gift number is seeded (NSPI_QA_GIFT), keep the whole flow offline — no
// registration network calls — so screenshots are deterministic and QA never creates throwaway
// rows in the production device DB. Always false in release.
private var onboardingQAOffline: Bool {
    #if DEBUG
    return ProcessInfo.processInfo.environment["NSPI_QA_GIFT"] != nil
    #else
    return false
    #endif
}

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
    /// Whether the "continue" affordance should be offered yet. A page can withhold it until the
    /// user performs a required action (the gift page requires the claim tap). Never a hard trap:
    /// Back and Esc always work, and the gate flips on the *gesture*, not on network success.
    var allowsAdvance: Bool { true }
    /// Set by the controller; a page calls it when `allowsAdvance` changes so the chrome refreshes.
    var onStateChange: (() -> Void)?
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
        if Settings.shared.serviceMode == ServiceMode.official, !onboardingQAOffline {
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
        guard pages[index].allowsAdvance else { return } // page is withholding "continue" (e.g. claim)
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
        page.onStateChange = { [weak self] in self?.updateChrome() }
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
        // A page can withhold "continue" until a required action is done (the gift claim). Hide it
        // rather than show a dead, dimmed control — the page's own primary CTA carries the flow.
        nextButton.isHidden = !pages[index].allowsAdvance
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
    private let connector = ConnectorThreadView()
    private var didAnimateIn = false

    private var reduceMotion: Bool { NSWorkspace.shared.accessibilityDisplayShouldReduceMotion }

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        let size = OnboardingViewController.pageSize

        heading.wantsLayer = true
        heading.frame = NSRect(x: 40, y: 44, width: size.width - 80, height: 30)
        addSubview(heading)

        // The connector thread is drawn first so it sits *behind* the glass circles it strings
        // together. It runs through the three icon centers; the segment between them stays visible.
        let firstCenterY: CGFloat = 104 + 8 + 23      // container top + circle inset + radius
        let lastCenterY: CGFloat = firstCenterY + 84 * 2
        connector.frame = NSRect(x: 76 + 23 - 12, y: firstCenterY, width: 24, height: lastCenterY - firstCenterY)
        addSubview(connector)

        let icons = ["keyboard", "text.viewfinder", "sparkles"]
        var y: CGFloat = 104
        for name in icons {
            let container = OnboardingFlippedView(frame: NSRect(x: 76, y: y, width: size.width - 152, height: 74))
            container.wantsLayer = true

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
        guard !reduceMotion else {
            // Reduce Motion: everything already sits at its resting pose; just draw the thread.
            connector.showComplete()
            rowContainers.forEach { $0.layer?.removeAllAnimations(); $0.alphaValue = 1 }
            return
        }
        // Choreographed cascade: heading leads, the three beats settle in on a soft spring, the
        // thread draws down through them, and each icon gives a single quiet ping as it lands.
        didAnimateIn = true
        springIn(heading, delay: 0)
        connector.animateIn(delay: 0.16)
        for (i, container) in rowContainers.enumerated() {
            let delay = 0.10 + Double(i) * 0.11
            springIn(container, delay: delay)
            let circle = rows[i].iconCircle
            DispatchQueue.main.asyncAfter(deadline: .now() + delay + 0.24) { [weak circle] in
                circle?.ping()
            }
        }
    }

    override func pageWillDisappear() {
        // Leave cleanly so a re-entry replays from a blank slate (no half-finished springs).
        connector.reset()
        heading.layer?.removeAllAnimations()
        heading.alphaValue = 1
        for container in rowContainers {
            container.layer?.removeAllAnimations()
            container.alphaValue = 1
        }
    }

    /// A soft scale-up-and-rise entrance with a whisper of overshoot, scaling around the view's own
    /// center (baked into the matrix so the default AppKit anchor point can't drift it sideways).
    private func springIn(_ view: NSView, delay: CFTimeInterval) {
        guard let layer = view.layer else { return }
        layer.removeAnimation(forKey: "springIn-t")
        layer.removeAnimation(forKey: "springIn-o")
        let c = CGPoint(x: view.bounds.midX, y: view.bounds.midY)
        var from = CATransform3DIdentity
        from = CATransform3DTranslate(from, 0, -14, 0)          // start a touch low (rises up)
        from = CATransform3DTranslate(from, c.x, c.y, 0)
        from = CATransform3DScale(from, 0.955, 0.955, 1)
        from = CATransform3DTranslate(from, -c.x, -c.y, 0)

        let now = CACurrentMediaTime()
        let t = CABasicAnimation(keyPath: "transform")
        t.fromValue = NSValue(caTransform3D: from)
        t.toValue = NSValue(caTransform3D: CATransform3DIdentity)
        t.duration = 0.62
        t.timingFunction = CAMediaTimingFunction(controlPoints: 0.22, 1.32, 0.36, 1) // ease-out-back
        t.beginTime = now + delay
        t.fillMode = .backwards
        layer.add(t, forKey: "springIn-t")

        let o = CABasicAnimation(keyPath: "opacity")
        o.fromValue = 0
        o.toValue = 1
        o.duration = 0.42
        o.timingFunction = CAMediaTimingFunction(name: .easeOut)
        o.beginTime = now + delay
        o.fillMode = .backwards
        layer.opacity = 1
        layer.add(o, forKey: "springIn-o")
    }
}

/// A hairline of brand light strung vertically through the three icon circles, drawn on its own
/// clock so it can "grow" downward as the beats land — a small designed detail that ties the three
/// steps into one thought (and reads as deliberate, not stock).
private final class ConnectorThreadView: NSView {
    private var progress: CGFloat = 0
    private var link: CADisplayLink?
    private var startAt: CFTimeInterval = 0
    private let duration: CFTimeInterval = 0.66

    override var isFlipped: Bool { true }            // draw top→bottom, matching the page
    override func hitTest(_ point: NSPoint) -> NSView? { nil }

    func animateIn(delay: CFTimeInterval) {
        progress = 0
        needsDisplay = true
        startAt = CACurrentMediaTime() + delay
        if link == nil {
            let l = displayLink(target: self, selector: #selector(tick))
            l.add(to: .main, forMode: .common)
            link = l
        }
        link?.isPaused = false
    }
    func showComplete() { link?.isPaused = true; progress = 1; needsDisplay = true }
    func reset() { link?.isPaused = true; progress = 0; needsDisplay = true }

    @objc private func tick() {
        let raw = (CACurrentMediaTime() - startAt) / duration
        guard raw >= 0 else { return }
        let t = min(1, raw)
        progress = t * t * (3 - 2 * t)               // smoothstep
        needsDisplay = true
        if t >= 1 { link?.isPaused = true }
    }

    override func draw(_ dirtyRect: NSRect) {
        guard progress > 0.001, let ctx = NSGraphicsContext.current?.cgContext else { return }
        let x = bounds.width / 2
        let h = bounds.height * progress

        // The thread: a 2pt vertical gradient, brighter at the top where the first beat anchors it.
        let lineRect = NSRect(x: x - 1, y: 0, width: 2, height: h)
        ctx.saveGState()
        NSBezierPath(roundedRect: lineRect, xRadius: 1, yRadius: 1).addClip()
        let grad = notchGradient([
            (NotchPalette.accentHi.withAlphaComponent(0.55), 0),
            (NotchPalette.accent.withAlphaComponent(0.22), 1),
        ])
        ctx.drawLinearGradient(grad, start: CGPoint(x: x, y: 0),
                               end: CGPoint(x: x, y: bounds.height), options: [])
        ctx.restoreGState()

        // A soft glowing tip while it's still growing.
        if progress < 0.999 {
            ctx.saveGState()
            ctx.setBlendMode(.plusLighter)
            let tip = CGPoint(x: x, y: h)
            let space = CGColorSpace(name: CGColorSpace.sRGB)!
            let c = (NotchPalette.accentHi.usingColorSpace(.sRGB) ?? NotchPalette.accentHi)
            if let g = CGGradient(colorsSpace: space,
                                  colors: [c.withAlphaComponent(0.8).cgColor,
                                           c.withAlphaComponent(0).cgColor] as CFArray, locations: [0, 1]) {
                ctx.drawRadialGradient(g, startCenter: tip, startRadius: 0, endCenter: tip, endRadius: 9, options: [])
            }
            c.withAlphaComponent(0.95).setFill()
            NSBezierPath(ovalIn: NSRect(x: tip.x - 1.6, y: tip.y - 1.6, width: 3.2, height: 3.2)).fill()
            ctx.restoreGState()
        }
    }

    deinit { link?.invalidate() }
}

/// A soft glass circle holding a tinted SF Symbol — the "how it works" iconography. Layer-backed so
/// it can emit a single expanding "ping" ring as its beat lands.
private final class CircleIconView: NSView {
    private let symbolName: String

    init(symbolName: String) {
        self.symbolName = symbolName
        super.init(frame: .zero)
        wantsLayer = true
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

    /// One quiet ring that expands and fades — a beat landing, not a spinner.
    func ping() {
        guard !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion, let host = layer else { return }
        let ring = CAShapeLayer()
        ring.path = CGPath(ellipseIn: bounds.insetBy(dx: 1, dy: 1), transform: nil)
        ring.fillColor = nil
        ring.strokeColor = NotchPalette.accentHi.withAlphaComponent(0.7).cgColor
        ring.lineWidth = 1.5
        ring.frame = bounds
        ring.anchorPoint = CGPoint(x: 0.5, y: 0.5)
        ring.position = CGPoint(x: bounds.midX, y: bounds.midY)
        host.addSublayer(ring)

        let scale = CABasicAnimation(keyPath: "transform.scale")
        scale.fromValue = 0.85
        scale.toValue = 1.9
        let fade = CABasicAnimation(keyPath: "opacity")
        fade.fromValue = 0.75
        fade.toValue = 0
        let group = CAAnimationGroup()
        group.animations = [scale, fade]
        group.duration = 0.72
        group.timingFunction = CAMediaTimingFunction(name: .easeOut)
        group.isRemovedOnCompletion = true
        ring.opacity = 0
        ring.add(group, forKey: "ping")
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.74) { [weak ring] in ring?.removeFromSuperlayer() }
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

// MARK: - Page 4 · The gift  (claim-to-reveal)

/// The welcome gift is now *earned by a tap*: a sealed brand medallion the player opens to reveal a
/// randomly-granted free balance (100–180, decided server-side at registration — see OfficialAPI /
/// the register route). Opening plays a charge→break→count-up→burst sequence; the odometer lands on
/// the real granted number. "Continue" stays hidden until the claim gesture, so the step can't be
/// skipped past — but Back and Esc always work, and the gate flips on the tap, never on the network.
private final class GiftPage: OnboardingPage {
    private enum Phase { case sealed, revealing, revealed }

    private let heading = onboardingLabel(size: 21, weight: .bold, color: .white)
    private let seal = GiftSealView()
    private let odometer = DigitOdometerView()
    private let burst = RewardBurstView()
    private let caption = onboardingLabel(size: 12.5, weight: .regular, color: NSColor(white: 1, alpha: 0.5))
    private let claimButton = GlowButton(title: "", style: .primary)
    private let note = onboardingLabel(size: 13, weight: .regular, color: NSColor(white: 1, alpha: 0.66))

    private var phase: Phase = .sealed
    private var hasClaimed = false
    private var didEnterOnce = false

    private var reduceMotion: Bool { NSWorkspace.shared.accessibilityDisplayShouldReduceMotion }
    override var allowsAdvance: Bool { hasClaimed }

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        let size = OnboardingViewController.pageSize
        let cx = size.width / 2

        heading.frame = NSRect(x: 40, y: 40, width: size.width - 80, height: 30)
        addSubview(heading)

        // Seal + odometer share the same optical center so the number emerges where the seal broke.
        let sealSide: CGFloat = 132
        let sealCenterY: CGFloat = 142
        seal.frame = NSRect(x: cx - sealSide / 2, y: sealCenterY - sealSide / 2, width: sealSide, height: sealSide)
        seal.onClick = { [weak self] in self?.claim() }
        addSubview(seal)

        odometer.color = .white
        odometer.fontSize = 58
        odometer.frame = NSRect(x: 40, y: sealCenterY - 58, width: size.width - 80, height: 116)
        odometer.isHidden = true
        addSubview(odometer)

        caption.alignment = .center
        caption.frame = NSRect(x: 40, y: 226, width: size.width - 80, height: 20)
        addSubview(caption)

        claimButton.onClick = { [weak self] in self?.claim() }
        addSubview(claimButton) // framed in rebuildStrings once its title width is known

        note.frame = NSRect(x: 66, y: 232, width: size.width - 132, height: 56)
        note.alphaValue = 0
        addSubview(note)

        // The burst sits on top (sparks overlay everything) but never intercepts clicks; sized
        // generously around the seal center so streaks have room before the card clips them.
        burst.frame = NSRect(x: cx - 260, y: sealCenterY - 180, width: 520, height: 360)
        addSubview(burst)

        rebuildStrings()
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func rebuildStrings() {
        heading.stringValue = phase == .sealed
            ? L10n.t("你的见面礼", "はじめましての贈りもの", "A little welcome gift")
            : L10n.t("见面礼已到账", "贈りもの、届きました", "Your gift has arrived")
        odometer.suffix = L10n.t("题", "問", "questions")
        caption.stringValue = L10n.t("轻点礼物，领取你的专属额度 · 数量随机",
                                     "ギフトをタップして受け取る · 数量はランダム",
                                     "Tap the gift to claim your questions · amount is random")
        claimButton.title = L10n.t("领取见面礼", "受け取る", "Claim gift")
        layoutClaimButton()
        if phase == .revealed { note.stringValue = noteText() }
    }

    private func layoutClaimButton() {
        let w = claimButton.intrinsicContentSize.width
        claimButton.frame = NSRect(x: (OnboardingViewController.pageSize.width - w) / 2, y: 252, width: w, height: 40)
        claimButton.needsDisplay = true
    }

    // MARK: Claim → reveal

    /// The real granted balance, or nil if registration hasn't landed yet. A DEBUG hook lets QA
    /// seed a deterministic number so the reveal can be screenshotted offline.
    private func resolvedNumber() -> Int? {
        #if DEBUG
        if let raw = ProcessInfo.processInfo.environment["NSPI_QA_GIFT"], let n = Int(raw) { return n }
        #endif
        if OfficialAPI.deviceToken != nil, let b = OfficialAPI.balanceQuestions { return b }
        return nil
    }

    private func claim() {
        guard phase == .sealed else { return }
        phase = .revealing
        hasClaimed = true
        onStateChange?()          // let the chrome reveal "continue"
        heading.stringValue = L10n.t("见面礼已到账", "贈りもの、届きました", "Your gift has arrived")
        fade(caption, to: 0)
        fade(claimButton, to: 0)

        let known = resolvedNumber()
        guard !reduceMotion else {
            seal.isHidden = true
            reveal(number: known, animated: false)
            return
        }
        seal.onBreakComplete = { [weak self] in self?.reveal(number: known, animated: true) }
        seal.breakOpen()
    }

    /// Hand-off from the broken seal: show the number (rolling it up), or a gentle "arriving" state
    /// while registration finishes. Idempotent guards keep a late async result from double-firing.
    private func reveal(number known: Int?, animated: Bool) {
        if let n = known {
            odometer.isHidden = false
            if animated {
                burst.burst(intensity: burstIntensity(for: n))
                odometer.onFinished = { [weak self] in self?.fadeInNote(success: true) }
                odometer.roll(to: n, duration: 1.4)
            } else {
                odometer.setImmediate(n)
                note.stringValue = noteText(success: true)
                note.alphaValue = 1
            }
            phase = .revealed
        } else {
            // Number not ready (offline / registration in flight). Break already played; show a
            // calm "arriving" line, then resolve when the network answers.
            odometer.isHidden = true
            note.stringValue = arrivingText()
            note.alphaValue = 1
            Task { @MainActor in
                _ = await OfficialAPI.registerIfNeeded()
                guard self.phase == .revealing else { return }
                if let n = self.resolvedNumber() {
                    self.odometer.isHidden = false
                    if animated {
                        self.burst.burst(intensity: self.burstIntensity(for: n))
                        self.odometer.roll(to: n, duration: 1.2)
                    } else {
                        self.odometer.setImmediate(n)
                    }
                    self.note.stringValue = self.noteText(success: true)
                } else {
                    self.note.stringValue = self.noteText(success: false) // "arrives on first use"
                }
                self.phase = .revealed
            }
        }
    }

    private func fadeInNote(success: Bool) {
        note.stringValue = noteText(success: success)
        guard !reduceMotion else { note.alphaValue = 1; return }
        NSAnimationContext.runAnimationGroup { ctx in
            ctx.duration = 0.5
            ctx.timingFunction = CAMediaTimingFunction(name: .easeOut)
            note.animator().alphaValue = 1
        }
    }

    /// Bigger gift, bigger celebration — a small, honest delight (100 ⇒ ~0.7, 180 ⇒ ~1.2).
    private func burstIntensity(for n: Int) -> CGFloat {
        let t = max(0, min(1, CGFloat(n - 100) / 80))
        return 0.72 + t * 0.5
    }

    private func noteText(success: Bool = true) -> String {
        success
            ? L10n.t("免费额度已到账。每答一题消耗 1 题，失败不扣。",
                     "無料枠が届きました。1回の回答につき1問消費。失敗時は消費されません。",
                     "Your free questions have arrived. Each answer costs one; failures are never charged.")
            : L10n.t("免费额度将在首次使用时自动到账（需要联网）。",
                     "無料枠は初回利用時に自動で届きます(ネット接続が必要)。",
                     "Your free questions will arrive automatically on first use (network required).")
    }

    private func arrivingText() -> String {
        L10n.t("正在为你准备额度…", "残高を準備しています…", "Preparing your questions…")
    }

    private func fade(_ view: NSView, to alpha: CGFloat) {
        guard !reduceMotion else { view.alphaValue = alpha; view.isHidden = alpha == 0; return }
        NSAnimationContext.runAnimationGroup({ ctx in
            ctx.duration = 0.22
            view.animator().alphaValue = alpha
        }, completionHandler: { if alpha == 0 { view.isHidden = true } })
    }

    // MARK: Appearance

    override func pageDidAppear() {
        if phase == .revealed {
            // Returning to an already-claimed gift: show the settled state, no re-animation.
            seal.isHidden = true
            caption.isHidden = true
            claimButton.isHidden = true
            odometer.isHidden = false
            note.alphaValue = 1
            return
        }
        // Make sure the account is warming up so the number is ready by the time they tap.
        if OfficialAPI.deviceToken == nil, Settings.shared.serviceMode == ServiceMode.official,
           !onboardingQAOffline {
            Task { await OfficialAPI.registerIfNeeded() }
        }
        #if DEBUG
        // Visual-QA: NSPI_QA_AUTOCLAIM=1 fires the claim automatically (pair with NSPI_QA_GIFT=N)
        // so the reveal sequence can be screenshotted without simulating a pointer click.
        if phase == .sealed, ProcessInfo.processInfo.environment["NSPI_QA_AUTOCLAIM"] == "1" {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { [weak self] in self?.claim() }
        }
        #endif

        guard !didEnterOnce, !reduceMotion else { return }
        didEnterOnce = true
        // A soft one-time entrance for the sealed medallion after the page slides in.
        seal.alphaValue = 0
        caption.alphaValue = 0
        NSAnimationContext.runAnimationGroup { ctx in
            ctx.duration = 0.5
            ctx.timingFunction = CAMediaTimingFunction(name: .easeOut)
            seal.animator().alphaValue = 1
            caption.animator().alphaValue = 1
        }
    }
}

// MARK: - Page 5 · Try it

private final class TryItPage: OnboardingPage {
    private let heading = onboardingLabel(size: 21, weight: .bold, color: .white)
    private let card = DemoQuestionCard(frame: NSRect(x: 0, y: 0, width: 420, height: 84))
    private let keycaps = KeycapChipView(keys: [], capSize: 40)
    private let hint = onboardingLabel(size: 13, weight: .regular, color: NSColor(white: 1, alpha: 0.65))
    private let subHint = onboardingLabel(size: 12, weight: .regular, color: NSColor(white: 1, alpha: 0.45))

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        let size = OnboardingViewController.pageSize

        heading.frame = NSRect(x: 40, y: 40, width: size.width - 80, height: 30)
        addSubview(heading)

        card.frame.origin = NSPoint(x: (size.width - 420) / 2, y: 86)
        addSubview(card)

        keycaps.wantsLayer = true
        addSubview(keycaps)

        hint.frame = NSRect(x: 70, y: 254, width: size.width - 140, height: 40)
        addSubview(hint)

        subHint.frame = NSRect(x: 70, y: 300, width: size.width - 140, height: 50)
        addSubview(subHint)

        rebuildStrings()
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func rebuildStrings() {
        heading.stringValue = L10n.t("现在就试一题", "さっそく1問解いてみよう", "Try one right now")
        card.setTexts(
            badge: L10n.t("示例题目", "サンプル問題", "SAMPLE QUESTION"),
            question: L10n.t("解方程：x² − 5x + 6 = 0",
                             "解きなさい：x² − 5x + 6 = 0",
                             "Solve: x² − 5x + 6 = 0"))
        keycaps.keys = KeycapChipView.caps(from: Settings.shared.captureCombo)
        let w = keycaps.intrinsicContentSize.width
        keycaps.frame = NSRect(x: (OnboardingViewController.pageSize.width - w) / 2, y: 194,
                               width: w, height: keycaps.intrinsicContentSize.height)
        hint.stringValue = L10n.t(
            "就停在这个页面，按下组合键 — 上面这道题的答案会从屏幕顶部的刘海里浮现。",
            "このページのまま、このキーを押すだけ — 上の問題の答えが画面上部のノッチから現れます。",
            "Stay right here and press these keys — the answer to the question above appears from the notch at the top of your screen.")
        subHint.stringValue = L10n.t(
            "之后在任何题目界面都能这样用。快捷键、语言、外观？都在刘海右侧的 ⚙ 设置里。",
            "この先はどんな問題画面でも同じように使えます。ショートカットや言語、外観はノッチ右側の ⚙ 設定から。",
            "From now on this works on any question, anywhere. Hotkeys, language, appearance — all in ⚙ Settings, at the right edge of the notch.")
    }

    // The hotkey capture must SEE the sample question: SCScreenshotManager honors sharingType
    // and drops `.none` windows from the shot (verified empirically), so this page — and only
    // this page — opts the onboarding window back into capture. Both hooks are needed: when
    // this is the START page, pageDidAppear runs during loadView where `window` is still nil,
    // and viewDidMoveToWindow covers that moment.
    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        if superview != nil { window?.sharingType = .readWrite }
    }

    override func pageDidAppear() {
        window?.sharingType = .readWrite
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
        window?.sharingType = ScreenShareGuard.windowSharingType
        keycaps.layer?.removeAnimation(forKey: "pressPulse")
    }
}

/// A glass card printing a real sample question on the page, so the very first hotkey press has
/// something to answer. Pairs with TryItPage.pageDidAppear flipping the window to `.readWrite`:
/// without that, SCK would drop the (normally capture-hidden) onboarding window from the shot
/// and the model would never see this card.
private final class DemoQuestionCard: NSView {
    override var isFlipped: Bool { true }
    private let badge = onboardingLabel(size: 11, weight: .semibold, color: NotchPalette.accentHi)
    private let question = onboardingLabel(size: 22, weight: .semibold, color: .white)

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        badge.frame = NSRect(x: 20, y: 15, width: frameRect.width - 40, height: 15)
        addSubview(badge)
        question.frame = NSRect(x: 20, y: 38, width: frameRect.width - 40, height: 30)
        addSubview(question)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func setTexts(badge: String, question: String) {
        self.badge.stringValue = badge
        self.question.stringValue = question
    }

    override func draw(_ dirtyRect: NSRect) {
        let path = NSBezierPath(roundedRect: bounds.insetBy(dx: 1, dy: 1), xRadius: 14, yRadius: 14)
        NotchPalette.accent.withAlphaComponent(0.10).setFill()
        path.fill()
        path.lineWidth = 1
        NotchPalette.accentHi.withAlphaComponent(0.30).setStroke()
        path.stroke()
    }
}
