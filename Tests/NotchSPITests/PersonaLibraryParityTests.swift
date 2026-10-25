import XCTest
@testable import NotchSPI

final class PersonaLibraryParityTests: XCTestCase {
    func testSharedDesktopLibraryScenariosAgainstNativeStore() throws {
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("desktop/test/fixtures/persona-library.json")
        let cases = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [[String: Any]]
        let suite = "PersonaLibraryParityTests." + UUID().uuidString
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = PersonaStore(defaults: defaults)
        var ids: [String: String] = [:]
        for step in cases {
            let key = step["id"] as! String
            switch step["action"] as! String {
            case "add": ids[key] = store.add(name: step["name"] as! String, text: step["description"] as! String)
            case "update": store.update(id: ids[key]!, name: step["name"] as? String, text: step["description"] as? String)
            case "activate": store.setActive(ids[key])
            case "remove": store.remove(id: ids[key]!)
            default: XCTFail("Unknown shared fixture action")
            }
            let expected = step["active"] as! String
            XCTAssertEqual(store.activeID, expected.isEmpty ? nil : ids[expected])
            XCTAssertEqual(store.all.count, step["count"] as! Int)
        }
    }
}
