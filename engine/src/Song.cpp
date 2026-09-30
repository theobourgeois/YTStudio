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

juce::String Precomputed::key() const
{
    return juce::String (normalize ? "n" : "-") + (reverse ? "r" : "-") + juce::String (start, 5) + "," + juce::String (length, 5) + ","
           + juce::String (fadeIn, 5) + "," + juce::String (fadeOut, 5);
}

std::shared_ptr<const Sample> Precomputed::apply (const Sample& raw) const
{
    const auto total = raw.audio.getNumSamples();
    const auto first = juce::jlimit (0, juce::jmax (0, total - 1), (int) std::floor (start * total));
    const auto kept = juce::jlimit (juce::jmin (1, total - first), total - first, (int) std::ceil (length * (total - first)));

    auto result = std::make_shared<Sample>();
    result->sampleRate = raw.sampleRate;
    result->audio.setSize (raw.audio.getNumChannels(), kept);
    for (int ch = 0; ch < raw.audio.getNumChannels(); ++ch)
        result->audio.copyFrom (ch, 0, raw.audio, ch, first, kept);

    if (reverse)
        result->audio.reverse (0, kept);
    if (normalize)
        if (const auto peak = result->audio.getMagnitude (0, kept); peak > 0.0f)
            result->audio.applyGain (1.0f / peak);
    if (const auto in = juce::jmin (kept, (int) (fadeIn * kept)); in > 0)
        result->audio.applyGainRamp (0, in, 0.0f, 1.0f);
    if (const auto out = juce::jmin (kept, (int) (fadeOut * kept)); out > 0)
        result->audio.applyGainRamp (kept - out, out, 1.0f, 0.0f);
    return result;
}

SampleCache::SampleCache() { formats.registerBasicFormats(); }

std::shared_ptr<const Sample> SampleCache::get (const juce::String& path, const Precomputed& precomputed)
{
    const auto raw = get (path);
    if (raw == nullptr || precomputed.changesNothing())
        return raw;

    const auto key = path + "|" + precomputed.key();
    if (const auto found = prepared.find (key); found != prepared.end())
        if (auto existing = found->second.lock())
            return existing;

    // Forget the ones no song uses any more (every turn of a knob makes another).
    std::erase_if (prepared, [] (const auto& entry) { return entry.second.expired(); });
    auto made = precomputed.apply (*raw);
    prepared[key] = made;
    return made;
}

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

std::unique_ptr<Song> Song::parse (const juce::var& json, SampleCache& samples, PluginHost& plugins, juce::StringArray& unreadable)
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
            channel.cutSelf = (bool) item["cutSelf"];
            if (const auto plugin = item["plugin"]; plugin.isObject())
            {
                channel.isPlugin = true;
                const auto state = plugin["state"].toString();
                channel.plugin = plugins.get (channel.id, plugin["id"].toString(), state.isEmpty() ? juce::File() : juce::File (state));
            }
            Precomputed precomputed;
            if (const auto tools = item["precomputed"]; tools.isObject())
            {
                precomputed.normalize = (bool) tools["normalize"];
                precomputed.reverse = (bool) tools["reverse"];
                precomputed.start = number (tools["start"], 0, 0, 0.99);
                precomputed.length = number (tools["length"], 1, 0.0001, 1);
                precomputed.fadeIn = number (tools["fadeIn"], 0, 0, 1);
                precomputed.fadeOut = number (tools["fadeOut"], 0, 0, 1);
            }
            if (const auto path = item["sample"]; path.isString() && path.toString().isNotEmpty())
            {
                channel.sample = samples.get (path.toString(), precomputed);
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
            note.key = (int) number (item["key"], 60, 0, 127);
            note.velocity = (float) number (item["velocity"], 0.78, 0, 1);
            song->notes.push_back (note);
        }
    juce::StringArray channelIds;
    for (const auto& channel : song->channels)
        channelIds.add (channel.id);
    plugins.keepOnly (channelIds);

    std::stable_sort (song->notes.begin(), song->notes.end(), [] (const Note& a, const Note& b) { return a.tick < b.tick; });
    return song;
}
