# EchoBoy: the DSP behind its sound

How to recreate the *sound* of Soundtoys' EchoBoy (the colour of its repeats) as a native C++/JUCE effect running
per sample on the audio thread. What EchoBoy's controls are and what the manuals say is in
[echoboy-manual.md](echoboy-manual.md); this document is about the signal processing: what each style models,
the measurable character of that hardware, and recipes to compute it cheaply. [Sources](#sources) at the end.

**How sure each number is**, marked on every value:

| Tag | Meaning |
| --- | --- |
| **[P]** | Published: Soundtoys' manuals, a paper, a datasheet or spec, a standard. Linked. |
| **[M]** | Measured on the hardware by a published paper or project (not by Soundtoys). |
| **[D]** | Derived: worked out here from published numbers or physics (the working is shown). |
| **[E]** | Informed estimate: what the hardware is known to sound like, put into numbers. Tune by ear or measure (see [Measuring EchoBoy](#measuring-echoboy-yourself)). |

**Nobody has published measurements of EchoBoy itself** (no frequency responses per style, saturation curves or
Plugin Doctor analyses turned up on Gearspace, KVR, or elsewhere), and Soundtoys never published a style's
internal settings. So every per-style table below is the *hardware's* character, which is what Soundtoys say they
modelled ("I'll hook it up to an analyzer and run sweeps and distortion and spectrum analysis, and then I start
looking at schematics", Ken Bogdanowicz, Tape Op [P]). The most accurate path to *EchoBoy's* numbers is to measure
it, if you have a copy: the protocol is at the end.

A note on the style names: EchoBoy has **Master Tape** (not "Master Echo") and no **Transistor Tape** style. The
transistor tape echo is the **EchoPlex** style (an EP-3, "solid state tape echo" [P]); the tube one is
**Tube Tape** ("a modern tape echo" [P]).

---

## 1. The engine: every style is a preset of the same blocks

The v5 manual says the Style Editor's controls "were used to create the included style presets" [P]. So EchoBoy
is **one engine** (EQ with per-repeat Decay, two saturation stages with a type menu, diffusion, wobble, input and
output drive, Low Cut / High Cut) and a style is a table of values for it. Build the engine; the styles are data.

A "Studio Tape" repeat is darker, dirtier and wobblier than the last because the filters, the saturation and the
wobble are **inside the feedback loop** [P: v5 manual's history section; "Decay Sat", "Loop" diffusion, Wobble
"FB" switch]. The recommended signal flow, per channel:

```
             ┌──────────────────────────── feedback ──────────────────────────────┐
             │                                                                    │
 x ─► Input ─┴►(+)─► RECORD STAGE ─► write ║ DELAY LINE ║ read ─► PLAYBACK STAGE ─┬─► tap
     (drive)        compressor (BBD)       ║  (tape)    ║ (wow, flutter,          │
                    pre-emphasis           ║            ║  glide; Hermite)        │
                    Decay Sat (style type) ║            ║                         │
                    de-emphasis            ║            ║  media bandwidth        │
                    BBD nonlinearity       ║            ║  (tape loss / BBD LPF)  │
                                                         expander, noise          │
             ┌────────────────────────────────────────────────────────────────────┘
             │
 tap ──┬─► loop EQ (Decay bands) ─► Low/High Cut ─► [Loop diffusion] ─► loop limiter ─► DC block ─► × Feedback ─► (+)
       │
       └─► out EQ (Gain bands) ─► [Post diffusion] ─► Out Sat ─► Output ─► width / ping-pong ─► mix with dry
```

Why each block sits where it does:

- **Input** drives the record stage, as the analogue input sections did ("designed to replicate the way true
  analog input sections respond" [P]); it affects only the wet path [P].
- **Decay Sat** is in the loop: each repeat is driven again [P (name, and the v1/v5 descriptions); placement D].
  **Out Sat** is once, on the output [P/D].
- **The media bandwidth** (tape playback losses, a BBD's filters) is in the loop, because every repeat physically
  goes through record and playback again [D]. It is the main reason repeats darken.
- **EQ Gain vs Decay** [D]: put an EQ set to the Decay values in the loop, and one set to the Gain values on the
  output tap. Repeat *n* has passed the loop EQ *n − 1* times, so a shelf's level on repeat *n* is
  `Gain + (n − 1) · Decay` dB, which is exactly the manual's description ("the Gain knob defines how the initial
  delay repeat will sound and the Decay knob defines what will happen with each subsequent repeat" [P]).
  EchoBoy's Decay is labelled −40…+18 [P]; that can't be dB per repeat. Map the knob to roughly ±6 dB per repeat
  at its ends, with fine resolution near zero (most styles need −0.3…−2 dB per repeat) [E].
- **Diffusion** is selectable Loop or Post [P].
- **Time changes**: in *Time* mode the knob changes the delay "like in hardware ... the pitch will audibly change";
  in Note mode "EchoBoy will smoothly crossfade to any new note values" [P].
- **No noise**: EchoBoy has no noise control and no source mentions hiss [P (absence)]. Treat hiss as optional,
  default off (section 3.9).
- **No ducking**: EchoBoy has none [P (absence)]; a recipe is in 3.10 if wanted.

---

## 2. The styles

Each table gives what to implement. Frequencies are −3 dB corners. "Per repeat" values are what the loop does
to each pass. Wobble is given in EchoBoy's own terms (pitch deviation in cents, rate in Hz: its Depth knob reads
Off…1200 and Rate .01…50, inferred to be cents and Hz [P labels]) and as delay modulation in ms. The conversion
(section 3.3): a sinusoidal delay modulation of amplitude *A* seconds at *f* Hz gives a peak pitch deviation of
`2π·f·A` (as a fraction), i.e. `≈ 1731 · 2π·f·A` cents; 0.1 % = 1.7 cents.

### 2.1 The physics that makes tape styles differ

These three facts decide most of the per-style numbers [D, from the cited physics]:

1. **Playback losses scale with tape speed.** Wallace's spacing loss is `e^(−k·d)` with wavenumber
   `k = 2πf / v` (Chowdhury eq. 13–14 [P]), i.e. **−54.6·d/λ dB**, linear in frequency, not in octaves: on a log
   plot it falls off a cliff (−3 dB at f₃, −6 dB at 2f₃, −12 dB at 4f₃). Its −3 dB point is
   `f₃ ≈ 0.055 · v / d`. Examples [D]: 7.5 ips with 1 µm spacing → 10.5 kHz; 2 µm (worn tape, a tired head) →
   5.2 kHz; 4 µm → 2.6 kHz; 15 ips, 1 µm → 21 kHz; 30 ips → 42 kHz. Gap loss `sinc(k·g/2)` (first null at
   `f = v/g`) and thickness loss `(1 − e^(−kδ))/(kδ)` add to it [P]. **"Tape age" is the spacing *d*.**
2. **What sets the delay sets whether the colour follows the time.**
   - Variable-speed machines (**RE-201**): delay ∝ 1/speed, so **longer delays are darker** (`f₃ ∝ 1/delay`) and
     the head bump moves down.
   - Moving-head machines (**Echoplex**: fixed speed, the record head slides [P]) and studio tape slap (fixed
     15/30 ips): **colour is independent of the delay**.
   - BBDs (**Memory Man, DM-2**): the clock changes with the delay but the filters are fixed, so the bandwidth is
     constant while **aliasing and clock whine grow with the delay** (the clock drops towards the audio band).
3. **Tape saturates first at high frequencies.** Recorders boost the treble before the tape (record
   pre-emphasis) and cut it after (playback de-emphasis): NAB 15 ips uses 50 µs (and 3180 µs at the bass), IEC
   15 ips 35 µs, AES 30 ips 17.5 µs [P, standard values]. Loud treble therefore hits the tape's saturation
   first, then gets turned back down: **high-frequency compression**, exactly the "Tape" saturation type ("high
   frequency compression and low-end distortion typical of high quality tape" [P]) and Studio Tape's
   "automatic de-essing on the echo during louder vocal passages" [P]. Recipe in 3.4.

### 2.2 Master Tape: Ampex ATR-102 at 30 ips

"Subtle tape compression and distortion, modeled after the Ampex ATR-102 we have in our lab, running at 30 ips.
High-Fidelity, but smooth and musically pleasing, saturates very nicely" [P].

| Parameter | Value | Basis |
| --- | --- | --- |
| Low end | 1-pole HPF at ~20 Hz; **head bump** peaking +1 dB at ~80–100 Hz, Q ≈ 1, with a small dip (−0.5 dB) an octave above | E (bump frequency scales with speed; the ATR-102 is "very flat" [P]) |
| High end | Flat to 20 kHz: 1-pole LPF at ~25 kHz (just to soften) | E / D (30 ips: spacing-loss f₃ ≈ 40 kHz) |
| Saturation | "Tape" type: AES 17.5 µs pre-emphasis (shelf zero ≈ 9.1 kHz, +6 dB), symmetric soft clip (tanh/erf, or hysteresis), exact de-emphasis. Low drive: THD ≈ 0.3 % at nominal, ~1–3 % at +6…+10 dB | P (curve family) / E (levels) |
| Harmonics | Odd (3rd, 5th): symmetric curve | P (for Studio Tape: "odd harmonic distortion in the low and mid-range") |
| Wow / flutter | 0.02–0.04 % RMS: wow ~0.3–0.5 Hz random; flutter from the capstan, ~5–15 Hz, tiny. ≈ 0.5–1 cent | P (ATR-102 factory spec ~0.04 % RMS at 15 ips; servo capstan, no pinch roller) / E (split) |
| Per repeat | High shelf −0.2 dB at 12 kHz; low shelf −0.3 dB below 40 Hz; a little more saturation each pass (via Decay Sat) | E |
| Noise | ~−75 dBFS if enabled | E |
| Diffusion | None | E |

### 2.3 Studio Tape: ATR-102 at 15 ips

"Subtle distortion and high frequency compression modeled after the ATR-102 running at 15 ips, typical of the
sound of tracking to studio tape" [P]. More saturation adds "odd harmonic distortion in the low and mid-range, and
... a high frequency compression effect ... automatic de-essing" [P]. The best-known style; a classic vocal slap.

| Parameter | Value | Basis |
| --- | --- | --- |
| Low end | 1-pole HPF ~25 Hz; head bump +1.5 dB at ~50–60 Hz, Q ≈ 1 | E |
| High end | 2-pole LPF ~18–20 kHz, Q 0.6 | E / D (15 ips, d ≈ 1 µm: f₃ ≈ 21 kHz) |
| Saturation | "Tape" type: NAB 50 µs pre-emphasis (zero ≈ 3.2 kHz; cap the shelf at +10 dB), symmetric soft clip, exact de-emphasis. Drive so a −6 dBFS vocal is at ~1 % THD at 1 kHz but sibilance at 6–8 kHz is compressed 2–4 dB | P (behaviour) / E (levels) |
| Wow / flutter | 0.04 % RMS (≈ 1 cent) | P (spec) |
| Per repeat | High shelf −0.5 dB at 8 kHz; low shelf −0.5 dB below 60 Hz | E |
| Noise | ~−70 dBFS if enabled | E |

### 2.4 EchoPlex: Maestro Echoplex EP-3 (solid-state)

"One of the true classics. This style is modeled after the EP-3 solid state tape echo" [P]. A tape loop at
"roughly 8 ips" past fixed playback and erase heads and a **record head on a slider**; the slow speed lets moving
the head make "large frequency shifts, including 'sonic booms' and shifting of the tape bias signal into the
audio band" [P, Arnardottir et al.]. Its JFET preamp (a TIS58 JFET [P, Echoplexus project]) is famous on its own.
Emulator makers describe the repeats "losing low end and gaining a shiny, percussive top end with a bit of grit"
as they recirculate [P, Catalinbread's description of the EP-3].

| Parameter | Value | Basis |
| --- | --- | --- |
| Delay range of the hardware | ~60–750 ms (pedal emulations quote 65–750 ms, 80–800 ms) | P (secondary) |
| Low end | 2-pole HPF ~120 Hz (Q 0.7): it thins with each repeat | E (from "losing low end") |
| High end | Mid-presence peak +2 dB at ~3 kHz (Q 0.8), then 2-pole LPF ~6.5 kHz; colour fixed whatever the delay (fixed speed) | E / D |
| Preamp | Slightly asymmetric soft clip (JFET: `tanh(x + 0.15) − tanh(0.15)`), even + odd harmonics, before the tape; output boost ~+3 dB | E |
| Tape saturation | Tape type, 50 µs-ish emphasis (slow tape: HF compression starts low) | E |
| Flutter | Quasi-periodic **capstan** and **pinch wheel** components plus random drift [P]; a reimplementation of that paper uses sines at **3.5 Hz** and **22 Hz** [P, secondary]. Use 3.5 Hz ≈ 4 cents, 22 Hz ≈ 2 cents, plus their 2nd harmonics at half level | P (structure) / E (depth) |
| Wow / drift | Lowpassed noise (1-pole at ~1 Hz), ≈ 3–6 cents RMS | E |
| Time changes | The record head is moved by hand: smooth the target with ~80–150 ms; a fast move is a Doppler "sonic boom" (pitch > 2× when the head runs toward the playback head) | P (behaviour) / E (time constant) |
| Per repeat | Low shelf −1 dB below 150 Hz; slight high-mid lift (+0.3 dB at 3 kHz) then high shelf −0.8 dB above 7 kHz; Decay Sat moderate (grit) | E |
| Self-oscillation | Yes, through the loop clipper | P (hardware) |

### 2.5 Space Echo: Roland RE-201

"Warm and gritty, the RE-201 is a staple sound of dub and reggae ... the unique self-oscillation of the Space
Echo is achievable in EchoBoy utilizing the 'Feedback' control" [P]. A tape loop with a variable-speed motor, a
record head and three playback heads at fixed spacing [P]. Head delay ranges quoted for it: head 1 **60–175 ms**,
head 2 **115–340 ms**, head 3 **175–500 ms** [P, forum]. Downing & Terjesen measured one [M]:

- **Wow**: the spectrum of the delay-time fluctuation "showed a sharp cutoff at approximately 1 Hz"; they
  synthesise it as zero-mean white noise through a 1 Hz lowpass, scaled to the measured variance (the variance
  itself isn't printed). Capstan and pinch-wheel harmonics were measured but not modelled.
- **Speed ballistics**: changing Repeat Rate takes seconds: time constants **1.89 s for increasing delay, 1.07 s for
  decreasing** (the DAFX book gives ≈ 2 s and 1 s), modelled with a leaky integrator. "A gradual speed-up or
  slow-down sound effect across multiple echos, with a corresponding pitch shift."
- **Saturation**: the DAFX book suggests the Gaussian error function `erf(x)` for tape; they measured a ramped
  1 kHz sine for the real curve but shipped erf.
- **Bandwidth**: a **2nd-order Chebyshev band-pass** matched to the delay path's response in the DAFX book; "unfiltered
  feedback can produce undesirable low-frequency distortion, and the self-oscillation which occurs at particular
  frequencies at high feedback settings is integral". Filter + saturation gave "a progressively warming-sounding
  series of echos at high feedback settings".
- **Tone stack**: a Baxandall bass/treble around a **750 Hz** crossover, on the output.

| Parameter | Value | Basis |
| --- | --- | --- |
| Band-pass (in loop) | 2nd-order Chebyshev-like band-pass (≈ 1 dB ripple): HP ~100 Hz, LP ~5 kHz at the shortest delay | M (shape) / E (corners) |
| Bandwidth vs delay | Scale the LP corner with tape speed: `f_LP = 5 kHz · (D_min / D)`, floor 2.2 kHz; the head bump (+1.5 dB, ~120 Hz at D_min) scales the same way | D (physics 2.1) / E |
| Saturation | erf: `y = erf(√π/2 · g·x) / (√π/2 · g)` style normalisation; record stage, in loop; medium drive. Transistor record amp: add a small asymmetry (bias 0.05) | M/P (erf) / E |
| Wow | 1 Hz-lowpassed noise, ≈ 0.2–0.3 % peak (≈ 4–5 cents; ≈ 0.5–0.7 ms at 0.7 Hz) | M (shape) / E (depth) |
| Flutter | Capstan harmonics ~5–10 Hz, 0.05–0.1 % (1–2 cents) | E |
| Time changes | Asymmetric one-pole on tape **speed**: τ = 1.9 s while slowing (delay growing), 1.1 s while speeding up | M |
| Per repeat | High shelf −1 dB above 4 kHz; low shelf −0.7 dB below 120 Hz | E |
| Self-oscillation | Loop gain above 1 with the clipper in the loop: it settles on the frequency where the band-pass peaks, at a multiple of 1/loop-delay (3.8) | M (behaviour) / D |
| Noise | ~−60 dBFS hiss if enabled (cheaper machine, slow tape) | E |

### 2.6 Tube Tape: "a modern tape echo"

"Lot's of high mids and distortion" [P]. The best-known modern tube tape echo is Fulltone's **Tube Tape Echo**
(12AX7s for record and playback, a 12AT7 for erase and bias; its Hi speed gives "lots of highs, less bass", Lo
speed is "warm, with lots of bass, less highs, and a slight warble" [P]); that it's the one modelled is an
inference.

| Parameter | Value | Basis |
| --- | --- | --- |
| Low end | 2-pole HPF ~140 Hz | E |
| Mids | Peaking +3.5 dB at ~2 kHz, Q 0.9 ("high mids") | P (character) / E |
| High end | 2-pole LPF ~7 kHz | E |
| Saturation | Tube: asymmetric, **even harmonics**: `y = tanh(g·x + b) − tanh(b)` with b ≈ 0.3, then DC block; drive higher than tape styles (≈ 3–5 % THD at nominal) | E |
| Wow / flutter | 0.1–0.15 % (≈ 2 cents) wow at ~0.6 Hz random; flutter ~8 Hz, 1 cent | E |
| Per repeat | Mid peak +0.4 dB at 2 kHz (repeats get more "honky"); high shelf −0.7 dB above 6 kHz | E |

### 2.7 Cheap Tape: consumer tape stock (a Soundtoys original)

"Modeled after the characteristics of a variety of vintage consumer-grade tape stock. Bright and very compressed
sounding" [P, v5]; EchoBoy Jr: "the sound of worn out tape, saturated with a mid-range boost" [P].

| Parameter | Value | Basis |
| --- | --- | --- |
| Band | 2-pole HPF ~180 Hz; peaking +3 dB at ~1.2 kHz (Q 0.7); presence shelf +2 dB above 4 kHz; 2-pole LPF ~9 kHz | P (character) / E |
| Compression | Before the tape stage: RMS compressor, ratio ~4:1, threshold −24 dB, attack 3 ms, release 80 ms | P ("very compressed") / E |
| Saturation | Tape type, high drive (THD 3–6 %) | E |
| Wow / flutter | Consumer-machine: wow 0.15–0.25 % (3–4 cents) at ~0.8 Hz; flutter 0.1 % at ~10 Hz | E |
| Per repeat | Mid peak +0.5 dB at 1.2 kHz; high shelf −1 dB above 6 kHz | E |

### 2.8 Binsonette: Binson Echorec (a Soundtoys original)

"A wonderful warbly, compressed echo sound, modeled from several Binson Echo-Rec and Echo-Rec II units" [P]. The
Echorec records on a spinning magnetic drum read by several heads [P], with valve electronics.

| Parameter | Value | Basis |
| --- | --- | --- |
| Band | 2-pole HPF ~110 Hz; 2-pole LPF ~4.5 kHz | E |
| Compression | Valve: slow-ish soft compression (ratio 2:1, attack 10 ms, release 200 ms) then mild asymmetric clip | P ("compressed") / E |
| Wobble | **Periodic**, at the drum's rotation rate (assume ~2–4 Hz) with harmonics, plus a little random: ≈ 6–10 cents. The warble is its identity | P ("warbly") / E |
| Per repeat | High shelf −1.2 dB above 3.5 kHz; low shelf −0.5 dB below 150 Hz | E |
| Diffusion | A trace (Loop, small): drum heads smear slightly | E |

### 2.9 TelRay: Tel-Ray Adineko oil can

"Operating off a mechanism consisting of a magnetic brush head, a rotating insulated belt around a can, and lots
of dielectric oil sloshing about, the Tel-Ray produces a dark and warbling/wavering echo" [P]; v1: "the ultra-dark
liquid sound of vintage oil can echo" [P].

| Parameter | Value | Basis |
| --- | --- | --- |
| Band | 2-pole HPF ~200 Hz; 3-pole LPF ~2.2 kHz (darkest style in the set) | P ("ultra-dark") / E |
| Wobble | Deep and irregular: periodic at the can's rotation (~3–5 Hz) **and** random walk (~0.5 Hz): ≈ 10–20 cents total | P ("warbling/wavering") / E |
| "Liquid" | Short Loop diffusion: 2 allpasses, 1–3 ms, g ≈ 0.4 | E |
| Saturation | Soft, moderate; valve-ish asymmetry | E |
| Per repeat | High shelf −2 dB above 1.8 kHz (repeats vanish into murk quickly) | E |

### 2.10 Memory Man: Electro-Harmonix (Deluxe) Memory Man, BBD

"Warm low-bandwidth chorus echo" [P]. The Deluxe Memory Man uses two MN3005 BBDs (8192 stages) for up to
~550 ms, an NE570 compander, and a low-pass filter to remove the clock [P]. A forum measurement: **flat to ~2.5 kHz,
−3 dB at ~3.2 kHz**, a sharp roll-off above 3.5 kHz [P, forum, via a search excerpt]. Its chorus/vibrato modulates
the clock.

| Parameter | Value | Basis |
| --- | --- | --- |
| BBD clock | `f_clk = N / (2·delay)`: 8192 stages at 550 ms → 7.45 kHz, BBD Nyquist 3.7 kHz; at 30 ms → 137 kHz | P (formula, Raffel) / D |
| Low-pass | ~8th-order total (3rd-order anti-alias + 3rd + 2nd-order reconstruction), −3 dB ~3.2 kHz, ≈ −40 dB by 5 kHz | P (structure) / M (corner) / E (exact slope) |
| Low end | 2-pole HPF ~70 Hz (coupling caps) | E |
| Compander | 2:1 compressor before, 2:1 expander after; averaging τ = 10 kΩ · C with C 0.22–1 µF → **2.2–10 ms** | P (Raffel) |
| BBD distortion | Level-independent: Raffel's polynomial (3.5) on the *compressed* signal; aim 1–3 % THD | P (structure) / E (level; Raffel's rule of thumb, 1 % per 1024 stages, gives 8 % for 8192, an upper bound) |
| Noise | Chip S/N ~75 dB (MN3005); added between compressor and expander so it breathes | P (secondary) / D |
| Chorus | Triangle LFO 0.5–3 Hz, ±8–15 cents (Chorus); Vibrato wider | E |
| Per repeat | High shelf −1.5 dB above 2.5 kHz; low shelf −0.5 dB below 100 Hz; repeats "warmer, darker, and slightly lo-fi with each repeat" | P (character, EHX/retail) / E |
| Clock artefacts | Optional: at delays > 300 ms add aliasing by actually resampling at f_clk (Holters & Parker, 3.5) and a faint residue at f_clk | P (method) / E |

### 2.11 DM-2: Boss DM-2, BBD

"THE guitar echo sound ... Produced from 1981-84, the DM-2 is the quintessential bucket-brigade delay. Warm,
resonant, punchy, but clean" [P]. 4096 stages (MN3005, later MN3205), **20–300 ms**, MN3102 clock driver, NE570
compander [P]. MN3205: S/N 67 dB, 0.8 % distortion (MN3005: 1 %) [P, secondary].

| Parameter | Value | Basis |
| --- | --- | --- |
| BBD clock | 4096 / (2 · 0.3 s) = **6.8 kHz** at 300 ms (Nyquist 3.4 kHz: the clock is audible as whine near max); 102 kHz at 20 ms | D |
| Low-pass | Raffel & Smith's "typical echo circuit" values (3rd-order anti-alias, 3rd- and 2nd-order reconstruction, all R = 10 kΩ): computing them gives a combined **−3 dB ≈ 3.3 kHz** and a steep fall (≈ −20 dB at 5 kHz); the 2nd-order "corner correction" section is resonant (Q ≈ 5 at ≈ 4.4 kHz), so the response **bumps up before the corner**: the "resonant" in Soundtoys' description | P (values) / D (my calculation, approximate: the paper's 3rd-order formula was partly garbled in the extracted text; these aren't DM-2's own values) |
| Low end | 2-pole HPF ~90 Hz | E |
| Compander | As Memory Man (2:1/2:1, τ ≈ 5 ms) | P / E |
| Distortion | Clean: ~0.8 % THD level-independent (3.5) | P |
| Modulation | None on the hardware; 0–1 cent clock jitter | P / E |
| Per repeat | Resonant peak +0.4 dB at ~2.8 kHz then high shelf −1.2 dB above 3.5 kHz: repeats stay "punchy" (mids hold) while the top goes | E |
| Noise | −67 dB re. max level, compander-modulated, if enabled | P (chip) |

### 2.12 The other styles

| Style | What to build | Basis |
| --- | --- | --- |
| **Analog Delay** ("warm and lightly distorted", 1970s–80s racks) | BBD chain like DM-2 but wider: 4th-order LPF ~6 kHz, compander, light asymmetric sat | P (char.) / E |
| **Digital Delay** ("just clean and clear") | No filters, no saturation (a transparent clip-limiter at 0 dBFS in the loop only), no wobble | P |
| **Telephone** | Band-pass **300–3400 Hz** (the telephone voice band), 4th-order each side; light hard-ish clip | P (band, ITU-T) / E |
| **AM Radio** ("compressed medium bandwidth") | Band-pass ~120 Hz–4.5 kHz (receiver IF), heavy compression (8:1, fast) | E |
| **FM Radio** ("ultra-compressed and loud") | 30 Hz–15 kHz, **75 µs** pre-emphasis then a fast brickwall limiter then de-emphasis (FM's own HF compression), plus a 3-band compressor ahead | P (15 kHz, 75/50 µs) / E |
| **Shortwave** ("very narrow and staccato") | ~300–2700 Hz, steep; AGC-style fast compressor that pumps; slow fading (amplitude LFO 0.1–0.5 Hz, ±6 dB) | E |
| **Transmitter** (CB, "very distorted and resonant in mid-frequencies") | Band-pass ~400–2500 Hz plus a resonant peak +8 dB, Q 3, at ~1.3 kHz; hard clip with high drive | P (char.) / E |
| **Saturated / Fat / Distressed / Distorted** | Tape-ish band (Studio Tape's) with the saturation type turned up: Saturated = Tape, high; Fat = Warm + low shelf +3 dB at 150 Hz; Distressed = compressor + Dirt; Distorted = Dirt, very high | P (char.) / E |
| **Limited** | A limiter in the loop whose threshold is the Saturation knob ("functions more like a limiter threshold ... pumping") | P |
| **Queeked** ("multi-band compression echo") | 3 bands (crossovers ~250 Hz, 3 kHz), each a fast compressor, in the loop | P / E |
| **Ambient** ("distortion and diffusion together") | Loop diffusion (g ≈ 0.6, size ~20 ms) + Warm saturation + slow random wobble 3 cents | P / E |
| **Diffused** ("ambient reverb-like") | Loop diffusion high (g ≈ 0.7, size ~30–40 ms), little saturation | P / E |
| **Splattered** ("highly reflective reverb") | Post diffusion, short size (~5–10 ms), high g: a burst of reflections per repeat | P / E |
| **Verbed** ("a cheap verb chaser afterwards") | Small Schroeder/FDN reverb after the echo (0.8–1.2 s), fed through the Out Sat so it reacts to Saturation | P / E |
| **Digital Chorus / Analog Chorus / CE-1 / Vibrato** | Short delay 5–20 ms modulated: sine/triangle 0.5–3 Hz, ±5–20 cents; Analog/CE-1 add BBD filtering (~8–10 kHz) and companding; Digital adds 12-bit-ish quantisation; Vibrato 100 % wet | E |

---

## 3. DSP recipes

All rates and times in seconds/Hz; compute coefficients in `prepareToPlay` and when a parameter moves (block
rate), smooth per sample. Allocate every buffer in `prepareToPlay` (`juce::dsp::DelayLine::setMaximumDelayInSamples`
allocates: never on the audio thread). Wrap `process` in `juce::ScopedNoDenormals`.

### 3.1 The delay line and its read

A power-of-two circular buffer, sized for the maximum delay + the deepest wobble + 4 samples of interpolation
margin. Read with **4-point, 3rd-order Hermite** (cheap, smooth, good under modulation) [P, standard]:

```cpp
// x = fractional part in [0,1), ym1,y0,y1,y2 = samples at i-1, i, i+1, i+2 (i = integer read position)
inline float hermite(float x, float ym1, float y0, float y1, float y2) {
    const float c0 = y0;
    const float c1 = 0.5f * (y1 - ym1);
    const float c2 = ym1 - 2.5f * y0 + 2.0f * y1 - 0.5f * y2;
    const float c3 = 0.5f * (y2 - ym1) + 1.5f * (y0 - y1);
    return ((c3 * x + c2) * x + c1) * x + c0;
}
```

- **Allpass (Thiran) interpolation** is flat in magnitude but has state, so it misbehaves when the delay jumps;
  fine for slow wow, not for glides or S/H wobble. Downing & Terjesen switched from linear to first-order allpass
  to kill aliasing under their tape modulation [M]. Lagrange-3 (`juce::dsp::DelayLineInterpolationTypes::Lagrange3rd`)
  is equivalent in cost to Hermite.
- Linear interpolation low-passes noticeably at fractional positions near 0.5 (a "breathing" HF loss as wow
  sweeps): avoid for the clean styles.

### 3.2 Changing the delay time: tape glide, tape transport, crossfade

**(a) Glide (Time mode, every style).** Smooth the *target* delay and read at the smoothed value; the pitch of the
output is `r = 1 − dD/dt` [D]. A one-pole per sample: `D += (D_target − D) · (1 − e^(−1/(τ·fs)))`; asymmetric τ for
tape machines (RE-201: 1.9 s growing, 1.1 s shrinking [M]; EchoPlex ~0.1 s [E]; a generic "analog" 0.15–0.3 s
[E]). Clamp `|dD/dt| ≤ 0.75` so the read never stops or reverses [E].

**(b) The real tape transport (recommended for the tape styles).** A tape echo's delay is the time a point of
tape takes to travel the head gap `L`: `∫_{t−τ}^{t} v(t') dt' = L`. Keep the tape's position as a running sum and
find, each sample, where the read head is in the recorded history [D; Zavalishin & Parker make this constant-time
[P]]:

```cpp
// per sample: v = speed in "head-gap units per second", wow and flutter multiply it
pos[w] = pos[w-1] + v / fs;            // double precision, or rebase periodically
buf[w] = recordStage(input);           // written at sample time w
const double target = pos[w] - 1.0;    // L = 1: the playback head is one gap behind
while (pos[r + 1] <= target) ++r;      // monotonic: amortised O(1) (speed-ups advance r by > 1)
const double frac = (target - pos[r]) / (pos[r + 1] - pos[r]);
out = hermite(frac, buf[r-1], buf[r], buf[r+1], buf[r+2]);
```

What this gives for free [D]: a speed change shifts the pitch of what is *already on the tape* and stops shifting
once fresh tape arrives (the classic tape-echo glide); and wow at a frequency whose period divides the delay
**cancels** (the delay fluctuation is the moving integral of the speed error over one delay time, `|Δτ(f)| ∝
|sin(πfτ)| / (πf)`), so the same wow sounds different at different delay times, as on real machines. Cost: one
extra position buffer. When the tape speeds up past 1× the read skips samples: see the aliasing note in (d).
Multi-head machines (RE-201, Echorec) are several `target`s: `pos − 1`, `pos − 2`, `pos − 3`.

**(c) Crossfade (Note mode, Digital Delay).** Two read taps; on a new time, start the second at the new delay and
equal-power crossfade over 30–50 ms (`g_old = cos(πt/2T)`, `g_new = sin(πt/2T)`) [P (behaviour) / E (time)].

**(d) Aliasing during glides.** Reading faster than real time (`r > 1`) folds content above `fs / (2r)`. The tape
and BBD styles band-limit *before* writing (record-side loss and filters at ≤ 7 kHz), so what's on the "tape" is
already below `fs/(2r)` for `r` up to ~3 at 44.1 kHz: the media filter doubles as the anti-aliasing filter, the
idea Holters & Parker use for BBDs [D/P]. For Digital Delay, accept it, run the loop at 2×, or low-pass the read
at `0.45 · fs / r` while gliding.

### 3.3 Wow, flutter and the Wobble shapes

Units: peak speed deviation `ε` (fraction; flutter specs are usually RMS ≈ peak/√2 for a sine). For delay
modulation at `f` Hz, amplitude `A = ε / (2πf)` seconds [D]. Examples: 0.05 % at 0.5 Hz → 0.16 ms; 0.3 % at
0.7 Hz → 0.68 ms; 0.3 % at 6 Hz → 0.08 ms; 1 % at 3 Hz → 0.53 ms.

Generator, per channel (cheap):

```
wow     = Aw · ( sin(2π·fw·t + φ) · (1 − mix) + OU(t) · mix )        // fw 0.3–1 Hz
OU      : y += sqrt(dt)·N(0,1)·σ;  y += θ·(μ − y)·dt;  then 1-pole LP at ~1–10 Hz
flutter = Af · ( cos(ω t) + 0.35·cos(2ωt + 13π/4) + 0.43·cos(3ωt − π/10) )   // ω = 2π·ff, ff 3–25 Hz
D(t)    = D_glide(t) + wow + flutter         (or multiply the transport speed v by 1 + ε(t) in 3.2b)
```

- The 1 : 0.35 : 0.43 harmonic weights and phases are ChowTape's flutter, captured from a Sony TC-260
  (`amp1 = −230, amp2 = −80, amp3 = −99` (scaled by `1000/fs`), phases 0, 13π/4, −π/10) [P, code]; ChowTape's wow is
  a sine plus an Ornstein–Uhlenbeck process lowpassed at 10 Hz, and its ranges are flutter 0.1–100 Hz
  (`0.1·1000^x`) and wow 0–3.5 Hz (`4.5^x − 1`) [P, code]. Space Echo's measured wow is noise lowpassed at
  ~1 Hz [M]; the Echoplex's is capstan + pinch wheel components (3.5 Hz, 22 Hz [P, secondary]) + drift [P].
- **EchoBoy's Wobble shapes** [P]: Triangle, Sine, Square, Random Walk ("smoothly ramps between random values"),
  Random S/H ("abruptly jumps"). A step in delay is a step in the output (a click), so slew Square and S/H over
  2–5 ms [E]; Random Walk = a new uniform random target every `1/rate` s, approached by cosine interpolation.
- **Sync** [P]: centre = all paths identical; one way = per-path rates detuned (e.g. ×1, ×1.13, ×0.89); the other =
  same rate, phase offsets up to 180° between left and right (L up while R down).
- **Where**: FB switch = modulate the read inside the loop (compounds per repeat); Out switch = a second short
  modulated delay (~5 ms base) on the wet output [P (switches) / D (placement)].
- Keep the random generators cheap and lock-free: xorshift32 per channel; Gaussian via the sum of 4 uniforms.

### 3.4 Saturation curves

All in the record stage (Decay Sat, in the loop) or on the output (Out Sat). Normalise so the small-signal gain
is 1 (so drive changes distortion, not loudness), and put a **DC blocker** (`y = x − x₁ + 0.9995·y₁`, ~3–10 Hz)
after any asymmetric curve: DC inside a feedback loop accumulates.

| Curve | Formula | Character |
| --- | --- | --- |
| tanh (fast) | `x·(27 + x²) / (27 + 9x²)`, clamp `|x| ≤ 3` | Smooth, odd harmonics |
| erf (Space Echo) | `erf(x)`; cheap: `x / sqrt(1 + x²)` is close in shape; or `tanh(1.2·x)` | Tape's magnetisation curve (DAFX book [P]) |
| Asymmetric (tube, JFET) | `tanh(g·x + b) − tanh(b)`, b 0.1–0.4 | Even + odd harmonics; DC → block it |
| Hard-ish (Dirt, Transmitter) | `clamp(x, −1, 1)` blended 50/50 with tanh | Brighter, edgier |
| Limiter types (Clean, Hard/Soft/Warm/Bright Limit, Pump) | Peak/RMS limiter, attack 0.5–5 ms, release 50–300 ms (Pump: release ~150 ms and no look-ahead, so it pumps); Warm = limiter + soft clip; Bright = limiter keyed on a low-passed sidechain so highs pass | P (descriptions) / E |

**"Tape" type (high-frequency compression), the key recipe [D, from 2.1]:**

```
pre  = HighShelf(f0 = 1/(2π·τ), +G dB)    // τ = 50 µs (15 ips) or 17.5 µs (30 ips); G 6–12 dB
y    = deemph( sat( drive · pre(x) ) ) / drive
deemph = HighShelf(f0, −G dB)              // the exact inverse: flat when sat is linear
+ head bump: Peaking(f_bump, +1…1.5 dB, Q 1) after
```

Small signals come out flat; loud highs saturate first and come back compressed; the low end distorts (more
level there pre-emphasis-relative, the "low-end distortion" [P]).

**Real hysteresis** (if the cheap curve isn't enough): Jiles–Atherton, as ChowTape [P]:

```
dM/dt = [ (1−c)·δM·(Man − M) / ((1−c)·δS·k − α·(Man − M)) · Ḣ  +  c·(Ms/a)·Ḣ·L'(Q) ] / (1 − c·α·(Ms/a)·L'(Q))
Q = (H + α·M)/a,  Man = Ms·L(Q),  L(x) = coth(x) − 1/x  (x/3 near 0),  L'(x) = 1/x² − coth²(x) + 1  (1/3 near 0)
δS = sign(Ḣ),  δM = 1 if sign(δS) == sign(Man − M) else 0
Ferric oxide: Ms = 3.5e5 A/m, a = 22e3, k = 27e3, c = 1.7e-1, α = 1.6e-3
```

Solve with RK2 (ChowTape's cheapest stable mode; the paper used RK4) on a 2× oversampled signal, `Ḣ` by the
trapezoidal rule; scale the input so ±1 maps to a few × 10⁴ A/m (see ChowTape's source). It adds the phase lag and
"drag" of real tape and a level-dependent low-end bloom. Costlier (~a few hundred flops per sample) but fine for
two channels.

**Aliasing**: a saturator in a feedback loop aliases on every pass. Cheapest fix: first-order antiderivative
anti-aliasing (ADAA, Parker, Zavalishin & Le Bivic, DAFx-16 [P]): `y = (F(xₙ) − F(xₙ₋₁)) / (xₙ − xₙ₋₁)`, with
`F = log(cosh(x))` for tanh (fall back to `f((xₙ+xₙ₋₁)/2)` when `|xₙ − xₙ₋₁| < 1e-5`). It adds half a sample of
delay; subtract it (and any oversampling filter latency) from the delay so the loop time stays exact.

### 3.5 BBD character

Order, per Raffel & Smith [P] and Holters & Parker [P]:
`input → compressor → anti-alias LPF → BBD (delay + nonlinearity + noise) → reconstruction LPF → expander`.
(Circuits differ on whether the compander sits inside or outside the filters, and whether feedback re-enters
before or after the compressor [P]: mistracking between them is part of the "breathing" sound.)

```cpp
// Compander (NE570/571: ratio 2, averager tau = 10k * C, C 0.22–1 µF -> 2.2–10 ms)
// compressor (feedback): y = x / avg|y|    expander (feed-forward): y = x * avg|x|      [Raffel & Smith]
envC += aC * (std::abs(yC) - envC);          // aC = 1 - exp(-1/(tau*fs)), envC from the compressor's own output
yC    = x * ref / std::max(envC, 1e-4f);     // ref: the level the BBD is driven at (e.g. 0.5)
// ... BBD ...
envE += aE * (std::abs(xE) - envE);
yE    = xE * envE / ref;
```

- **Filters**: 3rd-order Sallen–Key anti-alias, 3rd-order + 2nd-order "corner correction" reconstruction, R = 10 kΩ,
  typical echo-circuit capacitors C1/C2/C3 = 6.8 n/82 n/0.33 n (anti-alias), 2.2 n/33 n/1 n (3rd-order
  reconstruction), 39 n/0.33 n (2nd-order) [P]; cutoffs typically ⅓–½ of the clock, as low as 1.5 kHz in some
  echoes [P]. Raffel's MATLAB script designs the digital IIR from component values (colinraffel.com). Or fit by
  ear: two cascaded TPT SVF low-passes (Q 0.54 and 1.3) + one 1-pole, plus a peaking +3 dB, Q 3 just below the
  corner [E].
- **Nonlinearity**: "about 1 % of harmonic distortion occurs for every 1024 stages" (`THD = 1.01^(N/1024) − 1`),
  and it is **not** a clipping distortion: it barely depends on level, harmonics falling off linearly, the 4th
  and above nearly inaudible [P]. Their fit: `f(x) = x − a·x² − b·x³ + a` for `|x| < 1` (with `1 − a − b` /
  `−1 − a + b` beyond), `a = 1/8`, `b = 1/18` [P] (DC-block after). Apply it to the *compressed* signal: the
  compressor holds the BBD's level steady, which is why the distortion is level-independent [D].
- **Insertion loss**: 0–2 dB at low frequencies, falling to −4…−6 dB at the BBD's Nyquist [P]: a gentle extra
  1-pole at ~0.4·f_clk [E].
- **Noise**: at least 60 dB below the signal [P]; insert it *between* compressor and expander so it rises and
  falls with the music [D].
- **Sampling and aliasing (optional, most authentic)**: Holters & Parker model the BBD as a fixed-length delay
  line of N/2 cells clocked at its own rate, with the input and output filters as partial-fraction sums of
  one-pole sections evaluated at the BBD's sample instants (no separate interpolator): per audio sample, run the
  one-pole sections; at each BBD clock edge, enqueue a weighted sum (input side) or push the output step through
  the output poles [P]. chowdsp_utils ships an implementation (`chowdsp::BBD`). It gives real aliasing and clock
  artefacts at long delays and true clock-rate pitch modulation.

### 3.6 The loop's filters: Low Cut, High Cut, media bandwidth

- Use **TPT state-variable filters** (Simper/Zavalishin), stable when modulated every sample [P]:

```cpp
// setup: g = tan(pi*fc/fs); k = 1/Q; a1 = 1/(1 + g*(g + k)); a2 = g*a1; a3 = g*a2;
float v3 = v0 - ic2eq;
float v1 = a1 * ic1eq + a2 * v3;
float v2 = ic2eq + a2 * ic1eq + a3 * v3;
ic1eq = 2 * v1 - ic1eq;  ic2eq = 2 * v2 - ic2eq;
// low = v2, band = v1, high = v0 - k*v1 - v2;  shelves/peaks: combine (or RBJ biquads at block rate)
```

- **Slopes**: EchoBoy doesn't publish its Low/High Cut slopes or whether they're in the loop [P (gap)]. Choose
  **12 dB/oct, Q 0.707, in the loop** [E]: inside the loop the slope compounds with each repeat.
- **What compounding does** [D]: after *n* passes the −3 dB point of a 1-pole low-pass moves to
  `fc·√(2^(1/n) − 1)` (n = 2: 0.64 fc, 4: 0.44 fc, 8: 0.30 fc); of a 2-pole Butterworth to
  `fc·(2^(1/n) − 1)^(1/4)` (n = 2: 0.80 fc, 4: 0.66 fc, 8: 0.55 fc). So a gentle filter darkens repeats faster
  than a steep one at the same corner, and the corners in the style tables are the *first* repeat's.
- **Media bandwidth** (tape loss, BBD LPF) is a fixed part of the style, separate from the user's High Cut
  ("the effect of the HighCut control depends on the Echo Style" [P]: scale the user's corner within each
  style's range, e.g. High Cut sweeps 1–20 kHz for Digital but 800 Hz–6 kHz for Memory Man [E]).
- **Spacing loss** isn't a rational filter (dB-linear in f). Approximate `e^(−2πfd/v)` with a 2-pole
  Butterworth whose corner is ~1.15·f₃ followed by a 1-pole at ~2·f₃ [E], or a 16–32-tap minimum-phase FIR made
  at prepare time (ChowTape uses an FIR [P]).

### 3.7 Diffusion

A chain of Schroeder allpasses [P, standard], 4 per channel:

```
w[n] = x[n] + g·w[n−M];    y[n] = −g·w[n] + w[n−M]
```

- Lengths: Dattorro's input diffusers, 142, 107, 379, 277 samples at 29 761 Hz (4.77, 3.60, 12.73, 9.31 ms),
  `g` = 0.75, 0.75, 0.625, 0.625 [P]. Scale all four by **Size** (EchoBoy's 0…50 [P label]: e.g. size/10 ×) and
  map **Amount** to `g` in 0…0.75 [E]. Different, mutually prime lengths per channel decorrelate L and R.
- In **Loop** each repeat is smeared again; in **Post** once [P]. High `g` at small sizes rings metallically
  ("it will sound metallic and robot-like" [P]): modulate each length by ±0.3 ms at 0.3–1 Hz (Hermite reads) to
  break the ringing [E].
- **Keep repeats on time** [D]: an allpass of length M has its energy centroid at exactly M samples
  (`Σ_k k·M·(1−g²)²·g^(2(k−1)) = M`), so subtract the sum of the chain's lengths from the loop's delay when
  diffusion is in the loop (when the delay is longer than that sum).

### 3.8 Feedback above 100 % and self-oscillation

- **Make the loop clip, not the output.** With a soft saturator in the loop (slope 1 at 0, falling with level),
  a small-signal loop gain `G = fb · max|H_loop(f)|` above 1 grows until the saturator's describing gain brings
  it back to 1: a steady, musical self-oscillation instead of runaway [D]. EchoBoy's Feedback can do this ("the
  kind of self-oscillation achievable in units like the RE-201" [P]); let the knob reach ~110–120 % [E].
- **The pitch it oscillates at** [D]: frequencies where the loop phase is a multiple of 2π, `f_k ≈ k / T_loop`,
  picked by where `|H_loop|` peaks: the band-pass (RE-201) or resonant corner (DM-2) chooses the note; wow makes
  it drift, as the hardware does.
- **Guards**: a loop limiter after everything (soft knee at −3 dBFS, fast attack, release ~100 ms) as a safety
  net (the Limited style makes it the sound [P]); a DC blocker in the loop; flush denormals; no `NaN` (clamp the
  loop's state to ±8 and reset the line if it ever isn't finite).
- **Prime Numbers** ("delay repeats are slightly altered in time in a very special way to minimize resonance
  effects" [P]): not published. A reasonable reading [E]: round each path's delay (and each Rhythm tap) to a
  prime number of samples, or of 0.1 ms, so paths never share a common period; offset the second channel by a
  few primes' worth.

### 3.9 Noise (optional)

Hiss at the playback stage, inside the loop (so, as on a real echo, it builds up with feedback): white from
xorshift, shaped by the style's playback band, −60 (Space Echo) to −75 dBFS (Master Tape) [E]. BBD noise between
compressor and expander (3.5). EchoBoy itself doesn't seem to add any [P (absence)]: default off.

### 3.10 Ducking (not in EchoBoy)

If wanted: an envelope follower on the dry input (peak, attack 5–10 ms, release 150–400 ms), gain reduction
`min(1, (env/thr)^(−amount))` applied to the wet output only, smoothed per sample [E].

### 3.11 Real-time checklist

- Preallocate: delay buffers (max time × max fs + modulation margin), the tape position buffer, diffuser lines,
  oversampling buffers (`juce::dsp::Oversampling::initProcessing` in prepare). No `std::vector::push_back`,
  `new`, locks, or logging in `process`.
- Parameters: atomics read once per block, `juce::SmoothedValue` per sample for gains and delay targets; filter
  coefficients recomputed at block rate (or every 16–32 samples while a knob moves), SVF so changes don't click.
- Everything in seconds/Hz, so 44.1–192 kHz behave alike; recompute at `prepareToPlay`.
- Loop latency: subtract interpolation, ADAA (½ sample), oversampling filter and diffusion centroids from the delay.
- Cost: per channel one Hermite read, 4–6 SVFs, one saturator, 4 allpasses, two LFOs: tens of flops per sample.
  Hysteresis or a Holters–Parker BBD are the only expensive options.

---

## 4. Measuring EchoBoy yourself

Since no one has published EchoBoy's per-style data, this is how to get it (with a copy of EchoBoy, Plugin Doctor
or a script rendering through it). Do each at 48 kHz, Mix 100 % wet, Width off, Saturation knob at 12 o'clock,
Low/High Cut at their defaults, per style:

1. **First-repeat response**: Feedback 0, delay 100 ms; an impulse or a log sweep in; deconvolve; window the
   repeat. Gives each style's band (corners, slopes, bumps).
2. **Per-repeat change**: Feedback ~50 %, delay 300 ms; window repeats 1…6 separately; divide successive
   spectra. Gives the loop's per-pass EQ (the Decay bands + media filter) and the loop gain.
3. **Saturation**: sines at 100 Hz, 1 kHz, 6 kHz stepped from −40 to +6 dBFS through the first repeat: THD and
   harmonic balance (odd vs even) per level; the 6 kHz sine's compression against 1 kHz shows the "Tape" HF
   compression; tone bursts give a limiter's attack and release.
4. **Wow and flutter**: a 3.15 kHz sine (the flutter-test standard), Feedback 0; track the period of the repeat by
   zero crossings (Downing & Terjesen's method [M]): the delay-time trajectory, whose spectrum gives rates and
   depths.
5. **Glide**: step the Time knob (automation) 100 → 400 ms and back; track the repeat's delay over time for the
   time constants.
6. **Noise floor**: silence in, Feedback 0 and 90 %.
7. **Self-oscillation**: Feedback max, no input after a burst: level and pitch it settles at.

---

## Sources

EchoBoy and Soundtoys

- EchoBoy User's Guide, Version 5 (mirror used here): https://r2.gear4music.com/media/70/702633/download_702633.pdf
  (Soundtoys: https://www.soundtoys.com/wp-content/uploads/EchoBoy-Manual.pdf)
- EchoBoy 1.0 manual: https://barryrudolph.com/recall/manuals/echoboy.pdf
- EchoBoy Jr. styles: https://store.soundtoys.com/meet-echoboy-jr/
- Sound On Sound review (2006): https://www.soundonsound.com/reviews/sound-toys-echoboy
- Ken Bogdanowicz interview, Tape Op #62: https://tapeop.com/interviews/62/ken-bogdanowicz
- This repo's notes on the controls: [echoboy-manual.md](echoboy-manual.md)

Tape

- S. Arnardottir, J. S. Abel, J. O. Smith III, "A Digital Model of the Echoplex Tape Delay", AES 125th Convention,
  preprint 7649, 2008: https://aes2.org/publications/elibrary-page/?id=14800
- Reimplementation using its 3.5 Hz / 22 Hz components: https://github.com/DingJR/Echoplex
- J. Downing, C. Terjesen, "Real-Time Digital Modeling of the Roland Space Echo", U. Rochester, 2016:
  https://hajim.rochester.edu/ece/sites/zduan/teaching/ece472/projects/2016/Downing_Terjesen_paper.pdf
- V. Välimäki, S. Bilbao, J. O. Smith, J. S. Abel, J. Pakarinen, D. Berners, "Virtual Analog Effects", DAFX 2nd
  ed., ch. 12 (tape-based echo simulation): https://dafx.de/DAFX_Book_Page_2nd_edition/chapter12.html
- J. Chowdhury, "Real-Time Physical Modelling for Analog Tape Machines", DAFx-19:
  https://www.dafx.de/paper-archive/2019/DAFx2019_paper_3.pdf
- ChowTape manual: https://ccrma.stanford.edu/~jatin/chowdsp/Products/ChowTapeManual.pdf; source (wow/flutter in
  `Plugin/Source/Processors/Timing_Effects/`): https://github.com/jatinchowdhury18/AnalogTapeModel
- V. Zavalishin, J. Parker, "Efficient emulation of tape-like delay modulation behavior", DAFx-18:
  https://www.dafx.de/paper-archive/details/HeLd0OAtZr6hPw_63LViZg
- RE-201 head delay ranges (forum): https://www.kvraudio.com/forum/viewtopic.php?p=6803708
- ATR-102 (flutter ~0.04 % RMS at 15 ips; servo capstan, no pinch roller; from search excerpts of these pages):
  https://www.atrservice.com/restoration, https://mixdownmag.com.au/features/gear-icons-ampex-atr-102/
- Fulltone Tube Tape Echo review: https://tapeop.com/reviews/gear/51/tube-tape-echo
- Echoplex preamp (TIS58 JFET), flutter ~4 Hz: https://scientificguitarist.wixsite.com/home/echoplexus
- Catalinbread Belle Epoch (EP-3 repeats, 80–800 ms): https://cdn.shopify.com/s/files/1/0370/1873/0628/files/Belle_Epoch.pdf

Bucket brigades

- C. Raffel, J. O. Smith, "Practical Modeling of Bucket-Brigade Device Circuits", DAFx-10:
  https://dafx.de/paper-archive/2010/DAFx10/RaffelSmith_DAFx10_P42.pdf; code and filter script:
  https://colinraffel.com/software/bbdmodeling
- M. Holters, J. D. Parker, "A Combined Model for a Bucket Brigade Device and its Input and Output Filters",
  DAFx-18: https://dafx.de/paper-archive/2018/papers/DAFx2018_paper_12.pdf
- chowdsp BBD implementation: https://ccrma.stanford.edu/~jatin/chowdsp/chowdsp_utils/namespacechowdsp_1_1BBD.html
- Deluxe Memory Man (two MN3005s, NE570, 4047 clock; response flat to ~2.5 kHz, −3 dB ~3.2 kHz):
  https://music-electronics-forum.com/forum/effectification/guitar-effects/26284-deluxe-memory-man (the response
  figures came from a search excerpt of this thread and weren't re-found on the fetched page)
- Boss DM-2 (4096 stages, 20–300 ms, MN3205 67 dB S/N and 0.8 % distortion vs MN3005's 1 %):
  https://legendarytones.com/?p=984, https://www.diystompboxes.com/smfforum/index.php?msg=998243 (secondary: from
  search excerpts; check a datasheet before relying on the chip figures)

General DSP

- J. Dattorro, "Effect Design, Part 1: Reverberator and Other Filters", JAES 1997 (allpass diffusers):
  https://ccrma.stanford.edu/~dattorro/EffectDesignPart1.pdf
- A. Simper, "Linear Trapezoidal Integrated SVF": https://cytomic.com/files/dsp/SvfLinearTrapOptimised2.pdf
- J. Parker, V. Zavalishin, E. Le Bivic, "Reducing the Aliasing of Nonlinear Waveshaping Using Continuous-Time
  Convolution", DAFx-16 (dafx.de paper archive)
- Standards quoted from general references, not re-checked here: tape equalisation (NAB 50/3180 µs, IEC 35 µs at
  15 ips; AES 17.5 µs at 30 ips), telephone band 300–3400 Hz, FM broadcast 15 kHz with 75 µs (Americas) / 50 µs
  (Europe) pre-emphasis.
