import AppKit
import XCTest
@testable import NotchSPI

final class ScreenshotFlightTests: XCTestCase {
    @MainActor private func image() -> NSImage {
        let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 800, pixelsHigh: 500,
            bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
            colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
        let image = NSImage(size: NSSize(width: 800, height: 500))
        image.addRepresentation(bitmap)
        return image
    }

    @MainActor func testRenderedFlightLiftsOriginalPixelsAndTracksMovingSlotBeforeLandingOnce() throws {
        let flight = ScreenshotFlight()
        flight.qaManualClock = true; flight.qaReduceMotion = false
        defer { flight.cancelAll() }
        let id = UUID(), source = CGRect(x: -500, y: 100, width: 800, height: 500)
        var destination = ScreenshotFlightGeometry.cardFrame(image: CGSize(width: 800, height: 500),
            in: CGRect(x: 400, y: 900, width: 128, height: 80))
        var arrivals = 0
        flight.fly(id: id, image: image(), from: source, destination: { destination }, landed: { arrivals += 1 })
        let initial = try XCTUnwrap(flight.qaSnapshot(id))
        XCTAssertEqual(initial.frame, source)
        XCTAssertEqual(initial.inset, 0)
        XCTAssertEqual(initial.angle, 0)
        flight.qaAdvance(by: ScreenshotFlightGeometry.duration / 2)
        let halfway = try XCTUnwrap(flight.qaSnapshot(id))
        XCTAssertEqual(halfway.inset, 2, accuracy: 0.00001)
        XCTAssertEqual(abs(halfway.angle), 2.2 * .pi / 180, accuracy: 0.00001)
        XCTAssertEqual(halfway.opacity, 1)
        XCTAssertEqual(arrivals, 0, "Visual arrival must not occur during travel")
        destination.origin.y -= 30 // The notch can grow while answer tokens arrive.
        flight.qaAdvance(by: ScreenshotFlightGeometry.duration * 0.4)
        let approaching = try XCTUnwrap(flight.qaSnapshot(id))
        let expected = ScreenshotFlightGeometry.frame(source: source, destination: destination, progress: 0.9, reduced: false)
        XCTAssertEqual(approaching.frame.minY, expected.minY, accuracy: 0.00001)
        flight.qaAdvance(by: ScreenshotFlightGeometry.duration)
        XCTAssertEqual(arrivals, 1)
        XCTAssertNil(flight.qaSnapshot(id), "The desktop overlay leaves after the tray takes over")
        flight.qaAdvance(by: 10)
        XCTAssertEqual(arrivals, 1)
    }

    @MainActor func testIndependentFlightsCancelWithoutLateArrivalAndMissingSlotCleansUp() {
        let flight = ScreenshotFlight()
        flight.qaManualClock = true; flight.qaReduceMotion = false
        let first = UUID(), second = UUID(), source = CGRect(x: 0, y: 0, width: 800, height: 500)
        var arrivals = 0
        for id in [first, second] {
            flight.fly(id: id, image: image(), from: source, destination: { source }, landed: { arrivals += 1 })
        }
        flight.qaAdvance(by: 0.2)
        XCTAssertNotNil(flight.qaSnapshot(first)); XCTAssertNotNil(flight.qaSnapshot(second))
        flight.cancelAll(); flight.qaAdvance(by: 10)
        XCTAssertNil(flight.qaSnapshot(first)); XCTAssertNil(flight.qaSnapshot(second))
        XCTAssertEqual(arrivals, 0)
        flight.fly(id: first, image: image(), from: source, destination: { nil }, landed: { arrivals += 1 })
        XCTAssertNil(flight.qaSnapshot(first))
        XCTAssertEqual(arrivals, 1, "A lost destination releases the hidden tray slot once")
    }

    @MainActor func testReducedMotionAndUnknownSourceFadeAtDestinationWithoutTravelOrTilt() throws {
        for source in [CGRect(x: -500, y: 0, width: 800, height: 500), nil] {
            let flight = ScreenshotFlight()
            flight.qaManualClock = true; flight.qaReduceMotion = source != nil
            defer { flight.cancelAll() }
            let id = UUID(), end = CGRect(x: 500, y: 900, width: 128, height: 80)
            var arrivals = 0
            flight.fly(id: id, image: image(), from: source, destination: { end }, landed: { arrivals += 1 })
            flight.qaAdvance(by: 0.09)
            let snapshot = try XCTUnwrap(flight.qaSnapshot(id))
            XCTAssertEqual(snapshot.frame, end)
            XCTAssertEqual(snapshot.angle, 0)
            XCTAssertEqual(snapshot.opacity, 0.5, accuracy: 0.00001)
            flight.qaAdvance(by: 0.1)
            XCTAssertEqual(arrivals, 1); XCTAssertNil(flight.qaSnapshot(id))
        }
    }
}
