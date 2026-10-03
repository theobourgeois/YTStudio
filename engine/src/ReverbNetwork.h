// The Reverb's late network (docs/reverb/reverb.md 6.5): N lines, each an all-pass then a delay then an
// absorption filter, fed back through a lossless matrix (a ring for the plates, A4 ⊗ A4 for the 16-line
// FDN), the input added at the lines `Topology` says, the output read by taps inside the lines.
//
// Every read inside the loop is a first-order all-pass (Thiran) interpolator: flat in magnitude at any
// fraction, so modulation and a gliding Size take nothing from the top octave (6.6, "interpolation
// loss"). Lengths are rounded to primes, all different, when a network is configured. Its memory is
// allocated once (message thread) for the longest Size and the deepest modulation; configuring and
// running it never allocate, so the audio thread may do both (a spillover starts the second network).
#pragma once

#include "GraphicEq.h"

#include <juce_core/juce_core.h>

#include <array>
#include <vector>

namespace verb
{
constexpr int maxLines = 16;
constexpr int maxTaps = 64;
constexpr int maxDiffusers = 4;
/** The longest delay and all-pass a line holds (s): Hall's at Size 100%, Plate's at 1.6, and the modulation's reach. */
constexpr double maxDelaySeconds = 0.36, maxAllpassSeconds = 0.16;

/** A line as a mode makes it (`EngineReverbLine`): seconds at scale 1. */
struct LineSpec
{
    double allpass = 0.01, delay = 0.05, apGain = 0.5;
    bool modDelay = false, modAllpass = false;
    float inLeft = 0, inRight = 0;
};

/** An output tap (`EngineReverbTap`): inside a line's delay (0) or all-pass (1), seconds back at scale 1. */
struct TapSpec
{
    int line = 0, where = 0, side = 0;
    double at = 0;
    float gain = 0;
};

/** The network a mode wires (`EngineReverbNetwork`); its `signature` says when it's another (a new mode, era or preset): a spillover. */
struct Topology
{
    int lines = 0;
    bool ring = true;
    std::array<LineSpec, maxLines> line {};
    int taps = 0;
    std::array<TapSpec, maxTaps> tap {};
    int diffusers = 0;
    std::array<double, maxDiffusers> diffuserLength {}, diffuserGain {};
    int quantise = 0, bits = 0;
    double clip = 0;
    juce::uint64 signature = 0;
};

/** What the network is told each block (glided by the State). */
struct NetworkParams
{
    /** Every length's scale (Size), the in-line all-passes' gains × `apScale`. */
    double scale = 1, apScale = 1;
    /** Hz, samples of excursion, 0 chorus / 1 random. */
    double modRate = 0.8, modDepth = 0;
    int modShape = 0;
    /** Plate: the input diffusers' gains × this, and its input low-pass (Hz). */
    double diffuse = 0.6, bandwidth = 20000;
    /** How much of each side reaches the other's lines; mono: both sides summed. */
    double cross = 0.3;
    bool mono = false;
    /** The absorption's dB × this (0: frozen, lossless; above 1: Auto-Decay's shorter tail). */
    double absorb = 1;
    /** Held (Freeze, ∞): the energy keeper keeps the loop's level, `ceiling` its most (∞'s, with its input open). */
    bool hold = false;
    double ceiling = 0;
};

/** One network: its lines, its taps, its memory. */
class Network
{
public:
    /** Its memory, for `rate` (message thread). */
    void allocate (double rate, const GraphicEq& eq);

    /** Wire it as `topology` at `scale`, empty, its absorption from `designs` (one a line). Audio thread. */
    void configure (const Topology& topology, double scale, const std::array<EqDesign, maxLines>& designs, const std::array<EqDesign, maxLines>& allpassDesigns);
    /** New absorption designs for the same wiring (T60 changed), and the in-place values (gains) of a topology of the same signature. */
    void redesign (const std::array<EqDesign, maxLines>& designs, const std::array<EqDesign, maxLines>& allpassDesigns, double designScale);
    void update (const Topology& topology);

    /** Run a block: `inL`/`inR` in (null: nothing), the late sound added into `outL`/`outR` × `level`. */
    /** `lines`: each line's own input (its velvet feed), in place of `inL`/`inR` through the lines' injection (null: those). */
    void process (const NetworkParams& params, const float* inL, const float* inR, float* outL, float* outR, int numSamples, float level, const float* const* lines = nullptr);

    /** Empty it (O(1): its rings forget). */
    void clear();
    bool configured() const { return topology.signature != 0 && lineCount > 0; }
    int lineTotal() const { return lineCount; }
    juce::uint64 signature() const { return topology.signature; }
    double scale() const { return scaleNow; }
    /** The loudest it was last block (its output), and its loop's energy. */
    float peak() const { return lastPeak; }
    double energy() const { return loopEnergy; }
    /** Its guard clipped (a loop pushed past ±4) since the last ask. */
    bool clipped()
    {
        const auto c = clippedFlag;
        clippedFlag = false;
        return c;
    }
    /** Not run until sound reaches it (idle). */
    bool idle = true;

private:
    class Ring
    {
    public:
        void allocate (int samples)
        {
            int size = 1;
            while (size < samples + 8)
                size <<= 1;
            data.assign ((size_t) size, 0.0f);
            mask = size - 1;
            written = -1;
            validFrom = 0;
        }
        void push (float x) { data[(size_t) (++written & mask)] = x; }
        /** `back` samples before the newest (0 the newest). */
        float whole (juce::int64 back) const
        {
            const auto i = written - back;
            return i < validFrom || back < 0 ? 0.0f : data[(size_t) (i & mask)];
        }
        void clear() { validFrom = written + 1; }
        juce::int64 capacity() const { return mask - 4; }

    private:
        std::vector<float> data;
        juce::int64 mask = 0, written = -1, validFrom = 0;
    };

    /** A read `delay` samples before the sample about to be written, through a first-order all-pass interpolator (its memory `y`). */
    static float thiran (const Ring& ring, double delay, double& y)
    {
        delay = juce::jlimit (1.5, (double) ring.capacity() - 2, delay);
        const auto k = (juce::int64) std::floor (delay - 0.5);
        const auto d = delay - (double) k;
        const auto a = (1 - d) / (1 + d);
        const auto out = a * ring.whole (k - 1) + ring.whole (k) - a * y;
        y = std::abs (out) < 1e-30 ? 0.0 : out;
        return (float) out;
    }

    struct Line
    {
        Ring delay, allpass;
        double delayY = 0, allpassY = 0;
        EqFilter absorb;
        /** Its all-pass's own loss, inside its loop (a lossy all-pass: what circulates in it decays as everything else does). */
        EqFilter allpassAbsorb;
        /** Samples at the configured scale (primes), its all-pass gain now. */
        double delayLength = 0, allpassLength = 0, gain = 0, gainTarget = 0;
        /** Its LFO: phase (cycles), rate factor, the random walk's ends. */
        double phase = 0, rateFactor = 1;
        float from = 0, to = 0;
        juce::uint32 seed = 1;
        /** This sample's modulation (samples), shared by its delay's and its all-pass's reads. */
        float out = 0;
    };

    float lfo (Line& line, int shape, double rate);
    static int nearestPrime (int n, const std::array<int, 2 * maxLines + maxDiffusers>& used, int count);

    double rate = 48000;
    const GraphicEq* eq = nullptr;
    Topology topology;
    int lineCount = 0;
    std::array<Line, maxLines> lines;
    std::array<EqDesign, maxLines> designs {}, allpassDesigns {};
    double designScale = 1, realisedAbsorb = -1, realisedRatio = -1;
    /** The designs a redesign glides from (at `fromScale`) and how far it's gone (1: there). A loop filter's
     *  coefficients jumping mid-sound would put a click into the lines, which their taps then play. */
    std::array<EqDesign, maxLines> designsFrom {}, allpassFrom {};
    double fromScale = 1, morph = 1;
    /** The loss now (NetworkParams::absorb, glided to). */
    double absorbNow = -1;
    /** `a` at `sa` and `b` at `sb` mixed (`t` of `b`), as one design at a scale of 1. */
    static EqDesign blend (const EqDesign& a, double sa, const EqDesign& b, double sb, double t);
    std::array<Ring, maxDiffusers> diffuserRing;
    std::array<double, maxDiffusers> diffuserLength {};
    double scaleNow = 1, configuredScale = 1;
    double bandwidthY = 0;
    double keep = 1, keepTarget = 0, held = 0;
    juce::int64 heldSamples = 0;
    float lastPeak = 0;
    double loopEnergy = 0;
    bool clippedFlag = false;
    int counter = 0;
    /** Each tap's place (samples back), placed again as Size moves. */
    /** Where each tap reads (samples, fractional: Size glides, and a tap stepping a whole sample would click). */
    std::array<double, maxTaps> tapAt {};
    /** Each tap's gain now, gliding to its own (Decay reshapes a Plate's taps: a step would click). */
    std::array<double, maxTaps> tapGain {};
};
} // namespace verb
