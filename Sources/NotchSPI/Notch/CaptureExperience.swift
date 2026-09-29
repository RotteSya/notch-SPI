import AppKit

/// The same action vocabulary is used by shortcuts, menus and onboarding.
@MainActor
enum CaptureAction: CaseIterable {
    case single, multiple, personality
    var title: String {
        switch self {
        case .single: return L10n.t("截屏查题", "画像で質問", "Screenshot & ask")
        case .multiple: return L10n.t("多图查题", "複数画像で質問", "Ask with multiple images")
        case .personality: return L10n.t("性格测试", "性格検査", "Personality test")
        }
    }
    var combo: HotkeyCombo {
        switch self {
        case .single: return Settings.shared.captureCombo
        case .multiple: return Settings.shared.contextCombo
        case .personality: return Settings.shared.personalityCombo
        }
    }
    var detail: String {
        switch self {
        case .single: return L10n.t("一键捕获已配置目标，截图飞入刘海并自动提问。", "設定した対象をワンキーでキャプチャし、ノッチから自動送信。", "Capture the configured target. Its screenshot flies into the notch and asks automatically.")
        case .multiple: return L10n.t("1 张持续等待；2–4 张按顺序一起提交。", "1枚では待機。2〜4枚を順番にまとめて送信。", "One image waits. Two to four images are submitted together, in order.")
        case .personality: return L10n.t("一键捕获已配置目标，按当前人物像自动作答。", "設定した対象をキャプチャし、現在の人物像で自動回答。", "Capture the configured target to answer using your active persona.")
        }
    }
    static var countdownRule: String {
        L10n.t("第 2 张起，最后一次成功截图 4 秒后自动提交。捕获期间暂停；捕获失败后恢复剩余时间。刘海内可取消整轮。", "2枚目から、最後の画像追加の4秒後に送信。キャプチャ中は一時停止し、キャプチャ失敗時は残り時間から再開。ノッチで全体を取消できます。", "From the second image, send 4 seconds after the latest addition. Capture pauses the timer; capture failure resumes it. Cancel the entire round in the notch.")
    }
}

/// Shared screenshot geometry keeps the flight's final frame and its reserved slot identical.
enum CaptureStyle {
    static let cardSize = NSSize(width: 104, height: 68)
    static let cardRadius: CGFloat = 8
    static let cardGap: CGFloat = 12
    static let trayHeight: CGFloat = 136
    static let actionHeight: CGFloat = 40
    static let caption = NSFont.systemFont(ofSize: 11)
    static let status = NSFont.monospacedDigitSystemFont(ofSize: 12, weight: .medium)
}
