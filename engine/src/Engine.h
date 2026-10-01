// The audio engine: the audio device (or none, offline), and what plays through it, which is the
// song (`Sequencer`), the test tone, and the plugin bench's instrument and effect (`PluginBench`).
//
// Commands arrive on the message thread (`handle`); `process` is the real-time side and never waits:
// the song reaches it lock-free, and the bench is skipped for a block if it's busy being changed.
#pragma once

#include "Export.h"
#include "FilePreview.h"
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
    /**
     * Export the song in `params` (`EngineExportRequest`), once its plugins have loaded (`attempt`: how
     * many times it's waited). Playback stops while it runs: the device is let go of, the plugins are
     * prepared for the export's blocks and told it's offline. Songs sent meanwhile wait for it to end.
     */
    void startExport (const juce::var& params, Reply reply, int attempt);
    /** The export has ended (done, failed or aborted): playback comes back, with the latest song. */
    void finishExport (const juce::String& id, juce::var result, const juce::StringArray& missing);
    double rate() const;

    juce::var transport() const;
    juce::var deviceOptions() const;
    juce::Result setDevice (const juce::var& params);
    /** Hand the song to the sequencer, with whichever of its plugins are loaded by now. */
    juce::StringArray applySong();
    /** A song's plugin has loaded, failed or had its window closed. */
    void pluginChanged();
    /** A plugin's reported delay has changed since the song was made: make it again, compensated anew. */
    void checkLatencies();
    void sendStatus() const;

    const bool offline;
    juce::File deviceFile;
    juce::AudioDeviceManager devices;
    PluginBench bench;
    SampleCache samples;
    /**
     * The song's own plugins: its plugin channels' instruments and its mixer's effects. Before the
     * sequencer, which plays them: they must outlive the songs there.
     */
    PluginHost plugins;
    PluginHost effects;
    Sequencer sequencer;
    /** The Browser's preview of a file, outside the song. */
    FilePreview preview;
    /** The song as it was last given, to build it again when one of its plugins has finished loading. */
    juce::var lastSong;

    /** The song and the tone, before the bench's effect. */
    juce::AudioBuffer<float> mix;
    std::atomic<bool> tone { false };
    /** The output's level, falling back slowly: a meter. */
    std::atomic<float> peak { 0.0f };
    double tonePhase = 0.0;
    double sampleRate = 0.0;
    int blockSize = 0;
    /** How late the song's sound comes out (its compensated plugin delays), in samples, and the plugins' delays it was worked out from. */
    int songLatency = 0;
    juce::int64 latencies = 0;
    /** What the last transport event said, to say it again only when it changes. */
    bool saidPlaying = false;
    bool saidQuiet = true;
    bool saidPreviewing = false;

    /** Says how far the export is, while it runs. */
    struct Ticker final : juce::Timer
    {
        std::function<void()> tick;
        void timerCallback() override { tick(); }
    };
    Ticker exportTicker;
    juce::String exportId;
    /** So an export that ends after the engine has gone does nothing. */
    std::shared_ptr<bool> alive = std::make_shared<bool> (true);
    /** Last: it plays the song's plugins, so it goes before them. */
    std::unique_ptr<SongExport> exportJob;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (Engine)
};
