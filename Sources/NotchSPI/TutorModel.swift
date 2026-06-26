import SwiftUI

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

    var dotColor: Color {
        switch status {
        case .idle, .ready: return Color(red: 0.25, green: 0.73, blue: 0.31)
        case .running, .streaming: return Color(red: 0.48, green: 0.63, blue: 1.0)
        case .error: return Color(red: 0.97, green: 0.32, blue: 0.29)
        }
    }
}
