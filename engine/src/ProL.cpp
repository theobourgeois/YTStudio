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

    s->delay = (int) std::lround ((s->reserve + s->range) * rate);
    state.prepare (s->oversampling);
    s->lastStage = state.lastStageLatency (*s);
    s->latency = s->delay + state.oversamplingLatency (s->oversampling) + s->lastStage;
    // What the core is built for (its ramps' lengths, its delays): a change starts it afresh.
    s->shape = (juce::String (s->oversampling) + "|" + juce::String (s->delay) + "|" + juce::String (std::lround (s->lookahead * 1e7)) + "|" + juce::String (s->layers) + "|"
                + juce::String (std::lround (s->bass * 1e7)) + "|" + (s->truePeak ? "tp" : "-"))
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
    for (auto* rings : { &c->audio, &c->mainGain, &c->bassGain, &c->releaseGain })
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
    return s.oversampling > 1 ? juce::jmax (1, (int) std::lround (catchAhead * rate)) : 0;
}

State::Core& State::coreFor (int factor)
{
    const auto index = (size_t) juce::jlimit (0, 4, (int) std::lround (std::log2 ((double) juce::jmax (1, factor))));
    // (`Settings::parse` made it; were it missing, the plain one, which the constructor made, stands in.)
    return cores[index] != nullptr ? *cores[index] : *cores[0];
}

void State::reset (const Settings& s)
{
    core = &coreFor (s.oversampling);
    auto& c = *core;
    const auto fo = rate * c.factor;
    const auto delay = s.delay * c.factor;
    const auto ahead = juce::jlimit (1, juce::jmax (1, delay), (int) std::lround (s.lookahead * fo));
    const auto bassAhead = s.bass > 0 ? juce::jlimit (1, juce::jmax (1, delay), (int) std::lround (s.bass * fo)) : 0;
    for (int ch = 0; ch < 2; ++ch)
    {
        std::fill (c.audio[(size_t) ch].begin(), c.audio[(size_t) ch].end(), 0.0f);
        for (auto* rings : { &c.mainGain, &c.bassGain, &c.releaseGain })
            std::fill ((*rings)[(size_t) ch].begin(), (*rings)[(size_t) ch].end(), 1.0f);
        c.main[(size_t) ch].reset (ahead + 1, s.layers);
        c.bass[(size_t) ch].reset (juce::jmax (1, bassAhead) + 1, 4);
        c.bassFilter[(size_t) ch] = {};
        c.onsetFilter[(size_t) ch] = {};
    }
    c.follower = c.sinceOver = c.busy = c.fastEnv = c.slowEnv = c.boost = c.lastReduction = {};
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
    auto& c = *core;
    const auto factor = c.factor;
    const auto fo = rate * factor;
    const auto mask = c.size - 1;
    const auto delay = s.delay * factor;
    const auto ahead = juce::jlimit (1, juce::jmax (1, delay), (int) std::lround (s.lookahead * fo));
    const auto bassAhead = s.bass > 0 ? juce::jlimit (1, juce::jmax (1, delay), (int) std::lround (s.bass * fo)) : 0;
    const auto manualHold = s.hold >= 0 ? (int) std::lround (s.hold * fo) : -1;
    const auto autoMost = (int) std::lround (autoHoldMost * fo), holdMargin = (int) std::lround (0.0005 * fo);
    const auto osLatency = oversamplingLatency (factor);
    const auto total = s.delay + osLatency + s.lastStage;
    latencyNow.store (total, std::memory_order_relaxed);

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
    double reduction = 0;

    for (int start = 0; start < numSamples; start += chunk)
    {
        const auto m = juce::jmin (chunk, numSamples - start);
        const auto writeStart = ringWrite;

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

        // The limiter, at the oversampled rate.
        for (int i = 0; i < count; ++i)
        {
            const double ceiling = chunkCeiling[(size_t) (i / factor)];
            const auto t = c.t;
            double x[2] { a[0][i], a[1][i] }, over[2] {}, bassOver[2] {};
            for (int ch = 0; ch < 2; ++ch)
            {
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
                c.audio[(size_t) ch][(size_t) (t & mask)] = (float) x[ch];
                const auto level = std::abs (x[ch]);
                over[ch] = level > ceiling ? toDb (level / ceiling) : 0.0;
                if (bassAhead > 0)
                {
                    const auto low = std::abs (run (lp, x[ch], c.bassFilter[(size_t) ch].data()));
                    bassOver[ch] = low > ceiling ? toDb (low / ceiling) : 0.0;
                }
            }

            // Auto Hold: half the period of the bass when it's loud enough to matter (the mid, low-passed).
            auto hold = manualHold;
            {
                const auto low = run (lp, 0.5 * (x[0] + x[1]), c.holdFilter.data());
                c.holdEnv = juce::jmax (std::abs (low), c.holdEnv * holdFall);
                if ((low >= 0) != (c.holdLast >= 0))
                {
                    c.previousHalf = c.halfPeriod;
                    c.halfPeriod = (int) juce::jmin ((juce::int64) autoMost, t - c.lastCross);
                    c.lastCross = t;
                }
                c.holdLast = low;
                if (hold < 0)
                    hold = c.holdEnv > 0.3 * ceiling ? juce::jmin (autoMost, juce::jmax (c.halfPeriod, c.previousHalf) + holdMargin) : 0;
            }

            const auto most = juce::jmax (over[0], over[1]), bassMost = juce::jmax (bassOver[0], bassOver[1]);
            for (int ch = 0; ch < 2; ++ch)
            {
                const auto transient = over[ch] + s.linkTransients * (most - over[ch]);
                const auto slow = over[ch] + s.linkRelease * (most - over[ch]);

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

                // The bass stage: the low end's demand, over a longer ramp.
                if (bassAhead > 0)
                {
                    const auto low = bassOver[ch] + s.linkTransients * (bassMost - bassOver[ch]);
                    const auto ob = t - bassAhead;
                    const auto bassGain = c.bass[(size_t) ch].step (fromDb (-low), bassAhead, hold, 1, riseBass);
                    if (ob >= 0)
                        c.bassGain[(size_t) ch][(size_t) (ob & mask)] = (float) bassGain;
                }

                // Out: the sample `delay` back, under the lower of the two gains.
                const auto e = t - delay;
                double y = 0;
                if (e >= 0)
                {
                    auto g = (double) c.mainGain[(size_t) ch][(size_t) (e & mask)];
                    if (bassAhead > 0)
                        g = juce::jmin (g, (double) c.bassGain[(size_t) ch][(size_t) (e & mask)]);
                    y = g * c.audio[(size_t) ch][(size_t) (e & mask)];
                    reduction = juce::jmax (reduction, -toDb (g));
                }
                a[ch][i] = (float) y;
            }
            ++c.t;
        }

        if (factor > 1)
            c.oversampler->processSamplesDown (part);

        // The last stage, Unity Gain, the slot's mix.
        for (int j = 0; j < m; ++j)
        {
            const auto i = start + j;
            const auto pos = (writeStart + j) % dryLength;
            float y[2] { chunkAudio.getSample (0, j), chunkAudio.getSample (1, j) };
            const auto ceiling = (double) ceilingRing[(size_t) (((pos - s.delay - osLatency) % dryLength + dryLength) % dryLength)];
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
            const auto unity = s.unityGain ? fromDb (-gainNow) : 1.0;
            for (int ch = 0; ch < 2; ++ch)
            {
                auto out = y[ch] * unity * fadeIn;
                if (mix < 1.0f)
                    out = mix * out + (1.0f - mix) * dryRing.getSample (ch, ((pos - total) % dryLength + dryLength) % dryLength);
                (ch == 0 ? left : right)[i] = (float) out;
            }
        }
    }
    nowReduction.store ((float) reduction, std::memory_order_relaxed);
}

juce::var State::describe() const
{
    auto* object = new juce::DynamicObject();
    object->setProperty ("latency", latencyNow.load());
    object->setProperty ("reduction", nowReduction.load());
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

juce::var Registry::describe() const
{
    auto* object = new juce::DynamicObject();
    for (const auto& [id, state] : states)
        object->setProperty (id, state->describe());
    return juce::var (object);
}
} // namespace limit
