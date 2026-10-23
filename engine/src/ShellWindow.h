// The shell (`--window <url>`): the app's page in a window of the engine's own, through the system's web view, so
// the music suite and its plugins' windows are one program, as FL Studio is (docs/claude/music-shell.md). Plugin
// windows belong to it (`EditorWindow::setShellWindow`), so nothing waits on another program to stack or focus
// them. An experiment: the server still runs the engine and the page still talks to the server, but for what the
// page sends straight here (`src/suites/music/shell.ts`). On Windows the page is in a WebView2 of our own (WebView.h),
// on macOS in JUCE's WebBrowserComponent (`window.__JUCE__`'s "engine" function).
#pragma once

#include <juce_gui_extra/juce_gui_extra.h>

class Engine;

class ShellWindow final : public juce::DocumentWindow
{
public:
    /** Shows `url` (the app); the web view keeps its own data (WebView2's profile) in `dataDir`. */
    ShellWindow (const juce::String& url, Engine& engine, const juce::File& dataDir);
    ~ShellWindow() override;

    /** Closing it quits the engine, which tells the server first (`shellClosed`). */
    void closeButtonPressed() override;
    void moved() override;
    void resized() override;
    void activeWindowStatusChanged() override;

private:
    class Page;
    /** Where it is, for the plugin windows: they open over it and move with it (`PluginHost::setHost`). */
    void tellHost();

    Engine& engine;
    std::unique_ptr<Page> page;
};
