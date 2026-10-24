import Foundation
import CoreGraphics
import JavaScriptCore

/// Why an auto session ended — drives the status message the user sees.
enum AutoStopReason: Equatable {
    case userToggled       // auto-mode hotkey pressed again
    case captureHotkey     // capture hotkey pressed during an active session
    case stopButton        // capsule tap on the notch panel
    case questionCap(Int)  // hit the per-session question cap
    case runFailed         // an answer run ended in error (incl. mid-run 401/402, watchdog)
    case quotaExhausted    // balance ≤ 0 or credential rejected after a success
    case idleTimeout       // watched with no trigger for too long
    case hashFailures      // consecutive hash captures failed (screen locked/asleep)
}

/// Downsampled grayscale change detection. Pure byte math — no AppKit, fully unit-tested.
enum ScreenHasher {
    static let gridW = SharedAutoSource.gridW
    static let gridH = SharedAutoSource.gridH
    /// Per-cell luma delta below this is noise (JPEG-ish shimmer, AA, cursor blink residue).
    static let perPixelTolerance = UInt8(SharedAutoSource.perPixelTolerance)
    /// Fraction of grid cells that must move beyond tolerance for the screen to count as changed.
    static let changedFraction = SharedAutoSource.changedFraction

    /// Fraction (0…1) of cells whose |a−b| exceeds the tolerance.
    /// Mismatched or empty inputs count as fully changed (defensive).
    static func difference(_ a: [UInt8], _ b: [UInt8], tolerance: UInt8 = perPixelTolerance) -> Double {
        SharedAutoRules.call("autoDifference", [a, b, tolerance])?.toDouble() ?? 1
    }

    static func changed(_ a: [UInt8], _ b: [UInt8], threshold: Double = changedFraction) -> Bool {
        difference(a, b) >= threshold
    }

    /// CGImage (any size) → gridW×gridH luma bytes via a DeviceGray context draw.
    static func lumaGrid(from image: CGImage) -> [UInt8]? {
        var buffer = [UInt8](repeating: 0, count: gridW * gridH)
        let drawn: Bool = buffer.withUnsafeMutableBytes { raw in
            guard let ctx = CGContext(
                data: raw.baseAddress, width: gridW, height: gridH,
                bitsPerComponent: 8, bytesPerRow: gridW,
                space: CGColorSpaceCreateDeviceGray(),
                bitmapInfo: CGImageAlphaInfo.none.rawValue
            ) else { return false }
            ctx.interpolationQuality = .medium
            ctx.draw(image, in: CGRect(x: 0, y: 0, width: gridW, height: gridH))
            return true
        }
        return drawn ? buffer : nil
    }
}

/// Platform adapter for the shared deterministic engine. No timers or capture live here.
@MainActor
final class AutoSessionEngine {
    struct Config: Equatable {
        var maxQuestions: Int
        var stableTicksRequired = SharedAutoSource.stableTicksRequired
        var maxHashFailures = SharedAutoSource.maxHashFailures
        var idleTimeout: TimeInterval = TimeInterval(SharedAutoSource.idleTimeout)
    }
    enum State: String, Equatable { case inactive, running, baselinePending, watching }
    enum TickOutcome: Equatable { case none, trigger, stop(AutoStopReason) }

    private let now: () -> Date
    private let context: JSContext?
    private let engine: JSValue?
    private var bridgeFailed = false
    private var explicitStopReason: AutoStopReason?
    private(set) var config = Config(maxQuestions: SharedProduct.defaultAutoCap)
    var state: State { bridgeFailed ? .inactive : State(rawValue: engine?.forProperty("state")?.toString() ?? "") ?? .inactive }
    var questionsAsked: Int { Int(engine?.forProperty("count")?.toInt32() ?? 0) }
    var lastStopReason: AutoStopReason? { bridgeFailed ? .runFailed : explicitStopReason ?? reason(engine?.forProperty("lastStopReason")?.toString() ?? "") }
    var isActive: Bool { state != .inactive }
    nonisolated static let unlimitedQuestions = -1
    var progressText: String {
        let limit = config.maxQuestions == Self.unlimitedQuestions ? "∞" : String(config.maxQuestions)
        return "\(questionsAsked)/\(limit)"
    }
    init(now: @escaping () -> Date = Date.init) {
        self.now = now
        context = SharedAutoRules.makeContext()
        engine = context?.objectForKeyedSubscript("createAutoEngine")?.call(withArguments: [])
    }
    nonisolated static func clampMaxQuestions(_ n: Int) -> Int {
        Int(SharedAutoRules.call("autoClamp", [n, SharedProduct.defaultAutoCap, SharedProduct.autoCaps.max()!])?.toInt32()
            ?? Int32(SharedProduct.defaultAutoCap))
    }
    func start(config: Config) {
        self.config = config
        explicitStopReason = nil
        _ = invoke("start", [["maxQuestions": config.maxQuestions,
                               "stableTicksRequired": config.stableTicksRequired,
                               "maxHashFailures": config.maxHashFailures,
                               "idleTimeout": config.idleTimeout]])
    }
    func noteRunSucceeded(balanceQuestions: Int?, credentialRejected: Bool) -> TickOutcome {
        outcome(invoke("succeeded", [balanceQuestions.map { $0 as Any } ?? NSNull(),
                                     credentialRejected, now().timeIntervalSince1970]))
    }
    func noteRunFailed() -> TickOutcome { outcome(invoke("failed", [])) }
    func tickPaused() -> TickOutcome { outcome(invoke("paused", [now().timeIntervalSince1970])) }
    func tick(hash: [UInt8]?) -> TickOutcome {
        outcome(invoke("tick", [hash.map { $0 as Any } ?? NSNull(), now().timeIntervalSince1970]))
    }
    func stop(reason: AutoStopReason) {
        guard isActive else { return }
        explicitStopReason = reason
        let key: String
        switch reason {
        case .userToggled: key = "userToggled"
        case .captureHotkey: key = "captureHotkey"
        case .stopButton: key = "stopButton"
        case .questionCap: key = "questionCap"
        case .runFailed: key = "runFailed"
        case .quotaExhausted: key = "quotaExhausted"
        case .idleTimeout: key = "idleTimeout"
        case .hashFailures: key = "hashFailures"
        }
        _ = invoke("stop", [key])
    }
    private func invoke(_ method: String, _ arguments: [Any]) -> String {
        guard let context, let engine, context.exception == nil,
              let result = engine.invokeMethod(method, withArguments: arguments), context.exception == nil else {
            bridgeFailed = true
            return "runFailed"
        }
        return result.toString() ?? "none"
    }
    private func outcome(_ value: String) -> TickOutcome {
        if value == "trigger" { return .trigger }
        return reason(value).map(TickOutcome.stop) ?? .none
    }
    private func reason(_ value: String) -> AutoStopReason? {
        switch value {
        case "userToggled": return .userToggled
        case "captureHotkey": return .captureHotkey
        case "stopButton": return .stopButton
        case "questionCap": return .questionCap(config.maxQuestions)
        case "runFailed": return .runFailed
        case "quotaExhausted": return .quotaExhausted
        case "idleTimeout": return .idleTimeout
        case "hashFailures": return .hashFailures
        default: return nil
        }
    }
}

private enum SharedAutoRules {
    static func makeContext() -> JSContext? {
        guard let context = JSContext() else { return nil }
        context.evaluateScript(SharedAutoSource.javascript)
        return context.exception == nil ? context : nil
    }
    static func call(_ function: String, _ arguments: [Any]) -> JSValue? {
        guard let context = makeContext() else { return nil }
        let result = context.objectForKeyedSubscript(function)?.call(withArguments: arguments)
        return context.exception == nil ? result : nil
    }
}
