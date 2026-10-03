#include "Reverb.h"

#include <cmath>

namespace verb
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

/** The input's ring: the longest pre-delay (1 s) and the furthest early tap (120 ms at Size 100%, ×2.5), with room. */
constexpr double ringSeconds = 1.4;
/** What values glide over when the song (or a lane) changes them. */
constexpr double glideSeconds = 0.005;
/** A network quieter than this (peak) is let go (its tail is done). */
constexpr float quietPeak = 3e-5f;
/** The networks run in slices this long (Auto-Decay's factor, a spillover's fade). */
constexpr int slice = 32;

juce::uint64 mixHash (juce::uint64 h, double v)
{
    const auto q = (juce::int64) std::llround (v * 1e7);
    h ^= (juce::uint64) q + 0x9e3779b97f4a7c15ull + (h << 6) + (h >> 2);
    return h;
}
} // namespace

// ---------------------------------------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------------------------------------

std::shared_ptr<Settings> Settings::parse (const juce::var& json, int capacity, State& state)
{
    static std::atomic<juce::uint64> serials { 0 };
    auto s = std::make_shared<Settings>();
    s->serial = ++serials;
    s->dryBuffer.setSize (2, juce::jmax (1, capacity));
    const auto& net = json["network"];
    auto& t = s->topology;
    t.ring = net["matrix"].toString() != "hadamard";
    juce::uint64 h = t.ring ? 1 : 2;
    if (const auto* list = net["lines"].getArray())
        for (int i = 0; i < juce::jmin (maxLines, list->size()); ++i)
        {
            const auto& item = (*list)[i];
            auto& l = t.line[(size_t) i];
            l.allpass = number (item["allpass"], 0.01, 0.0005, 0.1);
            l.delay = number (item["delay"], 0.05, 0.001, 0.2);
            l.apGain = number (item["apGain"], 0.5, -0.85, 0.85);
            l.modDelay = (bool) item["modDelay"];
            l.modAllpass = (bool) item["modAllpass"];
            l.inLeft = (float) number (item["inLeft"], 0, -2, 2);
            l.inRight = (float) number (item["inRight"], 0, -2, 2);
            h = mixHash (mixHash (mixHash (h, l.allpass), l.delay), (l.modDelay ? 1 : 0) + (l.modAllpass ? 2 : 0));
            t.lines = i + 1;
        }
    if (const auto* list = net["taps"].getArray())
        for (int k = 0; k < juce::jmin (maxTaps, list->size()); ++k)
        {
            const auto& item = (*list)[k];
            auto& tap = t.tap[(size_t) k];
            tap.line = juce::jlimit (0, juce::jmax (0, t.lines - 1), (int) number (item["line"], 0, 0, maxLines - 1));
            tap.where = (int) number (item["where"], 0, 0, 1);
            tap.at = number (item["at"], 0, 0, 0.2);
            tap.gain = (float) number (item["gain"], 0, -2, 2);
            tap.side = (int) number (item["side"], 0, 0, 1);
            h = mixHash (mixHash (mixHash (h, tap.line * 4 + tap.where * 2 + tap.side), tap.at), 3);
            t.taps = k + 1;
        }
    if (const auto* list = net["diffusers"].getArray())
        for (int k = 0; k < juce::jmin (maxDiffusers, list->size()); ++k)
        {
            t.diffuserLength[(size_t) k] = number ((*list)[k]["length"], 0.005, 0.0005, 0.025);
            t.diffuserGain[(size_t) k] = number ((*list)[k]["gain"], 0.7, 0, 0.9);
            h = mixHash (h, t.diffuserLength[(size_t) k]);
            t.diffusers = k + 1;
        }
    t.quantise = (int) number (net["quantise"], 0, 0, 1024);
    t.bits = (int) number (net["bits"], 0, 0, 24);
    t.clip = number (net["clip"], 0, 0, 16);
    h = mixHash (mixHash (mixHash (h, t.quantise), t.bits), t.clip);
    t.signature = h | 1;

    s->scale = number (json["scale"], 1, 0.1, 4);
    if (const auto* list = json["t60"].getArray())
        for (int b = 0; b < juce::jmin (numBands, list->size()); ++b)
            s->t60[(size_t) b] = number ((*list)[b], 1.8, 0.01, 1e5);
    s->freeze = (bool) json["freeze"];
    s->toneLock = (bool) json["toneLock"];
    s->predelay = number (json["predelay"], 0.02, 0, 1);

    const auto& early = json["early"];
    for (const auto* side : { "left", "right" })
        if (const auto* list = early[side].getArray())
        {
            auto& taps = juce::String (side) == "left" ? s->earlyLeft : s->earlyRight;
            taps.reserve ((size_t) juce::jmin (Early::maxTaps, list->size() / 3));
            for (int k = 0; k + 2 < list->size() && (int) taps.size() < Early::maxTaps; k += 3)
                taps.push_back ({ (float) number ((*list)[k], 0, 0, 0.3), (float) number ((*list)[k + 1], 0, -4, 4), (float) number ((*list)[k + 2], 1, 0, 1e3) });
        }
    s->earlyLevel = number (early["level"], 0, 0, 8);
    s->earlySend = number (early["send"], 1, 0, 1);
    s->earlyCross = number (early["cross"], 0.5, 0, 1);
    s->air = number (early["air"], 18000, 100, 40000);
    s->density = number (early["density"], 0.5, 0, 1);
    s->diffuse = number (early["diffuse"], 0.6, 0, 1);
    s->vlf = number (early["vlf"], 0, -30, 0);
    s->lateLevel = number (json["late"]["level"], 1, 0, 8);
    s->apScale = number (json["late"]["apScale"], 1, 0, 2);
    s->modRate = number (json["mod"]["rate"], 0.8, 0.01, 20);
    s->modDepth = number (json["mod"]["depth"], 0, 0, 0.005);
    s->modShape = (int) number (json["mod"]["shape"], 0, 0, 1);
    const auto& input = json["input"];
    s->mono = (bool) input["mono"];
    s->inputCross = number (input["cross"], 0.3, 0, 1);
    s->inputLowCut = number (input["lowCut"], 20, 10, 30000);
    s->inputHighCut = number (input["highCut"], 20000, 10, 30000);
    s->bandwidth = number (input["bandwidth"], 20000, 100, 40000);
    s->deEss = number (json["deEss"]["amount"], 0, 0, 30);
    s->deEssFrequency = number (json["deEss"]["frequency"], 6500, 1000, 20000);
    const auto& duck = json["duck"];
    s->duck = number (duck["depth"], 0, -48, 0);
    s->autoThreshold = duck["threshold"].isVoid() || ! (duck["threshold"].isDouble() || duck["threshold"].isInt());
    s->threshold = number (duck["threshold"], -30, -100, 0);
    s->attack = number (duck["attack"], 0.01, 1e-4, 1);
    s->release = number (duck["release"], 0.25, 1e-3, 10);
    s->hold = number (duck["hold"], 0.05, 0, 2);
    s->tailOnly = duck["tailOnly"].isVoid() || (bool) duck["tailOnly"];
    s->key = (int) number (duck["key"], -1, -1, 1e6);
    s->autoDecay = number (duck["autoDecay"], 0, 0, 0.95);
    s->recovery = number (duck["recovery"], 0.1, 1e-3, 5);
    const auto& post = json["post"];
    s->lowCut = number (post["lowCut"], 20, 10, 30000);
    s->lowSlope = (int) number (post["lowSlope"], 12, 12, 24);
    s->highCut = number (post["highCut"], 20000, 10, 30000);
    s->highSlope = (int) number (post["highSlope"], 12, 12, 24);
    s->lowShelf = number (post["lowShelf"], 200, 10, 30000);
    s->lowShelfGain = number (post["lowShelfGain"], 0, -24, 24);
    s->highShelf = number (post["highShelf"], 8000, 10, 30000);
    s->highShelfGain = number (post["highShelfGain"], 0, -24, 24);
    s->studio = (bool) post["studio"];
    s->monoBelow = number (post["monoBelow"], 0, 0, 2000);
    s->width = number (post["width"], 1, 0, 2);
    s->level = number (post["level"], 1, 0, 8);
    s->dry = number (json["mix"]["dry"], 1, 0, 1);
    s->wet = number (json["mix"]["wet"], 0, 0, 1);
    const auto& era = json["era"];
    s->bandLimit = number (era["bandLimit"], 0, 0, 40000);
    s->aperture = (bool) era["aperture"];
    s->emphasis = (bool) era["emphasis"];
    s->bits = (int) number (era["bits"], 0, 0, 24);
    s->gainRanging = (bool) era["gainRanging"];
    s->noise = number (era["noise"], -200, -200, 0);
    s->seed = (juce::uint32) (juce::int64) number (json["seed"], 1, 0, 4294967295.0);
    s->design (state.graphicEq());
    return s;
}

void Settings::design (const GraphicEq& graphicEq)
{
    const auto held = infinite();
    for (int i = 0; i < topology.lines; ++i)
    {
        const auto& l = topology.line[(size_t) i];
        // Every element loses the same dB a second (Jot): the all-pass its share through its own loop, the
        // delay's filter the rest. A long all-pass (a plate's) holds much of the sound in its loop, so it gets
        // the whole design; a short one (the FDN's) a shelf, exact at the ends, the delay's filter making up the
        // rest at each band.
        std::array<double, numBands> allpass {}, target {};
        for (int b = 0; b < numBands; ++b)
            allpass[(size_t) b] = held ? 0.0 : -60.0 * l.allpass * scale / t60[(size_t) b];
        const auto whole = true;
        allpassDesigns[(size_t) i] = held ? EqDesign {} : whole ? graphicEq.design (allpass, true) : graphicEq.shelfOnly (allpass);
        for (int b = 0; b < numBands; ++b)
            target[(size_t) b] = held ? 0.0 : -60.0 * l.delay * scale / t60[(size_t) b] + (whole ? 0.0 : allpass[(size_t) b] - graphicEq.shelfAt (allpassDesigns[(size_t) i], b));
        designs[(size_t) i] = held ? EqDesign {} : graphicEq.design (target, true);
    }
    std::array<double, numBands> target {};
    for (int b = 0; b < numBands; ++b)
        target[(size_t) b] = held ? 0.0 : juce::jlimit (-15.0, 15.0, -10.0 * std::log10 (t60[(size_t) b] / t60[5]));
    tone = graphicEq.design (target, false);
    ++designed;
}

void Settings::set (Lane lane, const float* v, int size)
{
    const auto at = [&] (int k, double fallback) { return k < size ? (double) v[k] : fallback; };
    switch (lane)
    {
        case Lane::mix: dry = juce::jlimit (0.0, 1.0, at (0, dry)), wet = juce::jlimit (0.0, 1.0, at (1, wet)); break;
        case Lane::t60:
        {
            bool changed = false;
            for (int b = 0; b < juce::jmin (size, numBands); ++b)
            {
                const auto value = juce::jlimit (0.01, 1e5, (double) v[b]);
                changed = changed || std::abs (value - t60[(size_t) b]) > 1e-6 * t60[(size_t) b];
                t60[(size_t) b] = value;
            }
            if (changed)
                ++designed;
            break;
        }
        case Lane::freeze: freeze = at (0, 0) >= 0.5; break;
        case Lane::predelay: predelay = juce::jlimit (0.0, 1.0, at (0, predelay)); break;
        case Lane::scale: scale = juce::jlimit (0.1, 4.0, at (0, scale)); break;
        case Lane::distance:
            earlyLevel = juce::jlimit (0.0, 8.0, at (0, earlyLevel));
            lateLevel = juce::jlimit (0.0, 8.0, at (1, lateLevel));
            air = juce::jlimit (100.0, 40000.0, at (2, air));
            bandwidth = juce::jlimit (100.0, 40000.0, at (3, bandwidth));
            break;
        case Lane::density: density = juce::jlimit (0.0, 1.0, at (0, density)), diffuse = juce::jlimit (0.0, 1.0, at (1, diffuse)); break;
        case Lane::modRate: modRate = juce::jlimit (0.01, 20.0, at (0, modRate)); break;
        case Lane::modDepth: modDepth = juce::jlimit (0.0, 0.005, at (0, modDepth)); break;
        case Lane::width: width = juce::jlimit (0.0, 2.0, at (0, width)); break;
        case Lane::postCuts: lowCut = juce::jlimit (10.0, 30000.0, at (0, lowCut)), highCut = juce::jlimit (10.0, 30000.0, at (1, highCut)); break;
        case Lane::deEss: deEss = juce::jlimit (0.0, 30.0, at (0, deEss)), deEssFrequency = juce::jlimit (1000.0, 20000.0, at (1, deEssFrequency)); break;
        case Lane::duck: duck = juce::jlimit (-48.0, 0.0, at (0, duck)); break;
        case Lane::inputCross: inputCross = juce::jlimit (0.0, 1.0, at (0, inputCross)); break;
        case Lane::inputCuts: inputLowCut = juce::jlimit (10.0, 30000.0, at (0, inputLowCut)), inputHighCut = juce::jlimit (10.0, 30000.0, at (1, inputHighCut)); break;
        case Lane::vlf: vlf = juce::jlimit (-30.0, 0.0, at (0, vlf)); break;
        case Lane::earlySend: earlySend = juce::jlimit (0.0, 1.0, at (0, earlySend)); break;
        case Lane::earlyCross: earlyCross = juce::jlimit (0.0, 1.0, at (0, earlyCross)); break;
        case Lane::lateDiffusion: apScale = juce::jlimit (0.0, 2.0, at (0, apScale)); break;
        case Lane::duckTimes:
        {
            const auto th = at (0, autoThreshold ? 1.0 : threshold);
            autoThreshold = th > 0.5;
            if (! autoThreshold)
                threshold = juce::jlimit (-100.0, 0.0, th);
            attack = juce::jlimit (1e-4, 1.0, at (1, attack));
            release = juce::jlimit (1e-3, 10.0, at (2, release));
            hold = juce::jlimit (0.0, 2.0, at (3, hold));
            break;
        }
        case Lane::autoDecay: autoDecay = juce::jlimit (0.0, 0.95, at (0, autoDecay)), recovery = juce::jlimit (1e-3, 5.0, at (1, recovery)); break;
        case Lane::shelves:
            lowShelf = juce::jlimit (10.0, 30000.0, at (0, lowShelf));
            lowShelfGain = juce::jlimit (-24.0, 24.0, at (1, lowShelfGain));
            highShelf = juce::jlimit (10.0, 30000.0, at (2, highShelf));
            highShelfGain = juce::jlimit (-24.0, 24.0, at (3, highShelfGain));
            break;
        case Lane::monoBelow: monoBelow = juce::jlimit (0.0, 2000.0, at (0, monoBelow)); break;
        case Lane::level: level = juce::jlimit (0.0, 8.0, at (0, level)); break;
    }
}

void Settings::get (Lane lane, float* v, int& size) const
{
    size = 1;
    const auto put = [&] (std::initializer_list<double> values) {
        size = 0;
        for (const auto x : values)
            v[size++] = (float) x;
    };
    switch (lane)
    {
        case Lane::mix: put ({ dry, wet }); break;
        case Lane::t60:
            size = numBands;
            for (int b = 0; b < numBands; ++b)
                v[b] = (float) t60[(size_t) b];
            break;
        case Lane::freeze: put ({ freeze ? 1.0 : 0.0 }); break;
        case Lane::predelay: put ({ predelay }); break;
        case Lane::scale: put ({ scale }); break;
        case Lane::distance: put ({ earlyLevel, lateLevel, air, bandwidth }); break;
        case Lane::density: put ({ density, diffuse }); break;
        case Lane::modRate: put ({ modRate }); break;
        case Lane::modDepth: put ({ modDepth }); break;
        case Lane::width: put ({ width }); break;
        case Lane::postCuts: put ({ lowCut, highCut }); break;
        case Lane::deEss: put ({ deEss, deEssFrequency }); break;
        case Lane::duck: put ({ duck }); break;
        case Lane::inputCross: put ({ inputCross }); break;
        case Lane::inputCuts: put ({ inputLowCut, inputHighCut }); break;
        case Lane::vlf: put ({ vlf }); break;
        case Lane::earlySend: put ({ earlySend }); break;
        case Lane::earlyCross: put ({ earlyCross }); break;
        case Lane::lateDiffusion: put ({ apScale }); break;
        case Lane::duckTimes: put ({ autoThreshold ? 1.0 : threshold, attack, release, hold }); break;
        case Lane::autoDecay: put ({ autoDecay, recovery }); break;
        case Lane::shelves: put ({ lowShelf, lowShelfGain, highShelf, highShelfGain }); break;
        case Lane::monoBelow: put ({ monoBelow }); break;
        case Lane::level: put ({ level }); break;
    }
}

// ---------------------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------------------

State::State (double sampleRate, int capacity) : rate (sampleRate), blockCapacity (juce::jmax (1, capacity))
{
    eq.prepare (rate);
    for (auto& n : networks)
        n.allocate (rate, eq);
    int size = 1;
    while (size < (int) (ringSeconds * rate) + 8)
        size <<= 1;
    ringLeft.assign ((size_t) size, 0.0f);
    ringRight.assign ((size_t) size, 0.0f);
    ringMask = size - 1;
    early.prepare (rate);
    deEsser.prepare (rate);
    ducker.prepare (rate);
    glide = 1.0 - std::exp (-1.0 / (glideSeconds * rate));
    spillFadeLength = juce::jmax (1, (int) (0.03 * rate));
    predelayFadeLength = juce::jmax (1, (int) (0.03 * rate));
    // Scratch: dry ×2, early heard ×2, late in ×2, late out ×2, duck gain.
    scratch.setSize (9, blockCapacity);
    levels.reserve (eq::SpectrumGrid::points);
}

void State::reset (const Settings& s)
{
    for (auto& n : networks)
        n.clear();
    networks[0].configure (s.topology, s.scale, s.designs, s.allpassDesigns);
    networks[1].clear();
    active = 0;
    spillFade = 0;
    designed = s.designed;
    designedT60 = s.t60;
    t60Factor = 1;
    serial = s.serial;
    std::fill (ringLeft.begin(), ringLeft.end(), 0.0f);
    std::fill (ringRight.begin(), ringRight.end(), 0.0f);
    written = -1;
    predelayNow = -1;
    predelayFade = 0;
    early.reset();
    for (auto* group : { &inLow, &inHigh, &postLow, &postHigh, &studioLow, &studioHigh })
        for (auto& c : *group)
            c.reset();
    deEsser.reset();
    for (auto& f : limitIn)
        f.reset();
    for (auto& f : limitOut)
        f.reset();
    for (auto* group : { &aperture, &preEmphasis, &deEmphasis })
        for (auto& b : *group)
            b.reset();
    for (auto& f : tone)
        f.reset();
    for (auto* group : { &vlfHeard, &vlfLate, &lowShelf, &highShelf })
        for (auto& f : *group)
            f.reset();
    airY = {};
    sideLow.reset();
    sideMono.reset();
    ducker.reset();
    limiter = 1;
    noiseEnvelope = 0;
    dry = s.dry, wet = s.wet, earlyLevel = s.earlyLevel, lateLevel = s.lateLevel, width = s.width, level = s.level;
    inputGain = 1, freezeAmount = 0;
    quietSamples = 0;
    stale = false;
}

void State::adopt (Settings& s)
{
    auto& net = networks[(size_t) active];
    auto& other = networks[(size_t) (1 - active)];
    if (net.signature() != s.topology.signature)
    {
        // Another wiring (a mode, era or preset): the old network rings out beside a new one. If the other
        // is still ringing from the last change, it fades out first (30 ms).
        if (other.configured() && ! other.idle)
        {
            if (spillFade == 0)
                spillFade = spillFadeLength;
            return;
        }
        active = 1 - active;
        networks[(size_t) active].configure (s.topology, s.scale, s.designs, s.allpassDesigns);
        designed = s.designed, designedT60 = s.t60, t60Factor = 1, serial = s.serial;
        return;
    }
    net.update (s.topology);
    if (s.serial != serial)
    {
        // Another song: its designs (for its T60 at its Size).
        serial = s.serial;
        net.redesign (s.designs, s.allpassDesigns, s.scale);
        designed = s.designed, designedT60 = s.t60, t60Factor = 1;
    }
    // Size moved further than a glide should follow: the second network starts at the new size (if it's free).
    if (std::abs (std::log (s.scale / net.scale())) > 0.01 && (! other.configured() || other.idle))
    {
        active = 1 - active;
        networks[(size_t) active].configure (s.topology, s.scale, s.designs, s.allpassDesigns);
        designed = s.designed, designedT60 = s.t60, t60Factor = 1, serial = s.serial;
        return;
    }
    if (s.designed != designed)
    {
        // T60 changed. Every band by the same factor (Decay, by a lane): the design scaled. Its shape: designed again.
        designed = s.designed;
        double sum = 0, most = -1e9, least = 1e9;
        for (int b = 0; b < numBands; ++b)
        {
            const auto r = std::log (s.t60[(size_t) b] / designedT60[(size_t) b]);
            sum += r, most = juce::jmax (most, r), least = juce::jmin (least, r);
        }
        if (most - least < 0.03 && ! s.infinite() && designedT60[5] < 999)
            t60Factor = std::exp (sum / numBands);
        else
        {
            s.design (eq);
            designed = s.designed;
            net.redesign (s.designs, s.allpassDesigns, s.scale);
            designedT60 = s.t60;
            t60Factor = 1;
        }
    }
}

void State::process (Settings& s, const float* keyLeft, const float* keyRight, float* left, float* right, int numSamples)
{
    juce::ScopedNoDenormals noDenormals;
    if (numSamples <= 0 || numSamples > blockCapacity)
        return;
    if (stale)
        reset (s);
    adopt (s);

    const auto frozen = s.freeze || freezeHeld.load (std::memory_order_relaxed);
    const auto infinite = s.infinite();
    const auto kill = killHeld.load (std::memory_order_relaxed);
    const auto click = audition.exchange (false);
    frozenFlag.store (frozen || infinite, std::memory_order_relaxed);

    float inMax[2] {};
    for (int i = 0; i < numSamples; ++i)
        inMax[0] = juce::jmax (inMax[0], std::abs (left[i])), inMax[1] = juce::jmax (inMax[1], std::abs (right[i]));
    const auto fall = (float) std::exp (-numSamples / (0.25 * rate));
    for (int c = 0; c < 2; ++c)
        inPeak[c].store (juce::jmax (inMax[c], inPeak[c].load (std::memory_order_relaxed) * fall), std::memory_order_relaxed);

    // Silence costs next to nothing (6.14): nothing coming in, nothing left in it, nothing to say.
    const auto silent = juce::jmax (inMax[0], inMax[1]) < 1e-6f && ! click;
    auto& net = networks[(size_t) active];
    auto& other = networks[(size_t) (1 - active)];
    const auto ringing = ! net.idle || (other.configured() && ! other.idle);
    if (silent && ! ringing && quietSamples > (juce::int64) (ringSeconds * rate))
    {
        for (int i = 0; i < numSamples; ++i)
        {
            dry += (s.dry - dry) * glide;
            left[i] *= (float) dry, right[i] *= (float) dry;
        }
        wet = s.wet;
        for (int c = 0; c < 2; ++c)
            outPeak[c].store (outPeak[c].load (std::memory_order_relaxed) * fall, std::memory_order_relaxed);
        duckDb.store (0), deEssDb.store (0);
        return;
    }

    // The blocks' designs, if they changed.
    const auto off = [] (double hz, bool low) { return low ? hz <= 20.5 : hz >= 19999; };
    for (int c = 0; c < 2; ++c)
    {
        inLow[(size_t) c].set (true, s.inputLowCut, 12, off (s.inputLowCut, true), rate);
        inHigh[(size_t) c].set (false, s.inputHighCut, 12, off (s.inputHighCut, false), rate);
        postLow[(size_t) c].set (true, s.lowCut, s.lowSlope, off (s.lowCut, true), rate);
        postHigh[(size_t) c].set (false, s.highCut, s.highSlope, off (s.highCut, false), rate);
        studioLow[(size_t) c].set (true, 600, 24, ! s.studio, rate);
        studioHigh[(size_t) c].set (false, 10000, 24, ! s.studio, rate);
        lowShelf[(size_t) c].set (false, s.lowShelf, s.lowShelfGain, rate);
        highShelf[(size_t) c].set (true, s.highShelf, s.highShelfGain, rate);
        vlfHeard[(size_t) c].set (false, 200, s.vlf, rate);
        vlfLate[(size_t) c].set (false, 200, 0.5 * s.vlf, rate);
        limitIn[(size_t) c].set (s.bandLimit, rate);
        limitOut[(size_t) c].set (s.bandLimit, rate);
        aperture[(size_t) c].shelf (true, rate, 5000, s.aperture ? 2.0 : 0.0);
        preEmphasis[(size_t) c].shelf (true, rate, 3000, s.emphasis ? 6.0 : 0.0);
        deEmphasis[(size_t) c].shelf (true, rate, 3000, s.emphasis ? -6.0 : 0.0);
    }
    if (s.toneLock)
        for (auto& f : tone)
            f.realise (s.tone, eq, 1);
    sideLow.set (150, 0.70710678, rate);
    if (s.monoBelow >= 20)
        sideMono.set (s.monoBelow, 0.70710678, rate);
    if (early.needsLayout (net.scale(), s.density))
        early.layout (s.earlyLeft, s.earlyRight, net.scale(), s.density, rate);

    auto* dryL = scratch.getWritePointer (0);
    auto* dryR = scratch.getWritePointer (1);
    auto* earlyL = scratch.getWritePointer (2);
    auto* earlyR = scratch.getWritePointer (3);
    auto* lateInL = scratch.getWritePointer (4);
    auto* lateInR = scratch.getWritePointer (5);
    auto* lateL = scratch.getWritePointer (6);
    auto* lateR = scratch.getWritePointer (7);
    auto* duckGain = scratch.getWritePointer (8);

    const auto hasEarly = ! s.earlyLeft.empty();
    const auto airCoefficient = 1.0 - std::exp (-2 * pi * juce::jmin (s.air, 0.45 * rate) / rate);
    const auto crossEarly = 0.5 * s.earlyCross;
    const auto deEss = s.deEss > 0.01;
    const auto era = s.bandLimit > 0 || s.bits > 0;
    const auto targetInput = (kill ? 0.0 : 1.0) * (frozen && ! infinite ? 0.0 : 1.0);
    const auto inputGlide = 1.0 - std::exp (-1.0 / ((targetInput < inputGain ? 0.02 : 0.01) * rate));
    const auto predelayTarget = juce::jlimit (0.0, rate * 1.0, std::round (s.predelay * rate));
    if (predelayNow < 0)
        predelayNow = predelayTarget;
    const auto mask = ringMask;
    const auto readLeft = [this, mask] (juce::int64 back) { return (double) ringLeft[(size_t) ((written - back) & mask)]; };
    const auto readRight = [this, mask] (juce::int64 back) { return (double) ringRight[(size_t) ((written - back) & mask)]; };
    const auto readMono = [this, mask] (juce::int64 back) { const auto i = (size_t) ((written - back) & mask); return 0.5 * ((double) ringLeft[i] + (double) ringRight[i]); };
    float deEssMost = 0;

    for (int i = 0; i < numSamples; ++i)
    {
        dryL[i] = left[i], dryR[i] = right[i];
        double l = left[i], r = right[i];
        if (click && i == 0)
            l += 0.5, r += 0.5;
        // What never rings: the input's cuts, the esses, the era's converter.
        l = inHigh[0].process (inLow[0].process (l));
        r = inHigh[1].process (inLow[1].process (r));
        if (deEss)
        {
            deEsser.process (l, r, s.deEss, s.deEssFrequency, rate);
            deEssMost = juce::jmax (deEssMost, (float) deEsser.reduction);
        }
        if (era)
        {
            l = quantise (preEmphasis[0].process (limitIn[0].process (aperture[0].process (l))), s.bits, s.gainRanging);
            r = quantise (preEmphasis[1].process (limitIn[1].process (aperture[1].process (r))), s.bits, s.gainRanging);
        }
        inputGain += (targetInput - inputGain) * inputGlide;
        ++written;
        ringLeft[(size_t) (written & mask)] = (float) (l * inputGain);
        ringRight[(size_t) (written & mask)] = (float) (r * inputGain);

        // The pre-delay: a new length crossfades from the old over 30 ms.
        if (predelayFade == 0 && std::abs (predelayTarget - predelayNow) >= 1)
        {
            predelayFrom = predelayNow;
            predelayNow = predelayTarget;
            predelayFade = predelayFadeLength;
        }
        const auto fade = predelayFade > 0 ? (double) predelayFade / predelayFadeLength : 0.0;
        const auto now = (juce::int64) predelayNow, from = (juce::int64) predelayFrom;
        auto preL = readLeft (now), preR = readRight (now);
        if (fade > 0)
        {
            preL = preL * (1 - fade) + readLeft (from) * fade;
            preR = preR * (1 - fade) + readRight (from) * fade;
        }

        // The early energy: velvet taps from the pre-delayed input, a sequence a side.
        double el = 0, er = 0;
        if (hasEarly)
        {
            const auto taps = [&] (juce::int64 base, double& outL, double& outR) {
                if (s.mono)
                {
                    outL = early.tap (0, base, readMono);
                    outR = early.tap (1, base, readMono);
                }
                else
                {
                    const auto ll = early.tap (0, base, readLeft), lr = crossEarly > 0 ? early.tap (0, base, readRight) : 0.0;
                    const auto rr = early.tap (1, base, readRight), rl = crossEarly > 0 ? early.tap (1, base, readLeft) : 0.0;
                    outL = (1 - crossEarly) * ll + crossEarly * lr;
                    outR = (1 - crossEarly) * rr + crossEarly * rl;
                }
            };
            taps (now, el, er);
            if (fade > 0)
            {
                double fl, fr;
                taps (from, fl, fr);
                el = el * (1 - fade) + fl * fade, er = er * (1 - fade) + fr * fade;
            }
            early.step();
            // Air absorption: Distance's darkening.
            airY[0] += airCoefficient * (el - airY[0]);
            airY[1] += airCoefficient * (er - airY[1]);
            el = airY[0], er = airY[1];
        }
        if (predelayFade > 0)
            --predelayFade;

        earlyLevel += (s.earlyLevel - earlyLevel) * glide;
        earlyL[i] = (float) (vlfHeard[0].process (el) * earlyLevel);
        earlyR[i] = (float) (vlfHeard[1].process (er) * earlyLevel);
        // Into the late network: the early energy (Early Send), or the input itself.
        auto xl = hasEarly ? (1 - s.earlySend) * preL + s.earlySend * el : preL;
        auto xr = hasEarly ? (1 - s.earlySend) * preR + s.earlySend * er : preR;
        xl = vlfLate[0].process (xl);
        xr = vlfLate[1].process (xr);
        if (s.toneLock)
            xl = tone[0].process ((float) xl), xr = tone[1].process ((float) xr);
        lateInL[i] = (float) xl;
        lateInR[i] = (float) xr;

        // The ducker hears the key: another track's sound, or what comes in.
        const auto key = keyLeft != nullptr ? 0.5 * ((double) keyLeft[i] + (double) (keyRight != nullptr ? keyRight[i] : keyLeft[i])) : 0.5 * ((double) dryL[i] + (double) dryR[i]);
        duckGain[i] = (float) ducker.process (key, s.duck, s.threshold, s.autoThreshold, s.attack, s.release, s.hold, s.autoDecay, s.recovery, rate);
    }

    // The late network, in slices (Auto-Decay's factor, Freeze's glide, a spillover's fade).
    std::fill (lateL, lateL + numSamples, 0.0f);
    std::fill (lateR, lateR + numSamples, 0.0f);
    NetworkParams p;
    p.scale = s.scale;
    p.apScale = s.apScale;
    p.modRate = s.modRate;
    p.modDepth = s.modDepth * rate;
    p.modShape = s.modShape;
    p.diffuse = s.diffuse;
    p.bandwidth = s.bandwidth;
    p.cross = s.inputCross;
    p.mono = s.mono;
    const auto freezeUp = 1.0 - std::exp (-1.0 / (0.02 * rate)), freezeDown = 1.0 - std::exp (-1.0 / (0.05 * rate));
    bool sounded = false;
    for (int start = 0; start < numSamples; start += slice)
    {
        const auto length = juce::jmin (slice, numSamples - start);
        const auto wantFrozen = frozen ? 1.0 : 0.0;
        freezeAmount += (wantFrozen - freezeAmount) * (1 - std::pow (1 - (wantFrozen > freezeAmount ? freezeUp : freezeDown), length));
        if (freezeAmount < 1e-4)
            freezeAmount = 0;
        // Auto-Decay shortens the tail: the loss a pass × 1/factor.
        const auto factor = juce::jlimit (0.05, 1.0, ducker.factor);
        p.absorb = infinite ? 0.0 : (1 - freezeAmount) / (t60Factor * factor);
        if (p.absorb < 1e-4)
            p.absorb = 0;
        p.hold = infinite || freezeAmount > 0.98;
        p.ceiling = infinite ? 0.05 : 0.0;
        lateLevel += (s.lateLevel - lateLevel) * (1 - std::pow (1 - glide, length));
        auto& a = networks[(size_t) active];
        bool feeding = false;
        for (int i = start; i < start + length && ! feeding; ++i)
            feeding = lateInL[i] != 0.0f || lateInR[i] != 0.0f;
        if (feeding)
            a.idle = false;
        if (! a.idle)
            a.process (p, lateInL + start, lateInR + start, lateL + start, lateR + start, length, (float) lateLevel);
        auto& b = networks[(size_t) (1 - active)];
        if (b.configured() && ! b.idle)
        {
            // The spillover: the old network without input, its own decay.
            auto q = p;
            q.scale = b.scale();
            q.absorb = infinite ? 0.0 : (1 - freezeAmount);
            auto gain = (float) lateLevel;
            if (spillFade > 0)
            {
                gain *= (float) spillFade / (float) spillFadeLength;
                spillFade = juce::jmax (0, spillFade - length);
                if (spillFade == 0)
                    b.clear();
            }
            if (! b.idle)
            {
                b.process (q, nullptr, nullptr, lateL + start, lateR + start, length, gain);
                if (b.peak() < quietPeak && ! q.hold)
                    b.clear();
            }
        }
        sounded = sounded || a.peak() > quietPeak;
    }
    if (! net.idle && ! sounded && silent && ! frozen && ! infinite && quietSamples > (juce::int64) (ringSeconds * rate))
        net.clear();

    // The wet sound: early and late, the era's converter out, the Post EQ, width, ducking; then the mix.
    float outMax[2] {}, duckMost = 0;
    const auto noiseLevel = std::pow (10.0, s.noise / 20);
    const auto release = std::exp (-1.0 / (0.1 * rate));
    for (int i = 0; i < numSamples; ++i)
    {
        const auto g = (double) duckGain[i];
        duckMost = juce::jmin (duckMost, (float) (20 * std::log10 (juce::jmax (g, 1e-6))));
        const auto eg = s.tailOnly ? 1.0 : g;
        double l = earlyL[i] * eg + lateL[i] * g;
        double r = earlyR[i] * eg + lateR[i] * g;
        if (era)
        {
            if (s.noise > -199)
            {
                // The converter's noise follows the sound (gain-ranged), as the old units' did.
                noiseEnvelope = juce::jmax (std::abs (l) + std::abs (r), noiseEnvelope * 0.9995);
                noiseSeed = noiseSeed * 1664525u + 1013904223u;
                const auto n = ((double) (noiseSeed >> 8) / 8388608.0 - 1.0) * noiseLevel * juce::jmin (1.0, 8 * noiseEnvelope);
                l += n, r -= n;
            }
            l = limitOut[0].process (deEmphasis[0].process (quantise (l, s.bits, s.gainRanging)));
            r = limitOut[1].process (deEmphasis[1].process (quantise (r, s.bits, s.gainRanging)));
        }
        l = highShelf[0].process (lowShelf[0].process (studioHigh[0].process (studioLow[0].process (postHigh[0].process (postLow[0].process (l))))));
        r = highShelf[1].process (lowShelf[1].process (studioHigh[1].process (studioLow[1].process (postHigh[1].process (postLow[1].process (r))))));
        // Width as mid and side: the side's lows (under 150 Hz) never widened; Mono Below takes them out.
        width += (s.width - width) * glide;
        const auto mid = 0.5 * (l + r);
        auto side = 0.5 * (l - r);
        const auto lowSide = sideLow.low (side);
        side = width <= 1 ? side * width : lowSide + (side - lowSide) * width;
        if (s.monoBelow >= 20)
            side -= sideMono.low (side);
        level += (s.level - level) * glide;
        l = (mid + side) * level;
        r = (mid - side) * level;
        if (infinite)
        {
            // ∞ keeps adding what comes in: a limiter at -1 dBFS on the wet sound.
            const auto peak = juce::jmax (std::abs (l), std::abs (r)) * limiter;
            limiter = peak > 0.891 ? limiter * 0.891 / peak : 1 - (1 - limiter) * release;
            l *= limiter, r *= limiter;
        }
        outMax[0] = juce::jmax (outMax[0], (float) std::abs (l));
        outMax[1] = juce::jmax (outMax[1], (float) std::abs (r));
        lateL[i] = (float) l;
        lateR[i] = (float) r;
        dry += (s.dry - dry) * glide;
        wet += (s.wet - wet) * glide;
        left[i] = (float) (dryL[i] * dry + l * wet);
        right[i] = (float) (dryR[i] * dry + r * wet);
    }
    if (watched.load (std::memory_order_relaxed))
        spectrum.write (lateL, lateR, numSamples);

    const auto quiet = juce::jmax (outMax[0], outMax[1]) < 1e-6f && silent;
    quietSamples = quiet ? quietSamples + numSamples : 0;
    for (int c = 0; c < 2; ++c)
        outPeak[c].store (juce::jmax (outMax[c], outPeak[c].load (std::memory_order_relaxed) * fall), std::memory_order_relaxed);
    duckDb.store (duckMost, std::memory_order_relaxed);
    keyDb.store ((float) ducker.keyDb(), std::memory_order_relaxed);
    thresholdDb.store ((float) ducker.thresholdDb (s.threshold, s.autoThreshold), std::memory_order_relaxed);
    deEssDb.store (deEss ? deEssMost : 0.0f, std::memory_order_relaxed);
    decayFactor.store ((float) ducker.factor, std::memory_order_relaxed);
    if (networks[0].clipped() || networks[1].clipped())
        clippedFlag.store (true, std::memory_order_relaxed);
}

juce::var State::describe()
{
    auto* object = new juce::DynamicObject();
    const auto round = [] (float v, float by) { return std::round (v * by) / by; };
    object->setProperty ("input", juce::Array<juce::var> { round (inPeak[0].load(), 1e4f), round (inPeak[1].load(), 1e4f) });
    object->setProperty ("output", juce::Array<juce::var> { round (outPeak[0].load(), 1e4f), round (outPeak[1].load(), 1e4f) });
    object->setProperty ("duck", round (duckDb.load(), 100));
    object->setProperty ("key", round (keyDb.load(), 10));
    object->setProperty ("threshold", round (thresholdDb.load(), 10));
    object->setProperty ("deEss", round (deEssDb.load(), 100));
    object->setProperty ("decay", round (decayFactor.load(), 1000));
    object->setProperty ("clip", clippedFlag.exchange (false));
    object->setProperty ("frozen", frozenFlag.load());
    if (watched.load())
    {
        if (spectrum.fresh())
        {
            spectrum.measure (juce::nextPowerOfTwo (analyzerSize.load() * juce::jmax (1, (int) std::lround (rate / 44100.0))), rate, levels);
            juce::Array<juce::var> list;
            list.ensureStorageAllocated ((int) levels.size());
            for (const auto v : levels)
                list.add (std::round (v * 10) / 10);
            object->setProperty ("spectrum", list);
        }
        else
            object->setProperty ("spectrum", juce::var());
    }
    return juce::var (object);
}

// ---------------------------------------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------------------------------------

std::shared_ptr<State> Registry::get (const juce::String& effectId, double sampleRate, int capacity)
{
    auto& state = states[effectId];
    if (state == nullptr || std::abs (state->sampleRate() - sampleRate) > 0.5 || state->capacity() < capacity)
    {
        state = std::make_shared<State> (sampleRate, capacity);
        if (const auto it = watching.find (effectId); it != watching.end())
            state->watched.store (true), state->analyzerSize.store (it->second);
    }
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
        object->setProperty (id, state->describe());
    return juce::var (object);
}
} // namespace verb
