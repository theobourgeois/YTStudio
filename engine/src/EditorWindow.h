// A plugin's own interface in a window of ours (FL Studio's plugin wrapper: docs/fl-studio/plugin-window.md).
// The engine is a program of its own, so the window can't be inside the app's: it's made to act as if it
// were (our own title bar; the keys the plugin doesn't use go to the app; `PluginHost::setHost` floats,
// hides and moves it with the app's window).
#pragma once

#include <functional>
#include <map>
#include <juce_audio_utils/juce_audio_utils.h>

class EditorWindow final : public juce::DocumentWindow,
                           private juce::KeyListener
{
public:
    /** `onCloseButton` is told the window's × was pressed: closing it (deleting it) is the owner's to do. */
    EditorWindow (juce::AudioPluginInstance& plugin, const juce::String& title, std::function<void()> onCloseButton);
    ~EditorWindow() override;

    void closeButtonPressed() override { onClose(); }

    /** Bring it in front of the other apps' windows: the engine has no Dock icon to do it from. */
    void show();
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

private:
    using DocumentWindow::keyPressed;
    /** Keys the plugin didn't use (Space, F6, ⌘Z…) go to the app, which runs its shortcut (`EngineEvent` "key"). */
    bool keyPressed (const juce::KeyPress&, juce::Component*) override;

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
