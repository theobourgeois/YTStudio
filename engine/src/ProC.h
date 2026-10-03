// Pro-C (docs/fabfilter/pro-c.md, pro-c-vocals.md), FabFilter's Pro-C 3 compressor, ours, with our Vox
// and Vintage styles. The engine knows no style: TypeScript (`engineProC`) turns each one into the blocks
// and numbers here, and this runs them, per sample:
//
//   input ─► delay D ─► [up N×] ─► Character pre ─► × gain ─► colour ─► Character post ─► [down N×] ─► post filters ─► limiter ─┐
//     │                                     ▲                                                                                   +─► output
//     │  key (the input, another track, or pulses) ─► level ─► EQ ─► delay D−L ─► [up N×] ─► detector ─► link ─►                 │
//     │       gain computer (feedforward, or a feedback loop solved each sample) ─► ballistics ─► gate ─► lookahead ─► gain        │
//     └─► delay (D + the oversampling's) ─► dry ──────────────────────────────────────────────────────────────────────────────┘
//
// A song's settings (`Settings`) are parsed on the message thread (its filters designed, its oversamplers
// made there); the sound (`State`: delays, detectors, the gain's state, what it measured) is kept across
// songs by the effect's id (`Registry`), so an edit glides rather than clicks. The audio thread never
// allocates or waits here.
#pragma once

#include "CompDsp.h"
#include "EqDesign.h"
#include "GrossBeat.h"

#include <juce_audio_basics/juce_audio_basics.h>
#include <juce_dsp/juce_dsp.h>

#include <array>
#include <atomic>
#include <map>
#include <memory>
#include <vector>

namespace comp
{
/** The automation lanes of a Pro-C (`ProCLane`), in `PRO_C_LANES`' order. */
enum class Lane
{
    threshold,
    slope,
    knee,
    range,
    attack,
    release,
    hold,
    makeup,
    dry,
    mix,
    level,
    drive,
    input,
    output,
    emphasis
};

/** How the gain follows the curve (`EngineProCBallistics.shape`). */
enum class Shape
{
    decoupled,
    second,
    smoothstep,
    dual,
    rate,
    opto,
    fixMan
};
enum class Detector
{
    log,
    linear,
    light
};
enum class ColourKind
{
    none,
    even,
    odd,
    tape,
    diode
};
enum class Source
{
    internal,
    external,
    sync
};
enum class LinkMode
{
    mid,
    side,
    midToSide,
    sideToMid
};

struct Ballistics
{
    double attack = 0.005, release = 0.1, hold = 0;
    Shape shape = Shape::decoupled;
    double program = 2, programTime = 0.5;
    bool autoRelease = false;
    double dualWeight = 1, dualFactor = 1, rate = 120;
    bool rateAttack = false;
    double attackDelay = 0;
};

struct Opto
{
    double light = 0.01, fastRise = 0.005, fastFall = 0.02, slowRise = 0.005, slowFall = 0.2, memory = 1.8, split = 0.5;
};

struct Colour
{
    ColourKind kind = ColourKind::none;
    double base = 0, perDb = 0, peak = 0, width = 1, tilt = 0, drive = 1;
};

/** A side chain or post filter: a band's sections as SVFs, and the part it works on (0 stereo, 1 mid, 2 side). */
struct Filter
{
    std::array<eq::Svf, eq::maxSections> svfs;
    int count = 0, placement = 0;
};

class State;

/** A Pro-C's settings in a song (`EngineProC`), made on the message thread. Lanes change some on the audio thread (`set`). */
struct Settings
{
    bool feedback = false;
    double loop = 0, rms = 0, rmsTime = 0.005;
    Detector detector = Detector::log;
    Curve curve;
    bool autoThreshold = false;
    Ballistics ballistics;
    bool hasOpto = false;
    Opto opto;
    bool ttm = false;
    std::array<double, 2> crossovers { 90, 2500 };
    std::array<double, 3> ttmUp { 30, 24, 30 }, ttmTimes { 2, 1, 0.5 };
    bool gate = false;
    double gateThreshold = -60, gateRatio = 4, gateRange = 40;
    bool limiter = false;
    double limThreshold = 0, limAttack = 0, limRelease = 0.06;
    Colour colour;
    /** Character: 0 off, 1 tube, 2 diode, 3 bright. */
    int character = 0;
    double charDrive = 1;
    bool charPost = true;
    /** The key's filters (the side chain EQ and the style's), and the audio's after the colour (the Distress's high-pass). */
    std::vector<Filter> keyFilters, postFilters;
    double emphasis = 0;
    double makeup = 0, wetPan = 0, mix = 1, link = 1, toward = 0;
    std::array<double, 2> dry { 0, 0 }, input { 1, 1 }, output { 1, 1 };
    LinkMode linkMode = LinkMode::mid;
    Source source = Source::internal;
    /** External: the source track's index (-1: none, it hears silence). */
    int key = -1;
    double level = 1, syncBeats = 1, syncLength = 0.5;
    /** Samples at the song's rate: how far it looks ahead, the most it can (its delay), the oversampling's factor. */
    int lookahead = 0, maxLookahead = 0, oversampling = 1;
    /** Samples its sound comes out late: the most lookahead and the oversampling filters'. */
    int latency = 0;
    /** Samples its external key waits to line up with its sound (delay compensation's, `Song::compensate`). */
    int keyDelay = 0;

    static std::shared_ptr<Settings> parse (const juce::var& json, int capacity, State& state);
    /** An automation lane's values. Audio thread. */
    void set (Lane, const float* values, int size);
    /** What the lane is as the song has it (its base). */
    void get (Lane, float* values, int& size) const;
};

/** One Pro-C's sound. */
class State
{
public:
    State (double sampleRate, int capacity);

    double sampleRate() const { return rate; }
    int capacity() const { return blockCapacity; }

    /** Its oversamplers for a factor, made (message thread) the first time it's used; and their latency (whole samples). */
    void prepare (int factor);
    int oversamplingLatency (int factor) const;

    /**
     * Run `numSamples` of `left` and `right` through it, in place, its slot's `mix` against what came in
     * (held back by its latency). `keyLeft`/`keyRight`: an external key's sound (null: none); `clock`: the
     * song's position (Host Sync). Audio thread.
     */
    void process (const Settings&, const gross::Clock& clock, const float* keyLeft, const float* keyRight, float* left, float* right, int numSamples, float mix);
    /** Skipped this block (bypassed): it starts afresh when it's next run. Audio thread. */
    void skipped() { stale = true; }

    // The tab's live controls (any thread) ------------------------------------------------------------------
    /** 0 off, 1 the key, 2 what's taken away. */
    std::atomic<int> audition { 0 };
    /** Measure the loudness in and out for `seconds` (Match). */
    void startMatch (double seconds);

    /** `EngineProCState`: the display's points since the last drain (`drain`: take them), the levels now. Message thread. */
    juce::var describe (bool drain);

private:
    /** The gain's state for one path (left, right; or the one mid/side path; or a TTM band). */
    struct Path
    {
        // The smooth decoupled follower (its release stage, a second attack pole, its output), and Dual's slower one.
        double y1 = 0, mid = 0, yL = 0;
        double y1b = 0, midB = 0, yLb = 0;
        int holdLeft = 0, attackAge = 0;
        bool attacking = false;
        double program = 0, average = 0;
        // Smoothstep's release: where it began and how far along.
        double ssStart = 0;
        juce::int64 ssAge = -1;
        // The opto cell: the light, its fast part, its slow part, and how long and hard it's been lit.
        double light = 0, fast = 0, slow = 0, exposure = 0;
        // Fix / Man's fast follower and slow one, and how long the level's been over.
        double fmFast1 = 0, fmFast = 0, fmSlow = 0;
        juce::int64 overTime = 0;
        double gate = 0, gr = 0;
        MovingMax max;
        Box box1, box2;
    };
    /** What a path's ballistics follow: the gain computer at a level (`Target(gr)`: the reduction asked for if the reduction is `gr`). */
    struct Target
    {
        Curve curve;
        double loop = 0, level = -120, average = 0, upThreshold = -60;
        bool feedback = false, ttm = false;
        double operator() (double gr) const;
    };
    /** A key channel's detector (left, right, mid, side). */
    struct Detect
    {
        double ms = 0, env = 0, crestPeak = 0, crestMs = 0;
    };
    /** Values that glide towards the song's, so a knob turned (or automated) doesn't click. */
    struct Glide
    {
        double threshold = -18, slope = 0.75, loop = 0, knee = 6, range = 40, makeup = 0, mix = 1, drive = 1;
    };

    double rate;
    int blockCapacity;
    bool stale = true;
    int factor = 1;
    std::map<int, std::unique_ptr<juce::dsp::Oversampling<float>>> audioUp, keyUp;

    // Base-rate delays: the input (lookahead and the dry), the raw input (the slot's mix), the external key.
    juce::AudioBuffer<float> inputRing, rawRing, keyRing;
    int ringWrite = 0, keyWrite = 0;
    // A chunk's delayed input and key (at the song's rate), and each core sample's reduction.
    juce::AudioBuffer<float> chunkAudio, chunkKey;
    std::vector<float> chunkReduction;
    std::array<std::array<double, eq::maxSections * 2>, 32> filterState {};
    std::array<std::array<double, eq::maxSections * 2>, 8> postState {};
    std::array<std::array<double, 4>, 2> emphasisState {};
    Filter emphasisFilter;
    double emphasisDesigned = 0;

    std::array<Detect, 4> detect {};
    std::array<Path, 2> paths;
    std::array<Path, 3> bandPaths;
    std::array<double, 3> bandMs {};
    // TTM's splitters: the audio's two sides, then the key's.
    std::array<Splitter, 4> splitters;
    double autoLevel = -18;
    Glide glide;
    std::array<double, 2> inGain { 1, 1 }, outGain { 1, 1 }, dryGain { 0, 0 };
    double keyLevel = 1, limGain = 0;
    std::array<OnePole, 2> brightFilter, tiltFilter, dcFilter;
    double fadeIn = 0;

    // What it measured: the display's ring of points, and the levels now.
    struct Point
    {
        float in = -120, out = -120, gr = 0;
    };
    static constexpr int ringSize = 512;
    std::array<Point, ringSize> points {};
    std::atomic<int> pointsWritten { 0 };
    int pointsRead = 0;
    float sliceIn = 0, sliceOut = 0, sliceGr = 0;
    int sliceCount = 0;
    std::atomic<float> nowReduction { 0 }, nowKey { -120 }, nowLevel { -120 }, nowThreshold { -18 };
    std::array<std::atomic<float>, 2> inPeak {}, outPeak {};
    std::atomic<int> latencyNow { 0 };

    std::atomic<int> matchRequest { 0 };
    juce::int64 matchLeft = 0, matchCount = 0;
    double matchIn = 0, matchOut = 0;
    std::atomic<float> matchInDb { -120 }, matchOutDb { -120 };
    /** 0 none, 1 measuring, 2 done. */
    std::atomic<int> matchState { 0 };

    void reset (const Settings&);
    /** A chunk's gain path at the core's rate (the song's, times the oversampling): `audio` in place, its reduction into `reduction`. */
    void runCore (const Settings&, float* const* audio, const float* const* key, int n, double coreRate, float* reduction);
    /** A path's ballistics: the reduction now (dB). */
    double follow (const Settings&, const Ballistics&, Path&, const Target&, double coreRate, double crest);
};

/** The song's Pro-Cs' sounds, by effect id, kept across songs (message thread). The export makes its own. */
class Registry
{
public:
    std::shared_ptr<State> get (const juce::String& effectId, double sampleRate, int capacity);
    std::shared_ptr<State> find (const juce::String& effectId) const;
    void keepOnly (const juce::StringArray& ids);
    void clear() { states.clear(); }
    /** `{ <effect id>: State::describe() }`; `drain` takes their display's points (the transport event's). */
    juce::var describe (bool drain) const;

private:
    std::map<juce::String, std::shared_ptr<State>> states;
};
} // namespace comp
