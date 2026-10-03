// Pro-C's blocks (docs/fabfilter/pro-c.md 5): the gain computer's curves, a moving maximum and box
// filters for lookahead, a Linkwitz-Riley splitter for TTM, the colour shapers, small filters.
// Header-only, allocation-free once made: the audio thread runs them. The curves are the tab's
// (shared/music/pro-c.ts: `kneeOver`, `progressiveOver`, `limitRange`, `curveReduction`,
// `feedbackLaw`): keep the two in step; the offline tests hold the engine to them.
#pragma once

#include <juce_core/juce_core.h>

#include <algorithm>
#include <cmath>
#include <vector>

namespace comp
{
/** dB of a linear level, floored at -120 dB. */
inline double toDb (double x) { return 20.0 * std::log10 (std::max (x, 1e-6)); }
inline double fromDb (double db) { return std::pow (10.0, db / 20.0); }
/** A one-pole's coefficient: the share of the way it moves each sample, for a 63% time of `seconds`. */
inline double coefficient (double seconds, double rate) { return seconds <= 0 ? 1.0 : 1.0 - std::exp (-1.0 / (seconds * rate)); }

// ---------------------------------------------------------------------------------------------------------
// The curves (dB)
// ---------------------------------------------------------------------------------------------------------

enum class CurveKind
{
    standard,
    progressive,
    upward,
    vocal
};

struct Curve
{
    CurveKind kind = CurveKind::standard;
    double threshold = -18, slope = 0.75, knee = 6, range = 40;
};

/** Giannoulis' soft knee as reduction, slope 1 above it (`kneeOver`). */
inline double kneeOver (double o, double width)
{
    if (width <= 0)
        return std::max (0.0, o);
    if (o <= -width / 2)
        return 0;
    if (o >= width / 2)
        return o;
    return (o + width / 2) * (o + width / 2) / (2 * width);
}

/** The progressive rise: its slope grows from 0 to 1 over about 2W (`progressiveOver`). */
inline double progressiveOver (double o, double width)
{
    const auto w = std::max (0.5, width);
    const auto x = std::max (0.0, o + w / 2);
    return x - w * (1 - std::exp (-x / w));
}

/** Range's rounded corner (`limitRange`). */
inline double limitRange (double gr, double range, double width)
{
    const auto wg = std::max (1.0, std::min (width, range));
    if (gr <= range - wg / 2)
        return gr;
    if (gr >= range + wg / 2)
        return range;
    const auto d = range + wg / 2 - gr;
    return range - d * d / (2 * wg);
}

inline double vocalKnee (double average) { return juce::jlimit (12.0, 30.0, 12 + 1.5 * average); }

/** The reduction (dB; negative a boost) at a level, feedforward (`curveReduction`). */
inline double curveReduction (const Curve& c, double level, double vocalAverage)
{
    const auto o = level - c.threshold;
    switch (c.kind)
    {
        case CurveKind::standard: return limitRange (c.slope * kneeOver (o, c.knee), c.range, c.knee);
        case CurveKind::progressive: return limitRange (c.slope * progressiveOver (o, c.knee), c.range, c.knee);
        case CurveKind::vocal:
        {
            const auto knee = vocalKnee (vocalAverage);
            return limitRange (kneeOver (o, knee), c.range, knee);
        }
        case CurveKind::upward:
        {
            const auto boost = std::min (c.range, c.slope * kneeOver (-o, c.knee));
            const auto floor = c.threshold - 40;
            const auto fade = juce::jlimit (0.0, 1.0, (level - floor) / 12);
            return -boost * fade;
        }
    }
    return 0;
}

/** A feedback loop's law for an output level (`feedbackLaw`). */
inline double feedbackLaw (const Curve& c, double loop, double out)
{
    const auto o = out - c.threshold;
    const auto shaped = c.kind == CurveKind::progressive ? progressiveOver (o, c.knee) : kneeOver (o, c.knee);
    return limitRange (loop * shaped, c.range, c.knee);
}

// ---------------------------------------------------------------------------------------------------------
// Lookahead: a moving maximum, then two boxes (Signalsmith's limiter shaping)
// ---------------------------------------------------------------------------------------------------------

/** The largest of the last `length` values, in constant time per sample (a monotonic queue). */
class MovingMax
{
public:
    void prepare (int capacity)
    {
        values.assign ((size_t) capacity + 2, 0.0);
        stamps.assign ((size_t) capacity + 2, 0);
        reset();
    }
    void reset() { head = tail = 0, now = 0; }
    double push (double x, int length)
    {
        const auto size = (int) values.size();
        if (size == 0)
            return x;
        ++now;
        // Drop what's older than the window from the front, and what's not bigger than x from the back.
        while (head != tail && stamps[(size_t) head] <= now - length)
            head = (head + 1) % size;
        while (head != tail && values[(size_t) ((tail - 1 + size) % size)] <= x)
            tail = (tail - 1 + size) % size;
        values[(size_t) tail] = x;
        stamps[(size_t) tail] = now;
        tail = (tail + 1) % size;
        return values[(size_t) head];
    }

private:
    std::vector<double> values;
    std::vector<juce::int64> stamps;
    int head = 0, tail = 0;
    juce::int64 now = 0;
};

/** A moving average of the last `length` values (a running sum over a ring). */
class Box
{
public:
    void prepare (int capacity)
    {
        ring.assign ((size_t) capacity + 1, 0.0);
        reset();
    }
    void reset()
    {
        std::fill (ring.begin(), ring.end(), 0.0);
        sum = 0, write = 0;
    }
    double push (double x, int length)
    {
        const auto size = (int) ring.size();
        length = juce::jlimit (1, std::max (1, size - 1), length);
        ring[(size_t) write] = x;
        sum += x;
        auto old = write - length;
        if (old < 0)
            old += size;
        sum -= ring[(size_t) old];
        ring[(size_t) old] = 0;
        write = (write + 1) % size;
        return sum / length;
    }

private:
    std::vector<double> ring;
    double sum = 0;
    int write = 0;
};

// ---------------------------------------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------------------------------------

/** A one-pole TPT low-pass (its high-pass is the input less it). */
struct OnePole
{
    double g = 0, s = 0;
    void setup (double hz, double rate)
    {
        const auto w = std::tan (juce::MathConstants<double>::pi * std::min (hz, 0.49 * rate) / rate);
        g = w / (1 + w);
    }
    double low (double x)
    {
        const auto v = (x - s) * g;
        const auto y = v + s;
        s = y + v;
        return y;
    }
    double high (double x) { return x - low (x); }
    void reset() { s = 0; }
};

/** A state-variable section at Q = 1/√2 (a Linkwitz-Riley's half), its low, high and all-pass outputs. */
struct Butter
{
    double a1 = 0, a2 = 0, a3 = 0, k = std::sqrt (2.0), s1 = 0, s2 = 0;
    void setup (double hz, double rate)
    {
        const auto g = std::tan (juce::MathConstants<double>::pi * std::min (hz, 0.49 * rate) / rate);
        a1 = 1.0 / (1.0 + g * (g + k));
        a2 = g * a1;
        a3 = g * a2;
    }
    void run (double x, double& low, double& high, double& all)
    {
        const auto v3 = x - s2;
        const auto v1 = a1 * s1 + a2 * v3;
        const auto v2 = s2 + a2 * s1 + a3 * v3;
        s1 = 2 * v1 - s1;
        s2 = 2 * v2 - s2;
        low = v2;
        high = x - k * v1 - v2;
        all = x - 2 * k * v1;
    }
    void reset() { s1 = s2 = 0; }
};

/** Three bands (LR4 at two crossovers) that add back up to the sound, phase-shifted (OTT's splitter). */
struct Splitter
{
    Butter low1, low2, high1, high2, lowAll, mid1, mid2, top1, top2;
    void setup (double lowHz, double highHz, double rate)
    {
        for (auto* b : { &low1, &low2, &high1, &high2 })
            b->setup (lowHz, rate);
        for (auto* b : { &lowAll, &mid1, &mid2, &top1, &top2 })
            b->setup (highHz, rate);
    }
    void split (double x, double& low, double& mid, double& high)
    {
        double l, h, a, hp;
        low1.run (x, l, h, a);
        low2.run (l, low, h, a);
        high1.run (x, l, h, a);
        high2.run (h, l, hp, a);
        lowAll.run (low, l, h, low);
        mid1.run (hp, l, h, a);
        mid2.run (l, mid, h, a);
        top1.run (hp, l, h, a);
        top2.run (h, l, high, a);
    }
    void reset()
    {
        for (auto* b : { &low1, &low2, &high1, &high2, &lowAll, &mid1, &mid2, &top1, &top2 })
            b->reset();
    }
};

// ---------------------------------------------------------------------------------------------------------
// Shapers (`docs/fabfilter/pro-c.md` 5.12; the styles' colours, 4)
// ---------------------------------------------------------------------------------------------------------

/** Mostly the 2nd harmonic: x + d·x² (its DC taken off after). */
inline double evenShape (double x, double d) { return x + d * x * x; }

/** Mostly the 3rd: tanh(g x)/g, which is x − d·x³ for small x (g² = 3d), and soft for large. */
inline double oddShape (double x, double d)
{
    if (d <= 1e-9)
        return x;
    const auto g = std::sqrt (3 * d);
    return std::tanh (g * x) / g;
}

/** Pro-C 3's Character, ours: Tube (asymmetric tanh: even), Diode (a firmer symmetric knee: odd). Unity gain for small signals. */
inline double tubeShape (double x, double drive)
{
    constexpr double b = 0.2;
    const auto tb = std::tanh (b);
    const auto slope = drive * (1 - tb * tb);
    return (std::tanh (drive * x + b) - tb) / slope;
}
inline double diodeShape (double x, double drive)
{
    constexpr double p = 2.5;
    return x / std::pow (1 + std::pow (std::abs (drive * x), p), 1 / p);
}
} // namespace comp
