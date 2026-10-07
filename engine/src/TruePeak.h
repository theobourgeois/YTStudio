// YT-L's true peak stage (docs/fabfilter/pro-l.md §5.9), at the song's rate after everything else: it finds the
// peak of the waveform between each two samples and limits that. Its detector takes the most of the samples
// themselves, ITU-R BS.1770's own four phases (so a BS.1770 meter can never read more than it saw) and a finer
// 8× sinc with a parabola through its highest points (so an ideal reconstruction can't either), and the stage
// runs twice (`Settings` makes two): the second sees only what the first one's own gain changes left.
#pragma once

#include "Lookahead.h"

#include <array>
#include <cmath>
#include <vector>

namespace limit
{
class TruePeakPass
{
public:
    /** Half the sinc's length: how far each side of a gap it reads. */
    static constexpr int half = 64;
    /** How far a gap's requirement spreads each way (the samples whose gains shape it). */
    static constexpr int spread = 8;

    TruePeakPass()
    {
        // BS.1770-5 Annex 2: the meter's 48-tap interpolator as four phases of 12.
        static constexpr double itu[48] { 0.0017089843750, 0.0109863281250, -0.0196533203125, 0.0332031250000, -0.0594482421875, 0.1373291015625, 0.9721679687500, -0.1022949218750, 0.0476074218750, -0.0266113281250, 0.0148925781250, -0.0083007812500,
                                          -0.0291748046875, 0.0292968750000, -0.0517578125000, 0.0891113281250, -0.1665039062500, 0.4650878906250, 0.7797851562500, -0.2003173828125, 0.1015625000000, -0.0582275390625, 0.0330810546875, -0.0189208984375,
                                          -0.0189208984375, 0.0330810546875, -0.0582275390625, 0.1015625000000, -0.2003173828125, 0.7797851562500, 0.4650878906250, -0.1665039062500, 0.0891113281250, -0.0517578125000, 0.0292968750000, -0.0291748046875,
                                          -0.0083007812500, 0.0148925781250, -0.0266113281250, 0.0476074218750, -0.1022949218750, 0.9721679687500, 0.1373291015625, -0.0594482421875, 0.0332031250000, -0.0196533203125, 0.0109863281250, 0.0017089843750 };
        for (int p = 0; p < 4; ++p)
            for (int k = 0; k < 12; ++k)
                ituTaps[(size_t) p][(size_t) k] = itu[p * 12 + k];
        // The 8× sinc between sample j and j+1: the points j + p/8, from the samples j − half + 1 … j + half,
        // Kaiser-windowed (β 10), each phase's taps scaled to add up to 1.
        const auto bessel = [] (double x) {
            double sum = 1, term = 1;
            for (int k = 1; k < 40; ++k)
            {
                term *= (x / (2 * k)) * (x / (2 * k));
                sum += term;
            }
            return sum;
        };
        const auto beta = 10.0, norm = bessel (beta);
        for (int p = 1; p < 8; ++p)
        {
            double sum = 0;
            for (int m = 0; m < 2 * half; ++m)
            {
                const auto offset = (double) p / 8 - (m - half + 1);
                constexpr double pi = 3.14159265358979323846;
                const auto sinc = std::abs (offset) < 1e-12 ? 1.0 : std::sin (pi * offset) / (pi * offset);
                const auto r = offset / (half + 0.5);
                const auto w = std::abs (r) >= 1 ? 0.0 : bessel (beta * std::sqrt (1 - r * r)) / norm;
                sum += sincTaps[(size_t) p][(size_t) m] = sinc * w;
            }
            for (auto& tap : sincTaps[(size_t) p])
                tap /= sum;
        }
    }

    /** For a look-ahead of `lookahead` samples (its ramp as long) at `sampleRate`, on the message thread. */
    void prepare (int lookahead, double sampleRate)
    {
        ahead = std::max (1, lookahead);
        // It lets go over 5 ms: its reductions are a fraction of a dB, on single peaks.
        rise = 1 - std::exp (-1.0 / (0.005 * sampleRate));
        const auto room = 2 * half + spread + ahead + 16;
        size = 1;
        while (size < room)
            size <<= 1;
        for (auto& ring : rings)
            ring.assign ((size_t) size, 0.0f);
        ituPeaks.assign ((size_t) size, 0.0f);
        stage.prepare (2 * spread + ahead + 4, spread + ahead + 4);
        reset();
    }
    void reset()
    {
        for (auto& ring : rings)
            std::fill (ring.begin(), ring.end(), 0.0f);
        std::fill (ituPeaks.begin(), ituPeaks.end(), 0.0f);
        stage.reset (ahead + 1, 4);
        t = 0;
    }
    /** How late its output is. */
    int latency() const { return half + spread + ahead; }

    /** One stereo sample in; the sample `latency()` back out, with its gain applied, under `ceiling` (linear). */
    void process (float& left, float& right, double ceiling)
    {
        const auto mask = size - 1;
        rings[0][(size_t) (t & mask)] = left;
        rings[1][(size_t) (t & mask)] = right;
        const auto y = [&] (int ch, std::int64_t i) { return i < 0 ? 0.0 : (double) rings[(size_t) ch][(size_t) (i & mask)]; };

        // The meter's four points for the gap 6 samples back (its filter's delay is 5.1 to 5.9 samples).
        float itu = 0;
        for (int ch = 0; ch < 2; ++ch)
            for (int p = 0; p < 4; ++p)
            {
                double v = 0;
                for (int k = 0; k < 12; ++k)
                    v += ituTaps[(size_t) p][(size_t) k] * y (ch, t - k);
                itu = std::max (itu, (float) std::abs (v));
            }
        ituPeaks[(size_t) ((t - 6) & mask)] = itu;

        // The gap `half` back: its peak, and what it asks of the gain.
        const auto j = t - half;
        double peak = 0;
        if (j >= 0)
        {
            peak = ituPeaks[(size_t) (j & mask)];
            for (int ch = 0; ch < 2; ++ch)
            {
                // The gap's points j, j + 1/8 … j + 1, and one more each side (from the gaps beside it), so the
                // samples' own points have neighbours to fit a parabola through too.
                std::array<double, 11> v {};
                const auto at = [&] (int p, std::int64_t from) {
                    double s = 0;
                    for (int m = 0; m < 2 * half; ++m)
                        s += sincTaps[(size_t) p][(size_t) m] * y (ch, from - half + 1 + m);
                    return s;
                };
                v[0] = at (7, j - 1);
                v[1] = y (ch, j);
                for (int p = 1; p < 8; ++p)
                    v[(size_t) p + 1] = at (p, j);
                v[9] = y (ch, j + 1);
                v[10] = at (1, j + 1);
                for (int k = 1; k < 10; ++k)
                {
                    peak = std::max (peak, std::abs (v[(size_t) k]));
                    // A parabola through a point higher than its neighbours: its top.
                    if (std::abs (v[(size_t) k]) >= std::abs (v[(size_t) k - 1]) && std::abs (v[(size_t) k]) >= std::abs (v[(size_t) k + 1]))
                    {
                        const auto a = v[(size_t) k - 1], b = v[(size_t) k], c = v[(size_t) k + 1];
                        const auto curve = a - 2 * b + c;
                        if (std::abs (curve) > 1e-12 && (b > 0 ? curve < 0 : curve > 0))
                        {
                            const auto offset = 0.5 * (a - c) / curve;
                            if (std::abs (offset) <= 1)
                                peak = std::max (peak, std::abs (b - 0.25 * (a - c) * offset));
                        }
                    }
                }
            }
        }
        const auto requirement = peak > ceiling ? ceiling / peak : 1.0;
        // The window: `spread` each side of the gap, and `ahead` more forward; the ramp as long as `ahead`.
        const auto gain = stage.step (requirement, spread + ahead, spread, 1, rise);
        const auto out = t - latency();
        left = (float) (gain * y (0, out));
        right = (float) (gain * y (1, out));
        ++t;
    }

private:
    std::array<std::array<double, 12>, 4> ituTaps {};
    std::array<std::array<double, 2 * half>, 8> sincTaps {};
    std::array<std::vector<float>, 2> rings;
    std::vector<float> ituPeaks;
    Stage stage;
    int ahead = 48, size = 1;
    double rise = 1;
    std::int64_t t = 0;
};
} // namespace limit
