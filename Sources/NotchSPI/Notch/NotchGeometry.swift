import CoreGraphics

/// Pixel-exact placement of the notch panel against the physical hardware cutout.
///
/// The whole illusion depends on the software slab's notch-region walls landing **exactly** on the
/// hardware notch walls — the cutout is display-centered and its walls fall on the backing-pixel
/// grid, so a half-pixel of independent rounding is enough to slide the slab off by a physical
/// pixel and expose a black sliver in the menu bar (穿帮). Everything here therefore:
///   1. anchors on the display-centered notch axis (`screenFrame.midX`),
///   2. pixel-aligns every edge to the backing grid (crisp walls, no half-pixel blur),
///   3. pins the top edge to the physical display top (no seam at the top of the cutout),
/// and derives width/height from aligned edges so opposing walls can never drift apart.
///
/// Pure and side-effect-free so it is unit-tested directly against real `NSScreen` numbers.
enum NotchGeometry {
    /// Snap a point-space coordinate to the display's backing-pixel grid. At 2× this is the 0.5pt
    /// grid the hardware notch walls already sit on, so aligned edges fuse with the cutout instead
    /// of straddling a pixel boundary.
    @inline(__always)
    static func pixelAlign(_ v: CGFloat, scale: CGFloat) -> CGFloat {
        guard scale > 0, scale.isFinite else { return v.rounded() }
        return (v * scale).rounded() / scale
    }

    struct Metrics {
        /// The target screen's frame in global (bottom-left origin) coordinates.
        var screenFrame: CGRect
        /// Backing scale factor (2 on Retina) — the pixel grid every edge is snapped to.
        var scale: CGFloat
        /// Notch cutout width in points (from the auxiliary top areas, clamped by the caller).
        var notchWidth: CGFloat
        /// Notch/menu-bar height in points (safe-area top, clamped by the caller).
        var notchHeight: CGFloat
        var notchCenterX: CGFloat? = nil
    }

    /// Collapsed panel frame. The slab fills the whole panel; its right wall fuses with the
    /// hardware notch's right wall and it extends `sideExtension` points to the **left** into the
    /// menu bar so the Rose indicator has room beside the cutout.
    static func collapsed(_ m: Metrics, sideExtension: CGFloat) -> CGRect {
        let centerX = m.notchCenterX ?? m.screenFrame.midX                       // physical cutout is display-centered
        let notchRight = pixelAlign(centerX + m.notchWidth / 2, scale: m.scale)
        let notchLeft  = pixelAlign(centerX - m.notchWidth / 2, scale: m.scale)
        let left = pixelAlign(notchLeft - sideExtension, scale: m.scale)
        let height = pixelAlign(m.notchHeight, scale: m.scale)
        let top = m.screenFrame.maxY                           // pin to the physical top seam
        return CGRect(x: left, y: top - height, width: notchRight - left, height: height)
    }

    /// Expanded panel frame. An obsidian card of `cardWidth × cardHeight`, centered on the **same**
    /// notch axis as the collapsed slab (so the morph never drifts sideways), grown by a transparent
    /// shadow margin on the sides and bottom — never the top, which stays flush with the display.
    static func expanded(_ m: Metrics, cardWidth: CGFloat, cardHeight: CGFloat,
                         marginH: CGFloat, marginBottom: CGFloat) -> CGRect {
        let centerX = m.notchCenterX ?? m.screenFrame.midX
        let cardLeft  = pixelAlign(centerX - cardWidth / 2, scale: m.scale)
        let cardRight = pixelAlign(centerX + cardWidth / 2, scale: m.scale)
        let left  = pixelAlign(cardLeft - marginH, scale: m.scale)
        let right = pixelAlign(cardRight + marginH, scale: m.scale)
        let height = pixelAlign(cardHeight + marginBottom, scale: m.scale)
        let top = m.screenFrame.maxY
        return CGRect(x: left, y: top - height, width: right - left, height: height)
    }
}

/// Hardware geometry is independent of the decorative slab on displays without a cutout.
struct NotchScreenLayout: Equatable {
    var frame: CGRect
    var visibleFrame: CGRect
    var scale: CGFloat
    var safeTop: CGFloat
    var auxiliaryLeft: CGRect?
    var auxiliaryRight: CGRect?

    var contentInset: CGFloat {
        let scale = max(1, scale)
        return ceil(max(0, safeTop) * scale) / scale
    }

    var cutout: CGRect? {
        guard contentInset > 0 else { return nil }
        // If auxiliary data is unavailable, reserve the entire top band. Never invent
        // a hardware width from the decorative fallback.
        let left = auxiliaryLeft?.maxX ?? frame.minX
        let right = auxiliaryRight?.minX ?? frame.maxX
        return CGRect(x: left, y: frame.maxY - contentInset,
                      width: max(0, right - left), height: contentInset)
    }

    /// Inward rounding for paint; contentInset deliberately rounds the opposite way
    /// to protect text. Neither value is derived from the menu bar or Dock.
    var hardwareHeight: CGFloat {
        let scale = max(1, scale)
        return floor(max(0, safeTop) * scale) / scale
    }

    var metrics: NotchGeometry.Metrics {
        .init(screenFrame: frame, scale: scale,
              notchWidth: cutout?.width ?? 200,
              // Menu-bar height includes chrome below the camera housing. It must
              // never enlarge the collapsed silhouette (32 pt hardware vs 33 pt menu).
              notchHeight: contentInset > 0 ? hardwareHeight : 28,
              notchCenterX: cutout?.midX)
    }

    func collapsed(sideExtension: CGFloat) -> CGRect {
        if contentInset > 0 && (auxiliaryLeft == nil || auxiliaryRight == nil) {
            var fallback = metrics
            fallback.notchWidth = 200
            fallback.notchHeight = 28
            fallback.notchCenterX = frame.midX
            return NotchGeometry.collapsed(fallback, sideExtension: sideExtension)
                .offsetBy(dx: 0, dy: -contentInset)
        }
        return NotchGeometry.collapsed(metrics, sideExtension: sideExtension)
    }

    var cardWidth: CGFloat { min(600, max(1, visibleFrame.width - 2 * NotchMetrics.shadowMarginH)) }
    var maximumCardHeight: CGFloat {
        max(1, frame.maxY - visibleFrame.minY - NotchMetrics.shadowMarginBottom)
    }

    var hasTopWings: Bool { cutout != nil && auxiliaryLeft != nil && auxiliaryRight != nil }

    // Only unknown hardware geometry needs the conservative full-width fallback.
    var headerInset: CGFloat { cutout != nil && !hasTopWings ? contentInset : 0 }

    func bodyAdjustment(onboarding: Bool) -> CGFloat {
        max(headerInset, contentInset - (onboarding ? 38 : NotchLayout.headerHeight))
    }

    func expanded(contentHeight: CGFloat) -> CGRect {
        var result = NotchGeometry.expanded(metrics, cardWidth: cardWidth,
            cardHeight: min(maximumCardHeight, contentHeight),
            marginH: NotchMetrics.shadowMarginH, marginBottom: NotchMetrics.shadowMarginBottom)
        // A side Dock can make visibleFrame asymmetric, especially at low resolutions.
        result.origin.x = min(max(result.minX, visibleFrame.minX), visibleFrame.maxX - result.width)
        return result
    }

    /// Convert a global safe boundary into the flipped panel's local coordinates.
    func contentTop(in panel: CGRect) -> CGFloat {
        max(0, panel.maxY - (frame.maxY - contentInset))
    }
}
