import AppKit
import SQLite3
import XCTest
@testable import NotchSPI

final class QuestionBankTests: XCTestCase {
    private func json(_ questions: String, bankID: String = "demo.bank", version: String = "1.0.0", extra: String = "") -> Data {
        Data("""
        {"schema_version":1,"bank_id":"\(bankID)","title":"Demo","author":"格式示例","version":"\(version)","language":"zh"\(extra),"questions":[\(questions)]}
        """.utf8)
    }

    private func choice(_ id: String, _ stem: String, _ options: [(String, String, String)], _ answer: [String], type: String = "single_choice") -> String {
        let opts = options.map { #"{"id":"\#($0.0)","label":"\#($0.1)","text":"\#($0.2)"}"# }.joined(separator: ",")
        let ids = answer.map { "\"\($0)\"" }.joined(separator: ",")
        return #"{"id":"\#(id)","type":"\#(type)","stem":"\#(stem)","options":[\#(opts)],"answer":{"option_ids":[\#(ids)]}}"#
    }

    private func decode(_ data: Data, format: QuestionBankPackage.Format = .json, name: String = "demo.nspibank.json") -> PackageDraft {
        QuestionBankPackage.decode(data: data, filename: name, format: format)
    }

    private func question(_ data: Data) -> BankQuestion {
        let draft = decode(data)
        XCTAssertNil(draft.rootError, draft.rootError ?? "")
        return draft.questions[0]
    }

    func testSamplePackageAndCSVKeepChoiceIDsAndFillUnits() throws {
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("Fixtures/QuestionBank")
        let jsonData = try Data(contentsOf: root.appendingPathComponent("sample-bank.nspibank.json"))
        let csvData = try Data(contentsOf: root.appendingPathComponent("sample-bank.csv"))
        let jsonDraft = decode(jsonData)
        let csvDraft = decode(csvData, format: .csv, name: "sample-bank.csv")
        XCTAssertEqual(jsonDraft.questions.count, 3)
        XCTAssertEqual(csvDraft.questions.map(\.id), ["q001", "q002", "q003"])
        XCTAssertEqual(jsonDraft.questions.map(\.identityKey), csvDraft.questions.map(\.identityKey))
        let single = try XCTUnwrap(jsonDraft.questions.first { $0.id == "q001" })
        XCTAssertEqual(single.options.map(\.id), ["o_a", "o_b", "o_c"])
        let multi = try XCTUnwrap(csvDraft.questions.first { $0.id == "q002" })
        guard case .choice(let ids) = multi.answer else { return XCTFail("choice") }
        XCTAssertEqual(ids, ["o_a", "o_c"])
        let fill = try XCTUnwrap(jsonDraft.questions.first { $0.id == "q003" })
        let shown = QuestionIdentity.displayAnswer(kind: fill.kind, answer: fill.answer, options: [], labelMap: [:])
        XCTAssertEqual(shown.line, "15 cm²")
        XCTAssertFalse(fill.unitRepeatedInText)
    }

    func testCSVQuotesNewlinesBOMAndBrokenRows() {
        var text = "\u{feff}" + QuestionBankCSV.header.joined(separator: ",") + "\r\n"
        text += "\"q1\",\"single_choice\",\"zh\",\"line1\r\nline2\",\"a,b\",\"c\"\"d\",\"e\",,,,\"B\",,\"ex\"\"p\",\"src\"\r\n"
        text += "bad,row\n"
        let draft = decode(Data(text.utf8), format: .csv, name: "bank.csv")
        XCTAssertEqual(draft.questions.count, 1, "root=\(draft.rootError ?? "-") failures=\(draft.failures)")
        guard let parsed = draft.questions.first else { return }
        XCTAssertEqual(parsed.stem, "line1\nline2")
        XCTAssertEqual(parsed.options.map(\.text), ["a,b", "c\"d", "e"])
        XCTAssertTrue(draft.failures.contains { $0.message == "column_count" })
    }

    func testRejectsUnknownSchemaDuplicateKeysMissingOptionsAndTrustFields() {
        let unknown = decode(Data("{\"schema_version\":2}".utf8))
        XCTAssertEqual(unknown.rootError, "unsupported_schema:2")
        XCTAssertTrue(unknown.questions.isEmpty)
        let dup = decode(Data("{\"schema_version\":1,\"schema_version\":1}".utf8))
        XCTAssertEqual(dup.rootError, "duplicate_key:schema_version")
        let official = json(choice("q", "1+1?", [("o_a", "A", "1"), ("o_b", "B", "2")], ["o_b"]), extra: ",\"official\":true")
        XCTAssertEqual(decode(official).rootError, "unknown_field:official")
        let verified = json(choice("q", "1+1?", [("o_a", "A", "1"), ("o_b", "B", "2")], ["o_b"]), extra: ",\"verified\":true")
        XCTAssertTrue(decode(verified).rootError?.contains("verified") == true)
        let missing = json(#"{"id":"q","type":"single_choice","stem":"1+1?","options":[{"id":"o_a","label":"A","text":"1"},{"id":"o_b","label":"B","text":"2"}],"answer":{"option_ids":["o_z"]}}"#)
        XCTAssertTrue(decode(missing).failures.contains { $0.message.contains("answer") || $0.message.contains("option") })
        XCTAssertTrue(decode(missing).questions.isEmpty)
        let both = json([
            choice("q", "1+1?", [("o_a", "A", "1"), ("o_b", "B", "2")], ["o_b"]),
            choice("q", "2+2?", [("o_a", "A", "3"), ("o_b", "B", "4")], ["o_b"]),
        ].joined(separator: ","))
        let draft = decode(both)
        XCTAssertTrue(draft.questions.isEmpty)
        XCTAssertEqual(draft.failures.filter { $0.message == "duplicate_id" }.count, 2)
    }

    func testIdentityKeepsDigitsSignsUnitsNegationAndSuperscripts() {
        let base = question(json(choice("q", "速度是 1 000 m/s 吗？", [("o_a", "A", "是"), ("o_b", "B", "不是")], ["o_b"])))
        let grouped = question(json(choice("q", "速度是 1000 m/s 吗？", [("o_a", "A", "是"), ("o_b", "B", "不是")], ["o_b"])))
        let sign = question(json(choice("q", "速度是 -1 000 m/s 吗？", [("o_a", "A", "是"), ("o_b", "B", "不是")], ["o_b"])))
        let unit = question(json(choice("q", "速度是 1 000 km/s 吗？", [("o_a", "A", "是"), ("o_b", "B", "不是")], ["o_b"])))
        let negation = question(json(choice("q", "速度是 1 000 m/s 吗？", [("o_a", "A", "是"), ("o_b", "B", "是")], ["o_a"])))
        let superscript = question(json(choice("q", "面积是 15 cm² 吗？", [("o_a", "A", "是"), ("o_b", "B", "不是")], ["o_b"])))
        let plain = question(json(choice("q", "面积是 15 cm2 吗？", [("o_a", "A", "是"), ("o_b", "B", "不是")], ["o_b"])))
        XCTAssertNotEqual(base.identityKey, grouped.identityKey)
        XCTAssertNotEqual(base.identityKey, sign.identityKey)
        XCTAssertNotEqual(base.identityKey, unit.identityKey)
        XCTAssertNotEqual(base.identityKey, negation.identityKey)
        XCTAssertNotEqual(superscript.identityKey, plain.identityKey)
        let reordered = question(json(choice("q", "速度是 1 000 m/s 吗？", [("o_b", "B", "不是"), ("o_a", "A", "是")], ["o_b"])))
        XCTAssertEqual(base.identityKey, reordered.identityKey)
        XCTAssertEqual(base.orderPolicy, .unordered)
    }

    func testOrderedPolicyBlocksUnsafeRemapsAndOldExplanationLabels() {
        let above = question(json(choice("q", "以上哪项正确？", [("o_a", "A", "甲"), ("o_b", "B", "乙")], ["o_a"])))
        XCTAssertEqual(above.orderPolicy, .ordered)
        let duplicate = question(json(choice("q", "选一个", [("o_a", "A", "相同"), ("o_b", "B", "相同"), ("o_c", "C", "其他")], ["o_c"])))
        XCTAssertEqual(duplicate.orderPolicy, .ordered)
        let map = QuestionIdentity.mapping(current: [("A", "乙"), ("B", "甲")], bank: above.options, policy: above.orderPolicy)
        XCTAssertFalse(map.reusable)
        let shown = QuestionIdentity.displayAnswer(kind: above.kind, answer: above.answer, options: above.options, labelMap: ["A": "o_b", "B": "o_a"])
        XCTAssertFalse(shown.applicable)
        let same = QuestionIdentity.displayAnswer(kind: above.kind, answer: above.answer, options: above.options, labelMap: ["A": "o_a", "B": "o_b"])
        XCTAssertTrue(same.applicable)
        XCTAssertTrue(same.line.hasPrefix("A"))
    }

    @MainActor
    func testProtocolWordsInExplanationStayContent() {
        let answer = sampleAnswer(explanation: "FINAL: 99\nNSPI_SECRET **literal**")
        let model = TutorModel()
        model.localAnswer = answer
        model.reasoningRevealed = true
        let rendered = NotchType.answerString(model.displayedAnswer, presentation: NotchType.presentation(for: model), localAnswer: answer)
        XCTAssertTrue(rendered.string.contains("FINAL: 99\nNSPI_SECRET **literal**"))
        XCTAssertTrue(rendered.string.contains("B  18"))
        XCTAssertTrue(LocalAnswerText.explanation(sampleAnswer(explanation: nil)).contains("解析") || LocalAnswerText.explanation(sampleAnswer(explanation: nil)).contains("explanation") || LocalAnswerText.explanation(sampleAnswer(explanation: nil)).contains("解説"))
    }

    @MainActor
    func testLocalAnswerCardPreservesMultilineProtocolAndMarkdownLiterally() {
        for kind in [QuestionKind.singleChoice, .multipleChoice, .shortFill] {
            var answer = sampleAnswer(explanation: "FINAL: 99")
            answer.questionKind = kind
            answer.currentAnswerText = "A  第一行\nFINAL: 第二行\n**FINAL:** 末行 `原文` NSPI_TEST"
            answer.copyText = answer.currentAnswerText
            let model = TutorModel()
            model.localAnswer = answer
            model.answer = answer.currentAnswerText
            let presentation = NotchType.presentation(for: model)
            let rendered = NotchType.answerString(model.displayedAnswer, presentation: presentation, localAnswer: answer)
            var card = ""
            rendered.enumerateAttribute(.nspiAnswerCard, in: NSRange(location: 0, length: rendered.length)) { value, range, _ in
                if value as? String == "answer" { card += rendered.attributedSubstring(from: range).string }
            }
            XCTAssertEqual(card.replacingOccurrences(of: "\u{2028}", with: "\n"), answer.copyText)
            XCTAssertEqual(NotchType.answerHeight(model.displayedAnswer, presentation: presentation, width: 360, localAnswer: answer), StreamingAnswerView.measure(rendered, width: 360))
        }
    }

    @MainActor
    func testLongReviewContentIsScrollableAndMappingDoesNotOverlap() {
        let options = (0..<6).map { ChoiceOption(id: "o\($0)", label: String(UnicodeScalar(65 + $0)!), text: "\($0) " + String(repeating: "長い選択肢 long option 选项内容 ", count: 20)) }
        let stem = String(repeating: "完整条件 15 m/s; 条件を確認; check every condition\n", count: 30)
        let candidate = LocalCandidate(instanceID: UUID(), bankTitle: "Long", bankVersion: "1.0.0", itemID: "q", itemRevision: 1, catalogRevision: 1, kind: .singleChoice, stem: stem, options: options, answer: .choice(optionIDs: ["o1"]), explanation: nil, source: nil, orderPolicy: .unordered, allowAutomatic: false, blockedAutomatic: false, answerSemanticKey: "a", identityKey: "q", origin: .imported, bankEnabled: true)
        let review = QuestionMatchReviewController()
        review.present(imageURL: nil, candidates: [candidate], currentOptions: options.map { ExtractedOption(label: $0.label, text: $0.text) }, conflict: false, display: false)
        defer { review.dismiss() }
        func descendants(_ v: NSView) -> [NSView] { [v] + v.subviews.flatMap(descendants) }
        let views = descendants(review.window!.contentView!)
        let field = views.compactMap { $0 as? NSTextField }.first { $0.stringValue == stem }!
        XCTAssertNotNil(field.enclosingScrollView)
        XCTAssertGreaterThan(field.frame.height, 90)
        let scroll = field.enclosingScrollView!
        let document = scroll.documentView!
        XCTAssertGreaterThan(document.frame.height, scroll.contentSize.height)
        let blocks = document.subviews.sorted { $0.frame.minY < $1.frame.minY }
        for pair in zip(blocks, blocks.dropFirst()) { XCTAssertLessThanOrEqual(pair.0.frame.maxY, pair.1.frame.minY) }
        XCTAssertEqual(views.compactMap { $0 as? NSPopUpButton }.filter { !$0.isHidden }.count, 6)
        XCTAssertTrue(review.window!.styleMask.contains(.resizable))
        document.scroll(NSPoint(x: 0, y: document.frame.height))
        XCTAssertGreaterThan(scroll.contentView.bounds.minY, 0)
    }

    func testImportLifecycleSearchConflictAndReopen() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("nspi-qb-" + UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = SQLiteQuestionBankStore(databaseURL: root.appendingPathComponent("questions.sqlite"))
        await store.open()
        let importer = QuestionBankImporter(store: store)
        let file = root.appendingPathComponent("demo.nspibank.json")
        let body = json([
            choice("q1", "6 × 3 等于多少？", [("o_a", "A", "12"), ("o_b", "B", "18"), ("o_c", "C", "24")], ["o_b"]),
            choice("q2", "请选择所有偶数。", [("o_a", "A", "2"), ("o_b", "B", "3"), ("o_c", "C", "4")], ["o_a", "o_c"], type: "multiple_choice"),
            #"{"id":"q3","type":"short_fill","stem":"面积是多少？","answer":{"text":"15","unit":"cm²"}}"#,
        ].joined(separator: ","))
        try body.write(to: file)
        let preview = await importer.stage(file)
        XCTAssertFalse(preview.allowAutomatic)
        let created = await importer.commit(preview, decision: .createNew)
        XCTAssertEqual(created.status, "created")
        let again = await importer.commit(await importer.stage(file), decision: .createNew)
        XCTAssertEqual(again.status, "noop")
        let banks = try await store.summaries()
        XCTAssertEqual(banks.count, 1)
        XCTAssertEqual(banks[0].origin, .imported)
        XCTAssertFalse(banks[0].allowAutomatic)
        let zh = try await store.search(query: "偶数", offset: 0, instanceID: nil)
        XCTAssertEqual(zh.hits.count, 1)
        let ja = try await store.search(query: "cm²", offset: 0, instanceID: nil)
        XCTAssertEqual(ja.total, 0)
        let en = try await store.search(query: "18", offset: 0, instanceID: nil)
        XCTAssertGreaterThanOrEqual(en.total, 0)
        let area = try await store.search(query: "面积", offset: 0, instanceID: nil)
        XCTAssertEqual(area.hits.count, 1)
        let detail = try await store.detail(instanceID: banks[0].instanceID, itemID: "q3")
        XCTAssertEqual(detail?.answerText, "15 cm²")

        let other = json(choice("q9", "6 × 3 等于多少？", [("o_a", "A", "12"), ("o_b", "B", "18"), ("o_c", "C", "24")], ["o_a"]), bankID: "other.bank")
        let otherFile = root.appendingPathComponent("other.json")
        try other.write(to: otherFile)
        let otherPreview = await importer.stage(otherFile)
        let otherCreated = await importer.commit(otherPreview, decision: .createNew)
        XCTAssertEqual(otherCreated.status, "created")
        let conflict = try await store.search(query: "等于多少", offset: 0, instanceID: nil)
        XCTAssertTrue(conflict.hits.contains { $0.conflict })
        try await store.deleteBank(try XCTUnwrap(otherCreated.instanceID))
        let remaining = try await store.search(query: "等于多少", offset: 0, instanceID: nil)
        XCTAssertEqual(remaining.hits.count, 1)
        XCTAssertFalse(remaining.hits[0].conflict)

        let reopened = SQLiteQuestionBankStore(databaseURL: root.appendingPathComponent("questions.sqlite"))
        await reopened.open()
        let after = try await reopened.summaries()
        XCTAssertEqual(after.count, 1)
        XCTAssertEqual(after[0].questionCount, 3)
    }

    func testHigherVersionUpdatesOneInstanceAndDropsAliases() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("nspi-qb-" + UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = SQLiteQuestionBankStore(databaseURL: root.appendingPathComponent("questions.sqlite"))
        await store.open()
        let importer = QuestionBankImporter(store: store)
        let v1 = root.appendingPathComponent("v1.json")
        try json(choice("q", "题干甲", [("o_a", "A", "1"), ("o_b", "B", "2")], ["o_a"])).write(to: v1)
        let first = await importer.commit(await importer.stage(v1), decision: .createNew)
        let id = try XCTUnwrap(first.instanceID)
        try await store.setAutomatic(id, true)
        let item = try await store.candidate(instanceID: id, itemID: "q")
        let scope = AliasScope(imageDigests: ["abc"], targetID: "full-screen", crop: "full")
        try await store.saveAlias(scope: scope, candidate: try XCTUnwrap(item), labelMap: ["A": "o_a", "B": "o_b"])
        let v1b = root.appendingPathComponent("v1b.json")
        try json(choice("q", "题干乙", [("o_a", "A", "1"), ("o_b", "B", "2")], ["o_a"])).write(to: v1b)
        let same = await importer.stage(v1b)
        let conflicted = await importer.commit(same, decision: .update(id))
        XCTAssertEqual(conflicted.status, "version_conflict")
        let v2 = root.appendingPathComponent("v2.json")
        try json(choice("q", "题干甲改", [("o_a", "A", "1"), ("o_b", "B", "2")], ["o_b"]), version: "1.1.0").write(to: v2)
        var update = await importer.stage(v2)
        XCTAssertEqual(update.higherVersionTargets, [id])
        XCTAssertFalse(update.allowAutomatic)
        update.allowAutomatic = false
        let updated = await importer.commit(update, decision: .update(id))
        XCTAssertEqual(updated.status, "updated")
        let loaded = try await store.summary(id)
        let summary = try XCTUnwrap(loaded)
        XCTAssertEqual(summary.version, "1.1.0")
        XCTAssertTrue(summary.enabled)
        XCTAssertFalse(summary.allowAutomatic)
        let alias = try await store.alias(scope: scope)
        XCTAssertNil(alias)
        let kept = try await store.search(query: "题干甲", offset: 0, instanceID: nil)
        XCTAssertEqual(kept.hits.count, 1)
    }

    func testCorruptSchemaIsKeptAndLookupStaysUnavailable() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("nspi-qb-" + UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let database = root.appendingPathComponent("questions.sqlite")
        var handle: OpaquePointer?
        XCTAssertEqual(sqlite3_open(database.path, &handle), SQLITE_OK)
        XCTAssertEqual(sqlite3_exec(handle, "PRAGMA user_version = 2", nil, nil, nil), SQLITE_OK)
        sqlite3_close(handle)
        let store = SQLiteQuestionBankStore(databaseURL: database)
        await store.open()
        let reason = await store.failureReason()
        XCTAssertEqual(reason, "newer_schema")
        XCTAssertTrue(FileManager.default.fileExists(atPath: database.path))
        do {
            _ = try await store.hasEnabledBank()
            XCTFail("opened a newer schema")
        } catch {}
    }

    func testOCRMatchIsCandidateUntilAConfirmedAliasExists() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("nspi-qb-" + UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = SQLiteQuestionBankStore(databaseURL: root.appendingPathComponent("questions.sqlite"))
        await store.open()
        let importer = QuestionBankImporter(store: store)
        let file = root.appendingPathComponent("demo.json")
        try json(choice("q", "6 × 3 等于多少？", [("o_a", "A", "12"), ("o_b", "B", "18"), ("o_c", "C", "24")], ["o_b"])).write(to: file)
        let created = await importer.commit(await importer.stage(file), decision: .createNew)
        let id = try XCTUnwrap(created.instanceID)
        try await store.setAutomatic(id, true)
        let ocr = ScriptedQuestionOCR()
        ocr.result = QuestionRecognition(lines: [
            OCRLine(text: "6 × 3 等于多少？", x: 0.1, y: 0.1, width: 0.6, height: 0.04, confidence: 0.99),
            OCRLine(text: "A. 12", x: 0.1, y: 0.2, width: 0.4, height: 0.04, confidence: 0.99),
            OCRLine(text: "B. 18", x: 0.1, y: 0.3, width: 0.4, height: 0.04, confidence: 0.99),
            OCRLine(text: "C. 24", x: 0.1, y: 0.4, width: 0.4, height: 0.04, confidence: 0.99),
        ])
        let resolver = LocalQuestionResolver(store: store, gate: RecognitionGate(engine: ocr))
        let scope = AliasScope(imageDigests: ["img"], targetID: "window", crop: "full")
        let first = await resolver.lookup(image: Data([1]), scope: scope, languages: ["zh-Hans"], now: { ProcessInfo.processInfo.systemUptime })
        guard case .candidates(let items, _) = first else { return XCTFail("OCR equality is not an answer: \(first)") }
        XCTAssertEqual(items.count, 1)
        let confirmed = await resolver.confirm(items[0], scope: scope, labelMap: ["A": "o_a", "B": "o_b", "C": "o_c"])
        guard case .success = confirmed else { return XCTFail("confirm") }
        let second = await resolver.lookup(image: Data([1]), scope: scope, languages: ["zh-Hans"], now: { ProcessInfo.processInfo.systemUptime })
        guard case .ready(let answer) = second else { return XCTFail("alias should be ready: \(second)") }
        XCTAssertTrue(answer.currentAnswerText.contains("18"))
        try await store.setBlocked(instanceID: id, itemID: "q", blocked: true)
        let blocked = await resolver.requalify(answer, automatic: true)
        XCTAssertNil(blocked)
        ocr.result = QuestionRecognition(lines: [
            OCRLine(text: "6 × 4 等于多少？", x: 0.1, y: 0.1, width: 0.6, height: 0.04, confidence: 0.99),
            OCRLine(text: "A. 12", x: 0.1, y: 0.2, width: 0.4, height: 0.04, confidence: 0.99),
            OCRLine(text: "B. 18", x: 0.1, y: 0.3, width: 0.4, height: 0.04, confidence: 0.99),
            OCRLine(text: "C. 24", x: 0.1, y: 0.4, width: 0.4, height: 0.04, confidence: 0.99),
        ])
        let changed = AliasScope(imageDigests: ["other"], targetID: "window", crop: "full")
        let missed = await resolver.lookup(image: Data([1]), scope: changed, languages: ["zh-Hans"], now: { ProcessInfo.processInfo.systemUptime })
        XCTAssertEqual(missed, .miss)
    }

    func testOCRBudgetDoesNotWaitForASlowEngineOrStackCalls() async {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("nspi-qb-" + UUID().uuidString, isDirectory: true)
        try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = SQLiteQuestionBankStore(databaseURL: root.appendingPathComponent("questions.sqlite"))
        await store.open()
        let ocr = ScriptedQuestionOCR()
        ocr.delayNanoseconds = 800_000_000
        let resolver = LocalQuestionResolver(store: store, gate: RecognitionGate(engine: ocr))
        let scope = AliasScope(imageDigests: ["img"], targetID: "window", crop: "full")
        let started = Date()
        let first = await resolver.lookup(image: Data([1]), scope: scope, languages: ["en-US"], now: { ProcessInfo.processInfo.systemUptime })
        XCTAssertLessThan(Date().timeIntervalSince(started), 0.7)
        guard case .unavailable(let reason) = first else { return XCTFail("\(first)") }
        XCTAssertEqual(reason, "timeout")
        let second = await resolver.lookup(image: Data([1]), scope: scope, languages: ["en-US"], now: { ProcessInfo.processInfo.systemUptime })
        XCTAssertEqual(second, .unavailable("busy"))
        XCTAssertEqual(ocr.calls, 1)
        try? await Task.sleep(nanoseconds: 900_000_000)
        XCTAssertEqual(ocr.calls, 1)
    }

    func testTenThousandQuestionImportAndSearch() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("nspi-qb-" + UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        var questions: [String] = []
        questions.reserveCapacity(10_000)
        for index in 0..<10_000 {
            let id = "q\(index)"
            let stem = index == 42 ? "查找中文甲" : index == 77 ? "検索かな" : index == 88 ? "find english token" : "题目 \(index)"
            questions.append(choice(id, stem, [("o_a", "A", "1"), ("o_b", "B", "2")], ["o_a"]))
        }
        let data = json(questions.joined(separator: ","), bankID: "bulk.bank")
        let started = Date()
        let store = SQLiteQuestionBankStore(databaseURL: root.appendingPathComponent("questions.sqlite"))
        await store.open()
        let importer = QuestionBankImporter(store: store)
        let file = root.appendingPathComponent("bulk.json")
        try data.write(to: file)
        let result = await importer.commit(await importer.stage(file), decision: .createNew)
        let imported = Date().timeIntervalSince(started)
        XCTAssertEqual(result.status, "created")
        XCTAssertEqual(result.accepted, 10_000)
        var samples: [Double] = []
        for term in ["中文甲", "かな", "english"] {
            let t0 = Date()
            let page = try await store.search(query: term, offset: 0, instanceID: nil)
            samples.append(Date().timeIntervalSince(t0))
            XCTAssertEqual(page.hits.count, 1, term)
        }
        var repeated: [Double] = []
        for _ in 0..<21 {
            let t0 = Date()
            let page = try await store.search(query: "中文甲", offset: 0, instanceID: nil)
            repeated.append(Date().timeIntervalSince(t0))
            XCTAssertEqual(page.hits.count, 1)
        }
        let ordered = repeated.sorted()
        let p50 = ordered[ordered.count / 2]
        let p95 = ordered[min(ordered.count - 1, Int((Double(ordered.count) * 0.95).rounded(.up)) - 1)]
        print(String(format: "[QuestionBank] import_10k=%.3fs search=%@ zh_p50=%.4f zh_p95=%.4f", imported, samples.map { String(format: "%.4f", $0) }.joined(separator: ","), p50, p95))
        XCTAssertLessThan(imported, 30)
    }

    func testEmptyOversizedDowngradeAndCrossBankConflict() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("nspi-qb-" + UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = SQLiteQuestionBankStore(databaseURL: root.appendingPathComponent("questions.sqlite"))
        await store.open()
        let importer = QuestionBankImporter(store: store)

        let emptyData = Data(#"{"schema_version":1,"bank_id":"demo.bank","title":"Demo","version":"1.0.0","language":"zh","questions":[]}"#.utf8)
        XCTAssertEqual(decode(emptyData).rootError, "questions")
        let emptyFile = root.appendingPathComponent("empty.json")
        try emptyData.write(to: emptyFile)
        let emptyCommit = await importer.commit(await importer.stage(emptyFile), decision: .createNew)
        XCTAssertEqual(emptyCommit.status, "rejected")

        let broken = Data(#"{"schema_version":1,"bank_id":"demo.bank","title":"Demo","version":"1.0.0","language":"zh","questions":[{"id":"q","type":"essay","stem":"x"}]}"#.utf8)
        let brokenFile = root.appendingPathComponent("broken.json")
        try broken.write(to: brokenFile)
        let brokenPreview = await importer.stage(brokenFile)
        XCTAssertNil(brokenPreview.draft.rootError)
        XCTAssertTrue(brokenPreview.draft.questions.isEmpty)
        XCTAssertEqual(brokenPreview.draft.failures.first?.message, "type")
        let brokenCommit = await importer.commit(brokenPreview, decision: .createNew)
        XCTAssertEqual(brokenCommit.status, "empty")
        let afterBroken = try await store.summaries()
        XCTAssertEqual(afterBroken.count, 0)

        let directory = root.appendingPathComponent("folder.json", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let directoryPreview = await importer.stage(directory)
        XCTAssertEqual(directoryPreview.draft.rootError, "not_regular_file")

        let huge = root.appendingPathComponent("huge.json")
        FileManager.default.createFile(atPath: huge.path, contents: Data())
        let handle = try FileHandle(forWritingTo: huge)
        try handle.truncate(atOffset: UInt64(QuestionBankLimits.maxFileBytes + 1))
        try handle.close()
        let hugePreview = await importer.stage(huge)
        XCTAssertEqual(hugePreview.draft.rootError, "file_too_large")
        let afterHuge = try await store.summaries()
        XCTAssertEqual(afterHuge.count, 0)

        let current = root.appendingPathComponent("current.json")
        try json(choice("q", "题干甲", [("o_a", "A", "1"), ("o_b", "B", "2")], ["o_b"]), version: "2.0.0").write(to: current)
        let installed = await importer.commit(await importer.stage(current), decision: .createNew)
        let id = try XCTUnwrap(installed.instanceID)
        let older = root.appendingPathComponent("older.json")
        try json(choice("q", "题干甲改", [("o_a", "A", "1"), ("o_b", "B", "2")], ["o_a"]), version: "1.0.0").write(to: older)
        let downgrade = await importer.commit(await importer.stage(older), decision: .update(id))
        XCTAssertEqual(downgrade.status, "downgrade_refused")
        let keptVersion = try await store.summary(id)
        XCTAssertEqual(keptVersion?.version, "2.0.0")

        try await store.setAutomatic(id, true)
        let loadedItem = try await store.candidate(instanceID: id, itemID: "q")
        let item = try XCTUnwrap(loadedItem)
        let scope = AliasScope(imageDigests: ["same-image"], targetID: "window", crop: "full")
        try await store.saveAlias(scope: scope, candidate: item, labelMap: ["A": "o_a", "B": "o_b"])
        let rival = root.appendingPathComponent("rival.json")
        try json(choice("q", "题干甲", [("o_a", "A", "1"), ("o_b", "B", "2")], ["o_a"]), bankID: "other.bank").write(to: rival)
        let rivalCreated = await importer.commit(await importer.stage(rival), decision: .createNew)
        let rivalID = try XCTUnwrap(rivalCreated.instanceID)
        let resolver = LocalQuestionResolver(store: store, gate: RecognitionGate(engine: ScriptedQuestionOCR()))
        let blocked = await resolver.lookup(image: Data([1]), scope: scope, languages: ["zh-Hans"], now: { ProcessInfo.processInfo.systemUptime })
        guard case .conflict = blocked else { return XCTFail("enabled banks with different answers stay unresolved: \(blocked)") }
        try await store.setEnabled(rivalID, false)
        let ready = await resolver.lookup(image: Data([1]), scope: scope, languages: ["zh-Hans"], now: { ProcessInfo.processInfo.systemUptime })
        guard case .ready(let answer) = ready else { return XCTFail("one enabled answer can be reused: \(ready)") }
        XCTAssertTrue(answer.currentAnswerText.contains("2"))
        try await store.deleteBank(id)
        let survivor = try await store.search(query: "题干甲", offset: 0, instanceID: nil)
        XCTAssertEqual(survivor.hits.count, 1)
        XCTAssertEqual(survivor.hits[0].instanceID, rivalID)
    }

    func testEligibilitySkipsLocalForTheOriginalPaths() {
        XCTAssertTrue(LocalCaptureEligibility.allows(mode: "tutor", depth: "brief", fromAuto: false, withContext: false, chooseRegion: false, imageCount: 1, onboarding: false, banksEnabled: true))
        XCTAssertFalse(LocalCaptureEligibility.allows(mode: "tutor", depth: "hint", fromAuto: false, withContext: false, chooseRegion: false, imageCount: 1, onboarding: false, banksEnabled: true))
        XCTAssertFalse(LocalCaptureEligibility.allows(mode: "tutor", depth: "guided", fromAuto: false, withContext: false, chooseRegion: false, imageCount: 1, onboarding: false, banksEnabled: true))
        XCTAssertFalse(LocalCaptureEligibility.allows(mode: "tutor", depth: "full", fromAuto: false, withContext: false, chooseRegion: false, imageCount: 1, onboarding: false, banksEnabled: true))
        XCTAssertFalse(LocalCaptureEligibility.allows(mode: "personality", depth: "brief", fromAuto: false, withContext: false, chooseRegion: false, imageCount: 1, onboarding: false, banksEnabled: true))
        XCTAssertFalse(LocalCaptureEligibility.allows(mode: "tutor", depth: "brief", fromAuto: true, withContext: false, chooseRegion: false, imageCount: 1, onboarding: false, banksEnabled: true))
        XCTAssertFalse(LocalCaptureEligibility.allows(mode: "tutor", depth: "brief", fromAuto: false, withContext: true, chooseRegion: false, imageCount: 2, onboarding: false, banksEnabled: true))
        XCTAssertFalse(LocalCaptureEligibility.allows(mode: "tutor", depth: "brief", fromAuto: false, withContext: false, chooseRegion: false, imageCount: 1, onboarding: true, banksEnabled: true))
        XCTAssertFalse(LocalCaptureEligibility.allows(mode: "tutor", depth: "brief", fromAuto: false, withContext: false, chooseRegion: false, imageCount: 1, onboarding: false, banksEnabled: false))
    }

    @MainActor
    func testLocalHitDoesNotStartTheModelAndAMissStartsItOnce() async throws {
        let controller = NotchController(activateServices: false)
        defer { controller.prepareForTermination() }
        controller.qaPreserveSettings = true
        controller.qaDepthOverride = "brief"
        controller.qaCaptureModelPrep = { _ in }
        let banks = ScriptedBanks()
        banks.hasEnabledBank = true
        banks.next = .ready(sampleAnswer(explanation: "6 × 3 = 18。"))
        controller.qaQuestionBanks = banks
        let asset = try makeAsset()
        controller.qaStartPrepared([asset])
        for _ in 0..<50 where controller.model.localAnswer == nil {
            try await Task.sleep(nanoseconds: 20_000_000)
        }
        XCTAssertEqual(banks.lookups, 1)
        XCTAssertEqual(controller.qaModelInvocations, 0)
        XCTAssertNotNil(controller.model.localAnswer)
        XCTAssertNil(controller.model.resultState)
        XCTAssertEqual(controller.model.parserPath, .none)
        XCTAssertEqual(controller.model.answerLatency?.route, "local_bank")
        XCTAssertTrue(controller.model.statusText.contains("用户提供") || controller.model.statusText.contains("Provided by you") || controller.model.statusText.contains("ユーザー提供"))
        banks.next = .miss
        controller.qaStartPrepared([asset])
        for _ in 0..<50 where controller.qaModelInvocations == 0 {
            try await Task.sleep(nanoseconds: 20_000_000)
        }
        XCTAssertEqual(controller.qaModelInvocations, 1)
        XCTAssertEqual(banks.lookups, 2)
    }

    @MainActor
    func testEnabledBankSkipsWarmupAndDisabledBankKeepsTheOriginalPath() async throws {
        let controller = NotchController(activateServices: false)
        defer { controller.prepareForTermination() }
        controller.qaPreserveSettings = true
        controller.qaDepthOverride = "brief"
        controller.qaCaptureModelPrep = { _ in }
        let banks = ScriptedBanks()
        banks.hasEnabledBank = false
        controller.qaQuestionBanks = banks
        var warms = 0
        controller.qaScreenshotWarmUp = { warms += 1 }
        controller.qaScreenshotSubmit = { _, _ in }
        let file = try writePNG()
        controller.qaScreenshotCapture = { .success(ScreenCapture.Shot(path: file.path, blank: false, targetFingerprint: "target")) }
        controller.qaPressScreenshot(multiple: false)
        for _ in 0..<50 where warms == 0 { try await Task.sleep(nanoseconds: 20_000_000) }
        XCTAssertEqual(warms, 1)
        XCTAssertEqual(banks.lookups, 0)
        banks.hasEnabledBank = true
        banks.next = .ready(sampleAnswer(explanation: nil))
        controller.qaScreenshotSubmit = nil
        warms = 0
        controller.qaPressScreenshot(multiple: false)
        for _ in 0..<80 where controller.model.localAnswer == nil && warms == 0 {
            try await Task.sleep(nanoseconds: 20_000_000)
        }
        XCTAssertEqual(warms, 0)
        XCTAssertNotNil(controller.model.localAnswer)
    }

    @MainActor
    func testOrderedReviewDisablesConfirm() {
        let candidate = LocalCandidate(
            instanceID: UUID(), bankTitle: "Demo", bankVersion: "1.0.0", itemID: "q", itemRevision: 1, catalogRevision: 1,
            kind: .singleChoice, stem: "以上哪项？ 12 m/s", options: [
                ChoiceOption(id: "o_a", label: "A", text: "甲"),
                ChoiceOption(id: "o_b", label: "B", text: "乙"),
            ], answer: .choice(optionIDs: ["o_a"]), explanation: "选甲", source: "示例", orderPolicy: .ordered,
            allowAutomatic: false, blockedAutomatic: false, answerSemanticKey: "x", identityKey: "y", origin: .imported, bankEnabled: true)
        let review = QuestionMatchReviewController()
        review.present(imageURL: nil, candidates: [candidate], currentOptions: [ExtractedOption(label: "A", text: "乙"), ExtractedOption(label: "B", text: "甲")], conflict: false)
        let confirm = review.window?.contentView?.deepButton(titledLike: "核对无误") ?? review.window?.contentView?.deepButton(titledLike: "Checked")
        XCTAssertEqual(confirm?.isEnabled, false)
        let cancel = review.window?.contentView?.deepButton(key: "\u{1b}")
        XCTAssertEqual(cancel?.keyEquivalent, "\u{1b}")
        XCTAssertEqual(review.window?.isVisible, true)
        let first = review.window?.firstResponder as? NSButton
        XCTAssertEqual(first?.keyEquivalent, "\u{1b}")
        review.dismiss()
    }

    @MainActor
    func testReviewConfirmAndSettingsPage() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("nspi-qb-" + UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let runtime = QuestionBankRuntime(root: root, engine: ScriptedQuestionOCR())
        let file = root.appendingPathComponent("sample.csv")
        try QuestionBankTemplate.csv.data(using: .utf8)!.write(to: file)
        var preview = await runtime.stage(file)
        if preview.draft.needsLanguage {
            preview = await runtime.applying(language: .zh, title: "Demo", to: preview)
        }
        let committed = await runtime.commit(preview, decision: .createNew)
        XCTAssertEqual(committed.status, "created")
        let page = QuestionBankPageController(banks: runtime)
        _ = page.view
        await page.reload()
        await page.qaSearch("偶数")
        XCTAssertEqual(page.qaHitCount, 1)
        XCTAssertNotNil(page.view.deepButton(titledLike: "导入") ?? page.view.deepButton(titledLike: "Import"))
        XCTAssertNotNil(page.view.deepButton(titledLike: "复制答案") ?? page.view.deepButton(titledLike: "Copy answer"))
        for subview in page.view.subviews {
            XCTAssertTrue(page.view.bounds.contains(subview.frame), "\(type(of: subview)) \(subview.frame) outside \(page.view.bounds)")
        }
    }

    func testConfirmRejectsAQuestionChangedDuringReview() async throws {
        let (root, store, importer) = try await openBank()
        defer { try? FileManager.default.removeItem(at: root) }
        let resolver = LocalQuestionResolver(store: store, gate: RecognitionGate(engine: ScriptedQuestionOCR()))
        let scope = AliasScope(imageDigests: ["shot"], targetID: "window", crop: "full")
        let created = await importer.commit(await importer.stage(try writeJSON(root, "v1.json", fill("q1", "2 + 2 = ?", "4"))), decision: .createNew)
        let id = try XCTUnwrap(created.instanceID)
        let seenRow = try await store.candidate(instanceID: id, itemID: "q1")
        let seen = try XCTUnwrap(seenRow)

        let updated = await importer.commit(await importer.stage(try writeJSON(root, "v11.json", fill("q1", "3 + 3 = ?", "6"), version: "1.1.0")), decision: .update(id))
        XCTAssertEqual(updated.status, "updated")
        try await store.setAutomatic(id, true)
        let freshRow = try await store.candidate(instanceID: id, itemID: "q1")
        let fresh = try XCTUnwrap(freshRow)
        XCTAssertEqual(fresh.itemRevision, seen.itemRevision)
        XCTAssertNotEqual(fresh.catalogRevision, seen.catalogRevision)
        XCTAssertNotEqual(fresh.identityKey, seen.identityKey)
        let confirmed = await resolver.confirm(seen, scope: scope, labelMap: [:])
        XCTAssertEqual(confirmed, .failure(.stale))
        let staleAlias = try await store.alias(scope: scope)
        XCTAssertNil(staleAlias)
        let later = await resolver.lookup(image: Data([1]), scope: scope, languages: ["zh-Hans"], now: { ProcessInfo.processInfo.systemUptime })
        if case .ready(let answer) = later { XCTFail("updated question became \(answer.currentAnswerText)") }

        let answerOnly = try await openBank()
        defer { try? FileManager.default.removeItem(at: answerOnly.0) }
        let answerCreated = await answerOnly.2.commit(await answerOnly.2.stage(try writeJSON(answerOnly.0, "a1.json", fill("q1", "2 + 2 = ?", "4"))), decision: .createNew)
        let answerID = try XCTUnwrap(answerCreated.instanceID)
        let answerSeenRow = try await answerOnly.1.candidate(instanceID: answerID, itemID: "q1")
        let answerSeen = try XCTUnwrap(answerSeenRow)
        _ = await answerOnly.2.commit(await answerOnly.2.stage(try writeJSON(answerOnly.0, "a2.json", fill("q1", "2 + 2 = ?", "6"), version: "1.1.0")), decision: .update(answerID))
        try await answerOnly.1.setAutomatic(answerID, true)
        let answerFreshRow = try await answerOnly.1.candidate(instanceID: answerID, itemID: "q1")
        let answerFresh = try XCTUnwrap(answerFreshRow)
        XCTAssertEqual(answerFresh.identityKey, answerSeen.identityKey)
        XCTAssertEqual(answerFresh.itemRevision, answerSeen.itemRevision)
        let answerConfirm = await LocalQuestionResolver(store: answerOnly.1, gate: RecognitionGate(engine: ScriptedQuestionOCR())).confirm(answerSeen, scope: scope, labelMap: [:])
        XCTAssertEqual(answerConfirm, .failure(.stale))
        let answerAlias = try await answerOnly.1.alias(scope: scope)
        XCTAssertNil(answerAlias)

        let choiceBank = try await openBank()
        defer { try? FileManager.default.removeItem(at: choiceBank.0) }
        let choiceCreated = await choiceBank.2.commit(await choiceBank.2.stage(try writeJSON(choiceBank.0, "c1.json", choice("q1", "结果是多少", [("o1", "A", "4"), ("o2", "B", "5")], ["o1"]))), decision: .createNew)
        let choiceID = try XCTUnwrap(choiceCreated.instanceID)
        let choiceSeenRow = try await choiceBank.1.candidate(instanceID: choiceID, itemID: "q1")
        let choiceSeen = try XCTUnwrap(choiceSeenRow)
        _ = await choiceBank.2.commit(await choiceBank.2.stage(try writeJSON(choiceBank.0, "c2.json", choice("q1", "结果是多少", [("o1", "A", "6"), ("o2", "B", "7")], ["o1"]), version: "1.1.0")), decision: .update(choiceID))
        let choiceConfirm = await LocalQuestionResolver(store: choiceBank.1, gate: RecognitionGate(engine: ScriptedQuestionOCR())).confirm(choiceSeen, scope: scope, labelMap: ["A": "o1", "B": "o2"])
        XCTAssertEqual(choiceConfirm, .failure(.stale))
        let choiceAlias = try await choiceBank.1.alias(scope: scope)
        XCTAssertNil(choiceAlias)

        try await store.deleteBank(id)
        let removed = await resolver.confirm(seen, scope: scope, labelMap: [:])
        XCTAssertEqual(removed, .failure(.notFound))
        let removedAlias = try await store.alias(scope: scope)
        XCTAssertNil(removedAlias)
        let effect = await LocalCaptureSession.confirmationEffect(confirmed, requalified: nil)
        XCTAssertEqual(effect, .questionChanged)
    }

    func testConfirmRacesABankUpdate() async throws {
        let (root, store, importer) = try await openBank()
        defer { try? FileManager.default.removeItem(at: root) }
        let resolver = LocalQuestionResolver(store: store, gate: RecognitionGate(engine: ScriptedQuestionOCR()))
        let scope = AliasScope(imageDigests: ["shot"], targetID: "window", crop: "full")
        let created = await importer.commit(await importer.stage(try writeJSON(root, "v1.json", fill("q1", "2 + 2 = ?", "4"))), decision: .createNew)
        let id = try XCTUnwrap(created.instanceID)
        let seenRow = try await store.candidate(instanceID: id, itemID: "q1")
        let seen = try XCTUnwrap(seenRow)
        let staged = await importer.stage(try writeJSON(root, "v11.json", fill("q1", "3 + 3 = ?", "6"), version: "1.1.0"))
        async let updated = importer.commit(staged, decision: .update(id))
        async let confirmed = resolver.confirm(seen, scope: scope, labelMap: [:])
        let updateResult = await updated
        let confirmResult = await confirmed
        XCTAssertEqual(updateResult.status, "updated")
        if case .success(let answer) = confirmResult {
            XCTAssertEqual(answer.currentAnswerText, "4")
        } else {
            XCTAssertTrue(confirmResult == .failure(.stale) || confirmResult == .failure(.notFound))
        }
        try await store.setAutomatic(id, true)
        let later = await resolver.lookup(image: Data([1]), scope: scope, languages: ["zh-Hans"], now: { ProcessInfo.processInfo.systemUptime })
        if case .ready(let answer) = later {
            XCTAssertEqual(answer.currentAnswerText, "4")
        }
        if let alias = try await store.alias(scope: scope) {
            let row = try await store.candidate(instanceID: alias.instanceID, itemID: alias.itemID)
            XCTAssertEqual(row?.stem, "2 + 2 = ?")
            XCTAssertEqual(alias.catalogRevision, row?.catalogRevision)
            XCTAssertEqual(alias.itemRevision, row?.itemRevision)
        }
    }

    func testSwappedAliasKeepsTheCurrentAnswer() async throws {
        let (root, store, importer) = try await openBank()
        defer { try? FileManager.default.removeItem(at: root) }
        let created = await importer.commit(await importer.stage(try writeJSON(root, "swap.json", choice("q", "结果是多少", [("o_a", "A", "18"), ("o_b", "B", "12")], ["o_a"]))), decision: .createNew)
        let id = try XCTUnwrap(created.instanceID)
        let resolver = LocalQuestionResolver(store: store, gate: RecognitionGate(engine: ScriptedQuestionOCR()))
        let scope = AliasScope(imageDigests: ["shot"], targetID: "window", crop: "full")
        let seenRow = try await store.candidate(instanceID: id, itemID: "q")
        let seen = try XCTUnwrap(seenRow)
        let map = ["A": "o_b", "B": "o_a"]
        let first = await resolver.confirm(seen, scope: scope, labelMap: map)
        guard case .success(let firstAnswer) = first else { return XCTFail("\(first)") }
        XCTAssertEqual(firstAnswer.currentAnswerText, "B  18")
        let second = await resolver.lookup(image: Data([1]), scope: scope, languages: ["zh-Hans"], now: { ProcessInfo.processInfo.systemUptime })
        guard case .candidates(let items, let options) = second else { return XCTFail("\(second)") }
        XCTAssertEqual(options.map { "\($0.label)=\($0.text)" }, ["A=12", "B=18"])
        XCTAssertEqual(items[0].savedLabelMap, map)
        let repeated = await resolver.confirm(items[0], scope: scope, labelMap: items[0].savedLabelMap)
        guard case .success(let repeatedAnswer) = repeated else { return XCTFail("\(repeated)") }
        XCTAssertEqual(repeatedAnswer.currentAnswerText, "B  18")
        let storedAlias = try await store.alias(scope: scope)
        let stored = try XCTUnwrap(storedAlias)
        XCTAssertEqual(stored.labelMap, map)
        try await store.setAutomatic(id, true)
        let ready = await resolver.lookup(image: Data([1]), scope: scope, languages: ["zh-Hans"], now: { ProcessInfo.processInfo.systemUptime })
        guard case .ready(let answer) = ready else { return XCTFail("\(ready)") }
        XCTAssertEqual(answer.currentAnswerText, "B  18")
        XCTAssertEqual(answer.currentLabelMap, map)
    }

    @MainActor
    func testReviewSubmitsThePopupMapping() {
        let candidate = LocalCandidate(
            instanceID: UUID(), bankTitle: "Demo", bankVersion: "1.0.0", itemID: "q", itemRevision: 1, catalogRevision: 1,
            kind: .singleChoice, stem: "结果是多少", options: [
                ChoiceOption(id: "o1", label: "A", text: "18"),
                ChoiceOption(id: "o2", label: "B", text: "12"),
            ], answer: .choice(optionIDs: ["o1"]), explanation: nil, source: nil, orderPolicy: .unordered,
            allowAutomatic: false, blockedAutomatic: false, answerSemanticKey: "a", identityKey: "k", origin: .imported, bankEnabled: true)
        let review = QuestionMatchReviewController()
        var received: [String: String] = [:]
        review.onConfirm = { _, map in received = map }
        review.present(imageURL: nil, candidates: [candidate], currentOptions: [
            ExtractedOption(label: "A", text: "18"),
            ExtractedOption(label: "B", text: "12"),
        ], conflict: false, display: false)
        let popups = review.window?.contentView?.mapPopups() ?? []
        XCTAssertEqual(popups.count, 2)
        popups[0].choose(id: "o2")
        popups[1].choose(id: "o1")
        let confirm = review.window?.contentView?.deepButton(titledLike: "核对无误") ?? review.window?.contentView?.deepButton(titledLike: "Checked")
        XCTAssertEqual(confirm?.isEnabled, true)
        XCTAssertNotNil(confirm)
        if let confirm { _ = confirm.sendAction(confirm.action, to: confirm.target) }
        XCTAssertEqual(received, ["A": "o2", "B": "o1"])
        let shown = review.window?.contentView?.collectedText() ?? ""
        XCTAssertTrue(shown.contains("B  18"))

        var replay = candidate
        replay.savedLabelMap = ["A": "o2", "B": "o1"]
        let again = QuestionMatchReviewController()
        var replayed: [String: String] = [:]
        again.onConfirm = { _, map in replayed = map }
        again.present(imageURL: nil, candidates: [replay], currentOptions: [
            ExtractedOption(label: "A", text: "12"),
            ExtractedOption(label: "B", text: "18"),
        ], conflict: false, display: false)
        let againConfirm = again.window?.contentView?.deepButton(titledLike: "核对无误") ?? again.window?.contentView?.deepButton(titledLike: "Checked")
        XCTAssertEqual(againConfirm?.isEnabled, true)
        if let againConfirm { _ = againConfirm.sendAction(againConfirm.action, to: againConfirm.target) }
        XCTAssertEqual(replayed, ["A": "o2", "B": "o1"])

        let bare = QuestionMatchReviewController()
        bare.present(imageURL: nil, candidates: [candidate], currentOptions: [], conflict: false, display: false)
        let bareConfirm = bare.window?.contentView?.deepButton(titledLike: "核对无误") ?? bare.window?.contentView?.deepButton(titledLike: "Checked")
        XCTAssertEqual(bareConfirm?.isEnabled, false)
        review.dismiss()
        again.dismiss()
        bare.dismiss()
    }

    func testManualConflictSelectionCanBeShownOnce() async throws {
        let (root, store, importer) = try await openBank()
        defer { try? FileManager.default.removeItem(at: root) }
        let first = await importer.commit(await importer.stage(try writeJSON(root, "one.json", choice("q", "1 + 1 = ?", [("o_a", "A", "2"), ("o_b", "B", "3")], ["o_a"]))), decision: .createNew)
        let second = await importer.commit(await importer.stage(try writeJSON(root, "two.json", choice("q", "1 + 1 = ?", [("o_a", "A", "2"), ("o_b", "B", "3")], ["o_b"]), bankID: "other.bank")), decision: .createNew)
        let firstID = try XCTUnwrap(first.instanceID)
        let secondID = try XCTUnwrap(second.instanceID)
        try await store.setAutomatic(firstID, true)
        try await store.setAutomatic(secondID, true)
        let resolver = LocalQuestionResolver(store: store, gate: RecognitionGate(engine: ScriptedQuestionOCR()))
        let chosenRow = try await store.candidate(instanceID: firstID, itemID: "q")
        let chosen = try XCTUnwrap(chosenRow)
        let scope = AliasScope(imageDigests: ["shot"], targetID: "window", crop: "full")
        let map = ["A": "o_a", "B": "o_b"]
        let confirmed = await resolver.confirm(chosen, scope: scope, labelMap: map)
        guard case .success(let answer) = confirmed else { return XCTFail("\(confirmed)") }
        XCTAssertEqual(answer.currentAnswerText, "A  2")
        let shown = await resolver.requalify(answer, automatic: false)
        let displayed = try XCTUnwrap(shown)
        XCTAssertEqual(displayed.currentAnswerText, "A  2")
        XCTAssertFalse(displayed.userTrusted)
        XCTAssertTrue(displayed.conflictsWithAnotherBank)
        let line = LocalAnswerText.sourceLine(displayed)
        XCTAssertTrue(line.contains("不一致") || line.contains("異なります") || line.contains("different answer"))
        let automatic = await resolver.requalify(answer, automatic: true)
        XCTAssertNil(automatic)
        let effect = await LocalCaptureSession.confirmationEffect(.success(answer), requalified: displayed)
        XCTAssertEqual(effect, .present(displayed))
        let canceled = await LocalCaptureSession.confirmationEffect(.success(answer), requalified: nil)
        XCTAssertEqual(canceled, .canceled)
        let again = await resolver.lookup(image: Data([1]), scope: scope, languages: ["zh-Hans"], now: { ProcessInfo.processInfo.systemUptime })
        guard case .conflict(let items, let options) = again else { return XCTFail("\(again)") }
        XCTAssertEqual(options.map { "\($0.label)=\($0.text)" }, ["A=2", "B=3"])
        XCTAssertEqual(items[0].savedLabelMap, map)
        XCTAssertFalse(items.isEmpty)
    }

    func testLookupBudgetCoversLanguageAliasOCRAndALockedDatabase() async throws {
        let (root, _, _) = try await openBank()
        defer { try? FileManager.default.removeItem(at: root) }
        let database = root.appendingPathComponent("questions.sqlite")
        let ocr = ScriptedQuestionOCR()
        ocr.delayNanoseconds = 1_000_000_000
        let runtime = await QuestionBankRuntime(root: root, engine: ocr)
        await runtime.prepare()
        let scope = AliasScope(imageDigests: ["shot"], targetID: "window", crop: "full")

        var other: OpaquePointer?
        XCTAssertEqual(sqlite3_open(database.path, &other), SQLITE_OK)
        XCTAssertEqual(sqlite3_exec(other, "BEGIN EXCLUSIVE", nil, nil, nil), SQLITE_OK)
        let lockedAt = Date()
        let locked = await runtime.lookup(image: Data([1]), scope: scope, trace: { _ in })
        XCTAssertLessThan(Date().timeIntervalSince(lockedAt), 0.7)
        XCTAssertEqual(locked, .unavailable("timeout"))
        sqlite3_exec(other, "ROLLBACK", nil, nil, nil)
        sqlite3_close(other)

        let holdRoot = FileManager.default.temporaryDirectory.appendingPathComponent("nspi-qb-" + UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: holdRoot, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: holdRoot) }
        let heldRuntime = await QuestionBankRuntime(root: holdRoot, engine: ScriptedQuestionOCR())
        await heldRuntime.prepare()
        let entered = Entered()
        let hold = Task { await heldRuntime.qaHold(0.8, entered: { entered.signal() }) }
        entered.wait()
        let queuedAt = Date()
        let queued = await heldRuntime.lookup(image: Data([1]), scope: scope, trace: { _ in })
        XCTAssertLessThan(Date().timeIntervalSince(queuedAt), 0.7)
        XCTAssertEqual(queued, .unavailable("timeout"))
        await hold.value
        let afterHold = await heldRuntime.lookup(image: Data([1]), scope: scope, trace: { _ in })
        XCTAssertEqual(afterHold, .miss)

        let slowAt = Date()
        let slow = await runtime.lookup(image: Data([1]), scope: scope, trace: { _ in })
        XCTAssertLessThan(Date().timeIntervalSince(slowAt), 0.7)
        XCTAssertEqual(slow, .unavailable("timeout"))
        let busy = await runtime.lookup(image: Data([1]), scope: scope, trace: { _ in })
        XCTAssertEqual(busy, .unavailable("busy"))
        XCTAssertEqual(ocr.calls, 1)
        try await Task.sleep(nanoseconds: 1_200_000_000)
        ocr.delayNanoseconds = 0
        ocr.result = QuestionRecognition(lines: [])
        let after = await runtime.lookup(image: Data([1]), scope: scope, trace: { _ in })
        XCTAssertEqual(after, .miss)
        XCTAssertEqual(ocr.calls, 2)
    }

    func testCSVLimitAndBlankLanguageImport() async throws {
        var rows = [QuestionBankCSV.header.joined(separator: ",")]
        for index in 1...10_001 {
            rows.append("q\(index),short_fill,,面积\(index),,,,,,,\(index),cm²,,")
        }
        let tooMany = decode(Data(rows.joined(separator: "\n").utf8), format: .csv, name: "many.csv")
        XCTAssertEqual(tooMany.rootError, "too_many_questions")
        XCTAssertTrue(tooMany.questions.isEmpty)
        rows.removeLast()
        let accepted = decode(Data(rows.joined(separator: "\n").utf8), format: .csv, name: "many.csv")
        XCTAssertNil(accepted.rootError)
        XCTAssertEqual(accepted.questions.count, 10_000)
        XCTAssertTrue(accepted.needsLanguage)

        let (root, store, importer) = try await openBank()
        defer { try? FileManager.default.removeItem(at: root) }
        let overflow = root.appendingPathComponent("overflow.csv")
        var overflowRows = [QuestionBankCSV.header.joined(separator: ",")]
        overflowRows.append(contentsOf: (1...10_001).map { "q\($0),short_fill,,面积\($0),,,,,,,\($0),,," })
        try Data(overflowRows.joined(separator: "\n").utf8).write(to: overflow)
        let overflowCommit = await importer.commit(await importer.stage(overflow), decision: .createNew)
        XCTAssertEqual(overflowCommit.status, "rejected")
        let afterOverflow = try await store.summaries()
        XCTAssertEqual(afterOverflow.count, 0)
        let ten = root.appendingPathComponent("ten.csv")
        try Data(rows.joined(separator: "\n").utf8).write(to: ten)
        let tenStaged = await importer.applying(language: .zh, title: "Ten", to: await importer.stage(ten))
        let tenCreated = await importer.commit(tenStaged, decision: .createNew)
        XCTAssertEqual(tenCreated.status, "created")
        let tenBanks = try await store.summaries()
        XCTAssertEqual(tenBanks.first?.questionCount, 10_000)

        let blank = root.appendingPathComponent("blank.csv")
        let blankCSV = """
        id,type,language,stem,option_a,option_b,option_c,option_d,option_e,option_f,answer,unit,explanation,source
        q1,short_fill,,面积是多少？,,,,,,,15,cm²,,
        q2,single_choice,,请选择,甲,乙,,,,,A,,,
        q3,short_fill,,另一面积,,,,,,,8,,,
        """
        try Data(blankCSV.utf8).write(to: blank)
        let staged = await importer.stage(blank)
        XCTAssertTrue(staged.draft.needsLanguage)
        XCTAssertNil(staged.draft.manifest)
        XCTAssertEqual(staged.draft.questions.count, 3)
        let rejected = await importer.commit(staged, decision: .createNew)
        XCTAssertEqual(rejected.status, "rejected")
        let applied = await importer.applying(language: .zh, title: staged.title, to: staged)
        let created = await importer.commit(applied, decision: .createNew)
        XCTAssertEqual(created.status, "created")
        let banks = try await store.summaries()
        let bank = try XCTUnwrap(banks.first { $0.questionCount == 3 })
        XCTAssertEqual(bank.language, .zh)
        XCTAssertEqual(bank.questionCount, 3)
        let detail = try await store.detail(instanceID: bank.instanceID, itemID: "q1")
        XCTAssertEqual(detail?.language, .zh)
    }

    @MainActor
    func testImportSheetAppliesTheSelectedLanguageImmediately() {
        let csv = """
        id,type,language,stem,option_a,option_b,option_c,option_d,option_e,option_f,answer,unit,explanation,source
        q1,short_fill,,面积是多少？,,,,,,,15,cm²,,
        q2,single_choice,,请选择,甲,乙,,,,,A,,,
        q3,short_fill,,另一面积,,,,,,,8,,,
        """
        let draft = decode(Data(csv.utf8), format: .csv, name: "blank.csv")
        XCTAssertTrue(draft.needsLanguage)
        XCTAssertNil(draft.manifest)
        let preview = importPreview(draft)
        let sheet = QuestionBankImportSheet(preview: preview, refresh: Self.refreshPreview)
        let zh = expectation(description: "zh")
        var zhChoice: ImportChoice?
        Task { @MainActor in
            zhChoice = await sheet.qaCommit()
            zh.fulfill()
        }
        wait(for: [zh], timeout: 3)
        XCTAssertEqual(zhChoice?.preview.language, .zh)
        XCTAssertEqual(zhChoice?.preview.draft.manifest?.language, .zh)
        XCTAssertEqual(zhChoice?.preview.draft.questions.map(\.language), [.zh, .zh, .zh])
        XCTAssertFalse(zhChoice?.preview.draft.needsLanguage ?? true)

        let switched = QuestionBankImportSheet(preview: preview, refresh: Self.refreshPreview)
        switched.qaSelectLanguage(.ja)
        let ja = expectation(description: "ja")
        var jaChoice: ImportChoice?
        Task { @MainActor in
            jaChoice = await switched.qaCommit()
            ja.fulfill()
        }
        wait(for: [ja], timeout: 3)
        XCTAssertEqual(jaChoice?.preview.language, .ja)
        XCTAssertEqual(jaChoice?.preview.draft.questions.map(\.language), [.ja, .ja, .ja])
        XCTAssertEqual(jaChoice?.preview.draft.manifest?.version.text, "1.0.0")

        let raw = Data(#"{"schema_version":1,"bank_id":"demo.bank","title":"Demo","author":"Ann","version":"1.2.3","language":"zh","description":"Desc","source":"Src","license":"MIT","questions":[{"id":"q","type":"short_fill","stem":"面积","answer":{"text":"15","unit":"cm²"}}]}"#.utf8)
        let jsonDraft = decode(raw)
        let applied = QuestionBankPackage.apply(language: .ja, title: "Renamed", externalID: "demo.bank", to: jsonDraft)
        XCTAssertEqual(applied.manifest?.author, "Ann")
        XCTAssertEqual(applied.manifest?.version.text, "1.2.3")
        XCTAssertEqual(applied.manifest?.description, "Desc")
        XCTAssertEqual(applied.manifest?.source, "Src")
        XCTAssertEqual(applied.manifest?.license, "MIT")
        XCTAssertEqual(applied.manifest?.externalBankID, "demo.bank")
        XCTAssertEqual(applied.manifest?.title, "Renamed")
        XCTAssertEqual(applied.manifest?.language, .ja)
        XCTAssertEqual(applied.questions.first?.language, .zh)
    }

    @MainActor
    func testImportResultSurvivesTheFollowingReload() async throws {
        let (root, _, _) = try await openBank()
        defer { try? FileManager.default.removeItem(at: root) }
        let runtime = QuestionBankRuntime(root: root, engine: ScriptedQuestionOCR())
        let page = QuestionBankPageController(banks: runtime)
        _ = page.view
        let result = ImportCommitResult(status: "created", instanceID: nil, accepted: 2, failed: 1, report: "status ok\naccepted 2\nrow 3 bad")
        await page.qaFinishImport(result)
        let status = page.qaStatus
        let detail = page.qaDetailText
        XCTAssertTrue(status.contains("created"))
        XCTAssertTrue(status.contains("row 3 bad"))
        XCTAssertFalse(status.hasPrefix("0 /") || status.hasPrefix("1 /") || status.hasPrefix("2 /"))
        XCTAssertEqual(detail, result.report)
    }

    func testDamagedDatabaseFileIsKept() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("nspi-qb-" + UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let database = root.appendingPathComponent("questions.sqlite")
        try Data("not a database".utf8).write(to: database)
        let store = SQLiteQuestionBankStore(databaseURL: database)
        await store.open()
        let reason = await store.failureReason()
        XCTAssertNotNil(reason)
        XCTAssertTrue(FileManager.default.fileExists(atPath: database.path))
        let runtime = await QuestionBankRuntime(root: root, engine: ScriptedQuestionOCR())
        let outcome = await runtime.lookup(image: Data([1]), scope: AliasScope(imageDigests: ["shot"], targetID: "window", crop: "full"), trace: { _ in })
        guard case .unavailable = outcome else { return XCTFail("\(outcome)") }
        XCTAssertTrue(FileManager.default.fileExists(atPath: database.path))
    }

    func testConflictAliasCanSwitchSourcesAndIgnoreDisabledBank() async throws {
        let (root, store, importer) = try await openBank()
        defer { try? FileManager.default.removeItem(at: root) }
        let first = await importer.commit(await importer.stage(try writeJSON(root, "a.json", choice("q", "结果是多少", [("a1", "A", "2"), ("a2", "B", "3")], ["a1"]))), decision: .createNew)
        let second = await importer.commit(await importer.stage(try writeJSON(root, "b.json", choice("q", "结果是多少", [("b1", "A", "2"), ("b2", "B", "3")], ["b2"]), bankID: "other")), decision: .createNew)
        let a = try XCTUnwrap(first.instanceID), b = try XCTUnwrap(second.instanceID)
        let resolver = LocalQuestionResolver(store: store, gate: RecognitionGate(engine: ScriptedQuestionOCR()))
        let scope = AliasScope(imageDigests: ["same"], targetID: "target", crop: "full")
        let initial = try await store.candidate(instanceID: a, itemID: "q")!
        _ = await resolver.confirm(initial, scope: scope, labelMap: ["A": "a2", "B": "a1"])
        let result = await resolver.lookup(image: Data(), scope: scope, languages: [], now: { ProcessInfo.processInfo.systemUptime })
        guard case .conflict(let choices, _) = result else { return XCTFail("\(result)") }
        XCTAssertEqual(Set(choices.map(\.instanceID)), [a, b])
        let other = try XCTUnwrap(choices.first { $0.instanceID == b })
        XCTAssertEqual(other.savedLabelMap, ["A": "b2", "B": "b1"])
        let switched = await resolver.confirm(other, scope: scope, labelMap: other.savedLabelMap)
        guard case .success(let answer) = switched else { return XCTFail("\(switched)") }
        XCTAssertEqual(answer.currentAnswerText, "A  3")
        let shown = await resolver.requalify(answer, automatic: false)
        XCTAssertEqual(shown?.conflictsWithAnotherBank, true)
        let automatic = await resolver.requalify(answer, automatic: true)
        XCTAssertNil(automatic)
        try await store.setEnabled(b, false)
        let disabled = await resolver.lookup(image: Data(), scope: scope, languages: [], now: { ProcessInfo.processInfo.systemUptime })
        guard case .candidates(let active, _) = disabled else { return XCTFail("\(disabled)") }
        XCTAssertEqual(active.map(\.instanceID), [a])
        XCTAssertTrue(active.allSatisfy(\.bankEnabled))
        let back = await resolver.confirm(active[0], scope: scope, labelMap: active[0].savedLabelMap)
        guard case .success = back else { return XCTFail("\(back)") }
        try await store.setEnabled(b, true)
        let restored = await resolver.lookup(image: Data(), scope: scope, languages: [], now: { ProcessInfo.processInfo.systemUptime })
        guard case .conflict(let both, _) = restored else { return XCTFail("\(restored)") }
        XCTAssertEqual(both.count, 2)
    }

    @MainActor
    func testLanguageDefaultsRemainEditableAcrossCompletedPreviews() async throws {
        let (root, _, importer) = try await openBank()
        defer { try? FileManager.default.removeItem(at: root) }
        let csv = QuestionBankCSV.header.joined(separator: ",") + "\nq1,short_fill,,面積,,,,,,,1,,,\nq2,short_fill,en,Area,,,,,,,2,,,"
        var preview = await importer.stage(data: Data(csv.utf8), filename: "languages.csv", format: .csv)
        for language in [BankLanguage.zh, .ja, .en, .ja, .zh] {
            preview = await importer.applying(language: language, title: "Mixed", to: preview)
            XCTAssertEqual(preview.draft.questions[0].language, language)
            XCTAssertFalse(preview.draft.questions[0].languageExplicit)
            XCTAssertEqual(preview.draft.questions[1].language, .en)
            XCTAssertTrue(preview.draft.questions[1].languageExplicit)
        }
        let sheet = QuestionBankImportSheet(preview: preview) { lang, title, current in
            await importer.applying(language: lang, title: title, to: current)
        }
        sheet.qaSelectLanguage(.ja)
        try await Task.sleep(nanoseconds: 50_000_000)
        sheet.qaSelectLanguage(.en)
        let submitted = await sheet.qaCommit()
        XCTAssertEqual(submitted?.preview.draft.questions.map(\.language), [.en, .en])
    }

    @MainActor
    func testRuntimeFinalCheckTimesOutOnStorageQueueAndLock() async throws {
        let (root, store, importer) = try await openBank()
        defer { try? FileManager.default.removeItem(at: root) }
        let created = await importer.commit(await importer.stage(try writeJSON(root, "ready.json", fill("q", "2+2", "4"))), decision: .createNew)
        let id = try XCTUnwrap(created.instanceID)
        try await store.setAutomatic(id, true)
        let runtime = QuestionBankRuntime(root: root, engine: ScriptedQuestionOCR())
        await runtime.prepare()
        let candidate = try await store.candidate(instanceID: id, itemID: "q")!
        let scope = AliasScope(imageDigests: ["ready"], targetID: "window", crop: "full")
        _ = await runtime.confirm(candidate: candidate, scope: scope, labelMap: [:])
        let initial = await runtime.lookup(image: Data(), scope: scope, trace: { _ in })
        guard case .ready(let answer) = initial else { return XCTFail("\(initial)") }
        let holder = Task { await runtime.qaHold(0.8) }
        try await Task.sleep(nanoseconds: 30_000_000)
        let start = ProcessInfo.processInfo.systemUptime
        let queued = await runtime.requalify(answer, automatic: true)
        XCTAssertNil(queued)
        XCTAssertLessThan(ProcessInfo.processInfo.systemUptime - start, 0.55)
        await holder.value
        let renewed = await runtime.lookup(image: Data(), scope: scope, trace: { _ in })
        guard case .ready(let fresh) = renewed else { return XCTFail("\(renewed)") }
        var connection: OpaquePointer?
        XCTAssertEqual(sqlite3_open(root.appendingPathComponent("questions.sqlite").path, &connection), SQLITE_OK)
        defer { sqlite3_exec(connection, "ROLLBACK", nil, nil, nil); sqlite3_close(connection) }
        XCTAssertEqual(sqlite3_exec(connection, "BEGIN EXCLUSIVE", nil, nil, nil), SQLITE_OK)
        let lockedAt = ProcessInfo.processInfo.systemUptime
        let locked = await runtime.requalify(fresh, automatic: true)
        XCTAssertNil(locked)
        XCTAssertLessThan(ProcessInfo.processInfo.systemUptime - lockedAt, 0.55)
    }

    @MainActor
    func testSessionDeadlineIncludesFinalCheckAndIgnoresLateAnswer() async throws {
        let session = LocalCaptureSession()
        let banks = ScriptedBanks()
        banks.next = .ready(sampleAnswer(explanation: nil))
        banks.lookupDelay = 100_000_000
        banks.requalifyDelay = 700_000_000
        session.banks = { banks }
        session.depth = { "brief" }
        let asset = try makeAsset()
        var models = 0, warms = 0, presentations = 0
        session.onModel = { _, assets, _ in models += 1; XCTAssertEqual(assets, [asset]) }
        session.onWarm = { warms += 1 }
        session.onPresent = { _, _, _ in presentations += 1 }
        let start = ProcessInfo.processInfo.systemUptime
        let latency = CaptureLatency(entry: .single)
        session.start(mode: "tutor", assets: [asset], latency: latency)
        while session.isActive && ProcessInfo.processInfo.systemUptime - start < 1 {
            try await Task.sleep(nanoseconds: 10_000_000)
        }
        XCTAssertLessThan(ProcessInfo.processInfo.systemUptime - start, 0.55)
        XCTAssertEqual(models, 1)
        XCTAssertEqual(warms, 1)
        XCTAssertEqual(presentations, 0)
        XCTAssertGreaterThan(latency.offsets[.bankLookupCompleted] ?? 0, 300)
        try await Task.sleep(nanoseconds: 600_000_000)
        XCTAssertEqual(models, 1)
        XCTAssertEqual(presentations, 0)
    }

    private func sampleAnswer(explanation: String?) -> LocalAnswer {
        LocalAnswer(
            bankInstanceID: UUID(), bankTitle: "Demo", bankVersion: "1.0.0", itemID: "q", itemRevision: 1, catalogRevision: 1,
            questionKind: .singleChoice, currentAnswerText: "B  18", copyText: "B  18", selectedOptionIDs: ["o_b"],
            currentLabelMap: ["B": "o_b"], explanation: explanation, explanationApplicable: true, sourceKind: .imported,
            userTrusted: true, matchMethod: "alias", identityKey: "k", answerSemanticKey: "a")
    }

    private func writePNG() throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".png")
        let png = Data(base64Encoded: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGaQAAAAASUVORK5CYII=")!
        try png.write(to: url)
        return url
    }

    private func makeAsset() throws -> ContextAsset {
        ContextAsset(id: UUID(), sessionID: UUID(), file: QuestionAssetFile(url: try writePNG()), sha256: "abc", width: 1, height: 1, byteCount: 68, targetFingerprint: "target", capturedAt: Date())
    }

    private func openBank() async throws -> (URL, SQLiteQuestionBankStore, QuestionBankImporter) {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("nspi-qb-" + UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let store = SQLiteQuestionBankStore(databaseURL: root.appendingPathComponent("questions.sqlite"))
        await store.open()
        return (root, store, QuestionBankImporter(store: store))
    }

    private func fill(_ id: String, _ stem: String, _ text: String) -> String {
        #"{"id":"\#(id)","type":"short_fill","stem":"\#(stem)","answer":{"text":"\#(text)"}}"#
    }

    private func writeJSON(_ root: URL, _ name: String, _ question: String, version: String = "1.0.0", bankID: String = "demo.bank") throws -> URL {
        let url = root.appendingPathComponent(name)
        try json(question, bankID: bankID, version: version).write(to: url)
        return url
    }

    private func importPreview(_ draft: PackageDraft) -> ImportPreview {
        ImportPreview(fileDigest: "abc", contentDigest: "", draft: draft, title: draft.suggestedTitle, language: nil, allowAutomatic: false, identicalInstanceID: nil, sameExternalInstances: [], sameVersionChanged: [], higherVersionTargets: [], duplicateGroups: 0, conflictGroups: 0, replacementPreview: [])
    }

    private static func refreshPreview(language: BankLanguage, title: String, current: ImportPreview) async -> ImportPreview {
        let external = current.draft.manifest?.externalBankID ?? "local-blank"
        let applied = QuestionBankPackage.apply(language: language, title: title, externalID: external, to: current.draft)
        var next = current
        next.draft = applied
        next.title = applied.manifest?.title ?? title
        next.language = applied.manifest?.language
        return next
    }
}

@MainActor
private final class ScriptedBanks: QuestionBankServing {
    var hasEnabledBank = false
    var storageError: String?
    var next: LocalLookupOutcome = .miss
    var lookups = 0
    var lookupDelay: UInt64 = 0
    var requalifyDelay: UInt64 = 0
    func prepare() async {}
    func lookup(image: Data, scope: AliasScope, trace: @escaping @Sendable (String) -> Void) async -> LocalLookupOutcome {
        lookups += 1
        if lookupDelay > 0 { try? await Task.sleep(nanoseconds: lookupDelay) }
        return next
    }
    func confirm(candidate: LocalCandidate, scope: AliasScope, labelMap: [String: String]) async -> Result<LocalAnswer, QuestionBankError> {
        .failure(.notFound)
    }
    func requalify(_ answer: LocalAnswer, automatic: Bool) async -> LocalAnswer? {
        if requalifyDelay > 0 { try? await Task.sleep(nanoseconds: requalifyDelay) }
        return answer
    }
    func stage(_ url: URL) async -> ImportPreview { fatalError() }
    func applying(language: BankLanguage, title: String, to preview: ImportPreview) async -> ImportPreview { preview }
    func commit(_ preview: ImportPreview, decision: ImportDecision) async -> ImportCommitResult {
        ImportCommitResult(status: "empty", instanceID: nil, accepted: 0, failed: 0, report: "")
    }
    func banks() async -> [QuestionBankSummary] { [] }
    func search(query: String, offset: Int, instanceID: UUID?) async -> QuestionSearchPage { QuestionSearchPage(hits: [], offset: 0, total: 0) }
    func detail(instanceID: UUID, itemID: String) async -> QuestionDetail? { nil }
    func setEnabled(_ id: UUID, _ enabled: Bool) async {}
    func setAutomatic(_ id: UUID, _ allowed: Bool) async {}
    func remove(_ id: UUID) async {}
    func block(instanceID: UUID, itemID: String, blocked: Bool) async {}
}

private extension NSView {
    func deepButton(titledLike fragment: String) -> NSButton? {
        if let button = self as? NSButton, button.title.contains(fragment) { return button }
        for child in subviews {
            if let found = child.deepButton(titledLike: fragment) { return found }
        }
        return nil
    }

    func deepButton(key: String) -> NSButton? {
        if let button = self as? NSButton, button.keyEquivalent == key { return button }
        for child in subviews {
            if let found = child.deepButton(key: key) { return found }
        }
        return nil
    }

    func mapPopups() -> [NSPopUpButton] {
        var found: [NSPopUpButton] = []
        if let popup = self as? NSPopUpButton, popup.itemArray.contains(where: { $0.representedObject is String }) {
            found.append(popup)
        }
        for child in subviews { found.append(contentsOf: child.mapPopups()) }
        return found
    }

    func collectedText() -> String {
        var text = ""
        if let field = self as? NSTextField { text += field.stringValue + "\n" }
        for child in subviews { text += child.collectedText() }
        return text
    }
}

private extension NSPopUpButton {
    func choose(id: String) {
        for item in itemArray where (item.representedObject as? String) == id {
            select(item)
        }
        _ = sendAction(action, to: target)
    }
}

private final class Entered: @unchecked Sendable {
    private let semaphore = DispatchSemaphore(value: 0)
    func signal() { semaphore.signal() }
    func wait() { semaphore.wait() }
}
