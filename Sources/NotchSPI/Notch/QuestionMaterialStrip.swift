import AppKit

@MainActor
final class QuestionMaterialStrip: NSView {
    enum LocalAction: Equatable { case source, resolveWithModel }
    var onExplain: (() -> Void)?
    var onLocalAction: ((LocalAction) -> Void)?
    private var explanationAvailable = false
    private var personality = false
    private var localActions: [LocalAction] = []
    var onAdd: (() -> Void)?
    var onClear: (() -> Void)?
    var onSelect: (() -> Void)?
    var onRemove: ((UUID) -> Void)?
    var onUndo: (() -> Void)?
    private var undoAvailable = false
    private var preview: QuestionImagePreview?
    private var removeButtons: [NotchActionButton] = []
    private var assets: [ContextAsset] = []
    private var buttons: [NotchActionButton] = []
    private var localButtons: [NotchActionButton] = []
    override var isFlipped: Bool { true }

    func update(_ next: [ContextAsset], explanationAvailable: Bool, personality: Bool = false, localActions: [LocalAction] = [], undoAvailable: Bool = false) {
        guard next != assets || buttons.isEmpty || self.undoAvailable != undoAvailable || self.explanationAvailable != explanationAvailable || self.personality != personality || self.localActions != localActions else { return }
        if next != assets { preview?.close(); preview = nil }
        self.undoAvailable = undoAvailable
        self.explanationAvailable = explanationAvailable
        self.personality = personality
        self.localActions = localActions
        assets = next
        subviews.forEach { $0.removeFromSuperview() }
        buttons = []
        removeButtons = []
        for (ordinal, asset) in next.enumerated() {
            let assetID = asset.id
            let button = NotchActionButton(title: "\(ordinal + 1)") { [weak self] in self?.showPreview(assetID) }
            button.image = NSImage(contentsOf: asset.file.url)
            button.imagePosition = .imageAbove
            button.imageScaling = .scaleProportionallyDown
            button.toolTip = L10n.t("预览第 \(ordinal + 1) 张材料", "資料 \(ordinal + 1) をプレビュー", "Preview reference \(ordinal + 1)")
            button.setAccessibilityLabel(button.toolTip)
            buttons.append(button); addSubview(button)
            let remove = NotchActionButton(title: "×") { [weak self] in self?.onRemove?(assetID) }
            remove.setAccessibilityLabel(L10n.t("删除第 \(ordinal + 1) 张材料", "資料 \(ordinal + 1) を削除", "Remove reference \(ordinal + 1)"))
            removeButtons.append(remove); addSubview(remove)
        }
        var actions: [(String, () -> Void)] = [
            (CaptureAction.multiple.title, { [weak self] in self?.onAdd?() }),
            (personality ? CaptureAction.personality.title : CaptureAction.single.title, { [weak self] in self?.onSelect?() }),
            (L10n.t("清空题图与答案", "画像と回答を消去", "Clear images and answer"), { [weak self] in self?.onClear?() }),
        ]
        if undoAvailable { actions.insert((L10n.t("撤销删除", "削除を元に戻す", "Undo removal"), { [weak self] in self?.onUndo?() }), at: 0) }
        if explanationAvailable {
            actions.insert((L10n.t("查看解释", "解説を見る", "Explanation"), { [weak self] in self?.onExplain?() }), at: 0)
        }
        for (title, action) in actions {
            let button = NotchActionButton(title: title, action: action)
            buttons.append(button); addSubview(button)
        }
        localButtons = []
        for action in localActions {
            let title = action == .source
                ? L10n.t("查看原题/来源", "原題と出典", "Question and source")
                : L10n.t("使用模型重新求解", "モデルで解き直す", "Solve again with the model")
            let button = NotchActionButton(title: title) { [weak self] in self?.onLocalAction?(action) }
            localButtons.append(button); addSubview(button)
        }
        needsLayout = true
    }
    func showPreview(_ id: UUID) {
        guard let asset = assets.first(where: { $0.id == id }) else { return }
        preview?.close()
        preview = QuestionImagePreview(asset: asset, title: L10n.t("题目材料 · 预览", "問題の資料 · プレビュー", "Question material · Preview"))
        preview?.onRemove = { [weak self] in self?.onRemove?(id) }
        preview?.present()
    }
    override func layout() {
        super.layout()
        var x: CGFloat = 0
        var actionY: CGFloat = assets.isEmpty ? 4 : 24
        for (index, button) in buttons.enumerated() {
            let width: CGFloat = index < assets.count ? 56 : max(74, button.intrinsicContentSize.width + 4)
            if index >= assets.count, x + width > bounds.width, undoAvailable {
                x = 0; actionY = assets.isEmpty ? actionY + 30 : 74
            }
            button.frame = NSRect(x: x, y: index < assets.count ? 2 : actionY,
                                  width: width, height: index < assets.count ? 66 : 26)
            x += width + 6
            if index < removeButtons.count {
                removeButtons[index].frame = NSRect(x: button.frame.maxX - 20, y: button.frame.minY, width: 20, height: 20)
            }
        }
        x = 0
        let y = bounds.height - 28
        for button in localButtons {
            let width = max(74, button.intrinsicContentSize.width + 4)
            button.frame = NSRect(x: x, y: max(0, y), width: width, height: 26)
            x += width + 6
        }
    }
}

final class NotchActionButton: NSButton {
    private let actionBlock: () -> Void
    // The notch deliberately cannot become key; material actions must still accept clicks.
    override var needsPanelToBecomeKey: Bool { false }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func accessibilityPerformPress() -> Bool {
        guard isEnabled, !isHiddenOrHasHiddenAncestor else { return false }
        actionBlock()
        return true
    }
    init(title: String, action: @escaping () -> Void) {
        self.actionBlock = action
        super.init(frame: .zero)
        self.title = title
        self.target = self
        self.action = #selector(performAction)
        self.bezelStyle = .inline
        self.contentTintColor = NotchPalette.primary
        self.wantsLayer = true
        self.layer?.cornerRadius = CaptureStyle.cardRadius
        self.layer?.backgroundColor = NotchPalette.rule.cgColor
        self.controlSize = .small
        self.font = CaptureStyle.caption
        self.attributedTitle = NSAttributedString(string: title, attributes: [
            .font: CaptureStyle.caption, .foregroundColor: NotchPalette.primary,
        ])
        self.setAccessibilityLabel(title)
    }
    required init?(coder: NSCoder) { nil }
    @objc private func performAction() { actionBlock() }
}
