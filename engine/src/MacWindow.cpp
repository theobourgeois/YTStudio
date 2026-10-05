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
void keepAwake (bool) {}
#endif
