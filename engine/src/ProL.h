// YT-L (docs/fabfilter/pro-l.md, pro-l-research.md), our limiter: Pro-L 2's way of working, made more versatile.
// The engine knows no style: TypeScript (`engineProL`) turns each into the numbers here, and this runs them:
//
//   in ─► [DC filter] ─► × gain ─► [up N×] ─► [emphasis] ─┬────────────────────────────────► delay D ─► × g ─► [down N×] ─► last stage ─► × unity ─┐
//                                                         ├► demand ─► link ─► main stage (hold-min, release, release stage, ramp) ─┐          │
//                                                         └► low-pass ─► demand ─► link ─► bass stage (a longer ramp) ───── min ─► g          +─► out
//     └─► delay (the whole latency) ─► dry ──────────────────────────────────────────────────────────────────────────────────────────────────┘
//
// The main stage alone guarantees the ceiling (`Lookahead.h`); the bass stage and the release stage only lower
// the gain. Oversampled, a sample-peak catch at the song's rate holds the ceiling after the downsampler; with
// True Peak Limiting, two true peak passes do (`TruePeak.h`). Then come the meters (`Loudness.h`) and, last of
// all, dither (`Dither.h`). A song's settings are parsed on the message thread, which also makes a core (the
// oversampler and every buffer at its rate) for each factor the first time it's used; the sound (`State`) is
// kept across songs by the effect's id. The audio thread never allocates or waits here.
#pragma once

#include "Clipper.h"
#include "Dither.h"
#include "Loudness.h"
#include "Lookahead.h"
#include "TruePeak.h"

#include <juce_audio_basics/juce_audio_basics.h>
#include <juce_dsp/juce_dsp.h>

#include <array>
#include <atomic>
#include <map>
#include <memory>
#include <vector>

namespace limit
{
/** The automation lanes of a YT-L (`ProLLane`), in `PRO_L_LANES`' order. */
enum class Lane
{
    gain,
    output,
    attack,
    release,
    hold,
    linkTransients,
    linkRelease,
    sideFloor,
    clipRange,
    clipKnee
};

/** The slow stage (`EngineProL.releaseStage`): a follower of the demand, charged by Attack, let go by Release. */
struct ReleaseStage
{
    bool on = false;
    double attack = 0.275, release = 0.4, strength = 1, floor = 0, delay = 0;
};

class State;

/** A YT-L's settings in a song (`EngineProL`), made on the message thread. Lanes change some on the audio thread (`set`). */
struct Settings
{
    /** dB: what the sound is turned up by, and the ceiling (dBTP with `truePeak`). */
    double gain = 0, ceiling = 0;
    bool truePeak = false;
    /** 1, 2, 4, 8 or 16. */
    int oversampling = 1;
    /** Seconds: the look-ahead the ramp uses (the knob, at least the style's), the knob's range, the style's reserve. */
    double lookahead = 0.0005, range = 0.005, reserve = 0;
    /** The ramp's boxes (1–4). */
    int layers = 4;
    /** Seconds the gain stays down behind a peak; below 0: Auto (half the bass's period). */
    double hold = -1;
    /** The transient stage's release, fast (an isolated peak) to slow (a busy passage); 0: none (the ramp back up). */
    double fastRelease = 0.01, slowRelease = 0.06;
    ReleaseStage releaseStage;
    /** Seconds of the bass stage's ramp (0: no bass stage). */
    double bass = 0;
    /** dB: Dynamic's transient emphasis, at most. */
    double emphasis = 0;
    double linkTransients = 0.75, linkRelease = 1;
    /** Mid/side, side first: the side turned down to `sideFloor` (dB) before the mid moves. */
    bool midSide = false;
    double sideFloor = -6;
    /** The clip stage: on, its gap to the limiter (dB), its curve and knee (dB), and whether it's after the limiter. */
    bool clip = false, clipLast = false;
    double clipRange = 1.5, clipKnee = 1.5;
    ClipShape clipShape = ClipShape::smooth;
    /** 0 off, 1 all it takes away, 2 the clip stage's share, 3 the limiter's. */
    int audition = 0;
    bool dcFilter = false, unityGain = false;
    /** Dither at the very end: the bit depth (0: none) and the noise shaping (0 none, 1 Basic, 2 Optimized, 3 Weighted). */
    int ditherBits = 0, ditherShaping = 0;
    /** The factor the core runs at: the clip stage clips at 4x at least. */
    int factor = 1;
    /** Host samples the clip stage's positions take (one fo sample each, rounded up to whole samples). */
    int clipDelay = 0;

    /** Samples at the song's rate: the main delay (reserve and range), the last stage's, and the whole latency. */
    int delay = 0, lastStage = 0, latency = 0;
    /** What the core is built for: a new one means starting afresh. */
    juce::int64 shape = 0;

    static std::shared_ptr<Settings> parse (const juce::var& json, State& state);
    /** An automation lane's values. Audio thread. */
    void set (Lane, const float* values, int size);
    /** What the lane is as the song has it (its base). */
    void get (Lane, float* values, int& size) const;
};

/** One YT-L's sound. */
class State
{
public:
    State (double sampleRate, int capacity);

    double sampleRate() const { return rate; }
    int capacity() const { return blockCapacity; }

    /** Its core for an oversampling factor, made (message thread) the first time it's needed; and its latency. */
    void prepare (int factor);
    int oversamplingLatency (int factor) const;
    /** The last stage's delay (samples at the song's rate). */
    int lastStageLatency (const Settings&) const;

    /** Run `numSamples` of `left` and `right` through it, in place, its slot's `mix` against the sound coming in. Audio thread. */
    void process (const Settings&, float* left, float* right, int numSamples, float mix);
    /** Skipped this block (bypassed): it starts afresh when it's next run. Audio thread. */
    void skipped() { stale = true; }

    // The tab's live controls (any thread) ------------------------------------------------------------------
    /** Reset the loudness measurement and the maxima (taken by the audio thread at its next block). */
    std::atomic<bool> resetRequest { false };
    /** Pause the loudness measurement: Integrated, LRA and the maxima stop taking the sound in. */
    std::atomic<bool> paused { false };

    /** `EngineProLState`: its latency, its meters, and (`drain`: taken) the display's columns since the last drain. Message thread. */
    juce::var describe (bool drain);

private:
    /** Everything at the oversampled rate, for one factor. */
    struct Core
    {
        int factor = 1;
        std::unique_ptr<juce::dsp::Oversampling<float>> oversampler;
        int size = 1;
        std::array<std::vector<float>, 2> audio, pre, mainGain, bassGain, releaseGain;
        std::array<ClipStage, 2> clipFirst, clipLast;
        // What came out one fo sample ago (the post clip's input) and its source samples, for Audition.
        std::array<double, 2> lastLimited {}, lastPre {}, lastAudio {};
        std::array<Stage, 2> main, bass;
        juce::int64 t = 0;
        // Per channel: the release stage's follower (dB) and how long since it was charged, how busy the
        // transient stage's been, Dynamic's envelopes and boost, the bass stage's low-pass.
        std::array<double, 2> follower {}, sinceOver {}, busy {}, fastEnv {}, slowEnv {}, boost {}, lastReduction {};
        std::array<std::array<double, 4>, 2> bassFilter {}, onsetFilter {};
        // Auto Hold: a low-pass of the mid, where it last crossed zero, its half-periods, how loud it is.
        std::array<double, 4> holdFilter {};
        double holdLast = 0, holdEnv = 0;
        juce::int64 lastCross = 0;
        int halfPeriod = 0, previousHalf = 0;
    };

    double rate;
    int blockCapacity;
    bool stale = true;
    juce::int64 shape = -1;
    std::array<std::unique_ptr<Core>, 5> cores;
    Core* core = nullptr;

    // The song's rate: a chunk's audio, the dry ring (the slot's mix), the ceiling's ring (for the last
    // stage), the sample-peak catch and its ring, the true peak passes.
    juce::AudioBuffer<float> chunkAudio;
    std::vector<float> chunkCeiling;
    juce::AudioBuffer<float> dryRing;
    std::vector<float> ceilingRing;
    int ringWrite = 0;
    Stage catchStage;
    std::array<std::vector<float>, 2> catchRing;
    int catchWrite = 0;
    std::array<TruePeakPass, 2> passes;
    int passAhead = 0;
    double gainNow = 0, ceilingNow = 0;
    std::array<double, 2> dcIn {}, dcOut {};
    double fadeIn = 0;

    std::atomic<float> nowReduction { 0 };
    std::atomic<int> latencyNow { 0 };

    static constexpr int chunk = 512;

    // The meters (pro-l.md §5.15): measured after the last stage, before Unity Gain, the slot's mix and dither.
    LoudnessMeter loudness;
    Dither dither;
    int ditherFor = -1;
    // Each song-rate sample of a chunk: the input's peak (after Gain), the clip stage's and the limiter's most
    // reduction (dB) at the core's rate, and whether anything was clipped.
    std::array<std::array<float, chunk>, 2> chunkInput {};
    std::array<float, chunk> chunkClip {}, chunkLimit {};
    std::array<bool, chunk> chunkClipped {};
    /** A column of the display: 10 ms's peaks in and out (dB), most clip and limiter reduction (dB), M and S (LUFS). */
    struct Column
    {
        float in = -120, out = -120, clip = 0, limit = 0, m = -120, s = -120;
    };
    static constexpr int columnRing = 256;
    std::array<Column, columnRing> columns {};
    std::atomic<int> columnsWritten { 0 };
    int columnsRead = 0, columnSize = 480, columnFill = 0;
    Column column;
    // 100 ms windows (the last four: 400 ms): song-rate samples clipped, and within 0.5 dB of the ceiling.
    int windowSize = 4800, windowFill = 0, windowIndex = 0;
    std::array<int, 4> clippedWindows {}, denseWindows {};
    double mostClip = 0, mostLimit = 0;
    std::array<std::atomic<float>, 2> inPeak {}, outPeak {}, outTruePeak {};
    std::atomic<float> clippedShare { 0 }, density { 0 }, maxClip { 0 }, maxLimit { 0 };
    /** The clip stage's reduction of `x` (its curve's, without the anti-aliasing), for the chunk's sample `j`. */
    void clipped (const ClipCurve&, double x, int j);
    /** The meters' share of the chunk's sample `j`, as it leaves the last stage (`y`, before Unity Gain). */
    void measure (int j, const float* y, double ceiling, bool held);
    Core& coreFor (int factor);
    void reset (const Settings&);
};

/** The song's YT-Ls' sounds, by effect id, kept across songs (message thread). The export makes its own. */
class Registry
{
public:
    std::shared_ptr<State> get (const juce::String& effectId, double sampleRate, int capacity);
    std::shared_ptr<State> find (const juce::String& effectId) const;
    void keepOnly (const juce::StringArray& ids);
    void clear() { states.clear(); }
    /** `{ <effect id>: State::describe() }`; `drain` takes their display's columns (the transport event's). */
    juce::var describe (bool drain) const;

private:
    std::map<juce::String, std::shared_ptr<State>> states;
};
} // namespace limit
