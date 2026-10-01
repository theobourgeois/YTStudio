#include "AudioStream.h"

namespace
{
/** What the producer decodes at a time, in output samples. */
constexpr int chunk = 2048;
}

AudioStream::AudioStream (std::unique_ptr<juce::AudioFormatReader> source, double outputRate, double startSeconds, juce::int64 maxSamples, double ringSeconds,
                          double speed)
    : outRate (outputRate),
      duration ((double) source->lengthInSamples / source->sampleRate),
      reader (std::move (source)),
      ratio (reader->sampleRate / outputRate * juce::jlimit (0.0625, 16.0, speed))
{
    position = juce::jlimit ((juce::int64) 0, reader->lengthInSamples, (juce::int64) (juce::jmax (0.0, startSeconds) * reader->sampleRate));
    total = (juce::int64) std::ceil ((double) (reader->lengthInSamples - position) / ratio);
    if (maxSamples >= 0)
        total = juce::jmin (total, maxSamples);
    const auto capacity = juce::jmax (chunk * 2, (int) (ringSeconds * outRate));
    ring.setSize (2, capacity);
    fifo.setTotalSize (capacity);
    // Resampling delays the sound by the interpolator's latency: that many samples out are dropped at
    // the start, so the file's first sample is the stream's first (a clip starts on its sample).
    discard = juce::exactlyEqual (ratio, 1.0) ? 0 : juce::jmax (0, (int) std::lround (juce::LagrangeInterpolator::getBaseLatency() / ratio));
    input.setSize (2, (int) std::ceil ((chunk + discard) * ratio) + 16);
    output.setSize (2, chunk + discard);
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
    // The interpolator's latency, dropped once at the start.
    const auto drop = discard;
    discard = 0;
    // Enough of the file for `n` samples out; past its end the reader gives silence, which lets the
    // interpolator finish its last few samples.
    const auto needed = juce::jmin (input.getNumSamples(), (int) std::ceil ((n + drop) * ratio) + 8);
    if (buffered < needed)
    {
        reader->read (&input, buffered, needed - buffered, position, true, true);
        position += needed - buffered;
        buffered = needed;
    }
    int used = 0;
    for (int ch = 0; ch < 2; ++ch)
        used = interpolators[(size_t) ch].process (ratio, input.getReadPointer (ch), output.getWritePointer (ch), n + drop, buffered, 0);
    buffered -= used;
    for (int ch = 0; ch < 2; ++ch)
        if (buffered > 0)
            std::memmove (input.getWritePointer (ch), input.getReadPointer (ch, used), sizeof (float) * (size_t) buffered);

    const auto scope = fifo.write (n);
    for (int ch = 0; ch < 2; ++ch)
    {
        if (scope.blockSize1 > 0)
            ring.copyFrom (ch, scope.startIndex1, output, ch, drop, scope.blockSize1);
        if (scope.blockSize2 > 0)
            ring.copyFrom (ch, scope.startIndex2, output, ch, drop + scope.blockSize1, scope.blockSize2);
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
