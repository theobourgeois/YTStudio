# The music app's window (the engine is the app)

Read the engine's guide (`docs/claude/music-engine.md`) first; the plan is `docs/apps.md` (steps 3 and 4).

**Why.** In the Electron app the page is Electron's and the plugin windows are the engine's: two programs. On
Windows, owning a window across programs (`GWLP_HWNDPARENT`) joins their input queues, so Electron's UI thread
waits on the engine's message thread and the other way round. That caused the freezes, and every workaround around
them: `whileBusy`, cloaking, the stdout writer thread, pre-warmed panels, restacking (most gone with step 5). FL
Studio is one program, so none of it applies there. So the music app is the engine: the page in a window of its own (WKWebView through JUCE's
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
`engine/src/HostCommands.cpp`; the page's own window buttons, `host.window`), so `isDesktop` is true and the page acts
as in the desktop app where it can. What Electron's preload has and this doesn't (`panels`, the microphone) is absent,
and the page falls back to the browser's way. It answers the engine's events (`flush`, `openFile`, `dragPaths`; on a
Mac also `command`, `fullscreen`, `zoom`; on Windows `maximized`) and sends `host.ready` once the app has loaded,
getting the files it was handed meanwhile (and the page's zoom, whether the window is maximised). `hostCommand` sends a command
straight to the engine: the app's own (`host.*`) and those `directCommands` lets through (`preview`, a key played,
used by `transport.preview`). WebView2's messages on Windows (replies `{ id, ok, result | error }`, events
`{ event, ... }`), JUCE's native function `engine` and its `host` event on macOS. Everything else still goes through
the server.

**The server's side.** `askApp` sends the engine an app command: `page`, and `host.trash` / `host.reveal` for the
Trash and Show in Finder (the `trash` and `reveal` the Electron app gives `createApp`).

**Windows** (`WebView.cpp`, `ShellWin.cpp`). The engine hosts WebView2 itself, not through JUCE's
`WebBrowserComponent`, drawn through DirectComposition (composition hosting): it's handed the mouse and Explorer's drags,
so no window of WebView2's browser or GPU process is inside ours and every hit test is the engine's.
`VAUDIO_WEBVIEW_HOSTING=windowed` puts WebView2's own window in ours instead (measured as quick on 2026-10-23: Serum 2
open on a 5-Serum song playing, its window dragged, 20 clicks between it and the page, neither froze; a click reached
the page in about 10 ms, a drag step moved the window in under 1 ms), but those windows answer the hit tests, so the
window can't be dragged by the page there. WebView2's SDK comes from NuGet at configure time (engine/CMakeLists.txt) and
is linked statically. Its profile is kept in `<data>/engine/webview`.
- **No title bar** (JUCE's `DocumentWindow` without one: `ShellWindow::findControlAtPoint` answers the system's hit
  test, which the page's window passes on there with `HTTRANSPARENT`): its edges resize it (5 points in), the page's
  bars drag it (Aero Snap, a double click maximises, as a title bar), and the maximise button is `HTMAXBUTTON`, so
  hovering it shows Windows 11's snap layouts.
- **The window's buttons are the page's** (`CaptionButtons` in header/window-buttons.tsx, `captionButtons` in
  `editorDesktopInfo`): Windows' three, 46 points each, over the top-right corner of the bar that starts the window
  (`--window-controls-width`, as Electron's `titleBarOverlay`). The window hit-tests the maximise one (from the bar's
  height, `host.titleBar`), and hands its mouse to the page (`winShell::dress`, `WebView::forwardMouse`), so it still
  lights up and is clicked; `host.window` maximises and restores, and `maximized` says which it shows.
- **The bars** are told by the page (`host.dragRegions`: the `[data-titlebar]` bars, less what's pressed in them and
  what lies over them, in CSS pixels, sent when they change), not WebView2's `app-region` support
  (`IsNonClientRegionSupportEnabled`): it sends them again on nearly every frame while the page animates, and its
  browser process fell behind, growing by 50 MB a second while a song played and no longer answering.
- **Explorer's drops** go to WebView2 through `DropTarget` (with the system's drag picture), and the page is told the
  files' paths first (`dragPaths`, `pathForFile`), as on a Mac. Meanwhile the page's bars are the page's (a song
  dropped on the tab strip). A project opened is added to Windows' recent documents (`host.recent`).
- **The keys are the page's**: WebView2's own (F5 reloads, Ctrl+F finds, Ctrl+P prints) are off
  (`AreBrowserAcceleratorKeysEnabled`), and the keyboard Windows gives the window (Alt+Tab, a plugin's window closed)
  goes on to the page (`winShell::dress`), which JUCE's window otherwise kept until the page was clicked.
- **Panels are the engine's windows** (`PanelWindow`, docs/windows.md): the page's `window.open` with a panel's name
  makes one (`NewWindowRequested`), and `host.panel` shows, places, hides and closes it; the page is told where the
  window is and the displays' work areas (`screen`, with `host.ready` and as it moves) and when a panel was closed
  by something else (`panelClosed`). A reload closes them all.
- **The playhead doesn't stop while a window is dragged** (`dragWithoutPause`, MacWindow.cpp, the app's window and
  the plugins'): a press on a title bar goes straight into the system's move loop, where the message loop runs on.
  JUCE handed it to `DefWindowProc` once the mouse moved, which then waited up to half a second to see it move on,
  dispatching nothing meanwhile: no timers, so no transport events (measured: 537 ms with the mouse held still after
  the first move; about 100 ms now).

Plugin windows are owned by the window (`EditorWindow::setShellWindow`): an owned window on Windows, a child window
on macOS (`setWindowOwner`, MacWindow.cpp). They stay over it, move with it and never ask another program anything.
The window tells the engine's plugin host where it is (`host { bounds }`, `ShellWindow::tellHost`), so a plugin's
window opens over it; on Windows also its `frame` in physical pixels, which the plugin windows move by. What Electron needed to coordinate with the engine's windows from another program (window levels,
restacking, the hover relay, `whileBusy`) is gone (docs/apps.md, step 5).

**macOS** (`ShellMac.mm`, Objective-C++ without ARC, as JUCE is; `ShellWindow` calls it). JUCE's
`WebBrowserComponent` (WKWebView) is kept: what it doesn't say is done to its window and view in AppKit, as Electron
does for the other apps (`electron/main.ts`), so the page can't tell them apart.
- **The window** (`macShell::dress`): no title bar, the content under where it was, the traffic lights moved into
  the page's first bar (18 pt in, the bar's height from the page: `titleBar`, `host.titleBar`), or hidden when the
  page draws its own (`ownButtons`). The page marks itself `desktop desktop-darwin` (index.css makes room), and
  `fullscreen` when the window is. Its place is kept (`placeFile`, `<data>/engine/window.txt`). App Nap is held off
  (`beginActivityWithOptions`): a DAW plays while hidden.
- **Dragging it.** `-webkit-app-region` is Chromium's, so the page does it by hand: a press on a `[data-titlebar]`
  (not on what's pressed in it, the same `no-drag` list as index.css) sends `host.drag`, and the window follows the
  mouse (`performWindowDragWithEvent` with the press, kept by an event monitor); a double click sends
  `host.titleDoubleClick`, which does what System Settings says (zoom, minimise or nothing).
- **The menu bar** (`installMenus`): the app's menu (Hide and Hide Others leave ⌘H and ⌥⌘H to the page, which hands
  back what it doesn't use: `hideApp`), File (the page's `DesktopCommand`s as `command` events, Open Recent filled by
  AppKit from `host.recent`), Edit (to the web view: text fields' ⌘C, ⌘V, ⌘Z), View (zoom, kept between launches and
  marked as `--desktop-zoom`; Reload; Show Logs and the data folder), Window and Help. **The page's keys come first**:
  WKWebView's `performKeyEquivalent:` is replaced so a key the page caught (⌘O, ⌘W, ⌘R the export) never reaches the
  menu; the menu only shows them, as Electron's `registerAccelerator: false` does. A click on an item still runs it.
- **Dropped files' paths**: the view's `draggingEntered:` tells the page where Finder's files are (`dragPaths`)
  before WebKit hands it the drop; `pathForFile` matches a dropped `File` by its name (`droppedPath`).
- **Focus.** The window activated (⌘Tab, a plugin window closed) makes the web view first responder, so the keys go
  to the page (`focusPage`). Safari's Web Inspector works on it (`isInspectable`, Inspect Element).
- **Packaged** (`pnpm build:desktop music`, `packMusicMac` in `scripts/desktop.ts`): the engine's bundle copied as
  `YTStudio Music.app` (`gg.jestr.ytstudio.music`), its executable renamed, `Contents/Resources/app/` filled with
  Node (the official build of this Node's version, checked against its SHASUMS and cached in `build/node`), the
  server bundled by esbuild (`server.mjs`), the page (`dist/`), the photo helper and the music worker; the `.ytsng`
  type, its icon, signed ad hoc and a dmg. `LSUIElement` stays on: the plain engines the server starts from the same
  bundle (Home's offline previews) must show nothing, so the app's window asks for its Dock icon itself
  (`setDockIconVisible`). Packaged, the server finds ffmpeg on the login shell's `PATH` (`useLoginShellPath`), as
  Electron's `shell-path.ts`.
- Not yet: the page's localStorage (layouts, tabs, theme) isn't carried over from YTStudio's (WKWebView keeps its own).

**Trying it.** `pnpm install`, `pnpm engine:build`, then `pnpm dev:music` (`scripts/shell.ts`: Vite, and the engine
told to run this checkout's server through tsx and show Vite's page, so the page reloads as it's edited; the server
isn't watched: a C++ or server change means quitting and running it again). `pnpm dev:shell` is every suite there.

**Still to do** (docs/apps.md): packaging on Windows (step 3's Windows half).
