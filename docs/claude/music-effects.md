# The music suite's built-in effects

Ours, not plugins: each a `MixerEffect` with its settings in the song, its DSP native in `engine/src/`, its window in
`src/suites/music/<effect>/`. Read the music suite's guide (`docs/claude/music.md`) first.

- **Gross Beat** (`docs/fl-studio/gross-beat.md`; `shared/music/gross-beat*.ts`, `engine/src/GrossBeat.cpp`,
  `src/suites/music/gross-beat/`): FL's time and volume effect, ours, not a plugin: a `MixerEffect` whose
  plugin is `GROSS_BEAT_PLUGIN`, its settings **in the song** (`MixerEffect.grossBeat`: undone, read and drawn
  by the assistant), its slots that differ from their presets only. Its envelopes are automation points
  over a bar (time: 1 is now, 0 eight beats back), compiled to straight lines for the engine, which runs it
  natively in its slot with the song's position (`gross::Clock`, given by `Sequencer` each block), a buffer
  kept across songs by effect id (`gross::Registry`; the export makes its own). Its slots and two knobs
  automate (`AutomationTarget` `grossBeat`); HOLD and the scratching clock are live (`grossBeat` command),
  not the song's. Its window is `gross-beat-window.tsx`; keep its sound tested offline
  (`gross-beat.integration.test.ts`).
- **EchoBoy** (`docs/soundtoys/echoboy-manual.md`, its DSP in `echoboy-dsp.md`; `shared/music/echo-boy*.ts`,
  `engine/src/EchoBoy.cpp`, `src/suites/music/echo-boy/`): Soundtoys' echo, ours, as Gross Beat is: a
  `MixerEffect` whose plugin is `ECHO_BOY_PLUGIN`, its settings in the song (`MixerEffect.echoBoy`). Its
  modes are decided in TypeScript (`engineEchoBoy`): delay lines, a feedback matrix between them and Rhythm
  Echo's taps; the engine knows no mode. A style is the Style Editor's settings (`EchoStyle`, null in the
  song while it's as made); what makes the repeats change is in the loop (the Decay EQ, the record stage's
  saturation, the cuts, loop diffusion and wobble). The lines are kept across songs by effect id
  (`echo::Registry`), so edits don't cut the echoes off; Time glides, note values crossfade. Its knobs
  automate (`AutomationTarget` `echoBoy`; lanes `kind: "echo"` in the engine's units). Keep its sound tested
  offline (`echo-boy.integration.test.ts`).
- **Auto-Tune** (`docs/antares/auto-tune.md`, Antares Auto-Tune Pro's Auto mode; `shared/music/auto-tune*.ts`,
  `engine/src/AutoTune.cpp`, `src/suites/music/auto-tune/`): ours as Gross Beat is, `AUTO_TUNE_PLUGIN`, its
  settings in the song (`MixerEffect.autoTune`). What its knobs mean (Tracking as YIN's threshold, Natural
  Vibrato's dB, the input type's Hz) is decided in `engineAutoTune`; the engine hears the pitch, decides the
  note per ~2.7 ms frame and moves it by TD-PSOLA with sub-sample marks (whole samples drift cents), the
  grains stretched for Throat (or with the pitch, Formant off). It looks ahead by a latency fixed by the input
  type, reported to `Song::compensate` (an enabled one only); its mix's dry sound is read as late. Its state
  is kept by effect id (`tune::Registry`). It says its latest pitch readings in each transport event
  (`EngineTransport.autoTunes`), which `pitch-history.ts` keeps outside React for the window's graph. Every
  knob automates, the key and Create Vibrato's too (`AutomationTarget` `autoTune`, `AUTO_TUNE_CONTROL_INFO`,
  lanes `kind: "tune"`). Keep its sound tested offline to the
  cent (`auto-tune.integration.test.ts`).
- **Pro-Q** (`docs/fabfilter/pro-q.md`, and FabFilter's `pro-q-3-manual.md` and `pro-q-3-dsp.md` beside
  it): FabFilter's Pro-Q 3, ours, as Gross Beat is: a `MixerEffect` whose plugin is `PRO_Q_PLUGIN`, its
  settings **in the song** (`MixerEffect.proQ`: bands numbered 1..24, never renumbered; A/B; the
  analyzer's settings), in FabFilter's conventions (Q is the textbook Q × √2, slope is the order). Its
  shapes are analog sections twice, `bandSections` in TypeScript (what the display draws) and
  `analogSections` in `EqDesign.cpp`: **keep them in step**; `pro-q.integration.test.ts` measures the
  engine against the TypeScript curves in every mode (Zero Latency within 0.1 dB, Natural and Linear Phase
  exact). The engine designs FIR kernels on the message thread (only when the bands change) and hands
  them to the audio thread by atomic exchange (`Convolver::offer`); keep it so. Its latency is in delay
  compensation. The analyzer is measured only for the Pro-Qs `eqWatch` names (open windows); its fall,
  tilt and range are the tab's. Its window's look is its own (`--eq-*` tokens, dark in every theme).
  Its band controls, output, pan and Gain Scale automate (Gain Scale folded into the bands' gain lanes).
- **OTT** (`docs/xfer/ott.md`; `shared/music/ott*.ts`, `engine/src/Ott.cpp`, `src/suites/music/ott/`): Xfer's
  multiband upward/downward compressor, ours, as Gross Beat is: `OTT_PLUGIN`, its settings in the song
  (`MixerEffect.ott`). Its sound is David Braun's measured model of OTT 1.3.1 (`co.xfer_ott`): what its
  knobs mean is decided in TypeScript (`engineOtt`: each band's makeup, slopes, knees, release) and the
  engine runs the law (`ottGainDb`) after LR4 crossovers at 88.3 Hz and 2.5 kHz; **keep the law in step**
  in both, `ott.integration.test.ts` measures the engine against it (within 0.25 dB). Every knob and band
  threshold automates (`AutomationTarget` `ott`, `OTT_CONTROL_SPECS`, lanes `kind: "ott"` per `OTT_LANES`,
  as EchoBoy's). Its state is kept by effect id (`ott::Registry`); its bands' levels come in each transport
  event (`EngineTransport.otts`) for its display. Its display's colours are `--ott-*` (a screen in every theme).
- **Pro-C** (`docs/fabfilter/pro-c.md`, its vocal research `pro-c-vocals.md`; `shared/music/pro-c*.ts`,
  `engine/src/ProC.cpp` + `CompDsp.h`, `src/suites/music/pro-c/`): FabFilter's Pro-C 3 compressor, ours, as
  Gross Beat is (`PRO_C_PLUGIN`, `MixerEffect.proC`, in the song), with 21 styles: Pro-C 3's, **Vox** (RVox's
  one fader) and a **Vintage** group after the units vocal engineers name (FET 76, Opto 2A, Opto Tube,
  Distress, VCA 160, Diode 609), a Vintage style's Threshold being its Input's negative. **The engine knows
  no style**: `engineProC` turns each into blocks and numbers (a curve kind, feedforward or a feedback loop
  and its gain, a ballistics shape, an opto cell, a colour...), and `ProC.cpp` runs them per sample. Its
  curves (`kneeOver`, `progressiveOver`, `limitRange`, `curveReduction`, `feedbackLaw`) are in both
  `pro-c.ts` and `CompDsp.h`: **keep them in step**; the knee display draws `staticCurve` and
  `pro-c.integration.test.ts` holds the engine to it (0.1 dB) and to the units' behaviour. A feedback
  style's loop is solved each sample (stable at any attack, no oversampling needed); opto styles run
  feedforward (a cell in a high-gain loop would ring). Its External trigger hears its slot's key (see
  Sidechains); Host Sync pulses on `gross::Clock`. Its latency is Maximum
  Lookahead plus the oversampling filters', reported to delay compensation, its slot mix against the
  input held back as long. Its display's points and levels come in each transport event
  (`EngineTransport.proCs`, drained by the event, not the status); `compAudition` and `compMatch` are live.
  Its knobs automate (`AutomationTarget` `proC`, lanes `kind: "comp"` per `PRO_C_LANES`). Its look is `--comp-*`.
- **YT-L** (`docs/fabfilter/pro-l.md`, its research and measurements `pro-l-research.md`; `shared/music/pro-l*.ts`,
  `engine/src/ProL.cpp` + `Lookahead.h`, `TruePeak.h`, `Clipper.h`, `Loudness.h`, `Dither.h`, `src/suites/music/pro-l/`):
  FabFilter's Pro-L 2, ours, as Gross Beat is (`PRO_L_PLUGIN`, `MixerEffect.proL`, in the song): nine styles, a clip
  stage (FL's Fruity Soft Clipper's curve among its shapes, before or after the limiter), mid/side side first, true
  peak limiting, a BS.1770 loudness meter and dither. **The engine knows no style**: `engineProL` turns each into
  numbers (`PRO_L_STYLE_SPECS`). Its main stage alone guarantees the ceiling (a hold-min, then a box-stack ramp no
  longer than the look-ahead: `Lookahead.h`); the bass and release stages only lower the gain, so loudness always rises
  with Gain, and Auto Hold (half the bass's period) keeps a bass note undistorted: keep both so.
  `pro-l.integration.test.ts` holds the engine to its ceiling by sample, by BS.1770's meter and by an ideal
  reconstruction, its meter to EBU Tech 3341 and 3342, its dither to Pro-L 2's measured curves. Its readings and
  its display's columns come in each transport event (`EngineTransport.limiters`, drained by the event:
  `pro-l/history.ts`); the meter's reset and pause are the live `proL` command (Auto-Reset as play starts). Its
  knobs automate but Lookahead, which moves its latency (`AutomationTarget` `proL`, lanes `kind: "limiter"`). Its
  presets' delivery settings (Output, True Peak, dither) stay under Lock Output. Its look is `--lim-*`.
- **PanMan** (`docs/soundtoys/panman.md`; `shared/music/panman*.ts`, `engine/src/PanMan.cpp`,
  `src/suites/music/panman/`): Soundtoys' auto-panner, ours, built as Gross Beat is (when in doubt about it,
  do what Soundtoys' does: the doc is from its manual). `MixerEffect.panMan` on an effect whose plugin is
  `PANMAN_PLUGIN`, in the song. The pattern modes (LFO, Rhythm Step, Rhythm Shape: Smoothing, Feel and Groove
  included) are decided in TypeScript (`panPattern`) and sent as lines over the pattern's phase; Random's
  chance (repeatable, seeded by the effect's id), the triggers, the dynamics, the pan law (sine / cosine to
  ±105°, unity at the centre) and the Analog Styles are the engine's (`panman::State`, kept by effect id in
  `panman::Registry`), in time with `gross::Clock`. Every knob automates (`AutomationTarget` `panMan`;
  values travel scaled, `PAN_LANE_SCALE`: lanes hold values within ±64; Feel, Groove and the pattern
  modes' Smoothing as the pattern itself, a `shape` lane). The Manual Trigger is live (`panMan` command). Keep its sound tested offline
  (`panman.integration.test.ts`).
- **Pitch Wheel** (`docs/quikquak/pitchwheel.md`, QuikQuak Pitchwheel; `shared/music/pitch-wheel*.ts`,
  `engine/src/PitchWheel.cpp`, `src/suites/music/pitch-wheel/`): ours as Gross Beat is, `PITCH_WHEEL_PLUGIN`,
  its settings in the song (`MixerEffect.pitchWheel`). Each wheel's pointer is a target the pitch heard
  follows by physics (Smooth, then a spring: Gravity, Inertia), defined in `wheelPhysics`/`stepWheel` and
  mirrored in the engine's `Physics` (change both; an integration test compares them); the window runs the
  same physics when the engine is silent (it only reports while sound goes through). The engine shifts in
  the frequency domain, Laroche and Dolson's way (see the doc), one phase decision for both sides; a frame
  reads each voice's pitch history, so moves are sample-accurate. A channel's notes play it
  (`notesFrom`: the engine's `Song::wheelListeners`, fed by the sequencer's `scheduleRange` on their
  sample); the window's keyboard and the hand's drags are `pitchWheel` commands (a drag holds the wheel for a
  quarter-second, renewed, ahead of the song). It reports `EngineTransport.pitchWheels`, kept outside React
  by `pitch-wheel/live.ts`. Eight controls automate (`AutomationTarget` `pitchWheel`, lanes `kind:
  "wheel"`). Keep its sound tested offline (`pitch-wheel.integration.test.ts`).
- **Reverb** (`docs/reverb/reverb.md`, its research `reverb-vocals.md`; `shared/music/reverb*.ts`,
  `engine/src/Reverb*.cpp`, `src/suites/music/reverb/`): ours, for vocals first, as Gross Beat is
  (`REVERB_PLUGIN`, `MixerEffect.reverb`, in the song): six modes (`REVERB_MODE_SPECS`: Dattorro's plate,
  Smooth Plate's sixteen lines, the rooms' and hall's FDNs, as data) and three eras. **What each band's decay
  is is decided in TypeScript** (`reverbT60`: Decay, the mode's natural curve, the Decay EQ, the era) and so
  are the network, its taps, the early energy's velvet taps and each line's feed (`engineReverb`); the engine
  designs each line's absorption from the T60s (`Settings::design`: Jot's two stages, every element losing
  the same dB a second) and runs it. Nothing it does may click: a new absorption glides in (30 ms), a new
  tone corrector crossfades, Size jumps and new modes go to the second network, which takes the input over
  in 20 ms while the old one rings out at its own level, early layouts and the pre-delay crossfade; keep it so
  (`reverb.integration.test.ts` test 16 listens above 5 kHz under a held tone while Decay, Pre-delay and Size
  are automated). Freeze and ∞ hold the loop's energy with a proportional keeper (an integrating one swings).
  Its state is kept by effect id (`verb::Registry`), so edits don't cut the tail. Its Duck key is its slot's
  (`MixerEffect.sidechain`, after the source's fader: `setReverbKey`). Its modes are level-matched by `calibration` and its
  presets by `PRESET_LEVELS`, both measured (test 23 says by how much they're off); measure them again
  after a change to a network. Every knob automates (`AutomationTarget` `reverb`, `REVERB_CONTROL_SPECS`, lanes `kind:
  "verb"` per `REVERB_LANES`). Its displays' measurements come in each transport event (`EngineTransport.reverbs`,
  for the windows `verbWatch` names); Freeze held, Kill and the audition click are live (`verb`). Its look is
  `--verb-*`.
