import AppKit

/// One curated accent (强调色) — a pair of base + highlight tints that flow through the whole
/// instrument: the Rose while working, the notch's edge light, buttons, rings, pills.
struct AccentTheme: Equatable {
    let id: String
    let accent: NSColor
    let accentHi: NSColor

    var localizedName: String {
        switch id {
        case "sakura": return L10n.t("樱", "桜", "Sakura")
        case "matcha": return L10n.t("抹茶", "抹茶", "Matcha")
        case "amber": return L10n.t("琥珀", "琥珀", "Amber")
        case "moon": return L10n.t("月白", "月白", "Moonlight")
        default: return L10n.t("长春花", "ペリウィンクル", "Periwinkle")
        }
    }

    static let periwinkle = AccentTheme(
        id: "periwinkle",
        accent: NSColor(srgbRed: 0.48, green: 0.63, blue: 1.00, alpha: 1),
        accentHi: NSColor(srgbRed: 0.64, green: 0.745, blue: 1.00, alpha: 1))
    static let sakura = AccentTheme(
        id: "sakura",
        accent: NSColor(srgbRed: 0.93, green: 0.52, blue: 0.68, alpha: 1),
        accentHi: NSColor(srgbRed: 0.99, green: 0.70, blue: 0.80, alpha: 1))
    static let matcha = AccentTheme(
        id: "matcha",
        accent: NSColor(srgbRed: 0.44, green: 0.78, blue: 0.55, alpha: 1),
        accentHi: NSColor(srgbRed: 0.60, green: 0.89, blue: 0.68, alpha: 1))
    static let amber = AccentTheme(
        id: "amber",
        accent: NSColor(srgbRed: 0.95, green: 0.70, blue: 0.30, alpha: 1),
        accentHi: NSColor(srgbRed: 1.00, green: 0.82, blue: 0.50, alpha: 1))
    static let moon = AccentTheme(
        id: "moon",
        accent: NSColor(srgbRed: 0.72, green: 0.78, blue: 0.90, alpha: 1),
        accentHi: NSColor(srgbRed: 0.87, green: 0.91, blue: 1.00, alpha: 1))

    static let all: [AccentTheme] = [.periwinkle, .sakura, .matcha, .amber, .moon]

    static func byID(_ id: String) -> AccentTheme {
        all.first { $0.id == id } ?? .periwinkle
    }
}

/// Appearance & behavior preferences (外观自定义). Backed by UserDefaults like everything else;
/// `themeDidChange` tells live surfaces (the notch, open windows) to re-render.
enum Appearance {
    static let themeDidChange = Notification.Name("Appearance.themeDidChange")

    private static var d: UserDefaults { .standard }

    /// The active accent theme. Cached — NotchPalette.accent is read on every draw of every
    /// control, so this must never hit UserDefaults in a draw loop.
    private static var cachedTheme: AccentTheme?

    static var theme: AccentTheme {
        if let t = cachedTheme { return t }
        let t = AccentTheme.byID(d.string(forKey: "accentTheme") ?? "")
        cachedTheme = t
        return t
    }

    static func setTheme(_ id: String) {
        d.set(id, forKey: "accentTheme")
        cachedTheme = nil
        NotificationCenter.default.post(name: themeDidChange, object: nil)
    }

    // MARK: Answer text size

    /// The answer body's point size, now a continuous value (finer than the old small/standard/
    /// large presets). The answer card scales with it (card = body + 4, see NotchType.card).
    static let answerFontRange: ClosedRange<CGFloat> = 11...19
    static let answerFontDefault: CGFloat = 13

    /// Clamp any candidate size into the supported range (pure; unit-tested).
    static func clampFontSize(_ pt: CGFloat) -> CGFloat {
        min(max(pt, answerFontRange.lowerBound), answerFontRange.upperBound)
    }

    /// The px readout beside the size slider (pure; unit-tested).
    static func fontSizeReadout(_ pt: CGFloat) -> String { "\(Int(pt.rounded())) pt" }

    static var answerFontSize: CGFloat {
        get {
            if let pt = d.object(forKey: "answerFontSizePt") as? Double { return clampFontSize(CGFloat(pt)) }
            return clampFontSize(legacyAnswerFontSize())   // migrate the old 3-preset key on read
        }
        set {
            d.set(Double(clampFontSize(newValue)), forKey: "answerFontSizePt")
            NotificationCenter.default.post(name: themeDidChange, object: nil)
        }
    }

    /// Bridge from the retired "answerSize" = small|standard|large preset (12/13/15pt).
    private static func legacyAnswerFontSize() -> CGFloat {
        switch d.string(forKey: "answerSize") {
        case "small": return 12
        case "large": return 15
        default: return answerFontDefault
        }
    }

    // MARK: Auto-collapse (答完后收起)

    /// Decomposed into a plain duration + an explicit "keep it open" switch, so the UI is a
    /// slider plus a checkbox instead of one popup that overloads 0 to mean "never". The
    /// duration is remembered even while "stay expanded" is on, so toggling back restores it.
    static let collapseSecondsRange: ClosedRange<Double> = 2...30
    static let collapseSecondsDefault: Double = 9

    static func clampCollapseSeconds(_ v: Double) -> Double {
        min(max(v, collapseSecondsRange.lowerBound), collapseSecondsRange.upperBound)
    }

    static var stayExpanded: Bool {
        get {
            if d.object(forKey: "collapseStay") != nil { return d.bool(forKey: "collapseStay") }
            // Migrate: the old single key used 0 to mean "stay until mouse leaves".
            if d.object(forKey: "collapseDelay") != nil { return d.double(forKey: "collapseDelay") == 0 }
            return false
        }
        set {
            d.set(newValue, forKey: "collapseStay")
            NotificationCenter.default.post(name: themeDidChange, object: nil)
        }
    }

    static var collapseSeconds: Double {
        get {
            if let v = d.object(forKey: "collapseSeconds") as? Double { return clampCollapseSeconds(v) }
            let old = d.object(forKey: "collapseDelay") as? Double ?? 0   // 0 when absent
            return old > 0 ? clampCollapseSeconds(old) : collapseSecondsDefault
        }
        set {
            d.set(clampCollapseSeconds(newValue), forKey: "collapseSeconds")
            NotificationCenter.default.post(name: themeDidChange, object: nil)
        }
    }

    /// Seconds the expanded answer lingers after completion before folding back into the notch.
    /// 0 means "stay until the mouse moves away" — the single value the pipeline consumes.
    static var collapseDelay: TimeInterval { resolvedCollapseDelay(stay: stayExpanded, seconds: collapseSeconds) }

    static func resolvedCollapseDelay(stay: Bool, seconds: Double) -> TimeInterval {
        stay ? 0 : clampCollapseSeconds(seconds)
    }

    /// The readout beside the collapse slider (pure; unit-tested).
    static func collapseReadout(stay: Bool, seconds: Double) -> String {
        if stay { return L10n.t("保持展开", "開いたまま", "stays open") }
        let n = Int(clampCollapseSeconds(seconds).rounded())
        return L10n.t("\(n) 秒", "\(n)秒", "\(n)s")
    }

    // MARK: Reasoning fold (简略模式)

    /// Brief mode folds its scratch work away behind "▸ 推理过程" once the answer lands. Users who
    /// always want to see the working can make it start unfolded. Read by NotchController when a
    /// capture begins (see runTapped).
    static var revealReasoningByDefault: Bool {
        get { d.bool(forKey: "revealReasoning") }   // default false = folded
        set {
            d.set(newValue, forKey: "revealReasoning")
            NotificationCenter.default.post(name: themeDidChange, object: nil)
        }
    }
}
