import Foundation

struct CapturePrompt: Codable, Equatable {
    let system: String
    let task: String
}

enum Prompts {
    static let screenQueryClause = SharedProduct.prompt("screenQueryClause")

    /// Answer-language rule: match the problem's language, and when that's ambiguous (a bare
    /// formula, a diagram) fall back to the USER'S UI language — a Japanese user must never
    /// get a Chinese answer to a math screenshot.
    static var languageClause: String {
        let fallback: String
        switch L10n.lang {
        case .zh: fallback = "Simplified Chinese (简体中文)"
        case .ja: fallback = "Japanese (日本語)"
        case .en: fallback = "English"
        }
        return "Respond in the same language as the problem shown. If the language is unclear, respond in \(fallback)."
    }

    static var base: String { SharedProduct.prompt("base", values: ["languageClause": languageClause]) }

    /// The one-answer contract, shared by every depth that reveals a result. A streamed reply
    /// cannot be un-said: the panel shows text the moment it is generated, so a model that
    /// guesses early and corrects itself mid-stream leaves TWO answers on screen (the bug this
    /// clause exists to kill). The contract: verify FIRST, conclude ONCE, and mark the
    /// conclusion machine-readably — the client parses the FINAL line into the answer card and
    /// never shows the literal marker.
    static let finalLineClause = SharedProduct.prompt("finalLineClause")

    /// Compact enough to keep Objective V1 within the same-model token gate. The decision order
    /// is intentional: small vision models otherwise solve the legible arithmetic first and miss
    /// an on-screen ambiguity or crop warning that must downgrade the result.
    static let objectiveResultClause = SharedProduct.prompt("objectiveResultClause")

    static var objectiveBriefPrompt: String { SharedProduct.prompt("objectiveBriefPrompt", values: ["objectiveResultClause": objectiveResultClause]) }

    static let objectiveTask = SharedProduct.prompt("objectiveTask")

    static let depthClause: [String: String] = [
        "hint": "Solution detail: HINTS ONLY. Do NOT reveal the final answer or a full worked solution. Give one or two targeted hints and the single next step to try, then stop and invite them to attempt it themselves.",
        "guided": "Solution detail: GUIDED WALKTHROUGH. Work through the problem step by step, showing the reasoning and intermediate results. Close with a one-line takeaway of the general technique so it transfers to similar problems, then end with the FINAL line.",
        "full": "Solution detail: FULL WORKED SOLUTION. Provide the complete solution with every step justified, a short verification or sanity-check, a brief \"why this works\" note, and one common mistake to avoid — then end with the FINAL line.",
    ]

    // "简略" — the user wants the answer with minimal reading. The model still MUST work the
    // problem out first (an autoregressive model that is forbidden to reason can only guess —
    // that's how a wrong BDECA lands on screen before the right ADBCE), but the working stays
    // telegraphic scratch: the UI de-emphasizes it while streaming and folds it away once the
    // FINAL line arrives, leaving just the answer card.
    static var briefPrompt: String { SharedProduct.prompt("briefPrompt", values: ["finalLineClause": finalLineClause, "languageClause": languageClause]) }

    static func tutorText(_ depth: String) -> String {
        if depth == "brief" { return briefPrompt }
        let clause = depthClause[depth] ?? depthClause["guided"]!
        // Hints deliberately never reveal an answer, so they carry no FINAL contract.
        if depth == "hint" { return base + "\n\n" + clause }
        return base + "\n\n" + clause + "\n\n" + finalLineClause
    }

    // MARK: - 上下文追问 (two-image runs)

    /// Task line for a context run: the first image is the remembered ⌘⇧1 shot, the last is the
    /// fresh capture. Swapped in for the plain tutor task only — the system prompt (depth
    /// contract, FINAL line) is unchanged, so a context answer renders exactly like a tutor one.
    static let contextTask = SharedProduct.prompt("contextTask")

    /// The user-turn text every transport sends alongside the image block(s). Kept here so the
    /// three channels can never drift on how the images are introduced. The single-image form is
    /// byte-identical to the pre-context wording.
    static func analyzeTaskText(_ task: String, imageCount: Int) -> String {
        imageCount > 1
            ? "Analyze the \(imageCount) attached screenshot images in order, then \(task)"
            : "Analyze the attached screenshot image, then \(task)"
    }

    // MARK: - Frozen capture payload

    /// Build the complete request payload exactly once. All three transport channels receive this
    /// value; none of them is allowed to reconstruct prompts from live settings.
    static func capturePrompt(
        mode: String,
        depth: String,
        personaName: String,
        personaText: String,
        sessionContext: String,
        objectiveProtocolEnabled: Bool = false
    ) -> CapturePrompt {
        guard mode == "personality" else {
            // These two strings are the pre-refactor Tutor contract and deliberately ignore the
            // personality session parameter byte-for-byte.
            return CapturePrompt(
                system: objectiveProtocolEnabled && depth != "hint"
                    ? (depth == "brief"
                        ? objectiveBriefPrompt
                        : base + "\n\n" + (depthClause[depth] ?? depthClause["guided"]!)
                            + "\n\n" + objectiveResultClause)
                    : tutorText(depth),
                task: objectiveProtocolEnabled && depth != "hint"
                    ? objectiveTask
                    : "tutor me on the problem it shows."
            )
        }
        return CapturePrompt(
            system: personalityText(
                personaName: personaName,
                personaText: personaText,
                sessionContext: sessionContext
            ),
            task: "answer every visible personality-test item as the target persona, following the V1 output protocol above."
        )
    }

    private static func personalityText(
        personaName: String,
        personaText: String,
        sessionContext: String
    ) -> String {
        let personaData = jsonString([
            "name": personaName,
            "description": personaText,
        ])
        return SharedProduct.prompt("personality", values: ["personaData": personaData, "sessionContext": sessionContext])
    }

    private static func jsonString(_ object: [String: String]) -> String {
        let data = try! JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
        return String(decoding: data, as: UTF8.self)
    }
}
