// EchoBoy's building blocks (docs/soundtoys/echoboy-dsp.md): filters, a delay line read between its
// samples, all-pass diffusers, the wobble's LFOs and the nine saturations. Each is a few numbers of
// state, made on the message thread and run on the audio thread, which never allocates here.
#pragma once

#include <juce_core/juce_core.h>

#include <algorithm>
#include <cmath>
#include <vector>

namespace echo
{
constexpr double pi = 3.14159265358979323846;

/** A biquad (RBJ's cookbook), transposed direct form II. A new design keeps its state: no click. */
struct Biquad
{
    double b0 = 1, b1 = 0, b2 = 0, a1 = 0, a2 = 0;
    double z1 = 0, z2 = 0;

    float process (float x)
    {
        const auto y = b0 * x + z1;
        z1 = b1 * x - a1 * y + z2;
        z2 = b2 * x - a2 * y;
        return (float) y;
    }
    void reset() { z1 = z2 = 0; }
    void identity() { set (1, 0, 0, 1, 0, 0); }

    void set (double nb0, double nb1, double nb2, double na0, double na1, double na2)
    {
        b0 = nb0 / na0, b1 = nb1 / na0, b2 = nb2 / na0, a1 = na1 / na0, a2 = na2 / na0;
    }
    static double omega (double rate, double hz) { return 2 * pi * juce::jlimit (1.0, rate * 0.49, hz) / rate; }

    void lowpass (double rate, double hz, double q)
    {
        const auto w = omega (rate, hz), c = std::cos (w), alpha = std::sin (w) / (2 * q);
        set ((1 - c) / 2, 1 - c, (1 - c) / 2, 1 + alpha, -2 * c, 1 - alpha);
    }
    void highpass (double rate, double hz, double q)
    {
        const auto w = omega (rate, hz), c = std::cos (w), alpha = std::sin (w) / (2 * q);
        set ((1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + alpha, -2 * c, 1 - alpha);
    }
    void peak (double rate, double hz, double q, double db)
    {
        if (std::abs (db) < 1e-4)
            return identity();
        const auto a = std::pow (10.0, db / 40), w = omega (rate, hz), c = std::cos (w), alpha = std::sin (w) / (2 * q);
        set (1 + alpha * a, -2 * c, 1 - alpha * a, 1 + alpha / a, -2 * c, 1 - alpha / a);
    }
    /** A shelf (`high`: above `hz`, else below), `slope` 1 the steepest without a bump; gentler below. */
    void shelf (bool high, double rate, double hz, double db, double slope = 0.6)
    {
        if (std::abs (db) < 1e-4)
            return identity();
        const auto a = std::pow (10.0, db / 40), w = omega (rate, hz), c = std::cos (w), s = std::sin (w);
        const auto alpha = s / 2 * std::sqrt ((a + 1 / a) * (1 / slope - 1) + 2), k = 2 * std::sqrt (a) * alpha;
        if (high)
            set (a * ((a + 1) + (a - 1) * c + k), -2 * a * ((a - 1) + (a + 1) * c), a * ((a + 1) + (a - 1) * c - k), (a + 1) - (a - 1) * c + k, 2 * ((a - 1) - (a + 1) * c),
                 (a + 1) - (a - 1) * c - k);
        else
            set (a * ((a + 1) - (a - 1) * c + k), 2 * a * ((a - 1) - (a + 1) * c), a * ((a + 1) - (a - 1) * c - k), (a + 1) + (a - 1) * c + k, -2 * ((a - 1) + (a + 1) * c),
                 (a + 1) + (a - 1) * c - k);
    }
};

/** A one-pole low-pass: smoothing, and a DC blocker's inside. */
struct OnePole
{
    float y = 0;
    float process (float x, float coefficient) { return y += (x - y) * coefficient; }
    /** The coefficient that moves `1 - 1/e` of the way in `seconds`. */
    static float coefficient (double rate, double seconds) { return seconds <= 0 ? 1.0f : (float) (1 - std::exp (-1 / (seconds * rate))); }
};

/**
 * A delay line: what's written, read any distance back (Hermite between samples). Silence before
 * `validFrom` (made, or cleared since: a bypass), so nothing old comes back.
 */
class DelayLine
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
    int capacity() const { return (int) mask - 4; }
    void push (float x) { data[(size_t) (++written & mask)] = x; }
    /** The sample `delay` samples before the newest one (0 is the newest). */
    float read (double delay) const
    {
        delay = juce::jlimit (0.0, (double) capacity(), delay);
        const auto whole = (juce::int64) std::floor (delay);
        const auto f = (float) (delay - (double) whole);
        const auto i = written - whole;
        const auto ym1 = at (i + 1), y0 = at (i), y1 = at (i - 1), y2 = at (i - 2);
        // Catmull-Rom from y0 towards y1 (further back), `f` of the way.
        const auto c1 = 0.5f * (y1 - ym1), c2 = ym1 - 2.5f * y0 + 2.0f * y1 - 0.5f * y2, c3 = 0.5f * (y2 - ym1) + 1.5f * (y0 - y1);
        return ((c3 * f + c2) * f + c1) * f + y0;
    }
    /** Forget what's in it: from now on, reads before this sample are silent. */
    void clear() { validFrom = written + 1; }

private:
    float at (juce::int64 i) const { return i < validFrom || i > written ? 0.0f : data[(size_t) (i & mask)]; }
    std::vector<float> data;
    juce::int64 mask = 0, written = -1, validFrom = 0;
};

/** A Schroeder all-pass of up to `capacity` samples: smears without colouring (the diffusion's stage). */
class Allpass
{
public:
    void allocate (int samples) { buffer.assign ((size_t) juce::jmax (2, samples), 0.0f), index = 0; }
    float process (float x, int length, float g)
    {
        length = juce::jlimit (1, (int) buffer.size(), length);
        const auto read = index - length < 0 ? index - length + (int) buffer.size() : index - length;
        const auto delayed = buffer[(size_t) read];
        const auto v = x + g * delayed;
        buffer[(size_t) index] = v;
        index = index + 1 == (int) buffer.size() ? 0 : index + 1;
        return delayed - g * v;
    }
    void clear() { std::fill (buffer.begin(), buffer.end(), 0.0f); }

private:
    std::vector<float> buffer;
    int index = 0;
};

/** The wobble's shapes, as `EngineEchoBoy.wobble.shape` numbers them. */
enum class Shape
{
    triangle,
    sine,
    square,
    randomWalk,
    randomHold
};

/** One path's wobble: -1..1 at `rate` Hz, the jumps of Square and Random S/H rounded off a little. */
struct Lfo
{
    double phase = 0;
    float from = 0, to = 0, smooth = 0;
    juce::uint32 seed = 1;

    float random()
    {
        seed = seed * 1664525u + 1013904223u;
        return (float) (seed >> 8) / 8388608.0f - 1.0f;
    }
    /** The next value at `rate` Hz; `offset` (cycles) shifts where in its shape it reads. */
    float next (Shape shape, double rate, double sampleRate, double offset = 0)
    {
        phase += rate / sampleRate;
        if (phase >= 1)
        {
            phase -= std::floor (phase);
            from = to;
            to = random();
        }
        const auto p = std::abs (offset) < 1e-12 ? phase : phase + offset - std::floor (phase + offset);
        float v = 0;
        switch (shape)
        {
            case Shape::triangle: v = (float) (p < 0.5 ? 4 * p - 1 : 3 - 4 * p); break;
            case Shape::sine: v = (float) std::sin (2 * pi * p); break;
            case Shape::square: v = p < 0.5 ? 1.0f : -1.0f; break;
            case Shape::randomWalk: v = from + (to - from) * (float) (0.5 - 0.5 * std::cos (pi * p)); break;
            case Shape::randomHold: v = to; break;
        }
        // Jumps glide over a twentieth of a cycle (2 ms at least): a jump in a delay's length clicks.
        if (shape == Shape::square || shape == Shape::randomHold)
            return smooth += (v - smooth) * OnePole::coefficient (sampleRate, juce::jmax (0.002, 0.05 / juce::jmax (rate, 1e-3)));
        return smooth = v;
    }
};

/** The Style Editor's saturation types, as `EngineEchoBoy.saturation.type` numbers them. */
enum class Saturation
{
    clean,
    tape,
    warm,
    pump,
    dirt,
    hardLimit,
    softLimit,
    warmLimit,
    brightLimit
};

/**
 * One saturation stage: a sound driven `drive` (linear) into the type's curve and brought back down by
 * the same, so a quiet sound passes at its level and only what's driven past the curve's knee changes.
 * The limiters keep an envelope; Tape and Bright Limit filters of their own.
 */
class Saturator
{
public:
    void prepare (double sampleRate)
    {
        rate = sampleRate;
        emphasis.shelf (true, rate, 3000, 6, 0.7);
        deemphasis.shelf (true, rate, 3000, -6, 0.7);
        air.shelf (true, rate, 8000, 3, 0.7);
        detectorLow.lowpass (rate, 2500, 0.707);
        dcCoefficient = OnePole::coefficient (rate, 1 / (2 * pi * 8));
        fastAttack = OnePole::coefficient (rate, 0.0002);
        attack = OnePole::coefficient (rate, 0.002);
        slowAttack = OnePole::coefficient (rate, 0.006);
        pumpRelease = OnePole::coefficient (rate, 0.25);
        hardRelease = OnePole::coefficient (rate, 0.07);
        softRelease = OnePole::coefficient (rate, 0.2);
    }
    void reset() { envelope = 0, dc.y = 0, emphasis.reset(), deemphasis.reset(), air.reset(), detectorLow.reset(); }

    float process (float x, Saturation type, float drive)
    {
        const auto u = x * drive;
        float y = u;
        switch (type)
        {
            case Saturation::clean: y = knee (u); break;
            case Saturation::tape:
            {
                // Highs boosted into the curve and cut after: they compress first (tape's HF compression);
                // a touch of asymmetry (the bias) for the lows' grit.
                const auto e = emphasis.process (u);
                y = blockDc (deemphasis.process (std::tanh (e + 0.08f * e * e) - 0.08f * std::tanh (e) * std::tanh (e)));
                break;
            }
            case Saturation::warm: y = blockDc (warm (u)); break;
            case Saturation::pump:
            {
                // A limiter that lets its first edge through and lets go slowly: it pops and pumps.
                follow (std::abs (u), attack, pumpRelease);
                y = std::tanh (u * (envelope > 0.5f ? 0.5f / envelope : 1.0f) * 1.2f) / 1.2f * 1.25f;
                break;
            }
            case Saturation::dirt:
                // Harder-edged, and each half its own: even harmonics, grit.
                y = blockDc (u >= 0 ? cubic (u * 0.8f) / 1.2f : cubic (u) / 1.5f);
                break;
            case Saturation::hardLimit:
                follow (std::abs (u), fastAttack, hardRelease);
                y = juce::jlimit (-1.0f, 1.0f, u * (envelope > 0.9f ? 0.9f / envelope : 1.0f));
                break;
            case Saturation::softLimit:
                y = knee (u * softGain (std::abs (u), slowAttack));
                break;
            case Saturation::warmLimit:
                y = blockDc (warm (u * softGain (std::abs (u), slowAttack)));
                break;
            case Saturation::brightLimit:
                // The limiter hears the lows and mids only: the air passes over it, lifted a little.
                y = air.process (knee (u * softGain (std::abs (detectorLow.process (u)), slowAttack)));
                break;
        }
        return y / drive;
    }

private:
    /** Straight to about 0.6 (half scale loses 0.002 dB), bending smoothly to a ceiling of 1. */
    static float knee (float u)
    {
        const auto u2 = u * u, u4 = u2 * u2;
        return u / std::sqrt (std::sqrt (std::sqrt (1.0f + u4 * u4)));
    }
    static float cubic (float v)
    {
        v = juce::jlimit (-1.0f, 1.0f, v);
        return 1.5f * v - 0.5f * v * v * v;
    }
    /** Asymmetric: even harmonics (a tube's), its slope at 0 one. */
    static float warm (float u) { return (std::tanh (1.4f * u + 0.3f) - 0.29131261f) / 1.28385f; }
    float blockDc (float y) { return y - dc.process (y, dcCoefficient); }
    void follow (float level, float up, float down) { envelope += (level - envelope) * (level > envelope ? up : down); }
    /** A soft limiter's gain: about 8:1 past 0.7, from its envelope. */
    float softGain (float level, float up)
    {
        follow (level, up, softRelease);
        if (envelope <= 0.7f)
            return 1.0f;
        const auto over = envelope / 0.7f;
        return std::pow (over, 1.0f / 8.0f - 1.0f);
    }

    double rate = 48000;
    Biquad emphasis, deemphasis, air, detectorLow;
    OnePole dc;
    float dcCoefficient = 0, fastAttack = 1, attack = 1, slowAttack = 1, pumpRelease = 0, hardRelease = 0, softRelease = 0;
    float envelope = 0;
};

/** Past about ±1, a runaway loop is held under ±2 (transparent below): no style blows up. */
inline float safety (float x) { return std::abs (x) < 1.0f ? x : (x > 0 ? 1.0f : -1.0f) * (1.0f + std::tanh (std::abs (x) - 1.0f)); }
} // namespace echo
