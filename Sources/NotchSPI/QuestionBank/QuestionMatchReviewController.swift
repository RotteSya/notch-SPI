import AppKit

/// Side-by-side check of the captured question and one local candidate.
/// Confirmation is an explicit control. A matching transcription is not an answer.
@MainActor
final class QuestionMatchReviewController: NSWindowController, NSWindowDelegate {
    var onConfirm: ((LocalCandidate, [String: String]) -> Void)?
    var onUseModel: (() -> Void)?
    var onCancel: (() -> Void)?

    private var candidates: [LocalCandidate] = []
    private var currentOptions: [ExtractedOption] = []
    private var selectedIndex = 0
    private var finished = false
    private let imageView = NSImageView()
    private let stemView = NSTextField(wrappingLabelWithString: "")
    private let optionsView = NSTextField(wrappingLabelWithString: "")
    private let answerView = NSTextField(wrappingLabelWithString: "")
    private let notice = NSTextField(wrappingLabelWithString: "")
    private let picker = NSPopUpButton()
    private var mapPopups: [NSPopUpButton] = []
    private var mapLabels: [String] = []
    private let mapHost = SettingsFlippedView()
    private let reviewScroll = NSScrollView()
    private let reviewDocument = SettingsFlippedView()
    private var mapDetails: [NSTextField] = []
    private var mappingLabels: [NSTextField] = []
    private let confirmButton = NSButton(title: "", target: nil, action: nil)
    private let modelButton = NSButton(title: "", target: nil, action: nil)
    private let cancelButton = NSButton(title: "", target: nil, action: nil)

    convenience init() {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 860, height: 560),
            styleMask: [.titled, .closable, .resizable],
            backing: .buffered,
            defer: false)
        window.title = L10n.t("发现本地候选", "ローカル候補", "Local candidate")
        window.sharingType = ScreenShareGuard.windowSharingType
        self.init(window: window)
        window.delegate = self
        window.contentMinSize = NSSize(width: 860, height: 560)
        build()
    }

    func present(imageURL: URL?, candidates: [LocalCandidate], currentOptions: [ExtractedOption], conflict: Bool, display: Bool = true) {
        self.candidates = Array(candidates.prefix(QuestionBankLimits.maxCandidates))
        self.currentOptions = currentOptions
        selectedIndex = 0
        finished = false
        if let imageURL { imageView.image = NSImage(contentsOf: imageURL) }
        picker.removeAllItems()
        for (index, candidate) in self.candidates.enumerated() {
            picker.addItem(withTitle: "\(index + 1). \(candidate.bankTitle) \(candidate.bankVersion)")
        }
        picker.isHidden = self.candidates.count < 2
        notice.stringValue = conflict
            ? L10n.t("几个题库的答案不一致。可以查看，确认不会自动选其中一个。", "複数の問題集で答えが異なります。表示はできますが、自動では選べません。", "These banks disagree. You can read them; none is selected automatically.")
            : L10n.t("请核对题干、条件和全部选项。答案由该题库提供。", "問題文・条件・選択肢を確認してください。答えはこの問題集のものです。", "Check the stem, the conditions, and every option. The bank supplies the answer.")
        reloadCandidate()
        guard display else { return }
        window?.center()
        window?.makeKeyAndOrderFront(nil)
        window?.makeFirstResponder(confirmButton.isEnabled ? confirmButton : cancelButton)
    }

    func dismiss() {
        finished = true
        window?.close()
    }

    func windowWillClose(_ notification: Notification) {
        guard !finished else { return }
        finished = true
        onCancel?()
    }

    private func build() {
        guard let content = window?.contentView else { return }
        let root = SettingsFlippedView(frame: content.bounds)
        root.autoresizingMask = [.width, .height]
        content.addSubview(root)
        imageView.frame = NSRect(x: 16, y: 52, width: 280, height: 470)
        imageView.imageScaling = .scaleProportionallyUpOrDown
        imageView.setAccessibilityLabel(L10n.t("当前截图", "現在のスクリーンショット", "Current screenshot"))
        root.addSubview(imageView)
        notice.frame = NSRect(x: 312, y: 16, width: 530, height: 36)
        notice.font = .systemFont(ofSize: 12)
        notice.textColor = .secondaryLabelColor
        root.addSubview(notice)
        picker.frame = NSRect(x: 312, y: 56, width: 530, height: 26)
        picker.target = self
        picker.action = #selector(candidateChanged)
        picker.setAccessibilityLabel(L10n.t("候选题目", "候補問題", "Candidate question"))
        root.addSubview(picker)
        stemView.frame = NSRect(x: 312, y: 90, width: 530, height: 90)
        stemView.font = .systemFont(ofSize: 13)
        reviewDocument.addSubview(stemView)
        optionsView.frame = NSRect(x: 312, y: 184, width: 530, height: 150)
        optionsView.font = .systemFont(ofSize: 12)
        reviewDocument.addSubview(optionsView)
        mapHost.frame = NSRect(x: 312, y: 338, width: 530, height: 110)
        reviewDocument.addSubview(mapHost)
        answerView.frame = NSRect(x: 312, y: 452, width: 530, height: 52)
        answerView.font = .systemFont(ofSize: 13, weight: .semibold)
        reviewDocument.addSubview(answerView)
        confirmButton.frame = NSRect(x: 312, y: 516, width: 250, height: 28)
        confirmButton.title = L10n.t("核对无误，使用此题答案", "確認してこの答えを使う", "Checked, use this answer")
        confirmButton.bezelStyle = .rounded
        confirmButton.target = self
        confirmButton.action = #selector(confirmTapped)
        confirmButton.setAccessibilityLabel(confirmButton.title)
        root.addSubview(confirmButton)
        modelButton.frame = NSRect(x: 570, y: 516, width: 160, height: 28)
        modelButton.title = L10n.t("继续模型求解", "モデルで解く", "Continue with the model")
        modelButton.bezelStyle = .rounded
        modelButton.target = self
        modelButton.action = #selector(modelTapped)
        modelButton.setAccessibilityLabel(modelButton.title)
        root.addSubview(modelButton)
        cancelButton.frame = NSRect(x: 738, y: 516, width: 104, height: 28)
        cancelButton.title = L10n.t("取消", "キャンセル", "Cancel")
        cancelButton.bezelStyle = .rounded
        cancelButton.keyEquivalent = "\u{1b}"
        cancelButton.target = self
        cancelButton.action = #selector(cancelTapped)
        cancelButton.setAccessibilityLabel(cancelButton.title)
        root.addSubview(cancelButton)
        reviewScroll.hasVerticalScroller = true
        reviewScroll.autohidesScrollers = false
        reviewScroll.drawsBackground = false
        reviewScroll.documentView = reviewDocument
        reviewScroll.setAccessibilityLabel(L10n.t("完整题目与选项核对", "問題文と選択肢の確認", "Full question and option review"))
        root.addSubview(reviewScroll)
        for field in [stemView, optionsView, answerView] { field.isSelectable = true }
        layoutReview()
    }

    func windowDidResize(_ notification: Notification) { layoutReview() }

    private func fit(_ field: NSTextField, y: CGFloat, width: CGFloat) -> CGFloat {
        let height = ceil(field.attributedStringValue.boundingRect(
            with: NSSize(width: max(1, width - 6), height: 1_000_000),
            options: [.usesLineFragmentOrigin, .usesFontLeading]).height) + 8
        field.frame = NSRect(x: 0, y: y, width: width, height: max(24, height))
        return field.frame.maxY
    }

    private func layoutReview() {
        guard let root = window?.contentView?.subviews.first else { return }
        let size = root.bounds.size
        let left: CGFloat = 312
        let width = max(530, size.width - left - 18)
        imageView.frame = NSRect(x: 16, y: 52, width: 280, height: max(200, size.height - 90))
        notice.frame = NSRect(x: left, y: 16, width: width, height: 36)
        picker.frame = NSRect(x: left, y: 56, width: width, height: 26)
        reviewScroll.frame = NSRect(x: left, y: 90, width: width, height: size.height - 148)
        let textWidth = max(480, reviewScroll.contentSize.width - 12)
        var y = fit(stemView, y: 0, width: textWidth) + 16
        y = fit(optionsView, y: y, width: textWidth) + 16
        mapHost.frame = NSRect(x: 0, y: y, width: textWidth, height: 0)
        var mapY: CGFloat = 0
        for i in mapPopups.indices {
            mappingLabels[i].frame = NSRect(x: 0, y: mapY + 2, width: 36, height: 22)
            mapPopups[i].frame = NSRect(x: 40, y: mapY, width: textWidth - 40, height: 26)
            mapY += 30
            mapY = fit(mapDetails[i], y: mapY, width: textWidth) + 12
        }
        mapHost.setFrameSize(NSSize(width: textWidth, height: mapY))
        y += mapY
        y = fit(answerView, y: y + 12, width: textWidth) + 16
        reviewDocument.setFrameSize(NSSize(width: reviewScroll.contentSize.width, height: max(y, reviewScroll.contentSize.height)))
        let buttonY = size.height - 44
        confirmButton.frame = NSRect(x: left, y: buttonY, width: 246, height: 28)
        modelButton.frame = NSRect(x: left + 250, y: buttonY, width: width - 342, height: 28)
        cancelButton.frame = NSRect(x: size.width - 106, y: buttonY, width: 88, height: 28)
    }

    @objc private func candidateChanged() {
        selectedIndex = picker.indexOfSelectedItem
        reloadCandidate()
    }

    @objc private func confirmTapped() {
        guard candidates.indices.contains(selectedIndex), confirmButton.isEnabled else { return }
        let candidate = candidates[selectedIndex]
        let map = candidate.kind == .shortFill ? [:] : submittedMap()
        finish { self.onConfirm?(candidate, map) }
    }

    @objc private func modelTapped() { finish { self.onUseModel?() } }
    @objc private func cancelTapped() { finish { self.onCancel?() } }

    private func finish(_ action: () -> Void) {
        guard !finished else { return }
        finished = true
        action()
        window?.close()
    }

    private func reloadCandidate() {
        guard candidates.indices.contains(selectedIndex) else { return }
        let candidate = candidates[selectedIndex]
        stemView.attributedStringValue = QuestionTextMarks.marked(candidate.stem)
        let optionLines = candidate.options.map { "\($0.label)  \($0.text)" }.joined(separator: "\n")
        optionsView.attributedStringValue = QuestionTextMarks.marked(optionLines.isEmpty ? candidate.stem : optionLines)
        rebuildMap(candidate)
        refreshAnswer(candidate)
        confirmButton.isEnabled = canConfirm(candidate)
        layoutReview()
        reviewDocument.scroll(.zero)
    }

    private func rebuildMap(_ candidate: LocalCandidate) {
        mapHost.subviews.forEach { $0.removeFromSuperview() }
        mapPopups = []
        mapLabels = []
        mapDetails = []
        mappingLabels = []
        guard candidate.kind != .shortFill else { return }
        let pairs = visiblePairs(for: candidate)
        guard !pairs.isEmpty else { return }
        let derived = QuestionIdentity.mapping(current: pairs, bank: candidate.options, policy: candidate.orderPolicy).labelToOptionID
        let initial = candidate.savedLabelMap.isEmpty ? derived : candidate.savedLabelMap
        var y: CGFloat = 0
        for item in pairs.prefix(6) {
            let label = NSTextField(labelWithString: item.label + " →")
            label.frame = NSRect(x: 0, y: y, width: 36, height: 22)
            mapHost.addSubview(label)
            mappingLabels.append(label)
            let detail = NSTextField(wrappingLabelWithString: "")
            detail.isSelectable = true
            detail.font = .systemFont(ofSize: 12)
            mapHost.addSubview(detail)
            mapDetails.append(detail)
            let popup = NSPopUpButton(frame: NSRect(x: 40, y: y, width: 470, height: 24), pullsDown: false)
            for option in candidate.options {
                let menu = NSMenuItem(title: option.label + "  " + option.text, action: nil, keyEquivalent: "")
                menu.representedObject = option.id
                popup.menu?.addItem(menu)
            }
            if let id = initial[item.label], let index = candidate.options.firstIndex(where: { $0.id == id }) {
                popup.selectItem(at: index)
            }
            popup.target = self
            popup.action = #selector(mapChanged)
            popup.setAccessibilityLabel(L10n.t("选项 \(item.label) 对应", "選択肢 \(item.label) の対応", "Option \(item.label) maps to"))
            mapHost.addSubview(popup)
            mapPopups.append(popup)
            mapLabels.append(item.label)
            y += 26
        }
    }

    @objc private func mapChanged() {
        guard candidates.indices.contains(selectedIndex) else { return }
        let candidate = candidates[selectedIndex]
        refreshAnswer(candidate)
        confirmButton.isEnabled = canConfirm(candidate)
        layoutReview()
    }

    private func visiblePairs(for candidate: LocalCandidate) -> [(label: String, text: String)] {
        if !currentOptions.isEmpty { return currentOptions.map { ($0.label, $0.text) } }
        return candidate.savedLabelMap.keys.sorted().map { label in
            let text = candidate.options.first { $0.id == candidate.savedLabelMap[label] }?.text ?? ""
            return (label, text)
        }
    }

    private func submittedMap() -> [String: String] {
        var map: [String: String] = [:]
        for (label, popup) in zip(mapLabels, mapPopups) {
            if let id = popup.selectedItem?.representedObject as? String { map[label] = id }
        }
        return map
    }

    private func refreshAnswer(_ candidate: LocalCandidate) {
        for i in mapPopups.indices {
            let selected = candidate.options.first { $0.id == mapPopups[i].selectedItem?.representedObject as? String }
            let text = selected.map { $0.label + "  " + $0.text } ?? ""
            mapDetails[i].stringValue = mapLabels[i] + " → " + text
            mapPopups[i].toolTip = text
        }
        let map = candidate.kind == .shortFill ? [:] : submittedMap()
        let rendered = QuestionIdentity.displayAnswer(kind: candidate.kind, answer: candidate.answer, options: candidate.options, labelMap: map)
        answerView.stringValue = L10n.t("题库答案", "問題集の答え", "Bank answer") + "  " + rendered.line
    }

    private func canConfirm(_ candidate: LocalCandidate) -> Bool {
        if candidate.kind == .shortFill { return true }
        return QuestionIdentity.validatedLabelMap(submittedMap(), bank: candidate.options, policy: candidate.orderPolicy) != nil
    }
}

enum QuestionTextMarks {
    static func marked(_ text: String) -> NSAttributedString {
        let result = NSMutableAttributedString(string: text, attributes: [
            .font: NSFont.systemFont(ofSize: 13),
            .foregroundColor: NSColor.labelColor,
        ])
        let pattern = #"[0-9]+(?:[.,][0-9]+)?|[⁻⁺⁰¹²³⁴⁵⁶⁷⁸⁹₊₋]|(?:不|没|非|not|no|none|≠|≤|≥|<|>)"#
        guard let expression = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { return result }
        let range = NSRange(text.startIndex..<text.endIndex, in: text)
        for match in expression.matches(in: text, range: range) {
            result.addAttribute(.backgroundColor, value: NSColor.systemYellow.withAlphaComponent(0.35), range: match.range)
        }
        return result
    }
}

@MainActor
enum QuestionSourcePanel {
    static func show(_ detail: QuestionDetail) {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 560, height: 420),
            styleMask: [.titled, .closable],
            backing: .buffered,
            defer: false)
        window.title = detail.bankTitle + " " + detail.bankVersion
        window.sharingType = ScreenShareGuard.windowSharingType
        let text = NSTextView(frame: NSRect(x: 12, y: 12, width: 536, height: 396))
        text.isEditable = false
        text.string = sourceText(detail)
        text.font = .systemFont(ofSize: 13)
        window.contentView?.addSubview(text)
        window.center()
        window.makeKeyAndOrderFront(nil)
    }

    static func sourceText(_ detail: QuestionDetail) -> String {
        var lines = [detail.stem, ""]
        for option in detail.options { lines.append(option.label + "  " + option.text) }
        lines.append("")
        lines.append(L10n.t("答案", "答え", "Answer") + "  " + detail.answerText)
        if let explanation = detail.explanation, !explanation.isEmpty {
            lines.append(L10n.t("解析", "解説", "Explanation") + "  " + explanation)
        } else {
            lines.append(L10n.t("此题库未提供解析", "この問題集に解説はありません", "This bank has no explanation"))
        }
        if let source = detail.source, !source.isEmpty { lines.append(L10n.t("来源", "出典", "Source") + "  " + source) }
        lines.append(detail.bankTitle + " " + detail.bankVersion)
        return lines.joined(separator: "\n")
    }
}
