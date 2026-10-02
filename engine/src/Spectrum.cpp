#include "Spectrum.h"

namespace eq
{
Spectrum::Spectrum() : ring ((size_t) maxSize, 0.0f) {}

void Spectrum::write (const float* left, const float* right, int numSamples)
{
    // A plain ring: the reader may catch a sample being written, which an analyzer can't see.
    auto at = written.load (std::memory_order_relaxed);
    const auto mask = (juce::int64) maxSize - 1;
    for (int i = 0; i < numSamples; ++i)
        ring[(size_t) ((at + i) & mask)] = 0.5f * (left[i] + right[i]);
    written.store (at + numSamples, std::memory_order_release);
}

void Spectrum::measure (int size, double sampleRate, std::vector<float>& levels)
{
    size = juce::jlimit (256, maxSize, juce::nextPowerOfTwo (size));
    levels.assign ((size_t) SpectrumGrid::points, -200.0f);
    if (sampleRate <= 0)
        return;
    if (windowSize != size)
    {
        // A Hann window, and the FFT for it.
        windowSize = size;
        window.resize ((size_t) size);
        for (int i = 0; i < size; ++i)
            window[(size_t) i] = 0.5f - 0.5f * std::cos (juce::MathConstants<float>::twoPi * (float) i / (float) size);
        fft = std::make_unique<juce::dsp::FFT> (juce::roundToInt (std::log2 ((double) size)));
        scratch.assign ((size_t) size * 2, 0.0f);
        power.assign ((size_t) size / 2 + 1, 0.0f);
    }
    const auto end = written.load (std::memory_order_acquire);
    measured = end;
    const auto mask = (juce::int64) maxSize - 1;
    for (int i = 0; i < size; ++i)
    {
        const auto index = end - size + i;
        scratch[(size_t) i] = index < 0 ? 0.0f : ring[(size_t) (index & mask)] * window[(size_t) i];
    }
    std::fill (scratch.begin() + size, scratch.end(), 0.0f);
    fft->performRealOnlyForwardTransform (scratch.data(), true);
    // Power per bin, scaled so a full-scale sine's peak bin is 1: Hann's gain is a half, so |X| = N / 4.
    const auto scale = 4.0f / (float) size;
    const auto bins = size / 2 + 1;
    for (int k = 0; k < bins; ++k)
    {
        const auto re = scratch[(size_t) k * 2] * scale, im = scratch[(size_t) k * 2 + 1] * scale;
        power[(size_t) k] = re * re + im * im;
    }

    // In dB, and a peak's level and place between bins (a parabola through the three round it, which a
    // Hann window's lobe nearly is): a sine reads its level wherever it falls, not a few dB under it.
    db.resize ((size_t) bins);
    for (int k = 0; k < bins; ++k)
        db[(size_t) k] = 10.0f * std::log10 (power[(size_t) k] + 1e-20f);
    const auto peak = [this, bins] (int k, float& level, double& at) {
        if (k <= 0 || k >= bins - 1 || db[(size_t) k] < db[(size_t) k - 1] || db[(size_t) k] < db[(size_t) k + 1])
            return false;
        const auto a = db[(size_t) k - 1], b = db[(size_t) k], c = db[(size_t) k + 1];
        const auto bend = a - 2 * b + c;
        const auto p = bend < 0 ? juce::jlimit (-0.5f, 0.5f, 0.5f * (a - c) / bend) : 0.0f;
        level = b - 0.25f * (a - c) * p;
        at = (double) k + (double) p;
        return true;
    };

    // Each point: the loudest of the bins in its share of the octave (or, under the bins' spacing, the
    // curve between them), and any peak whose top falls in its share.
    const auto binHz = sampleRate / size;
    const auto nyquist = sampleRate / 2;
    const auto ratio = std::sqrt (std::pow (SpectrumGrid::highest / SpectrumGrid::lowest, 1.0 / (SpectrumGrid::points - 1)));
    for (int i = 0; i < SpectrumGrid::points; ++i)
    {
        const auto f = SpectrumGrid::frequency (i);
        if (f >= nyquist)
            break;
        const auto lo = f / ratio / binHz, hi = f * ratio / binHz;
        float value = -200.0f;
        if (std::floor (hi) - std::ceil (lo) >= 0)
        {
            for (auto k = (int) std::ceil (lo); k <= (int) std::floor (hi) && k < bins; ++k)
                value = juce::jmax (value, db[(size_t) k]);
        }
        else
        {
            const auto at = f / binHz;
            const auto k = juce::jlimit (1, bins - 2, (int) std::lround (at));
            const auto d = (float) (at - k);
            const auto a = db[(size_t) k - 1], b = db[(size_t) k], c = db[(size_t) k + 1];
            // Through the three bins round it, not past the louder of the two it's between.
            value = juce::jmin (juce::jmax (a, juce::jmax (b, c)), b + 0.5f * d * (c - a) + 0.5f * d * d * (a - 2 * b + c));
        }
        for (auto k = juce::jmax (1, (int) std::floor (lo) - 1); k <= juce::jmin (bins - 2, (int) std::ceil (hi) + 1); ++k)
        {
            float level;
            double at;
            if (peak (k, level, at) && at >= lo && at <= hi)
                value = juce::jmax (value, level);
        }
        levels[(size_t) i] = juce::jmax (-200.0f, value);
    }
}
} // namespace eq
