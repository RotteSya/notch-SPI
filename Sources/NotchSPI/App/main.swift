import AppKit

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
// Accessory: no Dock icon, lives at the notch like a menu-bar app.
app.setActivationPolicy(.accessory)
app.run()
