# The music suite

A DAW modelled on **FL Studio**: when in doubt about its UX, do what FL Studio does (as video follows Premiere).
**What FL Studio does is written down in `docs/fl-studio/`** (from its manual, with its screenshots, and from
Théo): read the panel's document before touching that panel, don't work from memory, and write the document for
a panel before building it. Each ends with where we still differ.
Built so far: the channel rack (sampler and plugin channels, the step sequencer and its graph editor, patterns,
swing), the Piano roll, the Playlist and song mode, the transport and the metronome, the mixer, the Browser,
the export, automation, recording, MIDI input, Gross Beat, EchoBoy, Auto-Tune, Pro-Q, PanMan, Pitch Wheel, OTT, Pro-C, YT-L, Reverb. Where it is and every step still to come, in order:
`docs/music-suite.md`. The app's new look (both suites), in progress: `docs/ui-redesign.md`.

- The document (`shared/music/types.ts`): `MusicProject = { settings: { tempo, timeSignature, swing, volume, scale? }, channels,
  patterns, playlist, mixer, automations }` (`volume` is the toolbar's main volume, folded into the master's gain by `compileSong`). A `Channel` is a sampler playing one of the project's media (`sampleId`), prepared first by its
  `precomputed` effects (trim, reverse, normalise, fades); a `Pattern` has `notes[channelId]`, sorted by `start`,
  and a `length` that's null for FL's Auto: use `lengthOf`/`patternSteps`, never the field. Solo isn't a field:
  it's a state of the mutes (`soloChannel`).
- A channel is a sampler or a **plugin channel** (`kind: "plugin"`, `plugin: { id, name, format }`): an instrument
  plugin (VST3, Audio Unit) the engine hosts for it. The engine keeps one instance per plugin channel across the
  song's edits (`engine/src/Host.cpp`), loads it in the background (the channel is silent until then;
  `EngineStatus.channels` says loaded, loading or failed), plays the pattern's notes into it as MIDI (moved by
  the channel's PITCH in whole semitones), and shows its own window when the channel's button is clicked. Its
  settings window is FL's wrapper (`plugin-tab.tsx`): the channel's knobs, and the plugin's presets (its own
  programs, and the user's saved in the engine's data folder, `PluginHost::savePreset`; `/api/engine/presets`). **A plugin's settings aren't in the document**: they're
  a file beside it in its package (`<project>.ytsng/plugins/<channel id>.bin`), written by the engine every few seconds when
  they've changed, when the channel is removed (so undoing that brings the plugin back as it was) and when the
  engine quits. So what's turned inside a plugin's window isn't an undo step, as in FL Studio. **Musical time is whole ticks, `PPQ` (96) to a quarter note**, never
  seconds; a step is `STEP_TICKS` (24). A step of the sequencer is simply a note starting on the grid
  (`stepNotes`), so the piano roll will edit the same notes.
- Edits are pure functions in `shared/music/edits.ts` that return the same instance when nothing changes, exactly
  like the video editor's. The store (`src/suites/music/store.ts`) keeps a `DocumentHistory`: `commit(edit)` for a
  one-shot edit, `songGesture()` for a drag (one undo step). Which pattern is shown and which channel is selected
  are UI state, not the song.
- **The mixer** (`docs/fl-studio/mixer.md`): `mixer.tracks` is the master (always first, `MASTER_TRACK_ID`) then
  the insert tracks; a channel plays into one (`Channel.mixerTrack`, by id, so moving tracks keeps the routing).
  A track has `EFFECT_SLOTS` effect slots (null is empty) and `sends` (post-fader, the master's by default).
  Sends never make a loop: `normalizeMusicProject` drops one and `setSend` refuses it (`canSend`), so
  `compileSong` can always order the tracks (`trackOrder`: each after its senders, the master last). Its edits
  are in `shared/music/mixer.ts`. An effect's settings are a file like a plugin channel's, by the effect's id:
  the engine has a second `PluginHost` for the mixer's effects (keyed by effect id, `EngineStatus.effects`,
  the `effectEditor` command), and each track runs its loaded, enabled effects in order before its fader,
  blending by its mix (`Sequencer::runEffect`). Plugin delay compensation is the engine's (only it knows the
  plugins' delays): `Song::compensate` walks the tracks in order, every path into a track (a channel through
  its instrument, a send) waits for the latest one in a `DelayLine` (`Delay.h`, handed on to the next song
  while its length stays the same, so edits don't empty it), and `songLatency` (in `outputLatencyMs` too)
  keeps the playhead in time. A plugin changing its delay makes the song again (`checkLatencies`). A track's
  `latencyOffset` (ms) is FL's manual compensation, added to what its plugins report.
  A track's invert, swap and stereo separation are folded into its gains in TypeScript (`stereoGains`), so
  the engine knows nothing of them. Copying a track's state copies its plugins' settings files on the server
  (`POST /api/engine/states/copy`) before the pasted effects (new ids) reach the engine. The Mixer window
  draws only the strips in view (`useVisibleStrips`): don't rely on off-screen strips being in the DOM.
  Plugins are chosen in one picker (`plugin-picker.tsx`, its model in `plugin-groups.ts`: groups from the
  plugin's reported category, pins in localStorage) for the rack's + and the effect slots. It lists our
  built-in ones and the plugins starred in the Plugin manager (`plugin-manager.tsx`, its More plugins…;
  the stars are `plugin-favourites.ts`, this computer's), FL's favourites. An effect slot dragged onto
  another strip moves the effect there, ⌘-drag copies it (onto a slot too; `effectToTrack`).
  The mixer's look is its own theme tokens (`--mixer-*`, `--fader-*`; knobs everywhere use `--knob-*`), FL
  Studio's colours: use them in the mixer rather than the app's surfaces. A track's `dock`, `separator`,
  `folded` and `group` (`Mixer.groups`) are only how the mixer shows it; they route nothing (a group's
  `linked` links its controls in the window; its `vca` fader is folded into its tracks' gains by
  `compileSong`). **Solo** is `MixerTrack.solo`, never a rewrite of the mutes, and follows the routing
  (`shared/music/solo.ts`: `heardMixer` is what `compileSong` plays, `hearing` what the strips show). A
  send can be `preFader` (the engine keeps the track's sound before its gains for it). A selected strip's
  controls act on every selected track (`menuTargets`; `controlTargets` adds linked groups).
  The Mixer window is `src/suites/music/mixer/` (F9): `mixer-window.tsx` (strips, the send row, menus),
  `inspector.tsx` (effect slots), `fader.tsx`, `meters.ts` (one animation loop draws every strip's meter from
  `useTransport().meters`; the falling in `meter.ts`, tested), `actions.ts` (what menus and keys do), `keys.ts`
  (its keys while it's in front), `track-selector.tsx` (the rack's and a channel window's track LCD). The
  selected tracks are UI state (`selectedTrackIds`; the first is the one sends are made from).
- **Sidechains** (`docs/sidechain.md`; `shared/music/sidechain.ts`, `mixer/sidechain-menu.tsx`): any effect
  slot can have a key (`MixerEffect.sidechain`: a track and a tap, `preFx` / `postFx`, the default / `postFader`).
  **A key is routing**: it orders the tracks as a send does (`routeOf`, used by `reaches`, `canSend`, `canKey`,
  `trackOrder` and the engine's stages), so it never makes a loop; no 0% send is needed. Edits that move or
  remove tracks or effects end with `withValidKeys`. The engine keeps taps as buffers of their own
  (`preFxBuffer`, `preBuffer`, `keyFaderBuffer` for a source the solo silences: `EngineTrack.keyGains`), treats a
  key as a path into its track in `Song::compensate` (a later key makes the track wait, an earlier one waits in
  the slot's `keyLine`), and hands the lined-up key to the effect (`Sequencer::keyOf`): Pro-C's External,
  Pro-Q's external dynamic bands (`EqBand.external`), a plugin's sidechain bus (turned on in `configurePlugin`,
  filled in `runEffect`; `EngineEffects.loaded[].sidechain` says which have one). Tested offline in
  `sidechain.integration.test.ts` (the test effect listens to its sidechain with VAUDIO_TEST_EFFECT_SIDECHAIN).
- **Modulators** (`docs/sidechain.md`; `shared/music/modulation.ts`, `src/suites/music/modulation/`): FL's Peak
  Controller, generalised: `MusicProject.modulators`, each following a track's tap or a channel's notes and
  moving its `links` (any `AutomationTarget` but the tempo, one modulator a control) by an amount of their range
  from their own value (or automation's): Bitwig's add, not FL's replace. **What a value means stays in
  TypeScript**: `compileSong` sends a modulated lane as a grid over the modulator's level (`steps` sets of
  values a point, `base` at the own values; a plugin parameter's lane an `amount`), in both modes. The engine
  follows each modulator after the mix (`followModulators`, its state kept by id) and drives modulated lanes
  every `modSlice` (64) samples, playing or not, from the level at the end of the slice before
  (`applyModulated`): a slice behind the source, so modulation needs no track order (it isn't delay-compensated).
  Every automatable control gets Modulate ▸ through `AutomationMenuItems`; `useAutomatedControl` shows the live
  value (levels from `EngineTransport.modulators`) and `SongKnob` the ring. Tested offline in
  `modulation.integration.test.ts`, including block-size independence.
- What volume, pan, velocity and swing *mean* is decided in `shared/music/compile.ts` (`compileSong` → `EngineSong`:
  gains, swung ticks), in tested TypeScript. The engine only plays samples at the moments it's told. Add musical
  rules there, not in C++.
- **The Piano roll** (`src/suites/music/piano/`): notes have an `id` (a small number, unique in their list: what's
  selected is a set of them), `pan` and `muted`. Its operations are pure functions of a note list in
  `shared/music/notes.ts` (move, clone, duplicate, quantize, glue, chop, slice, stretch...: tested, including with
  20 000 notes), applied with `editNotes`. The window draws on canvases (`draw.ts`) once a frame when something
  changed; only notes in view are drawn (`visibleRange`). **A drag doesn't edit the song while it lasts**: it's a
  `PianoDrag` in the Piano roll's store, which the canvas draws the notes through (`applyDrag`, the same function
  that commits it), and it becomes one edit when it's let go (`commitDrag`). Keep new gestures that way. Its maths
  is `geometry.ts`, its mouse `pointer.ts`, its keys `keys.ts` (run by the workspace while it's the front window),
  its commands `actions.ts`. The time selection is what the engine loops (`SetSongRequest.loop`; the engine's
  ticks then count from the loop's start: `patternTickNow`), and a ruler click is where play starts
  (`play { from }`; sent while playing, the engine goes there at once). Its look is FL's, in colours of its own
  for each theme (`readPalette`): don't take the page's theme colours for the grid or the notes. Each tool has its
  pointer (`cursors.ts`, picked by `gridCursor`; a drag sets the canvas's own while it lasts), and deleted notes
  fade out (`fades.ts`: call `fadeOut` wherever notes are deleted). The song's `scale` (`shared/music/scales.ts`)
  lights its rows and snaps notes drawn, stamped and moved (Alt: not); the Stamp places its chords, and the
  Quantizer (Alt+Q, `quantizeWith`) is previewed live as the Chopper is (both through the engine's song too).
- **A sampler's own settings** (`shared/music/sampler.ts`, the channel window's Envelope tab, `instrument-tab.tsx`):
  its loop, filter, swing mix and an envelope and LFO per target (pan, cutoff, resonance, pitch; the volume's
  LFO), each absent from the channel at its default (`samplerOf` fills them in; `samplerFields` checks a patch).
  The maths (`envelopeLevel`, `lfoValue`, `tensionCurve`, `cutoffHz`) is what the engine plays in
  `Sequencer::renderShaped`, the voices of a channel with any of it (others keep the plain path): keep the two
  the same, and test sounds in `server/music/sampler.integration.test.ts`.
- The tab sends the whole song to the engine on every change, even mid-drag (`engine-sync.ts` →
  `POST /api/engine/song`: the server normalises it, compiles it and turns sample ids into paths). The engine
  swaps songs without a gap. Notes the same as the last song's (a knob turned; they're most of a song in song
  mode) are left out and the engine keeps its own (`sameNotes`): a song mode send went from about 50 ms to 16. Where the song is comes back on an event stream (`/api/engine/events`, about 25 a
  second); the tab fills in between (`tickNow`) and shows it late by the output's latency.
- **Everything is a window** (`window.tsx`: `MusicWindow` on the `MusicDesktop`, the platform's
  `components/windows/`), as in FL Studio: dragged by its title bar, its edges sticking to the desktop's and
  other windows' (Alt: not), brought forward when touched, closed and reopened (`ui.ts` keeps which are open,
  `useMusicWindows` where they are and which is in front). A `resizable` one also resizes by its edges and
  fills the desktop (double-click its title, or drag it to the top) or half of it (drag it to a side); one that
  doesn't resize (the rack) goes to the corner and back on that double-click (`toggleCorner`); the Piano
  roll opens that way. The maths is `components/windows/geometry.ts`. A new panel is a new window, not a docked pane. One thing to know: a menu opened from inside a window is drawn
  elsewhere on the page but its React events still bubble through the window, so a handler on a container must
  check `currentTarget.contains(target)` before treating a press as its own (the title bar's drag does).
- **Mouse conventions** (FL's, and the ones to keep in every panel): the left button adds or turns on, the right
  button removes or turns off, and both paint when dragged (`startPointerDrag` takes `button: 2`). A control's
  right-click is its menu. Knobs are `Knob`/`SongKnob`, number displays `Lcd`: don't hand-roll either.
- What a menu item and its shortcut do lives once, in `rack-actions.ts`; keys are resolved in `keys.ts` (pure,
  tested) and run in `workspace.tsx`.
- **The Playlist** (`docs/fl-studio/playlist.md`, F5; `src/suites/music/playlist/`): `MusicProject.playlist`
  is numbered tracks (bound to nothing; `tracks` only as long as the last one changed) and clips
  (`PlaylistClip`: a pattern, an audio clip's channel or an automation clip, `start`, `length` (null: a pattern clip following
  its pattern), `offset` into its content (ticks of a pattern, **seconds** of an audio file), `muted`). Clip
  ids are small numbers, like notes'. Its operations are pure functions of a clip list in
  `shared/music/playlist.ts` (with a `ClipContext`: the patterns' lengths and the tempo, which a clip's
  length needs, and each audio clip's speed: a stretched one plays at its stretch's, so an audio clip's ticks
  become file seconds through `fileSecondsPerTick(clip)`, never `secondsPerTick`; its channel's pitch makes it
  higher or lower, never faster, as FL's does: the engine's stretcher shifts it, `audioPlayback`). An audio clip has its own `gain` and fades (`fadeIn`/`fadeOut` in ticks, their
  tensions: `fadeShape`, the engine's too), each absent at its default (`clipExtras` checks them). The
  window is built as the Piano roll is: canvases (`draw.ts`), a `PlaylistDrag` drawn
  through `applyDrag` and committed once, maths in `geometry.ts`, mouse in `pointer.ts`, keys in `keys.ts`,
  commands in `actions.ts`. An audio clip's channel is `Channel.kind: "audio"`, in the rack's
  Audio group (`RackGroup`), with a cut-down settings window; it has steps and notes too, as FL's (the
  engine reads its file into memory once notes play it, `playsNotes`, or it has precomputed effects;
  otherwise its clips stream it). Deleting a pattern or
  a channel takes its clips. A clip's colour is its source's (`Pattern.color`, `Channel.color`), else its
  track's; every clip colour is derived from one (`clipColours` in `draw.ts`). The clip menu's Preview
  sends the engine a song of that clip alone while it's held (`playlist/preview.ts`). Time markers
  (`Playlist.markers`, `shared/music/markers.ts`; Alt+T, in a band along the ruler) are named ticks, or Start /
  Stop recording markers (`punchRange`: recording keeps only what's between). Render as audio clip and
  Consolidate (`shared/music/consolidate.ts`, the render in `playlist/bounce.ts`) render clips as they reach
  their mixer tracks, before the tracks' effects: a song made for it (`bounceRender`: a plain stand-in track
  for each) exported with `bounce`, whose stems the server adopts as the project's media; each becomes a clip
  playing back into its track. A consolidated clip (`PlaylistClip.consolidated`) names the clips it replaced
  (`Playlist.consolidations`, kept once) for Unconsolidate and Re-render.
- **Stretching audio clips** (`docs/fl-studio/playlist.md`, Stretching audio clips; `shared/music/stretch.ts`):
  an `AudioStretch` (`mode`: Resample or Stretch, the pitch kept; `tempo`: the song's tempo at which the file
  plays at its own speed, so a stretched clip follows the tempo) is a clip's own (`PlaylistClip.stretch`, FL
  2025's variant) or else its channel's (`Channel.stretch`); `ClipContext.stretchOf` says which, and
  `audioPlayback` what it means (speed, transpose, keep-pitch: the channel's pitch shifts without changing the
  time, in either mode; in Resample the stretch's speed moves the pitch too). Setting one keeps each clip's content (`setClipStretch`, `stretchChannel`); the
  Playlist's Stretch (Shift+M, `usePlaylist.stretch`) makes an edge a `stretch` drag (`stretchClips`).
  The engine stretches in `AudioStream` on its reader thread with Signalsmith Stretch (MIT, fetched by
  CMake, seeded so renders repeat), sought so the first sample out is the file's at its start: nothing is
  late (`stretch.integration.test.ts`). Detect tempo is `POST /api/engine/tempo` (`server/music/tempo.ts`,
  on the platform's `server/beats.ts`).
- **Song mode** (PAT / SONG, L): `useTransport.mode` (not saved: a song with clips opens in song mode),
  with a start tick per mode; `switchMode` sends the engine the other song and carries on playing.
  `compileSong(..., "song")` flattens the arrangement into notes (a clip plays nothing past its pattern;
  notes cut at its end; a note a slice went through plays from the slice) and lists `audioClips`; the loop is
  the song (to its last clip's bar) or the Playlist's time selection. The engine streams audio clips
  (`ClipPlayer`): streams are made ahead on the message thread, each for a play (`generation`) and a pass
  round the loop, and started on their sample; keep that when adding to it. `playhead.ts` says where the
  shown pattern is inside the song, for the rack's lights and the Piano roll's playhead.
- **The Browser** (`docs/fl-studio/browser.md`, Alt+F8): the user's own sample folders (its Files tab), global, not the
  song's (`data/browser.json`, `server/music/browser.ts`; the tab's open folders and width are localStorage).
  The server reads nothing outside the folders added. It's a panel kept on the desktop's left
  (`browser/browser-panel.tsx`), outside the `Desktop`, so the windows keep to the room beside it; e2e
  tests that measure windows open songs with it closed. A file reaches a song as project media through
  `POST /api/browser/use` (copied once, by `origin`); a drag of its files carries their paths
  (`BROWSER_DRAG_TYPE`), and every drop target goes through `browser/drops.ts`, which takes Finder's files
  too. Previews are the engine's `FilePreview` (streamed), not the song's. Its **Online** tab (`browser/online-tab.tsx`)
  searches YouTube or takes a pasted link (the platform's `server/web-media.ts`, yt-dlp): wherever the Browser hands
  a sample round it's a string, a file's path or a clip's URL (`browser/online.ts`), and `/api/browser/use` and
  `/preview` take either (`url`), so a clip is dragged, sent and previewed as a file is. The download is kept in a
  format the engine reads (else made a WAV) and copied into the project once (`MediaAsset.origin`). e2e plays
  yt-dlp with `e2e/fake-ytdlp.mjs`.
- The starter kit (`public/kit/`, made by `scripts/make-kit.ts`) becomes ordinary project media when it's added.
- **Exporting** (`docs/fl-studio/export.md`, ⌘R / ⌘⇧R; `src/suites/music/export/`): the save dialog
  (`chooseSaveFile`, the desktop app's; a browser downloads instead), then the window, then
  `/api/music/exports` (`server/music/exports.ts`): the engine renders 32-bit float WAVs (the mix, and a
  stem per track) and ffmpeg encodes each format; MIDI is written from `compileSong`. The engine renders
  in the running engine (its plugins are loaded): it lets go of the device, plays a copy of the song once
  (`Song::loops` false) with a sequencer of its own, plugins prepared for blocks of 2048, told they're
  offline and run on every core (`Sequencer::setWorkers`; the mixer in `Song::stages`), then gives the
  device back. Meanwhile the tab edits on (`useTransport.exporting` stops play), and songs sent wait for
  the end. The song's plugin delay is trimmed and stems held back to the master's lateness: they add up
  to the mix, sample for sample (tested). Parallel and one-thread renders are identical (tested); keep
  it so: a stage's tracks touch only their own buffers, sends are added in order after. The mix is floating
  point and can go over full scale and still sound clean live (the system volume turns it down first); a
  file would clip, so a render that goes over is turned down as a whole (`exportGain`, `preventClipping`).
  Wrap remainder renders ringing out, then adds the tail onto the start (`server/music/wrap.ts`).
- **Automation** (`docs/fl-studio/automation.md`; `shared/music/automation.ts`, `src/suites/music/automation/`):
  an automation clip (`MusicProject.automations`) is a curve for one control (`AutomationTarget`: a
  channel's volume or pan, a mixer track's fader, pan or stereo separation, a send, an effect's mix, the
  main volume, a plugin's parameter by the id the plugin gives it); its clips on the playlist
  (`kind: "automation"`) share it. **It plays in song mode only**, and what a control is at a tick follows
  from the song alone (`controlAt`): its own value before its first clip, the curve inside one (the latest
  started wins), the last value after one. `compileSong` turns it into lanes in the engine's units (a
  channel's gains, a track's matrix...), sampled within a thousandth; the engine plays them in slices of
  256 samples counted from where play started (`Sequencer::applyLanes`), so live and exported sound the
  same whatever the blocks: keep any new lane kind on that grid. A control held by the hand is left out
  (`SetSongRequest.held`, from `useAutomatedControl`'s hold/release); a plugin's own value is taken when play
  starts and given back when it stops. A knob or fader that can be automated takes a `target`
  (`SongKnob`'s), which gives it Create automation clip and has it follow the curve in song mode (a knob
  that turns by its automation's fraction, a tapered one, says `fraction`). Its curve is edited on its
  clips in the Playlist (`curve-pointer.ts`, a `curve` drag committed once). **Every knob of our built-in
  effects is automatable**, as a plugin's every parameter is: a new knob in one gets a `target` (its
  control in the effect's `AutomationTarget` kind, a spec saying its range, taper and text, the engine
  lanes it moves), and `e2e/music.spec.ts` right-clicks every slider of every built-in's window to check
  it. Touching one shows **Automate "…"** in its window's title bar (`AutomateTouched`,
  `useAutomationUi.touchedControl`), as a plugin window's does. An engine lane holds up to
  `Song::Lane::maxSize` (64) values a point. FL's Step and Slide modes are the
  Playlist store's `curveStep`/`curveSlide`. **Tempo automation** (`shared/music/tempo.ts`): the engine
  keeps the song's own tempo and is sent a song warped through the tempo clips (`warpSong`); the server's
  `SongClock` converts every tick crossing to or from the engine, so the tab and the document only ever
  hold the song's ticks. Seconds from a tick in song mode: `songSeconds`/`engineTick`, never
  `secondsPerTick` alone.
- **Recording** (`docs/fl-studio/recording.md`, FL's through mixer tracks): a track's `input` (a device
  channel or a pair), `monitor` and `inputOffset` are the song's; **which tracks are armed, Record (R) and a
  recording in progress are the tab's** (`recording.ts`), sent with the song (`SetSongRequest.armed`). Settings
  opens an input device (and the desktop app asks for the microphone first: the engine opens no input until
  one is chosen). The engine adds a monitored input into its track before the effects, and `Recorder`
  writes each armed track's dry input: files opened ahead on the message thread, written through a
  `ThreadedWriter`'s FIFO, switched to a spare on the sample a loop goes round (plus the latency), never
  opened or closed on the audio thread; keep it so. Play with a count-in holds the transport while it
  clicks; without Loop record the song doesn't wrap while recording (`through`). Finished takes come as
  `take` events; the server makes them the project's media (`adoptTake`), and `addTakes`
  (`shared/music/recording.ts`) places them, the latency left out (`takeWindow`), a recording's takes one
  undo step. A Playlist track can be an insert's audio track (`PlaylistTrack.mixerTrack`): its takes land
  on it. The transport doesn't import the recording store (a cycle through the song's store): recording
  registers itself with it (`setRecorder`). Offline tests feed a WAV as the device's inputs (`render`'s
  `input`). If the engine dies mid-recording, the server mends the takes it was writing
  (`server/music/take-repair.ts`) and hands them in itself (`AudioEngine.salvage`).
- **MIDI input** (`docs/fl-studio/midi.md`): the engine listens to every MIDI input not turned off
  (`MidiInputs`, `midi.json` in its data folder) and plays it on the **MIDI target**, the rack's selected
  channel (`midiTarget`, sent by `src/suites/music/midi.ts`; packed with the song's serial so a song
  handed over meanwhile keeps it). Messages reach the audio thread through a lock-free queue (MIDI's
  threads take a spin lock among themselves only); a key's note off goes to the channel its note on did.
  `midiIn` puts messages in the same queue: the typing keyboard (Ctrl+T, `typing-keyboard.ts`) and the
  tests play that way, so everything played is lit and recorded alike. What was played comes back as
  `midi` events with the engine's tick; while recording (Record with nothing armed records notes alone)
  the tab keeps them, and on stop `recordedNotes`/`addRecordedNotes` (`shared/music/recording.ts`) make
  them one undo step in a pattern placed where recording started. Tested offline in
  `server/music/midi.integration.test.ts`.
- **Built-in effects** (Gross Beat, EchoBoy, Auto-Tune, Pro-Q, OTT, Pro-C, YT-L, PanMan, Pitch Wheel, Reverb):
  read [`docs/claude/music-effects.md`](music-effects.md) before touching one.
- **Extract stems and Convert to notes** (`docs/fl-studio/stems-and-notes.md`; an audio clip's menu, an audio
  channel's in the rack, `extract_stems` / `convert_to_notes`): models run on this computer, downloaded once when the
  user says yes (`shared/music/models.ts`, on the platform's `shared/models.ts` + `server/models.ts`, which the photo
  suite's use too). **The server runs them**, a job a process (`server/music/ml-worker.mjs`, ONNX Runtime's native
  build; the desktop app ships it bundled with the library beside it); `server/music/stems.ts` splits a file with
  HTDemucs into stems that become the project's media (reused by `origin`), `server/music/hearing.ts` gives Basic
  Pitch's activations and drum measurements once a file. **Picking notes is the tab's** (`shared/music/transcribe.ts`:
  `pickNotes` is Basic Pitch's own note creation, held to its Python's output by `transcribe-fixtures.json`; change
  both or neither), so the window's settings answer at once; `shared/music/stems.ts` (`placeStems`) and `convert.ts`
  (`convertedParts`, `addConvertedPattern`) are the edits, one undo step each. Stems play into the master and the
  original clip is muted; notes go on a plain sampler (the kit's `tone.wav`) to be replaced. e2e sets
  `EDITOR_MUSIC_MODELS=stand-in`; `ml-worker.integration.test.ts` runs the real models once they're downloaded.
- **Resampling** (`engine/src/Resampling.h`; Settings' Quality): how samplers and audio clips read between
  samples. Playback's choice (Hermite by default) comes with each song (`SetSongRequest.resampling`), the
  export's (sinc) with the export. Every method is centred: a hit is never late (tested).
- **Audio intelligence** (the assistant's ears and hands: snapshots, artifacts, evidence, jobs, runs, vocal mix,
  datasets): read [`docs/claude/audio-intelligence.md`](audio-intelligence.md) before touching it.
- **Serum presets** (`docs/serum/`, the `serum-presets` skill in `.claude/skills/`): we design Serum 2 presets in
  Théo's taste and he scores them round by round. `server/music/serum/` reads and writes `.SerumPreset` files (Xfer's
  container, Serum's CBOR) from a readable spec (`preset-format.md`); `taste.md` is the research on his 118 starred
  presets; his verdicts are in `data/serum-research/feedback.md` (git-ignored, the main checkout's). Serum runs in
  the offline engine to check a preset (`scripts/serum-readout.ts`) and to render a round (`scripts/serum-audition.ts`).
  **The Serum player** (`docs/serum/player.md`, step by step): a Serum 2 channel's window is ours
  (`src/suites/music/serum/`; Settings › Music can turn it off, `serumPlayer`: ask `opensSerumPlayer`, never
  `isSerum2`, for which window a channel opens): Serum's library in one list (`server/music/serum/library.ts`, its ratings Serum's own),
  presets loaded by a drop on Serum's invisible window, more folders listed with Serum's (Settings › Music:
  `data/serum-library.json`, each preset once by its hash), the sound saved as a preset in Serum's `User` folder
  (never over a factory, pack or Serum 1 one; Serum then told it has it on), the macros live, the mod matrix, envelopes and LFOs
  (`modulation.tsx`, `envelopes.tsx`), the effect racks (`effects.tsx`: every effect's measured units and which knobs
  get the racks' 16 host slots are `shared/music/serum-effects.ts`; every state the player loads links them).
  **Serum's state is the truth**: the server reads what the player shows out of it (`server/music/serum/sound.ts`),
  writes reload edits onto it (`editSerumBody`) and keeps beside it only what Serum's re-save drops
  (`plugins/<channel>.serum.json`: the preset's macro names, handed back with every state it loads). A live control is Serum's own parameter (`shared/music/serum-sound.ts`: ids and the measured mappings);
  everything else is a reload through the engine's `swapState`. The player has its own undo (the server's
  `SerumPlayer`, per channel: states for loads and reloads, control positions for drags), not the song's. Its plan
  says what Serum takes live, what a reload does, and what's built so far.
- The assistant's tools: specs in `shared/music/tools.ts`, handlers in `src/suites/music/tools.ts`, and their
  edits as pure `(song, input, env) => { song, text }` in `tool-edits.ts` (tested); the mixer's in
  `mixer/tool-edits.ts` (`findTrack`: by id, number, "master" or name; `describeMixer` is `get_mixer`). Channels
  and patterns can be named by id or by name. `describeSong` (`context.ts`) is what `get_song` returns.

## The audio engine

The native engine (`engine/`, C++/JUCE: threads, the mixer, samples, offline renders, plugin windows) is
[`docs/claude/music-engine.md`](music-engine.md): read it before touching `engine/` or `server/music/engine.ts`.

## Commands

```bash
pnpm tsx scripts/pro-c-sheet.ts [style ...] [--out f.png]           # Pro-C's styles measured on the engine: curves, gain, colour
pnpm tsx scripts/engine-profile.ts <Name.ytsng> [--only-plugin n] [--sample]   # a song's playback load, offline (silent)
pnpm engine:build # the music suite's audio engine (C++/JUCE) into engine/build; needs cmake + ninja (brew)
pnpm tsx scripts/make-kit.ts   # synthesise the music suite's starter kit (and Convert to notes' tone) into public/kit/
pnpm tsx scripts/make-audio-fixtures.ts [--out dir]   # the audio-intelligence fixtures as WAVs + a manifest (tests render them in memory)
pnpm tsx scripts/serum-preset.ts read|write|verify …   # Serum 2 presets ⇄ readable specs, checked in Serum offline (docs/serum/preset-format.md)
pnpm tsx scripts/serum-audition.ts <session.json>   # render a round of Serum presets as an audition page (the serum-presets skill)
pnpm tsx scripts/select-mixparams.ts   # MixParams' reviewed reference subset into the gitignored data/ (docs/audio-intelligence/)
python3 scripts/audit-cl1b.py <Dataset.zip> --out <report.json>   # CL 1B's layout, read statically: never unpickles
.venv/bin/python -I scripts/basic-pitch-fixtures.py shared/music/transcribe-fixtures.json   # Basic Pitch's own note picking (pip install basic-pitch)
```

## Layout

```
music/             The music suite: its document (types.ts), create/normalise (project.ts), its pure edits
                   (edits.ts; the playlist's in playlist.ts), automation (automation.ts: curves, what a
                   control is at any tick), the song as the engine plays it (compile.ts:
                   swing, gains, mutes, song mode's arrangement flattened, automation as lanes), its tools
                   (tools.ts), the audio engine's commands, status and events (engine.ts), the
                   Browser's types and search (browser.ts: pure, ranked, typo-tolerant), and the
                   export's settings, file names and ffmpeg arguments (export.ts) and MIDI file (midi.ts),
                   and recorded takes into the song (recording.ts: where they land, the latency left out),
                   Gross Beat (gross-beat.ts: its slots, edits and envelopes for the engine; its presets in
                   gross-beat-presets.ts), EchoBoy (echo-boy.ts: its edits, controls and delay lines for the
                   engine; echo-boy-styles.ts its 31 styles, echo-boy-library.ts its presets), Auto-Tune
                   (auto-tune.ts: its edits, Detect key, what the engine plays; scales, presets and ranges in
                   auto-tune-presets.ts), Pro-Q (pro-q.ts: its edits and what the engine plays; pro-q-filters.ts:
                   its shapes as analog sections, curves, Auto Gain; pro-q-presets.ts), PanMan (panman.ts: its patterns,
                   edits and what the engine plays; panman-presets.ts: its constants, validation and presets),
                   Pitch Wheel (pitch-wheel.ts: its edits, the wheels' physics
                   `stepWheel`, what the engine plays; defaults, presets and ranges in pitch-wheel-presets.ts),
                   the Reverb (reverb.ts: its edits, T60s, what the engine plays (`engineReverb`), its lanes;
                   reverb-modes.ts: the modes and eras as data; reverb-presets.ts: ranges, validation, presets),
                   stretching audio clips (stretch.ts: modes, speeds, the tempo a file was made at),
                   and drawing anything over time as lines for the engine (sampling.ts).
                   audio-intelligence/ is the assistant's hearing foundations (see `docs/claude/audio-intelligence.md`);
                   hash.ts is the pure SHA-256 and canonical JSON everything there is identified by;
                   mix-reference.ts is MixParams' reviewed subset (a research reference, never executable settings).
server/
  music/             The music suite's server side. engine.ts: AudioEngine runs the audio engine's process, JSON
                     lines over its stdin/stdout, restarts it when it dies (and gives it its song back), compiles
                     the song it's sent. routes.ts: `/api/engine`. fake-engine.mjs stands in for it in tests (and
                     the e2e suite). wav.ts reads and writes WAVs for the tests of what it plays.
                     browser.ts: the Browser's sample folders (global, `data/browser.json`), favourites,
                     listing and the watched search index; `/api/browser` reads nothing outside them.
                     exports.ts: song exports (`/api/music/exports`): the engine renders, ffmpeg encodes.
src/
  src/suites/music/   The music editor: store.ts (the song, undo,
                     autosave), ui.ts (selection, which windows are open and where), engine-sync.ts +
                     transport.ts (the engine follows the song; where it's playing), window.tsx (`MusicWindow`
                     and `MusicDesktop` on the platform's windows), channel-rack.tsx, rack-actions.ts (what its menus and keys do),
                     channel-settings.tsx (a sampler's window), channel-picker.tsx (the +: choose an
                     instrument), knob.tsx, lcd.tsx, waveform.ts, browser/ (the Browser, Alt+F8: a panel
                     kept on the desktop's left; its rows and keys are pure, tree.ts and keys.ts),
                     pattern-picker.tsx, gross-beat/ (Gross Beat's window, its mapping panel and tools), echo-boy/
                     (EchoBoy's window, Tweak, the Style Editor, Rhythm Echo's editor, its tools),
                     auto-tune/ (Auto-Tune's window, its live pitch graph and tools),
                     pro-q/ (Pro-Q's window: its display, gestures, band controls, analyzer, EQ Match, tools),
                     ott/ (OTT's window: its knobs, its display of a row a band, tools),
                     panman/ (PanMan's window, its editors, meters and tools),
                     pitch-wheel/ (Pitch Wheel's window: its dials and keyboard on canvases, what the engine
                     says in live.ts, its tools), reverb/ (the Reverb's window: its Decay and Shape displays,
                     knobs, the advanced and vocal panels, what the engine says in live.ts, its tools),
                     toolbar.tsx (FL's toolbar: transport, PAT / SONG (mode-switch.tsx),
                     tempo and position LCDs, the hint bar; its maths in position.ts), recording.ts (armed
                     tracks, Record, takes into the song) and inputs.ts (the input device's channels), midi.ts
                     (MIDI keyboards' target, the keys held, the typing keyboard), playlist/ (the
                     Playlist, F5: see above), automation/ (automation clips: see above),
                     playhead.ts (where the song and the shown pattern
                     are now), settings.tsx (its section of Settings: the device, and
                     engine-panel.tsx, the plugin bench), keys.ts, api.ts, and the assistant's side (tools.ts, tool-edits.ts,
                     context.ts).
```

## How to add something to the music editor

- **Something to the music editor**: the field in `shared/music/types.ts`, validated in `project.ts`
  (`normalizeMusicProject`, or it's dropped on load and save); a pure edit in `edits.ts` (tested); what it means to
  the sound in `compile.ts` (tested) and, only if the engine must do something new, `engine/src/Song.cpp` (parse)
  and `Sequencer.cpp` (play), with a test in `sequencer.integration.test.ts`; the UI in `src/suites/music/`; a tool
  for the assistant; and a test in `e2e/music.spec.ts`. The stand-in engine (`fake-engine.mjs`) must answer any
  new command.

## Gotchas

- The audio engine: `EDITOR_ENGINE_PATH` (default: `engine/build/...`, else the packaged app's resources) and
  `EDITOR_PLUGIN_PATHS` (extra VST3 folders; default: the test synth's build folder). The e2e suite sets the first to
  `server/music/fake-engine.mjs`, so tests never make a sound or depend on this computer's plugins.

