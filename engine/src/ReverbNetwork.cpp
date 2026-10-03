#include "ReverbNetwork.h"

#include <cmath>

namespace verb
{
namespace
{
/** How fast Size glides (a fraction of every length a second): under 3.5 cents of pitch while it moves (6.12). */
constexpr double sizeGlidePerSecond = 0.002;
/** How often (samples) the absorption is realised again while its scale moves, and the taps re-placed. */
constexpr int refreshEvery = 32;
/** How long a new absorption design takes to glide in (s). */
constexpr double designGlideSeconds = 0.03;

bool isPrime (int n)
{
    if (n < 2)
        return false;
    if (n % 2 == 0)
        return n == 2;
    for (int d = 3; d * d <= n; d += 2)
        if (n % d == 0)
            return false;
    return true;
}

/** The loop's guard: transparent under ±2, held under ±4. */
inline float guard (float x, bool& clipped)
{
    const auto a = std::abs (x);
    if (a < 2.0f)
        return x;
    clipped = true;
    return (x > 0 ? 1.0f : -1.0f) * (2.0f + 2.0f * std::tanh ((a - 2.0f) * 0.5f));
}

/** An era's converter in the loop: saturating at `clip`, then quantised (fixed point, or ranging its gain in 6 dB steps). */
inline float convert (float x, int bits, double clip, bool ranging)
{
    if (bits <= 0)
        return x;
    const auto c = (float) clip;
    const auto a = std::abs (x);
    if (a > 0.5f * c)
        x = (x > 0 ? 1.0f : -1.0f) * (0.5f * c + 0.5f * c * std::tanh ((a - 0.5f * c) / (0.5f * c)));
    double step;
    if (ranging)
    {
        int e = 0;
        std::frexp (juce::jmax (std::abs ((double) x), 1e-5), &e);
        step = std::ldexp (1.0, e - bits);
    }
    else
        step = clip * std::ldexp (1.0, 1 - bits);
    return (float) (std::round (x / step) * step);
}
} // namespace

void Network::allocate (double sampleRate, const GraphicEq& graphicEq)
{
    rate = sampleRate;
    eq = &graphicEq;
    for (auto& line : lines)
    {
        line.delay.allocate ((int) std::ceil (maxDelaySeconds * rate));
        line.allpass.allocate ((int) std::ceil (maxAllpassSeconds * rate));
    }
    for (auto& ring : diffuserRing)
        ring.allocate ((int) std::ceil (0.03 * rate));
}

int Network::nearestPrime (int n, const std::array<int, 2 * maxLines + maxDiffusers>& used, int count)
{
    n = juce::jmax (3, n);
    for (int k = 0;; ++k)
        for (const auto candidate : { n - k, n + k })
            if (isPrime (candidate) && std::find (used.begin(), used.begin() + count, candidate) == used.begin() + count)
                return candidate;
}

void Network::configure (const Topology& t, double scale, const std::array<EqDesign, maxLines>& newDesigns, const std::array<EqDesign, maxLines>& newAllpass)
{
    allpassDesigns = newAllpass;
    topology = t;
    for (int k = 0; k < maxTaps; ++k)
        tapGain[(size_t) k] = t.tap[(size_t) k].gain;
    lineCount = juce::jlimit (0, maxLines, t.lines);
    scaleNow = configuredScale = designScale = scale;
    designs = newDesigns;
    morph = 1, absorbNow = -1;
    std::array<int, 2 * maxLines + maxDiffusers> used {};
    int count = 0;
    const auto samples = [&] (double seconds, double most) {
        const auto n = nearestPrime ((int) std::lround (juce::jmin (seconds * scale, most) * rate), used, count);
        used[(size_t) count++] = n;
        return (double) n;
    };
    for (int i = 0; i < lineCount; ++i)
    {
        auto& line = lines[(size_t) i];
        const auto& spec = t.line[(size_t) i];
        line.delayLength = samples (spec.delay, maxDelaySeconds * 0.9);
        line.allpassLength = samples (spec.allpass, maxAllpassSeconds * 0.9);
        line.gain = line.gainTarget = spec.apGain;
        line.delay.clear();
        line.allpass.clear();
        line.delayY = line.allpassY = 0;
        line.absorb.reset();
        line.absorb.band.fill (-1);
        line.allpassAbsorb.reset();
        // Rates spread over 0.7 .. 1.3 × in irrational steps, phases a quarter apart: no two in step.
        line.rateFactor = 0.7 + 0.6 * (i * 0.6180339887 - std::floor (i * 0.6180339887));
        line.phase = 0.25 * i - std::floor (0.25 * i);
        line.seed = 0x9e3779b9u * (juce::uint32) (i + 1) ^ (juce::uint32) t.signature;
        // A random walk starts on its way (from one random place to another), not still at zero for a cycle.
        line.seed = line.seed * 1664525u + 1013904223u;
        line.from = (float) (line.seed >> 8) / 8388608.0f - 1.0f;
        line.seed = line.seed * 1664525u + 1013904223u;
        line.to = (float) (line.seed >> 8) / 8388608.0f - 1.0f;
        line.out = 0;
    }
    for (int k = 0; k < juce::jmin (maxDiffusers, t.diffusers); ++k)
    {
        diffuserLength[(size_t) k] = samples (t.diffuserLength[(size_t) k], 0.025);
        diffuserRing[(size_t) k].clear();
    }
    bandwidthY = 0;
    keep = 1, keepTarget = 0, held = 0, heldSamples = 0;
    loopEnergy = 0;
    lastPeak = 0;
    realisedAbsorb = realisedRatio = -1;
    counter = 0;
    idle = true;
}

void Network::redesign (const std::array<EqDesign, maxLines>& newDesigns, const std::array<EqDesign, maxLines>& newAllpass, double scale)
{
    // From what's playing now (partway through the last glide, perhaps), at a scale of 1.
    for (int j = 0; j < lineCount; ++j)
    {
        const auto t = juce::jlimit (0.0, 1.0, morph);
        designsFrom[(size_t) j] = blend (designsFrom[(size_t) j], 1 / fromScale, designs[(size_t) j], 1 / designScale, t);
        allpassFrom[(size_t) j] = blend (allpassFrom[(size_t) j], 1 / fromScale, allpassDesigns[(size_t) j], 1 / designScale, t);
    }
    fromScale = 1, morph = 0;
    designs = newDesigns;
    allpassDesigns = newAllpass;
    designScale = scale;
    realisedAbsorb = realisedRatio = -1;
}

EqDesign Network::blend (const EqDesign& a, double sa, const EqDesign& b, double sb, double t)
{
    if (t >= 1 && sb == 1)
        return b;
    EqDesign d;
    d.dcDb = (1 - t) * a.dcDb * sa + t * b.dcDb * sb;
    d.nyqDb = (1 - t) * a.nyqDb * sa + t * b.nyqDb * sb;
    d.corner = std::exp ((1 - t) * std::log (juce::jmax (1.0, a.corner)) + t * std::log (juce::jmax (1.0, b.corner)));
    for (int m = 0; m < numBands; ++m)
        d.command[(size_t) m] = (1 - t) * a.command[(size_t) m] * sa + t * b.command[(size_t) m] * sb;
    d.broadband = (1 - t) * a.broadband * sa + t * b.broadband * sb;
    return d;
}

void Network::update (const Topology& t)
{
    // The same wiring: only the values (all-pass gains, input and tap gains) change.
    for (int i = 0; i < lineCount; ++i)
    {
        lines[(size_t) i].gainTarget = t.line[(size_t) i].apGain;
        topology.line[(size_t) i].inLeft = t.line[(size_t) i].inLeft;
        topology.line[(size_t) i].inRight = t.line[(size_t) i].inRight;
    }
    for (int k = 0; k < juce::jmin (topology.taps, t.taps); ++k)
        topology.tap[(size_t) k].gain = t.tap[(size_t) k].gain;
    for (int k = 0; k < juce::jmin (topology.diffusers, t.diffusers); ++k)
        topology.diffuserGain[(size_t) k] = t.diffuserGain[(size_t) k];
}

void Network::clear()
{
    for (auto& line : lines)
    {
        line.delay.clear();
        line.allpass.clear();
        line.delayY = line.allpassY = 0;
        line.absorb.reset();
        line.allpassAbsorb.reset();
        line.out = 0;
    }
    for (auto& ring : diffuserRing)
        ring.clear();
    bandwidthY = 0;
    loopEnergy = 0;
    lastPeak = 0;
    idle = true;
}

float Network::lfo (Line& line, int shape, double base)
{
    line.phase += base * line.rateFactor / rate;
    if (line.phase >= 1)
    {
        line.phase -= std::floor (line.phase);
        line.from = line.to;
        line.seed = line.seed * 1664525u + 1013904223u;
        line.to = (float) (line.seed >> 8) / 8388608.0f - 1.0f;
    }
    if (shape == 1)
        return line.from + (line.to - line.from) * (float) (0.5 - 0.5 * std::cos (pi * line.phase));
    return (float) std::sin (2 * pi * line.phase);
}

void Network::process (const NetworkParams& p, const float* inL, const float* inR, float* outL, float* outR, int numSamples, float level, const float* const* feeds)
{
    if (! configured())
        return;
    const auto n = lineCount;
    const auto glide = std::exp (sizeGlidePerSecond / rate);
    const auto quantise = topology.quantise;
    const auto ranging = topology.bits > 0 && topology.bits <= 12;
    const auto bandwidthCoefficient = 1.0 - std::exp (-2 * pi * juce::jmin (p.bandwidth, 0.45 * rate) / rate);
    const auto crossIn = 0.5 * juce::jlimit (0.0, 1.0, p.cross);
    std::array<float, maxLines> q {};
    float peak = 0;
    double energy = 0;
    // Each line's all-pass gain glides to its own (a Plate's second all-passes follow Decay).
    const auto gainGlide = 1.0 - std::exp (-1.0 / (0.02 * rate));

    for (int i = 0; i < numSamples; ++i)
    {
        if (counter-- <= 0)
        {
            // More often while the loss moves (smaller steps, smaller ticks).
            const auto wanted = p.absorb < 1e-4 ? 0.0 : p.absorb;
            const auto step = morph < 1 || (absorbNow >= 0 && absorbNow != wanted) ? refreshEvery / 4 : refreshEvery;
            counter = step - 1;
            // Size glides slowly towards its target (a jump is the State's: a spillover).
            if (std::abs (scaleNow - p.scale) > 1e-9)
                scaleNow = p.scale > scaleNow ? juce::jmin (p.scale, scaleNow * std::pow (glide, step)) : juce::jmax (p.scale, scaleNow / std::pow (glide, step));
            // The absorption follows the lengths (a line's loss is in proportion to it) and the hold or Auto-Decay's factor.
            const auto ratio = scaleNow / designScale;
            const auto gliding = morph < 1;
            if (gliding)
                morph = juce::jmin (1.0, morph + step / (designGlideSeconds * rate));
            // The loss glides too (Decay's factor, Auto-Decay, Freeze): a loop filter's coefficients stepping
            // mid-sound put a click into the lines, which their taps then play.
            if (absorbNow < 0)
                absorbNow = wanted;
            else if (absorbNow != wanted)
            {
                absorbNow += (wanted - absorbNow) * (1.0 - std::exp (-step / (0.01 * rate)));
                if (std::abs (absorbNow - wanted) < 1e-5)
                    absorbNow = wanted;
            }
            if (gliding || std::abs (ratio - realisedRatio) > 1e-3 * realisedRatio || std::abs (absorbNow - realisedAbsorb) > 1e-5 || realisedAbsorb < 0)
            {
                realisedRatio = ratio;
                realisedAbsorb = absorbNow;
                for (int j = 0; j < n; ++j)
                    if (absorbNow <= 1e-6)
                    {
                        lines[(size_t) j].absorb.flat();
                        lines[(size_t) j].allpassAbsorb.flat();
                    }
                    else if (morph < 1)
                    {
                        const auto from = scaleNow / fromScale;
                        lines[(size_t) j].absorb.realise (blend (designsFrom[(size_t) j], from, designs[(size_t) j], ratio, morph), *eq, absorbNow);
                        lines[(size_t) j].allpassAbsorb.realise (blend (allpassFrom[(size_t) j], from, allpassDesigns[(size_t) j], ratio, morph), *eq, absorbNow);
                    }
                    else
                    {
                        lines[(size_t) j].absorb.realise (designs[(size_t) j], *eq, absorbNow * ratio);
                        lines[(size_t) j].allpassAbsorb.realise (allpassDesigns[(size_t) j], *eq, absorbNow * ratio);
                    }
            }
            // Whole samples at the size it was wired for (a fractional read is a gentle low-pass), moving
            // in proportion while Size glides.
            const auto moved = scaleNow / configuredScale;
            for (int k = 0; k < topology.taps; ++k)
                tapAt[(size_t) k] = std::round (topology.tap[(size_t) k].at * configuredScale * rate) * moved;
        }
        const auto ratio = scaleNow / configuredScale;

        // What goes in: mono, or each side with some of the other.
        double xl = inL != nullptr ? inL[i] : 0.0, xr = inR != nullptr ? inR[i] : 0.0;
        if (p.mono)
            xl = xr = 0.5 * (xl + xr);
        else
        {
            const auto l = xl, r = xr;
            xl = (1 - crossIn) * l + crossIn * r;
            xr = (1 - crossIn) * r + crossIn * l;
        }
        if (topology.diffusers > 0)
        {
            // The plate's input: Dattorro's bandwidth, then his four diffusers (their gains × Diffusion).
            bandwidthY += bandwidthCoefficient * (xl - bandwidthY);
            auto u = bandwidthY;
            for (int k = 0; k < topology.diffusers; ++k)
            {
                auto& ring = diffuserRing[(size_t) k];
                const auto g = topology.diffuserGain[(size_t) k] * p.diffuse;
                const auto delayed = (double) ring.whole ((juce::int64) diffuserLength[(size_t) k] - 1);
                const auto w = u + g * delayed;
                ring.push ((float) w);
                u = delayed - g * w;
            }
            xl = xr = u;
        }

        // Each line's output this sample.
        for (int j = 0; j < n; ++j)
        {
            auto& line = lines[(size_t) j];
            const auto& spec = topology.line[(size_t) j];
            const auto mod = (spec.modDelay || spec.modAllpass) && p.modDepth > 0 ? p.modDepth * lfo (line, p.modShape, p.modRate) : 0.0;
            if (spec.modDelay || spec.modAllpass)
                line.out = (float) mod;
            auto d = line.delayLength * ratio + (spec.modDelay ? mod : 0.0);
            if (quantise > 0)
                d = std::round (d * quantise) / quantise;
            auto s = line.absorb.process (thiran (line.delay, d, line.delayY));
            if (topology.bits > 0)
                s = convert (s, topology.bits, topology.clip, ranging);
            s = guard ((float) (s * keep), clippedFlag);
            energy += (double) s * s;
            q[(size_t) j] = s;
        }

        // Through the matrix.
        std::array<float, maxLines> m {};
        if (topology.ring || n != 16)
        {
            if (topology.ring)
                for (int j = 0; j < n; ++j)
                    m[(size_t) j] = q[(size_t) ((j + n - 1) % n)];
            else if (n == 8 || n == 4 || n == 2)
            {
                // A Hadamard (Sylvester's), done as a fast Walsh–Hadamard transform, scaled to stay lossless.
                for (int j = 0; j < n; ++j)
                    m[(size_t) j] = q[(size_t) j];
                for (int h = 1; h < n; h <<= 1)
                    for (int i0 = 0; i0 < n; i0 += h << 1)
                        for (int j = i0; j < i0 + h; ++j)
                        {
                            const auto a = m[(size_t) j], b = m[(size_t) (j + h)];
                            m[(size_t) j] = a + b;
                            m[(size_t) (j + h)] = a - b;
                        }
                const auto norm = 1.0f / std::sqrt ((float) n);
                for (int j = 0; j < n; ++j)
                    m[(size_t) j] *= norm;
            }
            else
            {
                // Householder: x − (2/N)·Σx.
                float sum = 0;
                for (int j = 0; j < n; ++j)
                    sum += q[(size_t) j];
                for (int j = 0; j < n; ++j)
                    m[(size_t) j] = q[(size_t) j] - 2.0f / (float) n * sum;
            }
        }
        else
        {
            // A4 ⊗ A4: A4 = I − ½·1·1ᵀ within each group of four, then across the groups.
            for (int g = 0; g < 4; ++g)
            {
                const auto* x = &q[(size_t) (4 * g)];
                const auto h = 0.5f * (x[0] + x[1] + x[2] + x[3]);
                for (int k = 0; k < 4; ++k)
                    m[(size_t) (4 * g + k)] = x[k] - h;
            }
            for (int k = 0; k < 4; ++k)
            {
                const auto h = 0.5f * (m[(size_t) k] + m[(size_t) (4 + k)] + m[(size_t) (8 + k)] + m[(size_t) (12 + k)]);
                for (int g = 0; g < 4; ++g)
                    m[(size_t) (4 * g + k)] -= h;
            }
        }

        // The input added, then each line's all-pass and into its delay.
        for (int j = 0; j < n; ++j)
        {
            auto& line = lines[(size_t) j];
            const auto& spec = topology.line[(size_t) j];
            line.gain += (line.gainTarget - line.gain) * gainGlide;
            const auto g = juce::jlimit (-0.85, 0.85, line.gain * p.apScale);
            const auto x = (double) m[(size_t) j] + (feeds != nullptr ? (double) feeds[j][i] : spec.inLeft * xl + spec.inRight * xr);
            auto apd = line.allpassLength * ratio + (spec.modAllpass ? (double) line.out : 0.0);
            if (quantise > 0)
                apd = std::round (apd * quantise) / quantise;
            const auto delayed = (double) line.allpassAbsorb.process (thiran (line.allpass, apd, line.allpassY));
            const auto w = x + g * delayed;
            line.allpass.push ((float) w);
            line.delay.push ((float) (delayed - g * w));
        }

        // The taps.
        double yl = 0, yr = 0;
        for (int k = 0; k < topology.taps; ++k)
        {
            const auto& tap = topology.tap[(size_t) k];
            const auto& line = lines[(size_t) tap.line];
            auto& gain = tapGain[(size_t) k];
            gain += (tap.gain - gain) * gainGlide;
            const auto& ring = tap.where == 0 ? line.delay : line.allpass;
            const auto whole = (juce::int64) tapAt[(size_t) k];
            const auto part = tapAt[(size_t) k] - (double) whole;
            const auto v = ((1 - part) * ring.whole (whole) + part * ring.whole (whole + 1)) * gain;
            (tap.side == 0 ? yl : yr) += v;
        }
        const auto ol = (float) (yl * level), orr = (float) (yr * level);
        outL[i] += ol;
        outR[i] += orr;
        peak = juce::jmax (peak, std::abs (ol), std::abs (orr));
    }

    lastPeak = peak;
    // The energy keeper (6.13): while held, the loop's level is kept where it was half a second in (Freeze), or under
    // the ceiling (∞ with its input open), nudged a little each block; otherwise it's left alone.
    const auto blockEnergy = energy / juce::jmax (1, numSamples);
    const auto smooth = 1.0 - std::exp (-numSamples / (0.25 * rate));
    loopEnergy += (blockEnergy - loopEnergy) * smooth;
    if (! std::isfinite (loopEnergy) || ! std::isfinite ((double) peak))
    {
        clear();
        return;
    }
    if (p.hold)
    {
        heldSamples += numSamples;
        if (heldSamples > (juce::int64) (0.5 * rate) && keepTarget <= 0)
            keepTarget = juce::jmax (loopEnergy, 1e-12);
        auto target = keepTarget;
        if (p.ceiling > 0)
            target = loopEnergy > p.ceiling ? p.ceiling : loopEnergy;
        if (target > 0 && loopEnergy > 1e-20 && lineCount > 0)
        {
            // In proportion to how far off it is: `keep` is a gain a pass, so the level already integrates
            // it (a keeper that integrated too would swing for ever). A pass of `length` samples at
            // ln(keep) moves the energy 2·ln(keep) a pass: back to the target in about 4 s, at most 1 dB a
            // second either way.
            double length = 0;
            for (int j = 0; j < lineCount; ++j)
                length += lines[(size_t) j].delayLength + lines[(size_t) j].allpassLength;
            length *= scaleNow / configuredScale / lineCount;
            const auto passesPerSecond = rate / juce::jmax (1.0, length);
            const auto error = juce::jlimit (-2.0, 2.0, std::log (target / loopEnergy));
            const auto most = std::log (10.0) / 10 / (2 * passesPerSecond);
            keep = std::exp (juce::jlimit (-most, most, error / (2 * 4.0 * passesPerSecond)));
        }
    }
    else
    {
        heldSamples = 0;
        keepTarget = 0;
        keep += (1.0 - keep) * juce::jmin (1.0, 20.0 * numSamples / rate);
    }
}
} // namespace verb
