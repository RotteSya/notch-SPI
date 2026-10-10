import Foundation

enum QuestionBankLocation {
    static func root(environment: [String: String] = ProcessInfo.processInfo.environment) -> URL {
        let testing = environment["XCTestConfigurationFilePath"] != nil || environment["NSPI_QA_EPHEMERAL"] == "1"
        if testing {
            return FileManager.default.temporaryDirectory
                .appendingPathComponent("notchspi-qb-\(ProcessInfo.processInfo.processIdentifier)", isDirectory: true)
        }
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSTemporaryDirectory())
        return base.appendingPathComponent("com.rottesya.notchspi/QuestionBank", isDirectory: true)
    }
}

@MainActor
protocol QuestionBankServing: AnyObject {
    var hasEnabledBank: Bool { get }
    var storageError: String? { get }
    func prepare() async
    func lookup(image: Data, scope: AliasScope, trace: @escaping @Sendable (String) -> Void) async -> LocalLookupOutcome
    func confirm(candidate: LocalCandidate, scope: AliasScope, labelMap: [String: String]) async -> Result<LocalAnswer, QuestionBankError>
    func requalify(_ answer: LocalAnswer, automatic: Bool) async -> LocalAnswer?
    func stage(_ url: URL) async -> ImportPreview
    func applying(language: BankLanguage, title: String, to preview: ImportPreview) async -> ImportPreview
    func commit(_ preview: ImportPreview, decision: ImportDecision) async -> ImportCommitResult
    func banks() async -> [QuestionBankSummary]
    func search(query: String, offset: Int, instanceID: UUID?) async -> QuestionSearchPage
    func detail(instanceID: UUID, itemID: String) async -> QuestionDetail?
    func setEnabled(_ id: UUID, _ enabled: Bool) async
    func setAutomatic(_ id: UUID, _ allowed: Bool) async
    func remove(_ id: UUID) async
    func block(instanceID: UUID, itemID: String, blocked: Bool) async
}

@MainActor
final class QuestionBankRuntime: QuestionBankServing {
    static let shared = QuestionBankRuntime()
    private let store: SQLiteQuestionBankStore
    private let importer: QuestionBankImporter
    private let resolver: LocalQuestionResolver
    private(set) var hasEnabledBank = false
    private(set) var storageError: String?

    init(root: URL, engine: QuestionOCREngine) {
        let database = root.appendingPathComponent("questions.sqlite")
        store = SQLiteQuestionBankStore(databaseURL: database)
        importer = QuestionBankImporter(store: store)
        resolver = LocalQuestionResolver(store: store, gate: RecognitionGate(engine: engine))
    }

    convenience init() {
        self.init(root: QuestionBankLocation.root(), engine: VisionQuestionOCR())
    }

    func prepare() async {
        await store.open()
        await refresh()
    }

    func lookup(image: Data, scope: AliasScope, trace: @escaping @Sendable (String) -> Void) async -> LocalLookupOutcome {
        let deadline = ProcessInfo.processInfo.systemUptime + QuestionBankLimits.lookupBudget
        let now: @Sendable () -> TimeInterval = { ProcessInfo.processInfo.systemUptime }
        return await Self.foreground(deadline: deadline, now: now) { [self] in
            let languages: [String]
            do {
                languages = try await self.languageCodes(deadline: deadline)
            } catch let error as QuestionBankError {
                if case .unavailable(let message) = error, message == "timeout" { return .unavailable("timeout") }
                return .unavailable("store")
            } catch {
                return .unavailable("store")
            }
            let result = await self.resolver.lookup(image: image, scope: scope, languages: languages, deadline: deadline, now: now, trace: trace)
            if case .ready(var answer) = result {
                answer.lookupDeadline = deadline
                return .ready(answer)
            }
            return result
        }
    }

    func qaHold(_ seconds: TimeInterval, entered: @escaping @Sendable () -> Void = {}) async {
        await store.qaHold(seconds, entered: entered)
    }

    func confirm(candidate: LocalCandidate, scope: AliasScope, labelMap: [String: String]) async -> Result<LocalAnswer, QuestionBankError> {
        await resolver.confirm(candidate, scope: scope, labelMap: labelMap)
    }

    func requalify(_ answer: LocalAnswer, automatic: Bool) async -> LocalAnswer? {
        let deadline = automatic ? (answer.lookupDeadline ?? ProcessInfo.processInfo.systemUptime + QuestionBankLimits.lookupBudget)
            : ProcessInfo.processInfo.systemUptime + QuestionBankLimits.lookupBudget
        return await QuestionBankDeadline.run(until: deadline, fallback: nil) { [resolver] in
            await resolver.requalify(answer, automatic: automatic, deadline: deadline)
        }
    }

    func stage(_ url: URL) async -> ImportPreview { await importer.stage(url) }

    func applying(language: BankLanguage, title: String, to preview: ImportPreview) async -> ImportPreview {
        await importer.applying(language: language, title: title, to: preview)
    }

    func commit(_ preview: ImportPreview, decision: ImportDecision) async -> ImportCommitResult {
        let result = await importer.commit(preview, decision: decision)
        await refresh()
        return result
    }

    func banks() async -> [QuestionBankSummary] {
        (try? await store.summaries()) ?? []
    }

    func search(query: String, offset: Int, instanceID: UUID?) async -> QuestionSearchPage {
        (try? await store.search(query: query, offset: offset, instanceID: instanceID)) ?? QuestionSearchPage(hits: [], offset: 0, total: 0)
    }

    func detail(instanceID: UUID, itemID: String) async -> QuestionDetail? {
        try? await store.detail(instanceID: instanceID, itemID: itemID)
    }

    func setEnabled(_ id: UUID, _ enabled: Bool) async {
        try? await store.setEnabled(id, enabled)
        await refresh()
    }

    func setAutomatic(_ id: UUID, _ allowed: Bool) async {
        try? await store.setAutomatic(id, allowed)
    }

    func remove(_ id: UUID) async {
        try? await store.deleteBank(id)
        await refresh()
    }

    func block(instanceID: UUID, itemID: String, blocked: Bool) async {
        try? await store.setBlocked(instanceID: instanceID, itemID: itemID, blocked: blocked)
    }

    private func languageCodes(deadline: TimeInterval) async throws -> [String] {
        let stored = try await store.enabledLanguages(deadline: deadline)
        var codes = Set(stored.map(\.visionCode))
        codes.insert(BankLanguage.fromInterface(L10n.lang).visionCode)
        return codes.sorted()
    }

    private static func foreground(deadline: TimeInterval, now: @escaping @Sendable () -> TimeInterval, _ work: @escaping @MainActor () async -> LocalLookupOutcome) async -> LocalLookupOutcome {
        await QuestionBankDeadline.run(until: deadline, fallback: .unavailable("timeout"), work: work)
    }

    private func refresh() async {
        storageError = await store.failureReason()
        hasEnabledBank = (try? await store.hasEnabledBank()) ?? false
    }
}

/// The foreground can finish while a bounded storage/OCR operation unwinds.
/// No task group is used: its scope would wait for a blocked child to finish.
@MainActor
enum QuestionBankDeadline {
    static func run<T: Sendable>(until deadline: TimeInterval, fallback: T, work: @escaping @MainActor () async -> T) async -> T {
        guard ProcessInfo.processInfo.systemUptime < deadline else { return fallback }
        return await withCheckedContinuation { continuation in
            let once = ResumeOnce()
            Task { @MainActor in
                let result = await work()
                if once.take() {
                    continuation.resume(returning: ProcessInfo.processInfo.systemUptime < deadline ? result : fallback)
                }
            }
            Task { @MainActor in
                let remaining = deadline - ProcessInfo.processInfo.systemUptime
                if remaining > 0 { try? await Task.sleep(nanoseconds: UInt64(remaining * 1_000_000_000)) }
                if once.take() { continuation.resume(returning: fallback) }
            }
        }
    }
}
