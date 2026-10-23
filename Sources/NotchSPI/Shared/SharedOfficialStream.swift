import Foundation
import JavaScriptCore

/// Typed adapter for the shared event state machine. The decoder copies this bridge on mutation.
final class SharedOfficialStream {
    private let context: JSContext?
    private var engine: JSValue?
    private let captureID: UUID
    private let screenQuery: Bool
    private let operation: String

    init(captureID: UUID, screenQuery: Bool, operation: String, snapshot: String? = nil) {
        self.captureID = captureID; self.screenQuery = screenQuery; self.operation = operation
        context = JSContext()
        guard let context else { return }
        for source in [SharedFreeTrialSource.javascript, SharedSettlementSource.javascript,
                       SharedOfficialStreamSource.javascript] {
            context.evaluateScript(source)
            guard context.exception == nil else { return }
        }
        engine = context.objectForKeyedSubscript("createOfficialStream")?.call(withArguments: [
            captureID.uuidString, screenQuery, operation, snapshot as Any? ?? NSNull(),
        ])
        if context.exception != nil || engine?.isUndefined != false { engine = nil }
    }

    func copy() throws -> SharedOfficialStream {
        guard let context, let engine else { throw OfficialStreamDecoder.Failure.invalidEvent }
        context.exception = nil
        let value = context.objectForKeyedSubscript("snapshotOfficialStream")?.call(withArguments: [engine])
        guard context.exception == nil, let snapshot = value?.toString() else {
            throw OfficialStreamDecoder.Failure.invalidEvent
        }
        return SharedOfficialStream(captureID: captureID, screenQuery: screenQuery,
                                    operation: operation, snapshot: snapshot)
    }

    func accept(_ payload: String) throws -> OfficialStreamDecoder.Event {
        let object = try invoke("accept", arguments: [payload])
        switch object["type"] as? String {
        case "delta":
            guard let text = object["text"] as? String else { throw OfficialStreamDecoder.Failure.invalidEvent }
            return .delta(text)
        case "usage": return .usage(try decode(object))
        case "error": return .error(try decode(object["error"] as? [String: Any] ?? object))
        case "done": return .done
        default: throw OfficialStreamDecoder.Failure.invalidEvent
        }
    }

    func finish() throws -> OfficialStreamDecoder.Outcome {
        try decode(invoke("finishOutcome", arguments: []))
    }

    private func invoke(_ method: String, arguments: [Any]) throws -> [String: Any] {
        guard let context, let engine else { throw OfficialStreamDecoder.Failure.invalidEvent }
        context.exception = nil
        let value = engine.invokeMethod(method, withArguments: arguments)
        guard context.exception == nil, let object = value?.toDictionary() as? [String: Any] else {
            throw OfficialStreamDecoder.Failure.invalidEvent
        }
        return object
    }

    private func decode<T: Decodable>(_ object: [String: Any]) throws -> T {
        try JSONDecoder().decode(T.self, from: JSONSerialization.data(withJSONObject: object))
    }
}
