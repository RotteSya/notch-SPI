// Used only by the Electron development host on macOS. Native Mac uses ScreenCaptureKit.
import CoreGraphics
import Foundation
if let id = CommandLine.arguments.last.flatMap(UInt32.init),
   let rows = CGWindowListCopyWindowInfo(.optionIncludingWindow, id) as? [[String: Any]],
   let row = rows.first, let bounds = row[kCGWindowBounds as String] as? [String: Any],
   let rect = CGRect(dictionaryRepresentation: bounds as CFDictionary),
   let data = try? JSONSerialization.data(withJSONObject: [rect.minX, rect.minY, rect.width, rect.height]) {
    print(String(decoding: data, as: UTF8.self))
}
