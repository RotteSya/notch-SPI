# NotchSPI

A native macOS **notch-based AI study tutor**. Press a hotkey and a Dynamic‑Island‑style
panel drops from the MacBook notch, reads the problem on your screen, and **streams a
tutoring explanation** — powered by the AI CLIs you already have (**Codex** / **Claude
Code**), run **read‑only**. No API key required — or bring your own key to go direct.

> **Capture exclusion.** The notch panel and NotchSPI's own windows are excluded from all
> **software** screen capture — screenshots, screen recording, and Zoom/Meet/Teams screen share
> (including "share entire screen") — via `NSWindow.sharingType = .none`. This blocks software
> capture only; it does **not** hide the panel from a camera pointed at the physical display.

## Features

- **Notch UI** (boring.notch‑style `NSPanel` at the notch): a collapsed indicator with an
  animated *Rose* loader sitting in the menu bar beside the notch; **hover to expand**; the
  panel **auto‑sizes to the answer**.
- **Capture → CLI → stream:** ScreenCaptureKit grabs the screen → drives `codex` or `claude`
  **read‑only** → streams the answer into the panel.
- **Official pay‑as‑you‑go service (default for new installs):** zero-setup onboarding — first
  launch registers an anonymous device and grants trial credits; captures are proxied and metered
  server‑side (contract in `docs/official-api.md`). An in‑app 账户与额度 panel shows balance,
  lifetime token usage, and a top‑up link. Existing installs keep their previous mode; all three
  modes (官方服务 / 自定义 Key / CLI) coexist and switch freely in the ⚙ menu.
- **Custom API key (optional):** in ⚙ →「自定义 API Key…」paste your own Anthropic / OpenAI key to
  send captures **straight to the official API** instead of the local CLI. When a key is set for the
  selected backend it takes priority; when it's empty the app **falls back to the CLI** exactly as
  before, so both channels coexist. Keys live only in local `UserDefaults`; an optional model field
  overrides the default. The header shows `Claude · API` while a key is active.
- **Depth modes:** 简略 (answer only) · 提示 · 引导 · 完整.
- **Global hotkeys (customizable):** `⌘⇧1` 讲题 (tutor), `⌘⇧2` 性格作答 (personality test), `⌘⇧Space` show/hide.
- **Settings menu (⚙):** switch backend (Codex/Claude), set custom API keys, depth, edit hotkeys, check for updates (检查更新), quit.
- **Check for updates (检查更新):** compares the running version against the latest GitHub release;
  also checks quietly on launch (≤ once/day) and points you to the download page when one is newer.

## Requirements

- macOS 14+ (built/tested on macOS 26, Apple Silicon).
- Swift 5.9+ / Xcode.
- One of:
  - At least one CLI installed **and logged in**:
    - **Codex** — the desktop app bundles a usable `codex` CLI (auto‑detected), or install the CLI.
    - **Claude Code** — `claude` on your `PATH`, logged in.
  - **or** a custom API key for the selected backend (⚙ →「自定义 API Key…」) — no CLI needed.

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
  APIKeyRunner.swift                 custom-key path: stream straight from Anthropic/OpenAI API
  Cloud/                             official pay-as-you-go service: routing + billing gate,
                                     API client, onboarding, 账户与额度 panel (docs/official-api.md)
  Hotkeys.swift / SettingsWindow.swift / APIKeySettings.swift / Settings.swift / Prompts.swift
```
