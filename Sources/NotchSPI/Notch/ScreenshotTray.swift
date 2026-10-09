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
    private let nextSlot = ScreenshotNextSlot()
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
        status.font = .systemFont(ofSize: 12, weight: .medium)
        status.textColor = NotchPalette.secondary
        status.lineBreakMode = .byTruncatingTail
        detail.font = CaptureStyle.caption
        detail.textColor = NotchPalette.secondary
        detail.maximumNumberOfLines = 2
        addSubview(status); addSubview(detail); addSubview(cancel); addSubview(nextSlot)
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
                card.layer?.borderWidth = 0.5
                card.layer?.borderColor = NSColor.white.withAlphaComponent(0.14).cgColor
                card.shadow = NSShadow()
                card.shadow?.shadowColor = NSColor.black.withAlphaComponent(0.3)
                card.shadow?.shadowBlurRadius = 3
                card.shadow?.shadowOffset = NSSize(width: 0, height: -3)
                let image = NSImageView(frame: NSRect(x: 4, y: 4, width: 96, height: 60))
                image.imageScaling = .scaleProportionallyUpOrDown
                image.autoresizingMask = [.width, .height]
                image.wantsLayer = true
                image.layer?.cornerRadius = CaptureStyle.cardRadius - 4
                image.layer?.masksToBounds = true
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
            if wasHidden, card.alphaValue == 1, !onboardingReduceMotion() {
                // A short photo-like sway, starting at the flight's exact horizontal pose.
                let settle = CAKeyframeAnimation(keyPath: "transform")
                let center = CGPoint(x: card.bounds.midX, y: card.bounds.midY)
                settle.values = [0.0, -1.2, 0.45, 0.0].map { angle in
                    var transform = CATransform3DMakeTranslation(center.x, center.y, 0)
                    transform = CATransform3DRotate(transform, angle * .pi / 180, 0, 0, 1)
                    transform = CATransform3DTranslate(transform, -center.x, -center.y, 0)
                    return NSValue(caTransform3D: transform)
                }
                settle.keyTimes = [0, 0.3, 0.65, 1]
                settle.timingFunctions = Array(repeating: CAMediaTimingFunction(name: .easeInEaseOut), count: 3)
                settle.duration = 0.22
                card.layer?.add(settle, forKey: "landing")
            }
        }
        let title = cancellable
            ? L10n.t("收集题目 · \(assets.count) / 4", "問題を収集中 · \(assets.count) / 4", "Collecting question · \(assets.count) / 4")
            : L10n.t("题目 · \(assets.count) 张截图", "問題 · 画像\(assets.count)枚", "Question · \(assets.count) image\(assets.count == 1 ? "" : "s")")
        if status.stringValue != title { status.stringValue = title }
        nextSlot.isHidden = !cancellable || assets.count >= 4
        let hint: String
        if !notice.isEmpty { hint = notice }
        else if cancellable { hint = message }
        else { hint = L10n.t("点击截图，查看完整题目", "画像をクリックして問題全体を確認", "Click an image to view the full question") }
        if detail.stringValue != hint { detail.stringValue = hint }
        detail.toolTip = hint
        detail.textColor = notice.isEmpty ? NotchPalette.secondary : .systemOrange
        cancel.isHidden = !cancellable
        fraction = CGFloat(max(0, min(1, (remaining ?? 0) / 4)))
        progress.alphaValue = capturing ? 0.35 : 1
        progress.isHidden = !cancellable || remaining == nil
        needsDisplay = true
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
        // Slots stay fixed through capture, countdown and submission. The flight and
        // preview use the same aspect-fit geometry, including portrait source pages.
        let gap = CaptureStyle.cardGap
        let cardSize = NSSize(width: min(CaptureStyle.cardSize.width, max(0, (bounds.width - 3 * gap) / 4)),
                              height: CaptureStyle.cardSize.height)
        func slot(_ index: Int) -> NSRect {
            NSRect(x: CGFloat(index) * (cardSize.width + gap), y: 30,
                   width: cardSize.width, height: cardSize.height)
        }
        for (index, id) in ids.enumerated() {
            if let card = cards[id], let asset = assets.first(where: { $0.id == id }) {
                card.frame = ScreenshotFlightGeometry.cardFrame(image: NSSize(width: asset.width, height: asset.height), in: slot(index))
                thumbnails[id]?.frame = card.bounds.insetBy(dx: 4, dy: 4)
            }
        }
        nextSlot.frame = slot(min(ids.count, 3))
        status.frame = NSRect(x: 0, y: 3, width: max(0, bounds.width - (cancel.isHidden ? 0 : 104)), height: 18)
        cancel.frame = NSRect(x: max(0, bounds.width - 90), y: 0, width: 90, height: 24)
        detail.frame = NSRect(x: 0, y: 120, width: bounds.width, height: 30)
        progress.frame = NSRect(x: 0, y: 113, width: bounds.width * fraction, height: 2)
    }

}

private final class ScreenshotPreviewWindow: NSWindow {
    override func cancelOperation(_ sender: Any?) { close() }
}

/// A passive continuation cue; the configured capture shortcut remains in the status.
@MainActor
private final class ScreenshotNextSlot: NSView {
    override var isFlipped: Bool { true }
    override init(frame: NSRect) {
        super.init(frame: frame)
        setAccessibilityElement(false)
    }
    required init?(coder: NSCoder) { nil }
    override func draw(_ dirtyRect: NSRect) {
        let outline = NSBezierPath(roundedRect: bounds.insetBy(dx: 0.5, dy: 0.5), xRadius: 8, yRadius: 8)
        NSColor.white.withAlphaComponent(0.025).setFill(); outline.fill()
        NSColor.white.withAlphaComponent(0.16).setStroke()
        outline.setLineDash([3, 4], count: 2, phase: 0); outline.lineWidth = 1; outline.stroke()
        let center = bounds.midX
        let plus = NSBezierPath()
        plus.move(to: NSPoint(x: center - 5, y: 28)); plus.line(to: NSPoint(x: center + 5, y: 28))
        plus.move(to: NSPoint(x: center, y: 23)); plus.line(to: NSPoint(x: center, y: 33))
        NSColor.white.withAlphaComponent(0.4).setStroke(); plus.lineWidth = 1; plus.stroke()
        let paragraph = NSMutableParagraphStyle(); paragraph.alignment = .center
        (L10n.t("下一张截图", "次の画像", "Next image") as NSString).draw(
            in: NSRect(x: 4, y: 43, width: bounds.width - 8, height: 18),
            withAttributes: [.font: CaptureStyle.caption, .foregroundColor: NotchPalette.secondary, .paragraphStyle: paragraph])
    }
}
