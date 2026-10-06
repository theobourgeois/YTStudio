# Visualizer: audio-reactive video

Status: plan first written 2026-10-06. **V1 (signals) and V2 (signals in expressions) are built** (2026-10-07; see
"What V1 and V2 built" below). **V3 is built** (2026-10-07: links, custom signals, nests hearing where they're placed,
the link popover, the assistant's tools, the Signals window, signal lanes, spectrograms). **V4 is built** (visualizer
effects, New item › Visualizer). **V5 is built** (Make visualizer: a song of the music suite made into a video
project). **V6 is built** (2026-10-07: the Shader effect, its three dialects, the shader editor, `set_shader`; see
"V6: Shaders" below).
[vaudio-port.md](vaudio-port.md) lists what comes over from Théo's earlier visualizer (`~/code/vaudio`) and where.

A professional audio visualizer inside the video editor, not a suite of its own. Any clip, effect parameter or shader
can react to sound: the song's bands, its kick, a stem, a channel's notes from the music suite, or pads hit live.
It's frame-exact (what plays in the Program monitor is what exports), programmable (expressions and GLSL), performable
(MIDI, keys, pads, recorded onto the timeline), and the assistant can do all of it, writing its own shaders included.
From a song in the music suite, **Make visualizer** makes the video project in one step.

## In one paragraph

Sound becomes **signals**: every audio file is analysed once into a file of band energies, levels, onsets, beats and
sections at a fixed rate (200 a second), a derivative like a waveform. Signals are a pure function of time, so the
preview and the export (which plans frames on the server) read the same numbers. Signals reach pictures three ways:
**expressions** (`audio("bass")`, `signal("Kick")`, `sinceBeat()`), **links** (the link button by every stopwatch:
pick a signal, an amount, a response) and **shader inputs** (a spectrum texture, a waveform, scalars) for visualizer
effects and the user's own GLSL. Things played live (knobs, pads, a mic, a camera) are **recorded** as keyframes,
event signals or media, so the export never depends on a performance being repeated. The music suite hands a song
over with its stems and exact notes, which become signals no analysis could guess.

## Product

**Who it's for**: artists and editors making music videos, visualizers and promo clips for songs, 9:16 first, who
want something that looks designed (not a stock spectrum), plus people who perform visuals live.

**References** (when in doubt, do what these do):
- **The editor's model is Premiere's and After Effects'**: parameters, keyframes, the graph editor, expressions.
  AE's *Convert Audio to Keyframes*, *Audio Spectrum* and *Audio Waveform* are the baseline we must beat.
- **Signals are Trapcode Sound Keys'**: drag a frequency range on a spectrum, shape it (gain, threshold, attack,
  release), name it, use it anywhere.
- **Performing is Premiere's**: the Audio Track Mixer's automation modes (Off, Read, Latch, Touch, Write) for knobs,
  and the Multi-Camera Monitor (cut between angles while playing, recorded as edits) for switching looks.
- **Live shows are Resolume's** (output to a second screen, react to the room's sound). Last, and optional.
- **Shaders speak ISF and Shadertoy**: both have audio inputs and large libraries; we read their dialects.

**Principles** (product decisions):
1. **Everything is a signal.** Audio analysis, a stem, a music-suite channel's notes, a pad recorded live, a MIDI
   knob: one model, one picker, one set of functions. A visual reacts to "Kick", whatever Kick is.
2. **Frame-exact.** Frame 900 is the same scrubbed, played or exported. Nothing reads live audio during export;
   nothing depends on the order frames were drawn in (except declared simulations, which replay: V8).
3. **Any parameter.** Not a visualizer's own sliders only: Position, Scale, a mask's feather, a text animator's
   amount, a transition's progress. Every number and point that takes a keyframe takes a link.
4. **The assistant can do everything** a user can, and writes code only in sandboxed languages (expressions, GLSL),
   never JavaScript.
5. **Live is recorded.** Performing writes keyframes, events and media into the project; it's then edited like
   anything else.

## The flow

1. **Drop a song** on the timeline. It's analysed in the background (a few seconds); its clip can show a
   spectrogram instead of a waveform. A music-suite song arrives already split into stems and notes (step 7).
2. **Signals.** Every audio source has built-in signals (level, sub, bass, low mids, mids, upper mids, presence, air,
   onset, beat). The Signals window adds custom ones: drag a range on the live spectrum, set gain, threshold, attack
   and release, watch its curve under the clip, name it "Kick". Signals have lanes under the timeline's ruler.
3. **Add a visualizer**: Effects › Audio (spectrum bars, line, circle, oscilloscope, vectorscope, spectrogram,
   particles on beats, vaudio's looks...) on a solid or an adjustment layer, or **New item › Visualizer**. Its
   **Source** is the mix (default), a track, a clip or a custom signal.
4. **Make anything react**: the link button beside a stopwatch. Pick a signal, an amount, a mode (add, multiply,
   map to a range) and a response (attack, release, curve, threshold); a small meter shows it moving. For events (a
   kick, a pad), a hit shape (attack, hold, decay). Power users write the expression; the link is one too, in effect.
5. **Write shaders**: the Shader effect takes GLSL (ours, ISF or Shadertoy's), with the spectrum, waveform and
   signals as inputs and parameters declared in the code, shown in Properties, keyframable and linkable.
6. **Perform**: arm parameters (knobs → keyframes, Latch/Touch/Write) and pads (→ event signals, quantised to the beat
   or not), press Perform, play. Switch between looks Multi-Camera-style. Punch in, do another pass, clean up in the
   graph editor. A camera and a mic can be recorded as you go.
7. **Make visualizer** (music suite): one command. The song's mix and stems are rendered, its notes become event
   signals per channel, its tempo map becomes an exact beat grid, its arrangement becomes markers; a 9:16 video
   project opens with a starting look already reacting, and the assistant ready.
8. **Export** frame-exact, in 4K, with transparency if wanted (ProRes 4444).
9. **Show** (optional, V9): the program output fullscreen on a second display, performing on top, reacting to a live
   input.

## Architecture

### Layering

- **Platform** (any suite may use it): signals' file format, their analysis on the server, their types and pure
  maths, the handoff between suites. New folders: `shared/signals/` and `server/signals/`, added to `PLATFORM` in
  `server/architecture.test.ts`. The FFT (three copies today: `server/beats.ts`, `shared/music/audio-intelligence/
  spectrum.ts`, `server/music/reverb-measure.ts`) moves to `shared/signals/fft.ts` first; music then imports it.
- **Video** (the roots): links, expressions' audio functions, visualizer effects, the Shader effect, Perform, the
  output window, the export's new formats.
- **Music** (`src/suites/music/`, `server/music/`): Make visualizer's side: render, notes, tempo, markers into a
  platform `SongHandoff`. Music never builds a video document; video's `SuiteBackend` does (a registry hook).

### Signals

**Analysis** (`shared/signals/analyse.ts`, pure; run by `server/signals.ts`): ffmpeg decodes to 48 kHz stereo f32,
streamed through the analyser. **200 frames a second**, each centred on its moment, whatever the sequence's fps
(24–120), read with linear interpolation. Per frame:
- `bands`: 96 log-spaced bands, 20 Hz–20 kHz, from a 2048-point Hann spectrum (43 ms), as dB (−90..0) quantised to a
  byte (0.35 dB steps). 0 dB is a full-scale sine.
- scalars (`SCALARS`): level and peak over 10 ms, the seven named bands (`NAMED_BANDS`, the music suite's edges),
  stereo width and balance, brightness (the spectral centroid), and four onset strengths: `onset` (spectral flux over
  32 log bands of a 1024-point spectrum, in dB, floored 30 dB under the recent loudest band) and `onsetLow`/`Mid`/
  `High` (each region's energy rising, below 150 Hz, between, above 4 kHz, floored against itself and 35 dB under the
  loudest region, so a hat's lows and a kick's highs don't count).
- hits: each onset strength's peaks, with their velocity: rises are measured against the loudest of the last 30 ms
  (noise flickers but never far above its own recent peaks), and a hit stands 1.4× above the mean over ±0.15 s,
  rises 2 dB at least, reaches 30% of the strongest within a second, and is 50 ms from the next; its time is
  interpolated between frames and put 4 ms later as measured (within 3.5 ms of a kick's or hat's attack, tested); and from `server/beats.ts`' `analyseRhythm` (files up to 12 minutes): tempo, beats, downbeats,
  sections, drops.
- references (auto-gain): each dB scalar's and band's 95th percentile over the frames with sound, each flux's 99th.

**Files**: one, `media/<id>/signals-v<version>.bin` (`format.ts`: a JSON header with the references, hits and rhythm,
then the scalars as float32 and the bands as bytes): about 5 MB for 3 minutes. The version is in its name, so a
newer analysis makes a new file (the old one is removed) and caches never serve a stale one. The waveform for
oscilloscopes (`wave`) is V4's.

**Lifecycle**: `MediaAsset.signals?: MediaSignals` (`processing`, `ready` with its `src` and `version`, or `error`),
its own status like `reversed`, so a file is `ready` (playable) before its signals are. Made after the waveform for every
file with sound; old assets are analysed when first used (as `requestReversedCopies` does), and the export waits for
them as it waits for reversed copies. Copy, rename and Library paths carry the URL (`copyAsset`, `renamed`).

**Sources**: a signal is read from a source at a timeline time:
- `master`: everything audible in the sequence (muted tracks out);
- `track`: one audio track, muted or not (so stems on a muted track can drive pictures);
- `clip`: one clip, wherever it's moved;
- `live`: the live input (V9 only, never exported).

A track's or the mix's value isn't rendered audio: it's the clips' **energies summed** at that moment, each read at its
own source time (`mediaTime`, `fileTime` for reversed clips) times its Volume squared. That's exact for levels and
bands of uncorrelated sources and close enough for the rest, costs nothing to recompute when clips move, and never
needs a mixdown. Events (onsets, beats) of a track are its clips' events mapped onto the timeline. Speed changes
without kept pitch move the spectrum; we ignore that (noted, not hidden: the Signals window says so).

**Reading** (`shared/audio-signals.ts`, video's, pure): a `SignalReader` is a video's document and its files'
loaded `SignalData` by media id: in the tab `stores/signals.ts` fetches them (asking the server to analyse old media)
and sets the open video's (`setSignalReader`); the export reads the package's files (`ExportService`, only when
something uses them: `usesSignals`) and plans frames inside `withSignals`; the assistant's background videos pass
their own (`PreviewSource.signals`). `signalValue`, `bandValue`, `sourceHits` (cached per store, clip list and
tracks) and `beatAt` read a source at a timeline time. A source not loaded yet reads silence in the preview, and is
waited for by the export.

**Values are 0..1.** Built-in signals auto-gain per source: a dB signal at its file's 95th percentile reads 1 and 24 dB
under it 0 (`AUTO_RANGE_DB`); several sounds sum their energies and their references, at unity gain, so Volume
still counts (a fade calms the pictures) but a quiet song reacts as much as a loud one. Onsets are flux over the
file's 99th percentile, the strongest since the frame before (none falls between frames). Width is 0..1, balance
−1..1, brightness 0..1 from 100 Hz to 10 kHz (log). Switchable off per custom signal (V3). Proposed: Théo to judge on
real songs.

**Nested sequences**: a nest's clip contributes its sequence's mix to the outer one. Inside a nest, **the mix is the
song of the video it's placed in** (Théo, 2026-10-07: nests are how looks get reused): `master` (an expression's
`audio()` without a source, a link's built-in signal, the beat, a custom signal's mix) is read on the outermost
sequence drawn, at the moment the nest's time is there (`Hearing`, `audio-signals.ts`). The preview's and the
export's levels say which use of the nest is being drawn (`withHearing`, `nestedHearing`); where nothing is drawing
(Properties, the assistant), a nest hears where it's first used, the main sequence's uses first. Tracks, clips and
"self" stay the nest's own. A kept nest frame (the preview's cache) is keyed by the outer time too when anything
reacts to sound.

### Custom signals and events

`Project.signals?: SignalDef[]` (the document, so undoable and saved; normalised in `normalize.ts`):

```ts
type SignalDef = {
  id: string; name: string; color: string;
  role?: "kick" | "snare" | "hats" | "bass" | "vocal" | "lead" | "mix";   // presets bind by role
} & (
  | { kind: "band"; source: SignalSource; low: number; high: number;      // Hz
      gain: number; threshold: number; attack: number; release: number;   // dB, 0..1, seconds
      curve: number; autoGain: boolean; onsets: boolean }                 // onsets: also emit events
  | { kind: "events"; events: SignalEvent[] }                             // pads, music notes, the assistant's
  | { kind: "curve"; points: { time: number; value: number }[] }          // a knob recorded unmapped
);
type SignalEvent = { time: number; length?: number; velocity: number; key?: number };
type SignalSource = { kind: "master" } | { kind: "track"; trackId: string } | { kind: "clip"; clipId: string };
```

A band signal's attack and release (and a link's) are a follower run at 200 Hz in blocks (`Series`), each started
eight time constants before it (from silence at 0), never from the frame before, so it's still a pure function of
time: scrubbed, played and exported agree, to within a ten-thousandth of following from the start. Series are kept
per video sound (`soundPrint`: its sound clips, their Volume and the tracks' mutes), so moving a picture keeps them. A
band with `onsets` has a hit where its shaped value rises out of silence (as hard as its highest in the next 40 ms). Events are timeline seconds; a music handoff's notes keep their
key and length. Roles let a preset say "the kick" and find it: a stem or channel named like one, a custom signal
given the role, or, for a song with nothing better, a band default (kick: 40–120 Hz onsets; snare: 150–250 Hz plus
2–5 kHz; hats: 8 kHz up; vocal: 300 Hz–3 kHz mid).

**The Signals window** (a video-desktop window): a live spectrum of the selected source at the playhead (from the
signals file, not an analyser), ranges dragged on it, the response's curve drawn over the timeline, the list of
signals with their roles. The timeline gets **signal lanes** under the ruler (collapsible): curves for band signals,
ticks for events (editable: move, delete, nudge, quantise to beats).

### Expressions

New globals in `shared/expressions.ts` (`GLOBALS`, so the catalogue and the assistant see them). Member access stays
limited (`audio.bass` doesn't parse today): these are functions, as `prop()` is.

| Function | Value |
| --- | --- |
| `audio(name = "level", source?)` | a built-in signal, 0..1; `source` is "master" (default), "self" (the clip's own sound), a track's name or id, an audio track's number, or a clip's id |
| `band(lowHz, highHz, source?)` | the energy between two frequencies, 0..1 |
| `audioAt(name, t, source?)` | the value at another time on the clip's clock, for lags and echoes |
| `sinceHit(name = "onset", source?)`, `hitCount(…)`, `hitVelocity(…)` | seconds since the last hit (`onset`, `onsetLow` kicks, `onsetMid`, `onsetHigh` hats), how many so far, its velocity |
| `envelope(seconds, attack, decay, curve = 1)` | a one-shot shape, pure: `envelope(sinceHit("onsetLow"), 0.01, 0.3)` is a punch |
| `beat()`, `bar()`, `beatPhase()`, `sinceBeat()`, `bpm()` | the beat of the song playing (the longest clip heard with a steady beat); exact from a music handoff in V5 |
| `section()`, `sinceDrop()` | the arrangement |
| `signal(name)`, `signalAt(name, t)` | a custom signal's value (V3) |

Before the first hit or beat, "since" is 10 000 s (`NEVER`): any envelope of it is over. The scope's `signals`
(`SignalScope`) comes from `audio-signals.ts` through `provideSignalScopes`, so `effects.ts` doesn't import it; it
finds the clip in the reader's document (any sequence) and maps the expression's clip time to timeline time.
Volume still can't have an expression (the export mixes sound with ffmpeg). `time`'s description is fixed: it's the
clip's own time (in the file, for media).

### Links

`Effect.links?: Record<string, ParamLink>`, keyed by parameter like `expressions`, on any parameter `canExpress`
allows (numbers and points; not Volume, not Time Remapping):

```ts
type ParamLink = {
  signal: SignalRef;                       // { name: "bass", source?: SignalSource } | { id: customSignalId }
  mode: "add" | "multiply" | "map";
  amount: number | [number, number];       // parameter units (display units in the UI); a point's is a vector
  to?: number | [number, number];          // map: from the stored value to this
  response: { threshold: number; curve: number; attack: number; release: number; invert: boolean };
  hit?: { attack: number; hold: number; decay: number };   // for event signals
};
```

Evaluated in `effectValuesAt` after keyframes and before expressions, so an expression's `value` includes the link
(and `effectValuesAt` stays the one place every drawer reads values). A link's attack and release make a cached
derived series, as a custom signal's do. Colours aren't linkable in V3 (a hue shift effect is); later maybe.
As built (`shared/links.ts`: validation, maths, edits; `linkLevel` in `audio-signals.ts`): `multiply` is
value × (1 + amount × signal); besides the sound's signals a link can follow `beat` and `downbeat`, the song's beat as
hits; hits (onsets, the beat, events, a band's onsets) with a `hit` shape make it on each, at its velocity, and
events are held as long as they last (a note's length); the response's threshold and curve shape a 0..1 value first,
then its attack and release follow it, then `invert`. A link to a deleted signal moves nothing (deleting a signal
removes its links).

**UI** (Properties, `link-button.tsx`, its options in `link-model.ts`): a link button beside each stopwatch (the
row's first column holds both), lit when linked. Clicking it on a property that isn't linked links it to the bass at
once, sized for the property (a fifth of its usual range, 15° of a rotation, a little lift of a point), and opens the
popover: the signal (Sound, Hits, this video's signals), where a built-in one is heard (the mix, the clip's own sound,
an audio track), Add / Multiply / Map to, the amount in the property's display units, attack and release (or a hit's
attack, hold and decay), threshold, curve, invert, Unlink, and a meter of the signal now with the value it gives.
Right-click on a property's name › Link to signal / Edit link, Unlink. Pass 2: the keyframe lanes' faint resulting
curve.

### Visualizer effects and shader inputs

An effect declares audio inputs: `EffectShader.audio?: { spectrum?: { history?: number }; wave?: boolean }`. Its pass
then carries resolved data, and the prelude gains:

```glsl
uniform sampler2D uSpectrum;   // 96 bands × history rows, row 0 now
uniform sampler2D uWave;       // 1024 samples × 2 channels around now
uniform float uLevel, uBass, uMid, uHigh, uOnset, uBeatPhase, uSinceBeat, uSinceOnset, uBpm;
float spectrum(float x);                 // x: 0..1 on a log frequency axis
float spectrumAgo(float x, float secs);  // the past: waterfalls and trails without feedback
vec2  wave(float x);                     // −1..1, left and right
```

The data is resolved where the frame is planned: the preview engine in the tab, `planRender` on the server for the
export. It travels to the export page as binary next to the pictures in `FramePacket` (not JSON), uploaded to R8/R16F
textures on spare units. **History is data, not feedback**: a spectrogram, a waterfall or a "trail" of bars reads past
rows, so it stays a pure function of time (vaudio's visualizers all relied on the canvas keeping the last frame).
Effects whose source isn't the mix get a `signal` parameter, a new `ParamSpec` kind (a `SignalRef`; a picker row in
`param-rows.tsx`).

The library (`shared/effect-library/audio.ts`, category "Audio"): spectrum bars (peak hold, mirrored, rounded,
gradient), line and filled spectrum, circular spectrum, oscilloscope, vectorscope (vaudio's lissajous), spectrogram /
waterfall, particles emitted on onsets (closed-form, as particles are), waveform ring, VU and loudness meters, then
vaudio's looks rebuilt (see the port). Plus effects for any clip: **Audio Displacement** (vaudio's displacement map),
**Strobe on hits**, **Hue orbit**. The effect sheet and thumbnails feed them a fixture song's signals so cards move.

### The Shader effect

One effect type, `shader`, whose instance carries its code: `Effect.shader?: { code: string; dialect: "native" | "isf"
| "shadertoy" }` (up to 64 KB, normalised). Its parameters are **declared in the code** and parsed into `ParamSpec`s
(an ISF JSON header, or ours: `// @param amount number 0 1 0.5 "Amount"`), so they're keyframable and linkable like
any other. That needs an instance-aware lookup, `definitionOf(effect)`, where code calls `effectDefinition(type)` today
(37 calls in 25 files); `sanitizeEffect` keeps a shader's params against its parsed definition.

- **Dialects**: preludes adapt ISF's (`IMG_NORMALIZED_PIXEL`, `TIME`, audio and `audioFFT` inputs) and Shadertoy's
  (`mainImage`, `iTime`, `iResolution`, `iChannel0` as its 512×2 audio texture) to ours, so existing shaders paste in.
  Licences are the user's concern; the assistant attributes what it adapts.
- **Cache by source**: shader keys include a hash of the code (`fx:shader:<hash>`), so many coexist.
- **Compile errors**: a synchronous compile on a shared hidden WebGL2 context (`gl.compileShader` is synchronous)
  returns the log mapped to the user's line numbers. The editor shows it inline; Properties shows a badge; the
  preview draws the clip without the effect (as today); the export refuses to start, naming the clip.
- **Editor**: a window with a code editor (CodeMirror 6, Proposed: a new dependency), live recompile as you type,
  parameter list generated from the code, examples, Save to Library.
- **Safety**: GLSL can't touch files or the network; it can hang the GPU (Chromium's watchdog loses the context).
  The compositor recovers from a lost context and turns off the last shader compiled, telling the user.

As built (V6): `shared/shader-code.ts` reads code (pure: declarations, the ISF header, the dialects' sources, compiler
logs onto the user's lines; `shaderApi`, the examples); `definitionOf(effect)` in `effects.ts` (an instance's
definition, cached per code: `shaderDefinition`); the preludes moved to `effect-prelude.ts` so the dialects build on
them. Details that differ from the plan above:
- **Lines**: the user's code follows `#line 1 1` (and each `@param` uniform `#line <its line> 1`), so ANGLE's log
  (`ERROR: 1:12: ...`) names the user's own line; `compileProblems` reads it. Token pasting (`##`) doesn't work in
  ANGLE, so ISF images and Shadertoy channels are structs (`_VzImage`, `_VzChannel`) with `texture`, `texelFetch`,
  `textureLod`, `textureSize` overloads, and the ISF macros (`IMG_NORM_PIXEL`...) call functions on them.
- **Dialect preludes** have none of our helpers (a Shadertoy's own `hash` or `noise` would clash) and our audio
  functions renamed (`_vz_spectrum`); the compositor also sets `uResolution`, which they use. ISF writes straight
  alpha (premultiplied for it); a Shadertoy is opaque. iChannel0 is the sound (512×2, the spectrum linear to 12 kHz
  on row 0, the waveform on row 1), iChannel1 the clip's picture; `// @iChannel0 input|audio|none` changes them.
  `iDate` is a fixed date (frames never depend on when they're drawn). Not supported: ISF's several PASSES, TARGETs,
  IMPORTED images, vertex shaders; Shadertoy's Common and Buffer tabs.
- **What it hears**: a native shader hears when it reads the sound (`spectrum`, `audioBass`, `hitAge`...; `@fall`,
  `@history`, `@wave`, `@hits` shape the request), an ISF through `audio`/`audioFFT` inputs, a Shadertoy when it reads
  an audio channel; then it gets a `source` parameter (Listens To) as visualizers do.
- **Compile checks**: the tab (`src/lib/shader-compiler.ts`) compiles each new shader on a hidden context, cached by
  key; `provideShaderCheck` leaves those that don't compile out of `effectPasses` (only that effect: the clip still
  draws). Properties marks the effect and shows its first problem; the editor lists them and marks their lines. The
  export compiles the plan's user shaders in its page before any frame (`GlSession.compile`) and refuses, naming the
  shader and the clip (`RenderPlan.shaderUses`).
- **Lost context**: the Program monitor's engine, on `webglcontextlost`, turns off (an undo step) the shader on now
  that was first drawn most recently among those drawn in the last 20 s (the watchdog takes seconds), and says so
  (`components/preview/shader-recovery.ts`). The compositor keeps the 24 most recently used user programs.
- **Editing**: new code keeps the values, keyframes, expressions and links of the parameters it still declares as
  the same kind (`setShaderCode`); a new Shader effect starts from its own code's defaults. The editor window
  (`components/shader/`, CodeMirror 6 with C's grammar and the app's `--code-*` colours, lazy) applies typing after
  180 ms and makes a burst one undo step (1.2 s); Dialect, Examples, a Reference (`shaderApi`), the declared
  parameters, Save to Library (the clip, with its shader, as a Library item).

### Simulations (stateful effects, V8)

Some looks need the past: feedback tunnels (vaudio's zoom/rotate/hue echo), physics (leviathan's chain), 3D scenes
that integrate. They're **simulations**: state at frame `f` is `step` applied `f − start` times from the clip's start,
at the sequence's frame step (never wall-clock time). The export draws in order, so it's exact. The preview keeps
**checkpoints** (every 30 frames, an LRU in a GPU memory budget) and replays from the nearest one when you seek, at the
preview's resolution (simulations are defined in UVs, so resolution doesn't change what they do). A simulation fed by
pure inputs (generators, visualizers, text, solids) is then exact in the preview too; one fed by video can't replay
without decoding the frames before, so it's exact while playing and approximate just after a seek (shown). The
existing time effects (Trails, Echo, Datamosh) can move onto this later and become exact as well.

### 3D scenes (V8)

three.js worlds as a generator effect whose renderer isn't GLSL: a layer kind (`Placed.scene`) drawn by a scene
runtime into its own canvas and uploaded as the layer's picture. The preview lazy-loads the runtime; the export page
gets it as a prebuilt bundle (esbuild IIFE, served by `gl-browser.ts`; the page only has `toString()`'d functions
today). Scenes are rewritten as simulations over signals (see the port for each one's state). Built-in scenes only:
no user JavaScript.

### Perform (V7)

- **Inputs** (`src/lib/control-inputs.ts`): Web MIDI (new to the tab; the music engine's MIDI stays the engine's),
  gamepads, the keyboard and the pointer on the Program monitor. MIDI Learn as vaudio's (a move past a threshold).
  `Project.controls?: ControlMapping[]` maps an input to a parameter or to a pad (an event signal): the mapping is the
  project's.
- **Knobs → keyframes**: an armed parameter has an automation mode (Premiere's: Read, Latch, Touch, Write). While
  playing in Perform, its samples (at the sequence's fps) are kept, then thinned (Ramer–Douglas–Peucker within a
  tolerance) into keyframes at `keyframeTime`, one undo step per pass. Punching in is Touch.
- **Pads → events**: hits go into an event signal with their velocity; optional quantise to the beat grid while
  recording or after. Links with a `hit` shape make them flash, punch, shake, glitch; "Hits" presets make those links
  in one click.
- **Switching looks**: the Multi-Camera way. A sequence of looks (nested sequences, one per angle), pads cut
  between them while playing, recorded as cuts.
- **Camera and mic**: live sources in Perform, shown in the Program monitor, recorded (MediaRecorder) and imported as
  media where recording started. A live mic drives links through a realtime analyser while recording; once its file
  is analysed, its signals replace the live ones, so the export matches.
- vaudio's play-mode keyboard map becomes the default Keys layout.

### Live output and shows (V9, optional)

A program output window, fullscreen on a chosen display (Electron's `screen`; the browser's Fullscreen API). The
compositor renders once at the output's size into an `OffscreenCanvas`; the frame goes to the output window
(`transferToImageBitmap`, a bitmaprenderer) and, scaled down, to the Program monitor. Measure 1080p60 and 4K30 before
committing (gate). **Show mode** adds the `live` source (an input device's realtime analysis), which links and
expressions can read, never exported (the export refuses a project that needs it).

### Make visualizer (V5)

- **Platform**: a `SongHandoff` type (`shared/handoff.ts`) and `ProjectStore.createFromHandoff`: it makes the package,
  imports the files into it, then asks the target suite's backend (`SuiteBackend.fromHandoff`, a registry hook) for
  the document, then saves. A route `POST /api/projects/handoff`.

  ```ts
  type SongHandoff = {
    kind: "song"; name: string; length: number;                      // seconds
    tempo: { bpm: number; timeSignature: [number, number]; map: { time: number; bpm: number }[] };
    mix: string; stems: { name: string; color: string; role?: SignalRole; file: string }[];
    notes: { channel: string; color: string; role?: SignalRole; events: SignalEvent[] }[];
    markers: { time: number; label: string }[]; origin: { projectId: string };
  };
  ```

- **Music side** (`server/music/handoff.ts`, `src/suites/music/visualizer/`): render the mix and a stem per mixer track
  with sound (the export already does both, 45–108× real time; stems are per track, so a channel needs its own
  insert to get its own stem: the window says which). Notes from `compileSong(..., "song")`, muted channels and
  tracks filtered out (it keeps them with a zero gain), to seconds through the compiled tempo. The tempo map gives the
  beat grid exactly; playlist markers and pattern changes give the markers. Roles guessed from names and the
  channels' samples (kick, snare, 808...), shown for the user to correct.
- **Video side**: a 9:16 project the song's length; the mix on an audio track; stems on muted tracks named after
  them (their sound off, their signals on); notes as event signals; `Project.tempo` (new: an exact beat grid that
  `beat()` prefers to analysis); markers. A starting look from a picker of presets (Library templates that bind by
  role), so it reacts at once.
- **The window**: look, aspect ratio, which stems, which channels' notes; then the project opens in a new tab with its
  assistant told what came over. Later: **Update from song** (re-render, swap the media, keep the edits; `origin`).

### Export (V10)

Today: H.264 MP4 at up to 4K, YUV 4:2:0 readback, no alpha. Added: an RGBA readback path, ProRes 422 HQ, ProRes 4444
with alpha (the black canvas becomes transparent only in that export: the canvas stays black in the app), HEVC, a
higher-quality H.264, PNG sequences. The export request gets a `format`. A test checks a linked parameter's frame
values in the export against the preview's resolver.

### The assistant

Full control, at parity per milestone (a feature isn't done without its tools):

| Tool | Kind | Milestone |
| --- | --- | --- |
| `get_signals`: what sounds where, the beat, bars, sections, drops, every hit, the level's shape, and signals' values over a range (built) | look | V1 |
| `plot_signals`: an image of signals as lanes over a range, with bars, drops and hits (built) | look | V1 |
| `get_catalog` sections `signals`, `visualizers`, `shader_api` (the prelude, dialects, examples); audio functions under `expressions` | look | V2–V6 |
| `define_signal`, `delete_signal` | edit | V3 |
| `link_param` (set or clear links on clips' parameters) | edit | V3 |
| `set_events` (add at times, beats or onsets; quantise; clear) | edit | V3 |
| `set_shader` (code and dialect; compile-checked, the log returned on failure) (built) | edit | V6 |
| `view_frames` with `from`/`to`/`count`, `at` beats, bars, drops or hits (with an `offset`), and `sheet` (one picture) (built) | look | V2 |
| `make_visualizer` (music suite) (built) | action | V5 |
| `map_control` (Perform mappings) | edit | V7 |

Compile checks stay synchronous inside edits through `EditEnv` (the tab passes a compiler; tests pass a fake), so
`set_shader` can go in a `batch`. The video assistant's instructions get a section on visual direction: find the
song's structure first (`get_signals`, `analyze_music`), bind by role, check its work at onsets (`view_frames`). The
assistant can't hear; signals are its ears and `plot_signals` its eyes on them.

## Milestones

Each ends with `pnpm typecheck && pnpm test`, the video e2e spec, the effect-sheet script for anything drawn, and its
assistant tools. Gates are what must be true (measured) before the next milestone builds on it.

### V1: Signals (built)

- `shared/signals/` (platform): the format, the analyser, reading at a time, the FFT (shared with `beats.ts`).
- `server/signals.ts` + `MediaLibrary`: analysed after the waveform for every file with sound, on demand for old
  ones (`POST /api/media/:id/signals`), waited for by the export (`signalsPath`); copied and renamed with the media.
- `shared/audio-signals.ts` (video): sources, energy sums, hits, the beat, auto-gain; `stores/signals.ts` in the tab.
- `get_signals`, `plot_signals`.
- Tests: synthetic kicks, hats, sines and stereo (`analyse.test.ts`: hits within 3.5 ms, levels and bands within a dB,
  streaming in any chunks gives the same file); sources, sums, Volume, mutes, speed, nests and the beat
  (`audio-signals.test.ts`); a real import analysed by the server (`integration.test.ts`).
- Moved to V3: the spectrogram on audio clips (with the signal lanes). Not done: moving the music suite's
  `loudness.ts`/`spectrum.ts` into the platform (signals didn't need BS.1770's loudness; their FFT stays as it is so
  their reports' numbers don't move).
- **Gate, measured** (2026-10-07, an M-series Mac): a 3-minute MP3 (kicks every half second over pink noise) is
  decoded, analysed and its rhythm found in 2.4 s (under 4 s), its file 5.8 MB; 120.1 BPM found; 359 of its 360
  kicks are low hits at full velocity (the one at 0 s is missed: nothing rises before the file starts), with 165
  weaker low hits from the noise (from 1,239 before the 30 ms rule and the 30% share). Real songs: Théo to judge.

### V2: Signals in expressions (built)

- The globals above, `withSignals` / `setSignalReader`, the beat of the song playing (the longest clip heard with a
  steady beat).
- Expression examples in `expression-row.tsx` (Pump with the bass, Punch on every kick, Pulse on the beat);
  `view_frames` contact sheets and frames `at` beats, bars, drops or hits.
- Tests: expressions reading signals (`audio-signals.test.ts`); an export where a solid flashes on each thump of a
  real file, checked in the MP4's pixels (`integration.test.ts`).

### V3: Links, custom signals, the Signals window

**Pass 1 (built, 2026-10-07)**:
- `Effect.links` (normalised in `sanitizeEffect`, so copied with effects everywhere: splits, paste, Library
  templates) and `Project.signals` (normalised, carried through nested sequences' views); evaluation in
  `effectValuesAt`; custom signals in expressions (`signal()`, `signalAt()`, `sinceHit("Kick")`...).
- Nests hear the song of the video they're placed in (Q4), in the preview and the export.
- The link button and popover in Properties.
- `link_param` (says how far the parameter moves), `define_signal` (says how often it's on and where its hits are),
  `delete_signal`, `set_events` (by hand, on beats, bars, drops or hits, every nth, quantised); `get_signals` and
  `plot_signals` read custom signals; get_timeline shows links and signals.
- Tests: `links.test.ts`, `audio-signals.test.ts` (links following kicks, beats, bands, events; reading order doesn't
  matter; a nest placed twice hears two moments), `signal-edits.test.ts`, `link-model.test.ts`; an export of a linked
  look in a nest flashing on the outer song's thumps (`integration.test.ts`); e2e linking Scale from Properties.

**Pass 2 (built, 2026-10-07)**:
- The Signals window (`components/signals/`, the timeline toolbar's Signals, or Signals… in a link's popover; state in
  `stores/signal-view.ts`): the video's signals listed; a band's spectrum at the playhead (`spectrumAt`, from the
  files' signals), dragged across to choose its range, with its source, role, gain, threshold, attack, release,
  curve, auto-gain and onsets; hits placed at the playhead, filled on beats, bars, kicks or hats, quantised,
  cleared; a meter of what the signal reads now.
- Signal lanes under the ruler (`timeline/signal-lanes.tsx`, main sequence only): a band's or a curve's value drawn,
  hits as ticks dragged along (snapping to beats with the magnet), right-clicked away, double-click to add one.
- Spectrograms on audio clips instead of waveforms (`timeline/spectrogram.tsx`, a switch in the Signals window).
- A linked property's resulting value drawn faintly in its keyframe lane (`properties/linked-curve.tsx`).
- `eventTimes` (beats, bars, drops, hits in a stretch) moved into `shared/audio-signals.ts` for the window and the tools.
- Tests: `components/signals/geometry.test.ts` (the spectrum's axis, a dragged range, hits moved, added, quantised);
  e2e: a band made from the spectrum, a hit dragged on its lane and right-clicked away, spectrograms.

- **Gate**: a timeline with 300 linked clips plays at 60 fps (`scripts/perf.ts --links`). **Measured** (2026-10-07,
  an M-series Mac, dev build): 300 solids on ten tracks over a 20 s song, each with scale linked to the bass and
  opacity to the kicks: 60.2 frames a second paused and playing, slowest frame 17 ms, no long tasks.

### V4: Visualizer effects

**Built (2026-10-07):**
- Signals v2 keep each file's waveform small (8 kHz, a signed byte a sample, left and right: about a megabyte a
  minute) for oscilloscopes; older files are analysed again when first used.
- Shader audio inputs: `EffectShader.audio.request(values)` asks for rows of spectrum over a span, how fast it falls,
  a waveform window and which hits; `effectPasses` reads them at the clip's moment (`audioInputs`, `clipAudio`: the
  mix where the clip is heard, a nest's being the video it's placed in) into `EffectPass.audio` (`AudioInputs`,
  plain numbers that travel in the export's frame layers; binary can come if they ever weigh too much); the
  compositor binds the spectrum and waveform as float textures (units 6 and 7) and the scalars and last 8 hits as
  uniforms; the prelude (`AUDIO_PRELUDE`) gives `spectrum(x)`, `spectrumAgo(x, s)`, `wave(x)`, `audioBass`...,
  `hitAge[i]`. Cards and sheets hear made-up sound (`demoAudio`), so cards play.
- The `source` param kind (Listens To: the mix, the clip's own sound, an audio track), not a uniform.
- The Audio category (`shared/effect-library/audio.ts`): Spectrum Bars (peaks, mirror, rounded), Line Spectrum,
  Circular Spectrum, Oscilloscope, Vectorscope, Spectrogram (a waterfall), Hit Burst (particles from each hit, seeded
  by when it was), Waveform Ring, Level Meter; for any clip, Audio Displacement, Strobe on Hits, Hue Orbit. Drawing
  ones take the generators' Blend Mode (Replace on a solid: the visualizer alone).
- **New item › Visualizer** (and `add_layer` kind `visualizer`): a solid drawing only Spectrum Bars (or the Audio
  effects given), as long as the video.
- Tests: the waveform (analyse.test.ts), what a visualizer hears and carries (audio-signals.test.ts), every Audio
  effect compiles and changes the picture (effect sheet), an export of Strobe on Hits flashing on each kick
  (integration), e2e: a Visualizer layer's bars on the Program monitor, its Listens To.
- Not yet: vaudio's 2D looks (see vaudio-port.md).

- **Gate**: a 1080×1920 sequence with three visualizers plays at 60 fps in the preview (`scripts/perf.ts --visualizers`).
  **Measured** (2026-10-07, an M-series Mac, headless Chromium, a 1920×1200 window at 2×): Spectrum Bars, Circular
  Spectrum and a Spectrogram over a song, 60.2 frames a second paused and playing, slowest frame 17 ms, no long tasks
  (the page's frame rate: the GPU's own time isn't measured).

### V5: Make visualizer (built)

**Built (2026-10-06):**
- The platform's handoff (`shared/handoff.ts`: `SongHandoff`, the looks, the video's options, `guessRole`) and
  `ProjectStore.createFromHandoff` (the files moved into the new package's media, then `SuiteBackend.fromHandoff`;
  nothing left of it if anything fails). No `POST /api/projects/handoff`: a handoff's files are paths on the server,
  so only the server makes one (the music job calls the store, wired in `app.ts`).
- Music (`shared/music/visualizer.ts`, pure; `server/music/visualizer.ts`, `/api/music/visualizer`): the song played
  once (the playlist, or the pattern shown when it's empty) rendered by the engine with stems and its tail (up to
  8 s), as FLAC, every file down alike if the mix went over full scale; a stem for each mixer track a sounding
  channel plays or sends into (muted and soloed-out tracks left out), each channel's audible notes in seconds
  through the compiled tempo, every beat from the tempo map (`songSeconds`) on through the tail, markers from the
  playlist's own and from where the set of patterns heard at a bar changes (two bars apart at least). Roles guessed
  from track and channel names (a track's from its channels' when they agree).
- The window (`src/suites/music/visualizer/`, the toolbar's film slate): the look, aspect ratio and frame rate
  (remembered), each stem and channel on or off with its role to correct, a note of the channels that play straight
  into the master (no stem is theirs); Make renders (Stop while it does), then the video opens in a tab.
- Video (`shared/song-video.ts`): the mix on a "Mix" track, each stem on a muted track named after it, each
  channel's notes an events signal with its role and colour, `Project.tempo` (the song's beats in its files' seconds,
  for the clips playing them: `clipGrid` prefers it to the analysis, so `beat()`, `bar()`, `bpm()` are exact, follow a
  moved or sped-up clip, and work before the signals are analysed; `bpm()` is the tempo between the beats either
  side), the markers, and a starting look: **Pulse** (Circular Spectrum and a Waveform Ring punching on the kick, an
  RGB split on the snare), **Bars** (Spectrum Bars, Hit Burst on the kick, a Glow with the bass), **Wave** (a
  Waveform Ring breathing with the bass, a flash on the snare, sparks on the hats), or nothing. Each binds by role:
  the role's notes first (exact hits), then its stem (its onsets, its level; a visualizer listens to the stem's
  track), then the mix's band for it. A title of the song's name over a dark gradient.
- `make_visualizer` (music, `action`: look, shape, stems, channels, roles; `open`); the video assistant's
  instructions say what a song's video has.
- Tests: `shared/music/visualizer.test.ts` (sources, mutes, notes in seconds, tempo clips, beats, markers),
  `shared/song-video.test.ts` (the project, binding by role, every look surviving `normalizeProject` unchanged,
  roles guessed), `audio-signals.test.ts` (an exact beat over the analysis's, moved, sped up, unloaded),
  `server/music/visualizer.test.ts` (the whole path through the app with the stand-in engine and ffmpeg), e2e:
  the window makes one that opens in a tab; the assistant makes one with a stem and a role given.
- Not yet: looks as Library templates (they're built in, in `song-video.ts`); **Update from song** (`origin` is
  kept on the media: `handoff:<song project id>:...`); a section's arrangement on the beat grid (sections still come
  from the analysis, markers from the song).

### V6: Shaders (built, 2026-10-07)

- `definitionOf(effect)`, `Effect.shader`, declared parameters, the dialects, hashed keys, compile checks, recovery
  from a lost context (see "The Shader effect", as built).
- The shader editor window (Properties › Edit code); Save to Library.
- `set_shader` (compiled first through `EditEnv.compile`: the errors come back on the model's lines and nothing
  changes; goes in a `batch`); `shader_api` in the catalogue (the dialects and the examples' code); `get_clips` shows
  a shader's code, whether it compiles and its problems.
- Tests: `shader-code.test.ts` (declarations, the ISF header, uniforms, what's heard, logs onto lines),
  `shader-effect.test.ts` (definitions, edits keeping parameters, storage, paste, passes), `shader-edits.test.ts`;
  `server/shaders.test.ts` compiles and draws known ISF and Shadertoy shaders (their own hash and noise, texelFetch
  on the sound, IMG_PIXEL, texture2D, long and point2D inputs) and the examples in headless Chromium, and checks
  errors land on the user's lines; the effect sheet draws the starting shader; e2e: a shader written in the editor
  (an error on its line, then fixed: its parameter in Properties, drawn on the Program monitor), an example, undo,
  and a lost context turning it off.

### V7: Perform

- Control inputs, Learn, mappings; automation modes and recording into keyframes; pads into events, quantise; Hits
  presets; switching looks (multi-camera); camera and mic recording.
- `map_control`. The Electron permission for MIDI.
- Tests: recorded samples to keyframes (thinning error under the tolerance), events quantised to a grid; e2e
  performing with synthetic MIDI.

### V8: Simulations and 3D

- The simulation contract (step, checkpoints, replay, budget), a Feedback effect (vaudio's), vaudio's camera modes
  (slit-scan, echo grid, freeze, difference) on video clips.
- The scene runtime (bundle for the export page, lazy in the preview) and vaudio's scenes: tesseract and singularity
  first, then cathedral, then leviathan.
- **Gate**: a simulated clip scrubbed to frame N in headless Chromium equals the export's frame N (within rounding).

### V9: Live output and shows (if wanted)

- The output window, render-once-show-twice, display choice, Show mode's `live` source.
- **Gate**: 1080p60 sustained with the Perform UI open.

### V10: Professional export

- RGBA readback, ProRes 422 HQ and 4444 (alpha), HEVC, PNG sequences, a quality setting.

V10 doesn't depend on the others and can be built whenever it's wanted; V5 and V6 don't depend on each other.

## Decision ledger

| ID | Decision | Reason | Revisit if |
| --- | --- | --- | --- |
| V01 | A video-editor capability, not a suite (2026-10-06) | The output is a video of a song; every effect, mask and keyframe already applies | Live shows become the main use |
| V02 | Signals are precomputed per file at a fixed rate and read as a pure function of time; never an `AnalyserNode` in the editor (2026-10-06) | Frame-exact preview and export; the export plans frames in Node | — |
| V03 | A track's or the mix's signal is its clips' energies summed, not a mixdown (2026-10-06) | Free when clips move; exact for levels and bands of separate sources | Visible errors on real songs (phase-cancelling layers) |
| V04 | Everything is a signal: audio, stems, notes, pads, knobs (2026-10-06) | One picker, one set of functions, presets that bind by role | — |
| V05 | Links are data (`Effect.links`), evaluated before expressions (2026-10-06) | A UI and the assistant edit them as values; expressions see the linked `value` | — |
| V06 | Visualizers keep their past as signal history, not feedback (2026-10-06) | Pure functions of time: scrubbing is exact | — |
| V07 | Stateful looks are declared simulations with checkpoints (2026-10-06) | The only exact way to have feedback and physics with scrubbing | Memory budget |
| V08 | User code is GLSL and expressions only, never JavaScript (2026-10-06) | Both are sandboxed; the assistant writes them freely | — |
| V09 | Performances are recorded into the project (keyframes, events, media) (2026-10-06) | The export never needs a performance repeated; recordings are edited like anything else | — |
| V10 | Music hands a song over as a platform `SongHandoff`; video's backend builds the project (2026-10-06) | The layering: suites never import each other | — |
| V11 | A nest hears the mix of the sequence it's placed in, at its moment there (2026-10-07) | Looks are reused as nests; a look with no sound of its own must react to the song | A nest needs its own mix: name its tracks |
| V12 | Followers (attack, release) run in blocks warmed up from eight time constants before (2026-10-07) | Pure in time without computing a song from its start on every seek or edit | Long releases (over 7 s) cost more per block |

## Questions for Théo

1. **Live shows** (V9): a goal, or a nice-to-have? It decides whether the preview must hold 60 fps at full screen
   from the start.
2. **Stem separation** for songs that don't come from the music suite (a Demucs-class model, local, a few hundred MB,
   no Python ideally: an ONNX or ggml port)? It would make "the kick" exact for any song. When?
3. ~~**Auto-gain** by default~~: yes (Théo, 2026-10-07). A band signal's `autoGain` is on unless turned off.
4. ~~**Nested sequences**~~: a nest hears the outer sequence's mix by default (Théo, 2026-10-07; see Signals).
5. **3D scenes**: how important, against 2D visualizers and shaders? Which first?
6. **The shader editor**: built with CodeMirror 6 (loaded with the window: line numbers, GLSL's colours, errors on
   their lines, its own undo and search). Théo to confirm, or say if a plain field would do.
7. **vaudio**: archived once ported, or kept as a separate toy?
8. **The canvas is always black**: an alpha export makes it transparent only in the file. Fine?
