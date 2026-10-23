# The music app's window (the engine is the app)

Read the engine's guide (`docs/claude/music-engine.md`) first; the plan is `docs/apps.md` (steps 3 and 4).

**Why.** In the Electron app the page is Electron's and the plugin windows are the engine's: two programs. On
Windows, owning a window across programs (`GWLP_HWNDPARENT`) joins their input queues, so Electron's UI thread
waits on the engine's message thread and the other way round. That causes the freezes, and every workaround around
them: `whileBusy`, cloaking, the stdout writer thread, pre-warmed panels, restacking. FL Studio is one program, so
none of it applies there. So the music app is the engine: the page in a window of its own (WKWebView through JUCE's
`WebBrowserComponent` on macOS, WebView2 hosted by `WebView.cpp` on Windows), the plugin windows beside it in the
same program. It was tried on Windows first (2026-10-23) and nothing froze.

**Who starts whom** (`engine/src/Main.cpp`).
- The engine is the app when it's given `--server` (development) or, packaged, when there's no `--data` and the
  server's bundle is in its resources (`app/`: `node`, `server.mjs`, `dist/`, the music worker; `Contents/Resources/app`
  on the Mac, beside the `.exe` on Windows). Started by a server with `--data` (the Electron apps, the tests, Home's
  offline previews), it's the plain engine on stdin and stdout, as before.
- It listens on 127.0.0.1 (a port of the system's choosing) and starts the server as its child (`Server.cpp`,
  `ServerProcess`), telling it `EDITOR_ENGINE_CONNECT=<port>:<token>` and `EDITOR_APP=music`. Packaged it also sets
  the data folder (`<appData>/YTStudio Music/data`), the projects folder, the ports and where the page and the worker
  are, unless they're set already. A server that stops is started again after a second; three quick stops in a row
  and the app says where the logs are and quits.
- The server connects (`AudioEngine`'s `connect`: `socketLink` in `server/music/engine.ts`, the same JSON lines as
  over stdin), proves it's the child with the token's line, and is sent `ready`. It never starts or restarts an engine
  of its own then. Once listening it tells the engine where the page is (`page { url }`): the window opens on it.
  Its port is the app's (5651 packaged); if that's taken it takes any other, since only the window needs it.
- Lines sent while no server is connected are dropped: the next one is sent `ready` and gives the song back.
- **Quitting** (the window's close button, ⌘Q, Alt+F4): the page is asked to save (`flush`: `editorDesktop.flush`,
  answered with `host.flushed`; 5 s at most), the server is told (`shellClosed`, then it exits as on SIGTERM) and
  given 3 s, then the engine quits. If the server goes away first, it exits; the engine starts it again.
- **A plugin crash** takes the app with it, as FL without its bridge: autosave and reopening cover the work.
- **One instance**, packaged (`moreThanOneInstanceAllowed`): a package opened again (Finder, Explorer, its icon) goes to
  the running app (`anotherInstanceStarted` → `ShellWindow::openFiles`), queued until the page says it's ready.
- The engine's settings start with YTStudio's (`carryOver`: `plugins.xml`, `device.xml`, `midi.json`, `presets/`,
  each once): from `--carry-from` in development, from YTStudio's data packaged.

**The page's side** (`src/lib/host.ts`, imported first by `main.tsx`). In the window it sets `editorDesktopInfo`
(the platform and the system's dialogs: `host.saveFile`, `host.chooseProject`, `host.chooseFolder`, run by
`engine/src/HostCommands.cpp`), so `isDesktop` is true and the page acts as in the desktop app where it can. What
Electron's preload has and this doesn't yet (`panels`, `titleBar`, `windowAction`, `pathForFile`, the microphone)
is absent, and the page falls back to the browser's way. It answers the engine's events (`flush`, `openFile`) and
sends `host.ready` once the app has loaded, getting the files it was handed meanwhile. `hostCommand` sends a command
straight to the engine: the app's own (`host.*`) and those `directCommands` lets through (`preview`, a key played,
used by `transport.preview`). WebView2's messages on Windows (replies `{ id, ok, result | error }`, events
`{ event, ... }`), JUCE's native function `engine` and its `host` event on macOS. Everything else still goes through
the server.

**The server's side.** `askApp` sends the engine an app command: `page`, and `host.trash` / `host.reveal` for the
Trash and Show in Finder (the `trash` and `reveal` the Electron app gives `createApp`).

**Windows** (`WebView.cpp`). The engine hosts WebView2 itself, not through JUCE's `WebBrowserComponent`. Windowed
hosting by default; `VAUDIO_WEBVIEW_HOSTING=composition` draws it through DirectComposition and hands it the mouse,
so no window of WebView2's browser or GPU process is inside ours. Measured on 2026-10-23 (Serum 2 open on a 5-Serum
song playing, its window dragged, 20 clicks between it and the page): neither froze, and both were as quick (a click
reached the page in about 10 ms, a drag step moved the window in under 1 ms, no thread stalled over 40 ms, no
dropouts). WebView2's SDK comes from NuGet at configure time (engine/CMakeLists.txt) and is linked statically. Its
profile is kept in `<data>/engine/webview`.

Plugin windows are owned by the window (`EditorWindow::setShellWindow`): an owned window on Windows, a child window
on macOS (`setWindowOwner`, MacWindow.cpp). They stay over it, move with it and never ask another program anything,
so `whileBusy` does nothing there.

**Trying it.** `pnpm install`, `pnpm engine:build`, then `pnpm dev:music` (`scripts/shell.ts`: Vite, and the engine
told to run this checkout's server through tsx and show Vite's page, so the page reloads as it's edited; the server
isn't watched: a C++ or server change means quitting and running it again). `pnpm dev:shell` is every suite there.

**Still to do** (docs/apps.md): on Windows the title bar, panels as owned windows, packaging (step 3's Windows half);
on the Mac the menu bar, the window's look, file drops with paths, packaging (step 4).
