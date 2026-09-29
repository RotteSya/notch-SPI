# NotchSPI

A native macOS **notch-based AI study tutor** for Apple Silicon. A hotkey captures the
problem on screen and a Dynamic Island-style panel **streams a tutoring explanation**.
Walk onboarding, claim a **random welcome quota**, and start answering. UI in
**简体中文 / 日本語 / English**.

The notch panel and NotchSPI's own windows are excluded from **software** screen capture
(`NSWindow.sharingType = .none`). That does not hide the panel from a camera pointed at
the physical display.

## Requirements

- macOS 14+ (Apple Silicon)
- Swift 5.9+ / Xcode Command Line Tools, Node ≥ 22.18.0, and npm to build from source

## Get started

```sh
./scripts/bootstrap.sh
./scripts/dev.sh
```

Onboarding asks for **Screen Recording** permission.

Default shortcuts: **⌘⇧1** selects a screenshot and asks automatically; **⌘⇧2** collects
2–4 screenshots in order and submits 4 seconds after the latest successful capture;
**⌘⇧9** uses the same capture feedback for personality questions. One image keeps waiting.
Selection pauses the countdown; Esc restores the remaining time. Each successful screenshot
flies into the notch, with a reduced-motion alternative. See the [interaction notes](docs/screenshot-shortcut-flow.md).

Engineering handover: [HANDOVER.md](HANDOVER.md).
