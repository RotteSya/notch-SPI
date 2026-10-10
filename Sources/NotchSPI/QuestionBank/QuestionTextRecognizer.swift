import CoreGraphics
import Foundation
import ImageIO
import Vision

struct OCRLine: Equatable, Sendable {
    var text: String
    var x: Double
    var y: Double
    var width: Double
    var height: Double
    var confidence: Float
}

struct QuestionRecognition: Equatable, Sendable {
    var lines: [OCRLine]
}

struct ExtractedOption: Equatable, Sendable {
    var label: String
    var text: String
}

enum ExtractedQuestion: Equatable, Sendable {
    case choice(stem: String, options: [ExtractedOption])
    case fill(stem: String)
    case miss
}

enum QuestionCandidateExtractor {
    static func extract(_ lines: [OCRLine]) -> ExtractedQuestion {
        guard !lines.isEmpty else { return .miss }
        guard lines.allSatisfy({ $0.confidence >= 0.35 }) else { return .miss }
        let rows = readingRows(lines)
        guard !rows.contains(where: isSplitColumn) else { return .miss }
        let textRows = rows.map { $0.map(\.text).joined(separator: " ") }.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
        guard !textRows.isEmpty else { return .miss }
        var options: [ExtractedOption] = []
        var stemRows: [String] = []
        var started = false
        for row in textRows {
            if let option = parseOption(row) {
                started = true
                options.append(option)
            } else if started {
                return .miss
            } else {
                stemRows.append(row)
            }
        }
        let stem = stemRows.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !stem.isEmpty, !referencesMissingMaterial(stem) else { return .miss }
        if questionNumberCount(stemRows) > 1 { return .miss }
        if options.isEmpty { return .fill(stem: stem) }
        let expected = options.enumerated().map { Character(UnicodeScalar(65 + $0.offset)!) }
        guard options.count >= 2, options.count <= 6, options.map(\.label) == expected.map(String.init) else { return .miss }
        guard options.allSatisfy({ !$0.text.isEmpty }) else { return .miss }
        return .choice(stem: stem, options: options)
    }

    static func parseOption(_ raw: String) -> ExtractedOption? {
        let line = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let first = line.first else { return nil }
        if first == "(" || first == "（" {
            let close: Character = first == "(" ? ")" : "）"
            guard let end = line.firstIndex(of: close) else { return nil }
            let inside = line[line.index(after: line.startIndex)..<end].trimmingCharacters(in: .whitespaces)
            guard inside.count == 1, let label = inside.first, ("A"..."F").contains(label) else { return nil }
            var rest = line[line.index(after: end)...].drop(while: { $0 == " " || $0 == "." || $0 == "、" || $0 == ":" || $0 == "：" })
            rest = rest.drop(while: { $0 == " " })
            guard !rest.isEmpty else { return nil }
            return ExtractedOption(label: String(label), text: String(rest))
        }
        guard ("A"..."F").contains(first) else { return nil }
        let markIndex = line.index(after: line.startIndex)
        guard markIndex < line.endIndex else { return nil }
        let mark = line[markIndex]
        guard mark == "." || mark == "、" || mark == ":" || mark == "：" || mark == ")" || mark == "）" else { return nil }
        let rest = line[line.index(after: markIndex)...].trimmingCharacters(in: .whitespaces)
        guard !rest.isEmpty else { return nil }
        return ExtractedOption(label: String(first), text: rest)
    }

    private static func readingRows(_ lines: [OCRLine]) -> [[OCRLine]] {
        let sorted = lines.sorted { lhs, rhs in
            if abs(lhs.y - rhs.y) > 0.012 { return lhs.y < rhs.y }
            return lhs.x < rhs.x
        }
        var rows: [[OCRLine]] = []
        for line in sorted {
            if let index = rows.indices.last, let anchor = rows[index].first, abs(anchor.y - line.y) <= max(0.02, anchor.height * 0.6) {
                rows[index].append(line)
                rows[index].sort { $0.x < $1.x }
            } else {
                rows.append([line])
            }
        }
        return rows
    }

    private static func isSplitColumn(_ row: [OCRLine]) -> Bool {
        guard row.count >= 2 else { return false }
        let ordered = row.sorted { $0.x < $1.x }
        for pair in zip(ordered, ordered.dropFirst()) {
            let gap = pair.1.x - (pair.0.x + pair.0.width)
            if gap > 0.18 && pair.0.width > 0.05 && pair.1.width > 0.05 { return true }
        }
        return false
    }

    private static func questionNumberCount(_ rows: [String]) -> Int {
        rows.filter { row in
            let text = row.trimmingCharacters(in: .whitespaces)
            if text.hasPrefix("（"), let end = text.firstIndex(of: "）") {
                let inside = text[text.index(after: text.startIndex)..<end]
                return !inside.isEmpty && inside.allSatisfy(\.isNumber)
            }
            let digits = text.prefix { $0.isNumber }
            guard !digits.isEmpty, digits.count < text.count else { return false }
            let mark = text[text.index(text.startIndex, offsetBy: digits.count)]
            return mark == "." || mark == "、"
        }.count
    }

    private static func referencesMissingMaterial(_ stem: String) -> Bool {
        let folded = stem.folding(options: [.caseInsensitive], locale: Locale(identifier: "en"))
        let phrases = ["见图", "如下图", "如图所示", "见材料", "阅读上文", "根据上文", "see the figure", "see the passage", "refer to the passage"]
        return phrases.contains { folded.contains($0) }
    }
}

protocol QuestionOCREngine: Sendable {
    func recognize(image: Data, languages: [String]) async -> QuestionRecognition
}

enum RecognitionGateResult: Equatable, Sendable {
    case lines(QuestionRecognition)
    case busy
    case timedOut
}

actor RecognitionGate {
    private var busy = false
    private let engine: QuestionOCREngine

    init(engine: QuestionOCREngine) { self.engine = engine }

    func recognize(image: Data, languages: [String], deadline: TimeInterval, now: @escaping @Sendable () -> TimeInterval) async -> RecognitionGateResult {
        if busy { return .busy }
        busy = true
        let task = Task { await engine.recognize(image: image, languages: languages) }
        let remaining = deadline - now()
        guard remaining > 0 else {
            releaseWhenFinished(task)
            return .timedOut
        }
        if let value = await wait(task, seconds: remaining) {
            busy = false
            return .lines(value)
        }
        releaseWhenFinished(task)
        return .timedOut
    }

    private func releaseWhenFinished(_ task: Task<QuestionRecognition, Never>) {
        Task { [weak self] in
            _ = await task.value
            await self?.markIdle()
        }
    }

    private func markIdle() { busy = false }

    private func wait(_ task: Task<QuestionRecognition, Never>, seconds: TimeInterval) async -> QuestionRecognition? {
        await withCheckedContinuation { continuation in
            let once = ResumeOnce()
            Task {
                let value = await task.value
                if once.take() { continuation.resume(returning: value) }
            }
            Task {
                try? await Task.sleep(nanoseconds: UInt64(max(0, seconds) * 1_000_000_000))
                if once.take() { continuation.resume(returning: nil) }
            }
        }
    }
}

final class ResumeOnce: @unchecked Sendable {
    private let lock = NSLock()
    private var taken = false
    func take() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        if taken { return false }
        taken = true
        return true
    }
}

final class ScriptedQuestionOCR: QuestionOCREngine, @unchecked Sendable {
    var delayNanoseconds: UInt64 = 0
    var result = QuestionRecognition(lines: [])
    private let lock = NSLock()
    private var callCount = 0
    var calls: Int { withLock { callCount } }

    func recognize(image: Data, languages: [String]) async -> QuestionRecognition {
        recordCall()
        if delayNanoseconds > 0 { try? await Task.sleep(nanoseconds: delayNanoseconds) }
        return result
    }

    private func recordCall() {
        lock.lock()
        callCount += 1
        lock.unlock()
    }

    private func withLock<T>(_ body: () -> T) -> T {
        lock.lock()
        defer { lock.unlock() }
        return body()
    }
}

struct VisionQuestionOCR: QuestionOCREngine {
    func recognize(image: Data, languages: [String]) async -> QuestionRecognition {
        await Task.detached(priority: .userInitiated) {
            Self.read(image: image, languages: languages)
        }.value
    }

    private static func read(image: Data, languages: [String]) -> QuestionRecognition {
        guard let source = CGImageSourceCreateWithData(image as CFData, nil),
              let cgImage = CGImageSourceCreateImageAtIndex(source, 0, nil) else { return QuestionRecognition(lines: []) }
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = false
        let supported = (try? request.supportedRecognitionLanguages()) ?? []
        let requested = languages.filter { language in supported.contains { $0.caseInsensitiveCompare(language) == .orderedSame } }
        guard !requested.isEmpty else { return QuestionRecognition(lines: []) }
        request.recognitionLanguages = requested
        let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
        do { try handler.perform([request]) } catch { return QuestionRecognition(lines: []) }
        let lines = (request.results ?? []).compactMap { observation -> OCRLine? in
            guard let candidate = observation.topCandidates(1).first else { return nil }
            let box = observation.boundingBox
            return OCRLine(text: candidate.string, x: box.minX, y: 1 - box.maxY, width: box.width, height: box.height, confidence: candidate.confidence)
        }
        return QuestionRecognition(lines: lines)
    }
}
