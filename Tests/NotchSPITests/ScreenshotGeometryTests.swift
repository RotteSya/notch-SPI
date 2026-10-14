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
            let start = ScreenshotFlightGeometry.sourceFrame(image: image, in: CGRect(x: -900, y: 100, width: image.width, height: image.height))
            let end = ScreenshotFlightGeometry.cardFrame(image: image, in: CGRect(x: 450, y: 900, width: 104, height: 68))
            for t in [CGFloat(0), 0.1, 0.5, 0.9, 1] {
                let frame = ScreenshotFlightGeometry.frame(source: start, destination: end, progress: t, reduced: false)
                let border = ScreenshotFlightGeometry.photoInset(progress: t) * 2
                XCTAssertEqual((frame.width-border)/(frame.height-border), image.width/image.height, accuracy: 0.00001)
            }
            XCTAssertEqual(ScreenshotFlightGeometry.frame(source: start, destination: end, progress: 0, reduced: false), start)
            let landing = ScreenshotFlightGeometry.frame(source: start, destination: end, progress: 1, reduced: false)
            XCTAssertEqual(landing.minX, end.minX, accuracy: 0.00001)
            XCTAssertEqual(landing.height, end.height, accuracy: 0.00001)
            XCTAssertEqual(ScreenshotFlightGeometry.frame(source: start, destination: end, progress: 0.4, reduced: true), end)
        }
    }

    func testRotatedFlightNeverEntersPhysicalCutouts() {
        let cutouts = [CGRect(x: 660, y: 944, width: 192, height: 38),
                       CGRect(x: 660, y: -38, width: 192, height: 38)]
        let source = CGRect(x: 0, y: 0, width: 1512, height: 982)
        let destination = CGRect(x: 690, y: 780, width: 128, height: 80)
        for sample in 0...100 {
            let t = CGFloat(sample) / 100
            let frame = ScreenshotFlightGeometry.frame(source: source, destination: destination, progress: t, reduced: false)
            let angle = sin(.pi * t) * 2.2 * .pi / 180
            let safe = ScreenshotFlightGeometry.avoidingCutouts(frame, angle: angle, cutouts: cutouts)
            let width = abs(cos(angle)) * safe.width + abs(sin(angle)) * safe.height
            let height = abs(sin(angle)) * safe.width + abs(cos(angle)) * safe.height
            let rotated = CGRect(x: safe.midX - width / 2, y: safe.midY - height / 2, width: width, height: height)
            for cutout in cutouts { XCTAssertFalse(rotated.intersects(cutout)) }
            XCTAssertLessThanOrEqual(safe.width, frame.width)
            XCTAssertEqual(safe.width / safe.height, frame.width / frame.height, accuracy: 0.00001)
        }
        XCTAssertEqual(ScreenshotFlightGeometry.avoidingCutouts(destination, angle: 0, cutouts: cutouts), destination)
        XCTAssertEqual(ScreenshotFlightGeometry.avoidingCutouts(source, angle: 0, cutouts: []), source)
    }

    func testLiftHasSlowEndsFastMiddleAndNoPauseOrOvershoot() {
        let samples = (0...100).map { ScreenshotFlightGeometry.travelProgress(CGFloat($0) / 100) }
        XCTAssertTrue(zip(samples, samples.dropFirst()).allSatisfy { $0 < $1 })
        XCTAssertLessThan(samples[10] - samples[0], samples[50] - samples[40])
        XCTAssertLessThan(samples[100] - samples[90], samples[60] - samples[50])
        let source = CGRect(x: -500, y: -300, width: 800, height: 500)
        let end = CGRect(x: 450, y: 900, width: 128, height: 83)
        let middle = ScreenshotFlightGeometry.frame(source: source, destination: end, progress: 0.5, reduced: false)
        XCTAssertEqual(middle.maxY, (source.maxY + end.maxY) / 2 + 30, accuracy: 0.00001)
        XCTAssertEqual(ScreenshotFlightGeometry.frame(source: source, destination: end, progress: -1, reduced: false), source)
        XCTAssertEqual(ScreenshotFlightGeometry.frame(source: source, destination: end, progress: 2, reduced: false), end)
    }
}
