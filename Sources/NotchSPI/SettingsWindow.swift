import AppKit
import Carbon.HIToolbox

func carbonModifiers(from flags: NSEvent.ModifierFlags) -> UInt32 {
    var m: UInt32 = 0
    if flags.contains(.command) { m |= UInt32(cmdKey) }
    if flags.contains(.shift) { m |= UInt32(shiftKey) }
    if flags.contains(.option) { m |= UInt32(optionKey) }
    if flags.contains(.control) { m |= UInt32(controlKey) }
    return m
}

func keyLabel(for event: NSEvent) -> String {
    let special: [UInt16: String] = [
        49: "Space", 36: "↩", 48: "⇥", 53: "⎋", 51: "⌫",
        123: "←", 124: "→", 125: "↓", 126: "↑",
        122: "F1", 120: "F2", 99: "F3", 118: "F4", 96: "F5", 97: "F6",
    ]
    if let s = special[event.keyCode] { return s }
    if let ch = event.charactersIgnoringModifiers, let first = ch.first,
       first.isLetter || first.isNumber || first.isPunctuation || first.isSymbol {
        return ch.uppercased()
    }
    return "Key\(event.keyCode)"
}

/// A top-left-origin container so settings rows lay out with y growing downward.
private final class FlippedView: NSView {
    override var isFlipped: Bool { true }
}

// MARK: - Hotkey settings

/// AppKit replacement for the SwiftUI `HotkeySettingsView`: two recordable hotkey rows. Clicking a
/// row's button arms a local key monitor that captures the next modifier+key combo and persists it.
final class HotkeySettingsViewController: NSViewController {
    var onChange: (() -> Void)?

    private var capture = Settings.shared.captureCombo
    private var personality = Settings.shared.personalityCombo
    private var toggle = Settings.shared.toggleCombo
    private var recording: String?          // "capture" | "personality" | "toggle" | nil
    private var monitor: Any?

    private let captureButton = HotkeySettingsViewController.makeRecordButton()
    private let personalityButton = HotkeySettingsViewController.makeRecordButton()
    private let toggleButton = HotkeySettingsViewController.makeRecordButton()

    override func loadView() {
        let root = FlippedView(frame: NSRect(x: 0, y: 0, width: 380, height: 232))

        let title = Self.makeLabel("快捷键", size: 15, weight: .semibold, color: .labelColor)
        title.frame = NSRect(x: 20, y: 18, width: 340, height: 20)
        root.addSubview(title)

        addRow(into: root, y: 52, title: "截屏讲题（学习辅导）", button: captureButton, action: #selector(recordCapture))
        addRow(into: root, y: 90, title: "截屏作答（性格测试）", button: personalityButton, action: #selector(recordPersonality))
        addRow(into: root, y: 128, title: "显示 / 隐藏", button: toggleButton, action: #selector(recordToggle))

        let hint = Self.makeLabel(
            "点击右侧按钮，然后按下新的组合键（需包含 ⌘/⇧/⌥/⌃ 至少一个）。",
            size: 11, weight: .regular, color: .secondaryLabelColor)
        hint.frame = NSRect(x: 20, y: 172, width: 340, height: 40)
        hint.maximumNumberOfLines = 2
        hint.lineBreakMode = .byWordWrapping
        root.addSubview(hint)

        view = root
        updateButtons()
    }

    private func addRow(into root: NSView, y: CGFloat, title: String, button: NSButton, action: Selector) {
        let label = Self.makeLabel(title, size: 13, weight: .regular, color: .labelColor)
        label.frame = NSRect(x: 20, y: y + 4, width: 160, height: 18)
        root.addSubview(label)

        button.target = self
        button.action = action
        button.frame = NSRect(x: 380 - 20 - 150, y: y, width: 150, height: 28)
        root.addSubview(button)
    }

    @objc private func recordCapture() { record("capture") }
    @objc private func recordPersonality() { record("personality") }
    @objc private func recordToggle() { record("toggle") }

    private func record(_ which: String) {
        stop()
        recording = which
        updateButtons()
        monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard let self else { return event }
            let mods = carbonModifiers(from: event.modifierFlags)
            if mods == 0 { return nil } // need at least one modifier; swallow bare keys
            let combo = HotkeyCombo(keyCode: UInt32(event.keyCode), modifiers: mods, label: keyLabel(for: event))
            switch which {
            case "capture":
                self.capture = combo
                Settings.shared.captureCombo = combo
            case "personality":
                self.personality = combo
                Settings.shared.personalityCombo = combo
            default:
                self.toggle = combo
                Settings.shared.toggleCombo = combo
            }
            self.recording = nil
            self.stop()
            self.updateButtons()
            self.onChange?()
            return nil // consume
        }
    }

    private func stop() {
        if let m = monitor { NSEvent.removeMonitor(m); monitor = nil }
    }

    private func updateButtons() {
        captureButton.title = recording == "capture" ? "按下快捷键…" : Settings.displayString(capture)
        personalityButton.title = recording == "personality" ? "按下快捷键…" : Settings.displayString(personality)
        toggleButton.title = recording == "toggle" ? "按下快捷键…" : Settings.displayString(toggle)
    }

    deinit { stop() }

    private static func makeRecordButton() -> NSButton {
        let b = NSButton(title: "", target: nil, action: nil)
        b.bezelStyle = .rounded
        b.font = .monospacedSystemFont(ofSize: 13, weight: .medium)
        return b
    }

    private static func makeLabel(_ text: String, size: CGFloat, weight: NSFont.Weight, color: NSColor) -> NSTextField {
        let f = NSTextField(labelWithString: text)
        f.font = .systemFont(ofSize: size, weight: weight)
        f.textColor = color
        return f
    }
}

// MARK: - Personality-test persona editor

/// AppKit replacement for the SwiftUI `PersonaSettingsView`: a name field + a multi-line
/// description editor, both committing to `Settings` live so the next ⌘⇧1 uses the latest persona.
final class PersonaSettingsViewController: NSViewController, NSTextFieldDelegate, NSTextViewDelegate {
    var onChange: (() -> Void)?

    private let nameField = NSTextField()
    private let descTextView = NSTextView()
    private let descScroll = NSScrollView()

    override func loadView() {
        let root = FlippedView(frame: NSRect(x: 0, y: 0, width: 440, height: 360))

        let title = Self.makeLabel("性格测试 · 人物像", size: 15, weight: .semibold, color: .labelColor)
        title.frame = NSRect(x: 20, y: 18, width: 400, height: 20)
        root.addSubview(title)

        let nameCaption = Self.makeLabel("给这次的人物像起个名字", size: 11, weight: .regular, color: .secondaryLabelColor)
        nameCaption.frame = NSRect(x: 20, y: 48, width: 400, height: 16)
        root.addSubview(nameCaption)

        nameField.frame = NSRect(x: 20, y: 68, width: 400, height: 24)
        nameField.placeholderString = "例如：A社 求める人物像"
        nameField.font = .systemFont(ofSize: 13)
        nameField.stringValue = Settings.shared.personaName
        nameField.delegate = self
        root.addSubview(nameField)

        let descCaption = Self.makeLabel("人物像描述（截图作答时答案会尽量贴合）", size: 11, weight: .regular, color: .secondaryLabelColor)
        descCaption.frame = NSRect(x: 20, y: 104, width: 400, height: 16)
        root.addSubview(descCaption)

        configureDescEditor()
        descScroll.frame = NSRect(x: 20, y: 126, width: 400, height: 160)
        root.addSubview(descScroll)

        let example = Self.makeLabel(
            "例：●創意と挑戦心を持ち、主体的に行動できる方 ●変化を常とし、外的変化へ柔軟に適応できる方 ●チームワークを重要視し、協調性を発揮できる方",
            size: 10.5, weight: .regular, color: .tertiaryLabelColor)
        example.frame = NSRect(x: 20, y: 296, width: 400, height: 52)
        example.maximumNumberOfLines = 3
        example.lineBreakMode = .byWordWrapping
        root.addSubview(example)

        view = root
    }

    private func configureDescEditor() {
        descScroll.borderType = .bezelBorder
        descScroll.hasVerticalScroller = true
        descScroll.drawsBackground = true

        descTextView.string = Settings.shared.personaText
        descTextView.font = .systemFont(ofSize: 12.5)
        descTextView.isEditable = true
        descTextView.isSelectable = true
        descTextView.isRichText = false
        descTextView.textContainerInset = NSSize(width: 6, height: 6)
        descTextView.isVerticallyResizable = true
        descTextView.isHorizontallyResizable = false
        descTextView.textContainer?.widthTracksTextView = true
        descTextView.minSize = .zero
        descTextView.maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
        descTextView.autoresizingMask = [.width]
        descTextView.delegate = self
        descScroll.documentView = descTextView
    }

    /// Persist immediately so the next ⌘⇧1 uses the latest persona.
    private func commit() {
        Settings.shared.personaName = nameField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        Settings.shared.personaText = descTextView.string
        onChange?()
    }

    func controlTextDidChange(_ obj: Notification) { commit() }
    func textDidChange(_ notification: Notification) { commit() }

    private static func makeLabel(_ text: String, size: CGFloat, weight: NSFont.Weight, color: NSColor) -> NSTextField {
        let f = NSTextField(labelWithString: text)
        f.font = .systemFont(ofSize: size, weight: weight)
        f.textColor = color
        return f
    }
}
