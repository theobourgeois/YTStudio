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
pnpm tsx scripts/effect-sheet.ts [type|tag ...] [--out f.png]       # render + check video effects
pnpm tsx scripts/perf.ts [clips] [--profile <scenario>]              # time a long edit in the real app
```

**Verify every change** with `pnpm typecheck && pnpm test`, and also `pnpm test:e2e` for anything the UI touches.
- Don't edit `src/` while e2e runs: Vite hot-reloads the page mid-test and a test fails for no real reason.
- The e2e tests depend on each other (serial, shared state), so run the whole file rather than `-g` one test.
- After touching a shader, `transition-gl.ts`, `effect-gl.ts` or `compositor.ts`, run the transition-sheet and effect-sheet
  scripts. They compile every shader in headless Chromium and check that each transition starts on the outgoing
  picture and ends on the incoming one, and that each effect visibly changes the picture (look at the sheet too).
- If `pnpm install` output looks stale (e.g. "Cannot find package 'playwright-core'"), run `pnpm install`.

## Layout

```
shared/            Pure TS, used by both sides. No DOM, no Node APIs (types only: canvas/WebGL).
  types.ts           Domain + HTTP API types; the route list is documented at the bottom.
  timeline.ts        Queries + edits on Project (clips, tracks, clipboard, snapping, output size).
  normalize.ts       normalizeProject: validates/repairs/upgrades any untrusted Project (load, save, export).
  params.ts          ParamSpec types (number, vec2, boolean, choice, text, color, font…) + sanitize/defaults.
  keyframes.ts       Keyframe validation, interpolation (easedProgress), setKeyframe.
  animation.ts       Keyframe edits (stopwatch, navigator, move/delete/easing) and timeline<->keyframe time helpers.
  effects.ts         Effect definitions (Motion, Opacity, Volume, Text, Appearance, then the video effects),
                     evaluation (motionAt, opacityAt, volumeAt, textStyleAt), edits (setParams, resetParams,
                     setEffectEnabled, addEffect/removeEffect/moveEffect for video effects).
  effect-library/    One file per category of GLSL video effects (blur, colour, glitch...); common.ts has helpers.
  effect-gl.ts       Video effect shader prelude, effectShader, effectPasses (a clip's effects at a moment).
  transitions.ts     Transition registry, timing specs, sanitize/patch.
  transition-library/  One file per category of GLSL transitions; common.ts has shared specs.
  transition-windows.ts  Where transitions play on the timeline + edits to them.
  compositor.ts      THE renderer (WebGL2): pictures (after their video effects) placed by an affine + opacity,
                     transitions, YUV in/out. Draws the preview, the Effects tab's thumbnails and every export frame.
  scene.ts           What each video track shows at time t (clip + source time, or transition + sides).
  transition-gl.ts   Transition shader prelude, fragmentSource, uniforms.
  transform.ts       Where a clip lands on the canvas (fit → scale/rotate around the anchor).
  captions.ts        Auto captions: presets, words → caption cues (fitting the canvas), transcripts → timeline,
                     edits to every caption at once (style, animation, merge).
  library.ts         The shared Library: folder tree, saved clips (ClipTemplate: normalize, placeTemplate), search.
  assistant-tools.ts The editor's tools for AI agents (MCP): names, input schemas, descriptions, kind (look/edit/action).
  assistant.ts       The assistant's chat: messages, ChatEvent + applyChatEvent (server and tab fold the same events),
                     describeToolCall (a step's label), TabEvent (what the tab's event stream carries).
  math.ts, format.ts, errors.ts   clamp/EPS/roundTime, time formatting, errorMessage.
server/
  index.ts → app.ts  Startup wiring; routes live in routes/<resource>.ts (one Router each).
  projects.ts, media.ts, web-media.ts, exports.ts   Services behind the routes.
  library.ts         LibraryStore: library.json (folders, items) + its own MediaLibrary under data/library/media.
  render.ts          Export plan (pure, unit-tested): planRender (decoders + per-frame layers), audioArgs, encoderArgs.
  frame-render.ts + gl-browser.ts   Runs the plan: decoders -> headless Chromium compositor -> encoder.
  process.ts         run()/spawnStreaming(): the only way to start external programs (argv, never a shell).
  transcription/     Speech to timed words for Auto captions. service.ts (jobs, cache, time mapping), audio.ts
                     (decode, squeeze out silences, snap words to the sound), engine.ts (the engine interface),
                     whisper-cpp.ts (local, one-click setup), openai.ts (OpenAI + Groq), fake.ts (e2e).
  assistant/         The assistant. mcp.ts: the MCP server (POST /mcp, stateless JSON-RPC). bridge.ts: relays tool calls
                     to an editor tab over its event stream and back. claude.ts: runs `claude -p` (stream-json) and
                     turns its output into ChatEvents. service.ts: one chat per video (saved in data/assistant),
                     Claude Code status, tool calls -> chat steps. prompt.ts: what agents are told.
  media-analysis.ts  ffmpeg looks into media: a frame as JPEG, silences + loudness, shot changes (for the assistant).
  config.ts          Every env var is read here and nowhere else.
  storage.ts         DataPaths (data dir layout), HttpError, atomic JSON I/O.
src/
  stores/editor.ts   THE document store: project, assets, selection, undo history, gestures, edit commands.
  stores/autosave.ts, asset-polling.ts   Side effects of the editor store (kept out of it).
  stores/playback.ts The playback clock (rAF). layout.ts = panel/tool UI state. projects.ts = project list.
  stores/library.ts  The Library (folders, items, their media) and how its tab is browsed.
  lib/api.ts         Typed client for every endpoint. lib/edit-gesture.ts, lib/pointer-drag.ts (see below).
  lib/text-render.ts Text layout + drawing (browser text engine); used by preview, export and canvas editor.
  components/preview/engine.ts   Imperative preview: drives hidden <video>/<img> and draws with the compositor.
  components/preview/sync.ts, placement.ts   Its pure planners (tested).
  components/timeline/  Timeline UI; geometry.ts is its pure maths, view-store.ts its interaction-speed state.
  components/properties/  Spec-driven properties panel (param-rows.tsx renders any ParamSpec), the stopwatch and
                     navigator (animation-controls.tsx) and the keyframe lanes (keyframe-lanes.tsx, pure maths in
                     keyframe-geometry.ts, selection in keyframe-selection.ts).
  components/captions/   Auto captions dialog, engine picker/setup, the Captions tab. State in stores/captions.ts.
  components/library/  The Library tab, its cards and dialogs (Save to Library), folder drop targets.
  components/effects/  The Effects tab: video effects and transitions (library-grid.tsx is their shared search,
                     category chips and cards; thumbnails.ts draws every card with one shared compositor).
  components/workspace/left-panel.tsx   Left panel tabs: Media | Effects | Captions | Properties.
                     Media switches between sources: This video | Library | Online (`MediaSource`); Effects between
                     kinds: Video effects | Transitions (`EffectKind`, `KINDS`). Its right edge resizes it (widths
                     in `stores/layout.ts`, one for usual and one while the keyframe lanes show).
  assistant/         Where agents' tool calls run (in the tab): tools.ts (every tool's handler), edits.ts (the pure
                     timeline edits, tested), describe.ts (what the model reads: timeline, clips, catalogue...),
                     frames.ts (Program monitor + media frames), bridge.ts (the tab's event stream), context.ts.
  stores/assistant.ts  The side panel, the open video's chat, live activity, clip highlights, confirmations, Revert.
  components/assistant/  The chat panel (right, full height), its steps, Markdown, the header button, the preview pill.
  components/ui/     shadcn/ui (generated; icons adapted to react-icons/pi).
```

Imports: `src/` uses `@/…` and `@shared/…`. `server/`, `shared/` and `scripts/` use relative paths **with the `.ts`
extension** (Node ESM through tsx).

## Data model (shared/types.ts)

- `Project = { version, name, settings: { aspectRatio, fps }, tracks, clips }`. All times are seconds (floats).
  Round the results of edits with `roundTime`.
- `tracks` is in display order: video tracks first (index 0 is drawn **on top**), then audio tracks. There's always at
  least one video track. Clips are placed freely (gaps allowed), never overlap on a track, and never start before 0.
- `Clip = { id, assetId, trackId, start, in, out, effects, transitionIn?, transitionOut?, speed?, reversed?, keepPitch? }`.
  `start` is timeline time; `in`/`out` are **source** time. Duration is `out - in` at normal speed. Stills and text have no source range, so their `in` can be
  anything, even negative.
- Speed: `Clip.speed` (absent = 1), `reversed` and `keepPitch: false` (absent = keep). Duration is
  `(out - in) / speed`, and a reversed clip runs from `out` down to `in`. Never do timeline<->source maths by hand:
  use `clipDuration`/`clipEnd`, `sourceTime`/`sourceAt` (what's shown), `sourceEdge` (where a cut or trim lands),
  `timelineTime` (inverse) and `sourceDelta` (in `shared/timeline.ts`). Only video and sound clips have a speed
  (`canRetime`). `setClipSpeed` ripples the rest of the track; `stretchClip` is the ⌥-drag rate stretch.
- A reversed clip plays its media's reversed copy (`MediaAsset.reversed`, made on demand by
  `server/derivatives.ts` `makeReversed`, requested by `requestReversedCopies` in `stores/asset-polling.ts`, awaited by
  the export). Source time `s` is at `fileTime(clip, s, duration)` in it. Media elements only play forwards, so the
  preview never plays a reversed clip any other way.
- Text clip: `assetId: ""` plus the Text and Appearance effects (`isTextClip`). The browser draws text in any installed
  font. The export receives PNGs drawn by the browser (`ExportRequest.texts`). Don't switch to ffmpeg `drawtext`.
- `Effect = { id, type, enabled, params, keyframes? }`. Built-in effects (motion, opacity, volume) are on every clip,
  and Text/Appearance on text clips. All of these have `id === type`, and code addresses them by type.
- Video effects (a definition with a `shader`) are the ones the user adds: any number, in the order they're drawn,
  after the others in `clip.effects`, with ids `type`, `type_2`... Each runs over the clip's own picture before
  Motion places it (Premiere's standard effects), so blur sizes etc. are fractions of the clip's frame.
- Keyframes are stored in **source time** (so they stay on their frame when the clip moves, trims or splits). Read
  values with `sourceTime(clip, playheadTime)`; write them at `keyframeTime(clip, playhead, fps)` (the frame under
  the playhead, or an existing keyframe within half a frame), which every editing surface uses. A keyframe's `easing`
  says how it's passed through (Premiere's Ease In/Out, Hold); `easedProgress` is the curve.
- Transitions are stored on clip edges. At a cut, the outgoing clip's `transitionOut` wins. See
  `transition-windows.ts` for the rules, and use `storedTransition`/`findWindow`/`refKey` rather than reading fields.
- Captions are text clips with `caption: true` (only valid on text clips; see `shared/captions.ts`). The Captions tab
  edits style for all of them (never their text or timing); Properties edits one. A caption's animation is its
  `transitionIn`; animated captions end one frame before the next so each animates in from nothing.
- Media (`MediaAsset`) belongs to one project. `kind` is video | audio | image. Filmstrip and waveform generation
  finish after import (`status: "processing"`).
- The Library (`LibraryFolder`, `LibraryItem`) is shared by every project and has its own media (`projectId: null`,
  a second `MediaLibrary` rooted at `data/library/media`, served at `/files/library`). An item is one file
  (`kind: "media"`) or saved clips (`kind: "clips"`, a `ClipTemplate`: tracks + clips pointing at Library media).
  Nothing ever references across: saving copies project media into the Library, and using an item
  (`POST /api/library/items/:id/use`) copies its media into the project, reusing a copy already there
  (`MediaAsset.origin`). Library media no item uses is deleted.

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
- A preview derives from `gestureBase` whenever the edit is relative (e.g. `moveKeyframes` by a delta):
  `preview(update)` applies `update` to the *current* project.
- Autosave (`stores/autosave.ts`) saves the project when it changes outside a gesture: debounced, one request at a
  time, retried, and flushed before switching projects.
- UI state that changes at pointer speed (ghosts, snap guides, scroll) goes in `timeline/view-store.ts`, never in the
  editor store.
- Store subscriptions: select the narrowest value possible. Use `useShallow` for derived arrays, maps or objects.
  Never subscribe to all of `project` in something that renders during drags or playback.

## Performance (edits with thousands of clips)

Auto captions make hundreds of clips, so everything must scale with the clip count. Check with `scripts/perf.ts`.
- Nothing ever changes a `clips` array or a clip in place, so queries are cached per clip list (`perClipList` in
  `shared/timeline.ts`): `trackClips` (sorted, shared: don't mutate it), `clipsById`, `captionClips`. Add new
  whole-project queries the same way instead of filtering/sorting `project.clips` in a hot path.
- No O(n²): no per-clip `find` inside a loop over clips, and no `reduce` of one-clip edits (each copies the list).
  Batch them in one pass, as `setParams`/`updateEffect` do with a set of ids (`ClipIds`). Placement
  (`findFreeStart`, `moveClips`) sorts blocked intervals (`nearestFree`) rather than trying every edge.
- Store selectors run on **every** store update (each pointer move of a drag), so they must be cheap. Anything
  computed from the project belongs in a cached query, not in a per-row selector.
- The timeline renders only the clips in its visible window (`useVisibleWindow`) plus the one being pressed
  (`heldClipId`). Don't rely on off-screen clips being in the DOM. The same goes for transition markers.
- Long lists (the transcript) memoise their rows; each row subscribes to its own state (e.g. whether it's playing),
  so playback never re-renders the whole list.
- The preview uses a fixed number of media elements: an A/B pair per video track and per audio track, whatever
  the clip count.

## How to add…

- **A property on an existing effect**: add a spec to its definition in `shared/effects.ts`. The panel, validation
  and keyframing (stopwatch, lanes) then work automatically. Then apply the value where clips are drawn: preview
  (`components/preview/engine.ts` / `placement.ts`) and export (`server/render.ts`: `planRender`'s `draw`,
  `audioArgs`). Anything drawn should become compositor work (`shared/compositor.ts`) so both get it at once.
- **A video effect** (added by the user from the Effects tab): add a `videoEffect(...)` to a
  `shared/effect-library/*.ts` file. The GLSL defines `vec4 effect(vec2 uv)`; params become uniforms. See the
  prelude docs in `effect-gl.ts`, and give it `demo` values if its defaults don't read on a card. Then run the
  effect-sheet script. The panel, keyframes, preview and export then work with no other change.
- **A built-in effect**: add an `EffectDefinition` to `EFFECTS` (`builtIn` puts it on every clip it `appliesTo`), plus
  the same preview and export work as a property.
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
- **A transcription engine** (another API or local model): implement `TranscriptionEngine` (`server/transcription/
  engine.ts`: 16 kHz mono WAV in, timed words out) and add it to `defaultEngines` in `service.ts`, plus its id to
  `TranscriptionEngineId`. Decoding, silence squeezing, time mapping and caching are the service's job.
- **Any feature (keep the assistant at parity)**: whatever the user can do, the assistant should be able to do too.
  When you add or change a feature, add or extend a tool in `shared/assistant-tools.ts` (name, a description written
  for a model, a JSON schema, its `kind`) and its handler in `src/assistant/tools.ts`; TypeScript won't build until
  every tool has one. An `edit` tool is a pure `(Project, input, env) => { project, text }` in `src/assistant/edits.ts`
  (it can then go in a `batch`), with a test in `edits.test.ts`; describe new state in `describe.ts` so the model can
  see it. Give it a label in `describeToolCall` and an icon in `components/assistant/tool-steps.tsx`. Error messages
  go to the model: say what's wrong and what to do (which ids exist, which values are allowed).
- **A left-panel tab**: add it to `LeftPanelTab` (`stores/layout.ts`) and to `TABS` in `workspace/left-panel.tsx`.
  Keep the strip short: a new place to find media is a `MediaSource` (and `SOURCES`), and a new kind of effect
  (video, audio) is an `EffectKind` (and `KINDS`), not a tab.
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
- There's no right-hand inspector (the right side is only the assistant's chat). Clip properties are in the left panel's Properties tab. Video settings (aspect ratio
  and fps) are in a header dialog. The canvas is always black.
- Clicking a media card previews that file in the Program monitor's place (the source monitor).

## Gotchas

- `createCompositor` and `drawSampleScene` are serialised with `toString()` and injected into the headless
  export page. They must not reference anything at module level.
- The export draws every frame in headless Chromium with `shared/compositor.ts`; ffmpeg only decodes (video as YUV
  4:2:0 at the size it's shown; the compositor converts with the source's matrix), mixes audio and encodes (BT.709).
  Everything animates exactly: Motion/Opacity per frame in `planRender`, volume as an ffmpeg expression of the same
  curve (`keyframeExpression`), and an animated text's look as one browser drawing per changed frame
  (`export/draw-texts.ts`, `TextRaster.from`), decoded by the page.
- After changing the compositor or the export, run the integration tests (`server/integration.test.ts` checks
  positions, transitions and colours of real exports).
- `data/` (or `EDITOR_DATA_DIR`) holds the projects, media, exports (never cleaned up yet) and `tmp`, which is wiped
  on startup. Export jobs live in memory.
- External programs: ffmpeg/ffprobe (import and export; `FFMPEG_PATH`/`FFPROBE_PATH`), yt-dlp for the Online tab
  (`YTDLP_PATH`), whisper.cpp's `whisper-cli` for local transcription (`WHISPER_PATH`; model in `EDITOR_MODELS_DIR`,
  default `~/.cache/editor/models`), and Chromium for every export (`CHROMIUM_PATH`, else Playwright's, else Chrome). The
  font list uses macOS AppKit through osascript (`fc-list` elsewhere).
- Whisper times the word after a long silence early; that's why `audio.ts` squeezes silences out before any engine
  and snaps words to the sound afterwards. Don't use whisper.cpp's own `--vad`: its token times aren't mapped back.
- The export numbers each track's frames afresh after `concat` (`setpts=N/...`): a transition's file keeps time in
  whole ms, and without it every transition pulled the rest of its track a frame early.
- Saves on unload use `keepalive`, which is capped at about 64 KiB in Chromium, so a very large project may lose its
  last edit if the tab closes mid-debounce.
- The server binds to 127.0.0.1 only and has no auth. It's a local tool. `/mcp` also refuses requests with a non-local
  `Origin` or `Host` (web pages and DNS rebinding).
- The assistant is the user's own Claude Code (`CLAUDE_PATH`, else found on the PATH), run in `data/assistant/workspace`
  with `--tools ""` (no shell or files), `--strict-mcp-config` and only the editor's MCP server. Tool calls run in the
  tab, one at a time; a tab that isn't open can't run them. Edits wait for the user's drag to end.
- The e2e suite plays Claude Code with `e2e/fake-claude.mjs`: a message's `call <tool> <json>` lines are tool calls.
