import AppKit
import QuartzCore

/// Stable reserved slots connect the flight to the card. Timer ticks only update the labels
/// and progress; images are decoded once, and preview is deliberately independent of the timer.
@MainActor
final class ScreenshotTray: NSView {
    var onCancel: (() -> Void)?
    private let status = NSTextField(labelWithString: "")
    private let detail = NSTextField(wrappingLabelWithString: "")
    private let progress = NSView()
    private lazy var cancel = NotchActionButton(title: L10n.t("取消本轮", "今回を取消", "Cancel round")) { [weak self] in self?.onCancel?() }
    private var ids: [UUID] = []
    private var assets: [ContextAsset] = []
    private var cards: [UUID: NotchActionButton] = [:]
    private var thumbnails: [UUID: NSImageView] = [:]
    private var fraction: CGFloat = 0
    private var preview: NSWindowController?
    private var collecting = false
    override var isFlipped: Bool { true }

    override init(frame: NSRect) {
        super.init(frame: frame)
        status.font = CaptureStyle.status
        status.textColor = NotchPalette.primary
        detail.font = CaptureStyle.caption
        detail.textColor = NotchPalette.secondary
        detail.maximumNumberOfLines = 2
        addSubview(status); addSubview(detail); addSubview(cancel)
        progress.wantsLayer = true
        progress.layer?.backgroundColor = NotchPalette.accent.cgColor
        progress.layer?.cornerRadius = 1
        addSubview(progress)
    }
    required init?(coder: NSCoder) { nil }

    func update(assets: [ContextAsset], images: [UUID: NSImage], flying: Set<UUID>,
                message: String, remaining: TimeInterval?, cancellable: Bool,
                capturing: Bool = false, notice: String = "") {
        let next = assets.map(\.id)
        if ids != next || capturing || (collecting && !cancellable) { preview?.close(); preview = nil }
        collecting = cancellable
        self.assets = assets
        for id in ids where !next.contains(id) { cards.removeValue(forKey: id)?.removeFromSuperview(); thumbnails.removeValue(forKey: id) }
        ids = next
        for (index, asset) in assets.enumerated() {
            if cards[asset.id] == nil {
                let id = asset.id // The closure must not retain the asset's temporary file.
                let card = NotchActionButton(title: "") { [weak self] in self?.showPreview(id) }
                card.layer?.backgroundColor = NSColor(calibratedWhite: 0.14, alpha: 1).cgColor
                card.layer?.borderWidth = 0.7
                card.layer?.borderColor = NSColor.white.withAlphaComponent(0.22).cgColor
                card.shadow = NSShadow()
                card.shadow?.shadowColor = NSColor.black.withAlphaComponent(0.3)
                card.shadow?.shadowBlurRadius = 9
                card.shadow?.shadowOffset = NSSize(width: 0, height: -3)
                let image = NSImageView(frame: NSRect(x: 4, y: 4, width: 96, height: 60))
                image.imageScaling = .scaleProportionallyUpOrDown
                image.autoresizingMask = [.width, .height]
                card.addSubview(image)
                thumbnails[id] = image
                let ordinal = NSTextField(labelWithString: "\(index + 1)")
                ordinal.font = .monospacedDigitSystemFont(ofSize: 10, weight: .bold)
                ordinal.textColor = .white
                ordinal.drawsBackground = true
                ordinal.backgroundColor = NSColor.black.withAlphaComponent(0.72)
                ordinal.alignment = .center
                ordinal.frame = NSRect(x: 5, y: 5, width: 19, height: 15)
                card.addSubview(ordinal)
                card.setAccessibilityLabel(L10n.t("预览截图 \(index + 1)", "画像 \(index + 1) をプレビュー", "Preview screenshot \(index + 1)"))
                card.toolTip = card.accessibilityLabel()
                cards[id] = card
                addSubview(card)
            }
            let card = cards[asset.id]!
            thumbnails[asset.id]?.image = images[asset.id]
            let wasHidden = card.alphaValue < 1
            card.alphaValue = flying.contains(asset.id) ? 0 : 1
            if wasHidden, card.alphaValue == 1, !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion {
                let settle = CASpringAnimation(keyPath: "transform.scale")
                settle.fromValue = 0.97; settle.toValue = 1
                settle.mass = 1; settle.stiffness = 260; settle.damping = 26
                settle.duration = 0.35
                card.layer?.add(settle, forKey: "landing")
            }
        }
        if status.stringValue != message { status.stringValue = message }
        status.toolTip = message
        let hint: String
        if !notice.isEmpty { hint = notice }
        else if capturing { hint = L10n.t("正在读取目标画面 · 可取消本轮", "対象をキャプチャ中 · 今回全体を取消できます", "Reading the target · you can cancel this round") }
        else if cancellable && assets.count == 1 { hint = L10n.t("1 张不会自动提交 · 点击缩略图可预览", "1枚では自動送信しません · クリックでプレビュー", "One image waits indefinitely · click a thumbnail to preview") }
        else if cancellable { hint = L10n.t("捕获期间暂停计时 · 新图录入后重新计时 4 秒", "追加のキャプチャ中は一時停止 · 画像追加後に4秒から再開", "Capture pauses the timer · each new image restarts 4 seconds") }
        else { hint = L10n.t("点击缩略图查看本次截图", "クリックで今回の画像を確認", "Click a thumbnail to inspect this question's images") }
        if detail.stringValue != hint { detail.stringValue = hint }
        detail.toolTip = hint
        detail.textColor = notice.isEmpty ? NotchPalette.secondary : .systemOrange
        cancel.isHidden = !cancellable
        fraction = CGFloat(max(0, min(1, (remaining ?? 0) / 4)))
        progress.alphaValue = capturing ? 0.35 : 1
        needsLayout = true
    }

    private func showPreview(_ id: UUID) {
        guard let index = ids.firstIndex(of: id), let asset = assets.first(where: { $0.id == id }),
              let image = ScreenshotThumbnail.load(asset.file.url, maxPixelSize: 1400) else { return }
        preview?.close()
        let screen = NSScreen.main?.visibleFrame.size ?? NSSize(width: 1000, height: 700)
        let scale = min(1, (screen.width - 120) / max(1, image.size.width), (screen.height - 180) / max(1, image.size.height))
        let size = NSSize(width: max(400, image.size.width * scale), height: max(240, image.size.height * scale))
        let window = ScreenshotPreviewWindow(contentRect: NSRect(origin: .zero, size: size), styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
        window.title = L10n.t("截图 \(index + 1) / \(ids.count) · 预览", "画像 \(index + 1) / \(ids.count)", "Screenshot \(index + 1) / \(ids.count) · Preview")
        window.titlebarAppearsTransparent = true
        window.isReleasedWhenClosed = false
        window.sharingType = ScreenShareGuard.windowSharingType
        let view = NSImageView(frame: NSRect(origin: .zero, size: size))
        view.image = image; view.imageScaling = .scaleProportionallyUpOrDown
        view.autoresizingMask = [.width, .height]
        let root = NSView(frame: NSRect(origin: .zero, size: size))
        view.frame = NSRect(x: 0, y: 34, width: size.width, height: size.height - 34)
        root.addSubview(view)
        let hint = NSTextField(labelWithString: collecting
            ? L10n.t("预览不暂停倒计时 · Esc 关闭", "プレビュー中も送信タイマーは継続 · Esc で閉じる", "Preview keeps the timer running · Esc to close")
            : L10n.t("Esc 关闭预览", "Esc で閉じる", "Esc to close preview"))
        hint.font = CaptureStyle.caption; hint.textColor = .secondaryLabelColor
        hint.frame = NSRect(x: 16, y: 10, width: size.width - 32, height: 16)
        hint.autoresizingMask = [.width]
        root.addSubview(hint)
        window.contentView = root
        window.center()
        preview = NSWindowController(window: window)
        window.makeKeyAndOrderFront(nil)
    }

    func screenFrame(for id: UUID) -> NSRect? {
        layoutSubtreeIfNeeded()
        guard let card = cards[id], let window else { return nil }
        return window.convertToScreen(card.convert(card.bounds, to: nil))
    }

    override func layout() {
        super.layout()
        for (index, id) in ids.enumerated() {
            let slot = NSRect(origin: NSPoint(x: CGFloat(index) * (CaptureStyle.cardSize.width + CaptureStyle.cardGap) + 2, y: 3), size: CaptureStyle.cardSize)
            if let card = cards[id], let asset = assets.first(where: { $0.id == id }) {
                card.frame = ScreenshotFlightGeometry.cardFrame(image: NSSize(width: asset.width, height: asset.height), in: slot)
                thumbnails[id]?.frame = card.bounds.insetBy(dx: 4, dy: 4)
            }
        }
        status.frame = NSRect(x: 2, y: 80, width: max(0, bounds.width - (cancel.isHidden ? 4 : 100)), height: 20)
        cancel.frame = NSRect(x: bounds.width - 90, y: 78, width: 90, height: 26)
        detail.frame = NSRect(x: 2, y: 104, width: max(0, bounds.width - 4), height: 28)
        progress.frame = NSRect(x: 2, y: 134, width: max(0, bounds.width - 4) * fraction, height: 2)
    }
}

private final class ScreenshotPreviewWindow: NSWindow {
    override func cancelOperation(_ sender: Any?) { close() }
}
