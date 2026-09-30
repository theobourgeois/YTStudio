// Plays a Song: the transport (a position in ticks, looping), the sampler's voices and the metronome.
//
// Two threads meet here and neither waits for the other. The message thread hands over songs and
// requests (`setSong`, `play`, `stop`, `trigger`) through atomics and lock-free queues; the audio
// thread (`process`) picks them up at the start of a block. Songs it's done with go back the same
// way, to be deleted off the audio thread (`collectGarbage`).
#pragma once

#include "Song.h"

#include <array>
#include <atomic>
#include <juce_audio_basics/juce_audio_basics.h>

class Sequencer
{
public:
    Sequencer() = default;
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

    bool isPlaying() const { return playingNow; }
    /** Where the loop is, in ticks. */
    double position() const { return positionNow; }

    // Audio thread -----------------------------------------------------------
    /** Add the next `numSamples` of the song to `left` and `right`. */
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
    void startVoice (int channel, float pitch, float gain, double lengthTicks, int delay, float pan = 0);
    /** A note for a channel's plugin: on at `delay` samples into the block, off `lengthSamples` later. */
    void startNote (HostedPlugin&, int key, float velocity, juce::int64 lengthSamples, int delay);
    /** Send the note-offs that fall in this block, and count the others down. */
    void endNotes (HostedPlugin&, int numSamples);
    void silencePlugins();
    void renderPlugins (float* left, float* right, int numSamples);
    void render (Voice& voice, float* left, float* right, int numSamples);
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

    std::atomic<int> playRequests { 0 }, stopRequests { 0 };
    std::atomic<double> playFrom { 0.0 };
    int playsSeen = 0, stopsSeen = 0;
    std::atomic<bool> metronome { false };

    bool playing = false;
    double position_ = 0;
    std::atomic<bool> playingNow { false };
    std::atomic<double> positionNow { 0.0 };

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
