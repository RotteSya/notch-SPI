#if DEBUG
import AppKit
import QuartzCore

/// Main-thread work attributed to one display frame. Counted only in DEBUG builds.
@MainActor
enum MotionQACounters {
    enum Kind: Int, CaseIterable { case layout, refresh, answerDraw, surfaceDraw, windowFrame, ghostDraw, lumaRender, trayLayout, flight }
    private(set) static var counts = [Int](repeating: 0, count: Kind.allCases.count)
    private(set) static var seconds = [Double](repeating: 0, count: Kind.allCases.count)
    static var enabled = false

    @inline(__always) static func begin() -> CFTimeInterval { enabled ? CACurrentMediaTime() : 0 }
    @inline(__always) static func end(_ kind: Kind, _ start: CFTimeInterval) {
        guard enabled else { return }
        counts[kind.rawValue] += 1
        seconds[kind.rawValue] += CACurrentMediaTime() - start
    }
    static func drain() -> (counts: [Int], seconds: [Double]) {
        defer {
            counts = [Int](repeating: 0, count: Kind.allCases.count)
            seconds = [Double](repeating: 0, count: Kind.allCases.count)
        }
        return (counts, seconds)
    }
}

/// Offline motion lab. A script drives the production controller (hover, capture intake,
/// streaming, completion, failure, guide) on the real display clock while a probe records one
/// row per display frame. Fixture images and a fixture answer stream replace capture and
/// transport; no account, model or network is involved. The process quits when the script ends.
@MainActor
enum MotionLabQA {
    private static var lab: Lab?

    static func start() -> NotchController {
        let args = CommandLine.arguments
        func value(_ flag: String) -> String? {
            args.firstIndex(of: flag).flatMap { $0 + 1 < args.count ? args[$0 + 1] : nil }
        }
        let script = value("--qa-motion-script") ?? "hover"
        let output = URL(fileURLWithPath: value("--qa-motion-output")
            ?? NSTemporaryDirectory() + "notchspi-motion-lab")
        let film = value("--qa-motion-film").flatMap(Int.init) ?? 0
        let defaults = UserDefaults(suiteName: "com.rottesya.notchspi.design-fixtures")!
        let history = RecentQuestionStore(directory: FileManager.default.temporaryDirectory
            .appendingPathComponent("notchspi-motion-lab-history-\(UUID())"))
        let controller = NotchController(activateServices: false, onboardingDefaults: defaults, recentQuestions: history)
        let lab = Lab(controller: controller, script: script, output: output, filmEvery: film)
        self.lab = lab
        controller.show()
        lab.run()
        return controller
    }

    @MainActor
    private final class Lab: NSObject {
        let controller: NotchController
        let script: String
        let output: URL
        let filmEvery: Int
        private var link: CADisplayLink?
        private var start: CFTimeInterval = 0
        private var lastTimestamp: CFTimeInterval = 0
        private var rows: [String] = []
        private var events: [String] = []
        private var frameIndex = 0
        private var restore: [() -> Void] = []
        private var streamWork: [DispatchWorkItem] = []
        private let filmQueue = DispatchQueue(label: "notchspi.motion-lab.film")
        private var windowImage: (@convention(c) (CGRect, UInt32, UInt32, UInt32) -> Unmanaged<CGImage>?)?

        init(controller: NotchController, script: String, output: URL, filmEvery: Int) {
            self.controller = controller; self.script = script; self.output = output; self.filmEvery = filmEvery
            super.init()
        }

        // MARK: Fixtures

        private func configure() {
            let settings = Settings.shared
            let service = settings.serviceMode, provider = settings.apiProvider, mode = settings.mode
            let copy = Appearance.autoCopyAnswer
            // A third-party channel with an in-memory key keeps the production run path
            // local; the fixture stream below replaces its transport.
            settings.serviceMode = ServiceMode.customKey; settings.apiProvider = "openai"; settings.mode = "tutor"
            settings.setAPIKey("offline-motion-lab", for: settings.activeProvider.storageKey)
            Appearance.autoCopyAnswer = false
            restore.append {
                settings.serviceMode = service; settings.apiProvider = provider; settings.mode = mode
                Appearance.autoCopyAnswer = copy
            }
            controller.qaOnboardingPermission = { true }
            controller.qaOpenPracticePage = { _ in true }
            controller.qaScreenshotWarmUp = {}
            controller.qaPrepareScreenshotFlight()   // as the product does shortly after launch
            controller.qaOnboardingClaimTrial = {
                try? await Task.sleep(for: .milliseconds(650))
                return !Task.isCancelled
            }
            // Rendered before the clock starts: a capture inside a recorded run only copies a file.
            let fixtures: [URL] = (1...4).compactMap { ordinal in
                let size = NSSize(width: 640, height: 400)
                let image = NSImage(size: size)
                image.lockFocus()
                NSColor(calibratedWhite: 0.97, alpha: 1).setFill()
                NSRect(origin: .zero, size: size).fill()
                ("QUESTION / 0\(ordinal)" as NSString).draw(at: NSPoint(x: 44, y: 312), withAttributes: [
                    .font: NSFont.monospacedSystemFont(ofSize: 25, weight: .bold), .foregroundColor: NSColor.darkGray])
                ("A train travels 120 km in 2 hours.\nWhat is its average speed?" as NSString)
                    .draw(in: NSRect(x: 44, y: 80, width: 560, height: 180), withAttributes: [
                        .font: NSFont.systemFont(ofSize: 22), .foregroundColor: NSColor.black])
                image.unlockFocus()
                guard let tiff = image.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
                      let data = rep.representation(using: .jpeg, properties: [.compressionFactor: 0.9]) else { return nil }
                let url = FileManager.default.temporaryDirectory
                    .appendingPathComponent("notchspi-motion-lab-fixture-\(ordinal)-" + UUID().uuidString + ".jpg")
                return (try? data.write(to: url)) != nil ? url : nil
            }
            restore.append { fixtures.forEach { try? FileManager.default.removeItem(at: $0) } }
            var ordinal = 0
            controller.qaScreenshotCapture = {
                guard !fixtures.isEmpty else { return .failure(.captureFailed) }
                let source = fixtures[ordinal % fixtures.count]
                ordinal += 1
                let url = FileManager.default.temporaryDirectory
                    .appendingPathComponent("notchspi-motion-lab-" + UUID().uuidString + ".jpg")
                do {
                    try FileManager.default.copyItem(at: source, to: url)
                    return .success(.init(path: url.path, blank: false, targetFingerprint: "motion-lab",
                                          sourceFrame: NSScreen.main?.frame))
                } catch { return .failure(.captureFailed) }
            }
        }

        private static let shortAnswer = "120 ÷ 2 = 60 km/h\nFINAL: B. 60 km/h"
        private static let longAnswer: String = {
            let block = """
            **思路**　这道题考查二次函数的最小值。先把 `f(x) = x² − 4x + 3` 配方成顶点式，最值一眼可见。

            **配方**　`f(x) = (x − 2)² − 1`，所以抛物线的顶点在 `(2, −1)`。因为二次项系数为正，开口向上，顶点就是图像的最低点。

            **检验**　代入 `x = 1` 与 `x = 3` 均得 `0`，两侧对称且都高于 `−1`，与顶点结论一致。
            """
            return Array(repeating: block, count: 4).joined(separator: "\n\n") + "\nFINAL: **−1**（`x = 2` 时取得）"
        }()
        private static let mathAnswer = #"""
        由求根公式 \(x = \frac{-b \pm \sqrt{b^2-4ac}}{2a}\)，代入 \(a=1\)、\(b=-4\)、\(c=3\)。

        判别式：\[\Delta = b^2 - 4ac = 16 - 12 = 4\]

        所以 \(x_1 = \frac{4+2}{2} = 3\)，\(x_2 = \frac{4-2}{2} = 1\)。

        求和验证：\[\sum_{i=1}^{2} x_i = -\frac{b}{a} = 4\]
        FINAL: \(x_1 = 3,\ x_2 = 1\)
        """#

        private static func payload(_ answer: String) -> String {
            let result = ObjectiveResultV1(v: 1, kind: .singleChoice, state: .ready, answer: answer, reason: .none)
            return "\nNSPI_RESULT_V1: " + String(decoding: (try? JSONEncoder().encode(result)) ?? Data(), as: UTF8.self)
        }

        /// One fixture transport per request. `interval`/`chunk` shape the cadence; `fail`
        /// ends the stream as an interrupted transport after the first third of the text.
        private func stream(_ text: String, firstToken: TimeInterval, interval: TimeInterval,
                            chunk: ClosedRange<Int>, fail: Bool = false) {
            let characters = Array(text)
            let limit = fail ? characters.count / 3 : characters.count
            controller.qaAnswerStream = { [weak self] onDelta, onDone in
                MainActor.assumeIsolated {
                    self?.schedule(after: firstToken) {
                        self?.note("stream.first")
                        self?.pump(characters, from: 0, limit: limit, interval: interval, chunk: chunk,
                                   fail: fail, onDelta: onDelta, onDone: onDone)
                    }
                }
            }
        }

        private func schedule(after delay: TimeInterval, _ action: @escaping @MainActor () -> Void) {
            let work = DispatchWorkItem { MainActor.assumeIsolated { action() } }
            streamWork.append(work)
            DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: work)
        }

        private func pump(_ characters: [Character], from index: Int, limit: Int, interval: TimeInterval,
                          chunk: ClosedRange<Int>, fail: Bool,
                          onDelta: @escaping (String) -> Void, onDone: @escaping (Bool, String) -> Void) {
            guard index < limit else {
                if fail { onDone(false, L10n.t("网络连接中断，未能完成本次查题。", "接続が切れました。", "The connection was interrupted.")) }
                else { onDelta(Self.payload("B")); onDone(true, "") }
                note("stream.done fail=\(fail)")
                return
            }
            let step = min(limit - index, Int.random(in: chunk))
            onDelta(String(characters[index..<index + step]))
            schedule(after: interval) { [weak self] in
                self?.pump(characters, from: index + step, limit: limit, interval: interval, chunk: chunk,
                           fail: fail, onDelta: onDelta, onDone: onDone)
            }
        }

        // MARK: Scripts

        private var compactPoint: NSPoint {
            let frame = controller.qaHoverFrame(expanded: false)
            return NSPoint(x: frame.midX, y: frame.midY)
        }
        private let outside = NSPoint(x: -10_000, y: -10_000)
        private func enter(_ dx: CGFloat = 0) {
            controller.qaTrackPointer(NSPoint(x: compactPoint.x + dx, y: compactPoint.y))
        }
        private func leave() { controller.qaTrackPointer(outside, allowsExpansion: false) }

        private func timeline() -> (steps: [(TimeInterval, String, () -> Void)], duration: TimeInterval) {
            var steps: [(TimeInterval, String, () -> Void)] = []
            func at(_ time: TimeInterval, _ name: String, _ action: @escaping () -> Void) { steps.append((time, name, action)) }
            let c = controller
            switch script {
            case "hover":
                at(0.6, "enter") { self.enter() }
                at(2.0, "leave") { self.leave() }                    // collapses after the 0.45 s grace
                at(3.6, "enter") { self.enter() }
                at(5.0, "collapse.button") { c.collapseByUser() }
                return (steps, 6.2)
            case "cycle":
                for n in 0..<7 {
                    at(0.6 + Double(n) * 0.9, "enter") { self.enter(CGFloat(n)) }
                    at(1.05 + Double(n) * 0.9, "collapse.button") { c.collapseByUser() }
                }
                return (steps, 7.2)
            case "reversal":
                at(0.6, "enter") { self.enter() }
                at(0.70, "collapse.mid-open") { c.collapseByUser() }
                at(0.80, "enter.mid-close") { self.enter(1) }
                at(1.8, "collapse") { c.collapseByUser() }
                at(1.90, "enter.mid-close") { self.enter(2) }
                at(1.98, "collapse.mid-open") { c.collapseByUser() }
                at(2.06, "enter.mid-close") { self.enter(3) }
                at(2.14, "collapse.mid-open") { c.collapseByUser() }
                at(2.22, "enter.mid-close") { self.enter(4) }
                at(3.4, "leave") { self.leave() }
                return (steps, 4.8)
            case "answer-short":
                stream(Self.shortAnswer, firstToken: 0.9, interval: 0.045, chunk: 2...4)
                at(0.6, "capture.single") { c.qaPressScreenshot(multiple: false) }
                at(4.6, "enter") { self.enter() }
                at(5.4, "leave") { self.leave() }
                at(7.0, "enter") { self.enter() }
                at(8.4, "collapse.button") { c.collapseByUser() }
                return (steps, 9.4)
            case "answer-long":
                stream(Self.longAnswer, firstToken: 0.8, interval: 0.03, chunk: 3...7)
                at(0.6, "capture.single") { c.qaPressScreenshot(multiple: false) }
                at(0.7, "enter") { self.enter() }
                at(3.6, "user.scroll-up") { c.qaNotchView.qaUserScroll(to: max(0, c.qaNotchView.qaReadingOffset - 120)) }
                at(5.6, "user.scroll-tail") { c.qaNotchView.qaUserScroll(to: c.qaNotchView.qaReadingMaximum) }
                return (steps, 11.5)
            case "answer-slow":
                stream(Self.longAnswer, firstToken: 1.2, interval: 0.35, chunk: 18...40)
                at(0.6, "capture.single") { c.qaPressScreenshot(multiple: false) }
                at(0.7, "enter") { self.enter() }
                return (steps, 14)
            case "answer-math":
                stream(Self.mathAnswer, firstToken: 0.8, interval: 0.05, chunk: 2...5)
                at(0.6, "capture.single") { c.qaPressScreenshot(multiple: false) }
                at(0.7, "enter") { self.enter() }
                return (steps, 9.5)
            case "error-retry":
                stream(Self.longAnswer, firstToken: 0.8, interval: 0.04, chunk: 3...6, fail: true)
                at(0.6, "capture.single") { c.qaPressScreenshot(multiple: false) }
                at(0.7, "enter") { self.enter() }
                at(6.2, "retry") {
                    self.stream(Self.shortAnswer, firstToken: 0.8, interval: 0.045, chunk: 2...4)
                    c.qaPressScreenshot(multiple: false)
                }
                return (steps, 10.5)
            case "interrupt-stream":
                stream(Self.longAnswer, firstToken: 0.8, interval: 0.03, chunk: 3...7)
                at(0.6, "capture.single") { c.qaPressScreenshot(multiple: false) }
                at(0.7, "enter") { self.enter() }
                at(2.6, "collapse.mid-stream") { c.collapseByUser() }
                at(2.75, "enter.mid-close") { self.enter(1) }
                at(4.2, "collapse.mid-stream") { c.collapseByUser() }
                at(5.4, "enter") { self.enter(2) }
                at(6.4, "capture.replaces-run") {
                    self.stream(Self.shortAnswer, firstToken: 0.7, interval: 0.045, chunk: 2...4)
                    c.qaPressScreenshot(multiple: false)
                }
                return (steps, 10.5)
            case "multi":
                stream(Self.shortAnswer, firstToken: 0.9, interval: 0.045, chunk: 2...4)
                at(0.6, "capture.multi.1") { c.qaPressScreenshot(multiple: true) }
                at(0.7, "enter") { self.enter() }
                at(1.5, "capture.multi.2") { c.qaPressScreenshot(multiple: true) }
                at(2.4, "capture.multi.3") { c.qaPressScreenshot(multiple: true) }
                at(3.4, "remove.2") { if c.model.screenshots.count > 1 { c.qaRemoveScreenshot(c.model.screenshots[1].id) } }
                at(4.2, "undo") { c.qaUndoScreenshot() }
                at(5.0, "submit.now") { c.qaSubmitScreenshotRound() }
                return (steps, 10)
            case "guide":
                at(0.6, "guide.welcome") { c.qaPresentOnboarding(.welcome) }
                at(2.2, "guide.advance") { c.qaAdvanceOnboarding() }
                at(3.4, "guide.advance") { c.qaAdvanceOnboarding() }
                at(3.55, "guide.back") { c.qaBackOnboarding() }
                at(3.7, "guide.advance") { c.qaAdvanceOnboarding() }
                at(5.2, "guide.capture") {
                    self.stream(Self.shortAnswer, firstToken: 0.9, interval: 0.045, chunk: 2...4)
                    c.qaPressScreenshot(multiple: false)
                }
                at(9.0, "guide.dismiss") { c.qaDismissOnboarding() }
                return (steps, 10.5)
            default:
                at(0.6, "enter") { self.enter() }
                return (steps, 2)
            }
        }

        // MARK: Run

        func run() {
            configure()
            try? FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
            if filmEvery > 0, let symbol = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "CGWindowListCreateImage") {
                windowImage = unsafeBitCast(symbol, to: (@convention(c) (CGRect, UInt32, UInt32, UInt32) -> Unmanaged<CGImage>?).self)
            }
            MotionQACounters.enabled = true
            let plan = timeline()
            // Let launch-time layout and the first display link settle before the clock starts.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { [self] in
                start = CACurrentMediaTime()
                _ = MotionQACounters.drain()
                let link = controller.qaNotchView.displayLink(target: self, selector: #selector(tick(_:)))
                link.add(to: .main, forMode: .common)
                self.link = link
                for (time, name, action) in plan.steps {
                    DispatchQueue.main.asyncAfter(deadline: .now() + time) { [weak self] in
                        self?.note(name); action()
                    }
                }
                DispatchQueue.main.asyncAfter(deadline: .now() + plan.duration) { [weak self] in self?.finish() }
            }
        }

        private func note(_ name: String) {
            events.append(String(format: "%.4f,%@", CACurrentMediaTime() - start, name))
        }

        @objc private func tick(_ link: CADisplayLink) {
            let now = CACurrentMediaTime()
            let view = controller.qaNotchView
            let sample = view.qaMotionSample
            let frame = controller.qaPanel.frame
            let work = MotionQACounters.drain()
            let interval = lastTimestamp == 0 ? 0 : link.timestamp - lastTimestamp
            lastTimestamp = link.timestamp
            let model = controller.model
            var fields: [String] = [
                String(format: "%.4f", now - start), String(format: "%.2f", interval * 1000),
                String(format: "%.2f", frame.minX), String(format: "%.2f", frame.minY),
                String(format: "%.2f", frame.width), String(format: "%.2f", frame.height),
                String(format: "%.4f", sample.geometry), String(format: "%.4f", sample.opacity),
                String(format: "%.4f", sample.contentAlpha),
                String(format: "%.2f", sample.ghost.minX), String(format: "%.2f", sample.ghost.minY),
                String(format: "%.2f", sample.scrollY), String(format: "%.2f", sample.documentHeight),
                String(format: "%.2f", sample.viewportHeight), String(format: "%.2f", sample.targetHeight),
                sample.morphing ? "1" : "0", sample.springing ? "1" : "0", sample.detached ? "1" : "0",
                model.expanded ? "1" : "0", "\(model.status)", "\(model.answer.count)",
            ]
            for kind in MotionQACounters.Kind.allCases {
                fields.append("\(work.counts[kind.rawValue])")
                fields.append(String(format: "%.3f", work.seconds[kind.rawValue] * 1000))
            }
            rows.append(fields.joined(separator: ","))
            frameIndex += 1
            if filmEvery > 0, frameIndex % filmEvery == 0 { capture(index: frameIndex, time: now - start) }
        }

        /// The panel's own composited pixels (light field and layer masks included). Falls back
        /// to an in-process view render when the window server call is unavailable.
        private func capture(index: Int, time: CFTimeInterval) {
            let panel = controller.qaPanel
            let name = String(format: "frame-%05d-%07.3f.png", index, time)
            let url = output.appendingPathComponent("film").appendingPathComponent(name)
            var image: CGImage?
            // includingWindow (1 << 3) + bestResolution (1 << 3 on the image option set).
            if let windowImage, panel.windowNumber > 0 {
                image = windowImage(.null, 1 << 3, UInt32(panel.windowNumber), 1 << 3)?.takeRetainedValue()
            }
            if image == nil, let view = panel.contentView, let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds) {
                view.cacheDisplay(in: view.bounds, to: rep)
                image = rep.cgImage
            }
            guard let image else { return }
            filmQueue.async {
                try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
                let rep = NSBitmapImageRep(cgImage: image)
                try? rep.representation(using: .png, properties: [:])?.write(to: url)
            }
        }

        private func finish() {
            link?.invalidate(); link = nil
            streamWork.forEach { $0.cancel() }
            var header = ["t", "interval_ms", "x", "y", "w", "h", "geometry", "opacity", "content_alpha",
                          "ghost_x", "ghost_y", "scroll_y", "document_h", "viewport_h", "target_h",
                          "morphing", "springing", "detached", "expanded", "status", "answer_chars"]
            for kind in MotionQACounters.Kind.allCases { header += ["\(kind)_n", "\(kind)_ms"] }
            let csv = ([header.joined(separator: ",")] + rows).joined(separator: "\n") + "\n"
            try? csv.write(to: output.appendingPathComponent("frames.csv"), atomically: true, encoding: .utf8)
            try? (["t,event"] + events).joined(separator: "\n").appending("\n")
                .write(to: output.appendingPathComponent("events.csv"), atomically: true, encoding: .utf8)
            let screen = controller.qaPanel.screen
            let meta = """
            script=\(script)
            reduce_motion=\(onboardingReduceMotion())
            frames=\(rows.count)
            film=\(windowImage != nil ? "window" : filmEvery > 0 ? "view" : "off")
            screen=\(screen?.frame ?? .zero) scale=\(screen?.backingScaleFactor ?? 0) safe_top=\(screen?.safeAreaInsets.top ?? 0) max_fps=\(screen?.maximumFramesPerSecond ?? 0)
            collapsed=\(controller.qaHoverFrame(expanded: false))
            collapse_delay=\(Appearance.collapseDelay)
            """
            try? (meta + "\n").write(to: output.appendingPathComponent("meta.txt"), atomically: true, encoding: .utf8)
            restore.forEach { $0() }
            filmQueue.sync {}
            // Termination awaits main-actor cleanup in a nested run loop; leave this main-queue
            // block first so that continuation can run.
            Timer.scheduledTimer(withTimeInterval: 0.05, repeats: false) { _ in
                MainActor.assumeIsolated { NSApp.terminate(nil) }
            }
        }
    }
}
#endif
