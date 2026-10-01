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
