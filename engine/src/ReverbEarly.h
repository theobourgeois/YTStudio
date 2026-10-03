// The Reverb's blocks around its late network (docs/reverb/reverb.md 6.3, 6.7, 6.9–6.11): the filters,
// the de-esser on the way in, the velvet early energy, the ducker (and Auto-Decay), and the eras'
// converters and band limits. Each is a few numbers of state, made on the message thread and run on the
// audio thread, which never allocates here.
#pragma once

#include "GraphicEq.h"

#include <juce_core/juce_core.h>

#include <array>
#include <cmath>
#include <vector>

namespace verb
{
/** A state-variable filter (Zavalishin's TPT): low-pass and high-pass of one sample, redesigned in place. */
struct Svf
{
    double a1 = 0, a2 = 0, a3 = 0, k = 1.414, s1 = 0, s2 = 0;
    void set (double hz, double q, double rate)
    {
        const auto g = std::tan (pi * juce::jlimit (5.0, 0.45 * rate, hz) / rate);
        k = 1 / q;
        a1 = 1 / (1 + g * (g + k));
        a2 = g * a1;
        a3 = g * a2;
    }
    void run (double x, double& low, double& high)
    {
        const auto v3 = x - s2;
        const auto v1 = a1 * s1 + a2 * v3;
        const auto v2 = s2 + a2 * s1 + a3 * v3;
        s1 = 2 * v1 - s1;
        s2 = 2 * v2 - s2;
        low = v2;
        high = x - k * v1 - v2;
    }
    double low (double x)
    {
        double l, h;
        run (x, l, h);
        return l;
    }
    double high (double x)
    {
        double l, h;
        run (x, l, h);
        return h;
    }
    void reset() { s1 = s2 = 0; }
};

/** A Butterworth cut of order 2 or 4 (one or two SVF sections), off at its end. */
struct Cut
{
    std::array<Svf, 2> sections;
    int order = 0;
    bool high = false;
    double designed = -1;
    int designedOrder = -1;
    void set (bool isHigh, double hz, int slope, bool off, double rate)
    {
        high = isHigh;
        const auto wanted = off ? 0 : (slope >= 24 ? 4 : 2);
        if (wanted == designedOrder && std::abs (hz - designed) < 1e-6)
            return;
        if (wanted != order)
            for (auto& s : sections)
                s.reset();
        order = designedOrder = wanted;
        designed = hz;
        if (order == 2)
            sections[0].set (hz, 0.70710678, rate);
        else if (order == 4)
        {
            sections[0].set (hz, 0.54119610, rate);
            sections[1].set (hz, 1.30656296, rate);
        }
    }
    double process (double x)
    {
        for (int k = 0; k < order / 2; ++k)
            x = high ? sections[(size_t) k].high (x) : sections[(size_t) k].low (x);
        return x;
    }
    void reset()
    {
        for (auto& s : sections)
            s.reset();
    }
};

/** An 8th-order Butterworth low-pass (four SVF sections): an era's band limit. */
struct BandLimit
{
    std::array<Svf, 4> sections;
    bool on = false;
    double designed = -1;
    void set (double hz, double rate)
    {
        on = hz > 0 && hz < 0.45 * rate;
        if (! on || std::abs (hz - designed) < 1e-6)
            return;
        designed = hz;
        constexpr double qs[] = { 0.50979558, 0.60134489, 0.89997622, 2.56291545 };
        for (int k = 0; k < 4; ++k)
            sections[(size_t) k].set (hz, qs[k], rate);
    }
    double process (double x)
    {
        if (! on)
            return x;
        for (auto& s : sections)
            x = s.low (x);
        return x;
    }
    void reset()
    {
        for (auto& s : sections)
            s.reset();
    }
};

/** A first-order shelf (`GraphicEq`'s design): `gain` dB below (low) or above (high) its corner. */
struct Shelf
{
    double b0 = 1, b1 = 0, a1 = 0, z = 0;
    double designed = 1e9, designedGain = 1e9;
    void set (bool high, double hz, double gainDb, double rate)
    {
        if (std::abs (hz - designed) < 1e-6 && std::abs (gainDb - designedGain) < 1e-6)
            return;
        designed = hz, designedGain = gainDb;
        const auto g = std::pow (10.0, gainDb / 20);
        const auto hd = high ? 1.0 : g, hn = high ? g : 1.0;
        const auto p = std::tan (pi * juce::jlimit (5.0, 0.45 * rate, hz) / rate) * std::sqrt (hn / hd);
        b0 = (hn + hd * p) / (1 + p);
        b1 = (hd * p - hn) / (1 + p);
        a1 = (p - 1) / (1 + p);
    }
    double process (double x)
    {
        const auto y = b0 * x + z;
        z = b1 * x - a1 * y;
        return y;
    }
    void reset() { z = 0; }
};

/** A biquad shelf (RBJ, slope 1), its state kept on a redesign: the de-esser's, the aperture's, the emphasis'. */
struct Biquad
{
    double b0 = 1, b1 = 0, b2 = 0, a1 = 0, a2 = 0, z1 = 0, z2 = 0;
    void shelf (bool high, double rate, double hz, double db)
    {
        if (std::abs (db) < 1e-4)
        {
            b0 = 1, b1 = b2 = a1 = a2 = 0;
            return;
        }
        const auto a = std::pow (10.0, db / 40), w = 2 * pi * juce::jlimit (5.0, 0.45 * rate, hz) / rate, c = std::cos (w), s = std::sin (w);
        const auto alpha = s / 2 * std::sqrt (2.0), k = 2 * std::sqrt (a) * alpha;
        double n0, n1, n2, d0, d1, d2;
        if (high)
        {
            n0 = a * ((a + 1) + (a - 1) * c + k), n1 = -2 * a * ((a - 1) + (a + 1) * c), n2 = a * ((a + 1) + (a - 1) * c - k);
            d0 = (a + 1) - (a - 1) * c + k, d1 = 2 * ((a - 1) - (a + 1) * c), d2 = (a + 1) - (a - 1) * c - k;
        }
        else
        {
            n0 = a * ((a + 1) - (a - 1) * c + k), n1 = 2 * a * ((a - 1) - (a + 1) * c), n2 = a * ((a + 1) - (a - 1) * c - k);
            d0 = (a + 1) + (a - 1) * c + k, d1 = -2 * ((a - 1) + (a + 1) * c), d2 = (a + 1) + (a - 1) * c - k;
        }
        b0 = n0 / d0, b1 = n1 / d0, b2 = n2 / d0, a1 = d1 / d0, a2 = d2 / d0;
    }
    double process (double x)
    {
        const auto y = b0 * x + z1;
        z1 = b1 * x - a1 * y + z2;
        z2 = b2 * x - a2 * y;
        return y;
    }
    void reset() { z1 = z2 = 0; }
};

/** An era's converter (6.10): its word length, fixed point or ranging its gain in 6 dB steps. */
inline double quantise (double x, int bits, bool ranging)
{
    if (bits <= 0)
        return x;
    double step;
    if (ranging)
    {
        int e = 0;
        std::frexp (juce::jmax (std::abs (x), 1e-5), &e);
        step = std::ldexp (1.0, e - bits);
    }
    else
        step = std::ldexp (1.0, 1 - bits);
    return std::round (x / step) * step;
}

/**
 * The de-esser (6.3), on the way into the reverb: a relative detector (how much of the sound is above
 * `frequency`), so it works at any send level, and a dynamic high shelf below it.
 */
struct DeEsser
{
    Svf detector;
    std::array<Biquad, 2> shelves;
    double eHigh = 0, eAll = 0, reduction = 0, up = 1, down = 1;
    double designedFrequency = -1, designedReduction = -1;
    int counter = 0;
    void prepare (double rate)
    {
        up = 1 - std::exp (-1 / (0.001 * rate));
        down = 1 - std::exp (-1 / (0.06 * rate));
    }
    void reset()
    {
        detector.reset();
        for (auto& s : shelves)
            s.reset();
        eHigh = eAll = reduction = 0;
    }
    /** One sample of both sides, `amount` dB at most. */
    void process (double& l, double& r, double amount, double frequency, double rate)
    {
        if (frequency != designedFrequency)
            detector.set (frequency, 0.70710678, rate);
        const auto x = 0.5 * (l + r);
        const auto hf = detector.high (x);
        eHigh += (hf * hf > eHigh ? up : down) * (hf * hf - eHigh);
        eAll += (x * x > eAll ? up : down) * (x * x - eAll);
        // Starts when the band is within 14 dB of the whole, 1.5 dB more for each dB nearer.
        const auto ratio = 10 * std::log10 ((eHigh + 1e-15) / (eAll + 1e-12));
        reduction = juce::jlimit (0.0, juce::jmax (0.0, amount), (ratio + 14) * 1.5);
        if (--counter <= 0 || frequency != designedFrequency)
        {
            counter = 16;
            if (std::abs (reduction - designedReduction) > 0.05 || frequency != designedFrequency)
            {
                designedReduction = reduction;
                for (auto& s : shelves)
                    s.shelf (true, rate, frequency * 0.55, -reduction);
            }
            designedFrequency = frequency;
        }
        l = shelves[0].process (l);
        r = shelves[1].process (r);
    }
};

/**
 * The ducker (6.11): a peak follower on the key (its lows under 150 Hz left out), how far over the
 * threshold it is (full depth 12 dB over), the reduction moving there at the attack's or the release's
 * rate (linear in dB: Release is the time to come all the way back), held for Hold. Auto-Decay's factor
 * from the same detector.
 */
struct Ducker
{
    Svf highpass;
    double envelope = 0, longTerm = 0, reduction = 0, factor = 1, over = 0;
    double fall = 1, longCoefficient = 1;
    juce::int64 holdLeft = 0;
    void prepare (double rate)
    {
        highpass.set (150, 0.70710678, rate);
        fall = std::exp (-1 / (0.02 * rate));
        longCoefficient = 1 - std::exp (-1 / (3.0 * rate));
    }
    void reset()
    {
        highpass.reset();
        envelope = longTerm = reduction = over = 0;
        factor = 1;
        holdLeft = 0;
    }
    /** The key's level (dB), and the threshold it's at (Auto: its long-term level − 12 dB). */
    double keyDb() const { return 20 * std::log10 (juce::jmax (envelope, 1e-6)); }
    double thresholdDb (double threshold, bool automatic) const { return automatic ? juce::jlimit (-60.0, 0.0, 10 * std::log10 (juce::jmax (longTerm, 1e-12)) - 12) : threshold; }

    /** One sample of the key; returns the wet's gain (linear). */
    double process (double key, double depth, double threshold, bool automatic, double attack, double release, double hold, double autoDecay, double recovery, double rate)
    {
        const auto x = highpass.high (key);
        const auto a = std::abs (x);
        envelope = a > envelope ? a : envelope * fall;
        longTerm += (x * x - longTerm) * longCoefficient;
        over = juce::jlimit (0.0, 1.0, (keyDb() - thresholdDb (threshold, automatic)) / 12);
        const auto target = depth * over;
        const auto span = juce::jmax (1.0, std::abs (depth));
        if (target < reduction)
        {
            reduction = juce::jmax (target, reduction - span / (juce::jmax (attack, 1e-4) * rate));
            holdLeft = (juce::int64) (hold * rate);
        }
        else if (holdLeft > 0)
            --holdLeft;
        else
            reduction = juce::jmin (target, reduction + span / (juce::jmax (release, 1e-3) * rate));
        // Auto-Decay: shortened at once, back over Recovery.
        const auto wanted = 1 - autoDecay * over;
        factor += (wanted - factor) * (wanted < factor ? 1 - std::exp (-1 / (0.002 * rate)) : 1 - std::exp (-1 / (juce::jmax (recovery, 1e-3) * rate)));
        return std::pow (10.0, reduction / 20);
    }
};

/** One velvet tap as the song has it (`EarlyTap`): seconds at scale 1, its signed gain, its rank. */
struct EarlyTap
{
    float at = 0, gain = 0, rank = 0;
};

/**
 * The velvet early energy (6.7): each side's taps read from the pre-delayed input, those whose rank is
 * under the density's fraction playing (softly in and out), normalised to a power gain of 1. Laid out
 * at a scale (Size); a new layout crossfades in over 50 ms.
 */
class Early
{
public:
    static constexpr int maxTaps = 400;

    void prepare (double rate) { fadeLength = (int) (0.05 * rate); }

    /** Lay `taps` (one side's) out at `samplesPerSecond × scale`, with the density's fraction. Audio thread. */
    void layout (const std::vector<EarlyTap>& left, const std::vector<EarlyTap>& right, double scale, double fraction, double rate)
    {
        // The current layout fades out while the new one fades in.
        old = now;
        fade = old.count[0] + old.count[1] > 0 ? fadeLength : 0;
        build (now, left, right, scale, fraction, rate);
        layoutScale = scale, layoutFraction = fraction;
    }
    bool needsLayout (double scale, double fraction) const { return layoutScale < 0 || std::abs (scale / layoutScale - 1) > 0.01 || std::abs (fraction - layoutFraction) > 0.002; }

    /** The early sound of side `side` at offset `base` (samples back of the newest input) through `read`. */
    template <typename Read>
    double tap (int side, juce::int64 base, Read read)
    {
        double y = sum (now, side, base, read);
        if (fade > 0)
        {
            const auto t = (double) fade / fadeLength;
            y = y * (1 - t) + sum (old, side, base, read) * t;
        }
        return y;
    }
    /** A sample has passed (the crossfade moves on). */
    void step()
    {
        if (fade > 0)
            --fade;
    }
    /** The furthest back a tap reads (samples). */
    int reach() const { return juce::jmax (now.reach, fade > 0 ? old.reach : 0); }
    void reset()
    {
        fade = 0;
        layoutScale = -1;
        now.count = { 0, 0 };
        old.count = { 0, 0 };
    }

private:
    struct Layout
    {
        std::array<std::array<int, maxTaps>, 2> at {};
        std::array<std::array<float, maxTaps>, 2> coefficient {};
        std::array<int, 2> count {};
        int reach = 0;
    };

    static void build (Layout& out, const std::vector<EarlyTap>& left, const std::vector<EarlyTap>& right, double scale, double fraction, double rate)
    {
        out.reach = 0;
        const std::vector<EarlyTap>* sides[2] { &left, &right };
        for (int side = 0; side < 2; ++side)
        {
            const auto& taps = *sides[side];
            double power = 0;
            int count = 0;
            for (size_t k = 0; k < taps.size() && count < maxTaps; ++k)
            {
                // Softly in and out around the fraction (a tap's rank).
                const auto w = juce::jlimit (0.0, 1.0, (fraction - taps[k].rank) / 0.05 + 0.5);
                if (w <= 0)
                    continue;
                const auto g = taps[k].gain * w;
                power += g * g;
                const auto at = (int) std::lround (taps[k].at * scale * rate);
                out.at[(size_t) side][(size_t) count] = at;
                out.coefficient[(size_t) side][(size_t) count] = (float) g;
                out.reach = juce::jmax (out.reach, at);
                ++count;
            }
            const auto norm = power > 0 ? 1 / std::sqrt (power) : 0.0;
            for (int k = 0; k < count; ++k)
                out.coefficient[(size_t) side][(size_t) k] *= (float) norm;
            out.count[(size_t) side] = count;
        }
    }

    template <typename Read>
    static double sum (const Layout& l, int side, juce::int64 base, Read read)
    {
        double y = 0;
        const auto& at = l.at[(size_t) side];
        const auto& c = l.coefficient[(size_t) side];
        for (int k = 0; k < l.count[(size_t) side]; ++k)
            y += c[(size_t) k] * read (base + at[(size_t) k]);
        return y;
    }

    Layout now, old;
    int fade = 0, fadeLength = 2400;
    double layoutScale = -1, layoutFraction = -1;
};
} // namespace verb
