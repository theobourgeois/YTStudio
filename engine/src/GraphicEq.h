// The Reverb's octave-band attenuation filters (docs/reverb/reverb.md 6.6): how long each band of each
// line rings. A line L samples long must lose -60·L / (fs·T60) dB a pass at every frequency for every
// mode of the network to decay at T60 (Jot and Chaigne). Each line's filter is made in two stages
// (Välimäki, Prawda and Schlecht 2024): Jot's first-order shelf, designed from the ends (31.5 Hz and
// 16 kHz) so it sets the decay at DC and Nyquist exactly, then a ten-band graphic EQ of proportional
// peak sections (Prawda, Välimäki and Schlecht 2019) fitted to what's left by a precomputed
// pseudo-inverse of their interaction matrix, refined once. A margin keeps the whole loop under unity.
//
// A design is a set of commands in dB; it's realised at any scale (the dB times a factor), which is what
// a glide of Size, Freeze, Auto-Decay or a uniform change of Decay needs (the sections' responses are
// close to self-similar), so only a change of the curve's shape is solved again. Allocation-free: the
// audio thread may design and realise.
#pragma once

#include <juce_core/juce_core.h>

#include <array>
#include <cmath>

namespace verb
{
constexpr int numBands = 10;
constexpr double pi = 3.14159265358979323846;
/** The octave bands (Hz): `REVERB_OCTAVES`. */
constexpr std::array<double, numBands> octaves { 31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000 };

/** One filter's design: the shelf's two ends (dB) and its corner (Hz), each band's command (dB), a broadband gain (dB). */
struct EqDesign
{
    double dcDb = 0, nyqDb = 0, corner = 1000;
    std::array<double, numBands> command {};
    double broadband = 0;
};

/** The interaction matrix and its pseudo-inverse at a sample rate; designs and evaluates. */
class GraphicEq
{
public:
    /** Centres and the geometric midpoints between them: where a design is fitted. */
    static constexpr int controls = 2 * numBands - 1;

    void prepare (double sampleRate)
    {
        rate = sampleRate;
        for (int m = 0; m < numBands; ++m)
        {
            wc[(size_t) m] = 2 * pi * juce::jmin (octaves[(size_t) m], 0.45 * rate) / rate;
            // An octave's bandwidth (1.5 × the centre), kept short of Nyquist at the top.
            const auto b = juce::jmin (1.5 * wc[(size_t) m], 1.8 * (pi - wc[(size_t) m]));
            tb[(size_t) m] = std::tan (b / 2);
        }
        for (int k = 0; k < controls; ++k)
        {
            const auto f = k % 2 == 0 ? octaves[(size_t) (k / 2)] : std::sqrt (octaves[(size_t) (k / 2)] * octaves[(size_t) (k / 2 + 1)]);
            cw[(size_t) k] = 2 * pi * juce::jmin (f, 0.49 * rate) / rate;
        }
        // Each section's response (dB) at a prototype gain, at the control points, per dB.
        constexpr double proto = 10;
        std::array<std::array<double, numBands>, controls> b {};
        for (int k = 0; k < controls; ++k)
            for (int m = 0; m < numBands; ++m)
                b[(size_t) k][(size_t) m] = sectionDb (m, proto, cw[(size_t) k]) / proto;
        // P = (BᵀB + λI)⁻¹ Bᵀ, by Gauss-Jordan on the 10 × 10 normal matrix.
        std::array<std::array<double, 2 * numBands>, numBands> a {};
        for (int i = 0; i < numBands; ++i)
        {
            for (int j = 0; j < numBands; ++j)
            {
                double sum = 0;
                for (int k = 0; k < controls; ++k)
                    sum += b[(size_t) k][(size_t) i] * b[(size_t) k][(size_t) j];
                a[(size_t) i][(size_t) j] = sum + (i == j ? 1e-6 : 0);
            }
            a[(size_t) i][(size_t) (numBands + i)] = 1;
        }
        for (int c = 0; c < numBands; ++c)
        {
            int pivot = c;
            for (int r = c + 1; r < numBands; ++r)
                if (std::abs (a[(size_t) r][(size_t) c]) > std::abs (a[(size_t) pivot][(size_t) c]))
                    pivot = r;
            std::swap (a[(size_t) c], a[(size_t) pivot]);
            const auto d = a[(size_t) c][(size_t) c];
            for (auto& v : a[(size_t) c])
                v /= d;
            for (int r = 0; r < numBands; ++r)
                if (r != c)
                {
                    const auto f = a[(size_t) r][(size_t) c];
                    for (int j = 0; j < 2 * numBands; ++j)
                        a[(size_t) r][(size_t) j] -= f * a[(size_t) c][(size_t) j];
                }
        }
        for (int i = 0; i < numBands; ++i)
            for (int k = 0; k < controls; ++k)
            {
                double sum = 0;
                for (int j = 0; j < numBands; ++j)
                    sum += a[(size_t) i][(size_t) (numBands + j)] * b[(size_t) k][(size_t) j];
                p[(size_t) i][(size_t) k] = sum;
            }
    }

    double sampleRate() const { return rate; }

    /**
     * The design for a target (dB at each octave band). `attenuation`: a loop's filter, kept under 0 dB
     * everywhere (a margin taken off the broadband gain where the fit ripples over).
     */
    EqDesign design (const std::array<double, numBands>& target, bool attenuation) const
    {
        EqDesign d;
        d.dcDb = target[0];
        d.nyqDb = target[(size_t) numBands - 1];
        // The shelf's corner where the target crosses halfway between its ends.
        const auto mid = 0.5 * (d.dcDb + d.nyqDb);
        d.corner = 1000;
        if (std::abs (d.dcDb - d.nyqDb) > 1e-9)
            for (int b = 0; b + 1 < numBands; ++b)
            {
                const auto x0 = target[(size_t) b] - mid, x1 = target[(size_t) b + 1] - mid;
                if (x0 == 0 || x0 * x1 < 0)
                {
                    const auto t = x0 == x1 ? 0.0 : x0 / (x0 - x1);
                    d.corner = octaves[(size_t) b] * std::pow (2.0, t);
                    break;
                }
            }
        d.corner = juce::jlimit (63.0, juce::jmin (8000.0, 0.4 * rate), d.corner);

        // What's left for the graphic EQ at the control points.
        std::array<double, controls> residual {};
        for (int k = 0; k < controls; ++k)
        {
            const auto want = k % 2 == 0 ? target[(size_t) (k / 2)] : 0.5 * (target[(size_t) (k / 2)] + target[(size_t) (k / 2 + 1)]);
            residual[(size_t) k] = want - shelfDb (d, 1, cw[(size_t) k]);
        }
        solve (residual, d.command);
        // Refined once: what the sections actually make, its error fitted again.
        std::array<double, controls> error {};
        for (int k = 0; k < controls; ++k)
        {
            double made = 0;
            for (int m = 0; m < numBands; ++m)
                made += sectionDb (m, d.command[(size_t) m], cw[(size_t) k]);
            error[(size_t) k] = residual[(size_t) k] - made;
        }
        std::array<double, numBands> more {};
        solve (error, more);
        for (int m = 0; m < numBands; ++m)
            d.command[(size_t) m] = juce::jlimit (-40.0, 40.0, d.command[(size_t) m] + more[(size_t) m]);

        if (attenuation)
        {
            // Never a gain anywhere: a loop at or over unity never dies.
            double most = -1e9;
            for (int k = 0; k <= 64; ++k)
                most = juce::jmax (most, responseDb (d, 1, pi * (k == 0 ? 1e-4 : (double) k / 64.0 * 0.9999)));
            for (int k = 0; k < controls; ++k)
                most = juce::jmax (most, responseDb (d, 1, cw[(size_t) k]));
            double least = -1e9;
            for (const auto t : target)
                least = juce::jmax (least, 0.25 * t);
            if (most > least)
                d.broadband = least - most;
        }
        return d;
    }

    /** Only the shelf (no bands): the in-line all-passes' own loss, Jot's first stage alone. */
    EqDesign shelfOnly (const std::array<double, numBands>& target) const
    {
        auto d = design (target, false);
        d.command.fill (0);
        d.broadband = 0;
        return d;
    }

    /** The shelf's response (dB) at band `b`'s centre. */
    double shelfAt (const EqDesign& d, int b) const { return shelfDb (d, 1, cw[(size_t) (2 * b)]); }

    /** A design's response (dB) at `scale` × its commands, at ω (radians a sample). */
    double responseDb (const EqDesign& d, double scale, double w) const
    {
        auto db = shelfDb (d, scale, w) + d.broadband * scale;
        for (int m = 0; m < numBands; ++m)
            db += sectionDb (m, d.command[(size_t) m] * scale, w);
        return db;
    }

    /** A proportional peak section's coefficients (b0, b1, b2, a1, a2; a0 = 1) for band `m` at `db`. */
    void section (int m, double db, double* c) const
    {
        const auto g = std::pow (10.0, db / 20), sg = std::sqrt (g), t = tb[(size_t) m], cs = std::cos (wc[(size_t) m]);
        const auto a0 = sg + t;
        c[0] = (sg + g * t) / a0;
        c[1] = -2 * sg * cs / a0;
        c[2] = (sg - g * t) / a0;
        c[3] = -2 * sg * cs / a0;
        c[4] = (sg - t) / a0;
    }

    /** The shelf's coefficients (b0, b1, a1) at `scale`. */
    void shelf (const EqDesign& d, double scale, double* c) const
    {
        const auto hd = std::pow (10.0, d.dcDb * scale / 20), hn = std::pow (10.0, d.nyqDb * scale / 20);
        const auto p = std::tan (pi * d.corner / rate) * std::sqrt (hn / juce::jmax (hd, 1e-300));
        c[0] = (hn + hd * p) / (1 + p);
        c[1] = (hd * p - hn) / (1 + p);
        c[2] = (p - 1) / (1 + p);
    }

private:
    void solve (const std::array<double, controls>& r, std::array<double, numBands>& out) const
    {
        for (int m = 0; m < numBands; ++m)
        {
            double sum = 0;
            for (int k = 0; k < controls; ++k)
                sum += p[(size_t) m][(size_t) k] * r[(size_t) k];
            out[(size_t) m] = sum;
        }
    }

    double sectionDb (int m, double db, double w) const
    {
        if (std::abs (db) < 1e-9)
            return 0;
        double c[5];
        section (m, db, c);
        const auto c1 = std::cos (w), c2 = std::cos (2 * w);
        const auto num = c[0] * c[0] + c[1] * c[1] + c[2] * c[2] + 2 * (c[0] * c[1] + c[1] * c[2]) * c1 + 2 * c[0] * c[2] * c2;
        const auto den = 1 + c[3] * c[3] + c[4] * c[4] + 2 * (c[3] + c[3] * c[4]) * c1 + 2 * c[4] * c2;
        return 10 * std::log10 (juce::jmax (num, 1e-300) / juce::jmax (den, 1e-300));
    }

    double shelfDb (const EqDesign& d, double scale, double w) const
    {
        double c[3];
        shelf (d, scale, c);
        const auto c1 = std::cos (w);
        const auto num = c[0] * c[0] + c[1] * c[1] + 2 * c[0] * c[1] * c1;
        const auto den = 1 + c[2] * c[2] + 2 * c[2] * c1;
        return 10 * std::log10 (juce::jmax (num, 1e-300) / juce::jmax (den, 1e-300));
    }

    double rate = 48000;
    std::array<double, numBands> wc {}, tb {};
    std::array<double, controls> cw {};
    std::array<std::array<double, controls>, numBands> p {};
};

/** A design realised: the shelf, the sections that do anything, the broadband gain. Its state survives a new realisation (no click). */
struct EqFilter
{
    void realise (const EqDesign& d, const GraphicEq& eq, double scale)
    {
        double c[5];
        eq.shelf (d, scale, c);
        sb0 = c[0], sb1 = c[1], sa1 = c[2];
        active = 0;
        for (int m = 0; m < numBands; ++m)
        {
            // Eco by itself: a band with next to nothing to do isn't run.
            if (std::abs (d.command[(size_t) m] * scale) < 0.002)
                continue;
            eq.section (m, d.command[(size_t) m] * scale, c);
            auto& s = sections[(size_t) active];
            // A band switched on starts from silence; one kept keeps its memory.
            if (band[(size_t) active] != m)
                s.z1 = s.z2 = 0;
            band[(size_t) active] = m;
            s.b0 = c[0], s.b1 = c[1], s.b2 = c[2], s.a1 = c[3], s.a2 = c[4];
            ++active;
        }
        for (int k = active; k < numBands; ++k)
            band[(size_t) k] = -1;
        gain = std::pow (10.0, d.broadband * scale / 20);
    }
    /** Flat: a gain of 1 (a frozen loop). */
    void flat()
    {
        sb0 = 1, sb1 = 0, sa1 = 0, active = 0, gain = 1;
        band.fill (-1);
    }

    float process (float x)
    {
        double y = sb0 * x + sz;
        sz = sb1 * x - sa1 * y;
        for (int k = 0; k < active; ++k)
        {
            auto& s = sections[(size_t) k];
            const auto in = y;
            y = s.b0 * in + s.z1;
            s.z1 = s.b1 * in - s.a1 * y + s.z2;
            s.z2 = s.b2 * in - s.a2 * y;
        }
        return (float) (y * gain);
    }

    void reset()
    {
        sz = 0;
        for (auto& s : sections)
            s.z1 = s.z2 = 0;
    }

    struct Section
    {
        double b0 = 1, b1 = 0, b2 = 0, a1 = 0, a2 = 0, z1 = 0, z2 = 0;
    };
    double sb0 = 1, sb1 = 0, sa1 = 0, sz = 0, gain = 1;
    std::array<Section, numBands> sections;
    std::array<int, numBands> band { -1, -1, -1, -1, -1, -1, -1, -1, -1, -1 };
    int active = 0;
};
} // namespace verb
