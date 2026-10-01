# The Playlist

How FL Studio's Playlist works, from the manual (`playlist.htm`, `playlist_patterns.htm`,
`playlist_audioclip.htm`, `playlist_automationclip.htm`, `menu_patterns.htm`, `toolbar_panels.htm`,
`songsettings_settings.htm`, `envsettings_audio.htm`, `basics_shortcuts.htm`) and Théo. See
[README.md](README.md) for the sources and for what holds everywhere (knobs, menus, windows, the left
button does and the right button undoes). Where neither the manual nor Théo says, it's marked
**(unverified)**.

The last sections are ours: [what we'll leave out](#what-well-leave-out),
[where Vaudio differs](#where-vaudio-differs), [what was decided](#decided-with-théo-2026-10-01) and
[how it will be built](#how-vaudio-will-build-it).

## What it is

![The Playlist, labelled](img/playlist_main.png)

The Playlist (F5) **arranges the song**. It's a window of **tracks** that **clips** are placed on. A clip
is one of three kinds:

| Clip | Holds | Looks like |
| --- | --- | --- |
| **Pattern clip** | A pattern: its notes for any of the channels (and its event automation) | A miniature of the pattern's notes, the pattern's name in its title bar |
| **Audio clip** | An audio file, played as it's placed | The file's waveform, its name in the title bar |
| **Automation clip** | A curve over time for one control (a knob, a fader, a plugin's parameter) | The curve |

When the playhead reaches a clip, FL does what the clip says: plays its notes, its audio, or moves its
control. The manual compares clips to notes in the Piano roll, and they're edited with the same tools.

The things that make it FL Studio:

- **Tracks aren't bound to anything.** Any clip goes on any track, and clips of every kind can share a
  track and even overlap (drawn see-through). A track has no instrument and no mixer track of its own.
- **Where a sound goes is decided by its channel**, not by the track it's on: a pattern clip's notes play
  on their channels, which play into their own mixer tracks. One pattern clip on one track can play every
  instrument of the rack.
- **Instances, not copies.** Every pattern clip of a pattern plays that same pattern: change the pattern
  and every clip of it changes. "Make unique" breaks one away (it clones the pattern).
- **Pattern mode and song mode** (the toolbar's PAT / SONG switch, L): PAT loops the current pattern
  (what Vaudio does today); SONG plays the Playlist from where play starts.
- **Track mode** (newer FL) can link a Playlist track to one instrument channel and one mixer track (an
  "Instrument track" or "Audio track"), for those who want a DAW's 1:1 layout. It's optional and off
  by default; the free model above is the FL way.

## Anatomy

- **Title bar**, left to right: the menu arrow; Snap (magnet); the tools (Draw, Paint, Delete, Mute,
  Slip, Slice, Select, Zoom, Playback); Play (plays the Playlist on its own); **"Playlist - Arrangement ›
  *clip source*"**: the arrangement's name (its menu: several arrangements of one song) and the **clip
  source**, the clip that Draw and Paint add (a menu of every pattern, audio and automation clip); then
  minimise, maximise, close.
- **Left**: the **Picker panel** (Alt+P), a list of every pattern, audio clip and automation clip of the
  project, with switches at its top to show each kind. Click one to make it the clip source, or drag it
  onto the tracks.
- **Clip focus** (above the track headers): three tabs, pattern, audio, automation. The focused kind is
  drawn on top of the others where they overlap and is the kind that's picked by a click. Each tab has its
  own options (audio: fades, stretch; pattern: clip colour from Note / Channel / Pattern). The **+** next
  to them adds an instrument or audio track (track mode).
- **The overview / scrollbar** along the top: a miniature of the whole song (FL's "Mini playlist
  preview") that scrolls the view; drag its ends to zoom.
- **The ruler** (the timeline, in bars): bar numbers, **time markers** under them ("Start", "Repeat",
  "Chorus"), the **play position marker** (a green triangle), and the **time selection** (red).
- **Track headers** down the left: each track's name ("Track 1"…), its colour as the header's background,
  a **mute light** at its bottom right (green when it plays), and a "…" grip. The divider under a header
  drags to change that track's height. ![Track headers and their menu](img/playlist_trackheaders.png)
- **The grid**: tracks across, time along the top. The background alternates by bar (FL's "Time segments:
  Bars"), with lines at bars, beats and the snap's divisions as you zoom in.
- **Clips**: a title bar (the clip menu's icon at its left, then the name) over the content. A clip's
  colour is its pattern's (or its channel's, or its notes', per the clip focus option).
- **Track height** control at the top right (all tracks), and a vertical scrollbar.
- There are **500 tracks**, all there from the start ("Track 1" to "Track 500"), empty until something's put
  on them. (unverified: the count; the manual only mentions "Insert one" and that the maximum exists.)

## Tools

One tool at a time, as in the Piano roll. Whatever the tool, **right-click deletes a clip** (and drags to
delete several), and **Ctrl selects** instead.

| Tool | Key | Left button | Right button | Modifiers |
| --- | --- | --- | --- | --- |
| **Draw** (pencil) | P | Click adds the clip source where it's clicked; keep holding to move it before letting go. On a clip: move it, or resize it by an edge | Delete; drag to delete several. Held on the background: slice (an option) | Shift: Paint. Ctrl: select. Alt: no snap |
| **Paint** (brush) | B | Click adds the clip source; drag paints copies of it one after another along the track | Delete; drag to delete several | Shift: copies the clip clicked. Ctrl: select. Alt: move a clip without snap |
| **Delete** | D | Click or drag to delete clips | | Shift: select (then Del) |
| **Mute** | T | Click or drag to mute clips (they stay, greyed, and don't play). Independent of the track's mute | Delete | Ctrl: select. Alt: move without snap |
| **Slip** | S | Drag a clip's content left or right inside the clip, its start and end staying where they are | | Shift+S: ripple edit (drag an edge: the content stays put at the other end) |
| **Slice** | C | Drag a line down through clips: each is cut where it crosses | | Shift: slice without dragging. Left-Shift: diagonal. Shift+Alt: no snap |
| **Select** | E | Click a clip, or drag a rectangle | | Shift: add to / take from the selection |
| **Zoom** | Z | Drag a rectangle to zoom to it | Toggle zoomed / not; its menu has the zoom presets | |
| **Playback** | Y | Click a clip to hear it from there; drag to scrub | | |

- **The clip source**: Draw and Paint add whatever's chosen as the clip source (the title bar's menu, the
  Picker panel, or a right-click on a clip focus tab). Clicking a clip with Draw also makes it the clip
  source, so the next click adds another of the same. (Théo)
- **Clicking a pattern clip makes its pattern the current one** (the rack and the Piano roll show it).
  (Théo)
- **Right-Shift+click** a clip slices it in any tool; Right-Shift+right-click slices and deletes the
  smaller part. **Insert** slices the clip under the pointer.
- **Double-click a pattern clip** opens it: in the Piano roll if it has notes, in the Channel rack if it's
  only steps (the "Edit patterns in: Automatic" default), scrolled to where it was clicked. **Alt**+double-
  click opens the other one. Double-click an audio clip: its channel's settings (Alt: the clip's own
  properties).
- **Double right-click** switches to the Mute tool.

## Clips: moving, resizing, copying

- **Move**: drag a clip (or any clip of the selection) left, right, and up and down between tracks. Snap
  applies to where its start lands. Alt while dragging: no snap.
- **Resize**: drag either edge of a clip, no key needed (Théo). (The manual has the left edge behind an
  option, "Allow resizing from the left", Ctrl+Alt+Home.) A resized or sliced clip is **a window onto its
  content**: what's outside it is still there, and dragging the edge out again brings it back.
- **Slip**: the Slip tool moves the content inside the window instead.
- **Clone**: Shift+drag a clip or the selection: the original stays, a copy moves (Shift+click a clip, in
  the shortcuts table).
- **Duplicate** (Ctrl+B): copies the selection (or every clip, if none is selected) straight after it.
  With a time selection, the copy goes one *time selection's length* later, and the time selection
  moves with it; the clips copied are still the selected ones. (Same as the Piano roll's Ctrl+B.)
- **Copy / paste**: Ctrl+C, Ctrl+V pastes at the left edge of the view (the first bar in view).
- **Shift+← / →** moves the selection by a snap unit; **Shift+↑ / ↓** moves it a track up or down (every
  clip, if none is selected).
- **Make unique** (the clip menu, or Shift+V+drag): the clip gets its own copy of its pattern (named
  "Pattern 1 #2"), so editing it changes only that clip.
- **Merge pattern clips** (Ctrl+G): the selected pattern clips become one clip of a new pattern holding
  all their notes.
- **Group** (Shift+G, Alt+G ungroups): grouped clips select and move together.
- **Chop** (the clip menu): cut a clip into bars or beats.
- **Quantize** (Ctrl+Q / Shift+Q): put the selected clips' starts on the snap's grid.
- **Shift+C**: select every clip of the same source.

### Pattern clips

- A pattern clip shows a **miniature of its pattern's notes** (every channel's, squeezed into the clip's
  height), and the pattern's name in its title bar. Its colour is the pattern's.
- **Its length** when it's added is the pattern's length (the Channel Rack's pattern length, or "Auto":
  to the end of the last bar with notes).
- **Lengthened past its pattern**, a clip shows more but **plays nothing there**: the pattern doesn't
  repeat (Théo).
- **Shortened or sliced**, a note that's cut by the clip's end stops there, and a note that starts before
  the clip's start (after a slice) plays from the clip's start: Project settings' **"Play truncated
  notes in clips"**, on in projects since FL 10.5. With it off, the second half of a sliced note is dropped.
- **When the pattern changes length**, clips that were as long as it follow it; a clip that's been resized
  keeps its length (Théo).
- **Split by channel** (the Patterns menu, also the Picker panel's pattern menu): makes one new pattern
  for each channel that has notes in the pattern, each named after its channel. This is what Théo means
  by "split by track": a whole beat built in one pattern, then pulled apart to arrange each part on its own
  track. **The pattern goes**: it's replaced by the new patterns, and each of its clips in the Playlist by
  the new patterns' clips, one per channel, on its track and the ones below (Théo). It's one undo step.

### Audio clips

![Audio clips](img/playlist_audio.png)

- **An audio clip is a channel**: dropping an audio file on the Playlist (from the Browser or the
  Finder) makes an **audio clip channel** in the Channel rack (in its own "Audio" group) and puts a
  clip of it where it's dropped. Every clip of that channel plays the same file. Like any channel, it plays
  into a mixer track (the rack's track selector, or its settings' TRACK).
- An audio clip channel is a cut-down sampler: its settings have only the sample tab (precomputed effects,
  time stretching) and the misc tab, and it isn't played from the step sequencer or the Piano roll (it can
  be, but isn't meant to be).
- **A clip shows its file's waveform**, from where the clip's window starts in the file.
- **Dropped on a track header**, it also names the track after the file. **Shift** while dropping several
  files puts them one after another on the track instead of stacked.
- **Each clip's own properties** (Alt+double-click: the Clip properties window): gain, pan, pitch
  (semitones and cents, its length kept), mute, reverse, and its start and length. Edits there make the
  clip a "variant" of its channel; the channel's settings change every clip of it.
  ![Clip properties](img/clip_properties.png)
- **Fades and gain on the clip** (the audio focus tab's "Show fades", Shift+F): a triangle at each top
  corner drags a fade in or out; a small circle bends its curve; a half-circle on the bottom edge is the
  clip's gain (+36 dB to silence). Overlapping clips **crossfade** automatically (a project setting, on).
  ![Clip fades and gain](img/playlist_audioclipenvelopes.png)
- **Slicing** can snap to the nearest zero crossing (an option) so cuts don't click.
- **Stretch** (Shift+M): dragging an edge time-stretches the clip instead of resizing its window; "Fit to
  tempo" and "Detect tempo" in its menu. Without stretching, an audio clip plays at its own speed whatever
  the tempo (a tempo change moves its end, not its sound).
- **7 / 8** pitch the selected audio clips a semitone down / up; **9** reverses them.
- "Make unique as sample" copies the file on disk too; "Extract stems", "Deverb", Edison and NewTone are
  FL's own tools.

### Automation clips

- A curve of points over time, with tension handles between them, for one control: made from a control's
  right-click menu ("Create automation clip"), which puts a clip on the Playlist covering the song (or the
  time selection).
- Its points are edited on the clip itself (right-click adds, drag moves; resizing is by its title bar).
- Vaudio's automation is step 4 of [../music-suite.md](../music-suite.md), after the playlist: it's only
  noted here so the playlist leaves room for it.

## The clip menu

![The clip menus](img/clips_menus.png)

The icon at the top left of each clip opens it:

- **Preview**: play the clip on its own.
- **Select source**: swap the clip for another source (Shift: keep its relative start and end).
- **Channel settings** (audio, automation); **Edit pattern** (pattern: the Piano roll, or the rack if
  it's empty).
- **Rename and recolor**, **Change color**.
- **Make unique**; **Select all similar clips**; **Delete**.
- **Chop** into bars, beats (audio: by detected beats, or regions).
- Audio only: Make unique as sample, Edit sample, Detect tempo, Fit to tempo, Automate volume / pan,
  Crossfade with.

## Tracks

- **Mute**: the light on the header (left-click). **Solo**: Ctrl+click or right-click it. Alt+click
  mutes a group of tracks. A track's mute silences every clip on it; a clip's own mute (the Mute tool)
  is separate.
- **Select**: a click on the header selects the track; Ctrl+↑ / ↓ moves the selection, Ctrl+Alt+↑ / ↓
  extends it.
- **Rename and colour**: the header's right-click menu (**Rename, color and icon…**, Change color, Change
  icon, Auto name: after its first pattern clip, Auto name clips). A click on the name renames it.
- **Height**: drag the divider under a header; Alt+click it resets. "Size" in the menu, "Lock to this
  size". The track height control (top right) scales every track.
- **Move**: Shift+mouse wheel over the headers reorders tracks; Move up / Move down in the menu.
- **Insert one / Delete**, **Clone** (with its clips).
- **Group with above track**: makes it a sub-track of the one above (folded under it, muted and soloed
  with it).
- **Lock to content**: the track only adds the clip it's locked to.
- **Merge pattern clips**: all its pattern clips into one.
- **Consolidate** (freeze): render the track's clips to one audio clip and mute them.
- **Mute all clips / Unmute all clips**.

## The time selection, play position and markers

- **Ctrl+drag along the ruler** selects a range of time across every track (red). The clips inside it are
  selected (the parts of them outside it are drawn red too, but don't play). **While there's a time
  selection, play loops it.** Shift+drag on the ruler copies and moves the selection.
- **A click on the ruler** moves the play position there (stopped or playing). **Home** goes back to the
  song's start. The green marker can be dragged.
- **Ctrl+Enter**: time-select around the selected clips. **Ctrl+← / →**: move the time selection by its own
  length.
- **Ctrl+Ins**: insert space the length of the time selection (everything after it moves later);
  **Ctrl+Alt+Ins**: the same, slicing what crosses its start. **Ctrl+Del**: delete what's in the time
  selection and close the gap.
- **A double-click on the ruler**, or Ctrl+click on the selection, clears it.
- **Time markers** (Alt+T): named labels on the ruler ("Verse", "Chorus"), dragged by their edge. A double-
  click on one selects up to the next. Their right-click menu gives them an action: Start, Loop (the song's
  repeat point), Marker loop, skip, pause, a time signature change, start / stop recording. Alt+/ and Alt+*
  jump between them.
- **The end of the song**: playing in song mode, the song goes on to the end of its last clip's bar and
  loops back to the start (Théo). A "Loop" marker sets where it goes back to.

## Snap and zoom

- **Snap** (the magnet): the same choices as the Piano roll's (Main, Line, Cell, none, fractions of a step
  and a beat, bar, events). **Line** snaps to the grid lines in view, so it gets finer as you zoom in.
  **Alt** bypasses it while held; **Backspace** toggles the global snap.
- **Zoom**: Ctrl+wheel (about the pointer), Page Up / Page Down, Shift+1…3 presets, **Shift+4 shows the
  whole song**, Shift+5 the time selection; the ends of the scrollbar; Ctrl+right-drag a rectangle;
  Ctrl+right-click toggles back. **Shift+0** centres on the play position.
- **Scroll**: the mouse wheel scrolls tracks up and down; middle-button drag (or Left-Shift+right-drag)
  pans both ways.
- **Vertical zoom**: the track height control; the dividers between headers for one track.

## The Picker panel

![The Picker panel](img/playlist_pickerpanel.png)

- Every pattern, audio clip and automation clip of the project, each with its colour and a miniature, with
  switches at the top for the kinds shown (right-click them: sort by name, colour, mixer track; show only
  unused).
- **Click** one: it becomes the clip source (Draw and Paint add it). **Drag** it onto a track. Alt+right-
  click (held) previews it.
- **Right-click**: the Patterns menu for that pattern (rename and colour, clone, delete, **split by
  channel**, transpose, render as audio clip); Shift+click renames; Shift+C finds its first clip in the
  Playlist.
- Dragging patterns up and down the list reorders them (and renumbers them).

## With the rest of FL

- **PAT / SONG** (L, or the toolbar's switch): in song mode, Play plays the Playlist from its play
  position; the toolbar's **song position** LCD and slider show where the song is. The Piano roll, while
  the song plays, shows the playhead where the song is in the pattern it's showing (unverified).
- **Space** plays and stops in both modes. Play while playing pauses; **Stop** returns to where play
  started.
- **F5** shows or hides the Playlist. It's usually maximised, the rack and the Piano roll floating over it.
- **Pattern clips and the pattern selector**: selecting a pattern in the toolbar's selector makes it the
  clip source. Making a new pattern (F4, "next empty") and painting it in is the usual way to start a
  section.
- **The Browser**: a file dragged onto the tracks makes an audio clip; onto a header, an audio clip and the
  track named after it.
- **The Channel rack**: a channel dropped on a track header links them (track mode). The rack's channels
  that appear in the selected pattern clip are highlighted (unverified).
- **The Channel rack's groups** (its title bar's filter menu): channels are in groups, and the rack shows
  one group or All. New channels go in **Unsorted**, the default, where the instruments and drums are;
  audio clips' channels go in an **Audio** group; **All** shows every channel (Théo). More groups can be
  made and channels moved between them.

## Keys

Tools: **P** draw, **B** paint, **D** delete, **T** mute, **S** slip, **C** slice, **E** select, **Z** zoom,
**Y** playback.

| Key | Does |
| --- | --- |
| F5 | Show / hide the Playlist |
| L | Pattern / song mode |
| Alt+P | The Picker panel |
| Ctrl+A / Ctrl+D | Select all / deselect |
| Shift+I | Invert the selection |
| Ctrl+C / Ctrl+X / Ctrl+V | Copy / cut / paste (at the left edge of the view) |
| Ctrl+B | Duplicate the selection to the right |
| Del | Delete the selection (all clips if none is selected) |
| Shift+← / → | Move the selection a snap unit |
| Shift+↑ / ↓ | Move the selection a track up / down |
| Ctrl+↑ / ↓, Ctrl+Alt+↑ / ↓ | Select the track above / below, extend the track selection |
| Ctrl+← / → | Move the time selection by its length |
| Ctrl+Enter | Time-select around the selected clips |
| Ctrl+Ins / Ctrl+Alt+Ins / Ctrl+Del | Insert space / slice and insert / delete space |
| Ctrl+G | Merge the selected pattern clips |
| Shift+G / Alt+G | Group / ungroup clips |
| Alt+M / Alt+Shift+M | Mute / unmute the selection |
| Ctrl+Q / Shift+Q | Quantize clip starts |
| Shift+C | Select every clip of the same source |
| Insert | Slice the clip under the pointer |
| 7 / 8 / 9 | Audio clips: a semitone down / up, reverse |
| Shift+M | Stretch mode (audio clips) |
| Home | Play position to the song's start |
| Alt+T | Add a time marker |
| Page Up / Page Down | Zoom in / out |
| Shift+1…3, Shift+4, Shift+5 | Zoom presets, the whole song, the time selection |
| Shift+0 | Centre on the play position |
| Alt (held) | Bypass snap |
| Backspace | Global snap on / off |
| Space | Play / stop |
| Esc | Close the window |

Mouse: right-click deletes; double right-click switches to Mute; Shift+drag clones; Right-Shift+click
slices; Alt+right-click auditions a clip; Shift+wheel over the headers reorders tracks; Shift+Alt+wheel
on a clip nudges it.

---

## What we'll leave out

From the first version (most of it for good):

- **Arrangements** (several arrangements of one song), **performance mode** and live marker jumps,
  **track mode** (instrument / audio tracks linked to channels and mixer tracks), **lock to content**,
  **consolidate / render as audio clip** (needs export, step 4), **merge pattern clips**, **clip
  groups**, the magic lasso, background pictures, icons, the View menu's styles.
- **Automation clips**: step 4, after the playlist. The clip kinds leave room for them.
- **Audio clips' time stretching, pitch and reverse, zero-crossing slicing, crossfades**: the clip plays
  its file at its own speed. Fades and gain on the clip can come soon after, if wanted.
- **Time markers and time signature changes**, the Zoom tool, Slip's ripple mode.

## Where Vaudio differs

Not built yet: this is what's planned for the first version (`docs/music-suite.md`, step 2). To be
rewritten as what's built, as the other docs are.

| What | FL Studio | Vaudio, first version |
| --- | --- | --- |
| Window | F5, floating or maximised | The same: F5 and a toolbar button, opening maximised as the Piano roll does |
| Tracks | 500 always there | As many as are in use plus a few empty ones below, growing as clips are put lower (FL's look: you never "add" a track). Name, colour, height, mute, solo |
| Clip kinds | Pattern, audio, automation | Pattern and audio; automation in step 4 |
| Tools | Draw, Paint, Delete, Mute, Slip, Slice, Select, Zoom, Playback | All but Zoom (as in our Piano roll), with the same keys and pointers |
| Clip source | Title bar menu, Picker panel, clip focus | The Picker panel and the title bar's menu |
| Picker panel | Patterns, audio and automation clips, sorting, groups | Patterns and audio clips; click to choose, drag onto the tracks; its pattern menu (rename, clone, delete, split by channel) |
| Audio clips | Audio clip channels in the rack | The same: a channel of a new kind, routed to a mixer track like any channel, streamed from disk by the engine |
| Song mode | PAT / SONG, L | The same, on the toolbar |
| Time selection, Ctrl+B, Ctrl+Ins / Del, Ctrl+Enter, Ctrl+← / → | Yes | Yes, as in our Piano roll |
| Look | FL's artwork | Its layout in our look (`docs/ui-redesign.md`), with colours of its own for each theme like the Piano roll's |

## Decided with Théo (2026-10-01)

1. **A pattern clip stretched past its pattern** shows more but plays nothing there: the pattern doesn't
   repeat.
2. **A pattern that changes length**: its full-length clips follow it; a resized clip keeps its length.
3. **Split by channel** removes the pattern and puts one pattern per channel (named after it) in its
   place, in the list and in each of its clips in the Playlist (one clip per channel on its track and
   the free ones below). One undo step.
4. **In song mode the song loops** to its start at the end of the last clip's bar.
5. **Clicking a clip with Draw** makes it the clip source, and a pattern clip's pattern the current one.
6. **Clips resize from either edge**, no key.
7. **PAT / SONG isn't saved**: a song with clips in its Playlist opens in song mode, otherwise pattern mode.
8. **Double-click a pattern clip**: the Piano roll if it has notes off the step grid, the rack if it's only
   steps.
9. **Audio clips are channels** in the rack, in an Audio group: the rack's group filter shows Unsorted (the
   default: every other channel), Audio, or All. In the rack they show a waveform where steps would be.
10. **The order of work**: the document, song mode in `compileSong`, the engine (audio clips streamed),
    the transport, the window, split by channel, the assistant, e2e. A commit after each step.

## How Vaudio will build it

What the research above and the code as it is today mean for building it.

### The document (`shared/music/types.ts`)

```ts
interface PlaylistTrack { id: string; name: string | null; color: string | null; height: number; muted: boolean }
interface PlaylistClip {
  id: number;            // small and unique in the list, as notes' ids: what's selected is a set of them
  track: string;         // a PlaylistTrack id
  start: number;         // ticks, song time
  length: number;        // ticks
  offset: number;        // ticks into its content where the clip's window starts (slip, slice, left resize)
  muted: boolean;
  kind: "pattern" | "audio";   // "automation" later
  ref: string;           // the pattern's id, or the audio clip channel's id
}
interface Playlist { tracks: PlaylistTrack[]; clips: PlaylistClip[] }   // clips sorted by start
```

- `MusicProject.playlist`, empty in a new song; `normalizeMusicProject` fills it in for old songs and
  drops clips whose pattern or channel is gone. Deleting a pattern or a channel removes its clips (in the
  same edit, one undo step).
- An audio clip channel is `Channel.kind: "audio"`: a sample and a mixer track, the sampler's level and
  pan; no envelope or step notes.
- Pure clip edits in `shared/music/playlist.ts` on a clip list, like `notes.ts` is for notes: add, move
  (time and track), resize, slip, slice, delete, mute, duplicate (Ctrl+B with the time selection), insert
  and delete space, quantize, make unique, split by channel. Each returns the same list when nothing
  changes. Tested, and with thousands of clips.

### Playing it (`shared/music/compile.ts`)

- Song mode makes the same `EngineSong` the engine already plays: its notes are the arrangement
  **flattened** into song ticks. Each pattern clip contributes its pattern's notes inside its window
  (`offset` to `offset + length`, nothing past the pattern's end), each note cut at the clip's end, and notes that
  started before the window's start played from it ("play truncated notes"). Swing as today, per pattern
  tick. Muted clips, muted tracks and soloed tracks decide what's left out.
- `loopTicks` is the song's length (to the end of the last clip's bar), or the time selection. The
  engine already loops whatever it's given, and plays notes by binary search, so a long song costs no
  more per block than a pattern does. The flattening runs on the server, where the song is compiled.
- **Audio clips** become a new list in `EngineSong`: `{ channel, tick, lengthTicks, offsetSeconds, file }`,
  and the engine plays each one from its file at the moment it's due, into its channel's mixer track
  (with its channel's gains, so the mixer, its meters and delay compensation all work as for a sampler).

### The engine (`engine/src/`)

- Audio clips can't be read whole into memory (a vocal take, a whole song): they're **streamed**, the way
  `FilePreview` streams the Browser's preview, with a reader thread decoding into a lock-free ring per clip.
- The difference from the preview: a clip must **start on its sample**, so its stream is opened and
  filled *before* it's due. The message thread prepares the streams of clips about to play (a second or
  two ahead of the playhead, and wherever play starts or the loop goes back to), and the audio thread
  only takes from rings that are ready. Starting play in the middle of a clip seeks into its file.
- Tested offline as everything else is (`sequencer.integration.test.ts`): a clip starts on its sample,
  starts mid-way when play starts inside it, loops, and goes through its mixer track.
- The stand-in engine (`fake-engine.mjs`) accepts the new fields.

### The transport and the toolbar

- PAT / SONG (L) on the toolbar. In song mode, `SetSongRequest` asks for the song (`mode: "song"`) and
  the loop is the Playlist's time selection; the position LCD and slider follow the song; the Playlist's
  ruler sets where play starts (as the Piano roll's does in pattern mode).
- The Piano roll, the rack and the Playlist each show the playhead in their own time: the Playlist in
  song ticks, the Piano roll in the pattern of the clip being played (unverified for FL; nice to have).

### The window (`src/suites/music/playlist/`)

Built like the Piano roll (`src/suites/music/piano/`), which already solved the same problems:

- **One canvas** for the clips, drawn once a frame when something changed, only what's in view
  (`visibleRange`), in colours of its own per theme (`readPalette`). Pattern clips draw a miniature of
  their notes (cached per pattern and size, since a pattern is drawn in every one of its clips).
  Audio clips draw their waveform (the Browser's waveform peaks, `waveform.ts`).
- **A drag doesn't edit the song while it lasts**: a `PlaylistDrag` in the Playlist's store, which the
  canvas draws the clips through (`applyDrag`, the same function that commits it), committed as one edit
  when it's let go.
- Its maths in `geometry.ts`, its mouse in `pointer.ts`, its keys in `keys.ts`, its commands in
  `actions.ts`, each tested; the Picker panel and the track headers as plain React beside the canvas.
- Drops from the Browser and the Finder go through `browser/drops.ts`, as every drop target does.

### The assistant

Tools at parity: read the arrangement (`get_playlist`; `get_song` sums it up), place, move, resize, mute
and remove clips, make one unique, split a pattern by channel, name, colour and mute tracks, add an audio
clip from a file, switch to song mode and play from a bar. Edits as pure `(song, input) => { song, text }`
in `tool-edits.ts`, tested.

### Performance

The song is sent to the engine on every change today. With a playlist, the tab still sends the document
(small: clips are a few numbers each) and the server flattens it; a song of 500 clips of 100 notes is
50 000 engine notes, which the compile, the JSON and the engine's parse must take in a few
milliseconds. Measure it, and if it's too slow, send only what changed later. In the window, as in the
Piano roll: nothing per clip in React, a frame only when something changed.
