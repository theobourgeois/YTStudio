// A song as the engine plays it: what `shared/music/compile.ts` made of the document (`EngineSong`),
// with its samples loaded. Built on the message thread, then handed whole to the audio thread
// (`Sequencer::setSong`), which only reads it: nothing in a Song changes once it's made.
#pragma once

#include "Host.h"

#include <juce_audio_formats/juce_audio_formats.h>
#include <map>
#include <memory>
#include <vector>

/** An audio file in memory. */
struct Sample
{
    juce::AudioBuffer<float> audio;
    double sampleRate = 44100.0;
};

/** What's done to a sample before it plays (the document's `Precomputed`): trim, reverse, normalise, fade. */
struct Precomputed
{
    bool normalize = false, reverse = false;
    /** Fractions: where the sample starts, how much of the rest is kept, and the fades at each end of that. */
    double start = 0, length = 1, fadeIn = 0, fadeOut = 0;

    bool changesNothing() const { return ! normalize && ! reverse && start <= 0 && length >= 1 && fadeIn <= 0 && fadeOut <= 0; }
    juce::String key() const;
    /** `raw` with all of it applied. */
    std::shared_ptr<const Sample> apply (const Sample& raw) const;
};

/**
 * The samples loaded so far (message thread). A file is read once and kept for as long as the engine
 * runs. A prepared version of one (`Precomputed`) lives only as long as a song uses it: the songs own
 * those, and this only remembers them so that the next song, usually the same but for one edit, gets
 * the same one back rather than another copy.
 */
class SampleCache
{
public:
    SampleCache();
    /** The file's sound, reading it the first time; null when it can't be read. */
    std::shared_ptr<const Sample> get (const juce::String& path);
    /** The file's sound, prepared. */
    std::shared_ptr<const Sample> get (const juce::String& path, const Precomputed&);

private:
    juce::AudioFormatManager formats;
    std::map<juce::String, std::shared_ptr<const Sample>> loaded;
    std::map<juce::String, std::weak_ptr<const Sample>> prepared;
};

struct Song
{
    struct Envelope
    {
        float attack = 0, decay = 0, sustain = 1, release = 0;
    };

    struct Channel
    {
        juce::String id;
        std::shared_ptr<const Sample> sample;
        /** A plugin channel's instrument, once it's loaded (the channel is silent until then). */
        std::shared_ptr<HostedPlugin> plugin;
        bool isPlugin = false;
        float gainLeft = 1, gainRight = 1;
        /** Semitones added to every note. */
        float pitch = 0;
        /** A new note silences the channel's notes still sounding. */
        bool cutSelf = false;
        /** Without one, a note plays its whole sample whatever its length. */
        bool hasEnvelope = false;
        Envelope envelope;
    };

    struct Note
    {
        int channel = 0;
        /** Ticks from the loop's start. */
        double tick = 0, length = 0;
        /** Semitones from the sample's own pitch. */
        float pitch = 0;
        float gain = 1;
        /** For a plugin: the MIDI note and its velocity, 0..1. */
        int key = 60;
        float velocity = 0.78f;
        /** -1 (left) .. 1 (right), on top of the channel's. */
        float pan = 0;
    };

    double tempo = 120, ppq = 96;
    /** The loop's length, and a beat's and a bar's (the metronome), in ticks. */
    double loopTicks = 384, beatTicks = 96, barTicks = 384;
    std::vector<Channel> channels;
    /** In order of `tick`. */
    std::vector<Note> notes;

    int channelIndex (const juce::String& id) const;

    /** From the JSON of an `EngineSong`. `unreadable` gets the ids of channels whose sample couldn't be read. */
    static std::unique_ptr<Song> parse (const juce::var& json, SampleCache& samples, PluginHost& plugins, juce::StringArray& unreadable);
};
