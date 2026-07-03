import CoreGraphics

/// The notch slab geometry. A square top edge flush with the display, **concave shoulders** at
/// the top-left/right that flare the surface down out of the menu bar (so it reads as grown from
/// the physical cutout, not a rectangle pasted onto it), and continuous convex bottom corners.
/// Both radii animate together so the whole body morphs as one piece during expand/collapse.
///
/// Built in a TOP-LEFT origin space (y increases downward) to match the flipped `NotchSurfaceView`
/// it is drawn into — identical math to the original SwiftUI `Shape`.
enum NotchShape {
    /// - Parameters:
    ///   - topRadius: the inverse (concave) shoulder radius where the top edge peels into the walls.
    ///   - bottomRadius: the convex radius at the two bottom corners.
    static func cgPath(in rect: CGRect, topRadius: CGFloat, bottomRadius: CGFloat) -> CGPath {
        // Clamp so neither radius can exceed what the current bounds allow (matters most while the
        // slab is still narrow/short mid-morph).
        let topR = max(0, min(topRadius, rect.width / 2))
        let botR = max(0, min(bottomRadius, rect.width / 2 - topR, max(0, rect.height - topR)))

        let p = CGMutablePath()
        // Outer top-left, flush at the display edge.
        p.move(to: CGPoint(x: rect.minX, y: rect.minY))
        // Concave top-left shoulder: peel inward and down to where the left wall begins.
        p.addQuadCurve(to: CGPoint(x: rect.minX + topR, y: rect.minY + topR),
                       control: CGPoint(x: rect.minX + topR, y: rect.minY))
        // Left wall.
        p.addLine(to: CGPoint(x: rect.minX + topR, y: rect.maxY - botR))
        // Convex bottom-left.
        p.addQuadCurve(to: CGPoint(x: rect.minX + topR + botR, y: rect.maxY),
                       control: CGPoint(x: rect.minX + topR, y: rect.maxY))
        // Bottom edge.
        p.addLine(to: CGPoint(x: rect.maxX - topR - botR, y: rect.maxY))
        // Convex bottom-right.
        p.addQuadCurve(to: CGPoint(x: rect.maxX - topR, y: rect.maxY - botR),
                       control: CGPoint(x: rect.maxX - topR, y: rect.maxY))
        // Right wall.
        p.addLine(to: CGPoint(x: rect.maxX - topR, y: rect.minY + topR))
        // Concave top-right shoulder.
        p.addQuadCurve(to: CGPoint(x: rect.maxX, y: rect.minY),
                       control: CGPoint(x: rect.maxX - topR, y: rect.minY))
        p.closeSubpath()
        return p
    }
}
