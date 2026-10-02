// OTT (docs/xfer/ott.md), Xfer's multiband upward and downward compressor, ours: three bands split by
// Linkwitz-Riley crossovers at 88.3 Hz and 2.5 kHz (summing flat), each with an envelope on both sides'
// mean square and the gain law of David Braun's model of OTT 1.3.1: an upward compressor below one
// knee, a downward one above another, a makeup and a floor. What its knobs mean (each band's makeup,
// slopes, knees, release) is decided in TypeScript (`engineOtt`); this runs the law (`ottGainDb`).
//
// The sound (`State`: the crossovers, envelopes, the values gliding) is kept across songs by the
// effect's id (`Registry`), so a knob turned glides rather than clicks. It's made on the message thread
// and run on the audio thread, which never allocates or waits here.
#pragma once

#include <juce_audio_basics/juce_audio_basics.h>

#include <array>
#include <atomic>
#include <map>
#include <memory>

namespace ott
{
constexpr int numBands = 3;

/** The automation lanes of an OTT (`OttLane`), in `OTT_LANES`' order: one value, or one a band. */
enum class Lane
{
    input,
    output,
    makeup,
    upward,
    downward,
    upKnee,
    downKnee,
    release,
    gains
};

/** A band as the song has it (`EngineOttBand`): seconds, dB, and its gain after it (linear). */
struct Band
{
    double attack = 0.006, release = 0.03;
    double makeup = 0, upward = 0, upKnee = -46, upWidth = 0.05, cap = 36, downward = 0, downKnee = -38, downWidth = 0.5, floor = -26;
    double gain = 1;
};

/** An OTT's settings in a song (`EngineOtt`), made on the message thread. Automation lanes change some of them (`set`) on the audio thread. */
struct Settings
{
    double input = 1, output = 1;
    std::array<Band, numBands> bands;
    /** The sound coming in, kept while it runs (the slot's mix is heard against it). */
    juce::AudioBuffer<float> dryBuffer;

    static std::shared_ptr<Settings> parse (const juce::var& json, int capacity);
    /** An automation lane's values (one, or one a band). Audio thread. */
    void set (Lane, const float* values, int size);
    /** What the lane is as the song has it (its base, put back when the song stops). */
    void get (Lane, float* values, int& size) const;
};

/** One OTT's sound: its crossovers, its bands' envelopes, the values it glides along, what it measured. */
class State
{
public:
    explicit State (double sampleRate);

    double sampleRate() const { return rate; }

    /** Run `numSamples` of `left` and `right` through it, in place. Audio thread. */
    void process (const Settings&, float* left, float* right, int numSamples);
    /** Skipped this block (bypassed): it starts afresh when it's next run. Audio thread. */
    void skipped() { stale = true; }

    /** `{ bands: [{ level, gain }] (low, mid, high: dB), input: [l, r], output: [l, r] }` for its display. Any thread. */
    juce::var describe() const;

private:
    /** A state-variable filter section (Zavalishin's TPT), Q = 1/√2: a Linkwitz-Riley's half. */
    struct Svf
    {
        double a1 = 0, a2 = 0, a3 = 0, k = 0;
        double s1 = 0, s2 = 0;
        void setup (double hz, double rate);
        /** The low-pass, high-pass and all-pass outputs of one sample. */
        void run (double x, double& low, double& high, double& all);
        void reset() { s1 = s2 = 0; }
    };
    /** A channel's crossovers: LR4 at 88.3 Hz (two sections each way), the low band's all-pass at 2.5 kHz, LR4 at 2.5 kHz. */
    struct Splitter
    {
        Svf low1, low2, high1, high2, lowAll, mid1, mid2, top1, top2;
        void split (double x, double& low, double& mid, double& high);
        void reset();
    };
    /** Where a band's values are now (they glide towards the song's). */
    struct Now
    {
        double makeup = 0, upward = 0, upKnee = 0, downward = 0, downKnee = 0, gain = 1;
    };

    double rate;
    double glide;
    std::array<Splitter, 2> splitters;
    std::array<double, numBands> envelope {};
    std::array<Now, numBands> now {};
    double input = 1, output = 1;
    bool stale = true;

    std::array<std::atomic<float>, numBands> level {}, gain {};
    std::array<std::atomic<float>, 2> inPeak {}, outPeak {};
};

/**
 * The song's OTTs' sounds, by effect id, kept across songs (message thread). The export makes a registry
 * of its own, so it starts afresh and leaves playback's alone.
 */
class Registry
{
public:
    std::shared_ptr<State> get (const juce::String& effectId, double sampleRate);
    void keepOnly (const juce::StringArray& ids);
    /** Let go of them all: the next song starts each one silent (the transport's reset, `Engine::silence`). */
    void clear() { states.clear(); }
    /** `{ <effect id>: State::describe() }`. */
    juce::var describe() const;

private:
    std::map<juce::String, std::shared_ptr<State>> states;
};
} // namespace ott
