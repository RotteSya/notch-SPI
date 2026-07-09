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
    /// Resolve the channel for one capture. Pure so the mode matrix is unit-testable.
    /// customKey mode with an empty key falls back to the CLI — exactly the behavior that
    /// existed before the official service, so nothing regresses for key-less users.
    /// Unknown mode strings resolve to the official default.
    static func resolve(mode: String, customKey: String) -> ServiceChannel {
        switch mode {
        case ServiceMode.cli:
            return .cli
        case ServiceMode.customKey:
            let key = customKey.trimmingCharacters(in: .whitespacesAndNewlines)
            return key.isEmpty ? .cli : .customKey(key)
        default:
            return .official
        }
    }

    /// First-run default. New installs land on the official quota service (开箱即用);
    /// existing installs keep whatever they were doing before this feature existed, so an
    /// update never silently reroutes a working setup.
    static func defaultMode(isExistingInstall: Bool, hasCustomKey: Bool) -> String {
        guard isExistingInstall else { return ServiceMode.official }
        return hasCustomKey ? ServiceMode.customKey : ServiceMode.cli
    }

    /// Header label for the notch UI, e.g. "官方服务" / "Claude · API" / "Claude".
    static func headerLabel(channel: ServiceChannel, backend: String) -> String {
        switch channel {
        case .official: return L10n.serviceOfficial
        case .customKey: return Settings.label(forCLI: backend, usingCustomKey: true)
        case .cli: return Settings.label(forCLI: backend)
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
                "服务还没准备好（首次使用需要联网领取免费额度）。请检查网络后再试一次，或打开设置 →「账户与额度」手动领取。",
                "サービスの準備がまだ完了していません(初回はネット接続で無料枠を受け取ります)。接続を確認して再試行するか、設定→「アカウントと残高」から受け取ってください。",
                "The service isn't ready yet (first use needs a network connection to claim your free questions). Check your connection and try again, or claim them in Settings → Account."))
        }
        // A known non-positive quota is stopped client-side for a friendly message;
        // an unknown quota is allowed through — the server is the source of truth
        // and will answer 402 if the account really is empty.
        if let balance = balanceQuestions, balance <= 0 {
            return .deny(L10n.t(
                "免费额度已用完。充值题数后即可继续使用。",
                "無料枠を使い切りました。質問数をチャージすると続けられます。",
                "You're out of questions. Top up to keep going."))
        }
        return .allow
    }
}
