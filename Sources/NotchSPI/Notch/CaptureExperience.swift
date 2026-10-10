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
        L10n.t("第 2 张起，最后一次成功截图 4 秒后自动提交。捕获或预览期间暂停；关闭预览后重新倒计时。可删除单张、撤销删除或点击「现在查题」，也可取消整轮。", "2枚目から、最後の画像追加の4秒後に送信。キャプチャ中は一時停止し、プレビュー中も一時停止し、閉じると4秒から再開。画像の削除・取消や手動送信もできます。", "From the second image, send 4 seconds after the latest addition. Capture pauses the timer; capture failure resumes it. Preview also pauses sending and closes with a fresh timer. Remove, undo, ask now, or cancel in the notch.")
    }
}

/// Shared screenshot geometry keeps the flight's final frame and its reserved slot identical.
enum CaptureStyle {
    static let cardSize = NSSize(width: 128, height: 80)
    static let cardRadius: CGFloat = 8
    static let cardGap: CGFloat = 12
    static let trayHeight: CGFloat = 156
    static let actionHeight: CGFloat = 40
    static let caption = NSFont.systemFont(ofSize: 11)
    static let status = NSFont.monospacedDigitSystemFont(ofSize: 12, weight: .medium)
}

@MainActor
enum CaptureProcessing {
    static var channelNote: String {
        switch Settings.shared.serviceMode {
        case ServiceMode.customKey: return L10n.t("题图将发送至所选 API 服务，费用由你的 API 账户承担。", "選択したAPIに画像を送信し、ご自身のアカウントに課金されます。", "Images go to your selected API; its billing applies.")
        case ServiceMode.cli: return L10n.t("题图将交给所选本机 CLI，按该服务的规则处理和计费。", "選択したCLIで処理し、そのサービスの料金が適用されます。", "Images go to your selected local CLI; its processing and billing apply.")
        default: return L10n.t("题图将发送至官方 AI 服务；成功获得可用答案扣 1 题。", "公式AIに画像を送信します。有効な回答で1問分を消費。", "Images go to the official AI service; a usable answer costs one question.")
        }
    }
}
