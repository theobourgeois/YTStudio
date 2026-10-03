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
} else if args[1] == "drag" || args[1] == "press" || args[1] == "release" {
    // drag x1 y1 x2 y2 [steps]: press at the start, move in steps, release at the end.
    guard AXIsProcessTrusted() else { fatalError("Accessibility access is required for native clicks") }
    func post(_ type: CGEventType, _ x: Double, _ y: Double) {
        CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: CGPoint(x: x, y: y), mouseButton: .left)?.post(tap: .cghidEventTap)
    }
    let x1 = Double(args[2])!, y1 = Double(args[3])!
    if args[1] == "drag" {
        let x2 = Double(args[4])!, y2 = Double(args[5])!
        let steps = args.count > 6 ? Int(args[6])! : 20
        post(.leftMouseDown, x1, y1)
        usleep(80000)
        for i in 1...steps {
            let t = Double(i) / Double(steps)
            post(.leftMouseDragged, x1 + (x2 - x1) * t, y1 + (y2 - y1) * t)
            usleep(16000)
        }
        usleep(80000)
        post(.leftMouseUp, x2, y2)
    } else if args[1] == "press" {
        post(.leftMouseDown, x1, y1)
    } else {
        post(.leftMouseUp, x1, y1)
    }
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
