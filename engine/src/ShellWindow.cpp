#include "ShellWindow.h"

#include "EditorWindow.h"
#include "Engine.h"
#include "HostCommands.h"
#include "MacWindow.h"
#include "Protocol.h"
#include "WebView.h"

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

ShellWindow::ShellWindow (const juce::String& urlToShow, Engine& engineToUse, const juce::File& dataDir)
    : DocumentWindow ("YTStudio Music", loading, DocumentWindow::allButtons), engine (engineToUse), url (urlToShow)
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
    const auto area = juce::Desktop::getInstance().getDisplays().getPrimaryDisplay()->userArea;
    centreWithSize (juce::jmin (1600, area.getWidth() * 9 / 10), juce::jmin (1000, area.getHeight() * 9 / 10));
    setVisible (true);
    juce::Process::makeForegroundProcess();
    toFront (true);
   #if ! JUCE_WINDOWS
    page->goToURL (url);
   #endif

    EditorWindow::setShellWindow (nativeWindowOf (*this));
    tellHost();
}

ShellWindow::~ShellWindow()
{
    EditorWindow::setShellWindow (nullptr);
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
        return complete (juce::Result::ok(), protocol::object ({ { "files", files } }));
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
    if (hostCommands::runForPage (name, params, complete))
        return;
    if (! directCommands.contains (name))
        return complete (juce::Result::fail ("\"" + name + "\" goes through the server, not straight to the engine."), {});
    engine.handle (name, params, std::move (complete));
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
   #if JUCE_WINDOWS
    // The window was activated (Alt+Tab, a plugin's window closed): the keys go to the page, not to JUCE's window.
    if (isActiveWindow())
        page->focus();
   #endif
}

void ShellWindow::tellHost()
{
    if (! isOnDesktop())
        return;
    const auto bounds = getScreenBounds();
    const auto host = protocol::object ({ { "floating", true },
                                          { "visible", true },
                                          { "bounds", protocol::object ({ { "x", bounds.getX() }, { "y", bounds.getY() }, { "width", bounds.getWidth() }, { "height", bounds.getHeight() } }) } });
    engine.handle ("host", host, [] (const juce::Result&, const juce::var&) {});
}
