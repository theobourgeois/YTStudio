// What only the operating system can say about the engine's windows and process: the one place the engine
// calls macOS's or Windows' own APIs (the file keeps its first name: it began with macOS alone).
#pragma once

#include <juce_gui_basics/juce_gui_basics.h>

/**
 * Keep a window out of Mission Control and Cmd-` cycling: a plugin's window is part of the app's workspace
 * (FL Studio's are inside its own), not a window of the computer. The app's own panels are the same
 * (`hiddenInMissionControl` in electron/panels.ts). Does nothing where there is no such thing, and until
 * the window has a peer (call it after it's visible). (On Windows, its style keeps it off the taskbar and
 * out of Alt+Tab: `EditorWindow::getDesktopWindowStyleFlags`.)
 */
void keepOutOfWindowSwitchers (juce::Component& window);

/**
 * Windows: the window the desktop app named by its handle (`HostWindow.handle`, its HWND as a decimal
 * number), or null if there's none or it's gone. Null elsewhere.
 */
void* appWindowFromHandle (const juce::String& handle);

/**
 * Windows: make a window (once it has a peer) belong to `owner`, a window of the desktop app's (null: to
 * none), as FL Studio's plugin windows belong to its own: always above it, never above another program's
 * windows, hidden while it's minimised. Across programs this is allowed, and the two share their input
 * state while it lasts (which is what lets a plugin's window take the focus from the app). Nothing
 * elsewhere: macOS has window levels instead (`setAlwaysOnTop`).
 */
void setWindowOwner (juce::Component& window, void* owner);

/** Windows: keep the computer from sleeping while the song plays (`playing`), or let it again. Nothing elsewhere. */
void keepAwake (bool playing);
