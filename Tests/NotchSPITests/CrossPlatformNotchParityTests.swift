import AppKit
import XCTest
@testable import NotchSPI

final class CrossPlatformNotchParityTests: XCTestCase {
    struct Fixtures: Decodable {
        struct Capsule: Decodable { let mode: String; let auto: Bool; let name: String; let action: String; let kind: String }
        struct Geometry: Decodable { let screenWidth: Double; let screenHeight: Double; let collapsedX: Double; let collapsedWidth: Double; let collapsedHeight: Double; let cardWidth: Double; let shadowH: Double; let shadowBottom: Double }
        struct Compact: Decodable { let status: String; let mark: String }
        let capsules: [Capsule]; let geometry: Geometry; let compact: [Compact]
    }
    private func fixtures() throws -> Fixtures {
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        return try JSONDecoder().decode(Fixtures.self, from: Data(contentsOf: root.appendingPathComponent("shared/fixtures/notch-parity.json")))
    }
    func testSharedOrdinaryDisplayGeometry() throws {
        let f = try fixtures().geometry
        let layout = NotchScreenLayout(frame: CGRect(x: 0, y: 0, width: f.screenWidth, height: f.screenHeight), visibleFrame: CGRect(x: 0, y: 0, width: f.screenWidth, height: f.screenHeight), scale: 2, safeTop: 0)
        let closed = layout.collapsed(sideExtension: 60)
        XCTAssertEqual(closed.minX, f.collapsedX)
        XCTAssertEqual(closed.width, f.collapsedWidth)
        XCTAssertEqual(closed.height, f.collapsedHeight)
        XCTAssertEqual(layout.cardWidth, f.cardWidth)
        XCTAssertEqual(NotchMetrics.shadowMarginH, f.shadowH)
        XCTAssertEqual(NotchMetrics.shadowMarginBottom, f.shadowBottom)
    }
    @MainActor func testSharedCapsuleDispatchesTheNativeControl() throws {
        func descendants(_ view: NSView) -> [NSView] { [view] + view.subviews.flatMap(descendants) }
        for c in try fixtures().capsules {
            let model = TutorModel()
            model.mode = c.mode; model.autoActive = c.auto; model.autoProgress = "3/20"
            model.personaLabel = c.name; model.depthLabel = "Parity effort"; model.expanded = true
            var action = ""
            let view = NotchView(model: model, frameProvider: { _ in CGRect(x: 0, y: 0, width: 644, height: 250) }, onHover: { _ in }, onCycleDepth: { action = "cycleEffort" }, onEditPersona: { action = "settings" }, onSettings: {}, onToggleReasoning: {}, onCopyAnswer: {}, onStopAuto: { action = "auto" })
            view.refreshScreenshotTray()
            let label = c.auto ? L10n.autoStopCapsule("3/20") : c.mode == "personality" ? (c.name.isEmpty ? L10n.t("设置人物像", "人物像を設定", "Set persona") : c.name) : "Parity effort"
            let control = try XCTUnwrap(descendants(view).first { $0.accessibilityLabel() == label && $0 is NSControl })
            XCTAssertTrue(control.accessibilityPerformPress())
            XCTAssertEqual(action, c.action, "\(c.mode), auto=\(c.auto)")
        }
    }
    @MainActor func testOrdinaryPanelNeverBecomesKeyButGuideCan() {
        let panel = NotchPanel(contentRect: .zero)
        defer { panel.close() }
        XCTAssertFalse(panel.canBecomeKey)
        panel.onboardingActive = true
        XCTAssertTrue(panel.canBecomeKey)
        panel.onboardingActive = false
        XCTAssertFalse(panel.canBecomeKey)
    }
}
