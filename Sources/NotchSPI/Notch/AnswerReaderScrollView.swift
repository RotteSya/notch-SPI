import AppKit
import QuartzCore

/// Shared reading surface. Keeps native scrolling and selection, with the same
/// restrained rounded surface as the notch and colors that follow system appearance.
@MainActor
final class AnswerReaderScrollView: NSScrollView {
    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true
        layer?.cornerRadius = 18
        layer?.masksToBounds = true
        layer?.borderWidth = 0.5
        borderType = .noBorder
        hasVerticalScroller = true
        autohidesScrollers = true
        scrollerStyle = .overlay
        horizontalScrollElasticity = .none
        drawsBackground = true
        updateSurface()
    }
    required init?(coder: NSCoder) { nil }
    override func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance()
        updateSurface()
    }
    private func updateSurface() {
        effectiveAppearance.performAsCurrentDrawingAppearance {
            backgroundColor = .textBackgroundColor
            layer?.borderColor = NSColor.separatorColor.withAlphaComponent(0.35).cgColor
        }
    }
    func restoreReadingPosition(_ position: NSPoint) {
        documentView?.layoutSubtreeIfNeeded()
        let maximum = max(0, (documentView?.frame.height ?? 0) - contentView.bounds.height)
        contentView.scroll(to: NSPoint(x: 0, y: min(maximum, max(0, position.y))))
        reflectScrolledClipView(contentView)
    }
    func transitionToRecord() {
        guard !onboardingReduceMotion(), window?.isVisible == true else {
            documentView?.layer?.removeAnimation(forKey: "record-change")
            return
        }
        documentView?.wantsLayer = true
        let fade = CATransition()
        fade.type = .fade; fade.duration = 0.14
        fade.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
        documentView?.layer?.add(fade, forKey: "record-change")
    }
}
