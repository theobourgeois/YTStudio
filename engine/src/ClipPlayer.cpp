#include "ClipPlayer.h"

#include <cmath>
#include <limits>

namespace
{
/** A prepared sample in memory, read as if it were a file (an audio clip channel with precomputed effects). */
class SampleReader final : public juce::AudioFormatReader
{
public:
    explicit SampleReader (std::shared_ptr<const Sample> prepared) : juce::AudioFormatReader (nullptr, "Prepared sample"), sample (std::move (prepared))
    {
        sampleRate = sample->sampleRate;
        bitsPerSample = 32;
        usesFloatingPointData = true;
        lengthInSamples = sample->audio.getNumSamples();
        numChannels = (unsigned int) juce::jmax (1, sample->audio.getNumChannels());
    }

    bool readSamples (int* const* destChannels, int numDestChannels, int startOffsetInDestBuffer, juce::int64 startSampleInFile, int numSamples) override
    {
        const auto total = (juce::int64) sample->audio.getNumSamples();
        const auto from = juce::jlimit ((juce::int64) 0, total, startSampleInFile);
        const auto count = (int) juce::jlimit ((juce::int64) 0, (juce::int64) numSamples, total - from);
        for (int ch = 0; ch < numDestChannels; ++ch)
        {
            auto* dest = reinterpret_cast<float*> (destChannels[ch]);
            if (dest == nullptr)
                continue;
            dest += startOffsetInDestBuffer;
            if (count > 0 && sample->audio.getNumChannels() > 0)
                juce::FloatVectorOperations::copy (dest, sample->audio.getReadPointer (juce::jmin (ch, sample->audio.getNumChannels() - 1), (int) from), count);
            if (count < numSamples)
                juce::FloatVectorOperations::clear (dest + count, numSamples - count);
        }
        return true;
    }

private:
    std::shared_ptr<const Sample> sample;
};

/** How far ahead of the playhead clips get their streams. */
constexpr double lookaheadSeconds = 1.5;
/** A stream that starts at once has this much decoded before play does; the reader does the rest. */
constexpr double immediateSeconds = 0.4;
/** A clip cut off at its end, or started inside its file, fades over this many samples (so it doesn't click). */
constexpr int fadeSamples = 64;
/** A stream later than this is dropped rather than started (another is made where play is). */
constexpr double latestSeconds = 1.0;
/** See `Sequencer`: a tick exactly on a block's edge lands in one block, not whichever rounding picks. */
constexpr double tickSlack = 1e-6;
}

ClipPlayer::ClipPlayer (bool isOffline) : offline (isOffline)
{
    formats.registerBasicFormats();
    if (! offline)
        reader.startThread (juce::Thread::Priority::high);
}

ClipPlayer::~ClipPlayer()
{
    reader.stopThread (2000);
    // Every stream ever made is in `live` until it's deleted, wherever it is now.
    for (auto* stream : live)
        delete stream;
}

void ClipPlayer::prepare (double rate) { sampleRate = rate > 0 ? rate : 48000.0; }

// Message thread -----------------------------------------------------------------------------------

void ClipPlayer::setSong (const Song& song)
{
    clips.clear();
    for (const auto& clip : song.audioClips)
        clips.push_back ({ clip.key, clip.path, clip.tick, clip.length, clip.seconds, clip.speed, clip.sample });
    loopTicks = juce::jmax (1.0, song.loopTicks);
    secondsPerTick = 60.0 / (song.tempo * song.ppq);
    quality = song.resampling;
    loops = song.loops;
}

bool ClipPlayer::has (juce::uint64 key, juce::uint32 playGeneration, juce::uint32 pass) const
{
    for (const auto* stream : live)
        if (stream->key == key && stream->generation == playGeneration && stream->pass == pass)
            return true;
    return false;
}

void ClipPlayer::prepare (double position, juce::uint32 playGeneration, juce::uint32 pass, double marginSeconds)
{
    const auto margin = marginSeconds / secondsPerTick;
    const auto lookahead = lookaheadSeconds / secondsPerTick;
    for (const auto& clip : clips)
    {
        const auto start = clip.tick;
        const auto end = juce::jmin (clip.tick + clip.length, loopTicks);
        if (end <= 0 || start >= loopTicks || end <= start)
            continue;
        // Inside it now (play started there, or it was changed while playing): from a little ahead.
        if (position >= start && position < end && ! has (clip.key, playGeneration, pass) && position + margin < end)
            make (clip, position + margin, playGeneration, pass, margin <= 0);
        // Where it's next entered: its start, in this pass or the next one round the loop.
        const auto entry = juce::jmax (start, 0.0);
        const auto later = entry > position;
        if (! later && ! loops)
            continue;
        const auto ahead = later ? entry - position : entry + loopTicks - position;
        const auto entryPass = later ? pass : pass + 1;
        if (ahead <= lookahead && ! has (clip.key, playGeneration, entryPass))
            make (clip, entry, playGeneration, entryPass, ahead * secondsPerTick < immediateSeconds);
    }
}

ClipPlayer::Stream* ClipPlayer::make (const Clip& clip, double startTick, juce::uint32 playGeneration, juce::uint32 pass, bool immediate)
{
    if (incomingQueue.getFreeSpace() < 1 || (int) live.size() >= maxStreams * 2)
        return nullptr;
    const juce::File file (clip.path);
    // Where in the file: a pitched clip goes through it `speed` times as fast.
    const auto seconds = clip.seconds + (startTick - clip.tick) * secondsPerTick * clip.speed;
    // Past the file's end, the clip plays nothing more.
    const auto known = durations.find (clip.path);
    if (clip.sample == nullptr && known != durations.end() && seconds >= known->second)
        return nullptr;
    // Prepared by its channel's precomputed effects: read from memory; else streamed from the file.
    std::unique_ptr<juce::AudioFormatReader> source (clip.sample != nullptr ? new SampleReader (clip.sample) : formats.createReaderFor (file));
    if (source == nullptr || source->sampleRate <= 0 || source->lengthInSamples <= 0)
        return nullptr;
    const auto duration = (double) source->lengthInSamples / source->sampleRate;
    if (clip.sample == nullptr)
        durations[clip.path] = duration;
    if (seconds >= duration)
        return nullptr;

    const auto end = juce::jmin (clip.tick + clip.length, loopTicks);
    const auto samples = (juce::int64) std::llround ((end - startTick) * secondsPerTick * sampleRate);
    if (samples <= 0)
        return nullptr;
    auto* stream = new Stream (std::move (source), sampleRate, seconds, samples, clip.key, startTick, playGeneration, pass, seconds > 1e-6, clip.speed, quality);
    // Due now: some of it is decoded here, so it sounds at the next block; the reader does the rest.
    if (immediate || offline)
        stream->fill (offline ? -1 : (int) (immediateSeconds * sampleRate));
    live.push_back (stream);
    if (! offline)
        reader.addTimeSliceClient (stream);
    const auto scope = incomingQueue.write (1);
    incoming[(size_t) scope.startIndex1] = stream;
    return stream;
}

void ClipPlayer::discard (Stream* stream)
{
    reader.removeTimeSliceClient (stream);
    std::erase (live, stream);
    delete stream;
}

void ClipPlayer::collectGarbage()
{
    const auto scope = garbageQueue.read (garbageQueue.getNumReady());
    for (int i = 0; i < scope.blockSize1 + scope.blockSize2; ++i)
        discard (garbage[(size_t) (i < scope.blockSize1 ? scope.startIndex1 + i : scope.startIndex2 + i - scope.blockSize1)]);
}

// Audio thread -------------------------------------------------------------------------------------

void ClipPlayer::retire (Stream* stream)
{
    const auto scope = garbageQueue.write (1);
    if (scope.blockSize1 > 0)
        garbage[(size_t) scope.startIndex1] = stream;
    // The queue holds every stream there can be; were it full, the stream would be leaked rather
    // than deleted here, on the audio thread.
}

namespace
{
int clipChannel (const Song& song, juce::uint64 key)
{
    for (const auto& clip : song.audioClips)
        if (clip.key == key)
            return clip.channel;
    return -1;
}
}

void ClipPlayer::adopt (const Song& song)
{
    for (int i = 0; i < numActive; ++i)
        active[(size_t) i]->channel = clipChannel (song, active[(size_t) i]->key);
}

void ClipPlayer::receive (const Song& song)
{
    const auto scope = incomingQueue.read (incomingQueue.getNumReady());
    for (int i = 0; i < scope.blockSize1 + scope.blockSize2; ++i)
    {
        auto* stream = incoming[(size_t) (i < scope.blockSize1 ? scope.startIndex1 + i : scope.startIndex2 + i - scope.blockSize1)];
        // Made for a play that's over: never started.
        if (stream->generation != generation || numActive >= maxStreams)
        {
            retire (stream);
            continue;
        }
        stream->channel = clipChannel (song, stream->key);
        active[(size_t) numActive++] = stream;
    }
}

void ClipPlayer::setGeneration (juce::uint32 next)
{
    generation = next;
    for (int i = 0; i < numActive;)
    {
        auto* stream = active[(size_t) i];
        if (stream->generation == next)
            ++i;
        else if (stream->started)
        {
            stream->stopping = true;
            ++i;
        }
        else
        {
            retire (stream);
            active[(size_t) i] = active[(size_t) --numActive];
        }
    }
}

void ClipPlayer::stopAll() { setGeneration (std::numeric_limits<juce::uint32>::max()); }

void ClipPlayer::startLate (double position, juce::uint32 pass, double loop, double ticksPerSample)
{
    for (int i = 0; i < numActive;)
    {
        auto* stream = active[(size_t) i];
        if (stream->started || stream->generation != generation || stream->pass > pass || (stream->pass == pass && stream->startTick >= position - tickSlack))
        {
            ++i;
            continue;
        }
        // Its tick has gone by: it starts now, skipping what it missed, so what's heard is in time.
        const auto lateTicks = (double) (pass - stream->pass) * loop + position - stream->startTick;
        const auto late = (juce::int64) std::llround (lateTicks / ticksPerSample);
        if (late >= stream->length || late > (juce::int64) (latestSeconds * sampleRate))
        {
            retire (stream);
            active[(size_t) i] = active[(size_t) --numActive];
            continue;
        }
        stream->started = true;
        stream->delay = 0;
        stream->owed = late;
        stream->remaining = stream->length - late;
        ++i;
    }
}

void ClipPlayer::schedule (double from, double to, double origin, juce::uint32 pass, int offset, int length, double ticksPerSample)
{
    for (int i = 0; i < numActive; ++i)
    {
        auto& stream = *active[(size_t) i];
        if (stream.started || stream.generation != generation || stream.pass != pass)
            continue;
        if (stream.startTick < from - tickSlack || stream.startTick >= to - tickSlack)
            continue;
        stream.started = true;
        stream.delay = offset + juce::jlimit (0, length - 1, (int) std::floor ((stream.startTick - origin + tickSlack) / ticksPerSample));
        stream.remaining = stream.length;
    }
}

void ClipPlayer::renderStream (Stream& stream, float gainLeft, float gainRight, float* left, float* right, int numSamples)
{
    const auto start = juce::jmin (stream.delay, numSamples);
    stream.delay = 0;
    // Behind (it started late, or the ring ran dry): catch up first.
    if (stream.owed > 0)
        stream.owed -= stream.skip ((int) juce::jmin (stream.owed, (juce::int64) std::numeric_limits<int>::max()));
    const auto room = numSamples - start;
    if (room <= 0)
        return;
    const auto fadeIn = stream.fadesIn ? fadeSamples : 0;
    if (stream.stopping)
    {
        const auto fade = juce::jmin (fadeSamples, room);
        stream.pull (left, right, start, fade, gainLeft, gainRight, 0, fade);
        stream.remaining = 0;
        return;
    }
    const auto want = (int) juce::jmin (stream.remaining, (juce::int64) room);
    // All but the clip's last few samples as they are; those fade out, so a clip cut off doesn't click.
    const auto plain = (int) juce::jlimit ((juce::int64) 0, (juce::int64) want, stream.remaining - fadeSamples);
    auto got = plain > 0 ? stream.pull (left, right, start, plain, gainLeft, gainRight, fadeIn, 0) : 0;
    for (int j = plain; j < want; ++j)
    {
        const auto level = (float) (stream.remaining - j - 1) / (float) fadeSamples;
        got += stream.pull (left, right, start + j, 1, gainLeft * level, gainRight * level, fadeIn, 0);
    }
    stream.remaining -= want;
    stream.owed += want - got;
}
