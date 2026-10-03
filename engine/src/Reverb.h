// The Reverb (docs/reverb/reverb.md), ours: a vocal reverb whose modes are tables of numbers for one
// engine. What each knob means (the network's lines and taps, the ten T60s, the velvet taps, the
// filters, the ducker) is decided in TypeScript (`engineReverb`, shared/music/reverb.ts); this runs it:
//
//   input ─ cuts ─ de-ess ─ era in ─ PRE-DELAY ─┬─ EARLY (velvet taps) ─┬───────────────┐
//                                               └──────► late input ◄────┘ (Early Send)  │
//                                                  tone corrector ─ LATE NETWORK ─ late ─┤
//                                            era out ─ Post EQ ─ width ─ duck ─ wet ─ MIX ─ out
//
// The sound (`State`: two networks, the input's ring, the filters' memories) is kept across songs by the
// effect's id (`Registry`), so turning a knob never cuts a tail off: values glide, T60 is realised again,
// Size glides (or jumps to the second network), and a new mode, era or preset starts the second network
// while the first rings out beside it (spillover). Made on the message thread, run on the audio thread,
// which never allocates or waits here.
#pragma once

#include "GraphicEq.h"
#include "ReverbEarly.h"
#include "ReverbNetwork.h"
#include "Spectrum.h"

#include <juce_audio_basics/juce_audio_basics.h>

#include <atomic>
#include <map>
#include <memory>

namespace verb
{
/** The automation lanes of a Reverb (`ReverbLane`), in `REVERB_LANES`' order. */
enum class Lane
{
    mix,
    t60,
    freeze,
    predelay,
    scale,
    distance,
    density,
    modRate,
    modDepth,
    width,
    postCuts,
    deEss,
    duck,
    inputCross,
    inputCuts,
    vlf,
    earlySend,
    earlyCross,
    lateDiffusion,
    duckTimes,
    autoDecay,
    shelves,
    monoBelow,
    level
};
constexpr int numLanes = 24;

class State;

/** A Reverb's settings in a song (`EngineReverb`), made on the message thread. Automation lanes change some (`set`) on the audio thread. */
struct Settings
{
    Topology topology;
    double scale = 1;
    std::array<double, numBands> t60 { 1.8, 1.8, 1.8, 1.8, 1.8, 1.8, 1.8, 1.8, 1.8, 1.8 };
    bool freeze = false, toneLock = true;
    double predelay = 0.02;
    std::vector<EarlyTap> earlyLeft, earlyRight;
    /** Each line's own feed (`lineFeeds`). */
    std::vector<std::vector<EarlyTap>> earlyLines;
    double earlyLevel = 0, earlySend = 1, earlyCross = 0.5, air = 18000, density = 0.5, diffuse = 0.6, vlf = 0;
    double lateLevel = 1, apScale = 1;
    double modRate = 0.8, modDepth = 0;
    int modShape = 0;
    bool mono = true;
    double inputCross = 0.3, inputLowCut = 20, inputHighCut = 20000, bandwidth = 20000;
    double deEss = 0, deEssFrequency = 6500;
    double duck = 0, threshold = -30, attack = 0.01, release = 0.25, hold = 0.05, autoDecay = 0, recovery = 0.1;
    bool autoThreshold = true, tailOnly = true;
    double lowCut = 20, highCut = 20000;
    int lowSlope = 12, highSlope = 12;
    double lowShelf = 200, lowShelfGain = 0, highShelf = 8000, highShelfGain = 0;
    bool studio = false;
    double monoBelow = 0, width = 1, level = 1;
    double dry = 1, wet = 0;
    double bandLimit = 0, noise = -200;
    bool aperture = false, emphasis = false, gainRanging = false;
    int bits = 0;
    juce::uint32 seed = 1;

    /** The absorption designed for `t60` at `scale` (one a line), the tone corrector's; bumped when a lane changes T60. */
    std::array<EqDesign, maxLines> designs {};
    /** Each line's all-pass's own loss (a shelf): it loses as much a second as the delay does. */
    std::array<EqDesign, maxLines> allpassDesigns {};
    EqDesign tone;
    int designed = 0;
    /** Each parsed one's own number (a new song's settings are adopted when it changes). */
    juce::uint64 serial = 0;
    /** The sound coming in, kept while it runs (the slot's mix is heard against it). */
    juce::AudioBuffer<float> dryBuffer;

    static std::shared_ptr<Settings> parse (const juce::var& json, int capacity, State& state);
    /** An automation lane's values. Audio thread. */
    void set (Lane, const float* values, int size);
    /** What the lane is as the song has it (its base, put back when the song stops). */
    void get (Lane, float* values, int& size) const;
    /** Design the absorption and the tone corrector for `t60` and `scale` (either thread: allocation-free). */
    void design (const GraphicEq& eq);
    bool infinite() const { return t60[5] >= 999; }
};

/** One Reverb's sound. */
class State
{
public:
    State (double sampleRate, int capacity);

    double sampleRate() const { return rate; }
    int capacity() const { return blockCapacity; }
    const GraphicEq& graphicEq() const { return eq; }

    /** Run `numSamples` of `left` and `right` through it, in place: dry and wet mixed. `keyLeft`/`keyRight`: the ducking key, its slot's (null: the input). Audio thread. */
    void process (Settings&, const float* keyLeft, const float* keyRight, float* left, float* right, int numSamples);
    /** Skipped this block (bypassed): its tail stops, and it starts empty when it's next run. Audio thread. */
    void skipped() { stale = true; }

    /** The window's live controls (`verb` command): Freeze and Kill held, a click played through it. Any thread. */
    std::atomic<bool> freezeHeld { false }, killHeld { false }, audition { false };
    /** Measured (the analyzer fed) while its window is open; its FFT length. Any thread. */
    std::atomic<bool> watched { false };
    std::atomic<int> analyzerSize { 4096 };

    /** `EngineReverbState`. Message thread (it measures the analyzer). */
    juce::var describe();

private:
    void reset (const Settings&);
    void adopt (Settings&);

    double rate;
    int blockCapacity;
    GraphicEq eq;
    std::array<Network, 2> networks;
    int active = 0;
    /** The other network fading out to make room (a third change while it still rang), samples left. */
    int spillFade = 0, spillFadeLength = 1;
    /** Samples left of a new network taking the input over from the old (and how long that takes). */
    int handover = 0, handoverLength = 1;
    /** The old network's late level × output level when it was let go of (it rings out at it). */
    double spillLevel = 1;
    int designed = -1;
    juce::uint64 serial = 0;
    /** T60 now as a factor of the design's (a uniform change of Decay, by a lane, needs no new design). */
    double t60Factor = 1;
    std::array<double, numBands> designedT60 {};

    // The input's ring (pre-delay and early taps read it), a side each.
    std::vector<float> ringLeft, ringRight;
    juce::int64 ringMask = 0, written = -1;
    double predelayNow = -1, predelayFrom = 0;
    int predelayFade = 0, predelayFadeLength = 1;
    Early early;
    LineFeed feed;

    // The blocks' memories.
    std::array<Cut, 2> inLow, inHigh, postLow, postHigh, studioLow, studioHigh;
    DeEsser deEsser;
    std::array<BandLimit, 2> limitIn, limitOut;
    std::array<Biquad, 2> aperture, preEmphasis, deEmphasis;
    /** The tone corrector, and the one it replaced fading out (a new design's coefficients mid-sound would click). */
    std::array<EqFilter, 2> tone, toneOld;
    EqDesign toneDesign;
    int toneFade = 0, toneFadeLength = 1, toneDesigned = -1;
    juce::uint64 toneSerial = 0;
    std::array<Shelf, 2> vlfHeard, lowShelf, highShelf;
    std::array<double, 2> airY {};
    Svf sideLow, sideMono;
    Ducker ducker;
    double limiter = 1;
    juce::uint32 noiseSeed = 1;
    double noiseEnvelope = 0;

    // Values gliding to the song's.
    double dry = 1, wet = 0, earlyLevel = 0, lateLevel = 1, width = 1, level = 1, inputGain = 1, freezeAmount = 0;
    double glide = 1;
    bool stale = true;
    juce::int64 quietSamples = 0;

    // Scratch, a block long; and each line's input (its feed and the input itself, by Early Send).
    juce::AudioBuffer<float> scratch, lineScratch, spillScratch;

    // For its window.
    std::atomic<float> inPeak[2] {}, outPeak[2] {};
    std::atomic<float> duckDb { 0 }, keyDb { -120 }, thresholdDb { -30 }, deEssDb { 0 }, decayFactor { 1 };
    std::atomic<bool> clippedFlag { false }, frozenFlag { false };
    eq::Spectrum spectrum;
    std::vector<float> levels;
};

/** The song's Reverbs' sounds, by effect id, kept across songs (message thread). The export makes a registry of its own. */
class Registry
{
public:
    std::shared_ptr<State> get (const juce::String& effectId, double sampleRate, int capacity);
    std::shared_ptr<State> find (const juce::String& effectId) const;
    void keepOnly (const juce::StringArray& ids);
    void clear() { states.clear(); }
    /** Those whose windows are open (by effect id, their FFT lengths). */
    void watch (const std::map<juce::String, int>& sizes);
    /** `{ <effect id>: EngineReverbState }`. */
    juce::var describe();

private:
    std::map<juce::String, std::shared_ptr<State>> states;
    std::map<juce::String, int> watching;
};
} // namespace verb
