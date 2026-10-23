// The music app's window (docs/apps.md): the app's page in a window of the engine's own, through the system's web
// view, so the music suite and its plugins' windows are one program, as FL Studio is (docs/claude/music-shell.md).
// Plugin windows belong to it (`EditorWindow::setShellWindow`), so nothing waits on another program to stack or
// focus them. The page talks to the server, but for what it asks the app itself (`src/lib/host.ts`: dialogs, the
// files the app was handed) and the few commands it sends straight to the engine. On Windows the page is in a
// WebView2 of our own (WebView.h), on macOS in JUCE's WebBrowserComponent (`window.__JUCE__`'s "engine" function).
#pragma once

#include <juce_gui_extra/juce_gui_extra.h>
#include <map>

class Engine;

class ShellWindow final : public juce::DocumentWindow
{
public:
    /** Shows `url` (the app); the web view keeps its own data (WebView2's profile) in `dataDir`. */
    ShellWindow (const juce::String& url, Engine& engine, const juce::File& dataDir);
    ~ShellWindow() override;

    /** Show `url` instead (a server restarted elsewhere); nothing if it's the page shown. */
    void show (const juce::String& url);
    /** Ask the page to save what it hasn't yet (`editorDesktop.flush`): `done` once it has, or after `ms` regardless. */
    void flush (int ms, std::function<void()> done);
    /** Files the app was handed (Finder, Explorer, its icon): the page opens them, once it's there to. */
    void openFiles (const juce::StringArray& paths);

    /** Closing it quits the app, once the page has saved (`EngineApplication::systemRequestedQuit`). */
    void closeButtonPressed() override;
    void moved() override;
    void resized() override;
    void activeWindowStatusChanged() override;
    /** No border of JUCE's: the page fills the window (on Windows its edges are the page's, `findControlAtPoint`). */
    juce::BorderSize<int> getBorderThickness() const override { return {}; }
    juce::BorderSize<int> getContentComponentBorder() const override { return {}; }
   #if JUCE_WINDOWS
    /**
     * Windows: the window has no title bar of the system's, so it says where its parts are, for the system's hit test
     * (dragging, Aero Snap, a double click to maximise, the snap layouts on the maximise button): its edges, the
     * maximise button the page draws (`CaptionButtons`, at the right end of the bar that starts the window) and the
     * page's bars (`host.dragRegions`).
     */
    WindowControlKind findControlAtPoint (juce::Point<float> point) const override;
   #endif

private:
    class Page;
    using Complete = std::function<void (const juce::Result&, const juce::var&)>;
    /** Where it is, for the plugin windows: they open over it and move with it (`PluginHost::setHost`). */
    void tellHost();
    /** What the page asked (`hostCommand` in src/lib/host.ts). */
    void command (const juce::String& name, const juce::var& params, Complete complete);
    /** Tell the page something (`{ event, ... }`: `onHostEvent` in src/lib/host.ts). */
    void post (const juce::var& event);
    /** What the window's own commands (the Mac's title bar, its menus) do, or false if `name` isn't one. */
    bool windowCommand (const juce::String& name, const juce::var& params, Complete& complete);
    /** A menu item (ShellMac.h): the page's commands go to it, the app's are run here. */
    void menu (const juce::String& name);
    juce::File placeFile() const { return dataDir.getChildFile ("window.txt"); }
   #if JUCE_WINDOWS
    /** The mouse on the page's maximise button goes to the page (`winShell::dress`): again if the peer is made anew. */
    void dressPeer();
    void* dressedPeer = nullptr;
    /** How tall the bar that starts the window is (`host.titleBar`, points): the page's window buttons are as tall. */
    int titleBarHeight = 40;
    /** Whether the page was last told the window is maximised (`maximized`). */
    bool saidMaximised = false;
    /**
     * Where the page's bars drag the window, and what in them takes its own presses (`host.dragRegions`, CSS pixels),
     * so the system's hit test is answered here and asks nothing of the page.
     */
    juce::Array<juce::Rectangle<float>> dragRegions, pressedRegions;
   #endif

    Engine& engine;
    /** The engine's data folder, in the app's (`data/engine`): where the window's place is kept. */
    const juce::File dataDir;
    std::unique_ptr<Page> page;
    juce::String url;
    /** The page said it's listening (`host.ready`); until then, files handed to the app wait. */
    bool pageReady = false;
    juce::StringArray waitingFiles;
    int nextFlush = 0;
    std::map<int, std::function<void()>> flushes;
};
