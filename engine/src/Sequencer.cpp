#include "Sequencer.h"

#include <cmath>

namespace
{
/** How long a voice takes to fade when it's silenced, so stopping doesn't click. */
constexpr double fadeSeconds = 0.004;
constexpr float clickGain = 0.3f;
constexpr double clickSeconds = 0.025;
/**
 * Ticks (a fraction of a millionth of a sample's worth): a note that falls exactly on the edge of a
 * block must land in one block or the other, not in whichever the rounding of the position picks.
 */
constexpr double tickSlack = 1e-6;
}

Sequencer::~Sequencer()
{
    delete song;
    delete pending.exchange (nullptr);
    collectGarbage();
}

void Sequencer::prepare (double rate) { sampleRate = rate > 0 ? rate : 48000.0; }

// Message thread -------------------------------------------------------------

void Sequencer::setSong (std::unique_ptr<Song> next)
{
    channelIds.clear();
    for (const auto& channel : next->channels)
        channelIds.add (channel.id);
    // One still waiting was never played: it's ours to delete.
    delete pending.exchange (next.release());
}

void Sequencer::play() { ++playRequests; }
void Sequencer::stop() { ++stopRequests; }

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

void Sequencer::collectGarbage()
{
    const auto scope = garbageQueue.read (garbageQueue.getNumReady());
    for (int i = 0; i < scope.blockSize1; ++i)
        delete garbage[(size_t) (scope.startIndex1 + i)];
    for (int i = 0; i < scope.blockSize2; ++i)
        delete garbage[(size_t) (scope.startIndex2 + i)];
}

// Audio thread ---------------------------------------------------------------

void Sequencer::adopt (Song* next)
{
    // Voices follow their channel to its new place in the rack, or end with it.
    for (auto& voice : voices)
    {
        if (! voice.active)
            continue;
        const auto channel = song != nullptr ? next->channelIndex (song->channels[(size_t) voice.channel].id) : -1;
        if (channel < 0)
            voice.active = false;
        else
            voice.channel = channel;
    }
    if (position_ >= next->loopTicks)
        position_ = std::fmod (position_, next->loopTicks);

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
            voice.fade = fade;
    click.level = 0;
    click.delay = -1;
}

void Sequencer::process (float* left, float* right, int numSamples)
{
    if (auto* next = pending.exchange (nullptr))
        adopt (next);

    if (const auto stops = stopRequests.load(); stops != stopsSeen)
    {
        stopsSeen = stops;
        playing = false;
        position_ = 0;
        silenceVoices();
    }
    if (const auto plays = playRequests.load(); plays != playsSeen)
    {
        playsSeen = plays;
        if (! playing)
        {
            playing = true;
            position_ = 0;
        }
    }

    if (song != nullptr)
    {
        const auto scope = triggerQueue.read (triggerQueue.getNumReady());
        for (int i = 0; i < scope.blockSize1 + scope.blockSize2; ++i)
        {
            const auto& trigger = triggers[(size_t) (i < scope.blockSize1 ? scope.startIndex1 + i : scope.startIndex2 + i - scope.blockSize1)];
            startVoice (trigger.channel, trigger.pitch, trigger.gain, -1, 0);
        }

        if (playing)
            schedule (numSamples);
        for (auto& voice : voices)
            if (voice.active)
                render (voice, left, right, numSamples);
    }
    renderClick (left, right, numSamples);

    playingNow = playing;
    positionNow = position_;
}

void Sequencer::schedule (int numSamples)
{
    const auto ticksPerSample = song->tempo * song->ppq / (60.0 * sampleRate);
    const auto loop = song->loopTicks;
    for (int offset = 0; offset < numSamples;)
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
    from -= tickSlack;
    to -= tickSlack;

    auto note = std::lower_bound (song->notes.begin(), song->notes.end(), from, [] (const Song::Note& n, double tick) { return n.tick < tick; });
    for (; note != song->notes.end() && note->tick < to; ++note)
        startVoice (note->channel, note->pitch, note->gain, note->length, at (note->tick));

    if (metronome)
        for (auto beat = std::ceil (from / song->beatTicks) * song->beatTicks; beat < to; beat += song->beatTicks)
        {
            click.delay = at (beat);
            click.frequency = std::fmod (beat, song->barTicks) < 0.5 ? 1760.0 : 1175.0;
        }
}

void Sequencer::startVoice (int channelIndex, float pitch, float gain, double lengthTicks, int delay)
{
    if (channelIndex < 0 || channelIndex >= (int) song->channels.size())
        return;
    const auto& channel = song->channels[(size_t) channelIndex];
    if (channel.sample == nullptr || channel.sample->audio.getNumSamples() == 0)
        return;

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
    voice->delay = delay;
    voice->age = ++voiceCount;
    voice->level = channel.hasEnvelope && channel.envelope.attack > 0 ? 0.0f : 1.0f;
    if (lengthTicks >= 0)
        voice->untilRelease = (juce::int64) (lengthTicks * 60.0 * sampleRate / (song->tempo * song->ppq));
}

void Sequencer::render (Voice& voice, float* left, float* right, int numSamples)
{
    const auto& channel = song->channels[(size_t) voice.channel];
    const auto& audio = voice.sample->audio;
    const auto* sourceLeft = audio.getReadPointer (0);
    const auto* sourceRight = audio.getReadPointer (audio.getNumChannels() > 1 ? 1 : 0);
    const auto last = audio.getNumSamples() - 1;
    const auto rate = voice.baseRate * std::pow (2.0, (double) (voice.pitch + channel.pitch) / 12.0);
    const auto gainLeft = voice.gain * channel.gainLeft, gainRight = voice.gain * channel.gainRight;
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

        if (voice.fade >= 0)
        {
            if (voice.fade == 0)
            {
                voice.active = false;
                return;
            }
            level *= (float) voice.fade-- / fadeLength;
        }

        const auto fraction = (float) (voice.position - index);
        left[i] += (sourceLeft[index] + (sourceLeft[index + 1] - sourceLeft[index]) * fraction) * gainLeft * level;
        right[i] += (sourceRight[index] + (sourceRight[index + 1] - sourceRight[index]) * fraction) * gainRight * level;
        voice.position += rate;
    }
}

void Sequencer::renderClick (float* left, float* right, int numSamples)
{
    auto start = 0;
    if (click.delay >= 0)
    {
        start = juce::jmin (click.delay, numSamples);
        click.delay = -1;
        click.level = 1.0f;
        click.phase = 0;
    }
    if (click.level <= 0.0001f)
        return;
    const auto decay = (float) std::exp (-1.0 / (clickSeconds * sampleRate));
    for (int i = start; i < numSamples; ++i)
    {
        const auto sample = clickGain * click.level * (float) std::sin (click.phase * juce::MathConstants<double>::twoPi);
        left[i] += sample;
        right[i] += sample;
        click.phase += click.frequency / sampleRate;
        click.level *= decay;
    }
}
