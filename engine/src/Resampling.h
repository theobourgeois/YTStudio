// How a sound is read between its samples: a sampler's voice pitched, a 44.1 kHz file in a 48 kHz
// song, an audio clip's channel pitched (FL's Resample). FL calls it Resampling / interpolation.
//
// - linear: a straight line between the two nearest samples. The cheapest, and it adds faint
//   whistles (images and aliasing) to bright sounds.
// - hermite: a curve through the four nearest (Catmull-Rom). Cheap, much cleaner. Playback's default.
// - sinc: a windowed sinc (Kaiser) over 32 samples, which also filters out what would alias when a
//   sound is pitched up (its cutoff falls with the rate, so it reaches further). The export's default.
//
// Every method reads exactly the sample at a whole position, and is centred on the position (the
// sound is in memory, or buffered ahead), so none of them delays anything: a hit lands on its sample
// whichever is used. Outside the data counts as silence.
#pragma once

#include <juce_core/juce_core.h>

#include <cmath>
#include <vector>

enum class Resampling
{
    linear,
    hermite,
    sinc
};

namespace resampling
{
/** "linear", "hermite" or "sinc"; anything else is `fallback`. */
inline Resampling parse (const juce::String& name, Resampling fallback)
{
    if (name == "linear")
        return Resampling::linear;
    if (name == "hermite")
        return Resampling::hermite;
    if (name == "sinc")
        return Resampling::sinc;
    return fallback;
}

/** The sinc's zero crossings on each side of the position (16: 32 samples, before it widens). */
constexpr int zeroCrossings = 16;
/** Its cutoff, as a fraction of the lower Nyquist frequency: what's just under it passes, what's past it is filtered. */
constexpr double rolloff = 0.97;
/**
 * Pitched up by more than this, the sinc stops widening (it would read 8× as many samples): what's
 * still above the cutoff then aliases a little. Three octaves up is rare, and still far cleaner than
 * linear.
 */
constexpr double maxWidening = 8.0;

/** The windowed sinc, tabulated once (`get` before the audio thread needs it: the engine does at startup). */
class Kernel
{
public:
    /** Points per zero crossing; between them it's read linearly (far below the window's own error). */
    static constexpr int resolution = 512;

    static const Kernel& get()
    {
        static const Kernel kernel;
        return kernel;
    }

    /** The kernel at `x` zero crossings from its centre (any sign). */
    float at (double x) const
    {
        const auto scaled = std::abs (x) * resolution;
        const auto index = (int) scaled;
        if (index >= zeroCrossings * resolution)
            return 0.0f;
        const auto fraction = (float) (scaled - index);
        return values[(size_t) index] + (values[(size_t) index + 1] - values[(size_t) index]) * fraction;
    }

private:
    Kernel()
    {
        // Kaiser's window, beta 9: its sidelobes are about 90 dB down.
        constexpr double beta = 9.0;
        const auto bessel = [] (double x) {
            double sum = 1, term = 1;
            for (int k = 1; k < 50; ++k)
            {
                term *= (x / (2.0 * k)) * (x / (2.0 * k));
                sum += term;
            }
            return sum;
        };
        const auto points = zeroCrossings * resolution;
        values.resize ((size_t) points + 2, 0.0f);
        for (int i = 0; i <= points; ++i)
        {
            const auto x = (double) i / resolution;
            const auto sinc = i == 0 ? 1.0 : std::sin (juce::MathConstants<double>::pi * x) / (juce::MathConstants<double>::pi * x);
            const auto r = x / zeroCrossings;
            values[(size_t) i] = (float) (sinc * bessel (beta * std::sqrt (juce::jmax (0.0, 1.0 - r * r))) / bessel (beta));
        }
    }

    std::vector<float> values;
};

/** The cutoff the sinc reads with at `rate` input samples per output sample (1: the input's own Nyquist). */
inline double cutoff (double rate) { return rolloff / juce::jlimit (1.0, maxWidening, rate); }

/** How far from a position a method reads, in input samples, on each side. */
inline int reach (Resampling quality, double rate)
{
    switch (quality)
    {
        case Resampling::linear: return 1;
        case Resampling::hermite: return 2;
        case Resampling::sinc: return (int) std::ceil (zeroCrossings / cutoff (rate)) + 1;
    }
    return 2;
}

/**
 * `data`'s value at `position` (input samples; whole numbers are its samples), read `rate` input
 * samples per output sample. `length` samples; outside them is silence.
 */
inline float read (const float* data, int length, double position, double rate, Resampling quality)
{
    const auto index = (int) std::floor (position);
    const auto t = (float) (position - index);
    const auto at = [&] (int i) { return i >= 0 && i < length ? data[i] : 0.0f; };
    // On a sample at the input's own rate: nothing to read between, nothing to filter.
    if (t == 0.0f && (quality != Resampling::sinc || rate == 1.0))
        return at (index);

    switch (quality)
    {
        case Resampling::linear:
        {
            const auto a = at (index);
            return a + (at (index + 1) - a) * t;
        }
        case Resampling::hermite:
        {
            const auto inside = index >= 1 && index + 2 < length;
            const auto y0 = inside ? data[index - 1] : at (index - 1);
            const auto y1 = inside ? data[index] : at (index);
            const auto y2 = inside ? data[index + 1] : at (index + 1);
            const auto y3 = inside ? data[index + 2] : at (index + 2);
            const auto c1 = 0.5f * (y2 - y0);
            const auto c2 = y0 - 2.5f * y1 + 2.0f * y2 - 0.5f * y3;
            const auto c3 = 0.5f * (y3 - y0) + 1.5f * (y1 - y2);
            return ((c3 * t + c2) * t + c1) * t + y1;
        }
        case Resampling::sinc:
        {
            const auto& kernel = Kernel::get();
            const auto fc = cutoff (rate);
            const auto half = zeroCrossings / fc;
            const auto first = juce::jmax (0, (int) std::ceil (position - half));
            const auto last = juce::jmin (length - 1, (int) std::floor (position + half));
            double sum = 0;
            for (int i = first; i <= last; ++i)
                sum += data[i] * kernel.at ((i - position) * fc);
            return (float) (sum * fc);
        }
    }
    return at (index);
}
} // namespace resampling
