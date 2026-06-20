import SwiftUI

/// The notch slab: top edge flush with the screen, small *concave* fillets at the
/// top corners (so it appears to flare out of the notch), and convex rounded
/// bottom corners. `bottomRadius` is animated on expand/collapse.
struct NotchShape: Shape {
    var bottomRadius: CGFloat
    var topRadius: CGFloat = 9

    var animatableData: CGFloat {
        get { bottomRadius }
        set { bottomRadius = newValue }
    }

    func path(in rect: CGRect) -> Path {
        let topR = min(topRadius, rect.width / 2)
        let botR = min(bottomRadius, rect.width / 2 - topR, max(0, rect.height - topR))
        var p = Path()
        p.move(to: CGPoint(x: rect.minX, y: rect.minY))
        // concave top-left
        p.addQuadCurve(
            to: CGPoint(x: rect.minX + topR, y: rect.minY + topR),
            control: CGPoint(x: rect.minX + topR, y: rect.minY)
        )
        p.addLine(to: CGPoint(x: rect.minX + topR, y: rect.maxY - botR))
        // convex bottom-left
        p.addQuadCurve(
            to: CGPoint(x: rect.minX + topR + botR, y: rect.maxY),
            control: CGPoint(x: rect.minX + topR, y: rect.maxY)
        )
        p.addLine(to: CGPoint(x: rect.maxX - topR - botR, y: rect.maxY))
        // convex bottom-right
        p.addQuadCurve(
            to: CGPoint(x: rect.maxX - topR, y: rect.maxY - botR),
            control: CGPoint(x: rect.maxX - topR, y: rect.maxY)
        )
        p.addLine(to: CGPoint(x: rect.maxX - topR, y: rect.minY + topR))
        // concave top-right
        p.addQuadCurve(
            to: CGPoint(x: rect.maxX, y: rect.minY),
            control: CGPoint(x: rect.maxX - topR, y: rect.minY)
        )
        p.closeSubpath()
        return p
    }
}
