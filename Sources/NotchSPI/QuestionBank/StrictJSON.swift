import Foundation

/// JSON parser that rejects duplicate object keys. Foundation's JSONSerialization keeps the last
/// duplicate, which would let a question package silently change an answer.
enum StrictJSON {
    enum Value {
        case object([(String, Value)])
        case array([Value])
        case string(String)
        case int(Int)
        case double(Double)
        case bool(Bool)
        case null

        var object: [(String, Value)]? {
            if case .object(let pairs) = self { return pairs }
            return nil
        }

        func field(_ key: String) -> Value? {
            object?.first { $0.0 == key }?.1
        }

        static func == (lhs: Value, rhs: Value) -> Bool {
            switch (lhs, rhs) {
            case (.object(let left), .object(let right)):
                guard left.count == right.count else { return false }
                return zip(left, right).allSatisfy { $0.0 == $1.0 && $0.1 == $1.1 }
            case (.array(let left), .array(let right)):
                return left == right
            case (.string(let left), .string(let right)):
                return left == right
            case (.int(let left), .int(let right)):
                return left == right
            case (.double(let left), .double(let right)):
                return left == right
            case (.bool(let left), .bool(let right)):
                return left == right
            case (.null, .null):
                return true
            default:
                return false
            }
        }

        var string: String? { if case .string(let value) = self { return value }; return nil }
        var int: Int? { if case .int(let value) = self { return value }; return nil }
        var array: [Value]? { if case .array(let value) = self { return value }; return nil }
        var bool: Bool? { if case .bool(let value) = self { return value }; return nil }
    }

    enum ParseError: Error, Equatable {
        case malformed
        case duplicateKey(String)
    }

    static func parse(_ data: Data) throws -> Value {
        guard var text = String(data: data, encoding: .utf8) else { throw ParseError.malformed }
        if text.hasPrefix("\u{feff}") { text.removeFirst() }
        var parser = Parser(text)
        let value = try parser.parseValue()
        try parser.skipWhitespace()
        guard parser.done else { throw ParseError.malformed }
        return value
    }

    private struct Parser {
        let characters: [Character]
        var index = 0
        var done: Bool { index >= characters.count }
        init(_ text: String) { characters = Array(text) }

        mutating func parseValue() throws -> Value {
            try skipWhitespace()
            guard let c = peek() else { throw ParseError.malformed }
            switch c {
            case "{": return try parseObject()
            case "[": return try parseArray()
            case "\"": return .string(try parseString())
            case "t": try consumeLiteral("true"); return .bool(true)
            case "f": try consumeLiteral("false"); return .bool(false)
            case "n": try consumeLiteral("null"); return .null
            default: return try parseNumber()
            }
        }

        mutating func parseObject() throws -> Value {
            try expect("{")
            try skipWhitespace()
            var pairs: [(String, Value)] = []
            var seen = Set<String>()
            if peek() == "}" { index += 1; return .object(pairs) }
            while true {
                try skipWhitespace()
                guard peek() == "\"" else { throw ParseError.malformed }
                let key = try parseString()
                guard seen.insert(key).inserted else { throw ParseError.duplicateKey(key) }
                try skipWhitespace()
                try expect(":")
                let value = try parseValue()
                pairs.append((key, value))
                try skipWhitespace()
                if peek() == "," { index += 1; continue }
                if peek() == "}" { index += 1; break }
                throw ParseError.malformed
            }
            return .object(pairs)
        }

        mutating func parseArray() throws -> Value {
            try expect("[")
            try skipWhitespace()
            var items: [Value] = []
            if peek() == "]" { index += 1; return .array(items) }
            while true {
                items.append(try parseValue())
                try skipWhitespace()
                if peek() == "," { index += 1; continue }
                if peek() == "]" { index += 1; break }
                throw ParseError.malformed
            }
            return .array(items)
        }

        mutating func parseString() throws -> String {
            try expect("\"")
            var out = ""
            while let c = peek() {
                index += 1
                if c == "\"" { return out }
                if c == "\\" {
                    guard let esc = peek() else { throw ParseError.malformed }
                    index += 1
                    switch esc {
                    case "\"", "\\", "/": out.append(esc)
                    case "b": out.append("\u{08}")
                    case "f": out.append("\u{0c}")
                    case "n": out.append("\n")
                    case "r": out.append("\r")
                    case "t": out.append("\t")
                    case "u":
                        let hex = try takeHex()
                        guard let scalar = Unicode.Scalar(hex) else { throw ParseError.malformed }
                        out.append(Character(scalar))
                    default: throw ParseError.malformed
                    }
                } else if c.unicodeScalars.contains(where: { $0.value < 0x20 }) {
                    throw ParseError.malformed
                } else {
                    out.append(c)
                }
            }
            throw ParseError.malformed
        }

        mutating func parseNumber() throws -> Value {
            let start = index
            if peek() == "-" { index += 1 }
            guard let first = peek(), first.isNumber else { throw ParseError.malformed }
            if first == "0" {
                index += 1
            } else {
                while peek()?.isNumber == true { index += 1 }
            }
            var fractional = false
            if peek() == "." {
                fractional = true
                index += 1
                guard peek()?.isNumber == true else { throw ParseError.malformed }
                while peek()?.isNumber == true { index += 1 }
            }
            if peek() == "e" || peek() == "E" {
                fractional = true
                index += 1
                if peek() == "+" || peek() == "-" { index += 1 }
                guard peek()?.isNumber == true else { throw ParseError.malformed }
                while peek()?.isNumber == true { index += 1 }
            }
            let token = String(characters[start..<index])
            if !fractional, let int = Int(token) { return .int(int) }
            guard let double = Double(token) else { throw ParseError.malformed }
            return .double(double)
        }

        mutating func takeHex() throws -> UInt32 {
            var value: UInt32 = 0
            for _ in 0..<4 {
                guard let c = peek() else { throw ParseError.malformed }
                index += 1
                let digit: UInt32
                switch c {
                case "0"..."9": digit = UInt32(c.unicodeScalars.first!.value - 48)
                case "a"..."f": digit = UInt32(c.unicodeScalars.first!.value - 87)
                case "A"..."F": digit = UInt32(c.unicodeScalars.first!.value - 55)
                default: throw ParseError.malformed
                }
                value = value * 16 + digit
            }
            return value
        }

        mutating func consumeLiteral(_ literal: String) throws {
            for character in literal {
                guard peek() == character else { throw ParseError.malformed }
                index += 1
            }
        }

        mutating func skipWhitespace() throws {
            while let c = peek(), c == " " || c == "\n" || c == "\r" || c == "\t" { index += 1 }
        }

        mutating func expect(_ character: Character) throws {
            guard peek() == character else { throw ParseError.malformed }
            index += 1
        }

        func peek() -> Character? { index < characters.count ? characters[index] : nil }
    }
}

extension StrictJSON.Value: Equatable {}
