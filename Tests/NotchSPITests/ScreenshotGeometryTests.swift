import AppKit
import XCTest
@testable import NotchSPI

final class ScreenshotGeometryTests: XCTestCase {
    func testQuartzConversionHandlesDisplaysAboveBelowAndLeftInPoints() {
        for rect in [CGRect(x: -1600, y: 120, width: 900, height: 600),
                     CGRect(x: 100, y: -1200, width: 800, height: 1000),
                     CGRect(x: 0, y: 1080, width: 1920, height: 1080)] {
            let frame = ScreenCapture.Context.appKitFrame(rect, primaryHeight: 1080)
            XCTAssertEqual(frame.minX, rect.minX)
            XCTAssertEqual(frame.maxY, 1080 - rect.minY)
            XCTAssertEqual(frame.size, rect.size, "Retina scale changes pixels, not global point coordinates")
        }
    }
    func testFlightPreservesPortraitAndUltrawideImageRatiosAndExactLanding() {
        for image in [CGSize(width: 400, height: 1200), CGSize(width: 2400, height: 800)] {
            let start = ScreenshotFlightGeometry.cardFrame(image: image, in: CGRect(x: -900, y: 100, width: image.width, height: image.height))
            let end = ScreenshotFlightGeometry.cardFrame(image: image, in: CGRect(x: 450, y: 900, width: 104, height: 68))
            for t in [CGFloat(0), 0.1, 0.5, 0.9, 1] {
                let frame = ScreenshotFlightGeometry.frame(source: start, destination: end, progress: t, reduced: false)
                XCTAssertEqual((frame.width-8)/(frame.height-8), image.width/image.height, accuracy: 0.00001)
            }
            XCTAssertEqual(ScreenshotFlightGeometry.frame(source: start, destination: end, progress: 0, reduced: false), start)
            let landing = ScreenshotFlightGeometry.frame(source: start, destination: end, progress: 1, reduced: false)
            XCTAssertEqual(landing.minX, end.minX, accuracy: 0.00001)
            XCTAssertEqual(landing.height, end.height, accuracy: 0.00001)
            XCTAssertEqual(ScreenshotFlightGeometry.frame(source: start, destination: end, progress: 0.4, reduced: true), end)
        }
    }
}
