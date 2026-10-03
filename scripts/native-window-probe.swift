// The desktop focus smoke test uses real macOS clicks and the Window Server's stacking order.
import AppKit
import ApplicationServices

let args = CommandLine.arguments
if args[1] == "click" {
    guard AXIsProcessTrusted() else { fatalError("Accessibility access is required for native clicks") }
    let point = CGPoint(x: Double(args[2])!, y: Double(args[3])!)
    CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
    usleep(80000)
    CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
} else if args[1] == "move" {
    let app = AXUIElementCreateApplication(Int32(args[2])!)
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(app, kAXWindowsAttribute as CFString, &value) == .success,
          let windows = value as? [AXUIElement], let window = windows.first else { fatalError("No native window") }
    var point = CGPoint(x: Double(args[3])!, y: Double(args[4])!)
    let position = AXValueCreate(.cgPoint, &point)!
    guard AXUIElementSetAttributeValue(window, kAXPositionAttribute as CFString, position) == .success else { fatalError("Couldn't move native window") }
} else {
    let pids = Set(args.dropFirst(2).compactMap { Int($0) })
    let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
    let matching = windows.filter { pids.contains($0[kCGWindowOwnerPID as String] as? Int ?? -1) }
    let result: [String: Any] = ["trusted": AXIsProcessTrusted(), "front": NSWorkspace.shared.frontmostApplication?.processIdentifier ?? -1, "windows": matching]
    print(String(data: try! JSONSerialization.data(withJSONObject: result), encoding: .utf8)!)
}
