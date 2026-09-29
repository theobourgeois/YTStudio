# CLAUDE.md

A local video editor that runs in the browser. It's short-form first (9:16 by default) and modelled on **Premiere Pro**:
when in doubt about UX, do what Premiere does (Effect Controls, Program Monitor handles, stopwatch keyframes).
It's a React app (`src/`) plus a local Express + ffmpeg server (`server/`), sharing pure domain logic (`shared/`).
README.md is the user-facing guide. This file is for working on the code.

## Commands

```bash
pnpm dev          # server :5311 + app http://localhost:5310 (moves to 5410/5411… if taken)
pnpm typecheck    # tsc -b (app + node projects)
pnpm test         # vitest: shared/, src/, server/ (the server integration tests need ffmpeg)
pnpm test:e2e     # Playwright on :5320/5321 with a throwaway e2e/.data (serial, ~1 min)
pnpm samples      # test media into ./samples
pnpm tsx scripts/transition-sheet.ts [type|tag ...] [--out f.png]   # render + check transitions
```

**Verify every change** with `pnpm typecheck && pnpm test`, and also `pnpm test:e2e` for anything the UI touches.
- Don't edit `src/` while e2e runs: Vite hot-reloads the page mid-test and a test fails for no real reason.
- The e2e tests depend on each other (serial, shared state), so run the whole file rather than `-g` one test.
- After touching a shader or `transition-gl.ts`, run the transition-sheet script. It compiles every shader in headless
  Chromium and checks that each one starts on the outgoing picture and ends on the incoming one.
- If `pnpm install` output looks stale (e.g. "Cannot find package 'playwright-core'"), run `pnpm install`.

## Layout

```
shared/            Pure TS, used by both sides. No DOM, no Node APIs (types only: canvas/WebGL).
  types.ts           Domain + HTTP API types; the route list is documented at the bottom.
  timeline.ts        Queries + edits on Project (clips, tracks, clipboard, snapping, output size).
  normalize.ts       normalizeProject: validates/repairs/upgrades any untrusted Project (load, save, export).
  params.ts          ParamSpec types (number, vec2, boolean, choice, text, color, font…) + sanitize/defaults.
  keyframes.ts       Keyframe validation, interpolation, setKeyframe.
  effects.ts         Effect definitions (Motion, Opacity, Volume, Text, Appearance), evaluation (motionAt,
                     opacityAt, volumeAt, textStyleAt), edits (setParams, resetParams, setEffectEnabled).
  transitions.ts     Transition registry, timing specs, sanitize/patch.
  transition-library/  One file per category of GLSL transitions; common.ts has shared specs.
  transition-windows.ts  Where transitions play on the timeline + edits to them.
  transition-gl.ts   WebGL2 renderer + shader prelude, shared by preview, thumbnails and export.
  transform.ts       Where a clip lands on the canvas (fit → scale/rotate around the anchor).
  math.ts, format.ts, errors.ts   clamp/EPS/roundTime, time formatting, errorMessage.
server/
  index.ts → app.ts  Startup wiring; routes live in routes/<resource>.ts (one Router each).
  projects.ts, media.ts, web-media.ts, exports.ts   Services behind the routes.
  render.ts          Project → one ffmpeg filter graph (pure, unit-tested); planTransitions.
  transition-render.ts + gl-browser.ts   Transitions drawn with the same shaders in headless Chromium.
  process.ts         run()/spawnStreaming(): the only way to start external programs (argv, never a shell).
  config.ts          Every env var is read here and nowhere else.
  storage.ts         DataPaths (data dir layout), HttpError, atomic JSON I/O.
src/
  stores/editor.ts   THE document store: project, assets, selection, undo history, gestures, edit commands.
  stores/autosave.ts, asset-polling.ts   Side effects of the editor store (kept out of it).
  stores/playback.ts The playback clock (rAF). layout.ts = panel/tool UI state. projects.ts = project list.
  lib/api.ts         Typed client for every endpoint. lib/edit-gesture.ts, lib/pointer-drag.ts (see below).
  lib/text-render.ts Text layout + drawing (browser text engine); used by preview, export and canvas editor.
  components/preview/engine.ts   Imperative preview: drives <video>/<img>/<canvas> + WebGL outside React.
  components/preview/sync.ts, placement.ts   Its pure planners (tested).
  components/timeline/  Timeline UI; geometry.ts is its pure maths, view-store.ts its interaction-speed state.
  components/properties/  Spec-driven properties panel (param-rows.tsx renders any ParamSpec).
  components/workspace/left-panel.tsx   Left panel tabs: Media | Online | Transitions | Properties.
  components/ui/     shadcn/ui (generated; icons adapted to react-icons/pi).
```

Imports: `src/` uses `@/…` and `@shared/…`. `server/`, `shared/` and `scripts/` use relative paths **with the `.ts`
extension** (Node ESM through tsx).

## Data model (shared/types.ts)

- `Project = { version, name, settings: { aspectRatio, fps }, tracks, clips }`. All times are seconds (floats).
  Round the results of edits with `roundTime`.
- `tracks` is in display order: video tracks first (index 0 is drawn **on top**), then audio tracks. There's always at
  least one video track. Clips are placed freely (gaps allowed), never overlap on a track, and never start before 0.
- `Clip = { id, assetId, trackId, start, in, out, effects, transitionIn?, transitionOut? }`. `start` is timeline time;
  `in`/`out` are **source** time. Duration is `out - in`. Stills and text have no source range, so their `in` can be
  anything, even negative.
- Text clip: `assetId: ""` plus the Text and Appearance effects (`isTextClip`). The browser draws text in any installed
  font. The export receives PNGs drawn by the browser (`ExportRequest.texts`). Don't switch to ffmpeg `drawtext`.
- `Effect = { id, type, enabled, params, keyframes? }`. Built-in effects (motion, opacity, volume) are on every clip,
  and Text/Appearance on text clips. All of these have `id === type`, and code addresses them by type.
- Keyframes are stored in **source time** (so they stay on their frame when the clip moves, trims or splits). Read
  values with `sourceTime(clip, playheadTime)`. The model and the preview support keyframes; there's no keyframe UI
  yet, and **the export ignores them** (every value is taken at `clip.in`).
- Transitions are stored on clip edges. At a cut, the outgoing clip's `transitionOut` wins. See
  `transition-windows.ts` for the rules, and use `storedTransition`/`findWindow`/`refKey` rather than reading fields.
- Media (`MediaAsset`) belongs to one project. `kind` is video | audio | image. Filmstrip and waveform generation
  finish after import (`status: "processing"`).

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
- Autosave (`stores/autosave.ts`) saves the project when it changes outside a gesture: debounced, one request at a
  time, retried, and flushed before switching projects.
- UI state that changes at pointer speed (ghosts, snap guides, scroll) goes in `timeline/view-store.ts`, never in the
  editor store.
- Store subscriptions: select the narrowest value possible. Use `useShallow` for derived arrays, maps or objects.
  Never subscribe to all of `project` in something that renders during drags or playback.

## How to add…

- **A property on an existing effect**: add a spec to its definition in `shared/effects.ts`. The panel, validation
  and keyframing then work automatically. Then apply the value where clips are drawn: preview
  (`components/preview/engine.ts` / `placement.ts`) and export (`server/render.ts`: `placeForRender`, `videoChain`,
  `audioChain`).
- **A new effect**: add an `EffectDefinition` to `EFFECTS` (`builtIn` puts it on every clip it `appliesTo`), plus the
  same preview and export work. Adding effects to clips by the user (Premiere's Effects panel) doesn't exist yet.
- **A new kind of parameter**: a spec type and a `sanitizeValue` case in `shared/params.ts`, a row in
  `components/properties/param-rows.tsx`, and display maths in `properties/display.ts` if it's numeric.
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
- **A left-panel tab**: add it to `LeftPanelTab` (`stores/layout.ts`) and to `TABS` in `workspace/left-panel.tsx`.
- **A clip kind (like text) or a track kind**: there's no registry yet. Clip kinds are branched on in
  `preview/engine.ts` (`kindOf` and each kind's slots), `preview/stage.tsx`, `preview/placement.ts`,
  `timeline/timeline-clip.tsx`, `timeline-menus.tsx`, `properties-panel.tsx`, `server/render.ts` and
  `server/exports.ts`. Track kinds assume video|audio in `shared/timeline.ts` (addTrack, pruneEmptyTrack,
  canPlaceOnTrack), `normalize.ts`, `timeline/geometry.ts`, `track-headers.tsx`, `lane-overlays.tsx`,
  `clip-gestures.ts` and `editor.ts` (`addAssetsToTimeline`, `moveSelectedToTrack`). Consider adding a registry
  before a third kind.

## Conventions

- Match the surrounding style: short doc comments on exports that say *why*, British spelling in prose ("colour",
  "normalise"), no drive-by reformatting.
- `cn` comes from the `cn` package (`import { cn } from "cn"`). Icons are `react-icons/pi` (Phosphor). UI primitives
  are in `components/ui` (shadcn, new-york). New shadcn components need their lucide imports swapped for
  `react-icons/pi`.
- Design: minimal, like T3 Code; a darker One Dark palette; DM Sans. The accent colour is `brand`. Light and dark
  themes are both supported.
- Put pure logic in `shared/` (or a pure module next to the component) and unit-test it. Components stay thin.
- Server: validate every request body inside the service (bodies are `unknown`). Paths come from `DataPaths` and
  ids are checked with `isValidId`. Start external programs only through `process.ts`.

## Product decisions (don't undo)

- The timeline works like Premiere/CapCut: free placement with snapping (the magnet toggle), and unlimited video
  tracks created by dropping above the top track. There's **no magnetic main track** and no auto-packing.
- There's no right-hand inspector. Clip properties are in the left panel's Properties tab. Video settings (aspect ratio
  and fps) are in a header dialog. The canvas is always black.
- Clicking a media card previews that file in the Program monitor's place (the source monitor).

## Gotchas

- `createTransitionRenderer` and `drawSampleScene` are serialised with `toString()` and injected into the headless
  export page. They must not reference anything at module level.
- The export takes the values at each clip's first frame (no keyframes yet). When adding keyframe UI, the export
  (`server/render.ts`, `export/draw-texts.ts`) needs per-frame evaluation.
- `data/` (or `EDITOR_DATA_DIR`) holds the projects, media, exports (never cleaned up yet) and `tmp`, which is wiped
  on startup. Export jobs live in memory.
- External programs: ffmpeg/ffprobe (import and export; `FFMPEG_PATH`/`FFPROBE_PATH`), yt-dlp for the Online tab
  (`YTDLP_PATH`), and Chromium for exports with transitions (`CHROMIUM_PATH`, else Playwright's, else Chrome). The
  font list uses macOS AppKit through osascript (`fc-list` elsewhere).
- Saves on unload use `keepalive`, which is capped at about 64 KiB in Chromium, so a very large project may lose its
  last edit if the tab closes mid-debounce.
- The server binds to 127.0.0.1 only and has no auth. It's a local tool.
