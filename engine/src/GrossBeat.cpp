#include "GrossBeat.h"

#include <algorithm>
#include <cmath>

namespace gross
{
namespace
{
double number (const juce::var& v, double fallback, double low, double high)
{
    if (! (v.isDouble() || v.isInt() || v.isInt64()))
        return fallback;
    const auto value = (double) v;
    return std::isfinite (value) ? juce::jlimit (low, high, value) : fallback;
}

/** Click reduction's fade across a jump: 3 ms. */
constexpr double fadeSeconds = 0.003;
/**
 * How far (samples) the read position may move from one sample to the next beyond how it moved the
 * sample before, and still be one path: more is a jump (a step in the envelope, a slot changing, HOLD).
 */
constexpr double jumpSamples = 16.0;
/** The scratching clock's hand is followed this quickly (seconds): smooth, but close behind. */
constexpr double scratchSeconds = 0.012;
/** Remove DC offset's high-pass: below this (Hz) goes. */
constexpr double dcHz = 10.0;
/** As the sequencer schedules notes: a tick a hair early is on it (the position gathers rounding). */
constexpr double tickSlack = 1e-6;

Envelope parseEnvelope (const juce::var& json)
{
    Envelope envelope;
    const auto* ticks = json["ticks"].getArray();
    const auto* values = json["values"].getArray();
    if (ticks == nullptr || values == nullptr || ticks->isEmpty() || ticks->size() != values->size())
        return envelope;
    envelope.ticks.reserve ((size_t) ticks->size());
    envelope.values.reserve ((size_t) values->size());
    auto last = 0.0;
    for (const auto& tick : *ticks)
        envelope.ticks.push_back (last = juce::jmax (last, number (tick, last, 0, 1e6)));
    for (const auto& value : *values)
        envelope.values.push_back ((float) number (value, 0, -64, 64));
    return envelope;
}

int slotOf (const juce::var& v) { return (int) number (v, 0, 0, slots - 1); }

/** A modulo that's never negative. */
double wrap (double x, double length) { return length > 0 ? x - std::floor (x / length) * length : 0; }
} // namespace

float Envelope::at (double tick, size_t& cursor) const
{
    const auto count = ticks.size();
    if (count == 0)
        return 0.0f;
    // Mostly forwards from the last lookup; back to the start when the bar goes round.
    if (cursor >= count || ticks[cursor] > tick)
        cursor = (size_t) juce::jmax (0, (int) (std::upper_bound (ticks.begin(), ticks.end(), tick) - ticks.begin()) - 1);
    while (cursor + 1 < count && ticks[cursor + 1] <= tick)
        ++cursor;
    if (cursor + 1 >= count || tick <= ticks[cursor])
        return values[cursor];
    const auto f = (float) ((tick - ticks[cursor]) / (ticks[cursor + 1] - ticks[cursor]));
    return values[cursor] + (values[cursor + 1] - values[cursor]) * f;
}

std::shared_ptr<Settings> Settings::parse (const juce::var& json, int capacity)
{
    auto s = std::make_shared<Settings>();
    s->timeSlot = slotOf (json["timeSlot"]);
    s->volumeSlot = slotOf (json["volumeSlot"]);
    s->timeMix = (float) number (json["timeMix"], 1, 0, 1);
    s->volumeMix = (float) number (json["volumeMix"], 1, 0, 1);
    s->attack = number (json["attack"], 0, 0, 0.5);
    s->release = number (json["release"], 0, 0, 1);
    s->tension = number (json["tension"], 0, -1, 1);
    s->oneShot = (bool) json["oneShot"];
    const auto hold = json["hold"].toString();
    s->hold = hold == "off" ? Hold::off : hold == "next" ? Hold::next : Hold::last;
    s->trigSync = number (json["trigSync"], 24, 0, 1e6);
    s->posSync = number (json["posSync"], 384, 0, 1e6);
    s->ticks = number (json["ticks"], 384, 1, 1e6);
    s->depth = number (json["depth"], 8, 0, 64);
    s->clickReduction = ! json.hasProperty ("clickReduction") || (bool) json["clickReduction"];
    s->attackCompensation = (bool) json["attackCompensation"];
    s->removeDc = (bool) json["removeDc"];
    s->hq = (bool) json["hq"];
    const auto envelopes = [] (const juce::var& list, std::array<Envelope, slots>& into) {
        if (const auto* items = list.getArray())
            for (int i = 0; i < slots && i < items->size(); ++i)
                if ((*items)[i].isObject())
                    into[(size_t) i] = parseEnvelope ((*items)[i]);
    };
    envelopes (json["time"], s->time);
    envelopes (json["volume"], s->volume);
    s->dry.setSize (2, juce::jmax (1, capacity));
    return s;
}

State::State (double sampleRate, int capacity) : rate (sampleRate)
{
    auto size = (juce::uint64) 1;
    while (size < (juce::uint64) juce::jmax (1, capacity))
        size <<= 1;
    mask = size - 1;
    for (auto& side : buffer)
        side.assign ((size_t) size, 0.0f);
    fadeLength = juce::jmax (1, (int) std::lround (fadeSeconds * rate));
}

void State::start (int kind, int slot, double songTick, const Settings& s)
{
    auto& k = kinds[(size_t) kind];
    k.playing = slot;
    k.queued = -1;
    k.elapsed = 0;
    k.cursor = 0;
    // POS SYNC: the envelope starts where the song is inside its length (on the grid, so a bar of it lines
    // up with the bars); off, from its start.
    k.anchor = s.posSync > 0 ? std::floor (songTick / s.posSync + 1e-9) * s.posSync : songTick;
}

void State::restart (const Settings& s, const Clock& clock)
{
    // The buffer starts afresh: what's before play is silence (the safety line).
    validFrom = written + 1;
    start (0, s.timeSlot, clock.tick, s);
    start (1, s.volumeSlot, clock.tick, s);
    kinds[0].asked = s.timeSlot;
    kinds[1].asked = s.volumeSlot;
    haveLast = justJumped = holding = false;
    fadeLeft = 0;
    level = -1;
}

float State::read (int side, double position, double speed, bool hq) const
{
    const auto index = (juce::int64) std::floor (position);
    const auto t = position - (double) index;
    if (! hq)
    {
        if (t == 0.0)
            return sampleAt (side, index);
        const auto y0 = sampleAt (side, index - 1), y1 = sampleAt (side, index), y2 = sampleAt (side, index + 1), y3 = sampleAt (side, index + 2);
        const auto f = (float) t;
        const auto c1 = 0.5f * (y2 - y0);
        const auto c2 = y0 - 2.5f * y1 + 2.0f * y2 - 0.5f * y3;
        const auto c3 = 0.5f * (y3 - y0) + 1.5f * (y1 - y2);
        return ((c3 * f + c2) * f + c1) * f + y1;
    }
    // HQ: the engine's windowed sinc, its cutoff lowered as the sound is played faster (no aliasing).
    if (t == 0.0 && speed <= 1.0)
        return sampleAt (side, index);
    const auto& kernel = resampling::Kernel::get();
    const auto fc = resampling::cutoff (juce::jmax (1.0, speed));
    const auto half = resampling::zeroCrossings / fc;
    double sum = 0;
    for (auto i = (juce::int64) std::ceil (position - half); i <= (juce::int64) std::floor (position + half); ++i)
        sum += sampleAt (side, i) * kernel.at (((double) i - position) * fc);
    return (float) (sum * fc);
}

void State::process (Settings& s, const Clock& clock, float* left, float* right, int numSamples)
{
    if (clock.playing && (clock.started || ! wasPlaying))
        restart (s, clock);
    wasPlaying = clock.playing;

    const auto tps = clock.ticksPerSample;
    const auto samplesPerBeat = tps > 0 ? clock.ppq / tps : rate;
    // Never further back than the buffer holds (with room for reading round the position).
    const auto deepest = -(double) (mask - 256);
    const auto scratchTarget = (double) scratch.load (std::memory_order_relaxed);
    const auto scratchStep = 1.0 - std::exp (-1.0 / (scratchSeconds * rate));
    const auto holdAsked = clock.playing && s.hold != Hold::off && hold.load (std::memory_order_relaxed);
    // ATT and REL: a full rise takes the attack time, a fall the release time, whatever the tension;
    // the tension bends the way there (`step` is `rate * distance^-tension`, which covers 0..1 in the time).
    const auto tension = juce::jlimit (-0.9, 0.9, s.tension);
    const auto attackRate = s.attack > 0 ? 1.0 / (s.attack * rate * (1.0 + tension)) : 0.0;
    const auto releaseRate = s.release > 0 ? 1.0 / (s.release * rate * (1.0 + tension)) : 0.0;
    const auto dcPole = 1.0f - (float) (juce::MathConstants<double>::twoPi * dcHz / rate);
    const auto loopLength = clock.loopEnd - clock.loopStart;

    for (int i = 0; i < numSamples; ++i)
    {
        ++written;
        const auto at = (size_t) (written & (juce::int64) mask);
        buffer[0][at] = left[i];
        buffer[1][at] = right[i];

        auto offset = 0.0;
        auto target = 1.0;
        if (clock.playing)
        {
            // This sample's tick, from the block's start (not added up sample by sample, which drifts).
            auto songTick = clock.tick + i * tps + tickSlack;
            if (clock.loops && songTick >= clock.loopEnd && loopLength > 0)
                songTick = clock.loopStart + wrap (songTick - clock.loopStart, loopLength);
            for (int kind = 0; kind < 2; ++kind)
            {
                auto& k = kinds[(size_t) kind];
                const auto asked = juce::jlimit (0, slots - 1, kind == 0 ? s.timeSlot : s.volumeSlot);
                // A slot picked (or automated): it starts on TRIG SYNC's next point, or at once.
                if (asked != k.asked)
                {
                    k.asked = asked;
                    if (asked != k.playing || k.queued >= 0)
                    {
                        k.queued = asked;
                        k.wait = s.trigSync > 0 ? std::ceil (songTick / s.trigSync - 1e-9) * s.trigSync - songTick : 0;
                    }
                }
                if (k.queued >= 0)
                {
                    if (k.wait <= 1e-9)
                        start (kind, k.queued, songTick + k.wait, s);
                    else
                        k.wait -= tps;
                }
                // One-shot: once round, then slot 1.
                else if (s.oneShot && k.playing != 0 && k.elapsed >= s.ticks)
                    start (kind, 0, songTick - (k.elapsed - s.ticks), s);
                k.phase = wrap (songTick - k.anchor, s.ticks);
                k.elapsed += tps;
            }

            auto& time = kinds[0];
            const auto& timeEnvelope = s.time[(size_t) time.playing];
            const auto beats = (timeEnvelope.empty() ? 0.0 : (double) timeEnvelope.at (time.phase, time.cursor)) * s.timeMix;
            offset = beats * samplesPerBeat;
            // What a jump lands on is read the attack time earlier, so it's heard once the volume is back.
            if (s.attackCompensation && beats < -1e-6)
                offset -= s.attack * rate;

            auto& volume = kinds[1];
            const auto& volumeEnvelope = s.volume[(size_t) volume.playing];
            const auto v = volumeEnvelope.empty() ? 1.0 : juce::jlimit (0.0, 1.0, (double) volumeEnvelope.at (volume.phase, volume.cursor));
            target = 1.0 - s.volumeMix + s.volumeMix * v;

            // HOLD: a bar of what came in, again and again while it's held (Last: the bar just played;
            // Next: the bar from now, once it's been heard).
            if (holdAsked && ! holding)
            {
                holding = true;
                holdStart = written;
                holdLength = juce::jmax ((juce::int64) 1, (juce::int64) std::llround (s.ticks / juce::jmax (1e-9, tps)));
            }
            if (holding)
            {
                const auto since = written - holdStart;
                if (s.hold == Hold::last)
                    offset = (double) (holdStart - holdLength + since % holdLength - written);
                else if (since >= holdLength)
                    offset = (double) (holdStart + since % holdLength - written);
            }

        }
        if (! holdAsked)
            holding = false;

        // The scratching clock, followed smoothly (a hand on a record).
        scratchNow += (scratchTarget - scratchNow) * scratchStep;
        offset = juce::jlimit (deepest, 0.0, offset + scratchNow * samplesPerBeat);

        const auto position = (double) written + offset;
        const auto step = haveLast ? position - lastRead : 1.0;
        if (haveLast && ! justJumped && std::abs (step - lastStep) > jumpSamples)
        {
            // A jump: the old path fades out across the new one (click reduction).
            if (s.clickReduction)
            {
                fadeRead = lastRead + lastStep;
                fadeStep = lastStep;
                fadeLeft = fadeLength;
            }
            justJumped = true;
        }
        else
        {
            justJumped = false;
            lastStep = step;
        }
        lastRead = position;
        haveLast = true;

        const auto speed = std::abs (justJumped ? 1.0 : step);
        auto outLeft = read (0, position, speed, s.hq);
        auto outRight = read (1, position, speed, s.hq);
        if (fadeLeft > 0)
        {
            // Equal power: the two paths aren't the same sound.
            const auto x = (float) fadeLeft / (float) fadeLength * juce::MathConstants<float>::halfPi;
            const auto old = std::sin (x), fresh = std::cos (x);
            const auto oldSpeed = std::abs (fadeStep);
            outLeft = outLeft * fresh + read (0, fadeRead, oldSpeed, s.hq) * old;
            outRight = outRight * fresh + read (1, fadeRead, oldSpeed, s.hq) * old;
            fadeRead += fadeStep;
            --fadeLeft;
        }

        // The volume, smoothed towards its envelope (from where it is at once, after play starts).
        if (level < 0)
            level = target;
        else if (level != target)
        {
            const auto rising = target > level;
            const auto rateNow = rising ? attackRate : releaseRate;
            const auto distance = std::abs (target - level);
            const auto move = rateNow <= 0 ? distance : rateNow * (tension == 0 ? 1.0 : std::pow (juce::jmax (distance, 1e-6), -tension));
            level = rising ? juce::jmin (target, level + move) : juce::jmax (target, level - move);
        }
        outLeft *= (float) level;
        outRight *= (float) level;

        if (s.removeDc)
        {
            const auto l = outLeft, r = outRight;
            outLeft = l - dcIn[0] + dcPole * dcOut[0];
            outRight = r - dcIn[1] + dcPole * dcOut[1];
            dcIn = { l, r };
            dcOut = { outLeft, outRight };
        }
        left[i] = outLeft;
        right[i] = outRight;
    }

    saidTime.store (kinds[0].playing, std::memory_order_relaxed);
    saidVolume.store (kinds[1].playing, std::memory_order_relaxed);
    saidQueuedTime.store (kinds[0].queued, std::memory_order_relaxed);
    saidQueuedVolume.store (kinds[1].queued, std::memory_order_relaxed);
    saidTimeTick.store ((float) kinds[0].phase, std::memory_order_relaxed);
    saidVolumeTick.store ((float) kinds[1].phase, std::memory_order_relaxed);
    saidHolding.store (holding, std::memory_order_relaxed);
}

juce::var State::describe() const
{
    const auto queued = [] (int slot) { return slot < 0 ? juce::var() : juce::var (slot); };
    auto* object = new juce::DynamicObject();
    object->setProperty ("time", saidTime.load());
    object->setProperty ("volume", saidVolume.load());
    object->setProperty ("queuedTime", queued (saidQueuedTime.load()));
    object->setProperty ("queuedVolume", queued (saidQueuedVolume.load()));
    object->setProperty ("timeTick", saidTimeTick.load());
    object->setProperty ("volumeTick", saidVolumeTick.load());
    object->setProperty ("holding", saidHolding.load());
    return juce::var (object);
}

std::shared_ptr<State> Registry::get (const juce::String& effectId, double sampleRate, double seconds)
{
    const auto capacity = (int) std::ceil (seconds * sampleRate) + 1024;
    auto& state = states[effectId];
    if (state == nullptr || state->sampleRate() != sampleRate || state->capacity() < capacity)
        state = std::make_shared<State> (sampleRate, capacity);
    return state;
}

void Registry::keepOnly (const juce::StringArray& ids)
{
    for (auto it = states.begin(); it != states.end();)
        it = ids.contains (it->first) ? std::next (it) : states.erase (it);
}

std::shared_ptr<State> Registry::find (const juce::String& effectId) const
{
    const auto it = states.find (effectId);
    return it == states.end() ? nullptr : it->second;
}

juce::var Registry::describe() const
{
    auto* object = new juce::DynamicObject();
    for (const auto& [id, state] : states)
        object->setProperty (id, state->describe());
    return juce::var (object);
}
} // namespace gross
