# What comes over from vaudio

`~/code/vaudio` (Vite, React, Convex) is Théo's earlier visualizer: a live WebGL compositor of layers, 2D and 3D
visualizers, a feedback post stage, a modulation matrix and a keyboard performance mode. Read 2026-10-06. Paths below
are under its `client/`.

Nothing in it is seekable: the visualizers rely on the canvas keeping the last frame, the post stage on last frame's
output, the 3D scenes on `dt` from frame to frame, and several smoothers are per frame rather than per second (their
feel changes with the frame rate). Its analysis is a 256-point `AnalyserNode` (128 bins about 180 Hz wide: its "bass" is
0–1.9 kHz). So the looks come over and the machinery is rewritten on signals ([README](README.md)).

## Dropped

Convex, guest identity, IndexedDB media, the `MediaRecorder` export, its compositor (the editor's does layers, blend
modes and most of its distortions already), the unused pointer uniforms, `Math.random` presets (seeded if kept).

## The 2D visualizers (`media.ts`) → Audio effects (V4)

Each becomes a GLSL `effect(uv)` reading `spectrum()`; their trails become `spectrumAgo()` taps (a few weighted past
rows) instead of a fading canvas.

| vaudio | What it draws | Port |
| --- | --- | --- |
| classic | 96 amber bars and a central glow | easy |
| bars | 96 rainbow bars, hue drifting | easy |
| radial | 72 rotating spokes, a disc growing with level | easy (polar) |
| tunnel | 19 wobbling ellipses, low bins outside | moderate (19 distance tests) |
| lattice | a 16×9 grid of cells sized by bins and bands | easy |
| ribbons | 7 sine lines displaced by the spectrum | moderate (distance to a curve; interpolate bins) |
| bloom | 28 orbiting glowing orbs | easy |
| shards | 24 rotating triangles | easy–moderate |
| plasma | a sin·cos field with a high-band spark | trivial |
| lissajous | the waveform against itself delayed, glowing | hardest: needs `wave()`; becomes the vectorscope |

`fillAmbientSpectrum` (a pure function of time, what plays in silence) comes over as is: cards and empty timelines use
it. vaudio's generators (`generators.ts`) are pure and mostly duplicate the editor's generate effects; take any look
that's missing.

## The compositor (`engine.ts`)

GLSL ES 1.0: update to `#version 300 es` when porting.

- **Comes over as effects** (V4): the displacement map (a layer's blurred luma as a height field displacing what's
  below: an effect with a layer input, like a track matte), `hueOrbit`, the strobe, the oscillating swirl, `shimmer`.
  Background modes 2 (domain-warped fbm plasma) and 3 (tunnel rings) as generators.
- **Comes over as the Feedback effect** (V8, a simulation): the post stage's echo, `max(col, echo)` (lighten, so
  bright things leave ghosts), each frame zoomed (`fbZoom`, up to 4.5%), rotated (`fbRotate`, 0.055 rad) and hue
  shifted (`fbHue`), decayed by `mix(0.55, 0.985, trails)`. Per frame in vaudio, so its parameters become per
  second (a frame's step is `rate × dt`). In float targets: vaudio's RGBA8 never fades below about 33/255.
- **Already in the editor**: the 24 blend modes, warp, kaleido, mirror, ripple, chroma split, posterize, solarize,
  grain, scanlines, vignette, pixelate. Compare looks; keep the editor's.

## The 3D scenes (`scene3d/`) → V8

`runtime.ts` (a renderer per layer, ACES, afterimage then bloom), `environment.ts` (a procedural environment map, no
state: comes over as is), `palette.ts`, `kit.ts` (`smoothTo`, `fibonacciDirections`, ribbons, dust, light shafts) are
reused. `audio.ts`' features (bands, punch, onset detection by a bass threshold over a moving mean) are replaced by
signals. The clock becomes the simulation's step.

| Scene | State carried frame to frame | Port |
| --- | --- | --- |
| tesseract | six 4D plane angles integrated, rates changed on onsets, shockwaves, smoothed scale and fov | easy–medium: piecewise integrals of signals and onsets |
| singularity | an orbit integral, smoothed inclination and jet, 70 Keplerian debris shards respawned at random | medium; its sky lensing and disk shaders are pure and come over as is |
| cathedral | travel integrated from speed, pulses spawned on onsets, moths and dust | medium |
| leviathan | a steering head and a 92-segment follow-the-leader chain, jellyfish, a lerped camera | hardest: a real simulation, needs checkpoints |

## Modulation (`modulation.ts`, `ModulationPanel.tsx`, `useControlInputs.ts`) → links and Perform

A route is source (audio level, a layer's luma or motion, a MIDI or gamepad control) → target (23 layer and 20 global
parameters), with an amount, bipolar and smoothing. Links (V3) generalise it to every parameter; layer luma and
motion as sources are a later idea (a video's own analysis as signals). MIDI and gamepad input, Learn (a move past
0.35 from a baseline) and the axis deadzone come over into `control-inputs.ts` (V7). Its smoothing is per frame:
links' is per second.

## Play mode (`usePlayMode.ts`, `playmap.ts`) → Perform (V7)

Kicks are transient boosts (zoom, strobe, chroma, ripple, swirl) decaying by `exp(−4.5 dt)`: they become Hits presets
on event signals. Keys: `` ` `` and 0–9 world presets, Q–P step a global effect each, A–' a hue piano, Z–/ randomise a
layer, `-` mutate, `=` chaos, Backspace wash; the pointer stamps, double-tap steps kaleido, a thrown drag sets the
feedback's rotation and zoom, right-click soothes. These become the default Keys layout, each key a pad or a knob
step mapped to the equivalent effect parameter, recorded like any performance.

## Camera modes (`motion.ts`) → V8

Difference, silhouette, edges, slit-scan, echo grid, smear and freeze, on the CPU over a 32-frame history. They
become effects on video clips over the editor's frame history (a texture array by age), as simulations where they
latch state (freeze).

## Presets (`presets.ts`)

A world preset is a partial set of global parameters (11), plus 9 chaos archetypes (Liquid, Tunnel, Fractal bloom,
Datamosh, Acid, Seance, Neon skeleton, Vortex, Hyperdrive). They become effect presets and starting looks for Make
visualizer, rebuilt from the ported effects; their guard rail (feedback over 0.6 caps strobe and solarize) stays.
