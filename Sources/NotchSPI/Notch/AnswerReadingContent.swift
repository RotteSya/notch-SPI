import Foundation

/// One lossless reading composition for the live answer and saved snapshots.
/// Does not reinterpret trailing model text as another authoritative conclusion.
struct AnswerReadingContent {
    let answer: String
    let explanation: String
    private var parsed: AnswerComposer.Parse { AnswerComposer.parse(answer, streaming: false) }
    var conclusion: String { parsed.final.flatMap { $0.isEmpty ? nil : $0 } ?? answer }
    var detail: String {
        let extra = AnswerComposer.parse(explanation, streaming: false)
        return [parsed.final == nil ? "" : parsed.working, parsed.overflow,
                extra.working, extra.final, extra.overflow].compactMap { $0 }
            .filter { !$0.isEmpty }.joined(separator: "\n\n")
    }
    var copyAnswer: String { AnswerText.plain(conclusion) }
    var copyAll: String { AnswerText.plain([conclusion, detail].filter { !$0.isEmpty }.joined(separator: "\n\n")) }
    var notchText: String {
        guard !explanation.isEmpty else { return answer }
        let extra = AnswerComposer.parse(explanation, streaming: false)
        guard let final = parsed.final else {
            return [answer, extra.working, extra.final, extra.overflow].compactMap { $0 }
                .filter { !$0.isEmpty }.joined(separator: "\n\n")
        }
        let body = [parsed.working, extra.working, extra.final, extra.overflow]
            .compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: "\n\n")
        return body + "\nFINAL: " + final + (parsed.overflow.isEmpty ? "" : "\n" + parsed.overflow)
    }
    static var reviewMessage: String {
        L10n.t("此答案需要核对，请结合原题确认。", "元の問題と照合して確認してください。", "This answer needs review. Check it against the original question.")
    }
}
