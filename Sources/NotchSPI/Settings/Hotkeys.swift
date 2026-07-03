import AppKit
import Carbon.HIToolbox

/// Global hotkeys via Carbon RegisterEventHotKey (no Accessibility permission needed).
final class HotKeyCenter {
    static let shared = HotKeyCenter()

    private var handlers: [UInt32: () -> Void] = [:]
    private var nextID: UInt32 = 1
    private var installed = false
    private var refs: [EventHotKeyRef?] = []

    /// keyCode: Carbon virtual key (e.g. kVK_ANSI_1, kVK_Space).
    /// modifiers: Carbon mask (cmdKey, shiftKey, …).
    func register(keyCode: UInt32, modifiers: UInt32, handler: @escaping () -> Void) {
        installHandlerIfNeeded()
        let id = nextID
        nextID += 1
        handlers[id] = handler
        var ref: EventHotKeyRef?
        let hotKeyID = EventHotKeyID(signature: OSType(0x4E544348), id: id) // 'NTCH'
        let status = RegisterEventHotKey(keyCode, modifiers, hotKeyID, GetApplicationEventTarget(), 0, &ref)
        if status != noErr {
            NSLog("[NotchSPI] hotkey registration failed (status=\(status)); combo may be taken by another app")
        }
        refs.append(ref)
    }

    func unregisterAll() {
        for ref in refs where ref != nil {
            UnregisterEventHotKey(ref)
        }
        refs.removeAll()
        handlers.removeAll()
        nextID = 1
    }

    private func installHandlerIfNeeded() {
        guard !installed else { return }
        installed = true
        var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        let selfPtr = Unmanaged.passUnretained(self).toOpaque()
        InstallEventHandler(
            GetApplicationEventTarget(),
            { (_, event, userData) -> OSStatus in
                guard let event, let userData else { return noErr }
                var hkID = EventHotKeyID()
                GetEventParameter(
                    event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID),
                    nil, MemoryLayout<EventHotKeyID>.size, nil, &hkID
                )
                let center = Unmanaged<HotKeyCenter>.fromOpaque(userData).takeUnretainedValue()
                if let h = center.handlers[hkID.id] {
                    DispatchQueue.main.async { h() }
                }
                return noErr
            },
            1, &spec, selfPtr, nil
        )
    }
}
