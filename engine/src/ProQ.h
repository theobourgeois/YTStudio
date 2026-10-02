// Pro-Q (docs/fabfilter/pro-q.md), FabFilter's EQ, ours: up to 24 bands, each a shape and slope made of
// analog-matched filters (EqDesign.h), on both sides, one side, the mid or the side (the left/right and
// stereo bands first, then the mid/side ones, as Pro-Q orders them); bands that move with the sound in
// their range (dynamic EQ); and three processing modes:
//
//   Zero Latency   the bands as matched filters in series: no delay.
//   Natural Phase  the same, then a short FIR that turns what's left of their response into the analog
//                  filters' exactly, magnitude and phase (7.3 ms late, as Pro-Q's).
//   Linear Phase   one long FIR with the analog magnitude and no phase change (Pro-Q's latencies); a
//                  dynamic band is a delta mixed in per sample (Convolver.h).
//
// A song's settings (`Settings`) are parsed on the message thread, its FIR kernels designed there and
// handed over; the sound (`State`: filters, smoothed parameters, detectors, convolvers, the analyzer's
// rings) is kept across songs by the effect's id (`Registry`), so an edit never clicks: parameters glide,
// a band that comes or goes fades, a band whose shape changes crossfades. The audio thread never
// allocates or waits here.
#pragma once

#include "Convolver.h"
#include "EqDesign.h"
#include "Spectrum.h"

#include <juce_audio_basics/juce_audio_basics.h>

#include <array>
#include <atomic>
#include <map>
#include <memory>
#include <vector>

namespace eq
{
constexpr int maxBands = 24;

enum class Placement
{
    stereo,
    left,
    right,
    mid,
    side
};

enum class Mode
{
    zeroLatency,
    naturalPhase,
    linearPhase
};

/** A band in a song (`EngineEqBand`). */
struct Band
{
    int id = 1;
    BandShape shape;
    Placement placement = Placement::stereo;
    /** dB its gain moves at most when its range is loud (0: static); its threshold (dB), unless Auto. */
    double range = 0, threshold = 0;
    bool autoThreshold = true;

    bool midSide() const { return placement == Placement::mid || placement == Placement::side; }
};

/** The Natural Phase delay: Pro-Q's 7.3 ms. */
constexpr double naturalDelaySeconds = 0.0073;
/** The convolvers' blocks: Natural Phase's short correction, Linear Phase's long kernels (Pro-Q's 1024). */
constexpr int naturalBlock = 64, linearBlock = 1024;
/** The longest block it takes (longer ones pass it by), and Linear Phase's chunk for its dynamic shares. */
constexpr int maxBlock = 16384, deltaChunk = 1024;

class State;

/** A Pro-Q's settings in a song (`EngineEq`), made on the message thread. Automation lanes change its bands' values. */
struct Settings
{
    std::array<Band, maxBands> bands;
    int count = 0;
    Mode mode = Mode::zeroLatency;
    /** Linear Phase's resolution: 0 Low .. 4 Maximum. */
    int resolution = 1;
    bool gainQ = false;
    /** The output in dB (Auto Gain in it), its pan (-1..1) across left/right or mid/side, its phase. */
    double output = 0, pan = 0;
    bool panMidSide = false, invert = false;
    /** Linear Phase plays dynamic bands only up to High (Pro-Q's). */
    bool dynamicsPlay = true;
    /** Samples it delays its sound (Natural and Linear Phase): delay compensation's. */
    int latency = 0;
    /** The dry sound for the slot's mix, as long as the song's longest block. */
    juce::AudioBuffer<float> dry;

    Band* find (int id)
    {
        for (int i = 0; i < count; ++i)
            if (bands[(size_t) i].id == id)
                return &bands[(size_t) i];
        return nullptr;
    }

    /** From an `EngineEq`. Its FIR kernels are designed for `state` and handed to it. */
    static std::shared_ptr<Settings> parse (const juce::var& json, int capacity, State& state);
};

/** The linear phase kernel's length at a resolution and rate (Pro-Q's: 4k .. 128k at 44.1 kHz, kept in ms). */
int linearTaps (int resolution, double sampleRate);

/** One Pro-Q's sound, kept across songs. */
class State
{
public:
    explicit State (double sampleRate);
    ~State();

    double sampleRate() const { return rate; }

    /** Run `numSamples` of `left` and `right` through it; `analyze`: feed the analyzer (playback, not an export). Audio thread. */
    void process (const Settings&, float* left, float* right, int numSamples, bool analyze);
    /** Mix `mix` of it against the dry sound in `dry` (held back by the latency). Audio thread. */
    void mixDry (const Settings&, float* left, float* right, const float* dryLeft, const float* dryRight, int numSamples, float mix);
    /** Skipped this block (bypassed): it starts afresh when it's back. Audio thread. */
    void skipped() { primed = false; }

    // The tab's -------------------------------------------------------------------------------------------
    /** Measured (the analyzer fed) while watched; its FFT length. Any thread. */
    std::atomic<bool> watched { false };
    std::atomic<int> analyzerSize { 4096 };
    /** The band soloed (0: none), and the solo's level (a gain). Any thread. */
    std::atomic<int> soloBand { 0 };
    std::atomic<float> soloGain { 1.0f };
    /** `EngineEqState`. Message thread. */
    juce::var describe();

    // The message thread's, while a song is parsed --------------------------------------------------------
    /** Natural Phase's and Linear Phase's convolvers (made the first time they're needed, kept). */
    Convolver& naturalConvolver();
    Convolver& linearConvolver();
    /** Delete what the audio thread is done with. */
    void collect();
    /** What the FIR kernels handed over were made from (they're made again only when it changes). */
    juce::String designed;

private:
    /** A band's filters on one channel pair: each section's coefficients (gliding `from` → `to` over a block) and memories. */
    struct Chain
    {
        std::array<Svf, maxSections> from {}, to {};
        int count = 0;
        std::array<std::array<std::array<double, 2>, maxSections>, 2> memory {};

        double run (double x, int channel, double t)
        {
            for (int i = 0; i < count; ++i)
                x = from[(size_t) i].lerp (to[(size_t) i], t).run (x, memory[(size_t) channel][(size_t) i][0], memory[(size_t) channel][(size_t) i][1]);
            return x;
        }
        void clear() { memory = {}; }
    };

    struct BandState
    {
        /** The band as last given (kept while it fades out after it's gone). */
        Band band;
        bool known = false;
        /** How much of it is heard (0..1: it fades in when it comes, out when it goes). */
        double wet = 0;
        /** What it plays now, gliding to the band's: log2 of its frequency, its gain, log2 of its Q. */
        double logFrequency = 0, gain = 0, logQ = 0;
        /** Its dynamics: the gain they add now (dB), the trigger's level (power) and Auto's long average (dB). */
        double dynamicGain = 0, level = 0, average = -100;
        std::array<std::array<double, 2>, 2> trigger {};
        Biquad triggerFilter;
        double triggerFor = -1;
        /** Its filters, and the ones it had before its shape changed (crossfaded out over `fade`). */
        Chain chain, old;
        double fade = 1;
        Shape madeShape = Shape::bell;
        int madeSlope = -1;
        double madeLogFrequency = 0, madeGain = 1e9, madeLogQ = 0;
        /** Said to the tab: the dynamic gain now, the trigger's level (dB). */
        std::atomic<float> saidGain { 0 }, saidLevel { -120 };
        /** Linear Phase: its dynamic share (0..1 of its range) held back by the latency, a ring of control blocks. */
        std::vector<float> shares;
        int shareWrite = 0;
    };

    void runStage (const Settings&, bool midSide, float* a, float* b, const float* inA, const float* inB, int numSamples);
    void runBand (const Settings&, BandState&, bool present, float* a, float* b, const float* inA, const float* inB, int numSamples);
    /** The trigger's level over a block of the input, and the dynamic gain it calls for (dB). */
    void detect (BandState&, const float* inA, const float* inB, int numSamples);
    void design (BandState&, const BandShape&, Chain&) const;

    double rate;
    bool primed = false;
    std::array<BandState, maxBands + 1> bands;
    /** The input (for the detectors and solo). */
    std::vector<float> inLeft, inRight;
    /** Linear Phase's dynamic bands' shares per sample, by delta. */
    std::array<std::vector<float>, Convolver::maxDeltas> deltaGains;
    std::unique_ptr<Convolver> natural, linear;
    std::atomic<Convolver*> naturalLive { nullptr }, linearLive { nullptr };
    /** The output's gains, gliding. */
    std::array<double, 4> out { 1, 0, 0, 1 };
    /** Solo: its filter, built for this band and memories; and how much of it is heard (it fades). */
    Chain solo;
    int soloFor = 0;
    double soloMix = 0;
    /** The dry sound held back by the latency, for the slot's mix. */
    std::array<std::vector<float>, 2> dryRing;
    int dryWrite = 0;

    Spectrum pre, post;
    std::vector<float> levels;
    std::atomic<float> peakLeft { 0 }, peakRight { 0 };
};

/** The song's Pro-Qs' sounds, by effect id, kept across songs (message thread). */
class Registry
{
public:
    std::shared_ptr<State> get (const juce::String& effectId, double sampleRate);
    void keepOnly (const juce::StringArray& ids);
    std::shared_ptr<State> find (const juce::String& effectId) const;
    /** Watch these (by id, with their FFT lengths); the rest not. */
    void watch (const std::map<juce::String, int>& sizes);
    /** `{ <effect id>: EngineEqState }` for those watched. */
    juce::var describe();
    void collect();

private:
    std::map<juce::String, std::shared_ptr<State>> states;
    /** The FFT lengths of those watched, by id (a Pro-Q made later starts watched if it's in here). */
    std::map<juce::String, int> watching;
};
} // namespace eq
