# The plugin window

The window a plugin's own interface is shown in (FL calls it the **plugin wrapper**), from the manual
(`plugins/wrapper.htm`) and Théo. See [README.md](README.md) for the sources.

## What it is

- It's a window of FL's desktop like any other (the channel rack, the piano roll): inside FL's main
  window, above the playlist, moved by its title bar. It isn't a window of the operating system, so it
  never goes behind FL, and it goes with FL when FL is hidden, minimised or moved (Théo).
- Its plugin menu has **Detached** (under Misc): "Detaches the Plugin from the FL Studio desktop so it
  can be moved to a monitor that does not have the FL Desktop stretched across it". The manual warns
  that a detached plugin is then treated as a separate application by Windows.

## The title bar

A slim strip in FL's own style, above the plugin's interface, left to right:

1. The **plugin menu** (presets, and the plugin's own commands).
2. The **preset browser**: arrows to step through presets (right-click: the preset menu). The title
   shows the plugin and its channel's name, "Serum (Chorus)", or the preset's name when "Display
   preset name in preset selector" is on.
3. **Typing keyboard priority** (see below).
4. **Wrapper settings** and **Plugin interface**: switch between FL's settings for the plugin and its own
   interface.
5. **Minimise** and **Close**.

## Presets

From the manual (`plugins/wrapper.htm`):

- The **preset browser arrows** "step through presets"; a right-click opens the preset menu. The list
  is the plugin's own programs and the FL presets (`.fst` files) saved for it.
- The plugin menu's **Save preset as** saves "the current preset as a single preset file in the
  Browser", and **Browse presets** opens them there. Also Randomize, Hybridize (between the previous and
  next preset), and a spare state (Store in spare state, Flip with spare state).

## The channel's settings

A plugin channel's window has FL's channel settings around the plugin (the wrapper's tabs): the same
volume, pan, pitch and mixer track a sampler's has, and the plugin's own interface. **PITCH** bends the
plugin's notes within a range (its pitch bend), which should match the plugin's own range.

## The keyboard

A plugin window with the focus doesn't stop FL's shortcuts working: **Space still plays and stops**
(Théo). How keys are shared is the **typing keyboard priority** button:

- Off (the default): "FL Studio uses keyboard shortcuts first", and the plugin gets the rest.
- On: "The plugin uses keyboard shortcuts before FL Studio. Any unused shortcuts are passed onto FL
  Studio."
- Wrapper settings also have "Keep focus" ("Prevent the plugin from stealing keyboard input"),
  "Allow FL Studio to process keyboard presses when the keyboard focus option is on" and "Allow FL
  Studio to undo when Ctrl+Z is pressed".

## Where YTStudio differs today

A plugin runs in the audio engine, and in the music app the engine is the app (`docs/claude/music-shell.md`): the
page is in the engine's own window and the plugin's window is another of its windows, made to act like part of the
app (`engine/src/EditorWindow.h`, `EditorWindow::setShellWindow`). The app's own windows (the rack, the Piano roll,
the Playlist, the mixer...) are boxes in the page for now (`docs/windows.md`; on Windows they become windows owned by
the app's window, as the plugins' are):

| FL Studio | YTStudio |
| --- | --- |
| Inside FL's window, above the playlist, below whatever was used since | A window of its own over the app's, never behind it: a child window of the app's on a Mac, an owned one on Windows. It opens centred over the app's window, moves along with it and is hidden while it's minimised. The app's windows (boxes in the page) can't come in front of it yet. Outside the music app (the music suite in YTStudio's Electron window, or a browser tab with `pnpm dev`) it's an ordinary window of the engine's |
| On Windows: never behind FL, minimised with it, no taskbar button of its own | The same in the music app on Windows: owned by its window (`setWindowOwner`, `engine/src/MacWindow.cpp`), always above it, never above another program, with no taskbar button or Alt+Tab entry (a tool window), and a plugin's window never closes because the app was clicked. Once the editor's windows are owned windows too, a click brings any of them in front of a plugin and the plugin back in front of them |
| FL's title bar | Ours, in the studio theme's dark colours: "Serum 2 (Chorus)", the preset browser (arrows and the preset's name: the plugin's programs if it has several, else the user's presets), Automate "…" once a parameter is touched, the wrapper button (the channel's settings, in the app) and a close button. No plugin menu or keyboard priority |
| The wrapper's tabs inside the plugin's window | The channel's settings are an app window (Channel settings… on the channel's menu, or the wrapper button): ON, PAN, VOL, PITCH, TRACK over the plugin (shown or hidden from there) and its presets |
| Presets: the plugin's programs and FL's `.fst` files, in the Browser | Its programs (when it has more than one: most VST3s keep theirs in their own window) and the user's presets: its whole state saved under a name in the engine's data folder (`presets/<format>/<plugin>/<name>.preset`), the same in every song, listed in the channel's settings, loaded, deleted. Not in the Browser |
| Randomize, Hybridize, spare state | Not yet |
| PITCH bends within a range | Moves the keys it's sent by whole semitones (ours): the same whatever the plugin's bend range |
| FL's shortcuts first (typing keyboard priority off) | On Windows, FL's: the engine hooks its message thread's keyboard (`hookThreadKeys`), so Space, the F keys, Alt+1…5, Ctrl+T, Ctrl+R and, while the typing keyboard is on, its note keys are the app's even while the plugin holds the focus (`EditorWindow::takeFirst`); Ctrl+Z stays the plugin's own undo. On a Mac, the plugin first, then ours: what the plugin doesn't use (Space, F6, F7, ⌘Z, ⌘⇧Z) is sent to the app (FL's priority *on*) |
| Detached | Not needed: it's always a window of its own |
