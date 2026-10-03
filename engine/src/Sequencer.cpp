#include "Sequencer.h"

#include "Protocol.h"

#include <cmath>
#include <cstring>
#include <limits>
#include <map>

namespace
{
/** How long a voice takes to fade when it's silenced, so stopping doesn't click. */
constexpr double fadeSeconds = 0.004;
/** How long a channel's plugin sounds when it's heard on its own (a click on its button). */
constexpr double auditionSeconds = 0.4;
/** The longest a held key sounds if it's never let go (the tab went away mid-press). */
constexpr double heldSeconds = 30.0;
/** A MIDI keyboard's note: it sounds until the key is let go, however long that is. */
constexpr juce::int64 keyHeld = std::numeric_limits<juce::int64>::max() / 4;
/** How the MIDI target is packed (`midiTarget`): the song's serial above these bits, the channel + 1 in them. */
constexpr int targetBits = 20;
/**
 * Ticks (a fraction of a millionth of a sample's worth): a note that falls exactly on the edge of a
 * block must land in one block or the other, not in whichever the rounding of the position picks.
 */
constexpr double tickSlack = 1e-6;
}

Sequencer::Sequencer (bool offline) : clips (offline), recording (offline) { heldKeys.fill (-1); }

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
    next->midiChannel = channelIds.indexOf (midiTargetId);

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
    {
        for (auto& send : track.sends)
            send.delayLine = lineFor ("s" + track.id + ">" + next->tracks[(size_t) send.track].id, send.delay);
        for (auto& effect : track.effects)
            if (effect.keyTrack >= 0)
                effect.keyLine = lineFor ("k" + effect.id, effect.keyDelay);
    }
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
void Sequencer::setMidiTarget (const juce::String& channelId)
{
    midiTargetId = channelId;
    // For the song last handed over (`serials`): the audio thread uses it once it has that song, and the
    // song's own `midiChannel` (from this id too) until then.
    midiTarget = (serials << targetBits) | (juce::uint64) (channelIds.indexOf (channelId) + 1);
}

int Sequencer::midiChannel() const
{
    const auto packed = midiTarget.load();
    if ((packed >> targetBits) == song->serial)
        return (int) (packed & ((1u << targetBits) - 1)) - 1;
    return song->midiChannel;
}

void Sequencer::midiIn (const juce::MidiMessage& message)
{
    // Notes and controllers only (no SysEx): three bytes at most.
    const auto size = message.getRawDataSize();
    if (size < 1 || size > 3 || message.isSysEx())
        return;
    const juce::SpinLock::ScopedLockType lock (midiWriting);
    const auto scope = midiQueue.write (1);
    if (scope.blockSize1 <= 0)
        return;
    auto& event = midiEvents[(size_t) scope.startIndex1];
    event.size = size;
    std::memcpy (event.bytes, message.getRawData(), (size_t) size);
}

juce::Array<juce::var> Sequencer::takePlayed()
{
    juce::Array<juce::var> list;
    const auto scope = playedQueue.read (playedQueue.getNumReady());
    for (int i = 0; i < scope.blockSize1 + scope.blockSize2; ++i)
    {
        const auto& note = played[(size_t) (i < scope.blockSize1 ? scope.startIndex1 + i : scope.startIndex2 + i - scope.blockSize1)];
        list.add (protocol::object ({ { "channel", note.channel >= 0 && note.channel < channelIds.size() ? juce::var (channelIds[note.channel]) : juce::var() },
                                      { "key", note.key },
                                      { "velocity", note.velocity },
                                      { "on", note.on },
                                      { "tick", note.playing ? juce::var (note.tick) : juce::var() },
                                      { "counting", note.counting },
                                      { "pass", (int) note.pass } }));
    }
    return list;
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
    // The slices automation is played in count on from where it is now (the song may be longer, or faster).
    if (playing)
        playStart = position_ - (double) sliceClock * next->tempo * next->ppq / (60.0 * sampleRate);

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
    if (playing)
        takeOwnValues (*next, song);
    // The lanes of the last song's that this one doesn't have: their controls are as the song says again.
    if (song != nullptr && lanesLive)
        for (auto& lane : song->lanes)
            if (lane.kind == Song::Lane::Kind::param && lane.lastSet > -2.0f)
            {
                auto kept = false;
                for (const auto& other : next->lanes)
                    kept = kept || (other.kind == Song::Lane::Kind::param && other.key == lane.key);
                if (! kept)
                {
                    lane.parameter->setValue (lane.own);
                    lane.plugin->automating.store (false);
                }
            }

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
    // The Pitch Wheels' notes end too (Single's offset back to none).
    if (song != nullptr)
        for (auto& track : song->tracks)
            for (auto& effect : track.effects)
                if (effect.wheel != nullptr)
                    effect.wheel->notesOff();
}

void Sequencer::takeRequests()
{
    if (auto* next = pending.exchange (nullptr))
        adopt (next);

    if (const auto stops = stopRequests.load(); stops != stopsSeen)
    {
        stopsSeen = stops;
        playing = false;
        position_ = 0;
        // Its automation lets go at once: a play taken in this same block takes the plugins' own values.
        if (song != nullptr && lanesLive)
            restoreLanes (*song);
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
        recording.end();
        if (playing)
            silenceVoices();
        // Plugins' own values are what they are now, unless automation has them already.
        else if (song != nullptr)
            takeOwnValues (*song, nullptr);
        playing = true;
        playStarted = true;
        position_ = song != nullptr ? std::fmod (playFrom.load(), song->loopTicks) : 0;
        generation = requestedGeneration.load();
        pass = 0;
        sliceClock = 0;
        playStart = position_;
        clips.setGeneration (generation);
        through = playThrough.load();
        recordWaiting = playRecords.load();
        countInDone = 0;
        countInLeft = song != nullptr ? (juce::int64) std::llround (playCountIn.load() * 60.0 * sampleRate / (song->tempo * song->ppq)) : 0;
    }
}

void Sequencer::process (float* left, float* right, int numSamples, const float* const* inputs, int numInputs, ChannelFeed feed)
{
    takeRequests();
    numInputs = inputs != nullptr ? juce::jlimit (0, maxInputs, numInputs) : 0;
    std::array<const float*, maxInputs> sliceInputs {};
    for (int done = 0; done < numSamples;)
    {
        auto length = numSamples - done;
        // A count-in is a part of its own: the transport (and automation's clock) holds while it clicks.
        const auto counting = playing && countInLeft > 0;
        if (counting)
            length = (int) juce::jmin ((juce::int64) length, countInLeft);
        // Automation plays in slices counted from where play started, whatever the blocks.
        else if (playing && song != nullptr && ! song->lanes.empty())
            length = juce::jmin (length, sliceSamples - (int) (sliceClock % sliceSamples));
        // The inputs from the same sample.
        for (int ch = 0; ch < numInputs; ++ch)
            sliceInputs[(size_t) ch] = inputs[ch] != nullptr ? inputs[ch] + done : nullptr;
        const auto sliceFeed = feed.channel != nullptr ? ChannelFeed { feed.channel, feed.left + done, feed.right + done } : ChannelFeed {};
        processBlock (left + done, right + done, length, sliceInputs.data(), numInputs, sliceFeed);
        if (onSlice != nullptr && song != nullptr)
            onSlice (*song, done, length);
        if (playing && ! counting)
            sliceClock += length;
        done += length;
    }

    playingNow = playing;
    positionNow = position_;
    countInNow = playing ? countInLeft : 0;
    generationNow = generation;
    passNow = pass;
}

void Sequencer::processBlock (float* left, float* right, int numSamples, const float* const* inputs, int numInputs, ChannelFeed feed)
{
    if (song != nullptr)
    {
        // Automation drives its controls while the song plays, and lets go of them when it stops.
        if (playing && ! song->lanes.empty())
            applyLanes (numSamples);
        else if (lanesLive)
            restoreLanes (*song);

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
        // MIDI keyboards: their notes start now, on the target channel.
        playMidi();

        clips.receive (*song);
        // Where the song is over this block, for its Gross Beats (before `schedule` moves it on).
        grossClock = {};
        grossClock.ticksPerSample = song->tempo * song->ppq / (60.0 * sampleRate);
        grossClock.ppq = song->ppq;
        if (playing && countInLeft <= 0)
        {
            grossClock.playing = true;
            grossClock.started = playStarted;
            playStarted = false;
            grossClock.tick = song->offsetTicks + position_;
            grossClock.loopStart = song->offsetTicks;
            grossClock.loopEnd = song->offsetTicks + song->loopTicks;
            grossClock.loops = song->loops && ! through;
        }
        if (playing)
        {
            // A count-in's part (`process` gives it one of its own): its clicks, the transport held.
            if (countInLeft > 0)
                countIn (numSamples);
            else
            {
                // The recording asked for begins as the transport moves.
                if (recordWaiting)
                {
                    recordWaiting = false;
                    recording.begin (0, position_);
                }
                clips.startLate (position_, pass, song->loopTicks, song->tempo * song->ppq / (60.0 * sampleRate));
                schedule (0, numSamples);
            }
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
            // An armed track that isn't heard still shows its input's level on its meter (FL's), so the
            // level can be set before recording.
            if (inputs != nullptr)
                for (size_t t = 0; t < song->tracks.size() && t < (size_t) maxMeters; ++t)
                {
                    const auto& track = song->tracks[t];
                    if (! track.armed || track.monitor || track.input.empty())
                        continue;
                    for (size_t side = 0; side < 2; ++side)
                    {
                        const auto channel = track.input[juce::jmin (side, track.input.size() - 1)];
                        if (channel < 0 || channel >= numInputs || inputs[channel] == nullptr)
                            continue;
                        const auto range = juce::FloatVectorOperations::findMinAndMax (inputs[channel], numSamples);
                        const auto loudest = juce::jmax (-range.getStart(), range.getEnd());
                        auto& meter = meters[t * 2 + side];
                        if (loudest > meter.load (std::memory_order_relaxed))
                            meter.store (loudest, std::memory_order_relaxed);
                    }
                }
            for (auto& voice : voices)
                if (voice.active)
                    render (voice, numSamples);
            renderPlugins (numSamples);
            clips.render (*song, numSamples, [this] (int channel) { return trackAudio (channel); });
            // A channel's preview, where its clips play (its delay line, else its track).
            if (feed.channel != nullptr)
                for (size_t c = 0; c < song->channels.size(); ++c)
                    if (song->channels[c].id == *feed.channel)
                    {
                        const auto [l, r] = trackAudio ((int) c);
                        if (l != nullptr)
                        {
                            juce::FloatVectorOperations::add (l, feed.left, numSamples);
                            juce::FloatVectorOperations::add (r, feed.right, numSamples);
                        }
                        break;
                    }
            // Channels that wait for their track's later inputs come out of their delay lines into it.
            for (auto& channel : song->channels)
                if (channel.delayLine != nullptr)
                    if (const auto buffer = song->tracks[(size_t) channel.track].buffer; buffer >= 0)
                        channel.delayLine->flushInto (song->audio.getWritePointer (buffer * 2), song->audio.getWritePointer (buffer * 2 + 1), numSamples);
            mixTracks (left, right, numSamples);
        }
    }
    else
    {
        // No song: what keyboards sent has nowhere to go.
        midiQueue.read (midiQueue.getNumReady());
    }
    renderClick (left, right, numSamples);
    recording.write (inputs, numInputs, numSamples);
}

void Sequencer::playMidi()
{
    const auto scope = midiQueue.read (midiQueue.getNumReady());
    const auto count = scope.blockSize1 + scope.blockSize2;
    if (count == 0)
        return;
    const auto target = midiChannel();
    const auto channels = (int) song->channels.size();
    const auto report = [&] (int channel, int key, float velocity, bool on) {
        const auto out = playedQueue.write (1);
        if (out.blockSize1 > 0)
            played[(size_t) out.startIndex1] = { channel, key, velocity, on, playing, playing && countInLeft > 0, position_, pass };
    };
    for (int i = 0; i < count; ++i)
    {
        const auto& event = midiEvents[(size_t) (i < scope.blockSize1 ? scope.startIndex1 + i : scope.startIndex2 + i - scope.blockSize1)];
        auto message = juce::MidiMessage (event.bytes, event.size);
        if (message.isNoteOn())
        {
            const auto key = message.getNoteNumber();
            const auto velocity = message.getFloatVelocity();
            // The same key again before it was let go: the last one ends first.
            if (heldKeys[(size_t) key] >= 0)
                releaseKey (heldKeys[(size_t) key], key);
            heldKeys[(size_t) key] = -1;
            if (target < 0 || target >= channels)
                continue;
            heldKeys[(size_t) key] = target;
            auto& channel = song->channels[(size_t) target];
            if (channel.isPlugin)
            {
                // Its PITCH moves the keys it's sent (whole semitones), as its pattern's notes are (`compile.ts`).
                sentKeys[(size_t) key] = juce::jlimit (0, 127, key + (int) std::lround (channel.pitch));
                if (channel.plugin != nullptr)
                    startNote (*channel.plugin, sentKeys[(size_t) key], velocity, keyHeld, 0);
            }
            else if (auto* voice = startVoice (target, (float) (key - 60), velocity * velocity / (0.78f * 0.78f), -1, 0))
            {
                voice->key = key;
                voice->loops = channel.loop;
            }
            report (target, key, velocity, true);
        }
        else if (message.isNoteOff())
        {
            const auto key = message.getNoteNumber();
            const auto channel = heldKeys[(size_t) key];
            heldKeys[(size_t) key] = -1;
            if (channel < 0 || channel >= channels)
                continue;
            releaseKey (channel, key);
            report (channel, key, 0, false);
        }
        else if (message.isSustainPedalOn() || message.isSustainPedalOff())
        {
            // A sampler's notes let go of meanwhile end with the pedal; a plugin keeps its own.
            pedal = message.isSustainPedalOn();
            if (! pedal)
                for (auto& voice : voices)
                    if (voice.active && voice.sustained)
                    {
                        voice.sustained = false;
                        voice.untilRelease = 0;
                    }
            if (target >= 0 && target < channels)
                if (auto* plugin = song->channels[(size_t) target].plugin.get())
                {
                    message.setChannel (1);
                    plugin->midi.addEvent (message, 0);
                }
        }
        else if (message.isPitchWheel() || message.isController() || message.isChannelPressure() || message.isAftertouch())
        {
            // The mod wheel, pitch bend and the rest are the plugin's to use.
            if (target >= 0 && target < channels)
                if (auto* plugin = song->channels[(size_t) target].plugin.get())
                {
                    message.setChannel (1);
                    plugin->midi.addEvent (message, 0);
                }
        }
    }
}

void Sequencer::releaseKey (int channelIndex, int key)
{
    if (channelIndex < 0 || channelIndex >= (int) song->channels.size())
        return;
    auto& channel = song->channels[(size_t) channelIndex];
    if (auto* plugin = channel.plugin.get())
    {
        const auto sent = sentKeys[(size_t) key];
        for (int n = 0; n < plugin->numPending; ++n)
            if (plugin->pending[(size_t) n].key == sent)
            {
                plugin->midi.addEvent (juce::MidiMessage::noteOff (1, sent), 0);
                plugin->pending[(size_t) n] = plugin->pending[(size_t) --plugin->numPending];
                break;
            }
        return;
    }
    for (auto& voice : voices)
        if (voice.active && voice.channel == channelIndex && voice.key == key)
        {
            voice.key = -1;
            // Held by the pedal: it ends when the pedal's let go.
            if (pedal)
                voice.sustained = true;
            else
                voice.untilRelease = 0;
        }
}


void Sequencer::applyLanes (int numSamples)
{
    // The slice this block is in (blocks never cross one: `process` cuts them): its ends' values, and how
    // far into it the block starts and ends. A gain glides along the slice's straight line, whatever
    // part of it a block is, so any block size makes the same sound.
    const auto ticksPerSample = song->tempo * song->ppq / (60.0 * sampleRate);
    const auto into = (int) (sliceClock % sliceSamples);
    const auto loop = song->loopTicks;
    // From where play started and the samples since, not the position (which gathers rounding), so the
    // slices are the same however the samples were asked for. (A tempo change mid-play moves them a
    // little: they're worked out at the new tempo from the start.)
    const auto first = (double) (sliceClock - into);
    auto sliceStart = playStart + first * ticksPerSample;
    auto sliceEnd = playStart + (first + sliceSamples) * ticksPerSample;
    // Its start inside the loop; its end straight on from there (a slice across the loop's end holds the
    // song's last values to it, as the export does, and the next starts from the loop's start).
    if (song->loops && ! through)
    {
        const auto span = sliceEnd - sliceStart;
        sliceStart = std::fmod (std::fmod (sliceStart, loop) + loop, loop);
        sliceEnd = sliceStart + span;
    }
    const auto a = (float) into / (float) sliceSamples, b = (float) (into + numSamples) / (float) sliceSamples;
    std::array<float, Song::Lane::maxSize> start {};
    std::array<float, 4> end {}, from {}, to {};
    for (auto& lane : song->lanes)
    {
        lane.valueAt (sliceStart, start.data());
        // Gains glide along the slice here; everything else is set at its start (and glides, if it does, in its effect).
        if (lane.kind == Song::Lane::Kind::channel || lane.kind == Song::Lane::Kind::track || lane.kind == Song::Lane::Kind::send)
        {
            lane.valueAt (sliceEnd, end.data());
            for (int c = 0; c < lane.size; ++c)
            {
                from[(size_t) c] = start[(size_t) c] + (end[(size_t) c] - start[(size_t) c]) * a;
                to[(size_t) c] = start[(size_t) c] + (end[(size_t) c] - start[(size_t) c]) * b;
            }
        }
        switch (lane.kind)
        {
            case Song::Lane::Kind::channel:
            {
                auto& channel = song->channels[(size_t) lane.channel];
                channel.fromLeft = from[0];
                channel.fromRight = from[1];
                channel.gainLeft = to[0];
                channel.gainRight = to[1];
                channel.ramp = true;
                break;
            }
            case Song::Lane::Kind::track:
            {
                auto& track = song->tracks[(size_t) lane.track];
                // A new song's first block glides from where the last one left it (a track it didn't have, from its lane).
                if (! ramping || track.previous < 0)
                    track.from = from;
                track.gains = to;
                track.automated = true;
                break;
            }
            case Song::Lane::Kind::send:
            {
                auto& send = song->tracks[(size_t) lane.track].sends[(size_t) lane.index];
                if (! ramping || send.previous < 0)
                    send.from = from[0];
                send.gain = to[0];
                send.automated = true;
                break;
            }
            case Song::Lane::Kind::pitch:
                // A sampler's pitch: as it is at the slice's start, all through it (voices work out their rate from it each block).
                song->channels[(size_t) lane.channel].pitch = start[0];
                break;
            case Song::Lane::Kind::mix:
                // An effect's mix and a plugin's parameter: as they are at the slice's start, all through it.
                song->tracks[(size_t) lane.track].effects[(size_t) lane.index].mix = juce::jlimit (0.0f, 1.0f, start[0]);
                break;
            case Song::Lane::Kind::gross:
                // A Gross Beat's slot or mix, likewise (a slot picked starts on its sync point).
                setGrossControl (*song->tracks[(size_t) lane.track].effects[(size_t) lane.index].grossSettings, lane.control, start[0]);
                break;
            case Song::Lane::Kind::tune:
                // An Auto-Tune's control, likewise.
                song->tracks[(size_t) lane.track].effects[(size_t) lane.index].tuneSettings->setControl (lane.control, start[0]);
                break;
            case Song::Lane::Kind::wheel:
                // A Pitch Wheel's wheel or knob, likewise (the physics smooth a wheel's steps).
                song->tracks[(size_t) lane.track].effects[(size_t) lane.index].wheelSettings->setControl (lane.control, start[0]);
                break;
            case Song::Lane::Kind::echo:
                // An EchoBoy's, likewise (its delays glide or crossfade there, its gains glide).
                song->tracks[(size_t) lane.track].effects[(size_t) lane.index].echoSettings->set ((echo::Control) lane.control, start.data(), lane.size);
                break;
            case Song::Lane::Kind::eq:
                // A Pro-Q's band (or output): set at the slice's start, and glided to by its filters.
                setEqControl (*song->tracks[(size_t) lane.track].effects[(size_t) lane.index].eqSettings, lane.band, lane.control, start[0]);
                break;
            case Song::Lane::Kind::ott:
                // An OTT's, likewise (its values glide there over a few ms).
                song->tracks[(size_t) lane.track].effects[(size_t) lane.index].ottSettings->set ((ott::Lane) lane.control, start.data(), lane.size);
                break;
            case Song::Lane::Kind::comp:
                // A Pro-C's, likewise (its knobs glide there over 20 ms).
                song->tracks[(size_t) lane.track].effects[(size_t) lane.index].compSettings->set ((comp::Lane) lane.control, start.data(), lane.size);
                break;
            case Song::Lane::Kind::panman:
                // A PanMan's control, likewise (its position and gains glide, so a step doesn't click).
                if (lane.control == panman::shapeControl)
                    song->tracks[(size_t) lane.track].effects[(size_t) lane.index].panSettings->setShape (start.data(), lane.size);
                else
                    setPanControl (*song->tracks[(size_t) lane.track].effects[(size_t) lane.index].panSettings, lane.control, start[0]);
                break;
            case Song::Lane::Kind::param:
            {
                // Held in its window by the hand: the hand wins, and the lane takes it back once it's let go.
                if (lane.plugin->watcher.held.load (std::memory_order_relaxed) == lane.parameterIndex)
                {
                    lane.lastSet = -2.0f;
                    break;
                }
                lane.plugin->automating.store (true, std::memory_order_relaxed);
                // Set at a slice's start (or straight away, the first time).
                if (into != 0 && lane.lastSet > -2.0f)
                    break;
                const auto value = start[0] < 0.0f ? lane.own : juce::jlimit (0.0f, 1.0f, start[0]);
                if (! juce::exactlyEqual (value, lane.lastSet))
                {
                    lane.parameter->setValue (value);
                    lane.lastSet = value;
                }
                break;
            }
        }
    }
    lanesLive = true;
}

void Sequencer::restoreLanes (Song& from)
{
    for (auto& lane : from.lanes)
        switch (lane.kind)
        {
            case Song::Lane::Kind::channel:
            {
                auto& channel = from.channels[(size_t) lane.channel];
                channel.gainLeft = channel.fromLeft = lane.base[0];
                channel.gainRight = channel.fromRight = lane.base[1];
                channel.ramp = false;
                break;
            }
            case Song::Lane::Kind::pitch:
                from.channels[(size_t) lane.channel].pitch = lane.base[0];
                break;
            case Song::Lane::Kind::track:
            {
                auto& track = from.tracks[(size_t) lane.track];
                std::copy_n (lane.base.begin(), 4, track.gains.begin());
                track.from = track.gains;
                track.automated = false;
                break;
            }
            case Song::Lane::Kind::send:
            {
                auto& send = from.tracks[(size_t) lane.track].sends[(size_t) lane.index];
                send.gain = send.from = lane.base[0];
                send.automated = false;
                break;
            }
            case Song::Lane::Kind::mix:
                from.tracks[(size_t) lane.track].effects[(size_t) lane.index].mix = lane.base[0];
                break;
            case Song::Lane::Kind::gross:
                setGrossControl (*from.tracks[(size_t) lane.track].effects[(size_t) lane.index].grossSettings, lane.control, lane.base[0]);
                break;
            case Song::Lane::Kind::tune:
                from.tracks[(size_t) lane.track].effects[(size_t) lane.index].tuneSettings->setControl (lane.control, lane.base[0]);
                break;
            case Song::Lane::Kind::wheel:
                from.tracks[(size_t) lane.track].effects[(size_t) lane.index].wheelSettings->setControl (lane.control, lane.base[0]);
                break;
            case Song::Lane::Kind::echo:
                from.tracks[(size_t) lane.track].effects[(size_t) lane.index].echoSettings->set ((echo::Control) lane.control, lane.base.data(), lane.size);
                break;
            case Song::Lane::Kind::eq:
                setEqControl (*from.tracks[(size_t) lane.track].effects[(size_t) lane.index].eqSettings, lane.band, lane.control, lane.base[0]);
                break;
            case Song::Lane::Kind::ott:
                from.tracks[(size_t) lane.track].effects[(size_t) lane.index].ottSettings->set ((ott::Lane) lane.control, lane.base.data(), lane.size);
                break;
            case Song::Lane::Kind::comp:
                from.tracks[(size_t) lane.track].effects[(size_t) lane.index].compSettings->set ((comp::Lane) lane.control, lane.base.data(), lane.size);
                break;
            case Song::Lane::Kind::panman:
                if (lane.control == panman::shapeControl)
                    from.tracks[(size_t) lane.track].effects[(size_t) lane.index].panSettings->restoreShape();
                else
                    setPanControl (*from.tracks[(size_t) lane.track].effects[(size_t) lane.index].panSettings, lane.control, lane.base[0]);
                break;
            case Song::Lane::Kind::param:
                if (lane.lastSet > -2.0f)
                    lane.parameter->setValue (lane.own);
                lane.lastSet = -2.0f;
                lane.plugin->automating.store (false);
                break;
        }
    lanesLive = false;
}

void Sequencer::takeOwnValues (Song& next, Song* previous)
{
    for (auto& lane : next.lanes)
    {
        if (lane.kind != Song::Lane::Kind::param)
            continue;
        const Song::Lane* before = nullptr;
        if (previous != nullptr && lanesLive)
            for (const auto& other : previous->lanes)
                if (other.kind == Song::Lane::Kind::param && other.key == lane.key)
                    before = &other;
        // Automated by the last song too: what it is now is automation's, so its own value carries on.
        lane.own = before != nullptr ? before->own : lane.parameter->getValue();
        lane.lastSet = before != nullptr ? before->lastSet : -2.0f;
    }
}

void Sequencer::release()
{
    if (song != nullptr && lanesLive)
        restoreLanes (*song);
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
        // Pitch Wheels this channel's notes play, on their sample.
        for (const auto& listener : song->wheelListeners)
            if (listener.channel == note->channel)
                listener.state->noteOn (note->key, note->velocity, at (note->tick), (juce::int64) (note->length / ticksPerSample));
    }

    if (metronome && ! song->clicks.empty())
    {
        // Tempo clips: the beats as listed.
        for (auto beat = std::lower_bound (song->clicks.begin(), song->clicks.end(), from); beat != song->clicks.end() && *beat < to; ++beat)
        {
            click.delay = at (*beat);
            click.bar = std::binary_search (song->barClicks.begin(), song->barClicks.end(), *beat);
        }
    }
    else if (metronome)
        for (auto beat = std::ceil (from / song->beatTicks) * song->beatTicks; beat < to; beat += song->beatTicks)
        {
            click.delay = at (beat);
            click.bar = std::fmod (beat, song->barTicks) < 0.5;
        }
}

Sequencer::Voice* Sequencer::startVoice (int channelIndex, float pitch, float gain, double lengthTicks, int delay, float pan)
{
    if (channelIndex < 0 || channelIndex >= (int) song->channels.size())
        return nullptr;
    const auto& channel = song->channels[(size_t) channelIndex];
    if (channel.sample == nullptr || channel.sample->audio.getNumSamples() == 0)
        return nullptr;

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
    voice->notePan = pan;
    // A note goes round its loop while it's held; a one-off hearing (no length) plays through.
    voice->loops = channel.loop && lengthTicks >= 0;
    voice->delay = delay;
    voice->age = ++voiceCount;
    voice->level = channel.hasEnvelope && channel.envelope.attack > 0 ? 0.0f : 1.0f;
    if (lengthTicks >= 0)
        voice->untilRelease = (juce::int64) (lengthTicks * 60.0 * sampleRate / (song->tempo * song->ppq));
    return voice;
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
            const auto* preLeft = track.preBuffer >= 0 ? song->audio.getReadPointer (track.preBuffer * 2) : l;
            const auto* preRight = track.preBuffer >= 0 ? song->audio.getReadPointer (track.preBuffer * 2 + 1) : r;
            for (const auto& send : track.sends)
            {
                const auto& target = song->tracks[(size_t) send.track];
                if (target.buffer < 0)
                    continue;
                // Before the fader, or after it.
                const auto* sendLeft = send.preFader ? preLeft : l;
                const auto* sendRight = send.preFader ? preRight : r;
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
                if ((! glide && ! send.automated) || juce::exactlyEqual (send.from, send.gain))
                {
                    juce::FloatVectorOperations::addWithMultiply (toLeft, sendLeft, send.gain, numSamples);
                    juce::FloatVectorOperations::addWithMultiply (toRight, sendRight, send.gain, numSamples);
                    flush();
                    continue;
                }
                for (int i = 0; i < numSamples; ++i)
                {
                    const auto gain = send.from + (send.gain - send.from) * (float) (i + 1) * step;
                    toLeft[i] += sendLeft[i] * gain;
                    toRight[i] += sendRight[i] * gain;
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

    // What keys taken before its effects hear.
    if (track.preFxBuffer >= 0)
    {
        song->audio.copyFrom (track.preFxBuffer * 2, 0, l, numSamples);
        song->audio.copyFrom (track.preFxBuffer * 2 + 1, 0, r, numSamples);
    }

    for (const auto& effect : track.effects)
    {
        // Its key, lined up with its sound (its source ran in an earlier stage, and nothing writes its taps after that).
        const auto [keyLeft, keyRight] = keyOf (effect, numSamples);
        if (effect.enabled && effect.plugin != nullptr)
            runEffect (*effect.plugin, effect.mix, l, r, numSamples, keyLeft, keyRight);
        else if (effect.eq != nullptr)
        {
            if (effect.enabled)
                runProQ (effect, l, r, numSamples, keyLeft, keyRight);
            else
                effect.eq->skipped();
        }
        else if (effect.gross != nullptr)
        {
            if (effect.enabled)
                runGrossBeat (effect, l, r, numSamples);
            else
                effect.gross->skipped();
        }
        else if (effect.tune != nullptr)
        {
            // Its mix is its own: the dry sound must wait as long as the tuned one.
            if (effect.enabled)
                effect.tune->process (*effect.tuneSettings, l, r, numSamples, effect.mix);
            else
                effect.tune->skipped();
        }
        else if (effect.wheel != nullptr)
        {
            // Its mix is its own too: the dry sound waits as long as the shifted one.
            if (effect.enabled)
                effect.wheel->process (*effect.wheelSettings, l, r, numSamples, effect.mix);
            else
                effect.wheel->skipped();
        }
        else if (effect.echo != nullptr)
        {
            if (effect.enabled)
                runEchoBoy (effect, l, r, numSamples);
            else
                effect.echo->skipped();
        }
        else if (effect.ott != nullptr)
        {
            if (effect.enabled)
                runOtt (effect, l, r, numSamples);
            else
                effect.ott->skipped();
        }
        else if (effect.comp != nullptr)
        {
            // Its mix is its own (the dry sound waits as long as its latency); its key may be another track's sound.
            if (effect.enabled)
                effect.comp->process (*effect.compSettings, grossClock, keyLeft, keyRight, l, r, numSamples, effect.mix);
            else
                effect.comp->skipped();
        }
        else if (effect.pan != nullptr)
        {
            if (effect.enabled)
                runPanMan (effect, l, r, numSamples);
            else
                effect.pan->skipped();
        }
    }

    // What its pre-fader sends take: the sound before its gains.
    if (track.preBuffer >= 0)
    {
        song->audio.copyFrom (track.preBuffer * 2, 0, l, numSamples);
        song->audio.copyFrom (track.preBuffer * 2 + 1, 0, r, numSamples);
    }

    // The fader, pan and mute: each side out from both sides in (gliding after a new song, or automated).
    glide = glide || track.automated;
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
    // Soloed out, its keys after its fader hear it through the gains it would have.
    if (track.keyFaderBuffer >= 0 && track.preBuffer >= 0)
    {
        const auto* inL = song->audio.getReadPointer (track.preBuffer * 2);
        const auto* inR = song->audio.getReadPointer (track.preBuffer * 2 + 1);
        auto* outL = song->audio.getWritePointer (track.keyFaderBuffer * 2);
        auto* outR = song->audio.getWritePointer (track.keyFaderBuffer * 2 + 1);
        const auto& g = track.keyGains;
        for (int i = 0; i < numSamples; ++i)
        {
            outL[i] = g[0] * inL[i] + g[1] * inR[i];
            outR[i] = g[2] * inL[i] + g[3] * inR[i];
        }
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

void Sequencer::runGrossBeat (const Song::Track::Effect& effect, float* left, float* right, int numSamples)
{
    auto& settings = *effect.grossSettings;
    auto& dry = settings.dry;
    if (numSamples > dry.getNumSamples())
        return;
    const auto mix = effect.mix;
    if (mix < 1.0f)
    {
        dry.copyFrom (0, 0, left, numSamples);
        dry.copyFrom (1, 0, right, numSamples);
    }
    effect.gross->process (settings, grossClock, left, right, numSamples);
    if (mix >= 1.0f)
        return;
    juce::FloatVectorOperations::multiply (left, mix, numSamples);
    juce::FloatVectorOperations::multiply (right, mix, numSamples);
    juce::FloatVectorOperations::addWithMultiply (left, dry.getReadPointer (0), 1.0f - mix, numSamples);
    juce::FloatVectorOperations::addWithMultiply (right, dry.getReadPointer (1), 1.0f - mix, numSamples);
}

void Sequencer::runEchoBoy (const Song::Track::Effect& effect, float* left, float* right, int numSamples)
{
    // Its own Mix is in it (dry and wet); the slot's mix is heard against the sound coming in, as a plugin's.
    const auto mix = effect.mix;
    auto& dry = effect.echoSettings->dryBuffer;
    if (mix < 1.0f && numSamples <= dry.getNumSamples())
    {
        dry.copyFrom (0, 0, left, numSamples);
        dry.copyFrom (1, 0, right, numSamples);
    }
    effect.echo->process (*effect.echoSettings, left, right, numSamples);
    if (mix >= 1.0f || numSamples > dry.getNumSamples())
        return;
    juce::FloatVectorOperations::multiply (left, mix, numSamples);
    juce::FloatVectorOperations::multiply (right, mix, numSamples);
    juce::FloatVectorOperations::addWithMultiply (left, dry.getReadPointer (0), 1.0f - mix, numSamples);
    juce::FloatVectorOperations::addWithMultiply (right, dry.getReadPointer (1), 1.0f - mix, numSamples);
}

void Sequencer::runOtt (const Song::Track::Effect& effect, float* left, float* right, int numSamples)
{
    // The slot's mix is heard against the sound coming in, as a plugin's (OTT has no latency to wait for).
    const auto mix = effect.mix;
    auto& dry = effect.ottSettings->dryBuffer;
    const auto blend = mix < 1.0f && numSamples <= dry.getNumSamples();
    if (blend)
    {
        dry.copyFrom (0, 0, left, numSamples);
        dry.copyFrom (1, 0, right, numSamples);
    }
    effect.ott->process (*effect.ottSettings, left, right, numSamples);
    if (! blend)
        return;
    juce::FloatVectorOperations::multiply (left, mix, numSamples);
    juce::FloatVectorOperations::multiply (right, mix, numSamples);
    juce::FloatVectorOperations::addWithMultiply (left, dry.getReadPointer (0), 1.0f - mix, numSamples);
    juce::FloatVectorOperations::addWithMultiply (right, dry.getReadPointer (1), 1.0f - mix, numSamples);
}

void Sequencer::runProQ (const Song::Track::Effect& effect, float* left, float* right, int numSamples, const float* keyLeft, const float* keyRight)
{
    auto& settings = *effect.eqSettings;
    auto& dry = settings.dry;
    if (numSamples > dry.getNumSamples())
        return;
    const auto mix = effect.mix;
    if (mix < 1.0f)
    {
        dry.copyFrom (0, 0, left, numSamples);
        dry.copyFrom (1, 0, right, numSamples);
    }
    effect.eq->process (settings, left, right, numSamples, true, keyLeft, keyRight);
    if (mix < 1.0f)
        effect.eq->mixDry (settings, left, right, dry.getReadPointer (0), dry.getReadPointer (1), numSamples, mix);
}

void Sequencer::setEqControl (eq::Settings& settings, int band, int control, float value)
{
    if (control == 4)
    {
        settings.output = juce::jlimit (-100.0, 72.0, (double) value);
        return;
    }
    if (control == 5)
    {
        settings.pan = juce::jlimit (-1.0, 1.0, (double) value);
        return;
    }
    auto* b = settings.find (band);
    if (b == nullptr)
        return;
    switch (control)
    {
        case 0: b->shape.frequency = juce::jlimit (10.0, 30000.0, std::exp2 ((double) value)); break;
        case 1: b->shape.gain = juce::jlimit (-60.0, 60.0, (double) value); break;
        case 2: b->shape.q = juce::jlimit (0.025, 40.0, std::exp2 ((double) value)); break;
        default: b->range = juce::jlimit (-60.0, 60.0, (double) value); break;
    }
}

void Sequencer::setGrossControl (gross::Settings& settings, int control, float value)
{
    const auto slot = juce::jlimit (0, gross::slots - 1, (int) std::lround (value));
    switch (control)
    {
        case 0: settings.timeSlot = slot; break;
        case 1: settings.volumeSlot = slot; break;
        case 2: settings.timeMix = juce::jlimit (0.0f, 1.0f, value); break;
        case 3: settings.volumeMix = juce::jlimit (0.0f, 1.0f, value); break;
        case 4: settings.attack = juce::jlimit (0.0, 0.5, (double) value); break;
        case 5: settings.release = juce::jlimit (0.0, 1.0, (double) value); break;
        default: settings.tension = juce::jlimit (-1.0, 1.0, (double) value); break;
    }
}

void Sequencer::runPanMan (const Song::Track::Effect& effect, float* left, float* right, int numSamples)
{
    auto& settings = *effect.panSettings;
    auto& dry = settings.dry;
    if (numSamples > dry.getNumSamples())
        return;
    const auto mix = effect.mix;
    if (mix < 1.0f)
    {
        dry.copyFrom (0, 0, left, numSamples);
        dry.copyFrom (1, 0, right, numSamples);
    }
    effect.pan->process (settings, grossClock, left, right, numSamples);
    if (mix >= 1.0f)
        return;
    juce::FloatVectorOperations::multiply (left, mix, numSamples);
    juce::FloatVectorOperations::multiply (right, mix, numSamples);
    juce::FloatVectorOperations::addWithMultiply (left, dry.getReadPointer (0), 1.0f - mix, numSamples);
    juce::FloatVectorOperations::addWithMultiply (right, dry.getReadPointer (1), 1.0f - mix, numSamples);
}

void Sequencer::setPanControl (panman::Settings& settings, int control, float value)
{
    switch (control)
    {
        // The offset and width as fractions of 105° and 210° (`PAN_LANE_SCALE`).
        case 0: settings.offset = juce::jlimit (-105.0, 105.0, value * 105.0); break;
        case 1: settings.width = juce::jlimit (0.0, 210.0, value * 210.0); break;
        case 2: settings.rate = juce::jlimit (0.001, 100.0, (double) value); break;
        case 3: settings.input = juce::jlimit (-60.0, 60.0, (double) value); break;
        case 4: settings.output = juce::jlimit (-60.0, 60.0, (double) value); break;
        case 5: settings.smoothing = juce::jlimit (0.0, 1.0, (double) value); break;
        case 6: settings.trigger = juce::jlimit (-60.0, 0.0, (double) value); break;
        case 7: settings.divider = juce::jlimit (1, 12, (int) std::lround (value)); break;
        // The cutoff in kHz; the mods as fractions of 105° and 210°.
        case 8: settings.cutoff = juce::jlimit (10.0, 40000.0, value * 1000.0); break;
        case 9: settings.filterGain = juce::jlimit (-40.0, 40.0, (double) value); break;
        case 10: settings.threshold = juce::jlimit (-60.0, 0.0, (double) value); break;
        case 11: settings.attack = juce::jlimit (0.0, 5.0, (double) value); break;
        case 12: settings.release = juce::jlimit (0.0, 5.0, (double) value); break;
        case 13: settings.offsetMod = juce::jlimit (-105.0, 105.0, value * 105.0); break;
        case 14: settings.widthMod = juce::jlimit (-210.0, 210.0, value * 210.0); break;
        case 15: settings.rateMod = juce::jlimit (-4.0, 4.0, (double) value); break;
        default: break;
    }
}

std::pair<const float*, const float*> Sequencer::keyOf (const Song::Track::Effect& effect, int numSamples)
{
    if (effect.keyTrack < 0 || effect.keyBuffer < 0)
        return { nullptr, nullptr };
    const auto& source = song->tracks[(size_t) effect.keyTrack];
    const auto pair = effect.keyTap == Song::Track::Tap::preFx       ? source.preFxBuffer
                      : effect.keyTap == Song::Track::Tap::postFx    ? source.preBuffer
                      : source.keyFaderBuffer >= 0                   ? source.keyFaderBuffer
                                                                     : source.buffer;
    if (pair < 0)
        return { nullptr, nullptr };
    const auto* tapLeft = song->audio.getReadPointer (pair * 2);
    const auto* tapRight = song->audio.getReadPointer (pair * 2 + 1);
    auto* line = effect.keyLine.get();
    if (line == nullptr)
        return { tapLeft, tapRight };
    // Earlier than the sound where the effect is: it waits in its delay line, into its own pair.
    line->clearInput (numSamples);
    juce::FloatVectorOperations::copy (line->inputLeft(), tapLeft, numSamples);
    juce::FloatVectorOperations::copy (line->inputRight(), tapRight, numSamples);
    auto* keyLeft = song->audio.getWritePointer (effect.keyBuffer * 2);
    auto* keyRight = song->audio.getWritePointer (effect.keyBuffer * 2 + 1);
    juce::FloatVectorOperations::clear (keyLeft, numSamples);
    juce::FloatVectorOperations::clear (keyRight, numSamples);
    line->flushInto (keyLeft, keyRight, numSamples);
    return { keyLeft, keyRight };
}

void Sequencer::runEffect (HostedPlugin& plugin, float mix, float* left, float* right, int numSamples, const float* keyLeft, const float* keyRight)
{
    if (numSamples > plugin.buffer.getNumSamples())
        return;
    juce::AudioBuffer<float> view (plugin.buffer.getArrayOfWritePointers(), plugin.buffer.getNumChannels(), numSamples);
    view.clear();
    view.copyFrom (0, 0, left, numSamples);
    view.copyFrom (1, 0, right, numSamples);
    // Its sidechain input (`configurePlugin` turned it on): the key, or silence without one.
    if (plugin.keyChannel >= 0 && keyLeft != nullptr)
        for (int c = 0; c < plugin.keyChannels && plugin.keyChannel + c < view.getNumChannels(); ++c)
            view.copyFrom (plugin.keyChannel + c, 0, c == 0 ? keyLeft : keyRight, numSamples);
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
    if (song->channels[(size_t) voice.channel].shaped)
        return renderShaped (voice, numSamples);
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
    // An automated channel's gains glide across the block.
    const auto noteLeft = voice.gain * voice.panLeft, noteRight = voice.gain * voice.panRight;
    const auto fromLeft = channel.ramp ? channel.fromLeft : channel.gainLeft, fromRight = channel.ramp ? channel.fromRight : channel.gainRight;
    const auto stepLeft = (channel.gainLeft - fromLeft) / (float) numSamples, stepRight = (channel.gainRight - fromRight) / (float) numSamples;
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

        const auto gainLeft = noteLeft * (fromLeft + stepLeft * (float) (i + 1)), gainRight = noteRight * (fromRight + stepRight * (float) (i + 1));
        left[i] += resampling::read (sourceLeft, length, voice.position, rate, quality) * gainLeft * level;
        right[i] += resampling::read (sourceRight, length, voice.position, rate, quality) * gainRight * level;
        voice.position += rate;
    }
}

void Sequencer::renderShaped (Voice& voice, int numSamples)
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
    const auto baseRate = voice.baseRate * std::pow (2.0, (double) (voice.pitch + channel.pitch) / 12.0);
    const auto perSecond = 1.0 / sampleRate;
    const auto tempo = song->tempo;
    const auto fromLeft = channel.ramp ? channel.fromLeft : channel.gainLeft, fromRight = channel.ramp ? channel.fromRight : channel.gainRight;
    const auto stepLeft = (channel.gainLeft - fromLeft) / (float) numSamples, stepRight = (channel.gainRight - fromRight) / (float) numSamples;
    const auto fadeLength = (float) juce::jmax (1, (int) (fadeSeconds * sampleRate));
    // Its loop, in the sample's samples; the crossfade over its last part, from as far back before its start.
    const auto loopStart = channel.loopStart * (double) length, loopEnd = juce::jmin ((double) last, channel.loopEnd * (double) length);
    const auto loopLength = juce::jmax (1.0, loopEnd - loopStart);
    const auto crossfade = channel.loopCrossfade * loopLength;
    // What changes with time (the envelopes, the LFOs, the filter's coefficients) is worked out every few samples.
    constexpr int chunk = 32;

    auto i = voice.delay;
    voice.delay = 0;
    while (i < numSamples)
    {
        auto n = juce::jmin (chunk, numSamples - i);
        if (voice.untilRelease > 0)
            n = (int) juce::jmin ((juce::int64) n, voice.untilRelease);
        if (voice.untilRelease == 0 && voice.released < 0)
            voice.released = (double) voice.elapsed * perSecond;
        const auto t0 = (double) voice.elapsed * perSecond, t1 = (double) (voice.elapsed + n) * perSecond, middle = (t0 + t1) / 2;
        const auto released = voice.released;
        if (channel.hasEnvelope && channel.envelope.over (t0, released))
        {
            voice.active = false;
            return;
        }
        auto level0 = channel.hasEnvelope ? channel.envelope.level (t0, released) : 1.0f;
        auto level1 = channel.hasEnvelope ? channel.envelope.level (t1, released) : 1.0f;
        // The volume's LFO dips it by up to its amount.
        if (channel.volumeLfo.enabled)
        {
            const auto depth = juce::jlimit (0.0f, 1.0f, channel.volumeLfo.amount);
            level0 *= 1.0f - depth * (1.0f - channel.volumeLfo.value (t0, tempo)) / 2.0f;
            level1 *= 1.0f - depth * (1.0f - channel.volumeLfo.value (t1, tempo)) / 2.0f;
        }
        const auto pan = juce::jlimit (-1.0f, 1.0f, voice.notePan + (channel.pan.any() ? channel.pan.at (middle, released, tempo) : 0.0f));
        const auto panLeft = juce::jmin (1.0f, 1.0f - pan), panRight = juce::jmin (1.0f, 1.0f + pan);
        const auto rate = channel.pitchMod.any() ? baseRate * std::exp2 ((double) channel.pitchMod.at (middle, released, tempo) * 24.0 / 12.0) : baseRate;
        // The filter (TPT state variable): its cutoff and resonance where their envelopes and LFOs have them now.
        float a1 = 0, a2 = 0, a3 = 0, k = 0;
        if (channel.filterType != 0)
        {
            const auto cutoff = juce::jlimit (0.0f, 1.0f, channel.filterCutoff + (channel.cutoff.any() ? channel.cutoff.at (middle, released, tempo) : 0.0f));
            const auto resonance = juce::jlimit (0.0f, 1.0f, channel.filterResonance + (channel.resonance.any() ? channel.resonance.at (middle, released, tempo) : 0.0f));
            const auto hz = juce::jmin (20.0 * std::pow (1000.0, (double) cutoff), 0.45 * sampleRate);
            const auto q = juce::MathConstants<double>::sqrt2 / 2.0 * std::exp2 (5.0 * (double) resonance);
            const auto g = (float) std::tan (juce::MathConstants<double>::pi * hz / sampleRate);
            k = (float) (1.0 / q);
            a1 = 1.0f / (1.0f + g * (g + k));
            a2 = g * a1;
            a3 = g * a2;
        }
        // It goes round its loop while held (and, with an envelope, through its release).
        const auto looping = voice.loops && (released < 0 || channel.hasEnvelope);

        for (int j = 0; j < n; ++j, ++i)
        {
            if (looping)
                while (voice.position >= loopEnd)
                    voice.position -= loopLength;
            if ((int) voice.position >= last)
            {
                voice.active = false;
                return;
            }
            float sample[2] = { resampling::read (sourceLeft, length, voice.position, rate, quality), resampling::read (sourceRight, length, voice.position, rate, quality) };
            if (looping && crossfade > 0 && voice.position > loopEnd - crossfade)
            {
                const auto w = (float) ((voice.position - (loopEnd - crossfade)) / crossfade);
                const auto back = juce::jmax (0.0, voice.position - loopLength);
                sample[0] = sample[0] * (1.0f - w) + resampling::read (sourceLeft, length, back, rate, quality) * w;
                sample[1] = sample[1] * (1.0f - w) + resampling::read (sourceRight, length, back, rate, quality) * w;
            }
            if (channel.filterType != 0)
                for (int side = 0; side < 2; ++side)
                {
                    const auto v0 = sample[side];
                    const auto v3 = v0 - voice.filterB[side];
                    const auto v1 = a1 * voice.filterA[side] + a2 * v3;
                    const auto v2 = voice.filterB[side] + a2 * voice.filterA[side] + a3 * v3;
                    voice.filterA[side] = 2.0f * v1 - voice.filterA[side];
                    voice.filterB[side] = 2.0f * v2 - voice.filterB[side];
                    sample[side] = channel.filterType == 1 ? v2 : channel.filterType == 2 ? v1 : v0 - k * v1 - v2;
                }
            auto level = level0 + (level1 - level0) * (float) (j + 1) / (float) n;
            if (voice.fade >= 0 && voice.fadeWait > 0)
                --voice.fadeWait;
            else if (voice.fade >= 0)
            {
                if (voice.fade == 0)
                {
                    voice.active = false;
                    return;
                }
                level *= (float) voice.fade-- / fadeLength;
            }
            const auto gainLeft = voice.gain * panLeft * (fromLeft + stepLeft * (float) (i + 1)), gainRight = voice.gain * panRight * (fromRight + stepRight * (float) (i + 1));
            left[i] += sample[0] * gainLeft * level;
            right[i] += sample[1] * gainRight * level;
            voice.position += rate;
        }
        voice.elapsed += n;
        if (voice.untilRelease > 0)
            voice.untilRelease -= n;
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
        const auto* outLeft = plugin.buffer.getReadPointer (0);
        const auto* outRight = plugin.buffer.getReadPointer (plugin.buffer.getNumChannels() > 1 && plugin.instance->getTotalNumOutputChannels() > 1 ? 1 : 0);
        if (! channel.ramp)
        {
            juce::FloatVectorOperations::addWithMultiply (left, outLeft, channel.gainLeft, numSamples);
            juce::FloatVectorOperations::addWithMultiply (right, outRight, channel.gainRight, numSamples);
            continue;
        }
        // Automated: its gains glide across the block.
        const auto stepLeft = (channel.gainLeft - channel.fromLeft) / (float) numSamples, stepRight = (channel.gainRight - channel.fromRight) / (float) numSamples;
        for (int i = 0; i < numSamples; ++i)
        {
            left[i] += outLeft[i] * (channel.fromLeft + stepLeft * (float) (i + 1));
            right[i] += outRight[i] * (channel.fromRight + stepRight * (float) (i + 1));
        }
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
