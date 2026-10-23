// What only the operating system can say about the engine's windows and process: the one place the engine
// calls macOS's or Windows' own APIs (the file keeps its first name: it began with macOS alone).
#pragma once

#include <functional>
#include <juce_gui_basics/juce_gui_basics.h>

/**
 * Keep a window out of Mission Control and Cmd-` cycling: a plugin's window is part of the app's workspace
 * (FL Studio's are inside its own), not a window of the computer. Does nothing where there is no such thing, and until
 * the window has a peer (call it after it's visible). (On Windows, its style keeps it off the taskbar and
 * out of Alt+Tab: `EditorWindow::getDesktopWindowStyleFlags`.)
 */
void keepOutOfWindowSwitchers (juce::Component& window);

/**
 * Make a window (once it has a peer) belong to `owner`, the shell's window (`ShellWindow`; null: to none), as
 * FL Studio's plugin windows belong to its own: always above it, never above another program's windows, hidden
 * while it's minimised. Windows: an owned window; macOS: a child window. Nothing elsewhere.
 */
void setWindowOwner (juce::Component& window, void* owner);

/**
 * Windows: a plugin that takes the keyboard (Serum, most JUCE plugins, once clicked) gives it to a child
 * window of its own, so the keys pressed in it never reach JUCE's key listeners. This hooks the keyboard of
 * the calling thread (the message thread, where plugins make their windows) and offers every key to
 * `handler` first: the window at the root of the one with the focus, the key as JUCE names it, whether it
 * went down (else up) and whether it's a repeat. True swallows it (the plugin never sees it). Installed
 * once; nothing elsewhere (macOS gives the keys to the window's key listeners as it is).
 */
using KeyHook = std::function<bool (void* root, const juce::KeyPress& key, bool down, bool repeat)>;
void hookThreadKeys (KeyHook handler);

/** The native window under a component (its peer's), or null. */
void* nativeWindowOf (juce::Component& window);

/**
 * Windows: where a window is on the screen in physical pixels (its frame, as the system has it), or empty. JUCE's
 * bounds are in logical pixels, rounded: a window following another by them drifts a pixel every few moves when
 * the display is scaled. Empty elsewhere.
 */
juce::Rectangle<int> nativeFrameOf (juce::Component& window);

/** Windows: move a window by `delta` physical pixels, without activating it or changing its stacking. Nothing elsewhere. */
void moveWindowBy (juce::Component& window, juce::Point<int> delta);

/**
 * Windows: keep a window off the screen while it's shown (DWM's cloak: it's still drawn, only not composed), or
 * put it back. A plugin's window shows white until the plugin has drawn its editor (Serum's a quarter of a
 * second); cloaked meanwhile, it appears drawn. Nothing elsewhere.
 */
void cloakWindow (juce::Component& window, bool cloaked);

/**
 * Windows: a press on the window's title bar moves it at once, in the system's move loop, rather than after the
 * system has waited to see whether the mouse goes on moving (the message loop stops meanwhile, and with it every
 * timer: the playhead). Call once it has a peer, and again for a new one (it's done once a peer). Nothing elsewhere.
 */
void dragWithoutPause (juce::Component& window);

/** Windows: keep the computer from sleeping while the song plays (`playing`), or let it again. Nothing elsewhere. */
void keepAwake (bool playing);

/**
 * The window lets every click through to what's under it (an invisible window). Windows: layered, transparent to the
 * mouse and never activated, so it never takes the focus. Nothing elsewhere.
 */
void ignoreMouse (juce::Component& window);

/**
 * Hand files to the plugin's view inside `window` as a drag and drop from Finder or Explorer would, at (x, y), a
 * fraction of the view's width and height from its top left. It's how a plugin is given a file only its
 * window takes (Serum 2 reads Serum 1 presets only that way). Says what the view answered at each stage of
 * the drop; an error (a string) if it didn't take them, threw, or there's no plugin view. Without `perform`, the
 * drag only passes over (x, y) and leaves: whether the plugin would take the files there.
 * macOS: AppKit's dragging calls on the plugin's NSView, the window moved under the pointer meanwhile. Windows: the
 * plugin's own `IDropTarget` (its child window's, from OLE), given Explorer's data object for the files at the
 * point; nothing moves. Neither on other systems.
 */
juce::var dropFiles (juce::Component& window, const juce::StringArray& files, double x, double y, bool perform = true);
