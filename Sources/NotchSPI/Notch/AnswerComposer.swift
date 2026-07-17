import Foundation

/// Parses the streamed answer text against the FINAL-line contract (see `Prompts.finalLineClause`).
///
/// The stream is raw model output and can never be un-said, so the AUTHORITATIVE answer surface
/// is decided here, not by the model's phrasing: everything before the marker is "working", the
/// marker's payload is the answer — and if a model ever violates the contract and emits two
/// FINAL lines, the LAST one wins. Two contradictory answers on screen become structurally
/// impossible: the answer card always shows exactly one conclusion.
///
/// Pure string logic — no AppKit, fully unit-tested.
enum AnswerComposer {

    /// A FINAL marker at the start of a line. Tolerates the decorations a markdown-trained model
    /// sneaks in despite instructions: heading hashes, bold/italic fences on either side of the
    /// keyword, a full-width colon, stray spaces, any capitalization.
    private static let markerRegex = try! NSRegularExpression(
        pattern: #"(?m)^[ \t]{0,3}(?:#{1,6}[ \t]*)?(?:\*{1,2}|_{1,2})?[ \t]*FINAL[ \t]*[:：][ \t]*"#,
        options: [.caseInsensitive]
    )

    struct Parse: Equatable {
        /// Everything before the (last) marker, tail-trimmed. The whole text when no marker yet.
        var working: String
        /// The marker line's payload — nil until a marker has streamed in. Always a single
        /// conclusion line: the contract says nothing may follow it, so anything that does is
        /// demoted to `overflow` — the card can never balloon mid-stream.
        var final: String?
        /// Contract-violating text after the FINAL line (more scratch from a non-compliant
        /// model). Rendered as de-emphasized notes below the card, never inside it.
        var overflow = ""
    }

    /// Split accumulated stream text into working + final answer. `streaming: true` additionally
    /// holds back a trailing half-arrived marker ("FIN", "**FINA") so the letters F-I-N-A-L never
    /// flash as visible text in the instant before the parser can swallow them.
    static func parse(_ raw: String, streaming: Bool) -> Parse {
        let ns = raw as NSString
        let matches = markerRegex.matches(in: raw, range: NSRange(location: 0, length: ns.length))
        guard let m = matches.last else {
            var working = raw
            if streaming { working = withholdPartialMarker(working) }
            return Parse(working: trimTail(working), final: nil)
        }
        var working = ns.substring(to: m.range.location)
        // If the model violated the contract with an EARLIER FINAL line, that superseded
        // conclusion stays visible as scratch — but without the shouting keyword.
        working = markerRegex.stringByReplacingMatches(
            in: working, range: NSRange(location: 0, length: (working as NSString).length),
            withTemplate: "")
        let payload = ns.substring(from: m.range.location + m.range.length)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        var final = payload
        var overflow = ""
        if let nl = payload.firstIndex(of: "\n") {
            final = String(payload[..<nl]).trimmingCharacters(in: .whitespaces)
            overflow = String(payload[payload.index(after: nl)...])
                .trimmingCharacters(in: .whitespacesAndNewlines)
        }
        final = stripUnbalancedFences(final)
        return Parse(working: trimTail(working), final: final, overflow: overflow)
    }

    /// True once the marker itself is fully present (drives the 推理中… → 作答中… status flip).
    static func hasMarker(_ raw: String) -> Bool {
        let ns = raw as NSString
        return markerRegex.firstMatch(in: raw, range: NSRange(location: 0, length: ns.length)) != nil
    }

    /// The answer-card payload as clean plain text for the clipboard — the FINAL answer with any
    /// inline markdown (`**bold**`, `` `code` ``) flattened to what the card visually shows.
    /// nil when the reply carries no answer card (no marker → nothing to auto-copy).
    static func clipboardAnswer(_ raw: String) -> String? {
        guard let final = parse(raw, streaming: false).final, !final.isEmpty else { return nil }
        if let a = try? AttributedString(
            markdown: final, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)) {
            let flat = String(a.characters).trimmingCharacters(in: .whitespacesAndNewlines)
            if !flat.isEmpty { return flat }
        }
        return final
    }

    // MARK: - Helpers

    private static func trimTail(_ s: String) -> String {
        var t = Substring(s)
        while let last = t.last, last == "\n" || last == " " || last == "\t" || last == "\r" {
            t = t.dropLast()
        }
        return String(t)
    }

    /// If the last line could still become a marker ("FIN", "**FINAL"), withhold that line.
    /// A line that has already diverged ("Finally, …") is shown as normal text.
    private static func withholdPartialMarker(_ text: String) -> String {
        let lineStart = text.range(of: "\n", options: .backwards)?.upperBound ?? text.startIndex
        let lastLine = text[lineStart...]
        // Strip the leading decoration the regex tolerates, then compare against "FINAL:".
        var core = Substring(lastLine).drop(while: { " \t".contains($0) })
        while let f = core.first, "#*_".contains(f) { core = core.dropFirst() }
        core = core.drop(while: { " \t".contains($0) })
        guard !core.isEmpty else { return text }
        let upper = core.uppercased()
        // A full "FINAL:"/"FINAL：" already matches the real regex; only shorter prefixes hide.
        if "FINAL:".hasPrefix(upper) || "FINAL：".hasPrefix(upper) {
            return String(text[..<lineStart])
        }
        return text
    }

    /// A bold-decorated marker line leaves half a fence in the payload: `**FINAL:** ADBCE` leaves
    /// a leading "**", `**FINAL: ADBCE**` a trailing one. Strip a fence only when its count in
    /// the payload is ODD (unbalanced) — a legitimate `FINAL: **ADBCE**（…）` keeps its balanced
    /// pair for the markdown renderer to turn into bold.
    private static func stripUnbalancedFences(_ s: String) -> String {
        var out = s
        for fence in ["**", "__"] {
            let count = out.components(separatedBy: fence).count - 1
            guard count % 2 == 1 else { continue }
            if out.hasPrefix(fence) {
                out = String(out.dropFirst(fence.count)).trimmingCharacters(in: .whitespacesAndNewlines)
            } else if out.hasSuffix(fence) {
                out = String(out.dropLast(fence.count)).trimmingCharacters(in: .whitespacesAndNewlines)
            }
        }
        return out
    }
}
