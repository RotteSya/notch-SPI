import XCTest
import BotAvatarsKit
@testable import NotchSPI

final class SharedVisualTests: XCTestCase {
    func testSharedGhostMatchesPinnedMacRigAcrossInterruptionsAndEvents() {
        for seed in [0.0, 0.37, 0.999] {
            let baseline = BotAvatarSim(seed: seed), shared = SharedGhostSimulation(seed: seed)
            for frame in 0..<2400 {
                if [30, 150, 170, 850].contains(frame) { baseline.setState(.working); shared.setState(.working) }
                if [120, 160, 500, 1100, 1900].contains(frame) { baseline.setState(.default); shared.setState(.default) }
                if frame == 1500 { baseline.setState(.sleeping); shared.setState(.sleeping) }
                let dt = frame % 3 == 0 ? 1.0 / 24 : 1.0 / 60
                baseline.update(dt); shared.update(dt)
                let a = SharedVisual.dictionary(baseline.pose), b = SharedVisual.dictionary(shared.pose)
                for key in a.keys where key != "w" {
                    let actual = b[key] as! Double, expected = a[key] as! Double
                    guard abs(actual - expected) < 1e-9 else { XCTFail("seed \(seed), frame \(frame), \(key): \(actual) != \(expected)"); return }
                }
                for i in 0..<3 { XCTAssertEqual(baseline.pose.w[i], shared.pose.w[i], accuracy: 1e-10) }
            }
        }
    }
    func testSharedReadingUsesNativeHierarchyAndEscapesOnlyAtRendererBoundary() {
        let rows = SharedVisual.reading(answer: "<img onerror=alert(1)> & B", detail: "x = \\(1+2\\)", review: true)
        XCTAssertEqual(rows[1].text, "<img onerror=alert(1)> & B")
        XCTAssertEqual(rows[1].size, InformationHierarchy.conclusionSize)
        XCTAssertEqual(rows.last?.size, InformationHierarchy.bodySize)
        XCTAssertEqual(rows.count, 5)
        XCTAssertEqual(SharedVisual.reading(answer: "B", detail: "", review: false, explaining: true).count, 3)
    }
}
