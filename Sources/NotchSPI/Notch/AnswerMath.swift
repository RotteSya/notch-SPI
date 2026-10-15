import AppKit
import CoreText
import SwiftMath

extension NSAttributedString.Key {
    static let answerMathSource = NSAttributedString.Key("NotchSPI.mathSource")
}

/// Local, shared formula layout. Copying always uses the original source, never image text.
enum AnswerMath {
    private final class Formula: NSObject {
        let image: NSImage
        let descent: CGFloat
        init(image: NSImage, descent: CGFloat) { self.image = image; self.descent = descent }
    }
    private final class Metrics {
        let width: CGFloat, ascent: CGFloat, descent: CGFloat
        init(_ bounds: CGRect) {
            width = bounds.width; descent = max(0, -bounds.minY); ascent = bounds.height - descent
        }
    }
    private static let cache: NSCache<NSString, Formula> = {
        let cache = NSCache<NSString, Formula>(); cache.countLimit = 256; return cache
    }()
    static func formula(_ source: String, attributes: [NSAttributedString.Key: Any]) -> NSAttributedString? {
        guard source.count <= 2048, source.filter({ $0 == "\\" }).count <= 128, let font = attributes[.font] as? NSFont else { return nil }
        guard (source.hasPrefix("\\(") && source.hasSuffix("\\)"))
            || (source.hasPrefix("\\[") && source.hasSuffix("\\]"))
            || (source.hasPrefix("$") && source.hasSuffix("$")) else { return nil }
        let display = source.hasPrefix("\\[") || source.hasPrefix("$$")
        let edge = source.hasPrefix("$") && !display ? 1 : 2
        guard source.count > edge * 2 else { return nil }
        let latex = String(source.dropFirst(edge).dropLast(edge))
        var depth = 0
        for character in latex {
            if character == "{" { depth += 1; if depth > 32 { return nil } }
            if character == "}" { depth -= 1; if depth < 0 { return nil } }
        }
        guard depth == 0 else { return nil }
        let color = ((attributes[.foregroundColor] as? NSColor) ?? .labelColor).usingColorSpace(.deviceRGB) ?? .black
        let key = "\(source)|\(font.pointSize)|\(color)" as NSString
        let value: Formula
        if let cached = cache.object(forKey: key) { value = cached }
        else {
            // SwiftMath resolves its own Bundle.module resources, including the SwiftPM
            // build directory used by XCTest. Host-bundle guesses reject valid installs.
            var math = MathImage(latex: latex, fontSize: font.pointSize, textColor: color,
                                 labelMode: display ? .display : .text, textAlignment: .left)
            let (error, image, layout) = math.asImage()
            guard error == nil, let image, let layout, image.size.width > 0, image.size.height > 0,
                  image.size.width < 20_000, image.size.height < 4_000 else { return nil }
            value = Formula(image: image, descent: layout.descent + 2)
            cache.setObject(value, forKey: key)
        }
        let attachment = NSTextAttachment()
        attachment.image = value.image
        attachment.bounds = CGRect(x: 0, y: -value.descent, width: value.image.size.width + 4, height: value.image.size.height + 4)
        var attrs = attributes
        attrs[.answerMathSource] = source
        attrs[.attachment] = attachment
        attrs[NSAttributedString.Key(kCTRunDelegateAttributeName as String)] = delegate(attachment.bounds)
        return NSAttributedString(string: "\u{FFFC}", attributes: attrs)
    }
    private static func delegate(_ bounds: CGRect) -> CTRunDelegate? {
        var callbacks = CTRunDelegateCallbacks(version: kCTRunDelegateVersion1,
            dealloc: { Unmanaged<Metrics>.fromOpaque($0).release() },
            getAscent: { Unmanaged<Metrics>.fromOpaque($0).takeUnretainedValue().ascent },
            getDescent: { Unmanaged<Metrics>.fromOpaque($0).takeUnretainedValue().descent },
            getWidth: { Unmanaged<Metrics>.fromOpaque($0).takeUnretainedValue().width })
        return CTRunDelegateCreate(&callbacks, Unmanaged.passRetained(Metrics(bounds)).toOpaque())
    }
    /// Break only at outer binary operators; never split fractions, roots, or matrices.
    private static func wrapped(_ source: String, attributes: [NSAttributedString.Key: Any], width: CGFloat) -> NSTextAttachment? {
        guard !source.contains("\\begin"), !source.contains("\\left") else { return nil }
        let edge = source.hasPrefix("$") && !source.hasPrefix("$$") ? 1 : 2
        let latex = String(source.dropFirst(edge).dropLast(edge))
        var depth = 0, part = "", parts: [String] = []
        for character in latex {
            if "{([".contains(character) { depth += 1 }
            if "})]".contains(character) { depth -= 1 }
            if depth == 0, "+=-".contains(character), !part.trimmingCharacters(in: .whitespaces).isEmpty {
                parts.append(part); part = ""
            }
            part.append(character)
        }
        parts.append(part)
        guard parts.count > 1 else { return nil }
        var rows: [[NSTextAttachment]] = [[]], rowWidth: CGFloat = 0
        for part in parts {
            guard let rendered = formula("\\(" + part + "\\)", attributes: attributes),
                  let item = rendered.attribute(.attachment, at: 0, effectiveRange: nil) as? NSTextAttachment else { return nil }
            let scale = min(1, width / item.bounds.width)
            item.bounds = CGRect(x: 0, y: item.bounds.minY * scale, width: item.bounds.width * scale, height: item.bounds.height * scale)
            if rowWidth + item.bounds.width > width, !rows[rows.count - 1].isEmpty { rows.append([]); rowWidth = 0 }
            rows[rows.count - 1].append(item); rowWidth += item.bounds.width
        }
        guard rows.count > 1 else { return nil }
        var drawings: [(NSImage, CGRect)] = [], top: CGFloat = 0, fullWidth: CGFloat = 0
        for row in rows {
            let ascent = row.map { $0.bounds.maxY }.max() ?? 0
            let descent = row.map { -$0.bounds.minY }.max() ?? 0
            var x: CGFloat = 0
            for item in row {
                if let image = item.image {
                    drawings.append((image, CGRect(x: x + 2, y: top + ascent - item.bounds.maxY + 2,
                        width: max(1, item.bounds.width - 4), height: max(1, item.bounds.height - 4))))
                }
                x += item.bounds.width
            }
            fullWidth = max(fullWidth, x); top += ascent + descent + 6
        }
        let size = CGSize(width: fullWidth, height: max(1, top - 6))
        let image = NSImage(size: size, flipped: false) { _ in
            for (image, rect) in drawings {
                image.draw(in: CGRect(x: rect.minX, y: size.height - rect.maxY, width: rect.width, height: rect.height),
                           from: .zero, operation: .sourceOver, fraction: 1, respectFlipped: false, hints: nil)
            }
            return true
        }
        let attachment = NSTextAttachment(); attachment.image = image
        attachment.bounds = CGRect(x: 0, y: -(rows.first?.map { -$0.bounds.minY }.max() ?? 0), width: size.width, height: size.height)
        return attachment
    }

    /// Use the same fitting for native text fields and Core Text's measurement/drawing.
    static func fitting(_ source: NSAttributedString, width: CGFloat) -> NSAttributedString {
        let result = NSMutableAttributedString(attributedString: source)
        source.enumerateAttribute(.attachment, in: NSRange(location: 0, length: source.length)) { value, range, _ in
            guard let original = value as? NSTextAttachment, original.bounds.width > 0 else { return }
            let para = source.attribute(.paragraphStyle, at: range.location, effectiveRange: nil) as? NSParagraphStyle
            let available = max(1, width - max(para?.headIndent ?? 0, para?.firstLineHeadIndent ?? 0) - abs(para?.tailIndent ?? 0) - 8)
            guard original.bounds.width > available else { return }
            let attachment: NSTextAttachment
            let attrs = source.attributes(at: range.location, effectiveRange: nil)
            if let raw = attrs[.answerMathSource] as? String, let multiline = wrapped(raw, attributes: attrs, width: available) {
                attachment = multiline
            } else {
                let scale = available / original.bounds.width
                attachment = NSTextAttachment(); attachment.image = original.image
                attachment.bounds = CGRect(x: 0, y: original.bounds.minY * scale,
                    width: original.bounds.width * scale, height: original.bounds.height * scale)
            }
            result.addAttribute(.attachment, value: attachment, range: range)
            if let delegate = delegate(attachment.bounds) {
                result.addAttribute(NSAttributedString.Key(kCTRunDelegateAttributeName as String), value: delegate, range: range)
            }
        }
        return result
    }
    static func sourceText(_ text: NSAttributedString) -> String {
        let result = NSMutableString(string: text.string)
        text.enumerateAttribute(.answerMathSource, in: NSRange(location: 0, length: text.length), options: .reverse) { value, range, _ in
            if let source = value as? String { result.replaceCharacters(in: range, with: source) }
        }
        return result as String
    }
}
