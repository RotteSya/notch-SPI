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

    /// "small" | "standard" | "large" → the answer body's point size.
    static var answerSizeID: String {
        get { d.string(forKey: "answerSize") ?? "standard" }
        set {
            d.set(newValue, forKey: "answerSize")
            NotificationCenter.default.post(name: themeDidChange, object: nil)
        }
    }

    static var answerFontSize: CGFloat {
        switch answerSizeID {
        case "small": return 12
        case "large": return 15
        default: return 13
        }
    }

    static func answerSizeLabel(_ id: String) -> String {
        switch id {
        case "small": return L10n.t("小", "小", "Small")
        case "large": return L10n.t("大", "大", "Large")
        default: return L10n.t("标准", "標準", "Standard")
        }
    }

    static let answerSizeIDs = ["small", "standard", "large"]

    // MARK: Auto-collapse delay

    /// Seconds the expanded answer lingers after completion before folding back into the notch.
    /// 0 means "stay until I move the mouse away" (collapse only on hover-out).
    static var collapseDelay: TimeInterval {
        get {
            guard d.object(forKey: "collapseDelay") != nil else { return 9 }
            return d.double(forKey: "collapseDelay")
        }
        set { d.set(newValue, forKey: "collapseDelay") }
    }

    static let collapseDelayChoices: [TimeInterval] = [4, 9, 20, 0]

    static func collapseDelayLabel(_ v: TimeInterval) -> String {
        if v == 0 { return L10n.t("一直展开，直到移开鼠标", "マウスを離すまで開いたまま", "Stay until mouse leaves") }
        return L10n.t("\(Int(v)) 秒后收起", "\(Int(v))秒後にたたむ", "Fold after \(Int(v))s")
    }
}
