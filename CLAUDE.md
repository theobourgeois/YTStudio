# CLAUDE.md

A local creative suite that runs in the browser (and as a desktop app): a React app (`src/`) plus a local Express +
ffmpeg server (`server/`), sharing pure domain logic (`shared/`). README.md is the front page (pictures),
docs/guide.md the user-facing guide. This file is for working on the code.

Every project belongs to one app, a *suite* (`SuiteId`: video, music, photo), picked on the Home screen or in the New
project picker. **Every project is a file of its own**, a package on disk named by its suite (`.ytvid`, `.ytsng`,
`.ytimg`; see "Projects are files"). The video editor lives at the roots of `shared/`, `server/` and `src/`; every
other suite has folders of its own (see "Suites"). YTStudio is becoming four apps, each showing one suite (see "Apps").

## Guides: read the one for what you're working on

This file is the platform: what every suite stands on. Each suite has its own guide in `docs/claude/`. **Read the guide
before working on its code** (the suite folders' own CLAUDE.md files load them for you there):

- **The video editor** ([`docs/claude/video.md`](docs/claude/video.md)): short-form first (9:16 by default) and
  modelled on **Premiere Pro**: when in doubt about UX, do what Premiere does (Effect Controls, Program Monitor
  handles, stopwatch keyframes). Its layout, data model, editing rules, performance, how to add effects, transitions,
  presets, shortcuts and panels, its product decisions and gotchas.
- **The visualizer** ([`docs/claude/visualizer.md`](docs/claude/visualizer.md)): audio-reactive video inside the video
  editor (signals, links, audio shaders, simulations, 3D scenes).
- **The music suite** ([`docs/claude/music.md`](docs/claude/music.md)): a DAW modelled on **FL Studio**. Its built-in
  effects ([`music-effects.md`](docs/claude/music-effects.md)), the native audio engine
  ([`music-engine.md`](docs/claude/music-engine.md)) and audio intelligence
  ([`audio-intelligence.md`](docs/claude/audio-intelligence.md)) have guides of their own.
- **The photo suite** ([`docs/claude/photo.md`](docs/claude/photo.md)): a Photoshop-style image editor (WebGPU).
- **Now Playing** ([`docs/now-playing.md`](docs/now-playing.md)): the Visualizer app's full-window visualizer of what
  Spotify plays (the video editor's looks, listening to the computer's sound live).

Keep this file to what every suite shares (under 40k characters): a suite's details go in its guide.

## Commands

```bash
pnpm dev          # server :5311 + app http://localhost:5310 (moves to 5410/5411… if taken), every suite
pnpm dev:video    # one app (also dev:photo, dev:visualizer; dev:music is in the engine's window): docs/apps.md
pnpm typecheck    # tsc -b (app + node projects)
pnpm test         # vitest: shared/, src/, server/ (the server integration tests need ffmpeg)
pnpm test:e2e     # Playwright on :5320/5321 with a throwaway e2e/.data (serial, ~20 min: rarely the whole thing)
pnpm test:e2e music   # only the spec files whose names contain "music": each suite's specs stand on their own
pnpm samples      # test media into ./samples
pnpm tsx scripts/transition-sheet.ts [type|tag ...] [--out f.png]   # render + check transitions
pnpm tsx scripts/effect-sheet.ts [type|tag ...] [--out f.png]       # render + check video effects
pnpm tsx scripts/preset-sheet.ts [type|tag ...] [--out f.png]       # render + check presets
pnpm tsx scripts/now-playing-sheet.ts [look|kind ...] [--song f.mp3] [--moments] [--rolls 24] [--record 45]  # Now Playing's looks in the real app
pnpm tsx scripts/milkdrop-sheet.ts --songs a.mp3,b.mp3 [--only "name|name"]   # every MilkDrop preset measured and laid out, for picking
pnpm tsx scripts/clap-vibe.ts --songs a.mp3,b.mp3,...   # Now Playing's vibe vocabulary (CLAP's text side) into shared/signals/vibe.json
pnpm tsx scripts/perf.ts [clips] [--profile <scenario>]              # time a long edit in the real app
pnpm tsx scripts/perf.ts --scrub <Project.ytvid> [--render]        # scrub and play a copy of a real project, GPU and all
pnpm tsx scripts/ui-sheet.ts [name ...] [--light|--dark]            # screenshot the gallery + screens, every theme
pnpm dev:shell    # every suite in the engine's own window, as the music app (docs/claude/music-shell.md)
pnpm dev:desktop [app]  # the desktop app (Electron): Vite + a window; restarts when electron/ or server/ change
pnpm build:desktop [app…] && pnpm test:desktop [--app <app>]   # release/mac-<arch>/YTStudio.app (an app's in release/<app>/), then launch it, export, check
pnpm update:desktop [app…]  # build YTStudio + Video, Photo, Visualizer and Music (engine too), quit the installed ones, replace them (macOS: /Applications; Windows: their installers, silently), reopen
pnpm tsx scripts/make-icon.ts [--variant dark] [--app all] [--colourways]   # redraw the app icon (or each app's, or Settings' colourways): a Mac's and a Windows PNG
```

**Verify every change** with `pnpm typecheck && pnpm test`, and also the e2e specs of what you touched for anything
the UI touches. **Don't run the whole e2e suite** (about 20 minutes, one file at a time): run only the files that
cover your change, by name, e.g. `pnpm test:e2e e2e/photo-crop.spec.ts`. Which ones:
- the video editor: `editor.spec.ts` (Home's cards and their previews: `previews.spec.ts`);
- music: `music.spec.ts` (~9 min; `piano.spec.ts` for the Piano roll, `music-audio.spec.ts` for audio intelligence);
- photo: the `photo-<tool>.spec.ts` of the tool you changed, else `photo.spec.ts`;
- the platform (Home, the tab strip, the menu bar, windows, `components/ui`, themes): one spec per suite it shows in.
- E2E_WEB_PORT/E2E_SERVER_PORT move the suite off :5320/5321 when another checkout is running its own.
- Don't edit `src/` while e2e runs: Vite hot-reloads the page mid-test and a test fails for no real reason.
- The e2e tests depend on each other (serial, shared state), so run the whole file rather than `-g` one test.
  Each suite has its own spec (`e2e/editor.spec.ts` is the video editor's, `e2e/music.spec.ts` the music
  suite's) that makes its own projects, so one suite's file runs alone.
- After touching a shader, `transition-gl.ts`, `effect-gl.ts`, `layers.ts` or `compositor.ts`, run the transition-sheet,
  effect-sheet and preset-sheet scripts. They compile every shader in headless Chromium and check that each transition
  (and transition preset) starts on the outgoing picture and ends on the incoming one, and that each effect visibly
  changes the picture (look at the sheets too).
- If `pnpm install` output looks stale (e.g. "Cannot find package 'playwright-core'"), run `pnpm install`.

## Layout

```
shared/            Pure TS, used by both sides. No DOM, no Node APIs (types only: canvas/WebGL).
  suites.ts          The suites: SuiteId, their names (SUITES), each one's document type (SuiteDocuments).
  suite-tools.ts     Every suite's assistant tools (SUITE_TOOLS), toolSpec/suiteToolSpec/toolSuite.
  tool-spec.ts       What a tool is (ToolSpec, kinds, JSON schema helpers) and its results, for every suite.
  ids.ts             createId, for everything the app makes.
  assistant.ts       The assistant's chat: messages, ChatEvent + applyChatEvent (server and tab fold the same events),
                     describeToolCall (a step's label), TabEvent (what the tab's event stream carries).
  math.ts, format.ts, errors.ts   clamp/EPS/roundTime, time and size formatting, errorMessage.
server/
  index.ts → app.ts  Startup wiring; routes live in routes/<resource>.ts (one Router each).
  suites/            Each suite's server side (SuiteBackend): create/normalise/summarise its documents, what its
                     assistant is told. index.ts is the registry; video.ts wraps the video editor's.
  projects.ts        ProjectStore: every suite's projects, each a package on disk (`Name.ytvid`: project.json, meta.json
                     says the suite (none = video), media/, a song's plugins/ and recordings/), opaque documents, and
                     this computer's recents (`data/projects.json`). packages.ts: names, unique paths, moves, the Trash.
  migrate.ts         Older data folders: data/project.json and data/projects + data/media become packages, on startup.
  process.ts         run()/spawnStreaming(): the only way to start external programs (argv, never a shell).
  architecture.test.ts  The layering between the platform and the suites, checked on every import (see Suites).
  assistant/         The assistant. mcp.ts: the MCP server (POST /mcp, stateless JSON-RPC). bridge.ts: relays tool calls
                     to an editor tab over its event stream and back, and every chat's activity to every tab.
                     agent.ts: the Agent interface each provider implements. claude.ts: runs `claude -p` (stream-json).
                     codex.ts: runs `codex app-server` (JSON-RPC), its model list and account. Both turn their output
                     into ChatEvents. service.ts: one chat per video (saved in data/assistant) on a provider + model +
                     thinking level, a conversation per provider, their status, tool calls -> chat steps. prompt.ts:
                     the system prompt around a suite's instructions. A chat's suite picks its prompt and MCP tools.
  beats.ts           Music analysis (pure, tested on synthetic drums): onsets, tempo (with the half/double choice),
                     beats (Ellis's DP tracker, then evened out), bars, loudness sections and drops. The platform's:
                     beat sync and the music suite's Detect tempo both use it.
  config.ts          Every env var is read here and nowhere else.
  log.ts             The app's log (`log(scope)`): JSON lines in `<data>/logs/ytstudio.log`, rotated, written in the
                     background; the tab's lines arrive by `POST /api/log` (`src/lib/log.ts`, `shared/log.ts`).
  storage.ts         DataPaths (data dir layout), HttpError, atomic JSON I/O.
electron/          The desktop app (YTStudio). main.ts: runs the server (electron/server.ts, the same createApp) in a
                     utility process of its own (server-process.ts, started by server-host.ts: the main process hands every
                     window its input, so the server's work there made them lag; the Trash, Show in Folder, the export's
                     drawing page and its log lines go over its port, server-protocol.ts; EDITOR_SERVER_IN_MAIN=1 runs it
                     in the main process) and shows the page in a window; packaged, data is in userData, in development ./data.
                     The music editor's plugin windows aren't Electron's business: they belong to the music app's
                     window (the engine is that app, docs/claude/music-shell.md); here the music suite is boxes in the page.
                     gl-window.ts: the export's compositor page in a hidden window (`setGlPageOpener`), so no Playwright.
                     shell-path.ts: the login shell's PATH (Finder-launched apps get a bare one). preload.ts only marks
                     the page (`html.desktop`: drag regions, room for the window buttons in src/index.css). On
                     Windows the window has no system title bar or menu bar: its buttons are the system's, drawn over
                     the page's top-right corner (`titleBarOverlay`), in the colours preload.ts reads off the bar there.
                     scripts/desktop.ts bundles it with esbuild: the packaged app ships no node_modules.
src/
  suites/            Each suite in the tab (ClientSuite): open/close its store, its Workspace, Home card line, the
                     assistant's side (message context, chat texts, tool handlers). index.ts is the registry;
                     video.ts plugs in the video editor; music/ and photo/ are those suites' (their guides).
  lib/document-history.ts, autosaver.ts   Undo (with gestures) and autosave for any suite's document; music uses
                     them, the video editor still has its own in stores/editor.ts and stores/autosave.ts.
  stores/projects.ts The recents (every suite) and which one is open (`openId`, in the URL; null is Home); hands it to
                     its suite. Opening and closing one tell the server (`opened`, `closed`).
                     `tabs` are the open projects as a strip along the window's top (`components/home/project-tabs.tsx`,
                     the order and edits in pure `stores/project-tabs.ts`, kept in localStorage): switching is just
                     `open` (the one left is flushed and its store closed, so it reloads: no per-tab state yet). The
                     strip always shows while a project is open, and on Home with tabs; it starts the window (the Home
                     button and a Mac's window buttons are in it: `[data-tabs]` in index.css, `title-bar` in
                     electron/main.ts). Settings › General can hide it (`stores/window-chrome.ts`): the menu row then
                     starts the window, the Home button before its menus, and on a Mac the page draws the window's
                     buttons at the bar's right (`header/window-buttons.tsx`) in place of the system's. ⌘W closes a tab (the File menu's Close Tab; ⇧⌘W the window), ⇧⌘[ / ⇧⌘] and
                     ⌃Tab go through them.
                     The strip is tabs only. Under it, every suite's header starts with **the menu row**
                     (`components/header/menu-row.tsx` `MenuRow`, 40 px): the project's name (and its format or save
                     state), **the menu bar** (`components/home/menu-bar.tsx`), the same in every suite: the app's File
                     and Edit (Settings…), then View, the suite's own menus and Window; then `HeaderActions`
                     (components/header/header-actions.tsx: undo and redo, Settings, Export, the assistant). A suite's
                     workspace renders `<SuiteMenuBar file edit view menus window />` (its items are
                     `components/ui/dropdown-menu` items, each running the code its key runs: video's through
                     `runShortcut`, music's `runKey`), which the row's slot shows in place of the app's own. A suite's
                     own tools go in a row below it (music's transport, photo's options bar; video has none).
  components/home/   The Home screen (home.tsx: New tiles, Open…, the recents as cards in project-card.tsx, search
                     and suite filter), the tab strip and the menu bar, Open… / Locate… (open-project-dialog.tsx: the
                     desktop app's dialog, else a path), the New project picker (⇧⌘O) and ⌘P's search, and the
                     app's project keys (project-search-dialog.tsx `useProjectShortcuts`: ⌘O, ⇧⌘H too).
  lib/api.ts         Typed client for every endpoint. lib/edit-gesture.ts, lib/pointer-drag.ts (see below).
  components/workspace/workspace.tsx   The main column: the open project's suite's Workspace, or the empty state.
  components/windows/  Floating windows, FL Studio's way, for every suite (docs/windows.md): `FloatingWindow` on a
                     `Desktop`, a store per desktop (`createWindows`: places, stacking, snaps), the maths in
                     geometry.ts. The music editor's desktop is one; the app's (`stores/app-windows.ts`, drawn by
                     App.tsx over everything) holds Settings. In the desktop app a `native` Desktop's windows are
                     windows of the system (native/: panel-window.ts opens one and dresses it in the page's theme,
                     styles.ts mirrors them, popups.ts is the one window menus are drawn in, geometry.ts the screen
                     maths, use-panel.ts the hooks). lib/window-events.ts is how code says which window it means
                     (see "Windows" below); shared/panels.ts names them.
  components/settings/  Settings (⌘,, `stores/settings.ts`): a window on the app's desktop, as FL's, with a tab for
                     General (the theme and fonts: `stores/theme.ts`) then one per suite (`ClientSuite.settings`;
                     video's is `src/suites/video-settings.tsx`, music's `src/suites/music/settings.tsx`), each
                     ending with where its new projects start. ⌘, opens it on the open project's suite. It doesn't
                     block the app under it, but keeps its keys (`keepsKeys`: the editors' shortcuts check
                     `keptByWindow`). Built from
                     `settings-ui.tsx` (`SettingsGroup`, `SettingsRow`). A preference goes here, kept where
                     what it changes lives (`stores/video-preferences.ts` for the video editor's own).
  components/dock/   Docked panels, Premiere's way, for any suite (docs/windows.md): model.ts (the layout: splits of
                     tab groups, floating panels; its edits are pure and tested), store.ts (`createDock`: the layout
                     remembered in localStorage), dock-area.tsx (`DockArea`: tabs that drag onto another group's tabs
                     or beside it, lines that resize, each group's menu: float, workspaces, Reset layout; a panel's
                     `header` in its group's tab strip, as the Timeline's sequence tabs;
                     `FloatingPanels` on a desktop).
  stores/assistant.ts  The side panel, the open video's chat, every chat's activity (Home's cards), provider status, live
                     activity, clip highlights, confirmations, Revert.
  components/assistant/  The chat panel (right, full height), the model + thinking pickers, its steps, Markdown, the
                     header button, the preview pill. A card's chat status is components/home/chat-status.ts.
  components/ui/     shadcn/ui (generated; icons adapted to react-icons/pi).
```

Imports: `src/` uses `@/…` and `@shared/…`. `server/`, `shared/` and `scripts/` use relative paths **with the `.ts`
extension** (Node ESM through tsx).

## Apps

YTStudio is becoming four apps (docs/apps.md): Video, Music, Photo and the Visualizer. `EDITOR_APP` (`server/config.ts`)
says which this is, and the page asks (`GET /api/app`, `src/lib/app.ts`, before it draws). `APPS` (`shared/apps.ts`)
says what each opens: its suites (Home, the tabs, New, Settings' tabs and Open… show only those; another app's file is
turned down, naming its app) and whether it has the visualizer. With no `EDITOR_APP` it's every suite (`pnpm dev`, the
e2e suite, the gallery). An app's data is its own (`data/apps/<app>`, which starts with the checkout's recents). Ask
`appSuites()`/`appOpens()`, never an app's id. Video, Photo and the Visualizer are desktop apps of their own
(`pnpm build:desktop <app>`: their name, bundle id, icon, ports, userData and file types); a new one starts with
YTStudio's recents and page storage (`electron/carry-over.ts`). Music is the engine itself, not Electron
(`docs/claude/music-shell.md`): on a Mac `pnpm build:desktop music` packs it; on Windows YTStudio, every suite, stays
as the music app until its installer is built.

## Suites

- A project's suite is fixed when it's made (`POST /api/projects { suite }`) and kept in its `meta.json`.
  `ProjectSummary` is a union on `suite`: common fields plus the suite's own (`SuiteSummaries`).
  A suite's preferences for new projects, kept in the tab (music's default tempo), go with it as `options`
  (`ClientSuite.newProjectOptions` → `SuiteBackend.withOptions`, applied to a copy of the starting point too).
  A suite can ask first (`ClientSuite.NewProject`, photo's New photo window): New opens it on the app's desktop
  (`useProjects.choosing`) and its choices become the `options`; closing it makes nothing.
- Everything suite-agnostic goes through the registries, keyed by `SuiteId` so TypeScript insists on every suite:
  `SUITES` + `SuiteDocuments` (`shared/suites.ts`), `SUITE_TOOLS` (`shared/suite-tools.ts`), `suiteBackend`
  (`server/suites/`) and `clientSuite` (`src/suites/`). Don't branch on a suite id anywhere else.
- `useProjects.openId` is the open project, of any suite. Opening one closes the previous suite's store and calls
  the new suite's `open`. `useEditor.projectId` is only the *video* store's project: use `openId` for anything
  that isn't the video editor (Home, assistant panel, bridge).
- The assistant: one chat per project, for every suite. The chat's suite decides the system prompt (`systemPrompt`
  around `SuiteBackend.assistant`), the MCP tools listed (`/mcp?chat=<id>`; outside clients get video's, or
  `?suite=`) and who runs the calls in the tab (`clientSuite(suite).runTool`). Tool names are unique across suites
  (tested). The panel (`AssistantPanel suite=…`) takes its texts from `ClientSuite.chat`.
- **Checkpoints** (Cursor's, every suite): the bridge snapshots the project around each tool call of an answer
  (`ClientSuite.documents`: its document, compared by identity), so any message of the user's can be restored (the
  project as it was when it was sent; Redo takes that back) and what the assistant changed since the last Keep waits in
  the review bar over the composer (Undo all / Keep all). Pure in `lib/checkpoints.ts`, held by `stores/checkpoints.ts`
  for the session; each restore is one undo step of the suite's own history and keeps the project's name.
- **Layering** (`server/architecture.test.ts` checks every import): the *platform* is what every suite stands on
  (projects, Home, assistant, storage, `components/ui`, `lib/api.ts`...: its `PLATFORM` list); a *suite* is its
  own folders (`shared/<suite>/`, `server/<suite>/`, `src/suites/<suite>/`), and video is everything else at the
  roots. A suite imports the platform and itself, never another suite; the platform never imports a suite except
  through a registry. So a new suite's routes go in `server/<suite>/routes.ts`, its client in
  `src/suites/<suite>/api.ts` (on `request` from `lib/api.ts`), its API types in `shared/<suite>/`: not in
  `server/routes/`, `lib/api.ts` or `shared/types.ts`, which are the platform's and the video editor's.
  Something two suites need (undo, autosave, ids) moves into the platform first; it isn't imported from video.
  The test's `DEBT` list is where the platform still reaches into the video editor: it may only shrink.
- Imports: import suites from `@/suites` (the registry), never a suite's module directly; they form an import cycle
  with `stores/projects.ts`, which is safe only because nothing uses `useProjects` at module level. Keep it that way.

## Projects are files

- A project is a package named by its suite, `Name.ytvid/` (`SUITES[suite].extension`, `server/packages.ts`): `project.json`, `meta.json` (id, suite, dates),
  `media/<id>/` and whatever its suite keeps beside them. New ones go in the location (`~/Documents/YTStudio`; Settings ›
  General changes it; `EDITOR_PROJECTS_DIR`; a given `EDITOR_DATA_DIR` keeps them in its own `Documents/YTStudio`, so
  tests and throwaway setups never touch the user's). The server keeps the recents in `data/projects.json`: a path per
  project, and what was known of it, for when its package isn't there (`ProjectSummary.missing`).
- The app was called Vaudio: `.vaudio` packages still open (`isPackageName`, `LEGACY_EXTENSIONS`), as do `.yt` ones (when it was one app),
  and take their suite's extension as the folder follows its name (`fitsName`; recents at startup, `adoptRecents`); `Documents/Vaudio` moves to `Documents/YTStudio` on startup
  (`migrate.ts`), recents find theirs (`relocated`), and the desktop app moves its profile from `Vaudio` too. Internal
  ids keep the old name (`vaudio:` plugin ids, `vaudio.*` storage keys, `VAUDIO_*` env vars): they're in saved data.
- Media keep their URLs (`/files/media/<id>/...`), served from whichever package holds them (`MediaLibrary`'s
  `projectDirs`, `filesDir`): never build a path from a media id or a project id yourself. A project's own files are
  under `ProjectStore.dir(id)` (the audio engine's `projectDir` option); `DataPaths.projectDir` is the old layout.
- A package is named after its project, but **its folder isn't renamed while a tab has it open** (media being
  added, filmstrips being made, a song's plugin states and recordings are written into it): renaming changes the
  document, and the folder follows on `closed`, at the next startup, or at once for one that isn't open (Home's
  Rename, the assistant in the background). A busy one (`MediaLibrary.busy`) waits.
- Open… (`POST /api/projects/open`) takes a package from anywhere: one that is a recent's new place takes over (and
  its name becomes its folder's, if it was renamed in Finder); a copy of one that's here gets a project id and media
  ids of its own (`reId`). Delete is the Trash (Electron's `shell.trashItem` in the desktop app); a package inside the
  data folder (a starting point, a test's) is deleted.
- The desktop app declares the type (`fileAssociations`, a package Finder shows as one file), opens one
  double-clicked or launched with (`open-file`, argv) through `editorDesktop.openFile`, and lists opened ones in
  File › Open Recent (`app.addRecentDocument`). Its File menu runs the page's `DesktopCommand`s. Images dropped on its
  Dock icon (or Open With) start a photo (`IMAGE_TYPES`, an Alternate handler: Preview stays the default), read only
  through `read-handed-image`, which serves no file the system didn't hand the app.

## How to add…

- **A suite** (image, vector…): its id in `SuiteId` and `SUITES` (name, noun, picker line, what its assistant works
  in) and its document in `SuiteDocuments` (`shared/suites.ts`); its document type, `create`/`normalize` (tested)
  and tools in `shared/<suite>/`, listed in `SUITE_TOOLS`; a `SuiteBackend` in `server/suites/<suite>.ts` (+ its
  summary fields in `SuiteSummaries`, and what its assistant is told); a `ClientSuite` in `src/suites/<suite>/`
  (store, `lazy` Workspace that renders `<AssistantPanel suite=…>`, tool handlers). TypeScript lists what's missing.
  Then an e2e test that makes one from the picker. Music is the template.

- **An API endpoint**: a method on the service, a route in `server/routes/<resource>.ts` (throw `HttpError` for 4xx),
  the doc line in the route list at the bottom of `shared/types.ts`, and a method on `api` in `src/lib/api.ts`.
- **Any feature (keep the assistant at parity)**: whatever the user can do, the assistant should be able to do too.
  When you add or change a feature, add or extend a tool in `shared/assistant-tools.ts` (the video editor's; other
  suites: `shared/<suite>/tools.ts` and `src/suites/<suite>/tools.ts`) (name, a description written
  for a model, a JSON schema, its `kind`) and its handler in `src/assistant/tools.ts`; TypeScript won't build until
  every tool has one. An `edit` tool is a pure `(Project, input, env) => { project, text }` in `src/assistant/edits.ts`
  (it can then go in a `batch`), with a test in `edits.test.ts`; describe new state in `describe.ts` so the model can
  see it. Give it a label in `describeToolCall` and an icon in `components/assistant/tool-steps.tsx`. Error messages
  go to the model: say what's wrong and what to do (which ids exist, which values are allowed).
## Conventions

- Match the surrounding style: short doc comments on exports that say *why*, British spelling in prose ("colour",
  "normalise"), no drive-by reformatting.
- `cn` comes from the `cn` package (`import { cn } from "cn"`). Icons are `react-icons/pi` (Phosphor). UI primitives
  are in `components/ui` (shadcn, new-york). New shadcn components need their lucide imports swapped for
  `react-icons/pi`.
- Design: FL Studio's idea in a blue-grey family (docs/ui-redesign.md): mid-tone surfaces in clear steps
  (`surface-0`..`surface-3`, `sunken`), lines darker than what they divide (`line`), a little depth on what can be
  pressed (the `raised`/`pressed`/`sunken`/`floating` utilities in `index.css`), small corners, dense; DM Sans by
  default (Settings offers others: `FONTS`, `MONO_FONTS`, set as `--font-sans`/`--font-mono` on <html>).
  The accent is `brand`. It's a theme system: a theme is one whole look, light or dark (`dark` adds the `dark`
  class), in a CSS file in `src/themes/`, listed in `THEMES` (`src/themes/index.ts`); System (the default) is
  Light or Dark as the computer is. Use its tokens, never raw colours (canvases read theirs from CSS variables
  too). Studio (`studio.css`: `.theme` is Light, `.theme.dark` Dark) is the base every theme has; another
  theme (`.theme.theme-<id>`) sets only what differs and `derived.css` works out the rest (faces, accent
  buttons, steps, knobs). A value a canvas reads (`--piano-*`, `--meter-*`, `--brand`, `--line`) must be a plain
  colour, never `color-mix()`. `src/themes/themes.test.ts` fails any theme whose text or accent isn't readable.
- Hover tips are the app's, never the browser's: a `title` anywhere (any suite, any window) shows as our tooltip
  (`components/ui/title-tips.tsx` moves it to `data-title` while the pointer is on it), so a plain `title` is fine;
  code that reads a control's tip uses `titleOf` (the music hint bar does), tests don't `getByTitle` a hovered one.
- The component gallery (`/gallery` in `pnpm dev`, `src/gallery/`) shows every primitive and suite control in
  each state; `pnpm tsx scripts/ui-sheet.ts [name ...] [--light|--dark]` screenshots it and the app's screens
  into `ui-sheet/`. Add a section (`GallerySection`) when you add a control.
- Put pure logic in `shared/` (or a pure module next to the component) and unit-test it. Components stay thin.
- Tests, from cheapest: pure logic in vitest beside the code (most of them); a service against a stand-in
  program (`fake-engine.mjs`, `e2e/fake-claude.mjs`); the real program where only it can tell (exports in
  `server/integration.test.ts`, sound in `server/music/engine.integration.test.ts`); then one e2e spec per suite.
- Server: validate every request body inside the service (bodies are `unknown`). Paths come from `DataPaths` and
  ids are checked with `isValidId`. Start external programs only through `process.ts`.
- Logging: `log("<scope>")` from `server/log.ts` (server, desktop app) or `src/lib/log.ts` (the tab), never
  `console.*`: it prints as before and keeps the line in `<data>/logs/` (Settings › General › Logs, Help › Show Logs),
  where a packaged app's console goes nowhere. Log what's worth knowing later at a boundary: a job's end or failure,
  a process dying, a request failing; at debug what's only for chasing a problem (`EDITOR_LOG_LEVEL=debug`: every
  request and program run). Never per frame or per pointer move, nor a document's content; a program's own output
  goes in quiet (`lineLogger`, `{ quiet: true }`). Nothing on the engine's audio thread logs.

## Windows (the page can be in several)

The music editor's windows and Settings can be windows of the operating system, drawn by the same React tree, where
the page's host gives it `panels` (`desktopPanels()`): only the music app on Windows does (the engine's own windows,
`PanelWindow`; `NATIVE_WINDOWS` in `floating-window.tsx`, `docs/windows.md`); everywhere else they're boxes in the page. `window` and `document` are always the main page's, so code that runs inside a
window must say which one it means: `addWindowListener` for what the editor wants in every window (shortcuts, a
drag's end), `ownerWindow` / `ownerDocument(event.target)` (`elementFromPoint`, `devicePixelRatio`, `activeElement`,
`getSelection`), `isElement` / `isHtmlElement` instead of `instanceof Element` (another window's elements aren't
instances of this one's), `queryAnywhere` to look in all of them; `startPointerDrag` already uses the window the
press was in. A Radix portal in `components/ui` takes a container from `usePopupContainer()` (menus, selects,
popovers: the shared popup window) or `usePortalContainer()` (tooltips, dialogs). e2e (a browser) tests the boxes in
the page.

## Gotchas

- Terminals inside Electron apps (T3 Code, VS Code) set `ELECTRON_RUN_AS_NODE=1`, which makes Electron a plain Node.js:
  the desktop scripts remove it, but launching the app's binary by hand from such a terminal quits silently.
- Electron's macOS build (44.5.0) comes with a broken ad-hoc signature, and macOS 26 kills it on launch ("Electron quit
  unexpectedly", SIGKILL Code Signature Invalid in the crash report). `scripts/desktop.ts` signs it again ad hoc
  (`adHocSign`): Electron in node_modules before `dev:desktop`, the packaged app after it's packed. By hand:
  `codesign --force --deep --sign - <Electron.app>`.
- The desktop app is still the web app: keep features working in the browser (`pnpm dev`); `src/lib/desktop.ts` is
  the only place the page knows it's in the app (it gives the app `flush` to save before closing).

- Store selectors must return the same value for the same state: `project.markers ?? []` makes a new array on every
  call and loops React for ever. Use a shared empty constant (`sequenceMarkers` does).
- `data/` (or `EDITOR_DATA_DIR`) holds the recents (`projects.json`), the starting points (`templates/`), exports (never cleaned up yet) and `tmp`, which is wiped
  on startup. Export jobs live in memory.
- External programs: ffmpeg/ffprobe (import and export; `FFMPEG_PATH`/`FFPROBE_PATH`), yt-dlp for the Online tab
  (`YTDLP_PATH`), whisper.cpp's `whisper-cli` for local transcription (`WHISPER_PATH`; model in `EDITOR_MODELS_DIR`,
  default `~/.cache/editor/models`), and Chromium for every export (`CHROMIUM_PATH`, else Playwright's, else Chrome). The
  font list uses macOS AppKit through osascript (`fc-list` elsewhere).
- The server binds to 127.0.0.1 only and has no auth. It's a local tool. `/mcp` also refuses requests with a non-local
  `Origin` or `Host` (web pages and DNS rebinding).
- The assistant is the user's own Claude Code (`CLAUDE_PATH`, else found on the PATH) or Codex (`CODEX_PATH`), picked
  per chat, run in `data/assistant/workspace` with only the editor's MCP server: Claude with `--tools ""` (no shell or
  files) and `--strict-mcp-config`; Codex's app-server with its built-in tools and the user's other MCP servers turned
  off by `-c` overrides (never by writing `~/.codex`), a read-only sandbox and the editor's prompt as its base
  instructions. Its MCP calls carry their id in `_meta.callId` (Claude's in `_meta["claudecode/toolUseId"]`).
- A chat's tool calls act on its own video, even while the tab shows another (`src/assistant/doc.ts`): a background
  copy is loaded, edited and saved through the autosave queue (flushed before any video opens), and `view_frames`
  draws it with an offscreen PreviewEngine (`PreviewSource`). Calls run in the tab, one at a time per video; a tab
  that isn't open can't run them. Edits to the open video wait for the user's drag to end.
- Switching providers mid-chat starts that provider's own conversation, told what it missed (`transcript`).
- The e2e suite plays Claude Code with `e2e/fake-claude.mjs` and Codex with `e2e/fake-codex.mjs`: a message's
  `call <tool> <json>` lines are tool calls (`wait` and, for Codex, `sleep <ms>` hold the turn).
