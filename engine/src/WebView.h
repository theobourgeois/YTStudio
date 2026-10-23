// Windows: the app's page in WebView2, hosted by the engine itself rather than through JUCE's WebBrowserComponent,
// which hides what the music app needs (docs/apps.md, step 3). Two ways to host it, to measure which one joins input
// queues with WebView2's own processes (a window owned or parented across programs shares its input with theirs):
// - windowed (the default): WebView2 puts a window of its own, made by its browser process, inside ours;
// - composition (`VAUDIO_WEBVIEW_HOSTING=composition`): its picture is a DirectComposition visual in our window, and
//   we hand it the mouse (`SendMouseInput`), so no window of another program's is inside ours.
#pragma once

#include <juce_gui_extra/juce_gui_extra.h>

#if JUCE_WINDOWS
class WebView : public juce::HWNDComponent
{
public:
    /** Answers what the page asked: `complete` is called once, on the message thread. */
    using Complete = std::function<void (const juce::Result&, const juce::var&)>;
    /** A command the page sent (`chrome.webview.postMessage ({ id, command, params })`, `src/suites/music/shell.ts`). */
    using CommandHandler = std::function<void (const juce::String& command, const juce::var& params, Complete complete)>;

    /** Shows `url`; WebView2 keeps its profile in `userDataFolder`. */
    WebView (const juce::String& url, const juce::File& userDataFolder, juce::Colour background, CommandHandler onCommand);
    ~WebView() override;

    /** Gives the page the keyboard (its window was activated). */
    void focus();
    /** Its window moved: WebView2's popups (a select's list) open where the page now is. */
    void parentMoved();

private:
    class Host;
    std::unique_ptr<Host> host;
};
#endif
