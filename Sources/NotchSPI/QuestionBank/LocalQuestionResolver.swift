import Foundation

struct LocalQuestionResolver {
    let store: SQLiteQuestionBankStore
    let gate: RecognitionGate

    func lookup(image: Data, scope: AliasScope, languages: [String], deadline: TimeInterval = ProcessInfo.processInfo.systemUptime + QuestionBankLimits.lookupBudget, now: @escaping @Sendable () -> TimeInterval, trace: @escaping @Sendable (String) -> Void = { _ in }) async -> LocalLookupOutcome {
        guard scope.imageDigests.count == 1 else { return .miss }
        if now() >= deadline { return .unavailable("timeout") }
        do {
            if let hit = try await store.matchedAlias(scope: scope, deadline: deadline) {
                var shown = hit.candidate
                shown.savedLabelMap = hit.alias.labelMap
                let options = aliasedOptions(shown, labelMap: hit.alias.labelMap)
                let keys = try await store.enabledAnswerKeys(identityKey: shown.identityKey, deadline: deadline)
                if keys.count > 1 || !shown.bankEnabled {
                    let active = try await store.candidates(stem: QuestionIdentity.candidateField(shown.stem), deadline: deadline)
                        .filter { $0.identityKey == shown.identityKey }
                    let candidates = active.map { candidate -> LocalCandidate in
                        var candidate = candidate
                        if candidate.instanceID == shown.instanceID && candidate.itemID == shown.itemID {
                            candidate.savedLabelMap = shown.savedLabelMap
                        } else if candidate.kind != .shortFill {
                            candidate.savedLabelMap = QuestionIdentity.mapping(
                                current: options.map { ($0.label, $0.text) }, bank: candidate.options,
                                policy: candidate.orderPolicy).labelToOptionID
                        }
                        return candidate
                    }.sorted { lhs, rhs in
                        if lhs.instanceID == shown.instanceID { return rhs.instanceID != shown.instanceID }
                        if rhs.instanceID == shown.instanceID { return false }
                        return (lhs.bankTitle, lhs.itemID) < (rhs.bankTitle, rhs.itemID)
                    }
                    if !candidates.isEmpty {
                        let limited = Array(candidates.prefix(QuestionBankLimits.maxCandidates))
                        return keys.count > 1 ? .conflict(limited, options: options) : .candidates(limited, options: options)
                    }
                    return .miss
                }
                if let answer = automaticAnswer(shown, labelMap: hit.alias.labelMap, method: "alias") { return .ready(answer) }
                return .candidates([shown], options: options)
            }
        } catch {
            return lookupFailure(error)
        }
        guard now() < deadline else { return .unavailable("timeout") }
        trace("ocrStarted")
        let recognized = await gate.recognize(image: image, languages: languages, deadline: deadline, now: now)
        trace("ocrCompleted")
        switch recognized {
        case .busy: return .unavailable("busy")
        case .timedOut: return .unavailable("timeout")
        case .lines(let recognition):
            return await match(recognition, deadline: deadline)
        }
    }

    func confirm(_ candidate: LocalCandidate, scope: AliasScope, labelMap: [String: String]) async -> Result<LocalAnswer, QuestionBankError> {
        do {
            guard let answer = manualAnswer(candidate, labelMap: labelMap) else { return .failure(.notFound) }
            try await store.saveAlias(scope: scope, candidate: candidate, labelMap: labelMap)
            return .success(answer)
        } catch let error as QuestionBankError {
            return .failure(error)
        } catch {
            return .failure(.unavailable("store"))
        }
    }

    func requalify(_ answer: LocalAnswer, automatic: Bool, deadline: TimeInterval = ProcessInfo.processInfo.systemUptime + QuestionBankLimits.lookupBudget) async -> LocalAnswer? {
        do {
            guard let fresh = try await store.candidate(instanceID: answer.bankInstanceID, itemID: answer.itemID, deadline: deadline), fresh.bankEnabled else { return nil }
            guard fresh.itemRevision == answer.itemRevision, fresh.catalogRevision == answer.catalogRevision, fresh.identityKey == answer.identityKey else { return nil }
            let keys = try await store.enabledAnswerKeys(identityKey: fresh.identityKey, deadline: deadline)
            let unique = keys.count == 1 && keys.contains(fresh.answerSemanticKey)
            if automatic {
                guard unique else { return nil }
                return automaticAnswer(fresh, labelMap: answer.currentLabelMap, method: answer.matchMethod)
            }
            guard var shown = manualAnswer(fresh, labelMap: answer.currentLabelMap) else { return nil }
            if !unique {
                shown.userTrusted = false
                shown.conflictsWithAnotherBank = true
            }
            return shown
        } catch { return nil }
    }

    private func match(_ recognition: QuestionRecognition, deadline: TimeInterval) async -> LocalLookupOutcome {
        let extracted = QuestionCandidateExtractor.extract(recognition.lines)
        do {
            let found: [LocalCandidate]
            switch extracted {
            case .miss:
                return .miss
            case .fill(let stem):
                found = try await store.candidates(stem: QuestionIdentity.candidateField(stem), optionKey: QuestionIdentity.candidateOptionsKey([], policy: .ordered), kind: .shortFill, deadline: deadline)
            case .choice(let stem, let options):
                let foldedStem = QuestionIdentity.candidateField(stem)
                let all = try await store.candidates(stem: foldedStem, deadline: deadline)
                found = all.filter { candidate in
                    guard candidate.kind != .shortFill else { return false }
                    return QuestionIdentity.candidateOptionsKey(candidate.options, policy: candidate.orderPolicy)
                        == QuestionIdentity.candidateOptionsKey(options.map { ChoiceOption(id: $0.label, label: $0.label, text: $0.text) }, policy: candidate.orderPolicy)
                }
            }
            let limited = Array(found.prefix(QuestionBankLimits.maxCandidates))
            guard !found.isEmpty else { return .miss }
            let current = extractedOptions(extracted)
            if Set(found.map(\.answerSemanticKey)).count > 1 { return .conflict(limited, options: current) }
            return .candidates(limited, options: current)
        } catch {
            return lookupFailure(error)
        }
    }

    private func aliasedOptions(_ candidate: LocalCandidate, labelMap: [String: String]) -> [ExtractedOption] {
        labelMap.keys.sorted().compactMap { label in
            guard let id = labelMap[label], let option = candidate.options.first(where: { $0.id == id }) else { return nil }
            return ExtractedOption(label: label, text: option.text)
        }
    }

    private func lookupFailure(_ error: Error) -> LocalLookupOutcome {
        if case QuestionBankError.unavailable(let message) = error, message == "timeout" {
            return .unavailable("timeout")
        }
        return .unavailable("store")
    }

    private func extractedOptions(_ extracted: ExtractedQuestion) -> [ExtractedOption] {
        if case .choice(_, let options) = extracted { return options }
        return []
    }

    private func automaticAnswer(_ candidate: LocalCandidate, labelMap: [String: String], method: String) -> LocalAnswer? {
        guard candidate.bankEnabled, candidate.allowAutomatic, !candidate.blockedAutomatic else { return nil }
        return makeAnswer(candidate, labelMap: labelMap, method: method, trusted: true)
    }

    private func manualAnswer(_ candidate: LocalCandidate, labelMap: [String: String]) -> LocalAnswer? {
        guard candidate.bankEnabled else { return nil }
        return makeAnswer(candidate, labelMap: labelMap, method: "confirmed", trusted: candidate.allowAutomatic)
    }

    private func makeAnswer(_ candidate: LocalCandidate, labelMap: [String: String], method: String, trusted: Bool) -> LocalAnswer {
        let rendered = QuestionIdentity.displayAnswer(kind: candidate.kind, answer: candidate.answer, options: candidate.options, labelMap: labelMap)
        return LocalAnswer(
            bankInstanceID: candidate.instanceID, bankTitle: candidate.bankTitle, bankVersion: candidate.bankVersion,
            itemID: candidate.itemID, itemRevision: candidate.itemRevision, catalogRevision: candidate.catalogRevision,
            questionKind: candidate.kind, currentAnswerText: rendered.line, copyText: rendered.copy,
            selectedOptionIDs: rendered.selected, currentLabelMap: labelMap,
            explanation: candidate.explanation, explanationApplicable: rendered.applicable,
            sourceKind: candidate.origin, userTrusted: trusted, matchMethod: method,
            identityKey: candidate.identityKey, answerSemanticKey: candidate.answerSemanticKey)
    }
}

enum LocalAnswerText {
    static func explanation(_ answer: LocalAnswer) -> String {
        if !answer.explanationApplicable {
            return L10n.t("原解析使用旧选项顺序", "元の解説は以前の選択肢順です", "The original explanation uses the previous option order")
        }
        if answer.explanation?.isEmpty != false {
            return L10n.t("此题库未提供解析", "この問題集に解説はありません", "This bank has no explanation")
        }
        return answer.explanation ?? ""
    }

    /// Plain text for accessibility and other text consumers; never a model protocol stream.
    static func rendered(answer: LocalAnswer, revealed: Bool) -> String {
        answer.currentAnswerText + (revealed ? "\n" + explanation(answer) : "")
    }

    static func sourceLine(_ answer: LocalAnswer) -> String {
        let origin = answer.sourceKind == .builtIn
            ? L10n.t("本地题库 · 官方内置", "ローカル問題集 · 公式内蔵", "Local bank · Built in")
            : L10n.t("本地题库 · 用户提供", "ローカル問題集 · ユーザー提供", "Local bank · Provided by you")
        var line = origin + " · " + answer.bankTitle + " " + answer.bankVersion
        if answer.conflictsWithAnotherBank {
            line += " · " + L10n.t("与其他已启用题库的答案不一致", "他の有効な問題集と答えが異なります", "Another enabled bank has a different answer")
        }
        return line
    }
}

enum LocalCaptureEligibility {
    static func allows(mode: String, depth: String, fromAuto: Bool, withContext: Bool, chooseRegion: Bool, imageCount: Int, onboarding: Bool, banksEnabled: Bool) -> Bool {
        banksEnabled && mode == "tutor" && depth == "brief" && !fromAuto && !withContext && !chooseRegion && imageCount == 1 && !onboarding
    }
}
