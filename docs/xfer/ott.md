# OTT

Xfer Records' **OTT**, the free multiband upward and downward compressor ("Over The Top"): the Ableton
Multiband Dynamics preset of that name made a plugin, and the sound of a decade of EDM (squashed,
bright, loud, every quiet tail brought up). This is what it is, from Xfer's plugin and what's been
written and measured of it, and then what's ours: [what's decided](#decided), [where Vaudio
differs](#where-vaudio-differs) and [how it's built](#how-its-built).

Sources: [Xfer's freeware page](https://xferrecords.com/freeware); the 2022 redesign's write-ups
([Bedroom Producers Blog](https://bedroomproducersblog.com/2022/05/04/xfer-records-ott/),
[Synth Anatomy](https://synthanatomy.com/2022/05/xfers-records-ott-free-multi-band-compressor-plugin-gets-new-gui.html));
a user's guide to its gestures ([note.com, shimix](https://note.com/shimix/n/n3c8ad268d2e8)); EDMProd on
the Ableton preset ([OTT plugin](https://www.edmprod.com/ott-plugin/)); and, for the sound itself,
**David Braun's model of OTT 1.3.1** in the Faust libraries (`co.xfer_ott`,
[grame-cncm/faustlibraries#257](https://github.com/grame-cncm/faustlibraries/pull/257), MIT), every
constant of which was fitted to measurements of the plugin binary. Anything in none of them is marked
**(unverified)**.

## What it is

- Three bands, split at **88.3 Hz** and **2.5 kHz** (the Ableton preset's crossovers: the low band is only
  the sub), 4th-order Linkwitz-Riley crossovers in series, so the bands add back up to the sound (an
  all-pass of it).
- In each band, two compressors at once: **upward** below a threshold (quiet sound brought up, about
  4:1, by up to ~36 dB) and **downward** above another (loud sound pushed down, to an infinite ratio), with
  a little room between them where the band is left alone. Then a **makeup** gain, and a floor on how
  far a band is ever turned down.
- The two channels are linked: each band's level is the mean square of both sides.
- Its sound comes from how far it goes: everything ends up at about the same loudness, tails, reverbs and
  noise come up, transients get pushed down, and the band gains tilt the result (EDM's bright top).

## The window

Xfer's (1.37, 2022's resizable redesign; ours keeps its layout):

| Where | Control | Range | Default | What it does |
| --- | --- | --- | --- | --- |
| Top | **Depth** | 0 .. 100% | 100% | How much of it there is. Not a dry / wet: it scales the upward and downward slopes and the makeup (the model's fit), so 0% is the sound untouched |
| Top | **Time** | 0 .. 1000% | 100% | The bands' release, 100% is OTT's own. Above 100% it lengthens in proportion; below, it shortens towards a few ms. The attack is fixed (6 to 10 ms) |
| Top | **In Gain** | −∞ .. +19.1 dB | 0 dB | Into the bands: where the sound sits against the thresholds (more in: more downward, less upward) |
| Top | **Out Gain** | −∞ .. +19.1 dB | 0 dB | After the bands are added up |
| Middle | **The display: H, M, L** | | | A row a band: its input level (a white marker), what comes out (a yellow bar), the upward range (brown, on the left) and the downward range (green, on the right) |
| Middle | **A band's threshold** | 0 .. 200% | 100% | Dragging the gap between brown and green moves both of the band's thresholds together, ±23 to 24 dB |
| Middle | **Ctrl+click brown / green** | on / off | on | Turns that band's upward or downward compressor off |
| Middle | **H / M / L gain** | −∞ .. +6 dB | 0 dB | Each band's level after it, beside its row |
| Bottom | **Upwd%** | 0 .. 200% | 100% | How strongly the upward compressors lift (their slope) |
| Bottom | **Dnwd%** | 0 .. 200% | 100% | How strongly the downward compressors push (their ratio, infinite from 100% at full Depth) |
| Menu | Clean XOV | | off | Another crossover (not modelled; see below) |

Every knob resets to its default with Ctrl+click (Xfer's) and is automatable in a DAW.

## The sound, as measured (`co.xfer_ott`)

Per band (low, mid, high), with E the band's level in dB (its mean square, `10·log10`), a softplus knee
`soft(w, z) = max(z, 0) + w·ln(1 + e^(−|z|/w))`, and a threshold's shift `s = (thresh − 1) · {23.0, 23.7, 24.0} dB`:

```
gain (dB) = makeup(depth)                                      // a cubic in Depth a band, at most 14.0 / 9.1 / 14.1 dB
          + min(cap, depth · upward · slope · soft(wu, tu + s − E))   // slope ≈ 0.75, tu ≈ −46 / −46.6 / −47.4 dB, cap ≈ 36 dB
          − min(1, down(depth) · strength(downward)) · soft(wd, E − td − s)   // td ≈ −38.9 / −34.8 / −41.7 dB
floored at −26.3 / −31.7 / −26.0 dB
```

- The envelope is a one-pole on the mean square that switches per sample between its attack (6.2 / 6.0 /
  9.7 ms) and its release: at Time 100% 30.9 / 30.9 / 10.4 ms, at 50% 14.8 / 17.4 / 7.0 ms, at 0% 10.0 /
  11.8 / 7.0 ms, and above 100% that times Time.
- The bands are summed, each times its gain; In Gain before them, Out Gain after.
- The model matches OTT's static curves to 0.03 dB (median), 1 dB at most, and program material to
  0.1 dB median / 1 dB 95th percentile at the defaults. OTT counts part of its release in samples (it's
  faster at 96 kHz than at 48 kHz); the model's is in seconds, OTT at 48 kHz at any rate.
- Like OTT, the output can peak well above the input: a quiet band sits at up to ~+50 dB of gain, so a
  sound starting after silence overshoots by ~10 dB for the attack's few ms. A limiter after it is usual.

## Decided

Choices made for Théo (to confirm by ear):

- **The sound is Braun's model**, constant for constant, rather than our own guess at the Ableton preset:
  it was measured against the real binary, and OTT isn't installed here to measure.
- **In and Out Gain go from −24 to +19.1 dB** (OTT's go to −∞; nobody uses the bottom of them), band
  gains from −24 to +6 dB.
- **Depth, Time, the gains, Upwd%, Dnwd% and the three thresholds are automatable**: all of its knobs
  (the brown / green switches aren't, being switches). Automated, they move in the engine at the slices
  automation always does (256 samples), and its gains and curves glide from one to the next.
- **Presets**: OTT has none; ours has a few starting points (Default, Gentle, Upward only, Downward only,
  Bright, Sub tamer, Vocal glue, Drum smash), as Pro-Q's and EchoBoy's have.
- **Its look**: OTT's layout (the four knobs, the three rows, the two strength knobs) in our theme (Gross
  Beat's and EchoBoy's plates and knobs), with OTT's brown and green for upward and downward (`--ott-*`
  tokens, a light and a dark of each).
- **The display's scale**: −84 to 0 dB, with the input marker at the band's level and the output's bar at
  that level plus the band's gain now.

## Where Vaudio differs

| | OTT | Vaudio |
| --- | --- | --- |
| Clean XOV | A second crossover | Not modelled (the model's crossovers are OTT's default ones) |
| Release at other sample rates | Faster at 96 kHz than at 48 kHz (part of it counts samples) | OTT at 48 kHz at every rate |
| Time's effect on a held tone | Barely any (0.7 dB over its range) | Up to 1.7 dB (the model's known divergence) |
| In / Out Gain's bottom | −∞ | −24 dB |
| Resizing | The window scales | A fixed size, as our other built-ins |
| Presets | None | A few of ours |

## How it's built

- **The song** (`shared/music/types.ts` `Ott`; `shared/music/ott.ts`): its settings on a mixer effect whose
  plugin is `OTT_PLUGIN` (`MixerEffect.ott`), validated in `normalizeOtt`, edited by `updateOtt` /
  `updateOttBand`, presets in `ott-presets.ts`. **What its knobs mean is decided in TypeScript**
  (`engineOtt`): each band's makeup, upward slope, knees, downward amount, release and gain, from Braun's
  constants; and `ottGainDb` is the law the engine runs, which the display and the tests use.
- **Automation**: `AutomationTarget` `{ kind: "ott", effect, control }` (`OTT_CONTROLS`, `OTT_CONTROL_SPECS`:
  each control's range, taper and text); `compileSong` turns the controls into the engine's lanes
  (`OTT_LANES`, `LANES_OF`: Depth moves the makeups, slopes and downward amounts, a threshold its band's
  knees...), sampled within a thousandth, as EchoBoy's are.
- **The engine** (`engine/src/Ott.cpp`): the crossovers (TPT state-variable sections, a low band's
  all-pass at 2.5 kHz so the bands sum flat), the envelopes and the gain law per sample, the coefficients
  gliding over ~5 ms towards what the song (or a lane) says. Its state is kept across songs by effect id
  (`ott::Registry`; the export makes its own). It reports each band's level and gain in each transport
  event (`EngineTransport.otts`), which the display draws.
- **Tested**: the law and the presets in vitest (`ott.test.ts`); the engine against the law offline
  (`server/music/ott.integration.test.ts`: a band's steady gain at levels across its range, the bands
  summing flat at Depth 0, automation moving it); the window and the assistant in `e2e/music.spec.ts`.
- **The window** (`src/suites/music/ott/`): `ott-window.tsx` (the preset bar, the knobs, the display),
  `display.tsx` + `draw.ts` (the three rows on a canvas: levels, the brown and green ranges, the gap
  dragged), `geometry.ts` (levels to pixels, tested). The assistant: `get_ott`, `update_ott`.
