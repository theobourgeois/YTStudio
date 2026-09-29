# Editor

A simple, clean video editor for cutting clips together — short-form first (9:16 by default), but any aspect works.
Drag clips in, arrange and trim them on a magnetic timeline, drop music underneath, export an MP4.

## Quick start

```bash
brew install ffmpeg      # required for import (thumbnails/waveforms) and export
brew install yt-dlp deno # optional: the Online tab (YouTube search, links from TikTok, Instagram, X...)
pnpm install
pnpm samples             # optional: generate a few test clips + a music track in ./samples
pnpm dev                 # server on :5311, app on http://localhost:5310
```

Then drag files from `./samples` (or anywhere) into the media panel or straight onto the timeline.

## Using it

Every video is its own project with its own media. Start one with **New video** (or drop clips on the empty screen),
work on it, then hit **Settle** when it's done: it moves to the *Settled* pile at the bottom of the sidebar and the
editor jumps to your next video in progress. Open a settled video any time, and **Unsettle** it to put it back in
progress. Toggle the sidebar with `⌘\`.

| Action | How |
| --- | --- |
| Import | **Import** button, or drop files on the media panel / timeline |
| Add to timeline | Drag from the media panel, double-click, or hover → **+** |
| Reorder | Drag clips on the video track (it's magnetic — no gaps) |
| Trim | Drag a clip's left/right edge |
| Split | `S` (or ⌘B) at the playhead |
| Delete | `⌫` / `Delete` (the video track closes the gap) |
| Play / pause | `Space` |
| Step | `←` `→` one frame, `⇧←` `⇧→` one second, `Home` / `End` |
| Zoom | `+` / `-`, or ⌘/Ctrl + scroll |
| Undo / redo | ⌘Z / ⇧⌘Z |

### Online media (music and clips)

The **Online** tab in the media panel searches YouTube, or takes a pasted link from any site `yt-dlp` supports
(TikTok, Instagram, X, ...). The **Audio / Video** switch picks what **+** adds: just the sound, dropped on an audio
track, or the whole video (up to 1080p, H.264), appended to the main track. Click a thumbnail to hear it first.
Audio is cached in `data/music`, so previewing then adding (or reusing a song in another video) only downloads once.

Sites regularly break `yt-dlp`; if searches or downloads start failing, run `brew upgrade yt-dlp`.
Mainstream songs baked into a video will likely get muted or claimed when posted, so the export dialog has
**Leave out music**: export without the audio tracks, then add the official sound in TikTok/Instagram when posting.

Select a clip to change its volume or fit (fit/fill) in the inspector; with nothing selected the inspector shows project
settings (aspect ratio, frame rate, background).

## How it works

- **`src/`** — React + Vite + Tailwind + shadcn/ui. State lives in two zustand stores: `stores/editor.ts` (project,
  media library, selection, undo history, autosave) and `stores/playback.ts` (the playback clock).
- **`shared/`** — domain types and the pure timeline logic (`timeline.ts`) used by both sides. Every edit is a pure
  `Project -> Project` function, which is what makes undo/redo and testing simple.
- **`server/`** — a small Express server that stores projects and their media in `./data`, probes media and generates
  thumbnails/waveforms with ffmpeg, and renders exports with a single ffmpeg filter graph.

The browser preview plays the original files with `<video>`/`<audio>` elements synced to the playback clock; the export
applies exactly the same rules (trim points, fit/fill, volume, mute) in ffmpeg.

Projects, media and exports are stored in `./data` (override with `EDITOR_DATA_DIR`). Ports: `EDITOR_WEB_PORT`
(5310) and `EDITOR_SERVER_PORT` (5311).

Import accepts what the browser preview can play: MP4/MOV/WebM/MKV with H.264, HEVC, VP8/9 or AV1 video, and
MP3/AAC/WAV/FLAC/Ogg/Opus audio. Anything else (e.g. old AVI files) is rejected with a hint to convert it to MP4.

## Scripts

| Script | |
| --- | --- |
| `pnpm dev` | server + app with hot reload |
| `pnpm test` | unit + server integration tests (vitest; integration tests need ffmpeg) |
| `pnpm test:e2e` | Playwright end-to-end tests in Chromium (isolated server + data dir) |
| `pnpm typecheck` | TypeScript |
| `pnpm build && pnpm start` | production build served by the server on :5311 |
| `pnpm samples` | generate test media into `./samples` |
