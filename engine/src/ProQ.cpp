#include "ProQ.h"

#include "Protocol.h"

namespace eq
{
namespace
{
/** Bands' settings glide and dynamics are worked out per control block of this many samples. */
constexpr int control = 32;

double number (const juce::var& v, double fallback, double low, double high)
{
    if (! (v.isDouble() || v.isInt() || v.isInt64()))
        return fallback;
    const auto x = (double) v;
    return std::isfinite (x) ? juce::jlimit (low, high, x) : fallback;
}

Shape shapeOf (const juce::String& name)
{
    static const juce::StringArray names { "bell", "lowShelf", "lowCut", "highShelf", "highCut", "notch", "bandPass", "tiltShelf", "flatTilt" };
    return (Shape) juce::jmax (0, names.indexOf (name));
}

Placement placementOf (const juce::String& name)
{
    static const juce::StringArray names { "stereo", "left", "right", "mid", "side" };
    return (Placement) juce::jmax (0, names.indexOf (name));
}

/** A band's shape at the gain it's at, Q narrowed by Gain-Q interaction (a Bell's). */
BandShape playing (const Band& band, double gain, bool gainQ)
{
    auto shape = band.shape;
    shape.gain = gain;
    if (gainQ && shape.shape == Shape::bell)
        shape.q = juce::jmin (40.0, shape.q * std::pow (10.0, std::abs (gain) / 80));
    return shape;
}

/** The parts of a stereo sound: left, right, mid, side. */
enum Part
{
    leftPart,
    rightPart,
    midPart,
    sidePart
};

/** Which parts a band's placement works on. */
bool works (Placement p, Part part)
{
    switch (p)
    {
        case Placement::stereo: return part == leftPart || part == rightPart;
        case Placement::left: return part == leftPart;
        case Placement::right: return part == rightPart;
        case Placement::mid: return part == midPart;
        case Placement::side: return part == sidePart;
    }
    return false;
}

/**
 * The whole EQ's response at `hz` as a matrix: each part's filters (analog, or as the matched digital
 * filters play them), left/right first, then mid/side. `override`: a band (by id) at another gain.
 */
Matrix response (const Settings& s, double hz, bool analog, double rate, int overrideId = 0, double overrideGain = 0, bool magnitude = false)
{
    std::array<std::complex<double>, 4> parts { 1.0, 1.0, 1.0, 1.0 };
    Sections sections;
    for (int i = 0; i < s.count; ++i)
    {
        const auto& band = s.bands[(size_t) i];
        const auto gain = band.id == overrideId ? overrideGain : band.shape.gain;
        analogSections (playing (band, gain, s.gainQ), sections);
        std::complex<double> h (1, 0);
        for (int k = 0; k < sections.count; ++k)
            h *= analog ? sections.list[(size_t) k].at (hz) : matched (sections.list[(size_t) k], rate).at (hz, rate);
        if (magnitude)
            h = std::abs (h);
        for (int part = 0; part < 4; ++part)
            if (works (band.placement, (Part) part))
                parts[(size_t) part] *= h;
    }
    // L/R first, then M/S: out = Dec · diag(M, S) · Enc · diag(L, R).
    const auto hl = parts[leftPart], hr = parts[rightPart], hm = parts[midPart], hs = parts[sidePart];
    return { (hm + hs) * 0.5 * hl, (hm - hs) * 0.5 * hr, (hm - hs) * 0.5 * hl, (hm + hs) * 0.5 * hr };
}

std::complex<double> det (const Matrix& m) { return m.ll * m.rr - m.lr * m.rl; }

/** a · b⁻¹. */
Matrix divide (const Matrix& a, const Matrix& b)
{
    const auto d = det (b);
    if (std::abs (d) < 1e-30)
        return {};
    const Matrix inv { b.rr / d, -b.lr / d, -b.rl / d, b.ll / d };
    return { a.ll * inv.ll + a.lr * inv.rl, a.ll * inv.lr + a.lr * inv.rr, a.rl * inv.ll + a.rr * inv.rl, a.rl * inv.lr + a.rr * inv.rr };
}

/**
 * Natural Phase's correction: what turns the matched filters' response into the analog one, exactly,
 * `delay` samples late (C = e^{-jwD} Ha Hd⁻¹), as a kernel for the convolver.
 */
Kernel naturalKernel (const Settings& s, double rate, int delay)
{
    constexpr int fftSize = 4096;
    std::vector<Matrix> responses ((size_t) fftSize / 2 + 1);
    for (int k = 0; k <= fftSize / 2; ++k)
    {
        const auto hz = k * rate / fftSize;
        // (Centred on `delay` as it's cut into taps.)
        responses[(size_t) k] = divide (response (s, hz, true, rate), response (s, hz, false, rate));
    }
    return kernelFromResponse (responses, fftSize, 2 * delay + 1, delay, naturalBlock);
}

/**
 * Linear Phase's kernel: the analog magnitude, no phase, `taps` long and centred. The bands are worked
 * out on a fine log scale and read between its points at each bin (a kernel of 128k bins would otherwise
 * take too long to make). `overrideId`: a band at another gain.
 */
std::vector<Matrix> linearResponse (const Settings& s, double rate, int fftSize, int overrideId = 0, double overrideGain = 0)
{
    constexpr int grid = 4096;
    const auto lowest = 1.0, nyquist = rate / 2;
    std::vector<Matrix> onGrid ((size_t) grid);
    for (int i = 0; i < grid; ++i)
        onGrid[(size_t) i] = response (s, lowest * std::pow (nyquist / lowest, (double) i / (grid - 1)), true, rate, overrideId, overrideGain, true);
    std::vector<Matrix> out ((size_t) fftSize / 2 + 1);
    const auto span = std::log (nyquist / lowest);
    for (int k = 0; k <= fftSize / 2; ++k)
    {
        const auto hz = juce::jmax (lowest, k * rate / fftSize);
        const auto at = std::log (hz / lowest) / span * (grid - 1);
        const auto i = juce::jlimit (0, grid - 2, (int) at);
        const auto t = juce::jlimit (0.0, 1.0, at - i);
        const auto& a = onGrid[(size_t) i];
        const auto& b = onGrid[(size_t) i + 1];
        const auto mix = [t] (std::complex<double> x, std::complex<double> y) { return x + (y - x) * t; };
        out[(size_t) k] = { mix (a.ll, b.ll), mix (a.lr, b.lr), mix (a.rl, b.rl), mix (a.rr, b.rr) };
    }
    return out;
}
} // namespace

int linearTaps (int resolution, double sampleRate)
{
    static const int taps[] = { 4096, 8192, 16384, 32768, 131072 };
    // Kept in ms at other rates: twice the taps at 88.2 and 96 kHz.
    const auto scale = juce::jmax (1, juce::nextPowerOfTwo ((int) std::lround (sampleRate / 44100.0)));
    return taps[juce::jlimit (0, 4, resolution)] * scale;
}

// ---------------------------------------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------------------------------------

std::shared_ptr<Settings> Settings::parse (const juce::var& json, int capacity, State& state)
{
    auto s = std::make_shared<Settings>();
    const auto rate = state.sampleRate();
    if (const auto* list = json["bands"].getArray())
        for (const auto& item : *list)
        {
            if (s->count >= maxBands)
                break;
            Band band;
            band.id = (int) number (item["id"], 1, 1, maxBands);
            band.shape.shape = shapeOf (item["shape"].toString());
            band.shape.frequency = number (item["frequency"], 1000, 10, 30000);
            band.shape.gain = number (item["gain"], 0, -60, 60);
            band.shape.q = number (item["q"], 1, 0.025, 40);
            band.shape.slope = (int) number (item["slope"], 12, 0, 96);
            band.placement = placementOf (item["placement"].toString());
            band.range = number (item["range"], 0, -60, 60);
            band.autoThreshold = item["threshold"].isVoid() || ! (item["threshold"].isDouble() || item["threshold"].isInt());
            band.threshold = number (item["threshold"], 0, -120, 0);
            if (s->find (band.id) != nullptr)
                continue;
            s->bands[(size_t) s->count++] = band;
        }
    static const juce::StringArray modes { "zeroLatency", "naturalPhase", "linearPhase" };
    s->mode = (Mode) juce::jmax (0, modes.indexOf (json["mode"].toString()));
    s->resolution = (int) number (json["resolution"], 1, 0, 4);
    s->gainQ = (bool) json["gainQ"];
    s->output = number (json["output"], 0, -100, 72);
    s->pan = number (json["pan"], 0, -1, 1);
    s->panMidSide = json["panMode"].toString() == "ms";
    s->invert = (bool) json["invert"];
    s->dynamicsPlay = s->mode != Mode::linearPhase || s->resolution <= 2;
    s->dry.setSize (2, juce::jmax (1, capacity));

    // The modes' kernels, made again only when what they're made of changes (any edit of the song sends it).
    const auto key = juce::JSON::toString (json["bands"], true) + json["mode"].toString() + juce::String (s->resolution) + (s->gainQ ? "q" : "") + juce::String (rate);
    if (s->mode == Mode::naturalPhase)
    {
        const auto delay = (int) std::lround (naturalDelaySeconds * rate);
        s->latency = delay;
        if (key != state.designed)
        {
            auto set = std::make_unique<KernelSet>();
            set->base = naturalKernel (*s, rate, delay - naturalBlock);
            state.naturalConvolver().offer (std::move (set));
        }
    }
    else if (s->mode == Mode::linearPhase)
    {
        const auto taps = linearTaps (s->resolution, rate);
        s->latency = taps / 2 + linearBlock;
        if (key != state.designed)
        {
            auto set = std::make_unique<KernelSet>();
            const auto delay = taps / 2;
            const auto base = linearResponse (*s, rate, taps);
            set->base = kernelFromResponse (base, taps, taps, delay, linearBlock);
            // Each dynamic band: what it adds at the end of its range (heard as much as its dynamics move it).
            if (s->dynamicsPlay)
                for (int i = 0; i < s->count && (int) set->deltas.size() < Convolver::maxDeltas; ++i)
                {
                    const auto& band = s->bands[(size_t) i];
                    if (isZero (band.range))
                        continue;
                    auto moved = linearResponse (*s, rate, taps, band.id, band.shape.gain + band.range);
                    for (size_t k = 0; k < moved.size(); ++k)
                    {
                        moved[k].ll -= base[k].ll;
                        moved[k].lr -= base[k].lr;
                        moved[k].rl -= base[k].rl;
                        moved[k].rr -= base[k].rr;
                    }
                    set->deltas.push_back (kernelFromResponse (moved, taps, taps, delay, linearBlock));
                    set->bands.push_back (band.id);
                }
            state.linearConvolver().offer (std::move (set));
        }
    }
    state.designed = key;
    return s;
}

// ---------------------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------------------

State::State (double sampleRate) : rate (sampleRate)
{
    // Everything the audio thread uses is made here, at its largest, never again while it may be used:
    // the input (blocks up to `maxBlock`), Linear Phase's dynamic shares (a chunk at a time), and the dry
    // sound's delay for the slot's mix (the longest latency, Linear Phase at Maximum).
    for (auto& band : bands)
        band.shares.assign (4096, 0.0f);
    inLeft.assign ((size_t) maxBlock, 0.0f);
    inRight.assign ((size_t) maxBlock, 0.0f);
    for (auto& g : deltaGains)
        g.assign ((size_t) deltaChunk, 0.0f);
    const auto ring = (size_t) juce::nextPowerOfTwo (linearTaps (4, rate) / 2 + linearBlock + maxBlock + 1);
    dryRing[0].assign (ring, 0.0f);
    dryRing[1].assign (ring, 0.0f);
}

State::~State() = default;

Convolver& State::naturalConvolver()
{
    if (natural == nullptr)
    {
        // The correction is at most 2 · 7.3 ms long (at 192 kHz, 2 · 1402 taps).
        natural = std::make_unique<Convolver> (naturalBlock, juce::nextPowerOfTwo ((int) std::lround (2 * naturalDelaySeconds * rate) + 2));
        naturalLive.store (natural.get());
    }
    return *natural;
}

Convolver& State::linearConvolver()
{
    if (linear == nullptr)
    {
        linear = std::make_unique<Convolver> (linearBlock, linearTaps (4, rate));
        linearLive.store (linear.get());
    }
    return *linear;
}

void State::collect()
{
    if (natural != nullptr)
        natural->collect();
    if (linear != nullptr)
        linear->collect();
}

void State::design (BandState& bs, const BandShape& shape, Chain& chain) const
{
    Sections sections;
    analogSections (shape, sections);
    chain.count = sections.count;
    for (int i = 0; i < sections.count; ++i)
        chain.to[(size_t) i] = Svf::from (matched (sections.list[(size_t) i], rate));
    juce::ignoreUnused (bs);
}

void State::detect (BandState& bs, const float* inA, const float* inB, int numSamples)
{
    const auto& band = bs.band;
    const auto f = band.shape.frequency;
    // The trigger: the part of the input the band works on (a band pass round a Bell, a low pass under a low
    // shelf, a high pass over a high or tilt shelf), on the band's part of the sound.
    const auto made = f + band.shape.q * 1e-7 + (double) band.shape.shape * 1e-9;
    if (std::abs (bs.triggerFor - made) > 1e-12)
    {
        bs.triggerFor = made;
        const auto qr = band.shape.q / std::sqrt (2.0);
        Section s;
        if (band.shape.shape == Shape::bell)
            s = { 0, 1 / qr, 0, 1, 1 / qr, 1, f };
        else if (band.shape.shape == Shape::lowShelf)
            s = { 1, 0, 0, 1, std::sqrt (2.0), 1, f };
        else
            s = { 0, 0, 1, 1, std::sqrt (2.0), 1, f };
        bs.triggerFilter = matched (s, rate);
    }
    const auto& q = bs.triggerFilter;
    const auto attack = 1 - std::exp (-1 / (juce::jmax (0.01, 2 / f) * rate));
    const auto release = 1 - std::exp (-1 / (juce::jmax (0.1, 20 / f) * rate));
    const auto filter = [&q] (double x, std::array<double, 2>& z) {
        const auto y = q.b0 * x + z[0];
        z[0] = q.b1 * x - q.a1 * y + z[1];
        z[1] = q.b2 * x - q.a2 * y;
        return y;
    };
    for (int i = 0; i < numSamples; ++i)
    {
        double x;
        switch (band.placement)
        {
            case Placement::left: x = filter (inA[i], bs.trigger[0]); break;
            case Placement::right: x = filter (inB[i], bs.trigger[1]); break;
            case Placement::mid: x = filter (0.5 * (inA[i] + inB[i]), bs.trigger[0]); break;
            case Placement::side: x = filter (0.5 * (inA[i] - inB[i]), bs.trigger[0]); break;
            case Placement::stereo:
            default:
            {
                const auto a = filter (inA[i], bs.trigger[0]), b = filter (inB[i], bs.trigger[1]);
                x = std::abs (a) > std::abs (b) ? a : b;
            }
        }
        const auto p = x * x;
        bs.level += (p - bs.level) * (p > bs.level ? attack : release);
    }
    // In dB, as a sine's peak (its power doubled).
    const auto levelDb = 10 * std::log10 (2 * bs.level + 1e-14);
    const auto seconds = numSamples / rate;
    // Auto: the threshold sits a little over the trigger's own long average (rising over a second, falling over three).
    if (levelDb > -80)
        bs.average += (levelDb - bs.average) * (1 - std::exp (-seconds / (levelDb > bs.average ? 1.0 : 3.0)));
    const auto threshold = band.autoThreshold ? bs.average + 4 : band.threshold;
    // A soft knee, then about 2:1 until the range is reached.
    const auto knee = juce::jlimit (3.0, 10.0, std::abs (band.range) / 2);
    const auto span = 2 * std::abs (band.range) + 1e-9;
    const auto over = levelDb - threshold;
    const auto share = over <= -knee / 2 ? 0.0 : over < knee / 2 ? (over + knee / 2) * (over + knee / 2) / (2 * knee * span) : over / span;
    const auto target = juce::jlimit (0.0, 1.0, share) * band.range;
    bs.dynamicGain += (target - bs.dynamicGain) * (1 - std::exp (-seconds / 0.005));
    bs.saidGain.store ((float) bs.dynamicGain, std::memory_order_relaxed);
    bs.saidLevel.store ((float) levelDb, std::memory_order_relaxed);
}

void State::runBand (const Settings& settings, BandState& bs, bool present, float* a, float* b, const float* inA, const float* inB, int numSamples)
{
    const auto& band = bs.band;
    const auto glide = 1 - std::exp (-control / (0.02 * rate));
    const auto fadeStep = 1.0 / (0.015 * rate);
    const auto dynamic = ! isZero (band.range) && settings.dynamicsPlay;
    const auto first = bs.madeSlope < 0;
    for (int pos = 0; pos < numSamples; pos += control)
    {
        const auto m = juce::jmin (control, numSamples - pos);
        // The band's settings, glided to.
        const auto logF = std::log2 (band.shape.frequency), logQ = std::log2 (band.shape.q);
        if (first && pos == 0)
        {
            bs.logFrequency = logF;
            bs.gain = band.shape.gain;
            bs.logQ = logQ;
            bs.wet = present ? 1 : 0;
        }
        else
        {
            bs.logFrequency += (logF - bs.logFrequency) * glide;
            bs.gain += (band.shape.gain - bs.gain) * glide;
            bs.logQ += (logQ - bs.logQ) * glide;
        }
        if (dynamic)
            detect (bs, inA + pos, inB + pos, m);
        else
            bs.dynamicGain += (0 - bs.dynamicGain) * glide;

        BandShape shape = band.shape;
        shape.frequency = std::exp2 (bs.logFrequency);
        shape.q = std::exp2 (bs.logQ);
        shape = playing ({ band.id, shape, band.placement }, bs.gain + bs.dynamicGain, settings.gainQ);

        // Its shape or slope changed: the old filters fade out while the new ones fade in.
        const auto structure = shape.shape != bs.madeShape || shape.slope != bs.madeSlope;
        if (structure && ! first)
        {
            bs.old = bs.chain;
            bs.old.from = bs.old.to;
            bs.fade = 0;
            bs.chain.clear();
        }
        const auto logGain = shape.gain;
        const auto changed = structure || std::abs (std::log2 (shape.frequency) - bs.madeLogFrequency) > 1e-5 || std::abs (logGain - bs.madeGain) > 1e-4
                             || std::abs (std::log2 (shape.q) - bs.madeLogQ) > 1e-5;
        bs.chain.from = bs.chain.to;
        if (changed)
        {
            design (bs, shape, bs.chain);
            if (structure)
                bs.chain.from = bs.chain.to;
            bs.madeShape = shape.shape;
            bs.madeSlope = shape.slope;
            bs.madeLogFrequency = std::log2 (shape.frequency);
            bs.madeGain = logGain;
            bs.madeLogQ = std::log2 (shape.q);
        }

        // Which channels it works on (in its stage: left/right, or mid/side).
        const auto onA = band.placement == Placement::stereo || band.placement == Placement::left || band.placement == Placement::mid;
        const auto onB = band.placement == Placement::stereo || band.placement == Placement::right || band.placement == Placement::side;
        const auto wetFrom = bs.wet;
        const auto wetTo = juce::jlimit (0.0, 1.0, bs.wet + (present ? 1 : -1) * fadeStep * m);
        const auto fadeFrom = bs.fade;
        for (int i = 0; i < m; ++i)
        {
            const auto t = (double) (i + 1) / m;
            const auto wet = wetFrom + (wetTo - wetFrom) * t;
            const auto fade = juce::jmin (1.0, fadeFrom + (i + 1) * fadeStep);
            const auto through = [&] (float* data, int channel) {
                const double x = data[pos + i];
                auto y = bs.chain.run (x, channel, t);
                if (fade < 1)
                    y = bs.old.run (x, channel, 1) * (1 - fade) + y * fade;
                data[pos + i] = (float) (x + (y - x) * wet);
            };
            if (onA)
                through (a, 0);
            if (onB)
                through (b, 1);
        }
        bs.wet = wetTo;
        bs.fade = juce::jmin (1.0, fadeFrom + m * fadeStep);
    }
}

void State::runStage (const Settings& settings, bool midSide, float* a, float* b, const float* inA, const float* inB, int numSamples)
{
    for (int id = 1; id <= maxBands; ++id)
    {
        auto& bs = bands[(size_t) id];
        const auto* given = const_cast<Settings&> (settings).find (id);
        if (given != nullptr)
        {
            if (given->midSide() != midSide)
                continue;
            bs.band = *given;
            bs.known = true;
        }
        else if (! bs.known || bs.band.midSide() != midSide)
            continue;
        if (given == nullptr && bs.wet <= 0)
        {
            // Gone, and faded out: forget it.
            bs.known = false;
            bs.madeSlope = -1;
            bs.chain.clear();
            bs.dynamicGain = 0;
            continue;
        }
        runBand (settings, bs, given != nullptr, a, b, inA, inB, numSamples);
    }
}

void State::process (const Settings& settings, float* left, float* right, int numSamples, bool analyze)
{
    juce::ScopedNoDenormals noDenormals;
    if (numSamples > (int) inLeft.size())
        return;
    if (! primed)
    {
        // Afresh: no memories, every band as it is now.
        for (auto& bs : bands)
        {
            bs.chain.clear();
            bs.old.clear();
            bs.fade = 1;
            bs.madeSlope = -1;
            bs.level = 0;
            bs.dynamicGain = 0;
            bs.trigger = {};
            bs.known = false;
            std::fill (bs.shares.begin(), bs.shares.end(), 0.0f);
        }
        if (auto* c = naturalLive.load())
            c->reset();
        if (auto* c = linearLive.load())
            c->reset();
        solo.clear();
        primed = true;
    }
    std::copy (left, left + numSamples, inLeft.begin());
    std::copy (right, right + numSamples, inRight.begin());
    if (analyze && watched.load (std::memory_order_relaxed))
        pre.write (left, right, numSamples);

    auto* linearConvolver = settings.mode == Mode::linearPhase ? linearLive.load() : nullptr;
    if (linearConvolver != nullptr)
    {
        // The long FIR plays the bands; the dynamic ones are worked out here and heard as its deltas, each
        // share held back by the latency so it moves with the sound it was measured on.
        const auto delayBlocks = settings.latency / control;
        // A chunk at a time, so the shares' scratch stays small.
        for (int chunk = 0; chunk < numSamples; chunk += deltaChunk)
        {
            const auto n = juce::jmin (deltaChunk, numSamples - chunk);
            int delta = 0;
            for (int i = 0; i < settings.count; ++i)
            {
                const auto& band = settings.bands[(size_t) i];
                if (isZero (band.range) || ! settings.dynamicsPlay || delta >= Convolver::maxDeltas)
                    continue;
                auto& bs = bands[(size_t) band.id];
                bs.band = band;
                bs.known = true;
                auto* gains = deltaGains[(size_t) delta++].data();
                const auto ring = (int) bs.shares.size();
                for (int pos = 0; pos < n; pos += control)
                {
                    const auto m = juce::jmin (control, n - pos);
                    detect (bs, inLeft.data() + chunk + pos, inRight.data() + chunk + pos, m);
                    bs.shares[(size_t) bs.shareWrite] = (float) (bs.dynamicGain / band.range);
                    const auto share = bs.shares[(size_t) ((bs.shareWrite - juce::jmin (delayBlocks, ring - 1) + ring) % ring)];
                    bs.shareWrite = (bs.shareWrite + 1) % ring;
                    std::fill (gains + pos, gains + pos + m, share);
                }
            }
            std::array<const float*, Convolver::maxDeltas> pointers {};
            for (int d = 0; d < delta; ++d)
                pointers[(size_t) d] = deltaGains[(size_t) d].data();
            linearConvolver->process (left + chunk, right + chunk, n, pointers.data());
        }
    }
    else
    {
        // The matched filters: left/right and stereo bands, then mid/side ones.
        runStage (settings, false, left, right, inLeft.data(), inRight.data(), numSamples);
        // (A mid/side band given, or one still fading out.)
        bool anyMidSide = false;
        for (int i = 0; i < settings.count; ++i)
            anyMidSide = anyMidSide || settings.bands[(size_t) i].midSide();
        for (int id = 1; id <= maxBands; ++id)
            anyMidSide = anyMidSide || (bands[(size_t) id].known && bands[(size_t) id].band.midSide());
        if (anyMidSide)
        {
            for (int i = 0; i < numSamples; ++i)
            {
                const auto l = left[i], r = right[i];
                left[i] = 0.5f * (l + r);
                right[i] = 0.5f * (l - r);
            }
            runStage (settings, true, left, right, inLeft.data(), inRight.data(), numSamples);
            for (int i = 0; i < numSamples; ++i)
            {
                const auto m = left[i], s = right[i];
                left[i] = m + s;
                right[i] = m - s;
            }
        }
        if (settings.mode == Mode::naturalPhase)
            if (auto* c = naturalLive.load())
                c->process (left, right, numSamples, nullptr);
    }

    // Solo: what the band works on, alone (a cut's: what it takes away), at the solo's level.
    const auto soloId = soloBand.load (std::memory_order_relaxed);
    const auto* soloed = soloId > 0 ? const_cast<Settings&> (settings).find (soloId) : nullptr;
    if (soloed != nullptr && soloFor != soloId)
    {
        soloFor = soloId;
        solo.clear();
        const auto f = soloed->shape.frequency, qr = soloed->shape.q / std::sqrt (2.0);
        Section s;
        switch (soloed->shape.shape)
        {
            case Shape::lowShelf:
            case Shape::highCut: s = soloed->shape.shape == Shape::highCut ? Section { 0, 0, 1, 1, std::sqrt (2.0), 1, f } : Section { 1, 0, 0, 1, std::sqrt (2.0), 1, f }; break;
            case Shape::lowCut: s = { 1, 0, 0, 1, std::sqrt (2.0), 1, f }; break;
            case Shape::highShelf:
            case Shape::tiltShelf: s = { 0, 0, 1, 1, std::sqrt (2.0), 1, f }; break;
            case Shape::bell:
            case Shape::notch:
            case Shape::bandPass:
            case Shape::flatTilt:
            default: s = { 0, 1 / qr, 0, 1, 1 / qr, 1, f }; break;
        }
        solo.count = 1;
        solo.to[0] = solo.from[0] = Svf::from (matched (s, rate));
    }
    const auto soloTarget = soloed != nullptr ? 1.0 : 0.0;
    if (soloMix > 0 || soloTarget > 0)
    {
        const auto gain = (double) soloGain.load (std::memory_order_relaxed);
        const auto step = 1.0 / (0.01 * rate);
        for (int i = 0; i < numSamples; ++i)
        {
            soloMix = juce::jlimit (0.0, 1.0, soloMix + (soloTarget > soloMix ? step : -step));
            const auto l = solo.run (inLeft[(size_t) i], 0, 1) * gain, r = solo.run (inRight[(size_t) i], 1, 1) * gain;
            left[i] = (float) (left[i] + (l - left[i]) * soloMix);
            right[i] = (float) (right[i] + (r - right[i]) * soloMix);
        }
        if (soloMix <= 0)
            soloFor = 0;
    }

    // The output: its level and phase, then its pan across left/right or mid/side (gliding over the block).
    const auto level = settings.output <= -60 ? 0.0 : std::pow (10.0, settings.output / 20) * (settings.invert ? -1 : 1);
    const auto a = juce::jmin (1.0, 1 - settings.pan), b = juce::jmin (1.0, 1 + settings.pan);
    const std::array<double, 4> to = settings.panMidSide ? std::array<double, 4> { level * (a + b) / 2, level * (a - b) / 2, level * (a - b) / 2, level * (a + b) / 2 }
                                                         : std::array<double, 4> { level * a, 0, 0, level * b };
    const auto from = out;
    for (int i = 0; i < numSamples; ++i)
    {
        const auto t = (double) (i + 1) / numSamples;
        const auto l = left[i], r = right[i];
        const auto m0 = from[0] + (to[0] - from[0]) * t, m1 = from[1] + (to[1] - from[1]) * t;
        const auto m2 = from[2] + (to[2] - from[2]) * t, m3 = from[3] + (to[3] - from[3]) * t;
        left[i] = (float) (m0 * l + m1 * r);
        right[i] = (float) (m2 * l + m3 * r);
    }
    out = to;

    if (analyze && watched.load (std::memory_order_relaxed))
    {
        post.write (left, right, numSamples);
        const auto raise = [] (std::atomic<float>& peak, juce::Range<float> range) {
            const auto loudest = juce::jmax (-range.getStart(), range.getEnd());
            if (loudest > peak.load (std::memory_order_relaxed))
                peak.store (loudest, std::memory_order_relaxed);
        };
        raise (peakLeft, juce::FloatVectorOperations::findMinAndMax (left, numSamples));
        raise (peakRight, juce::FloatVectorOperations::findMinAndMax (right, numSamples));
    }
}

void State::mixDry (const Settings& settings, float* left, float* right, const float* dryLeft, const float* dryRight, int numSamples, float mix)
{
    const auto size = (int) dryRing[0].size();
    const auto delay = settings.latency;
    for (int i = 0; i < numSamples; ++i)
    {
        float l = dryLeft[i], r = dryRight[i];
        if (delay > 0 && size > delay)
        {
            dryRing[0][(size_t) dryWrite] = l;
            dryRing[1][(size_t) dryWrite] = r;
            const auto read = (dryWrite - delay + size) % size;
            l = dryRing[0][(size_t) read];
            r = dryRing[1][(size_t) read];
            dryWrite = (dryWrite + 1) % size;
        }
        left[i] = left[i] * mix + l * (1 - mix);
        right[i] = right[i] * mix + r * (1 - mix);
    }
}

juce::var State::describe()
{
    auto* object = new juce::DynamicObject();
    const auto spectrum = [this] (Spectrum& s) -> juce::var {
        if (! s.fresh())
            return {};
        s.measure (juce::nextPowerOfTwo (analyzerSize.load() * juce::jmax (1, (int) std::lround (rate / 44100.0))), rate, levels);
        juce::Array<juce::var> list;
        list.ensureStorageAllocated ((int) levels.size());
        for (const auto v : levels)
            list.add (std::round (v * 10) / 10);
        return list;
    };
    object->setProperty ("pre", spectrum (pre));
    object->setProperty ("post", spectrum (post));
    juce::Array<juce::var> peak { (double) peakLeft.exchange (0), (double) peakRight.exchange (0) };
    object->setProperty ("peak", peak);
    auto* list = new juce::DynamicObject();
    for (int id = 1; id <= maxBands; ++id)
    {
        const auto& bs = bands[(size_t) id];
        if (bs.known && ! isZero (bs.band.range))
            list->setProperty (juce::String (id),
                               protocol::object ({ { "gain", std::round (bs.saidGain.load() * 100) / 100 }, { "level", std::round (bs.saidLevel.load() * 10) / 10 } }));
    }
    object->setProperty ("bands", juce::var (list));
    return juce::var (object);
}

// ---------------------------------------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------------------------------------

std::shared_ptr<State> Registry::get (const juce::String& effectId, double sampleRate)
{
    auto& state = states[effectId];
    if (state == nullptr || std::abs (state->sampleRate() - sampleRate) > 1e-6)
        state = std::make_shared<State> (sampleRate);
    state->collect();
    const auto it = watching.find (effectId);
    state->watched.store (it != watching.end());
    if (it != watching.end())
        state->analyzerSize.store (it->second);
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

void Registry::watch (const std::map<juce::String, int>& sizes)
{
    watching = sizes;
    for (auto& [id, state] : states)
    {
        const auto it = sizes.find (id);
        state->watched.store (it != sizes.end());
        if (it != sizes.end())
            state->analyzerSize.store (it->second);
    }
}

juce::var Registry::describe()
{
    auto* object = new juce::DynamicObject();
    for (auto& [id, state] : states)
        if (state->watched.load())
            object->setProperty (id, state->describe());
    return juce::var (object);
}

void Registry::collect()
{
    for (auto& [id, state] : states)
        state->collect();
}
} // namespace eq
