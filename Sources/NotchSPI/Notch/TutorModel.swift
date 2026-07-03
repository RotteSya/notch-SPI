import Combine

/// Observable state the notch renders. Mutated on the main thread by the controller's pipeline.
/// `ObservableObject` / `@Published` are Combine types — the notch is pure AppKit and observes
/// this via `objectWillChange`, no SwiftUI involved.
final class TutorModel: ObservableObject {
    enum Status {
        case idle, ready, running, streaming, error
    }

    @Published var expanded = false
    @Published var status: Status = .ready
    @Published var statusText = "就绪"
    @Published var answer = "" // streamed markdown text
    @Published var cliLabel = "Codex"
    @Published var depthLabel = "引导"
    @Published var mode = "tutor"        // active mode id: "tutor" | "personality"
    @Published var modeLabel = "学习辅导" // header title for the active mode
    @Published var personaLabel = ""      // current persona name (empty = not set)
}
