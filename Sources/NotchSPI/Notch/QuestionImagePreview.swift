import AppKit

/// Both image surfaces use the same preview. The owner keeps the file alive only while open.
@MainActor
final class QuestionImagePreview: NSWindowController, NSWindowDelegate {
    private var asset: ContextAsset?
    var onClose: (() -> Void)?
    var onRemove: (() -> Void)?
    private var closed = false

    init(asset: ContextAsset, title: String, collecting: Bool = false) {
        self.asset = asset
        let screen = NSScreen.main?.visibleFrame.size ?? NSSize(width: 1000, height: 700)
        let image = ScreenshotThumbnail.load(asset.file.url, maxPixelSize: 2000)
        let imageSize = image?.size ?? NSSize(width: 600, height: 400)
        let scale = min(1, (screen.width - 120) / max(1, imageSize.width), (screen.height - 180) / max(1, imageSize.height))
        let size = NSSize(width: max(400, imageSize.width * scale), height: max(240, imageSize.height * scale))
        let window = QuestionPreviewWindow(contentRect: NSRect(origin: .zero, size: size), styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
        window.title = title
        window.isReleasedWhenClosed = false
        window.sharingType = ScreenShareGuard.windowSharingType
        super.init(window: window)
        window.delegate = self
        window.onDelete = { [weak self] in self?.onRemove?() }
        let root = NSView(frame: NSRect(origin: .zero, size: size))
        let view = NSImageView(frame: NSRect(x: 0, y: 34, width: size.width, height: size.height - 34))
        view.image = image; view.imageScaling = .scaleProportionallyUpOrDown
        view.autoresizingMask = [.width, .height]
        view.setAccessibilityLabel(title)
        root.addSubview(view)
        let hint = NSTextField(labelWithString: collecting
            ? L10n.t("预览期间暂停提交 · 关闭后重新倒计时 4 秒 · Esc 关闭", "プレビュー中は送信を停止 · 閉じると4秒後に送信 · Escで閉じる", "Sending paused during preview · closes with a fresh 4s timer · Esc to close")
            : L10n.t("Esc 关闭预览", "Esc で閉じる", "Esc to close preview"))
        hint.font = CaptureStyle.caption; hint.textColor = .secondaryLabelColor
        hint.frame = NSRect(x: 16, y: 10, width: size.width - 32, height: 18)
        hint.autoresizingMask = [.width]
        root.addSubview(hint)
        window.contentView = root
        window.center()
    }
    required init?(coder: NSCoder) { nil }
    func present() { window?.makeKeyAndOrderFront(nil) }
    func windowWillClose(_ notification: Notification) { finish() }
    override func close() { super.close(); finish() }
    private func finish() {
        guard !closed else { return }
        closed = true; asset = nil
        let callback = onClose; onClose = nil; callback?()
    }
}

private final class QuestionPreviewWindow: NSWindow {
    var onDelete: (() -> Void)?
    override func keyDown(with event: NSEvent) {
        if event.keyCode == 51 || event.keyCode == 117 { onDelete?() }
        else { super.keyDown(with: event) }
    }
    override func cancelOperation(_ sender: Any?) { close() }
}
