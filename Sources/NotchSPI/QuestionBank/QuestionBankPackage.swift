import Foundation

enum QuestionBankPackage {
    private static let choiceLetters = ["a", "b", "c", "d", "e", "f"]
    private static let rootKeys: Set<String> = ["schema_version", "bank_id", "title", "author", "version", "language", "description", "source", "license", "questions"]
    private static let questionKeys: Set<String> = ["id", "type", "language", "stem", "options", "answer", "explanation", "source"]
    private static let optionKeys: Set<String> = ["id", "label", "text"]

    static func decode(data: Data, filename: String, format: Format) -> PackageDraft {
        switch format {
        case .json: return decodeJSON(data, filename: filename)
        case .csv: return decodeCSV(data, filename: filename)
        }
    }

    enum Format { case json, csv }

    static func format(for url: URL) -> Format? {
        let name = url.lastPathComponent.lowercased()
        if name.hasSuffix(".csv") { return .csv }
        if name.hasSuffix(".json") || name.hasSuffix(".nspibank.json") { return .json }
        return nil
    }

    private static func decodeJSON(_ data: Data, filename: String) -> PackageDraft {
        let empty = PackageDraft(manifest: nil, questions: [], failures: [], rootError: nil, warnings: [], needsLanguage: false, suggestedTitle: title(from: filename))
        let value: StrictJSON.Value
        do { value = try StrictJSON.parse(data) }
        catch StrictJSON.ParseError.duplicateKey(let key) {
            var draft = empty
            draft.rootError = "duplicate_key:\(key)"
            return draft
        } catch {
            var draft = empty
            draft.rootError = "malformed_json"
            return draft
        }
        guard let pairs = value.object else {
            var draft = empty
            draft.rootError = "root_not_object"
            return draft
        }
        let keys = Set(pairs.map(\.0))
        if let unknown = keys.subtracting(rootKeys).sorted().first {
            var draft = empty
            draft.rootError = "unknown_field:\(unknown)"
            return draft
        }
        guard case .int(let schema) = value.field("schema_version") else {
            var draft = empty
            draft.rootError = "schema_version"
            return draft
        }
        guard schema == QuestionBankLimits.schemaVersion else {
            var draft = empty
            draft.rootError = "unsupported_schema:\(schema)"
            return draft
        }
        guard let bankID = value.field("bank_id")?.string, QuestionBankText.validIdentifier(bankID) else {
            var draft = empty
            draft.rootError = "bank_id"
            return draft
        }
        guard let title = value.field("title")?.string, let limitedTitle = QuestionBankText.limited(title, max: QuestionBankLimits.maxTitle, allowEmpty: false) else {
            var draft = empty
            draft.rootError = "title"
            return draft
        }
        guard let versionText = value.field("version")?.string, let version = BankVersion.parse(versionText) else {
            var draft = empty
            draft.rootError = "version"
            return draft
        }
        guard let languageText = value.field("language")?.string, let language = BankLanguage(rawValue: languageText) else {
            var draft = empty
            draft.rootError = "language"
            return draft
        }
        let author = optionalText(value.field("author"), max: QuestionBankLimits.maxTitle)
        let description = optionalText(value.field("description"), max: QuestionBankLimits.maxProse)
        let source = optionalText(value.field("source"), max: QuestionBankLimits.maxProse)
        let license = optionalText(value.field("license"), max: QuestionBankLimits.maxProse)
        if value.field("author") != nil && author == nil { var draft = empty; draft.rootError = "author"; return draft }
        if value.field("description") != nil && description == nil { var draft = empty; draft.rootError = "description"; return draft }
        if value.field("source") != nil && source == nil { var draft = empty; draft.rootError = "source"; return draft }
        if value.field("license") != nil && license == nil { var draft = empty; draft.rootError = "license"; return draft }
        guard let questions = value.field("questions")?.array, !questions.isEmpty else {
            var draft = empty
            draft.rootError = "questions"
            return draft
        }
        guard questions.count <= QuestionBankLimits.maxQuestions else {
            var draft = empty
            draft.rootError = "too_many_questions"
            return draft
        }
        var failures: [QuestionFailure] = []
        var decoded: [(Int, BankQuestion)] = []
        for (index, item) in questions.enumerated() {
            switch decodeQuestion(item, index: index, fallbackLanguage: language, allowMissingID: false) {
            case .success(let question):
                decoded.append((index, question))
            case .failure(let failure):
                failures.append(failure)
            }
        }
        let idCounts = Dictionary(decoded.map { ($0.1.id, 1) }, uniquingKeysWith: +)
        var built: [BankQuestion] = []
        for (index, question) in decoded {
            if idCounts[question.id, default: 0] > 1 {
                failures.append(QuestionFailure(index: index, itemID: question.id, message: "duplicate_id"))
            } else {
                built.append(question)
            }
        }
        let manifest = BankManifest(externalBankID: bankID, title: limitedTitle, author: author, version: version, language: language, description: description, source: source, license: license, origin: .imported)
        return PackageDraft(manifest: manifest, questions: built, failures: failures, rootError: nil, warnings: warnings(for: built), needsLanguage: false, suggestedTitle: limitedTitle)
    }

    private static func decodeCSV(_ data: Data, filename: String) -> PackageDraft {
        let suggested = title(from: filename)
        let table = QuestionBankCSV.parse(data)
        if let error = table.errors.first {
            return PackageDraft(manifest: nil, questions: [], failures: [error], rootError: error.message, warnings: [], needsLanguage: false, suggestedTitle: suggested)
        }
        guard let header = table.rows.first else {
            return PackageDraft(manifest: nil, questions: [], failures: [], rootError: "empty_csv", warnings: [], needsLanguage: true, suggestedTitle: suggested)
        }
        guard header == QuestionBankCSV.header else {
            return PackageDraft(manifest: nil, questions: [], failures: [], rootError: "csv_header", warnings: [], needsLanguage: false, suggestedTitle: suggested)
        }
        if table.rows.count - 1 > QuestionBankLimits.maxQuestions {
            return PackageDraft(manifest: nil, questions: [], failures: [], rootError: "too_many_questions", warnings: [], needsLanguage: false, suggestedTitle: suggested)
        }
        var failures: [QuestionFailure] = []
        var pending: [(Int, StrictJSON.Value)] = []
        var explicitIDs = Set<String>()
        var duplicateExplicit = Set<String>()
        var generated: [String: Int] = [:]
        for (offset, row) in table.rows.dropFirst().enumerated() {
            let index = offset + 1
            if row.count != QuestionBankCSV.header.count {
                failures.append(QuestionFailure(index: index, itemID: nil, message: "column_count"))
                continue
            }
            let columns = Dictionary(uniqueKeysWithValues: zip(QuestionBankCSV.header, row))
            let explicit = columns["id"]?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            let id: String
            if explicit.isEmpty {
                id = generatedID(columns)
                if generated[id] != nil {
                    failures.append(QuestionFailure(index: index, itemID: id, message: "duplicate_blank_id_row"))
                    continue
                }
                generated[id] = index
            } else {
                id = explicit
                if !explicitIDs.insert(id).inserted { duplicateExplicit.insert(id) }
            }
            pending.append((index, csvObject(columns, id: id)))
        }
        var built: [BankQuestion] = []
        var needsLanguage = false
        for (index, object) in pending {
            if let id = object.field("id")?.string, duplicateExplicit.contains(id) {
                failures.append(QuestionFailure(index: index, itemID: id, message: "duplicate_id"))
                continue
            }
            let fallback = object.field("language")?.string.flatMap(BankLanguage.init(rawValue:))
            if object.field("language") == nil { needsLanguage = true }
            switch decodeQuestion(object, index: index, fallbackLanguage: fallback ?? .zh, allowMissingID: false, languageExplicit: fallback != nil) {
            case .success(let question):
                built.append(question)
            case .failure(let failure):
                failures.append(failure)
            }
        }
        return PackageDraft(manifest: nil, questions: built, failures: failures, rootError: nil, warnings: warnings(for: built), needsLanguage: needsLanguage, suggestedTitle: suggested)
    }

    static func apply(language: BankLanguage, title: String, externalID: String, to draft: PackageDraft) -> PackageDraft {
        var copy = draft
        copy.needsLanguage = false
        copy.suggestedTitle = title
        copy.questions = draft.questions.map { question in
            guard !question.languageExplicit else { return question }
            var item = question
            item.language = language
            // Preserve whether the file supplied a language; preview defaults remain editable.
            return stamp(item)
        }
        if var manifest = draft.manifest {
            manifest.title = title
            manifest.language = language
            copy.manifest = manifest
        } else {
            copy.manifest = BankManifest(externalBankID: externalID, title: title, author: nil, version: BankVersion(major: 1, minor: 0, patch: 0), language: language, description: nil, source: nil, license: nil, origin: .imported)
        }
        copy.warnings = warnings(for: copy.questions)
        return copy
    }

    private static func csvObject(_ columns: [String: String], id: String) -> StrictJSON.Value {
        let type = columns["type"] ?? ""
        var pairs: [(String, StrictJSON.Value)] = [
            ("id", .string(id)),
            ("type", .string(type)),
            ("stem", .string(columns["stem"] ?? ""))
        ]
        if let language = columns["language"], !language.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            pairs.append(("language", .string(language.trimmingCharacters(in: .whitespacesAndNewlines))))
        }
        if type == QuestionKind.shortFill.rawValue {
            var answer: [(String, StrictJSON.Value)] = [("text", .string(columns["answer"] ?? ""))]
            let unit = columns["unit"] ?? ""
            if !unit.isEmpty { answer.append(("unit", .string(unit))) }
            pairs.append(("answer", .object(answer)))
        } else {
            var options: [StrictJSON.Value] = []
            var startedEmpty = false
            for letter in choiceLetters {
                let text = columns["option_\(letter)"] ?? ""
                if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    startedEmpty = true
                    continue
                }
                if startedEmpty {
                    options.append(.string("gap"))
                    break
                }
                options.append(.object([
                    ("id", .string("o_\(letter)")),
                    ("label", .string(letter.uppercased())),
                    ("text", .string(text))
                ]))
            }
            pairs.append(("options", .array(options)))
            let tokens = (columns["answer"] ?? "").split(separator: ";").map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
            let ids = tokens.map { "o_\($0.lowercased())" }
            pairs.append(("answer", .object([("option_ids", .array(ids.map(StrictJSON.Value.string)))])))
        }
        if let explanation = columns["explanation"], !explanation.isEmpty {
            pairs.append(("explanation", .string(explanation)))
        }
        if let source = columns["source"], !source.isEmpty {
            pairs.append(("source", .string(source)))
        }
        return .object(pairs)
    }

    private enum Decode {
        case success(BankQuestion)
        case failure(QuestionFailure)
    }

    private static func decodeQuestion(_ value: StrictJSON.Value, index: Int, fallbackLanguage: BankLanguage, allowMissingID: Bool, languageExplicit: Bool = true) -> Decode {
        guard let pairs = value.object else {
            return .failure(QuestionFailure(index: index, itemID: nil, message: "question_not_object"))
        }
        if pairs.contains(where: { $0.1 == .string("gap") }) || (pairs.first { $0.0 == "options" }?.1.array?.contains(.string("gap")) == true) {
            return .failure(QuestionFailure(index: index, itemID: pairs.first { $0.0 == "id" }?.1.string, message: "options_not_contiguous"))
        }
        let keys = Set(pairs.map(\.0))
        if let unknown = keys.subtracting(questionKeys).sorted().first {
            return .failure(QuestionFailure(index: index, itemID: nil, message: "unknown_field:\(unknown)"))
        }
        guard let id = value.field("id")?.string, QuestionBankText.validIdentifier(id) else {
            return .failure(QuestionFailure(index: index, itemID: nil, message: "id"))
        }
        guard let kindText = value.field("type")?.string, let kind = QuestionKind(rawValue: kindText) else {
            return .failure(QuestionFailure(index: index, itemID: id, message: "type"))
        }
        let language: BankLanguage
        if let raw = value.field("language")?.string {
            guard let parsed = BankLanguage(rawValue: raw) else {
                return .failure(QuestionFailure(index: index, itemID: id, message: "language"))
            }
            language = parsed
        } else if !languageExplicit {
            language = fallbackLanguage
        } else if value.field("language") == nil {
            language = fallbackLanguage
        } else {
            return .failure(QuestionFailure(index: index, itemID: id, message: "language"))
        }
        guard let stem = value.field("stem")?.string, let limitedStem = QuestionBankText.limited(stem, max: QuestionBankLimits.maxStem, allowEmpty: false) else {
            return .failure(QuestionFailure(index: index, itemID: id, message: "stem"))
        }
        let explanation = optionalText(value.field("explanation"), max: QuestionBankLimits.maxExplanation)
        if value.field("explanation") != nil && explanation == nil {
            return .failure(QuestionFailure(index: index, itemID: id, message: "explanation"))
        }
        let source = optionalText(value.field("source"), max: QuestionBankLimits.maxProse)
        if value.field("source") != nil && source == nil {
            return .failure(QuestionFailure(index: index, itemID: id, message: "source"))
        }
        let options: [ChoiceOption]
        let answer: QuestionAnswer
        switch kind {
        case .shortFill:
            if value.field("options") != nil {
                return .failure(QuestionFailure(index: index, itemID: id, message: "options_forbidden"))
            }
            guard let answerObject = value.field("answer")?.object else {
                return .failure(QuestionFailure(index: index, itemID: id, message: "answer"))
            }
            let answerKeys = Set(answerObject.map(\.0))
            if let unknown = answerKeys.subtracting(["text", "unit"]).sorted().first {
                return .failure(QuestionFailure(index: index, itemID: id, message: "unknown_field:\(unknown)"))
            }
            guard let text = value.field("answer")?.field("text")?.string,
                  let limited = QuestionBankText.limited(text, max: QuestionBankLimits.maxFillText, allowEmpty: false) else {
                return .failure(QuestionFailure(index: index, itemID: id, message: "answer_text"))
            }
            let unit = optionalText(value.field("answer")?.field("unit"), max: QuestionBankLimits.maxUnit)
            if value.field("answer")?.field("unit") != nil && unit == nil {
                return .failure(QuestionFailure(index: index, itemID: id, message: "answer_unit"))
            }
            options = []
            answer = .fill(text: limited, unit: unit?.isEmpty == true ? nil : unit)
        case .singleChoice, .multipleChoice:
            guard let rawOptions = value.field("options")?.array, (2...12).contains(rawOptions.count) else {
                return .failure(QuestionFailure(index: index, itemID: id, message: "options"))
            }
            var decoded: [ChoiceOption] = []
            var ids = Set<String>()
            var labels = Set<String>()
            for raw in rawOptions {
                guard let optionPairs = raw.object else {
                    return .failure(QuestionFailure(index: index, itemID: id, message: "option"))
                }
                if let unknown = Set(optionPairs.map(\.0)).subtracting(optionKeys).sorted().first {
                    return .failure(QuestionFailure(index: index, itemID: id, message: "unknown_field:\(unknown)"))
                }
                guard let optionID = raw.field("id")?.string, QuestionBankText.validIdentifier(optionID), ids.insert(optionID).inserted else {
                    return .failure(QuestionFailure(index: index, itemID: id, message: "option_id"))
                }
                guard let label = raw.field("label")?.string,
                      let limitedLabel = QuestionBankText.limited(label, max: QuestionBankLimits.maxOptionLabel, allowEmpty: false),
                      labels.insert(limitedLabel).inserted else {
                    return .failure(QuestionFailure(index: index, itemID: id, message: "option_label"))
                }
                guard let text = raw.field("text")?.string,
                      let limitedText = QuestionBankText.limited(text, max: QuestionBankLimits.maxOptionText, allowEmpty: false) else {
                    return .failure(QuestionFailure(index: index, itemID: id, message: "option_text"))
                }
                decoded.append(ChoiceOption(id: optionID, label: limitedLabel, text: limitedText))
            }
            guard let answerObject = value.field("answer")?.object else {
                return .failure(QuestionFailure(index: index, itemID: id, message: "answer"))
            }
            let answerKeys = Set(answerObject.map(\.0))
            if answerKeys != ["option_ids"] {
                return .failure(QuestionFailure(index: index, itemID: id, message: "answer"))
            }
            guard let rawIDs = value.field("answer")?.field("option_ids")?.array else {
                return .failure(QuestionFailure(index: index, itemID: id, message: "answer"))
            }
            var optionIDs: [String] = []
            for rawID in rawIDs {
                guard let optionID = rawID.string, ids.contains(optionID), !optionIDs.contains(optionID) else {
                    return .failure(QuestionFailure(index: index, itemID: id, message: "answer_option"))
                }
                optionIDs.append(optionID)
            }
            if kind == .singleChoice && optionIDs.count != 1 {
                return .failure(QuestionFailure(index: index, itemID: id, message: "single_answer"))
            }
            if kind == .multipleChoice && optionIDs.isEmpty {
                return .failure(QuestionFailure(index: index, itemID: id, message: "multiple_answer"))
            }
            options = decoded
            answer = .choice(optionIDs: optionIDs)
        }
        _ = allowMissingID
        var question = BankQuestion(id: id, kind: kind, language: language, stem: limitedStem, options: options, answer: answer, explanation: explanation, source: source, orderPolicy: .ordered, identityKey: "", candidateStem: "", candidateOptions: "", answerSemanticKey: "", searchText: "", unitRepeatedInText: false)
        question.languageExplicit = languageExplicit
        return .success(stamp(question))
    }

    static func stamp(_ question: BankQuestion) -> BankQuestion {
        var copy = question
        let policy = question.kind == .shortFill ? OrderPolicy.ordered : QuestionIdentity.orderPolicy(stem: question.stem, options: question.options)
        copy.orderPolicy = policy
        copy.identityKey = QuestionIdentity.identityKey(kind: question.kind, language: question.language, stem: question.stem, options: question.options, policy: policy)
        copy.candidateStem = QuestionIdentity.candidateField(question.stem)
        copy.candidateOptions = QuestionIdentity.candidateOptionsKey(question.options, policy: policy)
        copy.answerSemanticKey = QuestionIdentity.answerSemanticKey(answer: question.answer, options: question.options)
        let optionText = question.options.map { QuestionIdentity.searchField($0.label + $0.text) }.joined()
        copy.searchText = QuestionIdentity.searchField(question.stem) + optionText
        if case .fill(let text, let unit) = question.answer {
            copy.unitRepeatedInText = QuestionIdentity.unitRepeated(text: text, unit: unit)
        }
        return copy
    }

    static func contentDigest(questions: [BankQuestion], manifest: BankManifest) -> String {
        let body = QuestionIdentity.lengthPrefixed([
            ("bank", manifest.externalBankID),
            ("version", manifest.version.text),
            ("lang", manifest.language.rawValue)
        ] + questions.map { question in
            ("q", QuestionIdentity.lengthPrefixed([
                ("id", question.id),
                ("identity", question.identityKey),
                ("answer", question.answerSemanticKey),
                ("explanation", question.explanation ?? ""),
                ("source", question.source ?? "")
            ]))
        })
        return QuestionBankFiles.sha256(Data(body.utf8))
    }

    private static func warnings(for questions: [BankQuestion]) -> [String] {
        questions.filter(\.unitRepeatedInText).map { "unit_repeated:\($0.id)" }
    }

    private static func optionalText(_ value: StrictJSON.Value?, max: Int) -> String? {
        guard let value else { return nil }
        guard let text = value.string else { return nil }
        return QuestionBankText.limited(text, max: max, allowEmpty: true)
    }

    private static func title(from filename: String) -> String {
        var name = filename
        if name.lowercased().hasSuffix(".nspibank.json") { name.removeLast(".nspibank.json".count) }
        else if name.lowercased().hasSuffix(".json") { name.removeLast(5) }
        else if name.lowercased().hasSuffix(".csv") { name.removeLast(4) }
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return "Question Bank" }
        if QuestionBankLimits.scalarCount(trimmed) <= QuestionBankLimits.maxTitle { return trimmed }
        return String(trimmed.unicodeScalars.prefix(QuestionBankLimits.maxTitle))
    }

    private static func generatedID(_ columns: [String: String]) -> String {
        let body = QuestionBankCSV.header.map { columns[$0] ?? "" }.joined(separator: "\u{1e}")
        return "row-" + String(QuestionBankFiles.sha256(Data(body.utf8)).prefix(32))
    }
}
