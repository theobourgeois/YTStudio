#if defined(_WIN32)
 #ifndef NOMINMAX
  #define NOMINMAX
 #endif
 #ifndef WIN32_LEAN_AND_MEAN
  #define WIN32_LEAN_AND_MEAN
 #endif
 #include <windows.h>
 #include <dwmapi.h>
 #include <ole2.h>
 #include <shlobj.h>
 #include <shobjidl.h>
 #pragma comment(lib, "dwmapi.lib")
 #pragma comment(lib, "ole32.lib")
 #pragma comment(lib, "shell32.lib")
 #pragma comment(lib, "uuid.lib")
#endif

#include "MacWindow.h"

#include <vector>

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

juce::Rectangle<int> nativeFrameOf (juce::Component& window)
{
    RECT frame;
    if (auto* hwnd = static_cast<HWND> (nativeWindowOf (window)); hwnd != nullptr && GetWindowRect (hwnd, &frame))
        return { frame.left, frame.top, frame.right - frame.left, frame.bottom - frame.top };
    return {};
}

void moveWindowBy (juce::Component& window, juce::Point<int> delta)
{
    RECT frame;
    if (auto* hwnd = static_cast<HWND> (nativeWindowOf (window)); hwnd != nullptr && GetWindowRect (hwnd, &frame))
        SetWindowPos (hwnd, nullptr, frame.left + delta.x, frame.top + delta.y, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_NOOWNERZORDER);
}

void cloakWindow (juce::Component& window, bool cloaked)
{
    if (auto* hwnd = static_cast<HWND> (nativeWindowOf (window)))
    {
        const BOOL on = cloaked ? TRUE : FALSE;
        DwmSetWindowAttribute (hwnd, DWMWA_CLOAK, &on, sizeof (on));
    }
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
#if JUCE_MAC
void setWindowOwner (juce::Component& window, void* owner)
{
    // macOS's owned windows are child windows: above their parent only, moved and minimised with it.
    auto* peer = window.getPeer();
    if (peer == nullptr || peer->getNativeHandle() == nullptr)
        return;
    using Get = id (*) (id, SEL);
    using Set = void (*) (id, SEL, id);
    using Add = void (*) (id, SEL, id, long);
    const auto get = reinterpret_cast<Get> (objc_msgSend);
    auto* child = get (static_cast<id> (peer->getNativeHandle()), sel_registerName ("window"));
    // `owner` is the shell's view (`nativeWindowOf`): its window is the parent.
    auto* parent = owner != nullptr ? get (static_cast<id> (owner), sel_registerName ("window")) : nullptr;
    auto* current = child != nullptr ? get (child, sel_registerName ("parentWindow")) : nullptr;
    if (child == nullptr || current == parent)
        return;
    if (current != nullptr)
        reinterpret_cast<Set> (objc_msgSend) (current, sel_registerName ("removeChildWindow:"), child);
    constexpr long above = 1; // NSWindowAbove
    if (parent != nullptr)
        reinterpret_cast<Add> (objc_msgSend) (parent, sel_registerName ("addChildWindow:ordered:"), child, above);
}
#else
void setWindowOwner (juce::Component&, void*) {}
#endif
void hookThreadKeys (KeyHook) {}
void* nativeWindowOf (juce::Component& window)
{
    auto* peer = window.getPeer();
    return peer != nullptr ? peer->getNativeHandle() : nullptr;
}
juce::Rectangle<int> nativeFrameOf (juce::Component&) { return {}; }
void moveWindowBy (juce::Component&, juce::Point<int>) {}
void cloakWindow (juce::Component&, bool) {}
void keepAwake (bool) {}
#endif

#if JUCE_MAC
namespace
{
struct DropPoint { double x, y; };
struct DropRect { DropPoint origin, size; };

template <typename Result, typename... Args>
Result send (id target, const char* selector, Args... args)
{
    return reinterpret_cast<Result (*) (id, SEL, Args...)> (objc_msgSend) (target, sel_registerName (selector), args...);
}

DropRect boundsOf (id view)
{
   #if defined(__x86_64__)
    DropRect rect;
    reinterpret_cast<void (*) (DropRect*, id, SEL)> (objc_msgSend_stret) (&rect, view, sel_registerName ("bounds"));
    return rect;
   #else
    return send<DropRect> (view, "bounds");
   #endif
}

DropRect windowFrameOf (id window)
{
   #if defined(__x86_64__)
    DropRect rect;
    reinterpret_cast<void (*) (DropRect*, id, SEL)> (objc_msgSend_stret) (&rect, window, sel_registerName ("frame"));
    return rect;
   #else
    return send<DropRect> (window, "frame");
   #endif
}

id nsString (const juce::String& text) { return send<id> ((id) objc_getClass ("NSString"), "stringWithUTF8String:", text.toRawUTF8()); }

id nsArray (const std::vector<id>& items)
{
    return send<id> ((id) objc_getClass ("NSArray"), "arrayWithObjects:count:", items.data(), (unsigned long) items.size());
}

bool respondsTo (id object, const char* selector) { return send<BOOL> (object, "respondsToSelector:", sel_registerName (selector)); }

// What the drop's NSDraggingInfo says: one drop at a time, on the message thread.
id dropPasteboard = nullptr;
id dropWindow = nullptr;
DropPoint dropLocation {};

/** An object that answers as NSDraggingInfo does, made once with the Objective-C runtime. */
Class draggingInfoClass()
{
    static Class made = [] {
        auto* cls = objc_allocateClassPair (objc_getClass ("NSObject"), "VaudioDraggingInfo", 0);
        class_addMethod (cls, sel_registerName ("draggingPasteboard"), (IMP) +[] (id, SEL) { return dropPasteboard; }, "@@:");
        class_addMethod (cls, sel_registerName ("draggingLocation"), (IMP) +[] (id, SEL) { return dropLocation; }, "{CGPoint=dd}@:");
        class_addMethod (cls, sel_registerName ("draggedImageLocation"), (IMP) +[] (id, SEL) { return dropLocation; }, "{CGPoint=dd}@:");
        class_addMethod (cls, sel_registerName ("draggingDestinationWindow"), (IMP) +[] (id, SEL) { return dropWindow; }, "@@:");
        class_addMethod (cls, sel_registerName ("draggingSourceOperationMask"), (IMP) +[] (id, SEL) { return (unsigned long) 0xffffffffffffffffull; }, "Q@:");
        class_addMethod (cls, sel_registerName ("draggingSource"), (IMP) +[] (id, SEL) { return (id) nullptr; }, "@@:");
        class_addMethod (cls, sel_registerName ("draggedImage"), (IMP) +[] (id, SEL) { return (id) nullptr; }, "@@:");
        class_addMethod (cls, sel_registerName ("draggingSequenceNumber"), (IMP) +[] (id, SEL) { return (long) 1; }, "q@:");
        class_addMethod (cls, sel_registerName ("numberOfValidItemsForDrop"), (IMP) +[] (id, SEL) { return (long) 1; }, "q@:");
        class_addMethod (cls, sel_registerName ("setNumberOfValidItemsForDrop:"), (IMP) +[] (id, SEL, long) {}, "v@:q");
        class_addMethod (cls, sel_registerName ("draggingFormation"), (IMP) +[] (id, SEL) { return (long) 0; }, "q@:");
        class_addMethod (cls, sel_registerName ("setDraggingFormation:"), (IMP) +[] (id, SEL, long) {}, "v@:q");
        class_addMethod (cls, sel_registerName ("animatesToDestination"), (IMP) +[] (id, SEL) { return (BOOL) NO; }, "B@:");
        class_addMethod (cls, sel_registerName ("setAnimatesToDestination:"), (IMP) +[] (id, SEL, BOOL) {}, "v@:B");
        class_addMethod (cls, sel_registerName ("springLoadingHighlight"), (IMP) +[] (id, SEL) { return (long) 0; }, "q@:");
        class_addMethod (cls, sel_registerName ("resetSpringLoading"), (IMP) +[] (id, SEL) {}, "v@:");
        class_addMethod (cls, sel_registerName ("enumerateDraggingItemsWithOptions:forView:classes:searchOptions:usingBlock:"),
                         (IMP) +[] (id, SEL, unsigned long, id, id, id, id) {}, "v@:Q@@@@");
        // Anything else asked of it (AppKit's private questions) answers nothing, rather than throwing.
        class_addMethod (cls, sel_registerName ("methodSignatureForSelector:"), (IMP) +[] (id, SEL, SEL) {
            return send<id> ((id) objc_getClass ("NSMethodSignature"), "signatureWithObjCTypes:", "@@:");
        }, "@@::");
        class_addMethod (cls, sel_registerName ("forwardInvocation:"), (IMP) +[] (id, SEL, id) {}, "v@:@");
        if (auto* protocol = objc_getProtocol ("NSDraggingInfo"))
            class_addProtocol (cls, protocol);
        objc_registerClassPair (cls);
        return cls;
    }();
    return made;
}

/** The deepest view under `view` that isn't JUCE's or AppKit's and takes drops: the plugin's own. */
id pluginDropView (id view, juce::StringArray& seen)
{
    const juce::String name (object_getClassName (view));
    seen.add (name);
    auto* subviews = send<id> (view, "subviews");
    for (unsigned long i = 0, count = send<unsigned long> (subviews, "count"); i < count; ++i)
        if (auto* found = pluginDropView (send<id> (subviews, "objectAtIndex:", i), seen))
            return found;
    const auto ours = name.startsWithIgnoreCase ("juce") || name.startsWith ("NS") || name.startsWith ("_NS");
    return ! ours && respondsTo (view, "performDragOperation:") ? view : nullptr;
}
} // namespace

void ignoreMouse (juce::Component& window)
{
    if (auto* peer = window.getPeer())
        if (auto* nsWindow = send<id> (static_cast<id> (peer->getNativeHandle()), "window"))
            send<void> (nsWindow, "setIgnoresMouseEvents:", (BOOL) YES);
}

juce::var dropFiles (juce::Component& window, const juce::StringArray& files, double x, double y, bool perform)
{
    auto* peer = window.getPeer();
    if (peer == nullptr || files.isEmpty())
        return "The window isn't on the screen, or there are no files.";
    juce::StringArray seen;
    auto* view = pluginDropView (static_cast<id> (peer->getNativeHandle()), seen);
    if (view == nullptr)
        return "No view in the window takes drops (views: " + seen.joinIntoString (", ") + ").";

    const auto bounds = boundsOf (view);
    const auto flipped = send<BOOL> (view, "isFlipped");
    const DropPoint inView { bounds.origin.x + x * bounds.size.x, bounds.origin.y + (flipped ? y : 1.0 - y) * bounds.size.y };
    dropLocation = send<DropPoint> (view, "convertPoint:toView:", inView, (id) nullptr);
    dropWindow = send<id> (view, "window");
    // Plugins hit-test where the pointer really is (Serum does): the (invisible) window goes under it, the drop's
    // point on the pointer.
    // It never takes the user's clicks meanwhile, and goes back where it was after.
    const auto ignoredMouse = send<BOOL> (dropWindow, "ignoresMouseEvents");
    const auto frame = windowFrameOf (dropWindow);
    send<void> (dropWindow, "setIgnoresMouseEvents:", (BOOL) YES);
    const auto mouse = send<DropPoint> ((id) objc_getClass ("NSEvent"), "mouseLocation");
    send<void> (dropWindow, "setFrameOrigin:", DropPoint { mouse.x - dropLocation.x, mouse.y - dropLocation.y });

    std::vector<id> paths;
    for (const auto& file : files)
        paths.push_back (nsString (file));
    auto* url = send<id> (send<id> ((id) objc_getClass ("NSURL"), "fileURLWithPath:", nsString (files[0])), "absoluteString");
    dropPasteboard = send<id> ((id) objc_getClass ("NSPasteboard"), "pasteboardWithUniqueName");
    send<long> (dropPasteboard, "declareTypes:owner:", nsArray ({ nsString ("NSFilenamesPboardType"), nsString ("public.file-url") }), (id) nullptr);
    send<BOOL> (dropPasteboard, "setPropertyList:forType:", nsArray (paths), nsString ("NSFilenamesPboardType"));
    send<BOOL> (dropPasteboard, "setString:forType:", url, nsString ("public.file-url"));

    auto* info = send<id> (send<id> ((id) draggingInfoClass(), "alloc"), "init");
    juce::DynamicObject::Ptr result = new juce::DynamicObject();
    juce::String thrown;
    // A plugin's view is foreign code: whatever it throws (an Objective-C exception unwinds as C++'s does) is said.
    try
    {
        result->setProperty ("view", juce::String (object_getClassName (view)));
        result->setProperty ("width", bounds.size.x);
        result->setProperty ("height", bounds.size.y);
        result->setProperty ("entered", (double) send<unsigned long> (view, "draggingEntered:", info));
        if (respondsTo (view, "draggingUpdated:"))
            result->setProperty ("updated", (double) send<unsigned long> (view, "draggingUpdated:", info));
        if (! perform)
        {
            if (respondsTo (view, "draggingExited:"))
                send<void> (view, "draggingExited:", info);
        }
        else
        {
            if (respondsTo (view, "prepareForDragOperation:"))
                result->setProperty ("prepared", (bool) send<BOOL> (view, "prepareForDragOperation:", info));
            result->setProperty ("performed", (bool) send<BOOL> (view, "performDragOperation:", info));
            if (respondsTo (view, "concludeDragOperation:"))
                send<void> (view, "concludeDragOperation:", info);
        }
    }
    catch (...)
    {
        thrown = "The plugin's window threw an exception when given the files.";
    }
    send<void> (info, "release");
    send<void> (dropPasteboard, "releaseGlobally");
    send<void> (dropWindow, "setFrameOrigin:", frame.origin);
    send<void> (dropWindow, "setIgnoresMouseEvents:", ignoredMouse);
    dropPasteboard = dropWindow = nullptr;
    if (thrown.isNotEmpty())
        return thrown;
    if (perform && ! (bool) result->getProperty ("performed"))
        return "The plugin's window didn't take the files.";
    return juce::var (result.get());
}
#elif JUCE_WINDOWS
namespace
{
/** OLE keeps a window's drop target (its `RegisterDragDrop`) under this property, for its own process. */
constexpr auto dropTargetProperty = L"OleDropTargetInterface";

juce::String classOf (HWND hwnd)
{
    wchar_t name[256] {};
    GetClassNameW (hwnd, name, 256);
    return juce::String (name);
}

/** Whether a window is one of the engine's own (a JUCE peer of ours): its drop target is our JUCE's, not the plugin's. */
bool isOurs (HWND hwnd)
{
    for (int i = juce::ComponentPeer::getNumPeers(); --i >= 0;)
        if (auto* peer = juce::ComponentPeer::getPeer (i); peer != nullptr && peer->getNativeHandle() == hwnd)
            return true;
    return false;
}

BOOL CALLBACK collectWindow (HWND hwnd, LPARAM windows)
{
    reinterpret_cast<std::vector<HWND>*> (windows)->push_back (hwnd);
    return TRUE;
}

/** The deepest window under `root` that isn't ours and takes drops: the plugin's own (a JUCE plugin's peer). */
HWND pluginDropWindow (HWND root, juce::StringArray& seen)
{
    std::vector<HWND> windows;
    EnumChildWindows (root, collectWindow, reinterpret_cast<LPARAM> (&windows));
    const auto depthOf = [root] (HWND hwnd) {
        int depth = 0;
        for (; hwnd != nullptr && hwnd != root; hwnd = GetAncestor (hwnd, GA_PARENT))
            ++depth;
        return depth;
    };
    std::stable_sort (windows.begin(), windows.end(), [&] (HWND a, HWND b) { return depthOf (a) > depthOf (b); });
    seen.clear();
    for (auto* hwnd : windows)
        seen.add (classOf (hwnd));
    for (auto* hwnd : windows)
        if (! isOurs (hwnd) && GetPropW (hwnd, dropTargetProperty) != nullptr)
            return hwnd;
    return nullptr;
}

/** Explorer's own data object for the files (CF_HDROP, Shell IDList Array, FileNameW...), or null. */
IDataObject* shellDataObject (const juce::StringArray& files)
{
    std::vector<PIDLIST_ABSOLUTE> ids;
    auto parsed = true;
    for (const auto& file : files)
    {
        PIDLIST_ABSOLUTE id = nullptr;
        if (FAILED (SHParseDisplayName (juce::File (file).getFullPathName().toWideCharPointer(), nullptr, &id, 0, nullptr)) || id == nullptr)
        {
            parsed = false;
            break;
        }
        ids.push_back (id);
    }
    IDataObject* data = nullptr;
    IShellItemArray* items = nullptr;
    if (parsed && SUCCEEDED (SHCreateShellItemArrayFromIDLists ((UINT) ids.size(), const_cast<PCIDLIST_ABSOLUTE_ARRAY> (ids.data()), &items)))
    {
        items->BindToHandler (nullptr, BHID_DataObject, IID_PPV_ARGS (&data));
        items->Release();
    }
    for (auto* id : ids)
        ILFree (id);
    return data;
}

/** One drop's calls into the plugin's drop target, and what it answered. */
struct DropCall
{
    IDropTarget* target;
    IDataObject* data;
    POINTL point;
    bool perform;
    DWORD entered, updated, dropped;
    HRESULT result;
};

/**
 * The drag a real one makes: enter, over, then drop (or leave). The plugin's code is foreign, and C++'s `catch`
 * doesn't take an access violation (MSVC's /EHsc), so it's guarded by SEH: no objects with destructors in here.
 */
bool callDropTarget (DropCall& call)
{
    __try
    {
        constexpr DWORD allowed = DROPEFFECT_COPY | DROPEFFECT_MOVE | DROPEFFECT_LINK;
        DWORD effect = allowed;
        call.target->DragEnter (call.data, MK_LBUTTON, call.point, &effect);
        call.entered = effect;
        effect = allowed;
        call.target->DragOver (MK_LBUTTON, call.point, &effect);
        call.updated = effect;
        if (! call.perform || call.updated == DROPEFFECT_NONE)
        {
            call.target->DragLeave();
            return true;
        }
        // The button is up by the time a real drop happens.
        effect = allowed;
        call.result = call.target->Drop (call.data, 0, call.point, &effect);
        call.dropped = effect;
        return true;
    }
    __except (EXCEPTION_EXECUTE_HANDLER)
    {
        return false;
    }
}
} // namespace

void ignoreMouse (juce::Component& window)
{
    if (auto* hwnd = static_cast<HWND> (nativeWindowOf (window)))
    {
        // Layered and transparent: every click goes through it; never activated, so it never takes the focus.
        SetWindowLongPtrW (hwnd, GWL_EXSTYLE, GetWindowLongPtrW (hwnd, GWL_EXSTYLE) | WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_NOACTIVATE);
        SetLayeredWindowAttributes (hwnd, 0, 0, LWA_ALPHA);
    }
}

juce::var dropFiles (juce::Component& window, const juce::StringArray& files, double x, double y, bool perform)
{
    auto* root = static_cast<HWND> (nativeWindowOf (window));
    if (root == nullptr || files.isEmpty())
        return "The window isn't on the screen, or there are no files.";
    const auto started = juce::Time::getMillisecondCounterHiRes();
    juce::StringArray seen;
    auto* hwnd = pluginDropWindow (root, seen);
    if (hwnd == nullptr)
        return "No window in the plugin's view takes drops (windows: " + (seen.isEmpty() ? juce::String ("none") : seen.joinIntoString (", ")) + ").";
    auto* target = static_cast<IDropTarget*> (GetPropW (hwnd, dropTargetProperty));
    auto* data = shellDataObject (files);
    if (data == nullptr)
        return "The files couldn't be made into a drop (are they all there?).";
    target->AddRef();

    RECT client {};
    GetClientRect (hwnd, &client);
    POINT point { client.left + juce::roundToInt (x * (client.right - client.left)), client.top + juce::roundToInt (y * (client.bottom - client.top)) };
    ClientToScreen (hwnd, &point);

    // Unlike macOS, nothing needs moving under the pointer: Serum takes the drop where it's told (`point`), so a
    // window the user has open stays as it is, and only shows the preset it's given.
    DropCall call { target, data, { point.x, point.y }, perform, DROPEFFECT_NONE, DROPEFFECT_NONE, DROPEFFECT_NONE, E_FAIL };
    const auto called = callDropTarget (call);
    target->Release();
    data->Release();

    if (! called)
        return "The plugin's window threw an exception when given the files.";
    juce::DynamicObject::Ptr result = new juce::DynamicObject();
    result->setProperty ("view", classOf (hwnd));
    result->setProperty ("width", (int) (client.right - client.left));
    result->setProperty ("height", (int) (client.bottom - client.top));
    result->setProperty ("entered", (double) call.entered);
    result->setProperty ("updated", (double) call.updated);
    if (perform)
        result->setProperty ("performed", call.result == S_OK && call.dropped != DROPEFFECT_NONE);
    result->setProperty ("ms", juce::roundToInt (juce::Time::getMillisecondCounterHiRes() - started));
    if (perform && ! (bool) result->getProperty ("performed"))
        return "The plugin's window didn't take the files.";
    return juce::var (result.get());
}
#else
void ignoreMouse (juce::Component&) {}
juce::var dropFiles (juce::Component&, const juce::StringArray&, double, double, bool) { return "Dropping files on a plugin's window isn't possible on this system."; }
#endif
