# YTStudio becomes four apps

A plan (Théo's call, 2026-10-23). Today YTStudio is one app with three suites in tabs. It becomes four apps of
their own:
- **Music**, the DAW. It runs in a window of the audio engine's own, on Windows and on the Mac.
- **Video**, the video editor. Electron.
- **Photo**, the photo editor. Electron.
- **Visualizer**, Now Playing's full-window visualizer. Electron.

Each app opens and saves its own kind of project and has its own Home. They share one repo and one platform (Home,
tabs, Settings, the assistant, `components/ui`, the server).

## Why

Music hurts and the others don't. On Windows the plugin windows misbehave and the computer freezes. The cause is that
Electron and the engine are two programs: owning a window across programs joins their input queues, so each waits on
the other. FL Studio is one program. The test on this branch (`pnpm dev:shell`, `docs/claude/music-shell.md`) put
the page in the engine's own window, and on Windows it felt like FL.

The suites are also different enough to be apps of their own, as Adobe's are. Music is the most different of all: a
native engine, plugins, and windows that have to belong to it. The code is already split for this. Each suite is its
own folders, and `server/architecture.test.ts` keeps them from importing each other.

## Decided

- **Four apps, launched from the Dock or Start menu.** A launcher (Creative Cloud's idea) comes last, and only if it's
  missed. Each app's Home is already its launcher: its recent projects and New.
- **The Now Playing pill goes.** It's what made every suite listen to the computer's sound, which the engine's
  window (Safari's web view on the Mac) can't do. The visualizer becomes an app of its own and stays on Electron,
  which listens with no picker.
- **A file type per app:** `.ytsng` (songs), `.ytvid` (videos) and `.ytimg` (photos). Finder and Explorer then
  open each in its own app. A `.yt` (and a `.vaudio`) still opens and is renamed to its suite's extension, as
  `.vaudio` became `.yt` (`LEGACY_EXTENSIONS`, `fitsName` in `server/packages.ts`). The Visualizer makes no projects.
- **Each app keeps its own data:** its recents, settings, layouts, assistant chats and logs, in a data folder of its
  own. Projects are files, so they're shared anyway: they all go to `~/Documents/YTStudio`. Two apps open at once
  never write the same file.
- **Music runs in the engine's window on both systems.** Video, photo and the visualizer stay on Electron, unchanged
  in how they run.

## Still to decide (each before its step)

- **The apps' names.** "YT Music" is YouTube's. Perhaps YTStudio Music, YTStudio Video and so on. Needed for step 2.
- **Who gets the current bundle id** (`gg.jestr.ytstudio`). The Mac's permissions are kept per id (the microphone,
  audio capture, Spotify's Apple Events). It goes to Video or Visualizer; Music asks for the microphone afresh.
- **Settings and layouts on the move.** They're in the page's storage, which a new app or web view starts empty. Either
  they're set once again, or step 1 moves what matters (theme, fonts, preferences) into each app's data folder.
- **A plugin crash.** Today a crashing plugin kills the engine and the server starts it again. In the music app the
  engine is the app, so a crash closes it, as in FL without its bridge. Autosave and reopening on the next launch
  cover the work. Running plugins in a process of their own (FL's "Make bridged") can come later, if needed.

## Steps

Each step ends in something to try. Each is merged (a PR) before the next starts.

### 1. An app shows one suite

The page and the server learn which app they are (`EDITOR_APP`: `music`, `video`, `photo`, `visualizer`, or none
for every suite, which is what `pnpm dev`, the e2e suite and the gallery keep using).
- **The page.** The server says which app it is, so one page build serves every app. Home lists only that app's
  projects and offers only its New. The tab strip has only its projects. Settings shows General plus its suite's tab.
  The menu bar's File › New has one item. Each app gets its own name and icon in the page.
- **The pill.** It's removed, and with it listening in the tab strip. The visualizer view moves behind the Visualizer
  app (step 2), along with Settings › General's Now Playing group. The video editor's own audio-reactive looks stay in
  the video editor.
- **File types.** `PROJECT_EXTENSION` becomes one per suite (`SUITES` says it). Packages are named by their suite,
  and `.yt` joins the legacy extensions. Open… takes any of them; one of another app's is turned down with its name.
- **Data.** Each app's data folder is its own (`EDITOR_DATA_DIR`), with its own recents, chats and logs.
- **Developing.** `pnpm dev` stays as it is, every suite in a browser. There's one command per app: `pnpm dev:music`
  (the engine's window, `scripts/shell.ts`), `pnpm dev:video`, `pnpm dev:photo` and `pnpm dev:visualizer`.
- **Done when:** with `EDITOR_APP=video`, Home shows only videos; a `.yt` song isn't listed; a `.yt` video opens and
  becomes `.ytvid`; the suite e2e specs pass with every suite.

### 2. Video, Photo and Visualizer as Electron apps

`scripts/desktop.ts` builds one app per name, each with its own:
- app id, name and icon;
- file type (`fileAssociations`, `CFBundleDocumentTypes`);
- `EDITOR_APP`, userData folder and fixed ports, so two apps open at once never share an origin;
- `update:desktop` and `test:desktop`.

Music isn't built here. The Visualizer opens straight into the visualizer: the stage, its keys, its looks, Your media
and Your taste. It still listens with Electron's grant (`answerListening`).
- **Done when:** the three apps install side by side, each opens its own files from Finder and Explorer, and each
  exports (Video: a cross dissolve; Photo: a JPEG; Visualizer: it plays to Spotify).

### 3. The music app on Windows

Music runs in the engine's window, made the real app rather than the test.

- **Who starts whom.** The engine is the app. It starts the server: a Node shipped with it, running the server
  bundle. It talks to the server over a pipe of its own, in the same JSON lines, so stdout stays for logs. The
  server no longer starts or restarts the engine. Closing the window saves first (`editorDesktop.flush`), then quits
  both.
- **Our own web view host.** Instead of JUCE's `WebBrowserComponent`, the engine hosts WebView2 itself. JUCE hides
  what's needed:
  - creating the windows the page opens (`NewWindowRequested`), so panels are real windows of the same program;
  - drag regions (`IsNonClientRegionSupportEnabled`, so `app-region: drag` works);
  - browser arguments (remote debugging for tests, the GPU flags);
  - process failures.
  It keeps one bridge for the page, `src/lib/host.ts`, which replaces both `editorDesktop` and the test's `shell.ts`.
  To measure first: whether WebView2's windowed hosting joins input queues with its own processes. If it freezes,
  composition hosting (`CoreWebView2CompositionController`) avoids it.
- **The window.** No system title bar; the page draws the window buttons (`header/window-buttons.tsx`) with snap
  layouts (`WM_NCHITTEST`). Its place is kept. It has its own icon and app id.
- **Panels.** The Piano roll, Mixer, Channel rack and Settings are owned windows again, as with Electron
  (`NATIVE_WINDOWS`). Now they're the engine's own, beside the plugin windows, in one program.
- **What `editorDesktop` did, in the engine:**
  - dialogs (save, open, choose a folder);
  - the Trash and Show in Explorer;
  - recent documents;
  - one instance only, handing it files opened twice;
  - the microphone;
  - logs and the data folder.
- **The direct bridge.** Commands the page now sends through the server that only the engine needs (the piano's
  keys, knobs, meters) can go straight to it, as `preview` does in the test. Each one moved is measured.
- **Packaging.** An installer (NSIS) with the engine, Node, the server bundle, the page, the music worker and the
  `.ytsng` file type. WebView2's runtime is part of Windows.
- **Tests.** The music e2e spec still runs the page in a browser. `test:desktop:music` drives the real app over
  WebView2's remote debugging and checks: it opens, plugins open over it, the panels are windows, and a song exports.
- **Done when:** Théo uses it for a session instead of FL and nothing freezes.

### 4. The music app on the Mac

The same app in WKWebView (Safari's engine). Music needs little the Safari engine lacks: no WebGPU, and no drawn
exports (the engine renders songs).
- **Its own WKWebView host**, as on Windows, for:
  - the windows the page opens;
  - `isInspectable` (Safari's Web Inspector);
  - file drops with their paths (sample folders from Finder, `droppedPath`);
  - not being throttled while hidden (`beginActivityWithOptions`).
- **The window.** A full-size content view with the traffic lights in the tab strip (`trafficLightPosition`'s place),
  and drag regions the page reports to it.
- **The menu bar:** the app menu, File, an Edit menu that sends copy, paste and undo to the web view (so text fields
  work), View, Window and Help, built from the page's commands.
- **Plugin windows** are child windows of the app's (already in the test). Panels stay in the page, as on the Mac now.
- **Packaging.** The engine's bundle becomes the app: no `LSUIElement`, Node and the server bundle inside, the
  `.ytsng` document type, signed ad hoc, a dmg.
- **Tests.** The page's e2e is unchanged. The desktop smoke test drives it through a test hook in the page
  (WKWebView has no remote debugging protocol).
- **Done when:** the same session on the Mac, and copy, paste and dropping a sample folder all work.

### 5. Electron loses the music suite's workarounds

With no music in Electron, its plugin-window code has nothing to do. These go:
- `electron/floating.ts`, `stacking.ts`, the engine half of `hover.ts`;
- `setHostWindow` and `raiseEngineWindow` (`server-protocol.ts`, `server/app.ts`);
- `whileBusy`, cloaking, `setAppWindow` and pre-warmed panels for the engine;
- the music half of `panels.ts`.

The guides (`docs/claude/music-engine.md`, `docs/windows.md`, CLAUDE.md) are rewritten to match.
- **Done when:** the Electron apps build without any of it and their tests pass.

### 6. A launcher (only if missed)

A small app listing the four, with each one's recent projects, to open or install. Not before it's wanted.

## What it means for development

- **One repo still.** The platform is what each app is built from; an app is mostly `EDITOR_APP` and its packaging.
- **Music's window side is C++:** menus, the title bar, dialogs, the web view host. A change there means rebuilding
  the engine (`pnpm engine:build`). Page changes still reload instantly in `pnpm dev:music`.
- **Tests split as the suites already do:** one e2e spec per suite, plus one desktop smoke test per app.
- **Disk:** three Electron apps take about three times Electron's size (some 250 MB each). The music app is small (the
  engine, Node, the page).
