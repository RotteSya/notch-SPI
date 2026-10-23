import Foundation
import JavaScriptCore

/// Per-call JavaScript context keeps the pure parser safe for background and UI callers.
enum SharedPersonality {
    private static func call(_ name: String, _ arguments: [Any]) -> JSValue? {
        guard let context = JSContext() else { return nil }
        context.evaluateScript(SharedPersonalitySource.javascript)
        guard context.exception == nil else { return nil }
        let value = context.objectForKeyedSubscript(name)?.call(withArguments: arguments)
        return context.exception == nil ? value : nil
    }
    static func compose(_ raw: String, streaming: Bool) -> PersonalityAnswerComposition {
        guard let object = call("composePersonality", [raw, streaming])?.toDictionary(),
              let data = try? JSONSerialization.data(withJSONObject: object),
              let result = try? JSONDecoder().decode(PersonalityAnswerComposition.self, from: data) else {
            return .init(visibleChoices: "", finalizedChoices: [], provisionalChoice: nil,
                         context: nil, errorCode: nil, errorOrdinals: [], violations: [.noValidChoices])
        }
        return result
    }
    static func ordinal(_ source: String) -> String? {
        guard let value = call("normalizePersonalityOrdinal", [source]), !value.isNull, !value.isUndefined else { return nil }
        return value.toString()
    }
    static func choice(_ source: String) -> String {
        call("normalizePersonalityChoice", [source])?.toString() ?? ""
    }
    static func isTerminal(_ code: String?) -> Bool {
        guard let code else { return false }
        return call("isPersonalityTerminalError", [code])?.toBool() ?? false
    }
}
