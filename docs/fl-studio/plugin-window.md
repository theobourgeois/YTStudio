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

## Where Vaudio differs today

A plugin runs in the audio engine, a program of its own (so a plugin that crashes takes the engine
down, not the app), and a window can't be put inside another program's window on a Mac. So the
plugin's window is the engine's, made to act like part of the app (`engine/src/EditorWindow.h`,
`PluginHost::setHost`):

| FL Studio | Vaudio |
| --- | --- |
| Inside FL's window | A window of its own that floats above the app's window while the app (or the plugin) is in use, hides when you switch to another app, and comes back with it. In the desktop app it's also hidden while the app's window is minimised or hidden, and moves along when that window moves. In a browser tab (`pnpm dev`) it's an ordinary window |
| FL's title bar | Ours, in the studio theme's dark colours: "Serum 2 (Chorus)", the preset browser (arrows and the preset's name: the plugin's programs if it has several, else the user's presets), Automate "…" once a parameter is touched, the wrapper button (the channel's settings, in the app) and a close button. No plugin menu or keyboard priority |
| The wrapper's tabs inside the plugin's window | The channel's settings are an app window (Channel settings… on the channel's menu, or the wrapper button): ON, PAN, VOL, PITCH, TRACK over the plugin (shown or hidden from there) and its presets |
| Presets: the plugin's programs and FL's `.fst` files, in the Browser | Its programs (when it has more than one: most VST3s keep theirs in their own window) and the user's presets: its whole state saved under a name in the engine's data folder (`presets/<format>/<plugin>/<name>.preset`), the same in every song, listed in the channel's settings, loaded, deleted. Not in the Browser |
| Randomize, Hybridize, spare state | Not yet |
| PITCH bends within a range | Moves the keys it's sent by whole semitones (ours): the same whatever the plugin's bend range |
| FL's shortcuts first (typing keyboard priority off) | The plugin first, then ours: what the plugin doesn't use (Space, F6, F7, ⌘Z, ⌘⇧Z) is sent to the app (FL's priority *on*). Taking keys before the plugin needs each system's own code, which the engine avoids |
| Detached | Not needed: it's always a window of its own |
