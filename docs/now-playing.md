# Now Playing

What the computer's music player is playing, at the top of the window, and a **visualizer** of it filling the
window: looks made of the video editor's own effects and 3D scenes, coloured by the song's cover, reacting to the
sound as it plays. Built on Théo's ask (2026-10-14): Spotify in the app, the song at the top, a click to a full-screen
visualization with presets, the cover's colours, vaudio's looks and its play keys.

## What's where

| Part | Where | Layer |
| --- | --- | --- |
| Asking the player, telling it what to do | `server/now-playing.ts`, `/api/now-playing` (`server/routes/now-playing.ts`) | platform |
| The types, positions, commands | `shared/now-playing.ts` | platform |
| The pill (the tab strip, else Home's bar; not in a project without the tab strip) | `src/components/now-playing/` | platform |
| The tab's state: polling, the cover's palette, listening, the visualizer open | `src/stores/now-playing.ts` | platform |
| Listening to the computer's sound | `src/lib/live-audio.ts`, the grant in `electron/main.ts` (`answerListening`) | platform |
| Live signals (the analysis as it's heard), the live beat | `shared/signals/live.ts`, `live-beat.ts` | platform |
| A cover's colours by role | `shared/palette.ts` | platform |
| The vibe (CLAP): its vocabulary, features, model; hearing it in a worker | `shared/signals/vibe.ts`, `clap.ts`; `src/lib/vibe.ts`, `vibe-worker.ts` | platform |
| The looks, the project they play in, the pads | `shared/live-looks.ts` | video |
| MilkDrop's looks (Butterchurn's presets picked, what each suits) | `shared/milkdrop-presets.ts`, `live-milkdrop.ts`; bundled by `vite.config.ts`; drawn by `now-playing-view/milkdrop.ts` | video |
| The visualizer: director, source, keys, view | `src/components/now-playing-view/` | video (`ClientSuite.NowPlaying`) |
| Its own window (a stage) | `src/components/windows/native/stage-window.ts`, `electron/stage.ts` | platform |
| vaudio's 2D visualizers | `shared/effect-library/audio.ts` (Wave Bars ... Acid Plasma) | video |
| The assistant | `now_playing`, `control_now_playing` (`shared/assistant-tools.ts`) | video |

The pill and the store are the platform's (they show in every suite); the visualizer is drawn by the video
editor's preview engine, so it's the video suite's, reached through the suite registry (`nowPlayingView()`).

## The player

Spotify's desktop app answers AppleScript (JavaScript for Automation, `osascript -l JavaScript`): no account, no
developer key, no Premium. `SPOTIFY_READ` asks without starting it (`Application("Spotify").running()`), about once
a second while it plays (slower when paused or closed); answers are shared for 400 ms. macOS asks the user once to
let the app control Spotify (Privacy › Automation, `NSAppleEventsUsageDescription`); if they said no, the pill says
so (`not-allowed`). Spotify's AppleScript gives `duration` in milliseconds, though its dictionary says seconds.

Only Spotify on a Mac for now. Apple Music answers AppleScript too (its cover is data, not a URL); Windows has a
now-playing API of its own (GlobalSystemMediaTransportControls). Either is another `Player`.

`EDITOR_NOW_PLAYING=stand-in` plays made-up songs (the e2e tests, the sheet): closed until told to play, so other
specs never see a pill. Its `demo` flag makes the tab measure a made-up drum loop (`demoSong`) instead of listening.

## Listening

The tab asks for a screen share's sound (`getDisplayMedia`). The desktop app answers it itself
(`setDisplayMediaRequestHandler`) with the system's sound (`audio: "loopback"`: Core Audio's process tap on a Mac,
Electron 39+, which needs `NSAudioCaptureUsageDescription`) and **its own page as the picture**, so it never asks to
record the screen. In a browser the share picker asks: a screen with its sound, or Spotify's web player's tab.

The sound goes through an audio worklet (`TAP`, a render quantum a message) to the page, never to the speakers, and is
measured as it arrives by `LiveSignals`: the file analyser (`SignalAnalyser`, `live`: a frame measured 11 ms after its
moment, its band window placed earlier) run live, read through the same `SignalData` as it grows, so
links, visualizers and 3D scenes react to it unchanged. What a file works out from all of itself is worked out from
what's been heard: references from the last 20 s, hits as soon as they peak, the beat followed by a phase-locked
tracker (`LiveBeat`: past beats stay put, the next 4 s are predicted), drops where the sound jumps up. About 1% of
a core; ~50 kB a second kept, so a session restarts on a song change after 10 minutes. Listening stops when the
visualizer closes (macOS shows that the computer's sound is being captured).

Gotcha: in `pnpm dev:desktop` the Electron in `node_modules` is started from a terminal, which macOS holds
responsible for capturing sound: without the terminal's own `NSAudioCaptureUsageDescription`, the stream is silent
(no error). The packaged app (`pnpm update:desktop`) has the key.

## The visualizer

A project of its own (`liveProject`), played by a `PreviewEngine` (`lowLatency`: one frame on the GPU at a time) whose
source (`LiveSource`) is the listening session's time, the newest moment measured (see Sync), and whose signals are the
live ones (`SignalReader.live`: a new store each frame, so nothing read from it goes stale, but the same session, so
simulations and 3D scenes keep their states, `simulation.ts`). Its tracks, top first: the perform layer (the keys'
punches and hue), the looks (each a nested sequence, switching through one of `SWITCHES` on the next bar), the sound
heard, and the pads (a muted track whose "sound" is the keys' hits, `padSignals`). `LiveDirector` keeps it.

A **look** (`LIVE_LOOKS`) is layers of editor effects for a palette and a seed (`LookContext`): a song's colours by
role (`AlbumPalette`: background, primary, secondary, accent, light) and a variation of its own (the song's id, the
look's, `M` for another). Worlds are the 3D scenes tinted by a Gradient Map; spectrums draw the sound plainly; trips
are vaudio's world presets (a visualizer fed back into itself); chaos is vaudio's chaos (see Chaos). Album shows the
cover (`COVER_ASSET`, an image the view attaches, `ImageSlots`). The kit looks are built from (signals, punches,
layers) is `shared/live-kit.ts`.

How looks change by themselves (A, the "Change looks" menu, `AUTO_SWITCHES`): never, following the music (see
Following the music), or every beat, bar, 2, 4, 8, 16 or 32 bars, each a look that suits the music. Every 4 beats or
more often (`CUT_BEATS`) a look cuts in on the beat, carried on from the last one heard (`onTheBeat`): there's no
time for a transition. Less often, through one landing on the bar.

To add a look: an entry in `LIVE_LOOKS` (its colours from the palette only: the test checks), then
`pnpm tsx scripts/now-playing-sheet.ts <id> --moments` (it at the made-up song's breakdown, build-up and drop, checked
for white-outs and black) and `--song some.mp3` to look at it on real music (the made-up song is too plain to judge a
spectrum by). Watch for white-outs: Feedback in lighten mode, glow and bright colours add up, and more so in a drop.

The looks are picked by the music (it's what the visualizer's for: Théo's); picking one yourself is the **looks menu**
up top (`LooksMenu`: the look playing on its button; Shuffle, then each kind opening its looks beside it, Shuffle of
that kind first), or the keys and R. There's no list of them along the bottom.

The keys (`keys.ts`, vaudio's play mode): ← → looks, ↑ ↓ kinds, R random, M another variation, = chaos, - mutate,
A how looks change, Z X C V punch, flash, split, twist, 1–0 turn the colours, T Y [ ] , . the frame (repeat, mirror,
turn, zoom), Q W E more warp, swirl, ripples (⇧ less), D every setting, ⌫ wash, Space play or pause, ⇧← ⇧→ songs,
F full screen, P the mini player, O its own window, H hide the controls, S tap along, ⇧S slow motion, I what it hears,
? the list, Esc close. They're the visualizer's alone while it fills the app (caught before the editor's); in a box
over the app, once it's been clicked (until something else is); out of the app, in its own window.

## Where it is

Four places (`placement.ts`, kept in `useVisualizerPrefs.place`, so the pill opens it where it was left): **filling the
app** (the first time), **a window** over it, **the mini player** (360 × 203 in the bottom right corner), both moved by
dragging them and resized by their edges, kept inside the app; and **out**, in a window of its own (O). Double-click goes
between filling the app and the box it was; P between the mini player and what it was. Small (under 640 × 300) it shows
only the mini player's controls: the song, play and skip, where it is, full screen, close.

Out, it's a **stage** (`openStageWindow`, `STAGE_PREFIX`): opened with `window.open`, the page draws into it as it does
a panel (one script, one set of stores: the view is a portal into it, the canvas made again there). Unlike a panel it's
an ordinary window, a browser's popup too; in the desktop app a framed window of the system's (`electron/stage.ts`):
it goes to another screen and full screen there (F), and is pinned over other programs on asking (the pin, kept). The
engine draws on the frames of its canvas's window, and the source ticks on them (`drawIn`): a window only has frames
while it's seen. Closing its window closes the visualizer; it opens out again next time. Refused (a browser's popup
blocker, which wants a click), it stays in the app.

## Sync

The picture of a moment is seen about 45 ms after the sound is sent to the speakers (`latencyOf`): macOS capturing it
(~10 ms, a guess), the chunk it arrives in (~1 ms), the analysis (11 ms), drawing (a frame waits half a frame for its
turn, then is seen a frame later: 25 ms at 60 Hz). The ears hear it when the speakers play it (Bluetooth headphones:
150–250 ms after the computer sends it, Settings › General › Sound delay, measured by tapping along: S).

What's known ahead is shown early by the difference (`LiveSignals.lead`): the beat (moved early in the signals'
rhythm) and the hits expected on it (`expected`: a beat of the bar that had a kick, or a snare, in nearly every one of
the last four bars expects the next one, placed where those hits fell against the beat; one that doesn't come is
dropped once it's past). So kicks and snares on the beat are on screen as they're heard (within a frame, on average
within a few ms); a hit nobody could expect is ~45–60 ms late (it was ~115 before step 1 of the plan). When the ears
are the later ones (headphones), everything waits for them instead (`wait`). The beat holds:
a tempo related to it (half or double time, a 3-3-2 pattern's dotted quarter) takes over only after winning for 10 s
(`TEMPO_PATIENCE`), an unrelated one (a new song) in 1.5 s; a beat that flips would throw everything on it off.
`src/components/now-playing-view/latency.test.ts` runs the whole pipeline at 60 fps and checks it.

## The mood

`LiveMood` (`shared/signals/mood.ts`, kept by `LiveSignals`, read four times a second) hears what kind of moment it
is, for looks to follow (steps 3 and 5):

- **Intensity** (0..1): how much is going on over the last 3 s: loudness against full scale and against the song's
  own loud parts, hits a second in each band (each band's own: the loudest band's would hide hats behind kicks), kicks
  a second, the sub-bass's share. Rises in ~0.6 s, falls in ~2 s (Synesthesia's `syn_Intensity` idea).
- **Presence**: each band (low, mid, high) getting busier or quieter: its last 2 s against the 6 s before.
- **Sections**: a drop where the low end comes in suddenly (`LiveSignals.findDrop`, looked for every frame over the
  last 0.3 s, so a big one is known a few ms after its kick and placed on it; a riser growing louder isn't one),
  a build-up where intensity climbs or the low end is gone and the highs rise, a breakdown where intensity has fallen
  well under the last 12 s's highest with no kicks. Each held until the song moves on (no flicker).
- **Character**: chill, groove, hype or heavy, from the song's typical intensity, density, steady beat, sub-bass,
  brightness, loudness and tempo since it started (`newSong`, on a new track), taken as it is for its first 10 s,
  then another must lead for 6 s to take over. `sure` says how settled and clear the call is.
- **Slow** (`slowness`, `isSlow` at 0.5): how slow the song feels, apart from its character. Its tempo as felt (under
  98 BPM some, under 78 all; a fast beat with few kicks on it is half time, as a ballad's at 72 read at 144), and only
  if it's sparse (7 hits a second some, 14 none: a trap song's hats at 75 aren't slow), followed over the last 6 s (a
  tempo read wrong for a while, at 3:2, or for a moment, doesn't stick). A slow song is never hype however loud it's
  mastered (and real songs are: their intensity is 0.65–0.9), and leans chill. On a slow song everything flows (Théo:
  "less abrupt, just flow into each other"): only looks that flow (`LookSuits.flows`: no bars or waveforms bouncing,
  no rushing worlds), its intensity held to 0.65 for them, every change a long blend with a feedback morph (3–6 s on
  the bar; its drop a shorter one, not a cut), the effects calm throughout. And it's in **slow motion** (Théo: "even
  slow songs go through a bunch of fast effects"): its looks are made at half speed (`ctx.pace`, `inSlowMotion`:
  everything a second, as its unit says, a zoom a second eased towards none), its hits swell (rising over 0.12 s at
  least, falling twice as long), and its energy doesn't shake, strobe, split or flash. The clock isn't slowed (the
  picture would leave the sound): the motion is, as a look is made, since a shader's time × speed jumps if its speed
  changes as it plays. Slow motion starts at a slow song and stops under 0.4 (no flicker on the line), the look shown
  then melting into itself made again (`slowMotionOn`).
- **Slow motion by choice** (Théo: "if the normal vibes are too much"): Speed along the bottom (Follow the music or
  Slow motion, `Pace` in `prefs.ts`), ⇧S, or the assistant's `control_now_playing` `pace`. Set, every song is taken as
  a slow one (`slowedDown`: `slow` 1, and a hype song as the kind it most is after hype, since a slow song is never
  hype): everything above, the flowing looks, the blends, the calm effects, half speed. Staying on one look (looks
  changing off), it's made again in slow motion even if it doesn't flow.

I shows it all in the visualizer (`mood-readout.tsx`), with the measurements under it; the assistant's `now_playing`
says it too. `mood.test.ts` checks it on made-up music (a pad, a groove, a club track, a half-time heavy track, a loud
ballad, and a song with a build-up, a drop and a breakdown); its numbers are tuned against those, so real music is the
real test. Slowness was checked on 19 real songs: the slow ones (70–77 BPM, sparse) read 0.8–0.95, the rest under 0.3.

## The vibe

What the rules above can't hear (a slow song mastered loud reads as intense; trap, a ballad and techno look alike to
loudness and hits) a model can: **CLAP** (LAION's larger CLAP for music and speech, Apache-2.0, as Xenova's ONNX
export), run on this computer. CLAP puts sound and text in one space, near when they match; so ten seconds of the
song are placed:

- **On axes**, each two opposite descriptions (`VIBE_AXES`): calm–intense, dark–bright, soft–harsh, slow–fast,
  dry–dreamy, free–groove; by which end the sound is nearer, centred on how real music reads (21 of Théo's songs,
  three windows each: `vibe.json`'s calibration), ±1 at two spreads. Pairs, because a single description that's near
  every sound (CLAP's "a euphoric festival EDM drop") would always win.
- **Among genres** (`VIBE_GENRES`, 24): its nearest three.

The song's vibe is its readings blended (from 8 s into it, so the song before isn't in it). It says **70% of the
song's kind** (`vibeCharacters`: chill is calm, soft and slow; groove the middle, not harsh, with a groove; hype
intense, bright and fast; heavy aggressive, intense and dark), the rules the rest; and it moves the **intensity** up
or down by as much as 0.2 (a calm song mastered loud is calmer than its loudness). On Théo's songs the rules called
nearly everything hype; with the vibe they're chill (need, goodmix1, kozdz, Untitled), groove (twentythree, sowhat,
botvox), hype (DIATRIBE, swagdemo2, leakssped) and heavy (drakhorse).

- **Where it runs**: in a worker (`src/lib/vibe-worker.ts`), ONNX Runtime Web on the CPU (WebAssembly, one thread:
  about 630 ms a reading on a Mac; WebGPU would take 25 ms, but the GPU is the visualizer's), a reading every 5 s while
  listening (`VibeHearing`). The features are CLAP's log-mel spectrogram (`clap.ts`, checked against transformers.js's
  to 0.0001 dB). Only the audio side ships: the text side ran once (`scripts/clap-vibe.ts` made `vibe.json`: run it
  again with songs to change the axes or genres, or centre them on other music).
- **The model**: 282 MB, downloaded once when the user says yes (the visualizer's offer, `vibe-offer.tsx`; Not now is
  kept), into the models folder (`/api/now-playing/vibe`, the platform's `DownloadedModel`). Without it, the rules
  alone. The tests stand in for it (`EDITOR_VIBE_MODEL=stand-in`: a made-up vibe).
- **Seen**: I shows its genres and axes; the assistant's `now_playing` says them.

## Energy

How much is going on drives every look, through the mood's intensity (step 3 of the plan):

- **`intensity`** is a signal like the others (`SignalName`, in `BUILT_IN_SIGNALS`), so links, expressions and the
  assistant read it: `LiveSignals` keeps it four times a second (`SignalData.intensity`), and a file's is worked out
  once from its signals (`intensitySeries` runs `LiveMood` over them), so a look reads the same live and in the editor.
- **A link's depth** (`ParamLink.depth`: a signal, a floor, a threshold, `depthOf`): the link moves `floor` of its
  amount while that signal is under the threshold, all of it at the top. A kick's punch with an intensity depth is a
  nudge in a breakdown and a slam in a drop. `link_param` takes it.
- **Every look's punches** (`punch` in `live-looks.ts`) have an intensity depth (a fifth of the punch at the quietest),
  with headroom (`HEADROOM`, 1.6×): a drop punches harder than the looks did before, a breakdown much less.
- **The energy layer** on top of every look (`energyLayer`; its strengths by kind in `ENERGY`, a look's own in
  `LiveLook.energy`): it shakes (intensity past 0.6), strobes on the snares (past 0.72), splits the colours on snares,
  inverts on the downbeat at the very top (trips only), punches the scale on kicks, and turns the exposure and
  saturation up with the intensity: a breakdown is a little dimmer and greyer than the look, a drop as bright and
  richer. Exposure, not Brightness: an offset wipes out a breakdown's faint trails and Contrast whites out a drop.
- Worlds fly faster and react more as it rises (their scene's speed and reactivity follow it); Echo Tunnel, Hyperdrive
  and Kaleido Cathedral zoom and turn with it.

The made-up song (`demoSong`) has a song's shape for this: a breakdown, a build-up and a drop, 16 bars at 124 BPM
(`DEMO_SECTIONS`). `now-playing-sheet.ts --moments` shows every look at each, a sheet per kind, and fails a picture
blown out to white or crushed to black (three frames a moment, judged by the middle one: a strobe's white frame is
fine). Its build-up is a white-noise riser, so the spectrums are fuller there than in its sparse drop: judge them on
real music. A look whose shapes vanish when it's quiet gets a floor (Hard Shards' At Rest) rather than more gain.

## Chaos

vaudio's chaos (step 4 of the plan), rebuilt in the editor's effects (`shared/live-chaos.ts`):

- **The World Loop** (`world-loop`, a simulation in `effect-library/simulation.ts`): vaudio's world stage. The picture
  coming in is bent (push, swirl, kaleido, ripple, warp, mirror; its colours split from the middle), then laid over its
  own echo, which zooms, turns and changes hue a second's share each frame, and also flows: swirled and warped inside
  the loop (MilkDrop's secret, which vaudio hasn't). Rates are per second, so it's the same at any frame rate;
  `server/simulation.test.ts` checks a frame is the same however it's reached.
- **Nine recipes** (`CHAOS_RECIPES`, vaudio's archetypes: Liquid, Tunnel, Fractal Bloom, Datamosh, Acid, Rorschach
  (its Séance), Neon Skeleton, Vortex, Stargate (its Hyperdrive)), each a look of kind chaos. A roll (`rollChaos`, from
  the look's random: another each song and each M) draws its world in vaudio's own ranges and units, and one or two
  layers (vaudio's `randomLayerFx`: a blend from the recipe's, one or two distortions, a colour style, spin, drift,
  pulse, shimmer), from sources the recipe picks (vaudio rolls the layers you have). The recipe's headline value grows
  with the intensity (vaudio's random `energy`, live), the rest move with the sound.
- **What vaudio's frames look like** (a recording of it in play, compared roll by roll): small hot things floating in
  black, copied round a kaleido or a mirror or in tiles, their colours split wide. So a roll is mostly the void (the
  cover's darkest colour, nearly black); things sit off the middle, smaller, *where its repeat shows them* (a kaleido
  takes only a thin wedge just right of the middle, a mirror the right half: elsewhere they're cut away and the frame
  is black, `direction`); most rolls repeat; colours split wide; the hues are vaudio's harmonies (complementary,
  triadic...) from the cover's, sometimes posterized. Its scribbles are the Lissajous (`audio-lissajous`: the sound
  against itself a moment later, white-hot where its strokes cross). The cover is a thing in the frame too, not a
  backdrop.
- **Guard rails** (`guarded`, tested over hundreds of rolls): vaudio's (the echo under 0.93; no strobe over a heavy
  echo) and ours: a frame-filling source's echo under 0.6; Added or Dodged layers held back; nothing near white drawn
  (the palette's light); the brighter its colours, the less a roll's fed back and exposed (`glareOf`: a yellow cover
  piles up to white where a blue doesn't); the hue swings about the cover's rather than going round the wheel (but in
  Acid).
- **Mutate** (`-`, `mutateWorld`): vaudio's: every world value nudged by up to 0.12, the layers kept, blended in
  (`LookContext.mutations` counts them). On a look that isn't chaos, `-` is another variation.

`now-playing-sheet.ts chaos --rolls 24 --song some.mp3` rolls each recipe 24 times on a song, numbered, a sheet each,
every roll checked for white and black (about 1 in 100 still just tips over). `--record 45 --song some.mp3 --from 48
--every 6.5` films it instead: the canvas as it draws, the song laid under it in step (an mp4), chaos rolled every so
often (or `--auto bars2`, the looks changing by themselves): for seeing it move, with the music. The stand-in player's covers look like
covers (a sky, a striped sun, hills, a grid, a title, grain), so a look that bends the cover is tried on something
like one.

## Following the music

Which look plays when looks change by themselves (step 5 of the plan, `chooser.ts`, pure and tested):

- **What a look suits** (`LiveLook.suits`): the kinds of song (`LiveMood`'s characters: chill, groove, hype, heavy),
  the intensities it reads well at (0..1), and whether it's minimal (for between songs). Every look says; a test
  checks every kind of song has three looks at least at every intensity it's likely to have.
- **Picking** (`pickLook`): a look that suits the moment (its range, with a margin of 0.08; the song's kind once it's
  sure of it), not one shown lately, at random weighted to the middle of its range. A drop wants an intense look
  (even before the intensity has caught up), a breakdown a calm one (by the intensity alone: a hype song's breakdown
  is calm), a fit isn't a minimal one.
- **Following** (`LookChooser.follow`, "Follow the music"): a new song starts on something minimal until it's known
  what kind of song it is, then a look for it; a drop brings an intense look at once, a breakdown a calm one on the
  bar; a build-up changes nothing (it lands on the drop). Each 8-bar phrase the look's checked: changed if it no
  longer suits; else a chaos look is mutated (and changed after 32 bars), another varied (and changed after 16: it
  doesn't evolve as chaos does). Far outside its range (0.2) for a couple of bars, a look's changed then. A long
  quiet (between songs) goes minimal. The every-so-many-bars switches pick by the music too (`pick`).
- **Why**: every choice says why (`Choice.why`), in the log (`now-playing`: info, but switching every 4 bars or more
  often only at debug) and the mood readout (I, the last three). The assistant's `now_playing` lists what each look
  suits.

The test plays made-up songs of each kind through it (an intro, a build-up, a drop, a breakdown, again) and checks no
look plays out of its range longer than a phrase, nor far out longer than a couple of bars; a build-up keeps its
look. `now-playing-sheet.ts --record 104 --song some.mp3 --auto song` films a whole song followed, with the choices
beside it (`<out>.txt`).

## Transitions and the frame

How one look gives way to the next, by the music (step 6 of the plan, `switches.ts`, pure and tested), from why it's
changing (`SwitchReason`, the chooser's or a key's):

- **A drop**: a hard cut on its kick, with a flash. The drop's known a few ms after the kick (`findDrop` every frame),
  the cut's placed on it, and how late it's drawn is logged (`cut on the drop N ms after its kick`): 0–30 ms on the
  made-up song and a real one, a frame being 17.
- **Calm** (a breakdown, a quiet, a new song, a chill song, intensity under 0.35): a slow blend (film, blur, luma or
  additive dissolve, morph, liquid), two bars (2–4.5 s) landing on the bar, with a **feedback morph**: a World Loop over
  everything swelling up to the switch and dying away after, so the look going melts into the one coming.
- **A groove**: a punch a beat long landing on the downbeat (cross-zoom, whip, pull-in, spin, zoom-out, swirl, light
  leak). **Glitches** (glitch, datamosh, RGB split, VHS) only where a glitchy look comes or goes
  (`LookSuits.glitch`: VHS Séance, Cyberspace, Datamosh).
- A build-up changes nothing (it lands on the drop); a key's switch is a quick dissolve; chaos (=) a flash.

**The frame** (`Frame`, on the perform layer, over any look: the editor's Transform, as the video editor's Motion has
it): repeated (2×2, 3×3, 4×4: zoomed out, its edges tiled), mirrored (the copies each beside its reflection; one copy,
mirrored down the middle), turning, zoomed, eased over a beat (`setFrame`, an expression with `ease()`; a turn carries
on from where it was: `frameAngle`).

**The effects engine** (`effects-engine.ts`, pure and tested; the "Effects" menu, `useVisualizerPrefs.effects`) plays
the frame and the distortions and feedback by itself, by the music, landing on its beats:

- **Follow the music** (the default): every set has a feedback move, Théo's favourites (soft trails, smoke: the echo
  flowing as it fades, a tunnel, a sinking echo, a colour echo, a deep tunnel), and a few others: calm, something
  gentle every 4 bars eased over a bar (a mirror, a mirror fold, a slow warp, a soft kaleidoscope); a groove, a set
  every 4 bars mutated after 2 (a swirl, ripples, a kaleidoscope, a warp); intense, a set every 2 bars mutated on the
  bar between (a kaleidoscope, a swirl, a lens, a warp). A build-up tightens bar by bar (more kaleidoscope and swirl,
  the echo drawn in); a drop is clean on its cut (the new look's impact), then goes hard a bar on; a breakdown washes
  back to gentle over a bar. It never turns the picture, repeats it or zooms out: a mirror only mirrors (Théo found
  the turning too much).
- **Every beat**: a new set on each downbeat, a mutation of it on each beat between (mirrored or not, the echo sinking
  or rising, its colour on, its trails longer or shorter, a kaleidoscope in or out; never the same twice running).
  With looks changing every 4 bars it's Théo's "every few beats mutated a bit, the next bar a new effect". **Every
  bar**: a new set on each downbeat.
- **By hand**: the panel and the keys. Touching either takes the effects over from the engine as they are.

A chaos look gets no feedback of the engine's (it has its own world: it gets one more of the other moves instead);
feedback stays under 0.8. Before the music's
downbeats are known, bars are counted in beats. Every change says why (the log: info, every beat at debug; the I
readout). Changing a setting doesn't wipe a World Loop's trails: heard live, a simulation's state is kept by its clip's
id, not its contents (`simulationVersion`), as vaudio's is.

**The player's settings** (D, the panel `play-panel.tsx`; `LiveFx`, kept in this browser; it shows what plays, the engine's too): vaudio's Distort (fluid
warp, swirl, ripples, kaleidoscope, lens, mirror fold: no pixelate, Théo had it out) and Feedback (feedback, trail
length, echo zoom, echo spin, echo hue, and echo flow: MilkDrop's smoke, the echo warped as it fades) panels, in its
units, over any look: a World Loop (warp and swirl moving with the sound) and a bulge. Q W E nudge warp, swirl, ripples as vaudio's do; ⌫ (Wash) puts them and the frame back. The assistant's
`control_now_playing` takes `frame`, `fx` and `effects` (who plays them); `now_playing` says what's set.

## MilkDrop

Step 8 of the plan: MilkDrop 2's presets, drawn by Butterchurn (WebGL 2), as looks (`kind: "milkdrop"`). 259 of the
1,754 `butterchurn-presets` has converted (`MILKDROP_PRESETS` in `shared/milkdrop-presets.ts`), picked from
`scripts/milkdrop-sheet.ts`'s sheets: every preset played on real songs in headless Chromium on the GPU and measured
(what a frame costs, how bright, how much white or black, how colourful, how fast it moves), then looked at. Out:
anything mostly black, blown out, slow to draw (over 4 ms a frame), still or strobing, garish, muddy, dim, washed out or
noisy. In: shapes and light in a black void, kaleidoscopes, feedback, calm scenes. The intensities each suits are from
how fast it moves; its kinds of song, and whether it flows (slow songs) or is minimal, by eye. The first 115 are from
its four packs' 395 (2026-10-14); 144 more (Théo wanted more variety) from the 1,360 in no pack (2026-10-15: 293 out on
the numbers, 1,067 looked at on `--resheet` sheets of those left). The menu lists them by name.

- **Drawing** (`milkdrop.ts`): one Butterchurn of its own on a canvas of its own (1280 × 720), which the preview engine
  takes as a live picture each frame (`PreviewSource.livePicture`, `MILKDROP_ASSET`): the editor's energy layer,
  effects, frame and transitions go over it as over any look. It draws only while a MilkDrop look is on screen
  (`LiveDirector.shownAt`). One look giving way to another, both MilkDrop's, is MilkDrop's own blend over the switch
  (both sides show the one canvas); from any other look, the preset's there at once.
- **Sound**: it hears what the rest does, at the picture's time (`LiveSignals.soundAt`: the last two seconds of the
  sound kept), so it's as in sync; in slow motion its time runs at half speed.
- **Cost**: 1.3 ms a frame on average (3.7 at most) on a Mac's GPU, on top of the engine's. Butterchurn and the presets
  load a moment after the visualizer opens: exactly those picked, one module of about 1.3 MB (less than the four packs
  were) made from their files by `vite.config.ts` (`virtual:milkdrop-presets`), so adding one is a line in
  `milkdrop-presets.ts`.
- **Picking**: the chooser picks them as any look, each kind as likely as another however many looks it has. In the
  looks menu they're a kind as any other (Shuffle MilkDrop, then each by name); the arrows don't step through them, and
  ↑ ↓ landing on MilkDrop shuffles. They keep their own colours (not the cover's), and the effects engine plays only
  frames and light distortions over them, as over chaos (they feed back into themselves).
- **Licences**: Butterchurn and `butterchurn-presets` are MIT; the presets are MilkDrop's community's, shipped in that
  package.

## The plan (v2)

After Théo's feedback (2026-10-14: the looks are milquetoast and ignore the song's mood, transitions read as amateur,
the picture is late, and the visualizer should be a window), one step at a time, each passed by him before the next.
Only the e2e spec a step touches is run (`e2e/now-playing.spec.ts`), never the whole suite.

1. **Sync** (done): see Sync. Pass: `latency.test.ts` (on-beat kicks within a frame, on average within 5 ms; others
   under 60 ms), the L readout (since removed: Théo didn't want it), and Théo's eyes on a kick-heavy song.
2. **Reading the mood** (done): the above. Pass: `mood.test.ts` on made-up music; I in the visualizer, and Théo's
   ears agree on real songs.
3. **Energy drives every look** (done): see Energy. Pass: each look on one song at a breakdown, a build-up and a drop,
   clearly different; nothing blown out or black (`now-playing-sheet.ts --moments` checks); Théo's eyes.
4. **The world stack** (done): see Chaos. Chaos and mutate are vaudio's own keys (= and -: C and M were taken).
   Pass: sheets green; a chaos sheet of 24 rolls a recipe on real music, none white or black; Théo scores a round and
   the ranges are tuned. Théo also asked for switching every beat and bar (done) and to drop the L readout (done).
5. **Picking looks by mood** (done): see Following the music. Pass: a test that a look never plays out of its range
   (for longer than a phrase); a log of each choice and why; Théo watches whole songs.
6. **Musical transitions** (done): see Transitions and the frame; with it, Théo's asks: the frame (repeat, mirror,
   turn, zoom, as the video editor's Motion) and vaudio's Distort and Feedback panels (D), played by the effects engine
   by the music (his: "I want the engine to know when to apply the effects"). Pass: drop cuts within a frame or two of
   their kick on a clear drop (logged; 80–140 ms on a softer one); films of whole songs; Théo's eyes.
7. **Its own window** (done): see Where it is. Pass: an e2e test (the mini player, moved and resized, its keys
   scoped, opened where it was left; out in its own window, drawn there, back in), the desktop smoke test (a framed
   window of the system's, drawn, its keys its own), Théo uses it.
8. **MilkDrop** (done): see MilkDrop. Pass: licences (MIT), 60 fps (1.2 ms a frame, 3.6 at most), Théo decides.

## Not yet

Spotify alone in a per-app tap (now: the whole computer's sound), synced lyrics (LRCLIB), Apple Music and Windows, preset rounds scored by Théo.
