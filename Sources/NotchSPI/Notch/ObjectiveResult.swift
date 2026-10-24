import Foundation

enum ObjectiveQuestionKind: String, Codable, CaseIterable {
    case singleChoice = "single_choice"
    case multipleChoice = "multiple_choice"
    case ordering
    case shortFill = "short_fill"
    case other
}

enum ObjectiveResultState: String, Codable {
    case ready, review, retake
}

enum ObjectiveResultReason: String, Codable {
    case none
    case ambiguousQuestion = "ambiguous_question"
    case ambiguousOptions = "ambiguous_options"
    case cropped, unreadable
    case missingContext = "missing_context"
    case unsupported
}

struct ObjectiveResultV1: Codable, Equatable {
    let v: Int
    let kind: ObjectiveQuestionKind
    let state: ObjectiveResultState
    let answer: String?
    let reason: ObjectiveResultReason
}

enum ObjectiveParserPath: String, Codable {
    case v1
    case legacyFallback = "legacy_fallback"
    case legacy
    case none
}

enum ObjectiveProtocolViolation: String, Codable, Equatable {
    case duplicateMarker, markerNotLast, invalidJSON, oversizedJSON, unknownField
    case invalidEnum, invalidStateCombination, finalMismatch, missingUsableResult
}

struct ObjectiveResultComposition: Equatable, Decodable {
    let visibleText: String
    let finalAnswer: String?
    let result: ObjectiveResultV1?
    let state: ObjectiveResultState?
    let parserPath: ObjectiveParserPath
    let violations: [ObjectiveProtocolViolation]
    var noResultReason: String? = nil
}

enum ObjectiveResultParser {
    static let marker = "NSPI_RESULT_V1:"

    static func normalizeAnswer(_ source: String) -> String {
        var value = source.precomposedStringWithCompatibilityMapping
            .trimmingCharacters(in: .whitespacesAndNewlines)
        value = value.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
        var changed = true
        while changed {
            changed = false
            for fence in ["**", "__", "`"] where value.hasPrefix(fence) && value.hasSuffix(fence)
                && value.count > fence.count * 2 {
                value = String(value.dropFirst(fence.count).dropLast(fence.count))
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                changed = true
            }
        }
        if value.range(of: #"^[A-Za-z]$"#, options: .regularExpression) != nil {
            return value.uppercased()
        }
        return value
    }

    static func compose(raw: String, protocolEnabled: Bool = true) -> ObjectiveResultComposition {
        if raw.contains("NSPI_NO_RESULT_V1:") {
            let reason = ScreenQueryDiagnostic.parse(raw)
            return .init(visibleText: "", finalAnswer: nil, result: nil, state: nil, parserPath: .none,
                         violations: reason == nil ? [.invalidJSON] : [], noResultReason: reason)
        }
        return SharedObjective.compose(raw, enabled: protocolEnabled)
    }

}

/// Incremental presentation filter. It never exposes a marker line, including partial prefixes.
struct ObjectiveResultStreamFilter {
    private(set) var rawBuffer = ""
    private var overflow = false

    mutating func append(_ delta: String) -> String {
        guard !overflow, rawBuffer.utf8.count + delta.utf8.count <= 64 * 1024 else {
            overflow = true; rawBuffer = ""; return ""
        }
        rawBuffer += delta
        return visible(streaming: true)
    }

    mutating func finish() -> ObjectiveResultComposition {
        ObjectiveResultParser.compose(raw: rawBuffer)
    }

    private func visible(streaming: Bool) -> String {
        let normalized = rawBuffer.replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
        var lines = normalized.components(separatedBy: "\n")
        let openLast = !normalized.hasSuffix("\n")
        lines = lines.enumerated().compactMap { index, line in
            let markers = [ObjectiveResultParser.marker, "NSPI_NO_RESULT_V1:"]
            if markers.contains(where: { line.contains($0) }) { return nil }
            if streaming && openLast && index == lines.count - 1 {
                let candidate = line.drop(while: { $0 == " " || $0 == "\t" })
                if !candidate.isEmpty && markers.contains(where: { $0.hasPrefix(String(candidate)) }) { return nil }
            }
            return line
        }
        return lines.joined(separator: "\n")
    }
}


enum ScreenQueryDiagnostic {
    private struct Payload: Decodable { let v: Int; let reason: String }
    static func parse(_ text: String) -> String? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        let marker = "NSPI_NO_RESULT_V1:"
        guard trimmed.hasPrefix(marker) else { return nil }
        let payload = String(trimmed.dropFirst(marker.count)).trimmingCharacters(in: .whitespaces)
        guard !payload.contains("\n"), !payload.contains("\r"), payload.utf8.count <= 4096,
              let data = payload.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              Set(object.keys) == Set(["v", "reason"]),
              let regex = try? NSRegularExpression(pattern: #""([^"\\]*)"\s*:"#),
              regex.numberOfMatches(in: payload, range: NSRange(payload.startIndex..., in: payload)) == 2,
              let decoded = try? JSONDecoder().decode(Payload.self, from: data), decoded.v == 1,
              ["unsupported_scope", "multiple_targets"].contains(decoded.reason) else { return nil }
        return decoded.reason
    }
}
