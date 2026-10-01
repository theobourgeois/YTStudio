#include "FilePreview.h"

#include "Protocol.h"

namespace
{
/** How far ahead of the audio thread a stream is decoded. */
constexpr double ringSeconds = 2.0;
/** A preview fades in over this (a file started mid-way doesn't click), and a cut-off one fades out. */
constexpr int fadeSamples = 256;
}

// A file being previewed: the stream, and what the tab calls it.
struct FilePreview::Stream final : AudioStream
{
    Stream (std::unique_ptr<juce::AudioFormatReader> source, double outputRate, double startSeconds, const juce::String& previewId, float left, float right,
            double playSpeed, bool atVolume)
        : AudioStream (std::move (source), outputRate, startSeconds, -1, ringSeconds, playSpeed),
          id (previewId),
          start (startSeconds),
          speed (juce::jlimit (0.0625, 16.0, playSpeed)),
          gainLeft (left),
          gainRight (right),
          browserVolume (atVolume)
    {
    }

    const juce::String id;
    const double start, speed;
    const float gainLeft, gainRight;
    const bool browserVolume;
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

juce::Result FilePreview::play (const juce::File& file, double startSeconds, const juce::String& id, float gainLeft, float gainRight, double speed, bool browserVolume)
{
    std::unique_ptr<juce::AudioFormatReader> source (formats.createReaderFor (file));
    if (source == nullptr || source->sampleRate <= 0 || source->lengthInSamples <= 0)
        return juce::Result::fail ("\"" + file.getFileName() + "\" can't be read as audio.");
    auto* stream = new Stream (std::move (source), sampleRate, juce::jmax (0.0, startSeconds), id, gainLeft, gainRight, speed, browserVolume);
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
                               { "seconds", latest->start + (double) latest->played.load() / latest->outRate * latest->speed },
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

int FilePreview::pull (Stream& stream, float* left, float* right, int numSamples, float volume, bool fadeOut)
{
    const auto gain = stream.browserVolume ? volume : 1.0f;
    return stream.pull (left, right, 0, numSamples, gain * stream.gainLeft, gain * stream.gainRight, fadeSamples, fadeOut ? fadeSamples : 0);
}
