// An audio file streamed from disk: its producer (a reader thread, or the rendering thread offline)
// decodes it ahead, resampled to the output's rate, into a lock-free ring that the audio thread reads.
// So a whole song plays in the memory of a few seconds of it (`SampleCache` reads files whole). The
// Browser's preview (`FilePreview`) and the playlist's audio clips (`ClipPlayer`) both play these.
#pragma once

#include <array>
#include <atomic>
#include <memory>
#include <juce_audio_formats/juce_audio_formats.h>

class AudioStream : public juce::TimeSliceClient
{
public:
    /**
     * `source` from `startSeconds` in, at `outputRate`; `maxSamples` output samples at most (-1: to the
     * file's end). The ring holds `ringSeconds` of it. `speed` plays it faster (and higher) or slower (and
     * lower), as a sampler's pitch does: an audio clip's channel pitched (FL's Resample).
     */
    AudioStream (std::unique_ptr<juce::AudioFormatReader> source, double outputRate, double startSeconds, juce::int64 maxSamples = -1, double ringSeconds = 2.0,
                 double speed = 1.0);

    int useTimeSlice() override;

    /** Decode until the ring is full (or holds `upTo` samples) or the file is done. The producer's only. */
    void fill (int upTo = -1);
    /** Everything decoded has been played. */
    bool finished() const { return ended.load (std::memory_order_acquire) && fifo.getNumReady() == 0; }

    /**
     * Audio thread: add up to `numSamples` from the ring to `left` and `right`, from `offset` in them, times
     * the gains, ramped by `fadeIn` (samples since the stream began, 0 to the fade's length) or out over
     * `fadeOutLength` samples (0: none). Returns how many it had.
     */
    int pull (float* left, float* right, int offset, int numSamples, float gainLeft, float gainRight, int fadeInLength, int fadeOutLength);
    /** Audio thread: drop up to `numSamples` without playing them (a stream that started late). Returns how many. */
    int skip (int numSamples);

    const double outRate;
    /** The file's length, in seconds. */
    const double duration;
    /** Output samples the audio thread has played (or skipped). */
    std::atomic<juce::int64> played { 0 };

private:
    void produce();

    std::unique_ptr<juce::AudioFormatReader> reader;
    /** File samples per output sample. */
    const double ratio;
    juce::AudioBuffer<float> ring;
    juce::AbstractFifo fifo { 1 };
    /** The producer's: what's been read of the file and not yet interpolated, and the next to read. */
    juce::AudioBuffer<float> input, output;
    int buffered = 0;
    juce::int64 position = 0;
    /** Output samples still to drop at the start (the interpolator's latency). */
    int discard = 0;
    std::array<juce::LagrangeInterpolator, 2> interpolators;
    /** Output samples in all, and decoded so far. */
    juce::int64 total = 0, produced = 0;
    std::atomic<bool> ended { false };

    JUCE_DECLARE_NON_COPYABLE (AudioStream)
};
