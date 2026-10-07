// YT-L's loudness meter (docs/fabfilter/pro-l.md §5.12): ITU-R BS.1770-5 and EBU Tech 3341 / 3342. K-weighting from
// its analogue prototypes at any rate (libebur128's derivation), 100 ms sub-blocks, Momentary (400 ms) and Short-term
// (3 s), Integrated (gated at −70 LUFS, then 10 LU under the gated mean) and Loudness Range (Short-term values gated
// at −70 LUFS and 20 LU under, the 95th percentile less the 10th), the most of each, and the true peak by BS.1770's
// own interpolator. Integrated and LRA come from fixed histograms (0.01 LU bins), so nothing allocates on the audio
// thread however long it measures; the readings go out through atomics. Audio thread, but for `prepare`.
#pragma once

#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <vector>

namespace limit
{
class LoudnessMeter
{
public:
    static constexpr double low = -70, high = 10, step = 0.01;
    static constexpr int bins = 8000;
    /** What a reading with nothing to read says (LUFS, dB). */
    static constexpr float none = -120;

    /** Message thread. */
    void prepare (double sampleRate)
    {
        rate = sampleRate;
        const auto pi = 3.14159265358979323846;
        {
            const auto f0 = 1681.974450955533, g = 3.999843853973347, q = 0.7071752369554196;
            const auto k = std::tan (pi * f0 / rate), vh = std::pow (10.0, g / 20), vb = std::pow (vh, 0.4996667741545416);
            const auto a0 = 1 + k / q + k * k;
            shelf = { (vh + vb * k / q + k * k) / a0, 2 * (k * k - vh) / a0, (vh - vb * k / q + k * k) / a0, 2 * (k * k - 1) / a0, (1 - k / q + k * k) / a0 };
        }
        {
            const auto f0 = 38.13547087602444, q = 0.5003270373238773;
            const auto k = std::tan (pi * f0 / rate), a0 = 1 + k / q + k * k;
            highPass = { 1, -2, 1, 2 * (k * k - 1) / a0, (1 - k / q + k * k) / a0 };
        }
        blockSize = std::max (1, (int) std::lround (0.1 * rate));
        integratedCount.assign ((size_t) bins, 0);
        integratedPower.assign ((size_t) bins, 0.0);
        rangeCount.assign ((size_t) bins, 0);
        binPower.resize ((size_t) bins);
        for (int b = 0; b < bins; ++b)
            binPower[(size_t) b] = std::pow (10.0, (low + (b + 0.5) * step + 0.691) / 10);
        clear();
    }

    /** Forget everything measured (the K-weighting's state and the windows too). */
    void clear()
    {
        state = {};
        sum = {};
        filled = 0;
        blocks = {};
        written = 0;
        tp = {};
        restart();
        momentary.store (none, std::memory_order_relaxed);
        shortTerm.store (none, std::memory_order_relaxed);
        for (auto& c : channel)
            c.store (none, std::memory_order_relaxed);
    }

    /** Reset: Integrated, LRA and the maxima start again; Momentary and Short-term carry on. */
    void restart()
    {
        std::fill (integratedCount.begin(), integratedCount.end(), 0);
        std::fill (integratedPower.begin(), integratedPower.end(), 0.0);
        std::fill (rangeCount.begin(), rangeCount.end(), 0);
        integratedTotal = rangeTotal = 0;
        integratedSum = rangeSum = 0;
        measured = 0;
        mostMomentary = mostShortTerm = -INFINITY;
        mostPeak = 0;
        for (auto* a : { &integrated, &maxMomentary, &maxShortTerm, &maxTruePeak })
            a->store (none, std::memory_order_relaxed);
        range.store (0, std::memory_order_relaxed);
        seconds.store (0, std::memory_order_relaxed);
    }

    /** One stereo sample; `paused`: Integrated, LRA and the maxima don't take it in. */
    void process (double left, double right, bool paused)
    {
        sum[0] += weighted (0, left);
        sum[1] += weighted (1, right);
        peaks[0] = truePeak (0, left);
        peaks[1] = truePeak (1, right);
        if (! paused)
            mostPeak = std::max (mostPeak, std::max (peaks[0], peaks[1]));
        if (++filled < blockSize)
            return;
        blocks[(size_t) (written % 30)] = { sum[0] / blockSize, sum[1] / blockSize };
        ++written;
        sum = {};
        filled = 0;

        std::array<double, 2> m {}, s {};
        for (int k = 1; k <= std::min<long long> (30, written); ++k)
        {
            const auto& b = blocks[(size_t) ((written - k) % 30)];
            for (int ch = 0; ch < 2; ++ch)
            {
                if (k <= 4)
                    m[(size_t) ch] += b[(size_t) ch];
                s[(size_t) ch] += b[(size_t) ch];
            }
        }
        const auto mPower = (m[0] + m[1]) / (double) std::min<long long> (4, written), sPower = (s[0] + s[1]) / (double) std::min<long long> (30, written);
        const auto mLufs = lufs (mPower), sLufs = lufs (sPower);
        momentary.store (shown (mLufs), std::memory_order_relaxed);
        shortTerm.store (shown (sLufs), std::memory_order_relaxed);
        for (int ch = 0; ch < 2; ++ch)
            channel[(size_t) ch].store (shown (lufs (m[(size_t) ch] / (double) std::min<long long> (4, written))), std::memory_order_relaxed);
        if (paused)
            return;
        measured += 1;
        seconds.store ((float) ((double) measured * blockSize / rate), std::memory_order_relaxed);
        if (written >= 4)
        {
            mostMomentary = std::max (mostMomentary, mLufs);
            if (const auto bin = binOf (mLufs); bin >= 0)
            {
                ++integratedCount[(size_t) bin];
                integratedPower[(size_t) bin] += mPower;
                ++integratedTotal;
                integratedSum += mPower;
            }
        }
        if (written >= 30)
        {
            mostShortTerm = std::max (mostShortTerm, sLufs);
            if (const auto bin = binOf (sLufs); bin >= 0)
            {
                ++rangeCount[(size_t) bin];
                ++rangeTotal;
                rangeSum += binPower[(size_t) bin];
            }
        }
        maxMomentary.store (shown (mostMomentary), std::memory_order_relaxed);
        maxShortTerm.store (shown (mostShortTerm), std::memory_order_relaxed);
        maxTruePeak.store (shown (20 * std::log10 (std::max (mostPeak, 1e-9))), std::memory_order_relaxed);
        integrated.store (shown (integratedNow()), std::memory_order_relaxed);
        range.store ((float) rangeNow(), std::memory_order_relaxed);
    }

    /** The last sample's true peak, each side (linear). */
    std::array<double, 2> peaks {};

    // The readings (LUFS, LU, dBTP; `none` until there's one), read by any thread.
    std::atomic<float> momentary { none }, shortTerm { none }, integrated { none }, range { 0 }, maxMomentary { none }, maxShortTerm { none }, maxTruePeak { none };
    /** Each side's Momentary alone (the output meter's RMS). */
    std::array<std::atomic<float>, 2> channel { none, none };
    /** Seconds measured since the reset (LRA settles after 60). */
    std::atomic<float> seconds { 0 };

private:
    struct Biquad
    {
        double b0, b1, b2, a1, a2;
    };
    double rate = 48000;
    Biquad shelf {}, highPass {};
    std::array<std::array<double, 4>, 2> state {};
    std::array<double, 2> sum {};
    int filled = 0, blockSize = 4800;
    std::array<std::array<double, 2>, 30> blocks {};
    long long written = 0, measured = 0;
    std::vector<long long> integratedCount, rangeCount;
    std::vector<double> integratedPower, binPower;
    long long integratedTotal = 0, rangeTotal = 0;
    double integratedSum = 0, rangeSum = 0;
    double mostMomentary = -INFINITY, mostShortTerm = -INFINITY, mostPeak = 0;
    std::array<std::array<double, 12>, 2> tp {};

    static double lufs (double power) { return power > 0 ? -0.691 + 10 * std::log10 (power) : -INFINITY; }
    static float shown (double l) { return std::isfinite (l) ? (float) std::max (l, (double) none) : none; }
    static int binOf (double l)
    {
        if (! (l >= low))
            return -1;
        return std::min (bins - 1, (int) ((l - low) / step));
    }

    double weighted (int ch, double x)
    {
        auto& z = state[(size_t) ch];
        const auto y1 = shelf.b0 * x + z[0];
        z[0] = shelf.b1 * x - shelf.a1 * y1 + z[1];
        z[1] = shelf.b2 * x - shelf.a2 * y1;
        const auto y2 = highPass.b0 * y1 + z[2];
        z[2] = highPass.b1 * y1 - highPass.a1 * y2 + z[3];
        z[3] = highPass.b2 * y1 - highPass.a2 * y2;
        return y2 * y2;
    }

    /** BS.1770-5 Annex 2's 4× interpolator (at 176.4 kHz and over, the samples themselves). */
    double truePeak (int ch, double x)
    {
        static constexpr double itu[4][12] {
            { 0.0017089843750, 0.0109863281250, -0.0196533203125, 0.0332031250000, -0.0594482421875, 0.1373291015625, 0.9721679687500, -0.1022949218750, 0.0476074218750, -0.0266113281250, 0.0148925781250, -0.0083007812500 },
            { -0.0291748046875, 0.0292968750000, -0.0517578125000, 0.0891113281250, -0.1665039062500, 0.4650878906250, 0.7797851562500, -0.2003173828125, 0.1015625000000, -0.0582275390625, 0.0330810546875, -0.0189208984375 },
            { -0.0189208984375, 0.0330810546875, -0.0582275390625, 0.1015625000000, -0.2003173828125, 0.7797851562500, 0.4650878906250, -0.1665039062500, 0.0891113281250, -0.0517578125000, 0.0292968750000, -0.0291748046875 },
            { -0.0083007812500, 0.0148925781250, -0.0266113281250, 0.0476074218750, -0.1022949218750, 0.9721679687500, 0.1373291015625, -0.0594482421875, 0.0332031250000, -0.0196533203125, 0.0109863281250, 0.0017089843750 },
        };
        auto& h = tp[(size_t) ch];
        for (int k = 11; k > 0; --k)
            h[(size_t) k] = h[(size_t) k - 1];
        h[0] = x;
        auto most = std::abs (x);
        if (rate < 176400)
            for (const auto& phase : itu)
            {
                double v = 0;
                for (int k = 0; k < 12; ++k)
                    v += phase[k] * h[(size_t) k];
                most = std::max (most, std::abs (v));
            }
        return most;
    }

    double integratedNow() const
    {
        if (integratedTotal == 0)
            return -INFINITY;
        const auto gate = binOf (lufs (integratedSum / (double) integratedTotal) - 10);
        long long count = 0;
        double power = 0;
        for (int b = std::max (0, gate + 1); b < bins; ++b)
            count += integratedCount[(size_t) b], power += integratedPower[(size_t) b];
        return count > 0 ? lufs (power / (double) count) : -INFINITY;
    }

    /** Tech 3342: the Short-term values over −70 LUFS, then over 20 LU under their mean power; the 95th percentile less the 10th. */
    double rangeNow() const
    {
        if (rangeTotal == 0)
            return 0;
        const auto gate = std::max (0, binOf (lufs (rangeSum / (double) rangeTotal) - 20) + 1);
        long long total = 0;
        for (int b = gate; b < bins; ++b)
            total += rangeCount[(size_t) b];
        if (total == 0)
            return 0;
        const auto percentile = [&] (double p) {
            const auto want = (long long) std::llround (p * (double) (total - 1));
            long long seen = 0;
            for (int b = gate; b < bins; ++b)
                if ((seen += rangeCount[(size_t) b]) > want)
                    return low + (b + 0.5) * step;
            return high;
        };
        return percentile (0.95) - percentile (0.10);
    }
};
} // namespace limit
