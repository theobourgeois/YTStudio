// The playlist's audio clips (song mode), each played from its file as it streams from disk
// (`AudioStream`): a vocal take or a whole song plays in the memory of a few seconds of it.
//
// A clip must start on its sample, so its stream is made and decoded *before* it's due. The message
// thread looks ahead of the playhead (`prepare`, on the engine's timer, and at once when play starts)
// and makes a stream for each clip about to be entered: at its start, or wherever play is inside it.
// A stream knows the tick it starts at, the play it belongs to (`generation`: every play and stop
// starts a new one) and the pass round the loop (`pass`), so the audio thread starts it on its sample
// when the playhead gets there (`schedule`), and drops it when play moves elsewhere. One that comes too
// late is started at once, skipping what it missed, so it's still in time.
//
// Streams reach the audio thread through a lock-free queue and go back through another to be deleted
// on the message thread, like songs (`Sequencer`). Offline, streams are decoded on the rendering
// thread, so a render is the same every time.
#pragma once

#include "AudioStream.h"
#include "Song.h"

#include <array>
#include <map>
#include <utility>
#include <vector>

class ClipPlayer
{
public:
    explicit ClipPlayer (bool offline);
    ~ClipPlayer();

    void prepare (double sampleRate);

    // Message thread -------------------------------------------------------------------------------

    /** The clips of the song about to be handed to the audio thread (`Song::audioClips`). */
    void setSong (const Song& song);
    /**
     * Have streams ready for the clips the playhead will be in within the next second or so, from
     * `position` (ticks into the loop) in play `generation`'s `pass` round it. `margin`: how far ahead
     * of `position` a clip already being played can start (0 when play hasn't started yet).
     */
    void prepare (double position, juce::uint32 generation, juce::uint32 pass, double marginSeconds);
    /** Delete the streams the audio thread is done with. */
    void collectGarbage();

    // Audio thread ---------------------------------------------------------------------------------

    /** A new song has been adopted: each stream finds its clip in it (by key), or fades out. */
    void adopt (const Song& song);
    /** Take the streams the message thread has made since the last block. */
    void receive (const Song& song);
    /** Play has started or stopped: the streams of other plays fade out. */
    void setGeneration (juce::uint32 generation);
    /** Start streams that are late (their tick has passed in this pass): at once, skipping what they missed. */
    void startLate (double position, juce::uint32 pass, double loopTicks, double ticksPerSample);
    /** The transport covers `[from, to)` of the loop in this block, `offset` samples in: start the streams due there. */
    void schedule (double from, double to, double origin, juce::uint32 pass, int offset, int length, double ticksPerSample);
    /** Fade out everything playing (stop). */
    void stopAll();
    /**
     * Add the playing streams' next `numSamples` to their channels' tracks: `target (channel)` gives a
     * channel's two buffers (or nulls), and the song its gains.
     */
    template <typename Target>
    void render (const Song& song, int numSamples, Target&& target);

private:
    struct Stream;

    /** The message thread's copy of a song's clip (what it needs to look ahead). */
    struct Clip
    {
        juce::uint64 key = 0;
        juce::String path;
        double tick = 0, length = 0, seconds = 0, speed = 1;
        /** Prepared by its channel's precomputed effects: played from memory instead of the file. */
        std::shared_ptr<const Sample> sample;
    };

    Stream* make (const Clip& clip, double startTick, juce::uint32 generation, juce::uint32 pass, bool immediate);
    bool has (juce::uint64 key, juce::uint32 generation, juce::uint32 pass) const;
    void retire (Stream* stream);
    void discard (Stream* stream);
    /** One stream's part of a block (audio thread). */
    void renderStream (Stream& stream, float gainLeft, float gainRight, float* left, float* right, int numSamples);

    const bool offline;
    double sampleRate = 48000.0;
    juce::AudioFormatManager formats;
    juce::TimeSliceThread reader { "Vaudio clip reader" };

    // The message thread's.
    std::vector<Clip> clips;
    double loopTicks = 1, secondsPerTick = 0.005;
    std::vector<Stream*> live;
    std::map<juce::String, double> durations;

    // Between the threads.
    static constexpr int maxStreams = 64;
    juce::AbstractFifo incomingQueue { maxStreams };
    std::array<Stream*, maxStreams> incoming {};
    juce::AbstractFifo garbageQueue { maxStreams * 2 };
    std::array<Stream*, maxStreams * 2> garbage {};

    // The audio thread's.
    std::array<Stream*, maxStreams> active {};
    int numActive = 0;
    juce::uint32 generation = 0;

    JUCE_DECLARE_NON_COPYABLE (ClipPlayer)
};

/** A clip's stream, and where it plays. */
struct ClipPlayer::Stream final : AudioStream
{
    Stream (std::unique_ptr<juce::AudioFormatReader> source, double outputRate, double startSeconds, juce::int64 samples, juce::uint64 clipKey, double tick,
            juce::uint32 playGeneration, juce::uint32 playPass, bool fadeIn, double speed)
        : AudioStream (std::move (source), outputRate, startSeconds, samples, 2.0, speed),
          key (clipKey),
          startTick (tick),
          generation (playGeneration),
          pass (playPass),
          length (samples),
          fadesIn (fadeIn)
    {
    }

    const juce::uint64 key;
    const double startTick;
    const juce::uint32 generation, pass;
    /** Output samples from its start to its clip's end (or the loop's). */
    const juce::int64 length;
    /** It starts inside its file: faded in, so it doesn't click. */
    const bool fadesIn;

    // The audio thread's.
    /** Its clip's channel in the song playing, or -1 (it's gone: fade out). */
    int channel = -1;
    bool started = false;
    /** Samples into this block where it starts. */
    int delay = 0;
    /** Samples left to play, and samples it fell behind by (the ring ran dry) and must skip to be in time. */
    juce::int64 remaining = 0, owed = 0;
    bool stopping = false;
};

template <typename Target>
void ClipPlayer::render (const Song& song, int numSamples, Target&& target)
{
    for (int i = 0; i < numActive; ++i)
    {
        auto& stream = *active[(size_t) i];
        if (! stream.started)
            continue;
        if (offline)
            stream.fill();
        float gainLeft = 0, gainRight = 0;
        std::pair<float*, float*> buffers { nullptr, nullptr };
        if (stream.channel >= 0)
        {
            gainLeft = song.channels[(size_t) stream.channel].gainLeft;
            gainRight = song.channels[(size_t) stream.channel].gainRight;
            buffers = target (stream.channel);
        }
        if (buffers.first == nullptr)
        {
            // Nowhere to play (its clip is gone, or its track can't be reached): it ends.
            stream.stopping = true;
            stream.remaining = 0;
        }
        else
            renderStream (stream, gainLeft, gainRight, buffers.first, buffers.second, numSamples);
    }
    // Those that have ended go back to be deleted.
    for (int i = 0; i < numActive;)
    {
        auto* stream = active[(size_t) i];
        if (stream->started && (stream->remaining <= 0 || stream->finished()))
        {
            retire (stream);
            active[(size_t) i] = active[(size_t) --numActive];
        }
        else
            ++i;
    }
}
