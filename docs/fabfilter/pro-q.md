# Pro-Q

FabFilter's **Pro-Q 3**, ours: a stock effect in the music suite, chosen from an effect slot's picker
(Built in → Pro-Q), as Gross Beat is. What Pro-Q 3 does and how it's worked is in
[pro-q-3-manual.md](pro-q-3-manual.md) (from its manual, its parameter list and its screenshots, in
`img/`); how its sound is made, in [pro-q-3-dsp.md](pro-q-3-dsp.md). This file is ours: what was
decided, where Vaudio differs, and how it's built.

## Decided

Built 2026-10-02 at Théo's request ("make Pro-Q 3, an exact clone: make it work the same way, sound the
same way"). Not yet talked through with him; what was chosen, to check:

- **Ours, not a plugin**: its settings are in the song (every edit undone, the assistant can shape it),
  as Gross Beat's are, and the engine runs it natively. The real Pro-Q 3 can still be loaded as a plugin
  beside it.
- **Its look is FabFilter's** (the dark display, the thick yellow curve, the band colours, the floating
  band controls with the dynamic ring), in every theme: a plugin's window keeps its own look. The colours
  are theme tokens (`--eq-*`), so a theme can change them.
- **FabFilter's conventions**, from FabFilter staff and measurements (`pro-q-3-dsp.md`): Q is the textbook
  Q × √2 (Q 1 is every shape's default; a Bell's Q is between its half-gain points, Q 2 one octave);
  slope is the order (6 dB/oct each); shelves and bells are symmetric Butterworth shelves (a shelf is half
  its gain at its frequency at any slope and Q); a cut's Q acts on its sharpest section (its gain at its
  frequency is 20·log10(Q/√2) at any slope); Brickwall is a 14th-order elliptic filter (0.05 dB ripple);
  Flat Tilt's slope is gain / 5 dB per octave; Natural Phase is 7.3 ms late; Linear Phase's latencies are
  Pro-Q's (3072 to 66560 samples at 44.1 kHz, the same in ms at other rates).
- **What isn't published, designed** (and so worth hearing against the real one): the dynamic EQ's
  detector (the band's own range as a band or low/high pass, attack max(10 ms, 2/f), release max(100 ms,
  20/f), a soft knee, about 2:1 until the range, Auto threshold 4 dB over the trigger's long average),
  Gain-Q interaction (Q × 10^(|gain|/80)), Auto Gain (the curve's power, pink and K-weighted, the side
  counting a quarter), the analyzer's fall rates (12 to 160 dB/s), collisions, EQ Match's fit, the band
  colours past 1 green, 2 blue, 5 violet.
- **Its presets are ours**, by what they're for (Kick Punch, Vocal Presence, De-Ess, Mastering Clean-Up...),
  with Pro-Q's Default Setting and Flat 7 Bands.
- **Defaults**: Zero Latency, Medium resolution, analyzer Pre+Post at High resolution, 90 dB, Medium speed,
  tilt 4.5 dB/oct, Spectrum Grab and collisions on, display ±12 dB.

## Where Vaudio differs

| What | Pro-Q 3 | Vaudio |
| --- | --- | --- |
| External side chain for dynamic bands | Yes, a band's switch, only with a custom threshold; the side chain not band-limited or M/S encoded | The same (`EqBand.external`, the band's SC switch by its threshold): it hears its slot's key, chosen in the Mixer slot's Sidechain input (`docs/sidechain.md`) |
| L/R and M/S bands in Linear Phase | Two stages, twice the latency | One stage (the whole 2×2 response in one kernel): the latency isn't doubled |
| Dynamic bands in Linear Phase | The kernel made again each block (up to High) | A delta kernel per dynamic band, mixed in per sample (up to High, as Pro-Q): the same latency, less CPU |
| Automating a band in Linear Phase | Glides | Heard when the song's next sent (an edit); automation is heard in Zero Latency and Natural Phase |
| Zero Latency near Nyquist | "A small deviation above 18 kHz" | The same kind (matched biquads); within 0.1 dB of analog for bands under fs/9, within 0.5 dB above (tested) |
| MIDI Learn | Yes | No (the app has no MIDI input yet); every band control can be automated instead |
| Surround, Dolby Atmos | Yes | Stereo only |
| Presets: save your own, folders on disk | Yes | Factory presets only; Copy / A/B and the app's undo |
| Interface sizes, full screen | Mini to Extra Large, full screen | The window resizes freely and fills the desktop (double-click its title) |
| Help menu, interactive hints | Yes | Tooltips |
| The band panel's shape | A slab with a hump over Gain | A rounded panel |
| Spectrum Grab's long press | Turns the highlight blue | Holds it until the background is clicked, with no colour change |
| EQ Match's reference | Side chain, another instance, a recorded or saved spectrum | Another Pro-Q's sound (what comes out of it) |

## How it's built

- **The document**: `MixerEffect.proQ` (`shared/music/types.ts`) on an effect whose plugin is
  `PRO_Q_PLUGIN` (`vaudio:pro-q`): `ProQState` (bands, mode, resolution, Gain Scale, output, pan, phase,
  Auto Gain, Gain-Q) plus the other A/B state, the analyzer and the display range. A band's `id` is its
  number (1..24), never reused while it's there, so its colour and its automation stay with it.
  Validated in `normalizeProQ` (`project.ts`); constants, ranges and presets in `pro-q-presets.ts`; edits
  (`addBand`, `dragBands`: gains scaled together, `splitBands`, `invertGain`, `makeDynamic`, A/B, presets)
  and `engineProQ` (what the engine plays, Auto Gain in the output) in `pro-q.ts`. All tested.
- **The filters** (`shared/music/pro-q-filters.ts`): each shape as analog sections in FabFilter's
  conventions (`bandSections`), their response, the curves the display draws, `playedBand` (Gain Scale,
  Gain-Q), `autoGain`. Tested against the conventions (bandwidths, half-gain points at every slope, a
  cut's gain at its frequency, the Brickwall's cliff, Flat Tilt's straightness).
- **The engine** (`engine/src/`): `EqDesign` builds the same sections in C++ (keep the two in step) and
  matches each to a digital biquad (impulse-invariant poles; Vicanek's peaking fit for a 2-pole Bell,
  matched high and low passes, zeros on the unit circle for notches and the elliptic filter, a least-
  squares numerator otherwise, cuts designed as the inverse of their boost), run as state-variable filters
  whose coefficients glide per sample (`Svf`). `ProQ` runs a song's Pro-Q: each band smoothed (20 ms),
  faded in and out when it comes and goes, crossfaded when its shape changes; left/right and stereo bands,
  then mid/side ones; dynamics; Natural Phase's correction FIR (`Ha · Hd⁻¹`, 7.3 ms) and Linear Phase's
  kernels (with dynamic deltas) through `Convolver` (uniformly partitioned, kernels designed off the audio
  thread, handed over by atomic exchange and crossfaded); solo; the output; the analyzer's rings
  (`Spectrum`: Hann FFT, peaks read between bins). Its latency goes into delay compensation. States are
  kept across songs by effect id (`eq::Registry`; the export has its own). `eqWatch` says which to measure,
  `eqSolo` solos a band; the transport events (and an offline render's answer) carry `eq`. Tested offline
  against the tab's curves: `server/music/pro-q.integration.test.ts`.
- **The window** (`src/suites/music/pro-q/`): `pro-q-window.tsx` (top bar, bottom bar, panels),
  `display.tsx` (the canvas, drawn every frame something moves, and what floats on it), `draw.ts`
  (drawing; the analyzer's fall), `geometry.ts` (its maths), `pointer.ts` (every gesture),
  `band-controls.tsx`, `parameter-display.tsx`, `band-menu.tsx`, `knob.tsx` (Pro-Q's knob, the dynamic
  ring), `piano.tsx`, `peaks.ts` (Spectrum Grab), `match.ts` and `match-panel.tsx` (EQ Match and
  collisions), `actions.ts`, `store.ts` (open windows, selection, zoom, solo, grab, match),
  `tool-edits.ts` (the assistant's `get_pro_q`, `set_pro_q_bands`, `update_pro_q`; `add_mixer_effect`
  takes "Pro-Q", `add_automation` its "eq frequency", "eq gain", "eq q", "eq range", "eq output", "eq pan", "eq gain scale").
  Its output's pan and Gain Scale automate too; Gain Scale has no lane of its own in the engine: it's folded
  into each band's gain and range lanes.
