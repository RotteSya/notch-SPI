import AppKit

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var controller: NotchController?

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Even though this is an accessory app with no persistent menu bar, AppKit dispatches the
        // standard editing shortcuts (⌘X/⌘C/⌘V/⌘A/⌘Z) through the main menu's key equivalents. Without
        // a main menu, the text fields in the settings / 人物像 windows can't cut, copy, or paste.
        NSApp.mainMenu = Self.makeMainMenu()

        let controller = NotchController()
        controller.show()
        self.controller = controller
    }

    private static func makeMainMenu() -> NSMenu {
        let mainMenu = NSMenu()

        // The first submenu is treated as the application menu regardless of title.
        let appItem = NSMenuItem()
        mainMenu.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "退出 NotchSPI", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu

        // Edit menu — routes clipboard / selection / undo to whichever text field is first responder.
        let editItem = NSMenuItem()
        mainMenu.addItem(editItem)
        let editMenu = NSMenu(title: "编辑")
        editMenu.addItem(withTitle: "撤销", action: Selector(("undo:")), keyEquivalent: "z")
        let redo = editMenu.addItem(withTitle: "重做", action: Selector(("redo:")), keyEquivalent: "z")
        redo.keyEquivalentModifierMask = [.command, .shift]
        editMenu.addItem(.separator())
        editMenu.addItem(withTitle: "剪切", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "拷贝", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "粘贴", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "全选", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = editMenu

        return mainMenu
    }
}
