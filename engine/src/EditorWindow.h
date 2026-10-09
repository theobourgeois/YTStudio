// A plugin's own interface in a window of ours (FL Studio's plugin wrapper: docs/fl-studio/plugin-window.md).
// The engine is a program of its own, so the window can't be inside the app's: it's made to act as if it
// were (our own title bar; the keys the plugin doesn't use go to the app; `PluginHost::setHost` puts it at the
// level of the app's floating windows, hides it and moves it with the app's window).
#pragma once

#include <functional>
#include <map>
#include <set>
#include <juce_audio_utils/juce_audio_utils.h>

class EditorWindow final : public juce::DocumentWindow,
                           private juce::KeyListener,
                           private juce::Timer
{
public:
    /** `onCloseButton` is told the window's × was pressed: closing it (deleting it) is the owner's to do. */
    /**
     * `hidden`: made fully transparent (macOS: on the screen as far as the plugin knows, so its view is attached,
     * but never seen or clicked), for handing the plugin files by `dropFiles`.
     */
    EditorWindow (juce::AudioPluginInstance& plugin, const juce::String& title, std::function<void()> onCloseButton, bool hidden = false);
    ~EditorWindow() override;

    void closeButtonPressed() override { onClose(); }

    /** Bring it in front of the other apps' windows: the engine has no Dock icon to do it from. */
    void show();
    /** Centred over `area` (the app's window, where FL opens its plugins), kept on that area's screen. */
    void centreOver (juce::Rectangle<int> area);

    /**
     * Windows: the desktop app's main window (`appWindowFromHandle`), or null. Plugin windows belong to it
     * there (`setWindowOwner`: above it, not above other programs, minimised with it) and have no taskbar
     * button or Alt+Tab entry of their own, as FL Studio's don't. Always null elsewhere.
     */
    static void setAppWindow (void* window);
    static void* appWindow() { return owner; }
    /** Belong to the app's window as it is now (Windows; nothing elsewhere). */
    void followAppWindow();
    /**
     * Windows: the message thread is about to be busy for a while (a plugin loading, its editor being made, a
     * sample read): until the returned hold is let go (on the message thread), no plugin window belongs to the
     * app's. Belonging to a window of another program ties the two programs' threads together: the app's
     * thread waits for ours whenever it moves, raises or activates a window, and shares its input with it, so
     * a plugin taking seconds to load would freeze the app for as long. Holds nest; nothing elsewhere.
     */
    static std::shared_ptr<void> whileBusy();
    /** The typing piano takes note keys before a plugin can consume them. */
    static bool typingKeyboard;

    /**
     * The parameter last touched in it (by index, and its name): its title bar then offers to automate it
     * (Automate "Cutoff"), which calls `onAutomate` with the index.
     */
    void setTouched (int index, const juce::String& name);
    std::function<void (int)> onAutomate;
    /**
     * FL's preset browser in the title bar: what it's on (`label`: a preset's or program's name, or empty)
     * and, with `canStep`, arrows to the previous and next (`onStep` with -1 or 1).
     */
    void setPreset (const juce::String& label, bool canStep);
    std::function<void (int)> onStep;
    /** Its wrapper button (FL's Wrapper settings): the channel's settings window, in the app. */
    std::function<void()> onSettings;
    void resized() override;
    /** Called when it becomes the active window (it was clicked, or opened): the app stacks its own windows by it. */
    std::function<void()> onActivated;

    int getDesktopWindowStyleFlags() const override;

private:
    static void* owner;
    /** How many `whileBusy` holds are out. */
    static int busy;
    /** Shown while busy: brought to the front once the holds are let go. */
    bool raiseWhenOwned = false;
    /**
     * A new window is cloaked (`cloakWindow`) until it has been drawn: until the message thread, which draws it
     * and the plugin's editor, has kept time for a few ticks in a row (or a second has gone by).
     */
    void timerCallback() override;
    juce::uint32 cloakedAt = 0, lastTick = 0;
    int calmTicks = 0;
    void activeWindowStatusChanged() override;
    /** Its peer may be made again (a style change): the new one belongs to the app's window too. */
    void parentHierarchyChanged() override;
    using DocumentWindow::keyPressed;
    /** Keys the plugin didn't use (Space, F6, ⌘Z…) go to the app, which runs its shortcut (`EngineEvent` "key"). */
    bool keyPressed (const juce::KeyPress&, juce::Component*) override;

    /**
     * Windows: a key offered before the plugin sees it (`hookThreadKeys`), FL's default typing keyboard
     * priority: the editor's keys (Space, the F keys, Alt+1…5, Ctrl+T and Ctrl+R) and, while the typing keyboard
     * is on, its note keys are the app's even when the plugin has the focus. True: taken (sent to the app).
     */
    bool takeFirst (const juce::KeyPress& key, bool down, bool repeat);
    /** The open windows, for the key hook to find the one a key was pressed in. */
    static juce::Array<EditorWindow*> openWindows;
    /** Keys `takeFirst` took down: their ups are swallowed too. */
    std::set<int> takenDown;

    bool keyStateChanged (bool, juce::Component*) override;
    void focusOfChildComponentChanged (FocusChangeType) override;
    void releaseKeys();
    std::map<int, juce::var> heldKeys;

    std::function<void()> onClose;
    /** The title bar's Automate button, shown once a parameter has been touched. */
    std::unique_ptr<juce::Button> automate;
    /** The preset browser (arrows and the preset's name) and the wrapper button. */
    std::unique_ptr<juce::Component> presetBar;
    std::unique_ptr<juce::Button> settings;
    int touched = -1;
    /** Its title bar's look; outlives the window's use of it (`setLookAndFeel (nullptr)` first). */
    std::unique_ptr<juce::LookAndFeel> look;
    juce::Component::SafePointer<juce::Component> editor;
};

/**
 * A key as the page names it (`KeyboardEvent`'s `key`, `code` and modifiers), or void for a key the app
 * has no use for. Only the keys its shortcuts use are named.
 */
juce::var describeKey (const juce::KeyPress&);

/**
 * Stereo in and out on a plugin's main buses and nothing else (no extra outputs), ready to play; with
 * `sidechain` (a mixer effect's), its sidechain input too when it has one.
 */
inline void configurePlugin (juce::AudioPluginInstance& plugin, double sampleRate, int blockSize, bool sidechain = false)
{
    auto layout = plugin.getBusesLayout();
    for (auto* buses : { &layout.inputBuses, &layout.outputBuses })
        for (int i = 0; i < buses->size(); ++i)
            buses->getReference (i) = i == 0 ? juce::AudioChannelSet::stereo() : juce::AudioChannelSet::disabled();
    plugin.setBusesLayout (layout);
    // An effect's sidechain input (its second input bus: `docs/sidechain.md`), stereo or else mono, if it takes either.
    if (sidechain && layout.inputBuses.size() > 1)
        for (const auto& set : { juce::AudioChannelSet::stereo(), juce::AudioChannelSet::mono() })
        {
            auto keyed = layout;
            keyed.inputBuses.getReference (1) = set;
            if (plugin.checkBusesLayoutSupported (keyed) && plugin.setBusesLayout (keyed))
                break;
        }
    plugin.setRateAndBufferSizeDetails (sampleRate, blockSize);
    plugin.prepareToPlay (sampleRate, blockSize);
}
