# Serum 2 presets: the file format and the preset spec

A tool that writes Serum 2 presets (`.SerumPreset`) from a readable JSON spec, and reads any preset (or Serum 2's
own plugin state) back into one, so that a person or an LLM can design presets. Everything here was checked
against the real Serum 2 (2.1.5), hosted silently in the audio engine (`--offline`: no device, no window).

- Code: `server/music/serum/` (pure, tested without Serum): `cbor.ts` (Serum's CBOR), `container.ts` (Xfer's
  container), `plugin-state.ts` (Serum's VST3 state), `catalogue.ts` (Serum's names, asked of Serum), `units.ts`,
  `fields.ts` (the spec's fields), `destinations.ts` (mod matrix names), `body.ts` (settings ⇄ spec), `preset.ts`
  (files ⇄ spec), `spec.ts` (the spec's types), `template.ts` (Serum's init patch).
- CLI: `scripts/serum-preset.ts` (`read`, `write`, `verify`); `scripts/serum-readout.ts` runs Serum in the engine.
- `scripts/serum-audition.ts` renders a round of presets, each playing its phrase over a beat, as an HTML page to
  score (the workflow is the `serum-presets` skill, `.claude/skills/serum-presets/SKILL.md`).

```bash
pnpm tsx scripts/serum-preset.ts read "Some Preset.SerumPreset" --out spec.json   # or a Serum 2 state (.bin)
pnpm tsx scripts/serum-preset.ts write spec.json --out "My Preset.SerumPreset"
EDITOR_ENGINE_PATH=… pnpm tsx scripts/serum-preset.ts verify --roundtrip <presets…> --specs <specs…> \
  --reference "A preset Serum saved.SerumPreset" --out <dir>
```

## The file

```
"XferJson\0"   u64 LE: JSON length   JSON metadata   u32 LE: settings size   u32 LE: 2   zstd(CBOR settings)
```

- **Metadata** (JSON, as nlohmann::json writes it: compact, keys sorted, whole numbers as `4.0`, UTF-8 as is):
  `fileType` ("SerumPreset"), `hash` (MD5 hex of the zstd bytes), `presetAuthor`, `presetDescription`,
  `presetName`, `product` ("Serum2"), `productVersion`, `tags`, `url`, `vendor` ("Xfer Records"), `version`. Every
  value but the hash repeats one in the settings.
- **zstd**: one frame with its content size, single segment, no checksum (what Node's `zstdCompressSync` makes).
- **Settings** (CBOR): a map of modules, keys sorted by their UTF-8 bytes. A float is a 32-bit float when the double
  is exactly one, else 64-bit (never 16); a number is an integer only under these keys: `activeClip(s)`,
  `baseNote`, `boundary64`, `busID`, `ccNum`, `channel`, `destModuleID`, `destModuleParamID`, `edgeFadeMs`, `fxID`,
  `gridDivision`, `interpolateAfterLoad`, `lfoID`, `lfoType`, `loopback64`, `loopbackPointNum`, `mpeConfig`,
  `mpePitchBendRange`, `noteNum`, `numChannels`, `numFrames`, `numPoints`, `paramIDs`, `paramIndex`, `pointID`,
  `sampleRate`, `scale`, `source`, `subType`, `target`, `type`, `types`. Measured on 118 presets (20 million floats,
  no exception); re-encoding all 118 gives their bytes back exactly. No map value is ever `null`. (`fxID` and
  `paramIndex` are the controller's effect knob links, `player.md` §2.1, never in a preset.)
- **Modules**: `Oscillator0..4` (A, B, C, noise, sub), each holding every type's module (`WTOsc0`, `SampleOsc0`,
  `MultiSampleOsc0`, `GranularOsc0`, `SpectralOsc0`; `NoiseOsc3`; `SubOsc4`), `VoiceFilter0/1`, `Env0..3`,
  `LFO0..9`, `ModSlot0..63`, `Macro0..7`, `FXRack0..2` (main, bus 1, bus 2: `FX` is a list of
  `{FX<Effect>: {plainParams…}, type}`), `RoutingSlot0..6` (A, B, C, noise, sub, filter 1, filter 2), `Global0`,
  `VoicePanel0`, `Arp0`, `ArpClip0..11`, `MidiClip0..11`, `ClipPlayer0`, `LFOPointModBus0..15`,
  `PitchQuantizer0`, `RetriggerState0`, then the editor's view settings (`SerumGUI`, `Osc`, `WTOsc`…) and the
  metadata. A module's parameters are `plainParams`: only those not at their default, and `"default"` when none
  is (a plugin state writes `{}`).
- **`version`** is the settings' format, and it matters: Serum converts older settings when it loads them (a
  2.0.11 preset at version 4 loads with "Sustain" same-note polyphony and compatibility flags; the same settings
  labelled 11 don't). A preset read keeps its own; new presets are written as version 11, "2.1.5", the Serum whose
  init patch they start from (`template.ts`).
- **Serum's processor and controller** keep separate states. The processor has the sound (everything above);
  the controller has the macro names, the effect racks' names, an LFO shape's name and the preset's name, in a
  format of its own. A `.SerumPreset` carries both in one body; the engine loads presets as processor state (the
  settings, plus `component`, `modMatrixLocked` and `scalarCurvesLocked` from Serum's own state: without them
  Serum ignores the state), so names can't be seen there (see "What isn't verified").

## The spec

```json
{
  "name": "Soft Lead",
  "tags": ["Lead", "Mono"],
  "global": { "volume": 60, "mono": true, "legato": true, "portamento": 60 },
  "oscillators": {
    "A": { "wavetable": "Analog/Basic Shapes.wav", "position": 86, "level": 80,
           "unison": { "voices": 3, "detune": 0.08, "blend": 60 }, "warp": { "mode": "kBendPos", "amount": 20 } },
    "sub": { "enabled": true, "level": 35, "octave": -1, "shape": "kTriangle" }
  },
  "filters": { "1": { "enabled": true, "type": "MG Low 24", "cutoff": 2400, "resonance": 18 } },
  "envelopes": { "1": { "attack": 25, "decay": 600, "sustain": 85, "release": 280 } },
  "lfos": { "1": { "sync": false, "rate": 5.5 }, "2": { "rate": "1/8.", "shape": { "points": [[0, 1], [0.5, 0, 0.3], [1, 1]] } } },
  "modulation": [
    { "source": "Env 2", "to": "Filter 1 Freq", "amount": 30 },
    { "source": "LFO 1", "aux": "Mod Wheel", "to": "A Fine", "amount": 15, "bipolar": true },
    { "source": "Macro 1", "to": "Main FX 2 Wet", "amount": 50 }
  ],
  "macros": { "1": { "name": "SPACE", "value": 0 } },
  "fx": { "main": [{ "effect": "chorus", "wet": 30 }, { "effect": "reverb", "type": "kHall", "wet": 22, "size": 55 }] }
}
```

Only `name` is required: what isn't said is Serum's init patch. Numbered sections are keyed `"1"`… (filters 1–2,
envelopes 1–4, LFOs 1–10, macros 1–8). Unknown keys, out-of-range values and unknown options are refused, every
problem listed with what would do (`SpecError`). Examples: `data/serum-research/generated/specs/`; real presets
read back: `generated/read-examples/`.

### Fields

Units are what Serum's knobs show, unless said. Ranges are Serum's (it clamps past them; every limit was read back
from Serum). Defaults are Serum's init patch.

| Where | Field | Unit and range | Default | Stored as |
| --- | --- | --- | --- | --- |
| `global` | `volume` | % of the knob, 0–100 (Serum also shows 20·log10((v/100)²)+3 dB) | 50 | `Global0.kParamMasterVolume` = (v/100)² |
| | `polyphony` | voices, 1–32 | 8 | `kParamPolyCount` |
| | `mono`, `legato`, `portaAlways`, `portaScaled` | true/false | false | `kParamMonoToggle`… (1/0) |
| | `portamento` | ms, 0–8000 | 0 | `kParamPortamentoTime`, seconds |
| | `portamentoCurve` | −100–100 | 0 | |
| | `bendUp`, `bendDown` | semitones, ±24 | 2, −2 | `kParamBendRangeUp/Dn` |
| | `transpose` | semitones, ±24 | 0 | |
| | `modWheel` | 0–100 | 0 | |
| | `swing` | %, 12.5–87.5 | 50 (off) | |
| | `directVolume`, `bus1Volume`, `bus2Volume` | % of the knob, 0–100 (50 is 0 dB) | 50 | 2·(v/100)² |
| `oscillators.A/B/C` | `enabled` | true/false | A on, B and C off | `OscillatorN.kParamEnable` |
| | `type` | `wavetable`, `sample`, `multisample`, `granular`, `spectral` | wavetable | `kParamType` (`kOsc_Sample`…; nothing for wavetable) |
| | `wavetable` | path in Serum's `Tables` folder ("S2 Tables/Default Shapes.wav", "Analog/Basic Shapes.wav") | Default Shapes | `WTOscN.relativePathToWT` |
| | `wavetableName` | text | the file's | `tableDisplayName` |
| | `sample` | path in `Samples` (sample, granular, spectral) | | `samplePathRelative` |
| | `multisample` | path in `Multisamples` (an .sfz) | | `sfzPathRelative` |
| | `level` | % of the knob, 0–100 (Serum shows 20·log10((v/100)²) dB) | 75 | (v/100)² |
| | `pan` | −50 (left) – 50 | 0 | |
| | `octave` | −4–4, whole | 0 | |
| | `semi` | semitones, ±12 (a harmonic with `pitchMode` "Harmonics") | 0 | `kParamPitch` |
| | `fine` | cents, ±100 | 0 | |
| | `coarse` | semitones, ±64 | | `kParamCoarsePit` |
| | `pitchTrack` | true/false | true | |
| | `unison.voices` | 1–16 | 1 | `kParamUnison` |
| | `unison.detune` | 0–1, as shown | 0.25 | `kParamDetune` |
| | `unison.blend` | %, 0–100 | 75 | `kParamDetuneWid` |
| | `unison.width` | %, −100–100 | 100 | `kParamUnisonStereo` |
| | `unison.stack`, `unison.mode` | options below | off, linear | `kParamUnisonStack`, `kParamDetuneMode` |
| | `unison.range`, `unison.span`, `unison.randomStart` | 0–48 st, ±100, 0–100 | | |
| | `unison.wtPos` | ±100 (wavetables) | 0 | `WTOsc.kParamUnisonWTPos` |
| | `position` | 1–256 across the table (Serum shows frame round(1 + (v−1)/255·(frames−1))) | 1 | `WTOsc.kParamTablePos` |
| | `warp`, `warp2` | `{ mode, amount, var }`: an option below, % of the knob 0–100, 0–1 | off | `kParamWarpMenu`, `kParamWarp` (v/100), `kParamWarpVar` (and …2) |
| | `phase`, `randomPhase` | degrees 0–360, % 0–100 (wavetables) | 180, 100 | `kParamInitialPhase`, `kParamRandomPhase` |
| | `start`, `end`, `loop.{mode,start,end,crossfade}`, `scanRate` | % (scan rate ±200) | 0, 100, one-shot | |
| | `pitchMode` | option below | semitones | |
| `oscillators.noise` | `enabled`, `level` (default 25), `pan`, `pitchTrack` (default off) | as above | | `Oscillator3` |
| | `pitch` | %, 0–100 (Serum shows (v−50)·1.28 st with pitch track) | 50 | `NoiseOsc3.kParamColor` = v/100 |
| | `fine` (±1), `phase`, `randomPhase` (%), `oneShot`, `type` | | | |
| | `sample` | path in `Samples/Factory Non-Tonal/Noises` | "Organics/AC hum1.wav" | `relativePathToNoiseSample` |
| `oscillators.sub` | `enabled`, `level`, `pan`, `octave`, `coarse`, `pitchTrack` | as above | off, 75 | `Oscillator4` |
| | `shape` | option below | sine | `SubOsc4.kParamShape` |
| | `phase` | degrees | 0 | |
| `filters.1/2` | `enabled` | true/false | off | `VoiceFilterN` |
| | `type` | option below, or what Serum shows ("MG Low 24") | MgL12 | |
| | `cutoff` | Hz, 8.18–22094 | 425 | `kParamFreq` = (69 + 12·log2(Hz/440)) / 136.8 |
| | `resonance`, `drive`, `var`, `mix`, `stereo` | %, 0–100 | 10, 0, 0, 100, 50 | `kParamReso`, `kParamDrive`, `kParamVar`, `kParamWet`, `kParamStereo` |
| | `level` | dB, up to +12.04 | 0 | 10^(v/40)/2 |
| `routing.A/B/C/noise/sub/filter1/filter2` | `to` | `filter`, `master`, `direct`, `none` | (see below) | `RoutingSlotN.kParamRoutingDest` (`kRoutingDestFilter`…) |
| | `filterBalance` | −100 (filter 1) – 100 (filter 2) | −100 | |
| | `bus1`, `bus2` | send %, 0–100 | 0 | `kParamFXBus1Level`… |
| `envelopes.1–4` | `attack`, `hold`, `decay`, `release` | ms, 0–32000 | 1 (Env 1) or 0.5, 0, 1000, 15 | seconds |
| | `sustain` | % of the knob, 0–100: Serum shows the gain (v/100)², Env 1 as 40·log10(v/100) dB, the others as % | 100 | v/100 |
| | `attackCurve`, `decayCurve`, `releaseCurve` | 0–100 | 50, 66.6, 66.6 | `kParamCurve1/2/3` |
| `lfos.1–10` | `rate` | synced: a division (below); free: Hz 0–100 (×10 with `rate10x`) | 1/4 | `kParamRate` |
| | `sync`, `dotted`, `triplets`, `rate10x`, `mono` | true/false | synced | |
| | `mode`, `type` | options below | restarts per note, drawn | |
| | `smooth` (%), `rise`, `delay` (0–4: seconds free, a fraction of bars synced), `phase` (degrees) | | 0 | |
| | `shape` | `{ points: [[x, y] or [x, y, curve], …], name?, loopback? }`: two or more points, x from 0 rising to 1, all 0–1, curve 0.5 straight. **y is measured from the top**: 0 is the top of Serum's editor (the LFO's full value), 1 the bottom (none); draw shapes that **end at their start's height** (Serum's default triangle is `[[0,1],[0.5,0],[1,1]]`) | Serum's default | `curveData` (`numPoints` = points − 1) |
| `modulation[]` | `source`, `aux` | sources below (or their numbers) | | `source: [main, aux]` |
| | `to` | a destination (below) | | `destModule…` |
| | `amount` | % of the destination's range, ±100 | 0 | `kParamAmount` |
| | `out` (%), `bipolar`, `auxInverted`, `bypass`, `slot` (1–64; else the next free), `curve` (as stored) | | | |
| `macros.1–8` | `name`, `value` (0–100) | | 0 | `MacroN.name`, `kParamValue` |
| `fx.main/bus1/bus2[]` | `effect`, then its parameters | below | | `FXRackN.FX` |

Every section also takes `params`: the module's other parameters by Serum's names (kParam…) with values as
stored; an oscillator, noise and sub also take `typeParams`, for their type's module (e.g.
`{"kParamDensity": 40}` on a granular oscillator). Serum's names for every module are in `catalogue.ts`
(`MODULE_PARAMS`).

**Synced LFO divisions**: `32 bar` … `bar`, `1/2`, `1/4`, `1/8`, `1/16`, `1/32`, `1/64`, `1/128`, `1/256`; dotted
`24 bar`, `12 bar`, `6 bar`, `3 bar`, `1.5 bar`, `1/2.` … `1/512.`; triplets `32 bar t` … `1/256 t`. A dotted or
triplet division turns `dotted`/`triplets` on unless they're given as false (an error then).

**Routing defaults** aren't stored: Serum writes only a change. The presets studied write `filter` for B, C, noise
and sub and only `master`/`none` for A, so A's default seems to be the filter and the others' something else.

### Options

Serum's own names (what its control shows, in brackets, where it has one; a filter type or warp may be given as
that). Listed by index, from Serum: an index written as a number is saved back by Serum as the option's name.

- **Filter types (`filters.N.type`; the effect filter's `type` takes the same)**: `MgL6` (MG Low 6), `MgL12` (MG Low 12, the default), `MgL18` (MG Low 18), `MgL24` (MG Low 24), `L6` (Low 6), `L12` (Low 12), `L18` (Low 18), `L24` (Low 24), `H6` (High 6), `H12` (High 12), `H18` (High 18), `H24` (High 24), `B12` (Band 12), `B24` (Band 24), `P12` (Peak 12), `P24` (Peak 24), `N12` (Notch 12), `N24` (Notch 24), `LH6` (LH 6), `LH12` (LH 12), `LB12` (LB 12), `LP12` (LP 12), `LN12` (LN 12), `HB12` (HB 12), `HP12` (HP 12), `HN12` (HN 12), `BP12` (BP 12), `BN12` (BN 12), `PP12` (PP 12), `PN12` (PN 12), `NN12` (NN 12), `LBH12` (L/B/H 12), `LBH24` (L/B/H 24), `LPH12` (L/P/H 12), `LPH24` (L/P/H 24), `LNH12` (L/N/H 12), `LNH24` (L/N/H 24), `BPN12` (B/P/N 12), `BPN24` (B/P/N 24), `CombP` (Cmb +), `CombN` (Cmb -), `CombL6P` (Cmb L6+), `CombL6N` (Cmb L6-), `CombH6P` (Cmb H6+), `CombH6N` (Cmb H6-), `CombHL6P` (Cmb HL6+), `CombHL6N` (Cmb HL6-), `FlangeP` (Flg +), `FlangeN` (Flg -), `FlangeL6P` (Flg L6+), `FlangeL6N` (Flg L6-), `FlangeH6P` (Flg H6+), `FlangeH6N` (Flg H6-), `FlangeHL6P` (Flg HL6+), `FlangeHL6N` (Flg HL6-), `Phase12P` (Phs 12+), `Phase12N` (Phs 12-), `Phase24P` (Phs 24+), `Phase24N` (Phs 24-), `Phase36P` (Phs 36+), `Phase36N` (Phs 36-), `Phase48P` (Phs 48+), `Phase48N` (Phs 48-), `Phase48L6P` (Phs 48L6+), `Phase48L6N` (Phs 48L6-), `Phase48H6P` (Phs 48H6+), `Phase48H6N` (Phs 48H6-), `Phase48HL6P` (Phs 48HL6+), `Phase48HL6N` (Phs 48HL6-), `FlangePhase12HL6P` (FPhs 12HL6+), `FlangePhase12HL6N` (FPhs 12HL6-), `LEQ6` (Low EQ 6), `LEQ12` (Low EQ 12), `BEQ12` (Band EQ 12), `HEQ6` (High EQ 6), `HEQ12` (High EQ 12), `RM` (Ring Mod), `RMT` (Ring Modx2), `SNH1` (SampHold), `SNH2` (SampHold-), `Combs` (Combs), `Allpasses` (Allpasses), `Reverb1` (Reverb), `Scream` (French LP), `ZDF_A` (German LP), `ADD_BASS` (Add Bass), `FormantONE` (Formant-I), `FormantTWO` (Formant-II), `FormantTWB` (Formant-III), `BandReject` (Bandreject), `DistComb1LP` (Dist.Comb 1 LP), `DistComb1BP` (Dist.Comb 1 BP), `DistComb2LP` (Dist.Comb 2 LP), `DistComb2BP` (Dist.Comb 2 BP), `Scream3LP` (Scream LP), `Scream3BP` (Scream BP), `Wsp` (Wsp), `DJMixer` (DJ Mixer), `Diffuser` (Diffusor), `LadderMg` (MG Ladder), `LadderAcid` (Acid Ladder), `LadderEMS` (EMS Ladder), `DirtyMg` (MG Dirty), `PZ_SVF` (PZ SVF), `Comb2` (Comb 2), `Exp` (Exp MM), `ExpBPF` (Exp BPF), `K35` (K35).
- **Wavetable warps (`warp.mode`, `warp2.mode`; what Serum shows is for oscillator A: `_OSC` and `_OSC2` are the other two oscillators)**: `kNoWarp` (Off, the default), `kSync` (Sync), `kBendPos` (Bend +), `kBendNeg` (Bend -), `kBendPosNeg` (Bend +/-), `kPWM` (PWM), `kASYMPos` (Asym +), `kASYMNeg` (Asym -), `kASYMPosNeg` (Asym +/-), `kFlip` (Flip), `kDLM` (Mirror), `kRemap_1` (Remap 1), `kRemap_2` (Remap 2), `kRemap_3` (Remap 3), `kRemap_4` (Remap 4), `kQuantize` (Quantize), `kEvenOdd` (Odd/Even), `kFilterLPF` (LPF), `kFilterHPF` (HPF), `kDistTube` (Tube), `kDistSoftClip` (Soft Clip), `kDistHardClip` (Hard Clip), `kDistDiode1` (Diode 1), `kDistDiode2` (Diode 2), `kDistLinFold` (Linear Fold), `kDistSinFold` (Sine Fold), `kDistZeroSquare` (Zero-Square), `kDistAsym` (Asym), `kDistRectify` (Rectify), `kDistSineShaper` (Sine Shaper), `kDistStompBox` (Stomp Box), `kDistTapeSat` (Tape Sat.), `kDistSoftSat` (Soft Sat.), `kFM_OSC` (FM (B)), `kFM_OSC2` (FM (C)), `kFM_NOISE` (FM (Noise)), `kFM_SUB` (FM (Sub)), `kFM_FILT1` (FM (Filter 1)), `kFM_FILT2` (FM (Filter 2)), `kFMX_OSC` (FME (B)), `kFMX_OSC2` (FME (C)), `kFMX_NOISE` (FME (Noise)), `kFMX_SUB` (FME (Sub)), `kFMX_FILT1` (FME (Filter 1)), `kFMX_FILT2` (FME (Filter 2)), `kFMP_OSC` (FML (B)), `kFMP_OSC2` (FML (C)), `kFMP_NOISE` (FML (Noise)), `kFMP_SUB` (FML (Sub)), `kFMP_FILT1` (FML (Filter 1)), `kFMP_FILT2` (FML (Filter 2)), `kPD_OSC` (PD (B)), `kPD_OSC2` (PD (C)), `kPD_NOISE` (PD (Noise)), `kPD_SUB` (PD (Sub)), `kPD_FILT1` (PD (Filter 1)), `kPD_FILT2` (PD (Filter 2)), `kSelfPD` (PD (Self)), `kAM_OSC` (AM (B)), `kAM_OSC2` (AM (C)), `kAM_NOISE` (AM (Noise)), `kAM_SUB` (AM (Sub)), `kAM_FILT1` (AM (Filter 1)), `kAM_FILT2` (AM (Filter 2)), `kRM_OSC` (RM (B)), `kRM_OSC2` (RM (C)), `kRM_NOISE` (RM (Noise)), `kRM_SUB` (RM (Sub)), `kRM_FILT1` (RM (Filter 1)), `kRM_FILT2` (RM (Filter 2)).
- **Sample, multisample and granular warps**: `kFilterLPF`, `kFilterHPF`, `kDistTube`, `kDistSoftClip`, `kDistHardClip`, `kDistDiode1`, `kDistDiode2`, `kDistLinFold`, `kDistSinFold`, `kDistZeroSquare`, `kDistAsym`, `kDistRectify`, `kDistSineShaper`, `kDistStompBox`, `kDistTapeSat`, `kDistSoftSat`, `kFM_OSC`, `kFM_OSC2`, `kFM_NOISE`, `kFM_SUB`, `kFM_FILT1`, `kFM_FILT2`, `kFMX_OSC`, `kFMX_OSC2`, `kFMX_NOISE`, `kFMX_SUB`, `kFMX_FILT1`, `kFMX_FILT2`, `kFMP_OSC`, `kFMP_OSC2`, `kFMP_NOISE`, `kFMP_SUB`, `kFMP_FILT1`, `kFMP_FILT2`, `kPD_OSC`, `kPD_OSC2`, `kPD_NOISE`, `kPD_SUB`, `kPD_FILT1`, `kPD_FILT2`, `kSelfPD`, `kAM_OSC`, `kAM_OSC2`, `kAM_NOISE`, `kAM_SUB`, `kAM_FILT1`, `kAM_FILT2`, `kRM_OSC`, `kRM_OSC2`, `kRM_NOISE`, `kRM_SUB`, `kRM_FILT1`, `kRM_FILT2`.
- **Spectral warps**: `kDetune`, `kSmear`, `kSpread`, `kAddharmonics`, `kAddsubharmonics`, `kGate`, `kRobotize`, `kSpectralShift`, `kMirror`, `kPeakFollow`, `kPeakOctaveUp`, `kPeakOctaveDown`, `kPeakHarmUp`, `kPeakHarmDown`, `kPeakHarmSweep`, `kShepardNarrow`, `kShepardFilter`, `kSpectralComb`, `kSpectralPitchShift`, `kSpectralPitchShiftNew`, `kSpectralPhaseTwist`, `kSpectralFormantShift`, `kMask_OSC`, `kMask_OSC2`, `kMask_NOISE`, `kMask_SUB`, `kMask_FILT1`, `kMask_FILT2`, `kVocode_OSC`, `kVocode_OSC2`, `kVocode_NOISE`, `kVocode_SUB`, `kVocode_FILT1`, `kVocode_FILT2`, `kFilterLPF`, `kFilterHPF`, `kDistTube`, `kDistSoftClip`, `kDistHardClip`, `kDistDiode1`, `kDistDiode2`, `kDistLinFold`, `kDistSinFold`, `kDistZeroSquare`, `kDistAsym`, `kDistRectify`, `kDistSineShaper`, `kDistStompBox`, `kDistTapeSat`, `kDistSoftSat`, `kFM_OSC`, `kFM_OSC2`, `kFM_NOISE`, `kFM_SUB`, `kFM_FILT1`, `kFM_FILT2`, `kFMX_OSC`, `kFMX_OSC2`, `kFMX_NOISE`, `kFMX_SUB`, `kFMX_FILT1`, `kFMX_FILT2`, `kFMP_OSC`, `kFMP_OSC2`, `kFMP_NOISE`, `kFMP_SUB`, `kFMP_FILT1`, `kFMP_FILT2`, `kPD_OSC`, `kPD_OSC2`, `kPD_NOISE`, `kPD_SUB`, `kPD_FILT1`, `kPD_FILT2`, `kSelfPD`, `kAM_OSC`, `kAM_OSC2`, `kAM_NOISE`, `kAM_SUB`, `kAM_FILT1`, `kAM_FILT2`, `kRM_OSC`, `kRM_OSC2`, `kRM_NOISE`, `kRM_SUB`, `kRM_FILT1`, `kRM_FILT2`.
- **Unison stack (`unison.stack`)**: `kOctave1` (12 (1x)), `kOctave2` (12 (2x)), `kOctave3` (12 (3x)), `kOctaveFifth1` (12+7(1x)), `kOctaveFifth2` (12+7(2x)), `kOctaveFifth3` (12+7(3x)), `kCenter12` (Center-12), `kCenter24` (Center-24).
- **Unison detune mode (`unison.mode`)**: `kDetuneSuper`, `kDetuneExp`, `kDetuneInv`, `kDetuneRandom`.
- **Loop mode (`loop.mode`)**: `kForward` (Fwd Loop), `kReverse` (Rev Loop), `kPingPong` (Fwd/Rev Loop), `kTailed` (Tailed).
- **Pitch mode (`pitchMode`)**: `Steps`, `Harmonics`, `Ratio`, `Freq`.
- **Sub shape (`oscillators.sub.shape`)**: `kRoundRect` (RoundRect), `kTriangle` (Triangle), `kSaw` (Saw), `kSquare` (Square), `kPulse` (Pulse).
- **Noise type (`oscillators.noise.type`)**: `White`, `Pink`, `Brown`, `Geiger`.
- **LFO mode (`lfos.N.mode`)**: `Free`, `Envelope`.
- **LFO type (`lfos.N.type`)**: `Path`, `Lorenz`, `Rossler`, `RandomSH`.
- **Distortion mode (`mode`)**: `kSoftClip`, `kHardClip`, `kDiode1`, `kDiode2`, `kLinFold`, `kSinFold`, `kZeroSquare`, `kDownsample`, `kAsym`, `kRectify`, `kXShaper`, `kXShaperAsym`, `kSineShaper`, `kStompBox`, `kTapeSat`, `kOverdrive`, `kSoftSat`.
- **Reverb type (`type`)**: `kHall`, `kVintage`, `kAbyss`, `kSpace`.

### Mod sources and destinations

**Sources** (`source`, `aux`): `Mod Wheel`, `Env 1`–`Env 4`, `LFO 1`–`LFO 10`, `Velo`, `Note#`, `Aftertouch`,
`Poly AT`, `Noise Osc`, `NoteOn Rand1`, `NoteOn Rand2`, `NoteOn Alt`, `NoteOn Alt2`, `Macro 1`–`Macro 8`,
`Pitch Bend`, `Expr X`, `Expr Y`, `Expr Z`, `Release Velo`, `Fixed`, `LFO 1 Y`–`LFO 10 Y`, `Osc A`, `Osc B`,
`Osc C`, `Sub Osc`, `Filter 1`, `Filter 2`, `Active Voices`, `Voice Mod 1`, `Voice Mod 2`, `Voice Index`,
`NoteOn Rand (Discrete)` (ids 1–59 in that order, from the presets studied).

**Destinations** (`to`) are named as Serum names its controls: `A Level`, `A Pan`, `A Octave`, `A Semi`,
`A Fine`, `A Coarse Pitch`, `A Unison`, `A Uni Detune`, `A Uni Blend`, `A Uni Width`, `A Warp`, `A Warp 2`,
`A WT Pos`, `A Phase`, `A Rand Phase` (and B, C, `Noise Pitch`, `Sub Shape`…), `Filter 1 Freq`, `Filter 1 Res`,
`Filter 1 Drive`, `Filter 1 Var`, `Filter 1 Wet`, `Env 1 Attack` … `Env 4 Rel Curve`, `LFO 1 Rate`, `LFO 1 Smooth`,
`Macro 1`, `Main Vol`, `Main Tuning`, `Porta Time`, `A>Filter Balance`, `A>BUS1`, `Arp Rate`… A parameter without
a control is a module and Serum's parameter name without "kParam": `Main FX 2 Wet`, `Bus 1 FX 1 Size` (the effect
at that place of the rack), `LFO 1 Mode`, `A PhaseMemory`, `LFO Point Bus 1 Value`, `Global PolyCount`. An
oscillator's type-specific names follow its type in the same preset ("A Warp" is a sample's warp when A is a
sample). A slot stores (module, id, parameter id, parameter name), and Serum finds the parameter by its name when
the module has it, else by the id; one written by the spec always has both right. A stored destination no name
says exactly is read as `{ "module": "WTOsc", "id": 0, "param": "kParamTablePos", "paramId": 6 }`, which is
accepted too. Effect destinations' ids are rack × 100 + place (checked on all 356 in the presets studied).

### Effects

An effect is `{ "effect": …, "enabled"?: bool, …parameters }`: its parameters by Serum's names without "kParam",
first letter (or acronym) lower case, values as Serum stores them. Serum's effects have no automatable controls,
so their units can't be read from Serum; the ranges below are Serum's clamps, and the presets studied suggest:
`wet`, `feedback`, `size`, `drive` are %, EQ and crossover `freq…` are Hz, the compressor's `attack`/`release` are
ms, `levelOut` is 0–1 (0.5 unity, as a filter's level), the effect filter's `freq` is 0–1 (the voice filters' knob,
by assumption). `ir` is a convolve effect's impulse (path in `Impulses`); `params`, `module` and `entry` keep
anything else.

- `distortion` (FXDistortion, type 0): wet, drive, lphp, mode, freq, bw, prePost, levelOut, numStages, keyTrack
- `flanger` (FXFlanger, type 1): wet, beatSync, rate, depth, feedback, width, levelOut, swing
- `phaser` (FXPhaser, type 2): wet, beatSync, rate, depth, depth2, freq, feedback, width, levelOut, numPoles, swing
- `chorus` (FXChorus, type 3): wet, beatSync, rate, delay, delay2, depth, feedback, filt, levelOut, filtMode, swing
- `delay` (FXDelay, type 4): wet, freq, bw, beatSync, link, timeL, timeR, mode, feedback, offsetL, offsetR, levelOut, hq
- `compressor` (FXComp, type 5): wet, thresh, ratio, attack, release, makeup, multiband, threshUD0, threshUD1, threshUD2, levelOut, xoverLow, xoverHi, gain0, gain1, gain2, ratioBelow, ratio0, ratio1, ratio2, ratioBelow0, ratioBelow1, ratioBelow2, deadband0, deadband1, deadband2, bypassDown1, bypassDown2, bypassDown3, bypassUp1, bypassUp2, bypassUp3, limiterLatencyComp, compensatedWetDry
- `reverb` (FXReverb, type 6): wet, size, delay, freq, feedback, freqB, width, freqC, mode, levelOut, vintageScale, vintageScaleB, preDelay, preDelayBeatSync, type
- `eq` (FXEQ, type 7): freq1, freq2, reso1, reso2, gain1, gain2, type1, type2, levelOut
- `filter` (FXFilter, type 8): wet, type, freq, reso, drive, var, stereo, levelOut, x, y, keyTrack, pad
- `hyper` (FXHyperD, type 9): wet, rate, detune, unison, retrig, levelOut, dimESize, dimEWet, dimELevelOut
- `bode` (FXBode, type 10): wet, beatSync, shift, range, levelOut, delayTime, feedback, delayBalance, swapAB, outputMix, outputWidth, blur, retrig, monoInput
- `convolve` (FXConv, type 11): wet, minPhase, levelOut, size, attack, decay, ipTrim, tone, predelay, predelayBeatSync, damping
- `utility` (FXUtils, type 12): wet, levelOut, width, balance, lfMono, lfXover, hpf, lpf, polarityL, polarityR
- `split` (FXSplit, type 13): freq, band1Bypass, band2Bypass, solo, moduleCount1, moduleCount2

### What isn't named: `params`, `typeParams`, `raw`

Reading a preset names what it can say exactly and keeps the rest, so writing the spec gives back the same settings
byte for byte: a module's other parameters go in `params`/`typeParams`; a value no decimal in the field's unit
gives back exactly stays there too, as stored (35 of the 25 971 named values in the 118 presets; levels are the
usual ones, since squaring leaves some gains without an exact percentage); everything else (arpeggiator and clips,
velocity curves, embedded wavetables, Serum 1's leftovers…) is `raw`, a JSON merge patch (RFC 7396) on the settings
by top-level key, applied last. In `raw`, long lists of 32-bit floats are `{"$f32": base64}`, integers past 2^53
`{"$int": "…"}`. When the CLI can read the files a preset names (Serum's Tables and Samples folders), the facts
Serum keeps about them (`numFrames`, `numChannels`, `sampleRate`) are filled in from their headers instead of
being left to `raw`; Serum works them out again on load anyway (a path alone is enough: tried).

## Units, measured

Each conversion was checked against what Serum shows, by writing values into a state and reading Serum's controls:

- **Cutoff**: 440·2^((136.8·x − 69)/12) Hz for the stored 0–1 (1 002 values, every filter type: all exact once
  rounded; Serum shows at most 22050).
- **Levels**: the stored value is the gain; the knob shows √gain as %, and 20·log10(gain) dB (+3 dB on Main Vol).
  Bus and direct volumes: gain = 2·stored, shown as √(stored/2) %.
- **Envelopes**: times in seconds (shown as ms or s); the sustain's gain is stored², Env 1 shows it in dB, the
  others in %.
- **LFO rate**: free, the stored value is Hz (×10 with Rate 10x); the knob's position is (stored/100)^¼, and when
  synced Serum cuts the knob into 14 bands, one per division from 32 bars to 1/256, each shared in thirds with the
  dotted and triplet divisions when those are allowed. A division's value here is the middle of its share: Serum
  shows it as that division whichever of dotted and triplets is on (2 001 positions in each of the four cases).
- **WT position**: 1–256 across the table, whatever its length (Serum shows the frame).
- **Display quirks**: PWM's warp display runs backwards: a knob (`warp.amount`) of 0 shows 100 (a full-width pulse), and 100 squeezes the wave to almost nothing (measured: a lead at amount 100 rendered 15 dB quieter than at 30); a pan truncates toward 0 from the knob's 32-bit position (−10 can read "−9 L"); a filter's
  level reads up to 0.1 dB low; 0 reads "--" on several controls; the "Scale" control reads "-" the first time a
  preset with scale "---" loads, then "---".

## What's verified

With `scripts/serum-preset.ts verify` (reports in `data/serum-research/generated/`):

- **Round trip**: 118 presets (the 32 starred Serum 2 presets, and 86 Serum 1 presets as Serum 2 converted them)
  each read into a spec, written back as a `.SerumPreset`, and both loaded into Serum. Settings byte-identical:
  118/118. Serum's 541 controls: 63 837 of 63 838 texts the same; the other is the "Scale" text Serum itself shows
  two ways (flagged unstable: the original reads differently on a second load). Serum's own re-save of both: the
  same, 118/118 (one only on a second load: a multisample's files load in the background, and the first save
  had caught one still loading).
- **From scratch**: five hand-written specs (a soft lead, a resonant pluck, a wide pad, a bass, and sample keys
  with sample, multisample, granular and noise samples) written and loaded: every control the spec sets shows what
  it says (168 of 168). Serum's re-save keeps everything written (mod slots, effects, LFO shapes, file paths…),
  except values at their defaults (Serum doesn't store them) and the names its controller keeps and the tags it
  works out itself. Every wavetable, sample, multisample, noise sample and impulse named was found (Serum filled in
  their frames).
- **Layout**: the written files laid out as a preset Serum saved: the container, the header's keys, formatting
  and agreement with the settings, payload version 2, the zstd frame's flags, the hash, the settings' modules.
- **Unit tests** (`pnpm vitest run server/music/serum`, no Serum needed): the CBOR rules, the container, the
  units, writing and reading specs, exact round trips of odd settings, the error messages.

## LFO shapes, measured

A shape's points are stored as Serum's editor draws them, y from the top. Measured on a held note with
`LFO 1 → A Level −60%` (free 0.5 Hz): Serum's default triangle (stored `[1, 0, 1]`) and `[[0,1],[0.5,0],[1,1]]` both
start quiet-modulated and peak mid-cycle; `[[0,0],[0.5,1],[1,0]]` does the opposite. A shape whose end differs from its
start doesn't run as drawn: `[[0,0],[1,1]]` held the full value the whole cycle, and `[[0,0],[0.5,0.5],[1,1]]` turned
back at its middle. 675 of the 693 stored shapes in the 118 presets studied end at their start's height. So: y 0 = full,
and close the loop.

## What isn't verified

- **Opening a written `.SerumPreset` in Serum's browser**: that needs Serum's window. The files are laid out as
  Serum's own and their settings load as Serum's state, but the browser's own path is untested; nor whether a
  Serum older than 2.1.5 opens a version 11 preset.
- **An LFO shape's name**, kept by Serum's controller: written where Serum's presets keep it, never seen back.
  (Macro and rack names are: `presetAsState` gives them to the controller, and the host's controls show the macros'
  names, `player.md` §2.4. Serum's re-save of a state drops them while its window has never been open.)
- **Effects' units** (no controls to read), the effect filter's cutoff scale, what `unison.detune` is in cents.
- **Defaults with no stored name**: the LFO mode that restarts per note, the sub's sine, a distortion's and a
  reverb's first types, an oscillator's wavetable type: they're written by leaving the key out.
- **Tags**: Serum's processor works its own out; the spec's go in the file for the browser.

## How the catalogue was made

`catalogue.ts` holds what Serum said when asked, in the offline engine (silent, no window), with states made by
editing Serum's init state:

- **Parameter names**: a mod slot aimed at (module, id) with a name Serum doesn't know is re-saved with the real
  name, so every id of every module (effects included) was asked.
- **Options**: a choice parameter written as a number is re-saved as its option's name; each index was asked, and
  for controls the text Serum shows was read too.
- **Ranges**: each parameter written as ±10⁹; Serum's re-save has it clamped to its range.
- **Units**: values swept and Serum's controls read (cutoff, LFO divisions, filter level, wavetable position).

The probes were one-off scripts on `scripts/serum-readout.ts` (kept with their results, outside the repo, in `data/serum-research/generated/probes/`) (`withSerum` loads a state into Serum and gives back
its controls and its re-save); `load(null)` gives Serum's init state, which `template.ts` is made from.
