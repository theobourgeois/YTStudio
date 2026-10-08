# Engine rendering and plugin-state restoration: current limits

Status: Slice A fact sheet, 2026-10-04. Written from code reading; no application code changed.
Later slices (passage render jobs, candidate renders, undo that restores plugin state) should build on
what is written here, and update it when the engine changes.

How this was checked. The real engine is not built in this worktree (`engine/build` is absent), so every
`*.integration.test.ts` is skipped. `pnpm vitest run server/music/exports.test.ts server/music/export.integration.test.ts`
passed 6 tests (the fake-engine ones, which say nothing about real audio) and skipped 9. Nothing below was
measured on the real engine. Statements are "read" (from source) or "tested" (an existing test asserts it,
but was not run here). Anything neither is marked **unverified**.

References are `file:line` in the current tree. `engine.ts` is `server/music/engine.ts`, `exports.ts` is
`server/music/exports.ts`, the C++ files are in `engine/src/`.

## 1. What can be rendered today

There are two render paths. Only the export is usable in the real app.

| | `renderExport` (the export) | `render` command |
| --- | --- | --- |
| Entry | `AudioEngine.renderExport` (engine.ts:247), driven by `MusicExports.start` (exports.ts:75), `POST /api/music/exports` (routes.ts:126) | `AudioEngine.render` (engine.ts:456), `POST /api/engine/render` via the generic `/:command` route (routes.ts:62) |
| Needs a device? | No. Runs on a thread of its own (Export.cpp:61-85) and works with a live device engine and an offline one | Offline engine only: `Only an offline engine renders` (Engine.cpp:506-510) |
| Source | A copy of the song in the request, parsed afresh (Engine.cpp:937), played once (`loops: false`, engine.ts:262) | Whatever the live sequencer is playing; `play` must have started it. It continues the live state |
| Length | The song, or a tick range; optional ring-out (see 3) | At most 600 s at 48 kHz (Engine.cpp:773) |
| Output | `mix.wav` and `<track id>.wav` stems, 32-bit float, 2 channels (Export.cpp:96-108) | Optional 24-bit stereo WAV (Engine.cpp:815-818), plus peak, RMS and per-track meters |

What the export renders:

- **Whole song or a range.** `ExportSongRequest.selection` is a tick range (`start`, `end`; shared/music/export.ts:130, read by exports.ts:86) passed as `loop` to `compileSong`, which counts the song from `loop.start` (compile.ts:674-676, `offsetTicks`). The range is in the Playlist's ticks in song mode, or the pattern's in pattern mode. A range is tested only for a whole-bar window in song mode (export.integration.test.ts:190-203). There is no seconds-based range and no lead-in parameter.
- **Mode.** `mode` is `song` (the playlist) or `pattern` (the pattern given by `patternId`). A pattern export cannot start mid-playlist.
- **Stems.** `stems` writes one file per mixer track that something plays into, taken after the track's fader, never the master (Export.cpp:121-134). A track that stays silent has its file deleted (Export.cpp:253-260). Stems are not per-channel, and there are no pre-fader or pre-effect taps. Stems are held back so they line up with the mix (see 3).
- **Format.** Files are always stereo, 32-bit float WAV. Sample rate is `Engine::rate()`: the output device's current rate live, or 48 kHz offline (`VAUDIO_OFFLINE_RATE` can change it; Engine.cpp:9-14, 913). It is not an export setting, so the same song can render at different rates on different machines. ffmpeg then encodes the formats asked for (exports.ts:231-268), with `preventClipping` gain, dither and bit depth applied there, not in the engine. The float intermediates are deleted in `finally` (exports.ts:281-283), so a raw artifact exists only if a caller calls `renderExport` with its own `folder`, or uses `bounce` (the mix WAV becomes project media, exports.ts:215-223).
- **Reported.** `peak` per file is the sample peak, not a true peak (Export.cpp:231-233); the job also carries `missing` (channels or effects the engine could not play) and `length`. Result `latency` (samples trimmed) is returned by the engine (Export.cpp:267) but exports.ts does not keep it on the job.
- **Differences from live playback.** Export blocks are 2048 samples (Engine.cpp:24), offline `render` 512 (Engine.cpp:14), a device whatever it picks. Export resampling is the request's, `sinc` by default (shared/music/export.ts:92), live is `hermite` (engine.ts:290). Plugins are told they are rendering offline (`setNonRealtime`, Host.cpp:271-281); some plugins change quality in that mode (tested only with the test effect, export.integration.test.ts:138). The request carries no `held`, `armed` or `listening`, so Mono/Dim and held controls are never in a render.
- **Missing plugins.** A plugin that is not installed, or whose sample cannot be read, is silent and listed in `missing` (Engine.cpp:947-954; tested for a missing plugin, export.integration.test.ts:240).

## 2. Serialisation, cancellation and crashes

- **One export at a time**, at two levels. `MusicExports.start` throws 409 if any job is `rendering` or `encoding` (exports.ts:79); the engine also refuses a second (Engine.cpp:917-918). Tested (exports.test.ts:136).
- **A render takes the device and the plugins.** `startExport` stops the sequencer and the preview, removes the audio callback, releases live automation, and calls `setExporting(true)`, `prepare(rate, 2048)` and `reset()` on the plugin hosts (Engine.cpp:956-969). The live plugin instances are the render's, so playback cannot continue. Windows of plugins are hidden (Host.cpp:271-281). `finishExport` prepares them again for playback and re-adds the callback (Engine.cpp:998-1021).
- **Blocked meanwhile.** `play`, `record`, `preview`, `midiIn`, `trigger`, `previewFile`, `render`, `setDevice`, `tone`, `note`, `load`, `unload`, `editor` and opening a plugin editor answer an error (Engine.cpp:220-222). `song` is accepted but only stored: it is applied when the export ends (Engine.cpp:573-575, 1015-1016; tested, export.integration.test.ts:205-225). `saveStates` is not in the blocked list, so the 5 s timer (engine.ts:386-390) still calls plugin `getStateInformation` while the render thread uses the same instances. Whether that is safe for every plugin is **unverified**.
- **Not concurrent.** Two renders cannot overlap in one engine. An isolated second engine process does not exist; the plan's "isolated render-engine" is future work.
- **No scheduling.** The server has no queue. A second request while one runs gets 409. `MusicExports.jobs` is an in-memory `Map` that is never pruned (exports.ts:60, 107), so job state is lost on a server restart and grows for the life of the process.
- **Waiting for plugins.** If a plugin is still loading, the engine retries every 100 ms for up to 600 tries (60 s; Engine.cpp:26, 938-946) before rendering without it. The server's reply timeout is 60 s (engine.ts:128, 772), so that wait can end in a 504 with the export still scheduled. **Unverified**: nobody has timed it.
- **Cancel.** `MusicExports.abort` sets the job's `AbortController` and sends `abortExport` (exports.ts:117-124). The engine checks the flag once per 2048-sample block (Export.cpp:192-196), closes and deletes its files, and returns `aborted`. While encoding, ffmpeg is killed through the signal and written files removed (exports.ts:274-280). Tested (export.integration.test.ts:205-238, exports.test.ts:136). Two limits: an abort sent during the plugin-load wait finds no job in the engine (Engine.cpp:225-229 does nothing) so the render runs to the end and the server discards it afterwards (exports.ts:229, `throwIfAborted`); and a block cannot be interrupted while a plugin is processing it.
- **Engine crash.** The `stopped` event rejects the render with 503 (engine.ts:249-254) and every pending request is rejected (engine.ts:859-867). `MusicExports` marks the job `failed`, deletes written files and the temp folder (exports.ts:274-283). The next command respawns the engine and re-sends the last live song (engine.ts:825); the export is not retried. Plugin state written before the crash survives; edits since the last write do not (see 4). Not tested against a real crash.
- **Server exit.** `shutdown` aborts every job (exports.ts:141-143) and closes the engine's stdin, so it quits. The engine's destructor stops an export (up to 30 s wait) and writes plugin states (Engine.cpp:78-90). `data/tmp` is wiped on the next start (storage.ts:104-106).

## 3. Lead-in, tails, latency and warm state

- **Plugin delay is trimmed.** The first `Song::latency` samples are skipped (Export.cpp:202); stems are delayed by `latency - track.latency` so they align with the mix to the sample (Export.cpp:132, tested export.integration.test.ts:138). Latencies come from `Song::compensate` (Song.cpp:670) and plugins' reported `getLatencySamples`, so a plugin that misreports its delay is trusted. A track's `latencyOffset` is added.
- **Tail.** `cut` stops at `ceil(loopTicks * 60 * rate / (tempo * ppq))` samples (Export.cpp:64). `ring` continues until the loudest sample stays under -80 dB for 0.5 s, or `maxTail` seconds pass (Export.cpp:10-12, 241-249); the server passes 30 s (shared/music/export.ts:41) and the engine clamps to 120 s (Engine.cpp:977-978). `wrap` renders a ring then folds the tail onto the start in TypeScript (exports.ts:207-213, wrap.ts). Cut, ring and wrap are tested (export.integration.test.ts:97-135).
- **A render starts cold.** This is the main limit for passages:
  - The export parses its song with its own empty registries for Gross Beat, Auto-Tune, EchoBoy, PanMan, Pro-Q, OTT, Pro-C, Pitch Wheel and Reverb (Engine.cpp:928-937), and `keepOnly` is false so live plugins are not unloaded (Song.cpp:676, Engine.cpp:937). Envelopes, delay buffers, reverb tails and look-ahead start empty at the first sample.
  - Hosted plugins get `instance->reset()` before the render (Engine.cpp:963-969, Host.cpp:283-290), so their processors' history is cleared too.
  - The export's `Sequencer` is new, so mixer delay lines are empty (Export.cpp:149); `silenceFirst` ends notes the live song left sounding (Export.cpp:172).
  - A range starts at `loop.start` with none of the song before it. `compileSong` also drops notes that start before `from`, so a note sustaining across the start is silent, not just late (compile.ts:826; the doc comment at compile.ts:657 says so). Audio clips that straddle `from` start part-way into the file (`seconds + (startTick - tick) * ...`, ClipPlayer.cpp:131, 253-270) but **no test covers an export that begins inside a clip**.
- **What a passage render therefore needs.** A caller must ask for `[start - leadIn, end]` and trim the lead-in itself, with its own tick-to-sample conversion; no parameter does this, and the engine's output frame count is `ceil` of the range, so the trim must use the same arithmetic (and `warpSong` / `songSeconds` when tempo clips exist, compile.ts:699-701). The lead-in length is a policy: long enough for the slowest compressor release, the longest reverb/delay decay and any Pro-Q Linear Phase or look-ahead latency in the chain. Notes that start before the lead-in begins are still lost. Beyond that, cold-start differences versus the real playhead remain (an LFO phase, or Gross Beat's clock, depends on the tick; `grossClock.tick = offsetTicks + position`, Sequencer.cpp:529) and have not been measured.
- **Live `render` is warmer but not clean.** The offline `render` command uses the live registries (`stop` without `reset` leaves tails ringing; `Engine::silence` clears them, Engine.cpp:639-662; tested silence.integration.test.ts:60). Its state depends on what was played before, so it is not a reproducible artifact path.

## 4. Plugin identity and state

- **Identity.** A plugin is `PluginRef { id, name, format }` (shared/music/types.ts:73-79). `id` is JUCE's `createIdentifierString()` for the scanned description (Plugins.cpp:14). `EnginePlugin` also carries `manufacturer`, `category` and `isInstrument` (shared/music/engine.ts:15-25), but the song stores only the `PluginRef`. No plugin version, file path, binary hash or parameter count is recorded anywhere I found; whether JUCE's identifier changes with a plugin update is **unverified**. Built-in effects are `PluginRef`s with `format: "YTStudio"` and ids like `vaudio:pro-c` (`PRO_C_PLUGIN`, pro-c-presets.ts:31). They load no plugin.
- **Owner key.** A plugin instance is keyed by its owner's id alone: a channel id, or a mixer effect id (`PluginHost::get`, Host.cpp:65; the loaded map is `ownerId`-keyed). State file path: `<project>.yt/plugins/<owner id>.bin` (engine.ts:286-299). The path is built for built-in effects too but unused.
- **Not in the document.** The song JSON holds the `PluginRef` and the owner id (`MixerEffect.id`, shared/music/types.ts:184-188), never the plugin's own state. There is no document revision, ETag or content hash for a music project: `ProjectMeta.updatedAt` is the only version (projects.ts:555-562). The `revision` in routes/projects.ts:43 belongs to previews.
- **When state is written.** `PluginHost::save` (Host.cpp:155-167) writes `getStateInformation` to the file only if its FNV-1a hash (Host.cpp:10-20) differs from `savedHash` (and not while the plugin's parameter is being automated, `automating`). Triggers:
  - every 5 s while the song has plugins, by the server (`SAVE_STATES_MS`, engine.ts:124, 386-390), only if the engine is running (engine.ts:360-362);
  - `POST /api/engine/states` (routes.ts:41) and before `copyStates` and before a project moves (`beforeMove`, app.ts:115, projects.ts:539);
  - when an owner leaves the song (`keepOnly`, Host.cpp:134-152, so undoing a removal brings the plugin back as it was) or gets another plugin (Host.cpp:80-82);
  - on engine quit (Engine.cpp:89-90, destructor Host.cpp:62).
  A crash loses edits since the last write. After a plugin is loaded for the first time, the first save writes the file even if unchanged (`savedHash` starts at 0). A plugin that has never been saved has no file (engine.ts:366-370).
- **When state is restored.** Only when an instance is created: `setStateInformation` from the file, once, in `get`'s completion handler (Host.cpp:119-125). A file changed on disk afterwards is not re-read. Restoring a different state therefore needs the owner's instance to be recreated. Note the ordering hazard: `keepOnly` calls `save` on the way out (Host.cpp:145-146), so a file overwritten while the instance is still loaded can be overwritten again by the live state. The safe order (remove owner from the song, wait for the unload, write the file, add the owner back) is derived from the code and **unverified**. A state file the plugin rejects is not reported; the engine does not check what `setStateInformation` did.
- **A render uses the live instance, not the file.** For an owner that is already loaded with the same `pluginId`, the export uses the existing instance (Host.cpp:67-82), including edits not yet written. Its settings are therefore the live ones, up to 5 s newer than the file, and parameter values being automated are the automated ones (`Release`, Export.cpp:175-179, gives them back). A candidate with a new effect id would load a fresh instance from `plugins/<new id>.bin` (default state if the file is missing): `copyStates` (engine.ts:368-380) is the existing way to seed it.
- **A snapshot could hash** `sha256(plugins/<owner id>.bin)` after a successful `saveStates`, recording the time of that save and whether the engine was running. Limits: the engine's own FNV hash is internal and not exposed; no command reads a plugin's bytes; a plugin's serialisation can differ without the sound differing (Host.cpp:123 comments on it), so the hash identifies the stored file, not the audible state; a file missing or stale for an unloaded or failed plugin looks identical to "no changes".
- **Not restored or not captured.** Live processor history (the instance is `reset()`, Host.cpp:283-290; `setStateInformation` does not carry compressor, reverb or oscillator state); edits made in a plugin's window and not yet written, and the plugin's `automating` parameters; the preset label (`hosted.preset`, memory only, Host.cpp:480); plugin window position and visibility (not read in the state file path; **unverified**); which program/preset the user's presets folder holds (global, not per project); any plugin that is not installed (`failed`, "isn't installed", Host.cpp:92). Plugin-window edits are not an undo step in the app; the document's undo does not cover state files (the music store's history is the document only, src/suites/music/store.ts).
- **Built-in effects and the document.** Gross Beat, EchoBoy, Auto-Tune, Pro-Q, OTT, Pro-C, PanMan, Pitch Wheel and Reverb keep their settings in the song (`MixerEffect.grossBeat`, `echoBoy`, `autoTune`, `proQ`, `ott`, `proC`, `panMan`, `pitchWheel`, `reverb`, types.ts:184-215), together with `enabled`, `mix` and `sidechain`. These settings are fully captured by the normalised document, and the engine decides nothing about meaning beyond it (`engineProC`, `engineReverb` ... in shared/music). What is **not** captured: their running state in the registries by effect id (cleared on export, kept across songs live; Engine.cpp:639-652), and live-only commands that are not the song's (Gross Beat HOLD, PanMan manual trigger, Pro-C audition, Reverb freeze/kill, Pitch Wheel drags; per CLAUDE.md). Whether Pro-Q's EQ Match keeps reference data outside the document is **unverified**.

## 5. Media

- **How referenced.** The only media reference in a music document is `Channel.sampleId` (shared/music/types.ts:95); audio clips reach media through their channel. `samplePath(projectId, mediaId)` finds the file through the project's media library and returns `library.sourcePath(asset)`, only for audio assets of that project (app.ts:133-136). Files live in `<project>.yt/media/<id>/` (media.ts:416-419, 470-481). `normalizeMusicProject` drops a `sampleId` the project has no audio for (engine.ts:279).
- **Hashes.** None exist for media. `MediaAsset` has `size`, `createdAt` and `origin` (shared/types.ts:48-72); a Browser file's `origin` is `file:<path>:<size>:<modified>`, which is a change-detection key, not a content hash. `createHash` is used elsewhere in the server (web-media.ts:86, transcription), never on project media. A snapshot would hash at capture time: `sha256` of the file at `samplePath(...)`, cached by (media id, size, mtime). Whether media files are ever rewritten in place after import is **unverified** (ids suggest not; bounces and takes become new ids, exports.ts:216-223).
- **Engine reading.** Samples are read whole into memory and cached by path (`SampleCache`, never dropped while the engine runs); long audio-clip files are streamed (`AudioStream`). The precomputed channel effects (trim, reverse, normalise, fades) are in the document, so the hash of the source file plus the document describes the prepared sound. Samples at another rate than the engine are resampled by the chosen method (Resampling.h); that choice is a render setting, not a media property.
- **Browser samples.** A file reaches a project only as a copy (`POST /api/browser/use`), so a project's media are the files to hash, not the user's folders.

## 6. Evidence for determinism

Tested (needs the real engine; skipped when `engine/build` is missing):

- Parallel and one-thread export are byte-identical, mix and every stem, with four test synths, test effects, a send, a Pro-C with sidechain keys (export.integration.test.ts:165-188). It compares threads only; it does not run the same render twice.
- Export equals live playback within 1e-4 in song mode with automation (volume and pan LFO), stems included (export.integration.test.ts:246-282). Live is warmed first and uses `threads: 4`.
- Length, hits on their sample, float format; cut, ring and wrap tails; stem alignment with delaying plugins; offline plugin mode; abort leaves no files; song sent mid-export plays afterwards; missing plugin reported (export.integration.test.ts:85-244).
- The Reverb plays the same every time (seeded, reverb.integration.test.ts:466), and Pro-Q, Pro-C, OTT, EchoBoy, Gross Beat, Auto-Tune, PanMan and Pitch Wheel have offline sound tests against their TypeScript models. Modulation is checked for block-size independence (CLAUDE.md, modulation.integration.test.ts).
- Plugin state persists across save, unload and restore for the test synth (engine.integration.test.ts:204-211) and the test effect's state is kept beside the project (engine.integration.test.ts:145).

Untested or unverified:

- Two sequential exports of the same song and settings being identical (this includes re-render after an engine restart or a different machine).
- A range render equalling the same span of a whole render, with or without lead-in; a range beginning inside a note or an audio clip; a range with tempo clips.
- Block-size independence of export (2048) versus live and offline `render` (512), for the built-in effects.
- Any third-party plugin's offline determinism; sample-rate dependence (everything above runs at 48 kHz offline).
- Restoring a state file into a running engine (see 4), and an engine crash during a render.
- Time-varying or random plugin behaviour (seeded for ours only).

## 7. Implications for the snapshot and artifact contract

A snapshot that makes a render traceable must record:

1. **The song:** a hash of the normalised document (canonical JSON after `normalizeMusicProject`), project id, and when it was captured. The tab's unsaved copy is what `POST /api/music/exports` renders, so say whether it was the saved document.
2. **What was rendered:** mode, `patternId`, tick range, any lead-in as requested and as trimmed, tempo map/warp, tail mode and `maxTail`, mix and stems, track ids rendered.
3. **Render configuration:** resampling method, sample rate and channels of the engine's output, block size (2048), `threads`, offline flag, `latency` returned by the engine, the `missing` list, engine build (`EngineStatus.outdated` is the only build signal found), the intermediate format (32-bit float stereo WAV), and the ffmpeg encode settings if an encoded copy is an artifact.
4. **Media:** per `sampleId` a content hash, size and the media id; the source file path is not stable identity.
5. **Plugins:** per plugin the `PluginRef`, owner id, and `plugins/<id>.bin` hash with the time of the `saveStates` that preceded it, plus whether the instance was loaded, loading or failed at render time (`EngineStatus.channels`/`effects`). Built-in effects: their settings are in the document hash.
6. **A coverage statement** per element: `captured`, `partial` or `unknown`.

The contract must flag as incomplete (not claim exactness) when:

- the render started **cold**: effect and plugin history was reset, and a passage render has a lead-in that is a policy, not a proof of convergence;
- a plugin's **live state may differ from the file** (up to 5 s of edits, parameters being automated, engine not running at capture, plugin failed to load or not installed);
- a plugin's **version and binary** are not identified, and a state file's hash does not prove the same audible state;
- the rate depends on the output device, and the export's resampling and block size differ from live;
- the plugin's **window edits are not undoable** and state files are outside the document history, so undo/candidate acceptance has to snapshot and restore the files itself and verify the order of unload, write and reload (4);
- a render **blocks playback** and the live plugin instances (so a candidate render with different plugin settings has no isolated engine yet, and must not leave the user's live instance changed);
- media are unhashed today, so "same input" is unproven until the hash is taken;
- anything listed as untested in 6 (for example a range that starts inside a note).
