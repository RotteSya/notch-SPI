import CryptoKit
import Foundation

/// Identity is conservative and versioned. Candidate folding only recalls a screenshot for review.
enum QuestionIdentity {
    static let version = 1

    static func canonicalField(_ raw: String) -> String {
        var text = raw.precomposedStringWithCanonicalMapping
        text = text.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
        return trimEdges(text)
    }

    static func candidateField(_ raw: String) -> String {
        let canonical = canonicalField(raw)
        let scalars = canonical.unicodeScalars.filter { !CharacterSet.whitespacesAndNewlines.contains($0) }
        return String(String.UnicodeScalarView(scalars))
    }

    static func searchField(_ raw: String) -> String {
        let folded = candidateField(raw)
        var scalars: [Unicode.Scalar] = []
        scalars.reserveCapacity(folded.unicodeScalars.count)
        for scalar in folded.unicodeScalars {
            if scalar >= "A" && scalar <= "Z" {
                scalars.append(Unicode.Scalar(scalar.value + 32)!)
            } else {
                scalars.append(scalar)
            }
        }
        return String(String.UnicodeScalarView(scalars))
    }

    static func orderPolicy(stem: String, options: [ChoiceOption]) -> OrderPolicy {
        guard !options.isEmpty else { return .ordered }
        let texts = options.map { canonicalField($0.text) }
        if Set(texts).count != texts.count { return .ordered }
        let haystack = ([stem] + options.map(\.text)).joined(separator: "\n")
        if containsPositionalRelation(haystack) || referencesOptionLabel(stem: stem, options: options) {
            return .ordered
        }
        return .unordered
    }

    static func identityKey(kind: QuestionKind, language: BankLanguage, stem: String, options: [ChoiceOption], policy: OrderPolicy) -> String {
        let ordered = identityOptionTexts(options, policy: policy)
        let payload = lengthPrefixed([
            ("v", String(version)),
            ("type", kind.rawValue),
            ("lang", language.rawValue),
            ("stem", canonicalField(stem)),
            ("policy", policy.rawValue),
            ("n", String(ordered.count))
        ] + ordered.enumerated().map { ("opt\($0.offset)", $0.element) })
        return SHA256.hash(data: Data(payload.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    static func candidateOptionsKey(_ options: [ChoiceOption], policy: OrderPolicy) -> String {
        let folded = options.map { candidateField($0.text) }
        let ordered = policy == .unordered ? folded.sorted() : folded
        return lengthPrefixed(ordered.enumerated().map { ("o\($0.offset)", $0.element) })
    }

    static func answerSemanticKey(answer: QuestionAnswer, options: [ChoiceOption]) -> String {
        switch answer {
        case .choice(let ids):
            let byID = Dictionary(uniqueKeysWithValues: options.map { ($0.id, canonicalField($0.text)) })
            let texts = ids.compactMap { byID[$0] }.sorted()
            return lengthPrefixed([("kind", "choice"), ("n", String(texts.count))] + texts.enumerated().map { ("a\($0.offset)", $0.element) })
        case .fill(let text, let unit):
            return lengthPrefixed([
                ("kind", "fill"),
                ("text", canonicalField(text)),
                ("unit", canonicalField(unit ?? ""))
            ])
        }
    }

    static func lengthPrefixed(_ fields: [(String, String)]) -> String {
        var out = ""
        for (label, value) in fields {
            let bytes = Array(value.utf8)
            out += label
            out += ":"
            out += String(bytes.count)
            out += ":"
            out += value
            out += "\u{1e}"
        }
        return out
    }

    static func unitRepeated(text: String, unit: String?) -> Bool {
        guard let unit, !unit.isEmpty else { return false }
        let value = canonicalField(text)
        let suffix = canonicalField(unit)
        guard !suffix.isEmpty else { return false }
        return value == suffix || value.hasSuffix(suffix) || value.hasSuffix(" " + suffix)
    }

    static func displayAnswer(kind: QuestionKind, answer: QuestionAnswer, options: [ChoiceOption], labelMap: [String: String]) -> (line: String, copy: String, selected: [String], applicable: Bool) {
        switch answer {
        case .fill(let text, let unit):
            let line = unit?.isEmpty == false ? text + " " + unit! : text
            return (line, line, [], true)
        case .choice(let ids):
            let inverse = Dictionary(labelMap.map { ($0.value, $0.key) }, uniquingKeysWith: { first, _ in first })
            let selected = options.filter { ids.contains($0.id) }
            let rendered = selected.map { option -> String in
                let label = inverse[option.id] ?? option.label
                return label + "  " + option.text
            }
            let line = rendered.joined(separator: "; ")
            let sameOrder = zip(options.map(\.label), labelMap.sorted { $0.key < $1.key }.map(\.key)).allSatisfy(==) || labelMap.isEmpty
            let applicable = labelMap.isEmpty || (sameOrder && options.map(\.label) == labelMap.keys.sorted())
            return (line, line, ids, applicable && labelMapValuesPreserveOrder(options: options, labelMap: labelMap))
        }
    }

    static func mapping(current: [(label: String, text: String)], bank: [ChoiceOption], policy: OrderPolicy) -> LabelMapping {
        let bankFolded = bank.map { (option: $0, key: candidateField($0.text)) }
        var used = Set<String>()
        var map: [String: String] = [:]
        var unique = true
        for item in current {
            let key = candidateField(item.text)
            let matches = bankFolded.filter { $0.key == key && !used.contains($0.option.id) }
            guard matches.count == 1, let match = matches.first else {
                unique = false
                continue
            }
            used.insert(match.option.id)
            map[item.label] = match.option.id
        }
        if used.count != bank.count || map.count != current.count { unique = false }
        if policy == .ordered {
            let currentKeys = current.map { candidateField($0.text) }
            let bankKeys = bank.map { candidateField($0.text) }
            if currentKeys != bankKeys { unique = false }
        }
        return LabelMapping(labelToOptionID: map, reusable: unique)
    }

    /// A complete one-to-one label map. Ordered questions also keep the bank's option order.
    static func validatedLabelMap(_ map: [String: String], bank: [ChoiceOption], policy: OrderPolicy) -> LabelMapping? {
        let bankIDs = bank.map(\.id)
        guard !bankIDs.isEmpty, map.count == bankIDs.count, Set(map.values) == Set(bankIDs) else { return nil }
        if policy == .ordered {
            let selected = map.keys.sorted().compactMap { map[$0] }
            guard selected == bankIDs else { return nil }
        }
        return LabelMapping(labelToOptionID: map, reusable: true)
    }

    struct LabelMapping: Equatable {
        var labelToOptionID: [String: String]
        var reusable: Bool
    }

    private static func labelMapValuesPreserveOrder(options: [ChoiceOption], labelMap: [String: String]) -> Bool {
        guard !labelMap.isEmpty else { return true }
        let current = labelMap.keys.sorted()
        let bankLabels = current.compactMap { label -> String? in
            guard let id = labelMap[label] else { return nil }
            return options.first { $0.id == id }?.label
        }
        return bankLabels == current
    }

    private static func identityOptionTexts(_ options: [ChoiceOption], policy: OrderPolicy) -> [String] {
        let texts = options.map { canonicalField($0.text) }
        return policy == .unordered ? texts.sorted() : texts
    }

    private static func trimEdges(_ text: String) -> String {
        let scalars = Array(text.unicodeScalars)
        var start = 0
        var end = scalars.count
        while start < end, CharacterSet.whitespacesAndNewlines.contains(scalars[start]) { start += 1 }
        while end > start, CharacterSet.whitespacesAndNewlines.contains(scalars[end - 1]) { end -= 1 }
        return String(String.UnicodeScalarView(scalars[start..<end]))
    }

    private static func containsPositionalRelation(_ text: String) -> Bool {
        let folded = text.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: Locale(identifier: "en"))
        let phrases = [
            "以上", "以下", "上述", "下述", "前述", "前两项", "前两", "后两项", "后两",
            "all of the above", "none of the above", "both of the above", "none of these", "all of these",
            "上記", "下記", "いずれも", "どれも"
        ]
        return phrases.contains { folded.contains($0) }
    }

    private static func referencesOptionLabel(stem: String, options: [ChoiceOption]) -> Bool {
        let haystacks = [stem] + options.map(\.text)
        for label in options.map(\.label) where !label.isEmpty {
            for haystack in haystacks where containsToken(label, in: haystack) {
                return true
            }
        }
        return false
    }

    private static func containsToken(_ token: String, in text: String) -> Bool {
        var search = text.startIndex
        while let range = text.range(of: token, options: [], range: search..<text.endIndex) {
            let beforeOK = range.lowerBound == text.startIndex || !isIdentifier(text[text.index(before: range.lowerBound)])
            let afterOK = range.upperBound == text.endIndex || !isIdentifier(text[range.upperBound])
            if beforeOK && afterOK { return true }
            search = range.upperBound
        }
        return false
    }

    private static func isIdentifier(_ character: Character) -> Bool {
        character.isLetter || character.isNumber
    }
}
