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
    /// A reply arrives a few characters at a time, so inline markup is briefly half-written:
    /// an opening `**` or backtick with no partner yet, or the first half of a formula. Shown
    /// literally, those characters appear, then vanish when their partner lands, and every glyph
    /// after them shifts. This returns the text a reader should see mid-stream instead: an open
    /// span is styled as if already closed, a delimiter with nothing after it waits for its
    /// content, and an unfinished formula waits until it can be typeset. What is on screen then
    /// only ever grows. The finished reply is never passed through here.
    static func settledForStreaming(_ text: String) -> String {
        var visible = text
        // An unfinished formula: hold it back from its opening delimiter. A long tail is more
        // likely prose after a stray delimiter, which stays readable as it always was.
        let source = visible as NSString
        if let last = math.matches(in: visible, range: NSRange(location: 0, length: source.length)).last,
           NSMaxRange(last.range) == source.length {
            let raw = source.substring(with: last.range)
            let closed = (raw.hasPrefix("\\(") && raw.hasSuffix("\\)") && raw.count >= 4)
                || (raw.hasPrefix("\\[") && raw.hasSuffix("\\]") && raw.count >= 4)
                || (raw.hasPrefix("$$") && raw.hasSuffix("$$") && raw.count >= 4)
                || (raw.hasPrefix("$") && !raw.hasPrefix("$$") && raw.hasSuffix("$") && raw.count >= 2)
            let display = raw.hasPrefix("\\(") || raw.hasPrefix("\\[") || raw.hasPrefix("$$")
            // `$5` is a price; `$x` opens inline math.
            let inline = !display && raw.count <= 120 && raw.dropFirst().first.map { !$0.isNumber && !$0.isWhitespace } == true
            if !closed, raw == "$" || inline || (display && raw.count <= 400) {
                visible = source.substring(to: last.range.location)
            }
        }
        if visible.hasSuffix("\\") { visible.removeLast() }   // the first half of \( or \[

        // Inline spans do not cross a line in practice; only the line being written is open.
        let lineStart = visible.lastIndex(of: "\n").map { visible.index(after: $0) } ?? visible.startIndex
        let line = String(visible[lineStart...])
        let characters = Array(line)
        let lineSource = line as NSString
        // Finished formulas on this line are opaque: TeX is full of asterisks and underscores.
        var opaque = [Bool](repeating: false, count: characters.count)
        for match in math.matches(in: line, range: NSRange(location: 0, length: lineSource.length)) {
            let lower = line.utf16.index(line.utf16.startIndex, offsetBy: match.range.location)
            let upper = line.utf16.index(lower, offsetBy: match.range.length)
            let first = line.distance(from: line.startIndex, to: lower)
            let count = line.distance(from: lower, to: upper)
            for index in first..<min(characters.count, first + count) { opaque[index] = true }
        }
        var open: [String] = []          // closers still owed, innermost last
        var index = 0
        var kept = characters.count      // characters of the line that are shown
        while index < characters.count {
            let character = characters[index]
            guard !opaque[index], character == "`" || character == "*" || character == "~" else { index += 1; continue }
            var end = index
            while end < characters.count, characters[end] == character, !opaque[end] { end += 1 }
            let run = end - index, atEnd = end == characters.count
            let inCode = open.last == "`"
            defer { index = end }
            if character == "`" {
                if inCode { open.removeLast() }
                else if atEnd { kept = index }            // an opener with nothing to style yet
                else { open.append("`") }
                continue
            }
            if inCode { continue }
            if character == "~" {
                guard run >= 2 else { if atEnd { kept = index }; continue }   // perhaps half of `~~`
                if open.last == "~~" { open.removeLast() } else if atEnd { kept = index } else { open.append("~~") }
                continue
            }
            let before = index > 0 ? characters[index - 1] : " "
            let after = atEnd ? " " : characters[end]
            let closer = run >= 2 ? "**" : "*"
            let canClose = !before.isWhitespace
            if atEnd, run == 1, open.last == "**" {
                kept = index                               // half of the closing `**`
            } else if canClose, let position = open.lastIndex(of: closer) {
                open.removeSubrange(position...)
            } else if atEnd {
                // Half of a closer still arriving, or an opener with nothing to style yet.
                kept = index
            } else if !after.isWhitespace, !(before.isASCII && (before.isLetter || before.isNumber)) {
                open.append(closer)                        // `3*4` and `2**3` are arithmetic
            }
        }
        let head = String(visible[..<lineStart])
        let shown = String(characters[..<kept])
        guard !open.isEmpty else { return head + shown }
        let closers = open.reversed().joined()
        // A closer cannot follow a space, so it goes before any the line currently ends with.
        let body = String(shown.reversed().drop(while: \.isWhitespace).reversed())
        let candidate = body + closers + shown.dropFirst(body.count)
        // The real parser has the last word: if it would print the borrowed closers, keep the
        // line as written rather than invent characters.
        guard let parsed = try? AttributedString(markdown: protect(body + closers).markdown,
                options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)),
              !String(parsed.characters).hasSuffix(String(closers.last!)) else { return head + shown }
        return head + candidate
    }

    static func plain(_ text: String) -> String {
        let source = protect(text)
        guard let value = try? AttributedString(markdown: source.markdown,
            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)) else { return text }
        return source.restore(String(value.characters))
    }
    static func attributed(_ text: String, baseFont: NSFont, codeFont: NSFont, color: NSColor,
                           para: NSParagraphStyle, extra: [NSAttributedString.Key: Any] = [:],
                           streaming: Bool = false) -> NSAttributedString {
        var attrs: [NSAttributedString.Key: Any] = [.font: baseFont, .foregroundColor: color, .paragraphStyle: para]
        attrs.merge(extra) { _, new in new }
        let text = streaming ? settledForStreaming(text) : text
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
