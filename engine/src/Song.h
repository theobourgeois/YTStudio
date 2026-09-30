// A song as the engine plays it: what `shared/music/compile.ts` made of the document (`EngineSong`),
// with its samples loaded. Built on the message thread, then handed whole to the audio thread
// (`Sequencer::setSong`), which only reads it: nothing in a Song changes once it's made.
#pragma once

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

/**
 * The samples loaded so far, by path (message thread). Nothing is ever dropped while the engine runs:
 * a voice still sounding keeps only a bare pointer to its sample, and this is what keeps it alive.
 */
class SampleCache
{
public:
    SampleCache();
    /** The file's sound, reading it the first time; null when it can't be read. */
    std::shared_ptr<const Sample> get (const juce::String& path);

private:
    juce::AudioFormatManager formats;
    std::map<juce::String, std::shared_ptr<const Sample>> loaded;
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
        float gainLeft = 1, gainRight = 1;
        /** Semitones added to every note. */
        float pitch = 0;
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
    };

    double tempo = 120, ppq = 96;
    /** The loop's length, and a beat's and a bar's (the metronome), in ticks. */
    double loopTicks = 384, beatTicks = 96, barTicks = 384;
    std::vector<Channel> channels;
    /** In order of `tick`. */
    std::vector<Note> notes;

    int channelIndex (const juce::String& id) const;

    /** From the JSON of an `EngineSong`. `unreadable` gets the ids of channels whose sample couldn't be read. */
    static std::unique_ptr<Song> parse (const juce::var& json, SampleCache& samples, juce::StringArray& unreadable);
};
