// YT-L's clip stage (docs/fabfilter/pro-l.md §5.7): five curves, odd and (all but Soft) exactly straight under
// their knee, anti-aliased by first-order ADAA applied to what they take off (the residue), not to the sound: under
// the knee the residue is exactly 0, so the sound passes bit for bit, and only the clippings are averaged.
//
// ADAA's average over [x[n−1], x[n]] stands for the residue half a sample back; averaging two of them centres it on
// n−1, so the stage gives `x[n−1] − residue` and is exactly one sample late, whatever it does.
#pragma once

#include <algorithm>
#include <cmath>

namespace limit
{
enum class ClipShape
{
    hard,
    smooth,
    soft,
    converter,
    fl
};

/** A clip curve at a level (`level`, linear) with its knee (`knee`, dB under the level; Smooth and FL). */
struct ClipCurve
{
    ClipShape shape = ClipShape::smooth;
    double level = 1, threshold = 1, width = 0;

    void set (ClipShape s, double lvl, double kneeDb)
    {
        shape = s;
        level = std::max (1e-6, lvl);
        switch (shape)
        {
            case ClipShape::hard: threshold = level; width = 0; break;
            // Straight to T, then a C2 smoothstep reaching the level flat at T + w (w = 2·(level − T)).
            case ClipShape::smooth:
                threshold = level * std::pow (10.0, -std::max (0.0, kneeDb) / 20);
                width = 2 * (level - threshold);
                break;
            case ClipShape::soft: threshold = 0; width = level; break;
            // Lavry's soft saturation, roughly: straight to 6 dB under, then a tanh join (C2) towards the level.
            case ClipShape::converter: threshold = level * std::pow (10.0, -6.0 / 20); width = level - threshold; break;
            // Fruity Soft Clipper (measured): straight to T, then an exponential knee (C1) towards the level.
            case ClipShape::fl:
                threshold = level * std::pow (10.0, -std::max (0.0, kneeDb) / 20);
                width = level - threshold;
                break;
        }
    }

    /** The curve's output for a level a ≥ 0. */
    double shaped (double a) const
    {
        switch (shape)
        {
            case ClipShape::hard: return std::min (a, level);
            case ClipShape::smooth:
            {
                if (a <= threshold || width <= 0)
                    return width <= 0 ? std::min (a, level) : a;
                const auto u = (a - threshold) / width;
                return u >= 1 ? level : threshold + width * (u - u * u * u + 0.5 * u * u * u * u);
            }
            case ClipShape::soft:
            {
                const auto v = a / level;
                return level * v / std::sqrt (1 + v * v);
            }
            case ClipShape::converter: return a <= threshold ? a : threshold + width * std::tanh ((a - threshold) / width);
            case ClipShape::fl: return a <= threshold || width <= 0 ? std::min (a, level) : level - width * std::exp (-(a - threshold) / width);
        }
        return a;
    }

    /** The curve's antiderivative from 0 (G(0) = 0), for a ≥ 0. */
    double integral (double a) const
    {
        const auto t = threshold;
        switch (shape)
        {
            case ClipShape::hard: return a <= level ? 0.5 * a * a : level * a - 0.5 * level * level;
            case ClipShape::smooth:
            {
                if (width <= 0)
                    return a <= level ? 0.5 * a * a : level * a - 0.5 * level * level;
                if (a <= t)
                    return 0.5 * a * a;
                const auto knee = [&] (double u) { return 0.5 * t * t + width * (t * u + width * (0.5 * u * u - 0.25 * u * u * u * u + 0.1 * u * u * u * u * u)); };
                const auto u = (a - t) / width;
                return u >= 1 ? knee (1) + level * (a - t - width) : knee (u);
            }
            case ClipShape::soft:
            {
                const auto v = a / level;
                return level * level * (std::sqrt (1 + v * v) - 1);
            }
            case ClipShape::converter:
            {
                if (a <= t)
                    return 0.5 * a * a;
                const auto z = (a - t) / width;
                // ln cosh, kept stable for large z.
                const auto logCosh = z + std::log1p (std::exp (-2 * z)) - std::log (2.0);
                return 0.5 * t * t + t * (a - t) + width * width * logCosh;
            }
            case ClipShape::fl:
                if (a <= t || width <= 0)
                    return a <= level ? 0.5 * a * a : level * a - 0.5 * level * level;
                return 0.5 * t * t + level * (a - t) + width * width * (std::exp (-(a - t) / width) - 1);
        }
        return 0.5 * a * a;
    }

    /** What the curve takes off x (odd), and its antiderivative (even). */
    double residue (double x) const { return x - (x < 0 ? -shaped (-x) : shaped (x)); }
    double residueIntegral (double x) const
    {
        const auto a = std::abs (x);
        return 0.5 * a * a - integral (a);
    }
};

/** One channel's clip stage: one sample late, the residue anti-aliased (first-order ADAA). */
struct ClipStage
{
    double previousX = 0, previousIntegral = 0, previousAverage = 0, residueOut = 0;

    void reset() { previousX = previousIntegral = previousAverage = residueOut = 0; }

    /** `x` in; the sample before it out, clipped by `curve` (or just delayed when `on` is false). */
    double process (const ClipCurve& curve, double x, bool on)
    {
        if (! on)
        {
            const auto out = previousX;
            previousX = x;
            previousIntegral = previousAverage = residueOut = 0;
            return out;
        }
        const auto integral = curve.residueIntegral (x);
        const auto dx = x - previousX;
        const auto average = std::abs (dx) > 1e-7 ? (integral - previousIntegral) / dx : curve.residue (0.5 * (x + previousX));
        residueOut = 0.5 * (average + previousAverage);
        const auto out = previousX - residueOut;
        previousX = x;
        previousIntegral = integral;
        previousAverage = average;
        return out;
    }
};
} // namespace limit
