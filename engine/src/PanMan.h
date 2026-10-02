// PanMan (docs/soundtoys/panman.md), Soundtoys' auto-panner, ours: the sound (summed to mono) moved
// across the stereo field by an LFO, a rhythm's pattern, chance, or the sound's own hits, through one of
// seven Analog Styles of saturation.
//
// What the pattern modes' patterns are is decided in TypeScript (`shared/music/panman.ts`): a song brings
// them as straight lines (`Settings::shape`). The rest (Random's chance, the triggers, the dynamics, the
// pan law, the saturation) is played here, by the rules the doc writes down. The sound's state (`State`:
// where the pattern is, the followers and filters) is kept across songs by the effect's id (`Registry`),
// made on the message thread and run on the audio thread, which never allocates or waits here. The
// Manual Trigger comes from the tab as an atomic.
#pragma once

#include "GrossBeat.h"

#include <juce_audio_basics/juce_audio_basics.h>

#include <atomic>
#include <limits>
#include <map>
#include <memory>

namespace panman
{
enum class Mode
{
    lfo,
    rhythmStep,
    rhythmShape,
    pingPong,
    random,
    step
};

enum class Style
{
    clean,
    fat,
    squash,
    dirt,
    crunch,
    shred,
    pump
};

enum class Filter
{
    hpf,
    off,
    lpf
};

/**
 * A PanMan's settings in a song (`EnginePanMan`), made on the message thread. Automation lanes change the
 * five automatable ones (offset, width, rate, input, output) on the audio thread.
 */
struct Settings
{
    Mode mode = Mode::lfo;
    /** Degrees, and 0..1. */
    double offset = 0, width = 180, smoothing = 0.5;
    /** The LFO's Hz; the pattern's length in beats; Random's step in beats; the BPM out of sync. */
    double rate = 0.5, beats = 1, stepBeats = 1, tempo = 120;
    bool sync = true;
    /** The pattern modes' pattern over 0..1 of it: positions -1..1 (`gross::Envelope`'s lookup, on phases). */
    gross::Envelope shape;
    juce::uint32 seed = 0;
    /** dB (0: the sound doesn't trigger); triggers to a move; the trigger's filter (Hz, dB) and Monitor. */
    double trigger = -20;
    int divider = 1;
    Filter filter = Filter::off;
    double cutoff = 1000, filterGain = 0;
    bool monitor = false;
    /** The dynamics: whether this mode has them, threshold (dB), attack and release (s), Gate, the mods (degrees, degrees, octaves). */
    bool dynamics = true, gate = false;
    double threshold = -20, attack = 0.01, release = 0.2, offsetMod = 0, widthMod = 0, rateMod = 0;
    Style style = Style::clean;
    /** dB. */
    double input = 0, output = 0;
    /** The dry sound while it's run, as long as the song's longest block (the slot's mix needs it). */
    juce::AudioBuffer<float> dry;

    static std::shared_ptr<Settings> parse (const juce::var& json, int capacity);
    bool patterned() const { return mode == Mode::lfo || mode == Mode::rhythmStep || mode == Mode::rhythmShape; }
    bool triggered() const { return mode == Mode::pingPong || mode == Mode::step; }
};

/** A 2nd-order section (RBJ's), Direct Form I in doubles: the trigger's filter. */
struct Biquad
{
    double b0 = 1, b1 = 0, b2 = 0, a1 = 0, a2 = 0;
    double x1 = 0, x2 = 0, y1 = 0, y2 = 0;

    void design (Filter, double cutoff, double sampleRate);
    double run (double x)
    {
        const auto y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
        x2 = x1;
        x1 = x;
        y2 = y1;
        y1 = y;
        return y;
    }
    void reset() { x1 = x2 = y1 = y2 = 0; }
};

/** One PanMan's sound: where its pattern is, its followers, triggers, filters and saturation. */
class State
{
public:
    explicit State (double sampleRate);

    double sampleRate() const { return rate; }

    /** Run `numSamples` of the sound in `left` and `right` through it (wet: the mix is the slot's). Audio thread. */
    void process (Settings&, const gross::Clock&, float* left, float* right, int numSamples);
    /** Skipped this block (bypassed): it goes on from where it is when it's next run. Audio thread. */
    void skipped() {}

    /** The Manual Trigger (any thread): a trigger, if the sound is under the Trigger's level then. */
    std::atomic<bool> manualTrigger { false };

    /**
     * What it's doing (`EnginePanState`), from what the audio thread last said: the position (degrees, and
     * the least and most since last asked, for the meter's trails), the input's and output's peaks since
     * last asked, the level the Threshold or Trigger sees (dB), and the divider's count. Any thread.
     */
    juce::var describe();

    /** A random position (-1..1) for `index` of `seed`'s sequence: the same every time. */
    static double chance (juce::uint32 seed, juce::int64 index);
    /** The pan law: [left, right] gains for a position in degrees (unity at the centre, constant power). */
    static std::pair<double, double> gains (double degrees);

private:
    /** Play started: the pattern, the triggers and the dynamics start afresh, so a render is the same every time. */
    void restart();
    /** A trigger: counted, and every `divider`th one moves the position (PingPong's other side, Step's next random place). */
    void triggered (const Settings&);
    /** The saturation of `style` on one sample. */
    double saturate (Style, double x);

    double rate;
    /** The saturation's coefficients at this rate: its band splits (200 Hz, 2.5 kHz), DC blocker and compressors' followers. */
    double lowPole, highPole, dcPole, squashAttack, squashRelease, pumpAttack, pumpRelease;

    // The audio thread's ---------------------------------------------------------------------------------
    bool wasPlaying = false;
    /** Where the rhythm modes are (beats: the song's while in time with it, else counted here), the drift RateMod has put on it, and the LFO's phase. */
    double beat = 0, drift = 0, lfoPhase = 0;
    size_t cursor = 0;
    /** The dynamics' follower (linear peak) and amount (0..1). */
    double level = 0, amount = 0;
    /** The trigger's filter, follower (linear peak), whether it can trigger again, and the samples since the last trigger. */
    Biquad detector;
    Filter designedFilter = Filter::off;
    double designedCutoff = -1, triggerLevel = 0;
    bool armed = true;
    juce::int64 sinceTrigger = std::numeric_limits<juce::int64>::max() / 2;
    /** The divider's count, the moves made since play started, PingPong's side; a move's glide (from, to, 0..1 of the way). */
    int count = 0, side = -1;
    juce::int64 moves = 0;
    double glideFrom = -1, glideTo = -1, glideDone = 1;
    /** The position (degrees) as it's heard, after the 1 ms that keeps moves from clicking; the gains as they are. */
    double heard = 0, inGain = 1, outGain = 1;
    bool fresh = true;
    /** The saturation's filters and followers: band splits, DC blockers, a compressor's level. */
    double lowState = 0, highState = 0, dcIn = 0, dcOut = 0, compLevel = 0;
    Style lastStyle = Style::clean;

    // What it says (any thread reads) ------------------------------------------------------------------
    std::atomic<float> saidPosition { 0 }, saidLeast { 1000 }, saidMost { -1000 }, saidInput { 0 }, saidOutput { 0 }, saidLevel { -120 };
    std::atomic<int> saidCount { 0 };
};

/**
 * The song's PanMen, by effect id, kept across songs (message thread). The export makes a registry of its
 * own, so it starts afresh and leaves playback's alone.
 */
class Registry
{
public:
    /** The effect's state, kept if it's at this rate; else a new one. */
    std::shared_ptr<State> get (const juce::String& effectId, double sampleRate);
    /** Let go of the ones not in `ids`. */
    void keepOnly (const juce::StringArray& ids);
    std::shared_ptr<State> find (const juce::String& effectId) const;
    /** `{ <effect id>: EnginePanState }`. */
    juce::var describe() const;

private:
    std::map<juce::String, std::shared_ptr<State>> states;
};
} // namespace panman
