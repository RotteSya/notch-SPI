import Foundation

enum PersonalityCompletionPrimary: Equatable {
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

enum PersonalitySessionMutation: Equatable {
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

struct PersonalityCompletionOutcome: Equatable {
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
        let composition = PersonalityAnswer.compose(raw: rawBuffer, streaming: false)
        let scopeMatches = currentScope == token.scope
        let terminal = PersonalityAnswer.isTerminalError(composition.errorCode)

        // Fixed priority 1: transport and terminal model failures. Terminal failures never write
        // a barrier, even if the model violated the protocol by also emitting choice-looking text.
        if !transportOK {
            var mutation: PersonalitySessionMutation = .none
            if composition.hasFinalizedChoices, !terminal, scopeMatches {
                session.markPreviousUnavailable(token: token)
                mutation = .continuityBarrier
            } else if !scopeMatches {
                mutation = .discardedStaleResult
            }
            return outcome(.transportFailure, composition, mutation)
        }
        if terminal {
            let primary: PersonalityCompletionPrimary = composition.errorCode == "unreadable"
                ? .unreadable : .dependsOnMissingPrevious
            return outcome(primary, composition, scopeMatches ? .none : .discardedStaleResult)
        }
        if !composition.hasFinalizedChoices {
            return outcome(.noValidChoices, composition, scopeMatches ? .none : .discardedStaleResult)
        }

        // Fixed priority 2: choices are usable, but continuity is not. Invalid/missing context
        // writes a barrier only while the request token still owns the active generation.
        guard let context = composition.context else {
            var mutation: PersonalitySessionMutation = .discardedStaleResult
            if scopeMatches {
                session.markPreviousUnavailable(token: token)
                mutation = .continuityBarrier
            }
            return outcome(.invalidContext, composition, mutation)
        }
        guard scopeMatches else {
            return outcome(.contextCleared, composition, .discardedStaleResult)
        }
        guard session.record(context, token: token) else {
            return outcome(.contextCleared, composition, .discardedStaleResult)
        }

        // Fixed priority 3 then 4: partial/missing-previous warning, otherwise normal success.
        if composition.errorCode == "partial_unreadable" {
            return outcome(.partialUnreadable, composition, .recorded)
        }
        if composition.errorCode == "partial_missing_previous" {
            return outcome(.partialMissingPrevious, composition, .recorded)
        }
        if token.contextBlock.contains(#""status":"unavailable""#) {
            return outcome(.missingPrevious, composition, .recorded)
        }
        return outcome(.done, composition, .recorded)
    }

    private func outcome(
        _ primary: PersonalityCompletionPrimary,
        _ composition: PersonalityAnswerComposition,
        _ mutation: PersonalitySessionMutation
    ) -> PersonalityCompletionOutcome {
        PersonalityCompletionOutcome(
            primary: primary,
            composition: composition,
            sessionMutation: mutation
        )
    }
}
