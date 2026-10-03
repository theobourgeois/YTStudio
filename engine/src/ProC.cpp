#include "ProC.h"

#include <cmath>

namespace comp
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

template <typename E>
E pick (const juce::var& v, std::initializer_list<const char*> names, E fallback)
{
    int i = 0;
    for (const auto* name : names)
    {
        if (v.toString() == name)
            return (E) i;
        ++i;
    }
    return fallback;
}

/** The chunk the input is taken in (the oversamplers are made for it). */
constexpr int chunk = 256;
/** What the knobs glide over, and the display's slice (samples at the song's rate). */
constexpr double glideSeconds = 0.02;
constexpr int slice = 256;

eq::Shape eqShapeOf (const juce::String& name)
{
    static const juce::StringArray names { "bell", "lowShelf", "lowCut", "highShelf", "highCut", "notch", "bandPass", "tiltShelf", "flatTilt" };
    return (eq::Shape) juce::jmax (0, names.indexOf (name));
}

/** A Pro-Q band (`EngineEqBand`) as a filter at `rate`. */
Filter makeFilter (const juce::var& band, double rate)
{
    eq::BandShape shape;
    shape.shape = eqShapeOf (band["shape"].toString());
    shape.frequency = number (band["frequency"], 1000, 10, 30000);
    shape.gain = number (band["gain"], 0, -60, 60);
    shape.q = number (band["q"], 1, 0.025, 40);
    shape.slope = (int) number (band["slope"], 12, 0, 96);
    eq::Sections sections;
    eq::analogSections (shape, sections);
    Filter filter;
    filter.count = sections.count;
    for (int i = 0; i < sections.count; ++i)
        filter.svfs[(size_t) i] = eq::Svf::from (eq::matched (sections.list[(size_t) i], rate));
    const auto placement = band["placement"].toString();
    filter.placement = placement == "mid" ? 1 : placement == "side" ? 2 : 0;
    return filter;
}

/** Run a filter's sections on one sample, its memory in `state` (two values a section). */
inline double runFilter (const Filter& f, double x, double* state)
{
    for (int s = 0; s < f.count; ++s)
        x = f.svfs[(size_t) s].run (x, state[s * 2], state[s * 2 + 1]);
    return x;
}

} // namespace

// ---------------------------------------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------------------------------------

std::shared_ptr<Settings> Settings::parse (const juce::var& json, int capacity, State& state)
{
    juce::ignoreUnused (capacity);
    auto s = std::make_shared<Settings>();
    const auto rate = state.sampleRate();
    s->feedback = (bool) json["feedback"];
    s->loop = number (json["loop"], 0, 0, 30);
    s->rms = number (json["rms"], 0, 0, 1);
    s->rmsTime = number (json["rmsTime"], 0.005, 0.0001, 1);
    s->detector = pick (json["detector"], { "log", "linear", "light" }, Detector::log);

    const auto curve = json["curve"];
    s->curve.kind = pick (curve["kind"], { "standard", "progressive", "upward", "vocal" }, CurveKind::standard);
    s->curve.threshold = number (curve["threshold"], -18, -120, 40);
    s->curve.slope = number (curve["slope"], 0.75, 0, 1);
    s->curve.knee = number (curve["knee"], 6, 0, 80);
    s->curve.range = number (curve["range"], 40, 0, 60);
    s->autoThreshold = (bool) json["autoThreshold"];

    const auto b = json["ballistics"];
    auto& bl = s->ballistics;
    bl.attack = number (b["attack"], 0.005, 1e-6, 2);
    bl.release = number (b["release"], 0.1, 1e-3, 20);
    bl.hold = number (b["hold"], 0, 0, 1);
    bl.shape = pick (b["shape"], { "decoupled", "second", "smoothstep", "dual", "rate", "opto", "fixMan" }, Shape::decoupled);
    bl.program = number (b["program"], 1, 1, 200);
    bl.programTime = number (b["programTime"], 0.5, 0.01, 10);
    bl.autoRelease = (bool) b["autoRelease"];
    bl.dualWeight = number (b["dualWeight"], 1, 0, 1);
    bl.dualFactor = number (b["dualFactor"], 1, 1, 1000);
    bl.rate = number (b["rate"], 120, 0.1, 100000);
    bl.rateAttack = (bool) b["rateAttack"];
    bl.attackDelay = number (b["attackDelay"], 0, 0, 0.05);

    if (const auto o = json["opto"]; o.isObject())
    {
        s->hasOpto = true;
        auto& op = s->opto;
        op.light = number (o["light"], 0.01, 1e-5, 2);
        op.fastRise = number (o["fastRise"], 0.005, 1e-5, 2);
        op.fastFall = number (o["fastFall"], 0.02, 1e-4, 20);
        op.slowRise = number (o["slowRise"], 0.005, 1e-5, 5);
        op.slowFall = number (o["slowFall"], 0.2, 1e-3, 30);
        op.memory = number (o["memory"], 1.8, 0, 60);
        op.split = number (o["split"], 0.5, 0, 1);
    }
    if (const auto t = json["ttm"]; t.isObject())
    {
        s->ttm = true;
        for (int i = 0; i < 2; ++i)
            s->crossovers[(size_t) i] = number (t["crossovers"][i], s->crossovers[(size_t) i], 20, 20000);
        for (int i = 0; i < 3; ++i)
        {
            s->ttmUp[(size_t) i] = number (t["upward"][i], s->ttmUp[(size_t) i], 0, 80);
            s->ttmTimes[(size_t) i] = number (t["times"][i], s->ttmTimes[(size_t) i], 0.05, 20);
        }
    }
    if (const auto g = json["gate"]; g.isObject())
    {
        s->gate = true;
        s->gateThreshold = number (g["threshold"], -60, -120, 0);
        s->gateRatio = number (g["ratio"], 4, 1, 100);
        s->gateRange = number (g["range"], 40, 0, 120);
    }
    if (const auto l = json["limiter"]; l.isObject())
    {
        s->limiter = true;
        s->limThreshold = number (l["threshold"], 0, -60, 12);
        s->limAttack = number (l["attack"], 0, 0, 0.1);
        s->limRelease = number (l["release"], 0.06, 0.001, 5);
    }
    const auto colour = json["colour"];
    s->colour.kind = pick (colour["kind"], { "none", "even", "odd", "tape", "diode" }, ColourKind::none);
    s->colour.base = number (colour["base"], 0, 0, 1);
    s->colour.perDb = number (colour["perDb"], 0, 0, 1);
    s->colour.peak = number (colour["peak"], 0, 0, 60);
    s->colour.width = number (colour["width"], 1, 0.1, 60);
    s->colour.tilt = number (colour["tilt"], 0, -12, 12);
    s->colour.drive = number (colour["drive"], 1, 0.001, 1000);
    const auto character = json["character"];
    s->character = (int) number (character["mode"], 0, 0, 3);
    s->charDrive = number (character["drive"], 1, 1, 100);
    s->charPost = character["post"].isVoid() || (bool) character["post"];
    s->emphasis = number (json["emphasis"], 0, 0, 24);
    s->makeup = number (json["makeup"], 0, -96, 96);
    s->wetPan = number (json["wetPan"], 0, -1, 1);
    s->mix = number (json["mix"], 1, 0, 2);
    for (int c = 0; c < 2; ++c)
    {
        s->dry[(size_t) c] = number (json["dry"][c], 0, 0, 64);
        s->input[(size_t) c] = number (json["input"][c], 1, 0, 64);
        s->output[(size_t) c] = number (json["output"][c], 1, 0, 64);
    }
    s->link = number (json["link"], 1, 0, 1);
    s->toward = number (json["toward"], 0, 0, 1);
    s->linkMode = pick (json["linkMode"], { "mid", "side", "midToSide", "sideToMid" }, LinkMode::mid);

    const auto sc = json["sidechain"];
    s->source = pick (sc["source"], { "internal", "external", "sync" }, Source::internal);
    s->level = number (sc["level"], 1, 0, 64);
    s->syncBeats = number (sc["syncBeats"], 1, 1.0 / 64, 64);
    s->syncLength = number (sc["syncLength"], 0.5, 0.01, 1);
    if (const auto* bands = sc["bands"].getArray())
        for (const auto& band : *bands)
            if (s->keyFilters.size() < 12)
                s->keyFilters.push_back (makeFilter (band, rate));
    // The left/right (stereo) ones first, then the mid/side ones (Pro-Q's order).
    std::stable_sort (s->keyFilters.begin(), s->keyFilters.end(), [] (const Filter& a, const Filter& c) { return (a.placement != 0) < (c.placement != 0); });
    if (const auto* bands = json["post"].getArray())
        for (const auto& band : *bands)
            if (s->postFilters.size() < 4)
                s->postFilters.push_back (makeFilter (band, rate));

    const auto factor = (int) number (json["oversampling"], 1, 1, 16);
    s->oversampling = factor >= 16 ? 16 : factor >= 8 ? 8 : factor >= 4 ? 4 : factor >= 2 ? 2 : 1;
    s->maxLookahead = (int) std::lround (number (json["maxLookahead"], 0, 0, 0.02) * rate);
    s->lookahead = juce::jmin (s->maxLookahead, (int) std::lround (number (json["lookahead"], 0, 0, 0.02) * rate));
    state.prepare (s->oversampling);
    s->latency = s->maxLookahead + state.oversamplingLatency (s->oversampling);
    return s;
}

void Settings::set (Lane lane, const float* v, int size)
{
    const auto at = [&] (int i) { return (double) v[juce::jmin (i, size - 1)]; };
    switch (lane)
    {
        case Lane::threshold: curve.threshold = juce::jlimit (-120.0, 40.0, at (0)); break;
        case Lane::slope:
            curve.slope = juce::jlimit (0.0, 1.0, at (0));
            if (size > 1)
                loop = juce::jlimit (0.0, 30.0, at (1));
            break;
        case Lane::knee: curve.knee = juce::jlimit (0.0, 80.0, at (0)); break;
        case Lane::range: curve.range = juce::jlimit (0.0, 60.0, at (0)); break;
        case Lane::attack: ballistics.attack = juce::jlimit (1e-6, 2.0, at (0)); break;
        case Lane::release: ballistics.release = juce::jlimit (1e-3, 20.0, at (0)); break;
        case Lane::hold: ballistics.hold = juce::jlimit (0.0, 1.0, at (0)); break;
        case Lane::makeup: makeup = juce::jlimit (-96.0, 96.0, at (0)); break;
        case Lane::dry: dry = { juce::jlimit (0.0, 64.0, at (0)), juce::jlimit (0.0, 64.0, at (1)) }; break;
        case Lane::mix: mix = juce::jlimit (0.0, 2.0, at (0)); break;
        case Lane::level: level = juce::jlimit (0.0, 64.0, at (0)); break;
        case Lane::drive: charDrive = juce::jlimit (1.0, 100.0, at (0)); break;
        case Lane::input: input = { juce::jlimit (0.0, 64.0, at (0)), juce::jlimit (0.0, 64.0, at (1)) }; break;
        case Lane::output: output = { juce::jlimit (0.0, 64.0, at (0)), juce::jlimit (0.0, 64.0, at (1)) }; break;
        case Lane::emphasis: emphasis = juce::jlimit (0.0, 24.0, at (0)); break;
    }
}

void Settings::get (Lane lane, float* v, int& size) const
{
    size = 1;
    switch (lane)
    {
        case Lane::threshold: v[0] = (float) curve.threshold; break;
        case Lane::slope: v[0] = (float) curve.slope, v[1] = (float) loop, size = 2; break;
        case Lane::knee: v[0] = (float) curve.knee; break;
        case Lane::range: v[0] = (float) curve.range; break;
        case Lane::attack: v[0] = (float) ballistics.attack; break;
        case Lane::release: v[0] = (float) ballistics.release; break;
        case Lane::hold: v[0] = (float) ballistics.hold; break;
        case Lane::makeup: v[0] = (float) makeup; break;
        case Lane::dry: v[0] = (float) dry[0], v[1] = (float) dry[1], size = 2; break;
        case Lane::mix: v[0] = (float) mix; break;
        case Lane::level: v[0] = (float) level; break;
        case Lane::drive: v[0] = (float) charDrive; break;
        case Lane::input: v[0] = (float) input[0], v[1] = (float) input[1], size = 2; break;
        case Lane::output: v[0] = (float) output[0], v[1] = (float) output[1], size = 2; break;
        case Lane::emphasis: v[0] = (float) emphasis; break;
    }
}

// ---------------------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------------------

State::State (double sampleRate, int capacity) : rate (sampleRate), blockCapacity (juce::jmax (1, capacity))
{
    // The input's ring: the longest lookahead, the longest oversampling delay, a block. The key's: a second more.
    const auto room = (int) std::ceil (0.025 * rate) + 2048 + blockCapacity;
    inputRing.setSize (2, room);
    rawRing.setSize (2, room);
    keyRing.setSize (2, room + (int) std::ceil (rate));
    inputRing.clear();
    rawRing.clear();
    keyRing.clear();
    chunkAudio.setSize (2, chunk);
    chunkKey.setSize (2, chunk);
    chunkReduction.assign ((size_t) chunk * 16, 0.0f);
    // Lookahead at 16× of 20 ms.
    const auto most = (int) std::ceil (0.02 * rate * 16) + 4;
    for (auto& p : paths)
    {
        p.max.prepare (most);
        p.box1.prepare (most);
        p.box2.prepare (most);
    }
    for (auto& a : inPeak)
        a.store (0);
    for (auto& a : outPeak)
        a.store (0);
    prepare (1);
}

void State::prepare (int f)
{
    if (f <= 1 || audioUp.count (f) > 0)
        return;
    const auto stages = (size_t) std::round (std::log2 ((double) f));
    for (auto* map : { &audioUp, &keyUp })
    {
        auto os = std::make_unique<juce::dsp::Oversampling<float>> (2, stages, juce::dsp::Oversampling<float>::filterHalfBandFIREquiripple, true, true);
        os->initProcessing ((size_t) chunk);
        (*map)[f] = std::move (os);
    }
}

int State::oversamplingLatency (int f) const
{
    const auto it = audioUp.find (f);
    return f <= 1 || it == audioUp.end() ? 0 : (int) std::lround (it->second->getLatencyInSamples());
}

void State::startMatch (double seconds)
{
    matchRequest.store ((int) (juce::jlimit (1.0, 60.0, seconds) * 1000));
}

void State::reset (const Settings& s)
{
    factor = s.oversampling;
    for (auto& d : detect)
        d = {};
    for (auto& p : paths)
    {
        p.y1 = p.mid = p.yL = p.y1b = p.midB = p.yLb = 0;
        p.holdLeft = 0, p.attackAge = 1 << 30, p.attacking = false;
        p.program = p.average = 0;
        p.ssAge = -1;
        p.light = p.fast = p.slow = p.exposure = 0;
        p.fmFast1 = p.fmFast = p.fmSlow = 0, p.overTime = 0;
        p.gate = p.gr = 0;
        p.max.reset();
        p.box1.reset();
        p.box2.reset();
    }
    for (auto& p : bandPaths)
        p.y1 = p.mid = p.yL = p.gr = p.program = 0, p.holdLeft = 0, p.attacking = false;
    bandMs.fill (0);
    const auto core = rate * factor;
    for (auto& sp : splitters)
    {
        sp.setup (s.crossovers[0], s.crossovers[1], core);
        sp.reset();
    }
    for (auto& f : brightFilter)
        f.setup (2000, core), f.reset();
    for (auto& f : tiltFilter)
        f.setup (5000, core), f.reset();
    // The DC taken off after an even shaper: a one-pole at 5 Hz.
    for (auto& f : dcFilter)
        f.setup (5, core), f.reset();
    for (auto& st : filterState)
        st.fill (0);
    for (auto& st : postState)
        st.fill (0);
    for (auto& st : emphasisState)
        st.fill (0);
    inputRing.clear();
    rawRing.clear();
    keyRing.clear();
    ringWrite = keyWrite = 0;
    autoLevel = -18;
    glide = { s.curve.threshold, s.curve.slope, s.loop, s.curve.knee, s.curve.range, s.makeup, s.mix, s.charDrive };
    inGain = s.input, outGain = s.output, dryGain = s.dry;
    keyLevel = s.level;
    limGain = 0;
    for (auto& [f, os] : audioUp)
        os->reset();
    for (auto& [f, os] : keyUp)
        os->reset();
    fadeIn = 0;
    stale = false;
}

double State::Target::operator() (double gr) const
{
    if (ttm)
    {
        // TTM's band: down above the threshold, up below its own lower one (faded out under a floor), the knee shared.
        const auto down = curve.slope * kneeOver (level - curve.threshold, curve.knee);
        const auto up = std::min (curve.range, curve.slope * kneeOver (upThreshold - level, curve.knee));
        const auto fade = juce::jlimit (0.0, 1.0, (level - (upThreshold - 40)) / 12);
        return limitRange (down, curve.range, curve.knee) - up * fade;
    }
    if (feedback && curve.kind != CurveKind::upward)
        return feedbackLaw (curve, loop, level - gr);
    return curveReduction (curve, level, average);
}

namespace
{
/** A follower's next value as `a + b·t` for its target `t`, once its branch (attack, hold, release) is chosen. */
struct Linear
{
    double a = 0, b = 0;
};

/** A smooth decoupled follower's step as `a + b·t` (Giannoulis et al.): its release stage (y1), then one attack pole or two. */
Linear decoupled (double y1, double mid, double yL, bool attack, bool holding, double aR, double aA, bool second)
{
    const Linear stage = attack ? Linear { 0, 1 } : holding ? Linear { y1, 0 } : Linear { aR * y1, 1 - aR };
    if (second)
        return { aA * yL + (1 - aA) * (aA * mid + (1 - aA) * stage.a), (1 - aA) * (1 - aA) * stage.b };
    return { aA * yL + (1 - aA) * stage.a, (1 - aA) * stage.b };
}

/** A branching follower's step as `a + b·t` (a feedback loop's detector): it rises at the attack, falls at the release, or holds. */
Linear branching (double yL, bool attack, bool holding, double aR, double aA)
{
    if (attack)
        return { aA * yL, 1 - aA };
    if (holding)
        return { yL, 0 };
    return { aR * yL, 1 - aR };
}
double branched (double yL, double t, bool attack, bool holding, double aR, double aA)
{
    const auto l = branching (yL, attack, holding, aR, aA);
    return l.a + l.b * t;
}

/** Its state moved on for the target it got. */
void advance (double& y1, double& mid, double& yL, double t, bool attack, bool holding, double aR, double aA, bool second)
{
    y1 = attack ? t : holding ? y1 : aR * y1 + (1 - aR) * t;
    if (second)
    {
        mid = aA * mid + (1 - aA) * y1;
        yL = aA * yL + (1 - aA) * mid;
    }
    else
        yL = aA * yL + (1 - aA) * y1;
}

inline double alpha (double seconds, double rate) { return std::exp (-1.0 / (juce::jmax (seconds, 1e-7) * rate)); }

/** Pro-C 3's Character, ours (`docs/fabfilter/pro-c.md` 5.12). */
inline double character (int mode, double x, double drive, OnePole& bright)
{
    switch (mode)
    {
        case 1: return tubeShape (x, drive);
        case 2: return diodeShape (x, drive);
        case 3: return x + 0.5 * std::tanh (drive * bright.high (x)) / drive;
        default: return x;
    }
}
} // namespace

double State::follow (const Settings& s, const Ballistics& b, Path& p, const Target& target, double coreRate, double crest)
{
    const auto c = [coreRate] (double seconds) { return coefficient (seconds, coreRate); };
    const auto feedback = target.feedback && target.curve.kind != CurveKind::upward;

    switch (b.shape)
    {
        case Shape::opto:
        {
            // The light follows the target; the cell's fast part follows the light, and its slow part too, slower
            // to let go the longer and harder it's been lit (its memory): the LA-2A's "60 ms to half, then seconds".
            const auto& o = s.opto;
            const auto t = target (p.gr);
            p.light += (t - p.light) * c (o.light);
            p.fast += (p.light - p.fast) * (p.light > p.fast ? c (o.fastRise) : c (o.fastFall));
            p.slow += (p.light - p.slow) * (p.light > p.slow ? c (o.slowRise) : c (o.slowFall + o.memory * p.exposure));
            const auto lit = juce::jlimit (0.0, 1.0, p.light / 10);
            p.exposure += (lit - p.exposure) * (lit > p.exposure ? c (2.0) : c (10.0));
            p.gr = o.split * p.fast + (1 - o.split) * p.slow;
            return p.gr;
        }
        case Shape::rate:
        {
            // dbx's RMS law: an attack faster the bigger the step (15, 5, 3 ms for 10, 20, 30 dB), a release at a constant dB/s.
            // The attack's time is set by the step it starts on (and shortened if the step grows), not by what's left of it.
            const auto t = target (p.gr);
            if (t > p.yL)
            {
                const auto step = t - p.yL;
                const auto tau = b.rateAttack ? 0.015 * std::pow (10.0 / juce::jlimit (1.0, 40.0, step), 1.6) : b.attack;
                p.ssStart = p.attacking ? juce::jmin (p.ssStart, tau) : tau;
                p.attacking = true;
                p.yL += step * c (p.ssStart);
            }
            else
            {
                p.attacking = false;
                p.yL = juce::jmax (t, p.yL - b.rate / coreRate);
            }
            p.gr = p.yL;
            return p.gr;
        }
        case Shape::smoothstep:
        {
            // Pumping: the attack a one-pole, the release a smoothstep from where it began, so the swell back is heard.
            const auto t = target (p.gr);
            if (t >= p.yL)
            {
                p.yL += (t - p.yL) * c (b.attack);
                p.ssAge = -1;
            }
            else
            {
                if (p.ssAge < 0)
                    p.ssStart = p.yL, p.ssAge = 0;
                const auto span = juce::jmax (1.0, 2.3 * b.release * coreRate);
                const auto u = juce::jmin (1.0, (double) p.ssAge++ / span);
                p.yL = juce::jmax (t, p.ssStart * (1 - u * u * (3 - 2 * u)));
            }
            p.gr = p.yL;
            return p.gr;
        }
        case Shape::fixMan:
        {
            // The CL 1B's Fix / Man: a fast detector (1 ms, 50 ms) and a slow one that only starts once the level
            // has stayed over for longer than Attack, releasing at Release; the larger wins.
            const auto t = target (p.gr);
            const auto aR = alpha (0.05, coreRate), aA = alpha (0.001, coreRate);
            p.fmFast1 = juce::jmax (t, aR * p.fmFast1 + (1 - aR) * t);
            p.fmFast = aA * p.fmFast + (1 - aA) * p.fmFast1;
            p.overTime = t > 0.5 ? p.overTime + 1 : 0;
            if (t > p.fmSlow)
            {
                if ((double) p.overTime >= b.attack * coreRate)
                    p.fmSlow += (t - p.fmSlow) * c (0.001);
            }
            else
                p.fmSlow += (t - p.fmSlow) * c (b.release);
            p.gr = juce::jmax (p.fmFast, p.fmSlow);
            return p.gr;
        }
        case Shape::decoupled:
        case Shape::second:
        case Shape::dual: break;
    }

    // The smooth decoupled follower (and Second's two attack poles, Dual's slower second follower), with hold,
    // program dependency and Auto Release; in a feedback loop, solved for the reduction it settles on this sample.
    // In a loop the follower branches (one state, rising at the attack and falling at the release: the
    // detector's capacitor): a peak stage there would hold the loud output of an onset's first moment.
    auto attackTime = b.attack;
    if (b.attackDelay > 0 && (double) p.attackAge < b.attackDelay * coreRate)
        attackTime *= 8;
    auto release = b.release * (1 + (b.program - 1) * p.program);
    if (b.autoRelease)
        release *= (0.25 + 1.75 * juce::jlimit (0.0, 1.0, p.yL / 18)) * juce::jlimit (0.25, 1.0, 2 / (crest * crest));
    const auto second = b.shape == Shape::second;
    const auto dual = b.shape == Shape::dual;
    const auto aA = second ? alpha (0.87 * attackTime / 2, coreRate) : alpha (attackTime, coreRate);
    // The decoupled follower's release measures about its stage's plus the attack's, so its stage is that much shorter.
    const auto releaseStage = feedback ? release : juce::jmax (release - attackTime, release / 2);
    const auto aR = alpha (releaseStage, coreRate), aRb = alpha (releaseStage * b.dualFactor, coreRate);
    const auto holding = p.holdLeft > 0;
    const auto w = dual ? b.dualWeight : 1.0;

    auto t = target (feedback ? p.gr : 0.0);
    auto attackA = t >= (feedback ? p.yL : p.y1), attackB = t >= (feedback ? p.yLb : p.y1b);
    auto g = 0.0;
    for (int pass = 0; pass < 2; ++pass)
    {
        auto l = feedback ? branching (p.yL, attackA, holding && ! attackA, aR, aA) : decoupled (p.y1, p.mid, p.yL, attackA, holding && ! attackA, aR, aA, second);
        if (dual)
        {
            const auto lb = feedback ? branching (p.yLb, attackB, holding && ! attackB, aRb, aA) : decoupled (p.y1b, p.midB, p.yLb, attackB, holding && ! attackB, aRb, aA, second);
            l = { w * l.a + (1 - w) * lb.a, w * l.b + (1 - w) * lb.b };
        }
        if (! feedback)
        {
            g = l.a + l.b * t;
            break;
        }
        // g = a + b·target(g): the target falls as g rises, so the root is between a and a + b·target(a) (Illinois' method).
        auto lo = l.a, hi = l.a + l.b * target (l.a);
        auto hLo = lo - l.a - l.b * target (lo), hHi = hi - l.a - l.b * target (hi);
        g = hi;
        int side = 0;
        for (int k = 0; k < 24 && hi - lo > 1e-7; ++k)
        {
            g = std::abs (hHi - hLo) > 1e-15 ? hi - hHi * (hi - lo) / (hHi - hLo) : (lo + hi) / 2;
            const auto h = g - l.a - l.b * target (g);
            if (h > 0)
            {
                hi = g, hHi = h;
                if (side == 1)
                    hLo /= 2;
                side = 1;
            }
            else
            {
                lo = g, hLo = h;
                if (side == -1)
                    hHi /= 2;
                side = -1;
            }
        }
        t = target (g);
        const auto nowA = t >= (feedback ? p.yL : p.y1), nowB = t >= (feedback ? p.yLb : p.y1b);
        if (nowA == attackA && (! dual || nowB == attackB))
            break;
        attackA = nowA, attackB = nowB;
    }

    if (feedback)
    {
        p.yL = branched (p.yL, t, attackA, holding && ! attackA, aR, aA);
        if (dual)
            p.yLb = branched (p.yLb, t, attackB, holding && ! attackB, aRb, aA);
    }
    else
    {
        advance (p.y1, p.mid, p.yL, t, attackA, holding && ! attackA, aR, aA, second);
        if (dual)
            advance (p.y1b, p.midB, p.yLb, t, attackB, holding && ! attackB, aRb, aA, second);
    }
    if (dual)
    {
        g = w * p.yL + (1 - w) * p.yLb;
    }
    else
        g = p.yL;
    if (attackA)
        p.holdLeft = (int) std::lround (b.hold * coreRate);
    else if (p.holdLeft > 0)
        --p.holdLeft;
    if (attackA && ! p.attacking)
        p.attackAge = 0;
    p.attacking = attackA;
    if (p.attackAge < (1 << 30))
        ++p.attackAge;
    // Program dependency: how long it's been compressing (rising over `programTime`, falling over 2 s).
    const auto over = t > 1 ? 1.0 : 0.0;
    p.program += (over - p.program) * (over > p.program ? c (b.programTime) : c (2.0));
    p.gr = g;
    return g;
}

void State::runCore (const Settings& s, float* const* audio, const float* const* key, int n, double coreRate, float* reduction)
{
    const auto c = [coreRate] (double seconds) { return coefficient (seconds, coreRate); };
    const auto cGlide = c (glideSeconds), cRms = c (s.rmsTime), cPanel = c (0.001), cCrest = c (0.2);
    const auto cAutoUp = c (1.0), cAutoDown = c (3.0), cAverage = c (1.5), cGateClose = c (0.08), cGateOpen = c (0.0005);
    const auto msMode = s.toward > 0 && ! s.ttm;
    const auto look = s.lookahead * factor;
    const auto lookFirst = (int) std::lround (0.582 * look), lookSecond = look - lookFirst;
    const auto rho = s.rms;
    const auto& bl = s.ballistics;
    const auto cAttackLinear = c (bl.attack), cReleaseLinear = c (bl.release * (1 + (bl.program - 1) * paths[0].program));
    const auto wM = s.linkMode == LinkMode::mid || s.linkMode == LinkMode::sideToMid ? 1.0 : 1.0 - s.toward;
    const auto wS = s.linkMode == LinkMode::side || s.linkMode == LinkMode::midToSide ? 1.0 : 1.0 - s.toward;
    const auto& colour = s.colour;
    const auto dcBlock = colour.kind == ColourKind::even || colour.kind == ColourKind::tape || s.character == 1;
    std::array<Ballistics, 3> bandTimes { bl, bl, bl };
    for (size_t k = 0; k < 3; ++k)
    {
        bandTimes[k].shape = Shape::decoupled;
        bandTimes[k].attack = bl.attack * s.ttmTimes[k];
        bandTimes[k].release = bl.release * s.ttmTimes[k];
    }

    double lastKey = -120, lastLevel = -120, lastThreshold = glide.threshold;
    for (int i = 0; i < n; ++i)
    {
        glide.threshold += (s.curve.threshold - glide.threshold) * cGlide;
        glide.slope += (s.curve.slope - glide.slope) * cGlide;
        glide.loop += (s.loop - glide.loop) * cGlide;
        glide.knee += (s.curve.knee - glide.knee) * cGlide;
        glide.range += (s.curve.range - glide.range) * cGlide;
        glide.makeup += (s.makeup - glide.makeup) * cGlide;
        glide.mix += (s.mix - glide.mix) * cGlide;
        glide.drive += (s.charDrive - glide.drive) * cGlide;

        // The key's levels (dB): left, right, and the mid and side when it works on them.
        const double kl = key[0][i], kr = key[1][i];
        std::array<double, 4> level { -120, -120, -120, -120 };
        for (int ch = 0; ch < (msMode ? 4 : 2); ++ch)
        {
            const auto v = ch == 0 ? kl : ch == 1 ? kr : ch == 2 ? 0.5 * (kl + kr) : 0.5 * (kl - kr);
            auto& d = detect[(size_t) ch];
            d.ms += (v * v - d.ms) * cRms;
            if (d.ms < 1e-30)
                d.ms = 0;
            switch (s.detector)
            {
                case Detector::log:
                    // A sine's RMS reads its peak (the mean square doubled), so peak and RMS styles share a threshold.
                    level[(size_t) ch] = rho > 0 ? (1 - rho) * toDb (std::abs (v)) + rho * 10 * std::log10 (std::max (2 * d.ms, 1e-12)) : toDb (std::abs (v));
                    break;
                case Detector::linear:
                {
                    // Punch: an RC on the rectified key, before the curve: the attack lags, so the first milliseconds get through.
                    const auto r = (1 - rho) * std::abs (v) + rho * std::sqrt (2 * d.ms);
                    d.env += (r > d.env ? cAttackLinear : cReleaseLinear) * (r - d.env);
                    level[(size_t) ch] = toDb (d.env);
                    break;
                }
                case Detector::light:
                    // The LA-2A's panel lights straight from the audio (no rectifier and filter): its average, read as a sine's peak.
                    d.env += (std::abs (v) * juce::MathConstants<double>::halfPi - d.env) * cPanel;
                    level[(size_t) ch] = toDb (d.env);
                    break;
            }
        }
        const auto loudest = std::max (level[0], level[1]);
        auto crest = std::sqrt (2.0);
        if (bl.autoRelease)
        {
            auto& d = detect[0];
            const auto x2 = std::max (kl * kl, kr * kr);
            d.crestPeak = std::max (x2, d.crestPeak + (x2 - d.crestPeak) * cCrest);
            d.crestMs += (x2 - d.crestMs) * cCrest;
            crest = d.crestMs > 1e-20 ? std::max (1.0, std::sqrt (d.crestPeak / d.crestMs)) : std::sqrt (2.0);
        }

        // Auto Threshold: the threshold rides the key's long-term level (a take averaging -18 dBFS is as if it were off).
        auto threshold = glide.threshold;
        if (s.autoThreshold)
        {
            if (loudest > -60)
                autoLevel += (loudest - autoLevel) * (loudest > autoLevel ? cAutoUp : cAutoDown);
            threshold += autoLevel + 18;
        }

        Target target;
        target.curve = { s.curve.kind, threshold, glide.slope, glide.knee, glide.range };
        target.loop = glide.loop;
        target.feedback = s.feedback;

        double x0 = audio[0][i], x1 = audio[1][i];
        if (s.character != 0 && ! s.charPost)
        {
            x0 = character (s.character, x0, glide.drive, brightFilter[0]);
            x1 = character (s.character, x1, glide.drive, brightFilter[1]);
        }
        double y0 = 0, y1 = 0, shown = 0, most = 0;

        if (s.ttm)
        {
            // To The Max: three bands, each down above the threshold and up below its own lower one.
            std::array<double, 3> a0 {}, a1 {}, k0 {}, k1 {};
            splitters[0].split (x0, a0[0], a0[1], a0[2]);
            splitters[1].split (x1, a1[0], a1[1], a1[2]);
            splitters[2].split (kl, k0[0], k0[1], k0[2]);
            splitters[3].split (kr, k1[0], k1[1], k1[2]);
            for (size_t k = 0; k < 3; ++k)
            {
                bandMs[k] += (0.5 * (k0[k] * k0[k] + k1[k] * k1[k]) - bandMs[k]) * cRms;
                target.ttm = true;
                target.level = 10 * std::log10 (std::max (2 * bandMs[k], 1e-12));
                target.upThreshold = threshold - s.ttmUp[k];
                const auto g = follow (s, bandTimes[k], bandPaths[k], target, coreRate, crest);
                const auto gain = fromDb (glide.mix * (glide.makeup - g));
                y0 += a0[k] * gain;
                y1 += a1[k] * gain;
                if (std::abs (g) > std::abs (shown))
                    shown = g;
                most = std::max (most, g);
            }
            lastLevel = loudest;
        }
        else
        {
            const auto count = msMode ? 1 : 2;
            std::array<double, 2> levels {}, gr {};
            if (msMode)
            {
                const auto part = s.linkMode == LinkMode::mid || s.linkMode == LinkMode::midToSide ? level[2] : level[3];
                levels[0] = (1 - s.toward) * loudest + s.toward * part;
            }
            else
            {
                levels[0] = (1 - s.link) * level[0] + s.link * loudest;
                levels[1] = (1 - s.link) * level[1] + s.link * loudest;
            }
            for (int k = 0; k < count; ++k)
            {
                auto& p = paths[(size_t) k];
                target.level = levels[(size_t) k];
                target.average = p.average;
                auto g = follow (s, bl, p, target, coreRate, crest);
                if (s.curve.kind == CurveKind::vocal)
                    p.average += (g - p.average) * cAverage;
                if (s.gate)
                {
                    // Vox's gate: a downward expander under its threshold, opening fast and closing slowly, on
                    // the key's RMS (sample by sample a waveform would close it at every zero crossing).
                    const auto heard = 10 * std::log10 (std::max (2 * std::max (detect[0].ms, detect[1].ms), 1e-12));
                    const auto want = std::min (s.gateRange, kneeOver (s.gateThreshold - heard, 6) * (s.gateRatio - 1));
                    p.gate += (want - p.gate) * (want > p.gate ? cGateClose : cGateOpen);
                    g += p.gate;
                }
                if (look > 0)
                {
                    // Lookahead: the reduction held over the window, then two boxes, so it's all there when the peak plays.
                    const auto held = p.max.push (g, look + 1);
                    const auto first = p.box1.push (held, juce::jmax (1, lookFirst));
                    g = lookSecond > 0 ? p.box2.push (first, lookSecond) : first;
                }
                gr[(size_t) k] = g;
            }
            if (count == 1)
                gr[1] = gr[0];
            if (msMode)
            {
                auto m = 0.5 * (x0 + x1), sd = 0.5 * (x0 - x1);
                m *= fromDb (glide.mix * wM * (glide.makeup - gr[0]));
                sd *= fromDb (glide.mix * wS * (glide.makeup - gr[0]));
                y0 = m + sd, y1 = m - sd;
            }
            else
            {
                y0 = x0 * fromDb (glide.mix * (glide.makeup - gr[0]));
                y1 = x1 * fromDb (glide.mix * (glide.makeup - gr[1]));
            }
            shown = std::abs (gr[0]) >= std::abs (gr[1]) ? gr[0] : gr[1];
            most = std::max (gr[0], gr[1]);
            lastLevel = std::max (levels[0], count == 2 ? levels[1] : -120.0);
        }

        // Wet Gain's pan ring: the mid against the side.
        if (std::abs (s.wetPan) > 1e-9)
        {
            auto m = 0.5 * (y0 + y1), sd = 0.5 * (y0 - y1);
            m *= std::min (1.0, 1 - s.wetPan);
            sd *= std::min (1.0, 1 + s.wetPan);
            y0 = m + sd, y1 = m - sd;
        }

        // The style's colour: a shaper whose drive grows with the reduction (and its unit's input), a tilt.
        if (colour.kind != ColourKind::none)
        {
            const auto amount = colour.kind == ColourKind::diode ? colour.base + colour.perDb * std::exp (-std::pow ((most - colour.peak) / colour.width, 2.0))
                                                                 : colour.base + colour.perDb * std::max (0.0, most);
            const auto d = juce::jlimit (0.0, 0.5, amount);
            const auto drive = colour.drive;
            for (auto* y : { &y0, &y1 })
            {
                const auto z = *y * drive;
                switch (colour.kind)
                {
                    case ColourKind::even: *y = evenShape (z, d) / drive; break;
                    case ColourKind::odd:
                    case ColourKind::diode: *y = oddShape (z, d) / drive; break;
                    case ColourKind::tape: *y = (oddShape (z, d) + 0.3 * d * z * z) / drive; break;
                    case ColourKind::none: break;
                }
            }
        }
        if (std::abs (colour.tilt) > 1e-9)
        {
            const auto k = fromDb (colour.tilt * juce::jlimit (0.0, 1.0, most / 6)) - 1;
            y0 += k * tiltFilter[0].high (y0);
            y1 += k * tiltFilter[1].high (y1);
        }
        if (s.character != 0 && s.charPost)
        {
            y0 = character (s.character, y0, glide.drive, brightFilter[0]);
            y1 = character (s.character, y1, glide.drive, brightFilter[1]);
        }
        if (dcBlock)
        {
            y0 -= dcFilter[0].low (y0);
            y1 -= dcFilter[1].low (y1);
        }
        audio[0][i] = (float) y0;
        audio[1][i] = (float) y1;
        reduction[i] = (float) shown;
        lastKey = loudest;
        lastThreshold = threshold;
    }
    nowKey.store ((float) lastKey, std::memory_order_relaxed);
    nowLevel.store ((float) lastLevel, std::memory_order_relaxed);
    nowThreshold.store ((float) lastThreshold, std::memory_order_relaxed);
}

void State::process (const Settings& s, const gross::Clock& clock, const float* keyLeft, const float* keyRight, float* left, float* right, int numSamples, float mix)
{
    juce::ScopedNoDenormals noDenormals;
    if (numSamples <= 0 || numSamples > blockCapacity)
        return;
    if (stale || s.oversampling != factor)
        reset (s);
    if (const auto request = matchRequest.exchange (0); request > 0)
    {
        matchLeft = (juce::int64) (request / 1000.0 * rate);
        matchIn = matchOut = 0;
        matchCount = 0;
        matchState.store (1);
    }
    // Opto 2A's emphasis (R37): a high shelf on the key, made again when it's moved (no allocation).
    if (std::abs (s.emphasis - emphasisDesigned) > 1e-6)
    {
        eq::BandShape shape;
        shape.shape = eq::Shape::highShelf;
        shape.frequency = 4000;
        shape.gain = s.emphasis;
        shape.q = 0.7;
        shape.slope = 12;
        eq::Sections sections;
        eq::analogSections (shape, sections);
        emphasisFilter.count = sections.count;
        for (int k = 0; k < sections.count; ++k)
            emphasisFilter.svfs[(size_t) k] = eq::Svf::from (eq::matched (sections.list[(size_t) k], rate));
        emphasisDesigned = s.emphasis;
    }

    const auto delay = s.maxLookahead, look = s.lookahead, osLatency = oversamplingLatency (factor), total = delay + osLatency;
    latencyNow.store (total, std::memory_order_relaxed);
    const auto size = inputRing.getNumSamples(), keySize = keyRing.getNumSamples();
    const auto cBase = coefficient (glideSeconds, rate);
    const auto cLimAttack = coefficient (s.limAttack, rate), cLimRelease = coefficient (s.limRelease, rate);
    const auto fadeStep = 1.0 / (0.005 * rate);
    const auto mode = audition.load (std::memory_order_relaxed);
    float inMax[2] {}, outMax[2] {};

    for (int start = 0; start < numSamples; start += chunk)
    {
        const auto m = juce::jmin (chunk, numSamples - start);
        const auto chunkWrite = ringWrite;
        auto* audioL = chunkAudio.getWritePointer (0);
        auto* audioR = chunkAudio.getWritePointer (1);
        auto* keyL = chunkKey.getWritePointer (0);
        auto* keyR = chunkKey.getWritePointer (1);
        const auto ringAt = [&] (const juce::AudioBuffer<float>& ring, int ch, int pos, int back) { return ring.getSample (ch, ((pos - back) % size + size) % size); };

        for (int j = 0; j < m; ++j)
        {
            const auto i = start + j;
            for (int ch = 0; ch < 2; ++ch)
            {
                inGain[(size_t) ch] += (s.input[(size_t) ch] - inGain[(size_t) ch]) * cBase;
                outGain[(size_t) ch] += (s.output[(size_t) ch] - outGain[(size_t) ch]) * cBase;
                dryGain[(size_t) ch] += (s.dry[(size_t) ch] - dryGain[(size_t) ch]) * cBase;
            }
            keyLevel += (s.level - keyLevel) * cBase;
            rawRing.setSample (0, ringWrite, left[i]);
            rawRing.setSample (1, ringWrite, right[i]);
            inputRing.setSample (0, ringWrite, (float) (left[i] * inGain[0]));
            inputRing.setSample (1, ringWrite, (float) (right[i] * inGain[1]));
            audioL[j] = ringAt (inputRing, 0, ringWrite, delay);
            audioR[j] = ringAt (inputRing, 1, ringWrite, delay);

            // The key: what it listens to, lined up with the sound (`delay − look` behind, so it hears `look` ahead).
            double kl = 0, kr = 0;
            switch (s.source)
            {
                case Source::internal:
                    kl = ringAt (inputRing, 0, ringWrite, delay - look);
                    kr = ringAt (inputRing, 1, ringWrite, delay - look);
                    break;
                case Source::external:
                {
                    keyRing.setSample (0, keyWrite, keyLeft != nullptr ? keyLeft[i] : 0.0f);
                    keyRing.setSample (1, keyWrite, keyRight != nullptr ? keyRight[i] : 0.0f);
                    // (Its slot's key, already lined up with its sound: `Song::compensate`.)
                    const auto back = delay - look;
                    kl = keyRing.getSample (0, ((keyWrite - back) % keySize + keySize) % keySize);
                    kr = keyRing.getSample (1, ((keyWrite - back) % keySize + keySize) % keySize);
                    keyWrite = (keyWrite + 1) % keySize;
                    break;
                }
                case Source::sync:
                    if (clock.playing && clock.ppq > 0)
                    {
                        // Host Sync: a 0 dBFS pulse on the song's beat, `syncLength` of each period long.
                        const auto beat = (clock.tick + i * clock.ticksPerSample) / clock.ppq;
                        const auto phase = std::fmod (beat, s.syncBeats) / s.syncBeats;
                        kl = kr = phase < s.syncLength ? 1.0 : 0.0;
                    }
                    break;
            }
            kl *= keyLevel, kr *= keyLevel;
            int f = 0;
            for (const auto& filter : s.keyFilters)
            {
                if (filter.placement == 0)
                {
                    kl = runFilter (filter, kl, filterState[(size_t) f * 2].data());
                    kr = runFilter (filter, kr, filterState[(size_t) f * 2 + 1].data());
                }
                else
                {
                    auto mid = 0.5 * (kl + kr), sd = 0.5 * (kl - kr);
                    if (filter.placement == 1)
                        mid = runFilter (filter, mid, filterState[(size_t) f * 2].data());
                    else
                        sd = runFilter (filter, sd, filterState[(size_t) f * 2].data());
                    kl = mid + sd, kr = mid - sd;
                }
                if (++f * 2 + 1 >= (int) filterState.size())
                    break;
            }
            if (emphasisDesigned > 0.01)
            {
                kl = runFilter (emphasisFilter, kl, emphasisState[0].data());
                kr = runFilter (emphasisFilter, kr, emphasisState[1].data());
            }
            keyL[j] = (float) kl;
            keyR[j] = (float) kr;
            ringWrite = (ringWrite + 1) % size;
        }

        // The gain path, oversampled when it's asked to be.
        if (factor > 1)
        {
            auto& up = *audioUp[factor];
            auto& keyUpsampler = *keyUp[factor];
            juce::dsp::AudioBlock<float> audioBlock (chunkAudio);
            auto audioPart = audioBlock.getSubBlock (0, (size_t) m);
            juce::dsp::AudioBlock<float> keyBlock (chunkKey);
            auto keyPart = keyBlock.getSubBlock (0, (size_t) m);
            auto upAudio = up.processSamplesUp (audioPart);
            auto upKey = keyUpsampler.processSamplesUp (keyPart);
            float* a[2] { upAudio.getChannelPointer (0), upAudio.getChannelPointer (1) };
            const float* k[2] { upKey.getChannelPointer (0), upKey.getChannelPointer (1) };
            runCore (s, a, k, m * factor, rate * factor, chunkReduction.data());
            up.processSamplesDown (audioPart);
        }
        else
        {
            float* a[2] { audioL, audioR };
            const float* k[2] { keyL, keyR };
            runCore (s, a, k, m, rate, chunkReduction.data());
        }

        for (int j = 0; j < m; ++j)
        {
            const auto i = start + j;
            const auto pos = (chunkWrite + j) % size;
            double y[2] { audioL[j], audioR[j] };
            int f = 0;
            for (const auto& filter : s.postFilters)
            {
                for (int ch = 0; ch < 2; ++ch)
                    y[ch] = runFilter (filter, y[ch], postState[(size_t) (f * 2 + ch)].data());
                if (++f * 2 + 1 >= (int) postState.size())
                    break;
            }
            if (s.limiter)
            {
                // The ceiling (Vox's, instant) or Diode 609's limiter (2 ms): what's over it, held down, let go slowly.
                const auto over = juce::jmax (0.0, toDb (juce::jmax (std::abs (y[0]), std::abs (y[1]))) - s.limThreshold);
                limGain = over > limGain ? (s.limAttack <= 0 ? over : limGain + (over - limGain) * cLimAttack) : limGain + (over - limGain) * cLimRelease;
                const auto g = fromDb (-limGain);
                const auto ceiling = fromDb (s.limThreshold);
                for (auto& v : y)
                {
                    v *= g;
                    if (s.limAttack <= 0)
                        v = juce::jlimit (-ceiling, ceiling, v);
                }
            }
            const double x[2] { ringAt (inputRing, 0, pos, total), ringAt (inputRing, 1, pos, total) };
            if (mode == 1)
                y[0] = keyL[j], y[1] = keyR[j];
            else if (mode == 2)
            {
                const auto made = fromDb (glide.mix * glide.makeup);
                y[0] = x[0] - y[0] / made, y[1] = x[1] - y[1] / made;
            }
            fadeIn = juce::jmin (1.0, fadeIn + fadeStep);
            for (int ch = 0; ch < 2; ++ch)
            {
                y[ch] = (y[ch] + x[ch] * dryGain[(size_t) ch]) * outGain[(size_t) ch] * fadeIn;
                inMax[ch] = juce::jmax (inMax[ch], (float) std::abs (x[ch]));
                outMax[ch] = juce::jmax (outMax[ch], (float) std::abs (y[ch]));
            }

            // What it measured: the display's slice, and Match's loudness.
            sliceIn = juce::jmax (sliceIn, (float) juce::jmax (std::abs (x[0]), std::abs (x[1])));
            sliceOut = juce::jmax (sliceOut, (float) juce::jmax (std::abs (y[0]), std::abs (y[1])));
            for (int k = 0; k < factor; ++k)
            {
                const auto r = chunkReduction[(size_t) (j * factor + k)];
                if (std::abs (r) > std::abs (sliceGr))
                    sliceGr = r;
            }
            if (++sliceCount >= slice)
            {
                const auto w = pointsWritten.load (std::memory_order_relaxed);
                points[(size_t) (w % ringSize)] = { (float) toDb (sliceIn), (float) toDb (sliceOut), sliceGr };
                pointsWritten.store (w + 1, std::memory_order_release);
                nowReduction.store (sliceGr, std::memory_order_relaxed);
                sliceIn = sliceOut = sliceGr = 0;
                sliceCount = 0;
            }
            if (matchState.load (std::memory_order_relaxed) == 1)
            {
                matchIn += 0.5 * (x[0] * x[0] + x[1] * x[1]);
                matchOut += 0.5 * (y[0] * y[0] + y[1] * y[1]);
                ++matchCount;
                if (--matchLeft <= 0)
                {
                    matchInDb.store ((float) (10 * std::log10 (std::max (matchIn / (double) matchCount, 1e-12))));
                    matchOutDb.store ((float) (10 * std::log10 (std::max (matchOut / (double) matchCount, 1e-12))));
                    matchState.store (2);
                }
            }

            // The slot's mix, against what came in held back by the latency.
            if (mix < 1.0f)
                for (int ch = 0; ch < 2; ++ch)
                    y[ch] = mix * y[ch] + (1.0f - mix) * ringAt (rawRing, ch, pos, total);
            left[i] = (float) y[0];
            right[i] = (float) y[1];
        }
    }

    const auto fall = (float) std::exp (-numSamples / (0.25 * rate));
    for (size_t ch = 0; ch < 2; ++ch)
    {
        inPeak[ch].store (juce::jmax (inMax[ch], inPeak[ch].load (std::memory_order_relaxed) * fall), std::memory_order_relaxed);
        outPeak[ch].store (juce::jmax (outMax[ch], outPeak[ch].load (std::memory_order_relaxed) * fall), std::memory_order_relaxed);
    }
}

juce::var State::describe (bool drain)
{
    const auto written = pointsWritten.load (std::memory_order_acquire);
    juce::Array<juce::var> list;
    if (drain)
    {
        // Never more than the ring holds (a slow reader loses the oldest).
        auto from = juce::jmax (pointsRead, written - ringSize + 1);
        for (auto w = from; w < written; ++w)
        {
            const auto& p = points[(size_t) (w % ringSize)];
            list.add (juce::Array<juce::var> { p.in, p.out, p.gr });
        }
        pointsRead = written;
    }
    auto* object = new juce::DynamicObject();
    object->setProperty ("step", slice / rate);
    object->setProperty ("points", list);
    object->setProperty ("reduction", nowReduction.load());
    object->setProperty ("key", nowKey.load());
    object->setProperty ("level", nowLevel.load());
    object->setProperty ("threshold", nowThreshold.load());
    object->setProperty ("input", juce::Array<juce::var> { inPeak[0].load(), inPeak[1].load() });
    object->setProperty ("output", juce::Array<juce::var> { outPeak[0].load(), outPeak[1].load() });
    object->setProperty ("latency", latencyNow.load());
    if (const auto state = matchState.load(); state != 0)
    {
        auto* match = new juce::DynamicObject();
        match->setProperty ("input", matchInDb.load());
        match->setProperty ("output", matchOutDb.load());
        match->setProperty ("done", state == 2);
        object->setProperty ("match", juce::var (match));
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
} // namespace comp
