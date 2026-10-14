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
| The pill (tab strip, else Home's bar or the menu row) | `src/components/now-playing/` | platform |
| The tab's state: polling, the cover's palette, listening, the visualizer open | `src/stores/now-playing.ts` | platform |
| Listening to the computer's sound | `src/lib/live-audio.ts`, the grant in `electron/main.ts` (`answerListening`) | platform |
| Live signals (the analysis as it's heard), the live beat | `shared/signals/live.ts`, `live-beat.ts` | platform |
| A cover's colours by role | `shared/palette.ts` | platform |
| The looks, the project they play in, the pads | `shared/live-looks.ts` | video |
| The visualizer: director, source, keys, view | `src/components/now-playing-view/` | video (`ClientSuite.NowPlaying`) |
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

The keys (`keys.ts`, vaudio's play mode): ← → looks, ↑ ↓ kinds, R random, M another variation, = chaos, - mutate,
A how looks change, Z X C V punch, flash, split, twist, 1–0 turn the colours, Space play or pause, ⇧← ⇧→ songs,
F full screen, H hide the controls, S tap along, I what it hears, ? the list, Esc close. They're the visualizer's alone while it's open (caught before the editor's).

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
- **Sections**: a drop where the low end comes in suddenly (`LiveSignals.findDrop`: a riser growing louder isn't one),
  a build-up where intensity climbs or the low end is gone and the highs rise, a breakdown where intensity has fallen
  well under the last 12 s's highest with no kicks. Each held until the song moves on (no flicker).
- **Character**: chill, groove, hype or heavy, from the song's typical intensity, density, steady beat, sub-bass,
  brightness, loudness and tempo since it started (`newSong`, on a new track), taken as it is for its first 10 s,
  then another must lead for 6 s to take over. `sure` says how settled and clear the call is.

I shows it all in the visualizer (`mood-readout.tsx`), with the measurements under it; the assistant's `now_playing`
says it too. `mood.test.ts` checks it on made-up music (a pad, a groove, a club track, a half-time heavy track, and
a song with a build-up, a drop and a breakdown); its numbers are tuned against those, so real music is the real test.

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
6. **Musical transitions**: a hard cut on the downbeat at a drop; a slow blend or a feedback morph in calm parts; no
   cut in a build-up (it lands on the drop); glitches only on glitch looks. Pass: a transition sheet; cuts within a
   frame of the downbeat (logged); Théo's eyes.
7. **Its own window**: a movable, resizable window, from a mini player to full screen; in the desktop app a window
   of the system (on top, or on a second screen). Pass: an e2e test, the desktop smoke test, Théo uses it.
8. **MilkDrop** (optional): Butterchurn as a source, its presets picked by mood. Pass: licences, 60 fps, Théo decides.

## Not yet

Spotify alone in a per-app tap (now: the whole computer's sound), the visualizer on a second screen (the visualizer
plan's V9), synced lyrics (LRCLIB), Apple Music and Windows, preset rounds scored by Théo.
