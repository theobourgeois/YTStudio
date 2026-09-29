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
pnpm dev                 # server on :5311, app on http://localhost:5310 (next free pair if taken)
```

Then drag files from `./samples` (or anywhere) into the media panel or straight onto the timeline.

## Using it

Every video is its own project with its own media. Start one with **New video** (or drop clips on the empty screen),
work on it, then hit **Settle** when it's done: it moves to the *Settled* pile at the bottom of the sidebar and the
editor jumps to your next video in progress. Open a settled video any time, and **Unsettle** it to put it back in
progress. Toggle the sidebar with `⌘\`.

| Action | How |
| --- | --- |
| Import | Drop files (video, audio, images) on the media panel / timeline (or click the empty media panel to browse) |
| Add to timeline | Drag from the media panel, double-click, or hover → **+** |
| Move | Drag clips anywhere on a track (they snap to edges and the playhead; the magnet toggles snapping). Drop above the top track for a new video track. `⌥←` `⌥→` nudge, `⌥↑` `⌥↓` move between tracks |
| Trim | Drag a clip's left/right edge |
| Split | `S` (or ⌘B) at the playhead |
| Delete | `⌫` / `Delete` leaves a gap; `⇧⌫` ripple-deletes (closes it). Click an empty stretch of a track and `⌫` to close that gap |
| Play / pause | `Space` |
| Step | `←` `→` one frame, `⇧←` `⇧→` one second, `Home` / `End` |
| Zoom | `+` / `-`, or ⌘/Ctrl + scroll |
| Undo / redo | ⌘Z / ⇧⌘Z |
| Select on the canvas | Click a clip in the preview (the topmost one under the pointer); click empty canvas, or anywhere around it, to deselect |
| Move / scale / rotate | Drag the selected clip on the canvas; drag a handle to scale around the anchor point (⇧ stretches instead of keeping the proportions); drag just outside a corner to rotate (⇧ = 15° steps); drag the crosshair to move the anchor point. ⇧ keeps a move on one axis, ⌥ turns snapping off |
| Text | `T` (or the **T** button under the preview), then click the canvas where the text goes and type; `Esc` when done. Double-click a text to type into it again. Font (any font installed on your computer), style, size, colours, stroke, background box and shadow are in **Properties** |
| Properties | **Properties** tab (or double-click a clip): drag a blue number sideways to change it (⇧ faster, ⌥ finer), click it to type, ↺ resets |
| Transitions | **Transitions** tab: drag one onto a cut or a clip's edge, or **+** / `⇧⌘D` for the cut nearest the playhead. Click it on the timeline to select it, drag its edges to change its length, `⌫` removes it |

### Transitions

The **Transitions** tab has a library of shader transitions: dissolves and dips, pushes, slides and whips, wipes
and shape irises, camera zooms and spins, 3D cubes, flips, page curls and doorways, glitches (RGB split, VHS,
datamosh, pixelate), light (flash, film burn, light leaks) and distortions (ripple, swirl, liquid). Filter them by tag
or search; hover a card to watch it.

Like Premiere, a transition sits on a clip edge. Between two touching clips it plays across the cut (centred on it,
or starting or ending there: **Alignment**), borrowing media from past the clips' in/out points; where the media runs
out, the first or last frame is held. On a free edge it plays inside the clip, from or into whatever is underneath
(lower tracks, or black). Select a transition to change its duration, alignment and its own settings in the
**Properties** tab.

Transitions are exported with the exact same WebGL shaders as the preview, run in a headless Chromium: Playwright's
(`pnpm exec playwright install chromium-headless-shell`) or your installed Google Chrome (or set `CHROMIUM_PATH`).
Exports without transitions don't need it.

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

- **`src/`** — React + Vite + Tailwind + shadcn/ui. The document lives in the zustand store `stores/editor.ts`
  (project, media library, selection, undo history; autosave is in `stores/autosave.ts`), the playback clock in
  `stores/playback.ts`.
- **`shared/`** — domain types and the pure timeline logic (`timeline.ts`) used by both sides. Every edit is a pure
  `Project -> Project` function, which is what makes undo/redo and testing simple. `normalize.ts` validates any
  stored or received project.
  - `effects.ts`: clip properties. A clip carries a list of effects; each effect definition is a list of typed
    parameter specs (`params.ts`: number, point, switch, choice, text, colour, font) that drive defaults, validation,
    the properties panel and evaluation. Values can be keyframed in the data model (`keyframes.ts`, stored in
    source-media time, with interpolation), but nothing creates keyframes yet. To add a property, add a spec (or a
    definition to `EFFECTS`), then draw it in `src/components/preview/engine.ts` and `server/render.ts`.
  - `transitions.ts`, `transition-windows.ts`, `transition-gl.ts`, `transition-library/`: transitions. Each one is a
    GLSL shader plus parameter specs (like effects). `transition-windows.ts` works out where they play on the timeline,
    `transition-gl.ts` is the WebGL renderer shared by the preview, the library thumbnails and the export. To add one,
    add a definition to a `transition-library` file; `pnpm tsx scripts/transition-sheet.ts <type or tag>` renders a
    contact sheet and checks it starts and ends on the right pictures.
  - `transform.ts`: where a clip lands on the canvas (fit, then scale and rotate around the anchor point, which sits at
    the position). The preview's CSS, the canvas handles and the export all use it.
- **`server/`** — a small Express server (one router per resource in `server/routes/`) that stores projects and their media in `./data`, probes media and generates
  thumbnails/waveforms with ffmpeg, and renders exports with a single ffmpeg filter graph. Transitions are drawn
  first (`transition-render.ts`): ffmpeg decodes both sides, a headless Chromium page (`gl-browser.ts`) runs the
  shader, and the frames are kept as a lossless file the main render splices in.

The browser preview plays the original files with `<video>`/`<img>`/`<audio>` elements synced to the playback clock and
placed with CSS transforms. The export applies the same rules (trim points, motion, opacity, volume, mute) in ffmpeg.

Projects, media and exports are stored in `./data` (override with `EDITOR_DATA_DIR`). Ports: `EDITOR_WEB_PORT`
(5310) and `EDITOR_SERVER_PORT` (5311); if they're taken (another checkout or worktree running), `pnpm dev` moves
to 5410/5411, 5510/5511, ...

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

Working on the code (architecture, conventions, how to add things): see [CLAUDE.md](CLAUDE.md).
