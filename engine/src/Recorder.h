// Recording (FL Studio's, through mixer tracks): each armed track's input, dry, written to a WAV of its
// own while the song plays, a new file for each pass round the loop (Loop record), so every pass is a
// take. The files are 32-bit float, one channel for a mono input, two for a pair.
//
// The audio thread never opens, writes or closes a file. Files are opened on the message thread
// before they're needed (a recording's first ones in `start`, and a spare per track for its next pass,
// made by `service`); the audio thread pushes samples into each file's lock-free FIFO, which a writer
// thread empties to disk (`AudioFormatWriter::ThreadedWriter`); a finished file goes back through a
// lock-free queue for the message thread to close and report. Offline (tests), files are written
// straight away on the rendering thread, so a render is the same every time.
//
// Latency: what's heard at a tick left the device late (the output's latency and the song's plugin
// delay), and what's played along to it reaches the engine late too (the input's). A recording's first
// file starts where play starts, with that `latency` at its head (`Take::skip`: the tab leaves it out);
// later passes switch files `latency` samples after the loop goes round, so each starts on the beat.
#pragma once

#include <juce_audio_formats/juce_audio_formats.h>

#include <array>
#include <atomic>
#include <functional>
#include <memory>
#include <vector>

class Recorder
{
public:
    /** What an armed track records: the device's input channels it takes (one: mono). */
    struct Source
    {
        juce::String track;
        std::vector<int> channels;
    };

    /** A file finished: one track's take, for one pass. */
    struct Take
    {
        juce::String recording, track;
        juce::File file;
        /** The engine's tick (into the loop) at sample `skip` of the file. */
        double startTick = 0;
        juce::int64 skip = 0, frames = 0;
        double sampleRate = 48000;
        int pass = 0;
        /** The last of its recording (play stopped). */
        bool final = false;
        /** Samples were lost (the disk didn't keep up). */
        bool dropped = false;
    };

    explicit Recorder (bool offline);
    ~Recorder();

    // Message thread -------------------------------------------------------------------------------

    /**
     * Get ready to record `sources` into `folder`, as recording `id`: their files are opened now, and
     * writing starts when the audio thread is told play has started (`begin`). `loop`: a pass round the
     * loop is a take of its own. Fails if a file can't be made.
     */
    juce::Result start (const juce::String& id, const juce::File& folder, const std::vector<Source>& sources, double sampleRate, juce::int64 latency, bool loop);
    /** Open the files the next passes need, and close and report (`onTake`) the ones finished. Call regularly. */
    void service (const std::function<void (const Take&)>& onTake);
    /** The recording in progress (asked for, or writing), or empty. */
    juce::String recording() const;
    /** Play stopped before a recording asked for began (in its count-in): it's dropped. */
    void cancel();

    // Audio thread ---------------------------------------------------------------------------------

    /** Play (the transport, after any count-in) starts at sample `offset` of this block, at `tick`: the recording asked for begins there. */
    void begin (int offset, double tick);
    /** The loop goes round at sample `offset` of this block. */
    void wrap (int offset);
    /** Play stopped before this block: the recording's files are finished. */
    void end();
    /** This block's input, by the device's channel (null: silent, or not open). After `begin`/`wrap` for the block. */
    void write (const float* const* inputs, int numInputs, int numSamples);

private:
    struct Sink;
    struct Track;
    struct Session;

    struct Finished
    {
        Sink* sink = nullptr;
        Session* session = nullptr;
        int track = 0, pass = 0;
        double startTick = 0;
        juce::int64 skip = 0, frames = 0;
        bool final = false, dropped = false;
    };

    std::unique_ptr<Sink> open (const Session&, const Track&, int pass);
    void finish (Track&, int index, bool final);

    const bool offline;
    juce::TimeSliceThread writerThread { "Recording" };
    std::unique_ptr<juce::AudioFormat> wav;

    /** Handed to the audio thread by `start`, taken by `begin`. */
    std::atomic<Session*> pending { nullptr };
    /** The audio thread's. */
    Session* session = nullptr;
    /** Sample count since recording began (the audio thread's), and where the next passes start. */
    juce::int64 clock = 0;
    static constexpr int maxSwitches = 16;
    std::array<juce::int64, maxSwitches> switches {};
    int numSwitches = 0;

    static constexpr int queueSize = 256;
    juce::AbstractFifo finishedQueue { queueSize };
    std::array<Finished, queueSize> finished {};
    /** Sessions the audio thread is done with: the message thread deletes them (and their unused spares). */
    juce::AbstractFifo doneQueue { 16 };
    std::array<Session*, 16> done {};
    /** The message thread's: every session started and not yet deleted (to make spares for). */
    std::vector<Session*> live;
    std::vector<float> silence;

    JUCE_DECLARE_NON_COPYABLE (Recorder)
};
