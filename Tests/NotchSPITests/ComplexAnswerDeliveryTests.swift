import AppKit
import XCTest
@testable import NotchSPI

final class ComplexAnswerDeliveryTests: XCTestCase {
    private struct Response: Decodable {
        let id: String
        let raw: String
        let expected_state: String
    }

    @MainActor func testRecordedProductionCasesStreamIntoAllReadersWithoutLosingAnswers() throws {
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("Fixtures/complex-answer-v3/responses.json")
        let cases = try JSONDecoder().decode([Response].self, from: Data(contentsOf: url))
        XCTAssertEqual(cases.count, 12)
        for item in cases {
            var stream = ObjectiveResultStreamFilter()
            for character in item.raw {
                let visible = stream.append(String(character))
                XCTAssertFalse(visible.contains("NSPI_RESULT_V1:"), item.id)
            }
            let result = stream.finish()
            XCTAssertEqual(result.parserPath, .v1, item.id)
            XCTAssertTrue(result.violations.isEmpty, item.id)
            if item.expected_state == "retake" {
                XCTAssertEqual(result.state, .retake, item.id)
                XCTAssertNil(result.finalAnswer, item.id)
                continue
            }
            let answer = try XCTUnwrap(result.finalAnswer)
            let model = TutorModel()
            model.answer = result.visibleText
            let reader = ExpandedAnswerContent(id: UUID(), assets: [], answer: result.visibleText,
                explanation: "", needsReview: result.state == .review,
                explaining: false, canExplain: false, explanationFailed: false)
            let history = RecentQuestion(id: UUID(), createdAt: Date(), answer: result.visibleText,
                explanation: "", needsReview: result.state == .review, imageCount: item.id == "two-image-context" ? 2 : 1)
            let notch = NotchType.answerString(model.renderedAnswer,
                presentation: .init(mode: "tutor", depth: "brief", finished: true, revealed: true)).string
            XCTAssertEqual(reader.conclusion, answer, item.id)
            XCTAssertEqual(history.conclusion, answer, item.id)
            XCTAssertEqual(reader.copyText, history.copyText, item.id)
            XCTAssertTrue(notch.contains(answer), item.id)
            XCTAssertFalse(notch.contains("NSPI_RESULT_V1"), item.id)
        }
    }
}
