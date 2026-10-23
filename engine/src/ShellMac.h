// The music app's window on macOS (docs/claude/music-shell.md): what AppKit can do for it that JUCE doesn't say,
// as Electron does for the other apps' windows (electron/main.ts). Only ShellWindow and Main.cpp call it, on macOS.
#pragma once

#include <functional>
#include <vector>
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
    /** A press (left or right) in a plugin's view (`addPluginView`): its frame comes to the front of the page's windows. */
    std::function<void (void* view)> pluginPressed;
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

/**
 * A view over the page for a plugin's editor to go in (`EditorWindow::Embedder`), hidden until `placePlugins` puts it
 * somewhere. The page draws the plugin's frame and its other windows; this view shows only the parts of the
 * plugin those windows don't cover, and takes clicks only there.
 */
void* addPluginView (juce::Component& window);
void removePluginView (void* view);

/** Where a plugin's view goes, in the page's CSS pixels: its body, and the parts of it that show. */
struct PluginPlace
{
    void* view;
    juce::Rectangle<double> body;
    std::vector<juce::Rectangle<double>> visible;
};

/** Put the plugins' views where the page says, stacked back to front as listed; the views not listed hide. */
void placePlugins (juce::Component& window, const std::vector<PluginPlace>& places);
} // namespace macShell
