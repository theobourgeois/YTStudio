#include "Sequencer.h"

#include <cmath>
#include <map>

namespace
{
/** How long a voice takes to fade when it's silenced, so stopping doesn't click. */
constexpr double fadeSeconds = 0.004;
/** How long a channel's plugin sounds when it's heard on its own (a click on its button). */
constexpr double auditionSeconds = 0.4;
/** The longest a held key sounds if it's never let go (the tab went away mid-press). */
constexpr double heldSeconds = 30.0;
/**
 * Ticks (a fraction of a millionth of a sample's worth): a note that falls exactly on the edge of a
 * block must land in one block or the other, not in whichever the rounding of the position picks.
 */
constexpr double tickSlack = 1e-6;
}

Sequencer::Sequencer (bool offline) : clips (offline), recording (offline) {}

Sequencer::~Sequencer()
{
    delete song;
    delete pending.exchange (nullptr);
    collectGarbage();
}

void Sequencer::prepare (double rate)
{
    sampleRate = rate > 0 ? rate : 48000.0;
    clips.prepare (sampleRate);
}

// Message thread -------------------------------------------------------------

void Sequencer::setSong (std::unique_ptr<Song> next)
{
    channelIds.clear();
    for (const auto& channel : next->channels)
        channelIds.add (channel.id);

    // Which of the last song's tracks and sends each of this one's was, so a fader that moved glides
    // there (the audio thread only copies by these indexes).
    next->serial = ++serials;
    next->previousSerial = next->serial - 1;
    juce::StringArray ids;
    std::vector<juce::StringArray> sends;
    for (auto& track : next->tracks)
    {
        track.previous = trackIds.indexOf (track.id);
        juce::StringArray to;
        for (auto& send : track.sends)
        {
            const auto& target = next->tracks[(size_t) send.track].id;
            send.previous = track.previous >= 0 ? sendIds[(size_t) track.previous].indexOf (target) : -1;
            to.add (target);
        }
        ids.add (track.id);
        sends.push_back (std::move (to));
    }
    trackIds = std::move (ids);
    sendIds = std::move (sends);
    markMetered (trackIds, next->serial);

    // Delay compensation's delay lines: the last song's, where a path waits as long as it did (so what's
    // in them carries on), or new ones.
    std::map<juce::String, std::shared_ptr<DelayLine>> lines;
    const auto lineFor = [&] (const juce::String& key, int length) -> std::shared_ptr<DelayLine> {
        if (length <= 0)
            return nullptr;
        auto line = delayLines[key];
        if (line == nullptr || line->length() != length || line->capacity() != next->capacity)
            line = std::make_shared<DelayLine> (length, next->capacity);
        return lines[key] = line;
    };
    for (auto& channel : next->channels)
        channel.delayLine = lineFor ("c" + channel.id, channel.delay);
    for (auto& track : next->tracks)
        for (auto& send : track.sends)
            send.delayLine = lineFor ("s" + track.id + ">" + next->tracks[(size_t) send.track].id, send.delay);
    delayLines = std::move (lines);

    // Its audio clips, to look ahead for while it plays.
    clips.setSong (*next);
    loopTicks = juce::jmax (1.0, next->loopTicks);

    // One still waiting was never played: it's ours to delete.
    delete pending.exchange (next.release());
}

juce::uint32 Sequencer::nextGeneration()
{
    const auto next = ++generations;
    requestedGeneration = next;
    return next;
}

void Sequencer::play (double fromTick)
{
    const auto from = juce::jmax (0.0, fromTick);
    const auto next = nextGeneration();
    // The clips where play starts are decoded before it does, so they sound from its first block.
    clips.prepare (std::fmod (from, loopTicks), next, 0, 0.0);
    playFrom = from;
    playCountIn = 0.0;
    playRecords = false;
    playThrough = false;
    ++playRequests;
}

void Sequencer::record (double fromTick, double countInTicks, bool loop)
{
    const auto from = juce::jmax (0.0, fromTick);
    const auto next = nextGeneration();
    clips.prepare (std::fmod (from, loopTicks), next, 0, 0.0);
    playFrom = from;
    playCountIn = juce::jmax (0.0, countInTicks);
    playRecords = true;
    playThrough = ! loop;
    ++playRequests;
}

void Sequencer::prepareClips()
{
    // Only once the audio thread has the play the message thread last asked for.
    if (playingNow.load() && generationNow.load() == generations)
        clips.prepare (positionNow.load(), generations, passNow.load(), 0.06);
}

bool Sequencer::preview (const juce::String& channelId, int key, float velocity, bool on)
{
    const auto channel = channelIds.indexOf (channelId);
    if (channel < 0)
        return false;
    const auto scope = triggerQueue.write (1);
    if (scope.blockSize1 > 0)
        triggers[(size_t) scope.startIndex1] = { channel, (float) (key - 60), velocity * velocity / (0.78f * 0.78f), on ? Trigger::Kind::hold : Trigger::Kind::release, key, velocity };
    return true;
}
void Sequencer::stop()
{
    nextGeneration();
    ++stopRequests;
}

bool Sequencer::trigger (const juce::String& channelId, float pitch, float gain)
{
    const auto channel = channelIds.indexOf (channelId);
    if (channel < 0)
        return false;
    const auto scope = triggerQueue.write (1);
    if (scope.blockSize1 > 0)
        triggers[(size_t) scope.startIndex1] = { channel, pitch, gain };
    return true;
}

juce::var Sequencer::takeMeters (float floor)
{
    auto* result = new juce::DynamicObject();
    // Only when the audio thread is measuring the song last handed over: the tracks' ids are its.
    if (meterSerial.load() == serials)
        for (int t = 0; t < trackIds.size() && t < maxMeters; ++t)
        {
            const auto left = meters[(size_t) t * 2].exchange (0.0f), right = meters[(size_t) t * 2 + 1].exchange (0.0f);
            if (left >= floor || right >= floor)
                result->setProperty (trackIds[t], juce::Array<juce::var> { left, right });
        }
    const auto left = selectionMeter[0].exchange (0.0f), right = selectionMeter[1].exchange (0.0f);
    if (left >= floor || right >= floor)
        result->setProperty ("@selection", juce::Array<juce::var> { left, right });
    return juce::var (result);
}

void Sequencer::setMeteredTracks (const juce::StringArray& ids)
{
    meteredIds = ids;
    markMetered (trackIds, serials);
}

void Sequencer::markMetered (const juce::StringArray& ids, juce::uint64 serial)
{
    // Off first, so the audio thread never adds up tracks of one song by another's indexes.
    selectionSerial = 0;
    for (int t = 0; t < maxMeters; ++t)
        metered[(size_t) t].store (t < ids.size() && meteredIds.contains (ids[t]), std::memory_order_relaxed);
    selectionSerial = serial;
}

void Sequencer::collectGarbage()
{
    clips.collectGarbage();
    const auto scope = garbageQueue.read (garbageQueue.getNumReady());
    for (int i = 0; i < scope.blockSize1; ++i)
        delete garbage[(size_t) (scope.startIndex1 + i)];
    for (int i = 0; i < scope.blockSize2; ++i)
        delete garbage[(size_t) (scope.startIndex2 + i)];
}

// Audio thread ---------------------------------------------------------------

void Sequencer::adopt (Song* next)
{
    // Voices follow their channel to its new place in the rack, or end with it. They also end if its
    // sample isn't the one they're playing any more: the old one goes when the old song does.
    for (auto& voice : voices)
    {
        if (! voice.active)
            continue;
        const auto channel = song != nullptr ? next->channelIndex (song->channels[(size_t) voice.channel].id) : -1;
        if (channel < 0 || next->channels[(size_t) channel].sample.get() != voice.sample)
            voice.active = false;
        else
            voice.channel = channel;
    }
    // (Playing on past the loop's end, recording, it stays where it is.)
    if (position_ >= next->loopTicks && ! through)
        position_ = std::fmod (position_, next->loopTicks);

    // Each track (and send) starts where the last song left it, and its first block glides to where
    // it's going. A new one starts as it is; a new send fades in.
    if (song != nullptr && next->previousSerial == song->serial)
        for (auto& track : next->tracks)
        {
            if (track.previous < 0)
                continue;
            const auto& before = song->tracks[(size_t) track.previous];
            track.from = before.gains;
            for (auto& send : track.sends)
                send.from = send.previous >= 0 ? before.sends[(size_t) send.previous].gain : 0.0f;
        }
    else
        for (auto& track : next->tracks)
            for (auto& send : track.sends)
                send.from = send.gain;
    ramping = true;

    clips.adopt (*next);

    if (song != nullptr)
    {
        const auto scope = garbageQueue.write (1);
        if (scope.blockSize1 > 0)
            garbage[(size_t) scope.startIndex1] = song;
        // A full queue would mean deleting here, on the audio thread; it holds far more than ever wait.
        else
            delete song;
    }
    song = next;
}

void Sequencer::silenceVoices()
{
    const auto fade = juce::jmax (1, (int) (fadeSeconds * sampleRate));
    for (auto& voice : voices)
        if (voice.active && voice.fade < 0)
        {
            voice.fade = fade;
            voice.fadeWait = 0;
        }
    click.level = 0;
    click.delay = -1;
    silencing = true;
}

void Sequencer::process (float* left, float* right, int numSamples, const float* const* inputs, int numInputs)
{
    if (auto* next = pending.exchange (nullptr))
        adopt (next);

    if (const auto stops = stopRequests.load(); stops != stopsSeen)
    {
        stopsSeen = stops;
        playing = false;
        position_ = 0;
        silenceVoices();
        generation = requestedGeneration.load();
        clips.stopAll();
        // A recording's files are done.
        recording.end();
        countInLeft = 0;
        recordWaiting = through = false;
    }
    if (const auto plays = playRequests.load(); plays != playsSeen)
    {
        playsSeen = plays;
        // Played while playing (the ruler clicked): it goes there, the notes sounding cut short; a
        // recording in progress ends there.
        if (playing)
            silenceVoices();
        recording.end();
        playing = true;
        position_ = song != nullptr ? std::fmod (playFrom.load(), song->loopTicks) : 0;
        generation = requestedGeneration.load();
        pass = 0;
        clips.setGeneration (generation);
        through = playThrough.load();
        recordWaiting = playRecords.load();
        countInDone = 0;
        countInLeft = song != nullptr ? (juce::int64) std::llround (playCountIn.load() * 60.0 * sampleRate / (song->tempo * song->ppq)) : 0;
    }

    if (song != nullptr)
    {
        // Each plugin's notes for this block: the ends of the ones sounding first, then the new ones.
        for (auto& channel : song->channels)
            if (channel.plugin != nullptr)
            {
                channel.plugin->midi.clear();
                if (silencing)
                    continue;
                endNotes (*channel.plugin, numSamples);
            }
        if (silencing)
            silencePlugins();
        silencing = false;

        const auto scope = triggerQueue.read (triggerQueue.getNumReady());
        for (int i = 0; i < scope.blockSize1 + scope.blockSize2; ++i)
        {
            const auto& trigger = triggers[(size_t) (i < scope.blockSize1 ? scope.startIndex1 + i : scope.startIndex2 + i - scope.blockSize1)];
            if (trigger.channel < 0 || trigger.channel >= (int) song->channels.size())
                continue;
            auto* plugin = song->channels[(size_t) trigger.channel].plugin.get();
            if (trigger.kind == Trigger::Kind::release)
            {
                // Let the key go: its note ends in this block. (A sampler's note plays itself out.)
                if (plugin != nullptr)
                    for (int n = 0; n < plugin->numPending; ++n)
                        if (plugin->pending[(size_t) n].key == trigger.key)
                            plugin->pending[(size_t) n].left = 0;
            }
            else if (plugin != nullptr)
            {
                const auto held = trigger.kind == Trigger::Kind::hold;
                startNote (*plugin, held ? trigger.key : juce::jlimit (0, 127, 60 + (int) std::round (trigger.pitch)), held ? trigger.velocity : 0.78f,
                           (juce::int64) ((held ? heldSeconds : auditionSeconds) * sampleRate), 0);
            }
            else
                startVoice (trigger.channel, trigger.pitch, trigger.gain, -1, 0);
        }

        clips.receive (*song);
        if (playing)
        {
            // The count-in's clicks first (the transport holds); the recording begins as it moves.
            const auto counting = countInLeft > 0;
            const auto start = countIn (numSamples);
            if (recordWaiting && countInLeft == 0)
            {
                recordWaiting = false;
                recording.begin (start, position_);
            }
            // Clips already under the playhead start in the block after the count-in ends (in time: they skip what they missed).
            if (! counting)
                clips.startLate (position_, pass, song->loopTicks, song->tempo * song->ppq / (60.0 * sampleRate));
            if (start < numSamples)
                schedule (start, numSamples);
        }
        // A block longer than the song's buffers (the device just changed): silence until the engine
        // gives it the song again with longer ones.
        if (numSamples <= song->capacity)
        {
            for (const auto& track : song->tracks)
                if (track.buffer >= 0)
                {
                    juce::FloatVectorOperations::clear (song->audio.getWritePointer (track.buffer * 2), numSamples);
                    juce::FloatVectorOperations::clear (song->audio.getWritePointer (track.buffer * 2 + 1), numSamples);
                }
            for (auto& channel : song->channels)
                if (channel.delayLine != nullptr)
                    channel.delayLine->clearInput (numSamples);
            // The inputs heard (monitored): into their tracks before the effects, as they come (no delay
            // compensation: it's live). A mono input on both sides.
            if (inputs != nullptr)
                for (const auto& track : song->tracks)
                    if (track.monitor && track.buffer >= 0 && ! track.input.empty())
                    {
                        const auto source = [&] (size_t side) {
                            const auto channel = track.input[juce::jmin (side, track.input.size() - 1)];
                            return channel >= 0 && channel < numInputs ? inputs[channel] : nullptr;
                        };
                        if (const auto* in = source (0))
                            juce::FloatVectorOperations::add (song->audio.getWritePointer (track.buffer * 2), in, numSamples);
                        if (const auto* in = source (1))
                            juce::FloatVectorOperations::add (song->audio.getWritePointer (track.buffer * 2 + 1), in, numSamples);
                    }
            for (auto& voice : voices)
                if (voice.active)
                    render (voice, numSamples);
            renderPlugins (numSamples);
            clips.render (*song, numSamples, [this] (int channel) { return trackAudio (channel); });
            // Channels that wait for their track's later inputs come out of their delay lines into it.
            for (auto& channel : song->channels)
                if (channel.delayLine != nullptr)
                    if (const auto buffer = song->tracks[(size_t) channel.track].buffer; buffer >= 0)
                        channel.delayLine->flushInto (song->audio.getWritePointer (buffer * 2), song->audio.getWritePointer (buffer * 2 + 1), numSamples);
            mixTracks (left, right, numSamples);
        }
    }
    renderClick (left, right, numSamples);
    recording.write (inputs, inputs != nullptr ? numInputs : 0, numSamples);

    playingNow = playing;
    positionNow = position_;
    generationNow = generation;
    passNow = pass;
}

int Sequencer::countIn (int numSamples)
{
    if (countInLeft <= 0)
        return 0;
    const auto samplesPerTick = 60.0 * sampleRate / (song->tempo * song->ppq);
    const auto length = juce::jmin ((juce::int64) numSamples, countInLeft);
    // A click on each of its beats, higher on its bars, counted from its start; heard whether the
    // metronome is on or not.
    for (auto beat = std::ceil ((double) countInDone / samplesPerTick / song->beatTicks - tickSlack);; ++beat)
    {
        const auto tick = beat * song->beatTicks;
        const auto at = (juce::int64) std::llround (tick * samplesPerTick) - countInDone;
        if (at >= length)
            break;
        if (at >= 0)
        {
            click.delay = (int) at;
            click.bar = std::fmod (tick, song->barTicks) < 0.5;
        }
    }
    countInDone += length;
    countInLeft -= length;
    return (int) length;
}

void Sequencer::schedule (int start, int numSamples)
{
    const auto ticksPerSample = song->tempo * song->ppq / (60.0 * sampleRate);
    const auto loop = song->loopTicks;
    if (! song->loops || through)
    {
        // Once through (an export, or a recording without Loop record): what starts before the end
        // plays, then nothing more does, and the playhead goes on.
        const auto to = position_ + (numSamples - start) * ticksPerSample;
        if (position_ < loop)
            scheduleRange (position_, juce::jmin (to, loop), position_, start, numSamples - start, ticksPerSample);
        position_ = to;
        return;
    }
    for (int offset = start; offset < numSamples;)
    {
        // Up to the loop's end, then again from its start.
        const auto untilEnd = juce::jmax (1, (int) std::ceil ((loop - position_) / ticksPerSample));
        const auto length = juce::jmin (numSamples - offset, untilEnd);
        const auto from = position_;
        auto to = from + length * ticksPerSample;
        scheduleRange (from, juce::jmin (to, loop), from, offset, length, ticksPerSample);
        if (to >= loop)
        {
            to -= loop;
            // Round again: a new pass, whose clips' streams start now, and a recording's next takes (on
            // the sample the loop's first notes play on).
            ++pass;
            recording.wrap (offset + juce::jlimit (0, length, (int) std::floor ((loop - from + tickSlack) / ticksPerSample)));
            scheduleRange (0, to, from - loop, offset, length, ticksPerSample);
        }
        position_ = to;
        offset += length;
    }
}

void Sequencer::scheduleRange (double from, double to, double origin, int offset, int length, double ticksPerSample)
{
    const auto at = [&] (double tick) {
        return offset + juce::jlimit (0, length - 1, (int) std::floor ((tick - origin + tickSlack) / ticksPerSample));
    };
    clips.schedule (from, to, origin, pass, offset, length, ticksPerSample);
    from -= tickSlack;
    to -= tickSlack;

    auto note = std::lower_bound (song->notes.begin(), song->notes.end(), from, [] (const Song::Note& n, double tick) { return n.tick < tick; });
    for (; note != song->notes.end() && note->tick < to; ++note)
    {
        const auto& channel = song->channels[(size_t) note->channel];
        if (! channel.isPlugin)
            startVoice (note->channel, note->pitch, note->gain, note->length, at (note->tick), note->pan);
        else if (channel.plugin != nullptr)
            startNote (*channel.plugin, note->key, note->velocity, (juce::int64) (note->length / ticksPerSample), at (note->tick));
    }

    if (metronome)
        for (auto beat = std::ceil (from / song->beatTicks) * song->beatTicks; beat < to; beat += song->beatTicks)
        {
            click.delay = at (beat);
            click.bar = std::fmod (beat, song->barTicks) < 0.5;
        }
}

void Sequencer::startVoice (int channelIndex, float pitch, float gain, double lengthTicks, int delay, float pan)
{
    if (channelIndex < 0 || channelIndex >= (int) song->channels.size())
        return;
    const auto& channel = song->channels[(size_t) channelIndex];
    if (channel.sample == nullptr || channel.sample->audio.getNumSamples() == 0)
        return;

    if (channel.cutSelf)
        for (auto& sounding : voices)
            if (sounding.active && sounding.channel == channelIndex && sounding.fade < 0)
            {
                sounding.fade = juce::jmax (1, (int) (fadeSeconds * sampleRate));
                sounding.fadeWait = delay;
            }

    // A free voice, or the one that's been sounding longest.
    auto* voice = &voices[0];
    for (auto& candidate : voices)
    {
        if (! candidate.active)
        {
            voice = &candidate;
            break;
        }
        if (candidate.age < voice->age)
            voice = &candidate;
    }

    *voice = Voice();
    voice->active = true;
    voice->sample = channel.sample.get();
    voice->channel = channelIndex;
    voice->baseRate = channel.sample->sampleRate / sampleRate;
    voice->pitch = pitch;
    voice->gain = gain;
    voice->panLeft = juce::jmin (1.0f, 1.0f - pan);
    voice->panRight = juce::jmin (1.0f, 1.0f + pan);
    voice->delay = delay;
    voice->age = ++voiceCount;
    voice->level = channel.hasEnvelope && channel.envelope.attack > 0 ? 0.0f : 1.0f;
    if (lengthTicks >= 0)
        voice->untilRelease = (juce::int64) (lengthTicks * 60.0 * sampleRate / (song->tempo * song->ppq));
}

std::pair<float*, float*> Sequencer::trackAudio (int channel)
{
    if (auto* line = song->channels[(size_t) channel].delayLine.get())
        return { line->inputLeft(), line->inputRight() };
    const auto buffer = song->tracks[(size_t) song->channels[(size_t) channel].track].buffer;
    if (buffer < 0)
        return { nullptr, nullptr };
    return { song->audio.getWritePointer (buffer * 2), song->audio.getWritePointer (buffer * 2 + 1) };
}

void Sequencer::mixTracks (float* left, float* right, int numSamples)
{
    const auto glide = ramping;
    ramping = false;
    const auto master = song->tracks.size() - 1;
    // A new song's tracks are in another order: what was measured belonged to the last one's.
    // The selection meter's sum, if the selection is marked for this song.
    const auto summing = selectionSerial.load() == song->serial;
    auto* selectedLeft = song->audio.getWritePointer (song->selectionBuffer * 2);
    auto* selectedRight = song->audio.getWritePointer (song->selectionBuffer * 2 + 1);
    if (summing)
    {
        juce::FloatVectorOperations::clear (selectedLeft, numSamples);
        juce::FloatVectorOperations::clear (selectedRight, numSamples);
    }
    if (meterSerial.load (std::memory_order_relaxed) != song->serial)
    {
        for (auto& meter : meters)
            meter.store (0.0f, std::memory_order_relaxed);
        meterSerial = song->serial;
    }
    // Stage by stage: its tracks' effects and faders (at once, for the export), then what each sends on, in turn.
    for (const auto& stage : song->stages)
    {
        each ((int) stage.size(), [&] (int i) { runTrack ((size_t) stage[(size_t) i], glide, numSamples); });
        for (const auto index : stage)
        {
            const auto t = (size_t) index;
            const auto& track = song->tracks[t];
            auto* l = song->audio.getWritePointer (track.buffer * 2);
            auto* r = song->audio.getWritePointer (track.buffer * 2 + 1);
            if (summing && t < (size_t) maxMeters && metered[t].load (std::memory_order_relaxed))
            {
                juce::FloatVectorOperations::add (selectedLeft, l, numSamples);
                juce::FloatVectorOperations::add (selectedRight, r, numSamples);
            }
            if (t == master)
            {
                juce::FloatVectorOperations::add (left, l, numSamples);
                juce::FloatVectorOperations::add (right, r, numSamples);
                continue;
            }
            const auto step = 1.0f / (float) numSamples;
            for (const auto& send : track.sends)
            {
                const auto& target = song->tracks[(size_t) send.track];
                if (target.buffer < 0)
                    continue;
                auto* toLeft = song->audio.getWritePointer (target.buffer * 2);
                auto* toRight = song->audio.getWritePointer (target.buffer * 2 + 1);
                // A send that waits for the track's later inputs goes in through its delay line.
                auto* line = send.delayLine.get();
                if (line != nullptr)
                {
                    line->clearInput (numSamples);
                    toLeft = line->inputLeft();
                    toRight = line->inputRight();
                }
                const auto flush = [&] {
                    if (line != nullptr)
                        line->flushInto (song->audio.getWritePointer (target.buffer * 2), song->audio.getWritePointer (target.buffer * 2 + 1), numSamples);
                };
                if (! glide || juce::exactlyEqual (send.from, send.gain))
                {
                    juce::FloatVectorOperations::addWithMultiply (toLeft, l, send.gain, numSamples);
                    juce::FloatVectorOperations::addWithMultiply (toRight, r, send.gain, numSamples);
                    flush();
                    continue;
                }
                for (int i = 0; i < numSamples; ++i)
                {
                    const auto gain = send.from + (send.gain - send.from) * (float) (i + 1) * step;
                    toLeft[i] += l[i] * gain;
                    toRight[i] += r[i] * gain;
                }
                flush();
            }
        }
    }

    if (summing)
    {
        const auto raise = [] (std::atomic<float>& meter, juce::Range<float> range) {
            const auto loudest = juce::jmax (-range.getStart(), range.getEnd());
            if (loudest > meter.load (std::memory_order_relaxed))
                meter.store (loudest, std::memory_order_relaxed);
        };
        raise (selectionMeter[0], juce::FloatVectorOperations::findMinAndMax (selectedLeft, numSamples));
        raise (selectionMeter[1], juce::FloatVectorOperations::findMinAndMax (selectedRight, numSamples));
    }
}

void Sequencer::runTrack (size_t t, bool glide, int numSamples)
{
    const auto& track = song->tracks[t];
    auto* l = song->audio.getWritePointer (track.buffer * 2);
    auto* r = song->audio.getWritePointer (track.buffer * 2 + 1);

    for (const auto& effect : track.effects)
        if (effect.enabled && effect.plugin != nullptr)
            runEffect (*effect.plugin, effect.mix, l, r, numSamples);

    // The fader, pan and mute: each side out from both sides in.
    const auto& to = track.gains;
    const auto& from = glide ? track.from : track.gains;
    const auto step = 1.0f / (float) numSamples;
    for (int i = 0; i < numSamples; ++i)
    {
        const auto k = glide ? (float) (i + 1) * step : 1.0f;
        const auto ll = from[0] + (to[0] - from[0]) * k, rl = from[1] + (to[1] - from[1]) * k;
        const auto lr = from[2] + (to[2] - from[2]) * k, rr = from[3] + (to[3] - from[3]) * k;
        const auto inLeft = l[i], inRight = r[i];
        l[i] = ll * inLeft + rl * inRight;
        r[i] = lr * inLeft + rr * inRight;
    }
    if (t < (size_t) maxMeters)
    {
        const auto raise = [] (std::atomic<float>& meter, juce::Range<float> range) {
            const auto loudest = juce::jmax (-range.getStart(), range.getEnd());
            if (loudest > meter.load (std::memory_order_relaxed))
                meter.store (loudest, std::memory_order_relaxed);
        };
        raise (meters[t * 2], juce::FloatVectorOperations::findMinAndMax (l, numSamples));
        raise (meters[t * 2 + 1], juce::FloatVectorOperations::findMinAndMax (r, numSamples));
    }
}

void Sequencer::runEffect (HostedPlugin& plugin, float mix, float* left, float* right, int numSamples)
{
    if (numSamples > plugin.buffer.getNumSamples())
        return;
    juce::AudioBuffer<float> view (plugin.buffer.getArrayOfWritePointers(), plugin.buffer.getNumChannels(), numSamples);
    view.clear();
    view.copyFrom (0, 0, left, numSamples);
    view.copyFrom (1, 0, right, numSamples);
    plugin.midi.clear();
    plugin.instance->processBlock (view, plugin.midi);
    // A plugin with one output gives it to both sides.
    const auto* wetLeft = view.getReadPointer (0);
    const auto* wetRight = view.getReadPointer (plugin.instance->getTotalNumOutputChannels() > 1 ? 1 : 0);
    if (mix >= 1.0f)
    {
        juce::FloatVectorOperations::copy (left, wetLeft, numSamples);
        juce::FloatVectorOperations::copy (right, wetRight, numSamples);
        return;
    }
    // Some of the dry sound, and the rest of the effect's.
    juce::FloatVectorOperations::multiply (left, 1.0f - mix, numSamples);
    juce::FloatVectorOperations::multiply (right, 1.0f - mix, numSamples);
    juce::FloatVectorOperations::addWithMultiply (left, wetLeft, mix, numSamples);
    juce::FloatVectorOperations::addWithMultiply (right, wetRight, mix, numSamples);
}

void Sequencer::render (Voice& voice, int numSamples)
{
    const auto [left, right] = trackAudio (voice.channel);
    if (left == nullptr)
        return;
    const auto& channel = song->channels[(size_t) voice.channel];
    const auto& audio = voice.sample->audio;
    const auto* sourceLeft = audio.getReadPointer (0);
    const auto* sourceRight = audio.getReadPointer (audio.getNumChannels() > 1 ? 1 : 0);
    const auto length = audio.getNumSamples();
    const auto last = length - 1;
    const auto quality = song->resampling;
    const auto rate = voice.baseRate * std::pow (2.0, (double) (voice.pitch + channel.pitch) / 12.0);
    const auto gainLeft = voice.gain * channel.gainLeft * voice.panLeft, gainRight = voice.gain * channel.gainRight * voice.panRight;
    const auto& envelope = channel.envelope;
    const auto perSecond = (float) (1.0 / sampleRate);
    const auto fadeLength = (float) juce::jmax (1, (int) (fadeSeconds * sampleRate));

    auto start = voice.delay;
    voice.delay = 0;
    for (int i = start; i < numSamples; ++i)
    {
        const auto index = (int) voice.position;
        if (index >= last)
        {
            voice.active = false;
            return;
        }

        auto level = 1.0f;
        if (channel.hasEnvelope)
        {
            if (voice.untilRelease == 0 && voice.stage != Voice::Stage::release)
            {
                voice.stage = Voice::Stage::release;
                voice.releaseStep = voice.level * perSecond / juce::jmax (envelope.release, 0.001f);
            }
            if (voice.untilRelease > 0)
                --voice.untilRelease;

            switch (voice.stage)
            {
                case Voice::Stage::attack:
                    voice.level += perSecond / juce::jmax (envelope.attack, 0.0005f);
                    if (voice.level >= 1.0f)
                    {
                        voice.level = 1.0f;
                        voice.stage = Voice::Stage::decay;
                    }
                    break;
                case Voice::Stage::decay:
                    voice.level -= (1.0f - envelope.sustain) * perSecond / juce::jmax (envelope.decay, 0.0005f);
                    if (voice.level <= envelope.sustain)
                    {
                        voice.level = envelope.sustain;
                        voice.stage = Voice::Stage::sustain;
                    }
                    break;
                case Voice::Stage::sustain:
                    voice.level = envelope.sustain;
                    break;
                case Voice::Stage::release:
                    voice.level -= voice.releaseStep;
                    break;
            }
            if (voice.level <= 0.0f)
            {
                voice.active = false;
                return;
            }
            level = voice.level;
        }

        if (voice.fade >= 0 && voice.fadeWait > 0)
        {
            --voice.fadeWait;
        }
        else if (voice.fade >= 0)
        {
            if (voice.fade == 0)
            {
                voice.active = false;
                return;
            }
            level *= (float) voice.fade-- / fadeLength;
        }

        left[i] += resampling::read (sourceLeft, length, voice.position, rate, quality) * gainLeft * level;
        right[i] += resampling::read (sourceRight, length, voice.position, rate, quality) * gainRight * level;
        voice.position += rate;
    }
}

void Sequencer::startNote (HostedPlugin& plugin, int key, float velocity, juce::int64 lengthSamples, int delay)
{
    // The same key again: its first note ends where the second starts.
    for (int i = 0; i < plugin.numPending; ++i)
        if (plugin.pending[(size_t) i].key == key)
        {
            plugin.midi.addEvent (juce::MidiMessage::noteOff (1, key), delay);
            plugin.pending[(size_t) i] = plugin.pending[(size_t) --plugin.numPending];
            break;
        }
    if (plugin.numPending >= (int) plugin.pending.size())
        return;
    plugin.midi.addEvent (juce::MidiMessage::noteOn (1, key, juce::jlimit (0.01f, 1.0f, velocity)), delay);
    plugin.pending[(size_t) plugin.numPending++] = { key, delay + juce::jmax ((juce::int64) 1, lengthSamples) };
}

void Sequencer::endNotes (HostedPlugin& plugin, int numSamples)
{
    for (int i = 0; i < plugin.numPending;)
    {
        auto& note = plugin.pending[(size_t) i];
        if (note.left < numSamples)
        {
            plugin.midi.addEvent (juce::MidiMessage::noteOff (1, note.key), (int) note.left);
            note = plugin.pending[(size_t) --plugin.numPending];
        }
        else
        {
            note.left -= numSamples;
            ++i;
        }
    }
}

void Sequencer::silencePlugins()
{
    for (auto& channel : song->channels)
        if (auto* plugin = channel.plugin.get())
        {
            for (int i = 0; i < plugin->numPending; ++i)
                plugin->midi.addEvent (juce::MidiMessage::noteOff (1, plugin->pending[(size_t) i].key), 0);
            plugin->numPending = 0;
            plugin->midi.addEvent (juce::MidiMessage::allNotesOff (1), 0);
        }
}

void Sequencer::renderPlugins (int numSamples)
{
    // Each plugin into its own buffer (at once, for the export), then each added to its track in turn.
    auto& playingPlugins = song->playingPlugins;
    playingPlugins.clear();
    for (size_t c = 0; c < song->channels.size(); ++c)
    {
        auto* plugin = song->channels[c].plugin.get();
        if (plugin != nullptr && numSamples <= plugin->buffer.getNumSamples() && trackAudio ((int) c).first != nullptr)
            playingPlugins.push_back ((int) c);
    }
    each ((int) playingPlugins.size(), [&] (int i) {
        auto& plugin = *song->channels[(size_t) playingPlugins[(size_t) i]].plugin;
        juce::AudioBuffer<float> view (plugin.buffer.getArrayOfWritePointers(), plugin.buffer.getNumChannels(), numSamples);
        view.clear();
        plugin.instance->processBlock (view, plugin.midi);
    });
    for (const auto c : playingPlugins)
    {
        const auto& channel = song->channels[(size_t) c];
        const auto& plugin = *channel.plugin;
        const auto [left, right] = trackAudio (c);
        // A plugin with one output plays on both sides.
        juce::FloatVectorOperations::addWithMultiply (left, plugin.buffer.getReadPointer (0), channel.gainLeft, numSamples);
        juce::FloatVectorOperations::addWithMultiply (right, plugin.buffer.getReadPointer (plugin.buffer.getNumChannels() > 1 && plugin.instance->getTotalNumOutputChannels() > 1 ? 1 : 0), channel.gainRight, numSamples);
    }
}

void Sequencer::setMetronomeSound (const juce::String& name)
{
    clickSound = name == "tick"      ? ClickSound::tick
                 : name == "tap"     ? ClickSound::tap
                 : name == "hihat"   ? ClickSound::hihat
                 : name == "cowbell" ? ClickSound::cowbell
                                     : ClickSound::beep;
}

void Sequencer::startClick()
{
    // Each sound's pitch on a bar and on a beat, how loud it is and how long it rings (seconds to fall by e).
    struct Shape { double bar, beat; float gain; double seconds; };
    static constexpr Shape shapes[] = {
        { 1760.0, 1175.0, 0.30f, 0.025 },  // beep: a sine
        { 3520.0, 2637.0, 0.45f, 0.005 },  // tick: a short high sine
        { 1245.0, 932.0, 0.42f, 0.018 },   // tap: a wood block's two partials
        { 0.0, 0.0, 0.32f, 0.030 },        // hi-hat: high-passed noise, louder on the bar
        { 800.0, 587.0, 0.16f, 0.060 },    // cowbell: two square waves
    };
    click.sound = clickSound.load();
    const auto& shape = shapes[(int) click.sound];
    click.frequency = click.bar ? shape.bar : shape.beat;
    click.gain = click.sound == ClickSound::hihat && ! click.bar ? shape.gain * 0.55f : shape.gain;
    const auto seconds = click.sound == ClickSound::hihat && click.bar ? shape.seconds * 1.6 : shape.seconds;
    click.decay = (float) std::exp (-1.0 / (seconds * sampleRate));
    click.level = 1.0f;
    click.phase = click.phase2 = 0;
    click.highPass = click.lastNoise = 0;
}

void Sequencer::renderClick (float* left, float* right, int numSamples)
{
    if (const auto auditions = clickAuditions.load(); auditions != clickAuditionsSeen)
    {
        clickAuditionsSeen = auditions;
        click.delay = 0;
        click.bar = true;
    }
    auto start = 0;
    if (click.delay >= 0)
    {
        start = juce::jmin (click.delay, numSamples);
        click.delay = -1;
        startClick();
    }
    if (click.level <= 0.0001f)
        return;
    const auto twoPi = juce::MathConstants<double>::twoPi;
    const auto step = click.frequency / sampleRate;
    for (int i = start; i < numSamples; ++i)
    {
        float value = 0;
        switch (click.sound)
        {
            case ClickSound::beep:
            case ClickSound::tick:
                value = (float) std::sin (click.phase * twoPi);
                break;
            case ClickSound::tap:
                value = 0.75f * (float) std::sin (click.phase * twoPi) + 0.25f * (float) std::sin (click.phase2 * twoPi);
                click.phase2 += step * 2.76;
                break;
            case ClickSound::hihat:
            {
                // A white noise (xorshift), its lows taken out.
                click.noise ^= click.noise << 13;
                click.noise ^= click.noise >> 17;
                click.noise ^= click.noise << 5;
                const auto noise = (float) click.noise / 2147483648.0f - 1.0f;
                click.highPass = 0.6f * (click.highPass + noise - click.lastNoise);
                click.lastNoise = noise;
                value = click.highPass;
                break;
            }
            case ClickSound::cowbell:
                value = 0.5f * ((std::fmod (click.phase, 1.0) < 0.5 ? 1.0f : -1.0f) + (std::fmod (click.phase2, 1.0) < 0.5 ? 1.0f : -1.0f));
                click.phase2 += step * 1.48;
                break;
        }
        const auto sample = click.gain * click.level * value;
        left[i] += sample;
        right[i] += sample;
        click.phase += step;
        click.level *= click.decay;
    }
}
