#include "Song.h"

#include <algorithm>
#include <limits>

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

std::unique_ptr<Song> Song::parse (const juce::var& json, SampleCache& samples, PluginHost& plugins, PluginHost& effects, juce::StringArray& unreadable, int capacity, double sampleRate)
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
                channel.plugin = plugins.get (channel.id, plugin["id"].toString(), state.isEmpty() ? juce::File() : juce::File (state), item["name"].toString());
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
            channel.stream = (bool) item["stream"];
            if (const auto path = item["sample"]; path.isString() && path.toString().isNotEmpty())
            {
                // An audio clip's file is streamed when it plays: here it only has to be there.
                if (channel.stream)
                {
                    channel.path = path.toString();
                    if (! juce::File (channel.path).existsAsFile())
                        unreadable.add (channel.id);
                }
                else
                {
                    channel.sample = samples.get (path.toString(), precomputed);
                    if (channel.sample == nullptr)
                        unreadable.add (channel.id);
                }
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
            note.pan = (float) number (item["pan"], 0, -1, 1);
            song->notes.push_back (note);
        }
    if (const auto* list = json["audioClips"].getArray())
        for (const auto& item : *list)
        {
            AudioClip clip;
            clip.channel = (int) number (item["channel"], -1, -1, 1e6);
            if (clip.channel < 0 || clip.channel >= (int) song->channels.size() || ! song->channels[(size_t) clip.channel].stream)
                continue;
            clip.path = song->channels[(size_t) clip.channel].path;
            clip.tick = number (item["tick"], 0, -1e9, 1e9);
            clip.length = number (item["length"], 0, 0, 1e9);
            clip.seconds = number (item["seconds"], 0, 0, 1e7);
            clip.speed = number (item["speed"], 1, 0.0625, 16);
            if (clip.path.isEmpty() || clip.length <= 0 || clip.tick >= song->loopTicks || clip.tick + clip.length <= 0)
                continue;
            clip.key = (juce::uint64) (song->channels[(size_t) clip.channel].id + "|" + clip.path + "|" + juce::String (clip.tick, 6) + "|" + juce::String (clip.length, 6) + "|"
                        + juce::String (clip.seconds, 9) + "|" + juce::String (clip.speed, 9) + "|" + juce::String (song->tempo, 6) + "|" + juce::String (song->ppq))
                                           .hashCode64();
            song->audioClips.push_back (std::move (clip));
        }
    std::stable_sort (song->audioClips.begin(), song->audioClips.end(), [] (const AudioClip& a, const AudioClip& b) { return a.tick < b.tick; });

    // The mixer's tracks. A song without them (or with none) has a master alone, as it was before.
    juce::StringArray effectIds;
    if (const auto* list = json["tracks"].getArray())
        for (const auto& item : *list)
        {
            Track track;
            track.id = item["id"].toString();
            track.latencyOffsetMs = number (item["latencyOffset"], 0, -1000, 1000);
            if (const auto* slots = item["effects"].getArray())
                for (const auto& slot : *slots)
                {
                    const auto plugin = slot["plugin"];
                    const auto id = slot["id"].toString();
                    if (! plugin.isObject() || id.isEmpty())
                        continue;
                    const auto state = plugin["state"].toString();
                    effectIds.add (id);
                    track.effects.push_back ({ effects.get (id, plugin["id"].toString(), state.isEmpty() ? juce::File() : juce::File (state), item["name"].toString()),
                                              (bool) slot["enabled"],
                                              (float) number (slot["mix"], 1, 0, 1) });
                }
            if (const auto* gains = item["gains"].getArray(); gains != nullptr && gains->size() == 4)
                for (size_t g = 0; g < 4; ++g)
                    track.gains[g] = (float) number ((*gains)[(int) g], 0, -64, 64);
            if (const auto* sends = item["sends"].getArray())
                for (const auto& send : *sends)
                {
                    const auto to = (int) number (send["track"], -1, -1, 1e6);
                    // Only later tracks: a song that doesn't keep to it can't make a loop here.
                    if (to > (int) song->tracks.size() && to < list->size())
                    {
                        Track::Send made;
                        made.track = to;
                        made.gain = (float) number (send["gain"], 1, 0, 64);
                        track.sends.push_back (std::move (made));
                    }
                }
            song->tracks.push_back (std::move (track));
        }
    if (song->tracks.empty())
        song->tracks.push_back ({});
    song->tracks.back().sends.clear();
    const auto master = (int) song->tracks.size() - 1;
    if (const auto* list = json["channels"].getArray())
        for (size_t c = 0; c < song->channels.size() && c < (size_t) list->size(); ++c)
        {
            const auto track = (int) number ((*list)[(int) c]["track"], master, 0, master);
            song->channels[c].track = track;
        }

    // A buffer for each track something can reach: a channel plays into it, or a track that's reached
    // sends to it. (Senders come first, so one pass finds them all.)
    std::vector<bool> reached (song->tracks.size(), false);
    reached[(size_t) master] = true;
    for (const auto& channel : song->channels)
        reached[(size_t) channel.track] = true;
    int buffers = 0;
    for (size_t t = 0; t < song->tracks.size(); ++t)
        if (reached[t])
        {
            song->tracks[t].buffer = buffers++;
            for (const auto& send : song->tracks[t].sends)
                reached[(size_t) send.track] = true;
        }
    song->capacity = juce::jmax (0, capacity);
    // And one more pair: the selected tracks' sound added up, for the mixer's selection meter.
    song->selectionBuffer = buffers;
    song->audio.setSize (buffers * 2 + 2, song->capacity);
    for (auto& track : song->tracks)
        track.from = track.gains;
    song->compensate (sampleRate);

    juce::StringArray channelIds;
    for (const auto& channel : song->channels)
        channelIds.add (channel.id);
    plugins.keepOnly (channelIds);
    effects.keepOnly (effectIds);

    std::stable_sort (song->notes.begin(), song->notes.end(), [] (const Note& a, const Note& b) { return a.tick < b.tick; });
    return song;
}

void Song::compensate (double sampleRate)
{
    // When each track's input arrives, and when its output leaves, in samples late. A track's input is
    // its latest arrival (nothing yet: the lowest number); the others wait for it.
    constexpr int nothing = std::numeric_limits<int>::min();
    std::vector<int> arrival (tracks.size(), nothing), out (tracks.size(), 0);
    const auto instrumentDelay = [] (const Channel& channel) { return channel.plugin != nullptr ? channel.plugin->instance->getLatencySamples() : 0; };
    for (const auto& channel : channels)
        arrival[(size_t) channel.track] = juce::jmax (arrival[(size_t) channel.track], instrumentDelay (channel));

    for (size_t t = 0; t < tracks.size(); ++t)
    {
        const auto& track = tracks[t];
        if (track.buffer < 0)
            continue;
        if (arrival[t] == nothing)
            arrival[t] = 0;
        auto delay = (int) std::lround (track.latencyOffsetMs * sampleRate / 1000.0);
        for (const auto& effect : track.effects)
            if (effect.enabled && effect.plugin != nullptr)
                delay += effect.plugin->instance->getLatencySamples();
        out[t] = arrival[t] + delay;
        for (const auto& send : track.sends)
            arrival[(size_t) send.track] = juce::jmax (arrival[(size_t) send.track], out[t]);
    }

    for (auto& channel : channels)
        channel.delay = juce::jmax (0, arrival[(size_t) channel.track] - instrumentDelay (channel));
    for (size_t t = 0; t < tracks.size(); ++t)
        for (auto& send : tracks[t].sends)
            send.delay = tracks[t].buffer < 0 ? 0 : juce::jmax (0, arrival[(size_t) send.track] - out[t]);
    latency = juce::jmax (0, out.back());
}
