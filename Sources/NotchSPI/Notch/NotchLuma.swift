import AppKit
import QuartzCore
import Metal

// The notch's interior LIGHT FIELD — a real GPU light simulation living inside the obsidian,
// not a painted gradient. Concept: the slab is machined black glass; the screen's light pools
// along its lower face and *responds to the tutor*: it breathes faintly while idle, sweeps with
// a band of focus while the model is thinking (`running`), and ripples with each arriving token
// while `streaming`. The top third stays pure black so the slab keeps fusing with the hardware
// cutout. Everything is deliberately dim — the field never competes with the answer text; it
// makes the black feel *alive* instead of printed. Its tint follows the user's accent theme.
//
// Pure Metal (shader compiled at runtime, no build-system dependency). The render loop only runs
// when there is something to show (see `needsMotion`) and parks itself once every glide settles,
// so a collapsed idle notch costs zero. Reduce Motion freezes on a deterministic still frame.
final class NotchLumaView: NSView {
    private let metalLayer = CAMetalLayer()
    private let maskLayer = CAShapeLayer()
    private var queue: MTLCommandQueue?
    private var pipeline: MTLRenderPipelineState?
    private var link: CADisplayLink?
    private var proxy: LumaProxy?
    private let t0 = CACurrentMediaTime()

    // Card geometry (view coords), mirrored from NotchView.applyLayout.
    private var cardRect: CGRect = .zero

    // State targets vs shown values (lerped per frame on the render clock so state changes glide).
    private var energyTarget: Float = 0.11
    private var energyShown: Float = 0.11
    private var tintTarget = SIMD3<Float>(0.55, 0.62, 0.85)
    private var tintShown = SIMD3<Float>(0.55, 0.62, 0.85)
    private var scanTarget: Float = 0
    private var scanShown: Float = 0
    private var depthShown: Float = 0        // morph progress (set directly by applyLayout)
    private var flow: Float = 0              // token-arrival pulse, decays
    private var lastStatus: TutorModel.Status = .ready

    private var reduceMotion: Bool { NSWorkspace.shared.accessibilityDisplayShouldReduceMotion }

    private struct Uniforms {
        var time: Float
        var res: SIMD2<Float>
        var cardMin: SIMD2<Float>
        var cardMax: SIMD2<Float>
        var tint: SIMD3<Float>
        var energy: Float
        var scan: Float
        var depth: Float
        var flow: Float
    }

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true
        guard let dev = MTLCreateSystemDefaultDevice(),
              let q = dev.makeCommandQueue(),
              let lib = try? dev.makeLibrary(source: Self.shader, options: nil),
              let vfn = lib.makeFunction(name: "luma_vertex"),
              let ffn = lib.makeFunction(name: "luma_fragment") else {
            isHidden = true   // Metal unavailable (rare) → gracefully fall back to plain obsidian
            return
        }
        let desc = MTLRenderPipelineDescriptor()
        desc.vertexFunction = vfn
        desc.fragmentFunction = ffn
        desc.colorAttachments[0].pixelFormat = .bgra8Unorm
        guard let state = try? dev.makeRenderPipelineState(descriptor: desc) else { isHidden = true; return }
        queue = q
        pipeline = state

        metalLayer.device = dev
        metalLayer.pixelFormat = .bgra8Unorm
        metalLayer.framebufferOnly = true
        metalLayer.isOpaque = false
        metalLayer.backgroundColor = .clear
        layer?.addSublayer(metalLayer)
        layer?.mask = maskLayer
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override var isFlipped: Bool { true }
    override func hitTest(_ point: NSPoint) -> NSView? { nil }

    // MARK: Geometry (from NotchView.applyLayout — same values the surface draws with)

    func setSlab(cardRect: CGRect, topRadius: CGFloat, bottomRadius: CGFloat, depth: CGFloat) {
        self.cardRect = cardRect
        depthShown = Float(depth)
        let path = NotchShape.cgPath(in: cardRect, topRadius: topRadius, bottomRadius: bottomRadius)
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        maskLayer.path = path
        metalLayer.frame = bounds
        let scale = window?.backingScaleFactor ?? 2
        metalLayer.contentsScale = scale
        let w = max(1, bounds.width * scale), h = max(1, bounds.height * scale)
        if metalLayer.drawableSize != CGSize(width: w, height: h) {
            metalLayer.drawableSize = CGSize(width: w, height: h)
        }
        CATransaction.commit()
        updateRunning()
    }

    // MARK: State (from NotchView.refresh)

    func setState(_ status: TutorModel.Status) {
        lastStatus = status
        switch status {
        case .idle, .ready:
            energyTarget = 0.11
            tintTarget = SIMD3(0.55, 0.62, 0.85)          // cool graphite breath — reads "off"
            scanTarget = 0
        case .running:
            energyTarget = 0.58
            tintTarget = accentRGB()                       // thinking, in the user's accent
            scanTarget = 1                                 // the focus sweep
        case .streaming:
            energyTarget = 0.44
            tintTarget = accentRGB()
            scanTarget = 0                                 // token ripples carry the motion
        case .error:
            energyTarget = 0.30
            tintTarget = SIMD3(1.00, 0.55, 0.22)          // warm amber, never alarm-red
            scanTarget = 0
        }
        updateRunning()
    }

    /// A token just arrived (streaming delta) — one soft pulse through the pool.
    func pulse() {
        flow = min(1.2, flow + 0.55)
        updateRunning()
    }

    private func accentRGB() -> SIMD3<Float> {
        let c = NotchPalette.accent.usingColorSpace(.sRGB) ?? NotchPalette.accent
        // Lift toward the hi-accent a touch so the dim field keeps chroma at low energy.
        return SIMD3(Float(c.redComponent) * 0.7 + 0.25,
                     Float(c.greenComponent) * 0.7 + 0.28,
                     Float(c.blueComponent) * 0.7 + 0.30)
    }

    // MARK: Run/pause — the field costs zero when there is nothing to show

    private var needsMotion: Bool {
        guard window != nil, !isHidden else { return false }
        if reduceMotion { return false }
        let stateWorth = depthShown > 0.02 || lastStatus == .running || lastStatus == .streaming
        let settling = abs(energyShown - energyTarget) > 0.004 || flow > 0.01
            || abs(scanShown - scanTarget) > 0.01
        return stateWorth || settling
    }

    private func updateRunning() {
        guard pipeline != nil else { return }
        if reduceMotion {
            energyShown = energyTarget; tintShown = tintTarget; scanShown = scanTarget
            renderFrame(now: t0 + 1)   // fixed instant → deterministic still
            link?.isPaused = true
            return
        }
        if needsMotion {
            if link == nil {
                let p = LumaProxy(self)
                proxy = p
                link = displayLink(target: p, selector: #selector(LumaProxy.tick))
                link?.add(to: .main, forMode: .common)
            }
            link?.isPaused = false
        }
    }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        if window == nil { link?.isPaused = true } else { updateRunning() }
    }

    fileprivate func step() {
        let now = CACurrentMediaTime()
        energyShown += (energyTarget - energyShown) * 0.07
        scanShown += (scanTarget - scanShown) * 0.09
        tintShown += (tintTarget - tintShown) * 0.07
        flow *= 0.90
        renderFrame(now: now)
        // Collapsed: only a faint breathing pool moves → 30fps is plenty. Expanded: full clock.
        link?.preferredFrameRateRange = depthShown < 0.05
            ? CAFrameRateRange(minimum: 20, maximum: 30, preferred: 30)
            : CAFrameRateRange(minimum: 48, maximum: 60, preferred: 60)
        if !needsMotion { link?.isPaused = true }
    }

    private func renderFrame(now: CFTimeInterval) {
        guard let pipeline, let queue, cardRect.width > 1,
              let drawable = metalLayer.nextDrawable(),
              let cmd = queue.makeCommandBuffer() else { return }
        let pass = MTLRenderPassDescriptor()
        pass.colorAttachments[0].texture = drawable.texture
        pass.colorAttachments[0].loadAction = .clear
        pass.colorAttachments[0].storeAction = .store
        pass.colorAttachments[0].clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 0)
        guard let enc = cmd.makeRenderCommandEncoder(descriptor: pass) else { return }
        let scale = Float(metalLayer.contentsScale)
        var u = Uniforms(
            time: Float(now - t0),
            res: SIMD2(Float(metalLayer.drawableSize.width), Float(metalLayer.drawableSize.height)),
            cardMin: SIMD2(Float(cardRect.minX) * scale, Float(cardRect.minY) * scale),
            cardMax: SIMD2(Float(cardRect.maxX) * scale, Float(cardRect.maxY) * scale),
            tint: tintShown, energy: energyShown, scan: scanShown, depth: depthShown, flow: flow)
        enc.setRenderPipelineState(pipeline)
        enc.setFragmentBytes(&u, length: MemoryLayout<Uniforms>.stride, index: 0)
        enc.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
        enc.endEncoding()
        cmd.present(drawable)
        cmd.commit()
    }

    deinit { link?.invalidate() }

    // MARK: Shader

    private static let shader = """
    #include <metal_stdlib>
    using namespace metal;

    struct VSOut { float4 pos [[position]]; };

    vertex VSOut luma_vertex(uint vid [[vertex_id]]) {
        float2 p = float2((vid << 1) & 2, vid & 2);
        VSOut o;
        o.pos = float4(p * 2.0 - 1.0, 0.0, 1.0);
        return o;
    }

    struct Uniforms {
        float  time;
        float2 res;
        float2 cardMin;
        float2 cardMax;
        float3 tint;
        float  energy;
        float  scan;
        float  depth;
        float  flow;
    };

    float lhash(float2 p) {
        p = fract(p * float2(123.34, 345.45));
        p += dot(p, p + 34.345);
        return fract(p.x * p.y);
    }

    float lnoise(float2 p) {
        float2 i = floor(p);
        float2 f = fract(p);
        float2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(lhash(i), lhash(i + float2(1, 0)), u.x),
                   mix(lhash(i + float2(0, 1)), lhash(i + float2(1, 1)), u.x), u.y);
    }

    fragment float4 luma_fragment(VSOut in [[stage_in]], constant Uniforms& U [[buffer(0)]]) {
        // p = 0…1 inside the card (top-left origin, matching the flipped view).
        float2 span = max(U.cardMax - U.cardMin, float2(1.0));
        float2 p = (in.pos.xy - U.cardMin) / span;
        if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) { return float4(0); }

        float T = U.time;
        float aspect = span.x / span.y;
        float2 w = float2(p.x * aspect, p.y);

        // ① Screen-light pool along the lower face — the machined glass catching the display's
        //    glow. Breathes slowly on its own; brighter with energy (the model at work).
        float pool = exp(-(1.0 - p.y) * 3.4);
        pool *= 0.62 + 0.20 * sin(T * 0.55 + p.x * 2.3) + 0.18 * sin(T * 0.23 + 1.7);
        pool *= smoothstep(0.0, 0.10, p.x) * (1.0 - smoothstep(0.90, 1.0, p.x));

        // ② Caustic drift — one slow warped current through the body, biased to the lower half.
        float2 q = float2(lnoise(w * 1.3 + float2(0.0, T * 0.045)),
                          lnoise(w * 1.3 + float2(3.7, -T * 0.038)));
        float ca = lnoise(w * 1.8 + q * 1.6 + float2(T * 0.02, 0.0));
        ca = smoothstep(0.52, 0.95, ca) * smoothstep(0.18, 0.70, p.y);

        // ③ Thinking sweep — a soft band of focus crossing the slab, like attention moving.
        float sx = fract(T * 0.30);
        float band = exp(-pow((p.x - mix(-0.25, 1.25, sx)) * 7.5, 2.0));
        float sweep = band * U.scan * smoothstep(0.15, 0.6, p.y);

        // ④ Token pulse — streaming deltas ripple through the pool from the left.
        float fx = fract(T * 0.9);
        float ripple = exp(-pow((p.x - fx) * 4.0, 2.0)) * U.flow * exp(-(1.0 - p.y) * 2.5);

        float3 col = U.tint * (pool * 0.34 + ca * 0.13 + sweep * 0.22 + ripple * 0.18) * U.energy;

        // Seam guard: top third stays essentially black so the slab keeps fusing with the
        // hardware cutout; collapsed (depth→0) dims the whole field to a whisper.
        col *= smoothstep(0.04, 0.38, p.y);
        col *= mix(0.30, 1.0, U.depth);

        // Triangular-PDF dither so the dim gradients never band.
        float dn = lhash(in.pos.xy) + lhash(in.pos.xy + 13.1) - 1.0;
        col = clamp(col + dn / 255.0, 0.0, 0.85);

        // Premultiplied over the black slab (source-over ≈ additive); col ≤ a keeps it legal.
        float a = clamp(max(col.r, max(col.g, col.b)), 0.0, 0.85);
        return float4(col, a);
    }
    """
}

private final class LumaProxy {
    weak var owner: NotchLumaView?
    init(_ o: NotchLumaView) { owner = o }
    @objc func tick() { owner?.step() }
}
