#include "ShellWindow.h"

#include "EditorWindow.h"
#include "Engine.h"
#include "HostCommands.h"
#include "MacWindow.h"
#include "Protocol.h"
#include "WebView.h"
#if JUCE_MAC
 #include "ShellMac.h"
#endif

namespace
{
/**
 * The commands the page may send straight here rather than through the server: only those the server merely
 * passes on (it checks nothing the page can't), where the trip through it is felt (a key of the piano played).
 */
const juce::StringArray directCommands { "preview" };

/** The page's background while it loads (Studio Dark's `surface-0`), so the window never flashes white. */
const juce::Colour loading { 0xff23272e };

} // namespace

#if JUCE_WINDOWS
class ShellWindow::Page final : public WebView
{
public:
    using WebView::WebView;
};
#else
class ShellWindow::Page final : public juce::WebBrowserComponent
{
public:
    Page (const Options& options, juce::String home) : WebBrowserComponent (options), home (std::move (home)) {}

    /** The app's dev server may not be up yet when the engine starts: try again until it is. */
    bool pageLoadHadNetworkError (const juce::String&) override
    {
        juce::Timer::callAfterDelay (500, [safe = juce::Component::SafePointer<Page> (this)] {
            if (safe != nullptr)
                safe->goToURL (safe->home);
        });
        return false;
    }

    /** What the page opens in a new window (a link, Help's pages) goes to the computer's browser. */
    void newWindowAttemptingToLoad (const juce::String& url) override { juce::URL (url).launchInDefaultBrowser(); }

    const juce::String home;
};
#endif

ShellWindow::ShellWindow (const juce::String& urlToShow, Engine& engineToUse, const juce::File& dataDirToUse)
    : DocumentWindow ("YTStudio Music", loading, DocumentWindow::allButtons), engine (engineToUse), dataDir (dataDirToUse), url (urlToShow)
{
   #if JUCE_WINDOWS
    page = std::make_unique<Page> (url, dataDir.getChildFile ("webview"), loading, [this] (const juce::String& name, const juce::var& params, WebView::Complete complete) {
        command (name, params, std::move (complete));
    });
   #else
    const auto options = juce::WebBrowserComponent::Options()
        .withKeepPageLoadedWhenBrowserIsHidden()
        .withNativeIntegrationEnabled()
        // engine(command, params) -> { ok, result } or { ok: false, error }.
        .withNativeFunction ("engine", [this] (const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion complete) {
            command (args.isEmpty() ? juce::String() : args[0].toString(), args.size() > 1 ? args[1] : juce::var(), [complete] (const juce::Result& result, const juce::var& value) {
                complete (result.wasOk() ? protocol::object ({ { "ok", true }, { "result", value } })
                                         : protocol::object ({ { "ok", false }, { "error", result.getErrorMessage() } }));
            });
        });
    page = std::make_unique<Page> (options, url);
   #endif

   #if JUCE_MAC
    // The engine is an app with no Dock icon (LSUIElement: it's part of YTStudio); the shell is the app itself.
    juce::Process::setDockIconVisible (true);
   #endif
    setUsingNativeTitleBar (true);
    setResizable (true, false);
    setContentNonOwned (page.get(), false);
    setResizeLimits (800, 500, 100000, 100000);
    const auto area = juce::Desktop::getInstance().getDisplays().getPrimaryDisplay()->userArea;
    centreWithSize (juce::jmin (1600, area.getWidth() * 9 / 10), juce::jmin (1000, area.getHeight() * 9 / 10));
    // Where it was last time (a screen since unplugged: JUCE keeps it on one that's there).
    if (const auto place = placeFile().loadFileAsString(); place.isNotEmpty())
        restoreWindowStateFromString (place);
    setVisible (true);
    juce::Process::makeForegroundProcess();
    toFront (true);
   #if ! JUCE_WINDOWS
    page->goToURL (url);
   #endif

   #if JUCE_MAC
    macShell::Listener listener;
    listener.menu = [this] (const juce::String& name) { menu (name); };
    listener.fullScreen = [this] (bool on) { post (protocol::object ({ { "event", "fullscreen" }, { "on", on } })); };
    listener.dragged = [this] (const juce::StringArray& paths) {
        juce::Array<juce::var> list;
        for (const auto& path : paths)
            list.add (path);
        post (protocol::object ({ { "event", "dragPaths" }, { "paths", list } }));
    };
    listener.pluginPressed = [this] (void* view) {
        for (const auto& [window, placed] : plugins)
            if (placed == view)
                raise (*window);
    };
    macShell::dress (*this, "YTStudio Music", std::move (listener));
    EditorWindow::setEmbedder (this);
   #endif

    EditorWindow::setShellWindow (nativeWindowOf (*this));
    tellHost();
}

ShellWindow::~ShellWindow()
{
    if (! isFullScreen())
        placeFile().replaceWithText (getWindowStateAsString());
    EditorWindow::setShellWindow (nullptr);
    EditorWindow::setEmbedder (nullptr);
    clearContentComponent();
}

void ShellWindow::show (const juce::String& newUrl)
{
    if (newUrl == url)
        return;
    url = newUrl;
    pageReady = false;
   #if JUCE_WINDOWS
    page->navigate (url);
   #else
    page->goToURL (url);
   #endif
}

void ShellWindow::flush (int ms, std::function<void()> done)
{
    if (! pageReady)
        return done();
    const auto request = nextFlush++;
    flushes[request] = std::move (done);
    post (protocol::object ({ { "event", "flush" }, { "request", request } }));
    juce::Timer::callAfterDelay (ms, [safe = juce::Component::SafePointer<ShellWindow> (this), request] {
        if (safe == nullptr)
            return;
        const auto found = safe->flushes.find (request);
        if (found == safe->flushes.end())
            return;
        std::fprintf (stderr, "[shell] the page didn't say it had saved\n");
        auto done = std::move (found->second);
        safe->flushes.erase (found);
        done();
    });
}

void ShellWindow::openFiles (const juce::StringArray& paths)
{
    toFront (true);
    if (! pageReady)
        return waitingFiles.addArray (paths);
    for (const auto& path : paths)
        post (protocol::object ({ { "event", "openFile" }, { "path", path } }));
}

void ShellWindow::command (const juce::String& name, const juce::var& params, Complete complete)
{
    if (name == "host.ready")
    {
        // The page is listening (loaded, or loaded again): what it missed meanwhile.
        pageReady = true;
        juce::Array<juce::var> files;
        for (const auto& path : waitingFiles)
            files.add (path);
        waitingFiles.clear();
       #if JUCE_MAC
        const auto zoom = macShell::pageZoom();
       #else
        const auto zoom = 1.0;
       #endif
        // The plugins open in the window (a page loaded again draws their frames again).
        juce::Array<juce::var> open;
        for (const auto& [window, view] : plugins)
            open.add (describePlugin (*window));
        return complete (juce::Result::ok(), protocol::object ({ { "files", files }, { "zoom", zoom }, { "plugins", open } }));
    }
    if (name == "host.flushed")
    {
        const auto found = flushes.find ((int) params["request"]);
        complete (juce::Result::ok(), {});
        if (found == flushes.end())
            return;
        auto done = std::move (found->second);
        flushes.erase (found);
        return done();
    }
    if (windowCommand (name, params, complete))
        return;
    if (hostCommands::runForPage (name, params, complete))
        return;
    if (! directCommands.contains (name))
        return complete (juce::Result::fail ("\"" + name + "\" goes through the server, not straight to the engine."), {});
    engine.handle (name, params, std::move (complete));
}

bool ShellWindow::windowCommand (const juce::String& name, const juce::var& params, Complete& complete)
{
    if (name == "host.window")
    {
        // The page's own window buttons (Settings › General without the tab strip).
        const auto action = params["action"].toString();
        if (action == "close")
            closeButtonPressed();
       #if JUCE_MAC
        else
            macShell::windowAction (*this, action);
       #else
        else if (action == "fullscreen")
            setFullScreen (! isFullScreen());
        else if (action == "minimize")
            setMinimised (true);
       #endif
        complete (juce::Result::ok(), {});
        return true;
    }
   #if JUCE_MAC
    if (name == "host.titleBar")
        macShell::titleBar (*this, juce::jlimit (20, 120, (int) params["height"]), (bool) params["ownButtons"]);
    else if (name == "host.drag")
        macShell::dragWindow (*this);
    else if (name == "host.titleDoubleClick")
        macShell::titleDoubleClicked (*this);
    else if (name == "host.hide")
        macShell::hide (params["which"].toString() == "others");
    else if (name == "host.recent")
        macShell::noteRecent (params["path"].toString());
    else if (name == "host.placePlugins")
    {
        // [{ key, body: { x, y, width, height }, visible: [rect...] }], back to front, in the page's CSS pixels.
        const auto rect = [] (const juce::var& r) {
            return juce::Rectangle<double> ((double) r["x"], (double) r["y"], (double) r["width"], (double) r["height"]);
        };
        std::vector<macShell::PluginPlace> places;
        if (const auto* list = params["places"].getArray())
            for (const auto& place : *list)
                if (auto* window = pluginByKey (place["key"].toString()))
                {
                    macShell::PluginPlace placed { plugins[window], rect (place["body"]), {} };
                    if (const auto* visible = place["visible"].getArray())
                        for (const auto& part : *visible)
                            placed.visible.push_back (rect (part));
                    places.push_back (std::move (placed));
                }
        macShell::placePlugins (*this, places);
    }
    else if (name == "host.pluginAction")
    {
        // A press in the frame the page draws: its ×, preset arrows, Automate or wrapper button.
        if (auto* window = pluginByKey (params["key"].toString()))
        {
            const auto action = params["action"].toString();
            if (action == "close")
                window->closeButtonPressed();
            else
                window->act (action, (int) params["direction"]);
        }
    }
    else
        return false;
    complete (juce::Result::ok(), {});
    return true;
   #else
    juce::ignoreUnused (params);
    return false;
   #endif
}

void ShellWindow::menu (const juce::String& name)
{
   #if JUCE_MAC
    if (name.startsWith ("page:"))
        return post (protocol::object ({ { "event", "command" }, { "name", name.fromFirstOccurrenceOf ("page:", false, false) } }));
    if (name == "hide" || name == "hideOthers")
        return macShell::hide (name == "hideOthers");
    if (name == "reload")
    {
        pageReady = false;
        return macShell::reloadPage (*this);
    }
    if (name == "zoomIn" || name == "zoomOut" || name == "zoomReset")
    {
        const auto zoom = macShell::zoomPage (*this, name == "zoomIn" ? 1 : name == "zoomOut" ? -1 : 0);
        return post (protocol::object ({ { "event", "zoom" }, { "factor", zoom } }));
    }
    // The app's data folder (`data/`), whose `engine` folder is the engine's.
    const auto data = dataDir.getParentDirectory();
    if (name == "showData")
        data.startAsProcess();
    else if (name == "showLogs")
        data.getChildFile ("logs").getChildFile ("ytstudio.log").revealToUser();
   #else
    juce::ignoreUnused (name);
   #endif
}

void ShellWindow::post (const juce::var& event)
{
   #if JUCE_WINDOWS
    page->post (event);
   #else
    page->emitEventIfBrowserIsVisible ("host", event);
   #endif
}

void ShellWindow::closeButtonPressed()
{
    juce::JUCEApplication::getInstance()->systemRequestedQuit();
}

void ShellWindow::moved()
{
    DocumentWindow::moved();
   #if JUCE_WINDOWS
    page->parentMoved();
   #endif
    tellHost();
}

void ShellWindow::resized()
{
    DocumentWindow::resized();
    tellHost();
}

void ShellWindow::activeWindowStatusChanged()
{
    DocumentWindow::activeWindowStatusChanged();
    // The window was activated (Alt+Tab, ⌘Tab, a plugin's window closed): the keys go to the page, not to JUCE's window.
    if (! isActiveWindow())
        return;
   #if JUCE_WINDOWS
    page->focus();
   #elif JUCE_MAC
    macShell::focusPage (*this);
   #endif
}

void ShellWindow::tellHost()
{
    if (! isOnDesktop())
        return;
    const auto rectangle = [] (juce::Rectangle<int> r) {
        return protocol::object ({ { "x", r.getX() }, { "y", r.getY() }, { "width", r.getWidth() }, { "height", r.getHeight() } });
    };
    auto host = protocol::object ({ { "bounds", rectangle (getScreenBounds()) } });
    if (const auto frame = nativeFrameOf (*this); ! frame.isEmpty())
        host.getDynamicObject()->setProperty ("frame", rectangle (frame));
    engine.handle ("host", host, [] (const juce::Result&, const juce::var&) {});
}

void* ShellWindow::attach (EditorWindow& window)
{
   #if JUCE_MAC
    auto* view = macShell::addPluginView (*this);
    plugins[&window] = view;
    return view;
   #else
    juce::ignoreUnused (window);
    return nullptr;
   #endif
}

void ShellWindow::changed (EditorWindow& window)
{
    if (plugins.count (&window) != 0)
        post (protocol::object ({ { "event", "plugin" }, { "plugin", describePlugin (window) } }));
}

void ShellWindow::raise (EditorWindow& window)
{
    if (plugins.count (&window) != 0)
        post (protocol::object ({ { "event", "pluginFront" }, { "key", window.embedKey() } }));
}

void ShellWindow::detach (EditorWindow& window)
{
    const auto found = plugins.find (&window);
    if (found == plugins.end())
        return;
   #if JUCE_MAC
    macShell::removePluginView (found->second);
   #endif
    plugins.erase (found);
    post (protocol::object ({ { "event", "pluginGone" }, { "key", window.embedKey() } }));
}

juce::var ShellWindow::describePlugin (EditorWindow& window)
{
    const auto* view = window.embeddedView();
    return protocol::object ({ { "key", window.embedKey() },
                               { "title", window.getName() },
                               { "width", view != nullptr ? view->getWidth() : 0 },
                               { "height", view != nullptr ? view->getHeight() : 0 },
                               { "shown", view != nullptr && view->isVisible() },
                               { "preset", window.presetLabel() },
                               { "steps", window.presetSteps() },
                               { "touched", window.touchedName() } });
}

EditorWindow* ShellWindow::pluginByKey (const juce::String& key) const
{
    for (const auto& [window, view] : plugins)
        if (window->embedKey() == key)
            return window;
    return nullptr;
}
