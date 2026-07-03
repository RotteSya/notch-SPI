import Foundation

/// One saved target persona (人物像) the personality-test answers should match.
struct Persona: Codable, Equatable {
    let id: String
    var name: String
    var text: String
    var updatedAt: Date

    init(id: String = UUID().uuidString, name: String, text: String, updatedAt: Date = Date()) {
        self.id = id
        self.name = name
        self.text = text
        self.updatedAt = updatedAt
    }
}

private struct PersonaLibrary: Codable {
    var activeID: String?
    var personas: [Persona]
    static let empty = PersonaLibrary(activeID: nil, personas: [])
}

/// Library of the user's target personas (人物像). Multiple named personas can be saved; exactly
/// one is "active" and drives the next 性格测试 capture. The active persona is mirrored back into
/// `Settings.personaName/personaText`, so the capture pipeline (CLIRunner / Prompts / runTapped)
/// keeps reading those two fields unchanged — the store is just a richer front for them.
///
/// Persisted as JSON in `UserDefaults` to match how the rest of the app stores settings (no
/// working-directory-relative files, which would be unreliable for a `.app` bundle).
final class PersonaStore {
    static let shared = PersonaStore()
    private let d = UserDefaults.standard
    private let key = "personaLibrary"

    private var library: PersonaLibrary

    private init() {
        if let data = d.data(forKey: key),
           let lib = try? JSONDecoder().decode(PersonaLibrary.self, from: data) {
            library = lib
        } else {
            // First run on this build: migrate the legacy single persona (personaName/personaText)
            // into the library so the user keeps the persona they already wrote.
            let name = d.string(forKey: "personaName") ?? ""
            let text = d.string(forKey: "personaText") ?? ""
            if !(name + text).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                let p = Persona(name: name, text: text)
                library = PersonaLibrary(activeID: p.id, personas: [p])
            } else {
                library = .empty
            }
            save()
        }
        syncActiveToSettings()
    }

    // MARK: - Access

    var all: [Persona] { library.personas }
    var activeID: String? { library.activeID }
    var active: Persona? { library.personas.first { $0.id == library.activeID } }

    // MARK: - Mutation (call on the main thread)

    /// Add a new named persona. The FIRST persona added becomes active automatically.
    @discardableResult
    func add(name: String, text: String) -> String {
        let p = Persona(name: name, text: text)
        library.personas.append(p)
        if library.activeID == nil { library.activeID = p.id }
        save()
        syncActiveToSettings()
        return p.id
    }

    /// Update an existing persona's name and/or text (refreshes `updatedAt`).
    func update(id: String, name: String? = nil, text: String? = nil) {
        guard let i = library.personas.firstIndex(where: { $0.id == id }) else { return }
        if let name { library.personas[i].name = name }
        if let text { library.personas[i].text = text }
        library.personas[i].updatedAt = Date()
        save()
        if id == library.activeID { syncActiveToSettings() }
    }

    /// Remove a persona. Deleting the active one falls back to "none" — never silently promote
    /// another, so a capture can't run against a persona the user didn't pick.
    func remove(id: String) {
        library.personas.removeAll { $0.id == id }
        if library.activeID == id { library.activeID = nil }
        save()
        syncActiveToSettings()
    }

    /// Choose which persona the next 性格测试 capture answers toward. `nil` = none.
    func setActive(_ id: String?) {
        if let id, !library.personas.contains(where: { $0.id == id }) { return }
        library.activeID = id
        save()
        syncActiveToSettings()
    }

    // MARK: - Persistence + capture-pipeline bridge

    private func save() {
        if let data = try? JSONEncoder().encode(library) {
            d.set(data, forKey: key)
        }
    }

    /// Mirror the active persona into the legacy `Settings` fields the capture pipeline reads.
    /// Clearing them when there's no active persona keeps the "还没有人物像" prompt correct.
    private func syncActiveToSettings() {
        Settings.shared.personaName = active?.name ?? ""
        Settings.shared.personaText = active?.text ?? ""
    }
}
