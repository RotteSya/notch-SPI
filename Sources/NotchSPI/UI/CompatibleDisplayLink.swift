import AppKit
import QuartzCore

/// Uses the native display clock where available and a bounded timer on older Macs.
final class CompatibleDisplayLink {
    private var native: AnyObject?
    private var timer: Timer?
    private let target: AnyObject
    private let selector: Selector
    private var runLoop: RunLoop?
    private var mode: RunLoop.Mode = .common

    init(view: NSView, target: AnyObject, selector: Selector, prefersNative: Bool = true) {
        self.target = target
        self.selector = selector
        if #available(macOS 14.0, *), prefersNative {
            native = view.displayLink(target: target, selector: selector)
        }
    }

    var isPaused = false {
        didSet {
            if #available(macOS 14.0, *), let link = native as? CADisplayLink { link.isPaused = isPaused }
            else { restartTimer() }
        }
    }
    var preferredFrameRateRange = CAFrameRateRange(minimum: 30, maximum: 60, preferred: 60) {
        didSet {
            guard oldValue != preferredFrameRateRange else { return }
            if #available(macOS 14.0, *), let link = native as? CADisplayLink { link.preferredFrameRateRange = preferredFrameRateRange }
            else { restartTimer() }
        }
    }
    func add(to runLoop: RunLoop, forMode mode: RunLoop.Mode) {
        self.runLoop = runLoop
        self.mode = mode
        if #available(macOS 14.0, *), let link = native as? CADisplayLink { link.add(to: runLoop, forMode: mode) }
        else { restartTimer() }
    }
    private func restartTimer() {
        timer?.invalidate()
        timer = nil
        guard !isPaused, let runLoop else { return }
        let fps = min(60, max(15, preferredFrameRateRange.preferred ?? 60))
        let timer = Timer(timeInterval: 1 / Double(fps), target: target, selector: selector,
                          userInfo: nil, repeats: true)
        self.timer = timer
        runLoop.add(timer, forMode: mode)
    }
    func invalidate() {
        if #available(macOS 14.0, *), let link = native as? CADisplayLink { link.invalidate() }
        timer?.invalidate()
        timer = nil
        runLoop = nil
    }
    deinit { invalidate() }
}
