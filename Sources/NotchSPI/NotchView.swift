import SwiftUI

struct NotchView: View {
    @ObservedObject var model: TutorModel
    var onHover: (Bool) -> Void
    var onCycleDepth: () -> Void
    var onSettings: () -> Void

    private let accent = Color(red: 0.48, green: 0.63, blue: 1.0)

    // Rose tint by state — white at rest (no "camera-in-use" green dot).
    private var roseColor: Color {
        switch model.status {
        case .running, .streaming: return accent
        case .error: return Color(red: 0.97, green: 0.32, blue: 0.29)
        default: return .white
        }
    }

    var body: some View {
        ZStack {
            background

            if model.expanded {
                expandedContent
            } else {
                collapsedContent
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .contentShape(Rectangle())
        .onHover { onHover($0) }
    }

    private var background: some View {
        // Same notch geometry in both states: concave top corners (6) + convex
        // bottom corners (14 collapsed / 22 expanded), matching the real notch.
        // The visible top-right corner of the collapsed extension is now concave
        // like the real notch, instead of a square corner sticking out.
        NotchShape(bottomRadius: model.expanded ? 22 : 14, topRadius: 6)
            .fill(Color.black)
    }

    private var collapsedContent: some View {
        // Rose loader lives in the visible menu-bar space to the left of the notch.
        HStack(spacing: 0) {
            RoseLoader(color: roseColor, size: 20)
                .padding(.leading, 14)
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var expandedContent: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                RoseLoader(color: roseColor, size: 16)
                Text("学习辅导").font(.system(size: 12.5, weight: .semibold)).foregroundStyle(.white)
                Text(model.statusText).font(.system(size: 11)).foregroundStyle(.secondary).lineLimit(1)
                Spacer()
                Button(action: onCycleDepth) {
                    Text(model.depthLabel)
                        .font(.system(size: 11))
                        .padding(.horizontal, 7)
                        .padding(.vertical, 2)
                        .background(Color.white.opacity(0.1), in: Capsule())
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
                Button(action: onSettings) {
                    Image(systemName: "gearshape").font(.system(size: 13))
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 16)
            .padding(.top, 10)
            .padding(.bottom, 8)

            ScrollView {
                Text(rendered)
                    .font(.system(size: 12.5))
                    .foregroundStyle(.white)
                    .opacity(model.answer.isEmpty ? 0.5 : 1)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .textSelection(.enabled)
                    .padding(.horizontal, 16)
                    .padding(.bottom, 14)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }

    private var rendered: AttributedString {
        if model.answer.isEmpty {
            return AttributedString("按 ⌘⇧1 截屏讲题 · 悬停展开")
        }
        if let a = try? AttributedString(
            markdown: model.answer,
            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        ) {
            return a
        }
        return AttributedString(model.answer)
    }
}
