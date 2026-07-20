import XCTest
@testable import NotchSPI

@MainActor
final class PersonalityCaptureRunTests: XCTestCase {
    private func scope(
        persona: String = "p1", target: String = "screen", channel: String = "official"
    ) -> PersonalitySessionScope {
        PersonalitySessionScope(
            personaID: persona,
            personaName: "Persona",
            personaText: "steady",
            captureTargetID: target,
            channelID: channel
        )
    }

    private func prompt(context: String) -> CapturePrompt {
        Prompts.capturePrompt(
            mode: "personality",
            depth: "guided",
            personaName: "Persona",
            personaText: "steady",
            sessionContext: context
        )
    }

    private func validRaw(
        ordinal: String = "1", choice: String = "当てはまる", summary: String = "item",
        errorLine: String? = nil
    ) -> String {
        var lines = ["\(ordinal). \(choice)"]
        if let errorLine { lines.append(errorLine) }
        lines.append(
            #"NSPI_CONTEXT_V1: {"last":{"ordinal":"\#(ordinal)","summary":"\#(summary)","choice":"\#(choice)"},"referenceable":[]}"#
        )
        return lines.joined(separator: "\n")
    }

    private func makeRun(
        session: PersonalitySession, scope: PersonalitySessionScope? = nil
    ) -> PersonalityCaptureRun {
        let token = session.begin(scope: scope ?? self.scope())
        return PersonalityCaptureRun(token: token, prompt: prompt(context: token.contextBlock))
    }

    func testRawBufferAndModelRemainIdenticalIncludingMachineLine() {
        let session = PersonalitySession()
        let run = makeRun(session: session)
        let model = TutorModel()
        model.mode = "personality"
        let raw = validRaw()
        for chunk in [String(raw.prefix(8)), String(raw.dropFirst(8).prefix(12)), String(raw.dropFirst(20))] {
            run.append(chunk, to: model)
        }

        XCTAssertEqual(run.rawBuffer, raw)
        XCTAssertEqual(model.answer, raw)
        XCTAssertTrue(model.answer.contains("NSPI_CONTEXT_V1"))
        let outcome = run.complete(session: session, currentScope: scope(), transportOK: true)
        XCTAssertEqual(outcome.primary, .done)
        XCTAssertEqual(outcome.sessionMutation, .recorded)

        let rendered = NotchType.answerString(model.answer, presentation: AnswerPresentation(
            mode: "personality", depth: "guided", finished: true, revealed: false
        ))
        XCTAssertEqual(rendered.string, "1. 当てはまる")
    }

    func testSecondFrozenPromptContainsFirstCapturePayload() {
        let session = PersonalitySession()
        let first = makeRun(session: session)
        let model = TutorModel()
        first.append(validRaw(summary: "first-scene"), to: model)
        XCTAssertEqual(first.complete(session: session, currentScope: scope(), transportOK: true).primary, .done)

        let second = makeRun(session: session)
        XCTAssertTrue(second.token.contextBlock.contains("first-scene"))
        XCTAssertTrue(second.prompt.system.contains("first-scene"))
        XCTAssertEqual(second.prompt, prompt(context: second.token.contextBlock))
    }

    func testInFlightPersonaChannelAndTargetChangesDiscardOldResults() {
        for changed in [
            scope(persona: "p2"),
            scope(target: "app:com.example"),
            scope(channel: "cli:codex"),
        ] {
            let session = PersonalitySession()
            let run = makeRun(session: session)
            let model = TutorModel()
            run.append(validRaw(), to: model)
            let outcome = run.complete(session: session, currentScope: changed, transportOK: true)
            XCTAssertEqual(outcome.primary, .contextCleared)
            XCTAssertEqual(outcome.sessionMutation, .discardedStaleResult)
            XCTAssertEqual(session.recordCount, 0)
        }
    }

    func testOlderSequenceCannotWriteEvenWhenScopeMatches() {
        let session = PersonalitySession()
        let stale = makeRun(session: session)
        _ = session.begin(scope: scope())
        stale.append(validRaw(), to: TutorModel())
        let outcome = stale.complete(session: session, currentScope: scope(), transportOK: true)
        XCTAssertEqual(outcome.primary, .contextCleared)
        XCTAssertEqual(outcome.sessionMutation, .discardedStaleResult)
        XCTAssertEqual(session.recordCount, 0)
    }

    func testEmptySuccessAndRawRefusalNeverAdvanceSession() {
        for raw in ["", "I cannot help with this questionnaire."] {
            let session = PersonalitySession()
            let run = makeRun(session: session)
            if !raw.isEmpty { run.append(raw, to: TutorModel()) }
            let outcome = run.complete(session: session, currentScope: scope(), transportOK: true)
            XCTAssertEqual(outcome.primary, .noValidChoices)
            XCTAssertEqual(outcome.sessionMutation, .none)
            XCTAssertEqual(session.recordCount, 0)
        }
    }

    func testInvalidContextWritesBarrierButNeverRawFallback() {
        let session = PersonalitySession()
        let run = makeRun(session: session)
        run.append("1. 当てはまる\nexplanation", to: TutorModel())
        let outcome = run.complete(session: session, currentScope: scope(), transportOK: true)
        XCTAssertEqual(outcome.primary, .invalidContext)
        XCTAssertEqual(outcome.sessionMutation, .continuityBarrier)
        XCTAssertEqual(session.recordCount, 0)
        let next = session.begin(scope: scope())
        XCTAssertTrue(next.contextBlock.contains(#""status":"unavailable""#))
        XCTAssertFalse(next.contextBlock.contains("explanation"))
    }

    func testTransportWithoutChoicePreservesPriorImmediatePrevious() {
        let session = PersonalitySession()
        let first = makeRun(session: session)
        first.append(validRaw(summary: "preserved-scene"), to: TutorModel())
        _ = first.complete(session: session, currentScope: scope(), transportOK: true)

        let failed = makeRun(session: session)
        failed.append("network prose", to: TutorModel())
        let outcome = failed.complete(session: session, currentScope: scope(), transportOK: false)
        XCTAssertEqual(outcome.primary, .transportFailure)
        XCTAssertEqual(outcome.sessionMutation, .none)
        let retry = session.begin(scope: scope())
        XCTAssertTrue(retry.contextBlock.contains("preserved-scene"))
        XCTAssertTrue(retry.contextBlock.contains(#""status":"available""#))
    }

    func testTransportAfterFinalizedChoiceWritesBarrier() {
        let session = PersonalitySession()
        let run = makeRun(session: session)
        run.append("1. 当てはまる\n", to: TutorModel())
        let outcome = run.complete(session: session, currentScope: scope(), transportOK: false)
        XCTAssertEqual(outcome.primary, .transportFailure)
        XCTAssertEqual(outcome.sessionMutation, .continuityBarrier)
        XCTAssertTrue(session.begin(scope: scope()).contextBlock.contains(#""status":"unavailable""#))
    }

    func testPartialWithValidContextRecordsAndWinsOverNormalDone() {
        let session = PersonalitySession()
        let run = makeRun(session: session)
        run.append(validRaw(
            errorLine: #"NSPI_ERROR_V1: {"code":"partial_unreadable","ordinals":["2"]}"#
        ), to: TutorModel())
        let outcome = run.complete(session: session, currentScope: scope(), transportOK: true)
        XCTAssertEqual(outcome.primary, .partialUnreadable)
        XCTAssertEqual(outcome.sessionMutation, .recorded)
        XCTAssertEqual(session.recordCount, 1)
    }

    func testTerminalErrorWinsOverContradictoryPartialRawChoice() {
        let session = PersonalitySession()
        let run = makeRun(session: session)
        run.append("1. 当てはまる\n" + #"NSPI_ERROR_V1: {"code":"unreadable"}"#, to: TutorModel())
        let outcome = run.complete(session: session, currentScope: scope(), transportOK: true)
        XCTAssertEqual(outcome.primary, .unreadable)
        XCTAssertEqual(outcome.sessionMutation, .none)
        XCTAssertEqual(session.recordCount, 0)
    }

    func testMissingPreviousWarningSurvivesSuccessfulRecord() {
        let session = PersonalitySession()
        let invalid = makeRun(session: session)
        invalid.append("1. A", to: TutorModel())
        _ = invalid.complete(session: session, currentScope: scope(), transportOK: true)

        let next = makeRun(session: session)
        XCTAssertTrue(next.token.contextBlock.contains(#""status":"unavailable""#))
        next.append(validRaw(ordinal: "2", choice: "B"), to: TutorModel())
        let outcome = next.complete(session: session, currentScope: scope(), transportOK: true)
        XCTAssertEqual(outcome.primary, .missingPrevious)
        XCTAssertEqual(outcome.sessionMutation, .recorded)
    }

    func testStatusPriorityAndSuffixesNeverOverwritePrimary() {
        let composition = PersonalityAnswer.compose(raw: "1. A", streaming: false)
        let invalid = PersonalityCompletionOutcome(
            primary: .invalidContext,
            composition: composition,
            sessionMutation: .continuityBarrier
        )
        let text = invalid.statusText(suffixes: PersonalityCompletionSuffixes(
            contextWasCleared: false,
            questionsRemaining: 42,
            quotaRunningLow: false,
            copied: true
        ))
        XCTAssertTrue(text.hasPrefix(L10n.statusContextNotSaved))
        XCTAssertTrue(text.contains(L10n.questionsLeft(42)))
        XCTAssertTrue(text.hasSuffix(L10n.statusCopied))
        XCTAssertFalse(text.hasPrefix(L10n.statusDone))

        let terminal = PersonalityCompletionOutcome(
            primary: .unreadable,
            composition: composition,
            sessionMutation: .none
        )
        XCTAssertTrue(terminal.statusText(suffixes: .init(
            contextWasCleared: true,
            questionsRemaining: 3,
            quotaRunningLow: true,
            copied: false
        )).hasPrefix(L10n.statusUnreadable))
    }
}
