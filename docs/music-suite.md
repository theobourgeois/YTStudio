# The music suite: where it is and what's next

The music suite is a DAW modelled on **FL Studio**. This is the state of it, how it's built, and every step
still to come, in the order agreed with Théo. It's written for whoever picks the work up next. Read
CLAUDE.md's "The music suite" section first (the rules), then `docs/fl-studio/README.md` (how FL Studio is
put together and how we use its manual). As of 2026-09-30, all of it is on the branch
`t3code/research-daw-architecture` (PR #23), not yet on main.

## What Théo wants

- **An FL Studio clone** in workflow: the channel rack, the piano roll (the most important part to him), the
  playlist, the mixer and the browser. He has used FL for years; when in doubt, do what FL does. Not FLP
  import.
- **His own plugins**: Serum 2, FabFilter Pro-Q and Pro-R, EchoBoy (VST3 / Audio Unit). The only stock
  devices needed are the sampler and an EQ.
- **His workflow**, which the order of work serves: a melody first (Serum 2 in the piano roll), then drums
  (the rack), then the playlist, split by track, to arrange the song; mixing after that.
- **Later, but designed for now**: recording audio (vocals over a song) and a MIDI keyboard.
- **The look** is FL's too (decided after the Piano roll): 3D-ish but modern, the accent blue, in dark and
  light. The whole app is being restyled that way: `docs/ui-redesign.md`.
- **How to build each panel**: talk the phase through with Théo first; write its FL Studio reference in
  `docs/fl-studio/<panel>.md` from the manual (and his corrections) before building it; then build it
  faithfully, tested, and fast with big projects. Finish each reference doc with "Where Vaudio differs".
- macOS first; keep a Windows port cheap (only JUCE's APIs in the engine). A personal tool: JUCE's free
  Starter licence.

## Where it is

### Built

| Part | What works | Reference |
| --- | --- | --- |
| The engine | A native C++/JUCE program the server runs: the audio device (choice of output, buffer, rate), hosting VST3 and Audio Unit instruments, plugin windows, plugin scanning, an offline mode that renders to a WAV for tests | CLAUDE.md "The audio engine" |
| Channel rack | Sampler and plugin channels; the step sequencer (left on, right off, painting); the graph editor; patterns; swing; mute and solo; selecting, moving, cloning and deleting channels by mouse and FL's keys; FL's knobs and LCDs; a file dropped on a channel replaces its sample; the + picks the Sampler or an instrument plugin; the starter kit | `docs/fl-studio/channel-rack.md` |
| Channel settings | A sampler's window: its waveform, volume, pan, pitch, the ADSR envelope, cut self, normalize, reverse, sample start and length, fades | same |
| Plugin channels | One plugin instance per channel, loaded in the background, played from the pattern's notes as MIDI; its own window from the channel's button; its state kept beside the project and restored | CLAUDE.md |
| Piano roll | Every tool (draw, paint, delete, mute, slice, select, playback), selecting, the time selection that loops, Ctrl+B, quantize, glue, chop, legato, the event editor (velocity, pan), note properties, ghost notes, the target channel, FL's keys; FL's look; tested with 20 000 notes | `docs/fl-studio/piano-roll.md` |
| Windows | Every panel is a floating window on a desktop: dragged, stuck to edges and other windows, resized, maximised (double-click the title), snapped to fill the desktop or half | CLAUDE.md |
| Transport | Play and stop the current pattern, tempo, the metronome, where play starts (the Piano roll's ruler, which also moves a playing song) | |
| Assistant | Tools at parity for all of the above (the mixer's too: `get_mixer`, `route_channels`, `update_mixer_track`, `set_send`, the mixer effect and track tools): `get_song`, `update_song`, `add_channel`, `list_plugins`, `update_channel`, `remove_channel`, `solo_channel`, `move_channel`, `set_steps`, `get_notes`, `set_notes`, `edit_step`, `add_pattern`, `update_pattern`, `remove_pattern`, `show_pattern`, `play_song` | `shared/music/tools.ts` |
| Undo and autosave | Every edit, one gesture per drag, in the platform's `DocumentHistory` and `Autosaver` | |

### How it's built, in one screen

```
The tab (src/suites/music/)                 The server (server/music/)           The engine (engine/src/)
  store.ts: the song, undo, autosave          engine.ts: runs the engine,          Engine.cpp: device, commands, process()
  ui.ts, window.tsx: windows, selection         compiles the song (shared/music/     Sequencer.cpp: transport, voices, MIDI
  channel-rack.tsx, piano/*: the panels         compile.ts), restarts it             Song.cpp: a compiled song, samples
  engine-sync.ts: sends the song on          routes.ts: /api/engine                Host.cpp: plugin channels, their state
    every change                             fake-engine.mjs: a stand-in           Plugins.cpp: scanning, the bench
  transport.ts: where it's playing                                                  Protocol.cpp: JSON lines
```

- **The document** (`shared/music/types.ts`): `MusicProject = { settings, channels, patterns }`. Times are
  whole ticks (`PPQ` 96 to a quarter note; a step is 24). Edits are pure functions (`edits.ts` for the
  song, `notes.ts` for a note list) that return the same object when nothing changes.
- **What things sound like is decided in TypeScript**: `compile.ts` turns the song into an `EngineSong`
  (gains from volume, pan and velocity; swung ticks; muted notes left out; the loop). The engine only plays
  what it's told, at the tick it's told. Keep musical rules there.
- **The engine is real-time safe**: the audio thread never waits, allocates or locks (songs arrive by an
  atomic pointer, requests by atomics and lock-free queues). Every new sound is tested offline with the real
  engine in `server/music/sequencer.integration.test.ts` (to the sample).
- **A plugin's settings aren't in the document**: they're a file per channel beside it, saved by the engine.

### Not built, or different from FL Studio today

The detailed lists are at the end of each reference doc. The main ones:

- **The mixer has no track EQ yet**, and the assistant can't use the mixer yet. No effect plugins on channels (the bench in the
  audio dialog can load one, for testing only).
- **No playlist**: only the current pattern plays, looped (FL's pattern mode). No song mode, no
  arrangement, no audio clips.
- **No browser**: samples are added from the rack's menu, by dropping files, or with the starter kit.
- **No automation**, and **no export** of the song (the engine can render offline; nothing uses it for
  that yet).
- Per-note pan is heard on samplers but not sent to plugins. Channels have no colours. Knob menus lack
  "Create automation clip" and "Link to controller".
- The channel settings window lacks FL's other tabs (loop points, time stretching, the full envelope and
  LFO page). Plugin channels have no FL-style wrapper window (their own window opens bare).

## What's next, in order

Each phase: agree its scope with Théo, write `docs/fl-studio/<panel>.md` (the manual's page is named in
`docs/fl-studio/README.md`: `mixer`, `playlist`, `browser`...), build, add the assistant's tools, test
(pure logic in vitest, sound in the engine's integration tests, the panel in an e2e spec), and update this
file and CLAUDE.md.

### 0. The new look (running now, in parallel)

`docs/ui-redesign.md`: the whole app, both suites. The rack's step buttons, knobs, LCDs, transport bar and
window title bars are part of it. New panels below should be built in the new look from the start.

### 1. The mixer

**In progress.** The reference is `docs/fl-studio/mixer.md`. Done: the document and its logic (`mixer`
in `MusicProject`, `Channel.mixerTrack`, the edits in `shared/music/mixer.ts`, the tracks compiled in an
order with their gains in `compileSong`), and routing in the engine (channels play into their track's
buffer, tracks run in that order through their gains and sends into the master; a changed gain glides
over a block; tested offline), and meters (each track's loudest level on each side since the last
transport event, after its fader, in `EngineEvent` "transport" as `meters`, kept in `useTransport`), and
the Mixer window (F9, `src/suites/music/mixer/`: strips, the send row, the track menu, the inspector's
effect slots, FL's keys; the track selector on the rack, Alt+M, and TRACK in a channel's window).
Effect plugins: the engine hosts what the slots hold (a second `PluginHost`, by effect id), runs them
on the track before its fader with bypass and mix, keeps their states beside the project, and opens
their windows from the slot's name; tested offline with our test effect (`engine/test-plugin/`).
Delay compensation: automatic, from what the plugins report (instruments and effects), along
sends and chains of tracks, with a manual offset per track; the inspector shows a track's plugin delay
and the strip a clock; tested to the sample offline (`server/music/latency.integration.test.ts`).
The strips' finishing touches: invert phase, swap sides and stereo separation, track colours, routing
cables, copying a track's state (effects with their settings) to another, and only the strips in view
drawn (500 tracks open as fast as 16). The assistant's mixer tools (`get_mixer`, `route_channels`,
`update_mixer_track`, `set_send`, `solo_mixer_track`, `add_`/`remove_`/`move_mixer_track`,
`add_`/`update_`/`remove_mixer_effect`, `copy_track_state`; `list_plugins` lists effects too; `get_song`
sums up the routing). Next: Théo's feedback pass, then the playlist. **The track EQ is put off** (Théo, 2026-09-30): he EQs
with Pro-Q in a slot; a stock EQ can come later if the assistant or shared songs need one.

What Théo needs: his effect plugins (Pro-Q, Pro-R, EchoBoy) on channels and on the master, levels, and a
stock EQ.

- **FL's model**: numbered insert tracks plus the master. Each channel is routed to an insert (the rack's
  mixer track selector, and TRACK in the channel's window). Each insert has 10 effect slots, volume, pan,
  mute, solo, a meter, and sends to other inserts (routing). Read the manual's `mixer` pages.
- **The document**: a `mixer` in `MusicProject`: inserts (id, name, volume, pan, muted, effects: plugin refs
  or the stock EQ with its bands, sends), and `Channel.insert` (a track number or id). Validate it in
  `normalizeMusicProject`. Effect plugins' states go in the same per-project folder as instruments'
  (`plugins/<id>.bin`), keyed by a slot id.
- **Compile**: `compile.ts` resolves the routing into an order the engine can run (inserts sorted so each is
  processed after everything sending to it; refuse cycles in the edit, not in the engine).
- **The engine**: each insert gets a buffer; channels render into their insert's buffer instead of the
  output; each insert runs its effect chain (`AudioPluginInstance::processBlock`, hosted like instruments in
  `Host.cpp`), applies its gain and pan, adds itself to its sends and the master. Plugin latency: report it,
  and plan plugin delay compensation (FL does it automatically) even if it comes later. Meters: a peak per
  insert in `EngineStatus` (the tab polls it). Keep the audio thread free of allocation: buffers are sized
  in `prepare`.
- **The stock EQ** (put off, see above): in C++ with JUCE's `dsp::IIR` (a few bands: low shelf, peaks, high shelf, cut filters),
  its parameters from the document. Test its response offline (render a sweep or noise and measure bands).
- **The UI**: the Mixer window (F9), in FL's layout (inserts as strips, the selected insert's effect slots on
  the right), the insert selector on the rack and in channel settings, an effect slot's menu (choose a plugin
  or the EQ, bypass, open its window), meters driven by the status.
- **Assistant**: tools to route channels, add and remove effects, set levels.
- **Tests**: routing and compile order in vitest; sound through inserts, sends and the EQ offline with the
  real engine; an e2e spec for the window.

### 2. The playlist

What Théo needs: split the song by track and compose the arrangement.

- **FL's model**: tracks that aren't bound to anything; pattern clips, audio clips and automation clips placed
  on them; song mode (the transport's PAT / SONG switch) plays the playlist. Read the manual's `playlist`
  pages. Its tools are close to the Piano roll's (draw, paint, delete, mute, slice, select, the time
  selection), so reuse the Piano roll's structure: pure operations on a clip list in `shared/music/`, the
  `PianoDrag` pattern (a drag is drawn through the same function that commits it), a canvas, `visibleRange`.
- **"Split by channel"**: FL's "Split by channel" on a pattern turns one pattern into one pattern per
  channel, each on its own playlist track. It's what "split by track" means in Théo's workflow: build it.
- **The document**: `playlist: { tracks, clips }`; a clip is `{ id, track, start, length, offset, kind:
  pattern | audio | automation, ref }`. Patterns keep their notes; a pattern clip plays its pattern, cut to
  its length and looped as FL does.
- **Compile**: flatten the arrangement into notes on the song's timeline (the engine's `notes` list already
  takes ticks; a song is just a long loop, or no loop). Audio clips become a new kind of voice.
- **The engine**: audio clips play long files. Samples are read whole into memory today (`SampleCache`),
  which is fine for drums and loops but not for a vocal take or a whole song. Plan streaming from disk on a
  reader thread with a lock-free ring per voice, before recording (step 6) needs it.
- **The transport**: pattern / song mode; a song position; the playlist's ruler sets where play starts and
  loops a time selection, like the Piano roll's.
- **Assistant**: tools to place and move clips and read the arrangement.

### 3. The browser

- **FL's model** (manual page `browser`): a tree of folders (the user's sample folders, the project's
  files, plugins, presets), clicking a sample to hear it, dragging it onto the rack (a new channel), a
  channel (replace its sample), the playlist (an audio clip) or the Piano roll.
- **The server**: the folders to show (a setting; by default a sensible music folder), listing them lazily,
  file metadata; files dragged in are imported as project media, as today.
- **The engine**: a preview voice for a file that isn't in the song (a `previewFile` command).
- The plugin list (already scanned) and, later, presets.

### 4. Automation and export

- **Automation clips**: a curve over time for a parameter: a channel's volume or pan, a mixer insert's, the
  EQ's, or a plugin's own parameter. FL makes them from a control's right-click ("Create automation clip"),
  which belongs in the knob menu (`knob.tsx`, where FL puts it). The engine needs to list a plugin's parameters and set them
  at block rate (sample-accurate later). Automation clips live in the playlist (step 2).
- **Export**: render the song offline (the engine already renders on request, much faster than real time)
  to WAV, then MP3 through ffmpeg (the server already runs it for the video editor); stems per insert
  later. A dialog like the video editor's export, with progress.

### 5. MIDI input

- The engine opens MIDI inputs (`juce::MidiInput`), plays them on the channel selected in the rack, and
  reports them to the tab (for the Piano roll's keyboard to light up).
- Recording into the Piano roll: notes arrive with the engine's time; quantize on the way in as an option.
  The Piano roll's typing keyboard (Ctrl+T, FL's) fits here too.

### 6. Audio recording

- An input device (the audio dialog already picks the output), monitoring, arming a mixer insert (FL records
  through an insert), record to a WAV on disk (on a writer thread, never the audio thread), the take
  becoming an audio clip in the playlist. Latency compensation from the device's reported latency. This
  needs the streaming playback from step 2.

### Also on the list, when they fit

From the reference docs' tables, roughly in order of use: channel colours; FL's wrapper around a plugin's
window (volume, pan, presets); the Piano roll's scale highlighting and stamp (chords); per-channel swing;
the full sampler envelope and LFO; loop points in the sampler; channel groups; per-note pan and the other
note properties sent to plugins (MPE, or per-note controllers); plugin delay compensation.

## Working on it

- `pnpm engine:build` builds the engine (cmake and ninja from Homebrew); restart `pnpm dev` after, since
  the server keeps the engine it started.
- `pnpm test` runs the engine's integration tests too when it's built (they're skipped otherwise). The e2e
  suite uses the stand-in engine (`server/music/fake-engine.mjs`): answer any new command there.
- `pnpm test:e2e music` and `pnpm test:e2e piano` run the music suite's browser tests alone.
- The test synth and test effect (`engine/test-plugin/`) are VST3s of our own: tests use them instead of anyone's plugins.
- To hear things for real, run `pnpm dev`, make a music project, and add Serum 2 with the rack's +.
