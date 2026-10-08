# The visualizer

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
Neon City, Nebula, Abyss, Monoliths, Cyberspace, Wormhole, Galaxy, Cosmic Web, Collider: the last five light on black, to
lay over clips) are raymarched
GLSL: each `shared/scenes/<scene>.ts` holds its GLSL, its parameters and its state, stepped in TypeScript
(`steppedState`), the same in the tab and the export's plan, handed to the GLSL as uniforms (`SCENE_GLSL` in
`effect-library/scenes.ts` gives the camera ray, noise, the tonemap). Ridgeline's terrain is mirrored in float32 TS
(`ridgeHeight`) so the camera never flies into it: change both. Cosmic Web's graph is integer hashes, mirrored exactly in TS
(`webNode`, `webEdge`) so its camera walks real filaments: change both. A scene that travels for ever (Neon City, Nebula,
Monoliths, Cyberspace, Wormhole, Cosmic Web) repeats its world over a long period and wraps the camera in TS, so a long song never runs out of float
precision. `scripts/scene-sheet.ts` renders them to look at;
`server/simulation.test.ts` is the gate: a frame the same in order, straight away and seeking.
