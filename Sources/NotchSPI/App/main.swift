import AppKit
import Darwin

#if DEBUG
// Set the vault switch before any singleton or ProcessInfo snapshot is initialized.
let launchBundle = Bundle.main.bundleIdentifier
if launchBundle == "com.rottesya.notchspi.design-qa" {
    setenv("NSPI_QA_EPHEMERAL", "1", 1)
    setenv("NSPI_VISUAL_QA", "1", 1)
}
if launchBundle == DevelopmentIsolation.devBundleID {
    setenv("NSPI_QA_EPHEMERAL", "1", 1)
}
if let message = DevelopmentIsolation.refusal(
    bundleID: launchBundle,
    arguments: CommandLine.arguments
) {
    fputs(message + "\n", stderr)
    fflush(stderr)
    if getenv("TERM") == nil && isatty(STDERR_FILENO) == 0 {
        let prompt = NSApplication.shared
        prompt.setActivationPolicy(.accessory)
        let alert = NSAlert()
        alert.messageText = "启动开发包"
        alert.informativeText = message
        alert.addButton(withTitle: "退出")
        alert.runModal()
    }
    exit(1)
}
#endif

if CommandLine.arguments.contains("--print-objective-eval-prompt") {
    let prompt = Prompts.capturePrompt(
        mode: "tutor", depth: "brief", personaName: "", personaText: "", sessionContext: "",
        objectiveProtocolEnabled: true)
    print(prompt.system)
    exit(0)
}

if CommandLine.arguments.contains("--print-objective-eval-task") {
    let prompt = Prompts.capturePrompt(
        mode: "tutor", depth: "brief", personaName: "", personaText: "", sessionContext: "",
        objectiveProtocolEnabled: true)
    print(prompt.task)
    exit(0)
}

if CommandLine.arguments.contains("--print-legacy-eval-prompt") {
    let prompt = Prompts.capturePrompt(
        mode: "tutor", depth: "brief", personaName: "", personaText: "", sessionContext: "")
    print(prompt.system)
    exit(0)
}

if CommandLine.arguments.contains("--print-legacy-eval-task") {
    let prompt = Prompts.capturePrompt(
        mode: "tutor", depth: "brief", personaName: "", personaText: "", sessionContext: "")
    print(prompt.task)
    exit(0)
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
// Accessory: no Dock icon, lives at the notch like a menu-bar app.
app.setActivationPolicy(.accessory)
#if DEBUG
// Visual-QA hook: `--qa-regular` runs as a regular app so screenshot tooling that filters by the
// app allowlist (and only enumerates regular apps) can capture the notch panel. Never in Release.
if CommandLine.arguments.contains("--qa-regular") { app.setActivationPolicy(.regular) }
#endif
app.run()
