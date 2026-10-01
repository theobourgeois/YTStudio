// The export: a song rendered to files as fast as it computes, on a thread of its own, by a sequencer
// of its own playing a copy of the song (the one the engine plays live is left as it was). The engine
// stops playing while it runs, since the song's plugins are the same instances (`Engine::startExport`).
//
// What's written: the mix (the master's sound) and, for stems, each mixer track's sound after its
// fader, as 32-bit float WAVs that the server then encodes. Every file starts on the song's first
// sample: the plugins' delay (`Song::latency`) is trimmed off, and each track's own (`Track::latency`)
// is made up by holding it back until it's as late as the master, so stems line up with the mix to the
// sample. The song doesn't loop: it ends where it ends (`Song::loops`), and then either stops there or
// rings out until it's quiet (a reverb's tail), the same length in every file.
#pragma once

#include "Sequencer.h"
#include "Song.h"

#include <atomic>
#include <functional>
#include <juce_audio_formats/juce_audio_formats.h>

class SongExport final : private juce::Thread
{
public:
    struct Settings
    {
        /** Where the files go: `mix.wav`, and `<track id>.wav` for each stem. */
        juce::File folder;
        bool mix = true, stems = false;
        /** Keep going after the end until it's quiet (else stop on the last sample). */
        bool ringOut = false;
        /** The longest a tail can ring. */
        double maxTailSeconds = 30;
        double sampleRate = 48000;
        int blockSize = 2048;
    };

    /** `finished` is called on the message thread with the result (`EngineExportEvent`'s fields), once. */
    SongExport (std::unique_ptr<Song> song, Settings settings, std::function<void (const juce::var&)> finished);
    ~SongExport() override;

    void start() { startThread (juce::Thread::Priority::high); }
    /** Stop as soon as it can; what was written is deleted. */
    void abort() { aborted = true; }

    /** How far it is: samples of the song written, out of how many (the tail comes after). */
    juce::int64 written() const { return done.load(); }
    juce::int64 length() const { return frames; }

private:
    void run() override;
    /** Render it all; returns the result, or throws a message. */
    juce::var render();

    std::unique_ptr<Song> song;
    const Settings settings;
    std::function<void (const juce::var&)> finished;
    /** The song's own length, in samples. */
    juce::int64 frames = 0;
    std::atomic<juce::int64> done { 0 };
    std::atomic<bool> aborted { false };
};
