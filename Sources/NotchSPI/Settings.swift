import Foundation
import Carbon.HIToolbox

struct HotkeyCombo: Equatable {
    var keyCode: UInt32
    var modifiers: UInt32 // Carbon modifier mask (cmdKey, shiftKey, …)
    var label: String     // display label for the key, e.g. "1", "Space"
}

final class Settings {
    static let shared = Settings()
    private let d = UserDefaults.standard

    var cli: String {
        get { d.string(forKey: "cli") ?? "codex" }
        set { d.set(newValue, forKey: "cli") }
    }

    var depth: String {
        get { d.string(forKey: "depth") ?? "guided" }
        set { d.set(newValue, forKey: "depth") }
    }

    // MARK: - Capture target

    /// Bundle ID of the app whose window gets captured; nil = full screen.
    var captureTargetBundleID: String? {
        get {
            let v = d.string(forKey: "captureTargetBundleID")
            return (v?.isEmpty ?? true) ? nil : v
        }
        set { d.set(newValue ?? "", forKey: "captureTargetBundleID") }
    }

    /// Display name remembered for the picker UI (shown even when the app isn't running).
    var captureTargetName: String? {
        get { d.string(forKey: "captureTargetName") }
        set { d.set(newValue ?? "", forKey: "captureTargetName") }
    }

    var captureTarget: CaptureTarget {
        if let id = captureTargetBundleID { return .app(bundleID: id) }
        return .fullScreen
    }

    // MARK: - Hotkeys

    private static let defaultCapture = HotkeyCombo(keyCode: UInt32(kVK_ANSI_1), modifiers: UInt32(cmdKey | shiftKey), label: "1")
    private static let defaultToggle = HotkeyCombo(keyCode: UInt32(kVK_Space), modifiers: UInt32(cmdKey | shiftKey), label: "Space")

    var captureCombo: HotkeyCombo {
        get { combo("capture", Settings.defaultCapture) }
        set { setCombo("capture", newValue) }
    }
    var toggleCombo: HotkeyCombo {
        get { combo("toggle", Settings.defaultToggle) }
        set { setCombo("toggle", newValue) }
    }

    private func combo(_ prefix: String, _ def: HotkeyCombo) -> HotkeyCombo {
        guard d.object(forKey: "\(prefix)KeyCode") != nil else { return def }
        return HotkeyCombo(
            keyCode: UInt32(d.integer(forKey: "\(prefix)KeyCode")),
            modifiers: UInt32(d.integer(forKey: "\(prefix)Mods")),
            label: d.string(forKey: "\(prefix)Label") ?? def.label
        )
    }
    private func setCombo(_ prefix: String, _ c: HotkeyCombo) {
        d.set(Int(c.keyCode), forKey: "\(prefix)KeyCode")
        d.set(Int(c.modifiers), forKey: "\(prefix)Mods")
        d.set(c.label, forKey: "\(prefix)Label")
    }

    static func displayString(_ c: HotkeyCombo) -> String {
        var s = ""
        if c.modifiers & UInt32(controlKey) != 0 { s += "⌃" }
        if c.modifiers & UInt32(optionKey) != 0 { s += "⌥" }
        if c.modifiers & UInt32(shiftKey) != 0 { s += "⇧" }
        if c.modifiers & UInt32(cmdKey) != 0 { s += "⌘" }
        return s + c.label
    }

    // MARK: - Labels

    static func label(forCLI cli: String) -> String {
        cli == "claude" ? "Claude" : "Codex"
    }

    static func label(forDepth depth: String) -> String {
        switch depth {
        case "brief": return "简略"
        case "hint": return "提示"
        case "full": return "完整"
        default: return "引导"
        }
    }

    static let depthCycle = ["brief", "hint", "guided", "full"]
}
