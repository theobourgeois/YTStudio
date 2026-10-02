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

    // Each point: between bins where they're further apart than the points (the low end), interpolated;
    // where several bins fall in a point's share of the octave (the top), the loudest of them, so a
    // sine reads its level wherever it is.
    const auto binHz = sampleRate / size;
    const auto nyquist = sampleRate / 2;
    const auto ratio = std::sqrt (std::pow (SpectrumGrid::highest / SpectrumGrid::lowest, 1.0 / (SpectrumGrid::points - 1)));
    for (int i = 0; i < SpectrumGrid::points; ++i)
    {
        const auto f = SpectrumGrid::frequency (i);
        if (f >= nyquist)
            break;
        const auto lo = f / ratio / binHz, hi = f * ratio / binHz;
        float p = 0;
        if (std::floor (hi) - std::ceil (lo) >= 1)
        {
            for (auto k = (int) std::ceil (lo); k <= (int) std::floor (hi) && k < bins; ++k)
                p = juce::jmax (p, power[(size_t) k]);
        }
        else
        {
            const auto at = f / binHz;
            const auto k = juce::jlimit (0, bins - 2, (int) at);
            const auto t = (float) (at - k);
            // Between the two bins in dB, so a peak's skirts read as they would on a finer FFT.
            const auto a = 10.0f * std::log10 (power[(size_t) k] + 1e-20f), b = 10.0f * std::log10 (power[(size_t) k + 1] + 1e-20f);
            levels[(size_t) i] = juce::jmax (-200.0f, a + (b - a) * t);
            continue;
        }
        levels[(size_t) i] = juce::jmax (-200.0f, 10.0f * std::log10 (p + 1e-20f));
    }
}
} // namespace eq
