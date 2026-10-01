# Recording audio

How FL Studio records audio (a vocal, a guitar) into a song, from the manual (`recording_audio`,
`recording`, `toolbar_panels`, `mixer`, `mixer_trackprops`, `mixer_mixermenu`, `mixer_iorouting`,
`envsettings_audio`, `playlist`, `menu_options`, `basics_new_20`/`21`/`24`) and Théo. See
[README.md](README.md) for the sources. The online manual now describes **FL Studio 2026**; recording has
hardly changed since FL 20, and what's newer says so. Recording notes (MIDI) is another page, for step 5.

The last sections are ours: [what we'll leave out](#what-well-leave-out), [what's decided](#decided-with-théo-2026-10-01),
[how we'd build it](#how-wed-build-it) and [where Vaudio differs](#where-vaudio-differs).

## What it is

- **FL records through a mixer track.** A mixer insert takes one input of the audio device (a stereo pair
  or a mono input), and **arming** the track makes it record. Whatever reaches the track is what's
  recorded, so it's always an unused insert, **never the master** (which gets everything).
- **The transport's Record button is a separate switch.** Tracks can stay armed while Record is off.
  With Record on, **Play** starts recording on every armed track; **Stop** ends it.
- **Each armed track writes a WAV file**, and in song mode the file appears in the Playlist as an **audio
  clip** where recording started. Several tracks can record at once, as many as the device has inputs.
- **No comping.** Loop recording makes each pass a clip of its own; combining takes is done by hand
  (slicing, muting, then consolidating). There are no take lanes in any version up to 2026.

## The workflow

![The mixer, labelled](img/recording_mixer-overview.png)

1. **Pick an unused insert track** and **choose its input** (the Input menu in its inspector, or on its
   Playlist audio track). Choosing an input **arms the track** and sets its pickup to EXT.
2. Optionally, **link a Playlist track to the insert**: it becomes an **audio track**, with the input,
   monitoring and arm on its header, and the takes land on it.
3. **Arm the transport**: click Record (it lights) or press **R**.
4. **Play** records (after the count-in, if it's on). **Stop** ends it.
5. The take is a new audio clip in the Playlist (song mode) or a new audio clip channel in the rack
   (pattern mode). With tracks still armed, recording again makes **new** clips and leaves earlier ones
   as they were.

The **One-click recording** button (a microphone on the toolbar) does steps 1–4 in one go: "I want to
record audio… Into Edison / Into playlist as an audio clip", then the input list, then a count-in of four
clicks.

![One-click: the input list](img/recording_one-click-input-select.png)

## The Record button

- **R**, or a click: Record on and off. It lights while on. With it on, Play records.
- **Right-click: the Recording filter** (what Record records) and options. Defaults, from the manual's
  picture:

  ![The record button's menu](img/recording_record-button-filter-menu.png)

  | Item | What it does | Default |
  | --- | --- | --- |
  | Automation | Records control movements as automation | on |
  | Notes | Records notes (MIDI, the typing keyboard) | on |
  | Audio | Records audio from armed tracks | on |
  | Clips | Records Performance mode clips | on |
  | Recording starts playback | Pressing Record also starts play | off |
  | Disarm on stop | Record turns itself off when play stops | off |
  | Enable recording markers | Start/Stop recording time markers switch Record on and off (punch in/out) | on |
  | Quantize… | Notes only | |

- **Alt+click** shows the "What do you want to record" popup (its choices aren't in the manual).

### The recording switches beside it

| Switch | Key | What it does |
| --- | --- | --- |
| **Count-in** (precount) | Ctrl+P | Metronome ticks before recording starts; right-click picks how many bars (the choices aren't in the manual; one-click uses one bar of four clicks; the manual advises at least a bar of lead-in) |
| **Loop record** | — | Recording goes round the loop (the time selection, else the whole song) until Stop: each pass is a new clip |
| **Blend** (overdub) | Ctrl+B | For audio, sound-on-sound: earlier passes keep playing as it loops. Off, they're muted |
| **Metronome** | Ctrl+M | Clicks every beat, accented on the bar. It's heard while recording (and captured if it reaches the armed track) |
| **Wait for input** | Ctrl+I | Play waits until input arrives |

## The mixer track

![The input menu and arm](img/recording_mixer-input-menu.png)

- **Input** (in the track inspector, Ctrl+Enter): the device's inputs as **stereo pairs** ("In 1 - In 2")
  then **mono** ones ("In 1"), then (none). A mono input fills both sides of the track. Several tracks can
  take the same input. Choosing one **arms** the track. The input is **mixed** with whatever else is routed
  into the track. Right-click → **AutoMap** gives each input to the next track and turns off their sends
  to the master (no feedback); Alt+click resets it.
- **Arm** (a small dot under the fader): left-click arms (red), right-click arms and asks for the file's
  name and folder. An armed track's fader turns **orange**. A track can be armed with no input, to record
  what's routed into it (internal audio).
- **Pickup** (where on the track the recording is taken; the icon before Input):

  ![Pickup and monitoring](img/recording_pickup-and-monitor-menu.png)

  | Pickup | Recorded | |
  | --- | --- | --- |
  | **EXT** | The external input only, dry | Recommended, the default, set when an input is chosen |
  | MIX | The input and the mixer's sound into the track, before effects | |
  | FX | After the effect slots | |
  | EQ | After the track's EQ | |
  | LVL | After its volume and pan | |
  | POST | After its mute | |

- **Monitor external input**: **Off**, **When armed** (the default) or **On**. What's heard goes through
  the track's effects and on to the master, so a vocal can be **recorded dry and heard with its reverb**
  (EXT pickup). The meters can show the input's level even when it isn't heard.
- **Input delay compensation** (the clock after Input): moves recorded audio earlier (positive) or later,
  in ms, samples or beats; "Adjust position of recorded audio" (FL 21) also takes out the delay of
  plugins in the way. The manual's way to measure it: record the metronome through the mic and line the
  clicks up with the grid.

  ![Input delay compensation](img/recording_input-delay-compensation.png)

### The Mixer menu → Disk recording

| Option | What it does |
| --- | --- |
| Auto-unarm | Tracks are disarmed when play stops |
| Auto-create audio clips | The take goes on the Playlist (song mode only); "should be on" |
| Latency compensation | Takes the input latency off the start of the take ("there is no latency for internal audio": turn it off for that) |
| Auto-name playlist tracks | Names the tracks takes land on |
| Group loop recorded takes | Each loop pass goes on a child track under the audio track that recorded it |
| 16-bit / 24-bit / 32-bit float | The files' format (FL 2026.1); "normally use 32-bit float" |
| Render armed / selected tracks to wave (Alt+R / Shift+Alt+R) | Bouncing, not recording |

## Audio tracks on the Playlist

![Track mode → Audio track](img/recording_playlist-track-mode-audio.png)

- Playlist tracks aren't bound to anything, but one can be **linked to a mixer insert**: right-click its
  header → **Track mode → Audio track → Insert N** (with several tracks selected, the next ones get the
  next inserts), or the Mixer's **Assign to new audio track(s)**, or a right-click on the Playlist's **+**.
- An audio track's header shows the insert's **input**, **monitoring** and **arm** (an icon that turns red
  when armed): recording can be set up without opening the Mixer. View → "Show controls on audio tracks"
  and "Show levels on audio tracks".

  ![An audio track's controls](img/recording_playlist-audio-track-controls.png)

- **Takes from that insert land on it.** When there's no room, they go on **sub-tracks** under it.

## What a recording makes

- **A WAV per armed track per pass**, at the device's rate, in the format chosen in Disk recording;
  stereo (every mixer track is). Named after the project, the date and the insert, with `_2`, `_3`… for
  loop passes ("untitled_2022-01-05 10-00-46_Insert 1_2", from the manual's picture; the rule isn't
  written down).
- **Where**: the file named on the arm's right-click, else the project's data folder if it has one, else
  `Documents/Image-Line/FL Studio/Audio/Recorded` (shown in the Browser).
- **The clip**: on the insert's audio track, else on **the first Playlist track it fits on** without
  overlapping, from where recording started. In pattern mode, no clip: an audio clip channel in the rack.
- **Its channel's routing**: with an audio track, back into the insert that recorded it (so it's heard
  through that insert's effects, and would be recorded again unless the pickup is EXT); without one, into
  the track the insert sends to.
- **Undo** takes the clip away; the file goes to the trash once it can't be redone any more.

![A recorded clip on an audio track](img/recording_playlist-recorded-clip.png)

## Loop recording and takes

![Loop takes as child tracks](img/recording_loop-takes.png)

1. Loop record on; Blend on to hear earlier passes, off to mute them; song mode.
2. The time selection is the loop; without one, the whole song (with nothing in the Playlist, one bar).
3. At each end of the loop, the pass is put on the Playlist as a clip and recording goes on from the
   start: a new file. With **Group loop recorded takes**, each pass is a child track under the audio track.
4. The manual's advice for takes: **Loop record on, Blend off**: each pass mutes the ones before it, so the
   last is what's heard, and any earlier one can be unmuted.
5. FL warns that the first few ms of each pass may glitch (it saves a file and makes a channel at the
   wrap) and advises a bar of lead-in.

Punch in/out is done with **Start recording / Stop recording** time markers ("at selection" in the
markers' menu); there's no punch mode as such.

## Audio settings (F10 → Audio)

![macOS audio settings](img/recording_audio-settings-coreaudio.png)

- On macOS, separate **Output** and **Input** devices (FL 2026; an aggregate device for more). On
  Windows, inputs need an ASIO driver.
- The status line gives both latencies: "input: 1675 smp, output: 970 smp, output + plugins: 1058 smp".
- A smaller **buffer** means less delay when monitoring (128 samples on Apple Silicon to start).
- **Offset**: a global shift of recorded material and the playhead, for what the rest doesn't fix.
- The **metronome track** (the master by default): route the click to a track of its own to give a
  performer a separate click.
- macOS asks for **microphone permission** before any input can be read.

## Shortcuts

| Key | What |
| --- | --- |
| R | Record on/off |
| Space | Play/stop (records when Record is on) |
| Ctrl+P | Count-in |
| Ctrl+B | Blend |
| Ctrl+M | Metronome |
| Ctrl+I | Wait for input |
| L | Pattern / song |
| Ctrl+Enter | The track inspector (input, arm) |
| Alt+click Input | Reset the mapping |

## What we'll leave out

- **Edison** (recording into an audio editor), the **One-click** wizard, **Wait for input**, the
  Recording filter's Notes, Automation and Clips (MIDI is step 5; automation recording can come with
  automation), the Audio Logger.
- **The pickup menu**: we always record the dry input (EXT) and hear it through the track (Théo).
- **Start/Stop recording markers** (punch in/out): not now (Théo); the time selection already loops.
- **Recording in pattern mode** (an audio clip channel, no clip): not now (Théo).
- **AutoMap**, Bypass track latency compensation, the 16/24-bit choice (32-bit float always), naming a
  file on the arm's right-click, Alt+R (that's bouncing).

## Decided with Théo (2026-10-01)

- **One pass** builds: an input device, an insert's input, arming, monitoring, the Record button with
  count-in, takes becoming audio clips, latency compensation; **plus loop recording (takes)** and **FL's
  audio tracks** (a Playlist track linked to an insert, with its controls on the header).
- **What's recorded and heard**: the **dry input** (FL's EXT), heard **through the insert's effects**
  (Monitor: Off, When armed, On; When armed by default). No pickup menu.
- **Hardware**: both an **audio interface** (input and output one device, a mono mic on input 1) and the
  **Mac's own mic** with headphones (input and output two devices), properly, from the start.
- **Where a take goes without an audio track**: FL's rule, **the first Playlist track it fits on**, from
  where recording started.
- Not now: punch in/out, recording in pattern mode.

## How we'd build it

The plan for the pass (also `docs/music-suite.md`, step 6). Musical decisions stay in TypeScript; the
engine moves samples and says when.

### Step zero: microphone access

Nothing records until macOS lets the engine read an input.

- **The engine opens no inputs today** (`devices.initialise (0, 2, …)` in `engine/src/Engine.cpp`), on
  purpose: opening one asks for the microphone. It should open inputs **only once the user picks an
  input device or an insert's input**, so someone who never records is never asked.
- **The usage string**: macOS refuses (or kills) a process reading the mic when the app responsible for it
  has no `NSMicrophoneUsageDescription`. The engine is started by Vaudio, which is then the app
  responsible: add the key to Vaudio's Info.plist (`mac.extendInfo` in `scripts/desktop.ts`) and to the
  engine's (`PLIST_TO_MERGE` in `engine/CMakeLists.txt`). When the app is signed with the hardened
  runtime, both need `com.apple.security.device.audio-input`.
- **Asking**: the desktop app asks first (`systemPreferences.askForMediaAccess("microphone")` in
  `electron/main.ts`, through the preload) when an input is chosen, and Settings says so plainly when
  it's been refused ("Vaudio can't hear your microphone: System Settings → Privacy & Security →
  Microphone"). In `pnpm dev` the terminal running the server is the app responsible, and it's that one
  macOS asks about.

### The document (`shared/music/types.ts`, validated in `project.ts`)

- `MixerTrack.input: { channels: [number] | [number, number] } | null`: the device's input channels it
  takes (one: mono, heard on both sides). By channel number, so it survives the device being renamed;
  a channel the device doesn't have is silent, not an error.
- `MixerTrack.monitor: "off" | "armed" | "on"` (`"armed"` by default) and `MixerTrack.inputOffset` (ms,
  FL's input delay compensation; positive moves takes earlier).
- `PlaylistTrack.mixerTrack: string | null`: FL's audio track, the insert it's linked to (by id).
- **Arming isn't in the document** (nor in undo): which tracks are armed, Record, Loop record, Blend and
  the count-in are the tab's (`src/suites/music/recording.ts`, a store; the count-in, Loop record and
  Blend kept in the browser like the metronome's sound). The master can't be armed.

### The engine

- **Devices**: `EngineDevices` gains `inputs` (devices), `input` (the chosen one), `inputChannels` (their
  names, for the menus) and the status `inputLatencyMs`. On macOS, JUCE pairs a different input and
  output device itself (an `AudioIODeviceCombiner`); test the Mac's mic with headphones (two devices,
  maybe at different rates) as well as an interface.
- **Input into the mixer**: the callback's input buffers reach `Engine::process` (live) or a test
  signal (offline, below). `compileSong` gives each track its `input` channels and whether it's
  `monitored` (monitor, armed) and `armed`; `Sequencer::mixTracks` adds a monitored track's input into its
  buffer **before its effects**, so it's heard through them. Meters show an armed track's input level
  even when it isn't monitored (FL's "always show input levels").
- **Writing** (`engine/src/Recorder.cpp`): per armed track, the dry input goes into a lock-free ring on
  the audio thread and a writer thread writes it (`juce::AudioFormatWriter::ThreadedWriter`): 32-bit
  float WAV, mono for a mono input, stereo for a pair. Files are opened ahead on the message thread (a
  spare one per track, ready for the next loop pass), as `ClipPlayer` makes streams ahead: the audio
  thread never opens or closes a file. A take records **the tick its first sample was taken at** and its
  length in samples.
- **Count-in**: `play { from, countIn }`: the metronome clicks `countIn` bars with the transport held,
  then play starts on the bar; recording starts with the transport, never during the count-in.
- **Loop record**: at the loop's end each armed track's file is closed (handed to the writer thread to
  finish) and the spare starts on the same sample: no gap and no glitch, unlike FL. Without Loop
  record, the song doesn't wrap while recording (the take can run past the song's end).
- **Events**: `EngineEvent "take"`: `{ track, file, startTick, frames, sampleRate, pass, latency }`
  (`latency`: the device's input + output latency and the song's plugin delay, in samples, at that
  moment). One per track per pass, when its file is complete.
- `fake-engine.mjs` answers the new commands and, on stop, writes a short WAV per armed track and sends
  its `take`, so the e2e suite can record without a microphone.

### Latency (`shared/music/recording.ts`, tested)

What's heard at tick T left the speakers late by the output latency and the song's plugin delay; what's
played along to it arrives late by the input latency. So a take's clip starts at its `startTick` with its
`offset` (seconds into the file) set to that total plus the track's `inputOffset`: the first sample
heard is the one played on the beat. Pure arithmetic, tested; the device's reported latency is often a
little off, which is what `inputOffset` is for (measured as the manual says: record the metronome
through the mic and line the clicks up).

### The server

- Takes are written straight into the project's folder (`data/projects/<id>/recordings/`), never `tmp`
  (wiped on startup). `POST /api/music/takes` (routes in `server/music/routes.ts`) adopts each finished
  file as project media (moved, not copied: a `MediaLibrary.adopt`), with its waveform, and returns the
  `MediaAsset`. Files of a take that crashed mid-way are WAVs with an unfinished header: repair them on
  the next start (later; note it).

### The tab

- **Takes become clips** (`addTakes` in `shared/music/playlist.ts`, tested): an audio clip channel per
  take (named after the insert and the take's number, routed **into the insert that recorded it**: it's
  heard through the same effects it was monitored through, and since we record the dry input it's never
  recorded twice), and a clip at its start: on the insert's audio track if it has one (then, with no room,
  the tracks below it), else **the first track it fits on**. Loop passes of one recording: the newest on
  the audio track (or the first free), each earlier one on its own track below and **muted** when Blend
  is off (FL's "Group loop recorded takes" and its advice for takes; we have no child tracks). All the
  takes of one recording are **one undo step**.
- **Recording in progress** is drawn on the Playlist: a red region growing from where it started on each
  track a take will land on (from the transport, not the file); the clip and its waveform appear when the
  take is done.
- **The toolbar**: Record (R) beside Play and Stop, lit red while on; its right-click menu: Count-in
  (Off, 1 bar, 2 bars, 4 bars; 1 bar by default), Loop record, Blend, Disarm on stop. Pressed in pattern
  mode, it switches to song mode (recording is the song's).
- **The Mixer**: the inspector's Input menu (stereo pairs, then mono inputs, then (none); choosing one
  arms the track), Monitor (Off / When armed / On) and the input offset; the arm dot under each strip's
  fader, the fader orange while armed; the track menu's Assign to new audio track(s).
- **The Playlist**: a track header's menu Track mode → Audio track → Insert N, and an audio track's
  header showing its input, monitor and arm.
- **Settings**: the input device, with the latencies both ways and the permission's state.

### The assistant

- `update_mixer_track` takes `input`, `monitor` and `inputOffset`; `update_playlist_track` takes the
  insert of an audio track; `list_audio_inputs`; `arm_tracks`; `record` (start and stop recording, with
  the count-in and loop options); `get_mixer` and `get_playlist` say what's armed and linked.

### Tests

- Vitest: the document's new fields through `normalizeMusicProject`; `addTakes` (placement, audio
  tracks, the first free track, loop passes muted, one undo step); the latency arithmetic; `compileSong`'s
  inputs and monitoring.
- The real engine, offline (`server/music/recording.integration.test.ts`): an offline engine has no
  device, so `render` takes an `input` (a WAV, or clicks at known samples) that stands in for it. Record
  clicks played on the beat: the take's file has them where they were, `startTick` is right, and the
  clip `addTakes` makes puts them on the beat to the sample; loop passes split exactly at the wrap with no
  sample lost or doubled; monitoring is heard through the track's effects and not when it's off; the
  count-in records nothing.
- E2e (`e2e/music.spec.ts`, the fake engine): choose an input, arm, Record, play, stop: the take is a clip
  on the right track; loop recording makes muted takes; an audio track gets its takes.

## Where Vaudio differs

Nothing is built yet. Once it is, this lists where it's not FL's (from the decisions above: no pickup
menu, no Edison or One-click, no punch markers, no pattern-mode recording, loop takes on tracks below
rather than child tracks, Record in pattern mode switching to song mode, 32-bit float only).
