#include "Reverb.h"

#include <cmath>

// A Reverb's state: its networks, early energy and blocks, run per block (its settings: ReverbSettings.cpp).

namespace verb
{

namespace
{
/** The input's ring: the longest pre-delay (1 s) and the furthest early tap (120 ms at Size 100%, ×2.5), with room. */
constexpr double ringSeconds = 1.4;
/** What values glide over when the song (or a lane) changes them. */
constexpr double glideSeconds = 0.005;
/** A network quieter than this (peak) is let go (its tail is done). */
constexpr float quietPeak = 3e-5f;
/** The networks run in slices this long (Auto-Decay's factor, a spillover's fade). */
constexpr int slice = 32;
} // namespace

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
    feed.prepare (rate);
    deEsser.prepare (rate);
    ducker.prepare (rate);
    glide = 1.0 - std::exp (-1.0 / (glideSeconds * rate));
    spillFadeLength = juce::jmax (1, (int) (0.03 * rate));
    toneFadeLength = juce::jmax (1, (int) (0.02 * rate));
    handoverLength = juce::jmax (1, (int) (0.02 * rate));
    predelayFadeLength = juce::jmax (1, (int) (0.03 * rate));
    // Scratch: dry ×2, early heard ×2, late in ×2, late out ×2, duck gain.
    scratch.setSize (11, blockCapacity);
    lineScratch.setSize (maxLines, blockCapacity);
    spillScratch.setSize (maxLines, blockCapacity);
    levels.reserve (eq::SpectrumGrid::points);
}

void State::reset (const Settings& s)
{
    for (auto& n : networks)
        n.clear();
    networks[0].configure (s.topology, s.scale, s.designs, s.allpassDesigns);
    networks[1].clear();
    active = 0;
    spillFade = 0, handover = 0;
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
    feed.reset();
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
    toneFade = 0, toneDesigned = -1;
    for (auto* group : { &vlfHeard, &lowShelf, &highShelf })
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
        handover = net.configured() ? handoverLength : 0;
        spillLevel = lateLevel * level;
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
        handover = handoverLength;
        spillLevel = lateLevel * level;
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
        // In and out together −3 dB at the band limit: each 8th-order Butterworth −1.5 dB there, its
        // corner a little above it, worked out where the filter is designed (warped: near Nyquist,
        // a ratio in hertz isn't one in the bilinear's frequencies).
        const auto limit = s.bandLimit > 0 && s.bandLimit < 0.45 * rate
                          ? rate / juce::MathConstants<double>::pi * std::atan (std::tan (juce::MathConstants<double>::pi * s.bandLimit / rate) * 1.0570)
                          : 0.0;
        limitIn[(size_t) c].set (limit, rate);
        limitOut[(size_t) c].set (limit, rate);
        aperture[(size_t) c].shelf (true, rate, 5000, s.aperture ? 2.0 : 0.0);
        preEmphasis[(size_t) c].shelf (true, rate, 3000, s.emphasis ? 6.0 : 0.0);
        deEmphasis[(size_t) c].shelf (true, rate, 3000, s.emphasis ? -6.0 : 0.0);
    }
    if (s.toneLock && (toneDesigned != s.designed || toneSerial != s.serial) && toneFade == 0)
    {
        // A new design starts from the old one's memory and fades in over 20 ms (not the first). One
        // waits for the last fade to finish: an old one dropped halfway would click.
        const auto same = toneDesigned >= 0 && std::memcmp (&toneDesign, &s.tone, sizeof (EqDesign)) == 0;
        if (! same)
        {
            if (toneDesigned >= 0)
                toneOld = tone, toneFade = toneFadeLength;
            toneDesign = s.tone;
            for (auto& f : tone)
                f.realise (s.tone, eq, 1);
        }
        toneDesigned = s.designed, toneSerial = s.serial;
    }
    sideLow.set (150, 0.70710678, rate);
    if (s.monoBelow >= 20)
        sideMono.set (s.monoBelow, 0.70710678, rate);
    if (early.needsLayout (net.scale(), s.density))
        early.layout (s.earlyLeft, s.earlyRight, net.scale(), s.density, rate);
    const auto lineCount = juce::jmin (maxLines, s.topology.lines);
    const auto feeding = ! s.earlyLines.empty() && (int) s.earlyLines.size() == lineCount;
    if (feeding && feed.needsLayout (net.scale(), s.density, lineCount))
    {
        std::array<float, LineFeed::maxLines> gains {};
        for (int j = 0; j < lineCount; ++j)
            gains[(size_t) j] = std::abs (s.topology.line[(size_t) j].inLeft) + std::abs (s.topology.line[(size_t) j].inRight);
        feed.layout (s.earlyLines, gains, net.scale(), s.density, rate);
    }

    auto* dryL = scratch.getWritePointer (0);
    auto* dryR = scratch.getWritePointer (1);
    auto* earlyL = scratch.getWritePointer (2);
    auto* earlyR = scratch.getWritePointer (3);
    auto* lateInL = scratch.getWritePointer (4);
    auto* lateInR = scratch.getWritePointer (5);
    auto* lateL = scratch.getWritePointer (6);
    auto* lateR = scratch.getWritePointer (7);
    auto* duckGain = scratch.getWritePointer (8);
    auto* spillInL = scratch.getWritePointer (9);
    auto* spillInR = scratch.getWritePointer (10);

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
        // Into the late network: each line its own velvet feed (Early Send), or the input itself.
        lateInL[i] = (float) preL;
        lateInR[i] = (float) preR;
        if (feeding)
        {
            const auto crossIn = 0.5 * s.inputCross;
            auto xl = preL, xr = preR;
            if (s.mono)
                xl = xr = 0.5 * (preL + preR);
            else
                xl = (1 - crossIn) * preL + crossIn * preR, xr = (1 - crossIn) * preR + crossIn * preL;
            for (int j = 0; j < lineCount; ++j)
            {
                const auto& line = s.topology.line[(size_t) j];
                // Its side: the lines the left feeds read the left (mixed by Input Cross), the others the right.
                const auto leftSide = std::abs (line.inLeft) >= std::abs (line.inRight);
                const auto feedAt = [&] (juce::int64 base) {
                    if (s.mono)
                        return feed.tap (j, base, readMono);
                    const auto fromLeft = feed.tap (j, base, readLeft);
                    const auto fromRight = crossIn > 0 || ! leftSide ? feed.tap (j, base, readRight) : 0.0;
                    const auto own = leftSide ? fromLeft : fromRight, opposite = leftSide ? fromRight : fromLeft;
                    return (1 - crossIn) * own + crossIn * opposite;
                };
                // The pre-delay's crossfade, as the early taps have it.
                auto v = feedAt (now);
                if (fade > 0)
                    v = v * (1 - fade) + feedAt (from) * fade;
                const auto direct = line.inLeft * xl + line.inRight * xr;
                lineScratch.getWritePointer (j)[i] = (float) ((1 - s.earlySend) * direct + s.earlySend * v);
            }
            feed.step();
        }

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
    // A new network (Size jumped, another mode) takes the input over in 20 ms, the old one letting go of
    // it as long: a sustained note cut off or started mid-wave would click in both.
    // The old one keeps the feeds it had (the same lines: Size), so what it hears doesn't change its kind.
    const auto handing = handover > 0;
    const auto spillFeeds = handing && feeding && networks[(size_t) (1 - active)].lineTotal() == lineCount;
    if (handing)
        for (int i = 0; i < numSamples; ++i)
        {
            const auto t = handover > 0 ? (float) handover-- / (float) handoverLength : 0.0f;
            spillInL[i] = lateInL[i] * t, spillInR[i] = lateInR[i] * t;
            lateInL[i] *= 1 - t, lateInR[i] *= 1 - t;
            if (feeding)
                for (int j = 0; j < lineCount; ++j)
                {
                    auto& x = lineScratch.getWritePointer (j)[i];
                    if (spillFeeds)
                        spillScratch.getWritePointer (j)[i] = x * t;
                    x *= 1 - t;
                }
        }
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
        bool sounding = false;
        for (int i = start; i < start + length && ! sounding; ++i)
            sounding = lateInL[i] != 0.0f || lateInR[i] != 0.0f;
        if (sounding)
            a.idle = false;
        if (! a.idle)
        {
            std::array<const float*, maxLines> lines {};
            for (int j = 0; j < lineCount; ++j)
                lines[(size_t) j] = lineScratch.getReadPointer (j) + start;
            a.process (p, lateInL + start, lateInR + start, lateL + start, lateR + start, length, (float) lateLevel, feeding ? lines.data() : nullptr);
        }
        auto& b = networks[(size_t) (1 - active)];
        if (b.configured() && ! b.idle)
        {
            // The spillover: the old network without input, its own decay.
            auto q = p;
            q.scale = b.scale();
            q.absorb = infinite ? 0.0 : (1 - freezeAmount);
            // At the level it was playing at (the new settings' output level taken back off).
            auto gain = (float) (spillLevel / juce::jmax (1e-6, level));
            if (spillFade > 0)
            {
                gain *= (float) spillFade / (float) spillFadeLength;
                spillFade = juce::jmax (0, spillFade - length);
                if (spillFade == 0)
                    b.clear();
            }
            if (! b.idle)
            {
                std::array<const float*, maxLines> spilled {};
                for (int j = 0; j < lineCount && spillFeeds; ++j)
                    spilled[(size_t) j] = spillScratch.getReadPointer (j) + start;
                b.process (q, handing ? spillInL + start : nullptr, handing ? spillInR + start : nullptr, lateL + start, lateR + start, length, gain, spillFeeds ? spilled.data() : nullptr);
                if (b.peak() < quietPeak && ! q.hold)
                    b.clear();
            }
        }
        sounded = sounded || a.peak() > quietPeak;
    }
    if (! net.idle && ! sounded && silent && ! frozen && ! infinite && quietSamples > (juce::int64) (ringSeconds * rate))
        net.clear();

    // The tone corrector on what the late network made (a linear network: the same as on what went in),
    // so the Decay EQ changes how long each band rings, not how loud.
    if (s.toneLock)
        for (int i = 0; i < numSamples; ++i)
        {
            const auto l = lateL[i], r = lateR[i];
            lateL[i] = tone[0].process (l), lateR[i] = tone[1].process (r);
            if (toneFade > 0)
            {
                const auto t = (float) toneFade-- / (float) toneFadeLength;
                lateL[i] = lateL[i] * (1 - t) + toneOld[0].process (l) * t;
                lateR[i] = lateR[i] * (1 - t) + toneOld[1].process (r) * t;
            }
        }

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
