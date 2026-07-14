import AppKit
import QuartzCore

/// The "Rose Two" math-curve loader (r = a·cos(2θ)): a rotating, breathing rose traced by a
/// fading trail of particles — NotchSPI's signature indicator. Pure AppKit: drawn with Core
/// Graphics on a `CADisplayLink` clock (the AppKit port of the original SwiftUI `Canvas`).
final class RoseLoaderView: NSView {
    var color: NSColor = .white { didSet { needsDisplay = true } }

    /// Whether the pipeline is actively working. At rest the rose still breathes/rotates, but
    /// those motions are minutes-slow (28s/rev, 4.3s pulse) — 24fps is imperceptible from 60 and
    /// this indicator is ALWAYS on screen beside the notch, so the idle cost matters. Working
    /// (running/streaming) takes the full clock.
    var busy: Bool = false { didSet { if busy != oldValue { retuneClock() } } }

    // config (from the original)
    private let particleCount = 48
    private let trailSpan = 0.3
    private let durationMs = 5200.0
    private let rotationDurationMs = 28000.0
    private let pulseDurationMs = 4300.0
    private let strokeWidth = 3.0
    private let roseA = 9.2
    private let roseABoost = 0.6
    private let roseBreathBase = 0.72
    private let roseBreathBoost = 0.28
    private let roseScale = 3.25
    private let pathSteps = 160

    private var link: CADisplayLink?
    private var reduceMotion: Bool { NSWorkspace.shared.accessibilityDisplayShouldReduceMotion }

    override init(frame frameRect: NSRect) { super.init(frame: frameRect) }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override var isFlipped: Bool { false }
    override func hitTest(_ point: NSPoint) -> NSView? { nil } // decorative; never intercept clicks

    // MARK: Display clock — runs only while on screen (and motion is allowed)

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        if window != nil { startLink() } else { stopLink() }
    }

    private func startLink() {
        guard link == nil, !reduceMotion else { needsDisplay = true; return }
        let l = displayLink(target: self, selector: #selector(tick))
        l.add(to: .main, forMode: .common)
        link = l
        retuneClock()
    }

    private func retuneClock() {
        guard let link, !reduceMotion else { return }
        let fps: Float = busy ? 60 : 24
        link.preferredFrameRateRange = CAFrameRateRange(minimum: max(15, fps - 12), maximum: fps, preferred: fps)
    }

    private func stopLink() { link?.invalidate(); link = nil }
    @objc private func tick() { needsDisplay = true }
    deinit { link?.invalidate() }

    // MARK: Geometry

    private func point(_ progress: Double, _ detail: Double) -> CGPoint {
        let t = progress * 2 * .pi
        let a = roseA + detail * roseABoost
        let r = a * (roseBreathBase + detail * roseBreathBoost) * cos(2 * t)
        return CGPoint(x: 50 + cos(t) * r * roseScale, y: 50 + sin(t) * r * roseScale)
    }

    private func normalize(_ p: Double) -> Double {
        let m = p.truncatingRemainder(dividingBy: 1)
        return (m + 1).truncatingRemainder(dividingBy: 1)
    }

    // MARK: Draw

    override func draw(_ dirtyRect: NSRect) {
        guard let ctx = NSGraphicsContext.current?.cgContext else { return }
        let sz = bounds.size
        guard sz.width > 1, sz.height > 1 else { return }
        // Reduce Motion: render one static, pleasing pose instead of animating.
        let timeMs = reduceMotion ? 1500.0 : CACurrentMediaTime() * 1000

        let scale = min(sz.width, sz.height) / 100
        let pulseAngle = (timeMs.truncatingRemainder(dividingBy: pulseDurationMs)) / pulseDurationMs * 2 * .pi
        let detail = 0.52 + ((sin(pulseAngle + 0.55) + 1) / 2) * 0.48
        let rotation = -((timeMs.truncatingRemainder(dividingBy: rotationDurationMs)) / rotationDurationMs) * 360
        let progress = (timeMs.truncatingRemainder(dividingBy: durationMs)) / durationMs

        ctx.saveGState()
        ctx.translateBy(x: sz.width / 2, y: sz.height / 2)
        ctx.rotate(by: rotation * .pi / 180)
        ctx.scaleBy(x: scale, y: scale)
        ctx.translateBy(x: -50, y: -50)

        // faint full curve
        let path = CGMutablePath()
        for i in 0...pathSteps {
            let p = point(Double(i) / Double(pathSteps), detail)
            if i == 0 { path.move(to: p) } else { path.addLine(to: p) }
        }
        ctx.addPath(path)
        ctx.setStrokeColor(color.withAlphaComponent(0.12).cgColor)
        ctx.setLineWidth(strokeWidth)
        ctx.setLineCap(.round)
        ctx.setLineJoin(.round)
        ctx.strokePath()

        // trailing particles
        for i in 0..<particleCount {
            let tail = Double(i) / Double(particleCount - 1)
            let p = point(normalize(progress - tail * trailSpan), detail)
            let fade = pow(1 - tail, 0.56)
            let radius = 0.9 + fade * 2.7
            let opacity = 0.04 + fade * 0.96
            let rect = CGRect(x: p.x - radius, y: p.y - radius, width: radius * 2, height: radius * 2)
            ctx.setFillColor(color.withAlphaComponent(CGFloat(opacity)).cgColor)
            ctx.fillEllipse(in: rect)
        }
        ctx.restoreGState()
    }
}
