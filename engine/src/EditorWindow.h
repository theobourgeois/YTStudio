// A plugin's own interface in a window of ours (FL Studio's plugin wrapper: docs/fl-studio/plugin-window.md).
// The engine is a program of its own, so the window can't be inside the app's: it's made to act as if it
// were (our own title bar; the keys the plugin doesn't use go to the app; `PluginHost::setHost` floats,
// hides and moves it with the app's window).
#pragma once

#include <functional>
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

    /**
     * The parameter last touched in it (by index, and its name): its title bar then offers to automate it
     * (Automate "Cutoff"), which calls `onAutomate` with the index.
     */
    void setTouched (int index, const juce::String& name);
    std::function<void (int)> onAutomate;
    void resized() override;

private:
    using DocumentWindow::keyPressed;
    /** Keys the plugin didn't use (Space, F6, ⌘Z…) go to the app, which runs its shortcut (`EngineEvent` "key"). */
    bool keyPressed (const juce::KeyPress&, juce::Component*) override;

    std::function<void()> onClose;
    /** The title bar's Automate button, shown once a parameter has been touched. */
    std::unique_ptr<juce::Button> automate;
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

/** Stereo in and out on a plugin's main buses and nothing else (no sidechains, no extra outputs), ready to play. */
inline void configurePlugin (juce::AudioPluginInstance& plugin, double sampleRate, int blockSize)
{
    auto layout = plugin.getBusesLayout();
    for (auto* buses : { &layout.inputBuses, &layout.outputBuses })
        for (int i = 0; i < buses->size(); ++i)
            buses->getReference (i) = i == 0 ? juce::AudioChannelSet::stereo() : juce::AudioChannelSet::disabled();
    plugin.setBusesLayout (layout);
    plugin.setRateAndBufferSizeDetails (sampleRate, blockSize);
    plugin.prepareToPlay (sampleRate, blockSize);
}
