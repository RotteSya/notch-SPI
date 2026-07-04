import Foundation

/// Which channel a capture travels through. Three modes coexist; the user picks one in the
/// gear menu (or during onboarding) and can switch freely at any time:
/// - `official`  — NotchSPI 官方按量计费服务（新安装的默认值）
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

    /// First-run default. New installs land on the official pay-as-you-go service (开箱即用);
    /// existing installs keep whatever they were doing before this feature existed, so an
    /// update never silently reroutes a working setup.
    static func defaultMode(isExistingInstall: Bool, hasCustomKey: Bool) -> String {
        guard isExistingInstall else { return ServiceMode.official }
        return hasCustomKey ? ServiceMode.customKey : ServiceMode.cli
    }

    /// Header label for the notch UI, e.g. "官方服务" / "Claude · API" / "Claude".
    static func headerLabel(channel: ServiceChannel, backend: String) -> String {
        switch channel {
        case .official: return "官方服务"
        case .customKey: return Settings.label(forCLI: backend, usingCustomKey: true)
        case .cli: return Settings.label(forCLI: backend)
        }
    }
}

/// 计费鉴权拦截器。Runs before every capture, but by construction it can only ever stop the
/// OFFICIAL channel: custom-key and CLI captures are returned as `.allow` on the first line,
/// before any account or balance state is even read.
enum BillingGate {
    enum Verdict: Equatable {
        case allow
        case deny(String) // user-facing reason (余额不足 / 未初始化)
    }

    static func preflight(channel: ServiceChannel, hasDeviceToken: Bool, balanceCents: Int?) -> Verdict {
        // Never intercept the non-official modes — they don't touch our billing at all.
        guard case .official = channel else { return .allow }

        guard hasDeviceToken else {
            return .deny("官方服务尚未完成初始化。请打开齿轮菜单 →「账户与额度…」重试初始化，或切换到自定义 API Key / 本机 CLI 模式。")
        }
        // A known non-positive balance is stopped client-side for a friendly message;
        // an unknown balance is allowed through — the server is the source of truth
        // and will answer 402 if the account really is empty.
        if let balance = balanceCents, balance <= 0 {
            return .deny("余额不足。请在齿轮菜单 →「账户与额度…」中充值后继续，或切换到自定义 API Key / 本机 CLI 模式。")
        }
        return .allow
    }
}
