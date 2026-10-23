# The music shell (an experiment)

Read the engine's guide (`docs/claude/music-engine.md`) first.

**Why.** In the desktop app the page is Electron's and the plugin windows are the engine's: two programs. On
Windows, owning a window across programs (`GWLP_HWNDPARENT`) joins their input queues, so Electron's UI thread
waits on the engine's message thread and the other way round. That causes the freezes, and every workaround around
them: `whileBusy`, cloaking, the stdout writer thread, pre-warmed panels, restacking. FL Studio is one program, so
none of it applies there. The shell tests whether doing the same thing fixes it: the app's page in a window of the
engine's own (JUCE's `WebBrowserComponent`: WKWebView on macOS, WebView2 on Windows), with the plugin windows
belonging to that window inside the same program.

It worked on Windows (2026-10-23), so the music suite becomes an app of its own in this window: the plan is
`docs/apps.md` (YTStudio as four apps).

**What it is (step 1, the test).**
- `pnpm dev:shell` (`scripts/shell.ts`) runs the server and Vite as `pnpm dev` does, with `EDITOR_ENGINE_WINDOW` set
  to the app's address. The server is not watched, because restarting it would close the window.
- The server starts the engine at once with `--window <url>` (`server/app.ts`, `AudioEngine`'s `window`). The engine
  opens `ShellWindow` and shows the page there.
- The page still talks to the server for everything except the few commands it sends straight to the engine:
  `directCommands` in `ShellWindow.cpp`, which is `preview` (a key played) for now. That goes through JUCE's
  native function `engine` (`src/suites/music/shell.ts`, used by `transport.preview`).
- Plugin windows are owned by the shell (`EditorWindow::setShellWindow`): an owned window on Windows, a child window
  on macOS (`setWindowOwner`, MacWindow.cpp). They stay over it, move with it and never ask another program
  anything, so `whileBusy` does nothing there.
- Closing the window quits the engine, which first tells the server (`shellClosed`). The server then stops, and
  so does `dev:shell`. If the engine crashes, the server starts it again and the window comes back.
- WebView2's SDK comes from NuGet at configure time (engine/CMakeLists.txt) and is linked statically. Its profile
  is kept in `<data>/engine/webview`.

**Trying it.** Run `pnpm install`, `pnpm engine:build`, then `pnpm dev:shell`. Things to judge on Windows: open
several plugins at once, click between a plugin and the Piano roll, play keys while Serum is open, and load a heavy
song.

**Known limits** (fine for a test, to fix if it goes ahead):
- The music panels are boxes in the page (`desktopPanels()` is false outside Electron), so a plugin window always
  sits above them, as in FL's detached mode.
- There's no system menu, so on macOS ⌘C/⌘V in text fields have no Edit menu to go through.
- The other suites work, but they're not what's being tested.
