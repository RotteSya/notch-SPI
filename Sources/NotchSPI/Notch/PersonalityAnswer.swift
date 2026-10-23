import Foundation

struct PersonalityContextItem: Codable, Equatable {
    let ordinal: String
    let summary: String
    let choice: String
}

struct PersonalityContextPayload: Codable, Equatable {
    let last: PersonalityContextItem
    let referenceable: [PersonalityContextItem]
}

struct PersonalityChoiceLine: Codable, Equatable {
    /// Canonical decimal ordinal (for example, `Q１` and `（１）` both become `1`).
    let ordinal: String
    /// Choice text with surrounding Markdown and whitespace normalized for exact validation.
    let choice: String
    /// Sanitized line used by the notch. Machine lines and prose never reach this field.
    let visibleText: String
}

enum PersonalityProtocolViolation: String, Codable, Equatable {
    case prose
    case invalidContext
    case missingContext
    case duplicateContextMarker
    case invalidError
    case duplicateErrorMarker
    case invalidErrorCombination
    case noValidChoices
}

struct PersonalityAnswerComposition: Codable, Equatable {
    let visibleChoices: String
    let finalizedChoices: [PersonalityChoiceLine]
    let provisionalChoice: PersonalityChoiceLine?
    let context: PersonalityContextPayload?
    let errorCode: String?
    let errorOrdinals: [String]
    let violations: [PersonalityProtocolViolation]

    var hasFinalizedChoices: Bool { !finalizedChoices.isEmpty }
}

enum PersonalityAnswer {
    static func compose(raw: String, streaming: Bool) -> PersonalityAnswerComposition {
        SharedPersonality.compose(raw, streaming: streaming)
    }
    static func normalizeOrdinal(_ source: String) -> String? { SharedPersonality.ordinal(source) }
    static func normalizeChoice(_ source: String) -> String { SharedPersonality.choice(source) }
    static func isTerminalError(_ code: String?) -> Bool { SharedPersonality.isTerminal(code) }
}
