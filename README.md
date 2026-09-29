# Editor

A simple, clean video editor for cutting clips together — short-form first (9:16 by default), but any aspect works.
Drag clips and images in, arrange and trim them on the timeline, position them on the canvas, drop music
underneath, export an MP4.

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
| Import | **Import** button, or drop files (video, audio, images) on the media panel / timeline |
| Add to timeline | Drag from the media panel, double-click, or hover → **+** |
| Reorder | Drag clips on the video track (it's magnetic — no gaps) |
| Trim | Drag a clip's left/right edge |
| Split | `S` (or ⌘B) at the playhead |
| Delete | `⌫` / `Delete` (the video track closes the gap) |
| Play / pause | `Space` |
| Step | `←` `→` one frame, `⇧←` `⇧→` one second, `Home` / `End` |
| Zoom | `+` / `-`, or ⌘/Ctrl + scroll |
| Undo / redo | ⌘Z / ⇧⌘Z |
| Select on the canvas | Click a clip in the preview (the topmost one under the pointer); click empty canvas to deselect |
| Move / scale / rotate | Drag the selected clip on the canvas; drag a handle to scale around the anchor point; drag just outside a corner to rotate (⇧ = 15° steps); drag the crosshair to move the anchor point. ⇧ keeps a move on one axis, ⌥ turns snapping off |
| Properties | **Properties** tab (or double-click a clip): drag a blue number sideways to change it (⇧ faster, ⌥ finer), click it to type, ↺ resets |

### Online media (music and clips)

The **Online** tab in the media panel searches YouTube, or takes a pasted link from any site `yt-dlp` supports
(TikTok, Instagram, X, ...). The **Audio / Video** switch picks what **+** adds: just the sound, dropped on an audio
track, or the whole video (up to 1080p, H.264), appended to the main track. Click a thumbnail to hear it first.
Audio is cached in `data/music`, so previewing then adding (or reusing a song in another video) only downloads once.

Sites regularly break `yt-dlp`; if searches or downloads start failing, run `brew upgrade yt-dlp`.
Mainstream songs baked into a video will likely get muted or claimed when posted, so the export dialog has
**Leave out music**: export without the audio tracks, then add the official sound in TikTok/Instagram when posting.

### Clip properties

The **Properties** tab in the left panel shows the selected clip's effects, like Premiere's Effect Controls:

- **Motion** (clips on video tracks): framing (fit the whole frame, or fill the canvas: that's 100%), position,
  scale, scale width (turn off *Uniform Scale* to stretch), rotation and anchor point. Positions are shown in pixels of
  the video at 1080p, anchor points in pixels of the clip's own media.
- **Opacity** (clips on video tracks).
- **Volume** (clips with sound).

Each effect has an **fx** switch to bypass it and a reset button. Images are placed like video. A new image clip is 5
seconds long and can be trimmed to any length, and transparent PNGs show the layers underneath.

## How it works

- **`src/`** — React + Vite + Tailwind + shadcn/ui. State lives in two zustand stores: `stores/editor.ts` (project,
  media library, selection, undo history, autosave) and `stores/playback.ts` (the playback clock).
- **`shared/`** — domain types and the pure timeline logic (`timeline.ts`) used by both sides. Every edit is a pure
  `Project -> Project` function, which is what makes undo/redo and testing simple.
  - `effects.ts`: clip properties. A clip carries a list of effects; each effect definition is a list of typed
    parameter specs (number, point, switch, choice) that drive defaults, validation, the properties panel and
    evaluation. Values can be keyframed in the data model (stored in source-media time, with interpolation), but
    nothing creates keyframes yet. To add a property, add a spec (or a definition to `EFFECTS`), then draw it in
    `src/components/preview/engine.ts` and `server/render.ts`.
  - `transform.ts`: where a clip lands on the canvas (fit, then scale and rotate around the anchor point, which sits at
    the position). The preview's CSS, the canvas handles and the export all use it.
- **`server/`** — a small Express server that stores projects and their media in `./data`, probes media and generates
  thumbnails/waveforms with ffmpeg, and renders exports with a single ffmpeg filter graph.

The browser preview plays the original files with `<video>`/`<img>`/`<audio>` elements synced to the playback clock and
placed with CSS transforms. The export applies the same rules (trim points, motion, opacity, volume, mute) in ffmpeg.

Projects, media and exports are stored in `./data` (override with `EDITOR_DATA_DIR`). Ports: `EDITOR_WEB_PORT`
(5310) and `EDITOR_SERVER_PORT` (5311).

Import accepts what the browser preview can play: MP4/MOV/WebM/MKV with H.264, HEVC, VP8/9 or AV1 video,
MP3/AAC/WAV/FLAC/Ogg/Opus audio, and PNG/JPEG/WebP/BMP (or single-frame GIF) images. Phone photos are shown upright
(EXIF orientation). Anything else (e.g. old AVI files, animated GIFs, HEIC) is rejected with a hint.

## Scripts

| Script | |
| --- | --- |
| `pnpm dev` | server + app with hot reload |
| `pnpm test` | unit + server integration tests (vitest; integration tests need ffmpeg) |
| `pnpm test:e2e` | Playwright end-to-end tests in Chromium (isolated server + data dir) |
| `pnpm typecheck` | TypeScript |
| `pnpm build && pnpm start` | production build served by the server on :5311 |
| `pnpm samples` | generate test media into `./samples` |
