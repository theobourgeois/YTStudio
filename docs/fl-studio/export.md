# Exporting (rendering) a song

How FL Studio exports a song to an audio file, from the manual (`fformats_save_export.htm`, with bits of
`menu_file`, `basics_shortcuts`, `playlist` and `plugins/wrapper`) and Théo. See [README.md](README.md) for
the sources. The last sections are ours: [what's decided](#decided-with-théo-2026-10-01) and [how we'd build it](#how-wed-build-it).

## What it is

- **Rendering**: FL plays the song (or a pattern) **as fast as it can, not in real time**, and writes the
  sound to a file. The time it takes "depends on export settings and project complexity". The manual says a
  render usually sounds *better* than live playback, because plugins and resampling can use their
  high-quality modes.
- **What's rendered is the master track**. A mixer track that doesn't reach the master, directly or
  through sends, isn't in the file. The exception is **Split mixer tracks**, which writes a file per track
  (stems).
- Formats: **WAV, MP3, OGG, FLAC, M4A** (audio) and **MID** (the notes, not sound). Several can be ticked
  at once, and one render writes them all.

## Opening it

| Key | What |
| --- | --- |
| Ctrl+R | Export a WAV file |
| Ctrl+Shift+R | Export an MP3 file |
| Ctrl+Shift+M | Export a MIDI file |
| File → Export → Wave / mp3 / ogg / MIDI file… | The same |

**First a save dialog** asks where the file goes and its name (the project's name by default). **Then the
export dialog** opens with that format ticked. Its title says what's being written:
"Rendering to untitled.wav/.mp3/.ogg/.flac/.mid". Nothing is rendered until **Start**.

## The dialog

![The export dialog](img/export_dialog.png)

Five folding sections from top to bottom, then a progress bar and the buttons.

### Project type

- **Mode**: **Song** (the Playlist) or **Pattern** (the current pattern). It starts on whichever mode the
  transport is in.
- **Tail**: what happens to sound still ringing after the end (reverb, delay, a long release):

  ![Tail options](img/export_remainder.png)

  - **Leave remainder** (the default): the render goes on past the end until the tail has died away.
  - **Wrap remainder**: for loops. The tail is mixed back onto the start of the file, so the loop plays
    seamlessly. It renders the last bar first and folds what rings past it into the start. A tail from
    notes before the last bar isn't wrapped.
  - **Cut remainder**: the file stops exactly at the end.
- **The length**, worked out in this order:
  - **Song mode**: 1. a time selection on the Playlist, if any; 2. else the last time marker past the
    last bar with something in it; 3. else the end of the last bar with something in it; 4. plus the tail.
  - **Pattern mode**: 1. the last time marker past the pattern's last bar with data; 2. else the end of
    that bar; 3. plus the tail.
  - If Leave remainder cuts a tail off anyway, a **Repeat time marker** placed later extends the render
    to it.
- **Length** (bars), **Total time** (H:M:S) and **Disk space** (every ticked format added up) are shown
  read-only.

### Output format

- A light per format: **WAV, MP3, OGG, FLAC, MID, M4A**. Tick several to write them all in one render.
- **WAV bit depth**:
  - **16-bit int**: CD quality, plays everywhere.
  - **24-bit int**: for older DAWs and hardware.
  - **32-bit float**: FL's own mix format, for more editing elsewhere.

  **Channels**: Stereo, Mono (merged), Mono (left only) or Mono (right only).
- **MP3 / OGG / M4A bitrate**: a slider. MP3 goes up to 320 kbps, OGG to 450. The manual's guide:
  - 128 kbps: acceptable;
  - 160 kbps: hard to tell from a CD;
  - 224 kbps and up: practically indistinguishable.

  MP3 only supports 32, 44.1 and 48 kHz. It also adds a little silence at the start, so it's no good for
  loops.
- **FLAC**: 16 or 24 bit, and a compression level from 0 to 8 (5 is the default). The output is the same
  at every level: a higher level only makes the file about 10% smaller and takes longer to encode.
- **The sample rate isn't in the dialog**: it's the project's rate, from the Audio settings.
- **MID**: writes the notes. For a whole song, the project first has to be turned into MIDI Out channels
  (a macro). The Piano roll has its own "Export as MIDI file".

### Quality

- **Resampling**: how samplers and audio clips interpolate when they play a sample at another pitch or
  rate:
  - **Linear** (fastest, aliases when pitched far);
  - **6-point Hermite**;
  - **16- to 512-point sinc** (better and slower).

  Live playback has its own setting, so the two can sound different.
- **HQ for all plugins**: FL's own plugins switch to their high-quality modes. For VST/AU plugins, the
  wrapper option **"Notify about rendering mode"** (on by default) tells the plugin it's rendering offline,
  so plugins that have a better offline mode use it.
- **Disable maximum polyphony**: ignores channels' voice limits for the render.
- **Dithering**: shaped dither when going down to 16 bits (WAV and MP3). The manual says it only matters
  in very quiet passages.

### Miscellaneous

- **Save playlist markers / loop markers / note markers**: write markers into the WAV, as slice points or
  loop points, from the Playlist's time markers, the loop, or every note start.
- **Save tempo information**: the tempo in the WAV's metadata.
- **Split mixer tracks** (stems): every mixer track that's used, written to its own WAV, in the same
  render.
  - **Include**: Master, and/or the current track.
  - **WAV only**, not MP3, OGG or FLAC.
  - Muted tracks are skipped.
  - The master's effects are only on the master's file. "Export all playlist tracks" (below) is the way to
    get stems through the master.
- **Trim PDC silence** (on by default): removes the plugin delay compensation's silence from the start of
  the file, so the song starts at sample 0.
- **Enable insert effects** / **Enable master effects**: include the mixer tracks' effects, and the
  master's, in the render. Both are on for a normal export. They mostly matter when bouncing (below).

### Upload to cloud

- Upload straight to SoundCloud (title, description, public or private).

### The buttons

- **Show file(s) when complete**: opens the folder afterwards.
- **Render minimized**: FL minimises and renders in the background.
- **Start** (becomes **Abort** while it renders). The bar at the bottom shows the progress, in bars.

## Related, elsewhere in FL

- **Export all playlist tracks** (Playlist → Tools): solos each Playlist track in turn and renders it,
  **through the master**. This is the other kind of stems. **Export all playlist track groups** does the
  same per group.
- **Consolidate** (freeze), **Render as audio clip**, **Render and replace**: render clips or patterns to
  an audio clip in the song, with these same render settings. These are bouncing, not exporting.
- **Alt+R** in the Mixer: renders the *armed* mixer tracks to WAV.
- **Master (FL Cloud)**: AI mastering to a loudness target (LUFS), an online service.
- **Command line**: `FL -R -Emp3 project.flp` renders without opening the window (batch export).

## Decided with Théo (2026-10-01)

1. **A save dialog first**, as FL's: where the file goes and its name (the song's name by default), then
   the export window. In the desktop app it's the Mac's own save dialog; in the browser, the file is
   downloaded when the render ends.
2. **Formats: WAV, MP3, FLAC, OGG, M4A and MIDI**, several in one render. Stems can be written in any of
   them, not only WAV as in FL.
3. **MIDI matters**: the whole song's notes, a MIDI track per channel. No FL-style "turn the channels into
   MIDI Out first": we write it from the document.
4. **The tail is a choice**: **Cut at the end** (the default: the file ends where the Playlist's last bar
   does) or **Let it ring out** (the render goes on until the output has been silent for a moment, up to
   a limit). No Wrap remainder for now.
5. **Plugins render in their high-quality offline mode, always** (FL's "Notify about rendering mode").
6. **Editing the song while it exports** would be ideal, and FL can't do it. See
   [editing while it renders](#editing-while-it-renders): edits are free; hearing them waits for the
   render to end.

7. **The sampler's resampling** (how a sample is played at another pitch or rate; today linear, which
   adds faint aliasing to bright sounds pitched far): **a better method everywhere**, live too, and the
   best (sinc) in exports. The quality can be chosen, in Settings and in the export window. Tested: the
   aliasing measured, and every hit still landing on its sample (the interpolator's delay compensated).
8. **Editing while it exports: yes** ([how](#editing-while-it-renders)).
9. **The rest as suggested** (Théo: "happy with those"):
   - **The window**: the export is a window on the music desktop, opened by **⌘R** (WAV ticked) and
     **⌘⇧R** (MP3), after the save dialog.
   - **What's rendered**: Song or Pattern mode, starting on the transport's mode. The length is the
     Playlist's time selection, else the end of the last clip's bar. Length, total time and disk space are
     shown.
   - **Formats**: WAV 16 / 24 / 32-bit float (24 by default), MP3 320 kbps by default (a slider), FLAC 16 /
     24 bit; stereo only; the engine's sample rate; dither off, a switch for 16-bit files.
   - **Stems**: Split mixer tracks, one file per mixer track that has sound, from the same render, named
     "<song> - <track>". Muted tracks are skipped; the master is included if ticked. The plugin delay's
     silence is always trimmed.
   - **Other settings**: no insert / master effects switches, WAV markers, tempo metadata or SoundCloud
     upload yet. A "Show in Finder" switch; the last settings remembered across songs.
   - **The assistant**: an `export_song` tool now; bouncing later.

**Every step is tested**, latency included (the plugin delay trimmed to the sample, stems lined up with
the mix), and committed as it's done (Théo).

## How we'd build it

The plan, so the decisions above can be weighed against it. It's written for speed: Théo wants exports to
be very fast.

- **Render in the engine that's running.** Its plugins are already loaded with their settings, so there's
  nothing to reload. A second, offline engine would spend seconds loading each Serum or Pro-R before
  making a sound. The engine leaves the audio device, tells every plugin it's rendering offline
  (`setNonRealtime`), renders on a thread of its own in big blocks (about 4096 samples), then goes back to
  the device. The live engine reads audio clips through its reader thread, so it gets a mode where the
  rendering thread decodes them, as the offline engine already does.
- **Plugins in parallel.** The tracks' order (`trackOrder`) already says which tracks depend on which.
  Every channel's instrument and the effects of tracks that receive nothing from other tracks run at the
  same time on a pool of threads. Then the tracks they send to, then the master. This is what makes songs
  heavy on plugins fast: roughly the number of cores (8–10 on an M-series Mac), up to the slowest single
  chain. Live playback can use it later (it needs real-time threads), so more synths play without
  dropouts.
- **Straight to disk.** WAVs are written as they're rendered: no limit on length, little memory. MP3 (and
  FLAC) are encoded by ffmpeg *while* rendering, through a pipe, so encoding adds almost nothing. Stems are
  each track's sound after its fader, written from the same pass.
- **Progress and abort**: the engine reports how far it is about every half second (an `EngineEvent`); the
  window shows it as FL's bar does, and Abort stops it at once and deletes the partial files.
- **The same song as playback**: `compileSong` in the mode chosen, with the loop turned off and the end
  where the length says, so a render is exactly what's heard.
- **Tested** as the engine's sound already is: offline, with the test synth and test effect, checking the
  length, the tail, the trimmed delay, that stems add up to the mix, and the time it takes
  (`server/music/export.integration.test.ts`). The window and the tool go in `e2e/music.spec.ts`, against
  the stand-in engine.

### Editing while it renders

FL locks the song while it renders. We can do better, because the song lives in the tab, not in the
engine:

- **The render plays a copy.** On Start, the engine renders the song as it was at that moment. Edits
  made afterwards (notes, clips, the mixer, new channels) go on as usual: undo, autosave, everything. The
  engine keeps the newest song aside and switches to it when the render ends, so the edits never reach
  the file being written.
- **What you can't do meanwhile is hear it.** Play and the previews (the Piano roll's keys, the
  Browser's files) wait until the render is done, because the render is using the engine's plugins. A
  quick render makes that a few seconds.
- **Plugin windows are the catch**: a knob turned inside Serum *during* the render would change the
  render, since it's the same instance. So plugin windows are hidden while it renders and come back
  after.
- **Playing while it renders** would need a second engine with its own copy of every plugin. That means
  loading them all again (seconds each for Serum) and sharing the CPU with playback, so the export gets
  slower. It's possible later as a "render in the background" option, but it works against "really
  fast".

**Expected speed** (estimates for a 3-minute song, to be measured first with a benchmark):

| Song | One thread | In parallel |
| --- | --- | --- |
| Samples only | about 1 s or less | the same |
| 4–6 Serum 2 + Pro-Q / Pro-R | 20–60 s | 5–10 s |
| 15+ synths, reverbs on sends | over a minute | 10–20 s |

Plugins' offline-quality modes (always on, decided) can make a render slower than playing it live. That's
the price of FL's better-than-live render.

## Where Vaudio differs

Not built yet. This section is filled in once it is.
