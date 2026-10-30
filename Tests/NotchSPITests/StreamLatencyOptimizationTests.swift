import XCTest
@testable import NotchSPI

final class StreamLatencyOptimizationTests: XCTestCase {
    // Frozen pre-optimization implementation: compare every intermediate visible value,
    // including invalid protocol, rather than merely checking the final answer.
    private func reference(_ raw: String) -> String {
        let normalized = raw.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
        let lines = normalized.components(separatedBy: "\n")
        return lines.enumerated().compactMap { index, line -> String? in
            let markers = [ObjectiveResultParser.marker, "NSPI_NO_RESULT_V1:"]
            if markers.contains(where: { line.contains($0) }) { return nil }
            if !normalized.hasSuffix("\n") && index == lines.count - 1 {
                let candidate = line.drop(while: { $0 == " " || $0 == "\t" })
                if !candidate.isEmpty && markers.contains(where: { $0.hasPrefix(String(candidate)) }) { return nil }
            }
            return line
        }.joined(separator: "\n")
    }

    func testEveryChunkMatchesOriginalFilteringAndValidation() {
        let cases = [
            "推理🙂e\u{301}\r\nFINAL: B\r\nNSPI_RESULT_V1: {\"v\":1}\n",
            "\n\nNSPI_NO_RESULT_V1: {}\r\n\r\nFINAL: A\n",
            "prefix NSPI_RESULT_V1: {}\n  NSPI_\rhello\nFINAL: C",
            "NSPI_RESULT_V1: {}\nNSPI_RESULT_V1: {}\ntrailing",
            "  NSPI_NO_RESULT_V1:\nFINAL: B\r\n", "", "\r\n\r\r\n"
        ]
        for source in cases {
            // Unicode scalars intentionally split CR/LF and combining character sequences.
            let units = source.unicodeScalars.map(String.init)
            for size in 1...17 {
                var filter = ObjectiveResultStreamFilter(), raw = ""
                for offset in stride(from: 0, to: units.count, by: size) {
                    let chunk = units[offset..<min(offset + size, units.count)].joined()
                    raw += chunk
                    XCTAssertEqual(filter.append(chunk), reference(raw), "size=\(size), source=\(source)")
                    XCTAssertEqual(filter.append(""), reference(raw))
                }
                XCTAssertEqual(filter.finish(), ObjectiveResultParser.compose(raw: source))
            }
        }
    }

    func testOverflowFailsClosedAndFreshRequestIsIndependent() {
        var filter = ObjectiveResultStreamFilter()
        XCTAssertEqual(filter.append(String(repeating: "a", count: 65_536)).count, 65_536)
        XCTAssertEqual(filter.append("b"), "")
        XCTAssertEqual(filter.append("FINAL: A"), "")
        XCTAssertNil(filter.finish().finalAnswer)
        var fresh = ObjectiveResultStreamFilter()
        XCTAssertEqual(fresh.append("FINAL: B"), "FINAL: B")
    }

    func testFilterBenchmark() throws {
        guard ProcessInfo.processInfo.environment["NSPI_FILTER_BENCHMARK"] == "1" else {
            throw XCTSkip("Opt-in local CPU benchmark")
        }
        let source = String(repeating: "A calculation line with units and context.\n", count: 300) + "FINAL: B\nNSPI_RESULT_V1: {}"
        let chars = Array(source)
        let chunks = stride(from: 0, to: chars.count, by: 16).map { String(chars[$0..<min($0 + 16, chars.count)]) }
        for sample in 0..<12 {
            var baseline = 0.0, optimized = 0.0
            func old() {
                var raw = "", output = ""
                let start = ProcessInfo.processInfo.systemUptime
                for chunk in chunks { raw += chunk; output = reference(raw) }
                baseline = (ProcessInfo.processInfo.systemUptime - start) * 1000
                XCTAssertEqual(output, reference(source))
            }
            func new() {
                var filter = ObjectiveResultStreamFilter(), output = ""
                let start = ProcessInfo.processInfo.systemUptime
                for chunk in chunks { output = filter.append(chunk) }
                optimized = (ProcessInfo.processInfo.systemUptime - start) * 1000
                XCTAssertEqual(output, reference(source))
            }
            if sample.isMultiple(of: 2) { old(); new() } else { new(); old() }
            print("FILTER_BENCH sample=\(sample) bytes=\(source.utf8.count) chunks=\(chunks.count) before_ms=\(baseline) after_ms=\(optimized)")
        }
    }
}
