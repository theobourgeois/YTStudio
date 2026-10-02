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

void Song::Lane::valueAt (double tick, float* out)
{
    const auto count = ticks.size();
    if (count == 0)
    {
        for (int c = 0; c < size; ++c)
            out[c] = base[(size_t) c];
        return;
    }
    // The last point at or before `tick`: from where the last lookup was (they mostly go forwards), else searched.
    if (cursor >= count || ticks[cursor] > tick || (cursor + 1 < count && ticks[cursor + 1] <= tick && cursor + 2 < count && ticks[cursor + 2] <= tick))
        cursor = (size_t) juce::jmax (0, (int) (std::upper_bound (ticks.begin(), ticks.end(), tick) - ticks.begin()) - 1);
    while (cursor + 1 < count && ticks[cursor + 1] <= tick)
        ++cursor;
    const auto* from = values.data() + cursor * (size_t) size;
    if (cursor + 1 >= count || tick <= ticks[cursor])
    {
        for (int c = 0; c < size; ++c)
            out[c] = from[c];
        return;
    }
    const auto* to = from + size;
    const auto f = (float) ((tick - ticks[cursor]) / (ticks[cursor + 1] - ticks[cursor]));
    for (int c = 0; c < size; ++c)
        out[c] = from[c] + (to[c] - from[c]) * f;
}

int Song::channelIndex (const juce::String& id) const
{
    for (size_t i = 0; i < channels.size(); ++i)
        if (channels[i].id == id)
            return (int) i;
    return -1;
}

std::unique_ptr<Song> Song::parse (const juce::var& json, SampleCache& samples, PluginHost& plugins, PluginHost& effects, gross::Registry& grossBeats, tune::Registry& autoTunes, echo::Registry& echoBoys, eq::Registry& eqs, panman::Registry& panMen,
                                  wheel::Registry& pitchWheels, juce::StringArray& unreadable, int capacity, double sampleRate, bool keepOnly)
{
    auto song = std::make_unique<Song>();
    song->tempo = number (json["tempo"], 120, 1, 2000);
    song->ppq = number (json["ppq"], 96, 1, 100000);
    song->loopTicks = number (json["loopTicks"], song->ppq * 4, 1, 1e9);
    song->beatTicks = number (json["beatTicks"], song->ppq, 1, 1e9);
    song->barTicks = number (json["barTicks"], song->beatTicks * 4, 1, 1e9);
    song->offsetTicks = number (json["offsetTicks"], 0, 0, 1e9);
    song->resampling = resampling::parse (json["resampling"].toString(), Resampling::hermite);
    song->loops = ! json.hasProperty ("loops") || (bool) json["loops"];

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
                // An audio clip's file is streamed when it plays: here it only has to be there. With
                // precomputed effects it's prepared now, in memory, as a sampler's is.
                if (channel.stream)
                {
                    channel.path = path.toString();
                    if (! juce::File (channel.path).existsAsFile())
                        unreadable.add (channel.id);
                    // Played from notes too (as a sampler), or prepared by precomputed effects: in memory.
                    else if (! precomputed.changesNothing() || (bool) item["playsNotes"])
                    {
                        channel.sample = samples.get (channel.path, precomputed);
                        channel.prepared = precomputed.key();
                    }
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
            clip.sample = song->channels[(size_t) clip.channel].sample;
            clip.tick = number (item["tick"], 0, -1e9, 1e9);
            clip.length = number (item["length"], 0, 0, 1e9);
            clip.seconds = number (item["seconds"], 0, 0, 1e7);
            clip.speed = number (item["speed"], 1, 0.0625, 16);
            if (clip.path.isEmpty() || clip.length <= 0 || clip.tick >= song->loopTicks || clip.tick + clip.length <= 0)
                continue;
            clip.key = (juce::uint64) (song->channels[(size_t) clip.channel].id + "|" + clip.path + "|" + juce::String (clip.tick, 6) + "|" + juce::String (clip.length, 6) + "|"
                        + juce::String (clip.seconds, 9) + "|" + juce::String (clip.speed, 9) + "|" + juce::String (song->tempo, 6) + "|" + juce::String (song->ppq) + "|"
                        + song->channels[(size_t) clip.channel].prepared)
                                           .hashCode64();
            song->audioClips.push_back (std::move (clip));
        }
    std::stable_sort (song->audioClips.begin(), song->audioClips.end(), [] (const AudioClip& a, const AudioClip& b) { return a.tick < b.tick; });

    // The mixer's tracks. A song without them (or with none) has a master alone, as it was before.
    juce::StringArray effectIds, grossIds, tuneIds, echoIds, eqIds, panIds, wheelIds;
    if (const auto* list = json["tracks"].getArray())
        for (const auto& item : *list)
        {
            Track track;
            track.id = item["id"].toString();
            track.latencyOffsetMs = number (item["latencyOffset"], 0, -1000, 1000);
            if (const auto input = item["input"]; input.isObject())
            {
                if (const auto* channels = input["channels"].getArray())
                    for (const auto& channel : *channels)
                        if (track.input.size() < 2)
                            track.input.push_back ((int) number (channel, -1, -1, 1023));
                track.monitor = (bool) input["monitor"];
                track.armed = (bool) input["armed"];
            }
            if (const auto* slots = item["effects"].getArray())
                for (const auto& slot : *slots)
                {
                    const auto plugin = slot["plugin"];
                    const auto id = slot["id"].toString();
                    if (! plugin.isObject() || id.isEmpty())
                        continue;
                    // Gross Beat is ours: run by the engine, not hosted. Its buffer holds as far back as its
                    // envelopes reach at this tempo, and the attack compensation's half second more.
                    if (plugin["id"].toString() == "vaudio:gross-beat")
                    {
                        Track::Effect effect { id, nullptr, (bool) slot["enabled"], (float) number (slot["mix"], 1, 0, 1) };
                        effect.grossSettings = gross::Settings::parse (slot["grossBeat"], capacity);
                        effect.gross = grossBeats.get (id, sampleRate, effect.grossSettings->depth * 60.0 / song->tempo + 0.6);
                        grossIds.add (id);
                        track.effects.push_back (std::move (effect));
                        continue;
                    }
                    // Auto-Tune is ours too. Its sound is made for the voice's lowest pitch (its latency follows).
                    if (plugin["id"].toString() == "vaudio:auto-tune")
                    {
                        Track::Effect effect { id, nullptr, (bool) slot["enabled"], (float) number (slot["mix"], 1, 0, 1) };
                        effect.tuneSettings = tune::Settings::parse (slot["autoTune"]);
                        effect.tune = autoTunes.get (id, sampleRate, effect.tuneSettings->minHz, capacity);
                        tuneIds.add (id);
                        track.effects.push_back (std::move (effect));
                        continue;
                    }
                    // Pitch Wheel is ours too: its wheels and voices carry on through edits (its window, its latency, follow the resolution).
                    if (plugin["id"].toString() == "vaudio:pitch-wheel")
                    {
                        Track::Effect effect { id, nullptr, (bool) slot["enabled"], (float) number (slot["mix"], 1, 0, 1) };
                        effect.wheelSettings = wheel::Settings::parse (slot["pitchWheel"]);
                        effect.wheel = pitchWheels.get (id, sampleRate, effect.wheelSettings->window, capacity);
                        // The channel whose notes play it (the song's own channels, parsed first).
                        if (const auto channel = song->channelIndex (effect.wheelSettings->notesFrom); channel >= 0 && effect.wheelSettings->notesFrom.isNotEmpty())
                            song->wheelListeners.push_back ({ channel, effect.wheel.get() });
                        wheelIds.add (id);
                        track.effects.push_back (std::move (effect));
                        continue;
                    }
                    // EchoBoy is ours too: its lines are kept across songs, so a knob turned doesn't cut its echoes off.
                    if (plugin["id"].toString() == "vaudio:echo-boy")
                    {
                        Track::Effect effect { id, nullptr, (bool) slot["enabled"], (float) number (slot["mix"], 1, 0, 1) };
                        effect.echoSettings = echo::Settings::parse (slot["echoBoy"], capacity);
                        effect.echo = echoBoys.get (id, sampleRate);
                        echoIds.add (id);
                        track.effects.push_back (std::move (effect));
                        continue;
                    }
                    // Pro-Q is ours as well: its filters' memories are kept across songs, its kernels made here.
                    if (plugin["id"].toString() == "vaudio:pro-q")
                    {
                        Track::Effect effect { id, nullptr, (bool) slot["enabled"], (float) number (slot["mix"], 1, 0, 1) };
                        effect.eq = eqs.get (id, sampleRate);
                        effect.eqSettings = eq::Settings::parse (slot["eq"], capacity, *effect.eq);
                        eqIds.add (id);
                        track.effects.push_back (std::move (effect));
                        continue;
                    }
                    if (plugin["id"].toString() == "vaudio:panman")
                    {
                        Track::Effect effect { id, nullptr, (bool) slot["enabled"], (float) number (slot["mix"], 1, 0, 1) };
                        effect.panSettings = panman::Settings::parse (slot["panMan"], capacity);
                        effect.pan = panMen.get (id, sampleRate);
                        panIds.add (id);
                        track.effects.push_back (std::move (effect));
                        continue;
                    }
                    const auto state = plugin["state"].toString();
                    effectIds.add (id);
                    track.effects.push_back ({ id,
                                              effects.get (id, plugin["id"].toString(), state.isEmpty() ? juce::File() : juce::File (state), item["name"].toString()),
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
    // And each track whose input is heard.
    for (size_t t = 0; t < song->tracks.size(); ++t)
        if (song->tracks[t].monitor && ! song->tracks[t].input.empty())
            reached[t] = true;
    int buffers = 0;
    for (size_t t = 0; t < song->tracks.size(); ++t)
        if (reached[t])
        {
            song->tracks[t].buffer = buffers++;
            for (const auto& send : song->tracks[t].sends)
                reached[(size_t) send.track] = true;
        }
    // Each reached track a stage after the latest of those sending to it.
    {
        std::vector<int> stage (song->tracks.size(), 0);
        for (size_t t = 0; t < song->tracks.size(); ++t)
            if (song->tracks[t].buffer >= 0)
            {
                for (const auto& send : song->tracks[t].sends)
                    stage[(size_t) send.track] = juce::jmax (stage[(size_t) send.track], stage[t] + 1);
                if ((int) song->stages.size() <= stage[t])
                    song->stages.resize ((size_t) stage[t] + 1);
                song->stages[(size_t) stage[t]].push_back ((int) t);
            }
    }
    song->capacity = juce::jmax (0, capacity);
    song->playingPlugins.reserve (song->channels.size());
    // And one more pair: the selected tracks' sound added up, for the mixer's selection meter.
    song->selectionBuffer = buffers;
    song->audio.setSize (buffers * 2 + 2, song->capacity);
    for (auto& track : song->tracks)
        track.from = track.gains;
    song->compensate (sampleRate);
    parseLanes (*song, json["lanes"]);

    juce::StringArray channelIds;
    for (const auto& channel : song->channels)
        channelIds.add (channel.id);
    if (keepOnly)
    {
        plugins.keepOnly (channelIds);
        effects.keepOnly (effectIds);
        grossBeats.keepOnly (grossIds);
        autoTunes.keepOnly (tuneIds);
        pitchWheels.keepOnly (wheelIds);
        echoBoys.keepOnly (echoIds);
        eqs.keepOnly (eqIds);
        panMen.keepOnly (panIds);
    }

    std::stable_sort (song->notes.begin(), song->notes.end(), [] (const Note& a, const Note& b) { return a.tick < b.tick; });
    return song;
}

void Song::parseLanes (Song& song, const juce::var& json)
{
    const auto* list = json.getArray();
    if (list == nullptr)
        return;
    for (const auto& item : *list)
    {
        const auto target = item["target"];
        const auto kind = target["kind"].toString();
        Lane lane;
        if (kind == "channel")
        {
            lane.kind = Lane::Kind::channel;
            lane.channel = (int) number (target["channel"], -1, -1, 1e6);
            if (lane.channel < 0 || lane.channel >= (int) song.channels.size())
                continue;
            lane.size = 2;
            const auto& channel = song.channels[(size_t) lane.channel];
            lane.base = { channel.gainLeft, channel.gainRight, 0, 0 };
        }
        else if (kind == "track" || kind == "send" || kind == "mix")
        {
            lane.track = (int) number (target["track"], -1, -1, 1e6);
            if (lane.track < 0 || lane.track >= (int) song.tracks.size())
                continue;
            const auto& track = song.tracks[(size_t) lane.track];
            if (kind == "track")
            {
                lane.kind = Lane::Kind::track;
                lane.size = 4;
                lane.base = track.gains;
            }
            else if (kind == "send")
            {
                lane.kind = Lane::Kind::send;
                lane.index = (int) number (target["send"], -1, -1, 1e6);
                if (lane.index < 0 || lane.index >= (int) track.sends.size())
                    continue;
                lane.base[0] = track.sends[(size_t) lane.index].gain;
            }
            else
            {
                lane.kind = Lane::Kind::mix;
                lane.index = (int) number (target["effect"], -1, -1, 1e6);
                if (lane.index < 0 || lane.index >= (int) track.effects.size())
                    continue;
                lane.base[0] = track.effects[(size_t) lane.index].mix;
            }
        }
        else if (kind == "gross")
        {
            // A Gross Beat's slot (by number) or mix.
            lane.kind = Lane::Kind::gross;
            lane.track = (int) number (target["track"], -1, -1, 1e6);
            if (lane.track < 0 || lane.track >= (int) song.tracks.size())
                continue;
            const auto& track = song.tracks[(size_t) lane.track];
            lane.index = (int) number (target["effect"], -1, -1, 1e6);
            if (lane.index < 0 || lane.index >= (int) track.effects.size() || track.effects[(size_t) lane.index].grossSettings == nullptr)
                continue;
            const auto control = juce::StringArray { "timeSlot", "volumeSlot", "timeMix", "volumeMix" }.indexOf (target["control"].toString());
            if (control < 0)
                continue;
            lane.control = control;
            const auto& settings = *track.effects[(size_t) lane.index].grossSettings;
            lane.base[0] = control == 0 ? (float) settings.timeSlot : control == 1 ? (float) settings.volumeSlot : control == 2 ? settings.timeMix : settings.volumeMix;
        }
        else if (kind == "tune")
        {
            // An Auto-Tune's control, in its own units (`AutoTuneControl`).
            lane.kind = Lane::Kind::tune;
            lane.track = (int) number (target["track"], -1, -1, 1e6);
            if (lane.track < 0 || lane.track >= (int) song.tracks.size())
                continue;
            const auto& track = song.tracks[(size_t) lane.track];
            lane.index = (int) number (target["effect"], -1, -1, 1e6);
            if (lane.index < 0 || lane.index >= (int) track.effects.size() || track.effects[(size_t) lane.index].tuneSettings == nullptr)
                continue;
            const auto control = juce::StringArray { "retuneSpeed", "humanize", "flexTune", "naturalVibrato", "transpose", "throat", "key" }.indexOf (target["control"].toString());
            if (control < 0)
                continue;
            lane.control = control;
            const auto& s = *track.effects[(size_t) lane.index].tuneSettings;
            const double base[] = { s.retune, s.humanize, s.flexTune, s.vibratoGain, s.transpose, s.throat, (double) s.key };
            lane.base[0] = (float) base[control];
        }
        else if (kind == "wheel")
        {
            // A Pitch Wheel's control, in its own units (`PitchWheelControl`: the wheels snapped, the knobs 0..1).
            lane.kind = Lane::Kind::wheel;
            lane.track = (int) number (target["track"], -1, -1, 1e6);
            if (lane.track < 0 || lane.track >= (int) song.tracks.size())
                continue;
            const auto& track = song.tracks[(size_t) lane.track];
            lane.index = (int) number (target["effect"], -1, -1, 1e6);
            if (lane.index < 0 || lane.index >= (int) track.effects.size() || track.effects[(size_t) lane.index].wheelSettings == nullptr)
                continue;
            const auto control = juce::StringArray { "pitch", "timbre", "pitchGravity", "pitchInertia", "pitchSmooth", "timbreGravity", "timbreInertia", "timbreSmooth" }.indexOf (target["control"].toString());
            if (control < 0)
                continue;
            lane.control = control;
            const auto& s = *track.effects[(size_t) lane.index].wheelSettings;
            const double base[] = { s.pitch.target, s.timbre.target, s.pitch.gravity, s.pitch.inertia, s.pitch.smooth, s.timbre.gravity, s.timbre.inertia, s.timbre.smooth };
            lane.base[0] = (float) base[control];
        }
        else if (kind == "echo")
        {
            // An EchoBoy's lane (`EchoLane`), as many values as it moves (the delays: one a line).
            lane.kind = Lane::Kind::echo;
            lane.track = (int) number (target["track"], -1, -1, 1e6);
            if (lane.track < 0 || lane.track >= (int) song.tracks.size())
                continue;
            const auto& track = song.tracks[(size_t) lane.track];
            lane.index = (int) number (target["effect"], -1, -1, 1e6);
            if (lane.index < 0 || lane.index >= (int) track.effects.size() || track.effects[(size_t) lane.index].echoSettings == nullptr)
                continue;
            const auto control = juce::StringArray { "mix", "feedback", "delays", "lowCut", "highCut", "saturation", "input", "output", "feel", "side" }.indexOf (target["control"].toString());
            if (control < 0)
                continue;
            lane.control = control;
            track.effects[(size_t) lane.index].echoSettings->get ((echo::Control) control, lane.base.data(), lane.size);
        }
        else if (kind == "eq")
        {
            // A Pro-Q band's frequency (log2 Hz), gain or range (dB), Q (log2), or its output (dB).
            lane.kind = Lane::Kind::eq;
            lane.track = (int) number (target["track"], -1, -1, 1e6);
            if (lane.track < 0 || lane.track >= (int) song.tracks.size())
                continue;
            const auto& track = song.tracks[(size_t) lane.track];
            lane.index = (int) number (target["effect"], -1, -1, 1e6);
            if (lane.index < 0 || lane.index >= (int) track.effects.size() || track.effects[(size_t) lane.index].eqSettings == nullptr)
                continue;
            lane.control = juce::StringArray { "frequency", "gain", "q", "range", "output" }.indexOf (target["control"].toString());
            lane.band = (int) number (target["band"], 0, 0, eq::maxBands);
            auto& settings = *track.effects[(size_t) lane.index].eqSettings;
            const auto* band = settings.find (lane.band);
            if (lane.control < 0 || (lane.control < 4 && band == nullptr))
                continue;
            lane.base[0] = (float) (lane.control == 4 ? settings.output
                                    : lane.control == 0 ? std::log2 (band->shape.frequency)
                                    : lane.control == 1 ? band->shape.gain
                                    : lane.control == 2 ? std::log2 (band->shape.q)
                                                        : band->range);
        }
        else if (kind == "panman")
        {
            // A PanMan's offset, width, rate, input or output, in its own units.
            lane.kind = Lane::Kind::panman;
            lane.track = (int) number (target["track"], -1, -1, 1e6);
            if (lane.track < 0 || lane.track >= (int) song.tracks.size())
                continue;
            const auto& track = song.tracks[(size_t) lane.track];
            lane.index = (int) number (target["effect"], -1, -1, 1e6);
            if (lane.index < 0 || lane.index >= (int) track.effects.size() || track.effects[(size_t) lane.index].panSettings == nullptr)
                continue;
            const auto control = juce::StringArray { "offset", "width", "rate", "input", "output" }.indexOf (target["control"].toString());
            if (control < 0)
                continue;
            lane.control = control;
            const auto& settings = *track.effects[(size_t) lane.index].panSettings;
            // The offset and width come as fractions of 105° and 210° (`PAN_LANE_SCALE`).
            const double own[] = { settings.offset / 105.0, settings.width / 210.0, settings.rate, settings.input, settings.output };
            lane.base[0] = (float) own[control];
        }
        else if (kind == "param")
        {
            lane.kind = Lane::Kind::param;
            const auto owner = target["owner"].toString();
            const auto id = target["id"].toString();
            if (owner == "channel")
            {
                for (const auto& channel : song.channels)
                    if (channel.id == id)
                        lane.plugin = channel.plugin;
            }
            else
                for (const auto& track : song.tracks)
                    for (const auto& effect : track.effects)
                        if (effect.id == id)
                            lane.plugin = effect.plugin;
            // Not loaded yet: the song is made again once it is.
            if (lane.plugin == nullptr)
                continue;
            const auto param = target["param"].toString();
            lane.parameter = findParameter (*lane.plugin->instance, param, (int) number (target["index"], -1, -1, 1e6), lane.parameterIndex);
            if (lane.parameter == nullptr)
                continue;
            lane.key = owner + ":" + id + ":" + param;
            lane.base[0] = -1;
        }
        else
            continue;

        const auto* ticks = item["ticks"].getArray();
        const auto* values = item["values"].getArray();
        if (ticks == nullptr || values == nullptr || ticks->isEmpty() || values->size() != ticks->size() * lane.size)
            continue;
        lane.ticks.reserve ((size_t) ticks->size());
        lane.values.reserve ((size_t) values->size());
        auto last = 0.0;
        for (const auto& tick : *ticks)
            lane.ticks.push_back (last = juce::jmax (last, number (tick, last, 0, 1e9)));
        // (An EchoBoy's cuts are in Hz.)
        const auto most = lane.kind == Lane::Kind::echo ? 1e5 : 64.0;
        for (const auto& value : *values)
            lane.values.push_back ((float) number (value, 0, -most, most));
        song.lanes.push_back (std::move (lane));
    }
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
            else if (effect.enabled && effect.tune != nullptr)
                delay += effect.tune->latency();
            else if (effect.enabled && effect.eqSettings != nullptr)
                delay += effect.eqSettings->latency;
            else if (effect.enabled && effect.wheel != nullptr)
                delay += effect.wheel->latency();
        out[t] = arrival[t] + delay;
        tracks[t].latency = out[t];
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
