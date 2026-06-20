import SwiftUI

/// Native port of the "Rose Two" math-curve loader (r = a·cos(2θ)): a rotating,
/// breathing rose traced by a fading trail of particles. Drawn with Canvas.
struct RoseLoader: View {
    var color: Color
    var size: CGFloat

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

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30.0)) { timeline in
            Canvas { ctx, sz in
                draw(ctx, sz, timeline.date.timeIntervalSinceReferenceDate * 1000)
            }
        }
        .frame(width: size, height: size)
    }

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

    private func draw(_ ctx: GraphicsContext, _ sz: CGSize, _ timeMs: Double) {
        let scale = min(sz.width, sz.height) / 100
        let pulseAngle = (timeMs.truncatingRemainder(dividingBy: pulseDurationMs)) / pulseDurationMs * 2 * .pi
        let detail = 0.52 + ((sin(pulseAngle + 0.55) + 1) / 2) * 0.48
        let rotation = -((timeMs.truncatingRemainder(dividingBy: rotationDurationMs)) / rotationDurationMs) * 360
        let progress = (timeMs.truncatingRemainder(dividingBy: durationMs)) / durationMs

        var c = ctx
        c.translateBy(x: sz.width / 2, y: sz.height / 2)
        c.rotate(by: .degrees(rotation))
        c.scaleBy(x: scale, y: scale)
        c.translateBy(x: -50, y: -50)

        // faint full curve
        var path = Path()
        for i in 0...pathSteps {
            let p = point(Double(i) / Double(pathSteps), detail)
            if i == 0 { path.move(to: p) } else { path.addLine(to: p) }
        }
        c.stroke(path, with: .color(color.opacity(0.12)),
                 style: StrokeStyle(lineWidth: strokeWidth, lineCap: .round, lineJoin: .round))

        // trailing particles
        for i in 0..<particleCount {
            let tail = Double(i) / Double(particleCount - 1)
            let p = point(normalize(progress - tail * trailSpan), detail)
            let fade = pow(1 - tail, 0.56)
            let radius = 0.9 + fade * 2.7
            let opacity = 0.04 + fade * 0.96
            let rect = CGRect(x: p.x - radius, y: p.y - radius, width: radius * 2, height: radius * 2)
            c.fill(Path(ellipseIn: rect), with: .color(color.opacity(opacity)))
        }
    }
}
