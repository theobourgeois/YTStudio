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
  export, the position display). It gets a pass of its own.
- **Not built**: Analyze audio file, the Time knob, Create sequence, Filter, Target links to several
  controls, Convert to events, the Step and Slide modes.
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
| Plugin parameters | Tools → Last tweaked, the Browser's Current project | Automate "…" in the plugin window's title bar, and the Picker's Automate… list |
| One clip, several controls | Target links | One control per automation clip |
| Step and Slide modes, Filter, Create sequence, Analyze audio file, Time, Convert to events | Yes | Not yet |
| Pulse width (PW) in the LFO | Yes | Not yet |
| Tempo | Automatable | Not yet |
| Channel pitch and other channel controls | Automatable | Volume and pan only |
| Precision | Per buffer (FL's "smooth" options) | Every 256 samples, the same live and exported: gains glide between, a plugin parameter is set at each |

## How it's built

- **The document** (`shared/music/types.ts`): `MusicProject.automations` holds each automation clip's
  source (`Automation`: its target, points, length, Min / Max, LFO, name, colour); a playlist clip of
  `kind: "automation"` refers to one by id, as a pattern clip does to its pattern. A point is
  `{ tick, value, tension, curve }`: the curve and tension are the segment arriving at it.
- **The maths** (`shared/music/automation.ts`, pure and tested): each curve type, the LFO, the value of an
  automation clip at a tick, and the value of a control at any tick of the song (the rules above); the
  edits (points, tension, curve, the Tools); making a clip for a control.
- **Compiling** (`compile.ts`): in song mode, each control a clip drives becomes a lane in the engine's own
  units (a channel's two gains, a mixer track's gain matrix, a send's gain, an effect's mix, a plugin
  parameter's 0..1), sampled from the rules into points the engine only has to draw straight lines
  between. Controls held by the hand are left out (`SetSongRequest.held`).
- **The engine** (`Sequencer`): while a song with lanes plays, it works in slices of 256 samples counted
  from where play started, so live playback and the export (in blocks of 2048) make exactly the same
  sound: gains glide across each slice, an effect's mix and a plugin's parameter are set at its start. A
  plugin's parameters are listed (`/api/engine/parameters`) and found by their id; the plugin's own value
  is taken when play starts and given back when it stops or the lane goes. The engine says which
  parameter was last touched in a plugin's window (`EngineEvent` "tweak"), and its title bar's
  Automate button asks the tab to automate it (`EngineEvent` "automate").
