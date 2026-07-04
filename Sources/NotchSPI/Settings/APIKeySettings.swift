import AppKit

/// A top-left-origin container so rows lay out with y growing downward (same pattern as the
/// other settings views; the original is file-private in SettingsWindow.swift).
private final class APIKeyFlippedView: NSView {
    override var isFlipped: Bool { true }
}

/// Settings window for the custom API keys: one section per backend (Claude → Anthropic,
/// Codex → OpenAI), each with a secure key field and an optional model override. Every edit
/// commits live to `Settings`, and the per-backend status line makes the active channel obvious:
/// key filled → direct-API mode, key empty → CLI fallback. The CLI path itself is never touched
/// here — this only decides which channel the next capture uses.
final class APIKeySettingsViewController: NSViewController, NSTextFieldDelegate {
    var onChange: (() -> Void)?

    private struct Section {
        let cliId: String
        let keyField: NSSecureTextField
        let modelField: NSTextField
        let statusLabel: NSTextField
    }

    private var sections: [Section] = []

    private static let width: CGFloat = 460
    private static let height: CGFloat = 360

    override func loadView() {
        let root = APIKeyFlippedView(frame: NSRect(x: 0, y: 0, width: Self.width, height: Self.height))

        let title = Self.makeLabel("自定义 API Key", size: 15, weight: .semibold, color: .labelColor)
        title.frame = NSRect(x: 20, y: 18, width: 420, height: 20)
        root.addSubview(title)

        let hint = Self.makeLabel(
            "填写后，截图会直连官方 API（优先于本机 CLI）；留空则自动回退到 codex / claude CLI，原有用法完全不受影响。Key 仅保存在本机。",
            size: 11, weight: .regular, color: .secondaryLabelColor)
        hint.frame = NSRect(x: 20, y: 44, width: 420, height: 44)
        hint.maximumNumberOfLines = 3
        hint.lineBreakMode = .byWordWrapping
        root.addSubview(hint)

        var y: CGFloat = 100
        y = addSection(into: root, y: y, cliId: "claude",
                       header: "Claude · Anthropic API Key",
                       keyPlaceholder: "sk-ant-…")
        _ = addSection(into: root, y: y + 16, cliId: "codex",
                       header: "Codex · OpenAI API Key",
                       keyPlaceholder: "sk-…")

        view = root
        refreshStatusLabels()
    }

    /// Lay out one backend section; returns the y just below it.
    private func addSection(into root: NSView, y: CGFloat, cliId: String,
                            header: String, keyPlaceholder: String) -> CGFloat {
        var y = y
        let headerLabel = Self.makeLabel(header, size: 13, weight: .semibold, color: .labelColor)
        headerLabel.frame = NSRect(x: 20, y: y, width: 300, height: 18)
        root.addSubview(headerLabel)

        let statusLabel = Self.makeLabel("", size: 11, weight: .regular, color: .secondaryLabelColor)
        statusLabel.frame = NSRect(x: 250, y: y + 2, width: 190, height: 16)
        statusLabel.alignment = .right
        root.addSubview(statusLabel)
        y += 26

        let keyField = NSSecureTextField()
        keyField.frame = NSRect(x: 20, y: y, width: 420, height: 24)
        keyField.placeholderString = keyPlaceholder
        keyField.font = .monospacedSystemFont(ofSize: 12, weight: .regular)
        keyField.stringValue = Settings.shared.apiKey(for: cliId)
        keyField.delegate = self
        root.addSubview(keyField)
        y += 32

        let modelCaption = Self.makeLabel("模型（留空使用默认 \(Settings.defaultAPIModels[cliId] ?? "")）",
                                          size: 11, weight: .regular, color: .secondaryLabelColor)
        modelCaption.frame = NSRect(x: 20, y: y, width: 420, height: 16)
        root.addSubview(modelCaption)
        y += 20

        let modelField = NSTextField()
        modelField.frame = NSRect(x: 20, y: y, width: 240, height: 24)
        modelField.placeholderString = Settings.defaultAPIModels[cliId]
        modelField.font = .monospacedSystemFont(ofSize: 12, weight: .regular)
        let saved = Settings.shared.apiModel(for: cliId)
        modelField.stringValue = saved == Settings.defaultAPIModels[cliId] ? "" : saved
        modelField.delegate = self
        root.addSubview(modelField)
        y += 32

        sections.append(Section(cliId: cliId, keyField: keyField,
                                modelField: modelField, statusLabel: statusLabel))
        return y
    }

    // Live commit so the next capture uses the latest values (same pattern as the persona editor).
    func controlTextDidChange(_ obj: Notification) {
        guard let field = obj.object as? NSTextField else { return }
        for section in sections {
            if field === section.keyField {
                Settings.shared.setAPIKey(section.keyField.stringValue, for: section.cliId)
            } else if field === section.modelField {
                Settings.shared.setAPIModel(section.modelField.stringValue, for: section.cliId)
            } else {
                continue
            }
            refreshStatusLabels()
            onChange?()
            return
        }
    }

    private func refreshStatusLabels() {
        for section in sections {
            let usingKey = Settings.shared.usesCustomKey(for: section.cliId)
            section.statusLabel.stringValue = usingKey ? "当前：API Key 直连" : "当前：CLI 模式"
            section.statusLabel.textColor = usingKey ? .systemGreen : .secondaryLabelColor
        }
    }

    static var contentSize: NSSize { NSSize(width: width, height: height) }

    private static func makeLabel(_ text: String, size: CGFloat, weight: NSFont.Weight, color: NSColor) -> NSTextField {
        let f = NSTextField(labelWithString: text)
        f.font = .systemFont(ofSize: size, weight: weight)
        f.textColor = color
        return f
    }
}
