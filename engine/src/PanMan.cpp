#include "PanMan.h"

#include <cmath>

namespace panman
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

constexpr double pi = juce::MathConstants<double>::pi;
/** How far past hard left or right a position goes ("beyond the speakers"), in degrees. */
constexpr double limit = 105.0;
/** The position follows where it should be this quickly (a one-pole's seconds): a move is done in about 1 ms, and doesn't click. */
constexpr double declickSeconds = 0.00025;
/** Input and Output glide to a new gain this quickly (automated, or turned). */
constexpr double gainSeconds = 0.005;
/** The dynamics' and the trigger's followers fall this quickly (seconds); they rise at once. */
constexpr double levelRelease = 0.05;
constexpr double triggerRelease = 0.03;
/** A trigger is ready again once the level has fallen this far (dB) under the Trigger's, and this long (s) after the last. */
constexpr double rearmDb = 6.0;
constexpr double holdoffSeconds = 0.01;
/** PingPong's and Step's glide at full Smoothing (seconds; Smoothing² of it). */
constexpr double longestGlide = 1.0;
/** Back in time with the song after RateMod: most of the way in a quarter of a second. */
constexpr double driftSeconds = 0.06;
/** Remove the DC the even harmonics make: a high-pass at this (Hz). */
constexpr double dcHz = 10.0;

double dbToGain (double db) { return std::pow (10.0, db / 20.0); }
double gainToDb (double gain) { return gain > 1e-6 ? 20.0 * std::log10 (gain) : -120.0; }
double sineCurve (double x) { return (1.0 - std::cos (pi * juce::jlimit (0.0, 1.0, x))) / 2.0; }
double onePole (double hz, double sampleRate) { return 1.0 - std::exp (-2.0 * pi * hz / sampleRate); }
double follower (double seconds, double sampleRate) { return std::exp (-1.0 / (seconds * sampleRate)); }

/** A soft clipper: the sound itself at small levels (its slope 1), full scale at 1.5 and past it; a third harmonic at every level. */
double cubic (double x)
{
    const auto a = std::abs (x);
    if (a >= 1.5)
        return x > 0 ? 1.0 : -1.0;
    return x - x * x * x / 6.75;
}

Mode parseMode (const juce::String& s)
{
    if (s == "rhythmStep")
        return Mode::rhythmStep;
    if (s == "rhythmShape")
        return Mode::rhythmShape;
    if (s == "pingPong")
        return Mode::pingPong;
    if (s == "random")
        return Mode::random;
    if (s == "step")
        return Mode::step;
    return Mode::lfo;
}

Style parseStyle (const juce::String& s)
{
    const auto index = juce::StringArray { "clean", "fat", "squash", "dirt", "crunch", "shred", "pump" }.indexOf (s);
    return index < 0 ? Style::clean : (Style) index;
}
} // namespace

// ---------------------------------------------------------------------------------------------------------

std::shared_ptr<Settings> Settings::parse (const juce::var& json, int capacity)
{
    auto s = std::make_shared<Settings>();
    s->mode = parseMode (json["mode"].toString());
    s->offset = number (json["offset"], 0, -limit, limit);
    s->width = number (json["width"], 180, 0, 2 * limit);
    s->smoothing = number (json["smoothing"], 0.5, 0, 1);
    s->rate = number (json["rate"], 0.5, 0.001, 100);
    s->beats = number (json["beats"], 1, 1e-3, 1e5);
    s->stepBeats = number (json["stepBeats"], 1, 1e-3, 1e5);
    s->sync = ! json.hasProperty ("sync") || (bool) json["sync"];
    s->tempo = number (json["tempo"], 120, 1, 2000);
    s->seed = (juce::uint32) (juce::int64) number (json["seed"], 0, 0, 4294967295.0);
    s->trigger = number (json["trigger"], -20, -120, 0);
    s->divider = (int) number (json["divider"], 1, 1, 64);
    const auto filter = json["filter"].toString();
    s->filter = filter == "hpf" ? Filter::hpf : filter == "lpf" ? Filter::lpf : Filter::off;
    s->cutoff = number (json["cutoff"], 1000, 10, 40000);
    s->filterGain = number (json["filterGain"], 0, -40, 40);
    s->monitor = (bool) json["monitor"];
    s->dynamics = ! json.hasProperty ("dynamics") || (bool) json["dynamics"];
    s->threshold = number (json["threshold"], -20, -120, 0);
    s->attack = number (json["attack"], 0.01, 0, 60);
    s->release = number (json["release"], 0.2, 0, 60);
    s->gate = (bool) json["gate"];
    s->offsetMod = number (json["offsetMod"], 0, -2 * limit, 2 * limit);
    s->widthMod = number (json["widthMod"], 0, -4 * limit, 4 * limit);
    s->rateMod = number (json["rateMod"], 0, -8, 8);
    s->style = parseStyle (json["style"].toString());
    s->input = number (json["input"], 0, -60, 60);
    s->output = number (json["output"], 0, -60, 60);

    // The pattern: lines over 0..1 of it, in order (two points at one place are a jump).
    const auto shape = json["shape"];
    const auto* at = shape["at"].getArray();
    const auto* values = shape["values"].getArray();
    if (at != nullptr && values != nullptr && ! at->isEmpty() && at->size() == values->size())
    {
        auto last = 0.0;
        for (const auto& phase : *at)
            s->shape.ticks.push_back (last = juce::jmax (last, number (phase, last, 0, 1)));
        for (const auto& value : *values)
            s->shape.values.push_back ((float) number (value, 0, -1, 1));
    }
    s->dry.setSize (2, juce::jmax (1, capacity));
    return s;
}

void Biquad::design (Filter type, double cutoff, double sampleRate)
{
    if (type == Filter::off)
    {
        b0 = 1;
        b1 = b2 = a1 = a2 = 0;
        return;
    }
    // RBJ's cookbook, Q 1/√2 (Butterworth): 12 dB an octave.
    const auto w = 2.0 * pi * juce::jlimit (10.0, 0.45 * sampleRate, cutoff) / sampleRate;
    const auto cosw = std::cos (w);
    const auto q = 1.0 / juce::MathConstants<double>::sqrt2;
    const auto alpha = std::sin (w) / (2.0 * q);
    const auto a0 = 1.0 + alpha;
    if (type == Filter::lpf)
    {
        b0 = (1.0 - cosw) / 2.0 / a0;
        b1 = (1.0 - cosw) / a0;
        b2 = b0;
    }
    else
    {
        b0 = (1.0 + cosw) / 2.0 / a0;
        b1 = -(1.0 + cosw) / a0;
        b2 = b0;
    }
    a1 = -2.0 * cosw / a0;
    a2 = (1.0 - alpha) / a0;
}

// ---------------------------------------------------------------------------------------------------------

State::State (double sampleRate)
    : rate (sampleRate),
      lowPole (onePole (200.0, sampleRate)),
      highPole (onePole (2500.0, sampleRate)),
      dcPole (1.0 - 2.0 * pi * dcHz / sampleRate),
      squashAttack (follower (0.005, sampleRate)),
      squashRelease (follower (0.12, sampleRate)),
      pumpAttack (follower (0.001, sampleRate)),
      pumpRelease (follower (0.25, sampleRate))
{
}

double State::chance (juce::uint32 seed, juce::int64 index)
{
    // splitmix64 of the seed and the index: well spread, and the same every time.
    auto z = (((juce::uint64) seed) << 32) ^ (juce::uint64) index;
    z += 0x9e3779b97f4a7c15ULL;
    z = (z ^ (z >> 30)) * 0xbf58476d1ce4e5b9ULL;
    z = (z ^ (z >> 27)) * 0x94d049bb133111ebULL;
    z ^= z >> 31;
    return (double) (z >> 11) * (2.0 / 9007199254740992.0) - 1.0;
}

std::pair<double, double> State::gains (double degrees)
{
    // Sine / cosine over the angle, carried past ±90° (the far side's gain turns a little negative), × √2:
    // unity at the centre, the same power everywhere.
    const auto angle = (juce::jlimit (-limit, limit, degrees) + 90.0) / 180.0 * (pi / 2.0);
    return { juce::MathConstants<double>::sqrt2 * std::cos (angle), juce::MathConstants<double>::sqrt2 * std::sin (angle) };
}

void State::restart()
{
    beat = 0;
    drift = 0;
    lfoPhase = 0;
    cursor = 0;
    count = 0;
    side = -1;
    moves = 0;
    glideDone = 1;
    fresh = true;
}

void State::triggered (const Settings& s)
{
    if (++count < s.divider)
        return;
    count = 0;
    ++moves;
    // From wherever it is now (mid-glide too) to the next place.
    glideFrom = glideFrom + (glideTo - glideFrom) * sineCurve (glideDone);
    if (s.mode == Mode::pingPong)
        glideTo = side = -side;
    else
        glideTo = chance (s.seed ^ 0x5bd1e995u, moves);
    const auto glide = s.smoothing * s.smoothing * longestGlide;
    glideDone = glide > 0 ? 0.0 : 1.0;
}

double State::saturate (Style style, double x)
{
    // Each a curve that's the sound itself at low levels, adding harmonics as it's driven (Input).
    const auto dcBlock = [&] (double v) {
        const auto out = v - dcIn + dcPole * dcOut;
        dcIn = v;
        dcOut = out;
        return out;
    };
    /** A compressor (a peak follower's coefficients; dB threshold, ratio, makeup): Squash's gentle, Pump's extreme. */
    const auto compress = [&] (double v, double attack, double release, double threshold, double ratio, double makeup) {
        const auto a = std::abs (v);
        const auto k = a > compLevel ? attack : release;
        compLevel = a + (compLevel - a) * k;
        const auto over = gainToDb (compLevel) - threshold;
        return v * dbToGain (makeup - (over > 0 ? over * (1.0 - 1.0 / ratio) : 0.0));
    };
    /** Fat: the lows (under 200 Hz) saturated, with a second harmonic; the rest as it is. */
    const auto fat = [&] (double v) {
        lowState += (v - lowState) * lowPole;
        const auto low = lowState;
        const auto warm = cubic (2.5 * low) / 2.5 + 0.15 * low * low;
        return dcBlock (warm) + (v - low);
    };
    switch (style)
    {
        case Style::clean:
        {
            // Untouched up to 0.9, then a short knee to full scale (reached at 1.05): fairly hard clipping.
            const auto a = std::abs (x);
            if (a <= 0.9)
                return x;
            const auto y = 0.9 + 0.1 * cubic ((a - 0.9) / 0.1);
            return x > 0 ? y : -y;
        }
        case Style::fat:
            return fat (x);
        case Style::squash:
            return fat (compress (x, squashAttack, squashRelease, -18.0, 4.0, 1.0));
        case Style::dirt:
            return dcBlock (cubic (1.6 * x) / 1.6 + 0.06 * 1.6 * x * x);
        case Style::crunch:
        {
            // The highs (over 2.5 kHz) pushed up and clipped, the lows as they are.
            highState += (x - highState) * highPole;
            const auto low = highState;
            return cubic (low + cubic (3.0 * (x - low)) / 1.8);
        }
        case Style::shred:
            // One side driven far harder than the other.
            return dcBlock ((x >= 0 ? cubic (3.0 * x) : cubic (1.2 * x)) / 2.1);
        case Style::pump:
            return cubic (compress (x, pumpAttack, pumpRelease, -30.0, 10.0, 12.0));
    }
    return x;
}

void State::process (Settings& s, const gross::Clock& clock, float* left, float* right, int numSamples)
{
    if (clock.playing && (clock.started || ! wasPlaying))
        restart();
    wasPlaying = clock.playing;
    if (fresh && s.triggered())
        glideFrom = glideTo = s.mode == Mode::pingPong ? -1.0 : chance (s.seed ^ 0x5bd1e995u, 0);

    const auto tps = clock.ticksPerSample;
    const auto ppq = clock.ppq > 0 ? clock.ppq : 96.0;
    const auto loopLength = clock.loopEnd - clock.loopStart;
    // Beats a sample: the song's, or (out of sync) the BPM's.
    const auto beatsPerSample = s.sync ? tps / ppq : s.tempo / 60.0 / rate;
    const auto patternBeats = juce::jmax (1e-6, s.beats);
    const auto stepBeats = juce::jmax (1e-6, s.stepBeats);

    if (s.triggered() && (s.filter != designedFilter || ! juce::exactlyEqual (s.cutoff, designedCutoff)))
    {
        detector.design (s.filter, s.cutoff, rate);
        designedFilter = s.filter;
        designedCutoff = s.cutoff;
    }
    const auto declick = 1.0 - std::exp (-1.0 / (declickSeconds * rate));
    const auto gainStep = 1.0 - std::exp (-1.0 / (gainSeconds * rate));
    const auto driftStep = 1.0 - std::exp (-1.0 / (driftSeconds * rate));
    const auto levelFall = follower (levelRelease, rate);
    const auto triggerFall = follower (triggerRelease, rate);
    // Attack and Release: the time the amount takes all the way up or down, in a straight line.
    const auto attackStep = s.attack > 0 ? 1.0 / (s.attack * rate) : 1.0;
    const auto releaseStep = s.release > 0 ? 1.0 / (s.release * rate) : 1.0;
    const auto threshold = dbToGain (s.threshold);
    const auto triggerOn = s.trigger < -0.01;
    const auto triggerAt = dbToGain (s.trigger);
    const auto rearmAt = dbToGain (s.trigger - rearmDb);
    const auto holdoff = (juce::int64) (holdoffSeconds * rate);
    const auto filterGain = dbToGain (s.filterGain);
    const auto glide = s.smoothing * s.smoothing * longestGlide;
    const auto glideStep = glide > 0 ? 1.0 / (glide * rate) : 1.0;
    // Another style: its filters and followers start afresh (a compressor's level isn't another's).
    if (s.style != lastStyle)
    {
        lowState = highState = dcIn = dcOut = compLevel = 0;
        lastStyle = s.style;
    }
    const auto inTarget = dbToGain (s.input);
    const auto outTarget = dbToGain (s.output);
    auto manual = manualTrigger.exchange (false);
    if (fresh)
    {
        inGain = inTarget;
        outGain = outTarget;
    }

    auto least = 1000.0, most = -1000.0, inPeak = 0.0, outPeak = 0.0;
    for (int i = 0; i < numSamples; ++i)
    {
        inGain += (inTarget - inGain) * gainStep;
        outGain += (outTarget - outGain) * gainStep;
        const auto inLeft = left[i] * inGain, inRight = right[i] * inGain;
        inPeak = juce::jmax (inPeak, std::abs (inLeft), std::abs (inRight));
        // Mono in, as the hardware panners were: a stereo source becomes one place that moves.
        const auto x = (inLeft + inRight) * 0.5;

        // The dynamics: how far over the threshold the level is (Env) or whether it is (Gate), reached
        // at the Attack's pace and left at the Release's.
        const auto a = std::abs (x);
        level = a > level ? a : level * levelFall;
        if (s.dynamics)
        {
            auto target = 0.0;
            if (level > threshold)
                target = s.gate || s.threshold > -0.01 ? 1.0 : juce::jlimit (0.0, 1.0, (gainToDb (level) - s.threshold) / -s.threshold);
            amount = target > amount ? juce::jmin (target, amount + attackStep) : juce::jmax (target, amount - releaseStep);
        }
        else
            amount = 0;
        const auto modulating = amount > 0 && std::abs (s.rateMod) > 1e-9;
        const auto factor = modulating ? std::exp2 (amount * s.rateMod) : 1.0;

        // The triggers: the filtered sound's level crossing the Trigger's (and the Manual Trigger, under it).
        auto monitored = 0.0;
        if (s.triggered())
        {
            monitored = detector.run (x) * filterGain;
            const auto t = std::abs (monitored);
            triggerLevel = t > triggerLevel ? t : triggerLevel * triggerFall;
            ++sinceTrigger;
            // A trigger as the level rises past the Trigger's; ready again once it's fallen well under it.
            if (! armed && triggerLevel < rearmAt && sinceTrigger > holdoff)
                armed = true;
            if (triggerOn && armed && triggerLevel > triggerAt)
            {
                triggered (s);
                armed = false;
                sinceTrigger = 0;
            }
            if (manual && (! triggerOn || triggerLevel < triggerAt))
            {
                triggered (s);
                sinceTrigger = 0;
            }
            manual = false;
        }

        // Where the rhythm is: the song's position while it plays in time with it, else counted here.
        auto here = 0.0;
        if (s.sync && clock.playing)
        {
            auto songTick = clock.tick + i * tps;
            if (clock.loops && songTick >= clock.loopEnd && loopLength > 0)
                songTick = clock.loopStart + std::fmod (songTick - clock.loopStart, loopLength);
            here = beat = songTick / ppq;
        }
        else
            here = beat += beatsPerSample;
        // RateMod pushes a rhythm off the beat; once it's over, the rhythm comes back to it.
        if (s.mode != Mode::lfo)
        {
            if (modulating)
                drift += (factor - 1.0) * beatsPerSample;
            else if (std::abs (drift) > 0)
            {
                const auto period = s.mode == Mode::random ? stepBeats : patternBeats;
                const auto home = std::round (drift / period) * period;
                drift += (home - drift) * driftStep;
                if (std::abs (home - drift) < 1e-9)
                    drift = home;
            }
        }

        // The position, -1..1 of the width around the offset.
        auto v = 0.0;
        switch (s.mode)
        {
            case Mode::lfo:
                lfoPhase += s.rate * factor / rate;
                lfoPhase -= std::floor (lfoPhase);
                v = s.shape.empty() ? 0.0 : s.shape.at (lfoPhase, cursor);
                break;
            case Mode::rhythmStep:
            case Mode::rhythmShape:
            {
                const auto p = (here + drift) / patternBeats;
                v = s.shape.empty() ? 0.0 : s.shape.at (p - std::floor (p), cursor);
                break;
            }
            case Mode::random:
            {
                // A new place each step, glided into over the last Smoothing of the step before.
                const auto at = (here + drift) / stepBeats;
                const auto k = (juce::int64) std::floor (at);
                const auto into = at - (double) k;
                v = chance (s.seed, k);
                if (s.smoothing > 0 && into > 1.0 - s.smoothing)
                    v += (chance (s.seed, k + 1) - v) * sineCurve ((into - (1.0 - s.smoothing)) / s.smoothing);
                break;
            }
            case Mode::pingPong:
            case Mode::step:
                glideDone = juce::jmin (1.0, glideDone + glideStep);
                v = glideFrom + (glideTo - glideFrom) * sineCurve (glideDone);
                break;
        }
        const auto width = juce::jlimit (0.0, 2 * limit, s.width + amount * s.widthMod);
        const auto degrees = juce::jlimit (-limit, limit, s.offset + amount * s.offsetMod + v * width / 2.0);
        heard = fresh ? degrees : heard + (degrees - heard) * declick;
        fresh = false;
        least = juce::jmin (least, heard);
        most = juce::jmax (most, heard);

        if (s.triggered() && s.monitor)
        {
            // Monitor: what the trigger hears, unpanned.
            left[i] = right[i] = (float) (monitored * outGain);
        }
        else
        {
            const auto y = saturate (s.style, x) * outGain;
            const auto [gl, gr] = gains (heard);
            left[i] = (float) (y * gl);
            right[i] = (float) (y * gr);
        }
        outPeak = juce::jmax (outPeak, (double) std::abs (left[i]), (double) std::abs (right[i]));
    }

    // What it says: raised here, taken back down by `describe`.
    const auto raise = [] (std::atomic<float>& said, double value, bool up) {
        const auto was = said.load (std::memory_order_relaxed);
        if (up ? value > was : value < was)
            said.store ((float) value, std::memory_order_relaxed);
    };
    saidPosition.store ((float) heard, std::memory_order_relaxed);
    raise (saidLeast, least, false);
    raise (saidMost, most, true);
    raise (saidInput, inPeak, true);
    raise (saidOutput, outPeak, true);
    saidLevel.store ((float) gainToDb (s.triggered() ? triggerLevel : level), std::memory_order_relaxed);
    saidCount.store (count, std::memory_order_relaxed);
}

juce::var State::describe()
{
    auto* object = new juce::DynamicObject();
    const auto position = saidPosition.load (std::memory_order_relaxed);
    auto least = saidLeast.exchange (1000.0f, std::memory_order_relaxed);
    auto most = saidMost.exchange (-1000.0f, std::memory_order_relaxed);
    // Nothing run since last asked: just where it is.
    if (least > most)
        least = most = position;
    const auto round = [] (double v, double scale) { return std::round (v * scale) / scale; };
    object->setProperty ("position", round (position, 100));
    object->setProperty ("least", round (least, 100));
    object->setProperty ("most", round (most, 100));
    object->setProperty ("input", round (saidInput.exchange (0.0f, std::memory_order_relaxed), 1e4));
    object->setProperty ("output", round (saidOutput.exchange (0.0f, std::memory_order_relaxed), 1e4));
    object->setProperty ("level", round (saidLevel.load (std::memory_order_relaxed), 10));
    object->setProperty ("count", saidCount.load (std::memory_order_relaxed));
    return juce::var (object);
}

// ---------------------------------------------------------------------------------------------------------

std::shared_ptr<State> Registry::get (const juce::String& effectId, double sampleRate)
{
    auto& state = states[effectId];
    if (state == nullptr || ! juce::exactlyEqual (state->sampleRate(), sampleRate))
        state = std::make_shared<State> (sampleRate);
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
} // namespace panman
