# FabFilter Pro-Q 3: how its DSP works, and how to reproduce it

What this covers: the maths behind Pro-Q 3's sound, so that a native C++/JUCE clone matches its curves. The
UX is in `pro-q-3-manual.md`, next to this file. Nobody can measure the real plug-in here, so every claim is
tagged with how far it can be trusted:

- **[FF]**: FabFilter says so (manual, product pages, staff on the FabFilter forum).
- **[user]**: someone measured or observed it on the real plug-in (forum posts). It can be wrong.
- **[inferred]**: my reasoning from the [FF]/[user] facts. It's consistent with everything found, but it isn't confirmed.
- **[checked]**: I checked it numerically (Python/NumPy, scripts described in §12), against the analog
  prototypes it is meant to match. That proves the maths is right, not that Pro-Q does the same thing.

Conventions: `fs` is the sample rate; `ω = 2πf/fs` is in radians per sample; `s` is the analog Laplace variable,
normalised so that the band's frequency is 1 unless written `ω0`; `g = 10^(G/20)` is a gain in dB as an amplitude;
`A = 10^(G/40) = √g`. "Q" alone means **Pro-Q's Q**, and `Qr` means the textbook (RBJ) Q.

---

## 0. The conclusions in brief

1. **Q is the RBJ Q × √2.** `Qr = Q/√2` [FF staff + user measurements, consistent to 3 digits]. So a 12 dB/oct
   Butterworth cut has Q = 1, and Q = 1 is the default for every shape. A bell's Q is defined, as in the RBJ cookbook,
   at the **half-gain-in-dB points**, and those points **don't move when the slope changes** [user/FF staff].
2. **Slope = 6 dB/oct × filter order**, for every shape. This explains the minimum of 12 for bells and notches
   (order 2), the 6 dB/oct shelves and cuts with no Q (order 1), and steep bells (order 4, 8, 16).
   Every shape is one family: **symmetric Butterworth shelves**, low-pass to band-pass transformed for bells,
   and with gain → 0 for cuts and notches. Q changes the damping of the highest-Q section, so the gain at the
   band's frequency is the same at every slope [inferred; it reproduces every [FF]/[user] fact found].
3. **Brickwall is a very high order elliptic filter** with about 0.05 dB of pass-band ripple. Its phase shift is no
   more than that of the 96 dB/oct Butterworth [FF staff].
4. **Zero Latency** is IIR filtering matched to the analog magnitude: "nearly perfect, except for a small deviation
   above 18 kHz" for a 15 kHz bell [FF]. That error pattern is what an **analog-matched biquad** gives
   (Vicanek 2016's method: impulse-invariant poles, a numerator fitted to the magnitude) [inferred, checked].
   No minimum-phase IIR can match the analog curve right up to Nyquist (see §3.1), so Pro-Q can't be exact there either.
5. **Natural Phase** matches the analog magnitude *and* phase, has a **fixed latency of about 7.3 ms**
   (≈ 320–330 samples at 44.1 kHz, the same whatever the bands) [user], and has no noticeable pre-ring [FF].
   The design proposed here is **the matched IIR followed by a short FIR**. The FIR corrects the IIR's
   remaining error to analog magnitude and phase, plus a pure delay. With a 64-sample delay it is already within
   0.03 dB and 0.15° of analog to 20 kHz [checked]. This is the exact-sounding mode.
6. **Linear Phase** latencies are 3072, 5120, 9216, 17408 and 66560 samples at 44.1 kHz [FF]. Each is exactly
   **L/2 + 1024**, for kernels L = 4096, 8192, 16384, 32768 and 131072 convolved in 1024-sample blocks [inferred].
   The latency scales with the sample rate, so it stays the same in ms [FF].
   L/R bands and M/S bands are processed in two stages, which doubles the latency [FF]. Dynamic bands work only
   up to High [FF], because the kernel is rebuilt each block [inferred].
7. **Dynamic EQ**: the trigger is the input band-limited "according to the frequency range the band works on",
   with a soft knee, and attack, release and knee chosen automatically from the programme, the band's frequency and
   the range [FF]. Attack is roughly 10 ms [user, unconfirmed]. The band's gain moves from Gain towards
   Gain + Range. Auto threshold follows the trigger's own level [FF].
8. **Auto Gain** is "an educated guess based on the current EQ settings, … not a dynamic process" [FF]. Pro-Q 3 added
   "channel weighting and an estimated correction of dynamic gain" [FF]. A weighted average of the curve's power is
   the recommended model [inferred].
9. **Analyzer**: FFTs of 1024, 2048, 4096 or 8192 points (Low to Maximum), a range of 60, 90 or 120 dB, and a tilt
   around 1 kHz of 4.5 dB/oct by default [FF]. Its windows, speeds, collisions, EQ Match and Spectrum Grab are not
   published: §10 gives designs.

---

## 1. Parameters and conventions

| Parameter | Range | Notes |
|---|---|---|
| Frequency | 5 Hz (manual) / 10 Hz (UI) – 30 kHz | Above Nyquist is allowed: the band's skirt still acts below Nyquist [FF] |
| Gain | ±30 dB | Bell, shelves, Tilt Shelf, Flat Tilt [FF] |
| Q | 0.025 – 40, default 1 | Not adjustable at 6 dB/oct [FF] |
| Slope | 6, 12, 18, 24, 30, 36, 48, 72, 96 dB/oct, Brickwall (cuts only) | Applies to every shape [FF] |
| Dynamic range | ±30 dB | Bell and shelves (Pro-Q 4 adds Flat Tilt) [FF] |

### 1.1 Q: the √2 convention [FF staff, user]

FabFilter staff (Cabirio) on the FabFilter forum: "Pro-Q's Q is scaled by that factor (with respect to most other
EQ's) so that for example a Butterworth high or low pass has a Q of 1 rather than 0.707, and the same applies to bell
filters". He also says "it's not based on the 3dB points but on half the max./min. boost/cut", and that Q = 2 is 1
octave, Q = 0.943 is 2 octaves and Q = 0.571 is 3 octaves. Those three figures are exactly the RBJ bandwidth relation
with `Qr = Q/√2`:

```
Qr = Q / √2
BW_oct (between the half-dB-gain points) = (2 / ln 2) · asinh( 1 / (2·Qr) ) = 2.8854 · asinh( 1 / (√2·Q) )
Q  = 1 / ( √2 · sinh( ln2 · BW_oct / 2 ) )
```

Q = 2 gives 1.000 oct, Q = 0.943 gives 2.00 oct, Q = 0.571 gives 3.00 oct, and the default Q = 1 gives
**1.90 octaves**. Q = 1 at 1 kHz puts the half-gain points at 517 Hz and 1931 Hz [checked].

### 1.2 Slope = 6 dB/oct × order [inferred]

| Shape | Slope S → analog order | Structure |
|---|---|---|
| Low/High Cut | N = S/6 (1…16) | Butterworth LP/HP of order N |
| Low/High Shelf, Tilt Shelf | M = S/6 | symmetric Butterworth shelf of order M (§2.2) |
| Bell | 2M with M = S/12 | LP→BP transform of an order-M symmetric shelf (§2.1) |
| Notch | 2M with M = S/12 | LP→BP transform of an order-M Butterworth HP (§2.4) |
| Band Pass | see §2.5 (uncertain) | LP→BP transform of a Butterworth LP |

This is consistent with: "Q cannot be adjusted at 6 dB/oct" (first order has no Q) [FF], bells and notches having a
minimum slope of 12 (Pro-Q 4 manual) [FF], the default of 12 dB/oct on new bells (a plain 2nd-order bell)
[user], and the 48 dB/oct low cut at Q = 1 having "no resonant hump" (Butterworth) [FF staff, Floris].
For odd slopes (18, 30) on bells and notches, M would be fractional. Pro-Q 4 has continuous slopes, so Pro-Q
probably interpolates the shape (for example by spreading the gain across sections). For a Pro-Q 3 clone, round M
up and spread the gain in dB evenly across the sections (§2.1 already does this), or build a 4th-order bell for 18.
Check this against a screenshot.

---

## 2. The analog prototypes

**Design principle [inferred]:** everything comes from one function, the **order-M symmetric Butterworth low
shelf** (Holters & Zölzer 2006, §2.3 "design alternatives"), with gain g at DC and 1 at ∞:

```
H_LS,M(p) = ∏_{m=1..M} ( p + g^(+1/(2M)) · e^{jα_m} ) / ( p + g^(−1/(2M)) · e^{jα_m} )
α_m = ( 1/2 − (2m−1)/(2M) ) · π          (so −e^{jα_m} are the LHP Butterworth roots)

|H_LS,M(jΩ)|² = ( Ω^{2M} + g ) / ( Ω^{2M} + 1/g )
```

Its key property: **|H(j1)|² = g for every M**. The gain at the corner is exactly half the shelf gain in dB,
whatever the order, and the cut (1/g) is the exact inverse of the boost. Each conjugate pair of factors is one real
2nd-order section. It keeps the half-dB-gain property even when its damping is changed, provided numerator and
denominator are changed together (§2.2) [checked algebraically]. For M = 1 and M = 2 it is exactly the RBJ shelf
(at S = 1 / Q = 0.707), and its band-pass transform at M = 1 is exactly the RBJ peaking EQ.

### 2.1 Bell

Substitute the low-pass to band-pass transform into the symmetric low shelf of order M = S/12:

```
p = Qr · ( s/ω0 + ω0/s ),        Qr = Q/√2,   g = 10^(G/20)
```

For **S = 12 (M = 1)** this is the RBJ peaking prototype, `A = 10^(G/40)`:

```
H_bell(s) = ( s² + s·(A/Qr)·ω0 + ω0² ) / ( s² + s·ω0/(A·Qr) + ω0² )
```

The bandwidth between the half-dB points is ω0/Qr. It doesn't depend on the gain ("constant Q" in the RBJ sense),
and a cut is the exact inverse of the boost.

For **M > 1**, `|H(jω)|² = (Ω^{2M} + g)/(Ω^{2M} + 1/g)` with `Ω = Qr·(ω/ω0 − ω0/ω)`. The half-dB-gain points stay at
`Ω = ±1` for every slope, which is the behaviour Cabirio describes ("Q determines the 6 dB points [for a 12 dB
boost] … those are the points that remain fixed" when the bell's slope changes) [checked: 517/1931 Hz at
12, 24 and 48 dB/oct]. A steeper bell is flatter on top and falls more steeply outside.

**Factorising it into biquads** (for both implementation and matching): every prototype root `p_k` (zeros
`−g^{1/2M}e^{jα_m}`, poles `−g^{−1/2M}e^{jα_m}`) maps to two s-plane roots:

```
s = ω0 · ( c ± √(c² − 1) ),   c = p_k / (2·Qr)      (complex arithmetic; their product is ω0²)
```

That gives 2M zeros and 2M poles. Keep the ones with Im ≥ 0 together with their conjugates, so that each conjugate
pair (or real pair) is one quadratic. Pair each zero quadratic with the pole quadratic nearest in |root| (natural
frequency) to make M analog biquads `(s² + β1 s + β0)/(s² + α1 s + α0)`. Each section's DC gain need not be 1; only
the product's is. Normalise the overall gain at DC to 1.

**Gain-Q interaction** (Bell only) [FF]: "the Q automatically gets a bit narrower when gain is increased, and …
a little gain is added when the Q gets very narrow". No formula is published. A placeholder to calibrate against
screenshots [inferred]:

```
Q_eff = Q · 10^( |G| / 80 )                       (×1.41 at 12 dB, ×2.37 at 30 dB)
G_eff = G · ( 1 + 0.1 · max(0, log2(Q_eff / 4)) )   ("a little gain" only when very narrow)
```

### 2.2 Low/High Shelf

Order **M = S/6**: the symmetric Butterworth shelf above (low shelf). For a high shelf use `p → 1/p` (equivalently
`H_HS(s; g) = g · H_LS(s; 1/g)`). For **M = 1** (6 dB/oct, Q ignored) it is `(s + √g)/(s + 1/√g)` (low shelf).
For **M = 2** (the 12 dB/oct default) it is the RBJ shelf with `Qr = Q/√2`, normalised to ω0 = 1:

```
Low shelf:   H(s) = A · ( s² + (√A/Qr)·s + A ) / ( A·s² + (√A/Qr)·s + 1 )
High shelf:  H(s) = A · ( A·s² + (√A/Qr)·s + 1 ) / ( s² + (√A/Qr)·s + A )
```

At Q = 1 (`Qr = 0.707`) it is maximally flat, with no overshoot. At higher Q it has a dip and a bump on either side
of the corner (resonant shelf). At lower Q it is a gentler, wider transition. Its gain at ω0 is exactly G/2 dB for
every Q.

FabFilter says "for the shelf filters, the internal Q values are chosen such that they result in a good range of shelf
shapes" [FF]. So Pro-Q's shelf Q may be a remapped (compressed) Qr rather than exactly Q/√2. Start with Q/√2 and
calibrate against screenshots at Q = 0.1, 1, 4 and 10 [inferred].

**M > 2 with Q** [inferred]: in the product, scale the damping of the **highest-Q section** (the one whose α_m is
closest to ±π/2) by `1/Q`, keeping numerator and denominator symmetric:
`(s² + 2ζ r_z s + r_z²)/(s² + 2ζ r_p s + r_p²)`, with `r_z = g^{1/(2M)}`, `r_p = 1/r_z` and ζ → ζ/Q. Each section
then still gives exactly half its dB gain at ω0, so the shelf's midpoint stays at G/2 for every slope and Q.

**Tilt Shelf** [inferred]: a shelf normalised so that the pivot is at 0 dB:
`H_tilt = g^(−1/2) · H_HS(g)`. That gives −G/2 at low frequencies, +G/2 at high frequencies and exactly 0 dB at the
frequency, for every slope and Q (because the shelf's corner gain is G/2). Whether Pro-Q's "gain" for Tilt Shelf is
this total swing G or ±G at the ends is **unverified**: check it on a screenshot (at G = +12, do the ends read ±6
or ±12?).

### 2.3 Low/High Cut

Butterworth of order **N = S/6**: ⌊N/2⌋ sections `1/(s² + s/q_k + 1)` with `q_k = 1/(2 sin((2k+1)π/(2N)))`, plus one
`1/(s+1)` if N is odd (HP: `s → 1/s`). The 6 dB/oct case is first order, with no Q [FF].

**How Q is applied** [inferred]: multiply **only the highest-q section** by Q (`q_top → q_top · Q`). This keeps
three facts true at once:

- Q = 1 is plain Butterworth at every slope: no hump at 48 dB/oct [FF staff].
- The gain at the cutoff is **exactly 20·log10(Q/√2) dB at every slope**. Each Butterworth section contributes
  q_k at ω = 1 and their product is 1/√2, so for example Q = 2 gives +3.0 dB at every slope [checked]. For 12 dB/oct
  this is just the analog fact that |H(jω0)| = Qr.
- It explains the forum advice to "set the Q at 0.707" for Linkwitz-Riley-style crossovers: Q = 0.707 puts
  **−6 dB at the cutoff for every slope** [user].

The resonant peak then stays near +3.7 dB at Q = 2 and +17 dB at Q = 10 for any order. Scaling *every* section by Q
instead would give +46 dB at 96 dB/oct with Q = 2 [checked], which isn't plausible. A smoother variant with the same
cutoff-gain invariant scales every section by `Q^(1/K)`, with K the number of 2nd-order sections. Pick between them on
a screenshot of a 48 dB/oct cut at Q = 4.

**Brickwall** [FF staff, Floris]: "an elliptic filter of a very high order, which results in an extremely steep
slope, while still introducing the same, or even less phase distortion as the 96dB/oct Butterworth filter. It does
introduce a little bit of ripple in the pass band (≈0.05 dB)". In linear phase mode it pre-rings heavily on low cuts
[FF staff]. "Same or less phase than BW16" means order ≤ 16 (an order-N filter turns at most N·90°).

Proposal [inferred]: an analog elliptic filter with `rp = 0.05 dB`, `rs ≈ 100 dB` and order 12–16, scaled so that its
**−3 dB point is at the band's frequency**, like the other slopes. Elliptic transition widths (analog, pass-band
edge = 1) [checked]:

| Order | rs | −3 dB at | Stop band reached at |
|---|---|---|---|
| 12 | 100 dB | 1.014 | 1.173 (2.8 semitones) |
| 14 | 100 dB | 1.008 | 1.087 (1.4 semitones) |
| 16 | 100 dB | 1.004 | 1.044 (0.75 semitone) |

Order 14 with rs = 100 dB is a good starting point. In Zero Latency mode use the bilinear transform pre-warped at the
cutoff: cramping hardly matters for such a cliff, and the BLT keeps the elliptic equiripple. Use an SVF/TPT structure
in double precision, because a 14th-order filter at 20 Hz has poles extremely close to z = 1 (§4).

### 2.4 Notch

The bell's limit as the gain goes to −∞ doesn't exist at fixed Qr (the poles' damping would blow up), so a notch has
its own Q. Proposal, consistent with the rest [inferred]: the band-pass transform of an order-M Butterworth **high
pass**, M = S/12, Qr = Q/√2:

```
|H(jω)|² = Ω^{2M} / ( Ω^{2M} + 1 ),   Ω = Qr · (ω/ω0 − ω0/ω)
M = 1:  H(s) = (s² + ω0²) / (s² + s·ω0/Qr + ω0²)
```

The −3 dB points sit at Ω = ±1 for every slope (the same invariant as the bell's half-gain points). Q is then the
classic notch Q × √2. Pro-Q's notch is drawn to −∞ at the frequency.

### 2.5 Band Pass (the least certain shape)

The Pro-Q 4 manual groups Band Pass with the cuts ("Low Cut, High Cut and Band Pass … go all the way down to 0
dB/oct"), not with bell and notch (minimum 12). That suggests its slope is the **skirt slope**, as for cuts
[inferred]. Proposal: the band-pass transform of an **order-N Butterworth low pass with N = S/6**, which falls at
S dB/oct on each side:

```
|H(jω)|² = 1 / ( 1 + Ω^{2N} ),   Ω = Qr · (ω/ω0 − ω0/ω),   0 dB at ω0, −3 dB at Ω = ±1
```

With Q, also scale the top section's damping, as for cuts. The alternative reading (S = 12 means a 2nd-order band
pass with 6 dB/oct skirts, as for bells) must be ruled out with one screenshot: a 12 dB/oct band pass at Q = 1 should
read about −12 dB one octave below the centre on the first reading, and about −6.5 dB on the second.

### 2.6 Flat Tilt

[FF]: "a flat tilting correction curve over the whole audible frequency spectrum". Sound On Sound: it "simply
rotates the entire frequency spectrum about a fixed point, applying more and more boost or cut the further you get
from that point".

**Gain → slope** [user]: a forum user who matched analyser tilts found that, with the pivot at 1 kHz, 15 dB gives
3 dB/oct (white → pink), 22 dB gives 4.5 dB/oct, and about 33 dB gives 6 dB/oct. All three fit
**slope = G / 5 dB/oct**, so G is the level reached about 5 octaves from the pivot (half the 10-octave audible range):

```
slope [dB/oct] = G / ( ½ · log2(20000/20) ) = G / 4.983      (±30 dB → ±6 dB/oct)
target(f) = slope · log2(f / f_pivot)  dB
```

One unofficial clone (fabcutie) uses "gain = level change across 20 Hz–20 kHz", which halves this. The user
measurement on the real plug-in wins, but check one screenshot: at G = +15 with the pivot at 1 kHz, 2 kHz should
read +3 dB.

**Realisation** [inferred, checked]: a lattice of first-order shelves, with zeros and poles spaced geometrically
1 octave apart. Within each period a zero is followed by a pole `P·s/(20·log10 2)` octaves higher (note: 6.0206 dB/oct
per pole, not 6). The lattice runs from about 2 Hz to about 50–100 kHz, so that the line has no bend in 20 Hz–20 kHz.
Normalise the product to 0 dB at the pivot. About 16 sections give a straight line to within about 0.03 dB in the
middle of the range [checked: the residual is set by the edges, not the period]. Each section is
`(1 + s/z_i)/(1 + s/p_i)`, discretised with Vicanek's matched one-pole shelf (§3.4). For negative G swap zeros and
poles. Slope and Q are irrelevant here.

### 2.7 All Pass

All Pass is Pro-Q 4 only: `(s² − s/Qr + 1)/(s² + s/Qr + 1)`. Leave it out of a Pro-Q 3 clone.

---

## 3. Zero Latency: decramping

### 3.1 The problem, and what no IIR can do

The bilinear transform (RBJ cookbook) maps the whole analog axis into [0, π) and squeezes everything towards
Nyquist ("cramping"). A 15 kHz bell at 44.1 kHz comes out several dB narrower, with errors of 3–8 dB below 20 kHz
[checked]. Pro-Q's Zero Latency mode is "nearly perfect, except for a small deviation above 18 kHz" [FF]. Staff
also say: "Pro-Q3 is fully decramped in Natural Phase and almost so in Zero Latency" [FF staff, Cabirio].

**Fundamental limit:** a real digital filter's `|H(e^{jω})|²` is a function of cos ω, so its slope in ω is zero at
Nyquist and its phase there is 0 or π. An analog curve generally has neither property at 22.05 kHz. So **no causal
minimum-phase IIR, at any order, can match an analog EQ curve exactly up to Nyquist**. The error can only be pushed
into the top band, and the price of exactness is latency (Natural Phase, §5).

### 3.2 Vicanek's matched biquad (2016): the formulas

Source: M. Vicanek, *Matched Second Order Digital Filters*, 2016,
https://www.vicanek.de/articles/BiquadFits.pdf. Notation: `H(z) = (b0 + b1 z⁻¹ + b2 z⁻²)/(1 + a1 z⁻¹ + a2 z⁻²)`.

**Poles: impulse invariance** of `s² + 2qω0 s + ω0²`, with `q = 1/(2Q_pole)` and ω0 in rad/sample:

```
q ≤ 1:  a1 = −2·e^{−qω0}·cos( √(1−q²)·ω0 )
q > 1:  a1 = −2·e^{−qω0}·cosh( √(q²−1)·ω0 )
        a2 = e^{−2qω0}
```

**Magnitude in φ-form:**

```
φ0 = 1 − sin²(ω/2),  φ1 = sin²(ω/2),  φ2 = 4·φ0·φ1
|H|² = (B0φ0 + B1φ1 + B2φ2) / (A0φ0 + A1φ1 + A2φ2)
A0 = (1+a1+a2)²,  A1 = (1−a1+a2)²,  A2 = −4a2
B0 = (b0+b1+b2)², B1 = (b0−b1+b2)², B2 = −4b0b2
```

**From B back to b**, choosing minimum-phase zeros (b0 > |b2|, b0 + b2 > |b1|):

```
W  = ½(√B0 + √B1)
b0 = ½( W + √(W² + B2) )
b1 = ½( √B0 − √B1 )
b2 = −B2 / (4·b0)
```

The same formulas turn A back into a (Vicanek 2024): `V = ½(√A0+√A1)`, `a0 = ½(V + √(V²+A2))`,
`a1 = ½(√A0−√A1)`, `a2 = −A2/(4a0)`, then divide by a0.

**Matched peaking EQ** (prototype `H = (s² + s√G/Q + 1)/(s² + s/(√G·Q) + 1)`, with G the peak amplitude gain and
Vicanek's Q; for Pro-Q, `Q_vic = Qr`, `G = g`, and the pole Q is `√G·Q_vic`, so `q = 1/(2·√G·Q_vic)`). Its
conditions: unity at DC, |H| = G at ω0, and an extremum at ω0:

```
B0 = A0
R1 = (A0φ0 + A1φ1 + A2φ2)·G²
R2 = (−A0 + A1 + 4(φ0−φ1)·A2)·G²
B2 = (R1 − R2·φ1 − B0) / (4·φ1²)
B1 = R2 + B0 + 4(φ1−φ0)·B2           (φ's evaluated at ω0)
→ b via the formulas above
```

**Matched low pass** (`H = 1/(s² + s/Q + 1)`, b2 = 0, unity at DC, |H(ω0)| = Q):

```
B0 = A0;  R1 = (A0φ0 + A1φ1 + A2φ2)·Q²;  B1 = (R1 − B0φ0)/φ1
b0 = ½(√B0 + √B1);  b1 = √B0 − b0;  b2 = 0          (√B0 = 1 + a1 + a2; needs double precision)
```

**Matched high pass** (double zero at DC, |H(ω0)| = Q):

```
b0 = Q·√(A0φ0 + A1φ1 + A2φ2) / (4φ1);   b1 = −2b0;   b2 = b0
```

**Matched band pass** (single zero at DC, unity and a maximum at ω0):

```
R1 = A0φ0 + A1φ1 + A2φ2
R2 = −A0 + A1 + 4(φ0−φ1)·A2
B2 = (R1 − R2·φ1) / (4φ1²);   B1 = R2 + 4(φ1−φ0)·B2
b1 = −½√B1;   b0 = ½( √(B2 + b1²) − b1 );   b2 = −b0 − b1
```

The "even simpler fits" in §5 of the paper match at Nyquist instead of ω0. I tested them and they are worse in band.

**Orfanidis** (prescribed Nyquist gain, JAES 1997; formulas as transcribed in Vicanek §3.3) needs
`f0 < (1 − 1/(2Q))·f_Nyquist` and broke down for HF bells in my tests. Don't use it as the main method.

### 3.3 Generalisation to any analog section, and the improvements tested [checked]

Every shape in §2 factorises into analog biquads `Ha(s) = (β2 s² + β1 s + β0)/(s² + α1 s + α0)`. A uniform matcher:

1. Poles: impulse invariance with `ω0 = √α0 / fs` and `Q_pole = √α0 / α1` (formulas above).
2. Numerator: `B0 = A0·|Ha(0)|²` (DC), `B1 = A1·|Ha(jπfs)|²` (Nyquist; drop this for a section with a zero at
   Nyquist), and B2 from the magnitude at a third frequency:
   `B2 = (|Ha(ω_m)|²·Aφ(ω_m) − B0φ0 − B1φ1)/φ2`, with ω_m = the section's natural frequency, clamped to ≤ 0.9π.
   This "3-point" fit is simpler, but it is less accurate in band than Vicanek's derivative condition (table below).
3. Or fit B0, B1, B2 by weighted least squares of `Bφ − |Ha|²·Aφ` on about 150 log-spaced points, with relative
   weights `1/(|Ha|²·Aφ)`. That is a 3×3 linear solve ("iiLS" below).
4. **Cuts by inverting the boost.** Design a bell or shelf *cut* as the reciprocal of the matched *boost*
   (`b ↔ a`, then normalise). The analog cut is exactly the boost's inverse, and a boost's poles (narrow) map much
   better than a deep cut's wide poles. This halves to thirds the worst errors of cuts, and it is free.

Max |error| in dB against the analog bell. 336 bells: f0 ∈ {50, 200, 1k, 3k, 5k, 10k, 15k}, Q ∈ {0.3…10},
G ∈ {±3, ±6, ±12, ±24}, fs = 44.1 kHz, cuts by inverted boost:

| Method | f0 ≤ 2.5 kHz, error below 5 kHz (max) | f0 ≤ 5 kHz, error below 10 kHz (max) | All, error below 20 kHz (p50 / p90 / max) |
|---|---|---|---|
| RBJ / BLT (reference) | — | ≈1.5–4 dB | several dB |
| **Vicanek peak + inverted cut** | **0.004** | **0.066** | 0.04 / 0.79 / 1.3 |
| 3-point (DC, centre, Nyquist) | 0.13 | 0.47 | 0.06 / 0.75 / 1.7 |
| iiLS numerator | 0.04 | 0.24 | 0.02 / 0.32 / 0.73 |

Reading: **Vicanek + inverted cut is essentially exact** (≤ 0.07 dB) wherever the band sits below about fs/9 and
the error is read below fs/4, and it has the "small deviation above 18 kHz" signature of the manual's figure. The
least-squares numerator spreads the HF error more evenly, at the cost of in-band accuracy. Recommended: Vicanek for
bells and shelves. If the deviation near Nyquist matters (bands above about 10 kHz at 44.1/48 kHz), blend towards
iiLS as f0 rises (e.g. a crossfade of B over 8–14 kHz).

Cuts (Butterworth cascades of matched sections; error where the analog response is above −24 dB) [checked]:

- **High pass** (Vicanek HP per section, matched one-pole for odd orders): ≤ 0.01 dB up to f0 = 5 kHz at any slope,
  ≤ 0.1 dB at 10 kHz, and 0.3–0.7 dB at 15–18 kHz for 12 dB/oct (less for steeper slopes).
- **Low pass**: exact for f0 ≤ 1 kHz. For f0 ≥ 5 kHz, Vicanek's LP (one zero) errs by 1–4 dB near Nyquist; iiLS
  gives 0.3–1 dB for 12–48 dB/oct up to 10 kHz, and 1.5–3 dB for 96 dB/oct at 15–18 kHz. This is the hardest case
  for any zero-latency design, and Pro-Q's ZL can't be exact there either (§3.1). Use iiLS for LP sections with
  f0 > fs/10.
- **Higher-order bells** (sections from §2.1, each matched with iiLS): 0.001 dB at 1 kHz for 24–96 dB/oct,
  0.16 dB at 8 kHz/48 dB/oct, 0.37 dB at 15 kHz/48 dB/oct.

**Frequencies at or above Nyquist** (allowed up to 30 kHz): impulse invariance aliases a pole pair whose damped
frequency `√(1−q²)·ω0` exceeds π. For such a section, or whenever ω0 > 0.9π, fit both poles and zeros with the
5-unknown least squares (A1, A2, B0, B1, B2 with A0 = 1, iterated with relative weights; then the a/b formulas
above). Only the skirt below Nyquist matters there, and a gentle biquad represents it well. If the fit isn't
realisable (a negative square root), fall back to a first-order shelf matched at DC and Nyquist.

### 3.4 Matched one-pole shelf (Vicanek 2019)

Source: https://www.vicanek.de/articles/ShelvingFits.pdf. Use it for every first-order section (6 dB/oct shelves and
Flat Tilt). High shelf `H(s) = (1 + √G·s)/(1 + s/√G)`, with `s = j·f/fc` and f, fc in units of Nyquist:

```
α = (2/π²)·( 1/fm² + 1/(G·fc²) ) − 1/φm
β = (2/π²)·( 1/fm² + G/fc² ) − 1/φm          fm = 0.9 (match point), φm = 1 − cos(π·fm)
a1 = −α / ( 1 + α + √(1 + 2α) )
b  = −β / ( 1 + β + √(1 + 2β) )
b0 = (1 + a1)/(1 + b),  b1 = b·b0             H(z) = (b0 + b1 z⁻¹)/(1 + a1 z⁻¹)
```

(The version with fm = 1 uses `α = (2/π²)(1 + 1/(G fc²)) − ½`.) A low shelf is the high shelf with 1/G, scaled by G.
Plain one-pole LP/HP cuts [checked]: pole `p = e^{−ω0}`. For LP, `b0 = ((1−p) + (1+p)·H_ny)/2`, `b1 = (1−p) − b0`.
For HP, `b0 = −b1 = (1+p)·H_ny/2`. Here `H_ny` is the analog magnitude at Nyquist.

### 3.5 Matched two-pole Butterworth shelf (Vicanek 2024/2025)

Source: https://www.vicanek.de/articles/2poleShelvingFits.pdf. This is exactly Pro-Q's 12 dB/oct shelf at Q = 1. It
matches at DC, at Nyquist, by maximal flatness, and at two frequencies
`f1 = fc/√(0.160 + 1.543fc²)` and `f2 = fc/√(0.947 + 3.806fc²)` (Nyquist units). It works even for fc above Nyquist,
with < 1 dB error at 20 dB of gain. The paper's appendix pseudocode (high shelf; the low shelf uses 1/G and scales b
by 1/g) is directly usable:

```
fc4 = fc^4;  hny = (fc4 + g)/(fc4 + 1/g)
for i in 1,2:  fi4 = fi^4;  hi = (fc4 + fi4*g)/(fc4 + fi4/g);  phii = sin(π/2·fi)^2
d1 = (h1−1)(1−phi1); c11 = −phi1·d1; c12 = phi1²(hny−h1)
d2 = (h2−1)(1−phi2); c21 = −phi2·d2; c22 = phi2²(hny−h2)
alfa1 = (c22 d1 − c12 d2)/(c11 c22 − c12 c21);  aa1 = (d1 − c11 alfa1)/c12;  bb1 = hny·aa1
aa2 = (alfa1 − aa1)/4;  bb2 = (alfa1 − bb1)/4
v = (1+√aa1)/2; w = (1+√bb1)/2; a0 = (v + √(v²+aa2))/2
a1 = (1−v)/a0; a2 = −aa2/(4a0²); b0 = (w + √(w²+bb2))/(2a0); b1 = (1−w)/a0; b2 = −bb2/(4·b0·a0²)
(g = 1.00001 when |1−gain| < 1e−6)
```

For resonant shelves (Q ≠ 1) and M > 2, use the generic §3.3 matcher on the factored sections.

### 3.6 What Pro-Q's ZL most likely is [inferred]

It is IIR sections matched to the analog magnitude. Vicanek's method fits every published detail: "most efficient
mode", zero latency, the error confined to the top of the spectrum for a 15 kHz bell, and "almost decramped".
FabFilter don't say which method they use. Pro-Q 4 claims "improved analog matching in zero latency and natural phase
mode" [FF], which confirms that Pro-Q 3's ZL wasn't exact. One KVR user claims "Pro-Q oversamples"; it is
unsubstantiated, and ZL reports 0 latency.

Practical consequence: **in ZL mode, "within 0.1 dB of Pro-Q" is achievable below roughly fs/4 for typical
settings, and can't be verified above it**, because Pro-Q's own residual is unknown. The exact reference is the
analog curve, which Natural Phase and Linear Phase reach.

---

## 4. Structure and parameter smoothing (zipper-free, modulation-safe)

Pro-Q glides smoothly. FabFilter even stress that frequency changes in Linear Phase have "no zipper effects
whatsoever" [FF]. For IIR modes, use the **TPT state-variable filter** (Simper/Zavalishin). It stays stable and quiet
when its coefficients change every sample. A direct-form biquad does not: it clicks, and its state means different
things when the coefficients jump.

### 4.1 Simper's linear trapezoidal SVF

(A. Simper, *Solving the continuous SVF equations using trapezoidal integration and equivalent currents*, Cytomic,
2013, `SvfLinearTrapOptimised2.pdf`.) The coefficients are recomputed whenever (g, k) change:

```
a1 = 1/(1 + g(g + k));  a2 = g·a1;  a3 = g·a2
per sample (v0 = input):
  v3 = v0 − ic2eq
  v1 = a1·ic1eq + a2·v3            // band pass
  v2 = ic2eq + a2·ic1eq + a3·v3    // low pass
  ic1eq = 2v1 − ic1eq
  ic2eq = 2v2 − ic2eq
  out = m0·v0 + m1·v1 + m2·v2
```

The standard (BLT) designs, with `g = tan(π fc/fs)`, `k = 1/Qr`, `A = 10^(G/40)` [checked against RBJ to 1e−15]:

| Type | g | k | m0 | m1 | m2 |
|---|---|---|---|---|---|
| LP | tan | 1/Qr | 0 | 0 | 1 |
| HP | tan | 1/Qr | 1 | −k | −1 |
| BP (unity peak) | tan | 1/Qr | 0 | k | 0 |
| Notch | tan | 1/Qr | 1 | −k | 0 |
| Bell | tan | 1/(Qr·A) | 1 | k(A²−1) | 0 |
| Low shelf | tan/√A | 1/Qr | 1 | k(A−1) | A²−1 |
| High shelf | tan·√A | 1/Qr | A² | k(1−A)A | 1−A² |

### 4.2 Decramped coefficients in the SVF: map any biquad onto (g, k, m0, m1, m2) [checked]

The SVF only realises BLT poles, but any stable digital pole pair *is* the BLT image of some (g, k). And LP, BP and HP
span all numerators. So every matched biquad from §3 can run in the SVF. Given `b0, b1, b2, a1, a2` (with a0 = 1):

```
g  = √( (1 + a1 + a2) / (1 − a1 + a2) )
k  = 2(1 − a2) / √( (1 + a1 + a2)(1 − a1 + a2) )
D  = 1 + g·k + g²
m0 = (b0 − b1 + b2)·D / 4
m2 = (b0 + b1 + b2)·D / (4g²) − m0
m1 = (b0 − b2)·D / (2g) − m0·k
```

I simulated the SVF with these against `lfilter(b, a)` on a Vicanek matched bell: the impulse responses agree to
1.1e−16. First-order sections use the one-pole TPT (`G = g/(1+g)`, `v = (x − s)·G`, `lp = v + s`, `s = lp + v`,
`hp = x − lp`). From a digital pole p: `g = (1−p)/(1+p)`. Mix `out = m0·x + m1·lp` to realise `(b0 + b1z⁻¹)/(1 − pz⁻¹)`.

### 4.3 The smoothing scheme (real time, no allocation)

- **Parameters** (frequency in log2 Hz, gain in dB, Q in log2, dynamic gain in dB) are smoothed with a one-pole
  glide of about 20–40 ms on the message → audio boundary. The glide shouldn't be audible as a lag; it only removes
  steps.
- **Control rate**: every 16 or 32 samples, per band, recompute the matched coefficients from the smoothed
  parameters (exp, cos and sqrt: a few hundred flops per section). Convert them to (g, k, m0, m1, m2) and **linearly
  interpolate those per sample** across the block. Interpolating g and k (both > 0) keeps every intermediate filter
  stable. Interpolating raw b/a coefficients doesn't guarantee that.
- **Precision**: compute coefficients in `double`, because Vicanek's √B1 loses accuracy in float (the paper says so).
  Run the SVF state in double too: 96 dB/oct and Brickwall sections at 20 Hz have poles within 1e−4 of z = 1.
  Flush denormals (JUCE `ScopedNoDenormals`).
- **Preallocated**: at most 24 bands × 8 sections (96 dB/oct bell or cut) × channels. Fixed arrays sized at
  `prepareToPlay`. The audio thread never allocates.
- **Bypass, enabling or disabling a band, changing its shape or slope**: crossfade the band's output against its
  input over about 10–20 ms. Its section count changes, so its state can't carry over. Pro-Q soft-bypasses globally
  too [FF].

---

## 5. Natural Phase

### 5.1 What is known

- [FF] It "not only perfectly matches magnitude response of analog EQing, but also closely matches the analog phase
  response … even at the lowest frequencies and highest Q settings, without introducing noticable pre-ring or long
  latency". In the manual's 15 kHz bell figure the magnitude matches analog "precisely", and the phase does too
  "apart from a very small, inaudible deviation above 20 kHz".
- [FF staff] "Natural Phase matches the shape exactly".
- [user] "all instances of Q3 in Natural phase … show the same 7.3 ms latency, regardless of the filter(s)"
  (FabFilter forum). Another report gives Natural Phase 330 samples. So the latency is **fixed** at
  **≈ 7.3 ms ≈ 320–330 samples at 44.1 kHz**, and presumably constant in ms across sample rates.
- [FF] Dynamic bands work in Natural Phase with the same attack and release as Zero Latency (only linear phase
  differs), so its dynamic path can't wait on a long kernel.

### 5.2 Why a pure delay is enough, and the design [inferred, checked]

The analog response `Ha(ω)` is causal and minimum phase. A digital system can only reproduce it exactly near Nyquist
as `Ha(ω)·e^{−jωD}` with some delay D (§3.1: the phase at Nyquist must be 0 or π). The matched IIR is already
`≈ Ha` everywhere except near Nyquist, so the remaining correction is short in time:

```
H_NP(ω) = H_iir(ω) · C(ω),     C(ω) = e^{−jωD} · Ha(ω) / H_iir(ω)
```

- `H_iir`: the ZL filters (§3), all bands, run as usual (sample-accurate dynamics, no added latency).
- `C`: an FIR of length `2D+1`, designed by frequency sampling. Evaluate `Ha` (product of every band's analog
  prototype, complex) and `H_iir` (product of the digital sections) at the N/2+1 bins of an N = 4096–8192 FFT. Form
  C, set the Nyquist bin to its real part, take the inverse real FFT, window it with a Hann window of length 2D+1
  centred on D, and convolve.
- Use matched (not BLT) IIR sections, so that `H_iir` has no zeros where `Ha` has none (BLT low passes have a zero at
  Nyquist, which would make C blow up).

Accuracy [checked; 44.1 kHz; magnitude and phase error against the analog curve plus delay, 20 Hz–20 kHz]:

| Case | D = 16 | D = 32 | D = 64 | D = 128 |
|---|---|---|---|---|
| Bell 15 kHz, Q 1, +12 dB | 0.064 dB / 0.4° | 0.018 / 0.1° | 0.003 / 0.0° | 0.001 |
| Bell 15 kHz, Q 8, −15 dB | 0.10 / 0.5° | 0.060 / 0.3° | 0.025 / 0.1° | 0.008 |
| 18 kHz Q 2 +10 & 60 Hz Q 4 +8 | 0.115 / 0.3° | 0.031 / 0.1° | 0.007 / 0.0° | 0.002 |
| 5 kHz Q 0.5 +12 & 12 kHz Q 4 −10 | 0.024 / 0.2° | 0.011 / 0.1° | 0.003 / 0.0° | 0.001 |

So D = 64 is already analog-exact for practical purposes. To *behave* like Pro-Q (the same reported latency, the same
alignment against parallel tracks), use **D = round(0.0073·fs)** (322 at 44.1 kHz, 350 at 48 kHz, 701 at 96 kHz). The
correction is then even more exact, and its "pre-ring" is limited to the HF part of the correction, which is
inaudible. Low-frequency, high-Q bands are handled by the IIR, so the FIR stays short "even at the lowest frequencies
and highest Q settings" [FF]. That is exactly what a purely FIR natural-phase mode couldn't do.

Implementation notes:

- **Updating C**: recompute on a background thread when parameters change (24 bands × ~4k bins of complex
  evaluation + one FFT: well under 1 ms). Hand the result over through a lock-free double buffer, and **crossfade**
  between the old and new FIR outputs over one block (64–256 samples). During a crossfade run two FIRs.
- **Bands that don't need correcting**: a band whose f0 < fs/16 contributes `Ha/H_iir ≈ 1`. Skip its term in C, or
  even skip C entirely when every band is low. Still delay by D, so the latency stays constant.
- **Dynamic bands**: the IIR follows the dynamic gain sample-accurately. C can lag (it is recomputed at about
  50–100 Hz from the smoothed dynamic gain), because it only changes the top octave by fractions of a dB.
- **Convolution**: 2D+1 ≈ 645 taps at 44.1 kHz. Use a uniformly partitioned FFT convolution with 64- or 128-sample
  partitions (latency-free if the first partition is direct-form), or direct form with SIMD (645 MACs/sample/channel:
  fine). `juce::dsp::Convolution` allocates when loading impulses on its own thread. Write a small fixed-size
  partitioned convolver instead, so that kernel swaps are lock-free and crossfaded.
- **Reported latency**: `setLatencySamples(D)`. Global bypass must delay the dry signal by D, which Pro-Q does [FF].

An alternative reading of "Natural Phase" is oversampled IIR with linear-phase resamplers (a pure delay plus a
transition band above 20 kHz, which also fits "deviation above 20 kHz"). The design above reaches the same response
more cheaply and is deterministic. Pro-Q 2-era forum guesses ("acts like linear phase on filters…") are not
technical.

---

## 6. Linear Phase

### 6.1 What is known [FF]

| Resolution | Latency at 44.1 kHz | ms | = L/2 + 1024 with L = |
|---|---|---|---|
| Low | 3072 | 70 | 4096 |
| Medium (recommended) | 5120 | 116 | 8192 |
| High | 9216 | 209 | 16384 |
| Very High | 17408 | 395 | 32768 |
| Maximum | 66560 | 1509 | 131072 |

- "When working with different sample rates, the latency in samples … can change to give you approximately the same
  low-frequency resolution (and the same latency in ms)". So scale L by `fs/44100`, rounded to a power of two
  (×2 at 88.2 and 96 kHz).
- L/R and M/S bands together: "two separate stages: first the L/R stage, then the M/S stage … this will double the
  latency".
- Dynamic EQ works only up to High, with attack and release "slightly different". Frequency changes have no zipper.
  CPU "doesn't change much with the different linear-phase processing modes". A forum report (Live 10) found the
  real delay of Maximum (1.362 s) differed from the reported 1.509 s: that was a host bug report.

### 6.2 The inferred architecture

The latency figures decompose exactly as **L/2** (the centre of a symmetric linear-phase kernel of length L) **plus
1024** (one block of uniformly partitioned overlap-save convolution with B = 1024). Proposal:

1. **Target magnitude** `T(f) = ∏ |Ha_band(f)|` over all bands of the stage, using the **analog** prototypes
   (decramped by construction, exact). It includes the output gain, but leave Auto Gain to a separate scalar.
   Evaluate it on the L/2+1 bins of an L-point FFT. For Brickwall use the elliptic magnitude, or an ideal step with a
   ~1/12-octave raised-cosine edge to limit the pre-ring.
2. **Kernel**: real, zero-phase spectrum → inverse FFT (L points) → circular shift by L/2 → window (Blackman-Harris
   or Kaiser β ≈ 8–10) → kernel `h[0..L−1]`, symmetric about L/2.
   The window costs resolution. The effective low-frequency resolution is about `k·fs/L`, with k ≈ 2–4 for the window
   (Low ≈ 20–40 Hz). That is why FabFilter says Low is for "low Q settings, or when only changing the mid-high part".
   Optional refinement: frequency-sample at 2L and design by least squares, which is slightly better than windowing.
3. **Convolution**: uniformly partitioned overlap-save, block B = 1024, FFT size 2048, P = L/1024 partitions
   (4…128) with a frequency-domain delay line. Latency is `B + L/2`, matching Pro-Q. Cost per block is P complex MACs
   × 1025 bins + 2 FFTs.
4. **Parameter changes**: rebuild the kernel's spectrum (P partitions) on a worker thread. At the next block boundary
   swap it in, and **crossfade the old and new kernels' outputs over that block** (compute both for one block).
   Without the crossfade, the frequency-domain delay line mixes kernels and clicks. This is the "no zipper" property.
5. **Dynamic bands** (Low, Medium, High only): rebuild the kernel **every block** from each dynamic band's
   current smoothed gain. A dynamic band's gain then changes at most every 1024 samples (23 ms) with a crossfade, which
   explains "attack and release slightly different". Very High and Maximum rebuild 32k/128k-point kernels, which would
   cost too much every block, so dynamics are disabled there as in Pro-Q. To save work, keep each band's static
   response cached, and only recompute the product when a dynamic gain changes by more than about 0.05 dB.
6. **Stages**: stage 1 is Stereo + L-only + R-only bands (per channel L and R kernels, the stereo bands in both).
   Stage 2 encodes M/S, applies the M and S kernels and decodes. Stereo bands can go into either stage (they commute
   with the M/S matrix), so put them in stage 1. Only build stage 2 when an M/S band exists, and report double the
   latency. With no L/R-specific bands, one M/S stage alone gives the single latency.
7. **Pre-ring** is the price, and is the reason Maximum warns of "pre-echo" [FF]. Don't fight it: it is the
   behaviour being cloned.

---

## 7. Dynamic EQ

### 7.1 What is known

- [FF] Bell and shelf bands, any slope. Range is ±30 dB ("negative values apply attenuation, positive values apply
  expansion", meaning upward boost; SOS). "Internally, the dynamic EQ process will trigger on a band-limited version of
  the plugin's input, according to the frequency range the band works on". "A soft knee is used internally …, so it
  can start triggering a little bit below the selected threshold". In auto mode "the threshold is constantly adjusting
  to the level of the current, band-limited trigger signal". "Attack, release and knee all depend on the processed
  audio, the frequency range of the EQ band and the current dynamic range". With an external side chain the side chain
  "is not processed in this way" (not band-limited or M/S-encoded) in Pro-Q 3. Pro-Q 4 band-limits it.
- [FF staff, Frederik] "an advanced algorithm to automatically choose attack/release times for 95% of all dynamic EQ
  cases"; there is deliberately no attack or release control in Pro-Q 3. SOS: "attack, release and ratio are fully
  automatic".
- [user, unconfirmed] attack "roughly 10 milliseconds".
- Gain Scale scales the gain **and** the dynamic range [FF staff, via the UX document].
- The display shows the static curve, the range (red) and the current dynamic gain (a yellow bar).

### 7.2 Proposed design [inferred]

**Trigger signal**: the band's own shape as a weighting, which is "the frequency range the band works on" exactly.
For a bell, use the band-pass `BP(s) = (s·ω0/Qr')/(s² + s·ω0/Qr' + ω0²)` at the band's frequency. Its −3 dB width
equals the bell's half-gain width (`Qr' = Qr`, so BW = ω0/Qr), with the same order as the bell (§2.1 sections with
gain → band pass). For a low or high shelf, use an LP or HP of the shelf's order at the shelf frequency. Run it in the
band's channel domain (L, R, M, S or stereo-linked: max of the two channels). In Pro-Q 3 an external side chain is
used as is (full band). Use matched SVF sections for the trigger too.

**Level detector**: on the trigger, a peak/RMS hybrid in dB (`max(|x|)` smoothed by the attack and release below,
or RMS with a 5–10 ms window). Report it to the UI as the trigger level shown in the threshold slider.

**Gain computer**: soft knee, width K = 6 dB. Overshoot `o = L − T`. The fraction of the range applied is

```
c(o) = 0                               o ≤ −K/2
     = (o + K/2)² / (2K·R_span)         |o| < K/2          (quadratic knee)
     = (o) / R_span                     o ≥ K/2,  clamped to ≤ 1
band gain (dB) = G + c · Range        (Range < 0: compress the band, > 0: expand it upwards)
```

`R_span` (the level above threshold that gives the full range; ≈ an internal ratio) is about 2·|Range|, i.e. ratio ≈ 2:1
until the range is reached. "The current dynamic range" changes the knee in Pro-Q. As a start, use
`K = clamp(|Range|/2, 3, 10) dB`.

**Time constants** (program dependent, as described): attack ≈ max(10 ms, 2/f0), release ≈ max(100 ms, 20/f0),
with an adaptive release: faster when the over-threshold level falls quickly, slower after a long gain reduction
(e.g. the release time scaled by 1 + c_avg). Smooth the band gain in dB with these (separate attack and release
one-poles). This is a design, not a measurement. Tune it by ear against the "95%" claim.

**Auto threshold**: track the trigger's long-term level with an asymmetric average (rise ≈ 1 s, fall ≈ 3 s, in dB)
and set `T = L_avg + 4 dB` (+ the knee). Transients and resonant build-ups above the band's own average then trigger,
which is what the auto mode is described as doing. While the level is silent (< −80 dBFS), freeze the threshold.

**Look-ahead**: none, since dynamic bands keep zero latency in ZL [FF]. In NP the D samples of delay could serve as
look-ahead for the dynamic gain (the IIR runs on the delayed signal, the detector on the undelayed one). That is an
*optional* improvement Pro-Q doesn't claim.

**Applying the gain without zipper noise**: the dynamic gain (dB) is one more smoothed parameter in §4.3.
Recompute the band's matched coefficients every 16–32 samples, map them to SVF form and interpolate per sample.
With a bell in SVF form only k and m1 change with gain (BLT case). With matched coefficients all five change, which
is still smooth. Per-sample recomputation isn't needed: at 32 samples the gain changes by < 0.1 dB per update
for any attack ≥ 5 ms.

**Displaying the dynamic curve**: draw the static curve, the range envelope (G … G+Range), and the curve at the
current dynamic gain.

---

## 8. Stereo placement: Stereo, Left, Right, Mid, Side

[FF] Per band: "process only the left, right, mid or side information". Linear phase runs an L/R stage then an M/S
stage. In ZL/NP everything is IIR, so it has the same structure without the latency:

```
stage 1 (L/R domain):  L' = Π(L-bands ∪ stereo-bands)(L),   R' = Π(R-bands ∪ stereo-bands)(R)
stage 2 (M/S domain):  M = (L' + R')/2,  S = (L' − R')/2
                       M' = Π(M-bands)(M),  S' = Π(S-bands)(S)
                       L_out = M' + S',  R_out = M' − S'
```

Use the `/2` encoding with plain-sum decoding, so a mono signal through a Mid band gets exactly the band's gain.
Skip stage 2 when there are no M/S bands. In NP, compute the correction FIR C per channel path: L and R from the
stage-1 bands, then M and S from the stage-2 bands, each with its own C, with the same delay D in both stages
(or D only once if one stage is empty). The EQ display groups curves by channel, so compute one analog curve per
domain for drawing.

Mono tracks: placement is ignored (only stereo bands apply) [FF]. Surround (9.1.6 speaker selection) is out of scope.

---

## 9. Auto Gain and Gain Scale

### 9.1 What is known [FF]

"Pro-Q automatically compensates for increase or loss of gain after EQ'ing … the applied make-up gain is an
educated guess based on the current EQ settings, and is not a dynamic process based on actually measured levels."
Pro-Q 3's changes: "Improved Auto Gain with channel weighting and an estimated correction of dynamic gain for a better
overall gain". Gain Scale "scale[s] the effect of the gain settings of all curves … only … Bell and Shelving". Per the
UX document it runs 0–200% and scales the dynamic range too.

### 9.2 Proposed algorithm [inferred]

A weighted power average of the curve over a "typical programme" spectrum:

```
f_k: 1/12-octave grid, 20 Hz … 20 kHz
W_k = P(f_k) · K(f_k)²         P: pink spectrum (equal power per octave: uniform on the log grid)
                               K: the ITU-R BS.1770 K-weighting magnitude (or a gentle A/ISO-226-like loudness weight)
ΔL  = 10 · log10( Σ_k W_k · |H(f_k)|² / Σ_k W_k )
make-up (dB) = −ΔL
```

- **Channel weighting**: compute ΔL per domain and combine as the expected programme power. Stereo and Mid bands get
  weight 1. Side bands: their |H|² applies only to the side energy, so use `|H_eff|² = (1·|H_M|² + w_S·|H_S|²)/(1+w_S)`
  with w_S ≈ 0.25 (side typically ~6 dB under mid). Left-only and Right-only bands: `(|H_L|² + |H_R|²)/2`.
- **Dynamic gain correction**: for dynamic bands, use the band's long-term average dynamic gain (the gain
  computer's output smoothed over about 1–2 s) instead of the static gain. Lacking that, use `G + Range/2`.
- Cut filters are included (a low cut at 100 Hz lowers ΔL slightly, as pink weighting implies).
- Recompute at control rate on parameter changes. Apply as a scalar gain smoothed over about 50 ms. Never let it
  depend on the measured signal.
- Calibration check (a guess to verify): a +6 dB, Q 1 bell at 1 kHz should give roughly −1.5 to −2 dB of make-up. A
  +6 dB high shelf at 10 kHz should give only about −0.5 to −1 dB (K-weighting and the pink tilt make highs count
  little).

**Gain Scale**: `G_eff = G · scale` and `Range_eff = Range · scale` for Bell, the shelves (Low, High, Tilt Shelf) and
Flat Tilt (Pro-Q 4's note includes it; Pro-Q 3's manual says "Bell and Shelving"). It changes nothing else.

---

## 10. The analyzer, Spectrum Grab, collisions, EQ Match

### 10.1 What is known [FF]

Pre, Post and external (side chain or another instance's post-EQ) spectra. Range 60, 90 (default) or 120 dB.
Resolution "Low … 1024 points, Medium … 2048, High … 4096, Maximum … 8192", where "more incoming samples are needed to
calculate a single spectrum, the update rate will be lower" (so the hop grows with N). Speed is the **release** speed
(Very Slow … Very Fast, Medium by default). Tilt is around **1 kHz**, 4.5 dB/oct by default, "resembling best how
loudness is perceived". Freeze stops the fall and builds a maximum. Collisions highlight areas "where frequencies may
collide with frequencies of the currently selected external spectrum" ("merely an indication"; High or Maximum
resolution recommended for low frequencies). EQ Match averages over time ("normally … not more than 30 seconds"),
uses the analyzer's resolution, and proposes a number of bands with a detail slider. Spectrum Grab creates only Bell
bands, with "an appropriate Q … determined automatically".

### 10.2 Proposed analyzer [inferred]

- **Where**: the audio thread copies pre, post and side-chain samples (mono sum, or max of channels) into lock-free
  FIFOs. The UI thread does all FFT work.
- **FFT**: N ∈ {1024, 2048, 4096, 8192}, scaled by fs/44100 (rounded to a power of two) so the Hz resolution stays the
  same. Blackman-Harris 4-term window (−92 dB sidelobes, which suits the 90/120 dB ranges). Hop = N/2 (the update rate
  falls with N, as FF state).
- **Level**: power per bin, corrected for the window's coherent and ENBW gain so that a full-scale sine reads 0 dB.
  Add the tilt `t·log2(f/1000)` dB.
- **Mapping to pixels**: for each x pixel (log frequency) take the **max** of the bins in its span where bins are
  denser than pixels (mid and high frequencies). Where they are sparser (low frequencies), interpolate between bins
  (Catmull-Rom on dB). Then apply a light 1/24–1/12-octave smoothing in log frequency. Pro-Q's curve is smooth but
  keeps peaks.
- **Ballistics**: attack instant (take the new value if higher). Release as a fall rate in dB/s: Very Fast 120,
  Fast 60, Medium 30, Slow 15, Very Slow 7.5 [inferred placeholders, double-step]. Implement it per displayed point:
  `y = max(new, y − rate·dt)`.
- **Freeze**: `y = max(y, new)` with no release.
- **Display**: the post spectrum as a filled area plus a line; pre as a dimmer fill; external with a light red outline.

### 10.3 Spectrum Grab [inferred]

On the frozen, smoothed post (or pre) spectrum, find local maxima with a **prominence ≥ 6 dB** within ±1/3 octave,
rank them by prominence (weighted by level), and label the top 5–8. On drag, create a Bell at the peak frequency. Its
Q comes from the peak's prominence width: measure the frequencies where the spectrum has fallen by half the
prominence on either side, then use `BW_oct = log2(f_hi/f_lo)` and convert with §1.1 (Q = 1/(√2·sinh(ln2·BW/2))),
clamped to 0.5–12. Gain follows the drag.

### 10.4 Collisions [inferred]

Compare this instance's post spectrum `A(f)` with the external `B(f)`, both long-term-ish (the analyzer's smoothed
dB with about 1 s averaging, tilt applied), on 1/6-octave bands:

```
collide(f) = clamp( ( min(A, B) − (max(Avg_A, Avg_B) − 6 dB) ) / 12, 0, 1 ) · [ |A − B| < 9 dB ]
```

Both signals must be strong (relative to their own average) in the same region and of similar level, which is where
masking is plausible. Draw a red glow with alpha `collide(f)`. In the instance list, show
`Σ collide · weight` per instance. This is "an indication, not exact science" by FabFilter's own words, so any
sensible metric is faithful.

### 10.5 EQ Match [inferred]

1. **Averaging**: accumulate the long-term power spectrum (the mean of |X|², not of dB) of the input and of the
   reference, at the analyzer's N. Ignore frames below −60 dBFS (silence). Enable Match once each has about 10 s
   of non-silent frames, and stop changing noticeably after about 30 s [FF].
2. **Difference**: convert to dB on a 1/48-octave grid, 20 Hz–20 kHz. Smooth each with 1/6-octave smoothing.
   Normalise both by their mean in 100 Hz–10 kHz (matching tone, not loudness). Then `D(f) = Ref − In`, clamped to
   ±24 dB, smoothed again (1/3 octave), with the edges below 30 Hz and above 18 kHz faded to 0 dB.
3. **Fit**: greedy plus refinement. Repeat: find the largest |residual| feature (by area over its half-height
   width). Add a Low or High Shelf if it touches an edge, otherwise a Bell, with gain = the residual peak and Q from its
   half-height width (§10.3). Then refine **all** band parameters (log f, gain, log Q) by Levenberg–Marquardt on the dB
   error over the grid, with the analog magnitudes from §2. Stop when the RMS residual is < 0.5 dB or there are 24
   bands minus the existing ones.
4. **Detail slider**: the bands in order of how much each one reduces the RMS error. The slider picks the first k,
   re-optimised for each k (cache the fits). The default is the smallest k whose RMS residual is < 1 dB.

---

## 11. Recommended implementation

**Shared foundation**

- One analog-prototype module (pure, testable, double precision): for each band, its list of analog sections
  (`{β2, β1, β0, α1, α0}` biquads and first-order sections) per §2, with `Qr = Q/√2`, the symmetric Butterworth shelf
  family, top-section Q, and an elliptic Brickwall. Also a complex `Ha(ω)` evaluator. The display, Linear Phase, the
  Natural Phase correction, Auto Gain and EQ Match all use it, so every mode and the UI agree on the same exact curve.
- One matcher: analog section → digital biquad, per §3. Vicanek peak/LP/HP/BP for the standard sections, the
  one-pole matcher for first order, iiLS for HF LPs and generic sections, a 5-unknown least squares above 0.9·Nyquist,
  and cuts by inverting the boost.
- One runtime structure: TPT SVFs (and one-pole TPTs) fed by the biquad → SVF mapping (§4.2). Coefficients come
  from smoothed parameters every 16–32 samples and are interpolated per sample. State is double.

**Zero Latency**: the matched sections in series per channel domain (§8: stage L/R, then M/S). Expected accuracy
against analog: ≤ 0.07 dB below fs/4 for bells below fs/9; ≤ 0.01 dB for HPs up to 5 kHz; and inevitably 0.3–1.5 dB
in the top octave for strong HF bands and HF low passes (as Pro-Q's own ZL: "small deviation above 18 kHz").

**Natural Phase**: ZL, followed by the correction FIR `C = e^{−jωD}·Ha/H_iir` (§5.2), with D = round(0.0073·fs).
It is rebuilt off the audio thread and crossfaded. Expected accuracy against analog, magnitude and phase:
**≤ 0.03 dB and ≤ 0.2° to 20 kHz**. This is the reference mode for "exact".

**Linear Phase**: zero-phase kernels of L = 4096·{1, 2, 4, 8, 32} × (fs/44.1k rounded to 2^n), with the target from
the analog magnitudes, windowed. Uniformly partitioned convolution with B = 1024. Report latency `L/2 + 1024`, doubled
with an extra M/S stage. Crossfaded kernel swaps. Dynamic bands up to High, rebuilt every block.

**Dynamic EQ**: shape-matched trigger filter, soft-knee gain computer with Range as the cap, program-dependent
attack/release (≈ 10 ms / ≈ 100+ ms, slower at low frequencies), and auto threshold = the long-term trigger level
+ 4 dB. The gain feeds the coefficient smoothing.

**Auto Gain**: the K-weighted, pink-weighted power average of |H|², channel-weighted, with dynamic bands at their
average gain. **Gain Scale** multiplies gain and range for Bell, shelves and Flat Tilt.

**Analyzer**: Blackman-Harris FFT, N = 1024–8192, hop N/2, tilt 4.5 dB/oct at 1 kHz, max-per-pixel with low-frequency
interpolation, release in dB/s. Grab, collisions and EQ Match as in §10.

### 11.1 Tests to write (they pin the maths)

- **Prototypes**: Q → bandwidth (Q 2 → 1.000 oct, 0.943 → 2.00, 0.571 → 3.00). The bell's half-gain points are equal
  at 12, 24, 48 and 96 dB/oct. The shelf's gain at f0 is G/2 for every slope and Q. Cuts give 20·log10(Q/√2) at fc for
  every slope, and no hump at Q = 1. The flat tilt is within 0.05 dB of the line from 20 Hz to 20 kHz. The tilt shelf
  is 0 dB at its pivot.
- **Matching**: the tolerances above against `Ha` at 44.1, 48 and 96 kHz. All coefficients finite and stable over
  the whole parameter grid (f 5 Hz–30 kHz, Q 0.025–40, G ±30, every slope).
- **SVF mapping**: the impulse response equals direct-form `lfilter` to 1e−12. A sweep of f and G at audio rate
  never produces NaN or Inf.
- **NP**: |H_NP·e^{jωD} / Ha| within 0.05 dB and 0.5° (20 Hz–20 kHz) for random 24-band settings. Reported latency
  equals the measured delay of a flat EQ.
- **LP**: the measured delay equals the reported latency for each resolution and sample rate. The magnitude equals
  the target within 0.1 dB above `4·fs/L`.

### 11.2 Open questions to settle with screenshots or the UX document

1. Shelf Q mapping: Q/√2, or compressed ("chosen … to result in a good range")?
2. Q on steep cuts: top section only, or spread with `Q^(1/K)`? Look at the hump shape at 48 dB/oct, Q = 4.
3. Band Pass slope meaning (§2.5).
4. Tilt Shelf gain: a total swing of G, or ±G?
5. Flat Tilt: G/5 dB/oct (user measurement) or G/10 (unofficial clone)?
6. Odd slopes (18 and 30 dB/oct) on bells and notches.
7. Gain-Q interaction strength.
8. Analyzer release rates.

---

## 12. How the [checked] claims were checked

Throwaway NumPy/SciPy scripts (not in the repo), at fs = 44.1 kHz unless stated:

- Vicanek peak, 3-point and iiLS matchers against the analog bell over the grid in §3.3, with and without inverted
  cuts.
- Matched Butterworth LP/HP cascades of 6–96 dB/oct at 30 Hz–18 kHz.
- The higher-order bell built by band-transforming the symmetric shelf: half-gain points, per-section matching error.
- Orfanidis for comparison (unstable near Nyquist, as the paper's condition predicts).
- Matched peaking at 2× the sample rate (≤ 0.74 dB worst case: oversampling alone doesn't make a biquad exact either).
- The biquad → SVF mapping, by simulating Simper's SVF sample by sample against `scipy.signal.lfilter` (agreement
  1e−16). Simper's bell and shelf mixes against the RBJ BLT prototypes (1e−15).
- The NP hybrid: a frequency-sampled correction with N = 8192, Hann window of 2D+1, measured magnitude and phase
  error against the delayed analog response.
- The Butterworth cut Q rules (peak and gain at fc for N = 2…16).
- Elliptic transition widths (`scipy.signal.ellip`, analog).
- The flat tilt lattice (ripple against period and range; the 6.0206 dB/oct correction).

---

## Sources

- FabFilter Pro-Q 3 manual (PDF): https://www.fabfilter.com/help/ffproq3-manual.pdf
- FabFilter Pro-Q 4 manual (PDF): https://www.fabfilter.com/downloads/pdf/help/ffproq4-manual.pdf ;
  band controls: https://www.fabfilter.com/help/pro-q/using/bandcontrols ;
  dynamic EQ: https://www.fabfilter.com/help/pro-q/using/dynamic-eq ;
  processing mode: https://www.fabfilter.com/help/pro-q/using/processingmode
- FabFilter Learn, linear phase EQ: https://www.fabfilter.com/learn/equalization/linear-phase-eq
- FabFilter forum: Pro-Q's Q (√2 factor, octave figures, half-gain points): https://prod.fabfilter.com/forum/topic/3446/band-q
- FabFilter forum: Q values vs REW/cookbook, decramping in NP/ZL, √2: https://prod.fabfilter.com/forum/add-comment?id=3564
- FabFilter forum: the Brickwall is a high-order elliptic filter with ~0.05 dB ripple: https://prod.fabfilter.com/forum/add-comment?id=3330
- FabFilter forum: Brickwall "along the lines of infinite dB/octave": https://prod.fabfilter.com/forum/topic/5941/pro-q3-brickwall-filter-slope
- FabFilter forum: 48 dB/oct low cut, "There's no resonant hump": https://prod.fabfilter.com/forum/add-comment?id=2268
- FabFilter forum: Natural Phase 7.3 ms whatever the filters, crossovers, Q 0.707: https://prod.fabfilter.com/forum/add-comment?id=6153
  and https://prod.fabfilter.com/forum/add-comment?id=6158
- FabFilter forum: linear phase latency report (Live): https://prod.fabfilter.com/forum/add-comment?id=1844
- FabFilter forum: Pro-Q 4 latency, spectral is linear phase: https://prod.fabfilter.com/forum/add-comment?id=7873
- FabFilter forum: dynamic EQ attack/release are automatic (Frederik): https://prod.fabfilter.com/forum/topic/3390/faster-attack-option-for-q3 ;
  https://prod.fabfilter.com/forum/topic/6416/pro-q3-still-doesnt-have-attackrelease-settings-for-dynamic-bands
- FabFilter forum: Flat Tilt gains for 3, 4.5 and 6 dB/oct: https://prod.fabfilter.com/forum/topic/6750/using-pro-qs-flat-tilt-to-mimic-tilt-settings-for-other-analyser-plugins
- Sound On Sound, Pro-Q 3 review: https://www.soundonsound.com/reviews/fabfilter-pro-q-3
- Gearspace, "Pro Q 2 – Zero Latency vs Natural Phase" (330 samples report; not retrievable here, only quoted in
  search results): https://gearspace.com/board/music-computers/1048715-pro-q-2-zero-latency-vs-natural-phase.html
- KVR, "Fabfilter or iZotope?" (unsubstantiated "Pro-Q oversamples"): https://www.kvraudio.com/forum/viewtopic.php?t=579115&start=75
- KVR, Oversampling for an EQ (decramping options): https://www.kvraudio.com/forum/viewtopic.php?t=511566
- M. Vicanek, *Matched Second Order Digital Filters* (2016): https://www.vicanek.de/articles/BiquadFits.pdf
- M. Vicanek, *Matched One-Pole Digital Shelving Filters* (2019): https://www.vicanek.de/articles/ShelvingFits.pdf
- M. Vicanek, *Matched Two-Pole Digital Shelving Filters* (2024/2025): https://www.vicanek.de/articles/2poleShelvingFits.pdf
- M. Holters, U. Zölzer, *Parametric Higher-Order Shelving Filters*, EUSIPCO 2006:
  https://new.eurasip.org/Proceedings/Eusipco/Eusipco2006/papers/1568980789.pdf
- S. J. Orfanidis, *Digital Parametric Equalizer Design With Prescribed Nyquist-Frequency Gain*, JAES 45(6), 1997:
  http://www.ece.rutgers.edu/~orfanidi/ece348/peq.pdf
- R. Bristow-Johnson, *Audio EQ Cookbook*: https://www.w3.org/TR/audio-eq-cookbook/
- A. Simper, *Linear Trap SVF* (Cytomic technical papers): https://cytomic.com/technical-papers/
- V. Zavalishin, *The Art of VA Filter Design* (TPT, SVF, Butterworth cascades, shelving from SVF outputs):
  https://www.native-instruments.com/fileadmin/ni_media/downloads/pdf/VAFilterDesign_2.1.0.pdf
- fabcutie (an unofficial clone; its Flat Tilt and Brickwall choices are used only as a contrast):
  https://github.com/danmcgrath10/fabcutie/pull/5
