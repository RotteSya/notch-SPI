import AppKit
import BotAvatarsKit
import JavaScriptCore

/// Local pure presentation code. No network, DOM, credentials or file access.
/// A lock serializes test callers; AppKit calls it on the main thread.
enum SharedVisual {
    private static let lock = NSRecursiveLock()
    private static let context: JSContext = {
        let value = JSContext()!
        value.evaluateScript(SharedVisualSource.javascript)
        precondition(value.exception == nil, "Invalid generated shared UI")
        return value
    }()
    static func call(_ name: String, _ arguments: [Any]) -> JSValue {
        lock.lock(); defer { lock.unlock() }
        let value = context.evaluateScript(name)!.call(withArguments: arguments)!
        precondition(context.exception == nil, "Invalid shared UI call")
        return value
    }
    static func number(_ expression: String) -> Double {
        lock.lock(); defer { lock.unlock() }; return context.evaluateScript(expression)!.toDouble()
    }
    static func rect(_ value: CGRect) -> [String: Double] {
        ["x": value.minX, "y": -value.maxY, "width": value.width, "height": value.height]
    }
    static func nativeRect(_ value: JSValue) -> CGRect {
        let d = value.toDictionary() as! [String: Double]
        return CGRect(x: d["x"]!, y: -d["y"]! - d["height"]!, width: d["width"]!, height: d["height"]!)
    }
    static func pose(_ value: JSValue) -> BotAvatarPose {
        let d = value.toDictionary()!, n: (String) -> Double = { (d[$0] as! NSNumber).doubleValue }
        var p = BotAvatarPose()
        p.yaw=n("yaw"); p.pitch=n("pitch"); p.roll=n("roll"); p.x=n("x"); p.y=n("y"); p.sx=n("sx"); p.sy=n("sy")
        p.eyeOpen=n("eyeOpen"); p.blinkL=n("blinkL"); p.blinkR=n("blinkR"); p.lookX=n("lookX"); p.lookY=n("lookY")
        p.breath=n("breath"); p.laugh=n("laugh"); p.whirl=n("whirl"); p.whirlAngle=n("whirlAngle")
        let w = d["w"] as! [Double]; p.w = SIMD3(w[0], w[1], w[2]); return p
    }
    static func dictionary(_ p: BotAvatarPose) -> [String: Any] {
        ["yaw":p.yaw,"pitch":p.pitch,"roll":p.roll,"x":p.x,"y":p.y,"sx":p.sx,"sy":p.sy,
         "eyeOpen":p.eyeOpen,"blinkL":p.blinkL,"blinkR":p.blinkR,"lookX":p.lookX,"lookY":p.lookY,
         "breath":p.breath,"laugh":p.laugh,"whirl":p.whirl,"whirlAngle":p.whirlAngle,"w":[p.w[0],p.w[1],p.w[2]]]
    }
    static func notchPose(_ base: BotAvatarPose, reduced: Bool, busy: Bool, hero: Bool, time: Double, blend: Double, completion: Double?) -> BotAvatarPose {
        pose(call("notchPose", [dictionary(base), ["reduced":reduced,"busy":busy,"hero":hero,"time":time,"blend":blend,"completion":completion as Any? ?? NSNull()]]))
    }
    struct ReadingRow {
        let kind: String, text: String, size: CGFloat, weight: NSFont.Weight, color: NSColor
    }
    static func reading(answer: String, detail: String, review: Bool, explaining: Bool = false, failed: Bool = false, emptyNote: Bool = true) -> [ReadingRow] {
        let input: [String: Any] = ["answer": answer, "detail": detail, "needsReview": review, "explaining": explaining,
            "explanationFailed": failed, "emptyNote": emptyNote, "language": L10n.t("zh", "ja", "en")]
        return (call("readingSections", [input]).toArray() as! [[String: Any]]).map { row in
            ReadingRow(kind: row["kind"] as! String, text: row["text"] as! String, size: row["size"] as! Double,
                weight: row["weight"] as? String == "semibold" ? .semibold : .regular,
                color: row["tone"] as? String == "warning" ? .systemOrange : row["tone"] as? String == "secondary" ? .secondaryLabelColor : .labelColor)
        }
    }
}

/// Each indicator owns a simulation; the JS source is shared with Windows.
final class SharedGhostSimulation {
    private let context = JSContext()!
    private let simulation: JSValue
    init(seed: Double) {
        context.evaluateScript(SharedVisualSource.javascript)
        simulation = context.evaluateScript("new Sim(\(seed))")!
        precondition(context.exception == nil)
    }
    func setState(_ state: BotAvatarState) { simulation.invokeMethod("setState", withArguments: [state.rawValue]) }
    func update(_ dt: Double) { simulation.invokeMethod("update", withArguments: [dt]) }
    var pose: BotAvatarPose { SharedVisual.pose(simulation.forProperty("pose")!) }
}
