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
    }

    /// Collapsed panel frame. The slab fills the whole panel; its right wall fuses with the
    /// hardware notch's right wall and it extends `sideExtension` points to the **left** into the
    /// menu bar so the Rose indicator has room beside the cutout.
    static func collapsed(_ m: Metrics, sideExtension: CGFloat) -> CGRect {
        let centerX = m.screenFrame.midX                       // physical cutout is display-centered
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
        let centerX = m.screenFrame.midX
        let cardLeft  = pixelAlign(centerX - cardWidth / 2, scale: m.scale)
        let cardRight = pixelAlign(centerX + cardWidth / 2, scale: m.scale)
        let left  = pixelAlign(cardLeft - marginH, scale: m.scale)
        let right = pixelAlign(cardRight + marginH, scale: m.scale)
        let height = pixelAlign(cardHeight + marginBottom, scale: m.scale)
        let top = m.screenFrame.maxY
        return CGRect(x: left, y: top - height, width: right - left, height: height)
    }
}
