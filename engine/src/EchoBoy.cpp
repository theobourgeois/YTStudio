#include "EchoBoy.h"

#include <cmath>

namespace echo
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

/** A new time in Time mode glides there like tape (this time constant), never faster than this many samples a sample. */
constexpr double glideSeconds = 0.2;
constexpr double maxGlide = 0.75;
/** A new note value crossfades (equal power) over this long. */
constexpr double fadeSeconds = 0.04;
/** Gains glide to the song's over this long: a knob turned doesn't click. */
constexpr double gainSeconds = 0.005;
/** A Rhythm tap moved glides there over this long. */
constexpr double tapSeconds = 0.05;
/** How far the wobble may reach (seconds): deep and slow wobbles are held to it. */
constexpr double maxWobble = 0.25;
/** The output's wobble reads this far back at least (seconds), so it can swing either way. */
constexpr double wobbleBase = 0.002;
/** The diffusers' lengths (ms) at a Size of 10, and their gains at full Amount: Dattorro's input diffusers. */
constexpr std::array<double, 4> diffuserMs { 4.77, 3.60, 12.73, 9.31 };
constexpr std::array<float, 4> diffuserGain { 0.75f, 0.75f, 0.625f, 0.625f };
/** Each line's and side's diffusers a little longer than the last, so they don't ring together. */
constexpr double diffuserSpread = 0.07;
/** The wobble's Sync turned left: each path's rate this much faster or slower at the end of the knob. */
constexpr std::array<double, 4> syncRates { 1.0, 1.13, 0.89, 1.07 };

/** The diffusion's lengths (samples) for a line or side `k` at `size` (0..50). */
int diffuserLength (double rate, double size, int stage, int k) { return juce::jmax (1, (int) std::lround (diffuserMs[(size_t) stage] * size / 10.0 * (1 + diffuserSpread * k) * rate / 1000)); }
} // namespace

std::shared_ptr<Settings> Settings::parse (const juce::var& json, int capacity)
{
    auto s = std::make_shared<Settings>();
    s->dryBuffer.setSize (2, juce::jmax (1, capacity));
    if (const auto* list = json["lines"].getArray())
        for (const auto& item : *list)
        {
            if (s->lines >= maxLines)
                break;
            auto& line = s->line[(size_t) s->lines++];
            line.delay = number (item["delay"], 0.25, 0, maxSeconds - maxWobble);
            line.glide = (bool) item["glide"];
            for (int c = 0; c < 2; ++c)
            {
                line.input[(size_t) c] = (float) number (item["input"][c], 0, -4, 4);
                line.out[(size_t) c] = (float) number (item["out"][c], 0, -4, 4);
            }
            line.group = (int) number (item["group"], 0, 0, 1);
        }
    const auto n = s->lines;
    for (int i = 0; i < n * n; ++i)
    {
        s->feedback[(size_t) i] = (float) number (json["feedback"][i], 0, -4, 4);
        s->fixed[(size_t) i] = (float) number (json["fixed"][i], 0, -4, 4);
    }
    s->amount = (float) number (json["amount"], 0, 0, 2);
    if (const auto* list = json["taps"].getArray())
        for (const auto& item : *list)
        {
            if (s->taps >= maxTaps)
                break;
            auto& tap = s->tap[(size_t) s->taps++];
            tap.delay = number (item["delay"], 0, 0, maxSeconds - maxWobble);
            tap.offset = number (item["offset"], 0, 0, 0.1);
            tap.left = (float) number (item["left"], 0, 0, 4);
            tap.right = (float) number (item["right"], 0, 0, 4);
            tap.one = (bool) item["one"];
        }
    s->feel = number (json["feel"], 0, -0.1, 0.1);
    s->dry = (float) number (json["dry"], 1, 0, 4);
    s->wet = (float) number (json["wet"], 1, 0, 4);
    s->input = (float) number (json["input"], 1, 0, 64);
    s->output = (float) number (json["output"], 1, 0, 64);
    s->side = (float) number (json["side"], 1, 0, 4);
    s->lowCut = number (json["lowCut"], 0, 0, 20000);
    s->highCut = number (json["highCut"], 0, 0, 30000);
    const auto eq = json["eq"];
    s->lowFreq = number (eq["low"][0], 20, 10, 20000), s->lowGain = number (eq["low"][1], 0, -60, 30), s->lowDecay = number (eq["low"][2], 0, -12, 12);
    s->midFreq = number (eq["mid"][0], 1000, 10, 20000), s->midQ = number (eq["mid"][1], 0.7, 0.1, 20), s->midGain = number (eq["mid"][2], 0, -60, 30), s->midDecay = number (eq["mid"][3], 0, -12, 12);
    s->highFreq = number (eq["high"][0], 12000, 10, 20000), s->highGain = number (eq["high"][1], 0, -60, 30), s->highDecay = number (eq["high"][2], 0, -12, 12);
    const auto diffusion = json["diffusion"];
    s->diffusionAmount = number (diffusion["amount"], 0, 0, 1);
    s->diffusionSize = number (diffusion["size"], 10, 0, 50);
    s->diffusionLoop = ! diffusion.hasProperty ("loop") || (bool) diffusion["loop"];
    const auto wobble = json["wobble"];
    s->wobbleDepth = number (wobble["depth"], 0, 0, 1200);
    s->wobbleRate = number (wobble["rate"], 0.5, 0.01, 50);
    s->wobbleSync = number (wobble["sync"], 0, -1, 1);
    s->wobbleShape = (Shape) (int) number (wobble["shape"], 3, 0, 4);
    s->wobbleFeedback = ! wobble.hasProperty ("feedback") || (bool) wobble["feedback"];
    s->wobbleOut = (bool) wobble["out"];
    const auto saturation = json["saturation"];
    s->saturation = (Saturation) (int) number (saturation["type"], 0, 0, 8);
    s->decaySat = number (saturation["decay"], 0, -48, 48);
    s->outSat = number (saturation["out"], 0, -48, 48);
    return s;
}

void Settings::set (Control control, const float* v, int size)
{
    switch (control)
    {
        case Control::mix: dry = v[0], wet = size > 1 ? v[1] : wet; break;
        case Control::feedback: amount = juce::jlimit (0.0f, 2.0f, v[0]); break;
        case Control::delays:
            for (int k = 0; k < juce::jmin (size, lines); ++k)
                line[(size_t) k].delay = juce::jlimit (0.0, maxSeconds - maxWobble, (double) v[k]);
            break;
        case Control::lowCut: lowCut = juce::jmax (0.0f, v[0]); break;
        case Control::highCut: highCut = juce::jmax (0.0f, v[0]); break;
        case Control::saturation: decaySat = v[0], outSat = size > 1 ? v[1] : outSat; break;
        case Control::input: input = juce::jmax (0.0f, v[0]); break;
        case Control::output: output = juce::jmax (0.0f, v[0]); break;
        case Control::feel: feel = juce::jlimit (-0.1, 0.1, (double) v[0]); break;
        case Control::side: side = juce::jmax (0.0f, v[0]); break;
    }
}

void Settings::get (Control control, float* v, int& size) const
{
    size = 1;
    switch (control)
    {
        case Control::mix: v[0] = dry, v[1] = wet, size = 2; break;
        case Control::feedback: v[0] = amount; break;
        case Control::delays:
            size = juce::jmax (1, lines);
            for (int k = 0; k < lines; ++k)
                v[k] = (float) line[(size_t) k].delay;
            break;
        case Control::lowCut: v[0] = (float) lowCut; break;
        case Control::highCut: v[0] = (float) highCut; break;
        case Control::saturation: v[0] = (float) decaySat, v[1] = (float) outSat, size = 2; break;
        case Control::input: v[0] = input; break;
        case Control::output: v[0] = output; break;
        case Control::feel: v[0] = (float) feel; break;
        case Control::side: v[0] = side; break;
    }
}

State::State (double sampleRate) : rate (sampleRate)
{
    const auto diffuserCapacity = diffuserLength (rate, 50, 2, maxLines + 1) + 2;
    for (auto& line : lines)
    {
        line.buffer.allocate ((int) std::ceil (maxSeconds * rate));
        line.saturator.prepare (rate);
        for (auto& d : line.diffusers)
            d.allocate (diffuserCapacity);
    }
    for (int c = 0; c < 2; ++c)
    {
        outSaturator[(size_t) c].prepare (rate);
        for (auto& d : post[(size_t) c])
            d.allocate (diffuserCapacity);
        wobbleLine[(size_t) c].allocate ((int) std::ceil ((maxWobble + wobbleBase) * 2 * rate));
    }
    // The left's and right's LFOs start alike: at Sync's centre they're one.
    lfos[0].seed = lfos[1].seed = 0x9e3779b9u;
    lfos[2].seed = lfos[3].seed = 0x7f4a7c15u;
    designed.fill (-1);
}

void State::clear()
{
    for (auto& line : lines)
    {
        line.buffer.clear();
        line.current = line.target = -1;
        line.fadeLeft = 0;
        line.lowDecay.reset(), line.midDecay.reset(), line.highDecay.reset(), line.cutLow.reset(), line.cutHigh.reset();
        line.saturator.reset();
        for (auto& d : line.diffusers)
            d.clear();
        line.dc.y = 0;
        line.loop = line.heard = 0;
    }
    for (int c = 0; c < 2; ++c)
    {
        gainLow[(size_t) c].reset(), gainMid[(size_t) c].reset(), gainHigh[(size_t) c].reset();
        outSaturator[(size_t) c].reset();
        for (auto& d : post[(size_t) c])
            d.clear();
        wobbleLine[(size_t) c].clear();
    }
    started = false;
}

void State::design (const Settings& s)
{
    const std::array<double, 13> now { rate, s.lowCut, s.highCut, s.lowFreq, s.lowGain, s.lowDecay, s.midFreq, s.midQ, s.midGain, s.midDecay, s.highFreq, s.highGain, s.highDecay };
    if (now == designed)
        return;
    designed = now;
    for (auto& line : lines)
    {
        line.lowDecay.shelf (false, rate, s.lowFreq, s.lowDecay);
        line.midDecay.peak (rate, s.midFreq, s.midQ, s.midDecay);
        line.highDecay.shelf (true, rate, s.highFreq, s.highDecay);
        if (s.lowCut > 0)
            line.cutLow.highpass (rate, s.lowCut, 0.707);
        else
            line.cutLow.identity();
        if (s.highCut > 0)
            line.cutHigh.lowpass (rate, s.highCut, 0.707);
        else
            line.cutHigh.identity();
    }
    for (int c = 0; c < 2; ++c)
    {
        gainLow[(size_t) c].shelf (false, rate, s.lowFreq, s.lowGain);
        gainMid[(size_t) c].peak (rate, s.midFreq, s.midQ, s.midGain);
        gainHigh[(size_t) c].shelf (true, rate, s.highFreq, s.highGain);
    }
}

float State::readLine (const LineState& line, double offset) const
{
    const auto now = line.buffer.read (juce::jmax (0.0, line.current + offset));
    if (line.fadeLeft <= 0)
        return now;
    const auto x = (float) (1.0 - (double) line.fadeLeft / (fadeSeconds * rate)) * juce::MathConstants<float>::halfPi;
    return line.buffer.read (juce::jmax (0.0, line.fadeFrom + offset)) * std::cos (x) + now * std::sin (x);
}

void State::process (const Settings& s, float* left, float* right, int numSamples)
{
    juce::ScopedNoDenormals noDenormals;
    if (wasSkipped)
    {
        clear();
        wasSkipped = false;
    }
    design (s);
    const auto n = s.lines;
    const auto fadeLength = (int) std::lround (fadeSeconds * rate);

    // The diffusion: in the loop each line is that much shorter (an all-pass's echo is centred on its
    // length), so the repeats stay on time; after it, every echo is read that much earlier.
    const auto diffusing = s.diffusionAmount > 0.001;
    std::array<std::array<int, 4>, maxLines + 2> diffusers {};
    std::array<int, maxLines + 2> diffusion {};
    for (int k = 0; k < maxLines + 2; ++k)
        for (int stage = 0; stage < 4; ++stage)
            diffusion[(size_t) k] += diffusers[(size_t) k][(size_t) stage] = diffuserLength (rate, s.diffusionSize, stage, k);

    // The wobble: a sine `depth` cents deep at `rate` Hz moves a line's read this many samples each way.
    const auto reach = juce::jmin (maxWobble, (std::pow (2.0, s.wobbleDepth / 1200) - 1) / (2 * pi * s.wobbleRate)) * rate;
    const auto wobbling = s.wobbleDepth > 0.01 && reach > 0.001;
    const auto outBase = s.wobbleOut && wobbling ? reach + wobbleBase * rate : 0.0;
    // How much later than the lines the wet sound comes out (post diffusion, the output's wobble): read that much earlier.
    const auto wetLate = (diffusing && ! s.diffusionLoop ? (double) diffusion[maxLines] : 0.0) + outBase;

    for (int k = 0; k < n; ++k)
    {
        auto& line = lines[(size_t) k];
        auto target = s.line[(size_t) k].delay * rate;
        if (diffusing && s.diffusionLoop && target > diffusion[(size_t) k] + 2)
            target -= diffusion[(size_t) k];
        target = juce::jmax (1.0, target);
        if (line.current < 0)
            line.current = target;
        else if (! s.line[(size_t) k].glide && std::abs (target - line.target) > 0.5 && std::abs (target - line.current) > 0.5)
        {
            // A new note value: crossfade from where it was.
            line.fadeFrom = line.current;
            line.current = target;
            line.fadeLeft = fadeLength;
        }
        line.target = target;
    }
    if (! started)
    {
        dry = s.dry, wet = s.wet, input = s.input, output = s.output, side = s.side, amount = s.amount;
        for (int t = 0; t < s.taps; ++t)
            tapDelay[(size_t) t] = s.tap[(size_t) t].delay * rate;
        started = true;
    }

    const auto gainStep = OnePole::coefficient (rate, gainSeconds);
    const auto glideStep = OnePole::coefficient (rate, glideSeconds);
    const auto tapStep = OnePole::coefficient (rate, tapSeconds);
    // What comes round again loses its DC (below about 1.5 Hz): a boosted low shelf mustn't pile it up.
    const auto dcStep = OnePole::coefficient (rate, 1 / (2 * pi * 1.5));
    const auto decayDrive = (float) std::pow (10.0, s.decaySat / 20), outDrive = (float) std::pow (10.0, s.outSat / 20);
    const auto feel = s.feel * rate;
    const auto syncRight = s.wobbleSync > 0 ? s.wobbleSync * 0.5 : 0.0;
    const auto rateOf = [&] (int lfo) { return s.wobbleRate * (s.wobbleSync < 0 ? std::pow (syncRates[(size_t) lfo], -s.wobbleSync) : 1.0); };
    float inMax[2] {}, outMax[2] {};

    for (int i = 0; i < numSamples; ++i)
    {
        dry += (s.dry - dry) * gainStep, wet += (s.wet - wet) * gainStep, input += (s.input - input) * gainStep;
        output += (s.output - output) * gainStep, side += (s.side - side) * gainStep, amount += (s.amount - amount) * gainStep;
        const float in[2] { left[i] * input, right[i] * input };
        inMax[0] = juce::jmax (inMax[0], std::abs (in[0])), inMax[1] = juce::jmax (inMax[1], std::abs (in[1]));

        // The wobble's LFOs: at Sync's centre one for all; left of it each at its own rate; right of it the right's a phase behind.
        std::array<double, 4> wobble {};
        if (wobbling)
        {
            const auto together = std::abs (s.wobbleSync) < 0.001;
            for (int l = 0; l < 4; ++l)
            {
                if ((l == 1 || l == 3) && together)
                {
                    wobble[(size_t) l] = wobble[(size_t) l - 1];
                    continue;
                }
                wobble[(size_t) l] = lfos[(size_t) l].next (s.wobbleShape, rateOf (l), rate, (l == 1 || l == 3) ? syncRight : 0.0) * reach;
            }
        }

        // Read every line (round the loop, and as heard: Feel's shift, the wet path's lateness made up).
        for (int k = 0; k < n; ++k)
        {
            auto& line = lines[(size_t) k];
            if (s.line[(size_t) k].glide)
                line.current += juce::jlimit (-maxGlide, maxGlide, (line.target - line.current) * glideStep);
            const auto mod = s.wobbleFeedback ? wobble[(size_t) s.line[(size_t) k].group] : 0.0;
            line.loop = readLine (line, mod - 1);
            line.heard = std::abs (feel - wetLate) < 1e-9 ? line.loop : readLine (line, mod - 1 + feel - wetLate);
            if (line.fadeLeft > 0)
                --line.fadeLeft;
        }

        // Write every line: what it takes from the input, and its feedback coloured again on its way round.
        float fedBack0 = 0;
        for (int k = 0; k < n; ++k)
        {
            auto& line = lines[(size_t) k];
            float fed = 0;
            for (int j = 0; j < n; ++j)
                fed += (s.fixed[(size_t) (k * n + j)] + amount * s.feedback[(size_t) (k * n + j)]) * lines[(size_t) j].loop;
            fed = line.highDecay.process (line.midDecay.process (line.lowDecay.process (fed)));
            fed -= line.dc.process (fed, dcStep);
            if (diffusing && s.diffusionLoop)
                for (int stage = 0; stage < 4; ++stage)
                    fed = line.diffusers[(size_t) stage].process (fed, diffusers[(size_t) k][(size_t) stage], diffuserGain[(size_t) stage] * (float) s.diffusionAmount);
            if (k == 0)
                fedBack0 = fed;
            const auto& to = s.line[(size_t) k];
            auto record = to.input[0] * in[0] + to.input[1] * in[1] + fed;
            record = line.saturator.process (record, s.saturation, decayDrive);
            record = safety (line.cutHigh.process (line.cutLow.process (record)));
            line.buffer.push (std::isfinite (record) ? record : 0.0f);
        }

        float out[2] {};
        for (int k = 0; k < n; ++k)
        {
            out[0] += s.line[(size_t) k].out[0] * lines[(size_t) k].heard;
            out[1] += s.line[(size_t) k].out[1] * lines[(size_t) k].heard;
        }
        // Rhythm Echo's taps read line 0 (the "One" hears only what comes round again).
        if (s.taps > 0 && n > 0)
        {
            const auto& line = lines[0];
            const auto mod = s.wobbleFeedback ? wobble[0] : 0.0;
            for (int t = 0; t < s.taps; ++t)
            {
                const auto& tap = s.tap[(size_t) t];
                auto& delay = tapDelay[(size_t) t];
                delay += (tap.delay * rate - delay) * tapStep;
                if (tap.one)
                {
                    out[0] += tap.left * fedBack0, out[1] += tap.right * fedBack0;
                    continue;
                }
                // The line was just written: one sample further back is `delay` samples ago.
                const auto back = delay + mod + feel - wetLate;
                const auto l = line.buffer.read (juce::jmax (0.0, back));
                out[0] += tap.left * l;
                out[1] += tap.right * (tap.offset > 0 ? line.buffer.read (juce::jmax (0.0, back + tap.offset * rate)) : l);
            }
        }

        // The wet sound coloured once: the Gain EQ, Out Sat, diffusion after the loop, the output's wobble.
        for (int c = 0; c < 2; ++c)
        {
            auto w = gainHigh[(size_t) c].process (gainMid[(size_t) c].process (gainLow[(size_t) c].process (out[c])));
            w = outSaturator[(size_t) c].process (w, s.saturation, outDrive);
            if (diffusing && ! s.diffusionLoop)
                for (int stage = 0; stage < 4; ++stage)
                    w = post[(size_t) c][(size_t) stage].process (w, diffusers[(size_t) (maxLines + c)][(size_t) stage], diffuserGain[(size_t) stage] * (float) s.diffusionAmount);
            if (outBase > 0)
            {
                wobbleLine[(size_t) c].push (w);
                w = wobbleLine[(size_t) c].read (outBase + wobble[(size_t) (2 + c)]);
            }
            out[c] = w;
        }
        // Width: the wet sound's sides, scaled.
        const auto mid = 0.5f * (out[0] + out[1]), sides = 0.5f * (out[0] - out[1]) * side;
        out[0] = (mid + sides) * output, out[1] = (mid - sides) * output;
        outMax[0] = juce::jmax (outMax[0], std::abs (out[0])), outMax[1] = juce::jmax (outMax[1], std::abs (out[1]));
        left[i] = dry * left[i] + wet * out[0];
        right[i] = dry * right[i] + wet * out[1];
    }

    // The LEDs' levels: the block's peak, or what was before it falling.
    const auto fall = (float) std::exp (-numSamples / (0.25 * rate));
    for (int c = 0; c < 2; ++c)
    {
        inPeak[c].store (juce::jmax (inMax[c], inPeak[c].load (std::memory_order_relaxed) * fall), std::memory_order_relaxed);
        outPeak[c].store (juce::jmax (outMax[c], outPeak[c].load (std::memory_order_relaxed) * fall), std::memory_order_relaxed);
    }
}

juce::var State::describe() const
{
    auto* object = new juce::DynamicObject();
    object->setProperty ("input", juce::Array<juce::var> { inPeak[0].load(), inPeak[1].load() });
    object->setProperty ("output", juce::Array<juce::var> { outPeak[0].load(), outPeak[1].load() });
    return juce::var (object);
}

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
} // namespace echo
