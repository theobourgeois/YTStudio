# Exporting (rendering) a song

How FL Studio exports a song to an audio file, from the manual (`fformats_save_export.htm`, with bits of
`menu_file`, `basics_shortcuts`, `playlist` and `plugins/wrapper`) and Théo. See [README.md](README.md) for
the sources. The last sections are ours: [what to decide](#to-decide-with-théo) (Théo: tick or strike
each line) and [how we'd build it](#how-wed-build-it).

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

## To decide with Théo

Théo: tick (✅) or strike (❌) each line, or correct it. I've put my suggestion in bold.

**Getting there**
1. ⬜ **Ctrl+R / Ctrl+Shift+R open the export window** (FL's keys; on the Mac, ⌘R / ⌘⇧R).
2. ⬜ Where the file goes. Either **FL's way: a save dialog first** (the desktop app has a real one; the
   browser version downloads the file at the end), or always into one folder plus a "Show in Finder"
   button. **Suggest FL's**.
3. ⬜ **The export is a window on the music desktop** (like Settings), not a modal.

**Project type**
4. ⬜ **Mode: Song or Pattern**, starting on the transport's mode.
5. ⬜ **Length**: **the Playlist's time selection if there is one, else the end of the last clip's bar**.
   We have no time markers, so there's no "last marker".
6. ⬜ **Tail: Leave remainder** (the default), **Cut remainder**, and **Wrap remainder** (for loops). With
   Leave, we stop once the output has been silent (below −90 dB or so) for a moment, up to a limit of
   about 30 s. Wrap could come later.
7. ⬜ Show the length, total time and disk space.

**Formats**
8. ⬜ **WAV (16 / 24 / 32-bit float) and MP3 (bitrate slider, 320 kbps by default)** to start. Ticking
   both writes both in one render. FLAC (lossless, smaller) is cheap to add with ffmpeg. OGG and M4A only
   if you use them.
9. ⬜ **Stereo only**; no mono options.
10. ⬜ The sample rate: **the engine's (Audio settings), as FL does**. Or a choice in the dialog (44.1 /
    48 kHz), since we render offline and can render at any rate.
11. ⬜ MIDI export of the whole song: later, or never? The Piano roll's own "Export as MIDI file" is
    simpler and more useful.

**Quality**
12. ⬜ **Tell plugins they're rendering** (FL's "Notify about rendering mode", always on). Serum,
    FabFilter and the like can then use their offline-quality settings, which are slower but better.
13. ⬜ The sampler's resampling: ours is linear today. **Offer a better one (Hermite or sinc) for the
    export only**, or better resampling everywhere?
14. ⬜ **Dither: off by default**, a switch for 16-bit.
15. ⬜ Max polyphony: not needed. We have no per-channel voice limit (128 voices in the engine).

**Miscellaneous**
16. ⬜ **Stems = Split mixer tracks**: one WAV per mixer track that has sound, from the same single render
    (so stems cost about the same as one mix), named "<song> - <track>.wav". Muted tracks skipped. Plus
    the master if ticked.
17. ⬜ "Export all playlist tracks" (stems through the master): **later**.
18. ⬜ **Trim PDC silence: always** (the file starts on the song's first sample). Our engine already knows
    the song's delay (`songLatency`).
19. ⬜ Insert / master effects switches: **leave out** (always on), since they mostly matter for bouncing.
20. ⬜ WAV markers, tempo metadata: **later** (cheap if you want them for loops).
21. ⬜ Upload to SoundCloud: **no**. Publishing is planned for later, with the video editor's.
22. ⬜ **Show in Finder when done** (a switch, as FL's).
23. ⬜ Render in the background: **yes, by default**. The rest of the app stays usable while it renders,
    but the song can't be played or edited until the render is done (or should it be editable?).
24. ⬜ **Remember the last settings** (format, bit depth, bitrate, tail, stems) across songs, as FL does.

**Later, in other steps**
25. ⬜ Bouncing (consolidate, render as audio clip, render and replace): after export, with the same
    render path. Audio clips need fades and gain first.
26. ⬜ The assistant gets an **`export_song`** tool (format, mode, tail, stems), and `get_song` says
    where the last export went.

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

**Expected speed** (estimates for a 3-minute song, to be measured first with a benchmark):

| Song | One thread | In parallel |
| --- | --- | --- |
| Samples only | about 1 s or less | the same |
| 4–6 Serum 2 + Pro-Q / Pro-R | 20–60 s | 5–10 s |
| 15+ synths, reverbs on sends | over a minute | 10–20 s |

Plugins' offline-quality settings (item 12) can make a render slower than playing it live. That's the
price of FL's better-than-live render; a switch could turn it off for quick bounces.

## Where Vaudio differs

Not built yet. This section is filled in once it is.
