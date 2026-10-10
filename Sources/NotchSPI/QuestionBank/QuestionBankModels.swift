import CryptoKit
import Darwin
import Foundation

enum QuestionBankLimits {
    static let maxFileBytes = 20 * 1024 * 1024
    static let maxQuestions = 10_000
    static let maxIdentifier = 128
    static let maxTitle = 120
    static let maxProse = 2_000
    static let maxStem = 20_000
    static let maxOptionLabel = 16
    static let maxOptionText = 4_000
    static let maxFillText = 512
    static let maxUnit = 64
    static let maxExplanation = 20_000
    static let schemaVersion = 1
    static let searchPageSize = 50
    static let lookupBudget: TimeInterval = 0.350
    static let maxCandidates = 3

    static func scalarCount(_ text: String) -> Int { text.unicodeScalars.count }
}

enum QuestionBankOrigin: String, Equatable, Sendable {
    case imported
    case builtIn = "built_in"
}

enum QuestionKind: String, Equatable, Sendable {
    case singleChoice = "single_choice"
    case multipleChoice = "multiple_choice"
    case shortFill = "short_fill"
}

enum BankLanguage: String, Equatable, CaseIterable, Sendable {
    case zh, ja, en

    var visionCode: String {
        switch self {
        case .zh: return "zh-Hans"
        case .ja: return "ja-JP"
        case .en: return "en-US"
        }
    }

    static func fromInterface(_ lang: L10n.Lang) -> BankLanguage {
        switch lang {
        case .zh: return .zh
        case .ja: return .ja
        case .en: return .en
        }
    }
}

struct BankVersion: Comparable, Equatable, Hashable, Sendable {
    var major: Int
    var minor: Int
    var patch: Int

    var text: String { "\(major).\(minor).\(patch)" }

    static func parse(_ raw: String) -> BankVersion? {
        let parts = raw.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 3 else { return nil }
        let numbers = parts.compactMap { part -> Int? in
            guard !part.isEmpty, part.allSatisfy(\.isNumber), let value = Int(part), value >= 0 else { return nil }
            return value
        }
        guard numbers.count == 3 else { return nil }
        return BankVersion(major: numbers[0], minor: numbers[1], patch: numbers[2])
    }

    static func < (lhs: BankVersion, rhs: BankVersion) -> Bool {
        (lhs.major, lhs.minor, lhs.patch) < (rhs.major, rhs.minor, rhs.patch)
    }
}

enum OrderPolicy: String, Equatable, Sendable {
    case ordered
    case unordered
}

struct ChoiceOption: Equatable, Sendable {
    var id: String
    var label: String
    var text: String
}

enum QuestionAnswer: Equatable, Sendable {
    case choice(optionIDs: [String])
    case fill(text: String, unit: String?)
}

struct BankQuestion: Equatable, Sendable {
    var id: String
    var kind: QuestionKind
    var language: BankLanguage
    var stem: String
    var options: [ChoiceOption]
    var answer: QuestionAnswer
    var explanation: String?
    var source: String?
    var orderPolicy: OrderPolicy
    var identityKey: String
    var candidateStem: String
    var candidateOptions: String
    var answerSemanticKey: String
    var searchText: String
    var unitRepeatedInText: Bool
    var languageExplicit: Bool = true
}

struct QuestionFailure: Equatable, Sendable {
    var index: Int
    var itemID: String?
    var message: String
}

struct BankManifest: Equatable, Sendable {
    var externalBankID: String
    var title: String
    var author: String?
    var version: BankVersion
    var language: BankLanguage
    var description: String?
    var source: String?
    var license: String?
    var origin: QuestionBankOrigin
}

struct PackageDraft: Equatable, Sendable {
    var manifest: BankManifest?
    var questions: [BankQuestion]
    var failures: [QuestionFailure]
    var rootError: String?
    var warnings: [String]
    var needsLanguage: Bool
    var suggestedTitle: String
}

enum QuestionBankError: Error, Equatable, Sendable {
    case root(String)
    case unavailable(String)
    case notFound
    case conflict
    case stale
}

struct QuestionBankSummary: Equatable, Sendable {
    var instanceID: UUID
    var externalBankID: String
    var title: String
    var author: String?
    var version: String
    var language: BankLanguage
    var origin: QuestionBankOrigin
    var questionCount: Int
    var enabled: Bool
    var allowAutomatic: Bool
    var catalogRevision: Int
    var importedAt: String
    var fileDigest: String
    var contentDigest: String
}

struct QuestionSearchHit: Equatable, Sendable {
    var instanceID: UUID
    var bankTitle: String
    var bankVersion: String
    var itemID: String
    var kind: QuestionKind
    var stemExcerpt: String
    var conflict: Bool
    var blockedAutomatic: Bool
}

struct QuestionSearchPage: Equatable, Sendable {
    var hits: [QuestionSearchHit]
    var offset: Int
    var total: Int
}

struct QuestionDetail: Equatable, Sendable {
    var instanceID: UUID
    var bankTitle: String
    var bankVersion: String
    var origin: QuestionBankOrigin
    var itemID: String
    var kind: QuestionKind
    var language: BankLanguage
    var stem: String
    var options: [ChoiceOption]
    var answerText: String
    var explanation: String?
    var source: String?
    var conflict: Bool
    var blockedAutomatic: Bool
    var itemRevision: Int
}

enum LocalLookupOutcome: Equatable, Sendable {
    case ready(LocalAnswer)
    case candidates([LocalCandidate], options: [ExtractedOption])
    case conflict([LocalCandidate], options: [ExtractedOption])
    case miss
    case unavailable(String)
}

struct LocalCandidate: Equatable, Sendable {
    var instanceID: UUID
    var bankTitle: String
    var bankVersion: String
    var itemID: String
    var itemRevision: Int
    var catalogRevision: Int
    var kind: QuestionKind
    var stem: String
    var options: [ChoiceOption]
    var answer: QuestionAnswer
    var explanation: String?
    var source: String?
    var orderPolicy: OrderPolicy
    var allowAutomatic: Bool
    var blockedAutomatic: Bool
    var answerSemanticKey: String
    var identityKey: String
    var origin: QuestionBankOrigin
    var bankEnabled: Bool
    var savedLabelMap: [String: String] = [:]
}

struct LocalAnswer: Equatable, Sendable {
    var bankInstanceID: UUID
    var bankTitle: String
    var bankVersion: String
    var itemID: String
    var itemRevision: Int
    var catalogRevision: Int
    var questionKind: QuestionKind
    var currentAnswerText: String
    var copyText: String
    var selectedOptionIDs: [String]
    var currentLabelMap: [String: String]
    var explanation: String?
    var explanationApplicable: Bool
    var sourceKind: QuestionBankOrigin
    var userTrusted: Bool
    var matchMethod: String
    var identityKey: String
    var answerSemanticKey: String
    var conflictsWithAnotherBank: Bool = false
    var lookupDeadline: TimeInterval? = nil
}

struct AliasScope: Equatable, Sendable {
    var imageDigests: [String]
    var targetID: String
    var crop: String

    var storageKey: String {
        QuestionIdentity.lengthPrefixed([
            ("count", String(imageDigests.count)),
            ("images", imageDigests.joined(separator: "\u{1e}")),
            ("target", targetID),
            ("crop", crop)
        ])
    }
}

struct LocalLookupRequest: Sendable {
    var image: Data
    var scope: AliasScope
    var selectionID: String
    var languages: [String]
    var now: @Sendable () -> TimeInterval
}

struct LocalConfirmRequest: Sendable {
    var candidate: LocalCandidate
    var scope: AliasScope
    var labelMap: [String: String]
    var answer: LocalAnswer
}

enum ImportDecision: Equatable, Sendable {
    case createNew
    case update(UUID)
}

struct ImportPreview: Equatable, Sendable {
    var fileDigest: String
    var contentDigest: String
    var draft: PackageDraft
    var title: String
    var language: BankLanguage?
    var allowAutomatic: Bool
    var identicalInstanceID: UUID?
    var sameExternalInstances: [QuestionBankSummary]
    var sameVersionChanged: [UUID]
    var higherVersionTargets: [UUID]
    var duplicateGroups: Int
    var conflictGroups: Int
    var replacementPreview: [ReplacementPreview]
}

struct ReplacementPreview: Equatable, Sendable {
    var instanceID: UUID
    var added: Int
    var changed: Int
    var removed: Int
}

struct ImportCommitResult: Equatable, Sendable {
    var status: String
    var instanceID: UUID?
    var accepted: Int
    var failed: Int
    var report: String
}

enum QuestionBankFiles {
    static func readRegularFile(_ url: URL) throws -> Data {
        var info = stat()
        guard lstat(url.path, &info) == 0 else { throw QuestionBankError.root("unreadable") }
        let kind = info.st_mode & S_IFMT
        guard kind == S_IFREG else { throw QuestionBankError.root("not_regular_file") }
        guard info.st_size >= 0, info.st_size <= QuestionBankLimits.maxFileBytes else {
            throw QuestionBankError.root("file_too_large")
        }
        let data = try Data(contentsOf: url, options: [.mappedIfSafe])
        guard data.count <= QuestionBankLimits.maxFileBytes else { throw QuestionBankError.root("file_too_large") }
        var after = stat()
        guard lstat(url.path, &after) == 0, (after.st_mode & S_IFMT) == S_IFREG,
              after.st_size <= QuestionBankLimits.maxFileBytes else {
            throw QuestionBankError.root("file_too_large")
        }
        return data
    }

    static func sha256(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
}

enum QuestionBankText {
    static func validIdentifier(_ raw: String) -> Bool {
        let scalars = raw.unicodeScalars
        guard (1...QuestionBankLimits.maxIdentifier).contains(scalars.count) else { return false }
        return scalars.allSatisfy { scalar in
            (scalar >= "a" && scalar <= "z") || (scalar >= "A" && scalar <= "Z")
                || (scalar >= "0" && scalar <= "9") || scalar == "." || scalar == "_" || scalar == "-"
        }
    }

    static func limited(_ text: String, max: Int, allowEmpty: Bool) -> String? {
        let count = QuestionBankLimits.scalarCount(text)
        if text.isEmpty { return allowEmpty ? text : nil }
        return count <= max ? text : nil
    }
}
