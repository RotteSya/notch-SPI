// Render two original synthetic documents for quality gates, never speed acceptance.
// Usage: swift scripts/fixtures/latency-quality-boundaries.swift /tmp/<private-directory>
import AppKit

guard CommandLine.arguments.count == 2 else { fatalError("Expected one output directory") }
let directory = URL(fileURLWithPath: CommandLine.arguments[1]).standardizedFileURL
guard directory.path.hasPrefix("/tmp/") || directory.path.hasPrefix("/private/tmp/") else {
    fatalError("Quality fixtures must stay in a temporary directory")
}
try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
                                      attributes: [.posixPermissions: 0o700])

func render(_ name: String, height: Int, rows: [(String, CGFloat)]) throws {
    let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 1200, pixelsHigh: height,
                                  bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
                                  isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
    NSColor.white.setFill()
    NSRect(x: 0, y: 0, width: 1200, height: height).fill()
    let attributes: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: 29), .foregroundColor: NSColor.black]
    for (text, top) in rows {
        (text as NSString).draw(in: NSRect(x: 36, y: CGFloat(height) - top - 70, width: 1128, height: 70),
                               withAttributes: attributes)
    }
    NSGraphicsContext.restoreGraphicsState()
    let data = bitmap.representation(using: .png, properties: [:])!
    try data.write(to: directory.appendingPathComponent(name), options: .withoutOverwriting)
}

// The synthetic document continues below the visible capture: C is visibly cut and D absent.
try render("cropped-options.png", height: 330, rows: [
    ("Q1　次の計算の答えを A〜D から一つ選びなさい。", 25),
    ("17 × 3 = ?", 95), ("A. 48", 165), ("B. 50", 235), ("C. 51", 305), ("D. 54", 375)
])
try render("unsupported-essay.png", height: 450, rows: [
    ("Q1　作文", 25),
    ("あなたがこれまでに挑戦した経験を一つ選び、", 105),
    ("その経験から何を学んだかを、日本語で200字程度で", 165),
    ("自由に説明してください。", 225)
])
print("Rendered two synthetic quality fixtures; model calls: 0")
