import AppKit
import QuartzCore
import SwiftUI
import BotAvatarsKit

/// Libraries.dev's MIT Ghost rig and renderer inside the original decorative indicator slot.
/// AppKit owns the clock, geometry and hit testing; the Canvas has no gestures or layout influence.
final class GhostIndicatorView: NSView {
    static let notchSize: CGFloat = 20
    static let bodyScale: CGFloat = 0.94
    // Ghost's resting outline begins at x=17 in the 100-unit body box.
    static let restingLeadingInset = notchSize * ((1 - bodyScale) / 2 + bodyScale * 0.17)
    var color: NSColor = .white { didSet { if color != oldValue { needsDisplay = true } } }
    var hero = false { didSet { if hero != oldValue { needsDisplay = true; updateClock() } } }
    var busy = false { didSet {
        guard busy != oldValue else { return }
        if busy { completionTime = nil }
        simulation.setState(busy ? .working : .default)
        updateClock()
        needsDisplay = true
    } }
    private let simulation = SharedGhostSimulation(seed: 0.37)
    private let renderState = BotAvatarRenderState()
    private var lastTick: CFTimeInterval = 0
    private var thinkingTime = 0.0
    private var thinkingBlend = 0.0
    private var completionTime: Double?
    private var completionTint: NSColor?
    private let completionDuration = SharedVisual.number("ghostStyle.completionDuration")

    func acknowledgeCompletion(from tint: NSColor? = nil) {
        guard !busy, !reduceMotion else { return }
        completionTint = tint
        completionTime = 0
        updateClock()
        needsDisplay = true
    }

    func cancelCompletion() {
        guard completionTime != nil else { return }
        completionTime = nil
        updateClock()
        needsDisplay = true
    }

    private var completionWeight: Double {
        SharedVisual.call("completionWeight", [completionTime as Any? ?? NSNull(), reduceMotion]).toDouble()
    }

    private final class ClockTarget: NSObject {
        weak var view: GhostIndicatorView?
        init(_ view: GhostIndicatorView) { self.view = view }
        @objc func tick() { view?.advance() }
    }
    private var clockTarget: ClockTarget?
    private var link: CADisplayLink?
    #if DEBUG
    var qaClockActive: Bool { link != nil }
    func qaAdvance(_ seconds: Double) { advanceMotion(seconds); needsDisplay = true }
    var qaThinkingBlend: Double { thinkingBlend }
    var qaCompletionActive: Bool { completionTime != nil }
    var qaCompletionTime: Double? { completionTime }
    var qaThinkingPose: BotAvatarPose { displayPose }
    #endif
    private var reduceMotion: Bool { NSWorkspace.shared.accessibilityDisplayShouldReduceMotion }

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        NSWorkspace.shared.notificationCenter.addObserver(self, selector: #selector(motionPreferenceChanged),
            name: NSWorkspace.accessibilityDisplayOptionsDidChangeNotification, object: nil)
    }
    @objc private func motionPreferenceChanged() { if reduceMotion { completionTime = nil }; updateClock() }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override var isFlipped: Bool { false }
    override func hitTest(_ point: NSPoint) -> NSView? { nil } // decorative; never intercept clicks

    // MARK: Display clock — runs only while on screen (and motion is allowed)

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        if window == nil { completionTime = nil }
        updateClock()
    }

    private func updateClock() {
        guard window != nil, !reduceMotion else {
            stopLink()
            needsDisplay = true
            return
        }
        if link != nil { retuneClock(); return }
        let target = ClockTarget(self)
        clockTarget = target
        let l = displayLink(target: target, selector: #selector(ClockTarget.tick))
        l.add(to: .main, forMode: .common)
        link = l
        retuneClock()
    }

    private func retuneClock() {
        guard let link, !reduceMotion else { return }
        let fps: Float = busy || completionTime != nil ? 60 : 24
        link.preferredFrameRateRange = CAFrameRateRange(minimum: max(15, fps - 12), maximum: fps, preferred: fps)
    }

    private func stopLink() { link?.invalidate(); link = nil; clockTarget = nil; lastTick = 0 }
    deinit { link?.invalidate(); NSWorkspace.shared.notificationCenter.removeObserver(self) }

    private func advance() {
        if reduceMotion { updateClock(); return }
        let now = CACurrentMediaTime()
        advanceMotion(lastTick == 0 ? 0 : min(0.05, now - lastTick))
        lastTick = now
        needsDisplay = true
    }

    private func advanceMotion(_ dt: Double) {
        if let time = completionTime {
            completionTime = time + dt < completionDuration ? time + dt : nil
            if completionTime == nil { retuneClock() }
        }
        simulation.update(dt)
        thinkingTime += dt
        let target = busy ? 1.0 : 0.0
        thinkingBlend += (target - thinkingBlend) * (1 - exp(-dt / 0.14))
    }

    /// Keep the tiny header's visual centre stable. Ghost's outline is asymmetric:
    /// its design bounds are y=17...87.5, so compensate the extra 2.25 body units.
    /// The rig's full hops/spins are softened in the notch to protect neighbouring ink.
    private var displayPose: BotAvatarPose {
        SharedVisual.notchPose(reduceMotion ? BotAvatarPose.rest(busy ? .working : .default) : simulation.pose,
            reduced: reduceMotion, busy: busy, hero: hero, time: thinkingTime, blend: thinkingBlend, completion: completionTime)
    }

    override func draw(_ dirtyRect: NSRect) {
        guard let context = NSGraphicsContext.current?.cgContext else { return }
        let side = Double(min(bounds.width, bounds.height))
        guard side > 1 else { return }
        var bodyColor = color
        if let time = completionTime, let previous = completionTint {
            let progress = min(1, time / 0.4)
            let eased = progress * progress * (3 - 2 * progress)
            bodyColor = previous.blended(withFraction: eased, of: color) ?? color
        }
        let tint = (hero ? NotchPalette.accentHi : bodyColor).usingColorSpace(.sRGB) ?? .white
        var config = BotAvatarDrawConfig(type: .ghost, face: .eyes,
            color: BotColor(r: tint.redComponent * 255, g: tint.greenComponent * 255, b: tint.blueComponent * 255))
        config.shading = .smooth
        config.shadow = 0.22
        config.highlight = 0.65
        config.depth = 0.45
        config.theme = .dark
        config.still = reduceMotion
        config.scale = Double(window?.backingScaleFactor ?? 2)
        let pose = displayPose
        let cache = renderState
        // Original rose's visible ink occupied ~2/3 of its frame. Ghost's native
        // 66×70.5 outline at 0.94 scale preserves that optical size in all four slots.
        let box = side * Double(Self.bodyScale)
        let thinking = reduceMotion ? (busy ? 1.0 : 0.0) : thinkingBlend
        let phase = reduceMotion ? 0 : thinkingTime * 2 * .pi / 1.05
        let completed = completionWeight
        let still = reduceMotion
        let canvas = Canvas { ctx, _ in
            ctx.translateBy(x: (side - box * BOT_AVATAR_OVERSCAN) / 2,
                            y: (side - box * BOT_AVATAR_OVERSCAN) / 2 - BOT_AVATAR_RISE * box)
            drawBotAvatarFrame(&ctx, box: box, pose: pose, cfg: config, state: cache)
            // Three ink dots sit inside the lower body, so the indicator never needs
            // more room or competes with the adjacent status text.
            ctx.transform = .identity
            ctx.translateBy(x: side / 2, y: side / 2 + pose.y * box / 100)
            ctx.rotate(by: .radians(pose.roll))
            for index in 0..<3 {
                let pulse = still ? 1 : (sin(phase - Double(index) * 0.9) + 1) / 2
                let radius = side * (0.028 + 0.008 * pulse)
                let dot = CGRect(x: Double(index - 1) * side * 0.105 - radius,
                                 y: side * 0.17 - radius, width: radius * 2, height: radius * 2)
                ctx.fill(Path(ellipseIn: dot), with: .color(Color(red: config.ink.r / 255,
                    green: config.ink.g / 255, blue: config.ink.b / 255)
                    .opacity(thinking * (1 - completed) * (0.3 + 0.65 * pulse))))
            }
            var check = Path()
            check.move(to: CGPoint(x: -side * 0.075, y: side * 0.20))
            check.addLine(to: CGPoint(x: -side * 0.015, y: side * 0.245))
            check.addLine(to: CGPoint(x: side * 0.085, y: side * 0.155))
            ctx.stroke(check, with: .color(Color(red: config.ink.r / 255,
                green: config.ink.g / 255, blue: config.ink.b / 255).opacity(completed * 0.9)),
                style: StrokeStyle(lineWidth: side * 0.04, lineCap: .round, lineJoin: .round))
        }.frame(width: side, height: side)
        let renderer = ImageRenderer(content: canvas)
        renderer.scale = config.scale
        context.saveGState()
        context.translateBy(x: (Double(bounds.width) - side) / 2, y: (Double(bounds.height) - side) / 2)
        renderer.render { _, render in render(context) }
        context.restoreGState()
    }
}
