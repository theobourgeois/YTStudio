# The audio engine (the music suite)

Read the music suite's guide (`docs/claude/music.md`) first.


- Plugins are native code, so sound can't be made in the tab: the engine (`engine/`) is a native program the server
  starts on the first `/api/engine` call. It owns the audio device and the plugins, and opens plugin editors as
  windows of its own. The tab never gets audio, only a status (`EngineStatus`, polled: the meter, scan progress).
- The server talks to it in JSON lines (`shared/music/engine.ts`); the engine keeps stdout for that alone (plugins'
  prints go to stderr) and quits when its stdin closes. `protocol::send` never waits: a writer thread empties a queue
  into stdout, and plugins' prints (fd 1 and 2) go through a pipe of the engine's own into another (dropped past
  4 MB). In the desktop app the server reads them on the main window's thread, which on Windows can be waiting for
  the engine's message thread (its windows are the main window's own): the two must never wait for each other.
  If it dies (a plugin crashed), the next command starts it again; what was loaded is lost until the song's
  document drives it.
- Stop pressed while stopped (`stop { reset }`, and every stop with Settings' Reset plugins on stop) is
  FL's way to silence the effects' tails: `Engine::silence` lets go of the device as an export does,
  resets every plugin, drops our effects' states (each registry's `clear`) and the delay lines, and makes
  the song again from silence.
- **Swaps** (`HostedPlugin::Swap`, `PluginHost::swap`): what a plugin can't take while it plays (a whole new state,
  `setState`; files dropped on its window, `dropFiles`) waits until the audio thread has faded the plugin channel out
  (5 ms) and stopped processing it (`Sequencer::tendSwap`, `fadeSwap`); the message thread then does it, and the
  audio thread plays the notes still sounding again (`Pending` keeps their velocity) and fades it back in. So a
  plugin is never loaded and played at once, and nothing clicks (a bare `setStateInformation` cuts Serum's notes
  dead). Swaps are done by `swapTicker` live and between rendered blocks offline: offline, a swap only happens
  when something renders. `setParameter` sets a plugin's parameter as its window would (with a gesture, so
  automation lets go of it meanwhile). `dropFiles` (`MacWindow.cpp`, macOS) hands files to a plugin's view as
  Finder's drag and drop would, in a window made invisible, ignoring the mouse and moved under the pointer (Serum
  hit-tests the real pointer); it's how Serum 2 is given a Serum 1 preset. Tested on the test synth
  (`plugin-swap.integration.test.ts`) and on Serum 2 itself when it's installed (`serum-player.integration.test.ts`).
- **Scopes** (`Scope.h`, `ChannelScope`): the Serum player's display. While a player is open (`channelWatch`), the
  audio thread copies its plugin channel's own sound (before its mixer track) into a scope, and each transport event
  says its spectrum (Pro-Q's `eq::Spectrum`, 480 points), its newest 1024 samples and 256 stereo pairs, and its
  peaks (`scopes`). Approximate on purpose (a torn sample is a pixel, never a sound); an offline render's answer
  always carries them (`plugin-swap.integration.test.ts`).
- Hosted plugins are told where the song is (`PlayHead.h`): each sequencer (playback's, the export's) fills in a
  playhead at the start of every block from the song (tempo, time signature, position, playing, loop) and gives
  it to every plugin it plays, so their synced LFOs and delays follow the song. The tempo is the song's own (with
  tempo clips the engine plays a warped song at that tempo). Tested by `playhead.integration.test.ts`
  (VAUDIO_TEST_EFFECT_PLAYHEAD=report: the test effect puts out what it's told).
- Commands run on the engine's message thread; the audio callback never waits. A song reaches it through an
  atomic pointer and goes back through a lock-free queue to be deleted (`Sequencer::setSong`, `collectGarbage`);
  requests are atomics and queues; the plugin bench has a lock the audio thread only tries (a block goes out
  without the bench if it's busy). Keep it that way: no allocation, locks or I/O on the audio thread.
- Playback runs on several cores, as FL's does (`Workers.h`): each block's plugin instruments, then each
  mixer stage's tracks (where two have effects), are spread over real-time threads in the device's audio
  workgroup, the costliest first; the audio thread works too and spins until they're done. Nothing there
  locks or allocates (one atomic ticket hands the items out). Anything a track runs must touch only its own
  buffers and state, and what's added up is added in the song's order, so one thread and several sound the
  same to the sample (`playback-threads.integration.test.ts`; `VAUDIO_PLAYBACK_THREADS=1` turns it off).
  `scripts/engine-profile.ts` measures what a song's package costs to play, offline, and what each part costs.
- The mixer: a `Song` has its tracks in the order to run them (the master last) and allocates their buffers
  itself, when it's parsed on the message thread (`Song::audio`, as long as the engine's longest block).
  Voices and plugins render into their channel's track; `Sequencer::mixTracks` runs the tracks' gains and
  sends. The metronome is added after the master, outside the mixer. Gains glide over the first block of a
  new song: which track and send of the last song each one was is worked out in `setSong`, so the audio
  thread only copies by index. Meters: the audio thread raises each track's peak (after its fader) in
  atomics, and `takeMeters` takes them back to 0 for each transport event (`meters`, silent tracks left
  out) and for `render`.
- Samples are read whole into memory on the message thread and never dropped while the engine runs (`SampleCache`):
  a sounding voice holds a bare pointer to its sample.
  Long files are streamed instead (`FilePreview`, the Browser's preview so far): a `TimeSliceThread` decodes
  and resamples ahead into a ring the audio thread reads; offline, the rendering thread fills it. An audio
  channel's own preview (its waveform pressed) names its channel: the sequencer adds it where that channel's
  clips play (`ChannelFeed`), so it's heard through its mixer track's effects.
- `--offline` (`AudioEngine`'s `offline`) opens no device: `render` computes the next samples on request, as fast
  as it can, and measures them (or writes a WAV). `server/music/engine.integration.test.ts` tests what things
  *sound like* this way, with the real engine and the test synth, silently; it's skipped when the engine isn't
  built. Live and offline share one `Engine::process`, so add sound-making code there and test it offline:
  `server/music/sequencer.integration.test.ts` builds songs with the app's own edits, renders them to a WAV and
  checks where each hit lands, to the sample.
- A plugin's window is the engine's (`EditorWindow`), so it can't be inside the app's; it acts as if it were
  (`docs/fl-studio/plugin-window.md`): our own title bar; keys the plugin doesn't use come back as an `EngineEvent`
  "key" and the tab runs its editor-wide shortcuts (`resolvePluginWindowKey`: Space plays); and the desktop app
  tells the engine about itself (`HostWindow`, `followByPluginWindows` in `electron/main.ts` →
  `PluginHost::setHost`): plugin windows are at the **floating level**, the same as the app's own windows in the
  desktop app (the music editor's windows are windows of the system there, "Windows" in CLAUDE.md and `docs/windows.md`),
  so they stack among each other by use: a click raises whichever it lands on, and the rack can be in front of a
  plugin that is in front of the Playlist. While another program is in use they all drop to the ordinary level;
  they hide with the main window and move with it. The engine says when one of its windows is used (`EngineEvent`
  "editorFocus", and "foreground": the engine became the app in front) and raises one on request (`raiseEditor`;
  a request's parameters are flattened into the message with `id` and `cmd`, so a parameter can't be called `id`);
  `electron/stacking.ts` keeps the order of all of them and puts it back after the app was away. **On Windows**
  there are no levels: the desktop app sends its main window's HWND (`HostWindow.handle`), and plugin windows
  become that window's owned windows (`setWindowOwner` in `MacWindow.cpp`, the engine's one platform file): above
  it, not above other programs, minimised with it, no taskbar button (`EditorWindow::getDesktopWindowStyleFlags`).
  Owned across programs, the app's thread waits for ours, so slow work on the message thread holds
  `EditorWindow::whileBusy()` (plugin loads, editors made, presets and samples read): the windows belong to nothing
  meanwhile. Wrap any new slow message-thread work the same way.
- Keep it portable (it runs on Windows too): only JUCE's APIs, no macOS calls of our own, paths from the server.
  On Windows it's built with ASIO (Steinberg's SDK, fetched by CMake) and, until a device is chosen in
  Settings (`vaudioChosen` in its `device.xml`), opens an audio interface's own ASIO driver (`openDefaultDevice`):
  Windows' shared audio underreports its latency (takes land late) and clocks a USB interface's input apart
  from its output (crackles). Windows' drivers count the buffer in their output latency, Core Audio's
  doesn't (`outputLatency`).
- It's an app bundle (plugin windows need one) with no Dock icon, shipped in the desktop app's resources.
  The desktop app isn't signed, so loading other people's plugins needs nothing; once it's signed with the
  hardened runtime, the engine needs the `com.apple.security.cs.disable-library-validation` entitlement.
- JUCE is used under its free Starter licence (a personal tool); selling this changes that.

## Layout

```
engine/            The music suite's audio engine, a C++/JUCE program (CMake; JUCE is fetched into engine/build).
                     src/Engine.cpp: the device, commands, the real-time `process`. Song.cpp: a compiled song
                     and its samples. Sequencer.cpp: the transport, the sampler's voices, plugin channels'
                     notes, the metronome. Host.cpp: the song's plugin channels (instances, state files,
                     windows). Plugins.cpp: plugin scanning and the bench's two slots. FilePreview.cpp:
                     the Browser's preview, a file streamed from disk; Recorder.cpp: recording (armed tracks'
                     inputs to WAVs, through FIFOs a writer thread empties); MidiInputs.cpp: MIDI keyboards
                     (every input not turned off, into the sequencer's queue); AudioStream.cpp is that stream (a reader
                     thread, a lock-free ring; Signalsmith Stretch for stretched clips), and ClipPlayer.cpp plays the playlist's audio clips with it,
                     each started on its sample. Export.cpp: the export, rendered on a thread of its own
                     (Workers.h runs its plugins on every core, as it does playback's). GrossBeat.cpp: Gross Beat, a native effect
                     (its rolling buffer, envelopes, sync, HOLD). EchoBoy.cpp: EchoBoy, a native echo (its
                     lines, the style on each repeat; its filters, saturations, diffusers, LFOs in EchoDsp.h).
                     AutoTune.cpp: Auto-Tune, native too (YIN pitch tracking, Antares' correction,
                     formant-keeping PSOLA). ProQ.cpp: Pro-Q, native too (its bands, dynamics, modes);
                     EqDesign.cpp: its filters (analog sections matched to digital ones, run as SVFs);
                     Convolver.cpp: FIR filters by FFT; Spectrum.cpp: the analyzer's measurements. PanMan.cpp: PanMan, another (its pattern, chance,
                     triggers, dynamics, pan law, Analog Styles). PitchWheel.cpp: Pitch Wheel, native too
                     (phase-locked spectral shifting, a true envelope for the formants, the wheels' physics, notes
                     as voices). Reverb.cpp: the Reverb, native too (its two networks, early energy, ducker,
                     de-esser, eras, Freeze; its settings in ReverbSettings.cpp); ReverbNetwork.cpp: its late
                     network (a ring or a 16-line FDN, lossy all-passes, Thiran reads); ReverbEarly.h: its velvet
                     taps and small blocks; GraphicEq.h: Jot's absorption (a shelf, then a 10-band proportional
                     graphic EQ fitted by least squares). Resampling.h: reading between samples (linear, Hermite, sinc),
                     centred so nothing is delayed. Protocol.cpp: the JSON lines. One file per job: split a file rather than let it grow past a few hundred
                     lines. test-plugin/ has VST3s of our own to test with: a synth and an effect (a gain that
                     can also delay its sound and report it; tests set VAUDIO_TEST_EFFECT_LATENCY).
```
