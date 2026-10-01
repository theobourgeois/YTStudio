#include "FilePreview.h"

#include "Protocol.h"

namespace
{
/** How far ahead of the audio thread a stream is decoded. */
constexpr double ringSeconds = 2.0;
/** What the reader decodes at a time, in output samples. */
constexpr int chunk = 2048;
/** A preview fades in over this (a file started mid-way doesn't click), and a cut-off one fades out. */
constexpr int fadeSamples = 256;
}

// A file being previewed: decoded ahead into a ring by its producer (the reader thread, or the
// rendering thread offline), read out by the audio thread.
struct FilePreview::Stream final : juce::TimeSliceClient
{
    Stream (std::unique_ptr<juce::AudioFormatReader> source, double outputRate, double startSeconds, const juce::String& previewId)
        : reader (std::move (source)),
          ratio (reader->sampleRate / outputRate),
          outRate (outputRate),
          id (previewId),
          start (startSeconds),
          duration ((double) reader->lengthInSamples / reader->sampleRate)
    {
        position = juce::jlimit ((juce::int64) 0, reader->lengthInSamples, (juce::int64) (startSeconds * reader->sampleRate));
        total = (juce::int64) std::ceil ((double) (reader->lengthInSamples - position) / ratio);
        const auto capacity = (int) (ringSeconds * outRate);
        ring.setSize (2, capacity);
        fifo.setTotalSize (capacity);
        input.setSize (2, (int) std::ceil (chunk * ratio) + 16);
        output.setSize (2, chunk);
    }

    int useTimeSlice() override
    {
        fill();
        return ended.load() ? 200 : 10;
    }

    /** Decode until the ring is full or the file is done. The producer's only. */
    void fill()
    {
        while (! ended.load (std::memory_order_relaxed) && fifo.getFreeSpace() >= chunk)
            produce();
    }

    void produce()
    {
        const auto n = (int) juce::jmin ((juce::int64) chunk, total - produced);
        if (n <= 0)
        {
            ended.store (true, std::memory_order_release);
            return;
        }
        // Enough of the file for `n` samples out; past its end the reader gives silence, which lets the
        // interpolator finish its last few samples.
        const auto needed = juce::jmin (input.getNumSamples(), (int) std::ceil (n * ratio) + 8);
        if (buffered < needed)
        {
            reader->read (&input, buffered, needed - buffered, position, true, true);
            position += needed - buffered;
            buffered = needed;
        }
        int used = 0;
        for (int ch = 0; ch < 2; ++ch)
            used = interpolators[(size_t) ch].process (ratio, input.getReadPointer (ch), output.getWritePointer (ch), n, buffered, 0);
        buffered -= used;
        for (int ch = 0; ch < 2; ++ch)
            if (buffered > 0)
                std::memmove (input.getWritePointer (ch), input.getReadPointer (ch, used), sizeof (float) * (size_t) buffered);

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

    /** Everything decoded has been played. */
    bool finished() const { return ended.load (std::memory_order_acquire) && fifo.getNumReady() == 0; }

    std::unique_ptr<juce::AudioFormatReader> reader;
    /** File samples per output sample. */
    const double ratio;
    const double outRate;
    const juce::String id;
    const double start;
    const double duration;

    juce::AudioBuffer<float> ring;
    juce::AbstractFifo fifo { 1 };
    /** The producer's: what's been read of the file and not yet interpolated, and the next to read. */
    juce::AudioBuffer<float> input, output;
    int buffered = 0;
    juce::int64 position = 0;
    std::array<juce::LagrangeInterpolator, 2> interpolators;
    /** Output samples in all, and decoded so far. */
    juce::int64 total = 0, produced = 0;
    std::atomic<bool> ended { false };
    /** Output samples the audio thread has played. */
    std::atomic<juce::int64> played { 0 };
};

FilePreview::FilePreview (bool isOffline) : offline (isOffline)
{
    formats.registerBasicFormats();
    if (! offline)
        reader.startThread (juce::Thread::Priority::high);
}

FilePreview::~FilePreview()
{
    reader.stopThread (2000);
    collectGarbage();
    for (auto* stream : { pending.exchange (nullptr), playing, fading })
        if (stream != nullptr && stream != stopRequest)
            delete stream;
}

void FilePreview::prepare (double rate) { sampleRate = rate > 0 ? rate : 48000.0; }

// Message thread -----------------------------------------------------------------------------------

juce::Result FilePreview::play (const juce::File& file, double startSeconds, const juce::String& id)
{
    std::unique_ptr<juce::AudioFormatReader> source (formats.createReaderFor (file));
    if (source == nullptr || source->sampleRate <= 0 || source->lengthInSamples <= 0)
        return juce::Result::fail ("\"" + file.getFileName() + "\" can't be read as audio.");
    auto* stream = new Stream (std::move (source), sampleRate, juce::jmax (0.0, startSeconds), id);
    // Its start is decoded here, so it sounds at the next block rather than when the reader gets to it.
    stream->fill();
    if (! offline)
        reader.addTimeSliceClient (stream);
    discard (pending.exchange (stream));
    latest = stream;
    return juce::Result::ok();
}

void FilePreview::stop()
{
    discard (pending.exchange (stopRequest));
    latest = nullptr;
}

void FilePreview::setVolume (float gain) { volume = juce::jlimit (0.0f, 1.0f, gain); }

void FilePreview::discard (Stream* stream)
{
    if (stream == nullptr || stream == stopRequest)
        return;
    reader.removeTimeSliceClient (stream);
    if (latest == stream)
        latest = nullptr;
    delete stream;
}

void FilePreview::collectGarbage()
{
    const auto scope = garbageQueue.read (garbageQueue.getNumReady());
    for (int i = 0; i < scope.blockSize1 + scope.blockSize2; ++i)
        discard (garbage[(size_t) (i < scope.blockSize1 ? scope.startIndex1 + i : scope.startIndex2 + i - scope.blockSize1)]);
}

bool FilePreview::isPlaying() const { return latest != nullptr && ! latest->finished(); }

juce::var FilePreview::describe() const
{
    if (! isPlaying())
        return {};
    return protocol::object ({ { "id", latest->id },
                               { "seconds", latest->start + (double) latest->played.load() / latest->outRate },
                               { "duration", latest->duration } });
}

// Audio thread -------------------------------------------------------------------------------------

void FilePreview::retire (Stream* stream)
{
    const auto scope = garbageQueue.write (1);
    if (scope.blockSize1 > 0)
        garbage[(size_t) scope.startIndex1] = stream;
    // The queue holds far more than ever wait (it's emptied 25 times a second). Were it full, the
    // stream would be leaked rather than deleted here, on the audio thread.
}

void FilePreview::process (float* left, float* right, int numSamples)
{
    if (auto* next = pending.exchange (nullptr))
    {
        if (fading != nullptr)
            retire (fading);
        fading = playing;
        playing = next == stopRequest ? nullptr : next;
    }
    const auto gain = volume.load (std::memory_order_relaxed);
    if (fading != nullptr)
    {
        pull (*fading, left, right, numSamples, gain, true);
        retire (fading);
        fading = nullptr;
    }
    if (playing != nullptr)
    {
        if (offline)
            playing->fill();
        pull (*playing, left, right, numSamples, gain, false);
        if (playing->finished())
        {
            retire (playing);
            playing = nullptr;
        }
    }
}

int FilePreview::pull (Stream& stream, float* left, float* right, int numSamples, float gain, bool fadeOut)
{
    const auto count = juce::jmin (numSamples, stream.fifo.getNumReady());
    const auto scope = stream.fifo.read (count);
    const auto played = stream.played.load (std::memory_order_relaxed);
    const auto fadeLength = juce::jmin (fadeSamples, count);
    float* out[] = { left, right };
    for (int part = 0; part < 2; ++part)
    {
        const auto from = part == 0 ? scope.startIndex1 : scope.startIndex2;
        const auto size = part == 0 ? scope.blockSize1 : scope.blockSize2;
        const auto offset = part == 0 ? 0 : scope.blockSize1;
        for (int ch = 0; ch < 2; ++ch)
        {
            const auto* source = stream.ring.getReadPointer (ch, from);
            for (int i = 0; i < size; ++i)
            {
                const auto at = offset + i;
                auto g = gain;
                if (fadeOut)
                    g *= at < fadeLength ? 1.0f - (float) at / (float) fadeLength : 0.0f;
                else if (played + at < fadeSamples)
                    g *= (float) (played + at) / (float) fadeSamples;
                out[ch][at] += source[i] * g;
            }
        }
    }
    stream.played.store (played + count, std::memory_order_relaxed);
    return count;
}
