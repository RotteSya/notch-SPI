import Foundation

/// Which channel a capture travels through. Three modes coexist; the user picks one during
/// onboarding (official, implicitly) or in 设置 → 高级, and can switch freely at any time:
/// - `official`  — NotchSPI 官方服务，题数额度制（新安装的默认值）
/// - `customKey` — 用户自己的 Anthropic / OpenAI API Key 直连
/// - `cli`       — 本机 codex / claude CLI（最初的模式）
enum ServiceChannel: Equatable {
    case official
    case customKey(String)
    case cli
}

/// Stable string ids persisted in UserDefaults ("serviceMode").
enum ServiceMode {
    static let official = "official"
    static let customKey = "customKey"
    static let cli = "cli"
    static let all = [official, customKey, cli]
}

enum ServiceRouting {
    /// New captures never silently switch a selected third-party channel to official billing.
    static func configurationError(mode: String, customKey: String, cliAllowed: Bool) -> String? {
        if mode == ServiceMode.customKey && customKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return L10n.t("请在高级设置中填写 API Key，或自行选择官方服务。", "詳細設定で API Key を入力するか、公式サービスを選んでください。", "Enter an API key in Advanced settings or select the official service.")
        }
        if mode == ServiceMode.cli && !cliAllowed {
            return L10n.t("此设备尚未启用 CLI。请在设置中选择可用通道。", "このデバイスでは CLI が有効ではありません。設定で利用可能な接続を選んでください。", "CLI is not enabled for this device. Choose an available channel in Settings.")
        }
        return nil
    }

    /// Resolve the channel for one capture. Pure so the mode matrix is unit-testable.
    /// customKey mode with an empty key falls back to the CLI — exactly the behavior that
    /// existed before the official service, so nothing regresses for key-less users.
    /// Unknown mode strings resolve to the official default.
    ///
    /// `cliAllowed` is the per-device unlock gate (OfficialAPI.cliEnabled — flipped by the
    /// operator per 设备码, like a manual quota grant): the CLI channel is retired by default
    /// and every path that would reach it — explicit cli mode, or the empty-custom-key
    /// fallback — reroutes to the official service until unlocked. The stored mode string is
    /// never rewritten, so unlocking restores the previous choice.
    static func resolve(mode: String, customKey: String, cliAllowed: Bool) -> ServiceChannel {
        switch mode {
        case ServiceMode.cli:
            return cliAllowed ? .cli : .official
        case ServiceMode.customKey:
            let key = customKey.trimmingCharacters(in: .whitespacesAndNewlines)
            if !key.isEmpty { return .customKey(key) }
            return cliAllowed ? .cli : .official
        default:
            return .official
        }
    }

    /// First-run default. New installs land on the official quota service (开箱即用);
    /// existing installs keep whatever they were doing before this feature existed, so an
    /// update never silently reroutes a working setup. Key-less existing installs used to
    /// default to the CLI; with the CLI retired behind the 设备码 gate they now land on the
    /// official service unless already unlocked.
    static func defaultMode(isExistingInstall: Bool, hasCustomKey: Bool, cliAllowed: Bool) -> String {
        guard isExistingInstall else { return ServiceMode.official }
        if hasCustomKey { return ServiceMode.customKey }
        return cliAllowed ? ServiceMode.cli : ServiceMode.official
    }

    /// Header label for the notch UI, e.g. "官方服务" / "Gemini · API" / "Codex".
    /// `cliBackend` names the CLI-mode engine (codex/claude); `customProviderName` names the active
    /// third-party provider for custom-key mode.
    static func headerLabel(channel: ServiceChannel, cliBackend: String, customProviderName: String) -> String {
        switch channel {
        case .official: return L10n.serviceOfficial
        case .customKey: return customProviderName + " · API"
        case .cli: return Settings.label(forCLI: cliBackend)
        }
    }
}

/// 额度鉴权拦截器。Runs before every capture, but by construction it can only ever stop the
/// OFFICIAL channel: custom-key and CLI captures are returned as `.allow` on the first line,
/// before any account or quota state is even read.
enum QuotaGate {
    enum Verdict: Equatable {
        case allow
        case deny(String) // user-facing reason (额度用完 / 未初始化)
    }

    static func preflight(channel: ServiceChannel, hasDeviceToken: Bool, balanceQuestions: Int?) -> Verdict {
        // Never intercept the non-official modes — they don't touch our quota at all.
        guard case .official = channel else { return .allow }

        guard hasDeviceToken else {
            return .deny(L10n.t(
                "官方账户尚未连接。请检查网络后重试，或打开设置 →「账户与订阅」刷新账户。",
                "公式アカウントに未接続です。接続を確認して再試行するか、設定→「アカウントとプラン」で更新してください。",
                "Your official account is not connected. Check your connection and retry, or refresh in Settings → Account & plan."))
        }
        // A known non-positive quota is stopped client-side for a friendly message;
        // an unknown quota is allowed through — the server is the source of truth
        // and will answer 402 if the account really is empty.
        if let balance = balanceQuestions, balance <= 0 {
            return .deny(L10n.t(
                "当前没有可用额度。请在设置 →「账户与订阅」查看体验、每日额度和题包。",
                "現在利用できる枠がありません。設定→「アカウントとプラン」で体験・毎日の枠・パックをご確認ください。",
                "No allowance is available right now. Check your trial, daily allowances, and packs in Settings → Account & plan."))
        }
        return .allow
    }
}
