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

    private var reduceMotion: Bool { NSWorkspace.shared.accessibilityDisplayShouldReduceMotion }

    /// MSL for a full-screen quad + the aurora field. Kept minimal: two uniforms (time,
    /// resolution), three exp-falloff ribbons, a soft vignette, and a hash grain that keeps the
    /// slow gradients from banding on wide-gamut panels.
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

    fragment float4 aurora_fragment(VOut in [[stage_in]],
                                    constant float &time [[buffer(0)]],
                                    constant float2 &res [[buffer(1)]]) {
        float2 uv = in.uv;
        float aspect = res.x / max(res.y, 1.0);
        float2 p = float2(uv.x * aspect, uv.y);
        float t = time * 0.05;

        float3 col = float3(0.027, 0.035, 0.075); // deep navy base

        for (int i = 0; i < 3; i++) {
            float fi = float(i);
            float speed = 0.6 + fi * 0.25;
            float yc = 0.30 + fi * 0.20;                       // ribbon center line
            float wave = sin(p.x * (2.2 + fi * 1.3) + t * speed * 6.2831 + fi * 2.1)
                       * sin(p.x * (1.1 + fi * 0.7) - t * speed * 3.7 + fi * 5.0);
            float y = uv.y - yc + wave * 0.16;
            float band = exp(-pow(y * (4.2 + fi * 1.4), 2.0));
            float3 ribbon = (i == 0) ? float3(0.30, 0.42, 0.95)   // periwinkle
                          : (i == 1) ? float3(0.52, 0.34, 0.92)   // violet
                                     : float3(0.22, 0.66, 0.80);  // teal whisper
            col += ribbon * band * (0.17 - fi * 0.035);
        }

        // vignette centered slightly above middle, where the content sits
        float d = distance(uv, float2(0.5, 0.42));
        col *= 1.0 - d * 0.55;

        // hash grain to break banding
        float g = fract(sin(dot(uv * res, float2(12.9898, 78.233))) * 43758.5453);
        col += (g - 0.5) * 0.012;

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
