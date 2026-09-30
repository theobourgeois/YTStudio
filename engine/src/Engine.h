// The audio engine: the audio device, the plugins it hosts and what plays through them.
//
// For now (the spike) that's one instrument into one effect, plus a test tone. Commands arrive on
// the message thread (`handle`); `audioDeviceIOCallbackWithContext` is the real-time side, and the
// two only meet under `audioLock`, which the audio thread never waits for (it plays silence instead).
#pragma once

#include <functional>
#include <juce_audio_devices/juce_audio_devices.h>
#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_audio_utils/juce_audio_utils.h>

class Engine final : private juce::AudioIODeviceCallback,
                     private juce::Timer
{
public:
    /** A command's answer: a result, or what went wrong (said to the user). */
    using Reply = std::function<void (const juce::Result&, const juce::var&)>;

    /** `dataDir` keeps the list of scanned plugins; `pluginPaths` are searched besides the usual folders. */
    Engine (const juce::File& dataDir, const juce::StringArray& pluginPaths);
    ~Engine() override;

    /** Run a command (message thread). `reply` is called once, possibly later. */
    void handle (const juce::String& command, const juce::var& params, Reply reply);

    juce::var status() const;

private:
    struct Slot
    {
        std::unique_ptr<juce::AudioPluginInstance> plugin;
        std::unique_ptr<juce::DocumentWindow> window;
        juce::String id;
        juce::var describe() const;
    };

    void audioDeviceIOCallbackWithContext (const float* const*, int, float* const*, int, int,
                                           const juce::AudioIODeviceCallbackContext&) override;
    void audioDeviceAboutToStart (juce::AudioIODevice*) override;
    void audioDeviceStopped() override;
    void timerCallback() override;

    Slot* slotNamed (const juce::var& params, Reply& reply);
    void startScan (bool rescan);
    void load (Slot&, const juce::String& pluginId, Reply reply);
    void unload (Slot&);
    void prepare (juce::AudioPluginInstance&) const;
    void sizeScratch();
    juce::var plugins() const;

    juce::AudioDeviceManager devices;
    juce::AudioPluginFormatManager formats;
    juce::KnownPluginList known;
    juce::File knownFile, pedalFile;
    juce::StringArray extraPaths;

    // The scan in progress: one scanner per format, stepped a plugin at a time so commands still run.
    juce::OwnedArray<juce::PluginDirectoryScanner> scanners;
    int scannerIndex = 0;
    juce::String scanningName;

    juce::CriticalSection audioLock;
    Slot instrument, effect;
    juce::MidiMessageCollector midi;
    juce::AudioBuffer<float> scratch;
    std::atomic<bool> tone { false };
    /** The loudest output sample since `status` last read it: a meter, and proof that sound comes out. */
    mutable std::atomic<float> peak { 0.0f };
    double tonePhase = 0.0;
    double sampleRate = 0.0;
    int blockSize = 0;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (Engine)
};
