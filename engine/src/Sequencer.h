// Plays a Song: the transport (a position in ticks, looping), the sampler's voices, the playlist's audio
// clips (`ClipPlayer`), the mixer's tracks (channels play into theirs, which add up into the master) and
// the metronome.
//
// Two threads meet here and neither waits for the other. The message thread hands over songs and
// requests (`setSong`, `play`, `stop`, `trigger`) through atomics and lock-free queues; the audio
// thread (`process`) picks them up at the start of a block. Songs it's done with go back the same
// way, to be deleted off the audio thread (`collectGarbage`).
#pragma once

#include "ClipPlayer.h"
#include "Song.h"

#include <array>
#include <atomic>
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
    /** From `fromTick` into the loop; if it's already playing, it goes there (what sounds is cut short). */
    void play (double fromTick = 0);
    /** Stop, silence what's sounding and go back to the start. */
    void stop();
    void setMetronome (bool on) { metronome = on; }
    bool metronomeOn() const { return metronome; }
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

    /** A sequencer of the export's own: notes left sounding in the song's plugins end at its first block. */
    void silenceFirst() { silencing = true; }
    /** The song playing (only on the thread that calls `process`, after it has once). */
    const Song* current() const { return song; }

    bool isPlaying() const { return playingNow; }
    /** Where the loop is, in ticks. */
    double position() const { return positionNow; }

    // Audio thread -----------------------------------------------------------
    /** Add the next `numSamples` of the song (the master's output, and the metronome) to `left` and `right`. */
    void process (float* left, float* right, int numSamples);

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
    void schedule (int numSamples);
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
    /** Run the mixer's tracks in order and add the master's sound to `left` and `right`. */
    void mixTracks (float* left, float* right, int numSamples);
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

    std::atomic<int> playRequests { 0 }, stopRequests { 0 };
    std::atomic<double> playFrom { 0.0 };
    int playsSeen = 0, stopsSeen = 0;
    std::atomic<bool> metronome { false };

    /** The audio clips: their streams, made ahead on the message thread. */
    ClipPlayer clips;
    /** Every play and every stop is a new generation, so streams made for one don't play in another. The message thread's count, and the one it asks for. */
    juce::uint32 generations = 0;
    std::atomic<juce::uint32> requestedGeneration { 0 };
    /** The message thread's copy of the last song's loop length (where play starts is within it). */
    double loopTicks = 1;

    bool playing = false;
    double position_ = 0;
    /** The audio thread's play generation, and how many times round the loop it's been since play started. */
    juce::uint32 generation = 0, pass = 0;
    std::atomic<bool> playingNow { false };
    std::atomic<double> positionNow { 0.0 };
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
    juce::uint32 voiceCount = 0;

    /** The metronome's click: a short decaying beep. */
    struct
    {
        int delay = -1;
        double phase = 0, frequency = 1000;
        float level = 0;
    } click;

    JUCE_DECLARE_NON_COPYABLE (Sequencer)
};
