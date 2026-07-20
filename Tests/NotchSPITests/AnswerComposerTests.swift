import XCTest
@testable import NotchSPI

/// The FINAL-line contract, parsed. This is the layer that makes "two answers on screen"
/// structurally impossible: the LAST marker always wins, and the marker keyword itself is
/// never shown as text.
final class AnswerComposerTests: XCTestCase {

    // MARK: Basic parsing

    func testNoMarkerReturnsWholeTextAsWorking() {
        let p = AnswerComposer.parse("some scratch work\nmore lines", streaming: false)
        XCTAssertEqual(p.working, "some scratch work\nmore lines")
        XCTAssertNil(p.final)
    }

    func testBasicMarker() {
        let p = AnswerComposer.parse("D=−20、E=20\nFINAL: ADBCE", streaming: false)
        XCTAssertEqual(p.working, "D=−20、E=20")
        XCTAssertEqual(p.final, "ADBCE")
    }

    func testMarkerOnlyNoWorking() {
        let p = AnswerComposer.parse("FINAL: 42", streaming: false)
        XCTAssertEqual(p.working, "")
        XCTAssertEqual(p.final, "42")
    }

    func testFinalIsOneLineExtrasBecomeOverflow() {
        // The contract says nothing may follow the FINAL line — anything that does is demoted
        // to overflow (quiet notes below the card), so the card can never balloon mid-stream.
        let p = AnswerComposer.parse("work\nFINAL: 第 3 项\n理由：略", streaming: false)
        XCTAssertEqual(p.final, "第 3 项")
        XCTAssertEqual(p.overflow, "理由：略")
    }

    func testMidStreamScratchAfterMarkerStaysOutOfTheCard() {
        // Replays the field bug mid-stream: a premature FINAL, then more scratch arriving.
        let p = AnswerComposer.parse("scratch\nFINAL: BDECA\n検算：A=−30 <", streaming: true)
        XCTAssertEqual(p.final, "BDECA")
        XCTAssertEqual(p.overflow, "検算：A=−30 <")
    }

    // MARK: The bug from the field: a superseded early answer

    func testLastMarkerWins() {
        let raw = """
        scratch…
        FINAL: BDECA
        検算でミス発見、A=−30 が最小
        FINAL: ADBCE
        """
        let p = AnswerComposer.parse(raw, streaming: false)
        XCTAssertEqual(p.final, "ADBCE")
        // The superseded conclusion stays visible as scratch — without the shouting keyword.
        XCTAssertTrue(p.working.contains("BDECA"))
        XCTAssertFalse(p.working.uppercased().contains("FINAL"))
    }

    // MARK: Decoration tolerance (markdown-trained models embellish)

    func testBoldKeywordMarker() {
        XCTAssertEqual(AnswerComposer.parse("x\n**FINAL:** ADBCE", streaming: false).final, "ADBCE")
    }

    func testWholeLineBoldStripsUnbalancedFence() {
        XCTAssertEqual(AnswerComposer.parse("x\n**FINAL: ADBCE**", streaming: false).final, "ADBCE")
    }

    func testBalancedBoldInsideAnswerIsKept() {
        XCTAssertEqual(AnswerComposer.parse("x\nFINAL: the value is **3**", streaming: false).final,
                       "the value is **3**")
        // A balanced fence right after the colon is an OPENING fence, not marker decoration —
        // it must survive for the markdown renderer (the ADBCE** regression from visual QA).
        XCTAssertEqual(AnswerComposer.parse("x\nFINAL: **ADBCE**（A=−30 が最小）", streaming: false).final,
                       "**ADBCE**（A=−30 が最小）")
    }

    func testFullWidthColonAndLowercase() {
        XCTAssertEqual(AnswerComposer.parse("x\nfinal：ADBCE", streaming: false).final, "ADBCE")
    }

    func testHeadingDecoratedMarker() {
        XCTAssertEqual(AnswerComposer.parse("x\n### FINAL: ADBCE", streaming: false).final, "ADBCE")
    }

    func testMidLineFinalIsNotAMarker() {
        let p = AnswerComposer.parse("the final: answer comes later", streaming: false)
        XCTAssertNil(p.final)
        XCTAssertEqual(p.working, "the final: answer comes later")
    }

    // MARK: Streaming: partial-marker withholding (F-I-N-A-L must never flash as text)

    func testPartialMarkerWithheldWhileStreaming() {
        for tail in ["F", "FIN", "FINAL", "**FINA", "final"] {
            let p = AnswerComposer.parse("scratch\n\(tail)", streaming: true)
            XCTAssertEqual(p.working, "scratch", "tail \(tail) should be withheld")
            XCTAssertNil(p.final)
        }
    }

    func testDivergedLastLineIsShownWhileStreaming() {
        let p = AnswerComposer.parse("scratch\nFinally, note", streaming: true)
        XCTAssertEqual(p.working, "scratch\nFinally, note")
    }

    func testPartialMarkerKeptWhenFinished() {
        // A finished reply ending in "FIN" is just text — nothing may be hidden.
        let p = AnswerComposer.parse("scratch\nFIN", streaming: false)
        XCTAssertEqual(p.working, "scratch\nFIN")
    }

    func testEmptyFinalWhileMarkerJustArrived() {
        let p = AnswerComposer.parse("scratch\nFINAL:", streaming: true)
        XCTAssertEqual(p.final, "")
        XCTAssertEqual(p.working, "scratch")
    }

    // MARK: hasMarker (drives the 推理中… → 作答中… status flip)

    func testHasMarker() {
        XCTAssertFalse(AnswerComposer.hasMarker("scratch"))
        XCTAssertFalse(AnswerComposer.hasMarker("scratch\nFIN"))
        XCTAssertTrue(AnswerComposer.hasMarker("scratch\nFINAL: x"))
        XCTAssertTrue(AnswerComposer.hasMarker("scratch\n**FINAL:** x"))
    }

    // MARK: clipboardAnswer (auto-copy payload)

    func testClipboardAnswerIsTheLastFinalFlattened() {
        // Last marker wins, and inline markdown is flattened to what the card shows.
        XCTAssertEqual(AnswerComposer.clipboardAnswer("scratch\nFINAL: BDECA\nfix\nFINAL: **ADBCE**"), "ADBCE")
        XCTAssertEqual(AnswerComposer.clipboardAnswer("x\nFINAL: **ADBCE**（A=−30 が最小）"), "ADBCE（A=−30 が最小）")
        XCTAssertEqual(AnswerComposer.clipboardAnswer("x\nFINAL: the value is `42`"), "the value is 42")
    }

    func testClipboardAnswerNilWithoutACard() {
        // No marker → nothing to auto-copy (hints, personality lists, error text).
        XCTAssertNil(AnswerComposer.clipboardAnswer("just some reasoning, no answer"))
        XCTAssertNil(AnswerComposer.clipboardAnswer("1. 当てはまる\n2. Bに近い"))
    }
}

/// The appearance knobs' pure clamping / derivation (no UserDefaults touched).
final class AppearancePreferenceTests: XCTestCase {
    func testFontSizeClampsIntoRange() {
        XCTAssertEqual(Appearance.clampFontSize(3), Appearance.answerFontRange.lowerBound)
        XCTAssertEqual(Appearance.clampFontSize(99), Appearance.answerFontRange.upperBound)
        XCTAssertEqual(Appearance.clampFontSize(14), 14)
    }

    func testCollapseSecondsClamp() {
        XCTAssertEqual(Appearance.clampCollapseSeconds(0), Appearance.collapseSecondsRange.lowerBound)
        XCTAssertEqual(Appearance.clampCollapseSeconds(1000), Appearance.collapseSecondsRange.upperBound)
        XCTAssertEqual(Appearance.clampCollapseSeconds(12), 12)
    }

    func testResolvedCollapseDelay() {
        // "Stay expanded" collapses to the 0 the pipeline reads as "never auto-fold".
        XCTAssertEqual(Appearance.resolvedCollapseDelay(stay: true, seconds: 15), 0)
        XCTAssertEqual(Appearance.resolvedCollapseDelay(stay: false, seconds: 15), 15)
        // A non-stay value is still clamped, so a corrupt default can't produce a 0 (== stay).
        XCTAssertEqual(Appearance.resolvedCollapseDelay(stay: false, seconds: 0),
                       Appearance.collapseSecondsRange.lowerBound)
    }

    func testFontSizeReadout() {
        XCTAssertEqual(Appearance.fontSizeReadout(13), "13 pt")
        XCTAssertEqual(Appearance.fontSizeReadout(19), "19 pt")
    }

    func testCollapseReadoutAcrossStatesAndLanguages() {
        withLanguage(.zhHans) {
            XCTAssertEqual(Appearance.collapseReadout(stay: false, seconds: 9), "9 秒")
            XCTAssertEqual(Appearance.collapseReadout(stay: true, seconds: 9), "保持展开")
            // A value past the range is clamped in the readout too, never shown raw.
            XCTAssertEqual(Appearance.collapseReadout(stay: false, seconds: 999), "30 秒")
        }
        withLanguage(.en) {
            XCTAssertEqual(Appearance.collapseReadout(stay: false, seconds: 20), "20s")
            XCTAssertEqual(Appearance.collapseReadout(stay: true, seconds: 20), "stays open")
        }
    }

    func testAnswerCardScalesWithBodySize() {
        // The card headline is body + 4 (see NotchType.card) — the slider drives both.
        let small = NotchType.answerHeight("x\nFINAL: 42", presentation: AnswerPresentation(
            mode: "tutor", depth: "guided", finished: true, revealed: false), width: 400)
        // Can't mutate Appearance here without touching defaults, but the composition must at
        // least produce a taller card than a plain two-line body at the same settings.
        let plain = NotchType.answerHeight("x\n42", presentation: AnswerPresentation(
            mode: "tutor", depth: "guided", finished: true, revealed: false), width: 400)
        XCTAssertGreaterThan(small, plain)
    }
}

/// Every depth that reveals an answer must carry the FINAL contract; hints must not.
final class PromptsFinalContractTests: XCTestCase {
    func testBriefCarriesContractAndReasoningFirst() {
        let p = Prompts.tutorText("brief")
        XCTAssertTrue(p.contains("FINAL:"))
        XCTAssertTrue(p.contains("BEFORE answering"))
        // The old answer-only phrasing (which forced guess-first answers) must be gone.
        XCTAssertFalse(p.contains("Output ONLY the final answer"))
    }

    func testGuidedAndFullCarryContract() {
        XCTAssertTrue(Prompts.tutorText("guided").contains("FINAL:"))
        XCTAssertTrue(Prompts.tutorText("full").contains("FINAL:"))
    }

    func testHintNeverRevealsSoNoContract() {
        XCTAssertFalse(Prompts.tutorText("hint").contains("FINAL:"))
    }

}

/// Composition-level guards: what actually reaches the glass.
final class AnswerCompositionTests: XCTestCase {
    private func composed(_ answer: String, depth: String = "brief",
                          finished: Bool = true, revealed: Bool = false) -> NSAttributedString {
        NotchType.answerString(answer, presentation: AnswerPresentation(
            mode: "tutor", depth: depth, finished: finished, revealed: revealed))
    }

    private func cardText(_ attr: NSAttributedString) -> String {
        var s = ""
        attr.enumerateAttribute(.nspiAnswerCard, in: NSRange(location: 0, length: attr.length)) { v, r, _ in
            if (v as? String) == "answer" { s += (attr.string as NSString).substring(with: r) }
        }
        return s
    }

    func testCardShowsOnlyTheLastConclusion() {
        let attr = composed("scratch\nFINAL: BDECA\nfix\nFINAL: ADBCE")
        XCTAssertEqual(cardText(attr).trimmingCharacters(in: .whitespaces), "ADBCE")
        // Folded brief answer: the scratch (and the superseded BDECA) is not on the glass.
        XCTAssertFalse(attr.string.contains("BDECA"))
    }

    func testRevealedBriefShowsScratchWithoutMarkerKeyword() {
        let attr = composed("scratch\nFINAL: BDECA\nfix\nFINAL: ADBCE", revealed: true)
        XCTAssertTrue(attr.string.contains("scratch"))
        XCTAssertTrue(attr.string.contains("BDECA"))          // superseded value visible…
        XCTAssertFalse(attr.string.uppercased().contains("FINAL"))  // …the keyword never is
    }

    func testFinishedBriefWithoutMarkerFallsBackToFullText() {
        // Contract violation or error text: nothing may be hidden or folded.
        let attr = composed("模型服务错误（HTTP 500）")
        XCTAssertTrue(attr.string.contains("HTTP 500"))
        XCTAssertNil(attr.attribute(.nspiAnswerCard, at: 0, effectiveRange: nil))
    }

    func testGuidedKeepsWalkthroughAndCard() {
        let attr = composed("step 1\nstep 2\nFINAL: 42", depth: "guided")
        XCTAssertTrue(attr.string.contains("step 1"))
        XCTAssertEqual(cardText(attr).trimmingCharacters(in: .whitespaces), "42")
        XCTAssertNil(attr.attribute(.nspiReasoningToggle, at: 0, effectiveRange: nil)) // no fold
    }

    func testHintIsUntouchedByTheContract() {
        let attr = composed("try isolating x first\nFINAL: oops", depth: "hint")
        // Hints never carry the contract, so the text renders as-is (defensive: even if the
        // model leaks a FINAL line, hint mode does not promote it to a card).
        XCTAssertTrue(attr.string.contains("FINAL: oops"))
    }

    func testMeasuredHeightAddsChipPadding() {
        let with = NotchType.answerHeight("x\nFINAL: 42", presentation: AnswerPresentation(
            mode: "tutor", depth: "guided", finished: true, revealed: false), width: 400)
        let without = NotchType.answerHeight("x\n42", presentation: AnswerPresentation(
            mode: "tutor", depth: "guided", finished: true, revealed: false), width: 400)
        XCTAssertGreaterThan(with, without) // card typography + chip padding grow the panel
    }
}
