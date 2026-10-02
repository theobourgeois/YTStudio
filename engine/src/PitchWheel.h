// Pitch Wheel (docs/quikquak/pitchwheel.md), QuikQuak's Pitchwheel, ours: a pitch shifter played by
// hand. Each wheel's pointer is a target; the pitch heard follows it through Smooth and a spring
// (Gravity, Inertia), every sample. The sound is shifted in the frequency domain, Laroche and Dolson's
// way: a zero-phase, twice zero-padded FFT of each side every eighth of a window; each spectral peak and
// the bins around it moved by whole bins to the new frequency and turned by a phase that advances at the
// exact new frequency (identity phase locking), the same turn on both sides (the stereo image stays);
// onsets reset the phases (drums stay sharp). The Timbre wheel moves the spectral envelope (a true
// envelope, from an iterated cepstrum) on its own; closed, the envelope moves with the pitch.
//
// Notes play it: Single, the latest one sets the offset from the origin note; Multi, each is a voice of
// its own, synthesised from the same analysis and gated on its very sample. They come from a channel of
// the song (the sequencer calls `noteOn`, audio thread) or from the window's keyboard (`liveNote`).
//
// What the settings mean is decided in TypeScript (`shared/music/pitch-wheel.ts`), but for the physics,
// mirrored from `wheelPhysics`/`stepWheel` there. A song brings them (`Settings`); the sound (`State`) is
// kept across songs by effect id (`Registry`), made on the message thread and run on the audio thread,
// which never allocates or waits here. It comes out a window late (`latency()`), which the mixer
// compensates.
#pragma once

#include <juce_audio_basics/juce_audio_basics.h>
#include <juce_dsp/juce_dsp.h>

#include <array>
#include <atomic>
#include <complex>
#include <map>
#include <memory>
#include <vector>

namespace wheel
{
/** A time that never comes (input samples): far off, but room to add to it. */
constexpr juce::int64 never = std::numeric_limits<juce::int64>::max() / 4;

/** A wheel's pointer (snapped, semitones) and its knobs, 0..1. */
struct WheelSettings
{
    double target = 0, gravity = 0.75, inertia = 0.45, smooth = 0.1;
};

/** A Pitch Wheel's settings in a song (`EnginePitchWheel`). Automation lanes change the wheels' on the audio thread (`setControl`). */
struct Settings
{
    WheelSettings pitch, timbre;
    bool timbreOn = true, multi = false;
    /** The channel whose notes play it (resolved by the song), and the note that shifts nothing. */
    juce::String notesFrom;
    int origin = 60;
    /** The analysis window at 48 kHz. */
    int window = 2048;

    static std::shared_ptr<Settings> parse (const juce::var& json);
    /** An automation lane's value for a control (`PitchWheelControl`, by index). Audio thread. */
    void setControl (int control, float value);
};

/** How a wheel's actual pitch follows its target over one sample (`wheelPhysics`, solved exactly for that step). */
struct Physics
{
    /** The pointer's follower: what of the gap it closes a sample. */
    double follow = 1;
    bool clamped = false;
    /** The spring's step: [gap, velocity] times this matrix. */
    double ee = 1, ev = 0, ve = 0, vv = 1;
    /** What it was made from, to know when to make it again. */
    double gravity = -1, inertia = -1, smooth = -1;

    void update (const WheelSettings&, double sampleRate);
};

/** Where a wheel is: its smoothed target, the actual pitch (semitones) and its speed (semitones a sample). */
struct Motion
{
    double target = 0, actual = 0, velocity = 0;
    void restAt (double value) { target = actual = value, velocity = 0; }
    void step (double goal, const Physics&);
};

/** One Pitch Wheel's sound. */
class State
{
public:
    /** For a window of `window` samples at 48 kHz (scaled to `sampleRate`), up to `capacity` samples a block. */
    State (double sampleRate, int window, int capacity);

    double sampleRate() const { return rate; }
    int window() const { return requestedWindow; }
    int capacity() const { return blockCapacity; }
    /** Samples its sound comes out late by (the mixer compensates). */
    int latency() const { return size; }

    /** Run `numSamples` of `left` and `right` through it, `mix` of it heard against the (delayed) dry sound. Audio thread. */
    void process (Settings&, float* left, float* right, int numSamples, float mix);
    /** Skipped this block (bypassed): it starts afresh when it's next run. Audio thread. */
    void skipped() { stale = true; }

    /** A note of the channel it follows, `offset` samples into the next block, `length` samples long. Audio thread (the sequencer's). */
    void noteOn (int key, float velocity, int offset, juce::int64 length);
    /** Play stopped (or jumped): its notes end; Single's offset goes back to none. Audio thread. */
    void notesOff();

    // Message thread: the hand.
    /** Hold a wheel's pointer here (semitones; snapped by the tab) for a moment (renewed while held). */
    void holdPitch (float semitones);
    void holdTimbre (float semitones);
    /** The actual pitch and timbre jump onto their pointers (a typed value). */
    void jump() { ++jumps; }
    /** A key of its keyboard, pressed or let go. */
    void liveNote (int key, bool on);

    /** What it's doing (`EnginePitchWheelState`). Any thread. */
    juce::var describe() const;

private:
    static constexpr int maxVoices = 12, maxHeld = 8, maxEvents = 64;

    struct Voice
    {
        bool active = false;
        /** Its note (-1: Single's voice). */
        int key = -1;
        float gain = 1;
        /** What the Timbre wheel's gains are scaled by to keep the sound's loudness (gliding frame to frame). */
        float loudness = 1;
        /** Input samples: when its gate opens and closes (closes: far off while it's held). */
        juce::int64 onAt = 0, offAt = never;
        /** Semitones from the origin (its note's), added to the wheel. */
        double offset = 0;
        Motion motion;
        /** Its pitch at each input sample (a ring of `size`), which frames read. */
        std::vector<float> history;
        /** The phase turn of each input bin's region, last frame and this one. */
        std::vector<float> thetaPrev, theta;
        /** What it's synthesised, both sides (rings), and its spectrum's scratch. */
        std::array<std::vector<float>, 2> out;
        std::array<std::vector<float>, 2> spectrum;
        juce::uint32 age = 0;
    };

    struct Event
    {
        int offset;
        int key;
        float velocity;
        /** Off, or on: how long (samples; negative: until let go). */
        bool on;
        juce::int64 length;
    };

    struct Held
    {
        int key;
        float velocity;
        /** The input sample it ends on (far off: held by the hand until let go). */
        juce::int64 endsAt;
    };

    void reset (const Settings&);
    void startVoice (Voice&, int key, float velocity, juce::int64 at, double goal);
    void press (const Event&, const Settings&, juce::int64 at);
    /** A note let go at input sample `at`: out of the held list (Single keeps its offset), its voice's gate closing. */
    void release (int key, juce::int64 at);
    double singleOffset() const;
    /** The input's newest sample went in and a hop has passed: analyse, shift, synthesise. */
    void frame (const Settings&);
    void analyse();
    void envelope();
    void synthesise (Voice&, bool timbreOn, double timbreRatio);
    float envelopeAt (double bin) const;

    double rate;
    int requestedWindow, blockCapacity;
    /** The window, the FFT's size (twice it: zero-padded), the hop. */
    int size = 2048, fftSize = 4096, hop = 256, bins = 2049;
    std::unique_ptr<juce::dsp::FFT> fft, cepstrumFft;
    std::vector<float> hann;
    float synthesisGain = 1.0f / 3.0f;

    // The input (both sides), a ring; samples written.
    std::array<std::vector<float>, 2> in;
    juce::int64 written = 0;
    juce::uint64 inMask = 0, outMask = 0, historyMask = 0;

    // Analysis: this frame's spectra (interleaved complex), last frame's phases, the power both sides
    // have, the peaks and their regions, each peak's frequency (radians a sample).
    std::array<std::vector<float>, 2> spectra;
    std::array<std::vector<float>, 2> lastPhase;
    std::vector<float> power;
    std::vector<int> peaks, regionLow, regionHigh;
    std::vector<double> peakOmega;
    /** The Timbre wheel's gain for each peak's region (scratch). */
    std::vector<float> regionGains;
    double highEnergy = 0, highEnergyBefore = 0;
    int sinceOnset = 1000;
    bool onset = false;
    /** The input is silent: nothing to shift. */
    bool silent = true;
    /** The first bin above the frequency onsets reset the phases of. */
    int resetFrom = 0;

    // The true envelope (log magnitude, half the FFT's bins), its scratch, the lifter's order (in
    // samples of quefrency: it follows the pitch, between its least and most).
    std::vector<float> logEnvelope, cepstrum, logSpectrum;
    float lifter = 60, lifterLeast = 48, lifterMost = 384;

    // The wheels and the voices.
    Physics pitchPhysics, timbrePhysics;
    Motion base, timbre;
    std::array<Voice, maxVoices> voices;
    juce::uint32 voiceCount = 0;
    /** Single's notes held, latest last, and the offset the last one left. */
    std::array<Held, maxHeld * 2> held {};
    int numHeld = 0;
    double lastOffset = 0;
    /** The settings' origin, as of this block. */
    int origin = 60;
    /** The notes of this block (from the sequencer), and the hand's (from the message thread). */
    std::array<Event, maxEvents> events {};
    int numEvents = 0;
    juce::AbstractFifo liveQueue { maxEvents };
    std::array<std::pair<int, bool>, maxEvents> liveNotes {};
    bool stale = true;
    /** Multi was on last block (a change starts the voices afresh). */
    bool wasMulti = false;

    // The hand's pointers: a value held for a moment, renewed; a jump asked for.
    std::atomic<float> handPitch { 0 }, handTimbre { 0 };
    std::atomic<int> pitchHolds { 0 }, timbreHolds { 0 }, jumps { 0 };
    int pitchHoldsSeen = 0, timbreHoldsSeen = 0, jumpsSeen = 0;
    juce::int64 pitchHeldUntil = 0, timbreHeldUntil = 0;
    juce::int64 holdSamples = 12000;

    // What it says (the audio thread writes, any thread reads).
    std::atomic<float> saidPitch { 0 }, saidTimbre { 0 }, saidInput { 0 };
    std::array<std::atomic<int>, maxVoices> saidKeys {};
    std::array<std::atomic<float>, maxVoices> saidPitches {};
    std::array<std::atomic<juce::uint32>, 4> saidNotes {};
    float inputPeak = 0;
};

/**
 * The song's Pitch Wheels' sounds, by effect id, kept across songs (message thread). The export makes a
 * registry of its own.
 */
class Registry
{
public:
    /** The effect's state, kept if it's at this rate, window and block size; else a new one. */
    std::shared_ptr<State> get (const juce::String& effectId, double sampleRate, int window, int capacity);
    std::shared_ptr<State> find (const juce::String& effectId) const;
    void keepOnly (const juce::StringArray& ids);
    /** `{ <effect id>: EnginePitchWheelState }`. */
    juce::var describe() const;

private:
    std::map<juce::String, std::shared_ptr<State>> states;
};
} // namespace wheel
