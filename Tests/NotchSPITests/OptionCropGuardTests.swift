import XCTest
import CoreGraphics
@testable import NotchSPI

final class OptionCropGuardTests: XCTestCase {
    private func line(_ text: String, x: Double = 0.03, y: Double, height: Double = 0.065,
                      confidence: Float = 0.5) -> OptionCropGuard.Line {
        .init(text: text, confidence: confidence, x: x, y: y, height: height)
    }
    private var clipped: [OptionCropGuard.Line] {
        [line("Q1 A～D", y: 0.83), line("A.48", y: 0.412, confidence: 1), line("B.50", y: 0.203)]
    }

    func testRequiresExplicitRangeAlignedPrefixAndGeometricEvidenceOfTheNextCutRow() {
        XCTAssertTrue(OptionCropGuard.isClearlyMissingOptions(clipped, clippedEdge: true))
        XCTAssertFalse(OptionCropGuard.isClearlyMissingOptions(clipped, clippedEdge: false))
        let negatives: [[OptionCropGuard.Line]] = [
            Array(clipped.dropFirst()),
            [line("A~D", y: 0.83, confidence: 0.3)] + Array(clipped.dropFirst()),
            [line("A~D", y: 0.5)] + Array(clipped.dropFirst()),
            [clipped[0], clipped[1]],
            [clipped[0], clipped[1], line("B.50", x: 0.2, y: 0.203)],
            [clipped[0], line("A.48", y: 0.6), line("B.50", y: 0.45)],
            [clipped[0], clipped[1], line("C.51", y: 0.203)],
            [line("A~D and A~E", y: 0.83), clipped[0]] + Array(clipped.dropFirst()),
            [clipped[0], line("A.1", y: 0.6), line("B.2", y: 0.45), line("C.3", y: 0.3), line("D.4", y: 0.15)],
        ]
        for value in negatives { XCTAssertFalse(OptionCropGuard.isClearlyMissingOptions(value, clippedEdge: true)) }
    }

    private func image(background: UInt8, ink: Bool) throws -> CGImage {
        let width = 640, height = 330
        var bytes = [UInt8](repeating: background, count: width * height * 4)
        for offset in stride(from: 3, to: bytes.count, by: 4) { bytes[offset] = 255 }
        if ink {
            for y in (height - 2)..<height { for x in 30..<40 {
                for channel in 0..<3 { bytes[(y * width + x) * 4 + channel] = 0 }
            } }
        }
        return try XCTUnwrap(CGImage(width: width, height: height, bitsPerComponent: 8, bitsPerPixel: 32,
            bytesPerRow: width * 4, space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue),
            provider: CGDataProvider(data: Data(bytes) as CFData)!, decode: nil, shouldInterpolate: false, intent: .defaultIntent))
    }

    func testPaperEdgeRequiresActualSmallDarkMarksAndSkipsOrdinaryWhiteOrDarkBackgrounds() throws {
        XCTAssertTrue(OptionCropGuard.hasClippedPaperEdge(try image(background: 255, ink: true)))
        XCTAssertFalse(OptionCropGuard.hasClippedPaperEdge(try image(background: 255, ink: false)))
        XCTAssertFalse(OptionCropGuard.hasClippedPaperEdge(try image(background: 32, ink: true)))
    }

    private struct Frozen: Decodable {
        struct Item: Decodable { let id: String; let image: String }
        let cases: [Item]
    }
    private func frozen() throws -> Frozen {
        guard let path = ProcessInfo.processInfo.environment["NSPI_OPTION_CROP_FIXTURES"] else {
            throw XCTSkip("Optional local frozen input test; on-device Vision only")
        }
        return try JSONDecoder().decode(Frozen.self, from: Data(contentsOf: URL(fileURLWithPath: path)))
    }

    @MainActor func testFrozenSixteenRejectsOnlyKnownClippedInputWithoutCallingAProvider() async throws {
        let fixture = try frozen(); XCTAssertEqual(fixture.cases.count, 16)
        var rows: [[String: Any]] = []
        for item in fixture.cases {
            let path = URL(fileURLWithPath: FileManager.default.currentDirectoryPath).appendingPathComponent(item.image).path
            let started = ProcessInfo.processInfo.systemUptime
            let cropped = await OptionCropGuard.shouldRetake(path: path)
            rows.append(["id": item.id, "cropped": cropped, "elapsed_ms": (ProcessInfo.processInfo.systemUptime - started) * 1000])
            XCTAssertEqual(cropped, item.id == "cropped-options", item.id)
        }
        if let output = ProcessInfo.processInfo.environment["NSPI_OPTION_CROP_REPORT"] {
            try JSONSerialization.data(withJSONObject: rows, options: [.prettyPrinted, .sortedKeys])
                .write(to: URL(fileURLWithPath: output))
        }
    }

    @MainActor func testRealSingleIntakeRejectsClippedFixtureBeforeAnySubmissionAndMultipleIntakePreservesContext() async throws {
        let item = try XCTUnwrap(try frozen().cases.first { $0.id == "cropped-options" })
        let savedMode = Settings.shared.mode, savedService = Settings.shared.serviceMode
        defer { Settings.shared.mode = savedMode; Settings.shared.serviceMode = savedService }
        Settings.shared.mode = "tutor"; Settings.shared.serviceMode = "official"
        let source = URL(fileURLWithPath: FileManager.default.currentDirectoryPath).appendingPathComponent(item.image)
        let controller = NotchController(activateServices: false)
        defer { controller.prepareForTermination() }
        controller.qaScreenshotCapture = {
            let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".png")
            try! FileManager.default.copyItem(at: source, to: url)
            return .success(.init(path: url.path, blank: false, targetFingerprint: "fixture"))
        }
        var submissions = 0
        controller.qaScreenshotSubmit = { _, _ in submissions += 1 }
        controller.model.answer = "FINAL: A. previous question"
        controller.model.resultState = .ready
        controller.model.explanationAvailable = true
        controller.model.recoveryAvailable = true
        controller.qaPressScreenshot(multiple: false)
        for _ in 0..<100 where controller.model.screenshotCapturing { try await Task.sleep(for: .milliseconds(10)) }
        XCTAssertFalse(controller.model.screenshotCapturing)
        XCTAssertEqual(submissions, 0); XCTAssertEqual(controller.qaModelInvocations, 0)
        XCTAssertTrue(controller.model.answer.isEmpty); XCTAssertTrue(controller.model.screenshots.isEmpty)
        XCTAssertEqual(controller.model.resultState, .retake); XCTAssertEqual(controller.model.resultReason, .cropped)
        XCTAssertFalse(controller.model.explanationAvailable); XCTAssertFalse(controller.model.recoveryAvailable)
        XCTAssertEqual(controller.model.status, .error)
        XCTAssertFalse(controller.model.captureFeedback.isEmpty)

        controller.qaPressScreenshot(multiple: true)
        for _ in 0..<100 where controller.model.screenshotCapturing { try await Task.sleep(for: .milliseconds(10)) }
        XCTAssertEqual(controller.model.screenshots.count, 1, "An earlier context shot may intentionally lack answer choices")
        XCTAssertEqual(submissions, 0)
        controller.qaCancelScreenshotRound()
    }
}
