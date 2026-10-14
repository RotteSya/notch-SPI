import AppKit

/// An explicitly opened reading snapshot. Retains the original images independently of
/// the live question group; it never becomes input to a new solve request.
struct ExpandedAnswerContent: Equatable {
    let id: UUID
    let assets: [ContextAsset]
    let answer: String
    let explanation: String
    let needsReview: Bool
    let explaining: Bool
    let canExplain: Bool
    let explanationFailed: Bool

    var reading: AnswerReadingContent { .init(answer: answer, explanation: explanation) }
    var conclusion: String { reading.copyAnswer }
    var detail: String { reading.detail }
    var copyText: String { reading.copyAll }

}

@MainActor
final class ExpandedAnswerWindowController: NSWindowController, NSWindowDelegate {
    private(set) var content: ExpandedAnswerContent?
    var onExplain: ((UUID) -> Void)?
    var onClose: (() -> Void)?
    private let images = AnswerReadingStack()
    private let answer = AnswerReadingStack()
    private let answerScroll = NSScrollView()
    private let explainButton = NSButton()
    private let note = NSTextField(labelWithString: "")
    private var pending: DispatchWorkItem?
    private var currentQuestion = true

    init(content: ExpandedAnswerContent) {
        let window = ExpandedAnswerWindow(contentRect: NSRect(x: 0, y: 0, width: 1060, height: 720),
            styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = L10n.t("完整答案", "回答の詳細", "Full Answer")
        window.minSize = NSSize(width: 800, height: 500)
        window.isReleasedWhenClosed = false; window.sharingType = ScreenShareGuard.windowSharingType
        super.init(window: window)
        window.delegate = self
        let root = NSView(frame: NSRect(x: 0, y: 0, width: 1060, height: 720)); window.contentView = root
        let title = NSTextField(labelWithString: L10n.t("完整答案", "回答の詳細", "Full Answer"))
        title.font = .systemFont(ofSize: 24, weight: .semibold)
        let subtitle = NSTextField(labelWithString: L10n.t("题图与解释并排查看", "問題画像と解説を並べて表示", "Question images and explanation, side by side"))
        subtitle.font = .systemFont(ofSize: 13); subtitle.textColor = .secondaryLabelColor
        let imageScroll = NSScrollView()
        for (scroll, stack) in [(imageScroll, images), (answerScroll, answer)] {
            scroll.documentView = stack; scroll.hasVerticalScroller = true
            scroll.drawsBackground = true; scroll.backgroundColor = .textBackgroundColor
            stack.translatesAutoresizingMaskIntoConstraints = false
            stack.widthAnchor.constraint(equalTo: scroll.contentView.widthAnchor).isActive = true
        }
        imageScroll.setAccessibilityLabel(L10n.t("题目截图", "問題画像", "Question images"))
        answerScroll.setAccessibilityLabel(L10n.t("完整答案和解释", "回答と解説の全文", "Full answer and explanation"))
        let divider = NSBox(); divider.boxType = .separator
        let copy = NSButton(title: L10n.t("复制答案", "回答をコピー", "Copy answer"), target: self, action: #selector(copyAnswer))
        let copyAll = NSButton(title: L10n.t("复制全部", "全文をコピー", "Copy all"), target: self, action: #selector(copyAllText))
        explainButton.title = L10n.t("生成解释", "解説を生成", "Explain")
        explainButton.target = self; explainButton.action = #selector(explain)
        for button in [copy, copyAll, explainButton] { button.bezelStyle = .rounded }
        let actions = NSStackView(views: [explainButton, copy, copyAll]); actions.spacing = 10
        note.font = .systemFont(ofSize: 12); note.textColor = .secondaryLabelColor
        note.lineBreakMode = .byTruncatingTail; note.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        for view in [title, subtitle, imageScroll, divider, answerScroll, actions, note] {
            view.translatesAutoresizingMaskIntoConstraints = false; root.addSubview(view)
        }
        NSLayoutConstraint.activate([
            title.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: 24),
            title.topAnchor.constraint(equalTo: root.topAnchor, constant: 22),
            subtitle.leadingAnchor.constraint(equalTo: title.leadingAnchor),
            subtitle.topAnchor.constraint(equalTo: title.bottomAnchor, constant: 8),
            imageScroll.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            imageScroll.topAnchor.constraint(equalTo: subtitle.bottomAnchor, constant: 22),
            imageScroll.widthAnchor.constraint(equalTo: root.widthAnchor, multiplier: 0.48),
            imageScroll.heightAnchor.constraint(greaterThanOrEqualToConstant: 300),
            imageScroll.bottomAnchor.constraint(equalTo: actions.topAnchor, constant: -16),
            divider.leadingAnchor.constraint(equalTo: imageScroll.trailingAnchor),
            divider.widthAnchor.constraint(equalToConstant: 1),
            divider.topAnchor.constraint(equalTo: imageScroll.topAnchor), divider.bottomAnchor.constraint(equalTo: imageScroll.bottomAnchor),
            answerScroll.leadingAnchor.constraint(equalTo: divider.trailingAnchor),
            answerScroll.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            answerScroll.topAnchor.constraint(equalTo: imageScroll.topAnchor), answerScroll.bottomAnchor.constraint(equalTo: imageScroll.bottomAnchor),
            actions.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -20),
            actions.heightAnchor.constraint(equalToConstant: 32), actions.bottomAnchor.constraint(equalTo: root.bottomAnchor, constant: -16),
            note.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: 20),
            note.trailingAnchor.constraint(lessThanOrEqualTo: actions.leadingAnchor, constant: -16),
            note.centerYAnchor.constraint(equalTo: actions.centerYAnchor)
        ])
        self.content = content
        renderImages(content); renderAnswer(content)
        window.setContentSize(NSSize(width: 1060, height: 720)); window.center()
    }
    private lazy var answerFieldEditor: AnswerReadingFieldEditor = {
        let editor = AnswerReadingFieldEditor(); editor.isFieldEditor = true; return editor
    }()
    func windowWillReturnFieldEditor(_ sender: NSWindow, to client: Any?) -> Any? {
        AnswerText.isReadingLabel(client) ? answerFieldEditor : nil
    }
    required init?(coder: NSCoder) { nil }

    func present() { window?.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true) }

    /// A different capture must never replace the question the user is reading.
    func update(_ next: ExpandedAnswerContent) {
        guard content?.id == next.id, next != content, currentQuestion else { return }
        content = next
        guard pending == nil else { return }
        let item = DispatchWorkItem { [weak self] in
            guard let self, let content = self.content else { return }
            self.pending = nil
            self.renderAnswer(content)
        }
        pending = item
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.08, execute: item)
    }

    func detachFromCurrentQuestion() {
        guard currentQuestion else { return }
        currentQuestion = false
        pending?.cancel(); pending = nil
        if let value = content {
            // A canceled stream stays visibly incomplete; no retries from this snapshot.
            content = .init(id: value.id, assets: value.assets, answer: value.answer,
                explanation: value.explanation, needsReview: value.needsReview, explaining: false,
                canExplain: false, explanationFailed: value.explanationFailed || value.explaining)
            renderAnswer(content!)
        }
    }

    private func renderImages(_ content: ExpandedAnswerContent) {
        images.addText(L10n.t("题目截图", "問題画像", "Question images"), size: 12, color: .secondaryLabelColor)
        if content.assets.isEmpty {
            images.addText(L10n.t("当前题图已清理，可在最近查题中查看保存的记录。", "画像の保存期間が終了しました。最近の問題をご確認ください。", "The current images have expired. Check saved entries in Recent Questions."), size: 14)
        }
        for (index, asset) in content.assets.enumerated() {
            images.addText("\(index + 1) / \(content.assets.count)", size: 12, color: .secondaryLabelColor)
            let image = AnswerReadingImage()
            image.image = ScreenshotThumbnail.load(asset.file.url, maxPixelSize: 2400)
            image.imageScaling = .scaleProportionallyUpOrDown
            image.setAccessibilityLabel(L10n.t("题图 \(index + 1)", "問題画像 \(index + 1)", "Question image \(index + 1)"))
            images.addFullWidth(image)
            let size = image.image?.size ?? NSSize(width: 600, height: 400)
            image.heightAnchor.constraint(equalTo: image.widthAnchor, multiplier: max(0.05, size.height / max(1, size.width))).isActive = true
        }
    }

    private func renderAnswer(_ content: ExpandedAnswerContent) {
        let position = answerScroll.contentView.bounds.origin
        answer.beginTextUpdate()
        answer.addText(L10n.t("答案", "回答", "Answer"), size: 12, color: .secondaryLabelColor)
        answer.addText(content.reading.conclusion, size: 24, weight: .semibold)
        if content.needsReview {
            answer.addText(AnswerReadingContent.reviewMessage, size: 13, color: .systemOrange)
        }
        if !content.detail.isEmpty {
            answer.addText(L10n.t("解释", "解説", "Explanation"), size: 12, color: .secondaryLabelColor)
            answer.addText(content.detail, size: 15)
        }
        if content.explaining {
            answer.addText(L10n.t("正在生成解释…", "解説を生成中…", "Generating explanation…"), size: 13, color: .secondaryLabelColor)
        } else if content.explanationFailed {
            answer.addText(L10n.t("解释未完成，原答案保留。", "解説は未完了です。元の回答を保持しています。", "Explanation incomplete. The original answer is preserved."), size: 13, color: .secondaryLabelColor)
        } else if content.detail.isEmpty {
            answer.addText(L10n.t("暂无已生成的解释", "生成済みの解説はありません", "No explanation has been generated yet"), size: 13, color: .secondaryLabelColor)
        }
        explainButton.isHidden = !currentQuestion || !content.canExplain || content.explaining
        note.stringValue = currentQuestion
            ? L10n.t("查看已有内容 · 可照常用快捷键查下一题", "次の問題はいつものショートカットで", "Use your usual shortcut for the next question")
            : L10n.t("保留这道题的内容 · 不随新题切换", "この問題の内容を表示しています", "Keeping this question open")
        answer.endTextUpdate()
        answer.layoutSubtreeIfNeeded()
        answerScroll.contentView.scroll(to: position); answerScroll.reflectScrolledClipView(answerScroll.contentView)
    }
    @objc private func copyAnswer() { if let content { copy(content.reading.copyAnswer) } }
    @objc private func copyAllText() { if let content { copy(content.copyText) } }
    private func copy(_ text: String) {
        NSPasteboard.general.clearContents(); NSPasteboard.general.setString(text, forType: .string)
    }
    @objc private func explain() {
        guard currentQuestion, let content, content.canExplain, !content.explaining else { return }
        onExplain?(content.id)
    }
    func windowWillClose(_ notification: Notification) {
        pending?.cancel(); pending = nil; content = nil
        images.clear(); answer.clear()
        onClose?()
    }
}

private final class ExpandedAnswerWindow: NSWindow {
    override func cancelOperation(_ sender: Any?) { close() }
}
private final class AnswerReadingImage: NSImageView {
    override var intrinsicContentSize: NSSize { NSSize(width: NSView.noIntrinsicMetric, height: NSView.noIntrinsicMetric) }
}
private final class AnswerReadingStack: NSStackView {
    override var isFlipped: Bool { true }
    init() {
        super.init(frame: .zero)
        orientation = .vertical; alignment = .leading; spacing = 18
        edgeInsets = NSEdgeInsets(top: 24, left: 28, bottom: 28, right: 28)
    }
    required init?(coder: NSCoder) { nil }
    func clear() { textKeys.removeAll(); nextTextViews = nil; for view in arrangedSubviews { removeArrangedSubview(view); view.removeFromSuperview() } }
    func addFullWidth(_ view: NSView) {
        view.translatesAutoresizingMaskIntoConstraints = false; addArrangedSubview(view)
        view.widthAnchor.constraint(equalTo: widthAnchor, constant: -56).isActive = true
    }
    private var textKeys: [ObjectIdentifier: String] = [:]
    private var nextTextViews: [NSTextField]?
    func beginTextUpdate() { nextTextViews = [] }
    func endTextUpdate() {
        guard let desired = nextTextViews else { return }
        for view in arrangedSubviews where !desired.contains(where: { $0 === view }) {
            textKeys.removeValue(forKey: ObjectIdentifier(view))
            removeArrangedSubview(view); view.removeFromSuperview()
        }
        for (index, view) in desired.enumerated() {
            if arrangedSubviews.indices.contains(index), arrangedSubviews[index] === view { continue }
            if arrangedSubviews.contains(where: { $0 === view }) { removeArrangedSubview(view) }
            insertArrangedSubview(view, at: index)
        }
        nextTextViews = nil
    }
    func addText(_ text: String, size: CGFloat, weight: NSFont.Weight = .regular, color: NSColor = .labelColor) {
        let key = "\(size)|\(weight.rawValue)|\(color)|\(text)"
        if nextTextViews != nil, let existing = arrangedSubviews.compactMap({ $0 as? NSTextField }).first(where: {
            textKeys[ObjectIdentifier($0)] == key && !(nextTextViews?.contains($0) ?? false)
        }) {
            nextTextViews?.append(existing); return
        }
        let label = AnswerText.label(text, size: size, weight: weight, color: color)
        label.preferredMaxLayoutWidth = 450
        textKeys[ObjectIdentifier(label)] = key
        addFullWidth(label)
        nextTextViews?.append(label)
    }
}
