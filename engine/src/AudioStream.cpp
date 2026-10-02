#include "AudioStream.h"

#include <signalsmith-stretch/signalsmith-stretch.h>

namespace
{
/** What the producer decodes at a time, in output samples. */
constexpr int chunk = 2048;
/** The stretcher's random phases are seeded, so the same clip renders the same every time. */
constexpr long stretchSeed = 0x5eed;
}

AudioStream::AudioStream (std::unique_ptr<juce::AudioFormatReader> source, double outputRate, double startSeconds, juce::int64 maxSamples, double ringSeconds,
                          double speed, Resampling resamplingQuality, double stretch)
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

    if (const auto times = juce::jlimit (0.125, 8.0, stretch); std::abs (times - 1.0) > 1e-6)
    {
        // Stretched: the file goes in `stretchRate` samples per output sample, and comes out at its own
        // pitch moved by the channel's speed. The stretcher keeps a cycle as many samples long as it
        // was, so a file at another rate is moved by the rates' ratio too: `ratio` is both.
        stretchRate = ratio / times;
        stretcher = std::make_unique<signalsmith::stretch::SignalsmithStretch<float, void>> (stretchSeed);
        stretcher->presetDefault (2, (float) outRate);
        stretcher->setTransposeFactor ((float) ratio);
        total = (juce::int64) std::ceil (((double) reader->lengthInSamples - start) / stretchRate);
        if (maxSamples >= 0)
            total = juce::jmin (total, maxSamples);
        // Its first output is the file at `start`, aligned (the stretcher's latency taken up front).
        const auto seekLength = stretcher->outputSeekLength ((float) stretchRate);
        const auto from = (juce::int64) std::llround (start);
        juce::AudioBuffer<float> seek (2, seekLength);
        reader->read (&seek, 0, seekLength, from, true, true);
        stretcher->outputSeek (seek.getArrayOfReadPointers(), seekLength);
        readPosition = from + seekLength;
        stretchInput.setSize (2, (int) std::ceil (chunk * stretchRate) + 2);
    }
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

void AudioStream::produce()
{
    const auto n = (int) juce::jmin ((juce::int64) chunk, total - produced);
    if (n <= 0)
    {
        ended.store (true, std::memory_order_release);
        return;
    }
    if (stretcher != nullptr)
        return produceStretched (n);
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

void AudioStream::produceStretched (int n)
{
    // The file samples this chunk takes, the fraction carried to the next so they add up exactly.
    const auto wanted = carry + (double) n * stretchRate;
    const auto count = (int) std::floor (wanted);
    carry = wanted - count;
    if (count > stretchInput.getNumSamples())
        stretchInput.setSize (2, count, false, false, true);
    reader->read (&stretchInput, 0, count, readPosition, true, true);
    readPosition += count;
    stretcher->process (stretchInput.getArrayOfReadPointers(), count, output.getArrayOfWritePointers(), n);

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
