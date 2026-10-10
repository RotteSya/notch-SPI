import AppKit
import UniformTypeIdentifiers

/// Settings page for a user's own question banks: import, search, and answer viewing.
@MainActor
final class QuestionBankPageController: NSViewController, SettingsPage {
    private let banks: QuestionBankServing
    private let searchField = NSSearchField()
    private let bankPopup = NSPopUpButton()
    private let enabledCheck = NSButton(checkboxWithTitle: "", target: nil, action: nil)
    private let automaticCheck = NSButton(checkboxWithTitle: "", target: nil, action: nil)
    private let removeButton = NSButton(title: "", target: nil, action: nil)
    private let table = NSTableView()
    private let detail = NSTextView()
    private let status = NSTextField(labelWithString: "")
    private let blockCheck = NSButton(checkboxWithTitle: "", target: nil, action: nil)
    private var summaries: [QuestionBankSummary] = []
    private var hits: [QuestionSearchHit] = []
    private var offset = 0
    private var total = 0
    private var selectedDetail: QuestionDetail?
    private var importing = false

    init(banks: QuestionBankServing? = nil) {
        self.banks = banks ?? QuestionBankRuntime.shared
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { nil }

    func pageDidShow() { Task { await reload() } }

    override func loadView() {
        let root = SettingsFlippedView(frame: NSRect(origin: .zero, size: MainSettingsWindowController.pageSize))
        view = root
        let title = pageTitleLabel(L10n.t("题库", "問題集", "Question Banks"))
        title.frame = NSRect(x: 24, y: 18, width: 400, height: 28)
        root.addSubview(title)
        let caption = captionLabel(L10n.t(
            "可离线搜索；截图匹配仅支持单张、讲解、简要模式。自动使用默认关闭，答案由题库提供。",
            "オフライン検索対応。画像照合は1枚・解説・簡潔モードのみ。自動使用は初期オフです。",
            "Search offline. Screenshot matching: one image, tutor, brief mode only. Automatic use starts off; answers come from the bank."))
        caption.frame = NSRect(x: 24, y: 48, width: 580, height: 32)
        root.addSubview(caption)

        let importButton = makeButton(L10n.t("导入", "読み込む", "Import"), #selector(importTapped), NSRect(x: 24, y: 86, width: 88, height: 28))
        let templateButton = makeButton(L10n.t("模板", "テンプレート", "Template"), #selector(templateTapped), NSRect(x: 120, y: 86, width: 100, height: 28))
        root.addSubview(importButton)
        root.addSubview(templateButton)
        searchField.frame = NSRect(x: 284, y: 88, width: 326, height: 26)
        searchField.placeholderString = L10n.t("搜索题干", "問題文を検索", "Search stems")
        searchField.target = self
        searchField.action = #selector(searchTapped)
        searchField.setAccessibilityLabel(searchField.placeholderString ?? "")
        root.addSubview(searchField)

        bankPopup.frame = NSRect(x: 24, y: 124, width: 250, height: 26)
        bankPopup.target = self
        bankPopup.action = #selector(bankChanged)
        bankPopup.setAccessibilityLabel(L10n.t("题库列表", "問題集一覧", "Bank list"))
        root.addSubview(bankPopup)
        enabledCheck.title = L10n.t("启用检索", "検索を有効", "Use in search")
        enabledCheck.frame = NSRect(x: 284, y: 154, width: 110, height: 22)
        enabledCheck.target = self
        enabledCheck.action = #selector(enabledTapped)
        root.addSubview(enabledCheck)
        automaticCheck.title = L10n.t("允许自动使用", "自動使用を許可", "Allow automatic use")
        automaticCheck.frame = NSRect(x: 400, y: 154, width: 140, height: 22)
        automaticCheck.target = self
        automaticCheck.action = #selector(automaticTapped)
        root.addSubview(automaticCheck)
        removeButton.title = L10n.t("移除", "削除", "Remove")
        removeButton.frame = NSRect(x: 548, y: 150, width: 72, height: 26)
        removeButton.bezelStyle = .rounded
        removeButton.target = self
        removeButton.action = #selector(removeTapped)
        removeButton.setAccessibilityLabel(removeButton.title)
        root.addSubview(removeButton)

        let scroll = NSScrollView(frame: NSRect(x: 24, y: 182, width: 590, height: 138))
        scroll.hasVerticalScroller = true
        scroll.drawsBackground = false
        let column = NSTableColumn(identifier: NSUserInterfaceItemIdentifier("stem"))
        column.title = L10n.t("题目", "問題", "Question")
        column.width = 560
        table.addTableColumn(column)
        table.headerView = nil
        table.rowHeight = 22
        table.delegate = self
        table.dataSource = self
        table.setAccessibilityLabel(L10n.t("搜索结果", "検索結果", "Search results"))
        scroll.documentView = table
        root.addSubview(scroll)

        let detailScroll = NSScrollView(frame: NSRect(x: 24, y: 330, width: 590, height: 140))
        detailScroll.hasVerticalScroller = true
        detail.isEditable = false
        detail.font = .systemFont(ofSize: 13)
        detail.string = ""
        detailScroll.documentView = detail
        root.addSubview(detailScroll)

        blockCheck.title = L10n.t("此题不再自动使用", "この問題を自動使用しない", "Do not use this question automatically")
        blockCheck.frame = NSRect(x: 24, y: 476, width: 280, height: 22)
        blockCheck.target = self
        blockCheck.action = #selector(blockTapped)
        root.addSubview(blockCheck)
        let copyButton = makeButton(L10n.t("复制答案", "答えをコピー", "Copy answer"), #selector(copyTapped), NSRect(x: 320, y: 474, width: 110, height: 26))
        let previous = makeButton(L10n.t("上一页", "前へ", "Previous"), #selector(previousPage), NSRect(x: 436, y: 474, width: 84, height: 26))
        let next = makeButton(L10n.t("下一页", "次へ", "Next"), #selector(nextPage), NSRect(x: 526, y: 474, width: 84, height: 26))
        root.addSubview(copyButton)
        root.addSubview(previous)
        root.addSubview(next)
        status.frame = NSRect(x: 24, y: 506, width: 590, height: 20)
        status.font = .systemFont(ofSize: 11)
        status.textColor = .secondaryLabelColor
        status.lineBreakMode = .byTruncatingTail
        root.addSubview(status)
    }

    func qaSearch(_ text: String) async {
        searchField.stringValue = text
        offset = 0
        await runSearch()
    }

    var qaHitCount: Int { hits.count }
    var qaDetailText: String { detail.string }

    func reload() async {
        await banks.prepare()
        if let error = banks.storageError {
            status.stringValue = L10n.t("题库数据库打不开，原有文件已保留。模型查题仍可使用。", "問題集データベースを開けません。ファイルは残しています。モデル検索は使えます。", "The question bank database cannot be opened. The file was kept. Model lookup still works.") + " (\(error))"
            summaries = []
            refillBanks()
            return
        }
        summaries = await banks.banks()
        refillBanks()
        await runSearch()
    }

    private func makeButton(_ title: String, _ action: Selector, _ frame: NSRect) -> NSButton {
        let button = NSButton(title: title, target: self, action: action)
        button.frame = frame
        button.bezelStyle = .rounded
        button.setAccessibilityLabel(title)
        return button
    }

    private func refillBanks() {
        let selected = currentBank()?.instanceID
        bankPopup.removeAllItems()
        bankPopup.addItem(withTitle: L10n.t("全部题库", "すべての問題集", "All banks"))
        bankPopup.lastItem?.representedObject = nil
        for bank in summaries {
            let author = bank.author.map { " · \($0)" } ?? ""
            bankPopup.addItem(withTitle: "\(bank.title) \(bank.version)\(author) · \(bank.questionCount)")
            bankPopup.lastItem?.representedObject = bank.instanceID
        }
        if let selected, let index = summaries.firstIndex(where: { $0.instanceID == selected }) {
            bankPopup.selectItem(at: index + 1)
        }
        reflectBank()
    }

    private func currentBank() -> QuestionBankSummary? {
        guard let id = bankPopup.selectedItem?.representedObject as? UUID else { return nil }
        return summaries.first { $0.instanceID == id }
    }

    private func reflectBank() {
        let bank = currentBank()
        enabledCheck.isEnabled = bank != nil
        automaticCheck.isEnabled = bank?.origin == .imported
        removeButton.isEnabled = bank != nil
        enabledCheck.state = bank?.enabled == true ? .on : .off
        automaticCheck.state = bank?.allowAutomatic == true ? .on : .off
    }

    @objc private func bankChanged() {
        offset = 0
        reflectBank()
        Task { await runSearch() }
    }

    @objc private func searchTapped() {
        offset = 0
        Task { await runSearch() }
    }

    @objc private func previousPage() {
        offset = max(0, offset - QuestionBankLimits.searchPageSize)
        Task { await runSearch() }
    }

    @objc private func nextPage() {
        guard offset + QuestionBankLimits.searchPageSize < total else { return }
        offset += QuestionBankLimits.searchPageSize
        Task { await runSearch() }
    }

    private func runSearch() async {
        let page = await banks.search(query: searchField.stringValue, offset: offset, instanceID: currentBank()?.instanceID)
        hits = page.hits
        total = page.total
        offset = page.offset
        table.reloadData()
        status.stringValue = L10n.t("\(hits.count) / \(total)", "\(hits.count) / \(total)", "\(hits.count) / \(total)")
        if hits.isEmpty { showDetail(nil) }
    }

    @objc private func enabledTapped() {
        guard let bank = currentBank() else { return }
        let enabled = enabledCheck.state == .on
        Task {
            await banks.setEnabled(bank.instanceID, enabled)
            await reload()
        }
    }

    @objc private func automaticTapped() {
        guard let bank = currentBank(), bank.origin == .imported else { return }
        Task { await banks.setAutomatic(bank.instanceID, automaticCheck.state == .on) }
    }

    @objc private func removeTapped() {
        guard let bank = currentBank() else { return }
        let alert = NSAlert()
        alert.messageText = L10n.t("移除「\(bank.title)」？", "「\(bank.title)」を削除しますか？", "Remove “\(bank.title)”?")
        alert.informativeText = L10n.t("只移除这个题库及其本地关联。", "この問題集とローカルの対応だけを削除します。", "This removes this bank and its local links.")
        alert.addButton(withTitle: L10n.t("移除", "削除", "Remove"))
        alert.addButton(withTitle: L10n.t("取消", "キャンセル", "Cancel"))
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        Task {
            await banks.remove(bank.instanceID)
            await reload()
        }
    }

    @objc private func blockTapped() {
        guard let detail = selectedDetail else { return }
        Task {
            await banks.block(instanceID: detail.instanceID, itemID: detail.itemID, blocked: blockCheck.state == .on)
        }
    }

    @objc private func copyTapped() {
        guard let detail = selectedDetail, !detail.answerText.isEmpty else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(detail.answerText, forType: .string)
        status.stringValue = L10n.t("已复制答案", "答えをコピーしました", "Answer copied")
    }

    @objc private func templateTapped() {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = "sample-bank.csv"
        panel.allowedContentTypes = [.commaSeparatedText]
        guard panel.runModal() == .OK, let url = panel.url else { return }
        try? QuestionBankTemplate.csv.data(using: .utf8)?.write(to: url)
    }

    @objc private func importTapped() {
        guard !importing else { return }
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.json, .commaSeparatedText]
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        guard panel.runModal() == .OK, let url = panel.url else { return }
        importing = true
        Task {
            let preview = await banks.stage(url)
            importing = false
            await showPreview(preview)
        }
    }

    private func showPreview(_ preview: ImportPreview) async {
        let sheet = QuestionBankImportSheet(preview: preview) { [banks] language, title, current in
            await banks.applying(language: language, title: title, to: current)
        }
        guard let host = view.window else { return }
        let choice = await sheet.run(on: host)
        guard let choice else { return }
        let result = await banks.commit(choice.preview, decision: choice.decision)
        await finishImport(result)
    }

    func qaFinishImport(_ result: ImportCommitResult) async {
        await finishImport(result)
    }

    var qaStatus: String { status.stringValue }

    private func finishImport(_ result: ImportCommitResult) async {
        await reload()
        status.stringValue = result.status + "  " + result.report.replacingOccurrences(of: "\n", with: " ")
        if result.failed > 0 || result.accepted == 0 {
            detail.string = result.report
            selectedDetail = nil
            blockCheck.isEnabled = false
        }
    }

    private func showDetail(_ detail: QuestionDetail?) {
        selectedDetail = detail
        guard let detail else {
            self.detail.string = ""
            blockCheck.isEnabled = false
            return
        }
        blockCheck.isEnabled = true
        blockCheck.state = detail.blockedAutomatic ? .on : .off
        self.detail.string = QuestionSourcePanel.sourceText(detail)
    }
}

extension QuestionBankPageController: NSTableViewDataSource, NSTableViewDelegate {
    func numberOfRows(in tableView: NSTableView) -> Int { hits.count }

    func tableView(_ tableView: NSTableView, viewFor tableColumn: NSTableColumn?, row: Int) -> NSView? {
        let hit = hits[row]
        let kind = hit.kind.rawValue
        let conflict = hit.conflict ? L10n.t(" · 答案冲突", " · 答えが不一致", " · Conflicting answers") : ""
        let field = NSTextField(labelWithString: "\(hit.stemExcerpt)  ·  \(hit.bankTitle) \(hit.bankVersion)  ·  \(kind)\(conflict)")
        field.lineBreakMode = .byTruncatingTail
        field.setAccessibilityLabel(field.stringValue)
        return field
    }

    func tableViewSelectionDidChange(_ notification: Notification) {
        let row = table.selectedRow
        guard hits.indices.contains(row) else { showDetail(nil); return }
        let hit = hits[row]
        Task {
            let detail = await banks.detail(instanceID: hit.instanceID, itemID: hit.itemID)
            showDetail(detail)
        }
    }
}

enum QuestionBankTemplate {
    static let csv = """
    id,type,language,stem,option_a,option_b,option_c,option_d,option_e,option_f,answer,unit,explanation,source
    q001,single_choice,zh,6 × 3 等于多少？,12,18,24,,,,B,,6 × 3 = 18。,自编示例
    q002,multiple_choice,zh,请选择所有偶数。,2,3,4,5,,,A;C,,2 和 4 都能被 2 整除。,自编示例
    q003,short_fill,zh,长方形长 5 cm、宽 3 cm，面积是多少？请以 cm² 为单位作答。,,,,,,,15,cm²,面积 = 长 × 宽 = 5 × 3 = 15 cm²。,自编示例
    """
}

struct ImportChoice {
    var preview: ImportPreview
    var decision: ImportDecision
}

@MainActor
final class QuestionBankImportSheet: NSWindowController {
    private var preview: ImportPreview
    private let titleField = NSTextField(string: "")
    private let languagePopup = NSPopUpButton()
    private let automatic = NSButton(checkboxWithTitle: "", target: nil, action: nil)
    private let targetPopup = NSPopUpButton()
    private let summary = NSTextField(wrappingLabelWithString: "")
    private let report = NSTextView()
    private var continuation: CheckedContinuation<ImportChoice?, Never>?
    private var selectionGeneration = 0
    private var committing = false
    private let refresh: (BankLanguage, String, ImportPreview) async -> ImportPreview

    init(preview: ImportPreview, refresh: @escaping (BankLanguage, String, ImportPreview) async -> ImportPreview) {
        self.preview = preview
        self.refresh = refresh
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 560, height: 460), styleMask: [.titled], backing: .buffered, defer: false)
        window.title = L10n.t("导入预览", "読み込みプレビュー", "Import preview")
        window.sharingType = ScreenShareGuard.windowSharingType
        super.init(window: window)
        build()
    }

    convenience init(preview: ImportPreview) {
        self.init(preview: preview) { _, _, current in current }
    }

    required init?(coder: NSCoder) { nil }

    func run(on host: NSWindow) async -> ImportChoice? {
        await withCheckedContinuation { continuation in
            self.continuation = continuation
            host.beginSheet(window!) { _ in }
        }
    }

    private func build() {
        guard let root = window?.contentView else { return }
        let flipped = SettingsFlippedView(frame: root.bounds)
        flipped.autoresizingMask = [.width, .height]
        root.addSubview(flipped)
        titleField.frame = NSRect(x: 16, y: 16, width: 360, height: 24)
        titleField.stringValue = preview.title
        flipped.addSubview(titleField)
        languagePopup.frame = NSRect(x: 384, y: 16, width: 160, height: 26)
        for language in BankLanguage.allCases { languagePopup.addItem(withTitle: language.rawValue) }
        if let language = preview.language ?? preview.draft.manifest?.language,
           let index = BankLanguage.allCases.firstIndex(of: language) {
            languagePopup.selectItem(at: index)
        }
        languagePopup.target = self
        languagePopup.action = #selector(restamp)
        flipped.addSubview(languagePopup)
        automatic.title = L10n.t("允许自动使用本题库答案", "この問題集の答えを自動使用する", "Allow automatic use of this bank's answers")
        automatic.frame = NSRect(x: 16, y: 48, width: 520, height: 22)
        automatic.state = preview.allowAutomatic ? .on : .off
        flipped.addSubview(automatic)
        let note = captionLabel(L10n.t("答案由该题库提供，应用未逐题验证。", "答えはこの問題集が提供します。アプリは一問ずつ検証していません。", "The bank supplies these answers. The app has not checked each one."))
        note.frame = NSRect(x: 16, y: 72, width: 520, height: 28)
        flipped.addSubview(note)
        targetPopup.frame = NSRect(x: 16, y: 104, width: 528, height: 26)
        targetPopup.addItem(withTitle: L10n.t("作为新题库导入", "新しい問題集として読み込む", "Import as a new bank"))
        for bank in preview.higherVersionTargets.compactMap({ id in preview.sameExternalInstances.first { $0.instanceID == id } }) {
            targetPopup.addItem(withTitle: L10n.t("更新 \(bank.title) \(bank.version)", "\(bank.title) \(bank.version) を更新", "Update \(bank.title) \(bank.version)"))
            targetPopup.lastItem?.representedObject = bank.instanceID
        }
        flipped.addSubview(targetPopup)
        summary.frame = NSRect(x: 16, y: 136, width: 528, height: 48)
        summary.stringValue = summaryText()
        flipped.addSubview(summary)
        let scroll = NSScrollView(frame: NSRect(x: 16, y: 188, width: 528, height: 210))
        scroll.hasVerticalScroller = true
        report.isEditable = false
        report.font = .systemFont(ofSize: 12)
        report.string = preview.draft.failures.map { "#\($0.index) \($0.itemID ?? "-") \($0.message)" }.joined(separator: "\n")
        scroll.documentView = report
        flipped.addSubview(scroll)
        let commit = NSButton(title: L10n.t("导入", "読み込む", "Import"), target: self, action: #selector(commitTapped))
        commit.frame = NSRect(x: 360, y: 412, width: 88, height: 28)
        commit.bezelStyle = .rounded
        commit.keyEquivalent = "\r"
        let cancel = NSButton(title: L10n.t("取消", "キャンセル", "Cancel"), target: self, action: #selector(cancelTapped))
        cancel.frame = NSRect(x: 456, y: 412, width: 88, height: 28)
        cancel.bezelStyle = .rounded
        cancel.keyEquivalent = "\u{1b}"
        flipped.addSubview(commit)
        flipped.addSubview(cancel)
    }

    func qaSelectLanguage(_ language: BankLanguage) {
        languagePopup.selectItem(withTitle: language.rawValue)
        restamp()
    }

    func qaCommit() async -> ImportChoice? {
        await withCheckedContinuation { continuation in
            self.continuation = continuation
            commitTapped()
        }
    }

    @objc private func restamp() {
        guard !committing, let language = selectedLanguage() else { return }
        selectionGeneration += 1
        let generation = selectionGeneration
        let title = titleField.stringValue
        Task {
            let updated = await refresh(language, title, preview)
            guard generation == selectionGeneration, !committing else { return }
            preview = updated
            summary.stringValue = summaryText()
        }
    }

    @objc private func commitTapped() {
        guard !committing, let language = selectedLanguage() else { return }
        committing = true
        selectionGeneration += 1
        let generation = selectionGeneration
        let title = titleField.stringValue
        let allowAutomatic = automatic.state == .on
        let decision = selectedDecision()
        Task {
            let updated = await refresh(language, title, preview)
            guard generation == selectionGeneration,
                  selectedLanguage() == language,
                  titleField.stringValue == title else {
                committing = false
                return
            }
            var committed = updated
            committed.allowAutomatic = allowAutomatic
            committed.title = title
            finish(ImportChoice(preview: committed, decision: decision))
        }
    }

    private func selectedLanguage() -> BankLanguage? {
        BankLanguage(rawValue: languagePopup.titleOfSelectedItem ?? "")
    }

    private func selectedDecision() -> ImportDecision {
        if let id = targetPopup.selectedItem?.representedObject as? UUID { return .update(id) }
        return .createNew
    }

    @objc private func cancelTapped() { finish(nil) }

    private func finish(_ choice: ImportChoice?) {
        window?.sheetParent?.endSheet(window!)
        continuation?.resume(returning: choice)
        continuation = nil
    }

    private func summaryText() -> String {
        let draft = preview.draft
        var parts = [
            L10n.t("有效 \(draft.questions.count)", "有効 \(draft.questions.count)", "Valid \(draft.questions.count)"),
            L10n.t("失败 \(draft.failures.count)", "失敗 \(draft.failures.count)", "Failed \(draft.failures.count)"),
            L10n.t("同题 \(preview.duplicateGroups)", "同一問題 \(preview.duplicateGroups)", "Same question \(preview.duplicateGroups)"),
            L10n.t("冲突 \(preview.conflictGroups)", "不一致 \(preview.conflictGroups)", "Conflicts \(preview.conflictGroups)"),
        ]
        if draft.needsLanguage { parts.append(L10n.t("请选择全库语言", "問題集の言語を選択", "Choose the bank language")) }
        if let error = draft.rootError { parts.append(error) }
        if !preview.sameVersionChanged.isEmpty {
            parts.append(L10n.t("同版本内容已变化，可取消或作为新题库导入", "同じ版で内容が変わっています。中止するか新しい問題集として読み込めます。", "This version's content changed. Cancel, or import it as a separate bank."))
        }
        return parts.joined(separator: " · ")
    }
}
