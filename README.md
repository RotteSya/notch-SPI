# NotchSPI

A native macOS **notch-based AI study tutor**. Press a hotkey and a Dynamic‑Island‑style
panel drops from the MacBook notch, reads the problem on your screen, and **streams a
tutoring explanation** — powered by the AI CLIs you already have (**Codex** / **Claude
Code**), run **read‑only**. No API key.

> **Honest study tool.** It deliberately has **no** screen‑share evasion / anti‑proctoring —
> the panel is fully visible to screen recording. Use it on your own practice material.

## Features

- **Notch UI** (boring.notch‑style `NSPanel` at the notch): a collapsed indicator with an
  animated *Rose* loader sitting in the menu bar beside the notch; **hover to expand**; the
  panel **auto‑sizes to the answer**.
- **Capture → CLI → stream:** ScreenCaptureKit grabs the screen → drives `codex` or `claude`
  **read‑only** → streams the answer into the panel.
- **Depth modes:** 简略 (answer only) · 提示 · 引导 · 完整.
- **Global hotkeys (customizable):** `⌘⇧1` capture, `⌘⇧Space` show/hide.
- **Settings menu (⚙):** switch backend (Codex/Claude), depth, edit hotkeys, quit.

## Requirements

- macOS 14+ (built/tested on macOS 26, Apple Silicon).
- Swift 5.9+ / Xcode.
- At least one CLI installed **and logged in**:
  - **Codex** — the desktop app bundles a usable `codex` CLI (auto‑detected), or install the CLI.
  - **Claude Code** — `claude` on your `PATH`, logged in.

## Build & run

```sh
swift build -c release
.build/release/NotchSPI
```

(or `swift run`). On the first capture, macOS asks for **Screen Recording** permission —
grant it to *NotchSPI*, then relaunch.

## Notes

- The CLIs are spawned in an **isolated temp directory** (read‑only), so they don't crawl
  your current project.
- **Codex** streams its whole answer at the end (feels slower); **Claude** streams
  token‑by‑token.
- Screenshots are downscaled to ~1568px JPEG before being sent to the CLI.

## Layout

```
Sources/NotchSPI/
  main.swift / AppDelegate.swift     app bootstrap (accessory app)
  NotchPanel.swift / NotchController.swift / NotchView.swift / NotchShape.swift   notch UI
  RoseLoader.swift                   animated math-curve indicator (Canvas)
  ScreenCapture.swift                ScreenCaptureKit → temp JPEG
  CLIRunner.swift                    detect + run codex/claude, stream stdout
  Hotkeys.swift / SettingsWindow.swift / Settings.swift / Prompts.swift
```
