#include "Ott.h"

#include <cmath>

namespace ott
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

/** The crossovers (Hz): the Ableton preset's, as OTT has them (`OTT_CROSSOVERS`). */
constexpr double lowSplit = 88.3, highSplit = 2500;
/** What the values glide over when the song (or a lane) changes them, so a knob turned doesn't click. */
constexpr double glideSeconds = 0.005;

/** The softplus knee (`softKnee`): 0 well below 0, `z` well above, rounded over about `width`. */
inline double softKnee (double width, double z)
{
    const auto over = std::abs (z) / width;
    return juce::jmax (z, 0.0) + (over > 40 ? 0.0 : width * std::log1p (std::exp (-over)));
}

/** A band's gain (dB) for a level (dB): `ottGainDb`. */
inline double gainDb (const Band& band, const double makeup, const double upward, const double upKnee, const double downward, const double downKnee, double level)
{
    const auto up = juce::jmin (band.cap, upward * softKnee (band.upWidth, upKnee - level));
    const auto down = downward * softKnee (band.downWidth, level - downKnee);
    return juce::jmax (band.floor, makeup + up - down);
}
} // namespace

// ---------------------------------------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------------------------------------

std::shared_ptr<Settings> Settings::parse (const juce::var& json, int capacity)
{
    auto s = std::make_shared<Settings>();
    s->dryBuffer.setSize (2, juce::jmax (1, capacity));
    s->input = number (json["input"], 1, 0, 16);
    s->output = number (json["output"], 1, 0, 16);
    if (const auto* list = json["bands"].getArray())
        for (int k = 0; k < juce::jmin (numBands, list->size()); ++k)
        {
            const auto& item = (*list)[k];
            auto& b = s->bands[(size_t) k];
            b.attack = number (item["attack"], b.attack, 1e-5, 1);
            b.release = number (item["release"], b.release, 1e-4, 10);
            b.makeup = number (item["makeup"], 0, -60, 60);
            b.upward = number (item["upward"], 0, 0, 4);
            b.upKnee = number (item["upKnee"], b.upKnee, -200, 40);
            b.upWidth = number (item["upWidth"], b.upWidth, 1e-3, 20);
            b.cap = number (item["cap"], b.cap, 0, 80);
            b.downward = number (item["downward"], 0, 0, 1);
            b.downKnee = number (item["downKnee"], b.downKnee, -200, 40);
            b.downWidth = number (item["downWidth"], b.downWidth, 1e-3, 20);
            b.floor = number (item["floor"], b.floor, -120, 0);
            b.gain = number (item["gain"], 1, 0, 16);
        }
    return s;
}

void Settings::set (Lane lane, const float* v, int size)
{
    const auto each = [&] (auto apply) {
        for (int k = 0; k < juce::jmin (size, numBands); ++k)
            apply (bands[(size_t) k], (double) v[k]);
    };
    switch (lane)
    {
        case Lane::input: input = juce::jlimit (0.0, 16.0, (double) v[0]); break;
        case Lane::output: output = juce::jlimit (0.0, 16.0, (double) v[0]); break;
        case Lane::makeup: each ([] (Band& b, double x) { b.makeup = juce::jlimit (-60.0, 60.0, x); }); break;
        case Lane::upward: each ([] (Band& b, double x) { b.upward = juce::jlimit (0.0, 4.0, x); }); break;
        case Lane::downward: each ([] (Band& b, double x) { b.downward = juce::jlimit (0.0, 1.0, x); }); break;
        case Lane::upKnee: each ([] (Band& b, double x) { b.upKnee = juce::jlimit (-200.0, 40.0, x); }); break;
        case Lane::downKnee: each ([] (Band& b, double x) { b.downKnee = juce::jlimit (-200.0, 40.0, x); }); break;
        case Lane::release: each ([] (Band& b, double x) { b.release = juce::jlimit (1e-4, 10.0, x); }); break;
        case Lane::gains: each ([] (Band& b, double x) { b.gain = juce::jlimit (0.0, 16.0, x); }); break;
    }
}

void Settings::get (Lane lane, float* v, int& size) const
{
    size = numBands;
    const auto each = [&] (auto read) {
        for (int k = 0; k < numBands; ++k)
            v[k] = (float) read (bands[(size_t) k]);
    };
    switch (lane)
    {
        case Lane::input: v[0] = (float) input, size = 1; break;
        case Lane::output: v[0] = (float) output, size = 1; break;
        case Lane::makeup: each ([] (const Band& b) { return b.makeup; }); break;
        case Lane::upward: each ([] (const Band& b) { return b.upward; }); break;
        case Lane::downward: each ([] (const Band& b) { return b.downward; }); break;
        case Lane::upKnee: each ([] (const Band& b) { return b.upKnee; }); break;
        case Lane::downKnee: each ([] (const Band& b) { return b.downKnee; }); break;
        case Lane::release: each ([] (const Band& b) { return b.release; }); break;
        case Lane::gains: each ([] (const Band& b) { return b.gain; }); break;
    }
}

// ---------------------------------------------------------------------------------------------------------
// The crossovers
// ---------------------------------------------------------------------------------------------------------

void State::Svf::setup (double hz, double sampleRate)
{
    const auto g = std::tan (juce::MathConstants<double>::pi * juce::jmin (hz, 0.49 * sampleRate) / sampleRate);
    k = std::sqrt (2.0);
    a1 = 1.0 / (1.0 + g * (g + k));
    a2 = g * a1;
    a3 = g * a2;
}

void State::Svf::run (double x, double& low, double& high, double& all)
{
    const auto v3 = x - s2;
    const auto v1 = a1 * s1 + a2 * v3;
    const auto v2 = s2 + a2 * s1 + a3 * v3;
    s1 = 2 * v1 - s1;
    s2 = 2 * v2 - s2;
    low = v2;
    high = x - k * v1 - v2;
    all = x - 2 * k * v1;
}

void State::Splitter::split (double x, double& low, double& mid, double& high)
{
    double l, h, a;
    // Linkwitz-Riley at 88.3 Hz: two Butterworth sections each way.
    low1.run (x, l, h, a);
    low2.run (l, low, h, a);
    double hp;
    high1.run (x, l, h, a);
    high2.run (h, l, hp, a);
    // The low band through the 2.5 kHz crossover's all-pass, so the three add up to the sound (phase-shifted).
    lowAll.run (low, l, h, low);
    // And at 2.5 kHz, what's above 88.3 Hz.
    mid1.run (hp, l, h, a);
    mid2.run (l, mid, h, a);
    top1.run (hp, l, h, a);
    top2.run (h, l, high, a);
}

void State::Splitter::reset()
{
    for (auto* svf : { &low1, &low2, &high1, &high2, &lowAll, &mid1, &mid2, &top1, &top2 })
        svf->reset();
}

// ---------------------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------------------

State::State (double sampleRate) : rate (sampleRate), glide (1.0 - std::exp (-1.0 / (glideSeconds * sampleRate)))
{
    for (auto& s : splitters)
    {
        for (auto* svf : { &s.low1, &s.low2, &s.high1, &s.high2 })
            svf->setup (lowSplit, rate);
        for (auto* svf : { &s.lowAll, &s.mid1, &s.mid2, &s.top1, &s.top2 })
            svf->setup (highSplit, rate);
    }
    for (int k = 0; k < numBands; ++k)
        level[(size_t) k].store (-120.0f), gain[(size_t) k].store (0.0f);
}

void State::process (const Settings& settings, float* left, float* right, int numSamples)
{
    juce::ScopedNoDenormals noDenormals;
    // Started afresh (new, or after a bypass): nothing heard yet, every value where the song has it.
    if (stale)
    {
        for (auto& s : splitters)
            s.reset();
        envelope.fill (0);
        for (int k = 0; k < numBands; ++k)
        {
            const auto& b = settings.bands[(size_t) k];
            now[(size_t) k] = { b.makeup, b.upward, b.upKnee, b.downward, b.downKnee, b.gain };
        }
        input = settings.input, output = settings.output;
        stale = false;
    }

    std::array<double, numBands> attack {}, release {};
    for (int k = 0; k < numBands; ++k)
    {
        attack[(size_t) k] = 1.0 - std::exp (-1.0 / (settings.bands[(size_t) k].attack * rate));
        release[(size_t) k] = 1.0 - std::exp (-1.0 / (settings.bands[(size_t) k].release * rate));
    }

    std::array<double, numBands> lastLevel {}, lastGain {};
    float inMax[2] {}, outMax[2] {};
    for (int i = 0; i < numSamples; ++i)
    {
        input += (settings.input - input) * glide;
        output += (settings.output - output) * glide;
        const auto l = left[i] * input, r = right[i] * input;
        inMax[0] = juce::jmax (inMax[0], (float) std::abs (l)), inMax[1] = juce::jmax (inMax[1], (float) std::abs (r));
        std::array<double, numBands> bl {}, br {};
        splitters[0].split (l, bl[0], bl[1], bl[2]);
        splitters[1].split (r, br[0], br[1], br[2]);

        double outL = 0, outR = 0;
        for (size_t k = 0; k < (size_t) numBands; ++k)
        {
            const auto& b = settings.bands[k];
            auto& n = now[k];
            n.makeup += (b.makeup - n.makeup) * glide;
            n.upward += (b.upward - n.upward) * glide;
            n.upKnee += (b.upKnee - n.upKnee) * glide;
            n.downward += (b.downward - n.downward) * glide;
            n.downKnee += (b.downKnee - n.downKnee) * glide;
            n.gain += (b.gain - n.gain) * glide;

            // The band's level: a one-pole on both sides' mean square, attacking or releasing as it goes.
            const auto power = 0.5 * (bl[k] * bl[k] + br[k] * br[k]);
            auto e = envelope[k];
            e += (power > e ? attack[k] : release[k]) * (power - e);
            envelope[k] = e < 1e-30 ? 0 : e;
            const auto db = 10.0 * std::log10 (juce::jmax (e, 1e-20));
            const auto g = gainDb (b, n.makeup, n.upward, n.upKnee, n.downward, n.downKnee, db);
            const auto gl = std::pow (10.0, g / 20.0) * n.gain;
            outL += gl * bl[k];
            outR += gl * br[k];
            lastLevel[k] = db, lastGain[k] = g;
        }
        left[i] = (float) (outL * output);
        right[i] = (float) (outR * output);
        outMax[0] = juce::jmax (outMax[0], std::abs (left[i])), outMax[1] = juce::jmax (outMax[1], std::abs (right[i]));
    }

    // For its display: each band's level and gain as the block ended, and the peaks in and out (falling).
    if (numSamples > 0)
        for (size_t k = 0; k < (size_t) numBands; ++k)
        {
            level[k].store ((float) juce::jmax (-120.0, lastLevel[k]), std::memory_order_relaxed);
            gain[k].store ((float) (lastGain[k] + 20.0 * std::log10 (juce::jmax (now[k].gain, 1e-6))), std::memory_order_relaxed);
        }
    const auto fall = (float) std::exp (-numSamples / (0.25 * rate));
    for (int c = 0; c < 2; ++c)
    {
        inPeak[(size_t) c].store (juce::jmax (inMax[c], inPeak[(size_t) c].load (std::memory_order_relaxed) * fall), std::memory_order_relaxed);
        outPeak[(size_t) c].store (juce::jmax (outMax[c], outPeak[(size_t) c].load (std::memory_order_relaxed) * fall), std::memory_order_relaxed);
    }
}

juce::var State::describe() const
{
    juce::Array<juce::var> list;
    for (size_t k = 0; k < (size_t) numBands; ++k)
    {
        auto* band = new juce::DynamicObject();
        band->setProperty ("level", level[k].load());
        band->setProperty ("gain", gain[k].load());
        list.add (juce::var (band));
    }
    auto* object = new juce::DynamicObject();
    object->setProperty ("bands", list);
    object->setProperty ("input", juce::Array<juce::var> { inPeak[0].load(), inPeak[1].load() });
    object->setProperty ("output", juce::Array<juce::var> { outPeak[0].load(), outPeak[1].load() });
    return juce::var (object);
}

// ---------------------------------------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------------------------------------

std::shared_ptr<State> Registry::get (const juce::String& effectId, double sampleRate)
{
    auto& state = states[effectId];
    if (state == nullptr || std::abs (state->sampleRate() - sampleRate) > 0.5)
        state = std::make_shared<State> (sampleRate);
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
} // namespace ott
