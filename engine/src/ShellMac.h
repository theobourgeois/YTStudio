// The music app's window on macOS (docs/claude/music-shell.md): what AppKit can do for it that JUCE doesn't say,
// as Electron does for the other apps' windows (electron/main.ts). Only ShellWindow and Main.cpp call it, on macOS.
#pragma once

#include <functional>
#include <juce_gui_basics/juce_gui_basics.h>

namespace macShell
{
/** What the window tells the app as it happens. */
struct Listener
{
    /** A menu item: one of the page's (`page:<DesktopCommand>`) or the app's (`reload`, `zoomIn`, `showLogs`...). */
    std::function<void (const juce::String& command)> menu;
    /** The window went into full screen, or came out. */
    std::function<void (bool fullScreen)> fullScreen;
    /** Files dragged from Finder over the page: where they are, which the page can't know (`droppedPath`). */
    std::function<void (const juce::StringArray& paths)> dragged;
};

/**
 * The window as the Electron apps' is on a Mac: no title bar, the page under the traffic lights (the tab strip
 * makes room for them), and its web view inspectable, with the page given the keys before the menus. And the menu
 * bar: the app's menu, File, Edit (to the web view's text), View, Window and Help. Call once it's visible, with the
 * page in it.
 */
void dress (juce::Component& window, const juce::String& appName, Listener listener);

/** The bar that starts the window is `height` points tall: the traffic lights sit in its middle, or hide (`ownButtons`). */
void titleBar (juce::Component& window, int height, bool ownButtons);

/** The page was pressed where it drags the window (its title bars): the window follows the mouse while it's down. */
void dragWindow (juce::Component& window);

/** A double click there: what the system says (zoom, minimise or nothing; System Settings › Desktop & Dock). */
void titleDoubleClicked (juce::Component& window);

/** The page's own window buttons: "minimize" or "fullscreen". */
void windowAction (juce::Component& window, const juce::String& action);

/** Make the web view the window's first responder, so the keys go to the page. */
void focusPage (juce::Component& window);

/** The page's zoom (View › Zoom In and Out): its factor, kept for next time. */
double pageZoom();
double zoomPage (juce::Component& window, int step);
void reloadPage (juce::Component& window);

/** macOS's Hide or Hide Others, for ⌘H / ⌥⌘H the page didn't use. */
void hide (bool others);

/** A project was opened: File › Open Recent and the Dock's menu list it. */
void noteRecent (const juce::String& path);
} // namespace macShell
