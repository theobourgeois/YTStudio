// Pro-Q's filters (docs/fabfilter/pro-q-3-dsp.md): each band's shape as analog sections, the same as the
// tab's (shared/music/pro-q-filters.ts `bandSections`: keep the two in step; the offline tests measure
// the engine against it), and those sections made digital so their magnitude matches the analog one
// up to Nyquist, without the cramping of the bilinear transform and without latency (Zero Latency):
//
//   poles   by impulse invariance (z = e^{sT}), kept under 0.9·Nyquist;
//   zeros   the numerator fitted to the analog magnitude: Vicanek's exact peaking fit for a 2-pole bell,
//           zeros on the unit circle where the analog ones are on the axis (notches, the elliptic
//           Brickwall), otherwise a least-squares fit exact at DC; a cut is designed as the inverse of
//           the boost it undoes, which maps far better.
//
// Each digital section then runs as a state-variable filter (`Svf`), whose coefficients can be
// interpolated sample by sample without zipper noise or instability.
#pragma once

#include <array>
#include <cmath>
#include <complex>
#include <vector>

namespace eq
{
/** Exactly zero (a coefficient that isn't there), without comparing floats with ==. */
inline bool isZero (double x) { return std::fpclassify (x) == FP_ZERO; }

enum class Shape
{
    bell,
    lowShelf,
    lowCut,
    highShelf,
    highCut,
    notch,
    bandPass,
    tiltShelf,
    flatTilt
};

/** A band's settings as its filter needs them. `slope` in dB per octave; 0 is Brickwall. */
struct BandShape
{
    Shape shape = Shape::bell;
    double frequency = 1000, gain = 0, q = 1;
    int slope = 12;
};

/**
 * An analog section: (b0 + b1 p + b2 p^2) / (a0 + a1 p + a2 p^2), p = s / (2 pi `frequency`). First order
 * when b2 and a2 are 0.
 */
struct Section
{
    double b0 = 1, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0;
    double frequency = 1000;

    std::complex<double> at (double hz) const;
    bool firstOrder() const { return isZero (a2) && isZero (b2); }
};

/** Most sections a band has (a Flat Tilt's ladder of shelves is the longest). */
constexpr int maxSections = 24;

/** A band's sections (at most `maxSections`), without allocating. */
struct Sections
{
    std::array<Section, maxSections> list;
    int count = 0;

    void add (const Section& s)
    {
        if (count < maxSections)
            list[(size_t) count++] = s;
    }
    std::complex<double> at (double hz) const;
};

/** A band as analog sections, at `gain` dB (its own, or where its dynamics take it). */
void analogSections (const BandShape& band, Sections& out);

/** A digital biquad: (b0 + b1 z^-1 + b2 z^-2) / (1 + a1 z^-1 + a2 z^-2); a2 and b2 are 0 for a first-order one. */
struct Biquad
{
    double b0 = 1, b1 = 0, b2 = 0, a1 = 0, a2 = 0;
    bool firstOrder = false;

    std::complex<double> at (double hz, double sampleRate) const;
};

/** The digital biquad whose magnitude matches an analog section's, at `sampleRate`. */
Biquad matched (const Section& section, double sampleRate);

/**
 * A biquad as a state-variable filter (Simper's linear trapezoidal SVF: out = m0 x + m1 band + m2 low),
 * or a first-order one as a one-pole TPT (out = m0 x + m1 low). Its coefficients interpolate safely.
 */
struct Svf
{
    double g = 0, k = 0, m0 = 1, m1 = 0, m2 = 0;
    bool firstOrder = false;

    static Svf from (const Biquad&);
    Svf lerp (const Svf& to, double t) const
    {
        return { g + (to.g - g) * t, k + (to.k - k) * t, m0 + (to.m0 - m0) * t, m1 + (to.m1 - m1) * t, m2 + (to.m2 - m2) * t, to.firstOrder };
    }
    /** One sample through it, its memory in `s1`, `s2`. */
    double run (double x, double& s1, double& s2) const
    {
        if (firstOrder)
        {
            const auto G = g / (1 + g);
            const auto v = (x - s1) * G;
            const auto low = v + s1;
            s1 = low + v;
            return m0 * x + m1 * low;
        }
        const auto a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2;
        const auto v3 = x - s2;
        const auto v1 = a1 * s1 + a2 * v3;
        const auto v2 = s2 + a2 * s1 + a3 * v3;
        s1 = 2 * v1 - s1;
        s2 = 2 * v2 - s2;
        return m0 * x + m1 * v1 + m2 * v2;
    }
};

/** The 14th-order elliptic low pass behind Brickwall (as the tab's `BRICKWALL`). */
extern const double brickwall[7][3];
} // namespace eq
