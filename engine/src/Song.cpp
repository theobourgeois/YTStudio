#include "Song.h"

#include <algorithm>

namespace
{
/** Longer files aren't samples; reading one into memory would stall the engine. */
constexpr double maxSampleSeconds = 600.0;

double number (const juce::var& v, double fallback, double low, double high)
{
    if (! (v.isDouble() || v.isInt() || v.isInt64()))
        return fallback;
    const auto value = (double) v;
    return std::isfinite (value) ? juce::jlimit (low, high, value) : fallback;
}
}

SampleCache::SampleCache() { formats.registerBasicFormats(); }

std::shared_ptr<const Sample> SampleCache::get (const juce::String& path)
{
    if (const auto found = loaded.find (path); found != loaded.end())
        return found->second;

    std::shared_ptr<Sample> sample;
    if (std::unique_ptr<juce::AudioFormatReader> reader { formats.createReaderFor (juce::File (path)) })
    {
        if (reader->lengthInSamples > 0 && (double) reader->lengthInSamples <= maxSampleSeconds * reader->sampleRate)
        {
            sample = std::make_shared<Sample>();
            sample->sampleRate = reader->sampleRate;
            sample->audio.setSize (juce::jmin (2, (int) reader->numChannels), (int) reader->lengthInSamples);
            reader->read (&sample->audio, 0, (int) reader->lengthInSamples, 0, true, true);
        }
    }
    // A file that can't be read is remembered too, so it isn't tried again on every edit.
    loaded[path] = sample;
    return sample;
}

int Song::channelIndex (const juce::String& id) const
{
    for (size_t i = 0; i < channels.size(); ++i)
        if (channels[i].id == id)
            return (int) i;
    return -1;
}

std::unique_ptr<Song> Song::parse (const juce::var& json, SampleCache& samples, juce::StringArray& unreadable)
{
    auto song = std::make_unique<Song>();
    song->tempo = number (json["tempo"], 120, 1, 2000);
    song->ppq = number (json["ppq"], 96, 1, 100000);
    song->loopTicks = number (json["loopTicks"], song->ppq * 4, 1, 1e9);
    song->beatTicks = number (json["beatTicks"], song->ppq, 1, 1e9);
    song->barTicks = number (json["barTicks"], song->beatTicks * 4, 1, 1e9);

    if (const auto* list = json["channels"].getArray())
        for (const auto& item : *list)
        {
            Channel channel;
            channel.id = item["id"].toString();
            channel.gainLeft = (float) number (item["gainLeft"], 1, 0, 8);
            channel.gainRight = (float) number (item["gainRight"], 1, 0, 8);
            channel.pitch = (float) number (item["pitch"], 0, -96, 96);
            if (const auto envelope = item["envelope"]; envelope.isObject())
            {
                channel.hasEnvelope = true;
                channel.envelope = { (float) number (envelope["attack"], 0, 0, 60),
                                     (float) number (envelope["decay"], 0, 0, 60),
                                     (float) number (envelope["sustain"], 1, 0, 1),
                                     (float) number (envelope["release"], 0, 0, 60) };
            }
            if (const auto path = item["sample"]; path.isString() && path.toString().isNotEmpty())
            {
                channel.sample = samples.get (path.toString());
                if (channel.sample == nullptr)
                    unreadable.add (channel.id);
            }
            song->channels.push_back (std::move (channel));
        }

    if (const auto* list = json["notes"].getArray())
        for (const auto& item : *list)
        {
            Note note;
            note.channel = (int) number (item["channel"], -1, -1, 1e6);
            if (note.channel < 0 || note.channel >= (int) song->channels.size())
                continue;
            note.tick = number (item["tick"], -1, -1, 1e9);
            if (note.tick < 0 || note.tick >= song->loopTicks)
                continue;
            note.length = number (item["length"], 1, 0, 1e9);
            note.pitch = (float) number (item["pitch"], 0, -127, 127);
            note.gain = (float) number (item["gain"], 1, 0, 8);
            song->notes.push_back (note);
        }
    std::stable_sort (song->notes.begin(), song->notes.end(), [] (const Note& a, const Note& b) { return a.tick < b.tick; });
    return song;
}
