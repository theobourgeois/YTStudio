// Windows: the app's page in WebView2, hosted by the engine itself rather than through JUCE's WebBrowserComponent,
// which hides what the music app needs (docs/apps.md, step 3). Two ways to host it:
// - composition (the default): its picture is a DirectComposition visual in our window, and we hand it the mouse
//   (`SendMouseInput`) and Explorer's drags, so no window of another program's is inside ours and every hit test is
//   ours: the shell's window has no title bar, and the page's bars (`host.dragRegions`), its edges and the maximise
//   button the page draws are the window's (`setNonClient`: dragging, Aero Snap, snap layouts);
// - windowed (`VAUDIO_WEBVIEW_HOSTING=windowed`): WebView2 puts a window of its own, made by its browser process,
//   inside ours. As quick (measured, docs/claude/music-shell.md), but those windows answer the hit tests, so the
//   window can't be dragged by the page's bars.
#pragma once

#include <juce_gui_extra/juce_gui_extra.h>

#if JUCE_WINDOWS
class PanelWindow;

class WebView : public juce::HWNDComponent
{
public:
    /** Answers what the page asked: `complete` is called once, on the message thread. */
    using Complete = std::function<void (const juce::Result&, const juce::var&)>;
    /** A command the page sent (`chrome.webview.postMessage ({ id, command, params })`, `src/lib/host.ts`). */
    using CommandHandler = std::function<void (const juce::String& command, const juce::var& params, Complete complete)>;

    /** Shows `url`; WebView2 keeps its profile in `userDataFolder`. */
    WebView (const juce::String& url, const juce::File& userDataFolder, juce::Colour background, CommandHandler onCommand);
    ~WebView() override;

    /** Gives the page the keyboard (its window was activated). */
    void focus();
    /** Its window moved: WebView2's popups (a select's list) open where the page now is. */
    void parentMoved();
    /** Tells the page something (`{ event, ... }`; replies carry an `id` instead). */
    void post (const juce::var& message);
    /** Shows another address (the server started again elsewhere). */
    void navigate (const juce::String& url);

    /** Whether the page is drawn through DirectComposition (what follows works only then). */
    bool composited() const;
    /**
     * Whether a point of the screen (physical pixels) over the page is its window's rather than the page's (a title
     * bar, an edge, the maximise button): there the page lets the window answer the system's hit test
     * (`findControlAtPoint`), so it's dragged, resized and shows snap layouts as a window with a title bar does.
     */
    void setNonClient (std::function<bool (juce::Point<int> screen)> isNonClient);
    /**
     * A mouse message the window had (WM_MOUSEMOVE, WM_LBUTTONDOWN, WM_LBUTTONUP or WM_MOUSELEAVE) at a point of
     * the screen (physical), handed to the page as if it were the page's: the maximise button is drawn by the page
     * but hit-tested by the window, and still lights up and is clicked.
     */
    void forwardMouse (unsigned int message, juce::Point<int> screen);

    /** Files dragged from Explorer over the page: where they are, which the page can't know (`droppedPath`). */
    std::function<void (const juce::StringArray& paths)> onDragPaths;

    /**
     * The page opens a window (`window.open`) named `name`: whether it's one of the app's (a panel's,
     * src/components/windows/native/), shown in a `PanelWindow` handed to `onWindowOpened`. Others (a link) go to the
     * computer's browser.
     */
    std::function<bool (const juce::String& name)> acceptsWindow;
    std::function<void (const juce::String& name, std::unique_ptr<PanelWindow> window)> onWindowOpened;
    /** The page is going (a reload, another address): the windows it opened have no one to draw them. */
    std::function<void()> onLeaving;

    class Host;

private:
    std::unique_ptr<Host> host;
};

/**
 * A window the page opened (`window.open` with a panel's name: src/components/windows/native/): a window of the
 * system's with no frame, owned by the shell's window (above it, minimised with it, no taskbar button), whose document
 * is the page's own (same renderer: the page draws into it and places it). Drawn by WebView2 as the page is.
 */
class PanelWindow
{
public:
    explicit PanelWindow (std::unique_ptr<WebView::Host> host);
    ~PanelWindow();

    /** Shown, given the keyboard (`focus`) or not. */
    void show (bool focus);
    /** In front of the app's other windows, with the keyboard. */
    void raise();
    void hide();
    bool isShown() const;
    /** Where it is, in points (JUCE's logical pixels, as the page's `ScreenRect`s). */
    void place (juce::Rectangle<int> bounds);
    /** Moved by physical pixels: the shell's window moved, and its panels go along (as plugin windows do). */
    void moveBy (juce::Point<int> delta);
    void setBackground (juce::Colour colour);
    void setTitle (const juce::String& title);

    /** It was closed by something other than the page (Alt+F4, the page's `window.close`). */
    std::function<void()> onClosed;
    /** Files dragged from Explorer over it: where they are (`WebView::onDragPaths`). */
    std::function<void (const juce::StringArray& paths)> onDragPaths;

private:
    std::unique_ptr<WebView::Host> host;
};
#endif
