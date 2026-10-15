import AppKit
import QuartzCore

/// Stable reserved slots connect the flight to the card. Timer ticks only update the labels
/// and progress; images are decoded once, and preview pauses submission without changing the reserved image slots.
@MainActor
final class ScreenshotTray: NSView {
    var onCancel: (() -> Void)?
    var onSubmit: (() -> Void)?
    var onRemove: ((UUID) -> Void)?
    var onUndo: (() -> Void)?
    var onPreviewChanged: ((Bool) -> Void)?
    private lazy var submit = NotchActionButton(title: L10n.t("现在查题", "今すぐ質問", "Ask now")) { [weak self] in self?.onSubmit?() }
    private lazy var undo = NotchActionButton(title: L10n.t("撤销删除", "削除を元に戻す", "Undo removal")) { [weak self] in self?.onUndo?() }
    private var removeButtons: [UUID: NotchActionButton] = [:]
    private var ordinals: [UUID: NSTextField] = [:]
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
    private var preview: QuestionImagePreview?
    private var collecting = false
    private var compact = false
    private var animateReferenceLayout = false
    private var reorderPending = false
    private var reorderFrames: [UUID: (CGRect, CGRect)] = [:]
    private var removeFrames: [UUID: (CGRect, CGRect)] = [:]
    private lazy var reorder = DisplayTween(host: self, value: 1)

    override var isFlipped: Bool { true }

    override init(frame: NSRect) {
        super.init(frame: frame)
        reorder.ease = { $0 * $0 * (3 - 2 * $0) }
        reorder.onChange = { [weak self] progress in self?.applyReorder(progress) }
        status.font = .systemFont(ofSize: 12, weight: .medium)
        status.textColor = NotchPalette.secondary
        status.lineBreakMode = .byTruncatingTail
        detail.font = CaptureStyle.caption
        detail.textColor = NotchPalette.secondary
        detail.maximumNumberOfLines = 2
        addSubview(status); addSubview(detail); addSubview(cancel); addSubview(nextSlot); addSubview(submit); addSubview(undo)
        progress.wantsLayer = true
        progress.layer?.backgroundColor = NotchPalette.accent.cgColor
        progress.layer?.cornerRadius = 1
        addSubview(progress)
    }
    required init?(coder: NSCoder) { nil }

    func update(assets: [ContextAsset], images: [UUID: NSImage], flying: Set<UUID>,
                message: String, remaining: TimeInterval?, cancellable: Bool,
                capturing: Bool = false, notice: String = "", undoAvailable: Bool = false, compact: Bool = false) {
        if self.compact != compact {
            finishReorder()
            animateReferenceLayout = !onboardingReduceMotion() && !ids.isEmpty
            self.compact = compact
        }
        let next = assets.map(\.id)
        if capturing || !flying.isEmpty || onboardingReduceMotion() { finishReorder() }
        if ids != next {
            reorderPending = collecting && cancellable && !compact && !capturing
                && flying.isEmpty && !ids.isEmpty && !onboardingReduceMotion()
        }
        if ids != next || capturing || (collecting && !cancellable) { preview?.close(); preview = nil }
        collecting = cancellable
        self.assets = assets
        for id in ids where !next.contains(id) { cards.removeValue(forKey: id)?.removeFromSuperview(); thumbnails.removeValue(forKey: id); ordinals.removeValue(forKey: id)?.removeFromSuperview(); removeButtons.removeValue(forKey: id)?.removeFromSuperview() }
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
                let ordinal = ScreenshotOrdinalLabel(labelWithString: "\(index + 1)")
                ordinal.font = .monospacedDigitSystemFont(ofSize: 10, weight: .bold)
                ordinal.textColor = .white
                ordinal.drawsBackground = true
                ordinal.backgroundColor = NSColor.black.withAlphaComponent(0.72)
                ordinal.alignment = .center
                ordinal.frame = NSRect(x: 5, y: 5, width: 19, height: 15)
                ordinals[id] = ordinal
                let remove = NotchActionButton(title: "×") { [weak self] in self?.onRemove?(id) }
                remove.layer?.backgroundColor = NSColor.black.withAlphaComponent(0.72).cgColor
                removeButtons[id] = remove; addSubview(remove)
                card.setAccessibilityLabel(L10n.t("预览截图 \(index + 1)", "画像 \(index + 1) をプレビュー", "Preview screenshot \(index + 1)"))
                card.toolTip = card.accessibilityLabel()
                cards[id] = card
                addSubview(card)
                addSubview(ordinal, positioned: .above, relativeTo: card)
                if let remove = removeButtons[id] { addSubview(remove, positioned: .above, relativeTo: card) }
            }
            let card = cards[asset.id]!
            ordinals[asset.id]?.stringValue = "\(index + 1)"
            card.setAccessibilityLabel(L10n.t("预览截图 \(index + 1)", "画像 \(index + 1) をプレビュー", "Preview screenshot \(index + 1)"))
            card.toolTip = card.accessibilityLabel()
            removeButtons[asset.id]?.isHidden = !cancellable || flying.contains(asset.id)
            removeButtons[asset.id]?.isEnabled = !capturing
            removeButtons[asset.id]?.setAccessibilityLabel(L10n.t("删除截图 \(index + 1)", "画像 \(index + 1) を削除", "Remove screenshot \(index + 1)"))
            thumbnails[asset.id]?.image = images[asset.id]
            let wasHidden = card.alphaValue < 1
            card.alphaValue = flying.contains(asset.id) ? 0 : 1
            ordinals[asset.id]?.alphaValue = card.alphaValue
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
            ? L10n.t("题图 \(assets.count)/4", "画像 \(assets.count)/4", "Images \(assets.count)/4")
            : L10n.t("题图 \(assets.count)", "画像 \(assets.count)枚", "Images \(assets.count)")
        if status.stringValue != title { status.stringValue = title }
        status.font = compact ? CaptureStyle.caption : CaptureStyle.status
        nextSlot.isHidden = !cancellable || assets.count >= 4
        let hint: String
        if !notice.isEmpty { hint = notice }
        else if cancellable { hint = message }
        else { hint = "" }
        if detail.stringValue != hint { detail.stringValue = hint }
        detail.isHidden = hint.isEmpty
        detail.toolTip = hint
        detail.textColor = notice.isEmpty ? NotchPalette.secondary : .systemOrange
        cancel.isHidden = !cancellable
        submit.isHidden = !cancellable; submit.isEnabled = assets.count >= 2 && !capturing
        submit.toolTip = L10n.t("收集 2–4 张后按顺序提交", "2〜4枚を順番に送信", "Submit two to four images in order")
        undo.isHidden = !undoAvailable; undo.isEnabled = !capturing
        fraction = CGFloat(max(0, min(1, (remaining ?? 0) / 4)))
        progress.alphaValue = capturing ? 0.35 : 1
        progress.isHidden = !cancellable || remaining == nil
        needsDisplay = true
        needsLayout = true
    }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        if compact {
            NotchPalette.rule.setFill()
            NSRect(x: NotchType.cardPadH, y: 0, width: max(0, bounds.width - 2 * NotchType.cardPadH), height: 0.5).fill()
        }
    }

    func stopReferenceMotion() {
        animateReferenceLayout = false
        finishReorder()
        layer?.removeAnimation(forKey: "reference-handoff")
        for card in cards.values {
            card.layer?.removeAnimation(forKey: "reference-layout")
            card.layer?.removeAnimation(forKey: "landing")
        }
    }

    func showPreview(_ id: UUID) {
        guard let index = ids.firstIndex(of: id), let asset = assets.first(where: { $0.id == id }) else { return }
        // Replacing an open preview is still one paused interval. Only the current
        // preview may resume the timer; closing its predecessor must not do so.
        let replacing = preview != nil
        preview?.onClose = nil
        preview?.close()
        let controller = QuestionImagePreview(asset: asset,
            title: L10n.t("截图 \(index + 1) / \(ids.count) · 预览", "画像 \(index + 1) / \(ids.count)", "Screenshot \(index + 1) / \(ids.count) · Preview"), collecting: collecting)
        if collecting && !replacing { onPreviewChanged?(true) }
        controller.onClose = { [weak self, weak controller] in
            guard let self, self.preview === controller else { return }
            self.preview = nil
            if self.collecting { self.onPreviewChanged?(false) }
        }
        if collecting { controller.onRemove = { [weak self] in self?.onRemove?(id) } }
        preview = controller
        controller.present()
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
        if compact {
            let inset = NotchType.cardPadH
            let gap: CGFloat = 8
            let width = min(CaptureStyle.referenceThumbnail.width, max(24, (bounds.width - 2 * inset - 90 - 3 * gap) / 4))
            for (index, id) in ids.enumerated() {
                guard let card = cards[id] else { continue }
                let oldBounds = card.layer?.presentation()?.bounds ?? card.bounds
                let oldPosition = card.layer?.presentation()?.position ?? card.layer?.position
                card.frame = NSRect(x: inset + CGFloat(index) * (width + gap), y: 9, width: width, height: CaptureStyle.referenceThumbnail.height)
                thumbnails[id]?.frame = card.bounds.insetBy(dx: 3, dy: 3)
                ordinals[id]?.isHidden = ids.count == 1
                ordinals[id]?.font = .monospacedDigitSystemFont(ofSize: 8, weight: .semibold)
                if let ordinal = ordinals[id] {
                    // In compact mode the badge fits the card and follows its existing
                    // reference motion automatically, without a second animation clock.
                    if ordinal.superview !== card { card.addSubview(ordinal) }
                    let textSize = ordinal.intrinsicContentSize
                    ordinal.frame = NSRect(x: 3, y: 3,
                                           width: max(14, ceil(textSize.width)), height: max(12, ceil(textSize.height)))
                }
                if animateReferenceLayout, let layer = card.layer, let oldPosition {
                    let move = CABasicAnimation(keyPath: "position")
                    move.fromValue = NSValue(point: oldPosition); move.toValue = NSValue(point: layer.position)
                    let resize = CABasicAnimation(keyPath: "bounds")
                    resize.fromValue = NSValue(rect: oldBounds); resize.toValue = NSValue(rect: layer.bounds)
                    let group = CAAnimationGroup(); group.animations = [move, resize]
                    group.duration = NotchPalette.referenceDuration
                    group.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
                    layer.add(group, forKey: "reference-layout")
                }
            }
            let labelX = inset + CGFloat(ids.count) * (width + gap) + 4
            status.alignment = .right
            status.frame = NSRect(x: labelX, y: 15, width: max(0, bounds.width - labelX - inset), height: 18)
            animateReferenceLayout = false
            return
        }
        for id in ids {
            cards[id]?.layer?.removeAnimation(forKey: "reference-layout")
            ordinals[id]?.isHidden = false
            ordinals[id]?.font = .monospacedDigitSystemFont(ofSize: 10, weight: .bold)
        }
        status.alignment = .left
        let inset = NotchType.cardPadH
        let contentWidth = max(0, bounds.width - inset * 2)
        animateReferenceLayout = false
        let gap = CaptureStyle.cardGap
        let cardSize = NSSize(width: min(CaptureStyle.cardSize.width, max(0, (contentWidth - 3 * gap) / 4)),
                              height: CaptureStyle.cardSize.height)
        func slot(_ index: Int) -> NSRect {
            NSRect(x: inset + CGFloat(index) * (cardSize.width + gap), y: 38,
                   width: cardSize.width, height: cardSize.height)
        }
        if reorderPending { reorderFrames.removeAll(); removeFrames.removeAll() }
        for (index, id) in ids.enumerated() {
            if let card = cards[id], let asset = assets.first(where: { $0.id == id }) {
                let target = ScreenshotFlightGeometry.cardFrame(image: NSSize(width: asset.width, height: asset.height), in: slot(index))
                if reorderPending, card.frame.width > 0, card.frame != target {
                    reorderFrames[id] = (card.frame, target)
                }
                card.frame = target
                thumbnails[id]?.frame = card.bounds.insetBy(dx: 4, dy: 4)
                let rect = slot(index)
                // The image card can be only 8pt wide/high for extreme crops.
                // Keep its readable ordinal in the stable slot, like the remove control.
                if let ordinal = ordinals[id] {
                    if ordinal.superview !== self { addSubview(ordinal, positioned: .above, relativeTo: card) }
                    ordinal.frame = NSRect(x: rect.minX + 5, y: rect.minY + 5, width: 19, height: 15)
                }
                let removeTarget = NSRect(x: rect.maxX - 24, y: rect.minY + 2, width: 22, height: 22)
                if reorderPending, let button = removeButtons[id], button.frame.width > 0 {
                    removeFrames[id] = (button.frame, removeTarget)
                }
                removeButtons[id]?.frame = removeTarget
            }
        }
        nextSlot.frame = slot(min(ids.count, 3))
        status.frame = NSRect(x: inset, y: 11, width: max(0, contentWidth - (cancel.isHidden ? 0 : 204)), height: 18)
        cancel.frame = NSRect(x: max(inset, bounds.width - inset - 90), y: 8, width: 90, height: 24)
        submit.frame = NSRect(x: max(inset, bounds.width - inset - 190), y: 8, width: 90, height: 24)
        undo.frame = NSRect(x: max(inset, bounds.width - inset - 100), y: 128, width: 100, height: 26)
        detail.frame = NSRect(x: inset, y: 128, width: max(0, contentWidth - (undo.isHidden ? 0 : 108)), height: 30)
        progress.frame = NSRect(x: inset, y: 121, width: contentWidth * fraction, height: 2)
        if reorderPending {
            reorderPending = false
            reorder.set(0)
            reorder.animate(to: 1, duration: 0.22)
        } else if reorder.isAnimating { applyReorder(reorder.value) }
    }

    private func applyReorder(_ progress: CGFloat) {
        for (id, frames) in reorderFrames {
            cards[id]?.frame = notchLerpRect(frames.0, frames.1, progress)
            if let card = cards[id] { thumbnails[id]?.frame = card.bounds.insetBy(dx: 4, dy: 4) }
        }
        for (id, frames) in removeFrames {
            removeButtons[id]?.frame = notchLerpRect(frames.0, frames.1, progress)
        }
    }

    private func finishReorder() {
        reorder.set(1)
        reorderPending = false
        reorderFrames.removeAll(); removeFrames.removeAll()
    }

    #if DEBUG
    func qaUseManualReorderClock() { reorder.qaManualTime = 0 }
    func qaAdvanceReorder(by dt: CFTimeInterval) { reorder.qaAdvance(by: dt) }
    var qaPreview: QuestionImagePreview? { preview }
    #endif
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

// Labels overlay the image but must not intercept its preview click.
private final class ScreenshotOrdinalLabel: NSTextField {
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
}
