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

## The keyboard

A plugin window with the focus doesn't stop FL's shortcuts working: **Space still plays and stops**
(Théo). How keys are shared is the **typing keyboard priority** button:

- Off (the default): "FL Studio uses keyboard shortcuts first", and the plugin gets the rest.
- On: "The plugin uses keyboard shortcuts before FL Studio. Any unused shortcuts are passed onto FL
  Studio."
- Wrapper settings also have "Keep focus" ("Prevent the plugin from stealing keyboard input"),
  "Allow FL Studio to process keyboard presses when the keyboard focus option is on" and "Allow FL
  Studio to undo when Ctrl+Z is pressed".

## Where Vaudio differs today

A plugin runs in the audio engine, a program of its own (so a plugin that crashes takes the engine
down, not the app), and a window can't be put inside another program's window on a Mac. So the
plugin's window is the engine's, made to act like part of the app (`engine/src/EditorWindow.h`,
`PluginHost::setHost`):

| FL Studio | Vaudio |
| --- | --- |
| Inside FL's window | A window of its own that floats above the app's window while the app (or the plugin) is in use, hides when you switch to another app, and comes back with it. In the desktop app it's also hidden while the app's window is minimised or hidden, and moves along when that window moves. In a browser tab (`pnpm dev`) it's an ordinary window |
| FL's title bar | Ours, in the studio theme's dark colours: "Serum 2 (Chorus)" and a close button. No plugin menu, presets, keyboard priority or wrapper settings yet |
| FL's shortcuts first (typing keyboard priority off) | The plugin first, then ours: what the plugin doesn't use (Space, F6, F7, ⌘Z, ⌘⇧Z) is sent to the app (FL's priority *on*). Taking keys before the plugin needs each system's own code, which the engine avoids |
| Detached | Not needed: it's always a window of its own |
