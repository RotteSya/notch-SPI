import Foundation
import JavaScriptCore

/// Runs the same receipt validator as the desktop client; it never grants local entitlement.
enum SharedFreeTrial {
    static func isValid(_ snapshot: FreeTrialSnapshot) -> Bool {
        guard let data = try? JSONEncoder().encode(snapshot),
              let object = try? JSONSerialization.jsonObject(with: data),
              let context = JSContext() else { return false }
        context.evaluateScript(SharedFreeTrialSource.javascript)
        guard context.exception == nil else { return false }
        let value = context.objectForKeyedSubscript("validFreeTrial")?.call(withArguments: [object])
        return context.exception == nil && value?.toBool() == true
    }
}
