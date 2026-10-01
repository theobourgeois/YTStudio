#include "Recorder.h"

namespace
{
/** How much of a track's input waits in memory for the writer thread: seconds of it. */
constexpr double bufferSeconds = 10.0;
/** The longest stretch written at once (longer blocks are written in pieces); silence for an input that isn't open is this long. */
constexpr int maxChunk = 8192;
}

/** A file being written: one track's take. */
struct Recorder::Sink
{
    juce::File file;
    int pass = 0, channels = 1;
    /** Offline: written at once. */
    std::unique_ptr<juce::AudioFormatWriter> direct;
    /** Live: through a FIFO the writer thread empties. */
    std::unique_ptr<juce::AudioFormatWriter::ThreadedWriter> threaded;

    bool write (const float* const* data, int numSamples)
    {
        if (threaded != nullptr)
            return threaded->write (data, numSamples);
        return direct != nullptr && direct->writeFromFloatArrays (data, channels, numSamples);
    }
};

struct Recorder::Track
{
    Source source;
    /** The file being written (the audio thread's once the recording has begun). */
    std::unique_ptr<Sink> current;
    /** The next pass's file, made ahead by the message thread and taken by the audio thread. */
    std::atomic<Sink*> spare { nullptr };
    /** The message thread's: the pass the next spare is for. */
    int nextPass = 1;
    /** The audio thread's: what's been written to `current`, and where it is in the song. */
    juce::int64 frames = 0, skip = 0;
    double startTick = 0;
    bool dropped = false;
};

struct Recorder::Session
{
    juce::String id;
    juce::File folder;
    double sampleRate = 48000;
    juce::int64 latency = 0;
    bool loop = false;
    std::vector<std::unique_ptr<Track>> tracks;
    /** Set by the audio thread when it's done with it (its files are finished). */
    std::atomic<bool> ended { false };

    ~Session()
    {
        // Files never handed to the audio thread, or never written: nothing to keep.
        for (auto& track : tracks)
        {
            if (auto* spare = track->spare.exchange (nullptr))
            {
                const auto file = spare->file;
                delete spare;
                file.deleteFile();
            }
            if (track->current != nullptr)
            {
                const auto file = track->current->file;
                track->current.reset();
                file.deleteFile();
            }
        }
    }
};

Recorder::Recorder (bool isOffline) : offline (isOffline), silence ((size_t) maxChunk, 0.0f) {}

Recorder::~Recorder()
{
    // Every session not yet deleted is in `live`: the one asked for, the one writing, the ones over.
    pending = nullptr;
    session = nullptr;
    for (auto* each : live)
        delete each;
    writerThread.stopThread (2000);
}

std::unique_ptr<Recorder::Sink> Recorder::open (const Session& recording, const Track& track, int pass)
{
    auto sink = std::make_unique<Sink>();
    sink->pass = pass;
    sink->channels = juce::jlimit (1, 2, (int) track.source.channels.size());
    sink->file = recording.folder.getChildFile (recording.id + "-" + track.source.track + "-" + juce::String (pass + 1) + ".wav");
    sink->file.deleteFile();
    auto output = std::make_unique<juce::FileOutputStream> (sink->file);
    if (! output->openedOk())
        return nullptr;
    std::unique_ptr<juce::OutputStream> stream = std::move (output);
    const auto options = juce::AudioFormatWriterOptions()
                             .withSampleRate (recording.sampleRate)
                             .withNumChannels (sink->channels)
                             .withBitsPerSample (32)
                             .withSampleFormat (juce::AudioFormatWriterOptions::SampleFormat::floatingPoint);
    auto writer = juce::WavAudioFormat().createWriterFor (stream, options);
    if (writer == nullptr)
        return nullptr;
    if (offline)
        sink->direct = std::move (writer);
    else
        sink->threaded = std::make_unique<juce::AudioFormatWriter::ThreadedWriter> (writer.release(), writerThread,
                                                                                  (int) (bufferSeconds * recording.sampleRate));
    return sink;
}

juce::Result Recorder::start (const juce::String& id, const juce::File& folder, const std::vector<Source>& sources, double sampleRate, juce::int64 latency, bool loop)
{
    if (sources.empty())
        return juce::Result::fail ("No mixer track is armed with an input.");
    if (! folder.createDirectory())
        return juce::Result::fail ("Couldn't make the folder for the recording: " + folder.getFullPathName());
    if (! offline && ! writerThread.isThreadRunning())
        writerThread.startThread();

    auto made = std::make_unique<Session>();
    made->id = id;
    made->folder = folder;
    made->sampleRate = sampleRate;
    made->latency = juce::jmax ((juce::int64) 0, latency);
    made->loop = loop;
    for (const auto& source : sources)
    {
        auto track = std::make_unique<Track>();
        track->source = source;
        track->current = open (*made, *track, 0);
        if (track->current == nullptr)
            return juce::Result::fail ("Couldn't write the recording in " + folder.getFullPathName());
        made->tracks.push_back (std::move (track));
    }
    // A loop's next pass needs its files before it comes round.
    if (loop)
        for (auto& track : made->tracks)
            track->spare = open (*made, *track, track->nextPass++).release();

    // One asked for and never begun (play was stopped first) goes.
    if (auto* old = pending.exchange (made.get()))
    {
        live.erase (std::remove (live.begin(), live.end(), old), live.end());
        delete old;
    }
    live.push_back (made.release());
    return juce::Result::ok();
}

void Recorder::cancel()
{
    // Either this takes it or the audio thread already has (then it's ended by the stop).
    if (auto* old = pending.exchange (nullptr))
    {
        live.erase (std::remove (live.begin(), live.end(), old), live.end());
        delete old;
    }
}

juce::String Recorder::recording() const
{
    for (auto it = live.rbegin(); it != live.rend(); ++it)
        if (! (*it)->ended.load())
            return (*it)->id;
    return {};
}

void Recorder::service (const std::function<void (const Take&)>& onTake)
{
    // The sessions the audio thread is done with: deleted once every file it finished before is reported.
    std::vector<Session*> over;
    {
        const auto scope = doneQueue.read (doneQueue.getNumReady());
        for (int i = 0; i < scope.blockSize1 + scope.blockSize2; ++i)
            over.push_back (done[(size_t) (i < scope.blockSize1 ? scope.startIndex1 + i : scope.startIndex2 + i - scope.blockSize1)]);
    }
    {
        const auto scope = finishedQueue.read (finishedQueue.getNumReady());
        for (int i = 0; i < scope.blockSize1 + scope.blockSize2; ++i)
        {
            const auto& item = finished[(size_t) (i < scope.blockSize1 ? scope.startIndex1 + i : scope.startIndex2 + i - scope.blockSize1)];
            std::unique_ptr<Sink> sink (item.sink);
            const auto file = sink->file;
            // Closing it writes what's left and the header's lengths.
            sink.reset();
            if (item.frames <= 0)
            {
                file.deleteFile();
                continue;
            }
            Take take;
            take.recording = item.session->id;
            take.track = item.session->tracks[(size_t) item.track]->source.track;
            take.file = file;
            take.startTick = item.startTick;
            take.skip = item.skip;
            take.frames = item.frames;
            take.sampleRate = item.session->sampleRate;
            take.pass = item.pass;
            take.final = item.final;
            take.dropped = item.dropped;
            onTake (take);
        }
    }
    for (auto* each : over)
    {
        live.erase (std::remove (live.begin(), live.end(), each), live.end());
        delete each;
    }

    // Spares for the passes to come.
    for (auto* each : live)
        if (each->loop && ! each->ended.load())
            for (auto& track : each->tracks)
                if (track->spare.load() == nullptr)
                    if (auto made = open (*each, *track, track->nextPass))
                    {
                        ++track->nextPass;
                        track->spare = made.release();
                    }
}

// Audio thread ----------------------------------------------------------------------------------------

void Recorder::begin (int offset, double tick)
{
    auto* next = pending.exchange (nullptr);
    if (next == nullptr)
        return;
    if (session != nullptr)
        end();
    session = next;
    clock = -offset;
    numSwitches = 0;
    for (auto& track : session->tracks)
    {
        track->frames = 0;
        track->skip = session->latency;
        track->startTick = tick;
        track->dropped = false;
    }
}

void Recorder::wrap (int offset)
{
    if (session == nullptr || ! session->loop || numSwitches >= maxSwitches)
        return;
    // The pass after the loop goes round begins as late as what's played along to it arrives.
    switches[(size_t) numSwitches++] = clock + offset + session->latency;
}

void Recorder::finish (Track& track, int index, bool final)
{
    Finished item;
    item.sink = track.current.release();
    item.session = session;
    item.track = index;
    item.pass = item.sink->pass;
    item.startTick = track.startTick;
    item.skip = track.skip;
    item.frames = track.frames;
    item.final = final;
    item.dropped = track.dropped;
    const auto scope = finishedQueue.write (1);
    if (scope.blockSize1 > 0)
        finished[(size_t) scope.startIndex1] = item;
    // (A full queue would mean deleting the file's writer here; it holds far more than ever wait.)
}

void Recorder::end()
{
    // A recording asked for and stopped before it began (in its count-in) is dropped by the next `start`.
    if (session == nullptr)
        return;
    for (size_t t = 0; t < session->tracks.size(); ++t)
        if (session->tracks[t]->current != nullptr)
            finish (*session->tracks[t], (int) t, true);
    session->ended = true;
    const auto scope = doneQueue.write (1);
    if (scope.blockSize1 > 0)
        done[(size_t) scope.startIndex1] = session;
    session = nullptr;
    numSwitches = 0;
}

void Recorder::write (const float* const* inputs, int numInputs, int numSamples)
{
    if (session == nullptr)
        return;

    const auto writeSegment = [&] (int from, int length) {
        for (int written = 0; written < length;)
        {
            const auto count = juce::jmin (maxChunk, length - written);
            for (auto& track : session->tracks)
            {
                if (track->current == nullptr)
                    continue;
                std::array<const float*, 2> data {};
                for (size_t c = 0; c < (size_t) track->current->channels; ++c)
                {
                    const auto channel = track->source.channels[c];
                    data[c] = channel >= 0 && channel < numInputs && inputs[channel] != nullptr ? inputs[channel] + from + written : silence.data();
                }
                if (track->current->write (data.data(), count))
                    track->frames += count;
                else
                    track->dropped = true;
            }
            written += count;
        }
    };

    // Nothing before the recording began; then up to each pass's switch, and the rest.
    auto at = (int) juce::jlimit ((juce::int64) 0, (juce::int64) numSamples, -clock);
    for (;;)
    {
        const auto cut = numSwitches > 0 ? switches[0] - clock : (juce::int64) numSamples + 1;
        const auto upto = (int) juce::jlimit ((juce::int64) at, (juce::int64) numSamples, cut);
        writeSegment (at, upto - at);
        at = upto;
        if (cut > numSamples)
            break;
        // The next pass: each track's spare file takes over (without one yet, the pass goes on in this one).
        for (size_t t = 0; t < session->tracks.size(); ++t)
        {
            auto& track = *session->tracks[t];
            auto* spare = track.spare.exchange (nullptr);
            if (spare == nullptr)
                continue;
            finish (track, (int) t, false);
            track.current.reset (spare);
            track.frames = 0;
            track.skip = 0;
            track.startTick = 0;
            track.dropped = false;
        }
        std::move (switches.begin() + 1, switches.begin() + numSwitches, switches.begin());
        --numSwitches;
    }
    clock += numSamples;
}
