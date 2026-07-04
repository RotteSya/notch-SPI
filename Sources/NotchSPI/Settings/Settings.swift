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

    // MARK: - Mode (tutor ↔ personality test)

    /// "tutor" (default) or "personality".
    var mode: String {
        get { d.string(forKey: "mode") ?? "tutor" }
        set { d.set(newValue, forKey: "mode") }
    }

    /// User-chosen display name for the current target persona (人物像).
    var personaName: String {
        get { d.string(forKey: "personaName") ?? "" }
        set { d.set(newValue, forKey: "personaName") }
    }

    /// The desired persona / 人物像 description that personality-test answers should match.
    var personaText: String {
        get { d.string(forKey: "personaText") ?? "" }
        set { d.set(newValue, forKey: "personaText") }
    }

    // MARK: - Service mode (官方按量计费 / 自定义 Key / 本机 CLI)

    /// The user's chosen channel. Until explicitly set, the default is computed per install:
    /// fresh installs → official service (开箱即用); installs that predate the official service
    /// keep their old behavior (custom key if one is saved, otherwise CLI).
    var serviceMode: String {
        get {
            if let v = d.string(forKey: "serviceMode"), ServiceMode.all.contains(v) { return v }
            return ServiceRouting.defaultMode(
                isExistingInstall: isExistingInstall,
                hasCustomKey: usesCustomKey(for: cli)
            )
        }
        set { d.set(newValue, forKey: "serviceMode") }
    }

    /// Any pre-official-service footprint in defaults means this install predates the feature.
    /// Only meaningful BEFORE launch-time subsystems run: PersonaStore's migration writes
    /// persona keys during controller init, which would make a fresh install look existing.
    /// That's why `bootstrapFirstRunState()` must be the first thing the app does.
    var isExistingInstall: Bool {
        ["cli", "depth", "captureKeyCode", "apiKey.claude", "apiKey.codex", "personaName"]
            .contains { d.object(forKey: $0) != nil }
    }

    /// One-time first-run bootstrap — call as the FIRST line of app launch, before any other
    /// subsystem touches UserDefaults. Pins `serviceMode` (fresh install → official; existing
    /// install → its previous behavior) and marks onboarding done for existing installs so an
    /// update never interrupts or reroutes a working setup. Idempotent: a no-op once
    /// `serviceMode` has been persisted.
    func bootstrapFirstRunState() {
        guard d.string(forKey: "serviceMode") == nil else { return }
        let existing = isExistingInstall
        serviceMode = ServiceRouting.defaultMode(
            isExistingInstall: existing,
            hasCustomKey: usesCustomKey(for: cli)
        )
        if existing { onboardingDone = true }
    }

    /// Whether the first-launch onboarding has been shown (existing installs skip it silently).
    var onboardingDone: Bool {
        get { d.bool(forKey: "onboardingDone") }
        set { d.set(newValue, forKey: "onboardingDone") }
    }

    static func label(forServiceMode mode: String) -> String {
        switch mode {
        case ServiceMode.customKey: return "自定义 API Key"
        case ServiceMode.cli: return "本机 CLI"
        default: return "官方服务（按量计费）"
        }
    }

    // MARK: - Custom API keys (direct-API mode)

    /// Default model per backend when the user hasn't overridden it in the API Key settings.
    static let defaultAPIModels = ["claude": "claude-opus-4-8", "codex": "gpt-5"]

    /// User-supplied API key for a backend ("claude" → Anthropic, "codex" → OpenAI).
    /// Non-empty ⇒ captures go straight to the vendor API; empty ⇒ fall back to the local CLI.
    func apiKey(for cli: String) -> String {
        (d.string(forKey: "apiKey.\(cli)") ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    func setAPIKey(_ key: String, for cli: String) {
        d.set(key.trimmingCharacters(in: .whitespacesAndNewlines), forKey: "apiKey.\(cli)")
    }

    func usesCustomKey(for cli: String) -> Bool { !apiKey(for: cli).isEmpty }

    /// Model ID used in direct-API mode; falls back to the per-backend default when unset.
    func apiModel(for cli: String) -> String {
        let v = (d.string(forKey: "apiModel.\(cli)") ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return v.isEmpty ? (Settings.defaultAPIModels[cli] ?? "") : v
    }

    func setAPIModel(_ model: String, for cli: String) {
        d.set(model.trimmingCharacters(in: .whitespacesAndNewlines), forKey: "apiModel.\(cli)")
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
    private static let defaultPersonality = HotkeyCombo(keyCode: UInt32(kVK_ANSI_2), modifiers: UInt32(cmdKey | shiftKey), label: "2")
    private static let defaultToggle = HotkeyCombo(keyCode: UInt32(kVK_Space), modifiers: UInt32(cmdKey | shiftKey), label: "Space")

    /// Capture-and-tutor (学习辅导). Bound to its own hotkey so the mode is chosen by which key
    /// you press — no manual mode switching.
    var captureCombo: HotkeyCombo {
        get { combo("capture", Settings.defaultCapture) }
        set { setCombo("capture", newValue) }
    }
    /// Capture-and-personality-test (性格测试作答). The mode for this capture, by hotkey.
    var personalityCombo: HotkeyCombo {
        get { combo("personality", Settings.defaultPersonality) }
        set { setCombo("personality", newValue) }
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

    /// Header label reflecting the active channel for a backend: "Claude · API" when a custom
    /// key routes captures straight to the vendor API, plain "Claude" in CLI mode.
    static func label(forCLI cli: String, usingCustomKey: Bool) -> String {
        usingCustomKey ? label(forCLI: cli) + " · API" : label(forCLI: cli)
    }

    static func label(forDepth depth: String) -> String {
        switch depth {
        case "brief": return "简略"
        case "hint": return "提示"
        case "full": return "完整"
        default: return "引导"
        }
    }

    static func label(forMode mode: String) -> String {
        mode == "personality" ? "性格测试" : "学习辅导"
    }

    static let depthCycle = ["brief", "hint", "guided", "full"]
}
