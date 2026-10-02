#include "AudioStream.h"

#include <signalsmith-stretch/signalsmith-stretch.h>

namespace
{
/** What the producer decodes at a time, in output samples. */
constexpr int chunk = 2048;
/** The stretcher's random phases, seeded: a render is the same every time. */
constexpr long stretchSeed = 0x5eed;
}

/**
 * Stretch mode's time stretcher (Signalsmith Stretch, its default preset: 120 ms blocks every 30 ms). It
 * takes `speed` resampled samples for each sample out; `in` and `out` are its buffers.
 */
struct AudioStream::Stretcher
{
    signalsmith::stretch::SignalsmithStretch<float> engine { stretchSeed };
    juce::AudioBuffer<float> in, out;
};

AudioStream::AudioStream (std::unique_ptr<juce::AudioFormatReader> source, double outputRate, double startSeconds, juce::int64 maxSamples, double ringSeconds,
                          double playSpeed, Resampling resamplingQuality, bool keepPitch, double transpose)
    : outRate (outputRate),
      duration ((double) source->lengthInSamples / source->sampleRate),
      reader (std::move (source)),
      ratio (reader->sampleRate / outputRate * (keepPitch ? 1.0 : juce::jlimit (0.0625, 16.0, playSpeed))),
      speed (keepPitch ? juce::jlimit (0.0625, 16.0, playSpeed) : 1.0),
      quality (resamplingQuality),
      reach (resampling::reach (resamplingQuality, ratio))
{
    start = juce::jlimit (0.0, (double) reader->lengthInSamples, juce::jmax (0.0, startSeconds) * reader->sampleRate);
    total = (juce::int64) std::ceil (((double) reader->lengthInSamples - start) / (ratio * speed));
    if (maxSamples >= 0)
        total = juce::jmin (total, maxSamples);
    const auto capacity = juce::jmax (chunk * 2, (int) (ringSeconds * outRate));
    ring.setSize (2, capacity);
    fifo.setTotalSize (capacity);
    output.setSize (2, chunk);
    if (! keepPitch)
    {
        // A chunk's worth of the file, and what the resampler reads on each side of it. Its first sample
        // out is the file's at `start` exactly: the resampler is centred, so the stream isn't late.
        input.setSize (2, (int) std::ceil (chunk * ratio) + 2 * reach + 4);
        inputStart = (juce::int64) std::floor (start) - reach;
        return;
    }

    stretcher = std::make_unique<Stretcher>();
    auto& engine = stretcher->engine;
    engine.presetDefault (2, (float) outRate);
    engine.setTransposeSemitones ((float) transpose);
    const auto latency = engine.inputLatency();
    const auto seekLength = engine.seekLength();
    const auto preRoll = engine.outputLatency();
    // The stretcher's input at a time: a chunk's worth (or its seek), and its output (or its pre-roll).
    const auto most = juce::jmax (seekLength, (int) std::ceil (juce::jmax (chunk, preRoll) * speed) + 4);
    stretcher->in.setSize (2, most);
    stretcher->out.setSize (2, juce::jmax (chunk, preRoll));
    input.setSize (2, (int) std::ceil (most * ratio) + 2 * reach + 4);
    // Where it is (the middle of its block, `latency` behind what it's given) starts at the file's `start`:
    // it's given what comes before that as its seek (silence before the file's start), then fed on.
    inputStart = (juce::int64) std::floor (start + (double) (latency - seekLength) * ratio) - reach;
    resample (latency - seekLength, seekLength, stretcher->in);
    engine.seek (stretcher->in.getArrayOfReadPointers(), seekLength, speed);
    fed = latency;
    // What comes out first is `outputLatency` behind where it is: from before `start`, so it's dropped.
    stretch (preRoll);
}

AudioStream::~AudioStream() = default;

int AudioStream::useTimeSlice()
{
    fill();
    return ended.load() ? 200 : 10;
}

void AudioStream::fill (int upTo)
{
    while (! ended.load (std::memory_order_relaxed) && fifo.getFreeSpace() >= chunk && (upTo < 0 || fifo.getNumReady() < upTo))
        produce();
}

void AudioStream::resample (juce::int64 index, int n, juce::AudioBuffer<float>& out)
{
    // The file samples these read: from the first one's reach behind to the last one's ahead.
    const auto from = (juce::int64) std::floor (start + (double) index * ratio) - reach;
    const auto to = (juce::int64) std::floor (start + (double) (index + n - 1) * ratio) + reach + 1;
    // Keep what's still needed of the window, then read the rest (before the file's start and past its
    // end, the reader gives silence).
    if (from > inputStart)
    {
        const auto drop = (int) juce::jmin ((juce::int64) buffered, from - inputStart);
        buffered -= drop;
        for (int ch = 0; ch < 2; ++ch)
            if (buffered > 0)
                std::memmove (input.getWritePointer (ch), input.getReadPointer (ch, drop), sizeof (float) * (size_t) buffered);
        inputStart = buffered > 0 ? inputStart + drop : from;
    }
    const auto wanted = (int) juce::jmin ((juce::int64) input.getNumSamples(), to - inputStart);
    if (buffered < wanted)
    {
        reader->read (&input, buffered, wanted - buffered, inputStart + buffered, true, true);
        buffered = wanted;
    }
    for (int ch = 0; ch < 2; ++ch)
    {
        const auto* data = input.getReadPointer (ch);
        auto* dest = out.getWritePointer (ch);
        for (int i = 0; i < n; ++i)
            dest[i] = resampling::read (data, buffered, start + (double) (index + i) * ratio - (double) inputStart, ratio, quality);
    }
}

void AudioStream::stretch (int n)
{
    // Where it is moves `speed` resampled samples a sample out, from the file's `start` (0) when nothing
    // has come out; it's fed `inputLatency` ahead of that. Counted from the start, so rounding never drifts.
    auto& s = *stretcher;
    emitted += n;
    const auto due = s.engine.inputLatency() + (juce::int64) std::llround ((double) emitted * speed);
    const auto count = (int) juce::jlimit ((juce::int64) 0, (juce::int64) s.in.getNumSamples(), due - fed);
    if (count > 0)
        resample (fed, count, s.in);
    fed += count;
    s.engine.process (s.in.getArrayOfReadPointers(), count, s.out.getArrayOfWritePointers(), n);
}

void AudioStream::produce()
{
    const auto n = (int) juce::jmin ((juce::int64) chunk, total - produced);
    if (n <= 0)
    {
        ended.store (true, std::memory_order_release);
        return;
    }
    if (stretcher != nullptr)
        stretch (n);
    else
        resample (produced, n, output);
    const auto& chunkOut = stretcher != nullptr ? stretcher->out : output;

    const auto scope = fifo.write (n);
    for (int ch = 0; ch < 2; ++ch)
    {
        if (scope.blockSize1 > 0)
            ring.copyFrom (ch, scope.startIndex1, chunkOut, ch, 0, scope.blockSize1);
        if (scope.blockSize2 > 0)
            ring.copyFrom (ch, scope.startIndex2, chunkOut, ch, scope.blockSize1, scope.blockSize2);
    }
    produced += n;
    if (produced >= total)
        ended.store (true, std::memory_order_release);
}

int AudioStream::pull (float* left, float* right, int offset, int numSamples, float gainLeft, float gainRight, int fadeInLength, int fadeOutLength, const float* envelope)
{
    const auto count = juce::jmin (numSamples, fifo.getNumReady());
    const auto scope = fifo.read (count);
    const auto before = played.load (std::memory_order_relaxed);
    // A fade out is over by the end of what there is.
    fadeOutLength = fadeOutLength > 0 ? juce::jmax (1, juce::jmin (fadeOutLength, count)) : 0;
    float* out[] = { left + offset, right + offset };
    const float gains[] = { gainLeft, gainRight };
    for (int part = 0; part < 2; ++part)
    {
        const auto from = part == 0 ? scope.startIndex1 : scope.startIndex2;
        const auto size = part == 0 ? scope.blockSize1 : scope.blockSize2;
        const auto at0 = part == 0 ? 0 : scope.blockSize1;
        for (int ch = 0; ch < 2; ++ch)
        {
            const auto* source = ring.getReadPointer (ch, from);
            for (int i = 0; i < size; ++i)
            {
                const auto at = at0 + i;
                auto g = gains[ch];
                if (fadeOutLength > 0)
                    g *= at < fadeOutLength ? 1.0f - (float) at / (float) fadeOutLength : 0.0f;
                else if (before + at < fadeInLength)
                    g *= (float) (before + at) / (float) fadeInLength;
                if (envelope != nullptr)
                    g *= envelope[at];
                out[ch][at] += source[i] * g;
            }
        }
    }
    played.store (before + count, std::memory_order_relaxed);
    return count;
}

int AudioStream::skip (int numSamples)
{
    const auto count = juce::jmin (numSamples, fifo.getNumReady());
    fifo.finishedRead (count);
    played.store (played.load (std::memory_order_relaxed) + count, std::memory_order_relaxed);
    return count;
}
