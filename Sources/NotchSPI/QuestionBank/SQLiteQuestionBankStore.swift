import Darwin
import Foundation
import SQLite3

actor SQLiteQuestionBankStore {
    let databaseURL: URL
    private var db: OpaquePointer?
    private(set) var unavailableReason: String?
    private let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

    init(databaseURL: URL) {
        self.databaseURL = databaseURL
    }

    func failureReason() -> String? { unavailableReason }

    func open() {
        guard db == nil else { return }
        do {
            try FileManager.default.createDirectory(at: databaseURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            var handle: OpaquePointer?
            let flags = SQLITE_OPEN_CREATE | SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX
            guard sqlite3_open_v2(databaseURL.path, &handle, flags, nil) == SQLITE_OK, let handle else {
                unavailableReason = "open_failed"
                if let handle { sqlite3_close(handle) }
                return
            }
            db = handle
            try exec("PRAGMA foreign_keys = ON")
            try exec("PRAGMA busy_timeout = 2000")
            try migrate()
            _ = try int64("SELECT COUNT(*) FROM banks")
        } catch {
            if unavailableReason == nil { unavailableReason = "migration_failed" }
        }
    }

    func hasEnabledBank() throws -> Bool {
        try require()
        return try int64("SELECT COUNT(*) FROM banks WHERE enabled = 1") > 0
    }

    func summaries() throws -> [QuestionBankSummary] {
        try require()
        return try rows("SELECT instance_id, external_bank_id, title, author, version, language, origin, enabled, allow_automatic, catalog_revision, imported_at, file_digest, content_digest, (SELECT COUNT(*) FROM bank_items i WHERE i.bank_instance_id = banks.instance_id) FROM banks ORDER BY imported_at, title") { stmt in
            QuestionBankSummary(
                instanceID: UUID(uuidString: text(stmt, 0)) ?? UUID(),
                externalBankID: text(stmt, 1),
                title: text(stmt, 2),
                author: optional(stmt, 3),
                version: text(stmt, 4),
                language: BankLanguage(rawValue: text(stmt, 5)) ?? .en,
                origin: QuestionBankOrigin(rawValue: text(stmt, 6)) ?? .imported,
                questionCount: Int(sqlite3_column_int64(stmt, 13)),
                enabled: sqlite3_column_int(stmt, 7) == 1,
                allowAutomatic: sqlite3_column_int(stmt, 8) == 1,
                catalogRevision: Int(sqlite3_column_int64(stmt, 9)),
                importedAt: text(stmt, 10),
                fileDigest: text(stmt, 11),
                contentDigest: text(stmt, 12))
        }
    }

    func summary(_ id: UUID) throws -> QuestionBankSummary? {
        try summaries().first { $0.instanceID == id }
    }

    func banks(externalID: String) throws -> [QuestionBankSummary] {
        try summaries().filter { $0.externalBankID == externalID }
    }

    func bank(fileDigest: String) throws -> QuestionBankSummary? {
        try summaries().first { $0.fileDigest == fileDigest }
    }

    func enabledLanguages() throws -> [BankLanguage] {
        try require()
        let values = try rows("SELECT DISTINCT language FROM banks WHERE enabled = 1") { BankLanguage(rawValue: text($0, 0)) }
        return values.compactMap { $0 }
    }

    func enabledLanguages(deadline: TimeInterval) throws -> [BankLanguage] {
        try withLookupBudget(deadline) { try self.enabledLanguages() }
    }

    func itemSnapshots(_ instanceID: UUID) throws -> [ItemSnapshot] {
        try require()
        return try rows("SELECT external_item_id, question_key, answer_semantic_key, item_revision FROM bank_items WHERE bank_instance_id = ?", bind: [.text(instanceID.uuidString)]) { stmt in
            ItemSnapshot(itemID: text(stmt, 0), questionKey: text(stmt, 1), answerSemanticKey: text(stmt, 2), itemRevision: Int(sqlite3_column_int64(stmt, 3)))
        }
    }

    struct ItemSnapshot: Equatable, Sendable {
        var itemID: String
        var questionKey: String
        var answerSemanticKey: String
        var itemRevision: Int
    }

    func search(query: String, offset: Int, instanceID: UUID?) throws -> QuestionSearchPage {
        try require()
        let trimmed = QuestionIdentity.searchField(query)
        let scoped = instanceID?.uuidString
        var whereSQL = "1 = 1"
        var bind: [Bind] = []
        if !trimmed.isEmpty {
            whereSQL += " AND bi.search_text LIKE ? ESCAPE '\\'"
            bind.append(.text(like(trimmed)))
        }
        if let scoped {
            whereSQL += " AND bi.bank_instance_id = ?"
            bind.append(.text(scoped))
        }
        let total = try int64("SELECT COUNT(*) FROM bank_items bi WHERE \(whereSQL)", bind: bind)
        var pageBind = bind
        pageBind.append(.int(QuestionBankLimits.searchPageSize))
        pageBind.append(.int(max(0, offset)))
        let hits = try rows("""
            SELECT bi.bank_instance_id, b.title, b.version, bi.external_item_id, bi.kind, bi.stem, bi.blocked_automatic, bi.question_key, bi.identity_version
            FROM bank_items bi JOIN banks b ON b.instance_id = bi.bank_instance_id
            WHERE \(whereSQL)
            ORDER BY b.title, bi.external_item_id
            LIMIT ? OFFSET ?
            """, bind: pageBind) { stmt -> QuestionSearchHit in
            let key = text(stmt, 7)
            let version = Int(sqlite3_column_int64(stmt, 8))
            let stem = text(stmt, 5)
            return QuestionSearchHit(
                instanceID: UUID(uuidString: text(stmt, 0)) ?? UUID(),
                bankTitle: text(stmt, 1),
                bankVersion: text(stmt, 2),
                itemID: text(stmt, 3),
                kind: QuestionKind(rawValue: text(stmt, 4)) ?? .shortFill,
                stemExcerpt: String(stem.prefix(180)),
                conflict: (try? self.semanticCount(key: key, version: version)) ?? 1 > 1,
                blockedAutomatic: sqlite3_column_int(stmt, 6) == 1)
        }
        return QuestionSearchPage(hits: hits, offset: max(0, offset), total: Int(total))
    }

    func detail(instanceID: UUID, itemID: String) throws -> QuestionDetail? {
        try require()
        let found = try rows("""
            SELECT b.title, b.version, b.origin, bi.kind, bi.language, bi.stem, bi.options_json, bi.answer_json, bi.explanation, bi.source, bi.blocked_automatic, bi.item_revision, bi.question_key, bi.identity_version
            FROM bank_items bi JOIN banks b ON b.instance_id = bi.bank_instance_id
            WHERE bi.bank_instance_id = ? AND bi.external_item_id = ?
            """, bind: [.text(instanceID.uuidString), .text(itemID)]) { stmt -> QuestionDetail in
            let options = QuestionBankCodec.options(text(stmt, 6))
            let answer = QuestionBankCodec.answer(text(stmt, 7))
            let rendered = QuestionIdentity.displayAnswer(kind: QuestionKind(rawValue: text(stmt, 3)) ?? .shortFill, answer: answer, options: options, labelMap: [:])
            let key = text(stmt, 12)
            let version = Int(sqlite3_column_int64(stmt, 13))
            return QuestionDetail(
                instanceID: instanceID, bankTitle: text(stmt, 0), bankVersion: text(stmt, 1),
                origin: QuestionBankOrigin(rawValue: text(stmt, 2)) ?? .imported,
                itemID: itemID, kind: QuestionKind(rawValue: text(stmt, 3)) ?? .shortFill,
                language: BankLanguage(rawValue: text(stmt, 4)) ?? .en,
                stem: text(stmt, 5), options: options, answerText: rendered.line,
                explanation: optional(stmt, 8), source: optional(stmt, 9),
                conflict: (try? self.semanticCount(key: key, version: version)) ?? 1 > 1,
                blockedAutomatic: sqlite3_column_int(stmt, 10) == 1,
                itemRevision: Int(sqlite3_column_int64(stmt, 11)))
        }
        return found.first
    }

    func candidates(stem: String, optionKey: String, kind: QuestionKind?) throws -> [LocalCandidate] {
        try require()
        var sql = """
            SELECT bi.bank_instance_id, b.title, b.version, bi.external_item_id, bi.item_revision, b.catalog_revision,
                   bi.kind, bi.stem, bi.options_json, bi.answer_json, bi.explanation, bi.source, bi.order_policy,
                   b.allow_automatic, bi.blocked_automatic, bi.answer_semantic_key, bi.question_key, b.origin, b.enabled
            FROM bank_items bi JOIN banks b ON b.instance_id = bi.bank_instance_id
            WHERE b.enabled = 1 AND bi.candidate_stem = ?
            """
        var bind: [Bind] = [.text(stem)]
        if let kind {
            sql += " AND bi.kind = ?"
            bind.append(.text(kind.rawValue))
        }
        let rows = try rows(sql, bind: bind) { stmt -> LocalCandidate? in
            let options = QuestionBankCodec.options(text(stmt, 8))
            let policy = OrderPolicy(rawValue: text(stmt, 12)) ?? .ordered
            let storedKey = QuestionIdentity.candidateOptionsKey(options, policy: policy)
            guard storedKey == optionKey else { return nil }
            return self.candidate(stmt, options: options, policy: policy)
        }
        return rows.compactMap { $0 }
    }

    func candidates(stem: String) throws -> [LocalCandidate] {
        try candidates(stem: stem, optionKey: QuestionIdentity.candidateOptionsKey([], policy: .ordered), kind: .shortFill)
            + matchingChoiceCandidates(stem: stem)
    }

    func candidates(stem: String, optionKey: String, kind: QuestionKind?, deadline: TimeInterval) throws -> [LocalCandidate] {
        try withLookupBudget(deadline) { try self.candidates(stem: stem, optionKey: optionKey, kind: kind) }
    }

    func candidates(stem: String, deadline: TimeInterval) throws -> [LocalCandidate] {
        try withLookupBudget(deadline) { try self.candidates(stem: stem) }
    }

    struct AliasHit: Equatable, Sendable {
        var alias: AliasRecord
        var candidate: LocalCandidate
    }

    func matchedAlias(scope: AliasScope, deadline: TimeInterval) throws -> AliasHit? {
        try withLookupBudget(deadline) {
            guard let alias = try self.alias(scope: scope),
                  let candidate = try self.candidate(instanceID: alias.instanceID, itemID: alias.itemID),
                  candidate.itemRevision == alias.itemRevision,
                  candidate.catalogRevision == alias.catalogRevision else { return nil }
            return AliasHit(alias: alias, candidate: candidate)
        }
    }

    func alias(scope: AliasScope) throws -> AliasRecord? {
        try require()
        let found = try rows("""
            SELECT alias_id, bank_instance_id, external_item_id, item_revision, catalog_revision, label_map_json, alias_version
            FROM input_aliases WHERE scope_key = ?
            """, bind: [.text(scope.storageKey)]) { stmt in
            AliasRecord(aliasID: text(stmt, 0), instanceID: UUID(uuidString: text(stmt, 1)) ?? UUID(), itemID: text(stmt, 2),
                        itemRevision: Int(sqlite3_column_int64(stmt, 3)), catalogRevision: Int(sqlite3_column_int64(stmt, 4)),
                        labelMap: QuestionBankCodec.stringMap(text(stmt, 5)), aliasVersion: Int(sqlite3_column_int64(stmt, 6)))
        }
        return found.first
    }

    struct AliasRecord: Equatable, Sendable {
        var aliasID: String
        var instanceID: UUID
        var itemID: String
        var itemRevision: Int
        var catalogRevision: Int
        var labelMap: [String: String]
        var aliasVersion: Int
    }

    func candidate(instanceID: UUID, itemID: String) throws -> LocalCandidate? {
        try require()
        let found = try rows("""
            SELECT bi.bank_instance_id, b.title, b.version, bi.external_item_id, bi.item_revision, b.catalog_revision,
                   bi.kind, bi.stem, bi.options_json, bi.answer_json, bi.explanation, bi.source, bi.order_policy,
                   b.allow_automatic, bi.blocked_automatic, bi.answer_semantic_key, bi.question_key, b.origin, b.enabled
            FROM bank_items bi JOIN banks b ON b.instance_id = bi.bank_instance_id
            WHERE bi.bank_instance_id = ? AND bi.external_item_id = ?
            """, bind: [.text(instanceID.uuidString), .text(itemID)]) { stmt -> LocalCandidate? in
            let options = QuestionBankCodec.options(text(stmt, 8))
            let policy = OrderPolicy(rawValue: text(stmt, 12)) ?? .ordered
            return self.candidate(stmt, options: options, policy: policy)
        }
        return found.first ?? nil
    }

    func candidate(instanceID: UUID, itemID: String, deadline: TimeInterval) throws -> LocalCandidate? {
        try withLookupBudget(deadline) { try self.candidate(instanceID: instanceID, itemID: itemID) }
    }

    func enabledAnswerKeys(identityKey: String) throws -> Set<String> {
        try answerKeys(identityKey)
    }

    func enabledAnswerKeys(identityKey: String, deadline: TimeInterval) throws -> Set<String> {
        try withLookupBudget(deadline) { try self.answerKeys(identityKey) }
    }

    /// Writes the alias only when the stored question is still the one the user saw.
    func saveAlias(scope: AliasScope, candidate: LocalCandidate, labelMap: [String: String]) throws {
        try require()
        try transaction {
            guard let fresh = try self.candidate(instanceID: candidate.instanceID, itemID: candidate.itemID) else {
                throw QuestionBankError.notFound
            }
            guard fresh.bankEnabled else { throw QuestionBankError.notFound }
            guard fresh.identityKey == candidate.identityKey,
                  fresh.itemRevision == candidate.itemRevision,
                  fresh.catalogRevision == candidate.catalogRevision else {
                throw QuestionBankError.stale
            }
            let storedMap = try Self.storedLabelMap(fresh, labelMap: labelMap)
            if let existing = try self.alias(scope: scope) {
                try self.run("""
                    UPDATE input_aliases SET bank_instance_id = ?, external_item_id = ?, item_revision = ?, catalog_revision = ?, label_map_json = ?, confirmed_at = ?, alias_version = alias_version + 1
                    WHERE alias_id = ?
                    """, bind: [.text(fresh.instanceID.uuidString), .text(fresh.itemID), .int(fresh.itemRevision), .int(fresh.catalogRevision), .text(QuestionBankCodec.stringMap(storedMap)), .text(Self.nowStamp()), .text(existing.aliasID)])
                return
            }
            try self.run("""
                INSERT INTO input_aliases (alias_id, scope_key, image_digest, bank_instance_id, external_item_id, item_revision, catalog_revision, label_map_json, confirmed_at, alias_version)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
                """, bind: [.text(UUID().uuidString), .text(scope.storageKey), .text(scope.imageDigests.first ?? ""), .text(fresh.instanceID.uuidString), .text(fresh.itemID), .int(fresh.itemRevision), .int(fresh.catalogRevision), .text(QuestionBankCodec.stringMap(storedMap)), .text(Self.nowStamp())])
        }
    }

    func qaHold(_ seconds: TimeInterval, entered: @escaping @Sendable () -> Void = {}) {
        entered()
        if seconds > 0 { Thread.sleep(forTimeInterval: seconds) }
    }

    func setEnabled(_ id: UUID, _ enabled: Bool) throws {
        try require()
        try run("UPDATE banks SET enabled = ? WHERE instance_id = ?", bind: [.int(enabled ? 1 : 0), .text(id.uuidString)])
    }

    func setAutomatic(_ id: UUID, _ allowed: Bool) throws {
        try require()
        try run("UPDATE banks SET allow_automatic = ? WHERE instance_id = ? AND origin = ?", bind: [.int(allowed ? 1 : 0), .text(id.uuidString), .text(QuestionBankOrigin.imported.rawValue)])
    }

    func setBlocked(instanceID: UUID, itemID: String, blocked: Bool) throws {
        try require()
        try run("UPDATE bank_items SET blocked_automatic = ? WHERE bank_instance_id = ? AND external_item_id = ?", bind: [.int(blocked ? 1 : 0), .text(instanceID.uuidString), .text(itemID)])
    }

    func deleteBank(_ id: UUID) throws {
        try require()
        try transaction {
            try self.run("DELETE FROM input_aliases WHERE bank_instance_id = ?", bind: [.text(id.uuidString)])
            try self.run("DELETE FROM banks WHERE instance_id = ?", bind: [.text(id.uuidString)])
            try self.exec("DELETE FROM questions WHERE NOT EXISTS (SELECT 1 FROM bank_items bi WHERE bi.question_key = questions.question_key AND bi.identity_version = questions.identity_version)")
        }
    }

    func commit(manifest: BankManifest, questions: [BankQuestion], fileDigest: String, contentDigest: String, enabled: Bool, allowAutomatic: Bool, update: UUID?, batchNote: String) throws -> UUID {
        try require()
        if questions.count > QuestionBankLimits.maxQuestions { throw QuestionBankError.root("too_many_questions") }
        if let update, try summary(update)?.origin == .builtIn {
            throw QuestionBankError.root("built_in_protected")
        }
        let instance = update ?? UUID()
        let stamp = Self.nowStamp()
        try transaction {
            let revision: Int
            let keepEnabled: Bool
            if let update {
                let current = try self.summary(update)
                revision = (current?.catalogRevision ?? 0) + 1
                keepEnabled = current?.enabled ?? enabled
                try self.run("DELETE FROM input_aliases WHERE bank_instance_id = ?", bind: [.text(update.uuidString)])
                try self.run("DELETE FROM bank_items WHERE bank_instance_id = ?", bind: [.text(update.uuidString)])
                try self.run("""
                    UPDATE banks SET external_bank_id = ?, title = ?, author = ?, version = ?, language = ?, description = ?, source = ?, license = ?,
                    file_digest = ?, content_digest = ?, enabled = ?, allow_automatic = ?, catalog_revision = ?
                    WHERE instance_id = ?
                    """, bind: [
                        .text(manifest.externalBankID), .text(manifest.title), .text(manifest.author ?? ""), .text(manifest.version.text), .text(manifest.language.rawValue),
                        .text(manifest.description ?? ""), .text(manifest.source ?? ""), .text(manifest.license ?? ""),
                        .text(fileDigest), .text(contentDigest), .int(keepEnabled ? 1 : 0), .int(allowAutomatic ? 1 : 0), .int(revision), .text(update.uuidString)
                    ])
            } else {
                revision = 1
                try self.run("""
                    INSERT INTO banks (instance_id, external_bank_id, title, author, version, language, description, source, license, origin, file_digest, content_digest, enabled, allow_automatic, catalog_revision, imported_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, bind: [
                        .text(instance.uuidString), .text(manifest.externalBankID), .text(manifest.title), .text(manifest.author ?? ""), .text(manifest.version.text), .text(manifest.language.rawValue),
                        .text(manifest.description ?? ""), .text(manifest.source ?? ""), .text(manifest.license ?? ""), .text(QuestionBankOrigin.imported.rawValue),
                        .text(fileDigest), .text(contentDigest), .int(enabled ? 1 : 0), .int(allowAutomatic ? 1 : 0), .int(revision), .text(stamp)
                    ])
            }
            for question in questions {
                try self.insertQuestion(question)
                try self.run("""
                    INSERT INTO bank_items (bank_instance_id, external_item_id, question_key, identity_version, item_revision, stem, options_json, answer_json, answer_semantic_key, explanation, source, blocked_automatic, kind, language, search_text, candidate_stem, candidate_options, order_policy)
                    VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)
                    """, bind: [
                        .text(instance.uuidString), .text(question.id), .text(question.identityKey), .int(QuestionIdentity.version),
                        .text(question.stem), .text(QuestionBankCodec.options(question.options)), .text(QuestionBankCodec.answer(question.answer)),
                        .text(question.answerSemanticKey), .text(question.explanation ?? ""), .text(question.source ?? ""),
                        .text(question.kind.rawValue), .text(question.language.rawValue), .text(question.searchText),
                        .text(question.candidateStem), .text(question.candidateOptions), .text(question.orderPolicy.rawValue)
                    ])
            }
            try self.exec("DELETE FROM questions WHERE NOT EXISTS (SELECT 1 FROM bank_items bi WHERE bi.question_key = questions.question_key AND bi.identity_version = questions.identity_version)")
            try self.run("""
                INSERT INTO import_batches (batch_id, file_digest, bank_instance_id, accepted_count, failed_count, status, created_at, failure_summary)
                VALUES (?, ?, ?, ?, 0, ?, ?, ?)
                """, bind: [.text(UUID().uuidString), .text(fileDigest), .text(instance.uuidString), .int(questions.count), .text(update == nil ? "created" : "updated"), .text(stamp), .text(String(batchNote.prefix(500)))])
        }
        return instance
    }

    func recordBatch(fileDigest: String, instanceID: UUID?, accepted: Int, failed: Int, status: String, note: String) throws {
        try require()
        try run("""
            INSERT INTO import_batches (batch_id, file_digest, bank_instance_id, accepted_count, failed_count, status, created_at, failure_summary)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, bind: [.text(UUID().uuidString), .text(fileDigest), .text(instanceID?.uuidString ?? ""), .int(accepted), .int(failed), .text(status), .text(Self.nowStamp()), .text(String(note.prefix(500)))])
    }

    private func insertQuestion(_ question: BankQuestion) throws {
        try run("""
            INSERT OR IGNORE INTO questions (question_key, identity_version, canonical_json, kind, language, search_text)
            VALUES (?, ?, ?, ?, ?, ?)
            """, bind: [.text(question.identityKey), .int(QuestionIdentity.version), .text(QuestionBankCodec.canonical(question)), .text(question.kind.rawValue), .text(question.language.rawValue), .text(question.searchText)])
    }

    private func matchingChoiceCandidates(stem: String) throws -> [LocalCandidate] {
        try require()
        return try rows("""
            SELECT bi.bank_instance_id, b.title, b.version, bi.external_item_id, bi.item_revision, b.catalog_revision,
                   bi.kind, bi.stem, bi.options_json, bi.answer_json, bi.explanation, bi.source, bi.order_policy,
                   b.allow_automatic, bi.blocked_automatic, bi.answer_semantic_key, bi.question_key, b.origin, b.enabled, bi.candidate_options
            FROM bank_items bi JOIN banks b ON b.instance_id = bi.bank_instance_id
            WHERE b.enabled = 1 AND bi.candidate_stem = ? AND bi.kind != ?
            """, bind: [.text(stem), .text(QuestionKind.shortFill.rawValue)]) { stmt -> LocalCandidate? in
            let options = QuestionBankCodec.options(text(stmt, 8))
            let policy = OrderPolicy(rawValue: text(stmt, 12)) ?? .ordered
            return self.candidate(stmt, options: options, policy: policy)
        }.compactMap { $0 }
    }

    private func candidate(_ stmt: OpaquePointer, options: [ChoiceOption], policy: OrderPolicy) -> LocalCandidate {
        LocalCandidate(
            instanceID: UUID(uuidString: text(stmt, 0)) ?? UUID(),
            bankTitle: text(stmt, 1), bankVersion: text(stmt, 2), itemID: text(stmt, 3),
            itemRevision: Int(sqlite3_column_int64(stmt, 4)), catalogRevision: Int(sqlite3_column_int64(stmt, 5)),
            kind: QuestionKind(rawValue: text(stmt, 6)) ?? .shortFill, stem: text(stmt, 7), options: options,
            answer: QuestionBankCodec.answer(text(stmt, 9)), explanation: optional(stmt, 10), source: optional(stmt, 11),
            orderPolicy: policy, allowAutomatic: sqlite3_column_int(stmt, 13) == 1, blockedAutomatic: sqlite3_column_int(stmt, 14) == 1,
            answerSemanticKey: text(stmt, 15), identityKey: text(stmt, 16),
            origin: QuestionBankOrigin(rawValue: text(stmt, 17)) ?? .imported,
            bankEnabled: sqlite3_column_int(stmt, 18) == 1)
    }

    private func semanticCount(key: String, version: Int) throws -> Int {
        try Int(int64("SELECT COUNT(DISTINCT answer_semantic_key) FROM bank_items WHERE identity_version = ? AND question_key = ?", bind: [.int(version), .text(key)]))
    }

    private func migrate() throws {
        let version = try int64("PRAGMA user_version")
        if version == 1 { return }
        if version > 1 { unavailableReason = "newer_schema"; throw QuestionBankError.unavailable("newer_schema") }
        if version != 0 { unavailableReason = "unknown_schema"; throw QuestionBankError.unavailable("unknown_schema") }
        if try tableExists("banks") {
            unavailableReason = "incomplete_schema"
            throw QuestionBankError.unavailable("incomplete_schema")
        }
        try transaction {
            try self.exec(Self.schema)
            try self.exec("PRAGMA user_version = 1")
        }
    }

    private func tableExists(_ name: String) throws -> Bool {
        try int64("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?", bind: [.text(name)]) > 0
    }

    private func require() throws {
        if db == nil { open() }
        if unavailableReason != nil || db == nil { throw QuestionBankError.unavailable(unavailableReason ?? "unavailable") }
    }

    private func answerKeys(_ identityKey: String) throws -> Set<String> {
        try require()
        let values = try rows("""
            SELECT DISTINCT bi.answer_semantic_key FROM bank_items bi
            JOIN banks b ON b.instance_id = bi.bank_instance_id
            WHERE b.enabled = 1 AND bi.identity_version = ? AND bi.question_key = ?
            """, bind: [.int(QuestionIdentity.version), .text(identityKey)]) { text($0, 0) }
        return Set(values)
    }

    private static func storedLabelMap(_ candidate: LocalCandidate, labelMap: [String: String]) throws -> [String: String] {
        if candidate.kind == .shortFill {
            guard labelMap.isEmpty else { throw QuestionBankError.conflict }
            return [:]
        }
        guard let valid = QuestionIdentity.validatedLabelMap(labelMap, bank: candidate.options, policy: candidate.orderPolicy) else {
            throw QuestionBankError.conflict
        }
        return valid.labelToOptionID
    }

    private func withLookupBudget<T>(_ deadline: TimeInterval, _ body: () throws -> T) throws -> T {
        try require()
        let remaining = deadline - ProcessInfo.processInfo.systemUptime
        if remaining <= 0 { throw QuestionBankError.unavailable("timeout") }
        let milliseconds = max(1, Int(remaining * 1000))
        setBusyTimeout(milliseconds)
        do {
            let value = try body()
            setBusyTimeout(2000)
            return value
        } catch {
            setBusyTimeout(2000)
            throw Self.lookupError(error)
        }
    }

    private func setBusyTimeout(_ milliseconds: Int) {
        guard let db else { return }
        sqlite3_busy_timeout(db, Int32(milliseconds))
    }

    private static func lookupError(_ error: Error) -> Error {
        guard case QuestionBankError.unavailable(let message) = error else { return error }
        let folded = message.lowercased()
        if message == "timeout" || message == "locked" || folded.contains("locked") || folded.contains("busy") {
            return QuestionBankError.unavailable("timeout")
        }
        return error
    }

    private func transaction(_ body: () throws -> Void) throws {
        try exec("BEGIN IMMEDIATE")
        do {
            try body()
            try exec("COMMIT")
        } catch {
            try? exec("ROLLBACK")
            throw error
        }
    }

    private func exec(_ sql: String) throws {
        try requireOpen()
        var error: UnsafeMutablePointer<CChar>?
        guard sqlite3_exec(db, sql, nil, nil, &error) == SQLITE_OK else {
            let message = error.map { String(cString: $0) } ?? "sqlite"
            sqlite3_free(error)
            throw QuestionBankError.unavailable(message)
        }
    }

    private func run(_ sql: String, bind: [Bind] = []) throws {
        let stmt = try prepare(sql, bind: bind)
        defer { sqlite3_finalize(stmt) }
        guard try step(stmt) == SQLITE_DONE else { throw QuestionBankError.unavailable("step") }
    }

    private func int64(_ sql: String, bind: [Bind] = []) throws -> Int64 {
        let stmt = try prepare(sql, bind: bind)
        defer { sqlite3_finalize(stmt) }
        guard try step(stmt) == SQLITE_ROW else { throw QuestionBankError.unavailable("query") }
        return sqlite3_column_int64(stmt, 0)
    }

    private func rows<T>(_ sql: String, bind: [Bind] = [], _ map: (OpaquePointer) throws -> T) throws -> [T] {
        let stmt = try prepare(sql, bind: bind)
        defer { sqlite3_finalize(stmt) }
        var out: [T] = []
        while true {
            let code = try step(stmt)
            if code == SQLITE_DONE { break }
            out.append(try map(stmt))
        }
        return out
    }

    private func step(_ stmt: OpaquePointer) throws -> Int32 {
        let code = sqlite3_step(stmt)
        if code == SQLITE_ROW || code == SQLITE_DONE { return code }
        if code == SQLITE_BUSY || code == SQLITE_LOCKED { throw QuestionBankError.unavailable("locked") }
        throw QuestionBankError.unavailable("step")
    }

    private func prepare(_ sql: String, bind: [Bind]) throws -> OpaquePointer {
        try requireOpen()
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK, let stmt else {
            throw QuestionBankError.unavailable("prepare")
        }
        for (offset, value) in bind.enumerated() {
            let index = Int32(offset + 1)
            switch value {
            case .text(let text):
                _ = text.withCString { sqlite3_bind_text(stmt, index, $0, -1, transient) }
            case .int(let number):
                sqlite3_bind_int64(stmt, index, Int64(number))
            }
        }
        return stmt
    }

    private func requireOpen() throws {
        if db == nil { throw QuestionBankError.unavailable(unavailableReason ?? "closed") }
    }

    private func text(_ stmt: OpaquePointer, _ index: Int32) -> String {
        guard let raw = sqlite3_column_text(stmt, index) else { return "" }
        return String(cString: raw)
    }

    private func optional(_ stmt: OpaquePointer, _ index: Int32) -> String? {
        if sqlite3_column_type(stmt, index) == SQLITE_NULL { return nil }
        let value = text(stmt, index)
        return value.isEmpty ? nil : value
    }

    private func like(_ text: String) -> String {
        var escaped = ""
        for character in text {
            if character == "\\" || character == "%" || character == "_" { escaped.append("\\") }
            escaped.append(character)
        }
        return "%" + escaped + "%"
    }

    private enum Bind {
        case text(String)
        case int(Int)
    }

    private static func nowStamp() -> String {
        ISO8601DateFormatter().string(from: Date())
    }

    private static let schema = """
    CREATE TABLE banks (
      instance_id TEXT PRIMARY KEY,
      external_bank_id TEXT NOT NULL,
      title TEXT NOT NULL,
      author TEXT,
      version TEXT NOT NULL,
      language TEXT NOT NULL,
      description TEXT,
      source TEXT,
      license TEXT,
      origin TEXT NOT NULL,
      file_digest TEXT NOT NULL,
      content_digest TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      allow_automatic INTEGER NOT NULL,
      catalog_revision INTEGER NOT NULL,
      imported_at TEXT NOT NULL
    );
    CREATE TABLE questions (
      question_key TEXT NOT NULL,
      identity_version INTEGER NOT NULL,
      canonical_json TEXT NOT NULL,
      kind TEXT NOT NULL,
      language TEXT NOT NULL,
      search_text TEXT NOT NULL,
      PRIMARY KEY (identity_version, question_key)
    );
    CREATE TABLE bank_items (
      bank_instance_id TEXT NOT NULL REFERENCES banks(instance_id) ON DELETE CASCADE,
      external_item_id TEXT NOT NULL,
      question_key TEXT NOT NULL,
      identity_version INTEGER NOT NULL,
      item_revision INTEGER NOT NULL,
      stem TEXT NOT NULL,
      options_json TEXT,
      answer_json TEXT NOT NULL,
      answer_semantic_key TEXT NOT NULL,
      explanation TEXT,
      source TEXT,
      blocked_automatic INTEGER NOT NULL DEFAULT 0,
      kind TEXT NOT NULL,
      language TEXT NOT NULL,
      search_text TEXT NOT NULL,
      candidate_stem TEXT NOT NULL,
      candidate_options TEXT NOT NULL,
      order_policy TEXT NOT NULL,
      PRIMARY KEY (bank_instance_id, external_item_id)
    );
    CREATE TABLE input_aliases (
      alias_id TEXT PRIMARY KEY,
      scope_key TEXT NOT NULL UNIQUE,
      image_digest TEXT NOT NULL,
      bank_instance_id TEXT NOT NULL,
      external_item_id TEXT NOT NULL,
      item_revision INTEGER NOT NULL,
      catalog_revision INTEGER NOT NULL,
      label_map_json TEXT NOT NULL,
      confirmed_at TEXT NOT NULL,
      alias_version INTEGER NOT NULL
    );
    CREATE TABLE import_batches (
      batch_id TEXT PRIMARY KEY,
      file_digest TEXT NOT NULL,
      bank_instance_id TEXT,
      accepted_count INTEGER NOT NULL,
      failed_count INTEGER NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      failure_summary TEXT
    );
    CREATE INDEX idx_items_identity ON bank_items(identity_version, question_key);
    CREATE INDEX idx_items_stem ON bank_items(candidate_stem);
    CREATE INDEX idx_items_search ON bank_items(search_text);
    """
}

enum QuestionBankCodec {
    static func options(_ options: [ChoiceOption]) -> String {
        let body = options.map { option in
            "{\"id\":\(json(option.id)),\"label\":\(json(option.label)),\"text\":\(json(option.text))}"
        }.joined(separator: ",")
        return "[" + body + "]"
    }

    static func options(_ jsonText: String) -> [ChoiceOption] {
        guard let data = jsonText.data(using: .utf8), let value = try? StrictJSON.parse(data), let array = value.array else { return [] }
        return array.compactMap { item in
            guard let id = item.field("id")?.string, let label = item.field("label")?.string, let text = item.field("text")?.string else { return nil }
            return ChoiceOption(id: id, label: label, text: text)
        }
    }

    static func answer(_ answer: QuestionAnswer) -> String {
        switch answer {
        case .choice(let ids):
            return "{\"option_ids\":[" + ids.map { json($0) }.joined(separator: ",") + "]}"
        case .fill(let text, let unit):
            if let unit, !unit.isEmpty { return "{\"text\":\(json(text)),\"unit\":\(json(unit))}" }
            return "{\"text\":\(json(text))}"
        }
    }

    static func answer(_ jsonText: String) -> QuestionAnswer {
        guard let data = jsonText.data(using: .utf8), let value = try? StrictJSON.parse(data) else {
            return .fill(text: "", unit: nil)
        }
        if let ids = value.field("option_ids")?.array?.compactMap(\.string) { return .choice(optionIDs: ids) }
        return .fill(text: value.field("text")?.string ?? "", unit: value.field("unit")?.string)
    }

    static func stringMap(_ map: [String: String]) -> String {
        let body = map.keys.sorted().map { key in "\(json(key)):\(json(map[key] ?? ""))" }.joined(separator: ",")
        return "{" + body + "}"
    }

    static func stringMap(_ jsonText: String) -> [String: String] {
        guard let data = jsonText.data(using: .utf8), let value = try? StrictJSON.parse(data), let pairs = value.object else { return [:] }
        var map: [String: String] = [:]
        for (key, item) in pairs { if let text = item.string { map[key] = text } }
        return map
    }

    static func canonical(_ question: BankQuestion) -> String {
        "{\"kind\":\(json(question.kind.rawValue)),\"language\":\(json(question.language.rawValue)),\"stem\":\(json(question.stem)),\"policy\":\(json(question.orderPolicy.rawValue)),\"identity\":\(json(question.identityKey))}"
    }

    private static func json(_ text: String) -> String {
        var out = "\""
        for scalar in text.unicodeScalars {
            switch scalar.value {
            case 0x5c: out += "\\\\"
            case 0x22: out += "\\\""
            case 0x0a: out += "\\n"
            case 0x0d: out += "\\r"
            case 0x09: out += "\\t"
            case ..<0x20: out += String(format: "\\u%04x", scalar.value)
            default: out.unicodeScalars.append(scalar)
            }
        }
        out += "\""
        return out
    }
}
