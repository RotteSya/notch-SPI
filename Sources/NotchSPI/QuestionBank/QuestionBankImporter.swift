import Foundation

struct QuestionBankImporter {
    let store: SQLiteQuestionBankStore

    func stage(_ url: URL) async -> ImportPreview {
        let filename = url.lastPathComponent
        let empty = ImportPreview(fileDigest: "", contentDigest: "", draft: PackageDraft(manifest: nil, questions: [], failures: [], rootError: "unreadable", warnings: [], needsLanguage: false, suggestedTitle: filename), title: filename, language: nil, allowAutomatic: false, identicalInstanceID: nil, sameExternalInstances: [], sameVersionChanged: [], higherVersionTargets: [], duplicateGroups: 0, conflictGroups: 0, replacementPreview: [])
        let data: Data
        do { data = try QuestionBankFiles.readRegularFile(url) }
        catch let error as QuestionBankError {
            var preview = empty
            if case .root(let message) = error { preview.draft.rootError = message }
            return preview
        } catch {
            return empty
        }
        guard let format = QuestionBankPackage.format(for: url) else {
            var preview = empty
            preview.draft.rootError = "unsupported_file"
            preview.fileDigest = QuestionBankFiles.sha256(data)
            return preview
        }
        return await stage(data: data, filename: filename, format: format)
    }

    func stage(data: Data, filename: String, format: QuestionBankPackage.Format) async -> ImportPreview {
        let digest = QuestionBankFiles.sha256(data)
        var draft = QuestionBankPackage.decode(data: data, filename: filename, format: format)
        if draft.rootError == nil, draft.manifest == nil, !draft.needsLanguage {
            let language = unanimousLanguage(draft.questions)
            if let language {
                let external = "local-" + String(digest.prefix(24))
                draft = QuestionBankPackage.apply(language: language, title: draft.suggestedTitle, externalID: external, to: draft)
            } else {
                draft.needsLanguage = true
            }
        }
        let content = draft.manifest.map { QuestionBankPackage.contentDigest(questions: draft.questions, manifest: $0) } ?? ""
        let preview = ImportPreview(fileDigest: digest, contentDigest: content, draft: draft, title: draft.manifest?.title ?? draft.suggestedTitle, language: draft.manifest?.language, allowAutomatic: false, identicalInstanceID: nil, sameExternalInstances: [], sameVersionChanged: [], higherVersionTargets: [], duplicateGroups: duplicateCount(draft.questions), conflictGroups: conflictCount(draft.questions), replacementPreview: [])
        guard draft.rootError == nil, draft.manifest != nil else { return preview }
        return await annotate(preview)
    }

    private func annotate(_ preview: ImportPreview) async -> ImportPreview {
        var preview = preview
        guard preview.draft.rootError == nil, let manifest = preview.draft.manifest else { return preview }
        do {
            if let sameFile = try await store.bank(fileDigest: preview.fileDigest) {
                preview.identicalInstanceID = sameFile.instanceID
            }
            let external = try await store.banks(externalID: manifest.externalBankID)
            preview.sameExternalInstances = external
            if preview.identicalInstanceID == nil {
                preview.identicalInstanceID = external.first { $0.contentDigest == preview.contentDigest && $0.version == manifest.version.text }?.instanceID
            }
            var changed: [UUID] = []
            var higher: [UUID] = []
            var replacements: [ReplacementPreview] = []
            for bank in external where bank.instanceID != preview.identicalInstanceID {
                guard let installed = BankVersion.parse(bank.version) else { continue }
                if installed == manifest.version && bank.contentDigest != preview.contentDigest { changed.append(bank.instanceID) }
                if installed < manifest.version {
                    higher.append(bank.instanceID)
                    let old = try await store.itemSnapshots(bank.instanceID)
                    replacements.append(diff(old: old, new: preview.draft.questions, instanceID: bank.instanceID))
                }
            }
            preview.sameVersionChanged = changed
            preview.higherVersionTargets = higher
            preview.replacementPreview = replacements
        } catch {
            preview.draft.rootError = "store_unavailable"
        }
        return preview
    }

    func applying(language: BankLanguage, title: String, to preview: ImportPreview) async -> ImportPreview {
        let external = preview.draft.manifest?.externalBankID ?? "local-" + String(preview.fileDigest.prefix(24))
        let draft = QuestionBankPackage.apply(language: language, title: title, externalID: external, to: preview.draft)
        var next = preview
        next.draft = draft
        next.title = draft.manifest?.title ?? title
        next.language = draft.manifest?.language
        next.contentDigest = draft.manifest.map { QuestionBankPackage.contentDigest(questions: draft.questions, manifest: $0) } ?? ""
        return await annotate(next)
    }

    func commit(_ preview: ImportPreview, decision: ImportDecision) async -> ImportCommitResult {
        let failed = preview.draft.failures.count
        let report = reportText(preview)
        guard preview.draft.rootError == nil, let manifest = preview.draft.manifest else {
            return ImportCommitResult(status: "rejected", instanceID: nil, accepted: 0, failed: failed, report: report)
        }
        guard preview.draft.questions.count <= QuestionBankLimits.maxQuestions else {
            return ImportCommitResult(status: "rejected", instanceID: nil, accepted: 0, failed: failed, report: report)
        }
        guard !preview.draft.questions.isEmpty else {
            return ImportCommitResult(status: "empty", instanceID: nil, accepted: 0, failed: failed, report: report)
        }
        if let identical = preview.identicalInstanceID, decision == .createNew || decision == .update(identical) {
            return ImportCommitResult(status: "noop", instanceID: identical, accepted: preview.draft.questions.count, failed: failed, report: report)
        }
        if case .update(let id) = decision {
            if preview.sameVersionChanged.contains(id) {
                return ImportCommitResult(status: "version_conflict", instanceID: id, accepted: 0, failed: failed, report: report)
            }
            if let installed = preview.sameExternalInstances.first(where: { $0.instanceID == id }),
               let current = BankVersion.parse(installed.version), current > manifest.version {
                return ImportCommitResult(status: "downgrade_refused", instanceID: id, accepted: 0, failed: failed, report: report)
            }
            guard preview.higherVersionTargets.contains(id) else {
                return ImportCommitResult(status: "unknown_target", instanceID: id, accepted: 0, failed: failed, report: report)
            }
            do {
                let instance = try await store.commit(manifest: titled(manifest, preview.title), questions: preview.draft.questions, fileDigest: preview.fileDigest, contentDigest: preview.contentDigest, enabled: true, allowAutomatic: preview.allowAutomatic, update: id, batchNote: "failed=\(failed)")
                return ImportCommitResult(status: "updated", instanceID: instance, accepted: preview.draft.questions.count, failed: failed, report: report)
            } catch {
                return ImportCommitResult(status: "failed", instanceID: id, accepted: 0, failed: failed, report: report)
            }
        }
        do {
            let instance = try await store.commit(manifest: titled(manifest, preview.title), questions: preview.draft.questions, fileDigest: preview.fileDigest, contentDigest: preview.contentDigest, enabled: true, allowAutomatic: preview.allowAutomatic, update: nil, batchNote: "failed=\(failed)")
            if failed > 0 { try? await store.recordBatch(fileDigest: preview.fileDigest, instanceID: instance, accepted: preview.draft.questions.count, failed: failed, status: "partial", note: report) }
            return ImportCommitResult(status: "created", instanceID: instance, accepted: preview.draft.questions.count, failed: failed, report: report)
        } catch {
            return ImportCommitResult(status: "failed", instanceID: nil, accepted: 0, failed: failed, report: report)
        }
    }

    private func titled(_ manifest: BankManifest, _ title: String) -> BankManifest {
        var copy = manifest
        if !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { copy.title = title }
        return copy
    }

    private func unanimousLanguage(_ questions: [BankQuestion]) -> BankLanguage? {
        let explicit = questions.filter(\.languageExplicit).map(\.language)
        let source = explicit.isEmpty ? questions.map(\.language) : explicit
        let unique = Set(source)
        return unique.count == 1 ? unique.first : nil
    }

    private func duplicateCount(_ questions: [BankQuestion]) -> Int {
        Dictionary(grouping: questions, by: \.identityKey).values.filter { items in
            items.count > 1 && Set(items.map(\.answerSemanticKey)).count == 1
        }.count
    }

    private func conflictCount(_ questions: [BankQuestion]) -> Int {
        Dictionary(grouping: questions, by: \.identityKey).values.filter { Set($0.map(\.answerSemanticKey)).count > 1 }.count
    }

    private func diff(old: [SQLiteQuestionBankStore.ItemSnapshot], new: [BankQuestion], instanceID: UUID) -> ReplacementPreview {
        let oldIDs = Dictionary(uniqueKeysWithValues: old.map { ($0.itemID, $0) })
        let newIDs = Dictionary(uniqueKeysWithValues: new.map { ($0.id, $0) })
        let added = newIDs.keys.filter { oldIDs[$0] == nil }.count
        let removed = oldIDs.keys.filter { newIDs[$0] == nil }.count
        let changed = newIDs.keys.filter { id in
            guard let prior = oldIDs[id], let item = newIDs[id] else { return false }
            return prior.questionKey != item.identityKey || prior.answerSemanticKey != item.answerSemanticKey
        }.count
        return ReplacementPreview(instanceID: instanceID, added: added, changed: changed, removed: removed)
    }

    private func reportText(_ preview: ImportPreview) -> String {
        var lines = ["status \(preview.draft.rootError ?? "ok")", "accepted \(preview.draft.questions.count)", "failed \(preview.draft.failures.count)"]
        for failure in preview.draft.failures {
            lines.append("row \(failure.index) \(failure.itemID ?? "-") \(failure.message)")
        }
        for warning in preview.draft.warnings { lines.append("warning \(warning)") }
        return lines.joined(separator: "\n")
    }
}
