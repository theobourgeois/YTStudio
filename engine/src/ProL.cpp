#include "ProL.h"

#include <cmath>

namespace limit
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
double toDb (double g) { return 20 * std::log10 (std::max (g, 1e-12)); }
double fromDb (double d) { return std::pow (10.0, d / 20); }
/** A one-pole's step towards its target over `seconds` (1: at once). */
double coefficient (double seconds, double sampleRate) { return seconds <= 0 ? 1.0 : 1.0 - std::exp (-1.0 / (seconds * sampleRate)); }

/** A second-order Butterworth low-pass (transposed direct form II; its state is two values). */
struct LowPass
{
    double b0 = 1, b1 = 0, b2 = 0, a1 = 0, a2 = 0;
};
LowPass highPass (double frequency, double sampleRate)
{
    const auto k = std::tan (juce::MathConstants<double>::pi * frequency / sampleRate), q = std::sqrt (0.5);
    const auto norm = 1 / (1 + k / q + k * k);
    LowPass f;
    f.b0 = norm;
    f.b1 = -2 * norm;
    f.b2 = norm;
    f.a1 = 2 * (k * k - 1) * norm;
    f.a2 = (1 - k / q + k * k) * norm;
    return f;
}
LowPass lowPass (double frequency, double sampleRate)
{
    const auto k = std::tan (juce::MathConstants<double>::pi * frequency / sampleRate), q = std::sqrt (0.5);
    const auto norm = 1 / (1 + k / q + k * k);
    LowPass f;
    f.b0 = k * k * norm;
    f.b1 = 2 * f.b0;
    f.b2 = f.b0;
    f.a1 = 2 * (k * k - 1) * norm;
    f.a2 = (1 - k / q + k * k) * norm;
    return f;
}
double run (const LowPass& f, double x, double* z)
{
    const auto y = f.b0 * x + z[0];
    z[0] = f.b1 * x - f.a1 * y + z[1];
    z[1] = f.b2 * x - f.a2 * y;
    return y;
}

// The most each time can be (seconds): its storage is made for them.
constexpr double reserveMost = 0.045, rangeMost = 0.005, holdMost = 0.05, autoHoldMost = 0.025;
// The sample-peak catch's look-ahead and hold, and the true peak passes' look-ahead (seconds).
constexpr double catchAhead = 0.0005, catchHold = 0.001, passAheadSeconds = 0.001;
/** The true peak passes' margin under the ceiling (dB): what their detector can still miss. */
constexpr double truePeakMargin = 0.03;
/** Where the bass stage and Auto Hold listen (Hz), and above where Dynamic's onsets are heard (so a bass note's own cycle isn't one). */
constexpr double bassFrequency = 150, onsetFrequency = 200;

int powerOfTwoAtLeast (int n)
{
    auto size = 1;
    while (size < n)
        size <<= 1;
    return size;
}
} // namespace

// ---------------------------------------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------------------------------------

std::shared_ptr<Settings> Settings::parse (const juce::var& json, State& state)
{
    auto s = std::make_shared<Settings>();
    const auto rate = state.sampleRate();
    s->gain = number (json["gain"], 0, -30, 40);
    s->ceiling = number (json["ceiling"], 0, -30, 0);
    s->truePeak = (bool) json["truePeak"];
    const auto factor = (int) number (json["oversampling"], 1, 1, 16);
    s->oversampling = factor >= 16 ? 16 : factor >= 8 ? 8 : factor >= 4 ? 4 : factor >= 2 ? 2 : 1;
    s->range = number (json["range"], 0.005, 0, rangeMost);
    s->reserve = number (json["reserve"], 0, 0, reserveMost);
    s->lookahead = number (json["lookahead"], 0.0005, 0, s->range + s->reserve);
    s->layers = (int) number (json["layers"], 4, 1, 4);
    const auto hold = json["hold"];
    s->hold = hold.isVoid() || ((hold.isDouble() || hold.isInt()) && (double) hold < 0) ? -1.0 : number (hold, 0, 0, holdMost);
    s->fastRelease = number (json["fastRelease"], 0.01, 0, 1);
    s->slowRelease = number (json["slowRelease"], s->fastRelease, s->fastRelease, 5);
    if (const auto stage = json["releaseStage"]; stage.isObject())
    {
        auto& r = s->releaseStage;
        r.on = true;
        r.attack = number (stage["attack"], 0.275, 0, 10);
        r.release = number (stage["release"], 0.4, 0, 10);
        r.strength = number (stage["strength"], 1, 0, 1);
        r.floor = number (stage["floor"], 0, 0, 10);
        r.delay = number (stage["delay"], 0, 0, 2);
    }
    s->bass = number (json["bass"], 0, 0, s->range + s->reserve);
    s->emphasis = number (json["emphasis"], 0, 0, 6);
    s->linkTransients = number (json["linkTransients"], 0.75, 0, 1);
    s->linkRelease = number (json["linkRelease"], 1, 0, 1);
    s->dcFilter = (bool) json["dcFilter"];
    s->unityGain = (bool) json["unityGain"];
    s->ditherBits = (int) number (json["dither"], 0, 0, 24);
    if (s->ditherBits < 8)
        s->ditherBits = 0;
    const auto shaping = json["noiseShaping"].toString();
    s->ditherShaping = shaping == "basic" ? 1 : shaping == "optimized" ? 2 : shaping == "weighted" ? 3 : 0;
    s->midSide = json["stereo"].toString() == "ms";
    s->sideFloor = number (json["sideFloor"], -6, -18, 0);
    if (const auto clip = json["clip"]; clip.isObject())
    {
        s->clip = true;
        s->clipRange = number (clip["range"], 1.5, 0, 6);
        s->clipKnee = number (clip["knee"], 1.5, 0, 6);
        const auto shape = clip["shape"].toString();
        s->clipShape = shape == "hard" ? ClipShape::hard : shape == "soft" ? ClipShape::soft : shape == "converter" ? ClipShape::converter : shape == "fl" ? ClipShape::fl : ClipShape::smooth;
        s->clipLast = clip["order"].toString() == "last";
    }
    const auto audition = json["audition"].toString();
    s->audition = audition == "all" ? 1 : audition == "clip" ? 2 : audition == "limiter" ? 3 : 0;

    s->delay = (int) std::lround ((s->reserve + s->range) * rate);
    // The clip stage clips at 4x at least (its anti-aliasing is made for it); it and its partner position after
    // the limiter are a sample each at that rate, rounded up to whole samples of the song's.
    s->factor = s->clip && s->oversampling < 4 ? 4 : s->oversampling;
    s->clipDelay = s->factor == 1 ? 2 : 1;
    state.prepare (s->factor);
    s->lastStage = state.lastStageLatency (*s);
    s->latency = s->delay + s->clipDelay + state.oversamplingLatency (s->factor) + s->lastStage;
    // What the core is built for (its ramps' lengths, its delays, its paths): a change starts it afresh.
    s->shape = (juce::String (s->factor) + "|" + juce::String (s->delay) + "|" + juce::String (std::lround (s->lookahead * 1e7)) + "|" + juce::String (s->layers) + "|"
                + juce::String (std::lround (s->bass * 1e7)) + "|" + (s->truePeak ? "tp" : "-") + (s->midSide ? "ms" : "lr") + (s->clip ? (s->clipLast ? "cl" : "cf") : "c-"))
                   .hashCode64();
    return s;
}

void Settings::set (Lane lane, const float* v, int size)
{
    juce::ignoreUnused (size);
    const auto x = (double) v[0];
    switch (lane)
    {
        case Lane::gain: gain = juce::jlimit (-30.0, 40.0, x); break;
        case Lane::output: ceiling = juce::jlimit (-30.0, 0.0, x); break;
        case Lane::attack: releaseStage.attack = juce::jlimit (0.0, 10.0, x); break;
        case Lane::release: releaseStage.release = juce::jlimit (0.0, 10.0, x); break;
        case Lane::hold: hold = x < 0 ? -1.0 : juce::jlimit (0.0, holdMost, x); break;
        case Lane::linkTransients: linkTransients = juce::jlimit (0.0, 1.0, x); break;
        case Lane::linkRelease: linkRelease = juce::jlimit (0.0, 1.0, x); break;
        case Lane::sideFloor: sideFloor = juce::jlimit (-18.0, 0.0, x); break;
        case Lane::clipRange: clipRange = juce::jlimit (0.0, 6.0, x); break;
        case Lane::clipKnee: clipKnee = juce::jlimit (0.0, 6.0, x); break;
    }
}

void Settings::get (Lane lane, float* v, int& size) const
{
    size = 1;
    switch (lane)
    {
        case Lane::gain: v[0] = (float) gain; break;
        case Lane::output: v[0] = (float) ceiling; break;
        case Lane::attack: v[0] = (float) releaseStage.attack; break;
        case Lane::release: v[0] = (float) releaseStage.release; break;
        case Lane::hold: v[0] = (float) hold; break;
        case Lane::linkTransients: v[0] = (float) linkTransients; break;
        case Lane::linkRelease: v[0] = (float) linkRelease; break;
        case Lane::sideFloor: v[0] = (float) sideFloor; break;
        case Lane::clipRange: v[0] = (float) clipRange; break;
        case Lane::clipKnee: v[0] = (float) clipKnee; break;
    }
}

// ---------------------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------------------

State::State (double sampleRate, int capacity) : rate (sampleRate), blockCapacity (juce::jmax (1, capacity))
{
    chunkAudio.setSize (2, chunk);
    chunkCeiling.assign ((size_t) chunk, 1.0f);
    // The dry ring: the longest main delay, the oversampling's, the last stage's, a block; and the ceiling's alongside.
    const auto room = (int) std::ceil ((reserveMost + rangeMost + 0.01) * rate) + 4096 + blockCapacity;
    dryRing.setSize (2, room);
    dryRing.clear();
    ceilingRing.assign ((size_t) room, 1.0f);
    const auto catchLook = juce::jmax (1, (int) std::lround (catchAhead * rate));
    catchStage.prepare (catchLook + (int) std::lround (catchHold * rate) + 8, catchLook + 8);
    for (auto& ring : catchRing)
        ring.assign ((size_t) powerOfTwoAtLeast (catchLook + 8), 0.0f);
    passAhead = juce::jmax (1, (int) std::lround (passAheadSeconds * rate));
    for (auto& pass : passes)
        pass.prepare (passAhead, rate);
    loudness.prepare (rate);
    columnSize = juce::jmax (1, (int) std::lround (0.01 * rate));
    windowSize = juce::jmax (1, (int) std::lround (0.1 * rate));
    prepare (1);
}

void State::prepare (int factor)
{
    const auto index = (size_t) juce::jlimit (0, 4, (int) std::lround (std::log2 ((double) juce::jmax (1, factor))));
    if (cores[index] != nullptr)
        return;
    auto c = std::make_unique<Core>();
    c->factor = 1 << index;
    if (c->factor > 1)
    {
        c->oversampler = std::make_unique<juce::dsp::Oversampling<float>> (2, index, juce::dsp::Oversampling<float>::filterHalfBandFIREquiripple, true, true);
        c->oversampler->initProcessing ((size_t) chunk);
    }
    const auto fo = rate * c->factor;
    const auto delayMost = (int) std::ceil ((reserveMost + rangeMost) * fo) + 8;
    c->size = powerOfTwoAtLeast (delayMost + 8);
    for (auto* rings : { &c->audio, &c->pre, &c->mainGain, &c->bassGain, &c->releaseGain })
        for (auto& ring : *rings)
            ring.assign ((size_t) c->size, 1.0f);
    const auto windowMost = (int) std::ceil ((reserveMost + rangeMost + holdMost) * fo) + 8;
    for (auto* stages : { &c->main, &c->bass })
        for (auto& stage : *stages)
            stage.prepare (windowMost, delayMost);
    cores[index] = std::move (c);
}

int State::oversamplingLatency (int factor) const
{
    const auto index = (size_t) juce::jlimit (0, 4, (int) std::lround (std::log2 ((double) juce::jmax (1, factor))));
    const auto& c = cores[index];
    return c == nullptr || c->oversampler == nullptr ? 0 : (int) std::lround (c->oversampler->getLatencyInSamples());
}

int State::lastStageLatency (const Settings& s) const
{
    if (s.truePeak)
        return passes[0].latency() + passes[1].latency();
    return s.factor > 1 ? juce::jmax (1, (int) std::lround (catchAhead * rate)) : 0;
}

State::Core& State::coreFor (int factor)
{
    const auto index = (size_t) juce::jlimit (0, 4, (int) std::lround (std::log2 ((double) juce::jmax (1, factor))));
    // (`Settings::parse` made it; were it missing, the plain one, which the constructor made, stands in.)
    return cores[index] != nullptr ? *cores[index] : *cores[0];
}

void State::reset (const Settings& s)
{
    core = &coreFor (s.factor);
    auto& c = *core;
    const auto fo = rate * c.factor;
    const auto delay = s.delay * c.factor;
    const auto ahead = juce::jlimit (1, juce::jmax (1, delay), (int) std::lround (s.lookahead * fo));
    const auto bassAhead = s.bass > 0 ? juce::jlimit (1, juce::jmax (1, delay), (int) std::lround (s.bass * fo)) : 0;
    for (int ch = 0; ch < 2; ++ch)
    {
        std::fill (c.audio[(size_t) ch].begin(), c.audio[(size_t) ch].end(), 0.0f);
        std::fill (c.pre[(size_t) ch].begin(), c.pre[(size_t) ch].end(), 0.0f);
        c.clipFirst[(size_t) ch].reset();
        c.clipLast[(size_t) ch].reset();
        for (auto* rings : { &c.mainGain, &c.bassGain, &c.releaseGain })
            std::fill ((*rings)[(size_t) ch].begin(), (*rings)[(size_t) ch].end(), 1.0f);
        c.main[(size_t) ch].reset (ahead + 1, s.layers);
        c.bass[(size_t) ch].reset (juce::jmax (1, bassAhead) + 1, 4);
        c.bassFilter[(size_t) ch] = {};
        c.onsetFilter[(size_t) ch] = {};
    }
    c.follower = c.sinceOver = c.busy = c.fastEnv = c.slowEnv = c.boost = c.lastReduction = {};
    c.lastLimited = c.lastPre = c.lastAudio = {};
    c.holdFilter = {};
    c.holdLast = c.holdEnv = 0;
    c.lastCross = 0;
    c.halfPeriod = c.previousHalf = 0;
    c.t = 0;

    const auto catchLook = juce::jmax (1, (int) std::lround (catchAhead * rate));
    catchStage.reset (catchLook + 1, 4);
    for (auto& ring : catchRing)
        std::fill (ring.begin(), ring.end(), 0.0f);
    catchWrite = 0;
    for (auto& pass : passes)
        pass.reset();
    dryRing.clear();
    std::fill (ceilingRing.begin(), ceilingRing.end(), 1.0f);
    ringWrite = 0;
    gainNow = s.gain;
    ceilingNow = s.ceiling;
    dcIn = dcOut = {};
    fadeIn = 0;
    shape = s.shape;
    stale = false;
}

void State::process (const Settings& s, float* left, float* right, int numSamples, float mix)
{
    juce::ScopedNoDenormals noDenormals;
    if (numSamples <= 0 || numSamples > blockCapacity)
        return;
    if (stale || s.shape != shape || core == nullptr)
        reset (s);
    if (resetRequest.exchange (false))
    {
        loudness.restart();
        mostClip = mostLimit = 0;
        maxClip.store (0, std::memory_order_relaxed);
        maxLimit.store (0, std::memory_order_relaxed);
    }
    if (const auto wanted = s.ditherBits * 4 + s.ditherShaping; wanted != ditherFor)
    {
        dither.set (s.ditherBits, s.ditherShaping, rate);
        dither.reset();
        ditherFor = wanted;
    }
    const auto held = paused.load (std::memory_order_relaxed);
    auto& c = *core;
    const auto factor = c.factor;
    const auto fo = rate * factor;
    const auto mask = c.size - 1;
    // The main delay at the core's rate, padded so that it and the clip stage's two positions (a sample each)
    // come to whole samples of the song's.
    const auto delay = s.delay * factor + s.clipDelay * factor - 2;
    const auto ahead = juce::jlimit (1, juce::jmax (1, delay), (int) std::lround (s.lookahead * fo));
    const auto bassAhead = s.bass > 0 ? juce::jlimit (1, juce::jmax (1, delay), (int) std::lround (s.bass * fo)) : 0;
    const auto manualHold = s.hold >= 0 ? (int) std::lround (s.hold * fo) : -1;
    const auto autoMost = (int) std::lround (autoHoldMost * fo), holdMargin = (int) std::lround (0.0005 * fo);
    const auto osLatency = oversamplingLatency (factor);
    const auto total = s.delay + s.clipDelay + osLatency + s.lastStage;
    latencyNow.store (total, std::memory_order_relaxed);
    const auto auditioning = s.audition != 0;

    // Coefficients: the glides (10 ms), the release stage's, how busy the transient stage is (100 ms), the
    // bass stage's release (30 ms), Dynamic's envelopes, Auto Hold's level (30 ms), the DC filter (1.5 Hz).
    const auto cGlide = coefficient (0.01, rate);
    const auto& rs = s.releaseStage;
    const auto keepAttack = rs.attack > 0 ? std::exp (-1.0 / (rs.attack * fo)) : 0.0;
    const auto releaseSeconds = juce::jmax (rs.release, rs.floor);
    const auto keepRelease = releaseSeconds > 0 ? std::exp (-1.0 / (releaseSeconds * fo)) : 0.0;
    const auto cBusy = coefficient (0.1, fo), riseBass = coefficient (0.03, fo);
    const auto fastUp = coefficient (0.001, fo), fastDown = coefficient (0.02, fo), slowUp = coefficient (0.02, fo), slowDown = coefficient (0.2, fo), boostGlide = coefficient (0.001, fo);
    const auto holdFall = std::exp (-1.0 / (0.03 * fo));
    const auto dcKeep = std::exp (-2 * juce::MathConstants<double>::pi * 1.5 / rate);
    const auto lp = lowPass (bassFrequency, fo);
    const auto hp = highPass (onsetFrequency, fo);
    const auto riseConstant = s.fastRelease <= 0 ? 1.0 : s.slowRelease <= s.fastRelease ? coefficient (s.fastRelease, fo) : -1.0;
    const auto catchLook = juce::jmax (1, (int) std::lround (catchAhead * rate)), catchHoldSamples = (int) std::lround (catchHold * rate);
    const auto catchRise = coefficient (0.005, rate);
    const auto catchMask = (int) catchRing[0].size() - 1;
    const auto dryLength = dryRing.getNumSamples();
    const auto fadeStep = 1.0 / (0.005 * rate);
    const auto floorGain = fromDb (s.sideFloor);
    const auto gap = fromDb (s.clipRange);
    double reduction = 0;
    // The clip curves, made again only when the ceiling moves: before the limiter it sits `clipRange` over the
    // ceiling; after it, at the ceiling (the limiter's then `clipRange` over).
    ClipCurve first, last;
    double curvesFor = -1;

    for (int start = 0; start < numSamples; start += chunk)
    {
        const auto m = juce::jmin (chunk, numSamples - start);
        const auto writeStart = ringWrite;
        std::fill (chunkClip.begin(), chunkClip.begin() + m, 0.0f);
        std::fill (chunkLimit.begin(), chunkLimit.begin() + m, 0.0f);
        std::fill (chunkClipped.begin(), chunkClipped.begin() + m, false);

        // In: the DC filter, the gain and the ceiling (gliding), the dry sound and the ceiling kept for later.
        for (int j = 0; j < m; ++j)
        {
            const auto i = start + j;
            gainNow += (s.gain - gainNow) * cGlide;
            ceilingNow += (s.ceiling - ceilingNow) * cGlide;
            const auto g = fromDb (gainNow);
            const double in[2] { left[i], right[i] };
            for (int ch = 0; ch < 2; ++ch)
            {
                dryRing.setSample (ch, ringWrite, (float) in[ch]);
                auto x = in[ch];
                if (s.dcFilter)
                {
                    const auto y = x - dcIn[(size_t) ch] + dcKeep * dcOut[(size_t) ch];
                    dcIn[(size_t) ch] = x;
                    dcOut[(size_t) ch] = y;
                    x = y;
                }
                chunkAudio.setSample (ch, j, (float) (x * g));
            }
            for (int ch = 0; ch < 2; ++ch)
                chunkInput[(size_t) ch][(size_t) j] = std::abs (chunkAudio.getSample (ch, j));
            chunkCeiling[(size_t) j] = (float) fromDb (ceilingNow);
            ceilingRing[(size_t) ringWrite] = chunkCeiling[(size_t) j];
            ringWrite = (ringWrite + 1) % dryLength;
        }

        juce::dsp::AudioBlock<float> block (chunkAudio);
        auto part = block.getSubBlock (0, (size_t) m);
        float* a[2] { chunkAudio.getWritePointer (0), chunkAudio.getWritePointer (1) };
        auto count = m;
        if (factor > 1)
        {
            auto up = c.oversampler->processSamplesUp (part);
            a[0] = up.getChannelPointer (0);
            a[1] = up.getChannelPointer (1);
            count = m * factor;
        }

        // The limiter, at the oversampled rate. In mid/side, "channels" 0 and 1 are the mid and the side.
        for (int i = 0; i < count; ++i)
        {
            const double ceiling = chunkCeiling[(size_t) (i / factor)];
            if (ceiling != curvesFor)
            {
                first.set (s.clipShape, ceiling * gap, s.clipKnee);
                last.set (s.clipShape, ceiling, s.clipKnee);
                curvesFor = ceiling;
            }
            // What the limiter holds to: the ceiling, or (the clip stage after it) the ceiling plus the gap.
            const auto limit = s.clip && s.clipLast ? ceiling * gap : ceiling;
            const auto t = c.t;
            double x[2] { a[0][i], a[1][i] };
            for (int ch = 0; ch < 2; ++ch)
                if (s.emphasis > 0)
                {
                    // Dynamic: an onset turned up before the limiter, as much as it's limiting. An onset is the sound
                    // above the bass rising fast over the whole sound's slower level: a held note (a bass's cycle
                    // included) is never one, since what's above 200 Hz of it stays under its own level.
                    const auto high = std::abs (run (hp, x[ch], c.onsetFilter[(size_t) ch].data()));
                    const auto level = std::abs (x[ch]);
                    auto& fast = c.fastEnv[(size_t) ch];
                    auto& slow = c.slowEnv[(size_t) ch];
                    fast += (high - fast) * (high > fast ? fastUp : fastDown);
                    slow += (level - slow) * (level > slow ? slowUp : slowDown);
                    const auto rise = slow > 1e-6 ? toDb (fast / slow) : 0.0;
                    const auto want = juce::jlimit (0.0, s.emphasis, 0.5 * rise) * juce::jlimit (0.0, 1.0, c.lastReduction[(size_t) ch] / 3);
                    c.boost[(size_t) ch] += (want - c.boost[(size_t) ch]) * boostGlide;
                    x[ch] *= fromDb (c.boost[(size_t) ch]);
                }
            if (s.midSide)
            {
                const auto mid = 0.5 * (x[0] + x[1]), side = 0.5 * (x[0] - x[1]);
                x[0] = mid;
                x[1] = side;
            }
            // The clip stage before the limiter (or, off or after it, a sample's delay): what went in, and what came out.
            double over[2] {}, bassOver[2] {}, requirement[2] { 1, 1 };
            for (int ch = 0; ch < 2; ++ch)
            {
                const auto previous = c.clipFirst[(size_t) ch].previousX;
                if (s.clip && ! s.clipLast)
                    clipped (first, x[ch], i / factor);
                x[ch] = c.clipFirst[(size_t) ch].process (first, x[ch], s.clip && ! s.clipLast);
                c.pre[(size_t) ch][(size_t) (t & mask)] = (float) previous;
                c.audio[(size_t) ch][(size_t) (t & mask)] = (float) x[ch];
                const auto level = std::abs (x[ch]);
                over[ch] = level > limit ? toDb (level / limit) : 0.0;
                if (bassAhead > 0 && (ch == 0 || ! s.midSide))
                {
                    const auto low = std::abs (run (lp, x[ch], c.bassFilter[(size_t) ch].data()));
                    bassOver[ch] = low > limit ? toDb (low / limit) : 0.0;
                }
            }
            if (s.midSide)
            {
                // Side first: the side turned down to its floor before the mid moves, so |L| and |R|, which are
                // |mid| + |side| at most, stay under the ceiling (the guarantee holds for the pair: pro-l.md §5.3).
                const auto am = std::abs (x[0]), as = std::abs (x[1]);
                if (am + as > limit)
                {
                    if (as > 0 && am < limit && (limit - am) / as >= floorGain)
                        requirement[1] = (limit - am) / as;
                    else if (am > 1e-12)
                    {
                        requirement[1] = as > 0 ? juce::jmin (1.0, floorGain) : 1.0;
                        requirement[0] = juce::jmax (0.0, (limit - requirement[1] * as) / am);
                        if (requirement[0] <= 0)
                            requirement[1] = juce::jmin (requirement[1], limit / as);
                    }
                    else
                        requirement[1] = juce::jmin (1.0, limit / as);
                }
            }

            // Auto Hold: half the period of the bass when it's loud enough to matter (the mid, low-passed).
            auto hold = manualHold;
            {
                const auto mid = s.midSide ? x[0] : 0.5 * (x[0] + x[1]);
                const auto low = run (lp, mid, c.holdFilter.data());
                c.holdEnv = juce::jmax (std::abs (low), c.holdEnv * holdFall);
                if ((low >= 0) != (c.holdLast >= 0))
                {
                    c.previousHalf = c.halfPeriod;
                    c.halfPeriod = (int) juce::jmin ((juce::int64) autoMost, t - c.lastCross);
                    c.lastCross = t;
                }
                c.holdLast = low;
                if (hold < 0)
                    hold = c.holdEnv > 0.3 * limit ? juce::jmin (autoMost, juce::jmax (c.halfPeriod, c.previousHalf) + holdMargin) : 0;
            }

            const auto most = juce::jmax (over[0], over[1]), bassMost = juce::jmax (bassOver[0], bassOver[1]);
            double limited[2] {};
            for (int ch = 0; ch < 2; ++ch)
            {
                // What this channel's gain must come down by (dB): linked in left/right, side first in mid/side.
                const auto transient = s.midSide ? -toDb (requirement[ch]) : over[ch] + s.linkTransients * (most - over[ch]);
                const auto slow = s.midSide ? transient : over[ch] + s.linkRelease * (most - over[ch]);

                // The release stage: a follower of the demand (dB), its gain kept for the sample it reacted to.
                auto releaseGain = 1.0;
                if (rs.on)
                {
                    auto& f = c.follower[(size_t) ch];
                    if (slow * rs.strength > f)
                    {
                        f = keepAttack * f + (1 - keepAttack) * slow * rs.strength;
                        c.sinceOver[(size_t) ch] = 0;
                    }
                    else if ((c.sinceOver[(size_t) ch] += 1.0 / fo) >= rs.delay)
                        f = keepRelease * f + (1 - keepRelease) * slow;
                    if (f < 1e-6)
                        f = 0;
                    releaseGain = fromDb (-f);
                }
                c.releaseGain[(size_t) ch][(size_t) (t & mask)] = (float) releaseGain;

                // The main stage, for the sample `ahead` back.
                const auto o = t - ahead;
                const auto floor = o >= 0 ? (double) c.releaseGain[(size_t) ch][(size_t) (o & mask)] : 1.0;
                const auto rise = riseConstant >= 0 ? riseConstant : coefficient (s.fastRelease * std::pow (s.slowRelease / s.fastRelease, c.busy[(size_t) ch]), fo);
                const auto gain = c.main[(size_t) ch].step (fromDb (-transient), ahead, hold, floor, rise);
                if (o >= 0)
                    c.mainGain[(size_t) ch][(size_t) (o & mask)] = (float) gain;
                c.busy[(size_t) ch] += ((gain < 0.944 ? 1.0 : 0.0) - c.busy[(size_t) ch]) * cBusy;
                c.lastReduction[(size_t) ch] = -toDb (gain);

                // The bass stage: the low end's demand, over a longer ramp (the mid's alone in mid/side).
                if (bassAhead > 0 && (ch == 0 || ! s.midSide))
                {
                    const auto low = s.midSide ? bassOver[0] : bassOver[ch] + s.linkTransients * (bassMost - bassOver[ch]);
                    const auto ob = t - bassAhead;
                    const auto bassGain = c.bass[(size_t) ch].step (fromDb (-low), bassAhead, hold, 1, riseBass);
                    if (ob >= 0)
                        c.bassGain[(size_t) ch][(size_t) (ob & mask)] = (float) bassGain;
                }

                // Out: the sample `delay` back, under the lower of the two gains.
                const auto e = t - delay;
                if (e >= 0)
                {
                    auto g = (double) c.mainGain[(size_t) ch][(size_t) (e & mask)];
                    if (bassAhead > 0 && (ch == 0 || ! s.midSide))
                        g = juce::jmin (g, (double) c.bassGain[(size_t) ch][(size_t) (e & mask)]);
                    limited[ch] = g * c.audio[(size_t) ch][(size_t) (e & mask)];
                    reduction = juce::jmax (reduction, -toDb (g));
                    auto& shown = chunkLimit[(size_t) (i / factor)];
                    shown = juce::jmax (shown, (float) -toDb (g));
                }
            }

            // The clip stage after the limiter (or a sample's delay), then what's heard: the sound, or Audition's share.
            for (int ch = 0; ch < 2; ++ch)
            {
                const auto e = t - delay;
                const auto preNow = e >= 0 ? (double) c.pre[(size_t) ch][(size_t) (e & mask)] : 0.0;
                const auto audioNow = e >= 0 ? (double) c.audio[(size_t) ch][(size_t) (e & mask)] : 0.0;
                if (s.clip && s.clipLast)
                    clipped (last, limited[ch], i / factor);
                auto y = c.clipLast[(size_t) ch].process (last, limited[ch], s.clip && s.clipLast);
                if (auditioning)
                {
                    // Lined up with `y`, which is a sample late: last sample's sources.
                    const auto all = c.lastPre[(size_t) ch] - y;
                    const auto clipped = s.clipLast ? c.lastLimited[(size_t) ch] - y : c.lastPre[(size_t) ch] - c.lastAudio[(size_t) ch];
                    const auto limiterShare = s.clipLast ? c.lastAudio[(size_t) ch] - c.lastLimited[(size_t) ch] : c.lastAudio[(size_t) ch] - y;
                    y = s.audition == 1 ? all : s.audition == 2 ? clipped : limiterShare;
                }
                c.lastPre[(size_t) ch] = preNow;
                c.lastAudio[(size_t) ch] = audioNow;
                c.lastLimited[(size_t) ch] = limited[ch];
                a[ch][i] = (float) y;
            }
            if (s.midSide)
            {
                const auto mid = (double) a[0][i], side = (double) a[1][i];
                a[0][i] = (float) (mid + side);
                a[1][i] = (float) (mid - side);
            }
            ++c.t;
        }

        if (factor > 1)
            c.oversampler->processSamplesDown (part);

        // The last stage, Unity Gain, the slot's mix (Audition: only the last stage's delay).
        for (int j = 0; j < m; ++j)
        {
            const auto i = start + j;
            const auto pos = (writeStart + j) % dryLength;
            float y[2] { chunkAudio.getSample (0, j), chunkAudio.getSample (1, j) };
            const auto ceiling = auditioning ? 1e9 : (double) ceilingRing[(size_t) (((pos - s.delay - s.clipDelay - osLatency) % dryLength + dryLength) % dryLength)];
            if (s.truePeak)
            {
                const auto inner = ceiling * fromDb (-truePeakMargin);
                passes[0].process (y[0], y[1], inner);
                passes[1].process (y[0], y[1], inner);
            }
            else if (factor > 1)
            {
                // The sample-peak catch: what the downsampler put back over the ceiling.
                const auto peak = (double) juce::jmax (std::abs (y[0]), std::abs (y[1]));
                const auto g = catchStage.step (peak > ceiling ? ceiling / peak : 1.0, catchLook, catchHoldSamples, 1, catchRise);
                for (int ch = 0; ch < 2; ++ch)
                {
                    catchRing[(size_t) ch][(size_t) (catchWrite & catchMask)] = y[ch];
                    y[ch] = (float) (g * catchRing[(size_t) ch][(size_t) ((catchWrite - catchLook) & catchMask)]);
                }
                ++catchWrite;
            }
            fadeIn = juce::jmin (1.0, fadeIn + fadeStep);
            if (! auditioning)
                measure (j, y, ceiling, held);
            const auto unity = s.unityGain && ! auditioning ? fromDb (-gainNow) : 1.0;
            float out[2];
            for (int ch = 0; ch < 2; ++ch)
            {
                out[ch] = (float) (y[ch] * unity * fadeIn);
                if (mix < 1.0f && ! auditioning)
                    out[ch] = mix * out[ch] + (1.0f - mix) * dryRing.getSample (ch, ((pos - total) % dryLength + dryLength) % dryLength);
            }
            if (dither.on() && ! auditioning)
                dither.process (out[0], out[1]);
            left[i] = out[0];
            right[i] = out[1];
        }
    }
    nowReduction.store ((float) reduction, std::memory_order_relaxed);
}

void State::clipped (const ClipCurve& curve, double x, int j)
{
    const auto a = std::abs (x);
    const auto out = curve.shaped (a);
    if (a <= 0 || out >= a)
        return;
    chunkClipped[(size_t) j] = true;
    chunkClip[(size_t) j] = juce::jmax (chunkClip[(size_t) j], (float) -toDb (out / a));
}

namespace
{
void raise (std::atomic<float>& most, float value)
{
    if (value > most.load (std::memory_order_relaxed))
        most.store (value, std::memory_order_relaxed);
}
float shownDb (double gain) { return (float) juce::jmax (-120.0, toDb (gain)); }
} // namespace

void State::measure (int j, const float* y, double ceiling, bool held)
{
    loudness.process (y[0], y[1], held);
    const auto near = ceiling * fromDb (-0.5);
    auto out = 0.0;
    for (int ch = 0; ch < 2; ++ch)
    {
        const auto a = (double) std::abs (y[ch]);
        out = juce::jmax (out, a);
        raise (outPeak[(size_t) ch], (float) a);
        raise (outTruePeak[(size_t) ch], (float) loudness.peaks[(size_t) ch]);
        raise (inPeak[(size_t) ch], chunkInput[(size_t) ch][(size_t) j]);
    }
    const auto clip = (double) chunkClip[(size_t) j], limitDb = (double) chunkLimit[(size_t) j];
    if (! held)
    {
        if (clip > mostClip)
            maxClip.store ((float) (mostClip = clip), std::memory_order_relaxed);
        if (limitDb > mostLimit)
            maxLimit.store ((float) (mostLimit = limitDb), std::memory_order_relaxed);
    }

    // The display's column.
    column.in = juce::jmax (column.in, shownDb (juce::jmax (chunkInput[0][(size_t) j], chunkInput[1][(size_t) j])));
    column.out = juce::jmax (column.out, shownDb (out));
    column.clip = juce::jmax (column.clip, (float) clip);
    column.limit = juce::jmax (column.limit, (float) limitDb);
    if (++columnFill >= columnSize)
    {
        column.m = loudness.momentary.load (std::memory_order_relaxed);
        column.s = loudness.shortTerm.load (std::memory_order_relaxed);
        const auto w = columnsWritten.load (std::memory_order_relaxed);
        columns[(size_t) (w % columnRing)] = column;
        columnsWritten.store (w + 1, std::memory_order_release);
        column = {};
        columnFill = 0;
    }

    // The last 400 ms: how much was clipped, and how much sat near the ceiling (a live sign of codec risk).
    clippedWindows[(size_t) windowIndex] += chunkClipped[(size_t) j] ? 1 : 0;
    denseWindows[(size_t) windowIndex] += out >= near ? 1 : 0;
    if (++windowFill >= windowSize)
    {
        auto clippedSum = 0, denseSum = 0;
        for (int k = 0; k < 4; ++k)
            clippedSum += clippedWindows[(size_t) k], denseSum += denseWindows[(size_t) k];
        clippedShare.store ((float) clippedSum / (float) (4 * windowSize), std::memory_order_relaxed);
        density.store ((float) denseSum / (float) (4 * windowSize), std::memory_order_relaxed);
        windowIndex = (windowIndex + 1) % 4;
        clippedWindows[(size_t) windowIndex] = denseWindows[(size_t) windowIndex] = 0;
        windowFill = 0;
    }
}

juce::var State::describe (bool drain)
{
    const auto pair = [&] (std::array<std::atomic<float>, 2>& peaks) {
        juce::Array<juce::var> list;
        for (auto& p : peaks)
            list.add (drain ? p.exchange (0) : p.load());
        return juce::var (list);
    };
    juce::Array<juce::var> list;
    if (drain)
    {
        const auto written = columnsWritten.load (std::memory_order_acquire);
        // Never more than the ring holds (a slow reader loses the oldest).
        for (auto w = juce::jmax (columnsRead, written - columnRing + 1); w < written; ++w)
        {
            const auto& c = columns[(size_t) (w % columnRing)];
            list.add (juce::Array<juce::var> { c.in, c.out, c.clip, c.limit, c.m, c.s });
        }
        columnsRead = written;
    }
    auto* meter = new juce::DynamicObject();
    meter->setProperty ("momentary", loudness.momentary.load());
    meter->setProperty ("shortTerm", loudness.shortTerm.load());
    meter->setProperty ("integrated", loudness.integrated.load());
    meter->setProperty ("range", loudness.range.load());
    meter->setProperty ("maxMomentary", loudness.maxMomentary.load());
    meter->setProperty ("maxShortTerm", loudness.maxShortTerm.load());
    meter->setProperty ("maxTruePeak", loudness.maxTruePeak.load());
    meter->setProperty ("seconds", loudness.seconds.load());
    meter->setProperty ("paused", paused.load());

    auto* object = new juce::DynamicObject();
    object->setProperty ("latency", latencyNow.load());
    object->setProperty ("reduction", nowReduction.load());
    object->setProperty ("input", pair (inPeak));
    object->setProperty ("output", pair (outPeak));
    object->setProperty ("truePeak", pair (outTruePeak));
    object->setProperty ("rms", juce::Array<juce::var> { loudness.channel[0].load(), loudness.channel[1].load() });
    object->setProperty ("loudness", juce::var (meter));
    object->setProperty ("clipped", clippedShare.load());
    object->setProperty ("density", density.load());
    object->setProperty ("maxClip", maxClip.load());
    object->setProperty ("maxReduction", maxLimit.load());
    object->setProperty ("step", columnSize / rate);
    object->setProperty ("columns", list);
    return juce::var (object);
}

// ---------------------------------------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------------------------------------

std::shared_ptr<State> Registry::get (const juce::String& effectId, double sampleRate, int capacity)
{
    auto& state = states[effectId];
    if (state == nullptr || std::abs (state->sampleRate() - sampleRate) > 0.5 || state->capacity() < capacity)
        state = std::make_shared<State> (sampleRate, capacity);
    return state;
}

std::shared_ptr<State> Registry::find (const juce::String& effectId) const
{
    const auto it = states.find (effectId);
    return it == states.end() ? nullptr : it->second;
}

void Registry::keepOnly (const juce::StringArray& ids)
{
    for (auto it = states.begin(); it != states.end();)
        it = ids.contains (it->first) ? std::next (it) : states.erase (it);
}

juce::var Registry::describe (bool drain) const
{
    auto* object = new juce::DynamicObject();
    for (const auto& [id, state] : states)
        object->setProperty (id, state->describe (drain));
    return juce::var (object);
}
} // namespace limit
