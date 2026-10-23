import Foundation
import JavaScriptCore

struct PersonalitySessionScope: Codable, Equatable {
    let personaID: String
    let personaName: String
    let personaText: String
    let captureTargetID: String
    let channelID: String
}

enum PersonalitySessionResetReason: String, Codable, Equatable {
    case scopeChanged
    case expired
    case tutorMode
    case manual
}

struct PersonalitySessionToken: Codable, Equatable {
    let generation: UInt64
    let sequence: UInt64
    let scope: PersonalitySessionScope
    let contextBlock: String
}

/// Typed platform adapter; generation, history and barrier rules live in shared/protocol.
@MainActor
final class PersonalitySession {
    private let now: () -> Date
    private let context: JSContext?
    private let engine: JSValue?

    init(now: @escaping () -> Date = Date.init,
         maxRecords: Int = SharedProduct.personalityMaxRecords,
         maxAge: TimeInterval = SharedProduct.personalityMaxAge) {
        self.now = now
        let runtime = JSContext()
        runtime?.evaluateScript(SharedPersonalitySource.javascript)
        runtime?.evaluateScript(SharedPersonaSessionSource.javascript)
        context = runtime
        engine = runtime?.exception == nil ? runtime?.objectForKeyedSubscript("createPersonaEngine")?.call(withArguments: [
            ["maxRecords": maxRecords, "maxAgeSeconds": maxAge, "maxContextBytes": SharedProduct.personalityMaxContextBytes]
        ]) : nil
    }
    var lastBeginResetReason: PersonalitySessionResetReason? {
        PersonalitySessionResetReason(rawValue: engine?.forProperty("lastBeginResetReason")?.toString() ?? "")
    }
    var lastBeginClearedContext: Bool { engine?.forProperty("lastBeginClearedContext")?.toBool() ?? false }
    var recordCount: Int { Int(engine?.forProperty("records")?.forProperty("length")?.toInt32() ?? 0) }
    var hasContinuity: Bool { engine?.forProperty("hasContinuity")?.toBool() ?? false }

    func begin(scope: PersonalitySessionScope) -> PersonalitySessionToken {
        guard let input = object(scope), let value = invoke("begin", [input, now().timeIntervalSince1970])?.toDictionary(),
              let data = try? JSONSerialization.data(withJSONObject: value),
              let token = try? JSONDecoder().decode(PersonalitySessionToken.self, from: data) else {
            // An unavailable bridge cannot create a token accepted by the shared engine.
            return .init(generation: 0, sequence: 0, scope: scope, contextBlock: "")
        }
        return token
    }
    @discardableResult
    func record(_ payload: PersonalityContextPayload, token: PersonalitySessionToken) -> Bool {
        guard let value = object(payload), let binding = object(token) else { return false }
        return invoke("record", [value, binding, now().timeIntervalSince1970])?.toBool() ?? false
    }
    func markPreviousUnavailable(token: PersonalitySessionToken) {
        guard let binding = object(token) else { return }
        _ = invoke("unavailable", [binding, now().timeIntervalSince1970])
    }
    func reset(reason: PersonalitySessionResetReason) { _ = invoke("reset", [reason.rawValue]) }
    func contextBlock() -> String { invoke("contextBlock", [])?.toString() ?? "" }

    private func object<T: Encodable>(_ value: T) -> Any? {
        guard let data = try? JSONEncoder().encode(value) else { return nil }
        return try? JSONSerialization.jsonObject(with: data)
    }
    private func invoke(_ method: String, _ arguments: [Any]) -> JSValue? {
        guard let context, let engine, context.exception == nil else { return nil }
        let result = engine.invokeMethod(method, withArguments: arguments)
        return context.exception == nil ? result : nil
    }
}
