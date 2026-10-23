import Foundation
import JavaScriptCore

/// Same terminal receipt rules used by desktop streams and status reconciliation.
enum SharedSettlement {
    static func isTerminal(_ snapshot: SettlementSnapshot) -> Bool {
        guard let data = try? JSONEncoder().encode(snapshot),
              let object = try? JSONSerialization.jsonObject(with: data),
              let context = JSContext() else { return false }
        context.evaluateScript(SharedFreeTrialSource.javascript)
        guard context.exception == nil else { return false }
        context.evaluateScript(SharedSettlementSource.javascript)
        guard context.exception == nil else { return false }
        let value = context.objectForKeyedSubscript("validSettlement")?.call(
            withArguments: [object, snapshot.captureID.uuidString])
        return context.exception == nil && value?.toBool() == true
    }
}
