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
are vaudio's world presets (a visualizer fed back into itself). Album shows the cover (`COVER_ASSET`, an image the
view attaches, `ImageSlots`).

To add a look: an entry in `LIVE_LOOKS` (its colours from the palette only: the test checks), then
`pnpm tsx scripts/now-playing-sheet.ts <id> --song some.mp3` and look at it on real music (the made-up loop is too
plain to judge a spectrum by). Watch for white-outs: Feedback in lighten mode, glow and bright colours add up.

The keys (`keys.ts`, vaudio's play mode): ← → looks, ↑ ↓ kinds, R random, M another variation, A how looks change,
Z X C V punch, flash, split, twist, 1–0 turn the colours, Space play or pause, ⇧← ⇧→ songs, F full screen, H hide
the controls, ? the list, Esc close. They're the visualizer's alone while it's open (caught before the editor's).

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
are the later ones (headphones), everything waits for them instead (`wait`). L shows the numbers. The beat holds:
a tempo related to it (half or double time, a 3-3-2 pattern's dotted quarter) takes over only after winning for 10 s
(`TEMPO_PATIENCE`), an unrelated one (a new song) in 1.5 s; a beat that flips would throw everything on it off.
`src/components/now-playing-view/latency.test.ts` runs the whole pipeline at 60 fps and checks it.

## The plan (v2)

After Théo's feedback (2026-10-14: the looks are milquetoast and ignore the song's mood, transitions read as amateur,
the picture is late, and the visualizer should be a window), one step at a time, each passed by him before the next.
Only the e2e spec a step touches is run (`e2e/now-playing.spec.ts`), never the whole suite.

1. **Sync** (done): the above. Pass: `latency.test.ts` (on-beat kicks within a frame, on average within 5 ms; others
   under 60 ms), the L readout, and Théo's eyes on a kick-heavy song.
2. **Reading the mood**: intensity over the last few seconds, which bands are getting busier or quieter, build-ups,
   drops and breakdowns, the song's character (chill, groove, hype, heavy). A readout shows what it thinks. Pass:
   tests on made-up music; Théo's ears agree on real songs.
3. **Energy drives every look**: one energy control on every look; calm parts drift, drops go off (big punches,
   shake, strobe on snares, inverts). Pass: each look on one song at a breakdown, a build-up and a drop, clearly
   different; nothing blown out or black (checked).
4. **The world stack**: a feedback effect with zoom, rotate, swirl, warp, kaleido, mirror, ripple and hue inside
   the loop (vaudio's and MilkDrop's secret); vaudio's 9 chaos recipes rebuilt (ranges that read well, energy-scaled,
   the cover's colours, guard rails); chaos (C) and mutate (M); sources blended by difference, exclusion,
   colour-dodge, add. Pass: sheets green; a chaos sheet of 24 rolls a recipe on real music, none white or black;
   Théo scores a round and the ranges are tuned.
5. **Picking looks by mood**: every look tagged with the energy and character it suits; mutate on 8 or 16-bar phrases,
   change on drops and songs; something minimal between songs. Pass: a test that a look never plays out of its
   range; a log of each choice and why; Théo watches whole songs.
6. **Musical transitions**: a hard cut on the downbeat at a drop; a slow blend or a feedback morph in calm parts; no
   cut in a build-up (it lands on the drop); glitches only on glitch looks. Pass: a transition sheet; cuts within a
   frame of the downbeat (logged); Théo's eyes.
7. **Its own window**: a movable, resizable window, from a mini player to full screen; in the desktop app a window
   of the system (on top, or on a second screen). Pass: an e2e test, the desktop smoke test, Théo uses it.
8. **MilkDrop** (optional): Butterchurn as a source, its presets picked by mood. Pass: licences, 60 fps, Théo decides.

## Not yet

Spotify alone in a per-app tap (now: the whole computer's sound), the visualizer on a second screen (the visualizer
plan's V9), synced lyrics (LRCLIB), Apple Music and Windows, preset rounds scored by Théo.
