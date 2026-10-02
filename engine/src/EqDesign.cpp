#include "EqDesign.h"

#include <algorithm>
#include <cmath>

namespace eq
{
namespace
{
constexpr double pi = 3.14159265358979323846;
constexpr double sqrt2 = 1.41421356237309504880;
using C = std::complex<double>;
} // namespace

const double brickwall[7][3] = {
    { 1.16875010689, 0.0157315728044, 0.996392865059 }, { 1.21480940173, 0.0532890912819, 0.965291173716 }, { 1.33515576153, 0.110317002406, 0.893416009502 },
    { 1.61897467419, 0.202044716507, 0.763645449376 },  { 2.37218547572, 0.33888282627, 0.563421310846 },   { 5.2094901803, 0.504391367122, 0.318743738755 },
    { 41.0045579738, 0.629812734107, 0.132729794846 },
};

// ---------------------------------------------------------------------------------------------------------
// The analog sections (shared/music/pro-q-filters.ts, line for line)
// ---------------------------------------------------------------------------------------------------------

namespace
{
/** Polynomial factors in p: quadratics p^2 + b p + c, and first-order p + r. */
struct Factors
{
    std::array<std::array<double, 2>, maxSections> quads {};
    int quadCount = 0;
    double first = 0;
    bool hasFirst = false;
};

/** The Butterworth angles of an order-m shelf, the widest first. */
int butterworthAngles (int m, double* out)
{
    for (int k = 1; k <= m / 2; ++k)
        out[k - 1] = (0.5 - (2.0 * k - 1) / (2.0 * m)) * pi;
    return m / 2;
}

/** A symmetric Butterworth low shelf of order m, gain g at DC, its sharpest section's damping / q: zeros and poles. */
void shelfFactors (int m, double g, double q, Factors& zeros, Factors& poles)
{
    const auto rz = std::pow (g, 1.0 / (2 * m)), rp = 1 / rz;
    double angles[maxSections];
    const auto n = butterworthAngles (m, angles);
    zeros = {};
    poles = {};
    for (int i = 0; i < n; ++i)
    {
        const auto damping = 2 * std::cos (angles[i]) / (i == 0 ? q : 1.0);
        zeros.quads[(size_t) zeros.quadCount++] = { damping * rz, rz * rz };
        poles.quads[(size_t) poles.quadCount++] = { damping * rp, rp * rp };
    }
    if (m % 2 == 1)
    {
        zeros.hasFirst = poles.hasFirst = true;
        zeros.first = rz;
        poles.first = rp;
    }
}

/** Butterworth poles of order m (p^2 + 2cos(a) p + 1, and p + 1 if odd). */
void butterworthFactors (int m, Factors& out)
{
    double angles[maxSections];
    const auto n = butterworthAngles (m, angles);
    out = {};
    for (int i = 0; i < n; ++i)
        out.quads[(size_t) out.quadCount++] = { 2 * std::cos (angles[i]), 1.0 };
    if (m % 2 == 1)
    {
        out.hasFirst = true;
        out.first = 1;
    }
}

/** p = Qr (s + 1/s): each factor's roots as quadratics in s ([b, c]: s^2 + b s + c), the larger root of a pair first. */
int bandTransform (const Factors& f, double qr, std::array<std::array<double, 2>, maxSections>& out)
{
    int count = 0;
    const auto push = [&] (double b, double c) {
        if (count < maxSections)
            out[(size_t) count++] = { b, c };
    };
    if (f.hasFirst)
        push (2 * f.first / (2 * qr), 1);
    for (int i = 0; i < f.quadCount; ++i)
    {
        const auto b = f.quads[(size_t) i][0], c = f.quads[(size_t) i][1];
        const auto disc = b * b / 4 - c;
        if (disc >= 0)
        {
            for (const auto root : { -b / 2 + std::sqrt (disc), -b / 2 - std::sqrt (disc) })
                push (-2 * root / (2 * qr), 1);
            continue;
        }
        const C cc = C (-b / 2, std::sqrt (-disc)) / (2 * qr);
        const auto d = std::sqrt (cc * cc - 1.0);
        std::array<std::array<double, 2>, 2> pair;
        int j = 0;
        for (const auto x : { cc + d, cc - d })
            pair[(size_t) j++] = { -2 * x.real(), std::norm (x) };
        if (pair[1][1] > pair[0][1])
            std::swap (pair[0], pair[1]);
        push (pair[0][0], pair[0][1]);
        push (pair[1][0], pair[1][1]);
    }
    return count;
}

void flatTilt (double pivot, double gain, Sections& out)
{
    const auto slope = gain / (0.5 * std::log2 (20000.0 / 20.0));
    if (std::abs (slope) < 1e-9)
        return;
    const auto share = std::min (1.0, std::abs (slope) / (20 * std::log10 (2.0)));
    const auto from = (int) std::floor (std::log2 (2 / pivot)), to = (int) std::ceil (std::log2 (100000 / pivot));
    for (int k = from; k <= to; ++k)
    {
        const auto corner = pivot * std::pow (2.0, k);
        const auto zero = slope > 0 ? corner : corner * std::pow (2.0, share);
        const auto pole = slope > 0 ? corner * std::pow (2.0, share) : corner;
        out.add ({ 1, 1, 0, 1, zero / pole, 0, zero });
    }
    const auto k = 1 / std::abs (out.at (pivot));
    out.list[0].b0 *= k;
    out.list[0].b1 *= k;
}
} // namespace

void analogSections (const BandShape& band, Sections& out)
{
    out.count = 0;
    const auto f = band.frequency;
    const auto qr = band.q / sqrt2;
    const auto n = band.slope / 6;
    const auto g = std::pow (10.0, band.gain / 20);
    const auto sec = [&] (double b0, double b1, double b2, double a0, double a1, double a2, double frequency) { out.add ({ b0, b1, b2, a0, a1, a2, frequency }); };
    std::array<std::array<double, 2>, maxSections> zs {}, ps {};
    Factors zeros, poles;
    switch (band.shape)
    {
        case Shape::bell:
        {
            const auto m = std::max (1, (int) std::lround (n / 2.0 + 1e-9));
            if (m == 1)
            {
                const auto a = std::sqrt (g);
                sec (1, a / qr, 1, 1, 1 / (a * qr), 1, f);
                return;
            }
            shelfFactors (m, g, 1, zeros, poles);
            const auto count = bandTransform (zeros, qr, zs);
            bandTransform (poles, qr, ps);
            for (int i = 0; i < count; ++i)
                sec (zs[(size_t) i][1], zs[(size_t) i][0], 1, ps[(size_t) i][1], ps[(size_t) i][0], 1, f);
            return;
        }
        case Shape::lowShelf:
        case Shape::highShelf:
        case Shape::tiltShelf:
        {
            const auto m = std::max (1, n);
            const auto low = band.shape == Shape::lowShelf;
            shelfFactors (m, g, band.q, zeros, poles);
            if (zeros.hasFirst)
            {
                if (low)
                    sec (zeros.first, 1, 0, poles.first, 1, 0, f);
                else
                    sec (1, zeros.first, 0, 1, poles.first, 0, f);
            }
            for (int i = 0; i < zeros.quadCount; ++i)
            {
                const auto zb = zeros.quads[(size_t) i][0], zc = zeros.quads[(size_t) i][1];
                const auto pb = poles.quads[(size_t) i][0], pc = poles.quads[(size_t) i][1];
                if (low)
                    sec (zc, zb, 1, pc, pb, 1, f);
                else
                    sec (1, zb, zc, 1, pb, pc, f);
            }
            if (band.shape == Shape::tiltShelf && out.count > 0)
            {
                const auto k = 1 / std::sqrt (g);
                out.list[0].b0 *= k;
                out.list[0].b1 *= k;
                out.list[0].b2 *= k;
            }
            return;
        }
        case Shape::lowCut:
        case Shape::highCut:
        {
            const auto high = band.shape == Shape::highCut;
            if (band.slope == 0)
            {
                for (int i = 0; i < 7; ++i)
                {
                    const auto wz2 = brickwall[i][0], a1 = brickwall[i][1], a0 = brickwall[i][2];
                    const auto k = a0 / wz2 * (i == 0 ? std::pow (10.0, -0.05 / 20) : 1.0);
                    if (high)
                        sec (k * wz2, 0, k, a0, a1, 1, f);
                    else
                        sec (k, 0, k * wz2, 1, a1, a0, f);
                }
                return;
            }
            if (n % 2 == 1)
            {
                if (high)
                    sec (1, 0, 0, 1, 1, 0, f);
                else
                    sec (0, 1, 0, 1, 1, 0, f);
            }
            for (int k = 0; k < n / 2; ++k)
            {
                const auto qk = 1 / (2 * std::sin ((2 * k + 1) * pi / (2 * n)));
                const auto damping = 1 / (qk * (k == 0 ? band.q : 1.0));
                if (high)
                    sec (1, 0, 0, 1, damping, 1, f);
                else
                    sec (0, 0, 1, 1, damping, 1, f);
            }
            return;
        }
        case Shape::notch:
        {
            const auto m = std::max (1, (int) std::lround (n / 2.0 + 1e-9));
            if (m == 1)
            {
                sec (1, 0, 1, 1, 1 / qr, 1, f);
                return;
            }
            butterworthFactors (m, poles);
            const auto count = bandTransform (poles, qr, ps);
            for (int i = 0; i < count; ++i)
                sec (1, 0, 1, ps[(size_t) i][1], ps[(size_t) i][0], 1, f);
            return;
        }
        case Shape::bandPass:
        {
            butterworthFactors (std::max (1, n), poles);
            const auto count = bandTransform (poles, qr, ps);
            for (int i = 0; i < count; ++i)
                sec (0, 1 / qr, 0, ps[(size_t) i][1], ps[(size_t) i][0], 1, f);
            if (out.count > 0)
                out.list[0].b1 /= std::abs (out.at (f));
            return;
        }
        case Shape::flatTilt:
            flatTilt (f, band.gain, out);
            return;
    }
}

C Section::at (double hz) const
{
    const C p (0, hz / frequency);
    return (b0 + b1 * p + b2 * p * p) / (a0 + a1 * p + a2 * p * p);
}

C Sections::at (double hz) const
{
    C h (1, 0);
    for (int i = 0; i < count; ++i)
        h *= list[(size_t) i].at (hz);
    return h;
}

C Biquad::at (double hz, double sampleRate) const
{
    const auto z1 = std::polar (1.0, -2 * pi * hz / sampleRate);
    const auto z2 = z1 * z1;
    return (b0 + b1 * z1 + b2 * z2) / (1.0 + a1 * z1 + a2 * z2);
}

// ---------------------------------------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------------------------------------

namespace
{
/** |H(jw)|^2 of a section at w radians a sample (its own frequency w0 radians a sample). */
double power (const Section& s, double w, double w0)
{
    const auto x = w / w0;
    const auto nr = s.b0 - s.b2 * x * x, ni = s.b1 * x;
    const auto dr = s.a0 - s.a2 * x * x, di = s.a1 * x;
    return (nr * nr + ni * ni) / std::max (1e-300, dr * dr + di * di);
}

/** The phi-form of a digital denominator's |A|^2 at phi1 = sin^2(w/2). */
double aPower (double A0, double A1, double A2, double phi1)
{
    const auto phi0 = 1 - phi1;
    return A0 * phi0 + A1 * phi1 + A2 * 4 * phi0 * phi1;
}

/** b from the phi-form numerator (minimum phase); false if it can't be reached (B2 is then clamped). */
void numerator (double B0, double B1, double B2, Biquad& q)
{
    B0 = std::max (0.0, B0);
    B1 = std::max (0.0, B1);
    const auto sB0 = std::sqrt (B0), sB1 = std::sqrt (B1);
    const auto W = (sB0 + sB1) / 2;
    B2 = std::max (B2, -W * W);
    q.b0 = (W + std::sqrt (std::max (0.0, W * W + B2))) / 2;
    q.b1 = (sB0 - sB1) / 2;
    q.b2 = q.b0 > 0 ? -B2 / (4 * q.b0) : 0;
}

/** First order: the pole and zero fitted at DC, Nyquist and the pole's frequency (Vicanek's matched one-pole). */
Biquad matchedFirst (const Section& s, double w0)
{
    Biquad q;
    q.firstOrder = true;
    const auto g0 = std::sqrt (power (s, 0, w0)), gn = std::sqrt (power (s, pi, w0));
    const auto wp = ! isZero (s.a1) ? w0 * std::abs (s.a0 / s.a1) : w0;
    // (Matched no higher than half Nyquist: a section turning above it only shapes the top, and matched
    // there its error would add up with others', a Flat Tilt's ladder.)
    const auto wm = std::clamp (wp, 1e-7, 0.5 * pi);
    const auto gm2 = power (s, wm, w0);
    const auto phi1 = std::pow (std::sin (wm / 2), 2.0), phi0 = 1 - phi1;
    // |H|^2 = (G0^2 A0 phi0 + Gn^2 A1 phi1) / (A0 phi0 + A1 phi1), A0 = (1 + a)^2, A1 = (1 - a)^2.
    double alpha;
    const auto num = phi0 * (gm2 - g0 * g0), den = phi1 * (gn * gn - gm2);
    if (std::abs (den) > 1e-30 && num / den > 0)
    {
        const auto r = std::sqrt (num / den);
        alpha = (1 - r) / (1 + r);
    }
    else
    {
        alpha = -std::exp (-wp);
    }
    alpha = std::clamp (alpha, -0.9999999999, 0.9999999999);
    const auto dcSign = ! isZero (s.a0) && s.b0 / s.a0 < 0 ? -1.0 : 1.0;
    const auto topSign = ! isZero (s.a1) && s.b1 / s.a1 < 0 ? -1.0 : 1.0;
    const auto sum = dcSign * g0 * (1 + alpha), difference = topSign * gn * (1 - alpha);
    q.b0 = (sum + difference) / 2;
    q.b1 = (sum - difference) / 2;
    q.a1 = alpha;
    return q;
}

/** Poles by impulse invariance, the section's natural frequency kept under 0.9 Nyquist. */
void poles (const Section& s, double w0, Biquad& q)
{
    // a2 p^2 + a1 p + a0 = 0 → p^2 + (a1/a2) p + a0/a2: natural frequency √(a0/a2), damping a1 / (2√(a0 a2)).
    const auto natural = std::sqrt (s.a0 / s.a2) * w0;
    const auto zeta = s.a1 / (2 * std::sqrt (s.a0 * s.a2));
    const auto wn = std::min (natural, 0.9 * pi);
    if (zeta < 1)
    {
        q.a1 = -2 * std::exp (-zeta * wn) * std::cos (std::sqrt (1 - zeta * zeta) * wn);
    }
    else
    {
        q.a1 = -2 * std::exp (-zeta * wn) * std::cosh (std::sqrt (zeta * zeta - 1) * wn);
    }
    q.a2 = std::exp (-2 * zeta * wn);
}

/** The numerator by least squares on the magnitude (relative error), exact at DC. */
void fitNumerator (const Section& s, double w0, double A0, double A1, double A2, Biquad& q)
{
    const auto B0 = power (s, 0, w0) * A0;
    // Normal equations for B1, B2 over log-spaced points from 10 Hz-ish to just under Nyquist, and Nyquist.
    double m11 = 0, m12 = 0, m22 = 0, r1 = 0, r2 = 0;
    constexpr int points = 96;
    const auto lowest = std::min (w0 / 64, 0.001);
    for (int i = 0; i <= points; ++i)
    {
        const auto w = i == points ? pi : lowest * std::pow (0.995 * pi / lowest, (double) i / (points - 1));
        const auto phi1 = std::pow (std::sin (w / 2), 2.0), phi0 = 1 - phi1, phi2 = 4 * phi0 * phi1;
        const auto target = power (s, w, w0) * aPower (A0, A1, A2, phi1);
        const auto weight = 1 / std::max (1e-24, target * target);
        const auto rhs = target - B0 * phi0;
        m11 += weight * phi1 * phi1;
        m12 += weight * phi1 * phi2;
        m22 += weight * phi2 * phi2;
        r1 += weight * phi1 * rhs;
        r2 += weight * phi2 * rhs;
    }
    const auto det = m11 * m22 - m12 * m12;
    double B1, B2;
    if (std::abs (det) > 1e-300)
    {
        B1 = (r1 * m22 - r2 * m12) / det;
        B2 = (m11 * r2 - m12 * r1) / det;
    }
    else
    {
        B1 = power (s, pi, w0) * A1;
        B2 = 0;
    }
    numerator (B0, B1, B2, q);
}

Biquad matchedSecond (const Section& s, double w0)
{
    Biquad q;
    poles (s, w0, q);
    const auto A0 = std::pow (1 + q.a1 + q.a2, 2.0), A1 = std::pow (1 - q.a1 + q.a2, 2.0), A2 = -4 * q.a2;

    // Zeros on the axis (a notch, the elliptic filter's): put them exactly there, matching DC (or the top).
    if (isZero (s.b1) && s.b0 > 0 && s.b2 > 0)
    {
        const auto wz = std::sqrt (s.b0 / s.b2) * w0;
        if (wz < 0.98 * pi)
        {
            const auto c = -2 * std::cos (wz);
            const auto atDc = std::sqrt (power (s, 0, w0)) * (1 + q.a1 + q.a2) / (2 + c);
            q.b0 = q.b2 = atDc;
            q.b1 = atDc * c;
            return q;
        }
    }
    // A high pass (a double zero at DC): (1 - z^-1)^2 scaled to the analog magnitude at its frequency
    // (Vicanek's matched high pass).
    const auto natural0 = std::sqrt (s.a0 / s.a2);
    const auto wm = std::min (w0 * natural0, 0.9 * pi);
    const auto phiM = std::pow (std::sin (wm / 2), 2.0);
    if (isZero (s.b0) && isZero (s.b1) && s.b2 > 0)
    {
        q.b0 = std::sqrt (power (s, wm, w0) * aPower (A0, A1, A2, phiM)) / (4 * phiM);
        q.b1 = -2 * q.b0;
        q.b2 = q.b0;
        return q;
    }
    // A low pass well under Nyquist (no zeros): exact at DC and at its frequency (Vicanek's matched low
    // pass); nearer the top, the least-squares fit spreads its error better.
    if (isZero (s.b1) && isZero (s.b2) && s.b0 > 0 && w0 * natural0 < 2 * pi / 10)
    {
        const auto B0 = power (s, 0, w0) * A0;
        const auto R1 = aPower (A0, A1, A2, phiM) * power (s, wm, w0);
        const auto B1 = std::max (0.0, (R1 - B0 * (1 - phiM)) / phiM);
        q.b0 = (std::sqrt (B0) + std::sqrt (B1)) / 2;
        q.b1 = std::sqrt (B0) - q.b0;
        q.b2 = 0;
        return q;
    }
    // A bell (its numerator and denominator round the same frequency): Vicanek's peaking fit, exact at
    // DC, at its frequency, and flat there.
    const auto natural = std::sqrt (s.a0 / s.a2);
    if (std::abs (std::sqrt (s.b0 / s.b2) - natural) < 1e-9 * natural && w0 * natural < 0.9 * pi && std::abs (s.b0 / s.a0 - 1) < 1e-9)
    {
        const auto wc = w0 * natural;
        const auto G2 = power (s, wc, w0);
        const auto phi1 = std::pow (std::sin (wc / 2), 2.0), phi0 = 1 - phi1;
        const auto B0 = A0;
        const auto R1 = aPower (A0, A1, A2, phi1) * G2;
        const auto R2 = (-A0 + A1 + 4 * (phi0 - phi1) * A2) * G2;
        const auto B2 = (R1 - R2 * phi1 - B0) / (4 * phi1 * phi1);
        const auto B1 = R2 + B0 + 4 * (phi1 - phi0) * B2;
        numerator (B0, B1, B2, q);
        return q;
    }
    fitNumerator (s, w0, A0, A1, A2, q);
    return q;
}
} // namespace

Biquad matched (const Section& s, double sampleRate)
{
    const auto w0 = 2 * pi * s.frequency / sampleRate;
    if (s.firstOrder())
        return matchedFirst (s, w0);
    // A cut (a section that takes away round its frequency, its zeros off the axis and away from DC): the
    // boost it undoes, inverted. A boost's narrow poles map far better than a cut's wide ones.
    if (s.b2 > 0 && s.b0 > 0 && s.b1 > 0)
    {
        const auto centre = std::pow (s.b0 / s.b2 * (s.a0 / s.a2), 0.25);
        if (power (s, centre * w0, w0) < 1 - 1e-9)
        {
            const Section inverse { s.a0, s.a1, s.a2, s.b0, s.b1, s.b2, s.frequency };
            const auto boost = matchedSecond (inverse, w0);
            if (boost.b0 > 0)
            {
                Biquad q;
                q.b0 = 1 / boost.b0;
                q.b1 = boost.a1 / boost.b0;
                q.b2 = boost.a2 / boost.b0;
                q.a1 = boost.b1 / boost.b0;
                q.a2 = boost.b2 / boost.b0;
                return q;
            }
        }
    }
    return matchedSecond (s, w0);
}

Svf Svf::from (const Biquad& q)
{
    Svf s;
    s.firstOrder = q.firstOrder;
    if (q.firstOrder)
    {
        const auto p = -q.a1;
        s.g = (1 - p) / (1 + p);
        const auto G = s.g / (1 + s.g);
        s.m0 = (q.b0 - q.b1) / (1 + p);
        s.m1 = (q.b0 - s.m0) / G;
        return s;
    }
    const auto plus = 1 + q.a1 + q.a2, minus = 1 - q.a1 + q.a2;
    s.g = std::sqrt (std::max (1e-30, plus) / std::max (1e-30, minus));
    s.k = 2 * (1 - q.a2) / std::sqrt (std::max (1e-60, plus * minus));
    const auto D = 1 + s.g * s.k + s.g * s.g;
    s.m0 = (q.b0 - q.b1 + q.b2) * D / 4;
    s.m2 = (q.b0 + q.b1 + q.b2) * D / (4 * s.g * s.g) - s.m0;
    s.m1 = (q.b0 - q.b2) * D / (2 * s.g) - s.m0 * s.k;
    return s;
}
} // namespace eq
