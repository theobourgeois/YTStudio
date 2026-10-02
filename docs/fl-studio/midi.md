# MIDI input and recording notes

How FL Studio takes notes from a MIDI keyboard (or the computer's keyboard) and records them, from the
manual (`envsettings_midi`, `recording`, `recording_scores`, `recording_step`, `toolbar_panels`,
`basics_shortcuts`) and Théo. See [README.md](README.md) for the sources. Recording audio is
[recording.md](recording.md); both share the Record button.

The last sections are ours: [what's decided](#decided-with-théo-2026-10-02), [how it's built](#how-its-built)
and [where Vaudio differs](#where-vaudio-differs).

## Playing

- **MIDI Settings** (Options → MIDI settings) lists the MIDI inputs found. Each is used once it's
  **enabled** (select it, click Enable); the MIDI activity light on the toolbar blinks when it sends.
  A *Controller type* picks special support for some keyboards; a generic one is "USB Audio Device".
- **Notes play the selected channel**: whichever channel is selected in the Channel Rack (its button
  clicked). Changing the Piano roll's target channel selects that channel too. FL lets a controller
  play several channels at once (by MIDI channel), which needs setting up per channel.
- **Velocity**: "Link note on velocity to: Velocity" (the default) sends the key's velocity on; [none]
  plays every note at 100. A curve shapes the response.
- **The sustain pedal** (CC 64) holds notes. "Foot pedal controls note off" makes it act as note offs.
- **Pitch bend, the mod wheel and other controllers** go to the plugin playing (and can be linked to
  any control with Link to controller, which we don't have).
- The keys played light up on the Piano roll's keyboard and the channel's activity light.

## The typing keyboard

**Typing keyboard to piano keyboard** (a button on the toolbar's recording panel; **Ctrl+T**) turns the
computer's keyboard into a piano for the selected channel. While it's on, those keys play notes rather
than run shortcuts (Ctrl and Alt combinations still run theirs). Its layout, FL's default *Piano*:

| Row | Keys | Notes |
| --- | --- | --- |
| Lower | Z S X D C V G B H N J M , L . ; / | C to E, an octave (and a bit) |
| Upper | Q 2 W 3 E R 5 T 6 Y 7 U I 9 O 0 P | C to E, the octave above |

The white keys are the letter rows and the black keys the rows above them, as on a piano. Its
right-click menu picks other layouts (scales, chords); we keep the Piano one.

## Recording notes

From `recording_scores`: notes are recorded "into the currently selected pattern" for the channel
selected in the rack.

1. Right-click Record: the recording filter has **Notes** on (the default).
2. Select the channel to record (click its button) and the pattern.
3. Record on (R), then Play (after the count-in, if it's on).
4. Play the keyboard. Notes appear in the channel's Piano roll (and its preview in the rack).
5. Stop.

- **Pattern mode**: the notes go into the selected pattern as it loops; each pass adds to it.
- **Song mode**: "The Pattern Clip will be automatically placed at the point where Playback started
  from after recording is stopped". An empty pattern clip placed beforehand says which track it's on.
- **Loop recording**: going round the loop (the pattern, or the song's time selection) keeps adding
  notes to the same pattern (overdub). Removing what's there is done by hand.
- **Quantizing**: the global snap. With it on (Step, Beat, Bar), notes are aligned as they're recorded;
  Line, Cell or (none) leave them as played. Record's right-click menu chooses what's aligned: the start
  only, the end only, both, or the start with the length kept (the note moved).
- **The Score logger** (Tools → Dump score log to selected pattern) keeps the last three minutes of
  what was played, recording or not, so a good take can be had after the fact.

## Decided with Théo (2026-10-02)

- **Recording notes is the song's, as recording audio is**: Record switches to song mode first (no
  recording in pattern mode). Notes go into a pattern placed where recording started.
- **Every MIDI input is used** once it's plugged in, unless turned off in Settings: there's no Enable
  step to forget. (Ours.)
- No per-note pan to plugins (MPE) for now.

## How it's built

- **The engine** (`engine/src/MidiInput.*`, `Sequencer`): it listens to every MIDI input not turned
  off (`juce::MidiInput`, re-listed when devices come and go) and keeps the user's choice in
  `midi.json` in its data folder. Messages from MIDI's own thread go into a lock-free queue the audio
  thread empties at the start of each block (the producers take a spin lock among themselves; the audio
  thread never waits). Notes play **the target channel** (`midiTarget`, the rack's selected channel), a
  plugin as MIDI and a sampler as a held voice that ends (its envelope's release) when the key is let
  go; a note off goes to the channel its note on went to. The sustain pedal holds a sampler's notes;
  plugins get the pedal, pitch bend and controllers as they come. `midiIn` puts messages into the same
  queue: the typing keyboard's notes and the tests' go the same way as a keyboard's.
- **What was played comes back** (`EngineEvent` "midi", with the transport events): each note on and
  off, its channel, and the engine's tick (into the loop) when it was played, and the pass round it.
  The tab lights the keys and, while recording, keeps the notes.
- **Recording** (`shared/music/recording.ts`, `recordedNotes`/`addRecordedNotes`; the tab's
  `recording.ts`): a recording with no armed tracks only records notes. Notes are put back in time by
  the output's latency (what was heard is what was played along to) and quantized as Record's menu
  says, with the Piano roll's snap (FL's global snap). When it stops, they become one undo step: into
  the selected pattern if it isn't on the playlist yet (else a new one), its clip placed at the bar
  where recording started, on the first track it fits on; or into a pattern clip of the selected
  pattern already there.

## Where Vaudio differs

| FL Studio | Vaudio |
| --- | --- |
| Each input is enabled by hand | Every input plays unless turned off (Settings → Music → MIDI inputs) |
| Controller types, ports, output, sync, Link to controller | Not yet |
| Velocity curve, [none] | Velocity as played |
| Foot pedal controls note off | The pedal holds notes |
| Recording in pattern mode | Not done (Théo): Record switches to song mode |
| Song mode records into the selected pattern | The selected pattern if it's not on the playlist yet, else a new one, so recording never changes clips already placed |
| Quantize from the global snap | From the Piano roll's snap (there's no global snap) |
| Several channels at once by MIDI channel, Score logger, step recording | Not yet |
| Typing keyboard layouts (scales, chords) | The Piano layout; `[` and `]` shift it an octave (ours) |
