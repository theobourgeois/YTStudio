// Pro-Q's spectrum analyzer (ProQ.h), the engine's half: the audio thread writes what goes into an EQ
// and what comes out into rings, only while its window is open (`watching`); the message thread takes
// the newest stretch of each, windows it, measures it by FFT and says it as levels at fixed frequencies
// (`EQ_SPECTRUM_*` in shared/music/pro-q.ts: log-spaced from 10 Hz to 30 kHz). How it falls, its
// tilt and its range are drawn by the tab.
#pragma once

#include <juce_audio_basics/juce_audio_basics.h>
#include <juce_dsp/juce_dsp.h>

#include <atomic>
#include <vector>

namespace eq
{
/** The frequencies the analyzer reports, as the tab has them: `points` log-spaced from `lowest` to `highest`. */
struct SpectrumGrid
{
    static constexpr int points = 480;
    static constexpr double lowest = 10.0, highest = 30000.0;
    static double frequency (int i) { return lowest * std::pow (highest / lowest, (double) i / (points - 1)); }
};

/** One signal's ring and its measurement. */
class Spectrum
{
public:
    /** The longest FFT (Maximum resolution), in samples. */
    static constexpr int maxSize = 32768;

    Spectrum();

    /** Add `numSamples` of a stereo signal (measured as its mid). Audio thread, only while watched. */
    void write (const float* left, const float* right, int numSamples);
    /**
     * Its levels now, in dB (a sine at full scale reads 0) at `SpectrumGrid`'s points, from the newest
     * `size` samples at `sampleRate` (a power of two up to `maxSize`). Points past Nyquist are -200.
     * Message thread.
     */
    void measure (int size, double sampleRate, std::vector<float>& levels);
    /** Something was written since the last `measure`. */
    bool fresh() const { return written.load (std::memory_order_relaxed) != measured; }

private:
    std::vector<float> ring;
    std::atomic<juce::int64> written { 0 };
    juce::int64 measured = 0;
    std::vector<float> scratch, window, power;
    int windowSize = 0;
    std::unique_ptr<juce::dsp::FFT> fft;
};
} // namespace eq
