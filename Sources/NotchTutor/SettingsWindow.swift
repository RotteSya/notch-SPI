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
