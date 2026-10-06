# CLAUDE.md

A local video editor that runs in the browser. It's short-form first (9:16 by default) and modelled on **Premiere Pro**:
when in doubt about UX, do what Premiere does (Effect Controls, Program Monitor handles, stopwatch keyframes).
It's a React app (`src/`) plus a local Express + ffmpeg server (`server/`), sharing pure domain logic (`shared/`).
README.md is the user-facing guide. This file is for working on the code.

It's growing into a **creative suite**: every project belongs to one app, a *suite* (`SuiteId`: video, music; image
next), picked on the Home screen or in the New project picker. **Every project is a file of its own**, a `.vaudio`
package on disk (see "Projects are files"). The video editor is the furthest along; **music is a DAW modelled on
FL Studio** (see "The music suite"). See "Suites" below: most of this file is about the video editor, which lives at the roots of
`shared/`, `server/` and `src/`; every other suite has folders of its own.

The planned **photo suite** is a Photoshop-style image editor with creative lighting/render effects.
Read [`docs/photo/README.md`](docs/photo/README.md) for its product, research and architecture (WebGPU in the
page renders and paints; content-addressed tiles in the package; a helper process decodes files) and the
foundations' milestones and gates. **F0–F4 are built**: the suite is registered (`SuiteId` `photo`), with
`shared/photo/` (the document: types.ts, project.ts, edits.ts, layers.ts; merge.ts plans merging layers; image, pixel, adjustment and generator layers, filters; effects/:
the effect definitions by kind (adjustments: Exposure, Curves; filters: glow.ts; generators: flare.ts, the Lens Flare) and their parameter specs (numbers, curves, colours, points, choices, booleans, element lists); render-plan.ts: `compileRender`, prefix keys,
`refinePlan`; reference/: the CPU references the GPU is tested against; colour and ICC, geometry, half floats,
surfaces, brush, the output transform; tools.ts), `server/photo/` (the helper process, the only code that parses
image files, with sharp; decoded sources in each package's `photo/cache/`; banded exports; the blob store; the lab),
`server/suites/photo.ts`, and `src/suites/photo/` (store.ts (history is a `PhotoState`: the document and the selection), ui.ts (several layers can be selected: selection.ts), keys.ts, layer-actions.ts (the Layers commands), merge.ts, painting.ts + paint-target.ts (the brush), uploads.ts (the publication gate), brush-options.ts, options-bar.tsx, workspace.tsx, panels/, canvas/,
tools.ts + tool-edits.ts, live.ts: the open photo's renderer (and, in development, `window.photoDebug` for e2e and
`window.photoBench` for the bench); render/: the WebGPU renderer, its atlas, page tables,
WGSL kernels and compositor.ts, the plan's evaluator, which draws the screen, exports, covers and the assistant's
pictures alike; renderer.ts keeps the composite below each adjustment and refines reduced views, never showing a
stale one; adjustments.ts the adjustments' passes; isolated.ts evaluates a layer with filters or a generator alone and
composites it; glow.ts the glow's passes (its octaves live on the document's 2^k grids, read at any grid by their
B-spline) and glow-cache.ts its contributions from level 0, kept per glow; flare.ts the flare's pass).
`scripts/photo-sheet.ts` renders and checks every filter and preset, as the video effect sheet does. `/photo-lab.html` in `pnpm dev` is F0's lab, kept for the
renderer's parts the suite doesn't use yet. Kernels and passes storing `rgba16float` must round first
(`round_for_store`): Metal truncates on store (docs/photo/rendering.md). Pixel layers and masks are surfaces
(`render/surface.ts`: tiles by hash, strokes on drafts); a saved photo only names pixels the server has (`uploads.ts`,
`SuiteBackend.checkSave`). Selections (docs/photo/selections.md: the Marquees, Lassos, Magic Wand, Quick Selection, Select
Subject, modes, Inverse, Feather, the canvas's right-click menu) are a rectangle or a `MaskSelection` (8-bit coverage
over its box: `shared/photo/selection*.ts`, `magic-wand.ts`, `quick-select.ts` on `graph-cut.ts` and `gmm.ts`); the
GPU gets a mask's coverage per tile from the CPU (`selectionCoverage`), keep rectangles' analytic path. The tools read
the photo through `PhotoRenderer.samplePixels` (`selecting.ts` keeps it). Select Subject's model (IS-Net) is
downloaded by the server into `MODELS_DIR` only when the user says yes, and run in the tab by ONNX Runtime Web
(`subject-model.ts`); e2e sets `EDITOR_SUBJECT_MODEL=stand-in`. Light (docs/photo/f4-light.md): no pixel is brighter than its coverage (up to white), the
output's `film` rolls light above white off at the end (`output.ts`), and a glow's or flare's WGSL mirrors its CPU
reference in `shared/photo/reference/`: change both. Layer Style L1–L4 are built (docs/photo/layer-style/README.md:
blend modes and compositing in render/blend.ts, effects (Bevel & Emboss, Satin, patterns too) in shared/photo/style/ and
render/style.ts, their fields made in the layer's pixels and kept; reference/blend.ts and reference/style.ts are held
to Photoshop's own renders, `scripts/photoshop-probes/bevel-sheet.ts` shows the bevels beside them). Patterns are
the document's surfaces (`patterns`) or built in (`style/patterns.ts`), read by the style pass from a storage buffer
of their mip levels; Styles (presets) are this computer's (`layer-style/styles.ts`). A filtered or
generator layer (isolated.ts) composites by the GPU's own blending when it's Normal or light added in linear light,
otherwise through the blend or style pass (`fixedComposite`); light blends in linear light in a "photoshop" document
too (`blendsInLinear`: a layer with filters, a flare with `blendSpace`). F5 (harden) is built but for its gate (Théo's
walkthrough in the packaged app): the server side (`server/photo/recovery.ts`: the checkpoint and the check on open,
`SuiteBackend.keepPrevious`/`check`; documents and blobs written with `writeFileDurably`; `faults.test.ts`), the
Filter menu and Filter Gallery (`filters.tsx`, from the catalogue `shared/photo/effects/catalog.ts`: a filter's
`category` and `presets` in its definition, so a new filter needs no UI of its own), export cancel, and tight GPU
budgets: a full-resolution render draws a region only in the same task as the check that its tiles are all resident
(`whenResident` in renderer.ts); keep it so, or an export can silently read evicted tiles. The stylised filters (Gradient Map, Color Grade,
Halftone, Glitch, VHS, Film Grain…: docs/photo/effects/stylized-filters.md) are **kernel filters**
(`shared/photo/effects/kernel.ts`): a definition, a CPU reference and a WGSL `effect(p, c)` each, by category in
`effects/filters/`, `reference/filters/` and `render/filters/` (change both sides; `kernel.ts`'s prelude and the
reference's helpers share names), run by one generic pass in isolated.ts on the content grown by the filter's reach.
`scripts/photo-sheet.ts` holds every look's GPU result to its reference and, with `--thumbnails`, renders the Filter
Gallery's cards into `public/photo-filters/` (run it after adding or changing a look). The gallery previews a look on
the canvas without touching the document (`filterPreview` in ui.ts, `shownDoc` in filter-preview.ts) until Apply. **Camera Raw** (docs/photo/camera-raw.md; CR0 to CR3
built) is one effect, `camera-raw`, a filter and an adjustment layer alike (`EffectDefinition.kinds`: check a kind with
`usableAs`, never `def.kind`). Its develop (`shared/photo/effects/camera-raw/develop.ts`) is built from Photoshop's
measured responses (`measured.ts`, generated by `scripts/photoshop-probes/camera_raw.py --tables`; `develop.test.ts`
holds it to CR0's fixtures run by run) and mirrored in WGSL by `render/camera-raw.ts`: change both. Its window and
sections are `src/suites/photo/camera-raw/` (⇧⌘A); its edits are absolute (`cameraRawEdit`), so its window's gesture
adds a new one and Cancel leaves nothing. Its local sliders and Contrast read an **analysis** of the picture it
develops (`analysis.ts`: guided-filter grids, haze, statistics, from a coarse render), handed in by `compileRender`'s
`cameraRaw` resolver by the input's key (its id, or "pending", in the node's key) and kept by
`render/camera-raw-analysis.ts`: the screen builds missing ones in the background, `settledPlan` waits for them.
Its Color Mixer and Color Grading are `colour.ts` (Grading in stops of linear ProPhoto, as Camera Raw's), Glow reads a
grid made from the analysis (`glowGrid`); the GPU's table carries them after the curves. Its presets are
`presets.ts` (the window's Presets tab, `add_filter`/`add_adjustment`'s `preset`), Auto is `auto.ts`.
The **Online panel** (docs/photo/online.md; a tab beside Properties) searches Iconify's icons, Bing's images and
Openverse's photos, or reads a pasted link, and places a result as a layer: the server searches and downloads
(`server/photo/online.ts`; Iconify limits requests, so icons' shapes are fetched a set at a time and kept, never one
by one), the helper's `prepare` makes anything that isn't PNG, JPEG or WebP a PNG; e2e sets
`EDITOR_ONLINE_ASSETS=stand-in` (`online-stand-in.ts`).

The **visualizer** (audio-reactive video, inside the video editor; **Make visualizer** from the music suite) is
planned in [`docs/visualizer/README.md`](docs/visualizer/README.md): signals, links, audio shaders, Perform, its
milestones V1–V10. **V1 and V2 are built**: every file with sound gets *signals* (`shared/signals/`, platform: the
format, the pure analyser, reading at a time; `server/signals.ts` + `MediaLibrary.analyseSignals`, `MediaAsset.signals`),
read on the timeline by `shared/audio-signals.ts` (video: a clip's, a track's or the mix's energies summed, hits, the
beat; a `SignalReader` per video: the tab's is `stores/signals.ts`, the export's built in `ExportService`, used through
`withSignals`), so expressions react to sound (`audio("bass")`, `sinceHit("onsetLow")`, `envelope`, `beat()`...) alike
in the preview and the export. The assistant's `get_signals` and `plot_signals` are its ears. **V3 is built**: links
(`Effect.links`: a number or point follows a signal by an amount, through a response; worked out in `effectValuesAt`
before expressions; `shared/links.ts` is their data, `linkLevel` in `audio-signals.ts` reads them,
followers in warmed-up blocks so values never depend on what was read first), the video's own signals
(`Project.signals`: bands of a source, hits, curves), and a nest hearing the mix of the sequence it's placed in
(`Hearing`: whatever draws a nest wraps it in `withHearing(nestedHearing(clip, outer))`, as with `atFrameRate`). The
link button sits by each stopwatch (`properties/link-button.tsx`); the tools are `link_param`, `define_signal`,
`delete_signal`, `set_events` (`src/assistant/signal-edits.ts`). The Signals window (`components/signals/`) makes bands
from a spectrum at the playhead and places hits; the timeline shows signal lanes under its ruler
(`timeline/signal-lanes.tsx`) and, switched on there, spectrograms on audio clips. **V4 is built**: visualizers are
video effects with `EffectShader.audio` (the Audio category, `shared/effect-library/audio.ts`); each pass carries what
it hears at its clip's moment (`EffectPass.audio`, read by `effectPasses` through `clipAudio`), bound by the compositor
as `uSpectrum`/`uWave` textures and uniforms (`AUDIO_PRELUDE` in `effect-gl.ts`); a `source` parameter says what it
listens to; New item › Visualizer is a solid drawing only its visualizer. Signals files (v2) keep a small waveform.
**V5 is built**: Make visualizer (the music toolbar's film slate, `make_visualizer`) hands a song to the video suite
through the platform (`shared/handoff.ts`, `ProjectStore.createFromHandoff`, `SuiteBackend.fromHandoff`): the music
side renders the mix and stems and works out notes, beats and markers (`shared/music/visualizer.ts`,
`server/music/visualizer.ts`), the video side builds the project with a starting look bound by role
(`shared/song-video.ts`); `Project.tempo` is the song's exact beat, which `beat()` prefers to the analysis. **V6 is built**: the Shader effect (type `shader`, `Effect.shader`: the user's GLSL, ours, ISF or Shadertoy's, read by
`shared/shader-code.ts`); its parameters are declared in its code, so **use `definitionOf(effect)` wherever an effect is
at hand** (`effectDefinition(type)` gives the starting shader's). Keyed by a hash of the code (`fx:shader:<hash>`);
the tab compiles each on a hidden context (`src/lib/shader-compiler.ts`, `provideShaderCheck`: one that doesn't compile
isn't drawn), the export refuses one (`GlSession.compile`), and a lost GPU turns the likely one off
(`preview/shader-recovery.ts`). The editor is `components/shader/` (CodeMirror 6); the assistant's `set_shader`.
**V8 is built** (before V7): **simulations** (`EffectShader.simulation`, `shared/simulation.ts`): an effect whose output is
its state, read back a frame later (`getState`), so frame `f` of a clip is the shader run `f + 1` times from its first
frame. The compositor keeps two states and checkpoints per simulation (`simulationFrom`, `advance`); the preview catches
a clip up before drawing it (time-boxed, `data-simulation`), the export draws in order and its plan adds `advance`
layers for frames it skipped. A simulation's pass carries a `version` (the clip and its sound, hashed): keep anything
that changes what it steps on in it. Feedback, Motion Trace, Freeze (`effect-library/simulation.ts`). **3D scenes**
(`EffectShader.scene`, docs/visualizer/scenes.md: Ridgeline, Infinite Dive, Aurora, Storm Sea, Ferrofluid, Event Horizon,
Neon City, Nebula, Abyss, Monoliths) are raymarched
GLSL: each `shared/scenes/<scene>.ts` holds its GLSL, its parameters and its state, stepped in TypeScript
(`steppedState`), the same in the tab and the export's plan, handed to the GLSL as uniforms (`SCENE_GLSL` in
`effect-library/scenes.ts` gives the camera ray, noise, the tonemap). Ridgeline's terrain is mirrored in float32 TS
(`ridgeHeight`) so the camera never flies into it: change both. A scene that travels for ever (Neon City, Nebula,
Monoliths) repeats its world over a long period and wraps the camera in TS, so a long song never runs out of float
precision. `scripts/scene-sheet.ts` renders them to look at;
`server/simulation.test.ts` is the gate: a frame the same in order, straight away and seeking.

## Commands

```bash
pnpm dev          # server :5311 + app http://localhost:5310 (moves to 5410/5411… if taken)
pnpm typecheck    # tsc -b (app + node projects)
pnpm test         # vitest: shared/, src/, server/ (the server integration tests need ffmpeg)
pnpm test:e2e     # Playwright on :5320/5321 with a throwaway e2e/.data (serial, ~2 min)
pnpm test:e2e music   # only e2e/music.spec.ts (seconds): each suite's spec stands on its own (photo too)
pnpm samples      # test media into ./samples
pnpm tsx scripts/transition-sheet.ts [type|tag ...] [--out f.png]   # render + check transitions
pnpm tsx scripts/effect-sheet.ts [type|tag ...] [--out f.png]       # render + check video effects
pnpm tsx scripts/preset-sheet.ts [type|tag ...] [--out f.png]       # render + check presets
pnpm tsx scripts/pro-c-sheet.ts [style ...] [--out f.png]           # Pro-C's styles measured on the engine: curves, gain, colour
pnpm tsx scripts/perf.ts [clips] [--profile <scenario>]              # time a long edit in the real app
pnpm tsx scripts/ui-sheet.ts [name ...] [--light|--dark]            # screenshot the gallery + screens, every theme
pnpm dev:desktop  # the desktop app (Electron): Vite + a window; restarts when electron/ or server/ change
pnpm build:desktop && pnpm test:desktop   # release/mac-<arch>/Vaudio.app, then launch it, export, check
pnpm test:desktop:music # macOS: real clicks between the music windows and Serum's (or the test synth's): stacking, focus, app switching; needs Accessibility access and an unlocked screen
pnpm engine:build # the music suite's audio engine (C++/JUCE) into engine/build; needs cmake + ninja (brew)
pnpm tsx scripts/make-icon.ts [--variant dark]   # redraw the app icon into resources/
pnpm tsx scripts/make-kit.ts   # synthesise the music suite's starter kit into public/kit/
pnpm tsx scripts/make-audio-fixtures.ts [--out dir]   # the audio-intelligence fixtures as WAVs + a manifest (tests render them in memory)
pnpm tsx scripts/photo-fixtures.ts [--skip-large]   # the photo suite's test images (48/100 MP, P3, 16-bit, alpha, EXIF) into data/photo-fixtures
pnpm tsx scripts/photo-bench.ts [--runner chrome|electron] [--quick] [--lab [--tiles 256,512]] [--shots dir]   # the photo suite's targets, measured in the workspace (--lab: F0's lab)
pnpm tsx scripts/select-mixparams.ts   # MixParams' reviewed reference subset into the gitignored data/ (docs/audio-intelligence/)
python3 scripts/audit-cl1b.py <Dataset.zip> --out <report.json>   # CL 1B's layout, read statically: never unpickles
python3 scripts/photoshop-probes/<probe>.py   # measure a real Photoshop (macOS, installed): docs/photo/layer-style/photoshop-measurements.md
```

**Verify every change** with `pnpm typecheck && pnpm test`, and also `pnpm test:e2e` for anything the UI touches.
- Don't edit `src/` while e2e runs: Vite hot-reloads the page mid-test and a test fails for no real reason.
- The e2e tests depend on each other (serial, shared state), so run the whole file rather than `-g` one test.
  Each suite has its own spec (`e2e/editor.spec.ts` is the video editor's, `e2e/music.spec.ts` the music
  suite's) that makes its own projects, so one suite's file runs alone.
- After touching a shader, `transition-gl.ts`, `effect-gl.ts`, `layers.ts` or `compositor.ts`, run the transition-sheet,
  effect-sheet and preset-sheet scripts. They compile every shader in headless Chromium and check that each transition
  (and transition preset) starts on the outgoing picture and ends on the incoming one, and that each effect visibly
  changes the picture (look at the sheets too).
- If `pnpm install` output looks stale (e.g. "Cannot find package 'playwright-core'"), run `pnpm install`.

## Layout

```
shared/            Pure TS, used by both sides. No DOM, no Node APIs (types only: canvas/WebGL).
  suites.ts          The suites: SuiteId, their names (SUITES), each one's document type (SuiteDocuments).
  suite-tools.ts     Every suite's assistant tools (SUITE_TOOLS), toolSpec/suiteToolSpec/toolSuite.
  tool-spec.ts       What a tool is (ToolSpec, kinds, JSON schema helpers) and its results, for every suite.
  ids.ts             createId, for everything the app makes.
  music/             The music suite: its document (types.ts), create/normalise (project.ts), its pure edits
                     (edits.ts; the playlist's in playlist.ts), automation (automation.ts: curves, what a
                     control is at any tick), the song as the engine plays it (compile.ts:
                     swing, gains, mutes, song mode's arrangement flattened, automation as lanes), its tools
                     (tools.ts), the audio engine's commands, status and events (engine.ts), the
                     Browser's types and search (browser.ts: pure, ranked, typo-tolerant), and the
                     export's settings, file names and ffmpeg arguments (export.ts) and MIDI file (midi.ts),
                     and recorded takes into the song (recording.ts: where they land, the latency left out),
                     Gross Beat (gross-beat.ts: its slots, edits and envelopes for the engine; its presets in
                     gross-beat-presets.ts), EchoBoy (echo-boy.ts: its edits, controls and delay lines for the
                     engine; echo-boy-styles.ts its 31 styles, echo-boy-library.ts its presets), Auto-Tune
                     (auto-tune.ts: its edits, Detect key, what the engine plays; scales, presets and ranges in
                     auto-tune-presets.ts), Pro-Q (pro-q.ts: its edits and what the engine plays; pro-q-filters.ts:
                     its shapes as analog sections, curves, Auto Gain; pro-q-presets.ts), PanMan (panman.ts: its patterns,
                     edits and what the engine plays; panman-presets.ts: its constants, validation and presets),
                     Pitch Wheel (pitch-wheel.ts: its edits, the wheels' physics
                     `stepWheel`, what the engine plays; defaults, presets and ranges in pitch-wheel-presets.ts),
                     the Reverb (reverb.ts: its edits, T60s, what the engine plays (`engineReverb`), its lanes;
                     reverb-modes.ts: the modes and eras as data; reverb-presets.ts: ranges, validation, presets),
                     stretching audio clips (stretch.ts: modes, speeds, the tempo a file was made at),
                     and drawing anything over time as lines for the engine (sampling.ts).
                     audio-intelligence/ is the assistant's hearing foundations (see "Audio intelligence" below);
                     hash.ts is the pure SHA-256 and canonical JSON everything there is identified by;
                     mix-reference.ts is MixParams' reviewed subset (a research reference, never executable settings).
  types.ts           Domain + HTTP API types; the route list is documented at the bottom.
  timeline.ts        Queries + edits on Project (clips, tracks, clipboard, snapping, output size).
  normalize.ts       normalizeProject: validates/repairs/upgrades any untrusted Project (load, save, export).
  params.ts          ParamSpec types (number, vec2, boolean, choice, text, color, font…) + sanitize/defaults.
  keyframes.ts       Keyframe validation, interpolation (easedProgress), setKeyframe.
  animation.ts       Keyframe edits (stopwatch, navigator, move/delete/easing/Bézier handles, copy/paste, stretch, rove,
                     a point's spatial handles: `setKeyframeSpatial`, `smoothMotionPath`) and timeline<->keyframe time helpers.
  sequences.ts       Nested sequences: `sequenceView`/`writeSequence` (a sequence edited as a project), `sequenceAsset`
                     (a sequence as media, so nested clips trim/retime like videos), nest/break apart, preview slots.
  time-remap.ts      Time remapping (the Time Remapping effect's keyframes map a clip's clock to source time):
                     `mediaTime`, `remapSpeed`, freeze/reverse/velocity edits, `remapFromSpeeds`.
  effects.ts         Effect definitions (Motion, Opacity, Volume, Text, Appearance, then the video effects),
                     evaluation (motionAt, opacityAt, volumeAt, textStyleAt), edits (setParams, resetParams,
                     setEffectEnabled, addEffect/removeEffect/moveEffect for video effects).
  effect-library/    One file per category of GLSL video effects (colour, blur, light, stylize, distort, generate,
                     keying, glitch...); common.ts has helpers. Also the definitions of what's added to a clip
                     without being a shader (`stackable`): mask.ts, shape.ts (Shape + operators), text-animator.ts.
  effect-gl.ts       Video effect shader prelude, effectShader, effectPasses (a clip's effects at a moment).
  layers.ts          clipLayer: a clip as a compositor layer at a moment (opacity, blend mode, edges, effects, and
                     motion blur's moments over the shutter); placer (2D affine or 3D projection), track mattes
                     (withTrackMattes), depth sorting. The preview and the export both build layers here.
  parenting.ts       Parenting (the pick-whip) and null objects: a child follows its parent's Motion as it moves away
                     from its pose when linked (`ClipParent.rest`); `placer` applies it (2D affine, or a 3D layer's
                     placement), the canvas overlay takes it back off drags (`uncarryMotion`).
  camera.ts          3D: Camera clips (the Camera effect), cameraAt, projectLayer (a 3D layer's homography), defocus.
  particles.ts       Particle effects' shaders: `Particle particle(int id)` in a vertex shader, instanced quads.
  presets.ts         Presets (After Effects' Animation Presets): transitions as an adjustment layer across a cut,
                     moves/looks on clips; applyPresetToClips, addPresetLayer. Definitions in preset-library/.
  transitions.ts     Transition registry, timing specs, sanitize/patch.
  transition-library/  One file per category of GLSL transitions; common.ts has shared specs.
  transition-windows.ts  Where transitions play on the timeline + edits to them.
  compositor.ts      THE renderer (WebGL2), an After Effects-style layer stack: pictures, solids and vector drawings
                     (`Placed.vector`, a shape layer: drawn by the browser's 2D canvas at the size shown) after their
                     masks (`Placed.masks`, also drawn by the 2D canvas) and video effects, placed by an affine or
                     projective map (3D) + opacity + blend mode (BLEND_MODES)
                     + edges (mirror/tile) + track matte, adjustment layers (drawAdjustment: the frame so far
                     through effects and Motion), motion blur (samples averaged in a float buffer), time effects'
                     frame history (texture arrays) and GPU optical flow, time interpolation between two frames,
                     particle passes (instanced), Grow Bounds, transitions, YUV in/out. Draws the preview, the
                     Effects tab's thumbnails and every export frame.
  scene.ts           What each video track shows at time t (clip + source time, or transition + sides).
  transition-gl.ts   Transition shader prelude, fragmentSource, uniforms.
  transform.ts       Where a clip lands on the canvas (fit → scale/rotate around the anchor).
  path.ts            Bézier paths (AE-style relative handles) for masks, shapes, text on a path, motion paths: shapes,
                     lengths, bounds, flattening, strokes, hit tests, edits, morphing, triangulation, SVG in/out.
  shape-ops.ts       Shape operators' geometry on paths: polygon booleans (mergePaths), trimPaths, offsetPath, zigZag,
                     wigglePath, roundCorners.
  masks.ts           Masks at a moment (`masksAt` -> the compositor's `MaskShape`s), addMask.
  shapes.ts          Shape layers at a moment: a clip's Shape effects and operators walked in order into a
                     `VectorDrawing` (`shapeDrawingAt`), plus its bounds and hit test for the canvas.
  text-animators.ts  Text animators: units (characters/words/lines), `selectionAmount` (the range and its shape),
                     `glyphSelections`, the ready-made ones (ANIMATOR_PRESETS, addAnimator).
  text-drawing.ts    Text: `TextLayout` (measured by the tab), `textDrawing` (layout + style at a moment -> what the
                     compositor draws), `textUnit`, and validating layouts from an export request.
  expressions.ts     The expression language: its own tokenizer, parser and interpreter (never `eval`), the AE
                     helpers (wiggle, loopOut, linear...), `expressionValue`. Effects run it in `effectValuesAt`.
  markers.ts         Sequence markers (`Project.markers`, timeline time) and clip markers (`Clip.markers`, source
                     time): add/update/remove, `allMarkers`, `adjacentMarker`.
  beat-sync.ts       Beat sync: a song's beats as markers on its clip (`Marker.beat`, `setBeatMarkers` replaces only
                     those) and `cutToMarkers` (clips end on markers, the rest of their track moves along).
  captions.ts        Auto captions: presets, words → caption cues (fitting the canvas), transcripts → timeline,
                     edits to every caption at once (style, animation, merge). Spoken animations are text animators.
  library.ts         The shared Library: folder tree, saved clips (ClipTemplate: normalize, placeTemplate), search.
  assistant-tools.ts The video editor's tools for AI agents (MCP): names, input schemas, descriptions, kind (look/edit/action).
  assistant.ts       The assistant's chat: messages, ChatEvent + applyChatEvent (server and tab fold the same events),
                     describeToolCall (a step's label), TabEvent (what the tab's event stream carries).
  export-formats.ts  What an export can be (V10): H.264, HEVC, ProRes 422 HQ, ProRes 4444, PNG sequences, as data (container,
                     encoder, readback, quality, alpha); `exportSettings` checks a request's format, quality and alpha.
  math.ts, format.ts, errors.ts   clamp/EPS/roundTime, time and size formatting, errorMessage.
server/
  index.ts → app.ts  Startup wiring; routes live in routes/<resource>.ts (one Router each).
  suites/            Each suite's server side (SuiteBackend): create/normalise/summarise its documents, what its
                     assistant is told. index.ts is the registry; video.ts wraps the video editor's.
  projects.ts        ProjectStore: every suite's projects, each a package on disk (`Name.vaudio`: project.json, meta.json
                     says the suite (none = video), media/, a song's plugins/ and recordings/), opaque documents, and
                     this computer's recents (`data/projects.json`). packages.ts: names, unique paths, moves, the Trash.
  migrate.ts         Older data folders: data/project.json and data/projects + data/media become packages, on startup.
  media.ts, web-media.ts, exports.ts   Services behind the routes.
  library.ts         LibraryStore: library.json (folders, items) + its own MediaLibrary under data/library/media.
  render.ts          Export plan (pure, unit-tested): planRender (decoders + per-frame layers), audioArgs.
  encoders.ts        Each export format's encoder (`encoderArgs`), the formats this ffmpeg can make (`availableFormats`).
  zip.ts             A stored ZIP of files on disk (ZIP64 when it's big): a PNG sequence's download.
  frame-render.ts + gl-browser.ts   Runs the plan: decoders -> headless Chromium compositor -> encoder.
  process.ts         run()/spawnStreaming(): the only way to start external programs (argv, never a shell).
  transcription/     Speech to timed words for Auto captions. service.ts (jobs, cache, time mapping), audio.ts
                     (decode, squeeze out silences, snap words to the sound), engine.ts (the engine interface),
                     whisper-cpp.ts (local, one-click setup), openai.ts (OpenAI + Groq), fake.ts (e2e).
  music/             The music suite's server side. engine.ts: AudioEngine runs the audio engine's process, JSON
                     lines over its stdin/stdout, restarts it when it dies (and gives it its song back), compiles
                     the song it's sent. routes.ts: `/api/engine`. fake-engine.mjs stands in for it in tests (and
                     the e2e suite). wav.ts reads and writes WAVs for the tests of what it plays.
                     browser.ts: the Browser's sample folders (global, `data/browser.json`), favourites,
                     listing and the watched search index; `/api/browser` reads nothing outside them.
                     exports.ts: song exports (`/api/music/exports`): the engine renders, ffmpeg encodes.
  architecture.test.ts  The layering between the platform and the suites, checked on every import (see Suites).
  assistant/         The assistant. mcp.ts: the MCP server (POST /mcp, stateless JSON-RPC). bridge.ts: relays tool calls
                     to an editor tab over its event stream and back, and every chat's activity to every tab.
                     agent.ts: the Agent interface each provider implements. claude.ts: runs `claude -p` (stream-json).
                     codex.ts: runs `codex app-server` (JSON-RPC), its model list and account. Both turn their output
                     into ChatEvents. service.ts: one chat per video (saved in data/assistant) on a provider + model +
                     thinking level, a conversation per provider, their status, tool calls -> chat steps. prompt.ts:
                     the system prompt around a suite's instructions. A chat's suite picks its prompt and MCP tools.
  media-analysis.ts  ffmpeg looks into media: a frame as JPEG, silences + loudness, shot changes, music (for the assistant).
  beats.ts           Music analysis (pure, tested on synthetic drums): onsets, tempo (with the half/double choice),
                     beats (Ellis's DP tracker, then evened out), bars, loudness sections and drops. The platform's:
                     beat sync and the music suite's Detect tempo both use it.
  config.ts          Every env var is read here and nowhere else.
  storage.ts         DataPaths (data dir layout), HttpError, atomic JSON I/O.
engine/            The music suite's audio engine, a C++/JUCE program (CMake; JUCE is fetched into engine/build).
                     src/Engine.cpp: the device, commands, the real-time `process`. Song.cpp: a compiled song
                     and its samples. Sequencer.cpp: the transport, the sampler's voices, plugin channels'
                     notes, the metronome. Host.cpp: the song's plugin channels (instances, state files,
                     windows). Plugins.cpp: plugin scanning and the bench's two slots. FilePreview.cpp:
                     the Browser's preview, a file streamed from disk; Recorder.cpp: recording (armed tracks'
                     inputs to WAVs, through FIFOs a writer thread empties); MidiInputs.cpp: MIDI keyboards
                     (every input not turned off, into the sequencer's queue); AudioStream.cpp is that stream (a reader
                     thread, a lock-free ring; Signalsmith Stretch for stretched clips), and ClipPlayer.cpp plays the playlist's audio clips with it,
                     each started on its sample. Export.cpp: the export, rendered on a thread of its own
                     (Workers.h runs its plugins on every core). GrossBeat.cpp: Gross Beat, a native effect
                     (its rolling buffer, envelopes, sync, HOLD). EchoBoy.cpp: EchoBoy, a native echo (its
                     lines, the style on each repeat; its filters, saturations, diffusers, LFOs in EchoDsp.h).
                     AutoTune.cpp: Auto-Tune, native too (YIN pitch tracking, Antares' correction,
                     formant-keeping PSOLA). ProQ.cpp: Pro-Q, native too (its bands, dynamics, modes);
                     EqDesign.cpp: its filters (analog sections matched to digital ones, run as SVFs);
                     Convolver.cpp: FIR filters by FFT; Spectrum.cpp: the analyzer's measurements. PanMan.cpp: PanMan, another (its pattern, chance,
                     triggers, dynamics, pan law, Analog Styles). PitchWheel.cpp: Pitch Wheel, native too
                     (phase-locked spectral shifting, a true envelope for the formants, the wheels' physics, notes
                     as voices). Reverb.cpp: the Reverb, native too (its two networks, early energy, ducker,
                     de-esser, eras, Freeze; its settings in ReverbSettings.cpp); ReverbNetwork.cpp: its late
                     network (a ring or a 16-line FDN, lossy all-passes, Thiran reads); ReverbEarly.h: its velvet
                     taps and small blocks; GraphicEq.h: Jot's absorption (a shelf, then a 10-band proportional
                     graphic EQ fitted by least squares). Resampling.h: reading between samples (linear, Hermite, sinc),
                     centred so nothing is delayed. Protocol.cpp: the JSON lines. One file per job: split a file rather than let it grow past a few hundred
                     lines. test-plugin/ has VST3s of our own to test with: a synth and an effect (a gain that
                     can also delay its sound and report it; tests set VAUDIO_TEST_EFFECT_LATENCY).
electron/          The desktop app (Vaudio). main.ts: runs the server (electron/server.ts, the same createApp) in the
                     main process and shows the page in a window; packaged, data is in userData, in development ./data.
                     panels.ts: the editor's windows as windows of the system (the page opens them with `window.open`;
                     this makes them frameless and floating, shows, hides and places them). floating.ts: which windows
                     float (the app is in use while one of its windows, or a plugin's, has the focus). stacking.ts: the
                     order of the floating windows, ours and the engine's, put back after the app was away.
                     hover.ts: macOS gives a window without the focus no mouse-moved events, so the pointer is told to the
                     window of ours under it (the main window's toolbar shows hover while a panel is in use).
                     gl-window.ts: the export's compositor page in a hidden window (`setGlPageOpener`), so no Playwright.
                     shell-path.ts: the login shell's PATH (Finder-launched apps get a bare one). preload.ts only marks
                     the page (`html.desktop`: drag regions, room for the window buttons in src/index.css). On
                     Windows the window has no system title bar or menu bar: its buttons are the system's, drawn over
                     the page's top-right corner (`titleBarOverlay`), in the colours preload.ts reads off the bar there.
                     scripts/desktop.ts bundles it with esbuild: the packaged app ships no node_modules.
src/
  suites/            Each suite in the tab (ClientSuite): open/close its store, its Workspace, Home card line, the
                     assistant's side (message context, chat texts, tool handlers). index.ts is the registry;
                     video.ts plugs in the video editor; music/ is the music editor: store.ts (the song, undo,
                     autosave), ui.ts (selection, which windows are open and where), engine-sync.ts +
                     transport.ts (the engine follows the song; where it's playing), window.tsx (`MusicWindow`
                     and `MusicDesktop` on the platform's windows), channel-rack.tsx, rack-actions.ts (what its menus and keys do),
                     channel-settings.tsx (a sampler's window), channel-picker.tsx (the +: choose an
                     instrument), knob.tsx, lcd.tsx, waveform.ts, browser/ (the Browser, Alt+F8: a panel
                     kept on the desktop's left; its rows and keys are pure, tree.ts and keys.ts),
                     pattern-picker.tsx, gross-beat/ (Gross Beat's window, its mapping panel and tools), echo-boy/
                     (EchoBoy's window, Tweak, the Style Editor, Rhythm Echo's editor, its tools),
                     auto-tune/ (Auto-Tune's window, its live pitch graph and tools),
                     pro-q/ (Pro-Q's window: its display, gestures, band controls, analyzer, EQ Match, tools),
                     ott/ (OTT's window: its knobs, its display of a row a band, tools),
                     panman/ (PanMan's window, its editors, meters and tools),
                     pitch-wheel/ (Pitch Wheel's window: its dials and keyboard on canvases, what the engine
                     says in live.ts, its tools), reverb/ (the Reverb's window: its Decay and Shape displays,
                     knobs, the advanced and vocal panels, what the engine says in live.ts, its tools),
                     toolbar.tsx (FL's toolbar: transport, PAT / SONG (mode-switch.tsx),
                     tempo and position LCDs, the hint bar; its maths in position.ts), recording.ts (armed
                     tracks, Record, takes into the song) and inputs.ts (the input device's channels), midi.ts
                     (MIDI keyboards' target, the keys held, the typing keyboard), playlist/ (the
                     Playlist, F5: see "The music suite"), automation/ (automation clips: see "The music
                     suite"), playhead.ts (where the song and the shown pattern
                     are now), settings.tsx (its section of Settings: the device, and
                     engine-panel.tsx, the plugin bench), keys.ts, api.ts, and the assistant's side (tools.ts, tool-edits.ts,
                     context.ts).
  lib/document-history.ts, autosaver.ts   Undo (with gestures) and autosave for any suite's document; music uses
                     them, the video editor still has its own in stores/editor.ts and stores/autosave.ts.
  stores/projects.ts The recents (every suite) and which one is open (`openId`, in the URL; null is Home); hands it to
                     its suite. Opening and closing one tell the server (`opened`, `closed`).
                     `tabs` are the open projects as a strip along the window's top (`components/home/project-tabs.tsx`,
                     the order and edits in pure `stores/project-tabs.ts`, kept in localStorage): switching is just
                     `open` (the one left is flushed and its store closed, so it reloads: no per-tab state yet). The
                     strip shows with two tabs, or on Home with one; then it starts the window (the Home button and a
                     Mac's window buttons move into it: `[data-tabs]` in index.css, `tab-strip` in electron/main.ts).
                     ⌘W closes a tab (the File menu's Close Tab; ⇧⌘W the window), ⇧⌘[ / ⇧⌘] and ⌃Tab go through them.
  components/home/   The Home screen (home.tsx: New tiles, Open…, the recents as cards in project-card.tsx, search
                     and suite filter), the corner's Home button, Open… / Locate… (open-project-dialog.tsx: the
                     desktop app's dialog, else a path), the New project picker (⇧⌘O) and ⌘P's search, and the
                     app's project keys (project-search-dialog.tsx `useProjectShortcuts`: ⌘O, ⇧⌘H too).
  stores/editor.ts   THE video document store: project, assets, selection, undo history, gestures, edit commands.
  stores/autosave.ts, asset-polling.ts   Side effects of the editor store (kept out of it).
  stores/playback.ts The playback clock (rAF). layout.ts = panel/tool UI state.
  stores/library.ts  The Library (folders, items, their media) and how its tab is browsed.
  lib/api.ts         Typed client for every endpoint. lib/edit-gesture.ts, lib/pointer-drag.ts (see below).
  lib/text-render.ts Text layout (the browser's text engine measures it in any installed font); used by the preview,
                     the export (`export/layout-texts.ts` sends layouts) and the canvas text editor.
  components/preview/engine.ts   Imperative preview: drives hidden <video>/<img> and draws with the compositor.
  components/preview/sync.ts, placement.ts   Its pure planners (tested). The engine plans each sequence as a `Level`
                     (a nested one draws into a compositor group), with media elements per `previewSlots` id.
  components/properties/graph-editor.tsx   The graph editor (value/speed graphs, Bézier handles; maths in graph-geometry.ts).
  components/preview/path-overlay.tsx   Paths on the Program monitor (masks, drawn shapes): the pen, rectangle and ellipse
                     tools, vertices and handles (pure maths in path-geometry.ts; which path is edited: stores/path-editing.ts).
                     transform-overlay.tsx also draws the motion path (keyframe dots and spatial handles).
  components/timeline/  Timeline UI; geometry.ts is its pure maths, view-store.ts its interaction-speed state.
                     markers.tsx: markers on the ruler and on clips, with their editor (stores/markers.ts).
  components/properties/  Spec-driven properties panel (param-rows.tsx renders any ParamSpec), the stopwatch and
                     navigator (animation-controls.tsx), the keyframe lanes (keyframe-lanes.tsx, pure maths in
                     keyframe-geometry.ts, selection and the keyframe clipboard in keyframe-selection.ts) and a
                     property's expression (expression-row.tsx: the script, its pick-whip, examples).
  components/captions/   Auto captions window, engine picker/setup, the Captions tab. State in stores/captions.ts.
  components/library/  The Library tab, its cards, dialogs and the Save to Library window, folder drop targets.
  components/workspace/video-desktop.tsx   The video editor's windows (`stores/video-windows.ts`), over it: export,
                     video settings, Auto captions, Save to Library. Its panels stay docked (docs/windows.md).
  components/effects/  The Effects tab: video effects and transitions (library-grid.tsx is their shared search,
                     category chips and cards; thumbnails.ts draws every card with one shared compositor).
  components/workspace/workspace.tsx   The main column: the open project's suite's Workspace, or the empty state.
  components/workspace/video-workspace.tsx   The video editor's (header, its docked panels, assistant).
  components/windows/  Floating windows, FL Studio's way, for every suite (docs/windows.md): `FloatingWindow` on a
                     `Desktop`, a store per desktop (`createWindows`: places, stacking, snaps), the maths in
                     geometry.ts. The music editor's desktop is one; the app's (`stores/app-windows.ts`, drawn by
                     App.tsx over everything) holds Settings. In the desktop app a `native` Desktop's windows are
                     windows of the system (native/: panel-window.ts opens one and dresses it in the page's theme,
                     styles.ts mirrors them, popups.ts is the one window menus are drawn in, geometry.ts the screen
                     maths, use-panel.ts the hooks). lib/window-events.ts is how code says which window it means
                     (see "Windows" below); shared/panels.ts names them.
  components/settings/  Settings (⌘,, `stores/settings.ts`): a window on the app's desktop, as FL's, with a tab for
                     General (the theme and fonts: `stores/theme.ts`) then one per suite (`ClientSuite.settings`;
                     video's is `src/suites/video-settings.tsx`, music's `src/suites/music/settings.tsx`), each
                     ending with where its new projects start. ⌘, opens it on the open project's suite. It doesn't
                     block the app under it, but keeps its keys (`keepsKeys`: the editors' shortcuts check
                     `keptByWindow`). Built from
                     `settings-ui.tsx` (`SettingsGroup`, `SettingsRow`). A preference goes here, kept where
                     what it changes lives (`stores/video-preferences.ts` for the video editor's own).
  components/dock/   Docked panels, Premiere's way, for any suite (docs/windows.md): model.ts (the layout: splits of
                     tab groups, floating panels; its edits are pure and tested), store.ts (`createDock`: the layout
                     remembered in localStorage), dock-area.tsx (`DockArea`: tabs that drag onto another group's tabs
                     or beside it, lines that resize, each group's menu: float, workspaces, Reset layout; a panel's
                     `header` in its group's tab strip, as the Timeline's sequence tabs;
                     `FloatingPanels` on a desktop).
  components/workspace/video-panels.tsx   The video editor's panels (`VIDEO_PANEL_DEFS`): Media (This video | Library,
                     `MediaSource`), Online (YouTube and pasted links), Effects (Video effects | Presets | Transitions,
                     `EffectKind`, `KINDS`), Captions, Properties, Program, Timeline. Laid out by `stores/video-dock.ts`
                     (the default, Théo's: Media, Online, Effects and Captions as tabs on the left, the monitor, Properties on the right, the timeline
                     below; `VIDEO_WORKSPACES`). Effects and effect presets dropped on Properties go on its clips
                     (`properties/properties-drop.tsx`). Show one with
                     `showPanel` (also `showMedia`, `showEffects`), never by assuming where it is: it may be in any
                     group, or floating. Properties widens to 520 px while its keyframe lanes show (`useVideoPanelMins`).
  assistant/         Where agents' tool calls run (in the tab): tools.ts (every tool's handler), doc.ts (the video a call
                     acts on: the open one via the editor store, or a background copy), edits.ts (the pure timeline
                     edits, tested), describe.ts (what the model reads: timeline, clips, catalogue...), frames.ts
                     (Program monitor, a background video drawn offscreen, media frames), bridge.ts (the tab's event
                     stream; one call queue per video), context.ts.
                     layout.ts: what `get_layout` reports (clips' boxes on the canvas in px, a text's letters).
  stores/assistant.ts  The side panel, the open video's chat, every chat's activity (Home's cards), provider status, live
                     activity, clip highlights, confirmations, Revert.
  components/assistant/  The chat panel (right, full height), the model + thinking pickers, its steps, Markdown, the
                     header button, the preview pill. A card's chat status is components/home/chat-status.ts.
  components/ui/     shadcn/ui (generated; icons adapted to react-icons/pi).
```

Imports: `src/` uses `@/…` and `@shared/…`. `server/`, `shared/` and `scripts/` use relative paths **with the `.ts`
extension** (Node ESM through tsx).

## Suites

- A project's suite is fixed when it's made (`POST /api/projects { suite }`) and kept in its `meta.json`.
  `ProjectSummary` is a union on `suite`: common fields plus the suite's own (`SuiteSummaries`).
  A suite's preferences for new projects, kept in the tab (music's default tempo), go with it as `options`
  (`ClientSuite.newProjectOptions` → `SuiteBackend.withOptions`, applied to a copy of the starting point too).
  A suite can ask first (`ClientSuite.NewProject`, photo's New photo window): New opens it on the app's desktop
  (`useProjects.choosing`) and its choices become the `options`; closing it makes nothing.
- Everything suite-agnostic goes through the registries, keyed by `SuiteId` so TypeScript insists on every suite:
  `SUITES` + `SuiteDocuments` (`shared/suites.ts`), `SUITE_TOOLS` (`shared/suite-tools.ts`), `suiteBackend`
  (`server/suites/`) and `clientSuite` (`src/suites/`). Don't branch on a suite id anywhere else.
- `useProjects.openId` is the open project, of any suite. Opening one closes the previous suite's store and calls
  the new suite's `open`. `useEditor.projectId` is only the *video* store's project: use `openId` for anything
  that isn't the video editor (Home, assistant panel, bridge).
- The assistant: one chat per project, for every suite. The chat's suite decides the system prompt (`systemPrompt`
  around `SuiteBackend.assistant`), the MCP tools listed (`/mcp?chat=<id>`; outside clients get video's, or
  `?suite=`) and who runs the calls in the tab (`clientSuite(suite).runTool`). Tool names are unique across suites
  (tested). The panel (`AssistantPanel suite=…`) takes its texts from `ClientSuite.chat`.
- **Layering** (`server/architecture.test.ts` checks every import): the *platform* is what every suite stands on
  (projects, Home, assistant, storage, `components/ui`, `lib/api.ts`...: its `PLATFORM` list); a *suite* is its
  own folders (`shared/<suite>/`, `server/<suite>/`, `src/suites/<suite>/`), and video is everything else at the
  roots. A suite imports the platform and itself, never another suite; the platform never imports a suite except
  through a registry. So a new suite's routes go in `server/<suite>/routes.ts`, its client in
  `src/suites/<suite>/api.ts` (on `request` from `lib/api.ts`), its API types in `shared/<suite>/`: not in
  `server/routes/`, `lib/api.ts` or `shared/types.ts`, which are the platform's and the video editor's.
  Something two suites need (undo, autosave, ids) moves into the platform first; it isn't imported from video.
  The test's `DEBT` list is where the platform still reaches into the video editor: it may only shrink.
- Imports: import suites from `@/suites` (the registry), never a suite's module directly; they form an import cycle
  with `stores/projects.ts`, which is safe only because nothing uses `useProjects` at module level. Keep it that way.

## The music suite

A DAW modelled on **FL Studio**: when in doubt about its UX, do what FL Studio does (as video follows Premiere).
**What FL Studio does is written down in `docs/fl-studio/`** (from its manual, with its screenshots, and from
Théo): read the panel's document before touching that panel, don't work from memory, and write the document for
a panel before building it. Each ends with where we still differ.
Built so far: the channel rack (sampler and plugin channels, the step sequencer and its graph editor, patterns,
swing), the Piano roll, the Playlist and song mode, the transport and the metronome, the mixer, the Browser,
the export, automation, recording, MIDI input, Gross Beat, EchoBoy, Auto-Tune, Pro-Q, PanMan, Pitch Wheel, OTT, Pro-C, Reverb. Where it is and every step still to come, in order:
`docs/music-suite.md`. The app's new look (both suites), in progress: `docs/ui-redesign.md`.

- The document (`shared/music/types.ts`): `MusicProject = { settings: { tempo, timeSignature, swing, volume, scale? }, channels,
  patterns, playlist, mixer, automations }` (`volume` is the toolbar's main volume, folded into the master's gain by `compileSong`). A `Channel` is a sampler playing one of the project's media (`sampleId`), prepared first by its
  `precomputed` effects (trim, reverse, normalise, fades); a `Pattern` has `notes[channelId]`, sorted by `start`,
  and a `length` that's null for FL's Auto: use `lengthOf`/`patternSteps`, never the field. Solo isn't a field:
  it's a state of the mutes (`soloChannel`).
- A channel is a sampler or a **plugin channel** (`kind: "plugin"`, `plugin: { id, name, format }`): an instrument
  plugin (VST3, Audio Unit) the engine hosts for it. The engine keeps one instance per plugin channel across the
  song's edits (`engine/src/Host.cpp`), loads it in the background (the channel is silent until then;
  `EngineStatus.channels` says loaded, loading or failed), plays the pattern's notes into it as MIDI (moved by
  the channel's PITCH in whole semitones), and shows its own window when the channel's button is clicked. Its
  settings window is FL's wrapper (`plugin-tab.tsx`): the channel's knobs, and the plugin's presets (its own
  programs, and the user's saved in the engine's data folder, `PluginHost::savePreset`; `/api/engine/presets`). **A plugin's settings aren't in the document**: they're
  a file beside it in its package (`<project>.vaudio/plugins/<channel id>.bin`), written by the engine every few seconds when
  they've changed, when the channel is removed (so undoing that brings the plugin back as it was) and when the
  engine quits. So what's turned inside a plugin's window isn't an undo step, as in FL Studio. **Musical time is whole ticks, `PPQ` (96) to a quarter note**, never
  seconds; a step is `STEP_TICKS` (24). A step of the sequencer is simply a note starting on the grid
  (`stepNotes`), so the piano roll will edit the same notes.
- Edits are pure functions in `shared/music/edits.ts` that return the same instance when nothing changes, exactly
  like the video editor's. The store (`src/suites/music/store.ts`) keeps a `DocumentHistory`: `commit(edit)` for a
  one-shot edit, `songGesture()` for a drag (one undo step). Which pattern is shown and which channel is selected
  are UI state, not the song.
- **The mixer** (`docs/fl-studio/mixer.md`): `mixer.tracks` is the master (always first, `MASTER_TRACK_ID`) then
  the insert tracks; a channel plays into one (`Channel.mixerTrack`, by id, so moving tracks keeps the routing).
  A track has `EFFECT_SLOTS` effect slots (null is empty) and `sends` (post-fader, the master's by default).
  Sends never make a loop: `normalizeMusicProject` drops one and `setSend` refuses it (`canSend`), so
  `compileSong` can always order the tracks (`trackOrder`: each after its senders, the master last). Its edits
  are in `shared/music/mixer.ts`. An effect's settings are a file like a plugin channel's, by the effect's id:
  the engine has a second `PluginHost` for the mixer's effects (keyed by effect id, `EngineStatus.effects`,
  the `effectEditor` command), and each track runs its loaded, enabled effects in order before its fader,
  blending by its mix (`Sequencer::runEffect`). Plugin delay compensation is the engine's (only it knows the
  plugins' delays): `Song::compensate` walks the tracks in order, every path into a track (a channel through
  its instrument, a send) waits for the latest one in a `DelayLine` (`Delay.h`, handed on to the next song
  while its length stays the same, so edits don't empty it), and `songLatency` (in `outputLatencyMs` too)
  keeps the playhead in time. A plugin changing its delay makes the song again (`checkLatencies`). A track's
  `latencyOffset` (ms) is FL's manual compensation, added to what its plugins report.
  A track's invert, swap and stereo separation are folded into its gains in TypeScript (`stereoGains`), so
  the engine knows nothing of them. Copying a track's state copies its plugins' settings files on the server
  (`POST /api/engine/states/copy`) before the pasted effects (new ids) reach the engine. The Mixer window
  draws only the strips in view (`useVisibleStrips`): don't rely on off-screen strips being in the DOM.
  Plugins are chosen in one picker (`plugin-picker.tsx`, its model in `plugin-groups.ts`: groups from the
  plugin's reported category, pins in localStorage) for the rack's + and the effect slots. It lists our
  built-in ones and the plugins starred in the Plugin manager (`plugin-manager.tsx`, its More plugins…;
  the stars are `plugin-favourites.ts`, this computer's), FL's favourites. An effect slot dragged onto
  another strip moves the effect there, ⌘-drag copies it (onto a slot too; `effectToTrack`).
  The mixer's look is its own theme tokens (`--mixer-*`, `--fader-*`; knobs everywhere use `--knob-*`), FL
  Studio's colours: use them in the mixer rather than the app's surfaces. A track's `dock`, `separator`,
  `folded` and `group` (`Mixer.groups`) are only how the mixer shows it; they route nothing (a group's
  `linked` links its controls in the window; its `vca` fader is folded into its tracks' gains by
  `compileSong`). **Solo** is `MixerTrack.solo`, never a rewrite of the mutes, and follows the routing
  (`shared/music/solo.ts`: `heardMixer` is what `compileSong` plays, `hearing` what the strips show). A
  send can be `preFader` (the engine keeps the track's sound before its gains for it). A selected strip's
  controls act on every selected track (`menuTargets`; `controlTargets` adds linked groups).
  The Mixer window is `src/suites/music/mixer/` (F9): `mixer-window.tsx` (strips, the send row, menus),
  `inspector.tsx` (effect slots), `fader.tsx`, `meters.ts` (one animation loop draws every strip's meter from
  `useTransport().meters`; the falling in `meter.ts`, tested), `actions.ts` (what menus and keys do), `keys.ts`
  (its keys while it's in front), `track-selector.tsx` (the rack's and a channel window's track LCD). The
  selected tracks are UI state (`selectedTrackIds`; the first is the one sends are made from).
- **Sidechains** (`docs/sidechain.md`; `shared/music/sidechain.ts`, `mixer/sidechain-menu.tsx`): any effect
  slot can have a key (`MixerEffect.sidechain`: a track and a tap, `preFx` / `postFx`, the default / `postFader`).
  **A key is routing**: it orders the tracks as a send does (`routeOf`, used by `reaches`, `canSend`, `canKey`,
  `trackOrder` and the engine's stages), so it never makes a loop; no 0% send is needed. Edits that move or
  remove tracks or effects end with `withValidKeys`. The engine keeps taps as buffers of their own
  (`preFxBuffer`, `preBuffer`, `keyFaderBuffer` for a source the solo silences: `EngineTrack.keyGains`), treats a
  key as a path into its track in `Song::compensate` (a later key makes the track wait, an earlier one waits in
  the slot's `keyLine`), and hands the lined-up key to the effect (`Sequencer::keyOf`): Pro-C's External,
  Pro-Q's external dynamic bands (`EqBand.external`), a plugin's sidechain bus (turned on in `configurePlugin`,
  filled in `runEffect`; `EngineEffects.loaded[].sidechain` says which have one). Tested offline in
  `sidechain.integration.test.ts` (the test effect listens to its sidechain with VAUDIO_TEST_EFFECT_SIDECHAIN).
- **Modulators** (`docs/sidechain.md`; `shared/music/modulation.ts`, `src/suites/music/modulation/`): FL's Peak
  Controller, generalised: `MusicProject.modulators`, each following a track's tap or a channel's notes and
  moving its `links` (any `AutomationTarget` but the tempo, one modulator a control) by an amount of their range
  from their own value (or automation's): Bitwig's add, not FL's replace. **What a value means stays in
  TypeScript**: `compileSong` sends a modulated lane as a grid over the modulator's level (`steps` sets of
  values a point, `base` at the own values; a plugin parameter's lane an `amount`), in both modes. The engine
  follows each modulator after the mix (`followModulators`, its state kept by id) and drives modulated lanes
  every `modSlice` (64) samples, playing or not, from the level at the end of the slice before
  (`applyModulated`): a slice behind the source, so modulation needs no track order (it isn't delay-compensated).
  Every automatable control gets Modulate ▸ through `AutomationMenuItems`; `useAutomatedControl` shows the live
  value (levels from `EngineTransport.modulators`) and `SongKnob` the ring. Tested offline in
  `modulation.integration.test.ts`, including block-size independence.
- What volume, pan, velocity and swing *mean* is decided in `shared/music/compile.ts` (`compileSong` → `EngineSong`:
  gains, swung ticks), in tested TypeScript. The engine only plays samples at the moments it's told. Add musical
  rules there, not in C++.
- **The Piano roll** (`src/suites/music/piano/`): notes have an `id` (a small number, unique in their list: what's
  selected is a set of them), `pan` and `muted`. Its operations are pure functions of a note list in
  `shared/music/notes.ts` (move, clone, duplicate, quantize, glue, chop, slice, stretch...: tested, including with
  20 000 notes), applied with `editNotes`. The window draws on canvases (`draw.ts`) once a frame when something
  changed; only notes in view are drawn (`visibleRange`). **A drag doesn't edit the song while it lasts**: it's a
  `PianoDrag` in the Piano roll's store, which the canvas draws the notes through (`applyDrag`, the same function
  that commits it), and it becomes one edit when it's let go (`commitDrag`). Keep new gestures that way. Its maths
  is `geometry.ts`, its mouse `pointer.ts`, its keys `keys.ts` (run by the workspace while it's the front window),
  its commands `actions.ts`. The time selection is what the engine loops (`SetSongRequest.loop`; the engine's
  ticks then count from the loop's start: `patternTickNow`), and a ruler click is where play starts
  (`play { from }`; sent while playing, the engine goes there at once). Its look is FL's, in colours of its own
  for each theme (`readPalette`): don't take the page's theme colours for the grid or the notes. Each tool has its
  pointer (`cursors.ts`, picked by `gridCursor`; a drag sets the canvas's own while it lasts), and deleted notes
  fade out (`fades.ts`: call `fadeOut` wherever notes are deleted). The song's `scale` (`shared/music/scales.ts`)
  lights its rows and snaps notes drawn, stamped and moved (Alt: not); the Stamp places its chords, and the
  Quantizer (Alt+Q, `quantizeWith`) is previewed live as the Chopper is (both through the engine's song too).
- **A sampler's own settings** (`shared/music/sampler.ts`, the channel window's Envelope tab, `instrument-tab.tsx`):
  its loop, filter, swing mix and an envelope and LFO per target (pan, cutoff, resonance, pitch; the volume's
  LFO), each absent from the channel at its default (`samplerOf` fills them in; `samplerFields` checks a patch).
  The maths (`envelopeLevel`, `lfoValue`, `tensionCurve`, `cutoffHz`) is what the engine plays in
  `Sequencer::renderShaped`, the voices of a channel with any of it (others keep the plain path): keep the two
  the same, and test sounds in `server/music/sampler.integration.test.ts`.
- The tab sends the whole song to the engine on every change, even mid-drag (`engine-sync.ts` →
  `POST /api/engine/song`: the server normalises it, compiles it and turns sample ids into paths). The engine
  swaps songs without a gap. Where the song is comes back on an event stream (`/api/engine/events`, about 25 a
  second); the tab fills in between (`tickNow`) and shows it late by the output's latency.
- **Everything is a window** (`window.tsx`: `MusicWindow` on the `MusicDesktop`, the platform's
  `components/windows/`), as in FL Studio: dragged by its title bar, its edges sticking to the desktop's and
  other windows' (Alt: not), brought forward when touched, closed and reopened (`ui.ts` keeps which are open,
  `useMusicWindows` where they are and which is in front). A `resizable` one also resizes by its edges and
  fills the desktop (double-click its title, or drag it to the top) or half of it (drag it to a side); one that
  doesn't resize (the rack) goes to the corner and back on that double-click (`toggleCorner`); the Piano
  roll opens that way. The maths is `components/windows/geometry.ts`. A new panel is a new window, not a docked pane. One thing to know: a menu opened from inside a window is drawn
  elsewhere on the page but its React events still bubble through the window, so a handler on a container must
  check `currentTarget.contains(target)` before treating a press as its own (the title bar's drag does).
- **Mouse conventions** (FL's, and the ones to keep in every panel): the left button adds or turns on, the right
  button removes or turns off, and both paint when dragged (`startPointerDrag` takes `button: 2`). A control's
  right-click is its menu. Knobs are `Knob`/`SongKnob`, number displays `Lcd`: don't hand-roll either.
- What a menu item and its shortcut do lives once, in `rack-actions.ts`; keys are resolved in `keys.ts` (pure,
  tested) and run in `workspace.tsx`.
- **The Playlist** (`docs/fl-studio/playlist.md`, F5; `src/suites/music/playlist/`): `MusicProject.playlist`
  is numbered tracks (bound to nothing; `tracks` only as long as the last one changed) and clips
  (`PlaylistClip`: a pattern, an audio clip's channel or an automation clip, `start`, `length` (null: a pattern clip following
  its pattern), `offset` into its content (ticks of a pattern, **seconds** of an audio file), `muted`). Clip
  ids are small numbers, like notes'. Its operations are pure functions of a clip list in
  `shared/music/playlist.ts` (with a `ClipContext`: the patterns' lengths and the tempo, which a clip's
  length needs, and each audio clip's speed: a stretched one plays at its stretch's, so an audio clip's ticks
  become file seconds through `fileSecondsPerTick(clip)`, never `secondsPerTick`; its channel's pitch makes it
  higher or lower, never faster, as FL's does: the engine's stretcher shifts it, `audioPlayback`). An audio clip has its own `gain` and fades (`fadeIn`/`fadeOut` in ticks, their
  tensions: `fadeShape`, the engine's too), each absent at its default (`clipExtras` checks them). The
  window is built as the Piano roll is: canvases (`draw.ts`), a `PlaylistDrag` drawn
  through `applyDrag` and committed once, maths in `geometry.ts`, mouse in `pointer.ts`, keys in `keys.ts`,
  commands in `actions.ts`. An audio clip's channel is `Channel.kind: "audio"`, in the rack's
  Audio group (`RackGroup`), with a cut-down settings window; it has steps and notes too, as FL's (the
  engine reads its file into memory once notes play it, `playsNotes`, or it has precomputed effects;
  otherwise its clips stream it). Deleting a pattern or
  a channel takes its clips. A clip's colour is its source's (`Pattern.color`, `Channel.color`), else its
  track's; every clip colour is derived from one (`clipColours` in `draw.ts`). The clip menu's Preview
  sends the engine a song of that clip alone while it's held (`playlist/preview.ts`). Time markers
  (`Playlist.markers`, `shared/music/markers.ts`; Alt+T, in a band along the ruler) are named ticks, or Start /
  Stop recording markers (`punchRange`: recording keeps only what's between). Render as audio clip and
  Consolidate (`playlist/bounce.ts`) are an export with `bounce`: the server adopts its mix as the project's
  media and the tab places it.
- **Stretching audio clips** (`docs/fl-studio/playlist.md`, Stretching audio clips; `shared/music/stretch.ts`):
  an `AudioStretch` (`mode`: Resample or Stretch, the pitch kept; `tempo`: the song's tempo at which the file
  plays at its own speed, so a stretched clip follows the tempo) is a clip's own (`PlaylistClip.stretch`, FL
  2025's variant) or else its channel's (`Channel.stretch`); `ClipContext.stretchOf` says which, and
  `audioPlayback` what it means (speed, transpose, keep-pitch: the channel's pitch shifts without changing the
  time, in either mode; in Resample the stretch's speed moves the pitch too). Setting one keeps each clip's content (`setClipStretch`, `stretchChannel`); the
  Playlist's Stretch (Shift+M, `usePlaylist.stretch`) makes an edge a `stretch` drag (`stretchClips`).
  The engine stretches in `AudioStream` on its reader thread with Signalsmith Stretch (MIT, fetched by
  CMake, seeded so renders repeat), sought so the first sample out is the file's at its start: nothing is
  late (`stretch.integration.test.ts`). Detect tempo is `POST /api/engine/tempo` (`server/music/tempo.ts`,
  on the platform's `server/beats.ts`).
- **Song mode** (PAT / SONG, L): `useTransport.mode` (not saved: a song with clips opens in song mode),
  with a start tick per mode; `switchMode` sends the engine the other song and carries on playing.
  `compileSong(..., "song")` flattens the arrangement into notes (a clip plays nothing past its pattern;
  notes cut at its end; a note a slice went through plays from the slice) and lists `audioClips`; the loop is
  the song (to its last clip's bar) or the Playlist's time selection. The engine streams audio clips
  (`ClipPlayer`): streams are made ahead on the message thread, each for a play (`generation`) and a pass
  round the loop, and started on their sample; keep that when adding to it. `playhead.ts` says where the
  shown pattern is inside the song, for the rack's lights and the Piano roll's playhead.
- **The Browser** (`docs/fl-studio/browser.md`, Alt+F8): the user's own sample folders (its Files tab), global, not the
  song's (`data/browser.json`, `server/music/browser.ts`; the tab's open folders and width are localStorage).
  The server reads nothing outside the folders added. It's a panel kept on the desktop's left
  (`browser/browser-panel.tsx`), outside the `Desktop`, so the windows keep to the room beside it; e2e
  tests that measure windows open songs with it closed. A file reaches a song as project media through
  `POST /api/browser/use` (copied once, by `origin`); a drag of its files carries their paths
  (`BROWSER_DRAG_TYPE`), and every drop target goes through `browser/drops.ts`, which takes Finder's files
  too. Previews are the engine's `FilePreview` (streamed), not the song's. Its **Online** tab (`browser/online-tab.tsx`)
  searches YouTube or takes a pasted link (the platform's `server/web-media.ts`, yt-dlp): wherever the Browser hands
  a sample round it's a string, a file's path or a clip's URL (`browser/online.ts`), and `/api/browser/use` and
  `/preview` take either (`url`), so a clip is dragged, sent and previewed as a file is. The download is kept in a
  format the engine reads (else made a WAV) and copied into the project once (`MediaAsset.origin`). e2e plays
  yt-dlp with `e2e/fake-ytdlp.mjs`.
- The starter kit (`public/kit/`, made by `scripts/make-kit.ts`) becomes ordinary project media when it's added.
- **Exporting** (`docs/fl-studio/export.md`, ⌘R / ⌘⇧R; `src/suites/music/export/`): the save dialog
  (`chooseSaveFile`, the desktop app's; a browser downloads instead), then the window, then
  `/api/music/exports` (`server/music/exports.ts`): the engine renders 32-bit float WAVs (the mix, and a
  stem per track) and ffmpeg encodes each format; MIDI is written from `compileSong`. The engine renders
  in the running engine (its plugins are loaded): it lets go of the device, plays a copy of the song once
  (`Song::loops` false) with a sequencer of its own, plugins prepared for blocks of 2048, told they're
  offline and run on every core (`Sequencer::setWorkers`; the mixer in `Song::stages`), then gives the
  device back. Meanwhile the tab edits on (`useTransport.exporting` stops play), and songs sent wait for
  the end. The song's plugin delay is trimmed and stems held back to the master's lateness: they add up
  to the mix, sample for sample (tested). Parallel and one-thread renders are identical (tested); keep
  it so: a stage's tracks touch only their own buffers, sends are added in order after. The mix is floating
  point and can go over full scale and still sound clean live (the system volume turns it down first); a
  file would clip, so a render that goes over is turned down as a whole (`exportGain`, `preventClipping`).
  Wrap remainder renders ringing out, then adds the tail onto the start (`server/music/wrap.ts`).
- **Automation** (`docs/fl-studio/automation.md`; `shared/music/automation.ts`, `src/suites/music/automation/`):
  an automation clip (`MusicProject.automations`) is a curve for one control (`AutomationTarget`: a
  channel's volume or pan, a mixer track's fader, pan or stereo separation, a send, an effect's mix, the
  main volume, a plugin's parameter by the id the plugin gives it); its clips on the playlist
  (`kind: "automation"`) share it. **It plays in song mode only**, and what a control is at a tick follows
  from the song alone (`controlAt`): its own value before its first clip, the curve inside one (the latest
  started wins), the last value after one. `compileSong` turns it into lanes in the engine's units (a
  channel's gains, a track's matrix...), sampled within a thousandth; the engine plays them in slices of
  256 samples counted from where play started (`Sequencer::applyLanes`), so live and exported sound the
  same whatever the blocks: keep any new lane kind on that grid. A control held by the hand is left out
  (`SetSongRequest.held`, from `useAutomatedControl`'s hold/release); a plugin's own value is taken when play
  starts and given back when it stops. A knob or fader that can be automated takes a `target`
  (`SongKnob`'s), which gives it Create automation clip and has it follow the curve in song mode (a knob
  that turns by its automation's fraction, a tapered one, says `fraction`). Its curve is edited on its
  clips in the Playlist (`curve-pointer.ts`, a `curve` drag committed once). **Every knob of our built-in
  effects is automatable**, as a plugin's every parameter is: a new knob in one gets a `target` (its
  control in the effect's `AutomationTarget` kind, a spec saying its range, taper and text, the engine
  lanes it moves), and `e2e/music.spec.ts` right-clicks every slider of every built-in's window to check
  it. Touching one shows **Automate "…"** in its window's title bar (`AutomateTouched`,
  `useAutomationUi.touchedControl`), as a plugin window's does. An engine lane holds up to
  `Song::Lane::maxSize` (64) values a point. FL's Step and Slide modes are the
  Playlist store's `curveStep`/`curveSlide`. **Tempo automation** (`shared/music/tempo.ts`): the engine
  keeps the song's own tempo and is sent a song warped through the tempo clips (`warpSong`); the server's
  `SongClock` converts every tick crossing to or from the engine, so the tab and the document only ever
  hold the song's ticks. Seconds from a tick in song mode: `songSeconds`/`engineTick`, never
  `secondsPerTick` alone.
- **Recording** (`docs/fl-studio/recording.md`, FL's through mixer tracks): a track's `input` (a device
  channel or a pair), `monitor` and `inputOffset` are the song's; **which tracks are armed, Record (R) and a
  recording in progress are the tab's** (`recording.ts`), sent with the song (`SetSongRequest.armed`). Settings
  opens an input device (and the desktop app asks for the microphone first: the engine opens no input until
  one is chosen). The engine adds a monitored input into its track before the effects, and `Recorder`
  writes each armed track's dry input: files opened ahead on the message thread, written through a
  `ThreadedWriter`'s FIFO, switched to a spare on the sample a loop goes round (plus the latency), never
  opened or closed on the audio thread; keep it so. Play with a count-in holds the transport while it
  clicks; without Loop record the song doesn't wrap while recording (`through`). Finished takes come as
  `take` events; the server makes them the project's media (`adoptTake`), and `addTakes`
  (`shared/music/recording.ts`) places them, the latency left out (`takeWindow`), a recording's takes one
  undo step. A Playlist track can be an insert's audio track (`PlaylistTrack.mixerTrack`): its takes land
  on it. The transport doesn't import the recording store (a cycle through the song's store): recording
  registers itself with it (`setRecorder`). Offline tests feed a WAV as the device's inputs (`render`'s
  `input`). If the engine dies mid-recording, the server mends the takes it was writing
  (`server/music/take-repair.ts`) and hands them in itself (`AudioEngine.salvage`).
- **MIDI input** (`docs/fl-studio/midi.md`): the engine listens to every MIDI input not turned off
  (`MidiInputs`, `midi.json` in its data folder) and plays it on the **MIDI target**, the rack's selected
  channel (`midiTarget`, sent by `src/suites/music/midi.ts`; packed with the song's serial so a song
  handed over meanwhile keeps it). Messages reach the audio thread through a lock-free queue (MIDI's
  threads take a spin lock among themselves only); a key's note off goes to the channel its note on did.
  `midiIn` puts messages in the same queue: the typing keyboard (Ctrl+T, `typing-keyboard.ts`) and the
  tests play that way, so everything played is lit and recorded alike. What was played comes back as
  `midi` events with the engine's tick; while recording (Record with nothing armed records notes alone)
  the tab keeps them, and on stop `recordedNotes`/`addRecordedNotes` (`shared/music/recording.ts`) make
  them one undo step in a pattern placed where recording started. Tested offline in
  `server/music/midi.integration.test.ts`.
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
- **Resampling** (`engine/src/Resampling.h`; Settings' Quality): how samplers and audio clips read between
  samples. Playback's choice (Hermite by default) comes with each song (`SetSongRequest.resampling`), the
  export's (sinc) with the export. Every method is centred: a hit is never late (tested).
- **Audio intelligence** (`docs/audio-intelligence/`: the plan is `audio-engineering-harness.md`, its slices
  `implementation-backlog.md`): giving the assistant truthful ears and hands. **A/B, D retrieval/workflows and bounded
  F package intake are built. C infrastructure and its held-out benchmark (`scripts/hearing-benchmark.ts`,
  `hearing-pack.ts`, `docs/audio-intelligence/hearing-benchmark.md`) are built and run; no listening task is promoted: the
  local measurements (`loudness.ts`: BS.1770 LUFS, EBU range, true peak; `spectrum.ts`: band balance, timed loudness and
  tone changes) are the ears. E's vocal run is built (`vocal-analysis.ts`, `vocal-mix.ts`, see below); G/H are planned.** `shared/music/audio-intelligence/` holds the contracts, all plain JSON, immutable, identified by a
  hash of what's in them (`shared/music/hash.ts`; their ids are fixed values in `identity.test.ts`: changing what
  is hashed orphans every stored record, so it's a schema change): `MixSnapshot` (`snapshot.ts`: the song's parts
  by hash, its media and plugins' state files by hash, and a `coverage` that says what couldn't be captured, so a
  capture never looks complete when it isn't; `diffSnapshots` is the stale check), `AudioArtifact` (`artifact.ts`:
  audio by content hash, its passage on the song's clock, what was done to it, and per-use permissions that start
  private), `EvidenceReport` (`evidence.ts`: measurements, observations and hypotheses kept apart, each naming its
  method or source, and what was inspected), `AudioJob` (`job.ts`: the state machine, cancel, retry, restart
  recovery) and `MixRun` (`run.ts`: phases and the budgets the service enforces whatever the agent asks).
  Validators refuse a record, never repair it, and check the id against the content. `families.ts` splits by
  recording family (a mix joins its sources' families) and `fixtures.ts` is the cleared collection, synthetic
  audio whose levels and correlations are known by construction. `server/music/audio-intelligence/` reads the
  files the pure builder can't (`captureSnapshot`, `FileHasher`). **Unknown stays unknown**: a null, a coverage
  gap or `unverified` is never filled with a guess (a plugin's version isn't recorded by the engine today, so
  a snapshot with outside plugins is `partial`; `docs/audio-intelligence/engine-render-limits.md` lists what a
  render can and can't promise: it starts cold, takes the device, and uses the live plugin instances).
  Slice B (`render-and-measure.md`) adds `AudioIntelligence` (`server/music/audio-intelligence/service.ts`):
  project-scoped source copies, artifacts, reports and durable jobs under `data/audio-intelligence/`. Capture uses
  the chat's live tab; render/analyse/status/cancel/retry/report/registration dispatch on the server via the
  platform's optional `AssistantOptions.serverTool` callback (wired in `app.ts`), so closed tabs don't lose jobs.
  Running jobs recover as interrupted; retry is explicit and bounded. Built-in-only song-mode renders share the
  engine's export queue and use a trusted resolver for immutable source copies. Measurements (`measure.ts`)
  inspect only passage frames, keeping lead-in/tails intact; no hosted hearing or musical opinions. A render can keep a
  track's stem (`stemTrackId`). E (`vocal-mix-workflow.md`): `create_vocal_mix_run` renders the beat (vocal muted) and the
  song with the vocal's stem, `analyseVocal` measures one against the other, `proposeVocalChanges` turns findings both
  passages share into bounded changes (fader, YT-C, YT-EQ: `applyVocalChange`; the fader is cubic, `faderMoved`), each
  rendered, measured, level-matched once (`levelMatch`) and compared at matched LUFS, on a `MixRun`; candidates are
  measured over the baseline's singing (`VocalAnalysis.sounding`).
  D (`workflows-and-examples.md`) adds curated workflow discovery, separately typed effect/decision/preference
  examples, reviewed use/context filters and source-backed profiles. `ExampleLibrary` stores project-local data
  separately from songs; references retain unknown units/intent and never become executable settings. F
  (`ordinary-package-ingestion.md`) adds `DatasetService`: bounded folder/ZIP imports, hash-preserved originals,
  durable import/review records, honest native extraction coverage, reviewed pair/tap/gain/latency context and
  profile/source links. `scripts/engineer-package.ts` is the local intake/review CLI. Only registered-ID inspection
  and analysis tools reach MCP; review/permission/profile writes are user routes. Native FLP/PTX/presets stay
  opaque until a tested adapter exists. Reviewed WAV excerpts retain parent/crop provenance and use B's local
  measurements; hosted listening additionally rechecks the dataset source's grant.
- The assistant's tools: specs in `shared/music/tools.ts`, handlers in `src/suites/music/tools.ts`, and their
  edits as pure `(song, input, env) => { song, text }` in `tool-edits.ts` (tested); the mixer's in
  `mixer/tool-edits.ts` (`findTrack`: by id, number, "master" or name; `describeMixer` is `get_mixer`). Channels
  and patterns can be named by id or by name. `describeSong` (`context.ts`) is what `get_song` returns.

### The audio engine

- Plugins are native code, so sound can't be made in the tab: the engine (`engine/`) is a native program the server
  starts on the first `/api/engine` call. It owns the audio device and the plugins, and opens plugin editors as
  windows of its own. The tab never gets audio, only a status (`EngineStatus`, polled: the meter, scan progress).
- The server talks to it in JSON lines (`shared/music/engine.ts`); the engine keeps stdout for that alone (plugins'
  prints go to stderr) and quits when its stdin closes. If it dies (a plugin crashed), the next command starts it
  again; what was loaded is lost until the song's document drives it.
- Stop pressed while stopped (`stop { reset }`, and every stop with Settings' Reset plugins on stop) is
  FL's way to silence the effects' tails: `Engine::silence` lets go of the device as an export does,
  resets every plugin, drops our effects' states (each registry's `clear`) and the delay lines, and makes
  the song again from silence.
- Commands run on the engine's message thread; the audio callback never waits. A song reaches it through an
  atomic pointer and goes back through a lock-free queue to be deleted (`Sequencer::setSong`, `collectGarbage`);
  requests are atomics and queues; the plugin bench has a lock the audio thread only tries (a block goes out
  without the bench if it's busy). Keep it that way: no allocation, locks or I/O on the audio thread.
- The mixer: a `Song` has its tracks in the order to run them (the master last) and allocates their buffers
  itself, when it's parsed on the message thread (`Song::audio`, as long as the engine's longest block).
  Voices and plugins render into their channel's track; `Sequencer::mixTracks` runs the tracks' gains and
  sends. The metronome is added after the master, outside the mixer. Gains glide over the first block of a
  new song: which track and send of the last song each one was is worked out in `setSong`, so the audio
  thread only copies by index. Meters: the audio thread raises each track's peak (after its fader) in
  atomics, and `takeMeters` takes them back to 0 for each transport event (`meters`, silent tracks left
  out) and for `render`.
- Samples are read whole into memory on the message thread and never dropped while the engine runs (`SampleCache`):
  a sounding voice holds a bare pointer to its sample.
  Long files are streamed instead (`FilePreview`, the Browser's preview so far): a `TimeSliceThread` decodes
  and resamples ahead into a ring the audio thread reads; offline, the rendering thread fills it. An audio
  channel's own preview (its waveform pressed) names its channel: the sequencer adds it where that channel's
  clips play (`ChannelFeed`), so it's heard through its mixer track's effects.
- `--offline` (`AudioEngine`'s `offline`) opens no device: `render` computes the next samples on request, as fast
  as it can, and measures them (or writes a WAV). `server/music/engine.integration.test.ts` tests what things
  *sound like* this way, with the real engine and the test synth, silently; it's skipped when the engine isn't
  built. Live and offline share one `Engine::process`, so add sound-making code there and test it offline:
  `server/music/sequencer.integration.test.ts` builds songs with the app's own edits, renders them to a WAV and
  checks where each hit lands, to the sample.
- A plugin's window is the engine's (`EditorWindow`), so it can't be inside the app's; it acts as if it were
  (`docs/fl-studio/plugin-window.md`): our own title bar; keys the plugin doesn't use come back as an `EngineEvent`
  "key" and the tab runs its editor-wide shortcuts (`resolvePluginWindowKey`: Space plays); and the desktop app
  tells the engine about itself (`HostWindow`, `followByPluginWindows` in `electron/main.ts` →
  `PluginHost::setHost`): plugin windows are at the **floating level**, the same as the app's own windows in the
  desktop app (the music editor's windows are windows of the system there, "Windows" below and `docs/windows.md`),
  so they stack among each other by use: a click raises whichever it lands on, and the rack can be in front of a
  plugin that is in front of the Playlist. While another program is in use they all drop to the ordinary level;
  they hide with the main window and move with it. The engine says when one of its windows is used (`EngineEvent`
  "editorFocus", and "foreground": the engine became the app in front) and raises one on request (`raiseEditor`;
  a request's parameters are flattened into the message with `id` and `cmd`, so a parameter can't be called `id`);
  `electron/stacking.ts` keeps the order of all of them and puts it back after the app was away. **On Windows**
  there are no levels: the desktop app sends its main window's HWND (`HostWindow.handle`), and plugin windows
  become that window's owned windows (`setWindowOwner` in `MacWindow.cpp`, the engine's one platform file): above
  it, not above other programs, minimised with it, no taskbar button (`EditorWindow::getDesktopWindowStyleFlags`).
- Keep it portable (it runs on Windows too): only JUCE's APIs, no macOS calls of our own, paths from the server.
  On Windows it's built with ASIO (Steinberg's SDK, fetched by CMake) and, until a device is chosen in
  Settings (`vaudioChosen` in its `device.xml`), opens an audio interface's own ASIO driver (`openDefaultDevice`):
  Windows' shared audio underreports its latency (takes land late) and clocks a USB interface's input apart
  from its output (crackles). Windows' drivers count the buffer in their output latency, Core Audio's
  doesn't (`outputLatency`).
- It's an app bundle (plugin windows need one) with no Dock icon, shipped in the desktop app's resources.
  The desktop app isn't signed, so loading other people's plugins needs nothing; once it's signed with the
  hardened runtime, the engine needs the `com.apple.security.cs.disable-library-validation` entitlement.
- JUCE is used under its free Starter licence (a personal tool); selling this changes that.

## Projects are files

- A project is a package, `Name.vaudio/` (`server/packages.ts`): `project.json`, `meta.json` (id, suite, dates),
  `media/<id>/` and whatever its suite keeps beside them. New ones go in the location (`~/Documents/Vaudio`; Settings ›
  General changes it; `EDITOR_PROJECTS_DIR`; a given `EDITOR_DATA_DIR` keeps them in its own `Documents/Vaudio`, so
  tests and throwaway setups never touch the user's). The server keeps the recents in `data/projects.json`: a path per
  project, and what was known of it, for when its package isn't there (`ProjectSummary.missing`).
- Media keep their URLs (`/files/media/<id>/...`), served from whichever package holds them (`MediaLibrary`'s
  `projectDirs`, `filesDir`): never build a path from a media id or a project id yourself. A project's own files are
  under `ProjectStore.dir(id)` (the audio engine's `projectDir` option); `DataPaths.projectDir` is the old layout.
- A package is named after its project, but **its folder isn't renamed while a tab has it open** (media being
  added, filmstrips being made, a song's plugin states and recordings are written into it): renaming changes the
  document, and the folder follows on `closed`, at the next startup, or at once for one that isn't open (Home's
  Rename, the assistant in the background). A busy one (`MediaLibrary.busy`) waits.
- Open… (`POST /api/projects/open`) takes a package from anywhere: one that is a recent's new place takes over (and
  its name becomes its folder's, if it was renamed in Finder); a copy of one that's here gets a project id and media
  ids of its own (`reId`). Delete is the Trash (Electron's `shell.trashItem` in the desktop app); a package inside the
  data folder (a starting point, a test's) is deleted.
- The desktop app declares the type (`fileAssociations`, a package Finder shows as one file), opens one
  double-clicked or launched with (`open-file`, argv) through `editorDesktop.openFile`, and lists opened ones in
  File › Open Recent (`app.addRecentDocument`). Its File menu runs the page's `DesktopCommand`s. Images dropped on its
  Dock icon (or Open With) start a photo (`IMAGE_TYPES`, an Alternate handler: Preview stays the default), read only
  through `read-handed-image`, which serves no file the system didn't hand the app.

## Data model (shared/types.ts)

- `Project = { version, name, settings: { aspectRatio, fps }, tracks, clips }`. All times are seconds (floats).
  Round the results of edits with `roundTime`.
- `tracks` is in display order: video tracks first (index 0 is drawn **on top**), then audio tracks. There's always at
  least one video track. Clips are placed freely (gaps allowed), never overlap on a track, and never start before 0.
- `Clip = { id, assetId, trackId, start, in, out, effects, transitionIn?, transitionOut?, speed?, reversed?, keepPitch? }`.
  `start` is timeline time; `in`/`out` are **source** time. Duration is `out - in` at normal speed. Stills and text have no source range, so their `in` can be
  anything, even negative.
- Speed: `Clip.speed` (absent = 1), `reversed` and `keepPitch: false` (absent = keep). Duration is
  `(out - in) / speed`, and a reversed clip runs from `out` down to `in`. Never do timeline<->source maths by hand:
  use `clipDuration`/`clipEnd`, `sourceTime`/`sourceAt` (what's shown), `sourceEdge` (where a cut or trim lands),
  `timelineTime` (inverse) and `sourceDelta` (in `shared/timeline.ts`). Only video and sound clips have a speed
  (`canRetime`). `setClipSpeed` ripples the rest of the track; `stretchClip` is the ⌥-drag rate stretch.
- A reversed clip plays its media's reversed copy (`MediaAsset.reversed`, made on demand by
  `server/derivatives.ts` `makeReversed`, requested by `requestReversedCopies` in `stores/asset-polling.ts`, awaited by
  the export). Source time `s` is at `fileTime(clip, s, duration)` in it. Media elements only play forwards, so the
  preview never plays a reversed clip any other way.
- Text clip: `assetId: ""` plus the Text and Appearance effects (`isTextClip`). The browser draws text in any installed
  font: the tab lays it out (`TextLayout`, only it can measure the user's fonts), `shared/text-drawing.ts` turns
  a layout and the style at a moment into a `TextDrawing`, and the compositor draws that with the 2D canvas at the
  size it's shown, in the preview and in the export's page alike. The export request carries the layouts
  (`ExportRequest.texts`), never pictures. Don't switch to ffmpeg `drawtext`.
- Clip kinds (`clipKind`): media, text, solid (`assetId: ""` + the Solid effect: a colour filling the canvas, drawn by
  the compositor; generator effects go on it), shape layer (`assetId: ""` + one or more Shape effects, type
  `vector-shape`, and shape operators between them, applied in order: `shared/shapes.ts`; its frame is the canvas,
  the canvas overlay's handles go around what it draws; shapes past the frame are drawn too: `VectorDrawing.bleed`) and adjustment layer (`assetId: ""` + `adjustment: true`: its effects,
  Motion and Opacity apply to everything below it; no transitions, and neighbours can't transition into it). Use
  `hasMedia` where code needs a media file. Solids and adjustment layers fill the canvas at 100%.
- Opacity has a `blendMode` and a `trackMatte` (the clip on the video track right above is its matte and isn't drawn);
  Motion has `edges` (none/mirror/tile/extend: what shows past the frame), `motionBlur` + `shutterAngle`, and
  `threeD` + `positionZ`/`rotationX`/`rotationY` (a 3D layer, seen through the topmost Camera clip: `camera.ts`).
  A keyframe's `influence` (0..1, absent = 1/3) is After Effects' ease velocity influence.
- `Clip.timeInterpolation` (blend | flow; videos only) is Premiere's Time Interpolation: the export decodes such a
  clip at its media's own frame rate (`RenderSource.native`) and sends the two frames either side of each moment;
  the preview plays it a frame ahead and keeps the previous frame (`PreviewEngine.keepFrame`). Both go through
  `Placed.interpolate`.
- Time effects (`EffectShader.history`: Echo, Posterize Time, Trails, Datamosh, Pixel Motion Blur...) read their
  earlier inputs, own last output and optical flow; the compositor keeps them per clip/effect by source time. They
  only exist while playing and in the export (frames drawn in order); paused, the preview shows the frame alone.
- Particle effects (`EffectShader.particles`) place particles in closed form from their birth, so any frame draws on
  its own. Effects that draw past the clip's frame ask for room (`EffectShader.grow`, `frameUv` in GLSL).
- `Effect = { id, type, enabled, params, keyframes? }`. Built-in effects (motion, opacity, volume) are on every clip,
  and Text/Appearance on text clips. All of these have `id === type`, and code addresses them by type.
- Video effects (a definition with a `shader`) are the ones the user adds: any number, in the order they're drawn,
  after the others in `clip.effects`, with ids `type`, `type_2`... Each runs over the clip's own picture before
  Motion places it (Premiere's standard effects), so blur sizes etc. are fractions of the clip's frame.
- Effects the user adds (`isAddedEffect`): video effects (a `shader`) and `stackable` ones (masks, a shape layer's
  shapes and operators, text animators). `orderEffects` keeps each kind together in `clip.effects` (built-ins, what
  the clip is, Time Remapping, shapes/animators, masks, video effects); `addEffect`/`removeEffect`/`moveEffect` work
  for all of them; `effectLabel` numbers several of a type ("Mask 2").
- A `path` parameter (`PathSpec`, a `BezierPath` in fractions of the clip's frame) is animatable: keyframes morph it
  (`lerpPath`). `ParamValue` includes paths: check `isPath` before treating an object value as anything else.
- Masks (`mask` effects) cut a clip's picture out before its video effects; on an adjustment layer they say where it
  changes what's below. `clipLayer` puts them on the layer (`masksAt`), so the preview and the export get them alike.
- Text animators (`text-animator` effects on text) reach the drawing through `textStyleAt` (`TextStyle.animators`, and
  `reach`: room the text's frame keeps for them, the same at every moment); `textDrawing` works out each letter's
  share and the compositor draws letter by letter, per frame, in the export too.
- Expressions (`Effect.expressions`, by parameter key; numbers and points only, never Volume): anything that draws
  must read values with `effectValuesAt(def, effect, time, clip)` (or `valuesAt`/`motionAt`..., which do), never
  `storedValuesAt`, which is the plain value the panel edits. `time` in an expression is the clip's source time.
  Its `fps` is the sequence's: whatever draws a sequence wraps the work in `atFrameRate(fps, ...)` (the preview's
  and the export's levels, the canvas overlay); a new place that draws clips must too.
- A point's keyframes can carry spatial handles (`Keyframe.spatialIn/Out`, the motion path): `keyframeValue` then
  travels the curve at an even pace by length (`spatialCurve`).
- Markers: `Project.markers` / `Sequence.markers` (timeline time; a sequence view's `markers` are that sequence's) and
  `Clip.markers` (source time). `snapPoints` includes them.
- Keyframes are stored in **source time** (so they stay on their frame when the clip moves, trims or splits). Read
  values with `sourceTime(clip, playheadTime)`; write them at `keyframeTime(clip, playhead, fps)` (the frame under
  the playhead, or an existing keyframe within half a frame), which every editing surface uses. A keyframe's `easing`
  says how it's passed through (Premiere's Ease In/Out, Hold); `easedProgress` is the curve.
- Transitions are stored on clip edges. At a cut, the outgoing clip's `transitionOut` wins. See
  `transition-windows.ts` for the rules, and use `storedTransition`/`findWindow`/`refKey` rather than reading fields.
- Nested sequences (`Project.sequences`, `shared/sequences.ts`): a clip plays one when its `assetId` is the sequence's
  id (`seq_…`); `sequenceAsset` describes it as a video (in the editor's `assets`, never sent to the server), so
  nested clips trim, retime and place like media. The editor store holds the whole video in `document` and the open
  sequence's view in `project` (identical on the main sequence); every edit is a `(Project) => Project` on the view,
  written back with `writeSequence`; undo history and autosave are documents. Anything that must see every clip
  (export texts, reversed copies, deleting media) walks `allClips`/`everySequence`. The preview plans nests as levels
  drawn into compositor groups (`beginGroup`/`endGroup`) and keeps settled nest frames; the export emits `group`
  frame layers and decodes nested clips natively (`planRender`).
- Time remapping: a clip with Time Remapping keyframes (`isRemapped`) runs its own clock at 1× (its `in`/`out` and all
  its keyframes are in it) and shows `mediaTime(clip, s)`. Anything that picks a media frame or sound must go through
  `mediaTime`/`remapSpeed` (preview `mediaOf`, export native runs and `soundPieces`), never `sourceTime` alone.
- Parenting (`Clip.parent`, `shared/parenting.ts`) and null objects (`nullObject`): `placer` takes a `parent` delta
  from `parentAt`; code that places clips must pass it (preview, export, canvas overlay).
- Dynamic easings (`overshoot`, `spring`, `bounce`; `isDynamic`) shape the stretch *arriving* at their keyframe and
  leave 0..1 (`dynamicProgress`); a Bézier handle on either side of the stretch takes over (`isDynamicSegment`).
- Keyframe Bézier handles (`handleIn`/`handleOut`, the graph editor) override easing on their side; `segmentHandles`
  is the curve's control points and `bezierProgress` evaluates it.
- Captions are text clips with `caption: true` (only valid on text clips; see `shared/captions.ts`). The Captions tab
  edits style for all of them (never their text or timing); Properties edits one. A caption's animation is a text
  animator stepping through its words at the times they're said (`SPOKEN_ANIMATIONS`, hold keyframes), or a
  transition on its `transitionIn`; only transition-animated captions end one frame before the next.
- Subclips (`Project.subclips`, `shared/subclips.ts`) are named parts of a media file made in the source preview
  (In/Out, ⌘U): listed in the Media tab after their file, and added to the timeline as that part. They point at the
  file (nothing is copied), are undoable edits, and go with their file. Their ids go wherever media ids do
  (`addAssetsToTimeline`, drag payloads, `useLibrary.addAssets`). While one is open in the source preview, its range
  is the In/Out there (`components/preview/source-marking.ts`); a file's own marks are browser state, not the video.
- Media (`MediaAsset`) belongs to one project. `kind` is video | audio | image. Filmstrip and waveform generation
  finish after import (`status: "processing"`).
- The Library (`LibraryFolder`, `LibraryItem`) is shared by every project and has its own media (`projectId: null`,
  a second `MediaLibrary` rooted at `data/library/media`, served at `/files/library`). An item is one file
  (`kind: "media"`) or saved clips (`kind: "clips"`, a `ClipTemplate`: tracks + clips pointing at Library media).
  Nothing ever references across: saving copies project media into the Library, and using an item
  (`POST /api/library/items/:id/use`) copies its media into the project, reusing a copy already there
  (`MediaAsset.origin`). Library media no item uses is deleted.

## Editing rules (src/stores/editor.ts)

- Every document change is a pure `(Project) => Project` from `shared/`. It returns **the same instance** when nothing
  changed; that's how no-ops skip the undo stack and autosave.
- One-shot edit: `useEditor.getState().commit(fn)`. Continuous edit (drag, scrub, typing): use `EditGesture`
  (`lib/edit-gesture.ts`): `begin` → `apply`* → `end`/`cancel`. The whole gesture is one undo step. Derive every
  preview from the gesture's base, never from the previous preview.
- Drags use `startPointerDrag` (`lib/pointer-drag.ts`), or on the timeline `startPointerSession`, which adds lane
  coordinates and auto-scroll. They handle capture, threshold, Esc/blur cancel and cleanup. Don't hand-roll window
  listeners.
- Selection is exactly one of: clips, a gap, a transition. Change it through the store's `select*`/`setSelection`
  actions, which clear the other kinds; don't `set({ selectedClipIds })` directly.
- Anything that isn't an undoable edit but changes the document (rename, deleted media) goes through
  `rewriteHistory` so undo can't bring back the old state.
- A preview derives from `gestureBase` whenever the edit is relative (e.g. `moveKeyframes` by a delta):
  `preview(update)` applies `update` to the *current* project.
- Autosave (`stores/autosave.ts`) saves the project when it changes outside a gesture: debounced, one request at a
  time, retried, and flushed before switching projects.
- UI state that changes at pointer speed (ghosts, snap guides, scroll) goes in `timeline/view-store.ts`, never in the
  editor store.
- Store subscriptions: select the narrowest value possible. Use `useShallow` for derived arrays, maps or objects.
  Never subscribe to all of `project` in something that renders during drags or playback.

## Performance (edits with thousands of clips)

Auto captions make hundreds of clips, so everything must scale with the clip count. Check with `scripts/perf.ts`.
- Nothing ever changes a `clips` array or a clip in place, so queries are cached per clip list (`perClipList` in
  `shared/timeline.ts`): `trackClips` (sorted, shared: don't mutate it), `clipsById`, `captionClips`. Add new
  whole-project queries the same way instead of filtering/sorting `project.clips` in a hot path.
- No O(n²): no per-clip `find` inside a loop over clips, and no `reduce` of one-clip edits (each copies the list).
  Batch them in one pass, as `setParams`/`updateEffect` do with a set of ids (`ClipIds`). Placement
  (`findFreeStart`, `moveClips`) sorts blocked intervals (`nearestFree`) rather than trying every edge.
- Store selectors run on **every** store update (each pointer move of a drag), so they must be cheap. Anything
  computed from the project belongs in a cached query, not in a per-row selector.
- The timeline renders only the clips in its visible window (`useVisibleWindow`) plus the one being pressed
  (`heldClipId`). Don't rely on off-screen clips being in the DOM. The same goes for transition markers.
- Long lists (the transcript) memoise their rows; each row subscribes to its own state (e.g. whether it's playing),
  so playback never re-renders the whole list.
- The preview uses a fixed number of media elements: an A/B pair per video track and per audio track, whatever
  the clip count.

## How to add…

- **A suite** (image, vector…): its id in `SuiteId` and `SUITES` (name, noun, picker line, what its assistant works
  in) and its document in `SuiteDocuments` (`shared/suites.ts`); its document type, `create`/`normalize` (tested)
  and tools in `shared/<suite>/`, listed in `SUITE_TOOLS`; a `SuiteBackend` in `server/suites/<suite>.ts` (+ its
  summary fields in `SuiteSummaries`, and what its assistant is told); a `ClientSuite` in `src/suites/<suite>/`
  (store, `lazy` Workspace that renders `<AssistantPanel suite=…>`, tool handlers). TypeScript lists what's missing.
  Then an e2e test that makes one from the picker. Music is the template.

- **A property on an existing effect**: add a spec to its definition in `shared/effects.ts`. The panel, validation
  and keyframing (stopwatch, lanes) then work automatically. Then apply the value where clips are drawn: preview
  (`components/preview/engine.ts` / `placement.ts`) and export (`server/render.ts`: `planRender`'s `draw`,
  `audioArgs`). Anything drawn should become compositor work (`shared/compositor.ts`) so both get it at once.
- **A video effect** (added by the user from the Effects tab): add a `videoEffect(...)` to a
  `shared/effect-library/*.ts` file (time effects in `time.ts`, particles in `particles.ts`). The GLSL defines `vec4 effect(vec2 uv)`; params become uniforms. See the
  prelude docs in `effect-gl.ts`, and give it `demo` values if its defaults don't read on a card. Then run the
  effect-sheet script. The panel, keyframes, preview and export then work with no other change.
- **A built-in effect**: add an `EffectDefinition` to `EFFECTS` (`builtIn` puts it on every clip it `appliesTo`), plus
  the same preview and export work as a property.
- **A new kind of parameter**: a spec type and a `sanitizeValue` case in `shared/params.ts`, a row in
  `components/properties/param-rows.tsx`, and display maths in `properties/display.ts` if it's numeric.
- **A preset**: add a `PresetDefinition` to `shared/preset-library/transitions.ts` or `effects.ts` (keys are fractions of
  its length; `common.ts` has the across/throughCut/spike shapes and MOVING). Transitions must end with every moved
  value back at rest (tested). Run the preset-sheet script and look at it.
- **A shape operator, or anything else added to clips without a shader**: an `EffectDefinition` with `stackable`
  (`shape` | `animator` | `mask`) in `shared/effect-library/`, listed in `EFFECTS`; evaluate it where its kind is
  drawn (`shapes.ts` `itemsAt`, `masks.ts`, `text-animators.ts`) with `effectValuesAt`; list it in the Properties
  add row (`AddEffectRow`) and in `describeCatalog`. The panel, keyframes, expressions and `add_effect` then work.
- **An expression function**: a global in `shared/expressions.ts` (`GLOBALS`, with its signature and description,
  which the assistant's catalogue and the tests read). Keep it pure and repeatable (seeded by the scope).
- **A transition**: add a definition to a `shared/transition-library/*.ts` file. The GLSL defines
  `vec4 transition(vec2 uv)`; params become uniforms. See the prelude docs in `transition-gl.ts`. Then run the
  transition-sheet script. No server change is needed.
- **A field on Project/Track/Clip**: add it to `types.ts`, **validate it in `shared/normalize.ts`** (otherwise it's
  silently dropped on load and save), and carry it through `splitClip`/`pasteClips` if it's per-clip.
- **An API endpoint**: a method on the service, a route in `server/routes/<resource>.ts` (throw `HttpError` for 4xx),
  the doc line in the route list at the bottom of `shared/types.ts`, and a method on `api` in `src/lib/api.ts`.
- **A keyboard shortcut**: `ShortcutAction` + `resolveShortcut` + `SHORTCUT_KEYS` + `SHORTCUT_GROUPS` in
  `hooks/shortcuts.ts` (tested), then `run` in `hooks/use-shortcuts.ts`. Add it to `EDITS` if it edits (so it's
  ignored mid-drag).
- **A transcription engine** (another API or local model): implement `TranscriptionEngine` (`server/transcription/
  engine.ts`: 16 kHz mono WAV in, timed words out) and add it to `defaultEngines` in `service.ts`, plus its id to
  `TranscriptionEngineId`. Decoding, silence squeezing, time mapping and caching are the service's job.
- **Something to the music editor**: the field in `shared/music/types.ts`, validated in `project.ts`
  (`normalizeMusicProject`, or it's dropped on load and save); a pure edit in `edits.ts` (tested); what it means to
  the sound in `compile.ts` (tested) and, only if the engine must do something new, `engine/src/Song.cpp` (parse)
  and `Sequencer.cpp` (play), with a test in `sequencer.integration.test.ts`; the UI in `src/suites/music/`; a tool
  for the assistant; and a test in `e2e/music.spec.ts`. The stand-in engine (`fake-engine.mjs`) must answer any
  new command.
- **Any feature (keep the assistant at parity)**: whatever the user can do, the assistant should be able to do too.
  When you add or change a feature, add or extend a tool in `shared/assistant-tools.ts` (the video editor's; other
  suites: `shared/<suite>/tools.ts` and `src/suites/<suite>/tools.ts`) (name, a description written
  for a model, a JSON schema, its `kind`) and its handler in `src/assistant/tools.ts`; TypeScript won't build until
  every tool has one. An `edit` tool is a pure `(Project, input, env) => { project, text }` in `src/assistant/edits.ts`
  (it can then go in a `batch`), with a test in `edits.test.ts`; describe new state in `describe.ts` so the model can
  see it. Give it a label in `describeToolCall` and an icon in `components/assistant/tool-steps.tsx`. Error messages
  go to the model: say what's wrong and what to do (which ids exist, which values are allowed).
- **A video editor panel**: its id in `VideoPanel` and `VIDEO_PANELS` (`stores/video-dock.ts`, where the default
  layout puts it; saved layouts get it in their first group) and its entry in `VIDEO_PANEL_DEFS`
  (`workspace/video-panels.tsx`). Keep the panels few: a new place to find media is a `MediaSource` (Online is a panel of its own, Théo's call) (and
  `SOURCES`), and a new kind of effect (video, audio) is an `EffectKind` (and `KINDS`), not a panel.
- **A clip kind (like text) or a track kind**: there's no registry yet. Clip kinds are branched on in
  `preview/engine.ts` (`kindOf` and each kind's slots), `preview/stage.tsx`, `preview/placement.ts`,
  `timeline/timeline-clip.tsx`, `timeline-menus.tsx`, `properties-panel.tsx`, `server/render.ts` and
  `server/exports.ts` (`clipKind` is the one place that says what a clip is). Track kinds assume video|audio in `shared/timeline.ts` (addTrack, pruneEmptyTrack,
  canPlaceOnTrack), `normalize.ts`, `timeline/geometry.ts`, `track-headers.tsx`, `lane-overlays.tsx`,
  `clip-gestures.ts` and `editor.ts` (`addAssetsToTimeline`, `moveSelectedToTrack`). Consider adding a registry
  before a third kind.

## Conventions

- Match the surrounding style: short doc comments on exports that say *why*, British spelling in prose ("colour",
  "normalise"), no drive-by reformatting.
- `cn` comes from the `cn` package (`import { cn } from "cn"`). Icons are `react-icons/pi` (Phosphor). UI primitives
  are in `components/ui` (shadcn, new-york). New shadcn components need their lucide imports swapped for
  `react-icons/pi`.
- Design: FL Studio's idea in a blue-grey family (docs/ui-redesign.md): mid-tone surfaces in clear steps
  (`surface-0`..`surface-3`, `sunken`), lines darker than what they divide (`line`), a little depth on what can be
  pressed (the `raised`/`pressed`/`sunken`/`floating` utilities in `index.css`), small corners, dense; DM Sans by
  default (Settings offers others: `FONTS`, `MONO_FONTS`, set as `--font-sans`/`--font-mono` on <html>).
  The accent is `brand`. It's a theme system: a theme is one whole look, light or dark (`dark` adds the `dark`
  class), in a CSS file in `src/themes/`, listed in `THEMES` (`src/themes/index.ts`); System (the default) is
  Light or Dark as the computer is. Use its tokens, never raw colours (canvases read theirs from CSS variables
  too). Studio (`studio.css`: `.theme` is Light, `.theme.dark` Dark) is the base every theme has; another
  theme (`.theme.theme-<id>`) sets only what differs and `derived.css` works out the rest (faces, accent
  buttons, steps, knobs). A value a canvas reads (`--piano-*`, `--meter-*`, `--brand`, `--line`) must be a plain
  colour, never `color-mix()`. `src/themes/themes.test.ts` fails any theme whose text or accent isn't readable.
- Hover tips are the app's, never the browser's: a `title` anywhere (any suite, any window) shows as our tooltip
  (`components/ui/title-tips.tsx` moves it to `data-title` while the pointer is on it), so a plain `title` is fine;
  code that reads a control's tip uses `titleOf` (the music hint bar does), tests don't `getByTitle` a hovered one.
- The component gallery (`/gallery` in `pnpm dev`, `src/gallery/`) shows every primitive and suite control in
  each state; `pnpm tsx scripts/ui-sheet.ts [name ...] [--light|--dark]` screenshots it and the app's screens
  into `ui-sheet/`. Add a section (`GallerySection`) when you add a control.
- Put pure logic in `shared/` (or a pure module next to the component) and unit-test it. Components stay thin.
- Tests, from cheapest: pure logic in vitest beside the code (most of them); a service against a stand-in
  program (`fake-engine.mjs`, `e2e/fake-claude.mjs`); the real program where only it can tell (exports in
  `server/integration.test.ts`, sound in `server/music/engine.integration.test.ts`); then one e2e spec per suite.
- Server: validate every request body inside the service (bodies are `unknown`). Paths come from `DataPaths` and
  ids are checked with `isValidId`. Start external programs only through `process.ts`.

## Windows (the page can be in several)

In the desktop app the music editor's windows and Settings can be windows of the operating system (on on Windows, where they and the plugin windows are all owned by the main window; off on a Mac: `NATIVE_WINDOWS` in `floating-window.tsx`, `docs/windows.md`), drawn by the same
React tree (`docs/windows.md`). `window` and `document` are always the main page's, so code that runs inside a
window must say which one it means: `addWindowListener` for what the editor wants in every window (shortcuts, a
drag's end), `ownerWindow` / `ownerDocument(event.target)` (`elementFromPoint`, `devicePixelRatio`, `activeElement`,
`getSelection`), `isElement` / `isHtmlElement` instead of `instanceof Element` (another window's elements aren't
instances of this one's), `queryAnywhere` to look in all of them; `startPointerDrag` already uses the window the
press was in. A Radix portal in `components/ui` takes a container from `usePopupContainer()` (menus, selects,
popovers: the shared popup window) or `usePortalContainer()` (tooltips, dialogs). Native windows only exist in the
desktop app; e2e (a browser) tests the boxes in the page, and `pnpm test:desktop:music` the native ones.

## Product decisions (don't undo)

- The timeline works like Premiere/CapCut: free placement with snapping (the magnet toggle), and unlimited video
  tracks created by dropping above the top track. There's **no magnetic main track** and no auto-packing.
  **Auto ripple** (the toolbar's chain toggle, off by default, `autoRipple` in the editor store) is the opt-in
  exception: deletes close gaps, edge trims and rate stretches move the rest of the track (`rippleClipEdit`), and
  media dropped at a time pushes it along (`insertClip`). Moves stay free either way.
- Clip properties are in the Properties panel, docked right of the Program monitor by default (Théo's layout; the
  user may move it anywhere). The assistant's chat is the app's, outside the dock, at the far right. Video settings (aspect ratio
  and fps) are in a window opened from the header. The canvas is always black.
- Clicking a media card previews that file in the Program monitor's place (the source monitor).

## Gotchas

- Terminals inside Electron apps (T3 Code, VS Code) set `ELECTRON_RUN_AS_NODE=1`, which makes Electron a plain Node.js:
  the desktop scripts remove it, but launching the app's binary by hand from such a terminal quits silently.
- Electron's macOS build (44.5.0) comes with a broken ad-hoc signature, and macOS 26 kills it on launch ("Electron quit
  unexpectedly", SIGKILL Code Signature Invalid in the crash report). `scripts/desktop.ts` signs it again ad hoc
  (`adHocSign`): Electron in node_modules before `dev:desktop`, the packaged app after it's packed. By hand:
  `codesign --force --deep --sign - <Electron.app>`.
- The desktop app is still the web app: keep features working in the browser (`pnpm dev`); `src/lib/desktop.ts` is
  the only place the page knows it's in the app (it gives the app `flush` to save before closing).

- `createCompositor` and `drawSampleScene` are serialised with `toString()` and injected into the headless
  export page. They must not reference anything at module level. (Masks and shape layers are drawn there with the
  page's own 2D canvas: `Path2D`, `OffscreenCanvas`, which the preview has too; text as well, in the fonts installed
  on this computer, which the page loads before the first frame: `RenderPlan.fonts`.)
- Store selectors must return the same value for the same state: `project.markers ?? []` makes a new array on every
  call and loops React for ever. Use a shared empty constant (`sequenceMarkers` does).
- The export draws every frame in headless Chromium with `shared/compositor.ts`; ffmpeg only decodes (video as YUV
  4:2:0 at the size it's shown; the compositor converts with the source's matrix), mixes audio and encodes (BT.709).
  Frames come back as YUV 4:2:0 (H.264, HEVC) or straight RGBA (ProRes, PNG: `readRgbaAsync`; ffmpeg converts with
  BT.709's matrix said explicitly, as swscale takes RGB as BT.601). An export with `alpha` begins each frame
  transparent instead of black: the canvas stays black everywhere else (a product decision).
  Everything animates exactly: Motion/Opacity per frame in `planRender`, volume as an ffmpeg expression of the same
  curve (`keyframeExpression`), and text drawn by the page itself at every frame (only its layout comes from the
  tab: one per change of its words, size or font, `TextLayoutAt.from`).
- After changing the compositor or the export, run the integration tests (`server/integration.test.ts` checks
  positions, transitions and colours of real exports).
- `data/` (or `EDITOR_DATA_DIR`) holds the recents (`projects.json`), the starting points (`templates/`), exports (never cleaned up yet) and `tmp`, which is wiped
  on startup. Export jobs live in memory.
- The audio engine: `EDITOR_ENGINE_PATH` (default: `engine/build/...`, else the packaged app's resources) and
  `EDITOR_PLUGIN_PATHS` (extra VST3 folders; default: the test synth's build folder). The e2e suite sets the first to
  `server/music/fake-engine.mjs`, so tests never make a sound or depend on this computer's plugins.
- External programs: ffmpeg/ffprobe (import and export; `FFMPEG_PATH`/`FFPROBE_PATH`), yt-dlp for the Online tab
  (`YTDLP_PATH`), whisper.cpp's `whisper-cli` for local transcription (`WHISPER_PATH`; model in `EDITOR_MODELS_DIR`,
  default `~/.cache/editor/models`), and Chromium for every export (`CHROMIUM_PATH`, else Playwright's, else Chrome). The
  font list uses macOS AppKit through osascript (`fc-list` elsewhere).
- Whisper times the word after a long silence early; that's why `audio.ts` squeezes silences out before any engine
  and snaps words to the sound afterwards. Don't use whisper.cpp's own `--vad`: its token times aren't mapped back.
- The export numbers each track's frames afresh after `concat` (`setpts=N/...`): a transition's file keeps time in
  whole ms, and without it every transition pulled the rest of its track a frame early.
- Saves on unload use `keepalive`, which is capped at about 64 KiB in Chromium, so a very large project may lose its
  last edit if the tab closes mid-debounce.
- The server binds to 127.0.0.1 only and has no auth. It's a local tool. `/mcp` also refuses requests with a non-local
  `Origin` or `Host` (web pages and DNS rebinding).
- The assistant is the user's own Claude Code (`CLAUDE_PATH`, else found on the PATH) or Codex (`CODEX_PATH`), picked
  per chat, run in `data/assistant/workspace` with only the editor's MCP server: Claude with `--tools ""` (no shell or
  files) and `--strict-mcp-config`; Codex's app-server with its built-in tools and the user's other MCP servers turned
  off by `-c` overrides (never by writing `~/.codex`), a read-only sandbox and the editor's prompt as its base
  instructions. Its MCP calls carry their id in `_meta.callId` (Claude's in `_meta["claudecode/toolUseId"]`).
- A chat's tool calls act on its own video, even while the tab shows another (`src/assistant/doc.ts`): a background
  copy is loaded, edited and saved through the autosave queue (flushed before any video opens), and `view_frames`
  draws it with an offscreen PreviewEngine (`PreviewSource`). Calls run in the tab, one at a time per video; a tab
  that isn't open can't run them. Edits to the open video wait for the user's drag to end.
- Switching providers mid-chat starts that provider's own conversation, told what it missed (`transcript`).
- The e2e suite plays Claude Code with `e2e/fake-claude.mjs` and Codex with `e2e/fake-codex.mjs`: a message's
  `call <tool> <json>` lines are tool calls (`wait` and, for Codex, `sleep <ms>` hold the turn).
