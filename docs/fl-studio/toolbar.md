# The toolbar

FL Studio's main toolbar, the strip across the top of the window, from Théo's own screen (FL Studio 2025,
below) and the manual (`toolbar_panels.htm`). See [README.md](README.md) for the sources.

![Théo's toolbar](img/user/toolbar.jpg)

## Anatomy

Two rows, left to right. Each group is a panel of its own (they can be rearranged; this is the default):

| Group | Top row | Bottom row |
| --- | --- | --- |
| Menus and hint | The menus: File, Edit, Add, Patterns, View, Options, Tools, Help | The **hint bar**: what's under the pointer (here the user's name, the clock, and "Track 7", the playlist track under the pointer) |
| Transport | **PAT / SONG** switch; **Play** (Pause while playing); **Stop**; **Record**; the **tempo** LCD ("171.000": drag up and down, right-click for its menu and presets) | Window buttons: **Playlist** (F5), **Channel rack** (F6), **Piano roll** (F7), **Mixer** (F9), **Browser** (Alt+F8) |
| Time | The **song position** LCD, big ("0:00:00", M:S:CS; a click switches to B:S:T, bars:steps:ticks) | The global **snap** ("(none)") |
| Recording | **Typing keyboard to piano** · **Countdown** before recording (3.2.1) · **Metronome** | The **pattern selector**: an arrow for its menu, the name (click: the list of patterns), and **+** for a new one |
| Position | The hint panel and the song's **waveform/oscilloscope** | The **song position slider**: where the song (or pattern) is; drag it to move there |
| Monitor | **CPU** and **memory** use, polyphony, and the **output meter** (peak level, left and right) | |

- **Play** plays the pattern (PAT) or the song (SONG); pressed while playing it pauses. **Stop** stops and
  goes back to where play started. **Space** is play/stop.
- **Stop pressed again** while stopped silences what's still ringing: delays, reverbs and every other
  effect's tail, which a first press leaves to ring out (FL's users: "press stop a second time, all reverbs,
  delays and other plugins are completely muted"). Audio settings' **Reset plugins on transport** makes
  every stop do it.
- The tempo and position LCDs look like the rest of FL's number displays: dark, recessed, with a small
  label (BPM, M:S:CS).
- Everything is small (a row is about 24 px), and the groups are separated by thin grooves.

## Where Vaudio differs today

Vaudio shows only what it can do. What's there follows FL's layout (`src/suites/music/toolbar.tsx`):

| FL Studio | Vaudio |
| --- | --- |
| Layout: groups of two rows each | Ours (Théo): the title and hint at the left; in the middle two rows, the transport, tempo, position, the recording switches and monitors above, the window buttons, pattern selector and a wide song position slider below. As dense as FL's: every button in both rows is one size (30 px), the LCDs as tall |
| Menus | None yet. The project's name (click to rename) is in their place, as the title |
| Hint bar | Yes: the name of what's under the pointer (its title) |
| PAT / SONG | Yes (L): two lights, the lit one is what plays (Théo's colours: PAT in the accent, SONG in FL's orange; the lit play and metronome icons are the accent too, without FL's glow). Not saved: a song with clips on its playlist opens in song mode |
| Play / Pause, Stop | Yes, joined as FL's: playing, Play shows Pause (lit); pressed it stops where it is and the next play goes on from there. Stop (and a jump, or the other mode) forgets where it paused. Space plays and stops. Stop pressed while stopped resets every plugin and our effects (`stop { reset }`, `Engine::silence`: the device let go of meanwhile, as for an export), and Settings' "Reset plugins on stop" makes every stop do it |
| Record, countdown, typing keyboard | Record in the transport panel; the typing keyboard and the count-in (3·2·1) after the position, as FL's, both kept in the browser across sessions |
| Tempo LCD | Yes, FL's look ("140.000", the decimals smaller, light digits on a dark display in every theme): drag it up and down (the pointer is locked, so it goes on past the screen's edge), or click it to type. Its menu has Tap tempo… (tap along to a song; any key taps too), Make it the default (new songs start at it; 140 BPM until it's set, kept in the browser) and Reset the default; no presets yet |
| Position LCD | Yes (where the pattern or the song is, where it paused, or where play starts), in B:S:T or M:S:CS: a click switches (kept in the browser). Its last part is drawn smaller, as FL's |
| Main volume knob | Yes, beside the position: everything the song puts out, after the master track (the song's, `settings.volume`; 78% leaves it as it is) |
| Window buttons | Playlist (F5), Piano roll (F7), Channel rack (F6), Mixer (F9), Browser (Alt+F8), the transport's buttons' size and face, lit while their window is open: a press opens the window or brings it forward (the keys toggle). Ours (Théo): Alt+1…5 toggle them too, in the F keys' order (Playlist, Channel rack, Piano roll, Mixer, Browser), since a Mac's F keys need Fn |
| Snap | The Piano roll has its own; no global snap yet |
| Metronome | Yes, with the recording switches after the position, as FL's. Its right-click menu picks its sound (Beep, Tick, Tap, Hi-hat, Cowbell, made by the engine; heard once as it's chosen; kept in the browser): FL has one sound you can replace with a sample |
| Pattern selector with + | Yes: the arrow opens the list (rename, clone, delete); the name is scrolled or dragged up and down through the patterns, and past the last to the next one, empty, which joins the song only once something's put in it (Théo); + asks for a name and shows the new pattern |
| Song position slider | Yes, along the pattern (or the song, in song mode): drag it to move where play is |
| CPU, output meter, oscilloscope | The output's level over the last few seconds (mirrored, like a waveform's outline) beside the time, and the engine's load now and over the last half minute, (the audio settings are in Settings, the gear at the toolbar's right end). Not a true oscilloscope: the engine sends levels, not samples |
| — | Ours: undo and redo, the theme, Settle and the assistant, at the right end |
