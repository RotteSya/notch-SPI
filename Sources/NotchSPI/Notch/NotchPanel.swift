import AppKit

/// A borderless, non-activating panel that sits at the notch and draws over the
/// menu bar. Non-activating + nonbecoming-key means it never steals focus.
final class NotchPanel: NSPanel {
    init(contentRect: NSRect) {
        super.init(
            contentRect: contentRect,
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        isFloatingPanel = true
        // Above the menu bar so the slab hangs from the notch.
        level = .statusBar
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
        // Exclude this panel from ALL screen capture — screenshots, screen recording, and
        // Zoom/Meet/Teams screen share, including "share entire screen". The notch answer
        // overlay must never enter a frame anyone else can see. This blocks software capture
        // only, NOT a camera pointed at the physical display.
        sharingType = ScreenShareGuard.windowSharingType
        isOpaque = false
        backgroundColor = .clear
        hasShadow = false
        isMovable = false
        isMovableByWindowBackground = false
        hidesOnDeactivate = false
        isReleasedWhenClosed = false
    }

    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

/// Single source of truth for excluding the app's own windows from screen capture.
enum ScreenShareGuard {
    /// `.none` in Release: every app window stays out of all software capture. A DEBUG-only
    /// escape hatch (`--visual-qa` arg or `NSPI_VISUAL_QA=1`) relaxes it to `.readOnly` so the
    /// notch can be screenshotted during local QA. Release builds always remain excluded.
    static var windowSharingType: NSWindow.SharingType {
        #if DEBUG
        let process = ProcessInfo.processInfo
        let visualQA = process.environment["NSPI_VISUAL_QA"] == "1"
            || process.arguments.contains("--visual-qa")
        return visualQA ? .readOnly : .none
        #else
        return .none
        #endif
    }
}
