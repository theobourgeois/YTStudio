#if defined(_WIN32)
 #ifndef NOMINMAX
  #define NOMINMAX
 #endif
 #ifndef WIN32_LEAN_AND_MEAN
  #define WIN32_LEAN_AND_MEAN
 #endif
 #include <windows.h>
#endif

#include "MacWindow.h"

#if JUCE_MAC
#include <objc/message.h>
#include <objc/runtime.h>

void keepOutOfWindowSwitchers (juce::Component& window)
{
    auto* peer = window.getPeer();
    if (peer == nullptr)
        return;
    // The Objective-C runtime from plain C++ (no .mm file): view.window, then window.collectionBehavior |= ...
    auto* view = static_cast<id> (peer->getNativeHandle());
    if (view == nullptr)
        return;
    using Get = id (*) (id, SEL);
    using GetBits = unsigned long (*) (id, SEL);
    using SetBits = void (*) (id, SEL, unsigned long);
    auto* nsWindow = reinterpret_cast<Get> (objc_msgSend) (view, sel_registerName ("window"));
    if (nsWindow == nullptr)
        return;
    constexpr unsigned long transient = 1 << 3;    // NSWindowCollectionBehaviorTransient: not shown by Mission Control
    constexpr unsigned long ignoresCycle = 1 << 6; // NSWindowCollectionBehaviorIgnoresCycle: skipped by Cmd-`
    const auto now = reinterpret_cast<GetBits> (objc_msgSend) (nsWindow, sel_registerName ("collectionBehavior"));
    reinterpret_cast<SetBits> (objc_msgSend) (nsWindow, sel_registerName ("setCollectionBehavior:"), now | transient | ignoresCycle);
}
#else
void keepOutOfWindowSwitchers (juce::Component&) {}
#endif

#if JUCE_WINDOWS
void* appWindowFromHandle (const juce::String& handle)
{
    if (handle.isEmpty() || ! handle.containsOnly ("0123456789"))
        return nullptr;
    auto* window = reinterpret_cast<HWND> (static_cast<uintptr_t> (handle.getLargeIntValue()));
    return IsWindow (window) ? window : nullptr;
}

void setWindowOwner (juce::Component& window, void* owner)
{
    auto* peer = window.getPeer();
    if (peer == nullptr)
        return;
    auto* hwnd = static_cast<HWND> (peer->getNativeHandle());
    if (hwnd == nullptr)
        return;
    // GWLP_HWNDPARENT is the owner for a top-level window (not a parent: it stays a window of its own).
    if (reinterpret_cast<HWND> (GetWindowLongPtrW (hwnd, GWLP_HWNDPARENT)) != owner)
        SetWindowLongPtrW (hwnd, GWLP_HWNDPARENT, reinterpret_cast<LONG_PTR> (owner));
}

namespace
{
KeyHook keyHandler;
HHOOK keyHook = nullptr;

/** JUCE's name for a virtual key (as its own Windows peer makes them), or 0 for one it has no use for here. */
int juceKeyCode (WPARAM vk)
{
    if (vk == VK_SPACE) return juce::KeyPress::spaceKey;
    if (vk >= VK_F1 && vk <= VK_F12) return juce::KeyPress::F1Key + (int) (vk - VK_F1);
    if (vk == VK_UP) return juce::KeyPress::upKey;
    if (vk == VK_DOWN) return juce::KeyPress::downKey;
    if (vk == VK_LEFT) return juce::KeyPress::leftKey;
    if (vk == VK_RIGHT) return juce::KeyPress::rightKey;
    if (vk == VK_DELETE) return juce::KeyPress::deleteKey;
    if (vk == VK_BACK) return juce::KeyPress::backspaceKey;
    if (vk == VK_RETURN) return juce::KeyPress::returnKey;
    if (vk == VK_ESCAPE) return juce::KeyPress::escapeKey;
    if ((vk >= 'A' && vk <= 'Z') || (vk >= '0' && vk <= '9')) return (int) vk;
    // , . ; / [ ] as the layout types them (the page names them by character too: `describeKey`).
    if (vk >= VK_OEM_1 && vk <= VK_OEM_8)
        if (const auto c = (int) (MapVirtualKeyW ((UINT) vk, MAPVK_VK_TO_CHAR) & 0x7fff); c > 0 && c < 128)
            return c;
    return 0;
}

LRESULT CALLBACK onThreadKey (int code, WPARAM vk, LPARAM info)
{
    // HC_ACTION: a key message taken off the queue (not merely peeked at: HC_NOREMOVE).
    if (code == HC_ACTION && keyHandler != nullptr)
        if (const auto keyCode = juceKeyCode (vk); keyCode != 0)
        {
            const auto down = (info & (1u << 31)) == 0;
            const auto repeat = down && (info & (1 << 30)) != 0;
            int mods = 0;
            if (GetKeyState (VK_SHIFT) < 0) mods |= juce::ModifierKeys::shiftModifier;
            if (GetKeyState (VK_CONTROL) < 0) mods |= juce::ModifierKeys::ctrlModifier;
            if (GetKeyState (VK_MENU) < 0) mods |= juce::ModifierKeys::altModifier;
            auto* focus = GetFocus();
            auto* root = focus != nullptr ? GetAncestor (focus, GA_ROOT) : nullptr;
            if (root != nullptr && keyHandler (root, juce::KeyPress (keyCode, juce::ModifierKeys (mods), 0), down, repeat))
                return 1;
        }
    return CallNextHookEx (keyHook, code, vk, info);
}
} // namespace

void hookThreadKeys (KeyHook handler)
{
    keyHandler = std::move (handler);
    if (keyHook == nullptr)
        keyHook = SetWindowsHookExW (WH_KEYBOARD, onThreadKey, nullptr, GetCurrentThreadId());
}

void* nativeWindowOf (juce::Component& window)
{
    auto* peer = window.getPeer();
    return peer != nullptr ? peer->getNativeHandle() : nullptr;
}

namespace
{
/**
 * Windows 11 treats a program without a visible window as background work: its threads may be slowed
 * down on efficiency cores (EcoQoS) and its timer resolution request ignored. The engine rarely has a
 * window, yet its audio has to keep up (the device's thread has MMCSS from JUCE, but the readers that
 * stream audio clips and previews ahead, the message thread that prepares them and the 40 ms transport
 * timer don't), so it opts out of both, as soon as it starts.
 */
[[maybe_unused]] const bool keptResponsive = [] {
    PROCESS_POWER_THROTTLING_STATE state {};
    state.Version = PROCESS_POWER_THROTTLING_CURRENT_VERSION;
    // Controlled, and off: never throttled.
    state.ControlMask = PROCESS_POWER_THROTTLING_EXECUTION_SPEED | PROCESS_POWER_THROTTLING_IGNORE_TIMER_RESOLUTION;
    state.StateMask = 0;
    if (SetProcessInformation (GetCurrentProcess(), ProcessPowerThrottling, &state, sizeof (state)))
        return true;
    // Windows 10 knows only the first.
    state.ControlMask = PROCESS_POWER_THROTTLING_EXECUTION_SPEED;
    return SetProcessInformation (GetCurrentProcess(), ProcessPowerThrottling, &state, sizeof (state)) != FALSE;
}();

/**
 * Above the browser's processes: the message thread prepares audio clips' streams and plugins' loads ahead
 * of the audio thread, and a busy page (a heavy redraw, an export's compositor) shouldn't starve it.
 * Not realtime: a plugin spinning must never freeze the computer.
 */
[[maybe_unused]] const bool raisedPriority = SetPriorityClass (GetCurrentProcess(), ABOVE_NORMAL_PRIORITY_CLASS) != FALSE;
}

void keepAwake (bool playing)
{
    // Windows' audio keeps a PC awake while it plays; an ASIO driver doesn't, so a song left playing
    // would stop when the computer went to sleep. Called on the message thread, whose state it is.
    SetThreadExecutionState (playing ? (ES_CONTINUOUS | ES_SYSTEM_REQUIRED) : ES_CONTINUOUS);
}
#else
void* appWindowFromHandle (const juce::String&) { return nullptr; }
void setWindowOwner (juce::Component&, void*) {}
void hookThreadKeys (KeyHook) {}
void* nativeWindowOf (juce::Component& window)
{
    auto* peer = window.getPeer();
    return peer != nullptr ? peer->getNativeHandle() : nullptr;
}
void keepAwake (bool) {}
#endif
