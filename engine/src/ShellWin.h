// The music app's window on Windows (docs/claude/music-shell.md): what Win32 does for it that JUCE doesn't say, as
// ShellMac.h does on macOS. The window has no title bar of the system's (JUCE's own, without one: `findControlAtPoint`
// says where its bars, edges and maximise button are); the page draws the window's buttons. Only ShellWindow calls it.
#pragma once

#include <functional>
#include <juce_gui_basics/juce_gui_basics.h>

namespace winShell
{
/**
 * The window's maximise button is the page's, but the window answers the system's hit test there (`HTMAXBUTTON`:
 * snap layouts show when it's hovered), so the mouse there comes to the window rather than the page. This hands it
 * on (`forward`: WM_MOUSEMOVE, WM_LBUTTONDOWN, WM_LBUTTONUP or WM_MOUSELEAVE at a point of the screen in physical
 * pixels), so the button lights up and is clicked as the page's own. And the keyboard Windows gives the window (it
 * was activated: Alt+Tab, a plugin's window closed) goes on to the page (`focused`): JUCE's window took it, and the
 * keys went nowhere until the page was clicked. Call again if the window's peer is made anew.
 */
void dress (juce::Component& window, std::function<void (unsigned int message, juce::Point<int> screen)> forward, std::function<void()> focused);

/** A project was opened: Windows' recent documents (the taskbar's jump list) list it. */
void noteRecent (const juce::String& path);
} // namespace winShell
