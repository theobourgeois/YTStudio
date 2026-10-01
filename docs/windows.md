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
- A window that `keepsKeys` (Settings) is like a dialog to the keyboard: what's pressed in it is its own,
  and the editors' shortcuts check `keptByWindow` and leave it alone. It's not modal: the app under it can
  still be clicked, and a song keeps playing.
- Its look is the theme's: `floating`, a title bar a step darker than its body, small corners.

## How it's built

- `geometry.ts`: the maths (sticking, edge snaps, resizing), pure and tested.
- `store.ts`: `createWindows(order)`, a store per desktop: where each window is (`places`), how they're
  stacked (`order`), the corner and snap state. Which windows are *open* belongs to their owner (the music
  editor's `ui.ts`, `useSettings`); `focus` brings one to the front when it opens.
- `floating-window.tsx`: `FloatingWindow` and `Desktop` (which hands its store to its windows), and
  `centredOnDesktop` for small windows that open in the middle.
- A suite wraps them with its own ids (`MusicWindow`, `MusicDesktop`, `useMusicWindows`), so its window
  ids are checked by TypeScript.
- **The app's desktop** (`stores/app-windows.ts`, drawn by `App.tsx`) covers the whole app, above every
  suite and below menus and dialogs. Only its windows take the pointer. Settings is on it.
- In the desktop app, a window is never part of the title bar's drag region (`index.css`), even over it.

## Where it goes next

1. **The video editor's dialogs become windows**: export, Auto captions, the video's settings, Save to
   Library. Its main layout (left panel, Program monitor, timeline) stays docked, as Premiere's does:
   those are always on screen and the timeline wants the full width.
2. Things better seen beside the edit become windows too: a source monitor, the graph editor, a mixer.
3. **The image editor** starts the same way: the canvas docked in the middle, as Photoshop's, and its
   panels (layers, history, brushes) windows.
4. Later, windows that **dock**: dragged into a region of the layout and out again, so any suite can
   start docked and float what it likes (FL Studio's newer versions and Premiere's panels both do this).
