import AppKit
import XCTest
@testable import NotchSPI

final class CaptureWindowIdentityTests: XCTestCase {
    func testWarmWindowMustMatchTheFreshSelectionOwnerAndGeometry() {
        let frame = CGRect(x: 20, y: 40, width: 800, height: 600)
        let context = ScreenCapture.Context(displayID: 1, primaryHeight: 1000, foreground: "fixture",
            window: .init(id: 42, processID: 100, frame: frame))
        XCTAssertTrue(context.canReuseWindow(id: 42, processID: 100, frame: frame))
        XCTAssertFalse(context.canReuseWindow(id: 43, processID: 100, frame: frame), "A neighboring document cannot replace the selected one")
        XCTAssertFalse(context.canReuseWindow(id: 42, processID: 101, frame: frame), "A relaunched owner invalidates its old handle")
        XCTAssertFalse(context.canReuseWindow(id: 42, processID: 100, frame: frame.offsetBy(dx: 30, dy: 0)), "Moved windows require fresh geometry")
        XCTAssertFalse(context.canReuseWindow(id: 42, processID: 100, frame: CGRect(x: 20, y: 40, width: 400, height: 600)), "Resizing must not reuse stale dimensions")
        let gone = ScreenCapture.Context(displayID: 1, primaryHeight: 1000, foreground: "fixture", window: nil)
        XCTAssertFalse(gone.canReuseWindow(id: 42, processID: 100, frame: frame), "A cached window cannot resurrect a missing selection")
    }
}
