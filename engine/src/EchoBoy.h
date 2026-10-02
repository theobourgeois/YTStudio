// EchoBoy (docs/soundtoys/echoboy-manual.md), Soundtoys' echo, ours: up to four delay lines wired as its
// mode says (decided in TypeScript, `shared/music/echo-boy.ts`: what each line takes in, a feedback matrix
// between them, where each is heard; Rhythm Echo's taps), each repeat coloured again by the style on its
// way round (the Decay EQ, the record stage's saturation, Low and High Cut, diffusion and wobble in the
// loop), the wet sound then coloured once (the Gain EQ, Out Sat, diffusion, wobble) and mixed with the dry.
//
// The sound (`State`: the lines, filters, LFOs) is kept across songs by the effect's id (`Registry`), so
// turning a knob doesn't cut the echoes off: a new time glides there (Time) or crossfades (a note value).
// It's made on the message thread and run on the audio thread, which never allocates or waits here.
#pragma once

#include "EchoDsp.h"

#include <juce_audio_basics/juce_audio_basics.h>

#include <array>
#include <atomic>
#include <map>
#include <memory>

namespace echo
{
constexpr int maxLines = 4;
constexpr int maxTaps = 16;
/** The longest a line holds (seconds): EchoBoy's 15 s, a Rhythm pattern of 8 beats at 30 bpm, and the wobble's reach. */
constexpr double maxSeconds = 16.5;

/** A delay line as the song has it (`EngineEchoLine`). */
struct Line
{
    /** Seconds; whether a new length glides (tape) or crossfades. */
    double delay = 0.25;
    bool glide = false;
    /** From the input's left and right; to the output's. */
    std::array<float, 2> input {}, out {};
    /** Whose wobble it follows: 0 left, 1 right. */
    int group = 0;
};

/** A Rhythm Echo tap reading line 0 (`EngineEchoTap`). */
struct Tap
{
    double delay = 0, offset = 0;
    float left = 0, right = 0;
    bool one = false;
};

/** The automation lanes of an EchoBoy (`EchoLane`), in `ECHO_LANES`' order. */
enum class Control
{
    mix,
    feedback,
    delays,
    lowCut,
    highCut,
    saturation,
    input,
    output,
    feel,
    side
};

/**
 * An EchoBoy's settings in a song (`EngineEchoBoy`), made on the message thread. Automation lanes change
 * some of them (`set`) on the audio thread.
 */
struct Settings
{
    int lines = 0;
    std::array<Line, maxLines> line;
    /** Line i takes in `fixed[i * lines + j] + amount * feedback[i * lines + j]` of line j's output. */
    std::array<float, maxLines * maxLines> feedback {}, fixed {};
    float amount = 0;
    int taps = 0;
    std::array<Tap, maxTaps> tap;
    double feel = 0;
    float dry = 1, wet = 1, input = 1, output = 1, side = 1;
    /** Hz, 0 off. */
    double lowCut = 0, highCut = 0;
    /** The Style Editor's EQ: frequency, gain (dB, the first repeat), dB each further repeat; the mid's Q. */
    double lowFreq = 20, lowGain = 0, lowDecay = 0, midFreq = 1000, midQ = 0.7, midGain = 0, midDecay = 0, highFreq = 12000, highGain = 0, highDecay = 0;
    double diffusionAmount = 0, diffusionSize = 10;
    bool diffusionLoop = true;
    double wobbleDepth = 0, wobbleRate = 0.5, wobbleSync = 0;
    Shape wobbleShape = Shape::randomWalk;
    bool wobbleFeedback = true, wobbleOut = false;
    Saturation saturation = Saturation::clean;
    /** dB of drive into the record stage's and the output's saturation. */
    double decaySat = 0, outSat = 0;

    /** The dry sound while it's run, for the slot's mix (as long as the song's longest block). */
    juce::AudioBuffer<float> dryBuffer;

    static std::shared_ptr<Settings> parse (const juce::var& json, int capacity);
    /** An automation lane's values (`size` of them) for `control`. Audio thread. */
    void set (Control control, const float* values, int size);
    /** What the lane `control` is as the song has it (its base, put back when the song stops). */
    void get (Control control, float* values, int& size) const;
};

/** One EchoBoy's sound: its lines, its filters' and saturations' states, its LFOs, what it heard. */
class State
{
public:
    explicit State (double sampleRate);

    double sampleRate() const { return rate; }

    /** Run `numSamples` of `left` and `right` through it, in place: the dry sound and the echo, mixed. Audio thread. */
    void process (const Settings&, float* left, float* right, int numSamples);
    /** Skipped this block (bypassed): its echoes stop, and it starts empty when it's next run. Audio thread. */
    void skipped() { wasSkipped = true; }

    /** `{ input: [l, r], output: [l, r] }`: the peaks into the echo and out of it (falling), for its LEDs. Any thread. */
    juce::var describe() const;

private:
    struct LineState
    {
        DelayLine buffer;
        /** Its length now and where it's going (samples); a crossfade's old length and the samples it has left. */
        double current = -1, target = -1, fadeFrom = 0;
        int fadeLeft = 0;
        Biquad lowDecay, midDecay, highDecay, cutLow, cutHigh;
        Saturator saturator;
        std::array<Allpass, 4> diffusers;
        OnePole dc;
        /** This sample's reads: round the loop, and as heard. */
        float loop = 0, heard = 0;
    };

    void design (const Settings&);
    void clear();
    /** A line read `offset` samples further back than its length (its crossfade, if one's going, mixed in). */
    float readLine (const LineState&, double offset) const;

    double rate;
    std::array<LineState, maxLines> lines;
    std::array<double, maxTaps> tapDelay {};
    /** The wet sound's EQ, saturation, diffusion and wobble, a side each. */
    std::array<Biquad, 2> gainLow, gainMid, gainHigh;
    std::array<Saturator, 2> outSaturator;
    std::array<std::array<Allpass, 4>, 2> post;
    std::array<DelayLine, 2> wobbleLine;
    /** The wobble's LFOs: the loop's left and right, the output's left and right. */
    std::array<Lfo, 4> lfos;
    /** Gains glide to the song's over a few ms. */
    float dry = 1, wet = 1, input = 1, output = 1, side = 1, amount = 0;
    bool started = false, wasSkipped = false;
    /** What the filters were designed for, to design them again only when it changes. */
    std::array<double, 13> designed {};

    std::atomic<float> inPeak[2] {}, outPeak[2] {};
};

/**
 * The song's EchoBoys' sounds, by effect id, kept across songs (message thread). The export makes a
 * registry of its own, so it starts with empty lines and leaves playback's alone.
 */
class Registry
{
public:
    std::shared_ptr<State> get (const juce::String& effectId, double sampleRate);
    void keepOnly (const juce::StringArray& ids);
    /** `{ <effect id>: { input, output } }`. */
    juce::var describe() const;

private:
    std::map<juce::String, std::shared_ptr<State>> states;
};
} // namespace echo
