// Auto-Tune (docs/antares/auto-tune.md), Antares' pitch corrector, ours: it hears the pitch of what comes
// in (YIN, on a low-passed copy at about 12 kHz, refined at the full rate), decides the note it should be
// (the key's notes, Retune Speed, Humanize, Flex-Tune, Natural Vibrato, Transpose, Create Vibrato) and
// moves it there by pitch-synchronous overlap-add (TD-PSOLA): each pitch period is a grain, laid down
// again at the new period. Grains keep the voice's formants; resampling each one moves them (Throat
// Length), or, with Formant off, moves them with the pitch as a tape would.
//
// What the settings mean is decided in TypeScript (`shared/music/auto-tune.ts`): a song brings them in
// the engine's units (`Settings`). The sound (`State`) is kept across songs by the effect's id
// (`Registry`), made on the message thread and run on the audio thread, which never allocates or waits
// here. It looks ahead by a fixed `latency()` (the deepest voice's periods), which the mixer compensates.
#pragma once

#include <juce_audio_basics/juce_audio_basics.h>

#include <array>
#include <atomic>
#include <map>
#include <memory>
#include <vector>

namespace tune
{
/** What a note of the scale does (`AutoTuneNote`): tuned to, passed as it's sung, or never a target. */
enum class Note
{
    tune,
    bypass,
    remove
};

/** Create Vibrato's shapes. */
enum class Shape
{
    none,
    sine,
    square,
    saw
};

/**
 * An Auto-Tune's settings in a song (`EngineAutoTune`), made on the message thread. Automation lanes
 * change the automatable ones on the audio thread (`setControl`).
 */
struct Settings
{
    /** The input type's pitch range, in Hz: nothing outside it is heard as a pitch. */
    double minHz = 80, maxHz = 1000;
    /** YIN's threshold (Tracking): how unclear a period may be and still be a pitch. */
    double threshold = 0.2;
    /** The scale, by pitch class (C is 0) at `key`; the key automated rotates it (`keyNow`). */
    std::array<Note, 12> notes {};
    int key = 0;
    /** A4, in Hz. */
    double reference = 440;
    /** Seconds; 0..1; 0..1; a gain on the sung vibrato; semitones. */
    double retune = 0, humanize = 0, flexTune = 0, vibratoGain = 1, transpose = 0;
    bool formant = true, classic = false;
    /** Targeting ignores vibrato: the note is chosen from the sung pitch's centre, so a wide vibrato doesn't flip it. */
    bool ignoreVibrato = false;
    /** The formants' scale (1 as sung, above 1 a longer throat: lower). */
    double throat = 1;
    /** Create Vibrato: its shape, Hz, seconds before it starts and to come in, 0..1 of wander, semitones, 0..1 of level, 0..1 of formant. */
    Shape shape = Shape::none;
    double rate = 5.5, delay = 0.5, onset = 0.5, variation = 0, depth = 0, amplitude = 0, formantDepth = 0;
    /** The key now (an automation lane's; `key` otherwise). */
    int keyNow = 0;

    static std::shared_ptr<Settings> parse (const juce::var& json);
    /** An automation lane's value for a control (`AutoTuneControl`, by index). Audio thread. */
    void setControl (int control, float value);
};

/** One Auto-Tune's sound: what came in, its pitch, its grains, what goes out. */
class State
{
public:
    /** For a voice no lower than `minHz` (its latency follows from it), up to `capacity` samples a block. */
    State (double sampleRate, double minHz, int capacity);

    double sampleRate() const { return rate; }
    double lowest() const { return minHz; }
    int capacity() const { return blockCapacity; }
    /** Samples its sound comes out late by (the mixer compensates). */
    int latency() const { return delay; }

    /** Run `numSamples` of `left` and `right` through it, `mix` of it heard against the (delayed) dry sound. Audio thread. */
    void process (const Settings&, float* left, float* right, int numSamples, float mix);
    /** Skipped this block (bypassed): it starts afresh when it's next run. Audio thread. */
    void skipped() { stale = true; }

    /** What it hears and plays (`EngineAutoTuneState`): its latest pitches. Any thread. */
    juce::var describe() const;

private:
    struct Frame
    {
        /** The input sample it's the pitch of: the middle of what YIN compared. */
        double time = 0;
        /** The pitch heard, Hz (0: none), and what's done to it there: the pitch ratio, the grains' stretch, their gain. */
        float f0 = 0, ratio = 1, stretch = 1, gain = 1;
        bool shifted = false;
    };
    struct Mark
    {
        /** Where it is, to a fraction of a sample: grains a whole sample out drift a few cents. */
        double pos = 0;
        float period = 0;
    };

    void reset();
    /** The decimated copy's newest sample went in: every hop, a frame. */
    void analyse (const Settings&);
    /** YIN on the decimated window: the period in full-rate samples (0: no pitch), and how clear it is. */
    double detect (double& clarity, double& level);
    /** What's done at a frame with pitch `f0` (0: none): `Frame`'s ratio, stretch and gain, and the pitches said. */
    void correct (const Settings&, Frame&);
    /** The frame at input sample `t` (interpolated between the two around it). */
    Frame frameAt (double t) const;
    /** Analysis marks, a period apart, as far as the input allows. */
    void placeMarks();
    /** Grains laid down, as far as the samples up to `end` need. */
    void synthesise (juce::int64 end);
    void addGrain (const Mark&, double at, double stretch, float gain);
    float input (int side, double position) const;
    float rawInput (int side, juce::int64 index) const { return index < 0 || index < written - (juce::int64) inMask ? 0.0f : in[(size_t) side][(size_t) (index & (juce::int64) inMask)]; }

    double rate, minHz;
    int blockCapacity;
    /** Decimation to about 12 kHz for detection; the hop between frames (full-rate samples); the longest period (full-rate) and in the decimated copy. */
    int decimation = 4, hop = 128, maxPeriod = 600, maxTau = 150, minTau = 4;
    int delay = 0;
    /** An unvoiced stretch's grains: 5 ms. */
    int unvoicedPeriod = 240;

    // Rings: the input (both sides), its mono high-passed copy, the decimated copy, what goes out.
    std::array<std::vector<float>, 2> in;
    std::vector<float> mono, low;
    std::array<std::vector<float>, 2> out;
    juce::uint64 inMask = 0, lowMask = 0, outMask = 0;
    /** Input samples written (the next one's index), decimated ones written. */
    juce::int64 written = 0, lowWritten = 0;
    /** YIN's scratch (no allocation on the audio thread). */
    std::vector<float> window, difference;

    // The filters: DC out of the mono copy, two low-pass sections before decimating.
    struct Biquad
    {
        double b0 = 1, b1 = 0, b2 = 0, a1 = 0, a2 = 0, z1 = 0, z2 = 0;
        double run (double x)
        {
            const auto y = b0 * x + z1;
            z1 = b1 * x - a1 * y + z2;
            z2 = b2 * x - a2 * y;
            return y;
        }
    };
    std::array<Biquad, 2> lowPass;
    double dcIn = 0, dcOut = 0, dcPole = 0.997;
    /** Samples the low-pass delays the detector's copy by. */
    double filterDelay = 0;

    // Frames (one a hop), marks, and the grains' clock.
    std::vector<Frame> frames;
    juce::int64 frameCount = 0;
    std::vector<Mark> marks;
    juce::int64 markCount = 0;
    double nextMark = 0;
    /** Where the next grain goes (shifting), the last grain's place and mark, whether the last was shifted. */
    double nextGrain = 0, lastGrain = -1;
    juce::int64 lastMarkUsed = -1;
    bool lastShifted = false;

    // The detector's and the corrector's memory, a frame to the next.
    double lastF0 = 0;
    int unvoicedRun = 100;
    double correction = 0, centre = 0, held = 0, noteTime = 0, phase = 0, wander = 0, wanderTarget = 0;
    int target = -1;
    bool voiced = false;
    /** YIN's threshold this frame (Tracking's, a little looser while a note goes on). */
    double currentThreshold = 0.2;
    juce::uint32 seed = 0x2545f491;
    bool stale = true;

    // What it says (the audio thread writes, any thread reads): the latest pitches, a few a frame.
    static constexpr int reportSize = 64;
    struct Report
    {
        std::atomic<float> in { -1 }, out { -1 };
        std::atomic<int> target { -1 };
    };
    std::array<Report, reportSize> reports;
    std::atomic<juce::int64> reported { 0 };
};

/**
 * The song's Auto-Tunes' sounds, by effect id, kept across songs (message thread). The export makes a
 * registry of its own.
 */
class Registry
{
public:
    /** The effect's state, kept if it's at this rate, for this voice and block size; else a new one. */
    std::shared_ptr<State> get (const juce::String& effectId, double sampleRate, double minHz, int capacity);
    void keepOnly (const juce::StringArray& ids);
    /** `{ <effect id>: EngineAutoTuneState }`. */
    juce::var describe() const;

private:
    std::map<juce::String, std::shared_ptr<State>> states;
};
} // namespace tune
