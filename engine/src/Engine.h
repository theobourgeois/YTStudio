// The audio engine: the audio device (or none, offline), and what plays through it, which is the
// song (`Sequencer`), the test tone, and the plugin bench's instrument and effect (`PluginBench`).
//
// Commands arrive on the message thread (`handle`); `process` is the real-time side and never waits:
// the song reaches it lock-free, and the bench is skipped for a block if it's busy being changed.
#pragma once

#include "Plugins.h"
#include "Sequencer.h"
#include "Song.h"

#include <functional>
#include <juce_audio_devices/juce_audio_devices.h>

class Engine final : private juce::AudioIODeviceCallback,
                     private juce::Timer
{
public:
    /** A command's answer: a result, or what went wrong (said to the user). */
    using Reply = std::function<void (const juce::Result&, const juce::var&)>;

    /**
     * `dataDir` keeps what the engine remembers (scanned plugins, the device chosen); `pluginPaths`
     * are searched besides the usual folders. `offline` opens no audio device: sound is only made by
     * the `render` command, as fast as it computes (tests, and later the export), so the same input
     * always gives the same samples. `onlyPluginPaths` leaves this computer's own plugins out of scans.
     */
    Engine (const juce::File& dataDir, const juce::StringArray& pluginPaths, bool offline, bool onlyPluginPaths);
    ~Engine() override;

    /** Run a command (message thread). `reply` is called once, possibly later. */
    void handle (const juce::String& command, const juce::var& params, Reply reply);

    juce::var status() const;

private:
    void audioDeviceIOCallbackWithContext (const float* const*, int, float* const*, int, int,
                                           const juce::AudioIODeviceCallbackContext&) override;
    void audioDeviceAboutToStart (juce::AudioIODevice*) override;
    void audioDeviceStopped() override;
    /** Tells the server where the song is while it plays, and tidies up after the audio thread. */
    void timerCallback() override;

    /** One block of the engine's output: the whole real-time path, whoever asks for it. */
    void process (float* const* output, int numOutputs, int numSamples);
    /** Offline: compute `frames` samples now and measure them (and write them to `file`, a WAV, if given). */
    void render (int frames, const juce::File& file, Reply reply);
    /** A device, or the offline engine, (re)starts at this rate and block size. */
    void start (double rate, int block);

    juce::var transport() const;
    juce::var deviceOptions() const;
    juce::Result setDevice (const juce::var& params);
    void sendStatus() const;

    const bool offline;
    juce::File deviceFile;
    juce::AudioDeviceManager devices;
    PluginBench bench;
    SampleCache samples;
    Sequencer sequencer;

    /** The song and the tone, before the bench's effect. */
    juce::AudioBuffer<float> mix;
    std::atomic<bool> tone { false };
    /** The output's level, falling back slowly: a meter. */
    std::atomic<float> peak { 0.0f };
    double tonePhase = 0.0;
    double sampleRate = 0.0;
    int blockSize = 0;
    /** What the last transport event said, to say it again only when it changes. */
    bool saidPlaying = false;
    bool saidQuiet = true;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (Engine)
};
