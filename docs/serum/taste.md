# Théo's taste in Serum presets

What 118 starred Serum presets say about the sounds Théo likes, written so that a person or an LLM can design new
Serum presets in that taste. The Serum 1 favourites (`.fxp`) are the ones Théo calls the most tasteful: they carry
the weight here. The Serum 2 ones (`.SerumPreset`) are mostly factory and pack presets and are used as contrast.

The world it comes from is underground: Drain Gang / Bladee-adjacent cloud rap, trance-tinged, lo-fi
(`ld - literally whitearmor` is named after Whitearmor). Most of the Serum 1 favourites come from **shinju**'s banks
(`@shinju_09`: `MO_SHINJU_*`, the `[PS]` presets, `lead/pad/pluck/synth/key [name]`, "shinju serum bank vol. 1–5"),
from **tda** (`ld -`, `pl -`, `banjo lol`, `MO_TDA_SY_Monitor`) and from **Stickz** (`PAD -`, `VOX -`, `GUITAR -`).

Everything below is a reading of settings, not of sound. Where a sentence says what something "sounds like", it is
an inference from the controls.

---

## 1. Method and caveats

**The data.** Each Serum 1 preset was converted by Serum 2's own importer; every preset was then loaded into the real
Serum 2, hosted offline, and two things were captured: the preset document (`out/<name>.json`) and Serum's readout of
all 541 controls as it displays them (`params/<name>.params.json`). Both live in
`/Users/theobourgeois/code/editor/data/serum-research/`. A preset's changes were found by comparing its readout with
`__init`'s, by index.

**What was done here** (scripts in `data/serum-research/tools/`, outputs in `data/serum-research/taste/`):

- `validate.py` checks that each decode is really its preset: the decoded name must be the file's, and every
  wavetable the decode names must appear among the strings of the original `.fxp`.
- `extract.py` turns each valid decode into one record (`taste/records.json`) and a compact card (`taste/cards.txt`).
- `categories.py` holds the categories assigned below; `stats.py` makes every count in this document.
- `fxp_strings.py` reads the readable strings out of a Serum 1 file (tables, author, description, macro names).
- `embedded_tables.py` and `table_frames.py` measure the harmonics of embedded tables and of Serum's factory tables,
  to say what a wavetable position actually is (saw, sine, triangle…).

**The captures were checked.** Each Serum 1 capture was accepted only when Serum's own preset name matched the
file, its state was stable over two polls, and every wavetable or sample it names is among the original `.fxp`'s
strings (`validate.py` repeats the last checks for all 118; an earlier capture had taken 23 presets' states from
the wrong preset and was redone). All counts below are over the **86 Serum 1** and **32 Serum 2** presets.

**What the data can't tell.**

- No sound was heard. Brightness, width and loudness are readings of settings.
- Effects: only the values stored in the file are known; Serum's defaults are not. An effect listed with few values
  runs mostly on defaults. Some values recur so often that they are probably defaults (Delay `Wet=30, Feedback=40`;
  Hall reverb `Size=35, Width=20`; Compressor `Attack=90.1, Release=89.9`; Chorus `Feedback=9.5`).
- An effect stored at `Wet=0` with a macro on it is silent until the macro moves. "Heard at load" below means the
  stored wet plus each macro's stored value × its mod amount is above zero (mod wheel at its stored position).
- Mod amounts are Serum's displayed percentages of a control's range.
- Wavetable positions: Serum shows `WT Pos`; the files store `TablePos` (0–256). Frames were read as
  `1 + TablePos/256 × (frames − 1)`, and the factory tables measured: **Analog/Basic Shapes** = 1 sine, 2 saw,
  3 triangle, 4 square, 5–6 pulses, 7 soft square; **S2 Tables/Default Shapes** = 1 saw, 2 sine, 3 triangle,
  4 soft square, 5 square, 6–7 pulses, 8–9 buzz; **Analog/Analog_BD_Sin** = six near-sine frames (2nd harmonic at
  most 15%); **Digital/HarmonicSeries** = frame *n* is the *n*-th harmonic alone; **Basic Mini** frame 1 = saw.
  Serum morphs between frames, so a position of 2.6 in Basic Shapes is a saw→triangle blend.
- "Own table" in a Serum 1 preset is an embedded table. Of the 65 embedded tables in the 86 Serum 1 captures, 48 are
  a single 2048-sample frame with an exact 1/n spectrum: **a plain sawtooth** (Serum 1's init wave). 30 of the 41
  sounding "own table" oscillators are that saw; the rest are a few sines and multi-frame user tables.
- The reverb's `Type` is stored only when it isn't the default. Serum 1 presets with no stored type carry a
  `PreDelay` and mostly `Width=100` rather than the Hall's values: they are **probably Plate** (an inference).
- A Hall reverb's stored `Delay` (30.6 when untouched, up to 250) is read as its pre-delay in ms.
- EQ band types are read as 0 = shelf, 1 = peak, 2 = cut (so `Type1=2` at ~200 Hz is a low cut). Delay `Mode=1` is read
  as ping-pong. Both are assumptions about Serum's menus, consistent with the stored gains.
- The Serum 1 effects order mostly *is* Serum 1's default rack order (HyperD, Distortion, Flanger, Phaser, Chorus,
  Delay, Compressor, Reverb, EQ, Filter), so order is only meaningful where it differs.
- `Main Vol=54% [-7.7 dB]` on 48 Serum 1 presets is the converter's, not a choice.

---

## 2. The catalogue

Category mostly from the name; *(inf.)* = decided from the settings. S = Serum version. Sketches are readings of
settings.
"tda-style file" = no author, but the file carries the same internal 8-letter code as tda's presets: a weak hint,
since such codes are shared across authors elsewhere.

### Lead (13, all Serum 1)

| Preset | S | Author / bank | Sketch |
|---|---|---|---|
| ld - literally whitearmor | 1 | blank (tda-style file) | Poly. Saw→triangle blend (Basic Shapes ≈2.6, 3 voices, detune 0.06) plus a quiet pure 3rd–4th harmonic (HarmonicSeries) panned left and auto-panned over a bar; MG Low 24 at 2.2 kHz, drive 40; slow pitch wobble; chorus 28%, wide plate-type reverb. Soft, airy, hollow. |
| ld - 3ds | 1 | tda | Mono legato, 10 ms glide. Square→pulse (Basic Shapes ≈4.3) + saw, 2 voices each, mains-hum noise 46%; a 53.5 Hz LFO on A Fine (audio-rate grit); distortion drive 100. Buzzy, lo-fi, dry. |
| ld - hendrix | 1 | tda | Mono legato, 117 ms glide. Two saws (one −1 oct) + hum noise; Band 24 at 73 Hz, res 28, swept by a 4-bar LFO; Zero-Square distortion drive 100; flanger 69%. Fuzz-guitar lead. |
| lead [club] | 1 | @shinju_09, vol. 2 | Mono legato, 40 ms glide. One saw/triangle (Basic Shapes ≈2.7) at 16 voices, detune 0 breathed by a ½-note LFO; flanger 92, phaser 61, sine-fold distortion 34, OTT-style comp, delay, hall, +18 dB shelf at 2.2 kHz. Swirling, bright. |
| lead [air bender] | 1 | shinju, vol. 1 | Mono. Two init saws at 16 voices, detune 0.18/0.19: A with PD 42, B four octaves up at 70% (a whistle), fine +26; MG Low 12 4.6 kHz, drive 33; downsample (drive 12), hall 44% size 50, low cut 236 Hz. Wide, bright, airy. |
| MO_SHINJU_LD_Broken_World | 1 | @shinju_09 | Mono, 61 ms glide. A user wavetable with FM-from-noise warp (DUST 44), a bar LFO on position, ¼ vibrato; distortion drive 75 via macro; reverb macro at 0. |
| MO_SHINJU_LD_Victorin2nd | 1 | @shinju_09 | Mono. Grimace [SN] at 8 voices + a PD saw; Peak 12 at 1.3 kHz, res 66; detune swells in (548 ms envelope); formant FX filter 89%; dry at load. Nasal, vocal. |
| MO_SHINJU_LD_Walker | 1 | @shinju_09 | Mono, 90 ms glide. Debussy table at 23% with FM-from-noise, faded and moved by 32-bar LFOs; French LP at 8 Hz, drive 52, opened by CUTOFF (39) and an LFO; ¼ vibrato; mod wheel adds a gated saw an octave up; HyperD on UNISON, hall on ROOM (27). |
| MO_SHINJU_LD_Wex | 1 | @shinju_09 | Mono, 2 ms glide. One saw, Flip warp moved by an LFO; MG Low 12 766 Hz, drive 25; rectifier distortion and reverb on macros, both 0 at load. Plain and focused. |
| MO_TP_LD_FUO | 1 | thayerperiod | Mono legato, 81 ms glide. One Basic Shapes triangle→square (+1 oct) with PWM at full width (Serum shows 100; the knob is at 0); an 8.7 Hz LFO on Fine 38% (fast wide vibrato, WOBBLE on its rate) and a ¼ LFO flipping the octave; soft-clip drive 100; a little delay and hall that DRYNESS removes. Chiptune-ish. |
| [PS] lead [careful] | 1 | @shinju_09, vol. 3 | Mono. SSQ table, 4 voices, detune 0; HyperD 100%, chorus 100%, downsample 42%, ping-pong delay fb 63. Chorused and crunchy. |
| [PS] lead [luv] | 1 | @shinju_09, vol. 3 | Mono, 5 ms glide. A sine +1 oct through Band 12 at 118 Hz, drive 49; decaying envelope with no sustain; default-mode distortion 34, +14 dB peak at 1.2 kHz, hall 60%. Whistling, vocal. |
| [PS] lead [scythe] | 1 | @shinju_09, vol. 3 | Mono, 12 ms glide. Ring table + saw, both 16 voices at detune 0.01 with PWM warps swept by a 3.3 s envelope; saw sub; ping-pong delay fb 73. |

### Mono synth (5, Serum 1, inferred: shinju's and CFA's "synth" presets that play as mono leads)

| Preset | S | Author / bank | Sketch |
|---|---|---|---|
| synth [ari] | 1 | shinju, vol. 1 | Mono. Near-sine (Analog_BD_Sin) at 16 voices, detune 0.38, PD warp 40; distortion drive 43 wobbled by a bar LFO; hall size 76, long pre-delay. A detuned-sine supersaw. |
| synth [stadium] | 1 | @shinju_09, vol. 2 | Mono legato, 19 ms. One init saw, 16 voices, detune 0.02; ping-pong delay fb 78, wet 49. Thick, nearly in tune, otherwise raw. |
| synth [shard] | 1 | shinju, vol. 1 | Mono legato, 31 ms. One saw −1 oct, PD warp 39; 232 ms attack; delayed vibrato; static phaser, hall 38%. A soft swelling lead. |
| [PS] synth [sea] | 1 | @shinju_09, vol. 3 | Mono. Two saws (−2 and −1 oct), 16 voices each; MG Low 6 at 1.8 kHz, drive 31; 0.5 s swell, 3 s fade, no sustain; no effects. |
| SY Monotone [CFA] | 1 | CFA-Sound | "Driven Monosynth": mono, 18 ms glide. Pulse (Basic Shapes ≈5.1) + a sine ring-modulated by it, both quiet and brought up by velocity (≈88%); Low 18 at 6.7 kHz, Env 2 → cutoff 44%; Diode distortion 78; delay, plate-type reverb. |

### Poly synth & chord (9)

| Preset | S | Author / bank | Sketch |
|---|---|---|---|
| synth [wine] *(inf.)* | 1 | shinju, vol. 1 | Saw/triangle (Basic Shapes ≈2.6) at 16 voices, detune 0.25, PD 31; a saw 4 octaves up at 70% (a whistle); triangle sub +1 oct; Band 12 89 Hz, drive 49; chorus, downsample 64%, ping-pong, hall. Decays to −15 dB: half pluck. |
| synth [luvthis] *(inf.)* | 1 | @shinju_09, vol. 2 | Hypa table, 16 voices, its volume, table position and the distortion drive all driven by one ½-note custom LFO: pulsing, sidechain-like; delay wet 100 fb 79; hall 41%. |
| [PS] synth [brush] *(inf.)* | 1 | @shinju_09, vol. 3 | Two 16-voice stacks (Monster 9 −1 oct, Wraith with PD), drifting by ¼ LFOs on Fine; a percussive noise sample on macro PERC; chorus 76, hall 43 size 64. Wide, lush chord synth. |
| MO_TDA_SY_Monitor *(inf.)* | 1 | tda | Two saw/triangle stacks of 13 voices (+1 oct and 0), panned −18/+21, fine ∓9; mod-wheel vibrato; macros RAVE, MONO MODE. Rave chord stab. |
| SY Linear Arithmetic [FP] *(inf.)* | 1 | Francis Preve | "Know your history": an FFT_Add_4ths attack layer decaying over 0.76 s on a saw/triangle body; noise swelling over 5 s; MG Low 24 541 Hz, drive 31; plate-type reverb. D-50 style. |
| Chord - Marie Sideways | 1 | @iamsynthetic_, Crystal bank | User table "Marie" + Sideways 1 +1 oct + noise; −19 dB at 404 Hz; multiband comp; small mono hall; linked delay. Chord stab. |
| synth [loss] *(inf.)* | 1 | @shinju_09, vol. 2 | Allophones vowel table and a saw, both +2 oct at 16 voices (0.25), RoundRect sub +1 oct; a 1.1 Hz LFO morphs the vowel; downsample 20%, chorus on a macro, multiband comp, hall 70% (size 61). High, vocal shimmer, very wet. |
| synth [splinter] *(inf.)* | 1 | @shinju_09, vol. 2 | One Basic Shapes square +1 oct at 16 voices (0.04), gated by a 1/16 custom LFO; Cmb+ comb filter 821 Hz, res 67, drive 25; decays to −10 dB; downsample 39%, hall 29%. Metallic pulse. |
| Synth - Circuit Soul *(inf.)* | 2 | NEST Acoustics | Synced saw and square (3 voices) + spectral "Aztec Pipe"; MG Dirty 1.6 kHz; splitter, soft-sat, frequency shifter, vintage reverb. |

### Pluck (18)

| Preset | S | Author / bank | Sketch |
|---|---|---|---|
| pl - doom | 1 | tda ("im a boy from texas") | Near-sine, 10 voices, detune 0.15, hum noise 25%; 0.33 s decay, no sustain, 1.1 s release; no filter, no effects. |
| pl - opium | 1 | tda | Square (EVOSounds Square C3); MG Low 12 at 18 Hz opened 65% by the amp envelope; 8.6 ms pitch blip; hum noise 28%; no effects. |
| pl - wtf is going on | 1 | tda | SubBass_1 table, far position + "Noise Circuit" 25%; 11 ms attack, 1.3 s decay, 1.7 s release; no filter, no effects. |
| pl - good | 1 | tda | Sine with PD warp 37; MG Low 12 at 40 Hz opened 36% by Env 1 (71 ms attack); ping-pong delay wet 49. |
| pl - edm shit | 1 | blank (tda-style file) | Square with PWM warp 100 wobbled by a ¼ LFO; 0.35 s decay; 37 ms pitch blip; no effects. |
| pl - arizona | 1 | tda | Mellow But Instable (late position) with Quantize warp (DOWNSAMPLE macro); a 126 ms blip with no sustain whose decay a 2-bar LFO varies; filter open; ping-pong delay 40%, hall 20%. |
| PL - basic saws ok | 1 | blank | Init saw, 7 voices, detune 0.16; MG Low 12 at 34 Hz with Env 2 71%; 24 ms pitch blip; 0.7 s decay; no effects. |
| pluck [sprite] | 1 | @shinju_09, vol. 2 | Quiet saw + near-sine 85%, sine sub −1; Low 12 2.2 kHz, res 61, drive 41; decays to −11 dB; downsample, chorus 48, hall 38 (size 63), ping-pong fb 83, +7 dB shelf. |
| pluck [revolt] | 1 | @shinju_09, vol. 4 | BS2 - Acid table through a Combs filter at 943 Hz opened by the envelope; LFO on delay wet; multiband comp on TIMBRE (100). Metallic. |
| pluck-pp | 1 | blank | Reesey Mess 3 (5 voices, 0.17) + Jno +1 oct (7 voices); MG Low 18 5.6 kHz, res 44; 25 ms hold, 0.55 s decay; delay + plate. |
| [PS] pluck [velvet] | 1 | @shinju_09, vol. 3 | A sine −1 oct at 16 voices (0.04) + a 16-voice square→pulse (PD 46) at 29%, sine sub; decays to −22 dB over 1 s; no voice filter, an MG Low 12 FX filter at the end opened by Env 1; ping-pong delay fb 69 filtered at 289 Hz; no reverb. Soft and round. |
| Pluck - Rabbit Hole | 1 | naawoj.com, Delirious bank | Tigra + Subby Saw, square sub 100%, noise; German LP 61 Hz opened by Env 2; phaser fb 75, multiband comp, plate. |
| Pluck - Tilt | 1 | naawoj.com, Delirious bank | Reesey Mess 5 (6 voices, Bend ±) + Creeper [SN]; MG Low 24 3.9 kHz, res 77, drive 30; 3 s decay; a 25 ms flick on A Fine; +16.5 dB peak at 2 kHz; chorus, delay, hall 16%. |
| PL Sunny [7S] | 1 | 7 Skies | "Trancey": init saw (8 voices, 0.25) + a sine +1 oct, Air Can 1 noise 55%; MG Low 12 at 8 Hz opened 100% by a 0.34 s envelope over a sustained note; a 4 ms pitch click (71%); squashing multiband comp (BIG); ping-pong 40%, small plate. |
| PL Totem [7S] | 1 | 7 Skies | Triangle (Basic Shapes ≈3.2), noise Air Can 4, sine sub; 78 ms decay with an 8 ms pitch drop; ping-pong + small plate. "Play it in a chord". |
| PL Tinkerbell [DRK] | 1 | Derrek | Tigra +1 oct (6 voices, Asym warp) + E_Yeah vowel table; 0.1 s decay; +18 dB peak at 1.65 kHz; HyperD, delay, plate. Glassy. |
| circus *(inf.)* | 1 | blank | Jno at 10 voices (0.16) with Remap 2 switched fully in by Env 2 while held; 30 ms hold, decays to −37 dB, 3.4 s release; no filter, no effects. |
| PL - ChillerTranceSynth | 2 | @mrbillstunes | Sine-ish Default Shapes + EP multisample + texture sample; MG Ladder 140 Hz; envelope-mode LFOs, trance gate; delay/reverb on buses; OTT macro. |

### Keys & bell (8)

| Preset | S | Author / bank | Sketch |
|---|---|---|---|
| key [hydra] | 1 | shinju, vol. 1 | Near-sine +2 oct, 16 voices, detune 0.15; triangle sub; MG Low 12 2 kHz, Env 2 (0.29 s) → cutoff 44%; 0.34 s decay; downsample 37, HyperD, ping-pong, hall. Macro PLUCK->PAD. |
| key [nowhere] | 1 | @shinju_09, vol. 5 | Saw −1 oct at 16 voices, detune 0, FM from noise 54; MG Low 12 357 Hz, res 33, drive 24 (Frozen Air's filter); decays to −37 dB over 1.9 s; comp, −9.7 dB at 186 Hz; no reverb or delay. Dark, dusty. |
| MO_SHINJU_KY_Clockwork | 1 | @shinju_09 | An odd-harmonic 14-frame table +1 oct walked by a 4-bar LFO, crossfaded (TEXTURE/KEY 46) with Dist Sub Dskperc (PD 43); MG Low 12 1.3 kHz, drive 18; decays to −15 dB; HyperD 42, comp, ping-pong; hall on REVERB (10). |
| MO_SHINJU_KY_Frozen_Air | 1 | @shinju_09 | Saw, 10 voices, detune 0, FM from noise (DUST 57) and a 52 Hz LFO on the warp; MG Low 12 301 Hz, res 33, drive 24; 94 ms attack; −24 dB shelf at 4.2 kHz half-undone by HARSHNESS. Dusty, dark. |
| MO_SHINJU_KY_Jumper | 1 | @shinju_09 | Dist Bass Dropper with a ¼ LFO on its volume; a sine 2 oct up fluttering at 13.4 Hz (SPARKLE 46), auto-panned; MG Low 12 350 Hz. |
| SY Augustines Bell Chapel [JL] *(inf., by name)* | 1 | PlugInGuru.com | FFT_Animal + FFT_Add_4ths, synced and swept by Env 2; velocity to level; 0.58 s decay; air noise −12 st; chorus, plate, delay. |
| EP - Electric Piano | 2 | Van Derand | RDE88 multisample + bipole harmonic + shamisen; frequency shifter, flanger, downsample on macros. Classic 80s EP. |
| BL - Kinderjoy | 2 | Level 8 | High double bell: sine +1 oct, PD saw-square +2 oct, glass noise, envelope-mode LFOs; chorus, flanger; convolution on Bus 1. |

### Pad (29)

| Preset | S | Author / bank | Sketch |
|---|---|---|---|
| PAD - Burn Alive | 1 | Stickz, Smile Presets | A pitched sample ("Corroded Synth") on the noise osc at 65%, MS-20 triangle and Andromeda saw faded by a slow LFO; MG Low 24 350 Hz; 0.84 s attack; macros SATURATION, GRANULAR PAN, FADE AWAY. |
| PAD - Celestial | 1 | Stickz, Future Bass Toolkit | Init saw (7 voices, 0.25) + Basic_McB +1 oct + a pizzicato sample on the noise osc; MG Low 18 at 8 Hz opened by an envelope-mode LFO; soft-clip 40, hall, delay. |
| PAD - Pop Sines | 1 | Stickz, Smile Presets | SQ-80 sine and Subsequent 37 triangle panned ±50, key-tracked position, "Pure Tone" sample; MG Low 24 1 kHz; every effect on a macro (TAPE CRUNCH 45). Clean, wide. |
| PD - Secrets | 1 | @prodbarthow, Adapt bank | Two Basic Mini past their saw frame (6 and 5 voices, B −2 oct); MG Low 12 213 Hz; 0.63 s attack; ⅛ and 1/16 LFOs on Fine (41–44%: a synced warble) and ⅛ on cutoff; only comp and a low cut. |
| PD - Wanderlust | 1 | @iamsynthetic_, Adapt bank | Two saws (8 + 4 voices, blend 100, B +1 oct); Band 12 468 Hz; 0.53 s attack, 1.2 s release; HyperD, chorus, delay, hall 50%, comp. |
| PD D_Pad 2 [DU] | 1 | DiskoUnkle | Two init saws, 4 voices each (PD on B), saw sub; Low 12 187 Hz, drive 20; soft-clip 58%; wide plate-type reverb. |
| PD Defiant [BR] | 1 | B Roy Sound | "Use Mod Wheel": a 256-frame user table at 12 voices (Remap 100) + Inharmx 3 noise; Phs 36+ filter 1.2 kHz; 0.66 s attack; a smoothed 2-bar LFO walks position, warp, filter and HyperD; the wheel brings phaser and flanger; delay 43%. |
| PD Jp8k [7S] | 1 | 7 Skies | "Carefully A/B with my Jp": two saws, 7 voices, detune 0.21/0.26, wobbled by the noise osc; MG Low 12 368 Hz; 0.5 s attack; chorus fb 35, delay. |
| PD Lost Space Pad [JL] | 1 | PlugInGuru.com | FFT_Animal (synced), breath noise −9 st, sine sub; MG Low 18 75 Hz, res 48, swept by a 16 s envelope and the mod wheel (stored at 100); 0.86 s attack, 3 s release; plate size 88. |
| Pad - Cello Vocal | 1 | NEST Acoustics | A user table moved by the noise osc, AM'd saw; filter type Reverb (BLUR 100); allpass FX filter; distortion and space on macros. |
| Pad - Chaos Theory | 1 | blank | Saw, 5 voices, FM from noise; filter type Reverb 431 Hz; a 10 Hz LFO auto-pans A; reverb first in the chain, HyperD, chorus 100, sample-and-hold filter. |
| Pad - Polarized | 1 | naawoj.com, Delirious bank | Two user tables (B a fifth up, synced), cymbal-loop noise, sine sub; a 1/16 LFO gates both oscs, ¼ LFO pans them opposite ways; Band 24 580 Hz; B24 FX filter, delay 61, plate. |
| [PS] pad [sense] | 1 | @shinju_09, vol. 3 | Near-sine (5 voices, PD on a bar LFO) + 16-voice saw, both gated by a ⅛ custom LFO; HyperD 52, chorus 100, multiband comp, delay; no reverb. Pulsing. |
| pad [trance] | 1 | @shinju_09, vol. 4 | Saw + square/pulse, 16 voices each, detune 0 (+DETUNE macro); ARP white noise 52%; Phs 12+ filter; ¼ gate on the voice amp (SPEED); hall 28%; −24 dB shelf at 5 kHz. Dark trance gate. |
| MO_SHINJU_PD_Immense_Light | 1 | @shinju_09 | One saw + "ARP circuit" noise; ¼ vibrato; ⅛ gate on the voice amp; HyperD, distortion, reverb, chorus on macros (WIDTH 41, DIST 16, REVERB 21). |
| PD - Analogous | 2 | Beatdemon | Rounded saw (tape-sat warp), OSCAR, Saw Ripple, triangle sub; LP 12 915 + HP 12 355; ⅛ LFO gate on all oscs; bus HyperD, convolve, chorus. |
| PD - Arp Solina | 2 | Electric Himalaya | Solina viola/horn multisamples; phaser, HyperD, convolve on macros. 1970s string machine. |
| PD - Bamboo Forest Reflections | 2 | Electric Himalaya | Balafon multisample over unison saw layers (7 and 5 voices); hall 42%; phaser on a macro. |
| PD - Beach Butterfly | 2 | Genji Siraisi | Shepard octave+fifths table, very slow smoothed LFOs on position, warp and pan; convolution. |
| PD - Butterbrot | 2 | CFA-Sound | Three Basic Mini saws (2 voices each); MG Ladder 408 Hz; 1.8 s attack; chorus, delay, reverb on macros. Buttery saw pad. |
| PD - Classic Analog | 2 | Electric Himalaya | OSCAR + Dying Saw + PWM Juno (4/4/3 voices, −1 oct); MG Low 12 189 Hz + high-pass; delay 40%. |
| PD - Dark Shuffle Motion | 2 | Electric Himalaya | Classic Analog's template with LFO-moved band-pass filters; delay macro. |
| PD - Liminal Autumn | 2 | Gigantor | Sample layers (grains of sand, breathy pianoish, strings); Abyss reverb 65, delay 60. |
| PD - Midnight | 2 | Audiotent | Bass Pluck (FM) + RCM Bass a fifth up, noise; LP 240 + BP 854; pitch blips; delay, hall. |
| PD - Motion Tech | 2 | Electric Himalaya | Classic Analog's template, synced OSCAR, band-pass motion. |
| PD - Pacific Rain | 2 | Steve Duda | Subby Roller + granular DX brass + spectral drone; MG Ladder 493, res 71; arp chance; Abyss reverbs on buses. |
| PD - Piano and Unison | 2 | Electric Himalaya | Baby grand multisample + unison saw layers (Bamboo's template). |
| PD - Space Coin | 2 | 7 SKIES | Three looped samples (Digital Nature, Space Coins); Band 12 res 98 on an LFO; Abyss, HyperD, chorus on macros. |
| Pad - Head Fog | 2 | NEST Acoustics | Brass Stab table with tube warp, noise; all on Bus 1: phaser, convolve, dirty filter, frequency shifter, delay, vintage reverb. |

### Bass (11)

| Preset | S | Author / bank | Sketch |
|---|---|---|---|
| BassReese - Grrr | 1 | Singular Sounds | Mono. SawRounded (7 voices, 0.07) + Reesey Mess 1 (5 voices, fine +20), both −2 oct, sine sub −2; MG Low 24 821 Hz, drive 27. Classic reese, nearly dry. |
| BassReese - Hollow Knight | 1 | blank | Mono. Near-sine −2 oct, 3 voices, 0.19, PD 44; MG Low 12 561 Hz, drive 50; HyperD, formant FX filter 83, chorus, distortion 55, multiband comp. |
| BassReese - Porta Potty | 1 | NEST Acoustics | Mono, 311 ms glide. SQR_SAW_Wrd −1 oct (7 voices, FM from noise) + user Reese2 −2 oct (5 voices) walked by a 0.2 Hz LFO, RoundRect sub −2; 312 ms attack; HyperD 37, tape-sat drive 100, delay on SPACE (80), MG FX filter. |
| BassReese - Undercurrent | 1 | NEST Acoustics | Mono, 253 ms glide. Saw 16 voices (0.25) + near-sine, −2 oct; MG Low 24 425 Hz; HyperD, distortion, noise-driven phaser, wow on the delay, Scream filter. |
| BA - Sputnikv2 | 1 | Dynox | Mono legato, 90 ms glide. Basic Shapes' soft-square last frame −2 oct with PD 68, swept across the table by a 4-bar LFO; a 4088 layer and hum noise on LAYER / NOISE (0); no filter; HyperD 49, distortion (DIRTY), multiband comp, +4.6 dB at 393 Hz. |
| BassPluck - Tubular | 1 | blank | Mono. Sine −2 oct + sine sub; 1 s decay, no sustain; a short envelope jumps the octave and adds noise for the attack; HyperD 50, sine-fold distortion. |
| MO_SHINJU_BS_5th_King | 1 | @shinju_09 | Mono. Saw −1 oct + a saw a fifth up faded in by a dotted-bar LFO, sine sub (SUB 38); MG Low 12 411 Hz, drive 26; distortion 51; reverb macro at 0. |
| MO_SHINJU_BS_World_Bed | 1 | @shinju_09 | Mono. Saw −2 oct (2 voices); a fifth on macro 5TH; MG Low 12 425 Hz (FILTER 49); distortion 100 and chorus (REESE) on macros at 0. |
| [PS] bass [hyper] | 1 | @shinju_09, vol. 3 | Mono legato, 27 ms. Gritty (last frame) −2 oct + Monster 2 [SL] −1 oct moved by a ⅛ LFO, sine sub −2 at 100%; Diode distortion 67, multiband comp, FX filter. |
| Savage Sounds - Bass 18 Mod | 1 | Savage Sounds | Poly. DirtySaw 12 voices (PD 64) + Basic Mini saw 14 voices −1 oct, blend 100; multiband comp; a little HyperD and chorus. |
| BA - 303 Die Treppe | 2 | Endov Lane | Mono slide. Saw Drift 303 into Acid Ladder (res 66, drive 58); mod wheel opens filter and effects; 13-effect chain. |

### Sequence & arp (17)

| Preset | S | Author / bank | Sketch |
|---|---|---|---|
| SEQ - Calcus | 1 | @prodbarthow, Adapt bank | A sine +1 oct whose pitch a bar-long 9-point LFO steps (a melody), a quieter sine gated in quarters; MG Low 12 949 Hz, res 37; delay 25%, hall 32%. |
| SQ Automator 1 [GS] | 1 | Genji Siraisi | Mono legato. Every oscillator at 0%, played by four bar-long LFOs of 4–33 points on volumes, pitches, octave, position and noise colour: a self-playing sequence; sine-fold distortion 67%; a plate whose wet an LFO cuts. |
| SQ Bass Riser [FN] | 1 | Frank Neumann | Mono. Saw (Remap warp) AM-ing a sine a fifth up; a 10-step bar LFO plays the filter and the pitch; plate-type reverb. |
| SQ Busy Lines [LCV] | 1 | Le Castle Vania | Saw −1 oct + Acid table, RoundRect sub; ⅛ LFO on position; soft-clip drive 82; fast multiband comp. |
| SQ Diver [GS] | 1 | Genji Siraisi | Two PWM Genji (8 voices, 0.17/0.45, sync); a 33-point bar LFO gates both and the filter; a 6.5 s envelope blooms delay and reverb in. |
| SQ Fifth Ave 1 [JL] | 1 | PlugInGuru.com | Acid −2 oct + PWM Juno with Remap warps flipped by a ⅛ LFO, pulse sub; gate envelope; 6.6 s envelope on MG Low 18; mod wheel darkens. |
| SQ Future Steps [LCV] | 1 | Le Castle Vania | Mono, 55 ms glide. A three-frame table stepped by a ⅛ LFO that also gates it; notch 611 Hz; small plate. |
| SEQ - Pluxis | 2 | Beatdemon | Harmonic Subtle, Mellow But Instable, DM FMOD tables moved by 17-point LFOs; bus HyperD. |
| SEQ - Trance in the Pance | 2 | P-LASK | Saw Square, 7 voices, detune 0 (Superfier 72); a 17-point ¼ LFO gates the volume; brick-wall comp, reverb. Classic gated trance. |
| SEQ - Vocal Circuit | 2 | Tunecraft | Saws + OOH_YAH_OO vocal table, formant filter, ten LFOs, 15 effects including downsample. |
| ARP - Bell Arperium | 2 | Electric Himalaya | Ring-mod + FM bells (Default Shapes ×3) on the arp; hall, two delays. |
| ARP - Etheric Aluminium | 2 | Electric Himalaya | PWM Genji (tube) + FM/sync partial tables; flanger filter 648 Hz, res 64; 50 mod routings. |
| ARP - Fun ElectroAcoustic Jam | 2 | Steve Duda | Oud, 12-string and acoustic multisamples on clips and arp; buses with frequency shifters and phaser. |
| ARP - Mallet Magium | 2 | Electric Himalaya | Kalimba + xylophone multisamples; arp macros, delay, reverb. |
| ARP - Proudly Digital | 2 | Electric Himalaya | Saw + Dying Saw + SAM_Speaks vocal table; LFO to the low-pass; formant filter on a macro; delay 58%. |
| ARP - Rainfall | 2 | SynthHacker | One Jno table + noise; LP 65 / HP 2.2 kHz; random pan per note; reverb macro. |
| ARP - Strum Multi | 2 | Steve Duda | Oud, swarsangam and guitar multisamples strummed by clips; convolution on Bus 2. |

### Vocal (4)

| Preset | S | Author / bank | Sketch |
|---|---|---|---|
| VOX - Leave Behind | 1 | Stickz, Smile Presets | Poly. A vocal sample ("SQ80 Vox Low") on the noise osc at 100%, +24 st; High 18 at 245 Hz; an 82 Hz LFO on the noise pan (CHAOS WIDTH); a 33-point ½ LFO gates the flanger's level (…GATE); Andromeda pad on WARM PAD; waveshaper 29%, delay, hall. |
| VOX - My Life | 1 | Stickz, Russian Roulette | Mono legato, 464 ms glide. A vocal sample ("Alter Vox 0") on the noise osc at 58%, pitch-tracked +12; synth layers on ADD SYNTH; asym waveshaper 80%; space on WET MIX. |
| VOX - No Happiness | 1 | Stickz | Mono legato, 69 ms. A vocal sample ("Alter Vox 27") at 100%; formant filter on a macro; waveshaper 29, chorus 43, hall 36. |
| VOX - Voices in a hurry | 2 | Electric Himalaya | Granular voices (Oo, breathy Ohaum, Eh) gated by ⅛ LFOs; L/N/H filter; HyperD, hall. |

### Instrument imitation (4)

| Preset | S | Author / bank | Sketch |
|---|---|---|---|
| GUITAR - Sad Stories | 1 | Stickz, Smile Presets | A nylon-guitar sample ("Tape Nylon") on the noise osc, start point by note; velocity opens MG Low 12; 8 s decay; asym waveshaper 16; effects on macros (MOD FX 34, WET MIX 27). |
| banjo lol | 1 | tda | Oddpass [SN] table; filter type Reverb at 61 Hz, res 45 (68% wet); the envelope moves table and FX filter; +8 dB at 1.5 kHz; hall 18%. Twangy. |
| BR - Hybrid Brass | 2 | Electric Himalaya | French horn + trombone multisamples + saw (3 voices); MG Ladder 98 Hz opened by an envelope; convolution. |
| BR - Warm Hybrid Brass | 2 | Electric Himalaya | DX Brass 2 table (diode warp) + saw + horn multisample; MG Low 12 60 Hz; HyperD, reverb on macros. |

**Counts**: Pad 29 (15 S1 / 14 S2), Pluck 18 (17 / 1), Sequence & arp 17 (7 / 10), Lead 13 (13 / 0), Bass 11 (10 / 1),
Poly synth & chord 9 (8 / 1), Keys & bell 8 (6 / 2), Mono synth 5 (5 / 0), Vocal 4 (3 / 1), Instrument imitation 4
(2 / 2). The Serum 1 set leans to leads, plucks, mono synths and basses; the Serum 2 set to pads and arps.

---

## 3. Profiles

Numbers are over all the presets of the category. Control names and values are as Serum displays them
(oscillator `Level`, `Unison`, `Uni Detune`, `WT Pos`, `Warp Mode`; `Filter 1 Type/Freq/Res/Drive/Var`; envelope times;
`source → destination amount`). Effect values are the stored ones.

### 3.1 Lead (13, all Serum 1)

**Shared.** Mono: 12 of 13, with glide on 9 (median 40 ms, 2–117 ms; legato on 4). Few sources: 6 have one tonal
oscillator, 7 have two. The sources are plain: saws (the init saw, Basic Shapes' saw→triangle range), a sine, a
square or triangle→square; one Grimace, one Ring and one Debussy table. Near-instant attack (≤8 ms in 10), full
sustain (0 dB in 12), and a short release (≤20 ms in 9). Every lead has effects. EQ in 11, almost always a **low cut**
(`Type1=2` in 9) at 170–655 Hz (median 283 Hz): leads are thinned at the bottom. Distortion in 10 (drive median 55).
Filters are on in only 7, but all of those drive the filter (drive 25–52).

**Varies.** Unison is 1 voice (10 of 20 sounding oscillators), or many voices at almost no detune (16 on
`lead [club]` at 0 and `[PS] lead [scythe]` at 0.01, 8 on `Victorin2nd` at 0, 4 on `[PS] lead [careful]` at 0), or,
once, 16 wide voices (`lead [air bender]`, 0.18). Reverb from none (3ds, hendrix, scythe) to hall wet 60
(`[PS] lead [luv]`); three of the four `MO_SHINJU` leads ship with the reverb at `Wet=0` on a ROOM/REVERB macro, and
`MO_TP_LD_FUO` has a DRYNESS macro that takes its small delay and hall away.

**Sub-families.**

*L1 — shinju's dry mono lead, character on macros* (`MO_SHINJU_LD_Wex`, `MO_SHINJU_LD_Victorin2nd`,
`MO_SHINJU_LD_Broken_World`, `MO_SHINJU_LD_Walker`):
- `Mono Toggle=On`, `Porta Time` 0–90 ms. One main oscillator (`A`: the saw, or a user/Grimace/Debussy table),
  `Unison=1` or `8` at `Uni Detune=0.00`.
- A warp that moves: `A Warp Mode=Flip` with `LFO 9 (1/4) → Osc A Warp 34%` (Wex), or `FM (Noise)` set by a DUST
  macro (`Macro 1 → Osc A Warp 100%`, DUST≈44–57).
- `Filter 1 Type=MG Low 12, Freq≈766, Res=17, Drive=25` (Wex) or `Peak 12, Freq≈1334, Res=66, Drive=29` (Victorin).
- `Env 1: Attack=0.5 ms, Sustain=0 dB, Release 15–170 ms`.
- Effects: `HyperD (Detune=0, Unison=4)` with `Mod Wheel → HyperD Detune 100%`; `Distortion` (Wex: `Mode=Rectify,
  Drive=81, Wet=0` + `DIST AMT` macro → Wet 100%); `Comp (Attack=0.1, Makeup≈11)`; `EQ` low cut ~380 Hz;
  `Reverb Hall, Size≈25, Width=20, Wet=0` + `ROOM` macro → Wet 100%.
- Macros: FILTER/CUTOFF, DIST AMT, ROOM/REVERB, MOD RATE/RATE, FM AMT or UNISON. The preset loads dry and close.
- Walker adds slow motion: `A: Debussy, Level=23%, FM (Noise) 24`; `LFO 1 (32 bar) → Osc A Volume 55%, Filter 1 Freq
  25%`, `LFO 9 (32 bar) → Osc A TablePos 36%`, `LFO 2 (1/4) → Osc A Fine 15%`; `Filter 1 Type=French LP, Freq=8,
  Drive=52, Var=45, Wet=91` opened by `CUTOFF (39) → Filter 1 Freq 100%`; `LFO 4 (1/4) × Mod Wheel → Osc B Volume
  100%` brings a gated saw an octave up; `UNISON → HyperD Detune 100%`, `ROOM (27) → Reverb Wet 100%`.

*L2 — 16-voice lead* (tight: `lead [club]`, `[PS] lead [scythe]`, `[PS] lead [careful]` at 4 voices; wide:
`lead [air bender]`):
- Mono legato, `Porta Time` 12–40 ms, `Porta Always=On`.
- `A: Basic Shapes, WT Pos=2` (TablePos 74: saw→triangle), `Unison=16, Uni Detune=0.00`, and
  `LFO 1 (1/2, triangle) → Osc A Detune 33%`, so the detune breathes from nothing to a little twice a bar.
  Scythe instead: `Ring` + saw, `Unison=16, Uni Detune=0.01`, `Warp Mode=PWM` (66 / 82) swept by
  `Env 2 (Decay 3.32 s) → Osc A Warp 47%, Osc B Warp 24%`.
- No voice filter.
- Club's chain: `Flanger (Rate 0.46, Wet 92) > Phaser (Feedback 80, Wet 61) > Distortion (Sin Fold, Drive 41, Wet 34)
  > Comp (multiband) > Delay (Feedback 40, Wet 30) > Reverb Hall (Size 35, Wet 26, Width 20) > EQ (low cut 485 Hz,
  +18 dB shelf at 2.2 kHz) > Filter (N12)`. `Main Vol=40%` to make room for 16 voices.
- Careful: `SSQ, WT Pos=217, Unison=4, Uni Detune=0`; `Delay fb 63 > Chorus Wet 100 > Distortion Downsample (Drive
  25, Wet 42) > EQ low cut 547 > HyperD Wet 100 > Comp`.
- Air bender (the wide one): `A: init saw, Unison=16, Uni Detune=0.18, Warp Mode=PD (B) 42`; `B: init saw,
  Level=70%, Octave=+4, Fine=26, Unison=16, Detune=0.19` (a whistle four octaves up, as in `synth [wine]`);
  `Filter 1 Type=MG Low 12, Freq=4640, Drive=33`; `Env 1: Attack 0.5 ms, Sustain 0 dB, Release 15 ms`; no modulation
  at all; `Chorus (off) > Distortion Downsample (Drive 12) > Reverb Hall (Size 50, pre-delay 45, Wet 44, Width 20) >
  EQ low cut 236`.

*L3 — soft, hollow poly or sine lead* (`ld - literally whitearmor`, `[PS] lead [luv]`):
- Whitearmor (poly): `A: Basic Shapes, WT Pos=2 (TablePos 68 ≈ frame 2.6, saw→triangle), Level=45%, Unison=3, Uni
  Detune=0.06`; `B: HarmonicSeries, WT Pos=3 (≈ frame 3.8: a pure 3rd–4th harmonic), Level=24%, Pan=-50 L`.
  `Filter 1 Type=MG Low 24, Freq=2209, Res=12, Drive=40, Var=67`. `Env 1: Attack=42 ms, Decay=1.00 s, Sustain=0 dB,
  Release=640 ms`. `LFO 1 (1/2) → Osc A Fine 24%`, `LFO 2 (bar) → Osc B Pan 100%`, `Mod Wheel → Filter 1 Freq 19%,
  Osc B Volume 44%`. `Chorus (Feedback 9.5, Wet 28) > Reverb (plate-type: PreDelay 3.6 ms, Size 61, Wet 33, Width
  100)`.
- Luv (mono, `Porta 5 ms`): `A: Basic Shapes, WT Pos=1` (sine), `Octave=+1`; `Filter 1 Type=Band 12, Freq=118, Res=39,
  Drive=49, Var=71`; `Env 1: Attack=56 ms, Decay=546 ms, Sustain=-∞, Release=470 ms`; `Env 2 (Decay 658 ms) → Filter
  1 Freq 32%`; `Distortion (default mode, Drive 62, Wet 34) > EQ (low cut 655 Hz, +14 dB peak at 1.23 kHz) > Reverb Hall
  (Size 53, Wet 60, Width 20)`. The same filter/env/reverb numbers are in `synth [wine]`: shinju's template.

*L4 — gritty legato lead* (tda's `ld - 3ds`, `ld - hendrix`; thayerperiod's `MO_TP_LD_FUO`):
- `Mono Toggle=On, Legato=On`, `Porta Time` 10 ms (3ds), 81 ms (FUO) or 117 ms (hendrix).
- tda: two oscillators at full level, plus `Noise: Organics/AC hum1` at 32–46% (a mains hum under the note).
- 3ds: `A: Basic Shapes, WT Pos=4` (square→pulse), `Unison=2, Uni Detune=0.04, Uni Blend=60`; `B: saw, Unison=2,
  Detune=0.13`; `LFO 1 (53.5 Hz) → Osc A Fine 100%` (audio-rate wobble = rough sidebands); `Distortion Drive=100`.
- Hendrix: two saws (`A Octave=-1`); `Filter 1 Type=Band 24, Freq=73, Res=28, Drive=26, Var=100`, `LFO 1 (4 bar) →
  Filter 1 Freq 43%`; `Distortion Mode=Zero-Square, Drive=100 > Flanger Wet 69 > EQ low cut 283 Hz`.
- FUO: one oscillator, `A: Basic Shapes, WT Pos=3 (TablePos 96 ≈ frame 3.3, triangle→square), Octave=+1, Warp
  Mode=PWM, Warp=100` as Serum shows it: the knob is at 0, a full-width pulse (PWM's display runs backwards; a knob at 100 squeezes the wave to almost nothing), `Porta Always=On`; `LFO 2 (8.7 Hz, triangle) → Osc A Fine 38%` (fast, wide vibrato; WOBBLE on
  its rate) and `LFO 1 (1/4, 6 points) → Osc A Octave 9%` (octave flips); `Mod Wheel → Osc A Warp 45%`; no filter;
  `HyperD (GRIT) > Distortion Soft Clip Drive=100 > EQ +5.9 dB at 2 kHz > Delay (Wet 24) > Reverb Hall (Wet 8.6)`,
  DRYNESS → delay and reverb wet −100%. Chiptune-like, close to 3ds.

**Outliers.** `whitearmor` is the only poly lead and the only one with a slow attack and a plate-like wide reverb:
it is soft where the others are dry and close. `lead [club]` is the only lead with a long modulation-effect chain.
`lead [air bender]` is the only wide-detuned lead and has no modulation at all: its movement is the 16-voice beating.

### 3.2 Mono synth (5, Serum 1)

**Shared.** All mono (glide 18–31 ms on 3, legato on 2). One or two oscillators, at **16 voices** in 3 of 5 (the
shinju ones). Detune spans 0.02 (stadium) to 0.38 (ari). Few voice filters (2 of 5). Effects few: reverb in 3, delay
in 2, none in `[PS] synth [sea]`.

*M1 — mono 16-voice wall* (`synth [stadium]`, `synth [ari]`):
- Stadium: `A: init saw, Unison=16, Uni Detune=0.02`, `Mono Toggle=On, Legato=On, Porta Time=19 ms`; only
  `Delay (Feedback 78, Wet 49, Freq 580, ping-pong)`.
- Ari: `A: Analog_BD_Sin, WT Pos=93 (near-sine), Unison=16, Uni Detune=0.38, Warp Mode=PD (B), Warp=40`; `Env 1
  Attack=11 ms, Release=382 ms`; `LFO 1 (bar) → Distortion Drive 20%`; `Distortion (default mode, Drive 43) > Reverb Hall
  (Size 76, Wet 29, pre-delay 109, Width 20) > EQ low shelf −4.4 dB at 216 Hz`. Detuned sines rather than saws:
  wide but soft-edged.

*M2 — mono swell* (`synth [shard]`, `[PS] synth [sea]`):
- Shard: `A: saw, Octave=-1, Warp Mode=PD (B), Warp=39`; `Env 1: Attack=232 ms, Decay=933 ms, Sustain=0 dB,
  Release=1.14 s`; `LFO 1 (1/4, Delay 1/64) → Osc A Fine 24%` (vibrato that arrives late); `Chorus (Wet 0, CHORUS
  macro) > Phaser (Feedback 80, Freq 135, Rate 0: a static comb) > Reverb Hall (Size 50, Wet 38) > EQ low cut 283`.
- Sea: `A: saw, Octave=-2, Unison=16, Detune=0.08` + `B: saw, Octave=-1, Unison=16, Detune=0.25`; `Filter 1 Type=MG
  Low 6, Freq=1822, Drive=31, Wet=87`; `Env 1: Attack=519 ms, Decay=3.05 s, Sustain=-∞`; no effects.

*M3 — driven factory monosynth* (`SY Monotone [CFA]`): `Mono, Porta Time=18 ms, Porta Always`; `A: Basic Shapes,
TablePos 177 (≈ frame 5: pulse), Level=6%`, `B: Basic Shapes sine, Level=11%, Warp Mode=RM (A) 11`, with `Velo → Osc
A Volume 88%, Osc B Volume 89%` (played by velocity); `Filter 1 Type=Low 18, Freq≈6.7 kHz, Res=29`, `Env 2 (Decay
469 ms, Sustain 38%) → Filter 1 Freq 44%`; `HyperD (off) > Distortion Diode 1 (Drive 78) > Delay ping-pong (Wet 22) >
Comp > Reverb (plate-type, Size 54, Wet 36) > EQ (−6.5 dB at 210 Hz, +5.9 dB at 3 kHz) > Filter H12` on an HP macro.
Brighter and more classic than the shinju mono synths; the one outlier here.

### 3.3 Poly synth & chord (9: 8 S1, 1 S2)

**Shared.** Poly, 2 tonal oscillators in 6 of 9, often big unison (16 voices in 5, 13 voices in 1). Instant attack.
Sustain below full (−3 to −15 dB in 6): chords that settle. Reverb in all 9 (hall size 23–68, wet ~36), chorus in 6,
delay in 5. **Downsample distortion in the three shinju vol. 1–2 presets** (wine, loss, splinter, wet 20–64).
Vibrato/drift LFOs on Fine in 3.

*P1 — shinju's big poly stack with a high partial* (`synth [wine]`, `[PS] synth [brush]`, `synth [loss]`):
- Wine: `A: Basic Shapes WT Pos=2 (saw→triangle), Unison=16, Uni Detune=0.25, Warp Mode=PD (B) 31`; `B: saw,
  Level=70%, Octave=+4, Fine=3` (a whistle four octaves up); `Sub: Triangle, Octave=+1`. `Filter 1 Type=Band 12,
  Freq=89, Res=20, Drive=49, Var=71`, `Env 2 (Decay 658 ms) → Filter 1 Freq 32%`; `Env 1: Decay=546 ms,
  Sustain=-14.8 dB, Release=1.14 s`. `Chorus (Filt 1.5 kHz, Wet 53) > Delay ping-pong (Feedback 27, Wet 30) >
  Distortion Downsample (Drive 25, Wet 64) > EQ (cut at 938 Hz, +4.8 dB at 3.3 kHz; Note# → EQ Freq2 13%) > Reverb
  Hall (Size 53, Wet 30) > Filter (Drive 35, Wet 72)`.
- Brush: `A: Monster 9 [SL], Octave=-1, Unison=16, Detune=0.17, Pan=-9`; `B: Wraith, Unison=16, Detune=0.17, PD (A)
  50, Pan=5, Fine=9`; `LFO 1 (1/4) → Osc A Fine 24%, Osc B Fine 29%`; `LFO 9 (0.1 Hz) → Osc B TablePos 35%`; noise
  `TransPerc2` on `PERC` macro; `Env 1: Decay=1.4 s, Sustain=-8.5 dB, Release=1.93 s`; `Chorus (Filt 1.27 kHz, Wet 76) >
  Reverb Hall (Size 64, Wet 43, FreqB 91) > EQ (low cut 108, −5 dB at 8.6 kHz)`.
- Loss: everything high: `A: Allophones (vowel table), TablePos 115, Octave=+2, Unison=16, Detune=0.25`; `B: saw,
  Octave=+2, Level=55%, Unison=16, Detune=0.25`; `Sub: RoundRect, Octave=+1, 68%`; `LFO 1 (1.1 Hz) → Osc A TablePos 55%`
  (a slow vowel morph); `Env 1: Sustain 0 dB, Release 132 ms`; `Distortion Downsample (Drive 17, Wet 20) > Chorus (Wet
  0, CHORUS macro) > Comp multiband > Reverb Hall (Size 61, pre-delay 71, Wet 70) > EQ low cut 471`. The wettest
  shinju preset.

*P2 — rhythmic pulsing synth* (`synth [luvthis]`, `synth [splinter]`): `A: Hypa, Level=0%, Unison=16, Detune=0.09`; one
`LFO 1 (1/2, custom 6 points)` → `Osc A Volume 100%`, `Osc A TablePos 100%`, `Distortion Drive 82%`, `Comp Makeup 25%`.
`Delay (Feedback 79, Wet 100, Freq 5 kHz) > Comp (multiband) > Reverb Hall (Size 45, Wet 41) > EQ > Distortion
(StompBox, Wet 49)`. `Main Vol=40%`.
- Splinter: `B: Basic Shapes, TablePos 131 (≈ frame 4: square), Octave=+1, Level=5%, Unison=16, Detune=0.04`, gated by
  `LFO 1 (1/16, 5 points, Smooth 9) → Osc B Volume 69%`; `Filter 1 Type=Cmb +, Freq=821, Res=67, Drive=25, Wet=68`;
  `Env 1: Decay 1.15 s, Sustain −10 dB, Release 1.29 s`; `Distortion Downsample (Drive 31, Wet 39) > Reverb Hall (Size
  35, Wet 29) > EQ low cut 547`.

*P3 — rave / chord stab* (`MO_TDA_SY_Monitor`, `Chord - Marie Sideways`):
- Monitor: `A: Basic Shapes WT Pos=2, Octave=+1, Unison=13, Detune=0.14, Uni Width=73, Pan=-18, Fine=-9`;
  `B: same, Octave=0, Unison=13, Detune=0.09, Uni Width=54, Pan=21, Fine=9`; `Noise 19%`; `Env 1: Decay=2 s,
  Sustain=-10.8 dB`; `LFO 1 (0.9 Hz) × Mod Wheel → Osc A/B Fine 100%`; macros RAVE (detune +15/+31%) and MONO MODE
  (`Uni Width −100%`). `Distortion (Drive 12, Wet 36) > Chorus (Wet 49) > Reverb (REVERB macro) > EQ low cut 119`.
- Marie Sideways: user table + Sideways 1, a gate envelope, `EQ −19 dB peak at 404 Hz`, multiband `Comp`, a small
  mono hall (`Width 0`) and a linked delay.

*P4 — layered D-50 tribute* (`SY Linear Arithmetic [FP]`): an attack layer (`A: FFT_Add_4ths`, `Env 3 (Decay 762 ms)
→ Osc A Volume 41%`) over `B: Basic Shapes saw→triangle, Unison=2, Detune=0.02`, `Sub Sine −1`; noise `Inharmx 9`
rising by `Env 2 (Attack 4.94 s)`; `Filter 1 MG Low 24, 541 Hz, Drive 31`; plate-type reverb.

**Outlier.** The Serum 2 `Synth - Circuit Soul` is the opposite of P1: three voices, spectral oscillator, splitter
chain, nine effects.

### 3.4 Pluck (18: 17 S1, 1 S2)

**Shared.** All poly. **No sustain** in 11 (`Sustain=-∞`; four more decay to −11…−44 dB); decay 0.08–3 s on the Serum 1
plucks (median 0.8), release ≥0.5 s on 12: the note dies on its own and leaves a tail. Instant attack. Mostly one
tonal oscillator (10) at **one voice** (15 of 25 sounding oscillators). Filters (11) start low and open with an
envelope (`MG Low 12` at 8–40 Hz on four). Five plucks put a **pitch blip** on the attack: a 4–37 ms envelope on
`Global MasterTuning` (12–71%); `Pluck - Tilt` does it on Fine. Six have no effects at all.

*PL1 — tda's raw pluck* (`pl - opium`, `pl - doom`, `PL - basic saws ok`, `pl - edm shit`, `pl - wtf is going on`,
`pl - good`, `pl - arizona`, and the authorless `circus`):
- One oscillator: a square (`EVOSounds Square C3`; `Basic Shapes WT Pos=4` + `Warp Mode=PWM`, shown as 100: the knob at 0, full width), a near-sine
  (`Analog_BD_Sin`, `Unison=10, Detune=0.15`), an init saw (`Unison=7, Detune=0.16`) or `SubBass_1`.
- `Noise: AC hum1` at 25–28% (doom, opium) or "Noise Circuit" 25%.
- `Filter 1 Type=MG Low 12, Freq=18–40, Res≈10, Drive 0–21` with `Env 1 → Filter 1 Freq 36–65%` (opium, good) or
  `Env 2 → 71%` (basic saws).
- `Env 1: Attack=0.5 ms (71 ms on good), Decay=0.33–1.29 s, Sustain=-∞, Release=0.06–2.25 s`.
- Pitch blip: `Env 2: Attack=0, Decay=8.6–37 ms, Sustain=--` → `Global MasterTuning 28–38%`.
- No effects (`pl - good` adds `Delay ping-pong, Feedback 40, Wet 49, Freq 747, BW 0.75` and a comp; `pl - arizona`
  a ping-pong at 40% and a hall at 20%). These are dry sounds made to be processed in the mix.
- Arizona moves its envelope: `A: Mellow But Instable, TablePos 189, Warp Mode=Quantize 25` (DOWNSAMPLE macro → +54%);
  `Env 1: Decay=126 ms, Sustain=-∞, Release=15 ms` (a tick) with `LFO 1 (2 bar, 5 points) → Env 1 Decay 24%, Osc A
  Volume −14%`, so the length changes through the bar.
- Circus: `A: Jno, Unison=10, Detune=0.16, Warp Mode=Remap 2` with `Env 2 (Sustain 100%, Release 39 ms) → Osc A Warp
  100%`; `Env 1: Hold 30 ms, Decay 368 ms, Sustain −37 dB, Release 3.39 s`; nothing else.

*PL2 — shinju's effected pluck* (`pluck [sprite]`, `pluck [revolt]`, `[PS] pluck [velvet]`):
- Sprite: `A: init saw, Level=26%, Detune=0.01`; `B: Analog_BD_Sin, Level=85%`; `Sub: Sine, Octave=-1`.
  `Filter 1 Type=Low 12, Freq=2167, Res=61, Drive=41`. `Env 1: Decay=764 ms, Sustain=-11.4 dB, Release=696 ms`;
  `Env 2 (Decay 445 ms) → Distortion Freq −11%, FX Filter Freq 11%`.
  `Distortion Downsample (Drive 16, LPHP 44) > Chorus (Depth 1.35, Wet 48) > Reverb Hall (Size 63, pre-delay 117,
  FreqB 75, Wet 38) > Delay ping-pong (Feedback 83, Freq 2.3 kHz, Wet 30) > EQ (low cut 229, +7.4 dB shelf at 2 kHz) >
  Filter P12 (Reso 33)`. `Main Vol=70%`.
- Revolt: `B: BS2 - Acid, WT Pos=29`; `Filter 1 Type=Combs, Freq=943, Drive=19, Var=39`, `Env 1 → Freq 39%`; `Env 1:
  Decay 949 ms, Sustain −4.5 dB`; `LFO 1 (1/2) → Delay Wet 70%`; `Delay ping-pong fb 57 > Chorus > Comp multiband
  (TIMBRE) > EQ (low cut 176, −9 dB peak at 3.1 kHz)`.
- Velvet: a soft 16-voice pluck. `A: Basic Shapes sine (WT Pos=1), Octave=-1, Unison=16, Detune=0.04`; `B: Basic
  Shapes TablePos 143 (≈ frame 4.4, square→pulse), Octave=-1, Level=29%, Unison=16, Detune=0.25, Warp Mode=PD (A) 46`;
  `Sub: Sine, 14%`. No voice filter: `Env 1 (Attack 7 ms, Decay 969 ms, Sustain −22 dB, Release 1.14 s) → FX Filter
  Freq 29%` on an `MG Low 12` FX filter late in the chain. `Distortion Sine Shaper (Drive 26, Wet 0, DIST macro) >
  Chorus > EQ (off) > Filter (MgL12) > Delay ping-pong (Feedback 69, Freq 289 Hz, Wet 30)`: very dark repeats, no
  reverb.

*PL3 — bank and library plucks* (`PL Totem [7S]`, `PL Sunny [7S]`, `PL Tinkerbell [DRK]`, `Pluck - Rabbit Hole`,
`Pluck - Tilt`, `pluck-pp`): shorter (Totem `Decay=78 ms`, Tinkerbell `100 ms`) or filter-plucked over a held note
(Sunny), brighter tables (Tigra, vowel E_Yeah, Reesey Mess, Creeper), and mostly plate-type reverbs at `Width=100`. Totem: `A: Basic Shapes WT Pos=3 (triangle), Phase=146°, Rand Phase=0`, `Noise: Air Can 4 19%`,
`Sub Sine 33%`, `Env 3 (Decay 8.2 ms) → MasterTuning 24%`, `Delay (Feedback 22, Wet 37) > Reverb (Size 28, Wet 12) >
EQ +4.4 dB at 1.74 kHz`. Sunny ("Trancey"): `A: init saw, Unison=8, Detune=0.25, Blend 67` + `B: sine, Octave=+1,
50%`, `Noise: Air Can 1 55%` pitch-tracked; `MG Low 12 at 8 Hz` with `Env 2 (Decay 336 ms) → Filter 1 Freq 100%` over
`Env 1 Sustain 0 dB, Release 1.4 s`; `Env 3 (Decay 4.4 ms) → MasterTuning 71%` (a hard click); `Comp multiband (Ratio
max, Makeup 31; BIG lowers the threshold) > Delay ping-pong (Feedback 44, Freq 4 kHz, Wet 40) > plate (Size 21, Wet 33)`.
Tilt: `Reesey Mess 5 (6 voices) + Creeper [SN]`, both `Bend +/- −100`; `MG Low 24, 3.85 kHz, Res 77, Drive 30`;
`Decay 2.96 s, Sustain −∞`; `Env 2 (25 ms) → Osc A Fine 100%`; `EQ +16.5 dB at 2 kHz`; `Main Vol=30%`.

**Outlier.** `PL - ChillerTranceSynth` (S2) layers a sine, an EP multisample and a texture sample, gated by LFOs in
envelope mode and sent to buses: a whole production idea in one preset, against tda's one-oscillator plucks.

### 3.5 Keys & bell (8: 6 S1, 2 S2)

**Shared.** Poly, decaying: sustain −∞ in 3, −4.5 to −37 dB in 5; decay 0.34–1.9 s on the shinju keys; release
0.5–1.2 s in 7. Every one has a filter (`MG Low 12` in 7), driven in 7. EQ in all 8, reverb in 7. Downsample
distortion in 3 (two behind macros).

*K1 — shinju keys* (`key [hydra]`, `key [nowhere]`, `MO_SHINJU_KY_Frozen_Air`, `MO_SHINJU_KY_Jumper`,
`MO_SHINJU_KY_Clockwork`):
- Hydra: `A: Analog_BD_Sin, Octave=+2, Unison=16, Uni Detune=0.15, Warp Mode=PD (B)`; `B` the same table far in
  (`WT Pos=219`) with `FM (Noise) 43`, `Level=0%` on macro MORE; `Sub: Triangle 75%`. `Filter 1 MG Low 12, 2022 Hz,
  Res 12, Drive 20`, `Env 2 (Decay 290 ms) → Filter 1 Freq 44%`; `Env 1: Decay=342 ms, Sustain=-∞, Release=800 ms`.
  Macro PLUCK->PAD → `Env 1 Attack +43%, Sustain +100%, Decay +60%`. `Distortion Downsample (Drive 21, Wet 37) >
  HyperD (Dim size 65, Dim wet 66) > Delay ping-pong (Feedback 40, Wet 30) > Reverb Hall (Size 61, pre-delay 59,
  Wet 35) > EQ low cut 581`.
- Frozen Air: `A: saw, Unison=10, Detune=0, Warp Mode=FM (Noise)` with DUST 57 and `LFO 9 (52 Hz) → Warp 15%`; noise
  osc enabled at `Level=0%` as the FM source; `MG Low 12, 301 Hz, Res 33, Drive 24, Var 39`; `Attack=94 ms,
  Decay=880 ms, Sustain=-12 dB`; `EQ −24 dB shelf at 4.2 kHz` with HARSHNESS (50) on it; reverb on ROOM (0).
- Jumper: `LFO 1 (1/4) → Osc A Volume 63%` on `Dist Bass Dropper`; `B: Basic Shapes sine, Octave=+2, Fine=-11` made
  to flutter by `LFO 9 (13.4 Hz) × SPARKLE → Osc B Volume 100%` and auto-panned by `LFO 10 (1 Hz) 91%`.
- Nowhere: Frozen Air's recipe, darker and drier. `A: saw, Octave=-1, Unison=16, Detune=0, Warp Mode=FM (Noise) 54`
  (noise osc at 0% as the FM source); `MG Low 12, 357 Hz, Res 33, Drive 24, Var 39` (Frozen Air: 301/33/24/39, a
  shinju template); `Env 1: Decay 1.91 s, Sustain −37 dB, Release 632 ms`; `Comp (Attack 0.1, Ratio 3.6) > EQ (low cut
  126, −9.7 dB at 186 Hz) > Filter (FILTER)`; no reverb, no delay.
- Clockwork: `A: an odd-harmonic 14-frame user table, Octave=+1`, `LFO 1 (4 bar) → Osc A TablePos 100%`; TEXTURE/KEY
  (46) crossfades it with `B: Dist Sub Dskperc, PD (A) 43`; `MG Low 12, 1.33 kHz, Drive 18`; `Decay 643 ms, Sustain
  −15 dB`; `HyperD (Wet 42, Retrig) > Distortion (Drive 18; Env 2 and the wheel add) > EQ > Comp (Ratio 5.4) > Delay
  ping-pong 30 > Filter (MgL12) > Reverb Hall (REVERB 10)`.

*K2 — bells and EP* (`SY Augustines Bell Chapel [JL]`, `BL - Kinderjoy`, `EP - Electric Piano`): synced or FFT
partial tables swept by a short envelope (`Env 2 → Osc A Warp 96%`), velocity to level, chorus, plate.

### 3.6 Pad (29: 15 S1, 14 S2)

**Shared.** Poly. Full sustain (0 dB in 22). Long release: ≥0.5 s in 21 (median 1.1 s). Slow attack in 13
(≥100 ms; 0.5–0.9 s on the Serum 1 slow pads, up to 1.8 s on Serum 2). Filter in 26 of 29, mostly MG Low 12/18/24 or
Band 12, cutoff median 420 Hz: pads are dark. Delay (21) and reverb (19) on almost all; chorus on 8 of the 15 S1
pads.

**Serum 1 pads vs Serum 2 pads.** S1: 2 tonal oscillators in 10 of 15, mostly saws, 16-voice unison in 2, one filter
only (13 of 15), chorus and HyperD common, distortion in 6, **LFO gates on the volume in 5**, slow LFO
detune/pan. S2: 3 tonal oscillators in 10 of 14, OSCAR/Dying Saw/PWM Juno/Basic Mini at 2–7 voices, both filters
(often a low-pass plus a high-pass) in 10, phaser and convolution common, Abyss reverb in 5, 134 macro routings
against 61.

*PD1 — detuned analog saw pad* (`PD Jp8k [7S]`, `PD - Wanderlust`, `PD D_Pad 2 [DU]`, `PD - Secrets`):
- Two saws: `A: Unison=7–8, Uni Detune=0.15–0.21, Uni Blend 83–100` (Jp8k `Octave=-1`), `B: Unison=4–7,
  Detune=0.20–0.26` (Wanderlust `Octave=+1, Fine=13`). D_Pad 2: two init saws at 4 voices (`Phase=235°/151°`, PD on B)
  and `Sub: Saw`.
- `Filter 1: MG Low 12 368 Hz Res 22` (Jp8k), `Band 12 468 Hz Res 11` (Wanderlust), `Low 12 187 Hz Res 16 Drive 20`
  (D_Pad 2).
- `Env 1: Attack 0.5–0.53 s` (D_Pad 2: 4.5 ms), `Sustain 0 dB`, `Release 0.9–1.3 s`.
- Drift: `Noise Osc → Osc A Detune 39%, Osc B Detune 38%` (Jp8k: noise as a random source) or a 3.2 Hz LFO on tuning
  behind a Vibrato macro.
- Effects: `HyperD (Detune 40, Dim wet 25, Wet 34) > Chorus (Depth 24, Feedback 19.5, Wet 36) > Delay (Feedback 50,
  Wet 37) > Reverb Hall (Size 48, pre-delay 56, Wet 50) > Comp (Ratio 2.4)` (Wanderlust); Jp8k: `EQ > Chorus
  (Feedback 35, Rate 0.065, Wet 39) > Delay (Wet 23)`; D_Pad 2: `Distortion Soft Clip (Wet 58) > Comp > Reverb
  (plate-type, Feedback 62, Size 54, Wet 33, Width 100)`.
- Secrets is the dry one: `A: Basic Mini, TablePos 110 (past the saw, softer), Unison=6, Detune=0.17`; `B: Basic
  Mini, TablePos 199, Octave=-2, Unison=5, Detune=0.16`; `MG Low 12, 213 Hz`; `Attack 631 ms, Release 778 ms`; synced
  warble instead of slow drift (`LFO 3 (1/16) → Osc A Fine 44%`, `LFO 1 (1/8) → Osc B Fine 41%`, `LFO 2 (1/8) → Filter
  1 Freq 36%`); only a comp and a low cut at 210 Hz, no space.

*PD2 — gated / pulsing pad* (`pad [trance]`, `[PS] pad [sense]`, `MO_SHINJU_PD_Immense_Light`, `Pad - Polarized`):
- A tempo-synced LFO chops the sound: `LFO 1 (1/4, custom 5 points) → Global VoiceAmp 100%` (trance), `LFO 5 (1/8) →
  Global VoiceAmp −100%` (Immense Light), `LFO 1 (1/8, 5 points) → Osc A Volume 64%, Osc B Volume 21%` (sense),
  `LFO 1 (1/16) → Osc A Volume 92%, Osc B Volume 100%` (Polarized).
- Trance: `A: saw, Unison=16, Detune=0.00`; `B: Basic Shapes WT Pos=4 (square→pulse), Octave=-1, Unison=16,
  Detune=0.00`; DETUNE macro (27) adds `+57/60%` of detune; `Noise: ARP white 52%`; `Filter 1 Type=Phs 12+, Freq=1011,
  Wet=75`; `Porta Time=11 ms, Legato, Porta Always` (poly); `Reverb Hall (Size 35, pre-delay 57, Wet 28) > EQ (low cut
  564 Hz, −24 dB shelf at 5 kHz)`. SPEED macro on the gate rate.
- Sense: `A: Analog_BD_Sin, Unison=5, Detune=0.08, PD (B)` with `LFO 2 (bar) → Warp 32%, Fine 11%`; `B: saw,
  Unison=16, Detune=0.17`; `HyperD (Detune 58, Dim wet 40, Wet 52) > Chorus (Depth 0.76, Rate 0, Filt 2.6 kHz, Wet 100)
  > Comp multiband > Delay ping-pong (Wet 30) > EQ low cut 457`. No reverb.
- Polarized adds opposite pans: `LFO 4 (1/4) → Osc A Pan 68%, Osc B Pan −68%`.

*PD3 — Stickz' sample-textured pad* (`PAD - Burn Alive`, `PAD - Celestial`, `PAD - Pop Sines`):
- The **noise oscillator plays a pitched sample** at 65–80% (`Pitch Track=On`, `Pitch` −3 to +13 st): "Corroded
  Synth", "Dirty Pizzicato", "Pure Tone". Wavetable oscs are Stickz' own (MS-20 triangle, Andromeda saw, SQ-80 sine,
  Subsequent 37 triangle) or an init saw.
- `MG Low 24 at 350 Hz–1 kHz` (Celestial: `MG Low 18 at 8 Hz` opened 78% by an envelope-mode ½ LFO).
- Effects mostly at `Wet=0` behind macros with standard names: SATURATION / TAPE CRUNCH (XShaperAsym distortion),
  WET MIX (delay and reverb), MOD FX (chorus, flanger), FADE AWAY (cutoff down, delay and reverb up, `VoiceAmp −50%`).
- Pop Sines: `A: SQ-80 Sine, Pan=-50, Phase=0°, Rand Phase=0`, `B: Subsequent 37 Triangle, Pan=50, Phase=69°`,
  `Note# → Osc A/B TablePos 100%`, `LFO 1 (0.8 Hz) → Osc B Fine 8%`: a slow beat between the two sides.

*PD4 — effect-filter pads* (`Pad - Chaos Theory`, `Pad - Cello Vocal`): `Filter 1 Type=Reverb` (431 Hz / 11 Hz, Res
50–86), the noise oscillator enabled at 0% as a random mod source (`Noise Osc → Filter 1 Stereo 100%`,
`→ Osc A TablePos 100%`), fast LFOs (10–14 Hz) on pan or an FX filter, `Allpasses` or `SNH2` FX filters.

*PD5 — slow evolving pad* (`PD Lost Space Pad [JL]`, `PD Defiant [BR]`):
- Lost Space: `FFT_Animal 1` synced, breath noise `−9 st 13%`, `Sub Sine −1 16%`; `MG Low 18, 75 Hz, Res 48, Drive 22`;
  `Env 1: Attack 863 ms, Release 3.04 s`; `Env 2 (Decay 16.2 s, Sustain 30%, Release 16.7 s) → Filter 1 Freq 68%,
  Osc A TablePos 37%`; `Reverb (plate-type, Size 88, Wet 48, Width 100)`.
- Defiant ("Use Mod Wheel"): `A: a 256-frame user table, Unison=12, Detune=0.25, Blend 91, Warp Mode=Remap 1 100`;
  `Noise: Inharmx 3 26%`; `Filter 1 Type=Phs 36+, Freq≈1.2 kHz, Res 20`; `Attack 660 ms, Sustain −3.6 dB, Release
  958 ms`; one `LFO 1 (2 bar, 6 points, Smooth 48)` → `Osc A TablePos 54%, Warp −21%, Filter 1 Freq 17%, HyperD Wet
  48%, FX Filter Freq 27%`; the wheel brings the phaser, flanger and Dimension; `HyperD (Dim size 75, Wet 57) > Flanger
  > Phaser (Feedback 80) > Delay (Wet 43) > Filter MgL12 (Wet 67)`.

**Serum 2 sub-families** (contrast only): the Electric Himalaya template (`PD - Classic Analog`, `Motion Tech`,
`Dark Shuffle Motion`: `OSCAR + Dying Saw + PWM Juno, Unison 4/4/3, Detune 0.11/0.07/0.06, Octave −1`, `MG Low 12
~170 Hz + High 18`, `Env 2 → Filter 23%`, NoteOn Rand on fine, NoteOn Alt on pan, eight macros); sample/multisample
hybrids (Arp Solina, Bamboo Forest, Piano and Unison, Liminal Autumn, Space Coin, Pacific Rain); a soft saw pad
(`PD - Butterbrot`: three `Basic Mini` saws at 2 voices, `MG Ladder 408 Hz`, `Attack 1.78 s`).

### 3.7 Bass (11: 10 S1, 1 S2)

**Shared.** Mono (10 of 11), glide on 5 (median 90 ms, up to 311 ms). Low octaves: most oscillators at `Octave=-2` or
`-1`. Instant attack (except Porta Potty's 312 ms and Undercurrent's 96 ms), full sustain, release ≤20 ms in 7: a
held, cleanly stopped note. Filter in only 6 (MG Low 12/24 at 411–821 Hz, drive 10–58 on 5). Distortion in 9 (drive
median 51), HyperD in 7. Little space: reverb in 3 at wet ≤9, delay in 3.

*B1 — reese* (`BassReese - Grrr`, `BassReese - Undercurrent`, `BassReese - Porta Potty`, `BassReese - Hollow
Knight`, `Savage Sounds - Bass 18 Mod`):
- Two detuned stacks low: Grrr `A: SawRounded, Octave=-2, Unison=7, Detune=0.07` + `B: Reesey Mess 1 [SL], Octave=-2,
  Unison=5, Detune=0.04, Fine=20` + `Sub Sine −2 51%`; Undercurrent `A: saw, Unison=16, Detune=0.25, Octave=-2` +
  `B: Analog_BD_Sin, Octave=-2`.
- `Filter 1 MG Low 24, Freq 425–821, Res 0–9, Drive 0–27, Var 33`; `Bend Up/Down ±12` (Grrr).
- Grrr has only `EQ (+2 dB low shelf at 28 Hz)`; Undercurrent runs `HyperD (Detune 100, Dim wet 35, Wet 37) >
  Distortion (Drive 59) > Phaser (Noise Osc → Freq 37%, Wet 63) > Delay (LFO 9/10 at 0.2–0.3 Hz → TimeL/TimeR 5%: tape
  wow) > EQ > Chorus (Wet 100) > Filter Scream3LP (Wet 50) > Reverb (macro)`, `Porta Time=253 ms, Porta Always`.
- Porta Potty (NEST, as Undercurrent): `Mono, Porta Time=311 ms`, `Bend ±12`; `A: SQR_SAW_Wrd, Octave=-1, Unison=7,
  Detune=0.07, FM (Noise) 27`; `B: user Reese2, Octave=-2, Unison=5, Detune=0.04, Remap 1 45` walked by `LFO 1
  (0.2 Hz) → Osc B TablePos 48%`; `Sub: RoundRect −2 51%`; `Env 1: Attack 312 ms, Release 112 ms`; no voice filter;
  `HyperD (Detune 27, Wet 37) > Distortion Tape Sat (Drive 100) > Delay (SPACE 80 → ≈50%) > EQ > Filter MgL12 (Drive
  21, Res 50)`; macros SPACE, HIGH PASS, DETUNE, TONE. `Main Vol=37%`.
- Hollow Knight: a near-sine reese (`Analog_BD_Sin, Unison=3, Detune=0.19, PD (A) 44`) through `MG Low 12 561 Hz,
  Drive 50`, `HyperD > Formant filter (Wet 83) > Chorus > Distortion (Drive 65, Wet 55) > Comp multiband (Makeup 31) >
  EQ cuts`. `Main Vol=88%`.

*B2 — mono bass with its layers on macros* (shinju's `MO_SHINJU_BS_5th_King`, `MO_SHINJU_BS_World_Bed`,
`[PS] bass [hyper]`; Dynox's `BA - Sputnikv2`):
- 5th King: `A: saw, Octave=-1, Level=27%`; `B: saw, Semi=+7, Level=0%` + `LFO 1 (bar dotted, 3 points) → Osc B
  Volume 45%` (the fifth comes and goes); `Sub: Sine, Octave=-2, Level 0%` on `SUB` (38) → `+100%`; `MG Low 12 411 Hz,
  Drive 26`; `Mod Wheel → Distortion Drive 49%`; `Comp (Makeup 3.3) > Distortion (Drive 51) > Reverb (REVERB, 0) > EQ >
  Filter (FILTER 100)`.
- World Bed: `A: saw, Octave=-2, Unison=2, Blend=66`; `B: saw, Octave=-1, Semi=+7, Unison=3` on `5TH` (0);
  `MG Low 12 425 Hz, Drive 10` + `FILTER 49`; distortion `Drive 100` and chorus behind `DIST AMT`/`REESE` at 0.
- Hyper: `A: Gritty, WT Pos=256, Octave=-2`; `B: Monster 2 [SL], WT Pos=150, Octave=-1, Level 42%`, `LFO 1 (1/8,
  Smooth 12) → Osc B TablePos 16%`; `Sub Sine −2 100%`; mono legato, `Porta 27 ms`; `Distortion Diode 1 (Drive 47,
  Wet 67) > Comp multiband > Filter (Drive 36)`.
- Sputnik: `Mono, Legato, Porta Time=90 ms`, `Bend ±12`; `A: Basic Shapes last frame (soft square), Octave=-2,
  Fine=30, Warp Mode=PD (B) 68`, swept by `LFO 1 (4 bar) → Osc A TablePos 100%`; `B: 4088, Octave=-2, Unison=5,
  Level 0%` on LAYER, hum noise on NOISE, `DIRTY → Distortion Drive 33%, Dimension 50%, Comp Thresh −15%`; no filter;
  `HyperD (Wet 49) > Distortion (Drive 38) > Comp multiband > EQ (+4.6 dB at 393 Hz)`.

*B3 — bass pluck* (`BassPluck - Tubular`): a sine (`Octave=-2`) + `Sub Sine −1`, `Env 1: Decay 1.02 s, Sustain -∞,
Release 117 ms`; `Env 3 (Decay 20 ms) → Osc B Octave 73%, Noise Volume 41%` (a click and pitch jump on the attack);
`HyperD (Detune 100, Wet 50) > Distortion Sin Fold (Drive 20)`.

**Outlier.** `Savage Sounds - Bass 18 Mod` is poly, with 12 + 14 unison voices (`DirtySaw` PD 64 + `Basic Mini` −1),
`Uni Blend=100`: the one maximal bass.

### 3.8 Sequence & arp (17: 7 S1, 10 S2)

**Shared.** Movement is the point: LFOs drive the oscillator volumes (20 routings), the filter (13) and table
positions (11). Synced rates (⅛, ¼, bar). Instant attack; mostly short release (≤20 ms in 9). Serum 2 ones use the
arpeggiator and clips (`Arp Rate`, `Arp Gate` on macros), multisamples and up to 50 routings.

*SQ1 — Serum 1 patterned sequence* (`SQ Diver [GS]`, `SQ Future Steps [LCV]`, `SQ Fifth Ave 1 [JL]`, `SQ Bass Riser
[FN]`, `SQ Busy Lines [LCV]`, `SQ Automator 1 [GS]`, `SEQ - Calcus`):
- An LFO drawn as a step pattern on volume and position: Diver `LFO 4 (bar, 33 points) → Osc A Volume 94%, Osc B
  Volume 89%, Filter 1 Freq 80%`; Future Steps `LFO 1 (1/8, 4 points) → Osc A TablePos 100%, Osc A Volume 100%`;
  Bass Riser `LFO 3 (bar, 10 points) → Filter 1 Freq 55%, Global MasterTuning 12%` (a pitch pattern).
- Or a melody drawn in the LFO: Calcus `A: Basic Shapes sine, Octave=+1` with `LFO 1 (bar, 9 points) → Osc A Pitch
  100%`, `B` (a quieter sine, 2 voices) gated by `LFO 2 (1/4) → Osc B Volume 100%`; `MG Low 12, 949 Hz, Res 37`; delay
  25%, hall 32%. Automator takes it furthest: `A: Basic_Mdc`, `B: 4088`, noise `Atmos 07` and a pulse sub all at
  `Level=0%`, played by four bar-long LFOs (31, 4, 23 and 33 points) on their volumes, pitches, octave, table position
  and noise colour; `Distortion Sine Fold (Drive 22, Wet 67)`; a plate (Size 100) whose wet `LFO 3` cuts. Mono legato.
- Sources: PWM Genji (`Unison=8, Detune 0.17/0.45, Sync`), Acid, PWM Juno with `Remap` warps, RoundRect or pulse subs.
- Diver's bloom: `Env 3 (Attack 6.51 s, Release 12.9 s) → Delay Wet 71%, Reverb Wet 74%`.
- Effects small: plate-type reverbs at `Size 8–55`, a multiband comp, a short delay.

*SQ2 — Serum 2 gated trance and arps* (`SEQ - Trance in the Pance`: `Saw Square, Unison=7, Detune=0`, Superfier macro
→ `Detune +51%`, `LFO 4 (1/4, 17 points) → Osc A Volume 75%`, `Comp Ratio 1e6, Thresh 0.15`, `Reverb Wet 58`; the
Electric Himalaya ARPs: FM/ring-mod bells, multisample mallets and ouds, macros for arp rate/gate/range).

### 3.9 Vocal (4: 3 S1, 1 S2)

*V1 — Stickz' vocal* (`VOX - My Life`, `VOX - No Happiness`, `VOX - Leave Behind`):
- My Life and No Happiness are leads: `Mono Toggle=On, Legato=On, Porta Time 69–464 ms`. Leave Behind is poly, with
  `Filter 1 Type=High 18, Freq 245 Hz` instead of the formant filter.
- The voice is a **sample on the noise oscillator** (`Alter Vox 0`, `Alter Vox 27`, `SQ80 Vox Low`) at 58–100%,
  `Pitch Track=On` (+12/+24 st). The wavetable oscillators are at `Level=0%` and come in on SYNTH MODE / ADD SYNTH /
  WARM PAD.
- Leave Behind's tricks: `LFO 9 (82 Hz) × CHAOS WIDTH → Noise Pan 100%` (audio-rate panning for width) and a
  33-point ½ LFO on the flanger's output level (…GATE: a trance gate made from an effect's level).
- A formant filter (`Formant-II/III`, `Res 37–50, Drive 21–29`) at `Wet=0`, opened by a FORMANT macro; LFOs on its
  `Var` (vowel) and `Freq`.
- `Distortion XShaperAsym (Drive 17–90, Wet 29–80) > Chorus/Comp > Reverb Hall (Size 33–40, Wet 0–36) > Delay > EQ
  (low cut 175–443 Hz, +3.4 dB high shelf)`. FADE AWAY (`VoiceAmp −50%`, delay up) as on the pads.

### 3.10 Instrument imitation (4: 2 S1, 2 S2)

`GUITAR - Sad Stories` is V1's method with a nylon-guitar sample (noise osc, `Pitch=12 st`, `Note# → Noise
InitialPhase 100%` so each note starts elsewhere), `Velo → Filter 1 Freq 39%, Filter 1 Wet −81%` (harder = brighter
and drier), `Env 1 Decay 8 s, Sustain −14 dB`. `banjo lol` gets a twang from `Filter 1 Type=Reverb, 61 Hz, Res 45`
with `Env 1 → Osc A TablePos 26%, FX Filter Freq 73%` on `Oddpass [SN]`. The two brass presets (S2) are multisample
hybrids.

---

## 4. Cross-cutting taste

**Simple sources, heavy character elsewhere.** 35 of the 86 Serum 1 favourites have one tonal oscillator and 51 have
two; none has three. The commonest source is a sawtooth: about 42 of the 137 sounding wavetable oscillators (31
plain, 11 warped), 30 of them Serum 1's embedded init saw. Then near-sines (Analog_BD_Sin, Basic Shapes' sine frame,
HarmonicSeries, single-cycle sines: about 20), then Basic Shapes' square and pulse frames (9: 3ds, edm shit, Totem,
pad [trance], FUO, velvet, splinter, Monotone, Sputnik), then **Basic Shapes parked between saw and triangle**
(TablePos 61–74 ≈ frame 2.5: whitearmor, lead [club], wine, Monitor, Linear Arithmetic). Recurring tables: the init
saw, Basic Shapes, Analog_BD_Sin, Default Shapes; Monster/Reesey/Grimace/Creeper (`[SL]`, `[SN]`) for grit; the Stickz
analog tables. Serum 2's favourites use three oscillators (24 of 32) and samples (30 of 100 sources).

**Warps used: PD most** (17 S1 oscillators, `Warp 30–68`), then FM from noise (9, for "dust"), Sync (7; often at
`1.00`, i.e. idle unless moved), Remap (5), PWM (4). Warps are usually moved by a macro, an envelope or an LFO.

**Unison is bimodal.** 54 of 137 Serum 1 wavetable oscillators are a single voice; 25 are at **16 voices** (17
presets, all but one shinju's). Serum 2's favourites never go past 7. At 16 voices the detune is wide in 16 of 25
(0.08–0.38, mostly 0.15–0.25) and nearly zero in 7 (`lead [club]` 0, `pad [trance]` 0, `key [nowhere]` 0, `[PS] lead
[scythe]` 0.01, `synth [stadium]` 0.02: thick but nearly in tune, often with an LFO or macro to add detune). Middle
counts (2–8 voices) mostly sit at 0.03–0.2. Unison width and blend are mostly left at default.

**Dark, driven filters.** 56 of 86 Serum 1 presets use one voice filter, never two. MG Low (12/18/24) is 31 of the
56; band-pass 6 (luv's sine, wine, hendrix, Wanderlust, Diver, Polarized), combs 2. Cutoff median **504 Hz**. Drive
is on in 32 (median 14, up to 52). Sweeps come from envelopes (14) and LFOs (17). Several plucks start fully closed
(8–40 Hz) and let an envelope open them.

**Envelopes.** Attack is instant (0.5 ms) except on pads, swells and two basses (≥100 ms in 9 S1: 0.23–0.86 s).
Sustain is either full (49) or none (15, plucks). Release is either ≤20 ms (35: leads, basses) or long (36 at
≥0.5 s). Many presets ignore envelopes 2–3 unless something short needs them (pitch blips, filter plucks).

**Effects: present, modest, in Serum's order.** Serum 1 presence: EQ 57, Reverb 56, Delay 45, Distortion 43, Comp 41,
Chorus 29, FX Filter 22, HyperD 20, Phaser 7, Flanger 7; 7 presets have none. Order mostly follows Serum 1's default
rack (HyperD first in 16 of 20, distortion before reverb 31 of 32, chorus before delay 15 of 18, EQ last or before the
FX filter 39 of 57), so don't read order as a statement. What is chosen:
- **Reverb**: Hall in 38, plate-type in 18. Size median 35, wet median 27. The Halls keep `Width` at 20–23 (30
  presets), which looks like the Hall's starting value left alone: a narrow room. Most plates (16) sit at `Width=100`.
- **Delay**: ping-pong (`Mode=1`) in 30 of 45; wet ~30, feedback 10–83 (median 40); the delay's band filter often
  narrowed (`BW 0.75–3`, `Freq 0.3–2.3 kHz`): dark repeats.
- **Distortion**: Serum's default mode (16), then **Downsample** (8 presets, every one shinju's: careful, hydra, air
  bender, sprite, wine, loss, splinter, and pad [trance] at wet 0; plus 4 S2), XShaperAsym (6, all Stickz), Soft Clip
  (4), Sin Fold (3), Diode (2). Downsample runs at drive 12–31 with wet 20–64: crunch rather than destruction. Drive
  100 is heard at full wet only on 3ds, hendrix, FUO (soft clip) and Porta Potty (tape sat); elsewhere it sits at low
  wet (GUITAR 16%) or behind a macro.
- **Compressor**: 18 of 41 multiband (Serum's OTT-style), mostly at default times; PL Sunny's is a squash (ratio
  maximal, makeup 31).
- **EQ**: a low cut at ~200 Hz (`Type1=2` in 34 of 57; leads higher, 170–655 Hz) and a high shelf around 2 kHz
  (median +2.6 dB; +14 to +18 dB on lead [club], [PS] lead [luv], PL Tinkerbell, Pluck - Tilt). Dark sounds cut instead
  (`−24 dB at 5 kHz` on pad [trance], `−24 dB at 4.2 kHz` on Frozen Air, `−9.7 dB at 186 Hz` on key [nowhere]).
- **Chorus**: shinju sets the chorus's own low-pass low (`Filt 1.3–4 kHz`) and the wet high (48–100): wide but dark.
- **HyperD** with `Unison=4`, often at `Detune=0` waiting for the mod wheel or a macro.

**Macros switch effects on.** 76 of 228 Serum 1 macro routings go to an effect's Wet. Nine Serum 1 presets load with
the reverb silent: five `MO_SHINJU` presets, `MO_TDA_SY_Monitor` and `PAD - Pop Sines` with a ROOM / REVERB / WET MIX
macro to bring it in, `SQ Diver` and `SQ Automator` by an envelope or LFO; distortion and chorus get the same treatment
(DIST AMT, DIST, CHORUS, REESE, 5TH), and FUO has the reverse, a DRYNESS macro. Common macro names: FILTER/CUTOFF (14),
REVERB/ROOM (11), FADE AWAY (6, Stickz), DIST AMT (4), CHORUS (4), WET MIX (3), SPEED (3), DUST, HARSHNESS, DETUNE.
A preset is a dry core plus four knobs.

**Movement is slow and small, or synced and hard.**
- Drift/vibrato: `LFO → Osc Fine` in 17 Serum 1 presets (median 24%), at ¼–½ note or 0.2–1 Hz, often on one oscillator
  only; delayed (`LFO Delay 1/64`) or on the mod wheel. Exceptions are fast: FUO's 8.7 Hz at 38%, Secrets' synced
  ⅛ and 1/16 warble.
- Gates: `LFO → Osc Volume` or `Global VoiceAmp` in 17 (⅛, ¼, 1/16; custom 3–6 point shapes), across pads, synths,
  sequences and even a bass and a lead.
- Table position (25 LFO routings), pan (8 presets, usually the second oscillator), detune breathing (`LFO → Detune`).
- Patterns drawn into bar-long LFOs of 9–33 points (Calcus, Diver, Automator) for melodies and rhythms.
- Randomness from the noise oscillator used as a mod source (8 routings: detune, table position, filter stereo, phaser).
- Audio-rate LFOs for grit (53.5 Hz on Fine in ld - 3ds; 52 Hz on warp in Frozen Air; 13.4 Hz flutter in Jumper; 82 Hz
  on the noise pan in Leave Behind).
- LFO shapes are mostly Serum's default triangle (35 of 105) or simple 3–6 point drawings.
- Pitch blips: a 4–37 ms envelope on `Global MasterTuning` (5 plucks).

**Stereo tricks.** The second oscillator panned (whitearmor B −50; Pop Sines ±50; Monitor −18/+21 with opposite
fine), auto-panned by a slow LFO, pans driven in opposite directions (Polarized), or an audio-rate pan (Leave
Behind). Unison width rarely touched;
chorus and HyperD carry the width; reverbs narrow (Halls at 20) or plate-wide (100).

**Mono and glide.** 31 of 86 Serum 1 presets are mono (leads, mono synths, basses, vocals, a sequence); glide
2–464 ms, median 31 ms; `Porta Always` often on. Serum 2's favourites: 1 mono.

**Serum 1 favourites vs Serum 2.**

| | Serum 1 (86) | Serum 2 (32) |
|---|---|---|
| Tonal oscillators | 1 in 35, 2 in 51, never 3 | 3 in 24 |
| Samples, multisamples, granular, spectral | none (but 7 Stickz presets play a sample on the noise osc) | 30 of 100 sources |
| Unison | 1 voice or 16 (17 presets at 16) | 2–7, never more |
| Voice filters | one, in 56 | both in 17, one in 13 |
| Mod routings | median 4.5 | median 20.5 |
| Mono | 31 | 1 |
| No effects at all | 7 | 0 |
| Distortion | 43 | 10 |
| Reverb types | Hall, plate | Hall, Abyss (6), Vintage (5) |
| Extras | — | Convolve 10, Frequency Shifter 7, buses, arp/clips |

The Serum 1 favourites are bedroom presets: a saw or a sine, a dark driven filter, one or two LFOs, a handful of
effects and four macros. The Serum 2 favourites are polished factory designs. Taste lies with the former: few parts,
each audible.

---

## 5. Rules for designing new ones

A checklist for an LLM designing a Serum preset in this taste. Values are Serum's displayed ones.

**Do**
1. Start from **one** oscillator; add a second only for a job (an octave/fifth, a high sine partial, a noise or hum
   bed). Never fill all three.
2. Use plain waves: the init saw, `Basic Shapes` between saw and triangle (`TablePos 60–75`, WT Pos 2), a sine or
   near-sine (`Analog_BD_Sin`), a square for plucks. Add grit with one warp: `PD` (30–60), `FM (Noise)` (on a DUST
   macro), `PWM` or `Flip`, and move it with a macro, envelope or LFO.
3. Choose unison deliberately: `1` voice, or `16` voices, either wide (`Uni Detune 0.15–0.25`, the commoner) or
   dense and in tune (`0.00–0.02`; breathe it with `LFO (1/2) → Detune ~30%` or a DETUNE macro). Middle counts 2–8 at
   `0.04–0.2`.
4. Filter dark and driven: `MG Low 12/24` (or `Band 12` on a sine), `Freq 300–800 Hz` for basses and pads,
   `0.8–2.2 kHz` for leads and keys, `Drive 15–50`. Plucks: start at `18–40 Hz` and open it with the amp envelope
   (`Env 1 → Freq 35–65%`).
5. Envelopes by role: leads/basses `A 0.5 ms, S 0 dB, R 15 ms` (whitearmor-style soft lead: `A 40 ms, R 640 ms`);
   plucks/keys `D 0.3–1.3 s, S −∞, R 0.6–2 s`; pads `A 0.5–0.9 s, S 0 dB, R 1–3 s`.
6. Leads, basses and mono synths: `Mono Toggle=On`, usually `Legato`, `Porta 10–60 ms` (up to ~120 ms for a sliding
   lead), `Porta Always=On`.
7. Movement: one slow `LFO → Osc Fine 10–25%` (¼–½ note or 0.2–1 Hz) for drift; for rhythm, a synced custom LFO
   (⅛ or ¼) on `Global VoiceAmp` or the osc volumes; for stereo, a slow LFO on the second oscillator's pan.
8. Effects, few and modest, in Serum's order: `HyperD/Distortion > Chorus > Delay > Comp > Reverb > EQ > Filter`.
   - Reverb: Hall `Size 35–65, Wet 25–40, Width ~20`, or plate `Size 45–90, Width 100`.
   - Delay: ping-pong, `Wet ~30`, `Feedback 40–80`, band filter `BW 1–3`, `Freq 0.6–2.3 kHz`.
   - Chorus: `Wet 50–100` with its low-pass at `1.5–4 kHz`.
   - Distortion: `Downsample Drive 12–31, Wet 20–65` for crunch (shinju's signature), or the default mode
     `Drive 40–60` for warmth.
   - EQ: low cut ~200 Hz (300–650 Hz on leads), a +2 to +7 dB shelf near 2 kHz, or −24 dB at 4–5 kHz to darken.
   - Comp: multiband (OTT-style) at default times when it needs to be loud.
9. Give it four macros named for what they do (FILTER, ROOM/REVERB, DIST AMT, CHORUS, DUST, DETUNE, SPEED,
   FADE AWAY) and route most of them to effect wets. Shipping the space at 0 on a macro is in character.
10. Noise as texture: `Organics/AC hum1` at 20–45% under leads and plucks, `ARP white` 50% under a trance pad; or the
    noise osc at 0% as a random mod source; or a pitched sample on it (`Pitch Track=On`) for vocals and guitars.
11. Lower `Main Vol` (40–55%) when stacking 16 voices.

**Avoid**
- Three oscillators, layered multisamples, granular or spectral oscillators as the core of the sound.
- Long mod matrices: aim for 2–8 routings (median 4.5); never 50.
- Bright open filters with no drive; resonance above ~40 except on peak/formant/comb types.
- Medium unison everywhere (e.g. every osc at 4 voices, detune 0.25).
- Big bright reverbs on leads (wet above ~40 on a lead only for a sine-ish lead like `[PS] lead [luv]`).
- Busy effect racks of 10+ modules, both buses, convolution and frequency shifters: Serum 2-style polish.
- Fast tremolo or vibrato in Hz on pads (drift is slow; rhythm is synced).

**Typical ranges (Serum 1 favourites)**

| Control | Range | Median / usual |
|---|---|---|
| Tonal oscillators | 1–2 | 2 |
| Unison | 1 or 16 | — |
| Uni Detune (unison > 1) | 0–0.45 | 0.12 |
| Osc Octave | −2…+2 | 0 (basses −2, leads 0/+1) |
| Filter 1 Freq | 8 Hz–14 kHz | 504 Hz |
| Filter Drive | 0–52 | 14 |
| Filter Res | 0–86 | 14 |
| Env 1 Attack | 0.5 ms–0.86 s | 0.5 ms |
| Env 1 Release | 5 ms–3.4 s | 15 ms (leads/bass), 0.7–1.3 s (plucks/pads) |
| Glide (mono) | 2–464 ms | 31 ms |
| LFO → Fine | 2–100% | 24% |
| Mod routings | 0–18 | 4.5 |
| Reverb Size / Wet | 0–100 / 0–70 | 35 / 27 |
| Delay Feedback / Wet | 10–83 / 0–100 | 40 / 30 |
| Distortion Drive | 0–100 | 45 |
| EQ low cut | 30 Hz–2 kHz | 210 Hz |

**Worked starting points** (straight from the evidence; adjust one or two things, not everything):
- *Whitearmor lead*: `A Basic Shapes, TablePos 68, Level 45%, Unison 3, Detune 0.06`; `B HarmonicSeries, TablePos 31,
  Level 24%, Pan −50` + `LFO 2 (bar) → B Pan 100%`; `MG Low 24, 2.2 kHz, Res 12, Drive 40, Var 67`; `Env 1 A 42 ms,
  R 640 ms`; `LFO 1 (1/2) → A Fine 24%`; `Chorus Wet 28`; plate `Size 61, Wet 33, Width 100`.
- *shinju mono lead*: one saw, mono, `Porta 2–60 ms`; `Flip` or `FM (Noise)` warp on an LFO/macro; `MG Low 12 ~770 Hz,
  Res 17, Drive 25`; `HyperD (Detune 0, Unison 4)` on the mod wheel; distortion (rectify) and Hall (`Size 25, Width 20`)
  at wet 0 behind DIST AMT and ROOM; `Comp Attack 0.1`; EQ low cut ~380 Hz.
- *tda pluck*: `EVOSounds Square` or a near-sine at 10 voices; `AC hum1` 25%; `MG Low 12 at 18–40 Hz`, `Env 1 → Freq
  65%`; `Env 1 D 0.8 s, S −∞, R 1.3 s`; `Env 2 D 9 ms → Main Tuning 38%`; no effects.
- *shinju pluck*: quiet saw + near-sine, sine sub −1; `Low 12, 2.2 kHz, Res 61, Drive 41`; `D 0.76 s, S −11 dB`;
  downsample (Drive 16), chorus 48, Hall (Size 63, Wet 38), ping-pong (fb 83), EQ low cut 230 + 7 dB at 2 kHz.
- *wide shinju lead*: two init saws at 16 voices, `Detune 0.18`, A with `PD 42`, B `+4 oct, Level 70%, Fine 26`;
  mono; `MG Low 12, 4.6 kHz, Drive 33`; downsample (Drive 12), Hall (`Size 50, Wet 44, Width 20`), low cut 236 Hz; no
  modulation (`lead [air bender]`).
- *soft 16-voice pluck*: a sine −1 oct at 16 voices (`0.04`) + a square/pulse at 29% (`PD 46`, 16 voices, `0.25`), a
  sine sub; `D 1 s, S −22 dB`; an MG Low 12 FX filter opened 29% by Env 1; ping-pong (fb 69) filtered at ~300 Hz; no
  reverb (`[PS] pluck [velvet]`).
- *trance-gate pad*: saw + square/pulse −1, both 16 voices at detune 0 + DETUNE macro; ARP white noise 50%;
  `LFO 1 (1/4, custom) → VoiceAmp 100%` with a SPEED macro; Hall `Size 35, Wet 28`; EQ low cut 560 + −24 dB at 5 kHz.

---

## Appendix: problems found in the data

- The first capture took 23 Serum 1 presets' states from the wrong preset; they were recaptured with the checks in
  §1 (`recapture.txt`). `states1/` still holds the first capture, so read Serum 1 states from `converted/`
  (`embedded_tables.py` does by default).
- `card.py` prints macro values as `None` when a macro has a name: Serum's readout renames `Macro N` to the macro's
  name, and the value is on the card's `global:` line instead. It tests the type `kOsc_MultiSamp` where the files say
  `kOsc_MultiSample`, and its `W` still read `/tmp/serum-work` when this was written.
- The `out/` JSON replaces embedded wavetable data with a placeholder (`"<2048 values>"`); the data is still in the
  captured states (`converted/`, `states/`), which `embedded_tables.py` reads. Two embedded tables there
  (`BassPluck - Tubular` A, `BassReese - Undercurrent` A) decode to implausible numbers, probably another sample format.
- Several Serum 2 presets show `Filter Freq = 8` (Serum's floor) with a modulation opening it; a static reading of
  those filters would be wrong.
- Effect parameter defaults are not in the data; values that recur everywhere (Delay `Wet=30`, Hall `Width=20`, Comp
  `Attack=90.1`) are probably defaults, not choices.
