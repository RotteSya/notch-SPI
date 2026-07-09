import Foundation

/// The app's display language. `auto` follows the system's preferred language, resolved to one
/// of the three supported languages (falling back to English).
enum AppLanguage: String, CaseIterable {
    case auto
    case zhHans = "zh-Hans"
    case ja = "ja"
    case en = "en"

    /// Name of each choice in ITS OWN language (a language picker must be readable to someone
    /// who can't read the currently selected language).
    var pickerLabel: String {
        switch self {
        case .auto: return L10n.t("跟随系统", "システムに合わせる", "Match System")
        case .zhHans: return "简体中文"
        case .ja: return "日本語"
        case .en: return "English"
        }
    }
}

/// Lightweight runtime-switchable localization (zh-Hans / ja / en).
///
/// Strings live in code as `L10n.t("中文", "日本語", "English")` triples — the compiler enforces
/// that every string exists in all three languages, and everything is greppable. Common
/// vocabulary shared across screens lives here; screen-specific strings sit inline at their
/// point of use. No .lproj: the onboarding's first screen offers a language choice that must
/// apply instantly, which bundle-based localization can't do without a relaunch.
enum L10n {
    /// Posted after the language setting changes so open windows re-render their labels.
    static let languageDidChange = Notification.Name("L10n.languageDidChange")

    enum Lang { case zh, ja, en }

    /// The persisted choice (defaults to `auto`).
    static var setting: AppLanguage {
        get { AppLanguage(rawValue: UserDefaults.standard.string(forKey: "appLanguage") ?? "") ?? .auto }
        set {
            UserDefaults.standard.set(newValue.rawValue, forKey: "appLanguage")
            cachedResolved = nil
            NotificationCenter.default.post(name: languageDidChange, object: nil)
        }
    }

    /// Resolved display language. Cached because `t(_:_:_:)` runs on every label of every
    /// redraw; invalidated when the setting changes.
    private static var cachedResolved: Lang?

    static var lang: Lang {
        if let c = cachedResolved { return c }
        let r = resolve(setting: setting, preferred: Locale.preferredLanguages)
        cachedResolved = r
        return r
    }

    /// Pure resolution (unit-testable): manual choice wins; `auto` maps the first system
    /// language we support (zh* → simplified Chinese, ja* → Japanese), defaulting to English.
    static func resolve(setting: AppLanguage, preferred: [String]) -> Lang {
        switch setting {
        case .zhHans: return .zh
        case .ja: return .ja
        case .en: return .en
        case .auto:
            for code in preferred {
                let c = code.lowercased()
                if c.hasPrefix("zh") { return .zh }
                if c.hasPrefix("ja") { return .ja }
                if c.hasPrefix("en") { return .en }
            }
            return .en
        }
    }

    /// The workhorse: pick the current language's variant.
    @inline(__always)
    static func t(_ zh: String, _ ja: String, _ en: String) -> String {
        switch lang {
        case .zh: return zh
        case .ja: return ja
        case .en: return en
        }
    }

    // MARK: - Common vocabulary (shared across screens)

    static var ok: String { t("好", "OK", "OK") }
    static var cancel: String { t("取消", "キャンセル", "Cancel") }
    static var delete: String { t("删除", "削除", "Delete") }
    static var next: String { t("继续", "次へ", "Continue") }
    static var back: String { t("上一步", "戻る", "Back") }
    static var skip: String { t("跳过", "スキップ", "Skip") }
    static var done: String { t("完成", "完了", "Done") }
    static var retry: String { t("重试", "再試行", "Retry") }
    static var refresh: String { t("刷新", "更新", "Refresh") }
    static var settingsTitle: String { t("设置", "設定", "Settings") }
    static var openSettings: String { t("设置…", "設定…", "Settings…") }
    static var quitApp: String { t("退出 NotchSPI", "NotchSPI を終了", "Quit NotchSPI") }
    static var topUp: String { t("充值…", "チャージ…", "Top Up…") }

    // MARK: - Modes & depths

    static var modeTutor: String { t("学习辅导", "学習チューター", "Study Tutor") }
    static var modePersonality: String { t("性格测试", "性格検査", "Personality Test") }

    static func modeLabel(_ mode: String) -> String {
        mode == "personality" ? modePersonality : modeTutor
    }

    static var depthBrief: String { t("简略", "簡潔", "Brief") }
    static var depthHint: String { t("提示", "ヒント", "Hints") }
    static var depthGuided: String { t("引导", "ガイド", "Guided") }
    static var depthFull: String { t("完整", "詳細", "Full") }

    static func depthLabel(_ depth: String) -> String {
        switch depth {
        case "brief": return depthBrief
        case "hint": return depthHint
        case "full": return depthFull
        default: return depthGuided
        }
    }

    // MARK: - Service modes

    static var serviceOfficial: String { t("官方服务", "公式サービス", "Official Service") }
    static var serviceCustomKey: String { t("自定义 API Key", "カスタム API キー", "Custom API Key") }
    static var serviceCLI: String { t("本机 CLI", "ローカル CLI", "Local CLI") }

    static func serviceModeLabel(_ mode: String) -> String {
        switch mode {
        case ServiceMode.customKey: return serviceCustomKey
        case ServiceMode.cli: return serviceCLI
        default: return serviceOfficial
        }
    }

    // MARK: - Quota (题数额度)

    /// "180 题" / "180問" / "180 questions" — the unit for balances and grants.
    static func questions(_ n: Int) -> String {
        t("\(n) 题", "\(n)問", n == 1 ? "1 question" : "\(n) questions")
    }

    /// "剩余 179 题" / "残り179問" / "179 questions left"
    static func questionsLeft(_ n: Int) -> String {
        t("剩余 \(n) 题", "残り\(n)問", n == 1 ? "1 question left" : "\(n) questions left")
    }

    static var quotaUnknown: String { t("额度未同步", "残高未同期", "Quota not synced") }

    // MARK: - Notch status line

    static var statusReady: String { t("就绪", "準備完了", "Ready") }
    static var statusPreparing: String { t("正在准备…", "準備中…", "Preparing…") }
    static var statusDone: String { t("完成", "完了", "Done") }
    static var statusError: String { t("出错", "エラー", "Error") }
    static var statusExplaining: String { t("讲解中…", "解説中…", "Explaining…") }
    static var statusAnswering: String { t("作答中…", "回答中…", "Answering…") }
    static var noOutput: String { t("（没有输出）", "（出力なし）", "(no output)") }
}
