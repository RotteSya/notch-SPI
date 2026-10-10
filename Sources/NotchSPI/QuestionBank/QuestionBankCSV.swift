import Foundation

/// RFC 4180-style reader. Quoted commas, quoted newlines and doubled quotes stay in the field.
enum QuestionBankCSV {
    static let header = ["id", "type", "language", "stem", "option_a", "option_b", "option_c", "option_d", "option_e", "option_f", "answer", "unit", "explanation", "source"]

    struct Table {
        var rows: [[String]]
        var errors: [QuestionFailure]
    }

    static func parse(_ data: Data) -> Table {
        guard var text = String(data: data, encoding: .utf8) else {
            return Table(rows: [], errors: [QuestionFailure(index: 0, itemID: nil, message: "encoding")])
        }
        if text.hasPrefix("\u{feff}") { text.removeFirst() }
        let scalars = Array(text.unicodeScalars)
        var rows: [[String]] = []
        var field = ""
        var row: [String] = []
        var quoted = false
        var index = 0
        func finishField() { row.append(field); field = "" }
        func finishRow() {
            if row.contains(where: { !$0.isEmpty }) || !field.isEmpty {
                finishField()
                rows.append(row)
            }
            row = []
        }
        while index < scalars.count {
            let scalar = scalars[index]
            if quoted {
                if scalar == "\"" {
                    if index + 1 < scalars.count, scalars[index + 1] == "\"" {
                        field.append("\"")
                        index += 2
                        continue
                    }
                    quoted = false
                    index += 1
                    continue
                }
                if scalar == "\r" || scalar == "\n" {
                    if scalar == "\r", index + 1 < scalars.count, scalars[index + 1] == "\n" { index += 1 }
                    field.append("\n")
                    index += 1
                    continue
                }
                field.unicodeScalars.append(scalar)
                index += 1
                continue
            }
            if scalar == "\"" && field.isEmpty {
                quoted = true
                index += 1
                continue
            }
            if scalar == "," {
                finishField()
                index += 1
                continue
            }
            if scalar == "\n" || scalar == "\r" {
                if scalar == "\r", index + 1 < scalars.count, scalars[index + 1] == "\n" { index += 1 }
                finishRow()
                index += 1
                continue
            }
            field.unicodeScalars.append(scalar)
            index += 1
        }
        if quoted {
            return Table(rows: [], errors: [QuestionFailure(index: rows.count + 1, itemID: nil, message: "unclosed_quote")])
        }
        if !field.isEmpty || !row.isEmpty { finishRow() }
        return Table(rows: rows, errors: [])
    }
}
