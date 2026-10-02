# Pro-C on vocals: the research

The research behind the vocal side of our compressor (`pro-c.md`). Théo asked for "a really good compressor,
mostly for vocals" (rap, trap, R&B, pop, hyperpop), and `pro-c.md` was thin exactly there: its vocal starting
points were marked "inferred, no primary source gives numbers", and its classic models (section 4) had four
units in a paragraph each. This document fills that in, in four parts:

1. [What engineers do](#1-what-engineers-do): how 50-odd mix engineers compress lead vocals, from their own
   session walk-throughs, with settings where they give them.
2. [The classic units, measured](#2-the-classic-units-measured): the eleven compressors those engineers name,
   from their manuals, schematics, service notes and published measurements.
3. [What other compressors do](#3-what-other-compressors-do): the ideas in thirty-odd compressor plug-ins
   (DAW stock ones, vocal ones, analogue models) worth taking, and what producers complain about.
4. [What the modelling literature adds](#4-what-the-modelling-literature-adds): papers that measured or
   modelled these units, and what they mean for our styles.

What it changes in the design is in `pro-c.md` itself: section 3.3 (on vocals), section 4 (the Vintage
group), section 6 (the presets), sections 7 and 9 (the proposal and the questions).

How sure each statement is: quotes in "…" are the source's own words; **(inferred)** is worked out rather than
read; **not stated** means no source we could read gives it; **(secondary)** is a write-up rather than the
person or maker. Some Sound On Sound pages were read through a summarising fetch, so a few settings are its
rendering of the article. Gearspace and Reddit refused automated reading, so designers' forum posts and user
complaints from there are missing. [Sources](#5-sources) at the end.

---

## 1. What engineers do

### 1.1 The chains

Each row is one engineer's lead-vocal chain in order (→), mostly from Sound On Sound's *Inside Track* and
*Secrets Of The Mix Engineers*, where the engineer opens the session and names each plug-in. Settings only
where the source gives them. Rap, R&B and pop first; the classic engineers after.

| Engineer (record) | Chain | Settings and words |
| --- | --- | --- |
| **Seth Firkins** (Future, *Draco*) | Tracking: U87 → Neve 1073 → **CL 1B**, Auto-Tune monitored and printed. Mix, "strict order": EQ7 → Waves De-Esser (~5.5 kHz) → **RComp** → D-Verb → AIR Flanger → **L1** | RComp makes "a nice, squeezed waveform". "The order of the plug-ins matters" |
| **Derek "MixedByAli" Ali** (Kendrick Lamar, *To Pimp A Butterfly*) | Tracking: U47 → 1073 → **CL 1B**. Mix: **RComp** (manual and opto) → SSL Channel filters → S1 → **Distressor**; a **Fairchild 670** in parallel on guests | RComp "threshold all the way down to −18, so if anything in the mid-range leaps out too much, it keeps that in check"; the Distressor "adds some grit and presence at the top" |
| **Matt Schaeffer** (Kendrick Lamar, *All The Stars*) | Flanger → **SSL E comp** → **RComp** → Q10 (HPF 50 Hz) → de-esser → **LA-2A** → Pultec → Decapitator → Pro-Q2 | SSL **4:1, slow attack, fast release**, to keep the transients |
| **Jaycen Joshua** (Bieber, *Baby*; rap) | **RComp** on the lead, split into a track per section; McDSP **MC404** multiband | "I vary the effects compression and EQ on his vocals during the song"; multiband because a static EQ can't follow "a vocal that's constantly changing" |
| **Leslie Brathwaite** (Pharrell, *Happy*) | Per track: De-esser → **RComp** → SSL Channel; on the lead aux **L2** + SSL Channel | The L2 "puts the vocals more in your face"; hooks compressed differently from verses |
| **Fabian Marasciullo** (Flo Rida / T-Pain, *Low*) | R-Channel and de-esser (twice) → **RVox** (peaks) → **Distressor pair** (Flo Rida) or **Neve 33609** (T-Pain's hook) → Dolby 740 | "I would have a hundred Distressors if I could." De-essing "twice", ~5.4 and ~4.5 kHz |
| **Tony Maserati** (Selena Gomez, *Rare*, 2020) | Q10 → **RComp** → REQ6 → Pro-DS → **CLA-2A** → Pro-Q2 | RComp "nearly **7:1** … where she's not hitting the threshold her voice is gaining by 5 dB. We're doing a serious amount of squashing"; "it reminds me of the dbx 160X" |
| **Stuart White** (Beyoncé & Jay-Z, *Apeshit*) | DS555 → Pro-DS → EQ3 (HPF 142 Hz) → **RComp** → **SSL E comp** → tape; parallel aux **RComp + CLA-76** mixed low; AE400 → **C4** last | "I love the RComp, mainly because it doesn't sound like compression to me." "Using compression for energy, mood and attitude" |
| **Teezio** (Chris Brown, *Heat*) | Tracking: 251 → 1073 → **CL 1B**, Auto-Tune. Mix: Pro-Q2 → EQP1A → **1176** → **Pro-MB** → **RComp** → de-esser | "Instead of completely smashing things with one compressor, I will compress lightly in stages" |
| **Thomas "Tillie" Mann** (Lil Baby) | De-esser → EQ3 (70 Hz) → **SSL comp** → **RComp** → tape → Pro-DS; parallel **CL 1B** | "The SSL Compressor is not doing much, it's just there for vibe. I do the actual compression with the RCompressor"; the CL 1B adds "body and a bit of beef" |
| **Kesha Lee** (Lil Uzi Vert) | **Auto-Tune first** → de-esser → EQ3 → gate; bus: de-esser → EQ3 → **RComp** → **SSL E** → **CLA-3A** → limiter | "Warm, full, loud, in-your-face … I always turn the beat down 1–2 dB" |
| **Maddmix** (21 Savage) | **Auto-Tune** → **1176LN** → **RVox** → Pro-DS → C6 → Pro-DS → Pro-Q2 → C6; parallel **CLA-76 + L1** | "If I hear something else that needs correcting, I will just add another compressor" |
| **Evan LaRay** (Cardi B, *Bodak Yellow*) | Track: EQ3 (HPF ~100 Hz) → **CLA-76** → de-esser. Bus: Pro-DS → **RComp** → **C4** → CLA Vocals → Decapitator → **RVox** → **L1**; parallel **PuigChild 670** "a lot" | "The CLA keeps the peaks in check" |
| **Jason "Cheese" Goldberg** (YoungBoy) | **Auto-Tune → RComp → 1176LN → de-esser → RVox**; bus with Pro-MB, L1, SSL E, C4, CLA Vocals…; parallel BF-76 ("NY aux") | 39 stages; "the entire process is about feeling" |
| **Ari Morris** (MoneyBagg Yo) | Pro-Q3 → de-esser → **RComp** → Massive Passive → **dbx 160** → Culture Vulture → Pro-MB → Soothe; sub **Pro-L 2**; parallel **1176** | "The 160 really crushes the vocals" |
| **Koen Heldens** (Trippie Redd) | Lows removed "to prevent compressor triggering" → **CLA-76 Blue in parallel** → … | **Medium/slow attack, fastest release, ~10 dB**, parallel |
| **Joseph Colmenero** (Lil Tecca) | **Auto-Tune** → Q6 → **Pro-C 2** → SSL Channel → 2 de-essers → **RVox as a gate** → Decapitator → **C4** | not stated |
| **Clint Gibbs** (Doja Cat, *Say So*) | HPF → **1176 all buttons in** → de-esser → Pro-Q3; parallel 1176 at ~−20 dB | All buttons "for pop vocal sound"; rides "specific syllables" |
| **Illangelo** (The Weeknd) | Auto-Tune → Pro-DS → Pro-Q2 → **Vocal Rider** → API 560 → **Pro-MB** ("really pumping!"); parallel **1176 "slamming it"** | not stated |
| **Manny Marroquin** (Kanye, *Stronger*) | SSL filters → **Neve 32264** → **CL 1B** → Avalon EQ → dbx 902 | Neve **3:1, fast recovery**; CL 1B **4:1, medium attack**: "The CL1 is a very smooth-sounding compressor, but its attack is not as fast or pronounced" |
| **Rob Bisel** (SZA, *Kill Bill*) | Tracking: U47 → 1073 → **CL 1B**. Mix: Pro-DS → Pro-Q3 → **CLA-3A** → **Pro-C 2** | not stated |
| **Mitch McCarthy** (Olivia Rodrigo, *drivers license*) | EQ → **CLA-76** → **MC404** → Pro-DS → Soothe 2; parallel **Distressor "hard"**, automated | **4:1, medium attack, very slow release**: "For dynamic singers it provides so much control" |
| **Rob Kinelski** (Billie Eilish, *bad guy*) | Pro-Q2 → **PuigChild 670** → de-esser (~6.5 kHz) → Pro-Q2 → 1073 → **Vocal Rider** (~1.5 dB) | The 670 "smooths the vocals out a bit and adds some colour" |
| **Chris Lord-Alge** | SSL E-Channel (+9 dB at 8 kHz, HPF ~70 Hz) → **CLA-76** → CLA Vocals → **L1** | **4:1, attack 3, release 7**: "a relatively slow attack and the fastest possible release"; "the most attitude possible … almost like a guitar amp". "You'd be surprised at how much compression you need to put on vocals" |
| **Tom Elmhirst** (Adele, *Rolling In The Deep*) | Pultec → **1176** → **CL 1B** | 1176 **fast attack, fast release**; CL 1B **slow, slow**, "more evening out the level". "If you're constantly moving the fader … you need to look at your compression" |
| **Spike Stent** (Beyoncé) | UA **1176AE** | **2:1**: "It just brings vocals to life … without sounding over-compressed … With some compressors, they just sound like the life's been squeezed out" |
| **Michael Brauer** | Pre-fader **LA-2A**, then seven compressors in parallel (1176 Rev A sometimes all buttons, Distressor Nuke, Fairchild 660…) | **~1 dB each** (secondary) |
| **George Seara** (Shawn Mendes) | SSL comp **2:1** → Avalon → **Distressor pair** → **Retro 176 pair** | 176: **4:1, medium attack, fast release, side chain filtered at ~70 Hz** |
| **Dan Grech-Marguerat** | 1073 → **1176** → API EQ | "Attack on **1**, release on **7**, **4:1** … makes anything sound very full" |
| **Ben Baptie** | 1176, LA-2A, Distressor | "The 1176A with **slow attack and fast release** allows the vocal to breathe" |
| **Young Guru** (Jay-Z) | **Fairchild 660** + ADL 1500 | "One of the best-ever vocal compressors. It glues them together so well, without having this super compressor sound" |
| **Mike Senior** (SOS Mix Rescue, as an educator) | Fairchild 670 → 1176LN, both ~6 dB, times "pretty fast, to dredge up lots of the little details"; or 1176 (fast attack, slow release) → a transparent 3:1 for another 6–9 dB | The 1176 for its "nice breathy FET distortion components" |

Without primary sources (searched, not found): Serban Ghenea's vocal settings (only that he uses Metric
Halo's SSL-style ChannelStrip on every session), Dylan Brady, Ken Lewis, Andrew Maury, Mike Dean's mixing
(only his tracking: 1073 → CL 1B), Finneas's settings ("the Logic compressor").

### 1.2 What it adds up to

1. **Two to four compressors in series, each doing little.** The clearest consensus: Elmhirst, Marroquin,
   Teezio, Maserati, Schaeffer, Kesha Lee, Seara, LaRay, Maddmix, Goldberg. Teezio's reason: "compress lightly
   in stages". Ed Boyer says the same of de-essers: two "working less hard" beat one.
2. **Fast first, slow second.** A FET or a fast VCA catching peaks, then an opto or tube levelling the phrase:
   Elmhirst (1176 → CL 1B), Marroquin (Neve → CL 1B, because the CL 1B's attack "is not as fast"), Needham
   (1176 → LA-2A), UA's own advice. Not universal: many put a clean control stage (RComp, SSL) before a colour
   one instead. Either way, **control, then colour, then a ceiling** (a limiter last: L1, L2, Pro-L 2).
3. **The Renaissance Compressor (RComp) and RVox run rap and R&B mixes.** RComp is in fifteen of these chains
   ("doesn't sound like compression", "reminds me of the dbx 160X", Ali's "threshold all the way down to −18"),
   RVox (a one-knob compressor, gate and limiter) in nine. **(inferred)** Their appeal is a clean,
   program-dependent release (Waves' ARC) and a one-knob path to "controlled".
4. **Tracking through a CL 1B.** "Neve 1073 → Tube-Tech CL 1B" is the near-universal rap and R&B tracking chain
   (Ali, Firkins, Teezio, Bisel, Hurtt, Mike Dean, Godbey, Tumay), with Auto-Tune monitored and printed.
5. **The 1176's vocal setting is slow-ish attack, fastest release, 4:1.** CLA (attack 3, release 7), Grech
   (1, 7), Baptie, Heldens, Seara. On an 1176, 7 is the fastest and "slow" is still under a millisecond, so it
   lets the consonant's first edge through and lets the voice "breathe". McCarthy goes the other way (medium
   attack, very slow release) for smoothness.
6. **Parallel crush is everywhere.** 10–20 dB of gain reduction blended under the dry vocal: Heldens (~10 dB),
   Gibbs (~20 dB), Illangelo ("slamming it"), LaRay, Stuart White, Maddmix, Tillie (a CL 1B for "beef"),
   McCarthy (Distressor "hard"). Paul White: "−20 to −15 dB of parallel compression to notice the vocal gaining
   weight and authority". Mike Senior: the parallel ones should have "contrasting characters".
7. **Multiband is standard on modern vocals**: C4, C6, MC404, Pro-MB, dynamic EQs, Soothe, in more than a
   dozen chains, for proximity mud and high-mid harshness (McCarthy: it "tames high-mid harshness").
8. **Auto-Tune goes first**, before any compressor (Kesha Lee, Maddmix, Colmenero, Goldberg, Illangelo;
   printed at tracking for Firkins, Teezio, Tillie). **(inferred)** The tuner wants the uncompressed voice,
   and the artist performs into it.
9. **The low end is cut before the compressor** so it doesn't trigger it (Heldens, CLA's 70 Hz, LaRay's
   100 Hz, Stuart White's 142 Hz), or the side chain itself is filtered (Seara's ~70 Hz). **De-essing goes
   before, after, or both** (twice for Marasciullo, Tillie, Maddmix, Elmhirst, Stent).
10. **Compression sets the tone; the level is ridden by hand.** CLA: "you try to get the overall tone for the
    whole record with the compressors, and then you're chasing the faders". Vocal Rider (Kinelski ~1.5 dB,
    Illangelo) is a fader, not a compressor. Godbey rides the "'t's and close-up things … so the compressor
    won't work too hard".

### 1.3 How much gain reduction

| Stage | Typical, as documented |
| --- | --- |
| A colour stage (an 1176AE at 2:1, an SSL "just there for vibe") | 1–2 dB |
| General vocal compression (Paul White) | ≤ 5 dB on the peaks, 2:1–4:1, ~10 ms attack, 50–100 ms release |
| Each stage of a heavy serial chain (Senior) | ~6 dB; a second, transparent stage 6–9 dB |
| A hard-squashed pop or rap lead (Maserati) | ~7:1, quiet parts rising 5 dB with the make-up |
| A tracking CL 1B (Tube-Tech's own vocal setting) | 4–5 dB, Manual mode |
| Parallel crush | 10–20 dB |
| Each of many parallel compressors (Brauer) | ~1 dB |
| A rider (Vocal Rider) | ±1.5 dB |

The spread is real: CLA ("you'd be surprised at how much compression you need") and Pensado ("I've never
really liked compression") or Ethan Stevens ("not really into compression for rap") are all hitmakers.

### 1.4 What goes wrong, in their words

| Problem | Said | Cause, and the remedy in our design |
| --- | --- | --- |
| Lifeless | "the life's been squeezed out" (Stent); "lose dynamics" (Teezio) | One compressor working too hard: stages, Range, Mix |
| Sibilance up | Senior's fast Fairchild + 1176 raised it, so a de-esser followed | The compressor holds the vowels, not the "s", and make-up raises it: a side chain dip at 5–8 kHz, or a de-esser (our Pro-DS) |
| Low-note distortion | the compressor responds "to individual cycles of the input waveform" (Paul White) | Fast release following a low voice's cycles: hold, program-dependent release (`pro-c.md` 3.4) |
| Pumping, breathing | "If the release time is too fast, the signal level may 'pump'" | Program-dependent release; less make-up |
| Breaths too loud | Stent has them "taken down" before the mix; Colmenero gates with RVox | Make-up and upward compression raise everything under the threshold (below) |
| Plosives and boom trigger it | Heldens removes the lows "to prevent compressor triggering" | A side chain high-pass at 70–150 Hz |
| Over-working on spikes | Godbey fixes the "'t's" first | Lookahead, a fast first stage, or a hand ride |

The words they use for good compression: **attitude, spit, in your face, upfront, presence, smooth, glue,
full, fat, warm, body, breathe**. For bad: **squeezed, bludgeoned, pump, sterile, "super compressor sound"**.

### 1.5 Where OTT fits

Théo's quick vocal chain is Auto-Tune then a heavy OTT. **No engineer in the survey puts OTT on a lead vocal**;
the one documented use is Josh Gudwin's, on a reverb return (Dua Lipa, *Don't Start Now*). Why it sounds good
fast and costs later **(inferred)**: OTT compresses upward in every band, so the quietest sound gets the most
gain, and in the gaps between words the quietest sound is breath, mouth noise, room and hiss. It also
compresses downward hard above its thresholds, so the result is dense and "finished" at once, the hyperpop
sound, but with no attack to shape the consonants and the noise floor up by as much as the upward gain.

What the engineers do instead is the chain of 1.2: a fast stage, a slow stage, a limiter, parallel crush for
density. Pro-C's **Upward** style (with its floor: nothing under it is raised) and **TTM** (OTT's three-band
sound, Pro-C 3's own) keep OTT's sound available on purpose; the vocal presets don't lean on them.

---

## 2. The classic units, measured

The units those engineers name, each from its maker's manual first, then service documents, schematics and
measurements. For each: what it is, the numbers, what makes its sound, and what a style modelled on it needs.
`pro-c.md` section 4 turns these into our Vintage styles.

### 2.1 UREI / Universal Audio 1176 (FET)

**What it is.** A FET used as a voltage-variable resistor, "the bottom leg in a voltage divider circuit, which
is placed ahead of a preamp stage". **Feedback**: "the 1176LN is a feedback style compressor since the
sidechain circuit samples the signal level after the gain reduction" (UA's manual), tapped before the Output
pot, so Output doesn't change the compression. The detector is a **full-wave peak rectifier** charging a
capacitor (C22): the Attack pot sets how fast it charges, the Release pot how fast it discharges. **The
threshold comes from the ratio buttons**: "a bias level is applied to the diodes by the Compression Ratio
pushbutton switches. This controls the threshold of limiting", so **a higher ratio is a higher threshold**.
Input sets how hard the signal hits that fixed threshold.

| Control | Range |
| --- | --- |
| Input | continuous; drives into the fixed threshold |
| Output | continuous; make-up only |
| Attack | **20 µs … 800 µs**, fastest **clockwise** (7); fully anticlockwise is **Off**: no gain reduction, the circuit's colour only |
| Release | **50 ms … 1.1 s**, fastest clockwise (7) |
| Ratio | **4:1** ("moderate compression"), **8:1** ("severe"), **12:1** ("mild limiting"), **20:1** ("hard limiting"), and **all buttons in** |

The 1–7 markings aren't times, and "the actual attack and release times do not correspond to the markings on
the unit" (a measurement project). The knob law is **not stated** anywhere.

**Measured.**

- **Threshold rises with ratio** (one 1176LN, sine, a fixed Input; a student project, so indicative):
  compression starts at −17.5 dBm at 4:1, −12.8 at 8:1, −9.6 at 12:1, −8.4 at 20:1: about **9 dB higher from
  4:1 to 20:1**, with ~2 dB of hysteresis. The same measurement: the extreme highs and lows were boosted while
  compressing.
- **Knee**: "The 1176LN utilizes soft knee compression and limiting" (UA); "the soft-knee response hardens as
  ratios increase" (SOS).
- **Program-dependent ratio and release**: "The attack and release are program dependent, as is the ratio. The
  1176 will faithfully compress or limit at the selected ratio for transients, but the ratio will always
  increase a bit after the transient" (Will Shanks, UA). Release "is quicker after transients … but it slows
  down after sustained and heavy compression" (secondary). Moore's measurements of three units (Huddersfield,
  2017) confirm the release is "much quicker after the transient" than after a sustained level, and that
  units differ (a reissue releases slower than a blackface even at 7).
- **Distortion comes from the release more than the attack** (Moore): steady until release position 6, then
  harmonics "drop sharply"; fastest attack with slowest release has the 3rd and 5th harmonics about 20 and 17
  dB lower than slowest attack with fastest release. At ~7 dB of reduction, fastest times, 20:1: 0.16–0.37%
  THD at 1 kHz, **2.5–3.8% at 50 Hz** (the fast release waveshaping the lows). UA's spec, "< 0.5% THD … at 1.1
  seconds release", is given at the *slowest* release for that reason; the manual calls the fast-setting ripple
  "a special kind of distortion".
- **Intermodulation** (SMPTE, ~7 dB of reduction): 0.5–0.7% at attack 3 / release 5, 4:1; 2–3% at release 7;
  **18–32% all buttons in**, fastest times.
- **Input stage**: clean (0.15–0.5% at +16 dBu) until about +20 dBu, then clips hard (5.5–7.6% at +26).
  Even harmonics over odd below clipping.
- **Colour**: "a slightly bright character, actually more of a subtle spectral tilt than an obvious
  high-frequency lift … the higher the Input level, the more [edge, growl, present, urgent] come into play";
  "most transparent when doing gain reduction of 4 dB or less" (Hugh Robjohns, SOS, in UA's manual).

**All buttons in** ("British mode"): "distortion increases radically due to a lag time on the attack of
initial transients (a phenomenon which might be described as a 'reverse look-ahead'). The ratio goes to
somewhere between 12:1 and 20:1, and the bias points change all over the circuit, thus changing the attack and
release times as well"; "the meter will go wild, often resting at maximum" (UA). Shanks: "Where 4:1 is a gentle
slope, All-Button is more like severe plateau!"; "the perception of distortion is increased with lower
frequencies". Pushing only 4:1 and 20:1 does the same. A measured transfer curve: **not found**.

**Revisions.** Rev A (1967, "bluestripe"): "more harmonic distortion at the expense of a higher noise floor".
Rev C (1970) introduced the **LN** circuit, keeping the FET "within its linear range" with a bias trim for
minimum distortion. **Rev D/E** are the classic blackface and what UA's reissue copies. Rev F (1973):
push-pull output, "the lowest harmonic distortion of any revision". Rev G: no input transformer, "cleaner".
UA's 1176AE (2007) adds **2:1** and a fixed **10 ms "Slo" attack**.

**On vocals.** Bruce Swedien: "All of the Michael Jackson and James Ingram vocals … were done with at least
one of those 1176s." Jim Scott: "always on the 4:1 … 10 o'clock, 2 o'clock". The pairing with an LA-2A after
it is "not unusual" (Mike Shipley).

**What a style needs.** Feedback; a peak detector; a fixed threshold per ratio (higher with the ratio, about
9 dB over the range); a soft knee that hardens with the ratio; a ratio that creeps up after a transient; a
release that's quicker after transients; distortion that grows with gain reduction and *falls* as the release
slows, worst on low notes; Attack Off as a colour-only bypass; all buttons as its own mode (12–20:1 plateau,
a delayed first attack, much more distortion, slower recovery); a slight bright tilt.

### 2.2 Teletronix LA-2A (opto, T4) and the LA-3A

**What it is.** The **T4** cell: an electroluminescent panel lighting a cadmium-sulphide photocell, "placed
ahead of the first amplifier stage", the photocell the bottom leg of a divider. "The actual stage gains and tube
operating parameters are not varied." **There is no rectifier**: "Since the light is produced directly from
the audio voltage … Rectification and filtering of the audio to produce a control signal are not necessary"
(the 1966 manual). The panel's light "depends upon the applied voltage and frequency", so the detection is
frequency-dependent by itself. UA calls it a feedback design; its own block description and the 1966 manual
aren't fully consistent on that.

| Control | What it does |
| --- | --- |
| Peak Reduction | The side chain's gain: "the greater the gain of this circuit, the lower the threshold". Threshold and amount in one knob |
| Gain | Output, up to 40 dB; "does not affect the compression" |
| Compress / Limit | "Compress … curve is more gentle, and presents a low compression ratio"; Limit higher. UA: "In practice, you will probably find the differences subtle" |
| R37 (rear) | High-frequency emphasis: from flat to "approximately 10 DB more reduction at 15 KC than at frequencies below 1 KC" |

**The curve.** "Compressor action occurs from the breakaway point at −30 DB input and up to −20 DB, at which
point the curve becomes horizontal … The input increases an additional 20 DB, but the output increases less
than 1 DB" (1966, limit-only Rev 1): **a ~10 dB soft region, then near-limiting**, the ratio rising all the
way. UA: Compress is "soft knee, 'fixed' (not really) at a 4:1 ratio"; elsewhere "roughly 3:1" on average.

**Time.** Attack: "average attack time of 10 milliseconds", frequency-dependent (UA). Release: "approximately
0.06 seconds for 50% release, 0.5 to 5 seconds for complete release depending upon amount of previous
reduction" (spec), "a gradual release over a period of 1 to 15 seconds" (the same manual's circuit text). UA:
the cell "releases quickly (40–80 milliseconds) to approximately half of its off resistance. The remainder …
can take place over as much as several seconds … the release time is slower if the unit has either been in
compression for a while, or the amount of compression is large". Shanks: the T4 "really seems [to have] a
time constant of several minutes". Note "50%" is of the cell's resistance, not of the dB reduction
**(inferred)**.

**Measured.**

- **Six LA-2As** (Moore): attack 33–81 ms (mean 52.8), release 449–1670 ms (mean 916.5), on 1 kHz bursts.
  A tone burst 12 dB over: 63% of the reduction within 125 ms, all of it by ~1100 ms; release ~1300 ms; small
  fluctuations during steady compression (the T4); lows reduced ~0.2 dB more.
- **T4 cells built and measured** (Stroe, Huddersfield): the attack is **two-stage** whatever the input (to
  63%, then a slow tail); the release depends on how long the light was on (the memory). For a CdS cell and a
  green panel: first attack 90 ms, second 1.5 s; release **1.6 s after 5 s of light, 1.2 s after 1 s, 0.15 s
  after 300 ms**. A CdSe cell is far faster (release 18–60 ms): the "fast opto". Gain reduction rises with
  frequency (the panel), and panel efficiency drops above ~5 kHz.
- **Distortion**: < 0.35% at +10 dBm, < 0.75% at +16 dBm; "at least 30 DB of gain reduction … with less than
  0.5% harmonic distortion". The optical cell itself doesn't follow the waveform: the colour is the tubes'
  (12AX7, 12BH7 cathode follower) and the transformers' **(inferred)**. Moore measured the highest idle THD of
  four units (0.2% at 0 dBu to 0.9% at +16 dBu), and 2–2.6% while compressing, odd harmonics dominant.

**Versions.** UA's plug-ins model three: Silver ("faster time constant"), Gray ("medium-speed", suggested "for
lead and background vocals"), LA-2 ("slowest … 'mellow'"). The **LA-3A** is the solid-state sibling with the
same T4: attack "less than 250 microseconds to 0.5 milliseconds depending on program material", release "500
milliseconds to 5.0 seconds depending on the duration of the peak", Limit "approaching 50:1", the same 10 dB HF
emphasis; and the clearest primary statement of why opto lows distort: "the low frequency Total Harmonic
Distortion in a limiter is a function of release time".

**On vocals.** "Primarily known as a vocal compressor … can rein in the most untamable, dynamically
fluctuating performances"; its slow memory lets you "really hit the LA-2A hard with little or no audible
amplitude modulation artifacts" (UA). The 1966 manual: "4 to 8 DB of compression continuously". Andrew
Scheps turns R37 to the highs on a parallel "air" copy.

**What a style needs.** A light stage driven by the audio, not a rectified envelope (attack ~10 ms average,
faster for highs); a cell that turns on in two stages and releases fast to about half, then slowly with a
memory of how long and how hard it was lit; a ratio that rises with level through a ~10 dB knee to
near-limiting; Peak Reduction as side chain gain into a fixed threshold; R37 as a 0–10 dB high-frequency tilt
of the side chain; tube colour, odd harmonics rising while compressing. `pro-c.md`'s opto cell (5.13) already
has the memory; Stroe's numbers tighten it (2.2's release after 300 ms, 1 s and 5 s are three test points).

### 2.3 Tube-Tech CL 1B (opto, tube)

The rap and R&B tracking compressor (1.2).

**What it is.** An optical gain element (LED and light-dependent resistor, Mix's review) right after the input
transformer, then a push-pull tube amplifier (ECC83, ECC82) and an output transformer: "The signal is not fed
through any semiconductor circuitry on its way to the output." The side chain (two quad op-amps, two
transistors) holds two time-constant circuits, fixed and variable. Feedforward or feedback: **not stated**;
the make-up "has no influence on the threshold setting" and the ratio is a real control, both of which fit a
feedforward detector **(inferred)**.

| Control | Range |
| --- | --- |
| Threshold | +20 … −40 dBu, "defined as the point where the gain is reduced by 1 dB" |
| Ratio | **2:1 … 10:1, continuous** |
| Attack | 0.5 … 300 ms |
| Release | 0.05 … 10 s |
| Attack / Release select | **Fixed** (1 ms, 50 ms), **Manual** (the knobs), **Fix / Man** (below) |
| Gain | off … +30 dB, after the element |
| Link | a DC bus: "the unit which performs the most compression is controlling the others" |

**Fix / Man**, in Tube-Tech's words: "combines the release times of fixed and manual mode. The attack time is
as in the fixed mode … it is possible to obtain a release time depending on the input signal, e.g. get a fast
release when the peak disappears, then superseded shortly thereafter by the release time selected by the
release control. From the time the peak disappears, until the selected release time takes over, is dependent
upon the setting of the attack control … This function is valid only if the time of the peak is shorter than
the setting of the attack control. If the peak … is longer than the setting of the attack control … it will
respond as in the manual mode." Softube's model (endorsed by Tube-Tech): in Fix / Man "the Attack control
changes function from a pure attack control to a control of the delayed release". **(inferred)** As two
detectors whose larger reduction wins: a fast one (1 ms / 50 ms) and a slow one that only charges once the
signal has stayed over the threshold longer than the Attack time, then releases at the Release time. A short
peak decays at 50 ms; a sustained phrase holds.

**Measured.** THD < 0.15% at 40 Hz (0 and +10 dBu); 5 Hz–25 kHz; noise −85 dBu. THD against gain reduction:
**not stated**. The cell's own release memory: **not stated** (UA: it "grabs transients quickly and then
releases slowly along a natural, exponential curve").

**Tube-Tech's settings**: vocals (and bass, piano, guitar) **4–5 dB, Manual, attack 2 o'clock, release 10
o'clock, ratio 10–2 o'clock**; final mix 3–4 dB in Fix / Man; snare and kick 2–3 dB in Fixed.

**What a style needs.** Our opto cell without the LA-2A's ratio law: a real 2–10:1 ratio, a threshold at the
1 dB point (a soft knee below it), times across 0.5–300 ms and 0.05–10 s, Fix / Man as a two-detector release,
clean push-pull tube colour (odd harmonics, low). The smoothest of the vocal styles, and the most used at
tracking.

### 2.4 Empirical Labs Distressor (EL8)

**What it is.** A VCA ("a custom designed gain control circuit"), "digitally controlled analog", **feedback**
(Empirical Labs' own Arousor manual: "this is a feedback compressor, and does not use a Threshold control"),
with **no threshold knob**: "each 'ratio mode' … sets both the threshold and the ratio". Several ratios "use
different circuitry, and are effectively different compressors": 2:1, 10:1 and Nuke have special detector
circuits. A bass "sponge" circuit "prevents the nasty and crackly threshold distortion most compressors exhibit
with faster attacks on the bass" (Dave Derr).

| Control | Range |
| --- | --- |
| Input | 0 … 10 (to "10½"); "the harder you drive, the more knee you'll hit, and the greater the ratio will be" |
| Attack | 0 (fastest) … 10: 50 µs … 30 ms; "time constants are dependent on ratio" |
| Release | 0 (fastest) … 10: 0.05 … 3.5 s; **up to 20 s in 10:1 Opto** |
| Output | 0 … 10, calibrated |
| Ratio | **1:1** (no compression, "warming" only), **2:1** and **3:1** ("parabolic" knees, 2:1's "as long as 30 dB"), **4:1**, **6:1** (steeper knees "gradually move towards hard limiting"), **10:1 Opto** (an LA-2A-like circuit), **20:1**, **Nuke** (brick wall "within 1 dB or so", **logarithmic release**: "lets off quickly at first and then slows. This release curve is a big part of the Distressor's sound") |
| Detector | HP (6 dB/oct, ~80–100 Hz: stops "p's and b's"), Band Emphasis ("emphasized 6 kHz band makes unit overreact to harsh mids"), Link |
| Audio | Norm, HP (80 Hz Bessel, 18 dB/oct), **Dist 2** (0.05–3% THD, 2nd harmonic "especially while compressing"), **Dist 3** (0.1–20%, 3rd and 2nd, "very similar to tape … flattens out the top and bottom") |
| British Mode (EL8-X) | The 1176's all buttons "with any ratio"; keep attack "well under 4" |

Derr on 4:1 and 6:1: they "have a large knee, but over about 8 dB of compression, starts to really grab and hold
a vocal in place". Clean mode is 0.025–0.3% THD, 2nd-dominant.

**Empirical Labs' vocal settings**: "6:1 or lower, attack 5, release 4", 3–17 dB of reduction, HP on in the
detector and the audio, Band Emphasis on piercing passages, Dist 2 at mixdown for "a warm edge"; an aggressive
one at 6:1, attack 2.5–3.5, release 0–2, HP + Dist 2, "17–20 dB on loud ones". British Mode as "a great final
compression during mixdown … very transparent, but when a vocal pops out … gets in and out of there quickly
and smoothly". Its own emulation list: LA-2A = 10:1 Opto, attack 10, release 0, detector HP; 1176 = its 3:1,
4:1, 6:1 and 20:1 at attack 0–3.5.

**What a style needs.** Input into a fixed threshold per ratio; a curve per ratio (long parabolic knees at
2–3:1, a knee that grabs past ~8 dB at 4–6:1, the opto cell at 10:1, brick wall at 20:1 and Nuke); time ranges
that depend on the ratio; Nuke's logarithmic release; the detector HP and 6 kHz emphasis as fixed side chain
filters; Dist 2 (asymmetric, 2nd, its drive following the gain reduction) and Dist 3 (symmetric, tape-like
clipping); British Mode as a switch.

### 2.5 dbx 160 / 160X / 160A, and the 165

**What it is.** A Blackmer VCA, **feedforward**, with a **true-RMS detector** whose own averaging sets the
time: "attack and release times … 'track' the signal envelope … no manual attack/release adjustments are
required". dbx on feedforward: feedback designs go unstable at high ratios; "the dbx 160 … can provide infinite
compression (approximately 120:1)".

| | 160 (1976) | 165 / 165A | 160X / XT / 160A |
| --- | --- | --- | --- |
| Knee | hard | **Over Easy** | Over Easy or hard |
| Ratio | 1:1 … ∞ (~120:1) | 1:1 … ∞ | 1:1 … ∞ … **−1:1** (over-compression) |
| Attack | 15 ms for 10 dB, 5 ms for 20 dB, 3 ms for 30 dB (to 63%) | Auto as the 160; Manual 1–400 dB/ms | as the 160 |
| Release | **120 dB/s** | Auto 120 dB/s; Manual 10–4000 dB/s | **125 dB/s** (1, 10, 50 dB in 8, 80, 400 ms) |

So the attack is faster the bigger the jump (0.67, 4, 10 dB/ms), and the release is a **constant rate in dB**
**(inferred** from the figures**)**. Over Easy's threshold is "'half-way' into compression"; at ∞:1 the
threshold is where 6 dB of reduction is reached. Distortion is 2nd-dominant and low; the 3rd "decreases with
slower time constants, higher frequencies and lower compression ratios" (RMS ripple on the lows). The 165's
manual: "The Auto Mode is recommended for vocals". UA: "quirky VCA compression", "in-your-face 'thwack'",
"aggressiveness and impact to … a hip-hop vocal". Ari Morris: "The 160 really crushes the vocals". Maserati on
RComp: "it reminds me of the dbx 160X".

**What a style needs.** Feedforward RMS detection whose window is the timing (no attack or release knobs in its
own mode); attack faster with bigger jumps; a constant dB-per-second release; hard knee (160) or Over Easy;
ratios to over-compression; little colour.

### 2.6 Neve 33609 and 2254 (diode bridge)

**What it is.** A diode bridge in shunt, the audio across it, a DC current through it: "much like the FET in an
1176" (Dave Berners, UA). **Two closed-loop side chains on one element**, compressor then limiter: the
compressor reads "before the output line amplifier, thus enabling make-up gain", the limiter "the line
amplifier output", so **the compressor's make-up drives the limiter**.

| Control (33609/N) | Range |
| --- | --- |
| Compress threshold | −20 … +10 dB, 2 dB steps |
| Compress ratio | 1.5, 2, 3, 4, 6:1 |
| Compress attack | Fast 3 ms; Slow 6 ms **with a 100 Hz first-order side chain high-pass**, "preferred for percussive and plosive sounds" |
| Compress recovery | 100, 400, 800, 1500 ms, **a1**, **a2** |
| Limit threshold | +4 … +15 dBu; attack 2 / 4 ms; recovery 50, 100, 200, 800 ms, a1, a2 |

**Knee**: "soft and progressive, so the true ratio is only attained > 5 dB above the threshold" (5–10 dB on the
2254). **Auto recovery**: "rapid for transient peaks but slower for persistent high levels"; a1 100 ms / 2 s,
a2 50 ms / 5 s (AMS Neve); UA measured its 33609/C as compressor a1 40 → 800 ms, a2 150 → 1500 ms. Berners: "a
second-order filter, but a nonlinearity placed within the filter changes the behavior".

**Distortion that peaks in the middle.** Berners: with no reduction and with heavy reduction distortion is low;
"when gain reduction is between 3 and 7 dB, diode resistances are comparable to surrounding circuit elements,
and large audio signals can cause THD levels approaching 10%". UA's measurement of its model at −0.5 dBFS:

| GR (dB) | 0.1 | 0.6 | 1.8 | 3.2 | 4.5 | 5.9 | 7.3 | 8.8 | 10.4 | 12 | 13.7 | 15.4 | 17.2 | 20.6 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| THD (%) | 0.46 | 2.8 | 6.2 | 8.6 | 9.4 | 9.4 | 8.8 | 7.2 | 5.2 | 3.8 | 2.3 | 1.3 | 0.9 | 0.1 |

That level "would be impossible to observe … in real-world use", but it shows "how transients can be
beautifully softened" before the attack catches them. The balanced bridge leaves mostly odd harmonics
**(inferred**, from SOS on diode bridges**)**. Marasciullo used one on T-Pain's hook; Marroquin a 32264 at 3:1,
fast recovery, before his CL 1B.

**What a style needs.** Feedback; a soft knee reaching the ratio 5–10 dB over; slow-ish attacks (3–6 ms) with
the slow one's 100 Hz side chain high-pass; a1 / a2 dual recovery; a limiter stage after the make-up; distortion
that rises to a peak around 3–7 dB of reduction and falls again (Pines' diode model, section 4, gives it from
first principles).

### 2.7 SSL G-series bus compressor (VCA)

The "Bus" style's model, and the SSL channel compressor in many vocal chains (Schaeffer's 4:1, slow attack,
fast release; Tillie's "just there for vibe").

- **Detector**: "a true peak full wave detector … the dominant, ie. louder channel, controls the gain
  reduction" (SSL). **Topology**: "Although the Bus Compressor side-chain per se has a 'feed-back' topology, the
  signal feeding the side-chain is derived from a feed-forward position" (SSL): a second VCA in the side chain
  mirrors the main one ("acting mostly as a feed-back compressor", Gyraf). Make-up is outside the loop.
- **Controls**: threshold −15 … +15 dB; ratio 2, 4, 10; attack 0.1, 0.3, 1, 3, 10, 30 ms; release 0.1, 0.3,
  0.6, 1.2 s, **Auto**; make-up −5 … +15 dB.
- **Auto release**: "a two-stage release (100 ms short, 12 seconds long)" (SSL), made by two capacitor-resistor
  pairs stacked: "if the signal has been short, the larger cap is not significantly charged, hence the release
  time is short".
- **Knee**: "the knee point … purposely changes depending on the setting of the RATIO control. Decreasing the
  RATIO setting lowers the effective threshold" (SSL). Measured on a 1991 G384's control voltage (Thompson &
  Heilemann, DAFx 2026): near a hard knee at 10:1, more gradual and curved at 2:1 and 4:1, and "effective attack
  times are greatly accelerated by the loop gain … the attack trajectory deviates from an ideal exponential".
- **Colour**: low-frequency distortion from gain modulation at fast releases; the console's unbalanced VCA
  adds even harmonics.

### 2.8 API 2500 (VCA)

- **RMS detector**, three VCAs per channel, discrete op-amps. **Type**: New (feedforward: "more aggressive …
  harder") or Old (feedback, "how the older API 525, 1176 type and 660 type compressors worked": "smoother,
  softer").
- **Controls**: threshold +10 … −20 dBu; attack 0.03 … 30 ms (7 steps); ratio 1.5, 2, 3, 4, 6, 10, ∞; release
  0.05 … 2 s or variable 50 ms … 3 s; **Knee** Hard / Med / Soft.
- **Thrust**: "a filter in front of the RMS detector, with a slope of 10 dB per decade, which is the inverse of
  the pink noise energy curve … so each octave has the same energy". Loud is "down 15 dB at 20 Hz and up 15 dB
  at 20 kHz": "the 'little more punch' switch". Patented (US 5,170,437) as a "half-order, five-stage" RC
  network. **(inferred)** A tilt crossing 0 dB near 630 Hz.
- **Link**: the control voltages summed, 0–100%, through a shape filter.
- Vocal use: **not stated**. Its Thrust is the cleanest published case for a tilted detector, which TDR's
  Kotelnikov ("Low Freq Relax", 3 dB/oct "the theoretically most reasonable compromise") and Klanghelm's DC8C
  ("Tilt") also offer.

### 2.9 Fairchild 660 / 670 (vari-mu)

**What it is** (the 1959 manual and schematic). A push-pull 6386 remote-cutoff stage, four triode sections in
parallel per side, re-biased through the input transformer's centre tap by "an extremely high control
voltage"; **feedback** (the side chain reads the output); a full-wave peak rectifier from a tube driver.

- **Controls**: Input (1 dB steps), **AC threshold** (front) and **DC threshold** (screwdriver) which together
  set "slope and position of the curve", Time Constant 1–6, and Left-Right or Vertical-Lateral (sum and
  difference).
- **Time constants** (1959): attack 0.2 ms (positions 1, 2, 6) or 0.4 ms (3, 4, 5); release from 10 dB of
  limiting 0.3, 0.8, 2, 5 s; position 5 "2 seconds for individual peaks, 10 seconds for multiple peaks";
  position 6 "0.3 seconds for individual peaks, 10 seconds for multiple peaks, 25 seconds for consistently high
  program level". The schematic shows how (inferred): in 5 and 6, extra capacitors sit behind 100 kΩ, so a
  short peak charges only the first and drains fast into them, while a long one charges them all.
- **The curve** (the 1959 graph, factory setting): slopes of about 2.5:1 just over the knee, ~3.6:1 at +5–10
  dB, ~6:1 at +10–15, ~10:1 at +15–20, ~25:1 above: **the ratio rises steadily with level**. The DC trim moves
  it between a wide soft compressor and a fairly hard limiter. Heritage's reissue: "it is not possible to
  describe the ratio as 2:1, 10:1 or anything so exact".
- **Distortion**: IM (60 Hz + 7 kHz) flat at ~0.2% up to ~12 dB of limiting at 0 dBm out, then rising steeply;
  the louder the output, the earlier (at +12 dBm, ~1.4% at 10 dB). Moore measured a real 670 as clean (0.07% at
  1 kHz under reduction).
- **On vocals**: "an excellent cure for sibilance and harsh, spitty vocal consonants"; "the buttery, smooth
  vocal sound of the Beatles"; "can seemingly weld signals together … without much gain reduction registering
  on the meter" (SOS). Young Guru: "glues them together so well, without having this super compressor sound".
  Kinelski's PuigChild on Billie Eilish, Pogue's on Steve Lacy, Ali's on guests.

Pro-C 3's **Vari-Mu** style is this family; Raffensperger's model (section 4) gives the 6386's curve.

### 2.10 Manley Variable Mu

- Remote-cutoff dual triode (6386, later 5670, now two 6BA6 as triodes: "very close to the 6386"), fully
  differential, transformer-coupled, a **tube-rectified feedback** side chain: "Most modern compressors use a
  feedforward circuit which sounds unmusical to us".
- **Compress** (1.5:1 rising: "With about 2 dB of GR the ratio is approx 1.5:1. With about 5 dB the ratio
  becomes 2:1. With about 10 dB the ratio becomes 5:1") or **Limit** (4:1 rising to 20:1; "as the threshold is
  lowered the knee becomes very soft (round)"). "Many limiters have GR curves that can be drawn with a ruler.
  Not this one."
- **Attack 25–70 ms**: "Determines the necessary length of transient to initiate gain reduction"; **recovery**
  0.2, 0.4, 0.6, 4, 8 s. "We designed the Variable-MU to be difficult to dial in a 'bad' setting."
- Input drive is a colour control: "gentle tube distortion … 'tube warmth', richness and enhanced clarity".
- A mix-bus unit first; UA: usable "on … a lead vocal" but its "raison d'être is on the mix bus".

### 2.11 Waves Renaissance Compressor and RVox

Not hardware, but the most-named vocal compressors in the survey (1.2). Their controls, as Waves describes them
(from Waves' product pages, not re-read for this document, so treat as **(secondary)**): RComp has **ARC**
(Auto Release Control, a program-dependent release), **Opto** and **Electro** modes (two release behaviours)
and **Warm** / **Smooth** (with or without a little harmonic colour); RVox is a one-knob compressor with a gate
and a limiter. Their release laws are **not stated** by Waves. **(inferred)** What engineers hear ("doesn't
sound like compression", "a nice, squeezed waveform", "reminds me of the dbx 160X") is a clean feedforward
compressor whose release lengthens with sustained reduction: our Clean or Vocal style with Auto Release.

### 2.12 Side by side

| Unit | Gain element | Detector, loop | Ratio | Attack | Release | Colour | On vocals |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1176 | FET | peak, feedback | 4, 8, 12, 20, all; threshold rises with ratio | 20–800 µs | 50 ms–1.1 s, quicker after transients | distortion from fast release, worst on lows; bright tilt | The first stage: 4:1, slow-ish attack, fast release |
| LA-2A | T4 opto | the light itself, feedback | ~3–4:1 rising to limiting over ~10 dB | ~10 ms avg, freq-dependent | 60 ms to half, then 0.5–5 s with memory | tubes, odd under GR | The leveller: 4–8 dB continuously |
| CL 1B | opto + tube | not stated (FF inferred) | 2–10:1 | 0.5–300 ms (Fixed 1 ms) | 0.05–10 s (Fixed 50 ms), Fix / Man | clean push-pull | Tracking and smooth levelling, 4–5 dB |
| Distressor | VCA | feedback, per-ratio circuits | 1, 2, 3, 4, 6, 10 Opto, 20, Nuke | 50 µs–30 ms | 0.05–3.5 s (20 s Opto); Nuke logarithmic | Dist 2 (2nd), Dist 3 (tape) | 6:1, A5 R4, 3–17 dB; "grit and presence" |
| dbx 160 | VCA | RMS, feedforward | to ∞ and −1:1; hard or Over Easy | 15 / 5 / 3 ms for 10 / 20 / 30 dB | 120–125 dB/s | clean | "Crushes", "thwack" |
| Neve 33609 | diode bridge | feedback, comp then limiter | 1.5–6:1, ratio > 5 dB over | 3 / 6 ms | 0.1–1.5 s, a1 / a2 | THD peaking at 3–7 dB GR | Hooks; fast first stage (32264) |
| SSL G | VCA | peak, mirrored-VCA loop | 2, 4, 10; threshold moves with ratio | 0.1–30 ms | 0.1–1.2 s, Auto 100 ms / 12 s | LF modulation, even (console) | 4:1, slow attack, fast release; "vibe" |
| API 2500 | VCA | RMS, FF or FB | 1.5–∞, three knees | 0.03–30 ms | 0.05–3 s | clean | not stated |
| Fairchild 670 | 6386 tubes | peak, feedback | rising, 2.5 → 25:1 | 0.2–0.8 ms | 0.3–5 s, auto 2/10, 0.3/10/25 s | IM rising with GR | Glue, sibilance control |
| Manley Vari-Mu | remote-cutoff triode | tube, feedback | 1.5 → 5–8:1 / 4 → 20:1 | 25–70 ms | 0.2–8 s | tube drive | Mix bus; occasionally vocals |
| RComp | digital | not stated | as set | as set | ARC | Warm / Smooth | The rap and R&B workhorse |

---

## 3. What other compressors do

Thirty-odd compressors read from their manuals: the DAWs' own (Ableton's Compressor and Glue, FL Studio's
Fruity Limiter, Fruity Compressor, Maximus, Emphasis; REAPER's ReaComp; Bitwig's Compressor+; Pro Tools' Dyn3
and Pro Compressor; Logic's), vocal ones (iZotope Nectar 4 and Neutron 4, sonible smart:comp 2 and 3, Waves
CLA Vocals, Baby Audio IHNY-2), analogue models (Arturia's FET-76, VCA-65, TUBE-STA, DIODE-609; Slate's
FG-Stress, FG-116, FG-Grey; Kiive XTComp; Softube's CL 1B, FET, TLA-100A; Sonnox Oxford Dynamics), and the
specialists (Klanghelm DC8C 3 and MJUC, TDR Kotelnikov and Molot, Weiss DS1-MK3, DMG Compassion).

### 3.1 Ideas worth taking

Each with where it's from and what we do with it (`pro-c.md` section numbers).

| Idea | From | Ours |
| --- | --- | --- |
| **Two compressors in one vocal plug-in** | Nectar 4 (two Compressor modules in series, Digital / Vintage / Optical / Solid-State), Nectar 2 (two in parallel) | Two Pro-Cs in two slots (the effect slot is the module); the assistant's `add_vocal_compression` makes the pair in one step (7, 8.7) |
| **A mode that is a whole circuit** (its own detector, curve, times, colour, its own knob ranges) | Logic's seven circuit types, Nectar's modes (Optical: fixed 4:1, 1–100 ms / 40–200 ms; Solid-State: 4–12:1), Bitwig's Character, Pro Compressor's detection modes ("Each mode has its own attack and release times") | Pro-C's styles are exactly this; the Vintage group adds the units' own ranges (4) |
| **The unit's own knobs: Input into a fixed threshold** | Every 1176, LA-2A, Distressor and Fairchild model (Arturia, Slate, Softube, UA, Kiive); Arturia and Kiive link Output to Input so driving doesn't get louder | The Vintage styles' Threshold knob is labelled Input, with Output following it (4) |
| **Release that depends on what came before** | SSL Auto (100 ms / 12 s), 33609 a1 / a2, CL 1B Fix / Man, Fairchild 5 and 6, Weiss (peak vs RMS chooses Release Fast or Slow), Glue's auto ("a slow one as a base … a fast one to react to transients"), Ableton's Log mode, Fruity Compressor's TCR, Kotelnikov's parallel peak and RMS paths, DMG's Short / Long, Neutron, smart:comp 3 | Pro-C's program dependency (`K`) and Auto Release already; the Vintage styles get their unit's own law (4) |
| **A peak path and an RMS path in parallel, the bigger reduction wins** | TDR Kotelnikov ("The section generating the highest reduction … takes control"; Peak Crest 3–8 dB "virtually distortion free handling of tonal content") | A candidate for Vocal and Smooth: transients caught by the peak path, the body by the RMS path, no cycle-following on low notes (5.3, to tune) |
| **A tilted detector** | API Thrust (+10 dB/decade), Kotelnikov LF Relax (3 dB/oct), DC8C Tilt, Softube FET Mk II "Sidechain Punch", the LA-2A's R37 | The side chain EQ can draw it; the vocal presets use a gentle high-pass and tilt (6) |
| **A detector high-pass on the slow attack** | The 33609's Slow attack (100 Hz), the Distressor's detector HP, Seara's 70 Hz | Vocal presets: SC high-pass 80–120 Hz (6) |
| **A cap on how much it reduces** | Glue's Range, Pro Compressor's Depth, Arturia's Compression Range, DC8C's Range | Pro-C's Range already |
| **Gain reduction limited by a soft S-curve** | Kotelnikov GE's GR Limit (an S-shaped transfer function) | Pro-C's Range corner (5.4) is that |
| **Measured make-up, learnt once** | Bitwig's Learn Make-up Gain (listens up to 15 s), TDR's Equal Loudness Trim / Bypass, FL Emphasis's Level Matching, Nectar 2 (RMS in and out), smart:comp | A **Match** button: learn the input and output loudness over a few seconds of playback and set Wet Gain once (proposed, 7). Pro-C's Auto Gain stays the static guess (it never pumps) |
| **Hear what's taken away** (delta) | Pro Compressor's Attenuation Listen, Emphasis's Delta, Kotelnikov's Delta, smart:comp 3's diff | Pro-C's Audition Triggering is that (5.1) |
| **A history display with the gain reduction over the audio** | Pro-C, Ableton's Activity, Nectar, Neutron, smart:comp, Fruity Limiter, Emphasis (GR per stage) | Pro-C's level display |
| **A transfer curve you drag** | Avid Pro Compressor (threshold, ratio, knee, depth on the curve; the ball leaves the curve on overshoot), Ableton (drag the knee), DMG | Proposed: drag the knee display's threshold and ratio (8.6, small) |
| **A gain reduction meter that says which part is the knee** | Dyn3: light orange inside the knee, dark at full ratio | Nice, cheap; proposed for the knee display's dot |
| **Hold before release** | Pro-C, Sonnox ("the release time is effectively multiplied by the hold time"), Weiss Release Delay ("avoids … pumping"), DMG ("to prevent release during breaths") | Pro-C's Hold already |
| **Low-latency mode for recording** | Nectar 2 (Tracking vs Mixing), Neutron's Zero Latency, smart:comp 3's Minimum phase, Kotelnikov's Live | Pro-C is zero-latency with Maximum Lookahead and Oversampling off: the vocal presets keep both off, so it can be recorded through (6) |
| **One knob** | Waves CLA Vocals (Sensitivity + a ±10 Compress fader + colours), RVox, Nectar's Intensity, IHNY-2's XY pad, smart:comp 3's "snappy ↔ punchy" / "dynamic ↔ dense" matrix | Pro-C's Vocal style (only Threshold matters); the assistant is the other one-knob path ("compress this vocal about 4 dB") |
| **A rider before the compressor** | Nectar 4's Auto-Level ("an intelligent and transparent alternative to compressors… it acts like a recording engineer", Range ±1–12 dB, Tame Noise ignores breaths), Waves Vocal Rider | Not a compressor: a separate effect later (7, "later") |
| **Over-compression** (negative ratios) | dbx 160X, Avid, Bitwig, Weiss's 1:5 upward expansion | Pro-C's Mix at 200% reaches it; not a ratio |
| **The release's shape** | Fruity Limiter's CURVE 1–8, Maximus's REL + REL2, DC8C's S-curves, DMG's Curve Law | Not proposed: a style decides its shape |

### 3.2 What producers complain about

What the reviews and the forums we could read say (Gearspace and Reddit refused automated reading, so this is
KVR, MusicTech, Sound On Sound and the makers' own admissions):

- **Times that mean different things.** "The time after the output reaches 50% of its target. Or 80% or −3 dB
  or whatever" (FabienTDR, KVR); Cytomic measured The Glue as a 10–90% time; JUCE's forum a 63% one; most
  manuals say "fully compressed", which an exponential never is. Pro-C's are τ, the 63% time, written down and
  tested (`pro-c.md` 5.0). The window should say so.
- **Auto gain that guesses wrong.** "Auto gain occasionally off so have to level match manually" (MusicTech on
  smart:comp 2); FabFilter itself: "it just makes an educated guess". Hence the proposed Match.
- **Latency that rules out tracking.** smart:comp 2's ~43–100 ms ("tracking is not (yet) possible", sonible).
  Pro-C's default is zero.
- **Too slow to catch peaks**, then aliasing when fast: a KVR review of Pro-C 1 ("attack starts at 0.5 ms …
  slow"); fast settings "may lead to a slight 'buzziness'" (Ableton). Pro-C 3 goes to 5 µs with oversampling.
- **Styles that sound alike** "when operating in a normal range" (a KVR review of Pro-C 2). The Vintage
  styles should differ audibly; the presets should show each one's strength.
- **Controls scattered**: Pro-C 2's wet, dry and mid/side "three different knobby things in different areas"
  (KVR).

---

## 4. What the modelling literature adds

Papers that measured or modelled these units, beyond the design literature `pro-c.md` already uses
(Giannoulis, Massberg & Reiss 2012 and 2013; Floru; Sanfilippo; Signalsmith).

| Paper | What it found | What it means for us |
| --- | --- | --- |
| **Stroe**, T4 cells built and measured (Huddersfield, 2017/18) | Two-stage attack (to 63%, then a slow tail of a second or more); release depends on how long the light was on (CdS: 1.6 s after 5 s, 1.2 s after 1 s, 0.15 s after 300 ms); CdSe much faster; reduction rises with frequency | Our opto cell's three test points; a two-stage attack too (the current model has one) |
| **Najnudel, Müller, Hélie, Roze** (DAFx23), a vactrol as a power-balanced physical model | Two charge-carrier states; "the higher the input voltage, the shorter the attack and the longer the release"; program dependence comes from the physics | The behaviour to match; too costly for us (Newton per sample): our two-state cell is the cheap stand-in |
| **Parker & D'Angelo** (DAFx13), a vactrol for Buchla's gate | A one-pole whose τ switches ~12 ms up, ~250 ms down, shortened at high levels; R = A/I^1.4 + B | The cheapest plausible cell; no long memory, so it needs our slow part |
| **Wright & Välimäki** (DAFx 2022), grey-box LA-2A | A Giannoulis compressor with learnt parameters fits the LA-2A best with switching attack / release, better still with a state-dependent τ: small when the input is large | Confirms the cell's level-dependent speed |
| **Yu et al.** (DAFx24) | A single feedforward compressor fitted to the LA-2A leaves 8–10% error: the memory isn't one pole | The same |
| **Yu & Fazekas** (AES AIMLA 2025), the LA-2A matched by Newton–Raphson | Five parameters against Peak Reduction: at 40 / 70 / 100, threshold −13 / −20 / −35 dB, ratio 5.4 / 4.3 / 3.7, attack τ 14 / 1.8 / 0.45 ms, release τ 214 / 116 / 111 ms; "it does not capture the documented two-stage release … but an average of them"; fitted ratio ~4:1 against the nominal 3:1 | Opto 2A's Peak Reduction knob can be checked against this table |
| **Berners & Abel** (UA), on modelling the 1176 | On sines the ratios are "much higher than what is selected on the front panel", on transients "very close"; "it is critical to get that entire [release] trajectory right" | A FET model with a peak detector in a feedback loop gives this by itself |
| **The digital feedback loop** (our own derivation and simulation, checked against THAT's design note) | Run with a one-sample delay, the loop's attack pole is `1 − (1 − α)·R`: the effective attack is ~τ/R (the "accelerated" attack Thompson measured on the SSL), it rings when `(1 − α)·R > 1` and settles on the wrong gain past 2 (48 kHz, 20:1, τ 100 µs: 46.6 dB instead of 28.5) | Why `pro-c.md` 5.7 solves the loop implicitly each sample rather than with a delay: stable at any attack and ratio without oversampling |
| **Aliasing** (our own simulations) | It comes from the gain signal, not the multiply: at 0.1 ms attack, oversampling only the multiply changed nothing; running the side chain and the multiply at 4× took aliasing from −64 to −91 dB. At attacks of 1 ms and more it's already around −70 dB at the base rate | Confirms 5.11: the whole gain path runs oversampled; the vocal presets (≥ 0.25 ms) need none |
| **Steinmetz & Reiss** (AES 2022), neural LA-2A | Models differ from the hardware "in cases of strong gain reduction, letting some transients pass through more" | The hard part to get right: how it grabs transients under heavy reduction |
| **Moore** (PhD, Huddersfield, 2017), 1176, LA-2A, 670, dbx 165A measured | The numbers quoted in 2.1, 2.2, 2.9; the 1176's distortion follows release more than attack | The FET style's distortion law |
| **Moore & Wakefield** (AES 2017) | 1176 settings with audible distortion are rated "aggressive" | Aggression *is* the distortion: it belongs in the FET style |
| **Raffensperger** (DAFx12), a wave digital Fairchild 670 | The 6386's curve `Ia = p1·Vak^p2 / ((p3 − p4·Vgk)^p5 · [p6 + exp(p7·Vak − p8·Vgk)])` with fitted constants; the timing network's values per position; a balanced stage gives only odd harmonics | The Vari-Mu style's gain law can come from it; its distortion is likely overstated (Moore measured a clean 670) |
| **Pines** (DAFx25), diode VCAs in real time | `y = (1/α)·ω(αx + β) − (1/α)·ω(β)` (ω: Wright omega); distortion rises as gain *falls*, with even and odd lobes; a balanced bridge gives only odd harmonics, least at gain ½ | A Diode style's colour from first principles, with antiderivative antialiasing |
| **Thompson & Heilemann** (DAFx26), SSL G384's control voltage | Curved knee at 2:1 and 4:1, near hard at 10:1; Auto is a two-pole release; the loop makes attacks faster and non-exponential | The Bus style's numbers |
| **Gu et al.** (DAFx25), SSL bus compressor dataset | A grey-box soft knee and a switching one-pole fit best; commercial plug-ins still beat the neural models | A table-driven style is enough |
| **Eichas & Zölzer** (2016–17), grey-box opto and 1176 models | Measured static curve + time constants + a fitted nonlinearity reproduce the units; an optocoupler turns on in ~5 ms and off ~100× slower | Our method: each style is a measured-shape table, tuned by ear |
| **Martínez Ramírez, Benetos, Reiss** (2020), 1176 all buttons | Models need memory even at the slowest release; all buttons "introduces distortion due to the variation of attack and release times" | All buttons is a time-varying effect, not only a curve |

Gaps: no paper models the Distressor, the dbx 160, the API 2500 or the Manley; no circuit-level 1176 paper was
found (its feedback detection and ratio-dependent threshold come from UA's manual and one measurement).

---

## 5. Sources

**The engineers** (Sound On Sound unless said)

- Inside Track: Future "Draco" https://www.soundonsound.com/techniques/inside-track-future-draco; Kendrick
  Lamar *To Pimp A Butterfly* https://www.soundonsound.com/techniques/inside-track-kendrick-lamars-pimp-butterfly;
  "All The Stars" https://www.soundonsound.com/techniques/inside-track-kendrick-lamar-black-panther-all-stars;
  Pharrell "Happy" https://www.soundonsound.com/techniques/inside-track-pharrell-williams-happy; Selena Gomez
  "Rare" https://www.soundonsound.com/techniques/inside-track-selena-gomez-rare?page=2; Beyoncé & Jay-Z
  "Apeshit" https://www.soundonsound.com/techniques/inside-track-beyonce-and-jay-z-apeshit; Chris Brown "Heat"
  https://www.soundonsound.com/techniques/inside-track-chris-brown-heat; Lil Baby
  https://www.soundonsound.com/techniques/inside-track-lil-baby-sum-2-prove?page=2; Lil Uzi Vert
  https://www.soundonsound.com/techniques/inside-track-lil-uzi-vert; 21 Savage
  https://www.soundonsound.com/techniques/inside-track-21-savage?page=2; Cardi B
  https://www.soundonsound.com/techniques/inside-track-cardi-b-bodak-yellow; YoungBoy
  https://www.soundonsound.com/techniques/inside-track-youngboy-loner-life; MoneyBagg Yo
  https://www.soundonsound.com/techniques/inside-track-moneybagg-yo-wockesha; Trippie Redd
  https://www.soundonsound.com/techniques/inside-track-trippie-redd-love-letter-you-5; Lil Tecca
  https://www.soundonsound.com/techniques/inside-track-lil-tecca-ransom; Doja Cat
  https://www.soundonsound.com/techniques/inside-track-doja-cat-ft-nicki-minaj-say-so; The Weeknd
  https://www.soundonsound.com/techniques/inside-track-weeknd; SZA https://www.soundonsound.com/techniques/inside-track-sza-kill-bill;
  Olivia Rodrigo https://www.soundonsound.com/techniques/inside-track-olivia-rodrigo-drivers-license; Billie
  Eilish https://www.soundonsound.com/techniques/inside-track-billie-eilish-bad-guy; Shawn Mendes
  https://www.soundonsound.com/techniques/inside-track-shawn-mendes-treat-you-better; Dua Lipa
  https://www.soundonsound.com/techniques/inside-track-dua-lipa-dont-start-now; Polo G
  https://www.soundonsound.com/techniques/inside-track-polo-g-rapstar; Metro Boomin
  https://www.soundonsound.com/techniques/inside-track-metro-boomin-heroes-villains; Pentatonix
  https://www.soundonsound.com/techniques/inside-track-pentatonix; Justin Timberlake
  https://www.soundonsound.com/techniques/inside-track-justin-timberlakes-2020-experience
- Secrets Of The Mix Engineers: Jaycen Joshua https://www.soundonsound.com/techniques/secrets-mix-engineers-jaycen-joshua;
  Chris Lord-Alge https://www.soundonsound.com/techniques/secrets-mix-engineers-chris-lord-alge; Manny
  Marroquin https://www.soundonsound.com/techniques/secrets-mix-engineers-manny-marroquin; Tony Maserati
  https://www.soundonsound.com/techniques/secrets-mix-engineers-tony-maserati; Fabian Marasciullo
  https://www.soundonsound.com/techniques/secrets-mix-engineers-fabian-marasciullo; Spike Stent
  https://www.soundonsound.com/techniques/secrets-mix-engineers-mark-spike-stent; Young Guru
  https://www.soundonsound.com/techniques/secrets-mix-engineers-young-guru
- Tom Elmhirst https://www.soundonsound.com/node/4905063; Mike Dean https://www.soundonsound.com/node/4927262
- Mike Senior, "Advanced Vocal Compression" https://www.soundonsound.com/techniques/advanced-vocal-compression;
  Mix Rescue https://www.soundonsound.com/techniques/mix-rescue-bobby-nobody and
  https://www.soundonsound.com/techniques/mix-rescue-stvitus; Paul White, "Compression & Limiting"
  https://www.soundonsound.com/techniques/compression-limiting, "Vocal Production"
  https://www.soundonsound.com/techniques/vocal-production, Vocal Rider review https://www.soundonsound.com/reviews/waves-vocal-rider
- Puremix: CLA in the box https://www.puremix.com/blog/chris-lord-alge-mixing-vocals-in-the-box; Brauer
  https://www.puremix.com/blog/michael-brauers-parallel-vocal-compression-technique; Scheps
  https://www.puremix.com/blog/what-is-the-andrew-scheps-vocal-air-trick-a-step-by-step-guide
- Mix, CLA https://www.mixonline.com/recording/chris-lord-alge-372731; Serban Ghenea https://www.mixonline.com/?p=91054
- ProSoundWeb, Spike Stent and the 1176AE https://www.prosoundweb.com/?p=77883
- Universal Audio: vocal chains https://www.uaudio.com/blog/top-uad-vocal-chains/; LA-2A and 1176 in a mix
  https://www.uaudio.com/blogs/ua/how-to-use-the-la-2a-and-1176-in-your-mix; 1176 tips https://www.uaudio.com/blogs/ua/1176-collection-tips
- Filter Magazine, Jaycen Joshua https://filter.audio/joshua.html (from a search excerpt)

**The units**

- 1176: UA 1176LN manual https://media.uaudio.com/assetlibrary/1/1/1176ln_manual.pdf; Will Shanks, UA's 1176
  revision history and all-buttons notes (UA blog); SOS, Wes Audio ng76 review; DIY Recording Equipment's
  revision notes; History of Recording
- LA-2A: Teletronix 1966 manual; UA LA-2A manual https://media.uaudio.com/assetlibrary/l/a/la-2a_manual.pdf;
  UA LA-2A Collection notes; LA-3A brochure (UREI)
- CL 1B: Lydkraft owner's manual https://kmraudio.com/cdn/shop/files/Manual-CL-1B-180515.pdf; Softube's manual
  https://softube.com/user-manuals/tube-tech-cl-1b-and-cl-1b-mk-ii-compressors; Barry Rudolph, Mix, 2008
  https://www.mixonline.com/?p=74903; Tube-Tech https://www.tube-tech.com/cl-1b-opto-compressor/
- Distressor: Empirical Labs manual https://www.empiricallabs.com/wp-content/uploads/distressor_manual.pdf;
  older manual https://www.barryrudolph.com/recall/manuals/distressor1.pdf; Arousor manual
  https://www.empiricallabs.com/wp-content/uploads/arousor_manual_rev2_v1.pdf; Dave Derr, SonicScoop 2018
  https://sonicscoop.com/inventor-insights-dave-derrs-tips-tricks-for-the-empirical-labs-distressor/; UA's
  Distressor manual https://help.uaudio.com/hc/en-us/articles/18741515014676
- dbx: 160/161 manual https://dbxpro.com/en-US/product_documents/160-161-owners-manualpdf--2; 160A
  https://dbxpro.com/en-US/product_documents/dbx160a-18-2040v-cpdf; 160X https://archive.org/details/dbx_dbx_160x;
  160X/XT https://archive.org/details/dbx_dbx_160x-xt; 165/165A https://dbxpro.com/en-US/product_documents/165-165a-owners-manualpdf;
  UA dbx 160 https://help.uaudio.com/hc/en-us/articles/18741620620692
- Neve: 33609/N manual https://www.ams-neve.com/wp-content/uploads/2022/01/33609N1.0usermanual.pdf; 2254/R
  https://www.ams-neve.com/wp-content/uploads/2023/01/2254R_User_Manual_Iss2_4-1.pdf; 2264ALB
  https://www.ams-neve.com/wp-content/uploads/2021/08/2264albusermanualiss1.2.pdf; UA Neve Dynamics manual
  (Berners) https://help.uaudio.com/hc/en-us/articles/33536131639956; Berners, "33609 Warmth"
  http://web.archive.org/web/20211016150921/https://www.uaudio.com/blog/33609-warmth/; SOS 2254/R
  https://www.soundonsound.com/reviews/neve-2254r
- SSL: THE BUS+ user guide https://www.solidstatelogic.com/assets/uploads/downloads/The_Bus_User_Guide_1.1.pdf;
  500-series G Comp guide https://www.solidstatelogic.com/assets/uploads/downloads/SSL_500_Series_G_Comp_Module_User_Guide.pdf;
  Gyraf's clone notes https://gyraf.dk/gy_pd/ssl/ssl.htm; UA's SSL G manual
  https://help.uaudio.com/hc/en-us/articles/30847649785748
- API: 2500 manual https://apiaudio.com/docs/manuals/2500_user_18-06-18.pdf; 2500+
  https://apiaudio.com/docs/manuals/2500+_user_23-01-09.pdf; US 5,170,437 https://patents.google.com/patent/US5170437A/en
- Fairchild: 1959 manual and schematic http://thehistoryofrecording.com/Manuals/Fairchild/Fairchild_670_stereo_limiting_amplifier_instructions_Schematics.pdf;
  SOS (Bieger, 2016) https://www.soundonsound.com/reviews/fairchild-660-670; UA's Fairchild manual
  https://help.uaudio.com/hc/en-us/articles/13293388042900; Heritage Herchild 670 manual; GroupDIY on the time
  constants https://groupdiy.com/threads/problem-with-fairchild-660-670-original-manual-data.40623/
- Manley: owner's manual (2015) https://r2.gear4music.com/media/20/203949/download_203949.pdf; early manual
  https://www.barryrudolph.com/recall/manuals/manleyvarimu.pdf; UA's model https://help.uaudio.com/hc/en-us/articles/18737967080340

**Other compressors** (manuals): Ableton Live 12 reference https://www.ableton.com/en/manual/live-audio-effect-reference/;
FL Studio's Fruity Limiter, Fruity Compressor, Maximus, Emphasis (Image-Line's online manual); REAPER
ReaEffects guide https://www.reaper.fm/userguide/REAPEREffectsGuide2021.pdf; Bitwig
https://bitwig.com/userguide/latest/dynamic; Avid Audio Plug-Ins Guide 2024.6
https://resources.avid.com/SupportFiles/PT/Audio_Plug-Ins_Guide_2024.6.pdf; iZotope Nectar 4
https://docs.izotope.com/nectar4/en/compressor/index.html, Auto-Level https://docs.izotope.com/nectar4/en/alm/index.html,
Neutron 4 https://docs.izotope.com/neutron4/en/compressor/index.html; sonible smart:comp 3
https://www.sonible.com/wp-content/uploads/2025/12/manual-smartComp3.pdf; Waves CLA Vocals
https://assets.wavescdn.com/pdf/plugins/cla-vocals.pdf; Arturia FET-76, VCA-65, TUBE-STA, DIODE-609 manuals
(arturia.com); Slate VMR docs https://docs.slatedigital.com/VMR/Virtual_Mix_Rack.html; Kiive XTComp
https://files.plugin-alliance.com/products/kiive_xtcomp/kiive_xtcomp_manual.pdf; Sonnox Oxford Dynamics user
guide; Softube FET Compressor and Mk II, TLA-100A (softube.com user manuals); Klanghelm DC8C 3
https://klanghelm.com/docs/DC8C3-manual.pdf, MJUC https://klanghelm.com/docs/MJUC-manual.pdf; TDR Kotelnikov GE
https://docs.tokyodawn.net/kotelnikov-ge-manual/, Molot GE https://docs.tokyodawn.net/molot-ge-manual/; Weiss
DS1-MK3 https://weiss.ch/wp-content/uploads/2022/07/DS1-MK3-Manual.pdf; DMG Compassion
https://dmgaudio.com/dl/DMGAudio_Compassion_Manual.pdf. Reviews and forums: MusicTech on smart:comp 2; KVR's
product pages and DSP forum (https://www.kvraudio.com/forum/viewtopic.php?t=390979); the JUCE forum
(https://forum.juce.com/t/how-to-calculate-attack-and-release-time-on-a-compressor/40266); GroupDIY.

**Modelling** — Stroe https://eprints.hud.ac.uk/id/eprint/34532/; Najnudel et al.
https://dafx.de/paper-archive/2023/DAFx23_paper_50.pdf; Parker & D'Angelo
https://dafx.de/paper-archive/2013/papers/44.dafx2013_submission_56.pdf; Wright & Välimäki
https://dafx.de/paper-archive/2022/papers/DAFx20in22_paper_35.pdf; Yu et al.
https://dafx.de/paper-archive/details/kJ3x4p22fkrjr8QN-65PIw; Steinmetz & Reiss https://arxiv.org/abs/2102.06200;
Moore (PhD) https://eprints.hud.ac.uk/id/eprint/34118/; Moore & Wakefield (AES 142, paper 9749); Raffensperger
https://dafx.de/paper-archive/2012/papers/dafx12_submission_9.pdf; Pines
https://dafx.de/paper-archive/2025/DAFx25_paper_44.pdf; Thompson & Heilemann
https://dafx.de/paper-archive/2026/papers/DAFx26_paper_30.pdf; Gu et al.
https://dafx.de/paper-archive/2025/DAFx25_paper_13.pdf; Eichas & Zölzer
https://www.hsu-hh.de/ant/wp-content/uploads/sites/699/2017/10/Eichas-Modeling-of-an-optocoupler-based-audio-dynamic-range-control-circuit-99480W.pdf;
Gerat, Eichas & Zölzer (AES 143, paper 9852); Martínez Ramírez et al. https://www.mdpi.com/2076-3417/10/2/638;
Simionato & Fasciani https://arxiv.org/abs/2408.12549
