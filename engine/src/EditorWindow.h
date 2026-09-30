// A plugin's own window: its editor, or a row per parameter for plugins without one.
#pragma once

#include <functional>
#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_audio_utils/juce_audio_utils.h>

class EditorWindow final : public juce::DocumentWindow
{
public:
    /** `onCloseButton` is told the window's × was pressed: closing it (deleting it) is the owner's to do. */
    EditorWindow (juce::AudioPluginInstance& plugin, const juce::String& title, std::function<void()> onCloseButton)
        : DocumentWindow (title, juce::Colours::black, DocumentWindow::closeButton | DocumentWindow::minimiseButton),
          onClose (std::move (onCloseButton))
    {
        juce::AudioProcessorEditor* editor = plugin.hasEditor() ? plugin.createEditorIfNeeded() : nullptr;
        if (editor == nullptr)
            editor = new juce::GenericAudioProcessorEditor (plugin);
        setUsingNativeTitleBar (true);
        setContentOwned (editor, true);
        setResizable (editor->isResizable(), false);
        centreWithSize (getWidth(), getHeight());
        setVisible (true);
    }

    ~EditorWindow() override { clearContentComponent(); }

    void closeButtonPressed() override { onClose(); }

    /** Bring it in front of the other apps' windows: the engine has no Dock icon to do it from. */
    void show()
    {
        juce::Process::makeForegroundProcess();
        toFront (true);
    }

private:
    std::function<void()> onClose;
};

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
