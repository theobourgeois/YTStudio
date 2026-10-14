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

The sound goes through an audio worklet (`TAP`) to the page, never to the speakers, and is measured as it arrives by
`LiveSignals`: the file analyser (`SignalAnalyser`) run live, read through the same `SignalData` as it grows, so
links, visualizers and 3D scenes react to it unchanged. What a file works out from all of itself is worked out from
what's been heard: references from the last 20 s, hits as soon as they peak, the beat followed by a phase-locked
tracker (`LiveBeat`: past beats stay put, the next 4 s are predicted), drops where the sound jumps up. About 1% of
a core; ~50 kB a second kept, so a session restarts on a song change after 10 minutes. Listening stops when the
visualizer closes (macOS shows that the computer's sound is being captured).

Gotcha: in `pnpm dev:desktop` the Electron in `node_modules` is started from a terminal, which macOS holds
responsible for capturing sound: without the terminal's own `NSAudioCaptureUsageDescription`, the stream is silent
(no error). The packaged app (`pnpm update:desktop`) has the key.

## The visualizer

A project of its own (`liveProject`), played by a `PreviewEngine` whose source (`LiveSource`) is the listening
session's time, a little behind the newest sound measured (plus Settings' sync offset), and whose signals are the
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

## Not yet

Spotify alone in a per-app tap (now: the whole computer's sound), the visualizer on a second screen (the visualizer
plan's V9), synced lyrics (LRCLIB), Apple Music and Windows, preset rounds scored by Théo.
