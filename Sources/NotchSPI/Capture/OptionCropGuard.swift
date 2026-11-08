import Foundation
import CoreGraphics
import ImageIO
import Vision

/// A narrow input check, not a general OCR solver. It requires a clipped white-paper
/// edge, an explicit A…D-style range and regularly spaced, aligned option rows.
enum OptionCropGuard {
    struct Line: Sendable {
        let text: String
        let confidence: Float
        let x: Double
        let y: Double
        let height: Double
    }

    @MainActor private static let operation = CaptureSystemOperation<Bool>()

    @MainActor static func shouldRetake(path: String) async -> Bool {
        do {
            return try await operation.run(timeout: 1) {
                try await Task.detached(priority: .userInitiated) { try detect(path: path) }.value
            }
        } catch { return false } // Unknown/busy/timed-out evidence retains the existing solver.
    }

    static func detect(path: String) throws -> Bool {
        guard let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil),
              let image = CGImageSourceCreateImageAtIndex(source, 0, nil),
              hasClippedPaperEdge(image) else { return false }
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .fast
        request.recognitionLanguages = ["en-US"] // Only Latin labels/ranges; no Japanese interpretation.
        request.usesLanguageCorrection = false
        try VNImageRequestHandler(cgImage: image).perform([request])
        let lines = (request.results ?? []).compactMap { observation -> Line? in
            guard let candidate = observation.topCandidates(1).first else { return nil }
            return .init(text: candidate.string, confidence: candidate.confidence,
                         x: observation.boundingBox.minX, y: observation.boundingBox.minY,
                         height: observation.boundingBox.height)
        }
        return isClearlyMissingOptions(lines, clippedEdge: true)
    }

    static func hasClippedPaperEdge(_ image: CGImage) -> Bool {
        guard image.width >= 320, image.height >= 100,
              let strip = image.cropping(to: CGRect(x: 0, y: image.height - 2, width: image.width, height: 2)) else { return false }
        var pixels = [UInt8](repeating: 255, count: strip.width * 2 * 4)
        let drawn = pixels.withUnsafeMutableBytes { bytes -> Bool in
            guard let context = CGContext(data: bytes.baseAddress, width: strip.width, height: 2, bitsPerComponent: 8,
                bytesPerRow: strip.width * 4, space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
            context.setFillColor(CGColor(gray: 1, alpha: 1)); context.fill(CGRect(x: 0, y: 0, width: strip.width, height: 2))
            context.draw(strip, in: CGRect(x: 0, y: 0, width: strip.width, height: 2)); return true
        }
        guard drawn else { return false }
        var white = 0, dark = 0
        for offset in stride(from: 0, to: pixels.count, by: 4) {
            if pixels[offset + 3] < 250 { white += 1; continue }
            let rgb = pixels[offset...offset + 2]
            if rgb.allSatisfy({ $0 >= 240 }) { white += 1 }
            if rgb.allSatisfy({ $0 <= 80 }) { dark += 1 }
        }
        let count = strip.width * 2
        return white * 100 >= count * 85 && dark >= 2 && dark * 10 < count
    }

    static func isClearlyMissingOptions(_ lines: [Line], clippedEdge: Bool) -> Bool {
        guard clippedEdge else { return false }
        let normalized = lines.map { line in
            (line, line.text.precomposedStringWithCompatibilityMapping.replacingOccurrences(of: " ", with: ""))
        }
        let ranges = normalized.compactMap { line, text -> Int? in
            guard line.confidence >= 0.5, line.y >= 0.7, line.x < 0.2,
                  let range = text.range(of: "A[~〜～–—−-][C-H]", options: .regularExpression),
                  let end = text[range].last?.asciiValue else { return nil }
            return Int(end - 65) + 1
        }
        guard ranges.count == 1, let expected = ranges.first else { return false }
        let options = normalized.compactMap { line, text -> (Int, Line)? in
            guard line.confidence >= 0.5, line.y < 0.7, line.x < 0.2, line.height > 0,
                  text.range(of: "^[A-H][.、:)]\\S", options: .regularExpression) != nil,
                  let first = text.first?.asciiValue else { return nil }
            return (Int(first - 65), line)
        }.sorted { $0.1.y > $1.1.y }
        guard options.count >= 2, options.count < expected,
              options.map({ $0.0 }) == Array(0..<options.count) else { return false }
        let heights = options.map { $0.1.height }, meanHeight = heights.reduce(0, +) / Double(heights.count)
        let gaps = zip(options, options.dropFirst()).map { $0.1.y - $1.1.y }
        guard let firstGap = gaps.first, firstGap > meanHeight * 1.5,
              gaps.allSatisfy({ abs($0 - firstGap) <= firstGap * 0.15 }),
              options.allSatisfy({ abs($0.1.x - options[0].1.x) <= 0.025 && abs($0.1.height - meanHeight) <= meanHeight * 0.25 }),
              let last = options.last else { return false }
        // A further required row would begin beyond the clipped edge; never infer missing
        // choices from an OCR omission while there is still space for them in the image.
        return last.1.y - firstGap <= 0.01
    }
}
