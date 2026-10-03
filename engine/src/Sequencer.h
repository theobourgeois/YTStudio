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

/** A channel's preview on its way into the song (`Sequencer::process`): heard where its clips play. */
struct ChannelFeed
{
    /** The song's channel it goes to (null: none). */
    const juce::String* channel = nullptr;
    const float* left = nullptr;
    const float* right = nullptr;
};

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
    /**
     * The channel MIDI keyboards play (the rack's selected one, by id; empty: none). Notes already held
     * end on the channel they started on.
     */
    void setMidiTarget (const juce::String& channelId);
    /**
     * What was played on MIDI keyboards since the last call (message thread), as `MidiPlayed` events:
     * each note on and off, its channel, and where the song was (the engine's tick into the loop, its pass
     * round it; null while stopped). Empty: nothing.
     */
    juce::Array<juce::var> takePlayed();

    // Any thread ---------------------------------------------------------------
    /**
     * A message from a MIDI keyboard (MIDI's own threads, or the `midiIn` command): it's played on the
     * target channel at the start of the next block. Never waits for the audio thread.
     */
    void midiIn (const juce::MidiMessage& message);
    /** Delete the songs the audio thread has let go of. Call regularly. */
    void collectGarbage();
    /** Have the audio clips about to play ready to start on time (they're streamed from disk). Call regularly, and before each offline block. */
    void prepareClips();

    /**
     * Each mixer track's loudest sample on each side (after its fader) since the last call, as
     * `{ trackId: [left, right] }`, leaving out tracks quieter than `floor`. Message thread.
     */
    juce::var takeMeters (float floor);
    /** Each modulator's level now, by id (`EngineTransport.modulators`; message thread). */
    juce::var describeModulators() const;
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
    /**
     * Delay compensation's delay lines start empty with the next song, rather than carrying on what's in
     * them (the transport's reset, `Engine::silence`). Only while `process` isn't running.
     */
    void forgetDelayLines() { delayLines.clear(); }
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
     * that monitor them and recorded on the armed ones. `feed`: a channel's preview (`FilePreview`), heard
     * where its clips play, through its track.
     */
    void process (float* left, float* right, int numSamples, const float* const* inputs = nullptr, int numInputs = 0, ChannelFeed feed = {});

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
        /** Started by a MIDI key (`key`), it plays until the key is let go; held by the sustain pedal meanwhile. */
        int key = -1;
        bool sustained = false;
        // A shaped channel's (`renderShaped`) ------------------------------------------------------
        /** Samples since it started, and when its note was let go (seconds; negative: held). */
        juce::int64 elapsed = 0;
        double released = -1;
        /** Its note's own pan (-1..1), moved by the channel's pan envelope and LFO. */
        float notePan = 0;
        /** It goes round its channel's loop while held (a note's or a key's, not a one-off hearing). */
        bool loops = false;
        /** Its filter's state, each side. */
        float filterA[2] {}, filterB[2] {};
    };

    /** A MIDI message as it came, waiting for the audio thread. */
    struct MidiEvent
    {
        juce::uint8 bytes[3] {};
        int size = 0;
    };

    /** A note played on a MIDI keyboard, as the audio thread heard it: what `takePlayed` says. */
    struct Played
    {
        int channel = -1, key = 0;
        float velocity = 0;
        bool on = false;
        /** Where the song was (the engine's tick, into the loop), and its pass round it; `playing` false: stopped. */
        bool playing = false, counting = false;
        double tick = 0;
        juce::uint32 pass = 0;
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
    void processBlock (float* left, float* right, int numSamples, const float* const* inputs, int numInputs, ChannelFeed feed);
    /** Drive the automated controls over the next `numSamples` (from `position_`). */
    void applyLanes (int numSamples);
    /** Put the automated controls back as the song has them unautomated, and plugins' parameters to their own values. */
    void restoreLanes (Song&);
    /** Take each automated plugin parameter's own value (what it is when play starts), or `previous`'s where it automated it too. */
    void takeOwnValues (Song& next, Song* previous);
    /** A lane's controls set to `start` (gains gliding from `from` to `to` across the block), `into` the slice. */
    void driveLane (Song::Lane&, const float* start, const std::array<float, 4>& from, const std::array<float, 4>& to, int into);
    /** Drive the modulated controls over the next `numSamples` (playing or not), each at its modulator's level. */
    void applyModulated (int numSamples);
    /** Follow each modulator's source over the block just mixed. */
    void followModulators (int numSamples);
    /** A track's pair in the song's audio at a tap (-1: none). */
    int tapPair (const Song::Track& source, Song::Track::Tap tap) const;
    /** The transport from sample `start` of the block to its end. */
    void schedule (int start, int numSamples);
    /** The count-in's part of the block (its clicks), in samples: the transport moves after it. */
    int countIn (int numSamples);
    void scheduleRange (double from, double to, double origin, int offset, int length, double ticksPerSample);
    /** Make a new play (or stop): its number, published for the audio thread to pick up with the request. */
    juce::uint32 nextGeneration();
    Voice* startVoice (int channel, float pitch, float gain, double lengthTicks, int delay, float pan = 0);
    /** Play what MIDI keyboards sent since the last block (start of a block, a song playing). */
    void playMidi();
    /** A MIDI key let go of on a channel: a plugin's note ends, a sampler's voice goes into its release (or waits for the pedal). */
    void releaseKey (int channel, int key);
    /** The channel MIDI plays now (the audio thread's view of `midiTarget`), or -1. */
    int midiChannel() const;
    /** A note for a channel's plugin: on at `delay` samples into the block, off `lengthSamples` later. */
    void startNote (HostedPlugin&, int key, float velocity, juce::int64 lengthSamples, int delay);
    /** Send the note-offs that fall in this block, and count the others down. */
    void endNotes (HostedPlugin&, int numSamples);
    void silencePlugins();
    void renderPlugins (int numSamples);
    void render (Voice& voice, int numSamples);
    /** A voice of a channel with a loop, a filter, or envelopes and LFOs beyond its volume's (`Song::Channel::shaped`). */
    void renderShaped (Voice& voice, int numSamples);
    /** Put a track's sound through an effect, `mix` of it heard against the dry sound. */
    /** A plugin effect on a block, its sidechain input given the key (null: none). */
    void runEffect (HostedPlugin&, float mix, float* left, float* right, int numSamples, const float* keyLeft = nullptr, const float* keyRight = nullptr);
    /** An effect's key for this block, lined up with its sound (its delay line run), or nulls without one. */
    std::pair<const float*, const float*> keyOf (const Song::Track::Effect&, int numSamples);
    /** Put a track's sound through a Gross Beat (`mix` of it heard against the dry sound), following `grossClock`. */
    void runGrossBeat (const Song::Track::Effect&, float* left, float* right, int numSamples);
    /** Put a track's sound through an EchoBoy (`mix` of it heard against the dry sound). */
    void runEchoBoy (const Song::Track::Effect&, float* left, float* right, int numSamples);
    /** Put a track's sound through a Pro-Q (`mix` of it heard against the dry sound, held back by its latency). */
    void runProQ (const Song::Track::Effect&, float* left, float* right, int numSamples, const float* keyLeft, const float* keyRight);
    /** Put a track's sound through an OTT (`mix` of it heard against the dry sound). */
    void runOtt (const Song::Track::Effect&, float* left, float* right, int numSamples);
    /** An automation lane's value for a Pro-Q's band control (`Song::Lane::band`, `control`). */
    static void setEqControl (eq::Settings&, int band, int control, float value);
    /** An automation lane's value for a Gross Beat's control (`Song::Lane::control`). */
    static void setGrossControl (gross::Settings&, int control, float value);
    /** Put a track's sound through a PanMan (`mix` of it heard against the dry sound), following `grossClock`. */
    void runPanMan (const Song::Track::Effect&, float* left, float* right, int numSamples);
    /** An automation lane's value for a PanMan's control (`Song::Lane::control`). */
    static void setPanControl (panman::Settings&, int control, float value);
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

    /** MIDI keyboards' messages: several threads may write (one at a time, by `midiWriting`), the audio thread reads. */
    static constexpr int midiQueueSize = 1024;
    juce::AbstractFifo midiQueue { midiQueueSize };
    std::array<MidiEvent, midiQueueSize> midiEvents {};
    juce::SpinLock midiWriting;
    /** What the audio thread played of them, for the message thread (`takePlayed`). */
    juce::AbstractFifo playedQueue { midiQueueSize };
    std::array<Played, midiQueueSize> played {};
    /** The MIDI target (message thread), and the audio thread's view of it: the song's serial it's for and its channel + 1, packed. */
    juce::String midiTargetId;
    std::atomic<juce::uint64> midiTarget { 0 };
    /** The audio thread's: the channel each MIDI key held went to (-1: not held), and the sustain pedal. */
    std::array<int, 128> heldKeys {};
    /** The key each one held was sent to its plugin as (moved by the channel's pitch then). */
    std::array<int, 128> sentKeys {};
    bool pedal = false;
    /** The channels of the song last handed over (message thread), to name a trigger's channel. */
    juce::StringArray channelIds;
    /** The tracks of the song last handed over and each one's sends' tracks' ids (message thread), to match the next song's to them. */
    juce::StringArray trackIds;
    std::vector<juce::StringArray> sendIds;
    juce::uint64 serials = 0;
    /** The last song's delay lines (message thread), by path: "c<channel>", "s<track>><track>". */
    std::map<juce::String, std::shared_ptr<DelayLine>> delayLines;
    /** The modulators' followers (message thread), by id, handed to the next song so they carry on. */
    std::map<juce::String, std::shared_ptr<Song::ModulatorState>> modulatorStates;
    /** Set when a song is adopted: its first block ramps from the last song's gains to its own. */
    bool ramping = false;
    /**
     * While a song with automation plays, it's rendered in slices this long, counted from where play
     * started (`sliceClock`), so the same song sounds the same whatever the blocks it's asked for (the
     * device's, the export's): gains glide across a slice, plugin parameters are set at its start.
     */
    static constexpr int sliceSamples = 256;
    /**
     * A song with modulated controls is rendered in slices this long too (playing or not), counted from where
     * play started (`modClock`, which runs on while stopped): each modulated control is set at a slice's
     * start from its modulator's level at the end of the last one (`docs/sidechain.md`). Divides `sliceSamples`.
     */
    static constexpr int modSlice = 64;
    juce::int64 modClock = 0;
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
