#include "AudioStream.h"

namespace
{
/** What the producer decodes at a time, in output samples. */
constexpr int chunk = 2048;
}

AudioStream::AudioStream (std::unique_ptr<juce::AudioFormatReader> source, double outputRate, double startSeconds, juce::int64 maxSamples, double ringSeconds,
                          double speed, Resampling resamplingQuality)
    : outRate (outputRate),
      duration ((double) source->lengthInSamples / source->sampleRate),
      reader (std::move (source)),
      ratio (reader->sampleRate / outputRate * juce::jlimit (0.0625, 16.0, speed)),
      quality (resamplingQuality),
      reach (resampling::reach (resamplingQuality, ratio))
{
    start = juce::jlimit (0.0, (double) reader->lengthInSamples, juce::jmax (0.0, startSeconds) * reader->sampleRate);
    total = (juce::int64) std::ceil (((double) reader->lengthInSamples - start) / ratio);
    if (maxSamples >= 0)
        total = juce::jmin (total, maxSamples);
    const auto capacity = juce::jmax (chunk * 2, (int) (ringSeconds * outRate));
    ring.setSize (2, capacity);
    fifo.setTotalSize (capacity);
    // A chunk's worth of the file, and what the resampler reads on each side of it. Its first sample
    // out is the file's at `start` exactly: the resampler is centred, so the stream isn't late.
    input.setSize (2, (int) std::ceil (chunk * ratio) + 2 * reach + 4);
    output.setSize (2, chunk);
    inputStart = (juce::int64) std::floor (start) - reach;
}

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

void AudioStream::produce()
{
    const auto n = (int) juce::jmin ((juce::int64) chunk, total - produced);
    if (n <= 0)
    {
        ended.store (true, std::memory_order_release);
        return;
    }
    // The file samples this chunk reads: from its first position's reach behind to its last's ahead.
    const auto first = start + (double) produced * ratio;
    const auto from = (juce::int64) std::floor (first) - reach;
    const auto to = (juce::int64) std::floor (start + (double) (produced + n - 1) * ratio) + reach + 1;
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
        auto* out = output.getWritePointer (ch);
        for (int i = 0; i < n; ++i)
            out[i] = resampling::read (data, buffered, start + (double) (produced + i) * ratio - (double) inputStart, ratio, quality);
    }

    const auto scope = fifo.write (n);
    for (int ch = 0; ch < 2; ++ch)
    {
        if (scope.blockSize1 > 0)
            ring.copyFrom (ch, scope.startIndex1, output, ch, 0, scope.blockSize1);
        if (scope.blockSize2 > 0)
            ring.copyFrom (ch, scope.startIndex2, output, ch, scope.blockSize1, scope.blockSize2);
    }
    produced += n;
    if (produced >= total)
        ended.store (true, std::memory_order_release);
}

int AudioStream::pull (float* left, float* right, int offset, int numSamples, float gainLeft, float gainRight, int fadeInLength, int fadeOutLength)
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
