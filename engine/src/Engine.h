// The audio engine: the audio device (or none, offline), and what plays through it, which is the
// song (`Sequencer`), the test tone, and the plugin bench's instrument and effect (`PluginBench`).
//
// Commands arrive on the message thread (`handle`); `process` is the real-time side and never waits:
// the song reaches it lock-free, and the bench is skipped for a block if it's busy being changed.
#pragma once

#include "Export.h"
#include "FilePreview.h"
#include "MidiInputs.h"
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

    /** One block of the engine's output: the whole real-time path, whoever asks for it. `inputs`: the device's input channels by number (null: not open). */
    void process (float* const* output, int numOutputs, int numSamples, const float* const* inputs = nullptr, int numInputs = 0);
    /**
     * Offline: compute `frames` samples now and measure them (and write them to `file`, a WAV, if
     * given). `input`, a WAV, stands in for the device's inputs from now on (its channels are inputs
     * 0, 1...), going on where the last render left it; "none" takes it away.
     */
    void render (int frames, const juce::File& file, const juce::String& input, Reply reply);
    /** Start recording (`RecordRequest`, the server's folder and id added): the armed tracks of the song playing. */
    juce::Result record (const juce::var& params);
    /** Tell the server of the takes finished since last time. */
    void reportTakes();
    /** Tell the server what was played on MIDI keyboards since last time. */
    void reportPlayed();
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
    /**
     * Every sound stops, tails too (FL's Stop pressed while stopped, and its "Reset plugins on
     * transport"): playback stops, the device is let go of while every plugin is reset and our
     * effects' sounds are dropped, then the song is made again from silence.
     */
    void silence();
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
    /** Its Gross Beats' sounds, by effect id (the songs hold them too, so it doesn't matter where this is). */
    gross::Registry grossBeats;
    /** Its Auto-Tunes' sounds, by effect id, likewise. */
    tune::Registry autoTunes;
    /** Its EchoBoys' sounds, by effect id. */
    echo::Registry echoBoys;
    /** Its Pro-Qs' sounds, likewise. */
    eq::Registry eqs;
    /** Its OTTs' sounds, likewise. */
    ott::Registry otts;
    /** Its PanMen's sounds, likewise. */
    panman::Registry panMen;
    /** Its Pitch Wheels' sounds, by effect id. */
    wheel::Registry pitchWheels;
    Sequencer sequencer;
    /** The Browser's preview of a file, outside the song. */
    FilePreview preview;
    /** MIDI keyboards (none offline: `midiIn` stands in). After the sequencer, which they play. */
    std::unique_ptr<MidiInputs> midiInputs;
    /** The song as it was last given, to build it again when one of its plugins has finished loading. */
    juce::var lastSong;
    /** Its armed tracks with an input: what a recording records. */
    std::vector<Recorder::Source> armed;
    /** The device's input channels each of the callback's inputs is (the open ones, in order). */
    std::vector<int> inputMap;
    static constexpr int maxInputs = 64;
    /** Offline: what stands in for the device's inputs, and how far into it the renders are. */
    juce::AudioBuffer<float> testInput;
    int testInputPosition = 0;

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
