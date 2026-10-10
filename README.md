# NotchSPI

A native macOS **notch-based AI study tutor** for Apple Silicon. A hotkey captures the
problem on screen and a Dynamic Island-style panel **streams a tutoring explanation**.
Complete onboarding and start answering with your account's available quota. UI in
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
./scripts/run-local.sh
```

This builds the current macOS app and opens it with your saved service and account.
Fresh installs use the official service. Quit any running NotchSPI or QA copy first.

For isolated UI development, use `./scripts/onboarding-qa.sh --mock` (onboarding)
or `./scripts/dev.sh` (general development). Both use a local mock with fixed answers
and temporary credentials; they cannot answer arbitrary questions. Normal builds
use the configured provider throughout onboarding and daily use.

Onboarding asks for **Screen Recording** permission.

Default shortcuts: **⌘⇧1** captures the configured target and asks automatically;
**⌘⇧2** collects 2–4 screenshots in order and submits 4 seconds after the latest
successful capture; **⌘⇧9** captures the configured target for personality questions.
One image keeps waiting. Opening a preview pauses submission; closing it starts a fresh
4-second countdown. Each image has a separate remove button and an 8-second undo;
“Ask now” submits the current 2–4 images in order. Each successful screenshot flies into the notch, with a
reduced-motion alternative. See the [capture notes](docs/direct-target-capture.md).

## Question banks

Settings → Question Banks imports a `.nspibank.json`, `.json`, or the fixed CSV template. Search and answers stay on this Mac. An ordinary single screenshot in tutor / brief mode checks the local bank first. A previously checked image can show its bank answer when that bank allows automatic use. Any other capture continues through the selected model service. A local answer does not create an official request; a successful official answer still uses one question of quota.

The three sample questions under `Tests/Fixtures/QuestionBank/` are format examples. Import steps, the file rules, and the current checks are in [docs/local-question-bank.md](docs/local-question-bank.md).

Engineering handover: [HANDOVER.md](HANDOVER.md).
