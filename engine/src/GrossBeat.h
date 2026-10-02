// Gross Beat (docs/fl-studio/gross-beat.md), FL Studio's time and volume effect, ours: it keeps the last
// bars of what comes in (a rolling buffer) and plays from it at an offset its time envelope says, at a
// level its volume envelope says, both a bar long and in time with the song.
//
// What the envelopes are is decided in TypeScript (`shared/music/gross-beat.ts`): a song brings them as
// straight lines (`Settings`). The sound (`State`) is kept across songs by the effect's id (`Registry`),
// so an edit doesn't empty the buffer: it's made on the message thread and run on the audio thread,
// which never allocates or waits here. HOLD and the scratching clock come from the tab as atomics.
#pragma once

#include "Resampling.h"

#include <juce_audio_basics/juce_audio_basics.h>

#include <array>
#include <atomic>
#include <map>
#include <memory>
#include <vector>

namespace gross
{
/** Time slots and volume slots: 36 of each. */
constexpr int slots = 36;

/** A slot's envelope as straight lines over its bar (`EngineGrossEnvelope`); empty if the song didn't send it. */
struct Envelope
{
    std::vector<double> ticks;
    std::vector<float> values;

    bool empty() const { return ticks.empty(); }
    /** Its value at `tick` of the bar: the later of two points on one tick, the ends held. `cursor` speeds the next lookup. */
    float at (double tick, size_t& cursor) const;
};

/** What HOLD repeats: nothing, the bar just played, or the next bar. */
enum class Hold
{
    off,
    last,
    next
};

/**
 * A Gross Beat's settings in a song (`EngineGrossBeat`), made on the message thread. Automation lanes
 * change the four automatable ones (the slots and mixes) on the audio thread.
 */
struct Settings
{
    int timeSlot = 0, volumeSlot = 0;
    float timeMix = 1, volumeMix = 1;
    /** Seconds; and -1..1. */
    double attack = 0, release = 0, tension = 0;
    bool oneShot = false;
    Hold hold = Hold::last;
    /** Ticks: TRIG SYNC and POS SYNC (0: off), a slot's length, and how far back the time envelopes reach (beats). */
    double trigSync = 24, posSync = 384, ticks = 384, depth = 8;
    bool clickReduction = true, attackCompensation = false, removeDc = false, hq = false;
    /** Time envelopes are offsets in beats (0 down to -depth), volume envelopes levels (0..1). */
    std::array<Envelope, slots> time, volume;
    /** The dry sound while it's run, as long as the song's longest block (the mix needs it). */
    juce::AudioBuffer<float> dry;

    static std::shared_ptr<Settings> parse (const juce::var& json, int capacity);
};

/** Where the song is over a block: what Gross Beat follows. */
struct Clock
{
    /** The transport moves (not stopped, not counting in). */
    bool playing = false;
    /** Play started on this block's first sample: the buffer starts afresh. */
    bool started = false;
    /** The song's tick on the block's first sample (where the bar is), and how far each sample moves it. */
    double tick = 0, ticksPerSample = 0, ppq = 96;
    /** Past `loopEnd` it goes round to `loopStart`, unless it doesn't loop. */
    double loopStart = 0, loopEnd = 1e18;
    bool loops = false;
};

/** One Gross Beat's sound: its rolling buffer and where its envelopes are. */
class State
{
public:
    /** A buffer of `capacity` samples a side (rounded up to a power of two). */
    State (double sampleRate, int capacity);

    double sampleRate() const { return rate; }
    int capacity() const { return (int) mask + 1; }

    /** Run `numSamples` of the sound in `left` and `right` through it (wet: the mix is the slot's). Audio thread. */
    void process (Settings&, const Clock&, float* left, float* right, int numSamples);

    // The tab's live controls (any thread) --------------------------------------------------------------
    /** HOLD: held while true. */
    std::atomic<bool> hold { false };
    /** The scratching clock: an offset in beats (0 down to -depth), added to the time envelope's; 0 lets go. */
    std::atomic<float> scratch { 0.0f };

    /** What it's playing (`EngineGrossState`), from what the audio thread last said. Any thread. */
    juce::var describe() const;

private:
    /** Start a slot now: the envelope from where POS SYNC says. */
    void start (int kind, int slot, double songTick, const Settings&);
    /** `side`'s sample at whole position `index` (silence before the buffer's start, the newest after it). */
    float sampleAt (int side, juce::int64 index) const
    {
        // Before play started, or further back than the buffer holds (written over since): silence.
        if (index < validFrom || written - index > (juce::int64) mask)
            return 0.0f;
        if (index > written)
            index = written;
        return buffer[(size_t) side][(size_t) (index & (juce::int64) mask)];
    }
    /** `side` read at `position` (samples; between them by Hermite, or sinc reading `rate` samples a sample). */
    float read (int side, double position, double speed, bool hq) const;
    void restart (const Settings&, const Clock&);

    double rate;
    juce::uint64 mask;
    std::array<std::vector<float>, 2> buffer;
    /** The newest sample's index (counted since it was made), and the first that's still sound (earlier is silence). */
    juce::int64 written = -1, validFrom = 0;

    // The audio thread's ---------------------------------------------------------------------------------
    /** Per kind (0 time, 1 volume): the slot playing, the one waiting for its sync point (-1: none) and how long it waits (ticks), the slot the song last asked for, where its bar started (song ticks), how long it's played (ticks). */
    struct Kind
    {
        int playing = 0, queued = -1, asked = -1;
        double wait = 0, anchor = 0, elapsed = 0, phase = 0;
        size_t cursor = 0;
    };
    std::array<Kind, 2> kinds;
    bool wasPlaying = false;
    /** The read position last sample, how far it moved, and whether it just jumped (so the next move isn't one). */
    double lastRead = 0, lastStep = 1;
    bool haveLast = false, justJumped = false;
    /** A jump being faded across: the old read position, its step, and the samples left. */
    double fadeRead = 0, fadeStep = 1;
    int fadeLeft = 0, fadeLength = 1;
    /** HOLD: held since this sample (or not), the bar's length then. */
    bool holding = false;
    juce::int64 holdStart = 0, holdLength = 1;
    double scratchNow = 0;
    /** The volume, smoothed. */
    double level = 1;
    /** The DC filter's last input and output, each side. */
    std::array<float, 2> dcIn {}, dcOut {};

    // What it says (any thread reads) ------------------------------------------------------------------
    std::atomic<int> saidTime { 0 }, saidVolume { 0 }, saidQueuedTime { -1 }, saidQueuedVolume { -1 };
    std::atomic<float> saidTimeTick { 0 }, saidVolumeTick { 0 };
    std::atomic<bool> saidHolding { false };
};

/**
 * The song's Gross Beats' sounds, by effect id, kept across songs (message thread). The export makes a
 * registry of its own, so it starts with empty buffers and leaves playback's alone.
 */
class Registry
{
public:
    /** The effect's state, kept if it's at this rate and holds `seconds` of sound; else a new one. */
    std::shared_ptr<State> get (const juce::String& effectId, double sampleRate, double seconds);
    /** Let go of the ones not in `ids` (the song has them no more). */
    void keepOnly (const juce::StringArray& ids);
    std::shared_ptr<State> find (const juce::String& effectId) const;
    /** `{ <effect id>: EngineGrossState }`. */
    juce::var describe() const;

private:
    std::map<juce::String, std::shared_ptr<State>> states;
};
} // namespace gross
