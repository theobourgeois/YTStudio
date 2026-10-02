#include "AutoTune.h"

#include <cmath>

namespace tune
{
namespace
{
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

/** An RBJ low-pass section. */
void designLowPass (auto& f, double sampleRate, double cutoff, double q)
{
    const auto w = juce::MathConstants<double>::twoPi * cutoff / sampleRate;
    const auto alpha = std::sin (w) / (2 * q);
    const auto c = std::cos (w);
    const auto a0 = 1 + alpha;
    f.b0 = (1 - c) / 2 / a0;
    f.b1 = (1 - c) / a0;
    f.b2 = (1 - c) / 2 / a0;
    f.a1 = -2 * c / a0;
    f.a2 = (1 - alpha) / a0;
}

/** The largest a grain is stretched (Throat Length's 180%, and Formant off's pitch down). */
constexpr double maxStretch = 1.8;
constexpr double minStretch = 0.5;
} // namespace

// ---------------------------------------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------------------------------------

std::shared_ptr<Settings> Settings::parse (const juce::var& json)
{
    auto s = std::make_shared<Settings>();
    s->minHz = number (json["minHz"], 80, 20, 2000);
    s->maxHz = number (json["maxHz"], 1000, s->minHz * 2, 4000);
    s->threshold = number (json["threshold"], 0.2, 0.02, 0.6);
    if (const auto* list = json["notes"].getArray(); list != nullptr && list->size() == 12)
        for (int i = 0; i < 12; ++i)
        {
            const auto n = (int) number ((*list)[i], 0, 0, 2);
            s->notes[(size_t) i] = n == 1 ? Note::bypass : n == 2 ? Note::remove : Note::tune;
        }
    s->key = (int) number (json["key"], 0, 0, 11);
    s->keyNow = s->key;
    s->reference = number (json["reference"], 440, 400, 480);
    s->retune = number (json["retune"], 0, 0, 0.4);
    s->humanize = number (json["humanize"], 0, 0, 1);
    s->flexTune = number (json["flexTune"], 0, 0, 1);
    s->vibratoGain = number (json["vibratoGain"], 1, 0, 4);
    s->transpose = number (json["transpose"], 0, -24, 24);
    s->formant = json["formant"].isBool() ? (bool) json["formant"] : true;
    s->classic = (bool) json["classic"];
    s->ignoreVibrato = (bool) json["ignoreVibrato"];
    s->throat = number (json["throat"], 1, minStretch, maxStretch);
    if (const auto v = json["vibrato"]; v.isObject())
    {
        const auto shape = v["shape"].toString();
        s->shape = shape == "sine" ? Shape::sine : shape == "square" ? Shape::square : shape == "saw" ? Shape::saw : Shape::none;
        s->rate = number (v["rate"], 5.5, 0.1, 10);
        s->delay = number (v["delay"], 0.5, 0, 1.5);
        s->onset = number (v["onset"], 0.5, 0, 1.5);
        s->variation = number (v["variation"], 0, 0, 1);
        s->depth = number (v["depth"], 0, 0, 1);
        s->amplitude = number (v["amplitude"], 0, 0, 1);
        s->formantDepth = number (v["formant"], 0, 0, 1);
    }
    return s;
}

void Settings::setControl (int control, float value)
{
    switch (control)
    {
        case 0: retune = juce::jlimit (0.0, 0.4, (double) value); break;
        case 1: humanize = juce::jlimit (0.0, 1.0, (double) value); break;
        case 2: flexTune = juce::jlimit (0.0, 1.0, (double) value); break;
        case 3: vibratoGain = juce::jlimit (0.0, 4.0, (double) value); break;
        case 4: transpose = juce::jlimit (-24.0, 24.0, (double) value); break;
        case 5: throat = juce::jlimit (minStretch, maxStretch, (double) value); break;
        case 6: keyNow = juce::jlimit (0, 11, (int) std::lround (value)); break;
        // Detune (A4 in Hz), Tracking (YIN's threshold), and Create Vibrato's (`AutoTuneControl`'s order).
        case 7: reference = juce::jlimit (400.0, 480.0, (double) value); break;
        case 8: threshold = juce::jlimit (0.01, 0.6, (double) value); break;
        case 9: rate = juce::jlimit (0.1, 10.0, (double) value); break;
        case 10: delay = juce::jlimit (0.0, 1.5, (double) value); break;
        case 11: onset = juce::jlimit (0.0, 1.5, (double) value); break;
        case 12: variation = juce::jlimit (0.0, 1.0, (double) value); break;
        case 13: depth = juce::jlimit (0.0, 1.0, (double) value); break;
        case 14: amplitude = juce::jlimit (0.0, 1.0, (double) value); break;
        default: formantDepth = juce::jlimit (0.0, 1.0, (double) value); break;
    }
}

// ---------------------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------------------

State::State (double sampleRate, double lowestHz, int capacity) : rate (sampleRate), minHz (lowestHz), blockCapacity (juce::jmax (1, capacity))
{
    decimation = juce::jmax (1, (int) std::lround (rate / 12000.0));
    const auto lowRate = rate / decimation;
    // A frame every ~2.7 ms: Retune Speed 0's steps land within one.
    const auto lowHop = juce::jmax (8, (int) std::lround (0.00267 * lowRate));
    hop = lowHop * decimation;
    maxTau = (int) std::ceil (lowRate / minHz) + 2;
    maxPeriod = maxTau * decimation;
    unvoicedPeriod = juce::jmax (32, (int) std::lround (0.005 * rate));
    // Enough ahead for the longest grain, stretched as far as it goes, from the mark nearest its place,
    // and two hops of slack (`synthesise` and `placeMarks` say why).
    delay = (int) std::ceil (maxPeriod * (maxStretch + 1.5)) + 2 * hop;

    const auto keep = (juce::int64) delay + (juce::int64) std::ceil (maxPeriod * (maxStretch + 3)) + blockCapacity + 8;
    inMask = powerOfTwoAbove (keep) - 1;
    for (auto& side : in)
        side.assign ((size_t) inMask + 1, 0.0f);
    mono.assign ((size_t) inMask + 1, 0.0f);
    lowMask = powerOfTwoAbove (4 * maxTau + 8) - 1;
    low.assign ((size_t) lowMask + 1, 0.0f);
    outMask = powerOfTwoAbove (delay + (juce::int64) std::ceil (2 * maxPeriod * maxStretch) + blockCapacity + 8) - 1;
    for (auto& side : out)
        side.assign ((size_t) outMask + 1, 0.0f);
    window.assign ((size_t) (2 * maxTau + 4), 0.0f);
    difference.assign ((size_t) (maxTau + 4), 0.0f);
    frames.assign (512, {});
    marks.assign (2048, {});

    // Two sections (a 4th-order Butterworth) a little under the decimated copy's Nyquist: voices'
    // fundamentals pass, the harmonics that fool YIN go.
    const auto cutoff = juce::jmin (0.42 * lowRate / 2, 3000.0);
    designLowPass (lowPass[0], rate, cutoff, 0.5412);
    designLowPass (lowPass[1], rate, cutoff, 1.3066);
    // A 4th-order Butterworth's delay at low frequencies: 2.61 / ωc.
    filterDelay = 2.613 / (juce::MathConstants<double>::twoPi * cutoff) * rate;
    dcPole = std::exp (-juce::MathConstants<double>::twoPi * juce::jmin (20.0, minHz * 0.5) / rate);
    reset();
}

void State::reset()
{
    for (auto& side : in)
        std::fill (side.begin(), side.end(), 0.0f);
    std::fill (mono.begin(), mono.end(), 0.0f);
    std::fill (low.begin(), low.end(), 0.0f);
    for (auto& side : out)
        std::fill (side.begin(), side.end(), 0.0f);
    std::fill (frames.begin(), frames.end(), Frame {});
    written = lowWritten = frameCount = markCount = 0;
    nextMark = 0;
    nextGrain = 0;
    lastGrain = -1;
    lastMarkUsed = -1;
    lastShifted = false;
    lastF0 = 0;
    unvoicedRun = 100;
    correction = centre = held = noteTime = phase = wander = wanderTarget = 0;
    target = -1;
    voiced = false;
    for (auto& f : lowPass)
        f.z1 = f.z2 = 0;
    dcIn = dcOut = 0;
    stale = false;
}

float State::input (int side, double position) const
{
    // Catmull-Rom through the four nearest samples.
    const auto i = (juce::int64) std::floor (position);
    const auto f = (float) (position - (double) i);
    const auto y0 = rawInput (side, i - 1), y1 = rawInput (side, i), y2 = rawInput (side, i + 1), y3 = rawInput (side, i + 2);
    return y1 + 0.5f * f * (y2 - y0 + f * (2.0f * y0 - 5.0f * y1 + 4.0f * y2 - y3 + f * (3.0f * (y1 - y2) + y3 - y0)));
}

void State::process (const Settings& settings, float* left, float* right, int numSamples, float mix)
{
    if (stale)
        reset();
    if (numSamples > blockCapacity)
        return;
    const auto start = written;
    for (int i = 0; i < numSamples; ++i)
    {
        const auto index = (size_t) (written & (juce::int64) inMask);
        in[0][index] = left[i];
        in[1][index] = right[i];
        // Mono, its DC out, for the detector.
        const auto m = 0.5 * ((double) left[i] + (double) right[i]);
        dcOut = m - dcIn + dcPole * dcOut;
        dcIn = m;
        mono[index] = (float) dcOut;
        const auto filtered = lowPass[1].run (lowPass[0].run (dcOut));
        ++written;
        if (written % decimation == 0)
        {
            low[(size_t) (lowWritten & (juce::int64) lowMask)] = (float) filtered;
            ++lowWritten;
        }
        if (written % hop == 0)
            analyse (settings);
    }
    placeMarks();
    const auto end = written - delay;
    synthesise (end);

    // Out: the grains laid down, `delay` late; the dry sound as late, for the mix.
    for (int i = 0; i < numSamples; ++i)
    {
        const auto at = start - delay + i;
        const auto o = (size_t) (at & (juce::int64) outMask);
        const auto wetLeft = out[0][o], wetRight = out[1][o];
        out[0][o] = out[1][o] = 0.0f;
        const auto dryLeft = rawInput (0, at), dryRight = rawInput (1, at);
        left[i] = mix >= 1.0f ? wetLeft : wetLeft * mix + dryLeft * (1.0f - mix);
        right[i] = mix >= 1.0f ? wetRight : wetRight * mix + dryRight * (1.0f - mix);
    }
}

// ---------------------------------------------------------------------------------------------------------
// Hearing the pitch
// ---------------------------------------------------------------------------------------------------------

double State::detect (double& clarity, double& level)
{
    // The decimated window: the last 2 * maxTau samples.
    const auto length = 2 * maxTau;
    const auto first = lowWritten - length;
    double energy = 0;
    for (int j = 0; j < length; ++j)
    {
        const auto index = first + j;
        const auto x = index < 0 ? 0.0f : low[(size_t) (index & (juce::int64) lowMask)];
        window[(size_t) j] = x;
        energy += (double) x * x;
    }
    level = std::sqrt (energy / length);
    clarity = 1;
    if (level < 1e-4)
        return 0;

    // YIN: the difference function, then cumulative-mean normalised.
    const auto w = maxTau;
    const auto* x = window.data();
    double running = 0;
    difference[0] = 1;
    for (int tau = 1; tau <= maxTau; ++tau)
    {
        double d = 0;
        for (int j = 0; j < w; ++j)
        {
            const auto e = x[j] - x[j + tau];
            d += (double) e * e;
        }
        running += d;
        difference[(size_t) tau] = running > 0 ? (float) (d * tau / running) : 1.0f;
    }
    const auto threshold = currentThreshold;
    int best = -1;
    for (int tau = minTau; tau < maxTau; ++tau)
        if (difference[(size_t) tau] < threshold)
        {
            while (tau + 1 < maxTau && difference[(size_t) tau + 1] < difference[(size_t) tau])
                ++tau;
            best = tau;
            break;
        }
    if (best < 0)
    {
        best = minTau;
        for (int tau = minTau; tau < maxTau; ++tau)
            if (difference[(size_t) tau] < difference[(size_t) best])
                best = tau;
    }
    // An octave from the last pitch is likelier the last pitch (a strong second harmonic, a weak fundamental).
    if (lastF0 > 0)
    {
        const auto lastTau = rate / lastF0 / decimation;
        const auto ratio = lastTau / best;
        const auto near = [&] (int tau) { return tau >= minTau && tau < maxTau && difference[(size_t) tau] < threshold * 1.3; };
        if (ratio > 1.8 && ratio < 2.2 && near (best * 2))
            best = best * 2;
        else if (ratio > 0.45 && ratio < 0.55 && near (best / 2))
            best = best / 2;
    }
    clarity = difference[(size_t) best];
    // Between samples, by the parabola through the three around it.
    auto tau = (double) best;
    if (best > 1 && best < maxTau)
    {
        const auto a = difference[(size_t) best - 1], b = difference[(size_t) best], c = difference[(size_t) best + 1];
        const auto denominator = a - 2 * b + c;
        if (denominator > 1e-9f)
            tau += 0.5 * (a - c) / denominator;
    }

    // Refined at the full rate, around where it was found.
    if (decimation > 1)
    {
        const auto centreTau = tau * decimation;
        const auto from = juce::jmax (2, (int) std::floor (centreTau) - decimation);
        const auto to = juce::jmin (maxPeriod - 1, (int) std::ceil (centreTau) + decimation);
        const auto span = maxPeriod;
        const auto origin = written - 2 * maxPeriod;
        const auto at = [&] (juce::int64 index) { return index < 0 ? 0.0f : mono[(size_t) (index & (juce::int64) inMask)]; };
        double bestD = 1e300;
        int bestT = -1;
        std::array<double, 64> ds {};
        const auto count = juce::jmin (64, to - from + 1);
        for (int k = 0; k < count; ++k)
        {
            const auto t = from + k;
            double d = 0;
            for (int j = 0; j < span; j += 1)
            {
                const auto e = at (origin + j) - at (origin + j + t);
                d += (double) e * e;
            }
            ds[(size_t) k] = d;
            if (d < bestD)
            {
                bestD = d;
                bestT = k;
            }
        }
        if (bestT > 0 && bestT < count - 1)
        {
            const auto a = ds[(size_t) bestT - 1], b = ds[(size_t) bestT], c = ds[(size_t) bestT + 1];
            const auto denominator = a - 2 * b + c;
            tau = from + bestT + (denominator > 1e-12 ? 0.5 * (a - c) / denominator : 0.0);
        }
        else if (bestT >= 0)
            tau = from + bestT;
        else
            tau = centreTau;
    }
    return tau;
}

void State::analyse (const Settings& settings)
{
    // Tracking: choosier when a pitch is new, a little more forgiving to keep one going.
    currentThreshold = settings.threshold * (voiced ? 1.25 : 1.0);
    minTau = juce::jmax (2, (int) std::floor (rate / decimation / settings.maxHz));
    double clarity = 1, level = 0;
    const auto period = detect (clarity, level);
    auto f0 = period > 0 ? rate / period : 0.0;
    const auto heard = period > 0 && clarity < currentThreshold && level > 0.0012 && f0 >= settings.minHz * 0.95 && f0 <= settings.maxHz * 1.05;
    // A frame or two unheard inside a note keeps its pitch (a consonant's edge, a breath of noise).
    if (heard)
        unvoicedRun = 0;
    else if (++unvoicedRun <= 3 && lastF0 > 0)
        f0 = lastF0;
    else
        f0 = 0;
    if (heard)
        lastF0 = f0;
    else if (f0 <= 0)
        lastF0 = 0;

    Frame frame;
    frame.f0 = (float) f0;
    // YIN compared the window's first half with what comes a period later: its middle is where this pitch is.
    const auto heardPeriod = f0 > 0 ? rate / f0 : maxPeriod * 0.5;
    frame.time = (double) written - 2.0 * maxPeriod + 0.5 * (maxPeriod + heardPeriod) - filterDelay;
    correct (settings, frame);
    frames[(size_t) (frameCount % (juce::int64) frames.size())] = frame;
    ++frameCount;
}

// ---------------------------------------------------------------------------------------------------------
// Deciding the note
// ---------------------------------------------------------------------------------------------------------

void State::correct (const Settings& s, Frame& frame)
{
    const auto dt = hop / rate;
    if (frame.f0 <= 0)
    {
        // No pitch: nothing to tune, and the next note starts afresh.
        voiced = false;
        correction = 0;
        target = -1;
        frame.ratio = 1;
        frame.stretch = 1;
        frame.gain = 1;
        frame.shifted = false;
        if ((frameCount & 1) == 0)
        {
            auto& r = reports[(size_t) (reported.load (std::memory_order_relaxed) % reportSize)];
            r.in.store (-1, std::memory_order_relaxed);
            r.out.store (-1, std::memory_order_relaxed);
            r.target.store (-1, std::memory_order_relaxed);
            reported.fetch_add (1, std::memory_order_release);
        }
        return;
    }
    const auto sung = 69.0 + 12.0 * std::log2 (frame.f0 / s.reference);
    const auto onset = ! voiced;
    voiced = true;
    if (onset)
    {
        centre = sung;
        correction = 0;
        held = noteTime = 0;
        target = -1;
    }

    // Natural Vibrato: what moves around the note's centre (a slow follower), made wider or narrower.
    centre += (sung - centre) * (1.0 - std::exp (-dt * juce::MathConstants<double>::twoPi * 2.5));
    const auto modified = centre + (sung - centre) * s.vibratoGain;

    // The target: the nearest note of the scale (Classic: whatever's nearest at once; otherwise a little
    // hysteresis, so a note sung between two doesn't flutter).
    const auto shift = ((s.keyNow - s.key) % 12 + 12) % 12;
    const auto stateOf = [&] (int midi) { return s.notes[(size_t) ((((midi - shift) % 12) + 12) % 12)]; };
    int nearest = -1;
    double nearestDistance = 1e9;
    const auto heard = s.ignoreVibrato ? centre : modified;
    const auto base = (int) std::lround (heard);
    for (int n = base - 12; n <= base + 12; ++n)
        if (stateOf (n) != Note::remove && std::abs (n - heard) < nearestDistance)
        {
            nearest = n;
            nearestDistance = std::abs (n - heard);
        }
    if (nearest >= 0 && target >= 0 && nearest != target && ! s.classic && stateOf (target) != Note::remove && std::abs (target - heard) < nearestDistance + 0.12)
        nearest = target;
    if (nearest != target)
    {
        // A new note: Humanize counts its sustain from here, and Create Vibrato starts again.
        held = noteTime = 0;
        target = nearest;
        if (! onset)
            centre = sung;
    }
    held += dt;
    noteTime += dt;

    // How far it's pulled: all the way, or (Flex-Tune) only near the note; none for a bypassed note.
    double wanted = 0;
    if (target >= 0 && stateOf (target) == Note::tune)
    {
        wanted = target - modified;
        if (s.flexTune > 0 && ! s.classic)
        {
            const auto zone = 0.5 * (1.0 - s.flexTune) + 0.04;
            wanted *= juce::jlimit (0.0, 1.0, (zone - std::abs (wanted)) / (zone * 0.5));
        }
    }
    // Retune Speed: how long the pull takes (about all of it in that time); Humanize slows it on a
    // note's sustain, so short notes snap and long ones keep their life.
    const auto sustain = juce::jlimit (0.0, 1.0, (held - 0.12) / 0.25);
    const auto time = s.retune + s.humanize * 0.35 * sustain;
    correction = time <= 1e-4 ? wanted : correction + (wanted - correction) * (1.0 - std::exp (-dt * 3.0 / time));

    // Create Vibrato, after the correction: it comes in after its delay, over its onset.
    double vibrato = 0, amplitude = 1, formantMove = 0;
    if (s.shape != Shape::none && (s.depth > 0 || s.amplitude > 0 || s.formantDepth > 0))
    {
        // Variation: the rate and depth wander a little, note to note.
        seed = seed * 1664525u + 1013904223u;
        if (noteTime <= dt)
            wanderTarget = ((double) (seed >> 8) / 16777216.0 * 2 - 1) * s.variation;
        wander += (wanderTarget - wander) * (1.0 - std::exp (-dt * 4));
        phase += s.rate * (1 + 0.3 * wander) * dt;
        phase -= std::floor (phase);
        const auto envelope = noteTime < s.delay ? 0.0 : s.onset <= 1e-4 ? 1.0 : juce::jmin (1.0, (noteTime - s.delay) / s.onset);
        const auto wave = s.shape == Shape::sine ? std::sin (juce::MathConstants<double>::twoPi * phase)
                          : s.shape == Shape::square ? std::tanh (5 * std::sin (juce::MathConstants<double>::twoPi * phase)) / std::tanh (5.0)
                                                     : 2 * phase - 1;
        const auto amount = envelope * (1 + 0.3 * wander);
        vibrato = s.depth * amount * wave;
        amplitude = 1 - s.amplitude * amount * (0.5 - 0.5 * wave);
        formantMove = s.formantDepth * amount * wave;
    }
    if (noteTime <= dt)
        phase = 0;

    const auto transpose = s.classic ? 0.0 : s.transpose;
    const auto heardOut = modified + correction + vibrato + transpose;
    const auto semitones = heardOut - sung;
    frame.ratio = (float) std::pow (2.0, semitones / 12.0);
    const auto formant = s.formant && ! s.classic;
    // Formant on: the grains keep their shape (scaled by the throat); off, they're squeezed with the pitch.
    double stretch = formant ? s.throat : 1.0 / frame.ratio;
    stretch *= std::pow (2.0, -formantMove * 0.25);
    stretch = juce::jlimit (minStretch, maxStretch, stretch);
    frame.stretch = (float) stretch;
    // A stretched grain overlaps the next more: as loud as before.
    frame.gain = (float) (amplitude / juce::jmax (1.0, formant ? stretch : stretch * frame.ratio));
    frame.shifted = std::abs (semitones) > 1e-4 || std::abs (stretch - 1) > 1e-4 || std::abs (amplitude - 1) > 1e-4;

    if ((frameCount & 1) == 0)
    {
        auto& r = reports[(size_t) (reported.load (std::memory_order_relaxed) % reportSize)];
        r.in.store ((float) sung, std::memory_order_relaxed);
        r.out.store ((float) heardOut, std::memory_order_relaxed);
        r.target.store (target, std::memory_order_relaxed);
        reported.fetch_add (1, std::memory_order_release);
    }
}

State::Frame State::frameAt (double t) const
{
    // The frames are a hop apart, give or take half a period: a guess, then the two either side of `t`.
    if (frameCount == 0)
        return {};
    const auto count = (juce::int64) frames.size();
    const auto newest = frameCount - 1;
    const auto oldest = juce::jmax ((juce::int64) 0, frameCount - count + 1);
    const auto at = [&] (juce::int64 i) -> const Frame& { return frames[(size_t) (i % count)]; };
    auto i = juce::jlimit (oldest, newest, (juce::int64) std::floor ((t + 1.5 * maxPeriod) / hop) - 1);
    while (i > oldest && at (i).time > t)
        --i;
    while (i < newest && at (i + 1).time <= t)
        ++i;
    const auto& a = at (i);
    if (t <= a.time || i == newest)
        return a;
    const auto& b = at (i + 1);
    const auto f = (t - a.time) / juce::jmax (1e-9, b.time - a.time);
    // A pitch starting or stopping between them: the nearer one's.
    if ((a.f0 > 0) != (b.f0 > 0) || a.shifted != b.shifted)
        return f < 0.5 ? a : b;
    Frame mixed;
    mixed.f0 = (float) (a.f0 + (b.f0 - a.f0) * f);
    mixed.ratio = (float) (a.ratio + (b.ratio - a.ratio) * f);
    mixed.stretch = (float) (a.stretch + (b.stretch - a.stretch) * f);
    mixed.gain = (float) (a.gain + (b.gain - a.gain) * f);
    mixed.shifted = a.shifted;
    return mixed;
}

// ---------------------------------------------------------------------------------------------------------
// The grains
// ---------------------------------------------------------------------------------------------------------

void State::placeMarks()
{
    const auto size = (juce::int64) marks.size();
    for (;;)
    {
        const auto frame = frameAt (nextMark);
        auto period = frame.f0 > 0 ? (float) (rate / frame.f0) : (float) unvoicedPeriod;
        auto pos = nextMark;
        // A mark needs the period after it, and room to be nudged.
        if (pos + period * 1.2 + 3 > (double) written)
            break;
        // A pitched mark is a period on from the last in the sound itself: where the waveform after the
        // last mark comes again (the period heard may be off a little), to a fraction of a sample.
        if (frame.f0 > 0 && markCount > 0)
        {
            const auto& last = marks[(size_t) ((markCount - 1) % size)];
            const auto origin = (juce::int64) std::lround (last.pos);
            const auto expected = pos - (double) origin;
            const auto search = juce::jmax (1, (int) (period / 6));
            const auto half = juce::jmax (8, (int) (period / 2));
            const auto around = (int) std::lround (expected);
            const auto score = [&] (int shift) {
                double c = 0, e = 0;
                for (int j = -half; j < half; j += 2)
                {
                    const auto a = mono[(size_t) ((origin + j) & (juce::int64) inMask)];
                    const auto b = mono[(size_t) ((origin + shift + j) & (juce::int64) inMask)];
                    c += (double) a * b;
                    e += (double) b * b;
                }
                return e > 0 ? c / std::sqrt (e) : 0.0;
            };
            double best = -1e300;
            int bestShift = around;
            for (int shift = juce::jmax (1, around - search); shift <= around + search; ++shift)
                if (const auto s = score (shift); s > best)
                {
                    best = s;
                    bestShift = shift;
                }
            // Between samples, by the parabola through the scores around the best.
            const auto a = score (bestShift - 1), c = score (bestShift + 1);
            const auto denominator = a - 2 * best + c;
            const auto fraction = denominator < -1e-12 ? juce::jlimit (-0.5, 0.5, 0.5 * (a - c) / denominator) : 0.0;
            pos = (double) origin + bestShift + fraction + (last.pos - (double) origin);
            if (pos <= last.pos + 1)
                pos = last.pos + 1;
        }
        marks[(size_t) (markCount % size)] = { pos, period };
        ++markCount;
        nextMark = pos + juce::jmax (1.0f, period);
    }
}

void State::addGrain (const Mark& mark, double at, double stretch, float gain)
{
    // A Hann window two periods long, centred on the mark, laid down centred on `at`, `stretch` times as long.
    const auto halfIn = (double) mark.period;
    const auto halfOut = halfIn * stretch;
    const auto first = (juce::int64) std::ceil (at - halfOut);
    const auto last = (juce::int64) std::floor (at + halfOut);
    const auto identity = std::abs (stretch - 1) < 1e-9 && std::abs (at - mark.pos) < 1e-9;
    for (auto t = first; t <= last; ++t)
    {
        const auto u = ((double) t - at) / halfOut;
        if (u <= -1 || u >= 1)
            continue;
        const auto w = (float) (0.5 + 0.5 * std::cos (juce::MathConstants<double>::pi * u)) * gain;
        const auto o = (size_t) (t & (juce::int64) outMask);
        if (identity)
        {
            out[0][o] += w * rawInput (0, t);
            out[1][o] += w * rawInput (1, t);
        }
        else
        {
            const auto source = mark.pos + ((double) t - at) / stretch;
            out[0][o] += w * input (0, source);
            out[1][o] += w * input (1, source);
        }
    }
}

void State::synthesise (juce::int64 end)
{
    const auto size = (juce::int64) marks.size();
    const auto oldest = juce::jmax ((juce::int64) 0, markCount - size + 1);
    // Grains placed until none still to come could reach back to before `end`.
    const auto reach = (double) end + maxPeriod * maxStretch + 1;
    // Each pass places a grain or moves on a mark; a guard all the same (the audio thread mustn't hang).
    for (int guard = 0; guard < 1 << 16; ++guard)
    {
        if (markCount == 0)
            return;
        if (! lastShifted || lastMarkUsed < 0)
        {
            // Not shifting: each analysis mark's grain goes back where it was (the sound as it is).
            const auto m = lastMarkUsed + 1;
            if (m < oldest)
            {
                lastMarkUsed = oldest - 1;
                continue;
            }
            if (m >= markCount)
                return;
            const auto& mark = marks[(size_t) (m % size)];
            if (mark.pos > reach)
                return;
            const auto frame = frameAt ((double) mark.pos);
            if (frame.shifted && frame.f0 > 0)
            {
                // A pitch to move: from here grains are laid a new period apart.
                lastShifted = true;
                nextGrain = mark.pos;
                continue;
            }
            addGrain (mark, mark.pos, 1.0, 1.0f);
            lastGrain = mark.pos;
            lastMarkUsed = m;
            continue;
        }

        // Shifting: a grain each output period, from the analysis mark nearest where it goes.
        const auto at = nextGrain;
        if (at > reach)
            return;
        // The nearest mark: the cursor moves on while the next is nearer.
        auto m = juce::jmax (oldest, lastMarkUsed);
        while (m + 1 < markCount && std::abs (marks[(size_t) ((m + 1) % size)].pos - at) <= std::abs (marks[(size_t) (m % size)].pos - at))
            ++m;
        // Its successor must be placed (or the nearest could still be to come).
        if (m + 1 >= markCount && marks[(size_t) (m % size)].pos < at)
            return;
        const auto& mark = marks[(size_t) (m % size)];
        const auto frame = frameAt (at);
        if (! frame.shifted || frame.f0 <= 0)
        {
            // Back to the sound as it is, from the first mark half a period on.
            lastShifted = false;
            auto next = m;
            while (next < markCount && marks[(size_t) (next % size)].pos < at + mark.period * 0.5)
                ++next;
            lastMarkUsed = next - 1;
            continue;
        }
        addGrain (mark, at, frame.stretch, frame.gain);
        lastGrain = at;
        lastMarkUsed = m;
        // The next a tuned period on: the pitch heard here moved by the ratio decided here (the mark's own
        // period may be from a little earlier, and a vibrato moves on meanwhile).
        nextGrain = at + juce::jmax (8.0, rate / ((double) frame.f0 * frame.ratio));
    }
}

// ---------------------------------------------------------------------------------------------------------
// What it says
// ---------------------------------------------------------------------------------------------------------

juce::var State::describe() const
{
    // The latest pitches, each `[number, sung, heard, target]` (notes as MIDI numbers, fractions are cents;
    // -1: no pitch), a frame pair apart (about 5 ms), oldest first.
    const auto count = reported.load (std::memory_order_acquire);
    juce::Array<juce::var> points;
    for (auto n = juce::jmax ((juce::int64) 0, count - 32); n < count; ++n)
    {
        const auto& r = reports[(size_t) (n % reportSize)];
        points.add (juce::Array<juce::var> { (double) n, (double) r.in.load (std::memory_order_relaxed), (double) r.out.load (std::memory_order_relaxed), r.target.load (std::memory_order_relaxed) });
    }
    auto* object = new juce::DynamicObject();
    object->setProperty ("latency", delay);
    object->setProperty ("step", 2.0 * hop / rate);
    object->setProperty ("points", points);
    return juce::var (object);
}

std::shared_ptr<State> Registry::get (const juce::String& effectId, double sampleRate, double minHz, int capacity)
{
    if (auto found = states.find (effectId); found != states.end())
    {
        const auto& state = found->second;
        if (juce::exactlyEqual (state->sampleRate(), sampleRate) && juce::exactlyEqual (state->lowest(), minHz) && state->capacity() >= capacity)
            return state;
    }
    auto state = std::make_shared<State> (sampleRate, minHz, capacity);
    states[effectId] = state;
    return state;
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
} // namespace tune
