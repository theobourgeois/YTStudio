// The music app's window (docs/apps.md): the app's page in a window of the engine's own, through the system's web
// view, so the music suite and its plugins' windows are one program, as FL Studio is (docs/claude/music-shell.md).
// Plugin windows belong to it (`EditorWindow::setShellWindow`), so nothing waits on another program to stack or
// focus them. The page talks to the server, but for what it asks the app itself (`src/lib/host.ts`: dialogs, the
// files the app was handed) and the few commands it sends straight to the engine. On Windows the page is in a
// WebView2 of our own (WebView.h), on macOS in JUCE's WebBrowserComponent (`window.__JUCE__`'s "engine" function).
#pragma once

#include "EditorWindow.h"
#include <juce_gui_extra/juce_gui_extra.h>
#include <map>

class Engine;

/**
 * On macOS the plugins' editors are in it (`EditorWindow::Embedder`), not windows of their own: the page draws
 * each one's frame as one of its windows, says where its body is and what covers it (`host.placePlugins`), and the
 * plugin's view goes there over the page, so the page's windows and the plugins' stack among each other (FL Studio's
 * plugin windows are inside its own).
 */
class ShellWindow final : public juce::DocumentWindow,
                          private EditorWindow::Embedder
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

    // The plugins in it (macOS), by their view (`macShell::addPluginView`).
    void* attach (EditorWindow&) override;
    void changed (EditorWindow&) override;
    void raise (EditorWindow&) override;
    void detach (EditorWindow&) override;
    /** What the page draws of a plugin's frame (`HostPlugin` in src/lib/host.ts). */
    static juce::var describePlugin (EditorWindow&);
    EditorWindow* pluginByKey (const juce::String& key) const;
    std::map<EditorWindow*, void*> plugins;

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
