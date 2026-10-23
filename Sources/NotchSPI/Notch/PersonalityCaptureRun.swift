import Foundation

enum PersonalityCompletionPrimary: String, Codable, Equatable {
    case transportFailure
    case unreadable
    case dependsOnMissingPrevious
    case noValidChoices
    case invalidContext
    case contextCleared
    case partialUnreadable
    case partialMissingPrevious
    case missingPrevious
    case done

    var isError: Bool {
        switch self {
        case .transportFailure, .unreadable, .dependsOnMissingPrevious, .noValidChoices:
            return true
        default:
            return false
        }
    }

    var localizedStatus: String {
        switch self {
        case .transportFailure: return L10n.statusTransportFailure
        case .unreadable: return L10n.statusUnreadable
        case .dependsOnMissingPrevious: return L10n.statusDependsOnMissingPrevious
        case .noValidChoices: return L10n.statusNoValidChoices
        case .invalidContext: return L10n.statusContextNotSaved
        case .contextCleared: return L10n.statusContextCleared
        case .partialUnreadable: return L10n.statusPartialUnreadable
        case .partialMissingPrevious: return L10n.statusPartialMissingPrevious
        case .missingPrevious: return L10n.statusMissingPrevious
        case .done: return L10n.statusDone
        }
    }
}

enum PersonalitySessionMutation: String, Codable, Equatable {
    case none
    case recorded
    case continuityBarrier
    case discardedStaleResult
}

struct PersonalityCompletionSuffixes: Equatable {
    var contextWasCleared = false
    var questionsRemaining: Int?
    var quotaRunningLow = false
    var copied = false
}

struct PersonalityCompletionOutcome: Codable, Equatable {
    let primary: PersonalityCompletionPrimary
    let composition: PersonalityAnswerComposition
    let sessionMutation: PersonalitySessionMutation

    var isError: Bool { primary.isError }

    func statusText(suffixes: PersonalityCompletionSuffixes = .init()) -> String {
        var parts = [primary.localizedStatus]
        if suffixes.contextWasCleared, primary != .contextCleared {
            parts.append(L10n.statusContextCleared)
        }
        if let questionsRemaining = suffixes.questionsRemaining {
            parts.append(L10n.questionsLeft(questionsRemaining))
        }
        if suffixes.quotaRunningLow { parts.append(L10n.statusQuotaRunningLow) }
        if suffixes.copied { parts.append(L10n.statusCopied) }
        return parts.joined(separator: " · ")
    }
}

/// Request-scoped state for one Personality capture. The raw protocol buffer and the observable
/// model are appended together on MainActor; completion always parses this local buffer, never a
/// UI composition or placeholder string.
@MainActor
final class PersonalityCaptureRun {
    let token: PersonalitySessionToken
    let prompt: CapturePrompt
    private(set) var rawBuffer = ""

    init(token: PersonalitySessionToken, prompt: CapturePrompt) {
        self.token = token
        self.prompt = prompt
    }

    func append(_ delta: String, to model: TutorModel) {
        rawBuffer += delta
        model.answer += delta
    }

    func complete(
        session: PersonalitySession,
        currentScope: PersonalitySessionScope?,
        transportOK: Bool
    ) -> PersonalityCompletionOutcome {
        session.complete(raw: rawBuffer, token: token, currentScope: currentScope, transportOK: transportOK)
    }
}
