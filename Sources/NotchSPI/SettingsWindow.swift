import SwiftUI
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

final class SettingsViewModel: ObservableObject {
    @Published var capture: HotkeyCombo
    @Published var toggle: HotkeyCombo
    @Published var recording: String? // "capture" | "toggle" | nil
    var onChange: (() -> Void)?
    private var monitor: Any?

    init() {
        capture = Settings.shared.captureCombo
        toggle = Settings.shared.toggleCombo
        recording = nil
    }

    func record(_ which: String) {
        stop()
        recording = which
        monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard let self else { return event }
            let mods = carbonModifiers(from: event.modifierFlags)
            if mods == 0 { return nil } // need at least one modifier; swallow bare keys
            let combo = HotkeyCombo(keyCode: UInt32(event.keyCode), modifiers: mods, label: keyLabel(for: event))
            if which == "capture" {
                self.capture = combo
                Settings.shared.captureCombo = combo
            } else {
                self.toggle = combo
                Settings.shared.toggleCombo = combo
            }
            self.recording = nil
            self.stop()
            self.onChange?()
            return nil // consume
        }
    }

    func stop() {
        if let m = monitor { NSEvent.removeMonitor(m); monitor = nil }
    }
}

struct HotkeySettingsView: View {
    @ObservedObject var vm: SettingsViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("快捷键").font(.headline)
            row(title: "截屏讲题", which: "capture", combo: vm.capture)
            row(title: "显示 / 隐藏", which: "toggle", combo: vm.toggle)
            Text("点击右侧按钮，然后按下新的组合键（需包含 ⌘/⇧/⌥/⌃ 至少一个）。")
                .font(.system(size: 11))
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer()
        }
        .padding(20)
        .frame(width: 380, height: 200, alignment: .topLeading)
    }

    private func row(title: String, which: String, combo: HotkeyCombo) -> some View {
        HStack {
            Text(title)
            Spacer()
            Button {
                vm.record(which)
            } label: {
                Text(vm.recording == which ? "按下快捷键…" : Settings.displayString(combo))
                    .font(.system(size: 13, weight: .medium, design: .monospaced))
                    .frame(minWidth: 96)
                    .padding(.vertical, 5)
                    .padding(.horizontal, 10)
                    .background(
                        (vm.recording == which ? Color.accentColor.opacity(0.3) : Color.gray.opacity(0.18)),
                        in: RoundedRectangle(cornerRadius: 7)
                    )
            }
            .buttonStyle(.plain)
        }
    }
}

// MARK: - Personality-test persona editor

final class PersonaViewModel: ObservableObject {
    @Published var name: String
    @Published var text: String
    var onChange: (() -> Void)?

    init() {
        name = Settings.shared.personaName
        text = Settings.shared.personaText
    }

    /// Persist immediately so the next ⌘⇧1 uses the latest persona.
    func commit() {
        Settings.shared.personaName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        Settings.shared.personaText = text
        onChange?()
    }
}

struct PersonaSettingsView: View {
    @ObservedObject var vm: PersonaViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("性格测试 · 人物像").font(.headline)

            Text("给这次的人物像起个名字")
                .font(.system(size: 11)).foregroundStyle(.secondary)
            TextField("例如：A社 求める人物像", text: $vm.name)
                .textFieldStyle(.roundedBorder)
                .onChange(of: vm.name) { vm.commit() }

            Text("人物像描述（截图作答时答案会尽量贴合）")
                .font(.system(size: 11)).foregroundStyle(.secondary)
            TextEditor(text: $vm.text)
                .font(.system(size: 12.5))
                .frame(minHeight: 150)
                .padding(6)
                .background(Color.gray.opacity(0.12), in: RoundedRectangle(cornerRadius: 8))
                .onChange(of: vm.text) { vm.commit() }

            Text("例：●創意と挑戦心を持ち、主体的に行動できる方 ●変化を常とし、外的変化へ柔軟に適応できる方 ●チームワークを重要視し、協調性を発揮できる方")
                .font(.system(size: 10.5)).foregroundStyle(.tertiary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer()
        }
        .padding(20)
        .frame(width: 440, height: 360, alignment: .topLeading)
    }
}
