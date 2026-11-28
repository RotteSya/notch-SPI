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

    private func window(_ id: CGWindowID, _ frame: CGRect, pid: pid_t = 100) -> ScreenCapture.WindowIdentity {
        .init(id: id, processID: pid, frame: frame)
    }

    func testFullScreenToolbarStripYieldsToTheContentWindowBehindIt() {
        // Geometry measured from a full-screen Chrome on a 1512x982 display.
        let page = window(2, CGRect(x: 0, y: 121, width: 1512, height: 861))
        for stripHeight in [124.0, 148.0] { // without and with the bookmarks bar
            let strip = window(1, CGRect(x: 0, y: 33, width: 1512, height: stripHeight))
            XCTAssertEqual(ScreenCapture.Context.preferredWindow(among: [(strip, true), (page, true)]), page)
            XCTAssertEqual(ScreenCapture.Context.preferredWindow(among: [(page, true), (strip, true)]), page)
        }
    }

    func testFrontmostVisibleWindowStillWinsWhenItIsNotAToolbarStrip() {
        let main = window(2, CGRect(x: 0, y: 38, width: 1470, height: 855))
        let popup = window(1, CGRect(x: 300, y: 200, width: 600, height: 400))
        XCTAssertEqual(ScreenCapture.Context.preferredWindow(among: [(popup, true), (main, true)]), popup,
                       "A small test popup in front of the browser stays the target")
        let upperHalf = window(3, CGRect(x: 0, y: 38, width: 1470, height: 400))
        XCTAssertEqual(ScreenCapture.Context.preferredWindow(among: [(upperHalf, true), (main, true)]), upperHalf,
                       "Same width alone does not make a window a toolbar")
        let detached = window(4, CGRect(x: 0, y: 500, width: 1470, height: 124))
        let lower = window(5, CGRect(x: 0, y: 700, width: 1470, height: 600))
        XCTAssertEqual(ScreenCapture.Context.preferredWindow(among: [(detached, true), (lower, true)]), detached,
                       "A strip must sit on its content window")
        let otherApp = window(6, CGRect(x: 0, y: 33, width: 1470, height: 124), pid: 200)
        XCTAssertEqual(ScreenCapture.Context.preferredWindow(among: [(otherApp, true), (main, true)]), otherApp,
                       "Only windows of one process form a toolbar pair")
    }

    func testHiddenWindowsFallBackToTheLargest() {
        let small = window(1, CGRect(x: 0, y: 0, width: 400, height: 300))
        let large = window(2, CGRect(x: 0, y: 0, width: 1200, height: 800))
        XCTAssertEqual(ScreenCapture.Context.preferredWindow(among: [(small, false), (large, false)]), large)
        XCTAssertEqual(ScreenCapture.Context.preferredWindow(among: [(large, false), (small, true)]), small,
                       "A visible window beats a larger hidden one")
        XCTAssertNil(ScreenCapture.Context.preferredWindow(among: []))
    }
}
