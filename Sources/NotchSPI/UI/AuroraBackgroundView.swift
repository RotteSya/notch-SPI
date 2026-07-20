import AppKit
import Metal
import QuartzCore

/// A live "aurora silk" background — three slow ribbons of brand-tinted light drifting through
/// a deep-navy field, rendered by a tiny Metal fragment shader on a `CAMetalLayer`.
///
/// The shader is compiled from source at runtime (`makeLibrary(source:)`), so there is no
/// build-system metallib plumbing and `swift run` behaves exactly like the bundled app. When
/// Metal is unavailable (VM, old GPU) or shader compilation fails, the view quietly falls back
/// to a static NSGradient of the same palette — the onboarding never breaks over a backdrop.
/// Honors Reduce Motion by rendering a single fixed frame instead of animating.
final class AuroraBackgroundView: NSView {

    // MARK: Metal state

    private var device: MTLDevice?
    private var queue: MTLCommandQueue?
    private var pipeline: MTLRenderPipelineState?
    private var metalLayer: CAMetalLayer?
    private var link: CADisplayLink?
    private let startTime = CACurrentMediaTime()
    private var metalOK = false

    private var reduceMotion: Bool { onboardingReduceMotion() }

    /// MSL for a full-screen quad + the aurora field. Two uniforms (time, resolution). The field
    /// is built from domain-warped value noise — three silk ribbons with luminous cores draped
    /// through a deep-navy gradient — so the light has cloth-like structure instead of reading as
    /// a flat blurred gradient. A gentle corner-only vignette and a hash grain (anti-banding)
    /// finish it. uv.y = 0 is the bottom of the window.
    private static let shaderSource = """
    #include <metal_stdlib>
    using namespace metal;

    struct VOut { float4 pos [[position]]; float2 uv; };

    vertex VOut aurora_vertex(uint vid [[vertex_id]]) {
        float2 p[4] = { float2(-1,-1), float2(1,-1), float2(-1,1), float2(1,1) };
        VOut o;
        o.pos = float4(p[vid], 0, 1);
        o.uv = p[vid] * 0.5 + 0.5;
        return o;
    }

    static float ahash(float2 p) {
        return fract(sin(dot(p, float2(127.1, 311.7))) * 43758.5453123);
    }
    static float anoise(float2 p) {
        float2 i = floor(p), f = fract(p);
        float2 u = f * f * (3.0 - 2.0 * f);
        float a = ahash(i), b = ahash(i + float2(1, 0));
        float c = ahash(i + float2(0, 1)), d = ahash(i + float2(1, 1));
        return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
    }
    static float afbm(float2 p) {
        float v = 0.0, amp = 0.55;
        for (int i = 0; i < 3; i++) {
            v += anoise(p) * amp;
            p = p * 2.03 + float2(17.3, 9.1);
            amp *= 0.5;
        }
        return v;
    }

    fragment float4 aurora_fragment(VOut in [[stage_in]],
                                    constant float &time [[buffer(0)]],
                                    constant float2 &res [[buffer(1)]]) {
        float2 uv = in.uv;
        float aspect = res.x / max(res.y, 1.0);
        float2 p = float2(uv.x * aspect, uv.y);
        float t = time * 0.045;

        // Deep-navy base, a breath lighter at the zenith so the field never reads flat.
        float3 col = mix(float3(0.013, 0.015, 0.036),
                         float3(0.034, 0.040, 0.082), smoothstep(0.0, 1.0, uv.y));

        // Domain warp: the ribbons ride these curved coordinates, which is what makes them
        // drape like silk instead of oscillating like sine waves. Amplitude stays low — at
        // higher values the noise reads as blotches instead of folds.
        float2 q = float2(afbm(p * 1.10 + float2(0.0, t * 0.35)),
                          afbm(p * 1.10 - float2(t * 0.28, 0.0)));
        float2 w = p + (q - 0.5) * 0.26;

        // Three ribbons: periwinkle high, violet mid, teal low — desaturated, held just above
        // the threshold of notice. Atmosphere, not a light show; the content is the show.
        for (int i = 0; i < 3; i++) {
            float fi = float(i);
            float yc     = (i == 0) ? 0.78 : (i == 1) ? 0.50 : 0.22;
            float freq   = 1.35 + fi * 0.55;
            float speed  = 0.55 + fi * 0.22;
            float y      = w.y - yc + sin(w.x * freq + fi * 2.4 + t * speed * 6.2831) * 0.045;
            float k      = 5.2 + fi * 1.1;
            float band   = exp(-pow(y * k, 2.0));
            float core   = exp(-pow(y * k * 3.0, 2.0));
            float3 tint  = (i == 0) ? float3(0.30, 0.40, 0.82)
                         : (i == 1) ? float3(0.42, 0.32, 0.74)
                                    : float3(0.20, 0.50, 0.60);
            float gain   = (i == 0) ? 0.050 : (i == 1) ? 0.062 : 0.075;
            col += tint * (band * gain + core * gain * 0.6);
        }

        // Corner-only vignette: gentle, never muddying the center.
        float vd = distance(uv, float2(0.5, 0.52));
        col *= 1.0 - 0.24 * smoothstep(0.45, 0.98, vd);

        // hash grain to break banding
        float g = fract(sin(dot(uv * res, float2(12.9898, 78.233))) * 43758.5453);
        col += (g - 0.5) * 0.010;

        return float4(col, 1.0);
    }
    """

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true
        setUpMetal()
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func hitTest(_ point: NSPoint) -> NSView? { nil } // decorative; never intercept clicks

    private func setUpMetal() {
        guard let device = MTLCreateSystemDefaultDevice(),
              let queue = device.makeCommandQueue(),
              let library = try? device.makeLibrary(source: Self.shaderSource, options: nil),
              let vfn = library.makeFunction(name: "aurora_vertex"),
              let ffn = library.makeFunction(name: "aurora_fragment")
        else { return } // fall back to the static gradient in draw(_:)

        let desc = MTLRenderPipelineDescriptor()
        desc.vertexFunction = vfn
        desc.fragmentFunction = ffn
        desc.colorAttachments[0].pixelFormat = .bgra8Unorm
        guard let pipeline = try? device.makeRenderPipelineState(descriptor: desc) else { return }

        let mLayer = CAMetalLayer()
        mLayer.device = device
        mLayer.pixelFormat = .bgra8Unorm
        mLayer.framebufferOnly = true
        mLayer.frame = bounds
        mLayer.autoresizingMask = [.layerWidthSizable, .layerHeightSizable]
        layer?.addSublayer(mLayer)

        self.device = device
        self.queue = queue
        self.pipeline = pipeline
        self.metalLayer = mLayer
        metalOK = true
    }

    // MARK: Fallback (no Metal)

    override func draw(_ dirtyRect: NSRect) {
        guard !metalOK else { return }
        // Static approximation of the same palette.
        let gradient = NSGradient(colorsAndLocations:
            (NSColor(srgbRed: 0.10, green: 0.13, blue: 0.28, alpha: 1), 0.0),
            (NSColor(srgbRed: 0.05, green: 0.06, blue: 0.13, alpha: 1), 0.55),
            (NSColor(srgbRed: 0.02, green: 0.02, blue: 0.05, alpha: 1), 1.0))
        gradient?.draw(in: bounds, angle: -90)
    }

    // MARK: Display clock

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        if window != nil { start() } else { stop() }
    }

    override func layout() {
        super.layout()
        guard let mLayer = metalLayer else { return }
        let scale = window?.backingScaleFactor ?? 2
        mLayer.frame = bounds
        mLayer.contentsScale = scale
        let w = max(1, bounds.width * scale)
        let h = max(1, bounds.height * scale)
        mLayer.drawableSize = CGSize(width: w, height: h)
        if reduceMotion { renderFrame() } // keep the static pose crisp after resizes
    }

    private func start() {
        guard metalOK else { return }
        guard !reduceMotion else {
            renderFrame() // one static, pleasing pose
            return
        }
        guard link == nil else { return }
        let l = displayLink(target: self, selector: #selector(tick))
        // Decorative backdrop drifting minutes-slow: 30fps is indistinguishable and halves the cost.
        l.preferredFrameRateRange = CAFrameRateRange(minimum: 20, maximum: 30, preferred: 30)
        l.add(to: .main, forMode: .common)
        link = l
    }

    private func stop() {
        link?.invalidate()
        link = nil
    }

    @objc private func tick() { renderFrame() }

    private func renderFrame() {
        guard let mLayer = metalLayer, let queue, let pipeline,
              mLayer.drawableSize.width > 1,
              let drawable = mLayer.nextDrawable(),
              let buffer = queue.makeCommandBuffer()
        else { return }

        let pass = MTLRenderPassDescriptor()
        pass.colorAttachments[0].texture = drawable.texture
        pass.colorAttachments[0].loadAction = .clear
        pass.colorAttachments[0].storeAction = .store
        pass.colorAttachments[0].clearColor = MTLClearColor(red: 0.02, green: 0.02, blue: 0.05, alpha: 1)

        guard let encoder = buffer.makeRenderCommandEncoder(descriptor: pass) else { return }
        var time = Float(reduceMotion ? 40.0 : CACurrentMediaTime() - startTime)
        var res = SIMD2<Float>(Float(mLayer.drawableSize.width), Float(mLayer.drawableSize.height))
        encoder.setRenderPipelineState(pipeline)
        encoder.setFragmentBytes(&time, length: MemoryLayout<Float>.size, index: 0)
        encoder.setFragmentBytes(&res, length: MemoryLayout<SIMD2<Float>>.size, index: 1)
        encoder.drawPrimitives(type: .triangleStrip, vertexStart: 0, vertexCount: 4)
        encoder.endEncoding()
        buffer.present(drawable)
        buffer.commit()
    }

    deinit { link?.invalidate() }
}
