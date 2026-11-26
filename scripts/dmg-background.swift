// Renders the DMG installer window background used by scripts/package.sh.
// Usage: swift scripts/dmg-background.swift   (writes Resources/dmg/background.tiff)
// Layout constants must match the Finder layout in package.sh (660×400, icons at x=170/490, y=205).
import AppKit

let width = 660.0, height = 400.0
let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
let outDir = root.appendingPathComponent("Resources/dmg")

func rgb(_ hex: UInt32, _ alpha: CGFloat = 1) -> NSColor {
    NSColor(srgbRed: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255, alpha: alpha)
}

func render(scale: Double) -> Data {
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(width * scale), pixelsHigh: Int(height * scale),
                               bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                               colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    rep.size = NSSize(width: width, height: height)
    let ctx = NSGraphicsContext(bitmapImageRep: rep)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = ctx
    let cg = ctx.cgContext
    // Top-left origin, in points.
    cg.translateBy(x: 0, y: height)
    cg.scaleBy(x: 1, y: -1)
    NSGraphicsContext.current = NSGraphicsContext(cgContext: cg, flipped: true)
    let full = CGRect(x: 0, y: 0, width: width, height: height)

    // Base: quiet off-white wash.
    NSGradient(starting: rgb(0xFBFBFE), ending: rgb(0xEEF0F8))!.draw(in: full, angle: 90)

    // Soft brand glows behind the two icons (blue → violet, matching the app icon).
    for (x, color) in [(170.0, rgb(0x5B8CFF, 0.16)), (490.0, rgb(0xA77BFF, 0.12))] {
        NSGradient(starting: color, ending: color.withAlphaComponent(0))!
            .draw(fromCenter: NSPoint(x: x, y: 205), radius: 0, toCenter: NSPoint(x: x, y: 205), radius: 150, options: [])
    }

    // Gentle wave band below the icon labels.
    let wave = NSBezierPath()
    wave.move(to: NSPoint(x: 0, y: 342))
    wave.curve(to: NSPoint(x: 660, y: 334), controlPoint1: NSPoint(x: 220, y: 316), controlPoint2: NSPoint(x: 440, y: 360))
    wave.line(to: NSPoint(x: 660, y: 400))
    wave.line(to: NSPoint(x: 0, y: 400))
    wave.close()
    rgb(0xE4E7F3, 0.55).setFill()
    wave.fill()

    // Curved arrow from the app to Applications.
    let start = NSPoint(x: 262, y: 214), c1 = NSPoint(x: 300, y: 178), c2 = NSPoint(x: 362, y: 178), end = NSPoint(x: 398, y: 210)
    let arrow = CGMutablePath()
    arrow.move(to: start)
    arrow.addCurve(to: end, control1: c1, control2: c2)
    let angle = atan2(end.y - c2.y, end.x - c2.x)
    for side in [-1.0, 1.0] {
        let a = angle + .pi - side * .pi / 6
        arrow.move(to: end)
        arrow.addLine(to: CGPoint(x: end.x + 13 * cos(a), y: end.y + 13 * sin(a)))
    }
    cg.saveGState()
    cg.addPath(arrow.copy(strokingWithWidth: 3, lineCap: .round, lineJoin: .round, miterLimit: 10))
    cg.clip()
    let stroke = CGGradient(colorsSpace: CGColorSpace(name: CGColorSpace.sRGB),
                            colors: [rgb(0x5B8CFF).cgColor, rgb(0xA77BFF).cgColor] as CFArray, locations: [0, 1])!
    cg.drawLinearGradient(stroke, start: CGPoint(x: start.x, y: 0), end: CGPoint(x: end.x + 4, y: 0), options: [])
    cg.restoreGState()

    // Copy.
    func text(_ string: String, size: CGFloat, weight: NSFont.Weight, color: NSColor, y: CGFloat) {
        let style = NSMutableParagraphStyle()
        style.alignment = .center
        let font = NSFont(name: weight == .semibold ? "PingFangSC-Semibold" : "PingFangSC-Regular", size: size)
            ?? NSFont.systemFont(ofSize: size, weight: weight)
        let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: color, .paragraphStyle: style, .kern: 0.3]
        NSAttributedString(string: string, attributes: attrs).draw(in: NSRect(x: 0, y: y, width: width, height: size * 1.6))
    }
    text("把 NotchSPI 拖到「应用程序」", size: 22, weight: .semibold, color: rgb(0x1C1C28), y: 52)
    text("复制完成后，从「应用程序」打开 NotchSPI", size: 13, weight: .regular, color: rgb(0x7D7F90), y: 358)

    NSGraphicsContext.restoreGraphicsState()
    return rep.representation(using: .png, properties: [:])!
}

try FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)
let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("notchspi-dmg-bg-\(getpid())")
try FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
defer { try? FileManager.default.removeItem(at: tmp) }
let one = tmp.appendingPathComponent("background.png"), two = tmp.appendingPathComponent("background@2x.png")
try render(scale: 1).write(to: one)
try render(scale: 2).write(to: two)
// Multi-resolution TIFF so Finder picks the sharp version on Retina displays.
let tiffutil = Process()
tiffutil.executableURL = URL(fileURLWithPath: "/usr/bin/tiffutil")
tiffutil.arguments = ["-cathidpicheck", one.path, two.path, "-out", outDir.appendingPathComponent("background.tiff").path]
try tiffutil.run()
tiffutil.waitUntilExit()
guard tiffutil.terminationStatus == 0 else { fatalError("tiffutil failed") }
print("wrote \(outDir.appendingPathComponent("background.tiff").path)")
