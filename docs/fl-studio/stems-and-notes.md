# Extract stems and Convert to notes

Two things done to an audio clip by models that run on this computer: its file split into its parts (vocals,
drums, bass...), and the notes played in it written as a pattern.

## What FL Studio does

- **Stem separation** came in FL Studio 21.2 (2023): an audio clip's menu has *Extract stems from sample*,
  with drums, bass, vocals and "other instruments" to choose from, and the stems are laid out on the Playlist
  below the clip they came from. Image-Line's announcement leaned on its online service for speed and promised a
  local option. ([MusicTech](https://musictech.com/news/gear/fl-studio-21-2-stem-separation-daw/),
  [Routenote](https://create.routenote.com/blog/fl-studio-to-feature-stem-separation/))
- **Audio to notes** is Edison's: open the clip in Edison, then *Convert to score and dump to Piano roll* in its
  tools, which writes the notes it hears into the Piano roll of the selected channel and pattern. It works best on
  one instrument with clear attacks. ([Image-Line's forum](https://forum.image-line.com/viewtopic.php?p=2035119),
  [Pause Play Repeat](https://www.pauseplayrepeat.com/blog/2))

## Decided with Théo (2026-10-07)

- Both from an **audio clip's menu** (and an audio channel's in the rack), each in a small window.
- **Extract stems**: six stems to choose from (FL's four ticked the first time); what isn't chosen goes into
  Other, so the stems always add up to the song (Vocals and Other is an instrumental). The stems land **below the
  clip**, lined up with it, on tracks named after them, and **the original is muted** by default. They play into
  the **master**: routing them to the mixer is the user's call, not ours.
- **Convert to notes**: Melodic (any pitch) or Drums (kick, snare, hat). The notes go in a new pattern **on a
  plain sampler** (the starter kit's tone; the kit's kick, snare and hat for drums), placed under the clip: the
  user replaces the sampler with an instrument (the channel's Replace). The window draws the notes as its settings
  move, and Preview plays the clip with them.
- Models: **HTDemucs** (Meta's, MIT) for stems; **Spotify's Basic Pitch** (Apache 2.0) for notes. Both have open
  weights we may ship; the better-scoring BS-RoFormer weights and the full-mix transcribers (MuScriptor, YourMT3)
  are non-commercial or GPL, so not these.

## How it's built

- **The models** (`shared/music/models.ts`) are downloaded once per computer into `MODELS_DIR`, only when the
  user says yes (the window's button), pinned to a revision and checked by size and SHA-256: HTDemucs's six-source
  ONNX export (StemSplitio's, the STFT done as convolutions, fp16 weights: 136 MB) and Basic Pitch's own ONNX
  file (230 KB). The downloader is the platform's (`server/models.ts`), shared with the photo suite's models.
- **They run on the server**, in a process of their own (`server/music/ml-worker.mjs`, ONNX Runtime's native
  build): one job a process, so a separation's memory goes back when it ends, a crash takes nothing with it, and
  cancelling is killing it. ffmpeg decodes the file first (`server/music/ml.ts`). The desktop app ships the
  worker bundled with ONNX Runtime's library beside it (`scripts/desktop.ts`). Measured on an M5 Pro: about 0.7 s a
  7.8-second segment on the CPU, a separation at about a fifth of the song's length (CoreML was slower and used 13
  GB; WebAssembly ran out of memory).
- **Extract stems** (`server/music/stems.ts`, `/api/music/stems`): a job the tab polls. The model's segments
  overlap by a quarter and are crossfaded, written to 24-bit WAVs as they go (memory stays flat whatever the
  length). Each stem becomes the project's media with an origin naming its file and its sources, so the same split
  again is reused at once. The tab places them (`placeStems`, one undo step), copying the clip's window, gain,
  fades and stretch, and the channel's pitch, stretch and sample effects. On MUSDB18's 7-second test clips the
  median SDR is drums 9.2 dB, bass 7.7, vocals 9.6, other 5.0: HTDemucs's published range. The stems add up to the
  mix within 20 dB and the segment joins don't click (both checked on a 41-second file).
- **Convert to notes** asks the server once what's heard in the file (`server/music/hearing.ts`,
  `/api/music/notes`): Basic Pitch's activations (a frame every 11.6 ms by 88 keys, in 16 bits) and drum
  measurements. Picking notes out of them is pure TypeScript in the tab (`shared/music/transcribe.ts`), so the
  settings answer at once: `pickNotes` is Basic Pitch's `output_to_notes_polyphonic` ported line for line and
  held to the Python's own output (`transcribe-fixtures.json`, made by `scripts/basic-pitch-fixtures.py`); on three
  real files the worker's activations matched the Python's to 8e-6 and the notes picked were identical.
  `convertedParts` puts them in the song's time (the clip's offset, its stretch and the tempo), on a grid, on the
  song's scale if asked; `addConvertedPattern` makes the sampler, the pattern and its clip (one undo step).
- **Drums** are ours, no model: hits are where the sound gets louder most sharply (spectral flux), each told apart
  by the power it adds in a kick's, a snare's and a hat's band; a kick's falling pitch, a beater's click in the
  snare's band and a snare's sizzle in the hat's are each kept from counting. On beats made from the kit, kicks
  and snares are all found with none invented; hats played with a snare are heard as the snare.
- **Preview** (`convertPreview`, sent by `engine-sync.ts` as the clip menu's Preview is): the engine is sent a song
  of the clip and its notes' pattern alone, looping over the clip, until Stop.
- **The assistant**: `extract_stems` and `convert_to_notes`, the same code as the windows.
- **Tests**: the pure parts in vitest (`transcribe`, `stems`, `convert`), the server's jobs with the stand-in
  (`server/music/stems.test.ts`), the real models when they're downloaded
  (`server/music/ml-worker.integration.test.ts`: a kit-and-bass mix split at about 20 dB, a melody heard note for
  note), and `e2e/music.spec.ts` with `EDITOR_MUSIC_MODELS=stand-in` (each stem an even share of the file, a
  made-up melody).

## Where Vaudio differs

- Six stems (guitar and piano too), not four, and Other is whatever isn't chosen.
- Everything runs on this computer; nothing is uploaded. The first use asks to download the model.
- Convert to notes has its own window (Melodic or Drums, sensitivity, the shortest note, quantize, the song's
  scale, a drawing of the notes and Preview) instead of Edison's one command, and makes a new sampler rather than
  writing into the selected channel.
- Notes have no pitch bends (Basic Pitch hears them; our notes can't hold them yet).
- Drums know only kick, snare and hat; toms and cymbals are heard as whichever they're nearest.
- A split's progress shows in a toast (with Cancel), not on the clip.
- Not yet: the Browser's files (only clips and channels), or a song's whole mix.
