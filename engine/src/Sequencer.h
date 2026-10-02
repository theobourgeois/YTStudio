// Plays a Song: the transport (a position in ticks, looping), the sampler's voices, the playlist's audio
// clips (`ClipPlayer`), the mixer's tracks (channels play into theirs, which add up into the master;
// a track's input is heard in it while it's monitored), the metronome, and recording (`Recorder`: the
// armed tracks' inputs written as play goes, after a count-in).
//
// Two threads meet here and neither waits for the other. The message thread hands over songs and
// requests (`setSong`, `play`, `stop`, `trigger`) through atomics and lock-free queues; the audio
// thread (`process`) picks them up at the start of a block. Songs it's done with go back the same
// way, to be deleted off the audio thread (`collectGarbage`).
#pragma once

#include "ClipPlayer.h"
#include "Recorder.h"
#include "Song.h"
#include "Workers.h"

#include <array>
#include <atomic>
#include <functional>
#include <map>
#include <utility>
#include <juce_audio_basics/juce_audio_basics.h>

class Sequencer
{
public:
    /** `offline`: audio clips' files are decoded on the rendering thread rather than a reader thread of their own. */
    explicit Sequencer (bool offline);
    ~Sequencer();

    /** The sample rate sound is made at. Only while `process` isn't running. */
    void prepare (double sampleRate);

    // Message thread ---------------------------------------------------------
    void setSong (std::unique_ptr<Song> song);
    /** From `fromTick` into the loop; if it's already playing, it goes there (what sounds is cut short). A recording in progress ends. */
    void play (double fromTick = 0);
    /**
     * Record (`recorder()` has been `start`ed): play from `fromTick` after `countInTicks` of the
     * metronome's clicks, the transport held meanwhile, and record from the moment it moves. Without
     * `loop`, play doesn't go round the loop: it goes on past its end until it's stopped.
     */
    void record (double fromTick, double countInTicks, bool loop);
    /** What records the armed tracks' inputs. */
    Recorder& recorder() { return recording; }
    const Recorder& recorder() const { return recording; }
    /** Stop, silence what's sounding and go back to the start. */
    void stop();
    void setMetronome (bool on) { metronome = on; }
    bool metronomeOn() const { return metronome; }
    /** The metronome's sound, by name ("beep", "tick", "tap", "hihat", "cowbell"); an unknown one is the beep. */
    void setMetronomeSound (const juce::String& name);
    /** One click of the metronome's sound (a bar's) now, playing or not: hearing a sound as it's chosen. */
    void auditionClick() { ++clickAuditions; }
    /** Play a channel's sample once, now (hearing a channel, outside the pattern). False: no such channel. */
    bool trigger (const juce::String& channelId, float pitch, float gain);
    /**
     * A key held on a channel (the Piano roll's keyboard): a plugin plays it until it's let go; a
     * sampler plays its sample at that pitch. False: no such channel.
     */
    bool preview (const juce::String& channelId, int key, float velocity, bool on);
    /** Delete the songs the audio thread has let go of. Call regularly. */
    void collectGarbage();
    /** Have the audio clips about to play ready to start on time (they're streamed from disk). Call regularly, and before each offline block. */
    void prepareClips();

    /**
     * Each mixer track's loudest sample on each side (after its fader) since the last call, as
     * `{ trackId: [left, right] }`, leaving out tracks quieter than `floor`. Message thread.
     */
    juce::var takeMeters (float floor);
    /**
     * The tracks the mixer's selection meter adds up (the selected ones), by id. Their sound after their
     * faders is added together and measured as one more meter, "@selection". Message thread.
     */
    void setMeteredTracks (const juce::StringArray& trackIds);

    /**
     * Run the song's plugins on these threads at once (the export's own sequencer; null: one after the
     * other, as playback does). Only while `process` isn't running.
     */
    void setWorkers (Workers* pool) { workers = pool; }
    /** A sequencer of the export's own: notes left sounding in the song's plugins end at its first block. */
    void silenceFirst() { silencing = true; }
    /**
     * Told after each part of a block it renders (`offset` samples in, `length` long), while the song's
     * mixer buffers hold that part: a song with automation is rendered in slices (the export's stems).
     * Only while `process` isn't running.
     */
    void setSliceListener (std::function<void (const Song&, int offset, int length)> listener) { onSlice = std::move (listener); }
    /**
     * The plugins' automated parameters get their own values back, and the automated controls theirs
     * (done with it, or set aside for the export). Only while `process` isn't running.
     */
    void release();
    /** The song playing (only on the thread that calls `process`, after it has once). */
    const Song* current() const { return song; }

    bool isPlaying() const { return playingNow; }
    /** Where the loop is, in ticks. */
    double position() const { return positionNow; }
    /** Seconds of count-in left (the transport holds meanwhile), or 0. */
    double countInSeconds() const { return (double) countInNow.load() / sampleRate; }

    // Audio thread -----------------------------------------------------------
    /**
     * Add the next `numSamples` of the song (the master's output, and the metronome) to `left` and
     * `right`. `inputs`: the device's input channels by number (null: not open), heard in the tracks
     * that monitor them and recorded on the armed ones.
     */
    void process (float* left, float* right, int numSamples, const float* const* inputs = nullptr, int numInputs = 0);

private:
    struct Voice
    {
        bool active = false;
        const Sample* sample = nullptr;
        int channel = 0;
        /** Where it is in its sample, and how far it moves per output sample at the note's own pitch. */
        double position = 0, baseRate = 1;
        float pitch = 0, gain = 1;
        /** The note's own pan, as what it leaves of each side. */
        float panLeft = 1, panRight = 1;
        /** Output samples before it starts (it began part-way through a block). */
        int delay = 0;
        /** Output samples until its note ends; negative: it plays until its sample does. */
        juce::int64 untilRelease = -1;
        enum class Stage { attack, decay, sustain, release } stage = Stage::attack;
        float level = 0, releaseStep = 0;
        /** Being silenced (stop, cut self): samples left of a short fade, or negative; and how long until it starts. */
        int fade = -1, fadeWait = 0;
        juce::uint32 age = 0;
    };

    struct Trigger
    {
        int channel;
        float pitch, gain;
        /** A held key: `hold` starts it, `release` lets it go. Otherwise it's played once. */
        enum class Kind { once, hold, release } kind = Kind::once;
        int key = 60;
        float velocity = 0.78f;
    };

    /** Set when the song stops: its plugins are told to end every note, in the next block. */
    bool silencing = false;

    void adopt (Song* next);
    /** The message thread's requests (a new song, play, stop), taken at the start of a block. */
    void takeRequests();
    /** A part of a block: the whole of it, or a slice when automation plays. */
    void processBlock (float* left, float* right, int numSamples, const float* const* inputs, int numInputs);
    /** Drive the automated controls over the next `numSamples` (from `position_`). */
    void applyLanes (int numSamples);
    /** Put the automated controls back as the song has them unautomated, and plugins' parameters to their own values. */
    void restoreLanes (Song&);
    /** Take each automated plugin parameter's own value (what it is when play starts), or `previous`'s where it automated it too. */
    void takeOwnValues (Song& next, Song* previous);
    /** The transport from sample `start` of the block to its end. */
    void schedule (int start, int numSamples);
    /** The count-in's part of the block (its clicks), in samples: the transport moves after it. */
    int countIn (int numSamples);
    void scheduleRange (double from, double to, double origin, int offset, int length, double ticksPerSample);
    /** Make a new play (or stop): its number, published for the audio thread to pick up with the request. */
    juce::uint32 nextGeneration();
    void startVoice (int channel, float pitch, float gain, double lengthTicks, int delay, float pan = 0);
    /** A note for a channel's plugin: on at `delay` samples into the block, off `lengthSamples` later. */
    void startNote (HostedPlugin&, int key, float velocity, juce::int64 lengthSamples, int delay);
    /** Send the note-offs that fall in this block, and count the others down. */
    void endNotes (HostedPlugin&, int numSamples);
    void silencePlugins();
    void renderPlugins (int numSamples);
    void render (Voice& voice, int numSamples);
    /** Put a track's sound through an effect, `mix` of it heard against the dry sound. */
    void runEffect (HostedPlugin&, float mix, float* left, float* right, int numSamples);
    /** Put a track's sound through a Gross Beat (`mix` of it heard against the dry sound), following `grossClock`. */
    void runGrossBeat (const Song::Track::Effect&, float* left, float* right, int numSamples);
    /** Put a track's sound through a Pro-Q (`mix` of it heard against the dry sound, held back by its latency). */
    void runProQ (const Song::Track::Effect&, float* left, float* right, int numSamples);
    /** An automation lane's value for a Pro-Q's band control (`Song::Lane::band`, `control`). */
    static void setEqControl (eq::Settings&, int band, int control, float value);
    /** An automation lane's value for a Gross Beat's control (`Song::Lane::control`). */
    static void setGrossControl (gross::Settings&, int control, float value);
    /** Run the mixer's tracks in order and add the master's sound to `left` and `right`. */
    void mixTracks (float* left, float* right, int numSamples);
    /** A track's effects, fader and meter (`mixTracks`): its own buffers alone, so a stage's run at once. */
    void runTrack (size_t t, bool glide, int numSamples);
    /**
     * Run `job (i)` for `i` in `[0, count)`: on the workers if there are some (the export), else in turn
     * (playback: nothing is made, so nothing is allocated on the audio thread).
     */
    template <typename Job>
    void each (int count, Job&& job)
    {
        if (workers != nullptr && count > 1)
            workers->run (count, std::function<void (int)> (job));
        else
            for (int i = 0; i < count; ++i)
                job (i);
    }
    /** A channel's track's two buffers, or nulls if it has none. */
    std::pair<float*, float*> trackAudio (int channel);
    void renderClick (float* left, float* right, int numSamples);
    void silenceVoices();

    static constexpr int maxVoices = 128;
    static constexpr int queueSize = 64;

    double sampleRate = 48000.0;
    /** The audio thread's. */
    Song* song = nullptr;
    std::atomic<Song*> pending { nullptr };
    juce::AbstractFifo garbageQueue { queueSize };
    std::array<Song*, queueSize> garbage {};

    juce::AbstractFifo triggerQueue { queueSize };
    std::array<Trigger, queueSize> triggers {};
    /** The channels of the song last handed over (message thread), to name a trigger's channel. */
    juce::StringArray channelIds;
    /** The tracks of the song last handed over and each one's sends' tracks' ids (message thread), to match the next song's to them. */
    juce::StringArray trackIds;
    std::vector<juce::StringArray> sendIds;
    juce::uint64 serials = 0;
    /** The last song's delay lines (message thread), by path: "c<channel>", "s<track>><track>". */
    std::map<juce::String, std::shared_ptr<DelayLine>> delayLines;
    /** Set when a song is adopted: its first block ramps from the last song's gains to its own. */
    bool ramping = false;
    /**
     * While a song with automation plays, it's rendered in slices this long, counted from where play
     * started (`sliceClock`), so the same song sounds the same whatever the blocks it's asked for (the
     * device's, the export's): gains glide across a slice, plugin parameters are set at its start.
     */
    static constexpr int sliceSamples = 256;
    /** The most input channels the device can give (`Engine`'s too). */
    static constexpr int maxInputs = 64;
    juce::int64 sliceClock = 0;
    /** Where play started (ticks): with `sliceClock`, where each slice is, exactly (the position adds up rounding as it goes). */
    double playStart = 0;
    /** The automated controls are being driven (it's playing a song with lanes): they're put back when it stops. */
    bool lanesLive = false;
    std::function<void (const Song&, int, int)> onSlice;

    std::atomic<int> playRequests { 0 }, stopRequests { 0 };
    std::atomic<double> playFrom { 0.0 };
    /** What the last play request asks for besides: a count-in first (ticks), to record, and not to go round the loop. */
    std::atomic<double> playCountIn { 0.0 };
    std::atomic<bool> playRecords { false }, playThrough { false };
    int playsSeen = 0, stopsSeen = 0;
    std::atomic<bool> metronome { false };
    enum class ClickSound { beep, tick, tap, hihat, cowbell };
    std::atomic<ClickSound> clickSound { ClickSound::beep };
    std::atomic<int> clickAuditions { 0 };
    int clickAuditionsSeen = 0;

    /** The audio clips: their streams, made ahead on the message thread. */
    ClipPlayer clips;
    /** Every play and every stop is a new generation, so streams made for one don't play in another. The message thread's count, and the one it asks for. */
    juce::uint32 generations = 0;
    std::atomic<juce::uint32> requestedGeneration { 0 };
    /** The message thread's copy of the last song's loop length (where play starts is within it). */
    double loopTicks = 1;

    bool playing = false;
    /** Play has just begun (a Gross Beat's buffer starts afresh): until the transport first moves. */
    bool playStarted = false;
    /** Where the song is over the block being made, for Gross Beats. */
    gross::Clock grossClock;
    double position_ = 0;
    /** The audio thread's count-in: samples of it left and done; a recording waiting for it to end; play not going round the loop. */
    juce::int64 countInLeft = 0, countInDone = 0;
    bool recordWaiting = false, through = false;
    Recorder recording;
    /** The audio thread's play generation, and how many times round the loop it's been since play started. */
    juce::uint32 generation = 0, pass = 0;
    std::atomic<bool> playingNow { false };
    std::atomic<double> positionNow { 0.0 };
    std::atomic<juce::int64> countInNow { 0 };
    std::atomic<juce::uint32> generationNow { 0 }, passNow { 0 };

    /** The meters: two per track of the song `meterSerial` names, by its tracks' order. The audio thread raises them, `takeMeters` takes them back to 0. */
    static constexpr int maxMeters = 1024;
    std::array<std::atomic<float>, maxMeters * 2> meters {};
    std::atomic<juce::uint64> meterSerial { 0 };
    /** The selection meter: which tracks it adds up (by index into the song `selectionSerial` names), and its level. */
    juce::StringArray meteredIds;
    std::array<std::atomic<bool>, maxMeters> metered {};
    std::atomic<juce::uint64> selectionSerial { 0 };
    std::array<std::atomic<float>, 2> selectionMeter {};
    /** Mark `meteredIds` among the tracks of the song with `serial`, ordered as `ids`. */
    void markMetered (const juce::StringArray& ids, juce::uint64 serial);

    std::array<Voice, maxVoices> voices;
    Workers* workers = nullptr;
    juce::uint32 voiceCount = 0;

    /** The metronome's click: a short decaying sound, made here (`renderClick`). */
    struct
    {
        int delay = -1;
        /** Starting on a bar: higher, or louder. Set with `delay`. */
        bool bar = false;
        ClickSound sound = ClickSound::beep;
        double phase = 0, phase2 = 0, frequency = 1000;
        float level = 0, gain = 0, decay = 0;
        /** The hi-hat's noise and its high-pass filter. */
        juce::uint32 noise = 0x9e3779b9u;
        float highPass = 0, lastNoise = 0;
    } click;
    /** Start the click due this block, from `click.delay` and `click.bar`. */
    void startClick();

    JUCE_DECLARE_NON_COPYABLE (Sequencer)
};
