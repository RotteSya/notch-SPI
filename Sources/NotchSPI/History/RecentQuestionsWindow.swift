import AppKit

@MainActor
final class RecentQuestionsWindowController: NSWindowController, NSTableViewDataSource, NSTableViewDelegate, NSWindowDelegate {
    private let store: RecentQuestionStore
    private var records: [RecentQuestion] = []
    private let table = NSTableView()
    private let detail = HistoryDetailStack()
    private let detailScroll = NSScrollView()
    private let status = NSTextField(labelWithString: "")
    private let copyButton = NSButton()
    private let copyAllButton = NSButton()
    private let deleteButton = NSButton()
    private let clearButton = NSButton()
    private var observer: NSObjectProtocol?
    private var selectedID: UUID?
    private var displayed: RecentQuestion?
    private var reloadingSelection = false

    init(store: RecentQuestionStore) {
        self.store = store
        let window = RecentQuestionsWindow(contentRect: NSRect(x: 0, y: 0, width: 960, height: 680),
            styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = L10n.t("最近查题", "最近の問題", "Recent Questions")
        window.minSize = NSSize(width: 760, height: 500)
        window.isReleasedWhenClosed = false
        window.sharingType = ScreenShareGuard.windowSharingType
        super.init(window: window)
        window.delegate = self
        let root = NSView(frame: NSRect(x: 0, y: 0, width: 960, height: 680)); window.contentView = root
        let header = NSTextField(labelWithString: L10n.t("最近查题", "最近の問題", "Recent Questions"))
        header.font = .systemFont(ofSize: 24, weight: .semibold)
        let subtitle = NSTextField(labelWithString: L10n.t(
            "自动保存在本机 · 最近 30 天，最多 100 条 / 200 MB · 回看不扣题",
            "このMacに自動保存 · 過去30日、最大100件 / 200 MB · 閲覧は消費なし",
            "Saved on this Mac · Last 30 days, up to 100 entries / 200 MB · No charge to review"))
        subtitle.font = .systemFont(ofSize: 12); subtitle.textColor = .secondaryLabelColor
        subtitle.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        status.font = .systemFont(ofSize: 12); status.textColor = .secondaryLabelColor
        copyButton.title = L10n.t("复制答案", "回答をコピー", "Copy answer")
        copyButton.target = self; copyButton.action = #selector(copyAnswer)
        copyAllButton.title = L10n.t("复制全部", "全文をコピー", "Copy all")
        copyAllButton.target = self; copyAllButton.action = #selector(copyAllText)
        deleteButton.title = L10n.t("删除记录", "削除", "Delete")
        deleteButton.target = self; deleteButton.action = #selector(deleteSelected)
        clearButton.title = L10n.t("清空记录…", "すべて削除…", "Clear all…")
        clearButton.target = self; clearButton.action = #selector(clearAll)
        for button in [copyButton, copyAllButton, deleteButton, clearButton] { button.bezelStyle = .rounded }
        let toolbar = NSStackView(views: [copyButton, copyAllButton, deleteButton, clearButton]); toolbar.spacing = 10

        let column = NSTableColumn(identifier: .init("question")); column.width = 244
        table.addTableColumn(column); table.headerView = nil; table.rowHeight = 72
        table.delegate = self; table.dataSource = self; table.style = .sourceList
        table.allowsEmptySelection = false
        table.setAccessibilityLabel(L10n.t("最近查题列表", "最近の問題一覧", "Recent questions list"))
        let list = NSScrollView(); list.hasVerticalScroller = true; list.documentView = table
        list.borderType = .noBorder
        detail.orientation = .vertical; detail.alignment = .leading; detail.spacing = 18
        detail.edgeInsets = NSEdgeInsets(top: 24, left: 28, bottom: 28, right: 28)
        detail.translatesAutoresizingMaskIntoConstraints = false
        detailScroll.documentView = detail; detailScroll.hasVerticalScroller = true
        detailScroll.drawsBackground = true; detailScroll.backgroundColor = .textBackgroundColor
        detail.widthAnchor.constraint(equalTo: detailScroll.contentView.widthAnchor).isActive = true
        let divider = NSBox(); divider.boxType = .separator
        for view in [header, subtitle, list, divider, detailScroll, status, toolbar] {
            view.translatesAutoresizingMaskIntoConstraints = false; root.addSubview(view)
        }
        NSLayoutConstraint.activate([
            header.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: 24),
            header.topAnchor.constraint(equalTo: root.topAnchor, constant: 22),
            subtitle.leadingAnchor.constraint(equalTo: header.leadingAnchor),
            subtitle.topAnchor.constraint(equalTo: header.bottomAnchor, constant: 8),
            subtitle.trailingAnchor.constraint(lessThanOrEqualTo: root.trailingAnchor, constant: -20),
            list.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            list.topAnchor.constraint(equalTo: subtitle.bottomAnchor, constant: 22),
            list.widthAnchor.constraint(equalToConstant: 260),
            list.heightAnchor.constraint(greaterThanOrEqualToConstant: 300),
            list.bottomAnchor.constraint(equalTo: toolbar.topAnchor, constant: -16),
            divider.leadingAnchor.constraint(equalTo: list.trailingAnchor),
            divider.topAnchor.constraint(equalTo: list.topAnchor), divider.bottomAnchor.constraint(equalTo: list.bottomAnchor),
            divider.widthAnchor.constraint(equalToConstant: 1),
            detailScroll.leadingAnchor.constraint(equalTo: divider.trailingAnchor),
            detailScroll.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            detailScroll.topAnchor.constraint(equalTo: list.topAnchor), detailScroll.bottomAnchor.constraint(equalTo: list.bottomAnchor),
            toolbar.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -20),
            toolbar.heightAnchor.constraint(equalToConstant: 32),
            toolbar.bottomAnchor.constraint(equalTo: root.bottomAnchor, constant: -16),
            status.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: 20),
            status.centerYAnchor.constraint(equalTo: toolbar.centerYAnchor),
            status.trailingAnchor.constraint(lessThanOrEqualTo: toolbar.leadingAnchor, constant: -16)
        ])
        observer = NotificationCenter.default.addObserver(forName: RecentQuestionStore.changed, object: store, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self, self.window?.isVisible == true else { return }
                self.reload()
            }
        }
        window.setContentSize(NSSize(width: 960, height: 680))
        window.center(); reload()
    }
    private lazy var answerFieldEditor: AnswerReadingFieldEditor = {
        let editor = AnswerReadingFieldEditor(); editor.isFieldEditor = true; return editor
    }()
    func windowWillReturnFieldEditor(_ sender: NSWindow, to client: Any?) -> Any? {
        AnswerText.isReadingLabel(client) ? answerFieldEditor : nil
    }
    required init?(coder: NSCoder) { nil }
    deinit { if let observer { NotificationCenter.default.removeObserver(observer) } }

    func present() {
        reload(); window?.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true)
        window?.makeFirstResponder(table)
    }
    private func reload() {
        store.list { [weak self] records, failed in
            guard let self else { return }
            self.applyRecords(records, failed: failed)
        }
    }
    /// Apply one serialized store snapshot without transiently selecting another question.
    func applyRecords(_ records: [RecentQuestion], failed: Bool) {
        status.stringValue = failed
            ? L10n.t("部分记录未能读取或保存", "一部の記録を読み書きできません", "Some records could not be read or saved")
            : L10n.t("\(records.count) 条记录", "\(records.count) 件", "\(records.count) entries")
        guard self.records != records || detail.arrangedSubviews.isEmpty else { return }
        let clip = table.enclosingScrollView?.contentView
        let origin = clip?.bounds.origin ?? .zero
        let topRow = table.row(at: NSPoint(x: 0, y: origin.y))
        let anchor = self.records.indices.contains(topRow) ? self.records[topRow].id : nil
        let offset = topRow >= 0 ? origin.y - table.rect(ofRow: topRow).minY : 0
        self.records = records
        let row = selectedID.flatMap { id in records.firstIndex { $0.id == id } } ?? 0
        reloadingSelection = true
        table.reloadData()
        if !records.isEmpty { table.selectRowIndexes(IndexSet(integer: row), byExtendingSelection: false) }
        reloadingSelection = false
        if let anchor, let index = records.firstIndex(where: { $0.id == anchor }), let clip {
            clip.scroll(to: NSPoint(x: origin.x, y: table.rect(ofRow: index).minY + offset))
            table.enclosingScrollView?.reflectScrolledClipView(clip)
        }
        renderSelection()
    }
    func numberOfRows(in tableView: NSTableView) -> Int { records.count }
    func tableView(_ tableView: NSTableView, viewFor tableColumn: NSTableColumn?, row: Int) -> NSView? {
        let record = records[row]
        let cell = NSTableCellView()
        let thumbnail = NSImageView()
        thumbnail.image = ScreenshotThumbnail.load(store.imageURL(for: record, index: record.imageCount - 1), maxPixelSize: 160)
        thumbnail.imageScaling = .scaleProportionallyUpOrDown
        thumbnail.setAccessibilityLabel(L10n.t("题目缩略图", "問題のサムネイル", "Question thumbnail"))
        let title = AnswerText.label(record.reading.conclusion.replacingOccurrences(of: "\n", with: " "), size: 14, weight: .medium)
        // Table field cells can omit attachment-only strings. Use the same CoreText
        // renderer as the notch for mathematical previews; ordinary titles retain
        // native truncation and table selection behaviour.
        let preview: NSView
        if title.attributedStringValue.containsAttachments {
            let mathPreview = StreamingAnswerView()
            mathPreview.setAnswer(title.attributedStringValue, isPlaceholder: true)
            mathPreview.setAccessibilityLabel(L10n.t("答案", "回答", "Answer"))
            preview = mathPreview
        } else {
            title.lineBreakMode = .byTruncatingTail
            preview = title
            cell.textField = title
        }
        let date = DateFormatter.localizedString(from: record.createdAt, dateStyle: .short, timeStyle: .short)
        let info = NSTextField(labelWithString: date + (record.needsReview ? " · " + L10n.t("需核对", "要確認", "Review") : ""))
        info.font = .systemFont(ofSize: 11); info.textColor = .secondaryLabelColor
        info.lineBreakMode = .byTruncatingTail
        info.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        for view in [thumbnail, preview, info] { view.translatesAutoresizingMaskIntoConstraints = false; cell.addSubview(view) }
        NSLayoutConstraint.activate([
            thumbnail.leadingAnchor.constraint(equalTo: cell.leadingAnchor, constant: 8),
            thumbnail.centerYAnchor.constraint(equalTo: cell.centerYAnchor),
            thumbnail.widthAnchor.constraint(equalToConstant: 48), thumbnail.heightAnchor.constraint(equalToConstant: 48),
            preview.leadingAnchor.constraint(equalTo: thumbnail.trailingAnchor, constant: 10),
            preview.trailingAnchor.constraint(equalTo: cell.trailingAnchor, constant: -10),
            preview.topAnchor.constraint(equalTo: cell.topAnchor, constant: 6),
            preview.heightAnchor.constraint(equalToConstant: 36),
            info.leadingAnchor.constraint(equalTo: preview.leadingAnchor),
            info.trailingAnchor.constraint(equalTo: preview.trailingAnchor),
            info.topAnchor.constraint(equalTo: preview.bottomAnchor, constant: 3)
        ])
        return cell
    }
    func tableViewSelectionDidChange(_ notification: Notification) { if !reloadingSelection { renderSelection() } }

    private var selected: RecentQuestion? { records.indices.contains(table.selectedRow) ? records[table.selectedRow] : nil }
    private func renderSelection() {
        copyButton.isEnabled = selected != nil; deleteButton.isEnabled = selected != nil; clearButton.isEnabled = !records.isEmpty
        copyAllButton.isEnabled = selected != nil
        guard displayed != selected || detail.arrangedSubviews.isEmpty else { return }
        let position = displayed?.id == selected?.id ? detailScroll.contentView.bounds.origin : .zero
        displayed = selected; selectedID = selected?.id
        for view in detail.arrangedSubviews { detail.removeArrangedSubview(view); view.removeFromSuperview() }
        guard let record = selected else {
            addText(L10n.t("还没有查题记录", "まだ記録がありません", "No recent questions"), size: 22, weight: .semibold)
            addText(L10n.t("继续使用原来的快捷键查题，完成后会自动保存在这里。", "いつものショートカットで解答すると、ここに自動保存されます。", "Use your usual capture shortcut. Completed answers will appear here automatically."), size: 14)
            return
        }
        addText(L10n.t("答案", "回答", "Answer"), size: 12, color: .secondaryLabelColor)
        addText(record.reading.conclusion, size: 24, weight: .semibold)
        if record.needsReview { addText(AnswerReadingContent.reviewMessage, size: 13, color: .systemOrange) }
        if !record.detail.isEmpty {
            addText(L10n.t("解释", "解説", "Explanation"), size: 12, color: .secondaryLabelColor)
            addText(record.detail, size: 15)
        }
        addText(L10n.t("题目截图", "問題の画像", "Question images"), size: 12, color: .secondaryLabelColor)
        for index in 0..<record.imageCount {
            if record.imageCount > 1 { addText("\(index + 1) / \(record.imageCount)", size: 11, color: .secondaryLabelColor) }
            let view = HistoryImageView()
            view.image = ScreenshotThumbnail.load(store.imageURL(for: record, index: index), maxPixelSize: 2000)
            view.imageScaling = .scaleProportionallyUpOrDown
            view.setAccessibilityLabel(L10n.t("题图 \(index + 1)", "問題画像 \(index + 1)", "Question image \(index + 1)"))
            add(view)
            let size = view.image?.size ?? NSSize(width: 600, height: 400)
            view.heightAnchor.constraint(equalTo: view.widthAnchor, multiplier: min(3, max(0.1, size.height / max(1, size.width)))).isActive = true
        }
        detail.layoutSubtreeIfNeeded()
        detailScroll.contentView.scroll(to: position)
        detailScroll.reflectScrolledClipView(detailScroll.contentView)
    }
    private func add(_ view: NSView) {
        view.translatesAutoresizingMaskIntoConstraints = false; detail.addArrangedSubview(view)
        view.widthAnchor.constraint(equalTo: detail.widthAnchor, constant: -56).isActive = true
    }
    private func addText(_ text: String, size: CGFloat, weight: NSFont.Weight = .regular, color: NSColor = .labelColor) {
        let label = AnswerText.label(text, size: size, weight: weight, color: color)
        label.preferredMaxLayoutWidth = 580
        add(label)
    }
    @objc private func copyAnswer() {
        guard let record = selected else { return }
        NSPasteboard.general.clearContents(); NSPasteboard.general.setString(record.conclusion, forType: .string)
    }
    @objc private func copyAllText() {
        guard let record = selected else { return }
        NSPasteboard.general.clearContents(); NSPasteboard.general.setString(record.copyText, forType: .string)
    }
    @objc private func deleteSelected() { if let record = selected { store.delete(id: record.id) } }
    @objc private func clearAll() {
        guard let window else { return }
        let alert = NSAlert()
        alert.messageText = L10n.t("清空最近查题？", "すべての記録を削除しますか？", "Clear recent questions?")
        alert.informativeText = L10n.t("将删除本机保存的题图、答案和解释，无法撤销。", "このMacに保存した画像・回答・解説を削除します。元に戻せません。", "Saved images, answers and explanations on this Mac will be deleted. This cannot be undone.")
        alert.addButton(withTitle: L10n.t("取消", "キャンセル", "Cancel"))
        alert.addButton(withTitle: L10n.t("清空记录", "すべて削除", "Clear all"))
        alert.beginSheetModal(for: window) { [weak self] response in
            if response == .alertSecondButtonReturn { self?.store.delete(id: nil) }
        }
    }
}

private final class RecentQuestionsWindow: NSWindow {
    override func cancelOperation(_ sender: Any?) { close() }
}

/// The archived image's pixel dimensions must not become the window's minimum size.
private final class HistoryImageView: NSImageView {
    override var intrinsicContentSize: NSSize {
        NSSize(width: NSView.noIntrinsicMetric, height: NSView.noIntrinsicMetric)
    }
}

private final class HistoryDetailStack: NSStackView {
    override var isFlipped: Bool { true }
}
