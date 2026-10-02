// An audio file streamed from disk: its producer (a reader thread, or the rendering thread offline)
// decodes it ahead, resampled to the output's rate (and, for a stretched audio clip in Stretch mode,
// time-stretched with its pitch kept by Signalsmith Stretch), into a lock-free ring that the audio
// thread reads.
// So a whole song plays in the memory of a few seconds of it (`SampleCache` reads files whole). The
// Browser's preview (`FilePreview`) and the playlist's audio clips (`ClipPlayer`) both play these.
#pragma once

#include "Resampling.h"

#include <atomic>
#include <memory>
#include <juce_audio_formats/juce_audio_formats.h>

class AudioStream : public juce::TimeSliceClient
{
public:
    /**
     * `source` from `startSeconds` in, at `outputRate`; `maxSamples` output samples at most (-1: to the
     * file's end). The ring holds `ringSeconds` of it. `speed` plays it faster (and higher) or slower (and
     * lower), as a sampler's pitch does: an audio clip's channel pitched (FL's Resample). `quality` is
     * how it's read between the file's samples, when it's at another rate or pitched (`Resampling`).
     * `keepPitch`: `speed` stretches it in time instead, its pitch kept and shifted by `transpose`
     * semitones (an audio clip in Stretch mode). Either way its first sample out is the file's at
     * `startSeconds`: nothing is late.
     */
    AudioStream (std::unique_ptr<juce::AudioFormatReader> source, double outputRate, double startSeconds, juce::int64 maxSamples = -1, double ringSeconds = 2.0,
                 double speed = 1.0, Resampling quality = Resampling::hermite, bool keepPitch = false, double transpose = 0.0);
    ~AudioStream() override;

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
    struct Stretcher;

    void produce();
    /** Resampled samples `[index, index + n)` (`index` 0 is the file at `start`; before it, earlier) into `out`. */
    void resample (juce::int64 index, int n, juce::AudioBuffer<float>& out);
    /** The stretcher's next `n` samples out into `output` (Stretch mode). */
    void stretch (int n);

    std::unique_ptr<juce::AudioFormatReader> reader;
    /** File samples per resampled sample (per output sample, but in Stretch mode, where the stretcher then takes `speed` of them a sample out). */
    const double ratio;
    const double speed;
    const Resampling quality;
    /** How many file samples the resampler reads on each side of where it is. */
    const int reach;
    juce::AudioBuffer<float> ring;
    juce::AbstractFifo fifo { 1 };
    /**
     * The producer's: a window of the file (`buffered` samples from file sample `inputStart`; before the
     * file's start and past its end, silence), and the next chunk out.
     */
    juce::AudioBuffer<float> input, output;
    juce::int64 inputStart = 0;
    int buffered = 0;
    /** Where the stream starts in the file, in its samples (between two, if it starts there). */
    double start = 0;
    /** Output samples in all, and decoded so far. */
    juce::int64 total = 0, produced = 0;
    std::atomic<bool> ended { false };
    /** Stretch mode's: the stretcher, how far into the resampled sound it's been fed, and how much has come out (its pre-roll, dropped, too). */
    std::unique_ptr<Stretcher> stretcher;
    juce::int64 fed = 0, emitted = 0;

    JUCE_DECLARE_NON_COPYABLE (AudioStream)
};
