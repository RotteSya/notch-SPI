import XCTest
@testable import NotchSPI

final class PersonalityAnswerTests: XCTestCase {
    private func contextLine(
        lastOrdinal: String = "2",
        lastChoice: String = "Bに近い",
        references: String = #"[{"ordinal":"1","summary":"会議で意見が対立","choice":"当てはまる"}]"#
    ) -> String {
        #"NSPI_CONTEXT_V1: {"last":{"ordinal":"\#(lastOrdinal)","summary":"AとBの自己評価","choice":"\#(lastChoice)"},"referenceable":\#(references)}"#
    }

    func testValidUnicodePayloadAndMarkdownChoices() {
        let raw = """
        **1. 当てはまる**
        ２． **Bに近い**
        \(contextLine())
        """
        let result = PersonalityAnswer.compose(raw: raw, streaming: false)
        XCTAssertEqual(result.finalizedChoices.map(\.ordinal), ["1", "2"])
        XCTAssertEqual(result.context?.last.choice, "Bに近い")
        XCTAssertFalse(result.visibleChoices.contains("NSPI_"))
        XCTAssertFalse(result.visibleChoices.contains("summary"))
    }

    func testOrdinalNormalizationCoversSupportedForms() {
        for source in ["1.", "１．", "1)", "（１）", "Q1", "Q１", "1、"] {
            XCTAssertEqual(PersonalityAnswer.normalizeOrdinal(source), "1", source)
        }
        XCTAssertNil(PersonalityAnswer.normalizeOrdinal("A1"))
        XCTAssertNil(PersonalityAnswer.normalizeOrdinal("1a"))
    }

    func testChoiceValidationUsesCanonicalOrdinalAndExactNormalizedText() {
        let valid = "Q１ **とても  当てはまる**\n" + contextLine(
            lastOrdinal: "（１）", lastChoice: "**とても   当てはまる**", references: "[]")
        XCTAssertNotNil(PersonalityAnswer.compose(raw: valid, streaming: false).context)

        let mismatch = "1. 当てはまる\n" + contextLine(
            lastOrdinal: "1", lastChoice: "やや当てはまる", references: "[]")
        let invalid = PersonalityAnswer.compose(raw: mismatch, streaming: false)
        XCTAssertNil(invalid.context)
        XCTAssertTrue(invalid.violations.contains(.invalidContext))
    }

    func testStrictSchemaAndLimitsRejectWholePayload() {
        let missingField = "1. はい\n" + #"NSPI_CONTEXT_V1: {"last":{"ordinal":"1","choice":"はい"},"referenceable":[]}"#
        XCTAssertNil(PersonalityAnswer.compose(raw: missingField, streaming: false).context)

        let longSummary = String(repeating: "あ", count: 241)
        let oversized = "1. はい\nNSPI_CONTEXT_V1: "
            + #"{"last":{"ordinal":"1","summary":"\#(longSummary)","choice":"はい"},"referenceable":[]}"#
        XCTAssertNil(PersonalityAnswer.compose(raw: oversized, streaming: false).context)

        let unknown = "1. はい\n" + #"NSPI_CONTEXT_V1: {"last":{"ordinal":"1","summary":"s","choice":"はい","extra":true},"referenceable":[]}"#
        XCTAssertNil(PersonalityAnswer.compose(raw: unknown, streaming: false).context)

        let wrongType = "1. はい\n" + #"NSPI_CONTEXT_V1: {"last":{"ordinal":1,"summary":"s","choice":"はい"},"referenceable":[]}"#
        XCTAssertNil(PersonalityAnswer.compose(raw: wrongType, streaming: false).context)

        let emptyChoice = "1. はい\n" + #"NSPI_CONTEXT_V1: {"last":{"ordinal":"1","summary":"s","choice":""},"referenceable":[]}"#
        XCTAssertNil(PersonalityAnswer.compose(raw: emptyChoice, streaming: false).context)
    }

    func testPayloadByteLimitAndReferenceCountAreHardLimits() throws {
        var choices: [String] = []
        var references: [[String: String]] = []
        for index in 1...8 {
            choices.append("\(index). " + String(repeating: "選", count: 70))
            references.append([
                "ordinal": "\(index)",
                "summary": String(repeating: "場", count: 220),
                "choice": String(repeating: "選", count: 70),
            ])
        }
        let object: [String: Any] = [
            "last": references.last!,
            "referenceable": references,
        ]
        let data = try JSONSerialization.data(withJSONObject: object)
        XCTAssertGreaterThan(data.count, 4_096)
        let raw = choices.joined(separator: "\n") + "\nNSPI_CONTEXT_V1: " + String(decoding: data, as: UTF8.self)
        XCTAssertNil(PersonalityAnswer.compose(raw: raw, streaming: false).context)

        let nine = (1...9).map { ["ordinal": "\($0)", "summary": "s", "choice": "A"] }
        let tooMany: [String: Any] = ["last": nine[0], "referenceable": nine]
        let tooManyData = try JSONSerialization.data(withJSONObject: tooMany)
        let tooManyRaw = (1...9).map { "\($0). A" }.joined(separator: "\n")
            + "\nNSPI_CONTEXT_V1: " + String(decoding: tooManyData, as: UTF8.self)
        XCTAssertNil(PersonalityAnswer.compose(raw: tooManyRaw, streaming: false).context)
    }

    func testLastValidContextWinsAndDuplicateIsReported() {
        let raw = """
        1. 当てはまる
        NSPI_CONTEXT_V1: {broken}
        \(contextLine(lastOrdinal: "1", lastChoice: "当てはまる", references: "[]"))
        """
        let result = PersonalityAnswer.compose(raw: raw, streaming: false)
        XCTAssertEqual(result.context?.last.choice, "当てはまる")
        XCTAssertTrue(result.violations.contains(.invalidContext))
        XCTAssertTrue(result.violations.contains(.duplicateContextMarker))
    }

    func testEveryMarkerCharacterBoundaryIsWithheld() {
        for marker in [
            #"NSPI_CONTEXT_V1: {"last":{"ordinal":"1","summary":"s","choice":"はい"},"referenceable":[]}"#,
            #"NSPI_ERROR_V1: {"code":"unreadable"}"#,
        ] {
            for end in 1...marker.count {
                let prefix = String(marker.prefix(end))
                let result = PersonalityAnswer.compose(raw: "1. はい\n" + prefix, streaming: true)
                XCTAssertEqual(result.visibleChoices, "1. はい", "leaked at boundary \(end): \(prefix)")
                XCTAssertFalse(result.visibleChoices.contains("NSPI"))
                XCTAssertFalse(result.visibleChoices.contains("{"))
            }
        }
    }

    func testDecoratedShortMarkerPrefixesBeatProvisionalChoice() {
        for prefix in ["N", "NS", "**NSPI_", "- nspi_context_v1", "__NSPI_ERROR_V1："] {
            let result = PersonalityAnswer.compose(raw: prefix, streaming: true)
            XCTAssertEqual(result.visibleChoices, "")
            XCTAssertNil(result.provisionalChoice)
        }
    }

    func testProvisionalChoiceDisplaysButDoesNotValidateContext() {
        let streaming = PersonalityAnswer.compose(raw: "1. 当てはま", streaming: true)
        XCTAssertEqual(streaming.visibleChoices, "1. 当てはま")
        XCTAssertEqual(streaming.provisionalChoice?.ordinal, "1")
        XCTAssertTrue(streaming.finalizedChoices.isEmpty)

        let raw = "1. 当てはまる\n" + contextLine(
            lastOrdinal: "1", lastChoice: "当てはまる", references: "[]")
        let finished = PersonalityAnswer.compose(raw: raw, streaming: false)
        XCTAssertNil(finished.provisionalChoice)
        XCTAssertEqual(finished.finalizedChoices.count, 1)
        XCTAssertNotNil(finished.context)
    }

    func testProseAndRefusalNeverEnterVisibleChoices() {
        let raw = """
        I cannot help manipulate a personality test.
        1. 当てはまらない
        Here is why.
        \(contextLine(lastOrdinal: "1", lastChoice: "当てはまらない", references: "[]"))
        """
        let result = PersonalityAnswer.compose(raw: raw, streaming: false)
        XCTAssertEqual(result.visibleChoices, "1. 当てはまらない")
        XCTAssertEqual(result.violations.filter { $0 == .prose }.count, 2)
    }

    func testErrorCodesAreHiddenAndCombinationRulesAreEnforced() {
        let terminal = PersonalityAnswer.compose(
            raw: #"NSPI_ERROR_V1: {"code":"unreadable"}"#, streaming: false)
        XCTAssertEqual(terminal.errorCode, "unreadable")
        XCTAssertEqual(terminal.visibleChoices, "")
        XCTAssertFalse(terminal.violations.contains(.noValidChoices))

        let partial = "1. はい\n"
            + #"NSPI_ERROR_V1: {"code":"partial_unreadable","ordinals":["Q２"]}"# + "\n"
            + contextLine(lastOrdinal: "1", lastChoice: "はい", references: "[]")
        let parsed = PersonalityAnswer.compose(raw: partial, streaming: false)
        XCTAssertEqual(parsed.errorCode, "partial_unreadable")
        XCTAssertEqual(parsed.errorOrdinals, ["2"])
        XCTAssertNotNil(parsed.context)
        XCTAssertFalse(parsed.visibleChoices.contains("NSPI_ERROR"))

        let illegal = "1. はい\n" + #"NSPI_ERROR_V1: {"code":"unreadable"}"#
        XCTAssertTrue(PersonalityAnswer.compose(raw: illegal, streaming: false)
            .violations.contains(.invalidErrorCombination))
    }

    func testCRLFLowercaseFullWidthColonAndDecorations() {
        let raw = "**1. はい**\r\n- nspi_context_v1："
            + #"{"last":{"ordinal":"1","summary":"改行\nと引用符\"","choice":"はい"},"referenceable":[]}"#
        let result = PersonalityAnswer.compose(raw: raw, streaming: false)
        XCTAssertNotNil(result.context)
        XCTAssertEqual(result.visibleChoices, "1. はい")
    }

    func testFinishedWithoutChoiceOrContextProducesClientViolations() {
        let refusal = PersonalityAnswer.compose(raw: "I refuse.", streaming: false)
        XCTAssertTrue(refusal.violations.contains(.noValidChoices))
        XCTAssertEqual(refusal.visibleChoices, "")

        let choiceOnly = PersonalityAnswer.compose(raw: "1. はい", streaming: false)
        XCTAssertTrue(choiceOnly.violations.contains(.missingContext))
        XCTAssertFalse(choiceOnly.violations.contains(.noValidChoices))
    }
}
