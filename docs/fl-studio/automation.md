# Automation

How FL Studio automates a control over the song, from the manual (`playlist_automationclip.htm`, with bits of
`playlist`, `basics_interface` and `plugins/wrapper`) and Théo. See [README.md](README.md) for the sources.
The last sections are ours: [what's decided](#decided-with-théo-2026-10-01), [where Vaudio
differs](#where-vaudio-differs) and [how it's built](#how-its-built).

## What it is

- An **automation clip** is a curve over time for **one control**: a knob, a fader, a send, an effect's mix,
  or a plugin's own parameter. It's a clip on the Playlist, beside pattern and audio clips, on any track.
- The curve is **points** joined by **segments**: each segment has a **curve type** (how it gets from one
  point to the next) and a **tension** (how much it bends), set with a handle half-way along it.
- Every clip of one automation clip shares its curve, as pattern clips share their pattern. **Make unique**
  gives one clip a copy of its own.
- A point's value is a fraction (0..1) of the control's range. The automation clip's **Min / Max** knobs
  squeeze that range (they restrict the values, not the picture).

## Making one

1. **A control's right-click menu → Create automation clip** (FL's own controls: channel volume and pan, the
   mixer's faders, pans and sends, effect slots' mixes, the main volume...).
2. **A plugin's parameter**, two ways:
   - **Last tweaked**: move the parameter in the plugin's window, then *Tools → Last tweaked → Create
     automation clip*.
   - **Browser → Current project → the plugin → the parameter**, right-click → *Create automation clip*.
3. **Add → Automation from last tweaked parameter**.
4. The Event editor's *Edit → Turn into automation clip*; an audio clip's menu, *Automate → Volume / Panning*.

With a **time selection** on the Playlist, the clip covers it; otherwise it covers **the whole song**. The
new clip starts flat **at the control's current value**, and that value becomes the control's
**initialised value** (below).

## Editing the curve (on the clip, in the Playlist)

| Mouse | What |
| --- | --- |
| Right-click (and drag) on the curve | Add a point there (and drag it) |
| Left-drag a point | Move it (it can't pass its neighbours) |
| Shift+drag | Only sideways (its value stays) |
| Ctrl+drag | Only up and down (its time stays) |
| Alt+drag | Without snapping |
| Shift+right-click | Add a point on the curve without changing its value |
| Right-click a point | Its menu: Delete, the curve types, Type in value… |
| Right Alt+click a point | Delete it |
| Left-drag a tension handle (the dot half-way along a segment) | Bend the segment; Ctrl for fine changes |
| Right-click a tension handle | Reset its tension |

The **curve types**, chosen on the point at a segment's right end:

| Type | What the segment does |
| --- | --- |
| Single curve | The default: straight, or bent one way by the tension |
| Double curve | An S: bent one way to its middle, the other way after (scratching) |
| Alt single curve | An asymmetrical S |
| Alt double curve | Linear, or accelerating / decelerating, the other way round from Double |
| Hold | Stays at the first point's value until the next point, then jumps |
| Stairs | Steps from one value to the next; the tension sets how many (gated, glitchy effects) |
| Smooth stairs | Steps that glide into each other (pitch, granular effects) |
| Pulse | A square wave between the two values; the tension sets its rate |
| Wave | A sine between the two values; the tension sets its rate |
| Half sine | One half cycle of a sine (starts and stops, scratches) |
| Smooth | An S joining the two points smoothly |

The clip's **Step** mode (draw a point every step, freehand) and **Slide** mode (moving a point moves every
point after it) are tools in its editor.

## The automation clip's settings

Double-clicking the clip (or its menu's *Channel settings*) opens its window:

- **Min / Max**: the range the curve covers.
- **Time** (a speed, and a multiplier beside it).
- **LFO**: turned on, it adds (or with **Multiply**, multiplies) a low-frequency oscillator to the curve,
  without erasing the points: **SPD** its rate, **TENS** its shape (tension), **SKEW** (with a triangle,
  saws), **PW** pulse width, **LVL** its amount (the middle is off, left inverts). Multiply suits a one-sided
  control (volume); adding suits a two-sided one (pan).
- **Tools** (the window's menu): Copy / Paste state, **Flip vertically**, **Scale levels**, **Normalize
  levels**, **Decimate points**, **Filter**, **Smooth up**, Create sequence, Analyze audio file.
- **Target links**: the controls it drives (FL lets one clip drive several), added, removed or located.
  *Convert to events* turns it into pattern events.

## What a control does while it's automated

The manual doesn't say. What FL Studio does, from Théo and from using it:

- Playing the song, the control **follows the curve** (the knob turns on its own).
- **Initialised value**: making a clip remembers the control's value then, which it goes back to at the
  song's start, before any clip (*Init song with this position* changes it; *Browser → Current project →
  Initialized controls* lists them). After a clip ends, the control **holds the last value** it was given.
- Moving an automated control by hand while it plays: it changes, and the curve takes it back at its next
  change. Stopped, it stays where the song left it.
- Automation clips play with the Playlist (song mode).

## Decided with Théo (2026-10-01)

- **Everything in one pass**, as the Playlist was: clips, the curve editing, every curve type, the
  settings window with Min / Max, the LFO and the Tools, plugin parameters.
- **The curve is edited FL's way**, on the clip in the Playlist.
- **Automation only plays in song mode.** In pattern mode every control is its own value.
- **Shared curves**: a clip's copies share it; Make unique splits one off.
- **No tempo automation** in this pass: it changes how ticks become seconds everywhere (audio clips, the
  export, the position display). It gets a pass of its own. (Built on 2026-10-02: see below.)
- **Not built**: Analyze audio file, the Time knob, Create sequence, Filter, Target links to several
  controls, Convert to events. (The Step and Slide modes and channel pitch came on 2026-10-02.)
- **What an automated control does** (the manual doesn't say; Théo asked for it to be predictable and to
  make sense):
  - A control's **own value** is what the document says (the knob's value): it's what plays in pattern
    mode and, in song mode, **before the first clip** (FL's initialised value, without a separate one to
    keep track of).
  - In song mode, where a clip is, the control is the clip's curve; **after a clip, it holds the clip's
    last value** until the next clip. Where clips of one control overlap, the one that started latest
    wins (on the same tick, the lower track). Muted clips, and clips on muted tracks, count for nothing.
  - So the value at any tick follows from the song alone: playing from bar 40 sounds exactly like playing
    through to it.
  - In song mode, an automated knob **shows the curve's value** where the song is, playing or stopped, and
    a small mark says it's automated.
  - **While a control is held, the hand wins**: dragging an automated knob changes its own value (an undo
    step, as ever) and you hear it; let go, the curve takes over again. In a plugin's window, the same:
    while you hold one of its knobs, the curve leaves it alone.
  - A plugin's own value is whatever it is when play starts; automation moves it while the song plays,
    and stopping puts it back, so what's saved and what plays in pattern mode is never an automated
    value.
- **Plugin parameters, better than Last tweaked** (Théo: "there's got to be a better way"): touching a
  parameter in a plugin's window shows **Automate "Cutoff"** in that window's title bar: one click makes
  the clip. The Playlist's Picker has an **Automate…** button, a searchable list of every control the song
  has (each plugin's parameters with them), the last one touched at the top.

## Where Vaudio differs

| What | FL Studio | Vaudio |
| --- | --- | --- |
| Where automation clips live | Channels in the Channel Rack | A list of the song's own (`MusicProject.automations`), shown in the Picker's automation tab; not in the rack |
| Pattern mode | (unverified) | Automation never plays in pattern mode (Théo) |
| A held control | (unverified) | The hand wins while it's held, the curve takes over when it's let go |
| Initialised values | A separate value per control, set when a clip is made, *Init song with this position* | The control's own value is the initialised value |
| Plugin parameters | Tools → Last tweaked, the Browser's Current project | **Automate "…"** in the plugin window's title bar (the parameter last touched there), and the Picker's **Automate…** window: every control of the song, each plugin's parameters with them, searchable |
| What can be automated | Nearly every control | Channels' volume, pan and pitch, mixer tracks' fader, pan and stereo separation, sends, effects' mixes, the main volume, plugins' parameters |
| Deleting a point | Right Alt+click | Alt+click (a Mac has no right Alt to tell apart), or the point's menu |
| The curve types | Eleven | The same eleven; how Alt single / Alt double, Half sine and Smooth stairs bend is ours (unverified against FL) |
| Tools | Copy / Paste state, Flip, Scale levels (a dialog), Normalize, Decimate, Filter, Smooth up, Create sequence, Analyze audio file | Flip vertically, Normalize levels, Scale levels up (×1.25) and down (×0.8), Decimate points, Smooth |
| LFO | SPD, TENS, SKEW, PW, LVL, Multiply | SPD (cycles a bar), TENS, SKEW, LVL, Multiply; no PW |
| One clip, several controls | Target links | One control per automation clip |
| Step and Slide modes | Yes | The same, as two toggles in the Playlist's toolbar (2026-10-02). **Step**: a left drag on a curve paints held steps, a cell of the snap's grid each (Alt: a step's), at the pointer's height, cells skipped by a fast drag filled in between; the curve keeps its shape before and after them. **Slide**: a point dragged takes every later point with it (none passes the one before; the last stays inside the curve) |
| Filter, Create sequence, Analyze audio file, Time, Convert to events | Yes | Not yet |
| Tempo | Automatable | The same (2026-10-02): the tempo LCD's menu makes a tempo clip (or Automate…, or the assistant's `add_automation`); in song mode the LCD shows the curve's tempo where the song is, and what it edits is the song's own (pattern mode's, and the song's before any tempo clip). A new clip's Min / Max are FL's 60 to 180 BPM, widened to take in the song's tempo; the control's whole range is 20 to 999. Notes, automation and the metronome follow it to the sample. An audio clip starts where its tick falls and plays its file in real time from there (FL's: a tempo change moves its end, not its sound), so its length on the Playlist is at the song's own tempo. Not followed yet: the count-in (the song's own tempo), Gross Beat's sync and samplers' tempo-synced LFOs (the song's own tempo, as the engine's), a MIDI export (one tempo, the notes where they're heard) |
| Channel pitch | Automatable | The same (2026-10-02), ±24 semitones as its knob: a sampler's notes bend as they sound (set every 256 samples, the lanes' grid); a plugin channel's notes move by whole semitones, by what the pitch is where each starts (ours: FL bends within the plugin's range). An audio clip's channel has none to automate (its clips' length follows its pitch). Other channel controls (filter, swing mix...) aren't automatable yet |
| An audio clip's Automate | Volume, Panning | The same: an automation clip of its channel's volume or pan, over the clip |
| Precision | Per buffer (FL's "smooth" options) | Slices of 256 samples counted from where play started, the same live and exported: gains glide along each slice, an effect's mix and a plugin's parameter are set at its start |
| Plugin delay | "Compensate automations" | Automation is applied as the song plays, not shifted for a plugin's delay |

## How it's built

- **The document** (`shared/music/types.ts`): `MusicProject.automations` holds each automation clip's
  source (`Automation`: its target, points, length, Min / Max, LFO, name, colour); a playlist clip of
  `kind: "automation"` refers to one by id, as a pattern clip does to its pattern (it follows the curve's
  length until it's resized). A point is `{ tick, value, tension, curve }`: the curve and tension are the
  segment arriving at it. `normalizeMusicProject` keeps an automation clip whose control has gone (a
  deleted channel): it drives nothing, and undoing the deletion brings it back to life.
- **The maths** (`shared/music/automation.ts`, pure and tested): each curve type (`curveAt`), the LFO
  (`lfoAt`), a clip's value at a tick of its curve (`automationValue`), a control's value at any tick of
  the song (`controlAt`, over `automationIndex`: the rules above); the controls (`controlOf`: names, own
  values, a fraction to the control's units); the edits (points, tension, curve, the Tools); making a clip
  for a control (`createAutomation`).
- **Compiling** (`compile.ts`): in song mode, each engine target any clip drives becomes a lane in the
  engine's own units: a channel's two gains (its volume and pan together), a sampler's pitch (a plugin
  channel's moves its notes' keys instead, `transposePlugins`), a mixer track's gain matrix
  (fader, pan, stereo separation, and the main volume on the master), a send's gain, an effect's mix, a
  plugin parameter's 0..1 (-1 where it keeps its own value). Sampled from `controlAt` every 8 ticks and
  closer where a straight line would be more than a thousandth off (checked in quarters, as an S crosses
  its line in the middle), two points at a tick for a jump, then thinned. Controls held by the hand are left
  out (`SetSongRequest.held`).
- **The engine** (`Sequencer`): while a song with lanes plays, blocks are cut into slices of 256 samples
  counted from where play started (`sliceClock`), and each slice's ticks are worked out from that count,
  not the running position, so any block size (the device's, the export's 2048) makes the same sound
  (tested: blocks of 300 against 512, and the export against playback). A slice across the loop's end
  holds the song's last values to it. Gains glide along the slice's straight line; an effect's mix and a
  plugin's parameter are set at its start (`AudioProcessorParameter::setValue`, the hosts' automation
  path). A plugin's own value is taken when play starts (or carried from the last song) and given back
  when it stops, a lane goes, or the export ends. A song arriving mid-play re-anchors the slices where play
  is. Parameters are found by the id the plugin gives them (`parameterId`), their index as a hint.
- **Tempo** (`shared/music/tempo.ts`): the engine keeps one tempo, the song's own. In song mode with a
  tempo clip, `tempoMap` draws the tempo over the song as straight lines (within 0.01 BPM) and
  `engineTick` integrates them exactly (a logarithm per line), so `compileSong` (`warpSong`) moves every
  tick it sends (notes and their ends, audio clips' starts, lanes, the loop) to where it falls in time at
  that tempo, and lists the metronome's beats (`clicks`, `barClicks`: the engine's only change). The server
  converts every tick crossing to and from the engine (`AudioEngine.clock`, a `SongClock`: play's and
  record's `from`, the transport's tick, MIDI notes' ticks, takes' start), so the tab and the document
  only ever see the song's ticks; the playhead moves on between the engine's words at `tempoAt`.
- **Plugin windows**: each hosted plugin has a `ParameterWatcher` (gestures, any thread, in atomics); the
  engine's timer reports the parameter last touched (`EngineEvent` "touch") and shows **Automate "…"** in
  the window's title bar (`EditorWindow::setTouched`), whose click is `EngineEvent` "automate"; a
  parameter held in its window isn't driven by its lane meanwhile. `GET /api/engine/parameters` lists a
  plugin's automatable parameters.
- **The tab** (`src/suites/music/automation/`): `actions.ts` (make, open, delete, Tools), `store.ts` (open
  windows, the last touched parameter, the held controls), `control.tsx` (a knob's or fader's automation:
  following the curve in song mode, its menu items), `curve-geometry.ts` and `curve-pointer.ts` (editing
  on the Playlist, a `curve` drag committed once), `draw-curve.ts`, `automation-window.tsx`,
  `chooser.tsx` + `controls.ts` (Automate…), `tool-edits.ts` (the assistant's).
