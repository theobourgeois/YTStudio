#include "PitchWheel.h"

#include <algorithm>
#include <cmath>

namespace wheel
{
namespace
{
constexpr double twoPi = juce::MathConstants<double>::twoPi;
constexpr double pi = juce::MathConstants<double>::pi;
/** How far the actual pitch (and timbre) can go, either way: `MAX_SWING`. */
constexpr double maxSwing = 48;
/** A voice's gate opens and closes over this long: no clicks. */
constexpr double gateSeconds = 0.003;
/** How long the hand's pointer holds after its last word. */
constexpr double holdSeconds = 0.25;
/** Onsets reset the phases of what's above this (a bass under a drum keeps its continuity). */
constexpr double resetAboveHz = 250;
/** The band whose energy jumping says a drum hit. */
constexpr double onsetAboveHz = 1500;
/** An envelope moves a bin's level by this much at most (24 dB either way). */
constexpr double maxEnvelopeLog = 2.7631; // ln 15.85

double number (const juce::var& v, double fallback, double low, double high)
{
    if (! (v.isDouble() || v.isInt() || v.isInt64()))
        return fallback;
    const auto x = (double) v;
    return std::isfinite (x) ? juce::jlimit (low, high, x) : fallback;
}

juce::uint64 powerOfTwoAbove (juce::int64 n)
{
    juce::uint64 size = 1;
    while ((juce::int64) size < n)
        size <<= 1;
    return size;
}

int log2Of (int n)
{
    int order = 0;
    while ((1 << order) < n)
        ++order;
    return order;
}

double wrap (double phase)
{
    return phase - twoPi * std::floor ((phase + pi) / twoPi);
}

WheelSettings parseWheel (const juce::var& json, double fallbackTarget)
{
    WheelSettings w;
    w.target = number (json["target"], fallbackTarget, -maxSwing, maxSwing);
    w.gravity = number (json["gravity"], 0.75, 0, 1);
    w.inertia = number (json["inertia"], 0.45, 0, 1);
    w.smooth = number (json["smooth"], 0.1, 0, 1);
    return w;
}
} // namespace

// ---------------------------------------------------------------------------------------------------------
// Settings and physics
// ---------------------------------------------------------------------------------------------------------

std::shared_ptr<Settings> Settings::parse (const juce::var& json)
{
    auto s = std::make_shared<Settings>();
    s->pitch = parseWheel (json["pitch"], 0);
    s->timbre = parseWheel (json["timbre"], 0);
    s->timbreOn = ! json["timbreOn"].isBool() || (bool) json["timbreOn"];
    s->multi = (bool) json["multi"];
    s->notesFrom = json["notesFrom"].isString() ? json["notesFrom"].toString() : juce::String();
    s->origin = (int) number (json["origin"], 60, 0, 127);
    s->window = number (json["window"], 2048, 0, 1e6) > 3000 ? 4096 : 2048;
    return s;
}

void Settings::setControl (int control, float value)
{
    const auto unit = juce::jlimit (0.0, 1.0, (double) value);
    switch (control)
    {
        case 0: pitch.target = juce::jlimit (-maxSwing, maxSwing, (double) value); break;
        case 1: timbre.target = juce::jlimit (-maxSwing, maxSwing, (double) value); break;
        case 2: pitch.gravity = unit; break;
        case 3: pitch.inertia = unit; break;
        case 4: pitch.smooth = unit; break;
        case 5: timbre.gravity = unit; break;
        case 6: timbre.inertia = unit; break;
        default: timbre.smooth = unit; break;
    }
}

void Physics::update (const WheelSettings& w, double sampleRate)
{
    if (juce::exactlyEqual (w.gravity, gravity) && juce::exactlyEqual (w.inertia, inertia) && juce::exactlyEqual (w.smooth, smooth))
        return;
    gravity = w.gravity;
    inertia = w.inertia;
    smooth = w.smooth;
    // `wheelPhysics` (shared/music/pitch-wheel.ts), for a step of one sample.
    const auto dt = 1.0 / sampleRate;
    const auto tau = 1.5 * smooth * smooth;
    const auto natural = 30.0 * std::pow (0.25 / 30.0, inertia);
    const auto omega = twoPi * natural * (1 + 40 * std::pow (gravity, 4.0));
    const auto zeta = juce::jmin (1.0, 0.02 + 1.5 * gravity * gravity);
    follow = tau > 0 ? 1 - std::exp (-dt / tau) : 1;
    clamped = gravity >= 0.999;
    const auto decay = std::exp (-zeta * omega * dt);
    if (zeta >= 0.9999)
    {
        ee = decay * (1 + omega * dt);
        ev = decay * dt;
        ve = -decay * omega * omega * dt;
        vv = decay * (1 - omega * dt);
    }
    else
    {
        const auto wd = omega * std::sqrt (1 - zeta * zeta);
        const auto c = std::cos (wd * dt), s = std::sin (wd * dt);
        ee = decay * (c + zeta * omega / wd * s);
        ev = decay * s / wd;
        ve = -decay * omega * omega / wd * s;
        vv = decay * (c - zeta * omega / wd * s);
    }
}

void Motion::step (double goal, const Physics& physics)
{
    target += (goal - target) * physics.follow;
    if (physics.clamped)
    {
        actual = juce::jlimit (-maxSwing, maxSwing, target);
        velocity = 0;
        return;
    }
    const auto e = actual - target;
    const auto e1 = physics.ee * e + physics.ev * velocity;
    velocity = physics.ve * e + physics.vv * velocity;
    actual = target + e1;
    if (std::abs (actual) > maxSwing)
    {
        actual = actual > 0 ? maxSwing : -maxSwing;
        velocity = 0;
    }
}

// ---------------------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------------------

State::State (double sampleRate, int requested, int capacity) : rate (sampleRate), requestedWindow (requested), blockCapacity (juce::jmax (1, capacity))
{
    // The window keeps its length in time: twice as many samples at 96 kHz, four times at 192.
    const auto scale = rate > 100000 ? 4 : rate > 50000 ? 2 : 1;
    size = requested * scale;
    fftSize = size * 2;
    hop = size / 8;
    bins = fftSize / 2 + 1;
    fft = std::make_unique<juce::dsp::FFT> (log2Of (fftSize));
    cepstrumFft = std::make_unique<juce::dsp::FFT> (log2Of (size));
    // A periodic Hann, for analysis and synthesis: eight overlapping, their squares add up to 3.
    hann.resize ((size_t) size);
    for (int n = 0; n < size; ++n)
        hann[(size_t) n] = (float) (0.5 - 0.5 * std::cos (twoPi * n / size));
    synthesisGain = 1.0f / 3.0f;

    inMask = powerOfTwoAbove (size + blockCapacity + hop + 8) - 1;
    for (auto& side : in)
        side.assign ((size_t) inMask + 1, 0.0f);
    outMask = inMask;
    historyMask = powerOfTwoAbove (size + 8) - 1;
    for (auto& side : spectra)
        side.assign ((size_t) fftSize * 2, 0.0f);
    for (auto& side : lastPhase)
        side.assign ((size_t) bins * 2, 0.0f);
    power.assign ((size_t) bins, 0.0f);
    peaks.reserve ((size_t) bins);
    regionLow.reserve ((size_t) bins);
    regionHigh.reserve ((size_t) bins);
    peakOmega.reserve ((size_t) bins);
    regionGains.reserve ((size_t) bins);
    logEnvelope.assign ((size_t) size / 2 + 1, 0.0f);
    logSpectrum.assign ((size_t) size / 2 + 1, 0.0f);
    cepstrum.assign ((size_t) size * 2, 0.0f);
    // The envelope's detail: a millisecond of quefrency (voices up to ~500 Hz don't show their harmonics in it).
    lifterLeast = (float) juce::jmax (8.0, 0.001 * rate);
    lifterMost = (float) juce::jmin (0.008 * rate, size / 2.0 - 2);
    lifter = lifterLeast;
    resetFrom = (int) std::ceil (resetAboveHz * fftSize / rate);
    holdSamples = (juce::int64) (holdSeconds * rate);
    for (auto& voice : voices)
    {
        voice.history.assign ((size_t) historyMask + 1, 0.0f);
        voice.thetaPrev.assign ((size_t) bins, 0.0f);
        voice.theta.assign ((size_t) bins, 0.0f);
        for (auto& side : voice.out)
            side.assign ((size_t) outMask + 1, 0.0f);
        for (auto& side : voice.spectrum)
            side.assign ((size_t) fftSize * 2, 0.0f);
    }
    for (auto& key : saidKeys)
        key = -1;
}

void State::reset (const Settings& settings)
{
    for (auto& side : in)
        std::fill (side.begin(), side.end(), 0.0f);
    for (auto& side : lastPhase)
        std::fill (side.begin(), side.end(), 0.0f);
    written = 0;
    highEnergy = highEnergyBefore = 0;
    sinceOnset = 1000;
    silent = true;
    base.restAt (settings.pitch.target);
    timbre.restAt (settings.timbre.target);
    numHeld = 0;
    lastOffset = 0;
    for (auto& voice : voices)
    {
        voice.active = false;
        for (auto& side : voice.out)
            std::fill (side.begin(), side.end(), 0.0f);
    }
    // Single's voice is always made (heard in Single, its gate shut in Multi), so the modes change over at once.
    wasMulti = settings.multi;
    startVoice (voices[0], -1, 0.78f, -never, settings.pitch.target);
    if (settings.multi)
        voices[0].offAt = -never;
    stale = false;
}

void State::startVoice (Voice& voice, int key, float velocity, juce::int64 at, double goal)
{
    voice.active = true;
    voice.key = key;
    voice.gain = juce::jlimit (0.0f, 1.28f, velocity / 0.78f);
    voice.onAt = at;
    voice.offAt = never;
    voice.age = ++voiceCount;
    // It starts where it's going (a chord's notes don't scoop in), as if it had always been there.
    voice.motion.restAt (goal);
    std::fill (voice.history.begin(), voice.history.end(), (float) goal);
    std::fill (voice.thetaPrev.begin(), voice.thetaPrev.end(), 0.0f);
    for (auto& side : voice.out)
        std::fill (side.begin(), side.end(), 0.0f);
}

void State::noteOn (int key, float velocity, int offset, juce::int64 length)
{
    if (numEvents < maxEvents)
        events[(size_t) numEvents++] = { juce::jmax (0, offset), juce::jlimit (0, 127, key), velocity, true, juce::jmax ((juce::int64) 1, length) };
}

void State::notesOff()
{
    // Every note ends where the block starts; Single's offset back to none.
    for (int i = 0; i < numHeld; ++i)
        for (auto& voice : voices)
            if (voice.active && voice.key == held[(size_t) i].key && voice.offAt > written)
                voice.offAt = written;
    numHeld = 0;
    lastOffset = 0;
    numEvents = 0;
}

void State::holdPitch (float semitones)
{
    handPitch = semitones;
    ++pitchHolds;
}

void State::holdTimbre (float semitones)
{
    handTimbre = semitones;
    ++timbreHolds;
}

void State::liveNote (int key, bool on)
{
    const auto scope = liveQueue.write (1);
    if (scope.blockSize1 > 0)
        liveNotes[(size_t) scope.startIndex1] = { juce::jlimit (0, 127, key), on };
}

double State::singleOffset() const
{
    return numHeld > 0 ? (double) (held[(size_t) numHeld - 1].key - origin) : lastOffset;
}

void State::release (int key, juce::int64 at)
{
    for (int i = 0; i < numHeld; ++i)
        if (held[(size_t) i].key == key)
        {
            // Single: the latest note let go leaves its offset (QuikQuak's Mono - Constant), until another.
            if (i == numHeld - 1)
                lastOffset = key - origin;
            std::move (held.begin() + i + 1, held.begin() + numHeld, held.begin() + i);
            --numHeld;
            break;
        }
    for (auto& voice : voices)
        if (voice.active && voice.key == key && voice.offAt > at)
            voice.offAt = at;
}

void State::press (const Event& event, const Settings& settings, juce::int64 at)
{
    // The same key held already: it ends where this one starts.
    release (event.key, at);

    if (numHeld == (int) held.size())
    {
        std::move (held.begin() + 1, held.end(), held.begin());
        --numHeld;
    }
    held[(size_t) numHeld++] = { event.key, event.velocity, event.length < 0 ? never : at + event.length };
    lastOffset = event.key - origin;
    if (! settings.multi)
        return;
    // Multi: a voice of its own (a free one, else the one that's been going longest). The first is Single's.
    Voice* voice = nullptr;
    for (size_t v = 1; v < voices.size() && voice == nullptr; ++v)
        if (! voices[v].active)
            voice = &voices[v];
    if (voice == nullptr)
    {
        voice = &voices[1];
        for (size_t v = 2; v < voices.size(); ++v)
            if (voices[v].age < voice->age)
                voice = &voices[v];
    }
    const auto wheelGoal = written < pitchHeldUntil ? (double) handPitch.load() : settings.pitch.target;
    voice->offset = event.key - settings.origin;
    startVoice (*voice, event.key, event.velocity, at, wheelGoal + voice->offset);
}

void State::process (Settings& settings, float* left, float* right, int numSamples, float mix)
{
    juce::ScopedNoDenormals noDenormals;
    origin = settings.origin;
    if (stale)
        reset (settings);
    if (numSamples > blockCapacity)
        return;
    if (settings.multi != wasMulti)
    {
        // Single <-> Multi: what's heard changes over now (a fade's length), not a window from now.
        wasMulti = settings.multi;
        const auto now = written - size;
        for (size_t v = 1; v < voices.size(); ++v)
            voices[v].offAt = juce::jmin (voices[v].offAt, now);
        if (settings.multi)
            voices[0].offAt = now;
        else
        {
            if (voices[0].offAt != never)
                voices[0].onAt = now;
            voices[0].offAt = never;
        }
    }
    pitchPhysics.update (settings.pitch, rate);
    timbrePhysics.update (settings.timbre, rate);
    if (const auto holds = pitchHolds.load(); holds != pitchHoldsSeen)
        pitchHoldsSeen = holds, pitchHeldUntil = written + holdSamples;
    if (const auto holds = timbreHolds.load(); holds != timbreHoldsSeen)
        timbreHoldsSeen = holds, timbreHeldUntil = written + holdSamples;

    // This block's notes: the sequencer's (`noteOn`), the hand's, and the ends of those held, in order.
    {
        const auto scope = liveQueue.read (liveQueue.getNumReady());
        for (int i = 0; i < scope.blockSize1 + scope.blockSize2 && numEvents < maxEvents; ++i)
        {
            const auto& [key, on] = liveNotes[(size_t) (i < scope.blockSize1 ? scope.startIndex1 + i : scope.startIndex2 + i - scope.blockSize1)];
            events[(size_t) numEvents++] = { 0, key, 0.78f, on, -1 };
        }
        std::stable_sort (events.begin(), events.begin() + numEvents, [] (const Event& a, const Event& b) { return a.offset < b.offset; });
    }
    int nextEvent = 0;

    const auto gate = juce::jmax ((juce::int64) 1, (juce::int64) (gateSeconds * rate));
    float peak = 0;
    for (int i = 0; i < numSamples; ++i)
    {
        // Notes ending here, then the block's notes starting (or let go by the hand) here.
        for (int h = numHeld - 1; h >= 0; --h)
            if (held[(size_t) h].endsAt <= written)
                release (held[(size_t) h].key, written);
        while (nextEvent < numEvents && events[(size_t) nextEvent].offset <= i)
        {
            const auto& event = events[(size_t) nextEvent++];
            if (event.on)
                press (event, settings, written);
            else
                release (event.key, written);
        }

        // The wheels: where the hand holds them, else where the song (or its automation) has them.
        const auto pitchGoal = written < pitchHeldUntil ? (double) handPitch.load (std::memory_order_relaxed) : settings.pitch.target;
        const auto timbreGoal = written < timbreHeldUntil ? (double) handTimbre.load (std::memory_order_relaxed) : settings.timbre.target;
        if (const auto j = jumps.load (std::memory_order_relaxed); j != jumpsSeen)
        {
            jumpsSeen = j;
            base.restAt (pitchGoal);
            timbre.restAt (timbreGoal);
            // As if they'd always been there: frames still to come for what's gone in hear them there too.
            for (auto& voice : voices)
                if (voice.active)
                {
                    voice.motion.restAt (pitchGoal + (voice.key < 0 ? singleOffset() : voice.offset));
                    std::fill (voice.history.begin(), voice.history.end(), (float) voice.motion.actual);
                }
        }
        base.step (pitchGoal, pitchPhysics);
        timbre.step (timbreGoal, timbrePhysics);
        const auto historyIndex = (size_t) (written & (juce::int64) historyMask);
        const auto single = numHeld > 0 ? (double) (held[(size_t) numHeld - 1].key - origin) : lastOffset;
        for (auto& voice : voices)
            if (voice.active)
            {
                voice.motion.step (pitchGoal + (voice.key < 0 ? single : voice.offset), pitchPhysics);
                voice.history[historyIndex] = (float) voice.motion.actual;
            }

        // The input in; a frame each hop.
        const auto index = (size_t) (written & (juce::int64) inMask);
        in[0][index] = left[i];
        in[1][index] = right[i];
        peak = juce::jmax (peak, std::abs (left[i]), std::abs (right[i]));
        ++written;
        if (written % hop == 0)
            frame (settings);

        // Out: the voices, a window late, each through its gate; the dry sound as late, for the mix.
        const auto at = written - 1 - size;
        const auto o = (size_t) (at & (juce::int64) outMask);
        float wetLeft = 0, wetRight = 0;
        for (auto& voice : voices)
        {
            if (! voice.active)
                continue;
            auto level = voice.gain;
            if (at < voice.onAt)
                level = 0;
            else if (at - voice.onAt < gate)
                level *= (float) (at - voice.onAt) / (float) gate;
            if (at >= voice.offAt)
                level *= juce::jmax (0.0f, 1.0f - (float) (at - voice.offAt) / (float) gate);
            wetLeft += voice.out[0][o] * level;
            wetRight += voice.out[1][o] * level;
            voice.out[0][o] = voice.out[1][o] = 0.0f;
            // Its gate shut: done.
            if (voice.key >= 0 && at >= voice.offAt + gate)
                voice.active = false;
        }
        const auto dryLeft = at >= 0 ? in[0][o] : 0.0f, dryRight = at >= 0 ? in[1][o] : 0.0f;
        left[i] = mix >= 1.0f ? wetLeft : wetLeft * mix + dryLeft * (1.0f - mix);
        right[i] = mix >= 1.0f ? wetRight : wetRight * mix + dryRight * (1.0f - mix);
    }
    numEvents = 0;

    // What it says.
    inputPeak = juce::jmax (peak, inputPeak * std::pow (0.5f, (float) numSamples / (float) (0.05 * rate)));
    saidInput.store (inputPeak, std::memory_order_relaxed);
    saidPitch.store ((float) (settings.multi ? base.actual : voices[0].motion.actual), std::memory_order_relaxed);
    saidTimbre.store ((float) timbre.actual, std::memory_order_relaxed);
    for (size_t v = 0; v < voices.size(); ++v)
    {
        const auto& voice = voices[v];
        const auto sounding = settings.multi && voice.active && voice.key >= 0 && voice.offAt > written;
        saidKeys[v].store (sounding ? voice.key : -1, std::memory_order_relaxed);
        saidPitches[v].store ((float) voice.motion.actual, std::memory_order_relaxed);
    }
    std::array<juce::uint32, 4> notes {};
    for (int i = 0; i < numHeld; ++i)
        notes[(size_t) (held[(size_t) i].key >> 5)] |= 1u << (held[(size_t) i].key & 31);
    for (size_t w = 0; w < notes.size(); ++w)
        saidNotes[w].store (notes[w], std::memory_order_relaxed);
}

// ---------------------------------------------------------------------------------------------------------
// A frame: analysis, the envelope, each voice shifted
// ---------------------------------------------------------------------------------------------------------

void State::frame (const Settings& settings)
{
    analyse();
    bool shifts = false;
    for (const auto& voice : voices)
        shifts = shifts || voice.active;
    if (! shifts)
        return;
    const auto timbreOn = settings.timbreOn;
    if (timbreOn && ! silent)
        envelope();
    const auto timbreRatio = std::exp2 (timbre.actual / 12.0);
    for (auto& voice : voices)
        if (voice.active)
            synthesise (voice, timbreOn, timbreRatio);
}

void State::analyse()
{
    // Each side's frame, windowed, rotated so its middle is at 0 (zero phase: a bin's phase is the
    // phase at the frame's middle), zero-padded to twice its length.
    const auto first = written - size;
    for (int side = 0; side < 2; ++side)
    {
        auto& buffer = spectra[(size_t) side];
        std::fill (buffer.begin(), buffer.end(), 0.0f);
        for (int n = 0; n < size; ++n)
        {
            const auto x = in[(size_t) side][(size_t) ((first + n) & (juce::int64) inMask)] * hann[(size_t) n];
            buffer[(size_t) ((n - size / 2 + fftSize) % fftSize)] = x;
        }
        fft->performRealOnlyForwardTransform (buffer.data(), true);
    }

    const auto* l = spectra[0].data();
    const auto* r = spectra[1].data();
    float loudest = 0;
    for (int k = 0; k < bins; ++k)
    {
        const auto p = l[2 * k] * l[2 * k] + l[2 * k + 1] * l[2 * k + 1] + r[2 * k] * r[2 * k] + r[2 * k + 1] * r[2 * k + 1];
        power[(size_t) k] = p;
        loudest = juce::jmax (loudest, p);
    }
    // Quieter than about -110 dB: silence, nothing to shift.
    const auto floor = (float) (size * 1e-6 * size * 1e-6);
    silent = loudest < floor;

    // Onsets: the energy above 1.5 kHz jumping (+4 dB on the last frame), at most once a window.
    const auto from = (int) std::ceil (onsetAboveHz * fftSize / rate);
    double high = 0;
    for (int k = from; k < bins; ++k)
        high += power[(size_t) k];
    onset = ! silent && sinceOnset >= size / hop && high > 2.5 * highEnergy && high > 1e3 * floor * bins;
    sinceOnset = onset ? 0 : sinceOnset + 1;
    highEnergyBefore = highEnergy;
    highEnergy = high;

    peaks.clear();
    regionLow.clear();
    regionHigh.clear();
    peakOmega.clear();
    if (! silent)
    {
        // Peaks: louder than their two neighbours each side, within 90 dB of the loudest.
        const auto quietest = loudest * 1e-9f;
        for (int k = 2; k < bins - 2; ++k)
        {
            const auto p = power[(size_t) k];
            if (p > quietest && p > power[(size_t) k - 1] && p >= power[(size_t) k + 1] && p > power[(size_t) k - 2] && p >= power[(size_t) k + 2])
                peaks.push_back (k);
        }
        // Each peak's region: up to the quietest bin between it and the next.
        for (size_t i = 0; i < peaks.size(); ++i)
        {
            regionLow.push_back (i == 0 ? 0 : regionHigh.back() + 1);
            if (i + 1 == peaks.size())
                regionHigh.push_back (bins - 1);
            else
            {
                auto lowest = peaks[i];
                for (auto k = peaks[i] + 1; k < peaks[i + 1]; ++k)
                    if (power[(size_t) k] < power[(size_t) lowest])
                        lowest = k;
                regionHigh.push_back (lowest);
            }
            // Its true frequency, from how far its phase went since the last frame (each side, by its level).
            const auto k = peaks[i];
            const auto expected = twoPi * k * hop / fftSize;
            double omega = 0, weight = 0;
            for (int side = 0; side < 2; ++side)
            {
                const auto* x = spectra[(size_t) side].data();
                const auto* last = lastPhase[(size_t) side].data();
                const std::complex<double> now (x[2 * k], x[2 * k + 1]), before (last[2 * k], last[2 * k + 1]);
                const auto magnitude = std::abs (now);
                if (magnitude <= 0)
                    continue;
                const auto advance = std::arg (now * std::conj (before));
                omega += magnitude * (twoPi * k / fftSize + wrap (advance - expected) / hop);
                weight += magnitude;
            }
            peakOmega.push_back (weight > 0 ? omega / weight : twoPi * k / fftSize);
        }
    }
    // This frame's spectra, for the next one's phase advances.
    for (int side = 0; side < 2; ++side)
        std::copy (spectra[(size_t) side].begin(), spectra[(size_t) side].begin() + bins * 2, lastPhase[(size_t) side].begin());
}

void State::envelope()
{
    // A true envelope (Röbel and Rodet): the log spectrum smoothed by its cepstrum, raised to the peaks it
    // passed under, smoothed again: it rests on the harmonics rather than between them. On every second
    // bin (the frame's own resolution: the zero padding adds no detail).
    const auto half = size / 2;
    float loudest = 0;
    for (int k = 0; k <= half; ++k)
        loudest = juce::jmax (loudest, power[(size_t) (2 * k)]);
    const auto floor = loudest * 1e-10f + 1e-30f;
    for (int k = 0; k <= half; ++k)
        logSpectrum[(size_t) k] = 0.5f * std::log (power[(size_t) (2 * k)] * 0.5f + floor);

    const auto smooth = [this, half] (const std::vector<float>& from, std::vector<float>& to, bool first) {
        // The log spectrum, mirrored, is real and even: so is its cepstrum.
        std::fill (cepstrum.begin(), cepstrum.end(), 0.0f);
        for (int k = 0; k <= half; ++k)
            cepstrum[(size_t) k] = from[(size_t) k];
        for (int k = 1; k < half; ++k)
            cepstrum[(size_t) (size - k)] = from[(size_t) k];
        cepstrumFft->performRealOnlyForwardTransform (cepstrum.data(), true);
        if (first)
        {
            // The pitch's period stands out in the cepstrum of a voice: the envelope may then have all the
            // detail under half of it (formants close together stay apart) and none of the harmonics. A
            // sound with no clear pitch (noise, a chord) gets a millisecond's.
            const auto least = (int) lifterLeast + 4, most = (int) juce::jmin ((double) half - 1, rate / 60);
            auto best = least;
            double sum = 0;
            for (auto q = least; q <= most; ++q)
            {
                sum += (double) cepstrum[(size_t) (2 * q)] * cepstrum[(size_t) (2 * q)];
                if (cepstrum[(size_t) (2 * q)] > cepstrum[(size_t) (2 * best)])
                    best = q;
            }
            const auto peak = cepstrum[(size_t) (2 * best)];
            const auto spread = std::sqrt (sum / (most - least + 1));
            const auto voiced = peak / (float) size > 0.05f && peak > 3.0 * spread;
            const auto wanted = voiced ? juce::jlimit (lifterLeast, lifterMost, 0.55f * (float) best) : lifterLeast;
            lifter += (wanted - lifter) * 0.3f;
        }
        // Keep the low quefrencies (the envelope), tapering into the cut.
        const auto taperFrom = lifter * 0.75f;
        for (int q = 0; q <= half; ++q)
        {
            auto weight = 0.0f;
            if ((float) q <= taperFrom)
                weight = 1.0f;
            else if ((float) q < lifter)
                weight = 0.5f + 0.5f * std::cos ((float) pi * ((float) q - taperFrom) / (lifter - taperFrom));
            cepstrum[(size_t) (2 * q)] *= weight;
            cepstrum[(size_t) (2 * q + 1)] = 0.0f;
        }
        cepstrumFft->performRealOnlyInverseTransform (cepstrum.data());
        for (int k = 0; k <= half; ++k)
            to[(size_t) k] = cepstrum[(size_t) k];
    };
    smooth (logSpectrum, logEnvelope, true);
    for (int iteration = 0; iteration < 4; ++iteration)
    {
        for (int k = 0; k <= half; ++k)
            logSpectrum[(size_t) k] = juce::jmax (logSpectrum[(size_t) k], logEnvelope[(size_t) k]);
        smooth (logSpectrum, logEnvelope, false);
    }
}

float State::envelopeAt (double bin) const
{
    // A bin of the padded spectrum, on the envelope's (every second one), between its points.
    const auto x = juce::jlimit (0.0, (double) (size / 2), bin * 0.5);
    const auto i = juce::jmin ((int) x, size / 2 - 1);
    const auto f = (float) (x - i);
    return logEnvelope[(size_t) i] + (logEnvelope[(size_t) i + 1] - logEnvelope[(size_t) i]) * f;
}

void State::synthesise (Voice& voice, bool timbreOn, double timbreRatio)
{
    // The pitch over the hop up to the frame's middle: its mean ratio turns the phases (the integral of
    // the frequency over the hop: glides don't step), and moves the peaks.
    const auto middle = written - size / 2;
    double sum = 0;
    for (auto t = middle - hop; t < middle; ++t)
        sum += std::exp2 ((double) voice.history[(size_t) (t & (juce::int64) historyMask)] / 12.0);
    const auto ratio = sum / hop;

    auto& yl = voice.spectrum[0];
    auto& yr = voice.spectrum[1];
    std::fill (yl.begin(), yl.begin() + bins * 2 + 2, 0.0f);
    std::fill (yr.begin(), yr.begin() + bins * 2 + 2, 0.0f);
    const auto* xl = spectra[0].data();
    const auto* xr = spectra[1].data();
    const auto top = bins - 1;
    const auto transparent = std::abs (ratio - 1) < 1e-9 && (! timbreOn || std::abs (timbreRatio - 1) < 1e-9);

    // The Timbre wheel: each partial's level is the envelope where the wheel wants it at its new
    // frequency, over the envelope it brought: one gain for its whole region (the window's shape around
    // it, sidelobes and all, stays as it was). Then all of them together brought back to the loudness
    // they had (gliding there over a few frames): the wheel changes the sound's colour, not its level (a
    // lone sine's envelope is the sine itself: keeping it would only turn the sine down).
    auto loudness = 1.0f;
    if (timbreOn && ! transparent && ! silent)
    {
        double before = 0, after = 0;
        regionGains.resize (peaks.size());
        for (size_t i = 0; i < peaks.size(); ++i)
        {
            const auto frequency = peakOmega[i] * fftSize / twoPi;
            const auto gain = std::exp (juce::jlimit ((float) -maxEnvelopeLog, (float) maxEnvelopeLog, envelopeAt (frequency * ratio / timbreRatio) - envelopeAt (frequency)));
            regionGains[i] = gain;
            double energy = 0;
            for (auto k = regionLow[i]; k <= regionHigh[i]; ++k)
                energy += power[(size_t) k];
            before += energy;
            after += energy * gain * gain;
        }
        const auto wanted = after > 0 ? (float) juce::jlimit (1.0 / 16, 16.0, std::sqrt (before / after)) : 1.0f;
        voice.loudness += (wanted - voice.loudness) * 0.35f;
        loudness = voice.loudness;
    }
    else
        voice.loudness = 1.0f;

    if (! silent)
        for (size_t i = 0; i < peaks.size(); ++i)
        {
            const auto k0 = peaks[i];
            const auto omega = peakOmega[i];
            const auto frequency = omega * fftSize / twoPi;
            // Moved by whole bins to as near its new frequency as they go; turned so its phase advances at
            // that frequency exactly (from where its region was turned to last frame).
            const auto shift = (int) std::lround ((ratio - 1) * frequency);
            const auto reset = onset && k0 >= resetFrom;
            const auto theta = reset ? 0.0 : wrap ((double) voice.thetaPrev[(size_t) k0] + hop * (ratio - 1) * omega);
            const auto gain = timbreOn && ! transparent ? regionGains[i] * loudness : 1.0f;
            const auto cg = (float) std::cos (theta) * gain, sg = (float) std::sin (theta) * gain;
            const auto low = regionLow[i], high = regionHigh[i];
            for (int k = low; k <= high; ++k)
            {
                voice.theta[(size_t) k] = (float) theta;
                const auto j = k + shift;
                if (j < 0 || j > top)
                    continue;
                yl[(size_t) (2 * j)] += xl[2 * k] * cg - xl[2 * k + 1] * sg;
                yl[(size_t) (2 * j + 1)] += xl[2 * k] * sg + xl[2 * k + 1] * cg;
                yr[(size_t) (2 * j)] += xr[2 * k] * cg - xr[2 * k + 1] * sg;
                yr[(size_t) (2 * j + 1)] += xr[2 * k] * sg + xr[2 * k + 1] * cg;
            }
        }
    std::swap (voice.theta, voice.thetaPrev);
    if (silent)
        return;

    // Back to time, the middle unrotated, windowed again and added in where the frame was.
    const auto first = written - size;
    for (int side = 0; side < 2; ++side)
    {
        auto& buffer = voice.spectrum[(size_t) side];
        fft->performRealOnlyInverseTransform (buffer.data());
        auto& out = voice.out[(size_t) side];
        for (int n = 0; n < size; ++n)
            out[(size_t) ((first + n) & (juce::int64) outMask)] += buffer[(size_t) ((n - size / 2 + fftSize) % fftSize)] * hann[(size_t) n] * synthesisGain;
    }
}

// ---------------------------------------------------------------------------------------------------------
// What it says
// ---------------------------------------------------------------------------------------------------------

juce::var State::describe() const
{
    juce::Array<juce::var> sounding;
    for (size_t v = 0; v < voices.size(); ++v)
        if (const auto key = saidKeys[v].load (std::memory_order_relaxed); key >= 0)
        {
            auto* voice = new juce::DynamicObject();
            voice->setProperty ("key", key);
            voice->setProperty ("pitch", saidPitches[v].load (std::memory_order_relaxed));
            sounding.add (juce::var (voice));
        }
    juce::Array<juce::var> notes;
    for (int key = 0; key < 128; ++key)
        if ((saidNotes[(size_t) (key >> 5)].load (std::memory_order_relaxed) >> (key & 31)) & 1u)
            notes.add (key);
    auto* object = new juce::DynamicObject();
    object->setProperty ("latency", size);
    object->setProperty ("pitch", saidPitch.load (std::memory_order_relaxed));
    object->setProperty ("timbre", saidTimbre.load (std::memory_order_relaxed));
    object->setProperty ("voices", sounding);
    object->setProperty ("input", saidInput.load (std::memory_order_relaxed));
    object->setProperty ("notes", notes);
    return juce::var (object);
}

std::shared_ptr<State> Registry::get (const juce::String& effectId, double sampleRate, int window, int capacity)
{
    if (auto found = states.find (effectId); found != states.end())
    {
        const auto& state = found->second;
        if (juce::exactlyEqual (state->sampleRate(), sampleRate) && state->window() == window && state->capacity() >= capacity)
            return state;
    }
    auto state = std::make_shared<State> (sampleRate, window, capacity);
    states[effectId] = state;
    return state;
}

std::shared_ptr<State> Registry::find (const juce::String& effectId) const
{
    const auto found = states.find (effectId);
    return found != states.end() ? found->second : nullptr;
}

void Registry::keepOnly (const juce::StringArray& ids)
{
    for (auto it = states.begin(); it != states.end();)
        it = ids.contains (it->first) ? std::next (it) : states.erase (it);
}

juce::var Registry::describe() const
{
    auto* object = new juce::DynamicObject();
    for (const auto& [id, state] : states)
        object->setProperty (id, state->describe());
    return juce::var (object);
}
} // namespace wheel
