// The Browser's preview: one audio file played straight to the output, outside the song, streamed from
// disk so a whole song previews in the memory of a few seconds of it (`SampleCache` reads files whole).
// A channel's own preview goes into its mixer track instead: `Engine::process` hands the sequencer what
// it pulled, which adds it where the channel's clips play, so the track's effects take it as they take them.
//
// A `Stream` is a file being played (an `AudioStream`): a reader thread decodes it ahead, at the
// device's rate, into a lock-free ring the audio thread reads. Streams reach the audio thread through an atomic pointer and go
// back through a lock-free queue to be deleted on the message thread, like songs (`Sequencer`). A new
// preview cuts the last one off with a short fade. Offline, the stream is read on the rendering thread
// instead, so a render is the same every time.
#pragma once

#include "AudioStream.h"

#include <array>
#include <atomic>
#include <memory>
#include <juce_audio_formats/juce_audio_formats.h>

class FilePreview
{
public:
    explicit FilePreview (bool offline);
    ~FilePreview();

    /** The device's rate: what streams made from now on play at. */
    void prepare (double sampleRate);

    // Message thread -------------------------------------------------------------------------------

    /**
     * Play `file` from `startSeconds`, cutting the last one off. `id` is the tab's name for it. A channel's own preview (an audio clip's,
     * from its settings window) gives its gains and pitch (`transpose` semitones, its time kept, through the
     * stretcher) and isn't at the Browser's volume. `speed` reads it faster or slower, its pitch going with it.
     * `channel` (a song's channel id; empty: none) sends it into that channel's mixer track rather than the output.
     */
    juce::Result play (const juce::File& file, double startSeconds, const juce::String& id, float gainLeft = 1.0f, float gainRight = 1.0f, double speed = 1.0,
                       bool browserVolume = true, double transpose = 0.0, const juce::String& channel = {});
    void stop();
    /** 0..1, at once (it's the Browser's volume). */
    void setVolume (float gain);
    /** Delete the streams the audio thread is done with. */
    void collectGarbage();
    /** What's previewing: `{ id, seconds, duration }`, or void when nothing is. */
    juce::var describe() const;
    bool isPlaying() const;

    // Audio thread ---------------------------------------------------------------------------------

    /**
     * Add the preview's next samples to `left` and `right`, or, a channel's, to `channelLeft` and
     * `channelRight` (cleared here first). Returns which channel that is (null: none), valid until the next call.
     */
    const juce::String* process (float* left, float* right, float* channelLeft, float* channelRight, int numSamples);

private:
    struct Stream;

    void retire (Stream*);
    /** Delete a stream nothing plays any more (the audio thread never got it, or gave it back). */
    void discard (Stream*);
    /** Add up to `numSamples` of `stream` from its ring (faded in at its start, or out over this block); how many it had. */
    int pull (Stream& stream, float* left, float* right, int numSamples, float volume, bool fadeOut);

    const bool offline;
    double sampleRate = 48000.0;
    juce::AudioFormatManager formats;
    juce::TimeSliceThread reader { "Vaudio preview reader" };

    /** The next stream for the audio thread (or `stopRequest`): it takes it at its next block. */
    std::atomic<Stream*> pending { nullptr };
    /** A pointer that means "stop", in `pending` (never dereferenced). */
    char stopToken = 0;
    Stream* const stopRequest = reinterpret_cast<Stream*> (&stopToken);
    /** The audio thread's: the stream playing, and the one being faded out. */
    Stream* playing = nullptr;
    Stream* fading = nullptr;
    /** Streams done with in the last block, retired at the next: the channel `process` named stays alive till then. */
    std::array<Stream*, 2> spent {};
    std::atomic<float> volume { 1.0f };

    static constexpr int queueSize = 64;
    juce::AbstractFifo garbageQueue { queueSize };
    std::array<Stream*, queueSize> garbage {};

    /** The message thread's: the stream last handed over, to say how far along it is (null once it's done). */
    Stream* latest = nullptr;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (FilePreview)
};
