#include "Reverb.h"

#include <cmath>

// A Reverb's settings: parsed from the song (on the message thread), designed, and moved by its lanes.

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

juce::uint64 mixHash (juce::uint64 h, double v)
{
    const auto q = (juce::int64) std::llround (v * 1e7);
    h ^= (juce::uint64) q + 0x9e3779b97f4a7c15ull + (h << 6) + (h >> 2);
    return h;
}
} // namespace

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
    if (const auto* lines = early["lines"].getArray())
        for (int j = 0; j < juce::jmin (maxLines, lines->size()); ++j)
        {
            std::vector<EarlyTap> taps;
            if (const auto* list = (*lines)[j].getArray())
            {
                taps.reserve ((size_t) juce::jmin (LineFeed::maxTaps, list->size() / 3));
                for (int k = 0; k + 2 < list->size() && (int) taps.size() < LineFeed::maxTaps; k += 3)
                    taps.push_back ({ (float) number ((*list)[k], 0, 0, 0.3), (float) number ((*list)[k + 1], 0, -4, 4), (float) number ((*list)[k + 2], 1, 0, 1e3) });
            }
            s->earlyLines.push_back (std::move (taps));
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
} // namespace verb
