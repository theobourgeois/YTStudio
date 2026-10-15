# Windows

Every suite floats its windows the same way, FL Studio's: the music editor started it, and it's now the
platform's (`src/components/windows/`), so the video editor, the image editor and the app itself use the
same title bars, snapping, stacking and keys.

## What a window does

- It floats on a **desktop** (`Desktop`): dragged by its title bar, its edges sticking to the desktop's and
  to other windows' (Alt: not), brought to the front when touched, closed with its ×.
- A `resizable` one resizes by any edge or corner, fills the desktop (double-click its title, or drag it to
  the top) or half of it (drag it to a side), and goes back the same way. One that doesn't resize goes to
  the desktop's corner and back on that double-click.
- A window that `keepsKeys` (Settings, the video editor's) is like a dialog to the keyboard: what's
  pressed in it is its own (the editors' shortcuts check `keptByWindow` and leave it alone), Esc closes it
  (`escapeCloses`), and the focus goes into it when it opens and back when it closes. It's not modal: the
  app under it can still be clicked, and a song keeps playing.
- What's in a window that was a dialog is laid out with `WindowBody`, `WindowLead` (the line on what it's
  for) and `WindowFooter` (its buttons); its title is in the title bar (`heading` when it changes, as the
  export's "Exporting…", so its `title` can stay its name).
- Confirmations, name prompts and pickers (delete this?, a folder's name, New project) stay modal dialogs:
  they want an answer before anything else.
- Its look is the theme's: `floating`, a title bar a step darker than its body, small corners.

## How it's built

- `geometry.ts`: the maths (sticking, edge snaps, resizing), pure and tested.
- `store.ts`: `createWindows(order)`, a store per desktop: where each window is (`places`), how they're
  stacked (`order`), the corner and snap state. Which windows are *open* belongs to their owner (the music
  editor's `ui.ts`, `useSettings`, the video editor's `useOpenVideoWindows`); `focus` brings one to the
  front when it opens.
- `floating-window.tsx`: `FloatingWindow` and `Desktop` (which hands its store to its windows), and
  `centredOnDesktop` for small windows that open in the middle.
- A suite wraps them with its own ids (`MusicWindow`, `MusicDesktop`, `useMusicWindows`), so its window
  ids are checked by TypeScript.
- **The video editor's desktop** (`stores/video-windows.ts`, `components/workspace/video-desktop.tsx`)
  lies over the whole editor (`overlay`): export, video settings, Auto captions and Save to Library float
  there, and the editor beside them stays usable (edit while it exports; watch the Program monitor while
  changing the frame).
- **The app's desktop** (`stores/app-windows.ts`, drawn by `App.tsx`) covers the whole app, above every
  suite and below menus and dialogs. Only its windows take the pointer. Settings is on it.
- In the desktop app, a window is never part of the title bar's drag region (`index.css`), even over it.

## Native windows (the desktop app)

> **On on Windows, off on a Mac** (`NATIVE_WINDOWS` in `components/windows/floating-window.tsx`).
>
> - **Windows**: every panel is a window owned by the main window (`setParentWindow`, `electron/panels.ts`), and so
>   is every plugin window (the engine's `setWindowOwner`). Owned windows are always above their owner, never
>   above another program, minimised with it, and stacked among each other by use. So the Piano roll comes in front
>   of Serum when it's clicked and Serum in front of it, as in FL Studio, with no window levels and no restacking.
>   A plugin's window never closes because the app was used. The keys the editor needs reach it even while a
>   plugin holds the keyboard in a child window of its own: the engine hooks its message thread's keyboard
>   (`hookThreadKeys`, `EditorWindow::takeFirst`, FL's default typing keyboard priority).
>   Panels have no frame of the system's (`thickFrame: false`), so Windows doesn't zoom and fade them in, and
>   what pops up in them (menus, popovers, tooltips) has no CSS animation: everything appears at once.
>   **Owning across programs ties them together**: the app's thread then waits for the engine's whenever it moves,
>   raises or activates a window, and they share their input. So the engine must never block on the app (its
>   messages go out through a writer thread: a full pipe once froze the app for good, the song still playing),
>   and its plugin windows belong to nothing while its message thread is busy (`EditorWindow::whileBusy`: a
>   plugin loading, its editor being made, a sample read), coming back in front when they belong to the app again.
>   A new plugin window is cloaked (DWM) until it's drawn, so it never shows white first. The menu window is shown
>   off the screens until it's see-through (shown in place, it was a grey sheet as a song opened), and a panel shown
>   behind others only has the panels in front of it raised again (the restacker is the Mac's).
> - **Mac**: the editor's windows are boxes in the page, as in a browser. Native ones gave no hover or keyboard
>   to the windows beside the one in use. A plugin's window floats over the main window instead and **closes
>   when one of the app's own windows is used** (`closeEngineWindows`, on the main window's focus). The levels
>   below describe the Mac's native mode (its smoke test is `pnpm test:desktop:music`, which needs the flag).

In the desktop app the music editor's windows (and Settings) are not boxes in the page but **windows of the
operating system**, so a plugin's window, which is the audio engine's (another program), can sit *between* them:
the channel rack in front, the plugin behind it, the Playlist behind that. In a browser tab they stay boxes in the
page, exactly as above (`Desktop`'s `native` only takes effect where there is a desktop app,
`desktopPanels()`).

- **One React tree, several documents.** `FloatingWindow` opens a window with `window.open` (same origin, same
  renderer: Electron's `setWindowOpenHandler` makes it frameless, hidden and floating, `electron/panels.ts`),
  copies the page's theme and stylesheets into it (`native/styles.ts`: a stylesheet the page adds or removes, as
  Radix's scroll lock does for every menu, is added or removed alone; a changed one has them all copied again, for
  hot updates) and draws its chrome and content into it with a portal. A window of the system is slow to make (its
  document, 250 KB of styles parsed, its fonts), so a panel closed keeps its window hidden for the next one (up to
  four) and two are made while the app is idle (`native/panel-window.ts`, `prewarmPanelWindows`); a panel is shown
  once its fonts are in and it has drawn two frames, and one reused is revealed a moment later (`REUSED_REVEAL_MS`
  in `electron/panels.ts`), so it never shows the panel it was before. Every store, hook and canvas is the page's own; the window is only a
  place to draw. The page moves it with `moveTo`, or with `panels.place` when its size changes too (a move and a
  resize from the page undo each other); it is resized by its edges by the system, and its title bar drags it
  (`startPointerDrag` on the pointer's place on the *screen*, the edges still sticking to the desktop's and to other
  windows').
- **They are the app's, not the computer's.** The panels (`hiddenInMissionControl`, `electron/panels.ts`) and the
  engine's plugin windows (`keepOutOfWindowSwitchers`, `engine/src/MacWindow.cpp`: Transient + IgnoresCycle) have no
  tile in Mission Control and aren't cycled by Cmd-`; none is in the Dock (`skipTaskbar`, LSUIElement).
- **A window's place is still its place on the desktop** (`WindowPlace`, CSS px from the desktop element's corner);
  `native/geometry.ts` turns it into the screen's points and back, and a window follows the main window when it
  moves. One may leave the main window and the screen, but never all of them (`keepReachable`).
- **Stacking.** Panels and the engine's plugin windows are all at the *floating level*, so a click raises whichever
  it lands on, whoever it belongs to. The main window (the toolbar, the stage) is an ordinary window and can't
  cover them. Clicking the toolbar's Play never buries a plugin. While another program is in use they drop to the
  ordinary level (behind it, still showing), and rise again with the app (`electron/floating.ts`: the app is in
  use while one of its windows or a plugin's has the focus, with a grace for the moment between the two). The system
  doesn't keep their order across those level changes, so the main process keeps it (`electron/stacking.ts`: every
  window used moves to the top, the engine says which of its windows was, `editorFocus`) and puts the windows back in it,
  one at a time, after the app is in front again (`Restacker`).
- **What pops up over a window** (menus, selects, popovers, context menus) can't be drawn outside it, and a small
  window's menu would be cut off. They're drawn in one transparent window shared by all the panels
  (`native/popups.ts`), lying over the display from the corner of the panel the pointer is in, so that a menu's place
  against the control that opened it (worked out in the control's window) is its place there. It appears while
  something is in it and hides after. Tooltips and dialogs stay in their panel (`PortalContainerProvider`,
  `PopupContainerProvider`).
- **Code that runs in a window can't assume `window` and `document` are its own.** They're the main page's.
  Listen for the keyboard or a drag's end with `addWindowListener` (every window, those opened later too), find what
  the pointer is over with `ownerDocument(event.target).elementFromPoint`, measure a canvas against
  `ownerWindow(canvas).devicePixelRatio`, ask whether something is an element with `isElement` / `isHtmlElement`
  (`instanceof Element` is false for another window's), and look across windows with `queryAnywhere`. A new Radix
  portal takes `container={usePopupContainer()}` (menus) or `usePortalContainer()` (tooltips, dialogs).
  `ResizeObserver`, `IntersectionObserver` and `requestAnimationFrame` of the page work on a panel's elements.
- **Hover in a window without the focus.** macOS sends mouse-moved events only to the window with the keyboard,
  so with a panel in use the main window's toolbar (or another panel) wouldn't light up under the pointer, though a
  click works (`acceptFirstMouse`). `electron/hover.ts` reads the pointer about every frame and, if the topmost of
  our windows under it isn't the focused one, sends it a `mouseMove` (and a `mouseLeave` when the pointer goes
  out). It can't see the engine's plugin windows, so one over ours still hovers what's under it.
- **Known limits.** A panel's menu can't reach above or left of its corner (the popup window starts there). A window
  isn't shown on a full-screen Space of the main window (the engine's can't be told to: it would take macOS calls
  of our own). The snap preview (dragging a window to the desktop's edge) is drawn in the main window, under the
  panels. A modal dialog opened from a small panel is limited to that panel.
- **Stages.** A window of its own for a picture to fill (Now Playing's visualizer out of the app: `stage-window.ts`,
  `electron/stage.ts`, docs/now-playing.md). Drawn by the page as a panel is, but an ordinary framed window: in the
  Window menu, full screen on its own screen, over other programs only when pinned, a popup in a browser. What's
  drawn in one asks its window for frames, not the page's: the main window may be minimised while it plays.

## Where it goes next

1. Done: **the video editor's dialogs are windows** (export, Auto captions, the video's settings, Save to
   Library). Its main layout (left panel, Program monitor, timeline) stays docked, as Premiere's does:
   those are always on screen and the timeline wants the full width.
2. Done: **the video editor's panels dock** (`src/components/dock/`, `stores/video-dock.ts`): a tab dragged
   onto another group's tabs joins them, towards an edge goes beside it; the lines between groups resize
   them; each group's menu floats its panel out as a window on the video desktop (its × docks it back),
   picks a workspace or resets the layout. The layout is remembered (localStorage), the same in every video.
   The assistant's side panel stays outside it, the app's.
3. Things better seen beside the edit become panels too: a source monitor, the graph editor, a mixer.
4. **The image editor** starts the same way: the canvas docked in the middle, as Photoshop's, and its
   panels (layers, history, brushes) windows.
5. The music editor docks with it too, where FL Studio does (its Browser, the Playlist and the Mixer can dock
   in FL 21+), and a floating window could dock by being dragged onto a group rather than by its button.
