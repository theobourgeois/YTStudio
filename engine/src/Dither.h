// YT-L's dither (docs/fabfilter/pro-l.md §5.11): TPDF noise of 2 LSB peak to peak, and an error-feedback quantiser
// whose noise is shaped by one of three filters fitted to Pro-L 2's measured Basic, Optimized and Weighted curves
// (pro-l-research.md §2.7; within 2 dB in every band; minimum phase, so the loop is stable). They're fitted at 48 kHz
// and used at 44.1 kHz too; above 50 kHz the dither is flat (shaping would move noise only above 24 kHz).
#pragma once

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>

namespace limit
{
class Dither
{
public:
    /** 0 none (flat TPDF), 1 Basic, 2 Optimized, 3 Weighted. */
    void set (int bitDepth, int shaping, double sampleRate)
    {
        bits = bitDepth;
        static constexpr double filters[3][12] {
            { 0.949929, -0.497192, 0.117622, -0.045348, 0.035617, -0.117339, -0.066405, 0.164529, -0.040056, -0.061023, 0.054551, 0.023699 },
            { 1.368953, -1.326547, 1.369624, -1.213952, 0.930504, -0.658943, 0.220484, 0.139937, -0.262084, 0.29064, -0.26664, 0.149352 },
            { 2.229608, -2.735885, 2.889878, -3.266813, 3.112273, -2.707914, 2.172446, -1.396771, 0.712158, -0.400349, 0.113509, 0.032834 },
        };
        const auto shaped = shaping >= 1 && shaping <= 3 && sampleRate < 50000;
        for (int k = 0; k < 12; ++k)
            taps[(size_t) k] = shaped ? filters[shaping - 1][k] : 0.0;
    }
    void reset()
    {
        errors = {};
        written = 0;
    }
    bool on() const { return bits > 0; }

    /** A stereo sample quantised to the bit depth, with its shaped dither. */
    void process (float& left, float& right)
    {
        if (bits <= 0)
            return;
        const auto lsb = std::ldexp (1.0, -(bits - 1));
        for (int ch = 0; ch < 2; ++ch)
        {
            auto& x = ch == 0 ? left : right;
            auto& e = errors[(size_t) ch];
            double feedback = 0;
            for (int k = 0; k < 12; ++k)
                feedback += taps[(size_t) k] * e[(size_t) ((written - k + 12) % 12)];
            const auto v = std::clamp ((double) x - feedback, -1.0, 1.0);
            const auto tpdf = (random() + random()) * lsb;
            auto y = std::round ((v + tpdf) / lsb) * lsb;
            y = std::clamp (y, -1.0, 1.0 - lsb);
            // The error fed back (its own TPDF included); kept bounded, so a clipped output can't run it away.
            e[(size_t) ((written + 1) % 12)] = std::clamp (y - v, -4 * lsb, 4 * lsb);
            x = (float) y;
        }
        written = (written + 1) % 12;
    }

private:
    int bits = 0;
    std::array<double, 12> taps {};
    std::array<std::array<double, 12>, 2> errors {};
    int written = 0;
    std::uint64_t seed = 0x9E3779B97F4A7C15ull;
    /** Uniform in [−½, ½). */
    double random()
    {
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        return (double) (seed >> 11) / 9007199254740992.0 - 0.5;
    }
};
} // namespace limit
