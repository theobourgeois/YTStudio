#include "Export.h"

#include "Protocol.h"

#include <limits>

namespace
{
/** Quieter than this (−80 dB), a ringing tail is over... */
constexpr float quietLevel = 0.0001f;
/** ...once it's stayed that quiet for this long. */
constexpr double quietSeconds = 0.5;

/** A stem's sound held back `length` samples (so it's as late as the mix), in place. */
struct Hold
{
    explicit Hold (int samples) : length (samples), ring (2, juce::jmax (1, samples)) { ring.clear(); }

    void apply (float* left, float* right, int numSamples)
    {
        if (length <= 0)
            return;
        float* sides[] = { left, right };
        for (int ch = 0; ch < 2; ++ch)
        {
            auto* held = ring.getWritePointer (ch);
            auto at = position;
            for (int i = 0; i < numSamples; ++i)
            {
                std::swap (held[at], sides[ch][i]);
                if (++at == length)
                    at = 0;
            }
        }
        position = (int) ((position + numSamples) % length);
    }

    const int length;
    juce::AudioBuffer<float> ring;
    int position = 0;
};

/** One file being written: the mix, or a track's stem. */
struct Output
{
    juce::String id;
    /** The track's channel pair in the song's mixer buffers (-1: the mix). */
    int buffer = -1;
    juce::File file;
    std::unique_ptr<juce::AudioFormatWriter> writer;
    std::unique_ptr<Hold> hold;
    float peak = 0;
};

bool isFileName (const juce::String& id)
{
    return id.isNotEmpty() && id.length() <= 64 && id.containsOnly ("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-");
}
}

SongExport::SongExport (std::unique_ptr<Song> exported, Settings chosen, std::function<void (const juce::var&)> onFinished)
    : juce::Thread ("Vaudio export"), song (std::move (exported)), settings (std::move (chosen)), finished (std::move (onFinished))
{
    frames = (juce::int64) std::ceil (song->loopTicks * 60.0 * settings.sampleRate / (song->tempo * song->ppq));
}

SongExport::~SongExport()
{
    aborted = true;
    stopThread (30000);
}

void SongExport::run()
{
    juce::var result;
    try
    {
        result = render();
    }
    catch (const juce::String& error)
    {
        result = protocol::object ({ { "state", "failed" }, { "error", error } });
    }
    juce::MessageManager::callAsync ([callback = finished, result] { callback (result); });
}

juce::var SongExport::render()
{
    const auto began = juce::Time::getMillisecondCounterHiRes();
    const auto rate = settings.sampleRate;
    const auto block = settings.blockSize;
    const auto latency = song->latency;

    if (! settings.folder.createDirectory())
        throw juce::String ("Couldn't make the folder to export into.");
    const auto open = [&] (const juce::File& file) {
        file.deleteFile();
        std::unique_ptr<juce::OutputStream> stream = std::make_unique<juce::FileOutputStream> (file);
        const auto options = juce::AudioFormatWriterOptions()
                                 .withSampleRate (rate)
                                 .withNumChannels (2)
                                 .withBitsPerSample (32)
                                 .withSampleFormat (juce::AudioFormatWriterOptions::SampleFormat::floatingPoint);
        auto writer = juce::WavAudioFormat().createWriterFor (stream, options);
        if (writer == nullptr)
            throw juce::String ("Couldn't write " + file.getFileName() + ".");
        return writer;
    };

    std::vector<Output> outputs;
    if (settings.mix)
    {
        Output mix;
        mix.id = "mix";
        mix.file = settings.folder.getChildFile ("mix.wav");
        mix.writer = open (mix.file);
        outputs.push_back (std::move (mix));
    }
    // A stem for each track something plays into, but the master (that's the mix): held back until
    // it's as late as the master, so it lines up with the mix once the song's delay is trimmed.
    if (settings.stems)
        for (size_t t = 0; t + 1 < song->tracks.size(); ++t)
        {
            const auto& track = song->tracks[t];
            if (track.buffer < 0 || ! isFileName (track.id))
                continue;
            Output stem;
            stem.id = track.id;
            stem.buffer = track.buffer;
            stem.file = settings.folder.getChildFile (track.id + ".wav");
            stem.writer = open (stem.file);
            stem.hold = std::make_unique<Hold> (juce::jmax (0, latency - track.latency));
            outputs.push_back (std::move (stem));
        }
    if (outputs.empty())
        throw juce::String ("There's nothing to export.");

    const auto closeAll = [&] (bool keep) {
        for (auto& output : outputs)
        {
            output.writer.reset();
            if (! keep)
                output.file.deleteFile();
        }
    };

    // Denormals are slow, and the flag that turns them off is each thread's own (the workers set theirs).
    juce::ScopedNoDenormals noDenormals;
    Sequencer sequencer (true);
    sequencer.prepare (rate);
    std::unique_ptr<Workers> workers;
    if (settings.threads > 1)
    {
        workers = std::make_unique<Workers> (settings.threads);
        sequencer.setWorkers (workers.get());
    }
    sequencer.setSong (std::move (song));
    // Notes the live song left sounding in the plugins end before the first one is played.
    sequencer.silenceFirst();
    sequencer.play (0);

    juce::AudioBuffer<float> mix (2, block);
    juce::AudioBuffer<float> stem (2, block);
    // Samples rendered (the first `latency` of them are trimmed), written to every file, and to write:
    // the song, or while it rings out, everything until it's quiet.
    juce::int64 rendered = 0, written = 0, target = settings.ringOut ? std::numeric_limits<juce::int64>::max() : frames;
    juce::int64 quietFor = 0;
    auto ringing = settings.ringOut;
    const auto quietRun = (juce::int64) (quietSeconds * rate);
    const auto longestTail = (juce::int64) (juce::jmax (0.0, settings.maxTailSeconds) * rate);

    while (written < target)
    {
        if (aborted || threadShouldExit())
        {
            closeAll (false);
            return protocol::object ({ { "state", "aborted" } });
        }
        sequencer.prepareClips();
        sequencer.collectGarbage();
        mix.clear();
        sequencer.process (mix.getWritePointer (0), mix.getWritePointer (1), block);
        const auto* playing = sequencer.current();

        const auto skip = (int) juce::jlimit ((juce::int64) 0, (juce::int64) block, latency - rendered);
        rendered += block;
        const auto available = block - skip;
        const auto count = (int) juce::jmin ((juce::int64) available, target - written);

        auto loudest = 0.0f;
        for (auto& output : outputs)
        {
            float* sides[2];
            if (output.buffer < 0)
            {
                sides[0] = mix.getWritePointer (0);
                sides[1] = mix.getWritePointer (1);
            }
            else
            {
                stem.copyFrom (0, 0, playing->audio, output.buffer * 2, 0, block);
                stem.copyFrom (1, 0, playing->audio, output.buffer * 2 + 1, 0, block);
                sides[0] = stem.getWritePointer (0);
                sides[1] = stem.getWritePointer (1);
                output.hold->apply (sides[0], sides[1], block);
            }
            if (count <= 0)
                continue;
            const float* part[] = { sides[0] + skip, sides[1] + skip };
            if (! output.writer->writeFromFloatArrays (part, 2, count))
            {
                closeAll (false);
                throw juce::String ("Couldn't write " + output.file.getFileName() + " (is the disk full?).");
            }
            const auto level = juce::jmax (juce::FloatVectorOperations::findMaximum (part[0], count), -juce::FloatVectorOperations::findMinimum (part[0], count),
                                           juce::FloatVectorOperations::findMaximum (part[1], count), -juce::FloatVectorOperations::findMinimum (part[1], count));
            output.peak = juce::jmax (output.peak, level);
            loudest = juce::jmax (loudest, level);
        }
        if (count <= 0)
            continue;
        written += count;
        done = juce::jmin (written, frames);

        if (ringing && written > frames)
        {
            quietFor = loudest < quietLevel ? quietFor + count : 0;
            if (quietFor >= quietRun || written - frames >= longestTail)
            {
                ringing = false;
                target = written;
            }
        }
    }
    closeAll (true);

    // Stems of tracks that never made a sound aren't worth a file.
    juce::Array<juce::var> files;
    for (const auto& output : outputs)
    {
        if (output.buffer >= 0 && output.peak <= 0.0f)
        {
            output.file.deleteFile();
            continue;
        }
        files.add (protocol::object ({ { "id", output.id }, { "file", output.file.getFullPathName() }, { "peak", output.peak } }));
    }
    return protocol::object ({ { "state", "done" },
                               { "frames", written },
                               { "sampleRate", rate },
                               { "latency", latency },
                               { "seconds", (juce::Time::getMillisecondCounterHiRes() - began) / 1000.0 },
                               { "files", files } });
}
