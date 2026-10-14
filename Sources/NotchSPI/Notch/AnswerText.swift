import AppKit

/// Identical inline typography and plain-text copying on all answer surfaces.
/// Math source is preserved literally: Markdown must not eat TeX backslashes or subscripts.
enum AnswerText {
    private static let math = try! NSRegularExpression(pattern: #"\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]|\$\$[\s\S]*?\$\$|\$[^\n$]+\$|\\\([\s\S]*$|\\\[[\s\S]*$|\$\$[\s\S]*$|\$[^\n$]*$"#)
    private struct ProtectedText {
        let markdown: String
        let replacements: [(String, String)]
        func restore(_ text: String) -> String {
            replacements.reduce(text) { $0.replacingOccurrences(of: $1.0, with: $1.1) }
        }
    }
    private static func protect(_ text: String) -> ProtectedText {
        var prefix = "NSPIMATHPLACEHOLDER"
        while text.contains(prefix) { prefix += "X" }
        let source = text as NSString
        let matches = math.matches(in: text, range: NSRange(location: 0, length: source.length))
        var markdown = text, replacements: [(String, String)] = []
        for (index, match) in matches.enumerated().reversed() {
            let token = prefix + String(index) + "END"
            replacements.append((token, source.substring(with: match.range)))
            markdown = (markdown as NSString).replacingCharacters(in: match.range, with: token)
        }
        return .init(markdown: markdown, replacements: replacements)
    }
    static func plain(_ text: String) -> String {
        let source = protect(text)
        guard let value = try? AttributedString(markdown: source.markdown,
            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)) else { return text }
        return source.restore(String(value.characters))
    }
    static func attributed(_ text: String, baseFont: NSFont, codeFont: NSFont, color: NSColor,
                           para: NSParagraphStyle, extra: [NSAttributedString.Key: Any] = [:]) -> NSAttributedString {
        var attrs: [NSAttributedString.Key: Any] = [.font: baseFont, .foregroundColor: color, .paragraphStyle: para]
        attrs.merge(extra) { _, new in new }
        let out = NSMutableAttributedString(), source = protect(text)
        guard let value = try? AttributedString(markdown: source.markdown,
            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)) else {
            return NSAttributedString(string: text, attributes: attrs)
        }
        for run in value.runs {
            var a = attrs, font = baseFont
            if let intent = run.inlinePresentationIntent {
                if intent.contains(.code) { font = codeFont }
                else {
                    if intent.contains(.stronglyEmphasized) { font = NSFontManager.shared.convert(font, toHaveTrait: .boldFontMask) }
                    if intent.contains(.emphasized) { font = NSFontManager.shared.convert(font, toHaveTrait: .italicFontMask) }
                }
            }
            a[.font] = font
            let restored = source.restore(String(value[run.range].characters))
            let text = restored as NSString
            var start = 0
            let matches = run.inlinePresentationIntent?.contains(.code) == true ? [] : math.matches(in: restored, range: NSRange(location: 0, length: text.length))
            for match in matches {
                out.append(NSAttributedString(string: text.substring(with: NSRange(location: start, length: match.range.location - start)), attributes: a))
                let raw = text.substring(with: match.range)
                out.append(AnswerMath.formula(raw, attributes: a) ?? NSAttributedString(string: raw, attributes: a))
                start = NSMaxRange(match.range)
            }
            out.append(NSAttributedString(string: text.substring(from: start), attributes: a))
        }
        return out
    }
    static func isReadingLabel(_ client: Any?) -> Bool { client is AnswerReadingLabel }
    static func label(_ text: String, size: CGFloat, weight: NSFont.Weight = .regular,
                      color: NSColor = .labelColor) -> NSTextField {
        let label = AnswerReadingLabel(wrappingLabelWithString: "")
        let paragraph = NSMutableParagraphStyle(); paragraph.lineSpacing = 4; paragraph.paragraphSpacing = 6
        label.originalText = attributed(text, baseFont: .systemFont(ofSize: size, weight: weight),
            codeFont: .monospacedSystemFont(ofSize: max(10, size - 0.5), weight: weight), color: color, para: paragraph)
        label.attributedStringValue = label.originalText
        label.setAccessibilityValue(AnswerMath.sourceText(label.originalText))
        label.isSelectable = true
        label.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        label.setContentCompressionResistancePriority(.required, for: .vertical)
        return label
    }
}

/// Measure using the actual column width, including after window resizing. A fixed
/// preferredMaxLayoutWidth otherwise leaves the last lines outside the label's frame.
private final class AnswerReadingLabel: NSTextField {
    var originalText = NSAttributedString()
    override func accessibilityValue() -> String? { AnswerMath.sourceText(originalText) }
    override func accessibilityLabel() -> String? { AnswerMath.sourceText(originalText) }

    override var intrinsicContentSize: NSSize {
        guard bounds.width > 4 else { return super.intrinsicContentSize }
        let rect = attributedStringValue.boundingRect(with: NSSize(width: bounds.width - 4, height: 100_000),
            options: [.usesLineFragmentOrigin, .usesFontLeading])
        let cellHeight = cell?.cellSize(forBounds: NSRect(x: 0, y: 0, width: bounds.width, height: 100_000)).height ?? 0
        return NSSize(width: NSView.noIntrinsicMetric, height: ceil(max(rect.height + 4, cellHeight)))
    }
    override func setFrameSize(_ newSize: NSSize) {
        let changed = abs(newSize.width - frame.width) > 0.5
        super.setFrameSize(newSize)
        if changed {
            attributedStringValue = AnswerMath.fitting(originalText, width: max(1, newSize.width - 4))
            invalidateIntrinsicContentSize()
        }
    }
}

/// Preserve editable TeX when a user copies a text selection containing a formula.
final class AnswerReadingFieldEditor: NSTextView {
    override func writeSelection(to pboard: NSPasteboard, types: [NSPasteboard.PasteboardType]) -> Bool {
        guard let storage = textStorage, NSMaxRange(selectedRange()) <= storage.length else { return false }
        let selected = storage.attributedSubstring(from: selectedRange())
        pboard.clearContents()
        return pboard.setString(AnswerMath.sourceText(selected), forType: .string)
    }
}
