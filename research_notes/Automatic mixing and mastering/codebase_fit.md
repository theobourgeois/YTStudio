# Automatic mixing and mastering: codebase fit, stem and FLP import

Repository root: `C:/Users/goali/code/editor`. Every path below is relative to it. Line numbers are from the tree at commit d3ce2043 (2026-10-29).

## 1. What the music suite already has: document model, engine, built-in effects, plugin hosting, audio intelligence

### Takeaway
The music suite is an FL Studio-style DAW, and its whole mix lives in the document as plain JSON: a mixer with a master plus inserts, 10 effect slots per track, sends, sidechains, groups/VCA and automation. Ten built-in processors are modelled on the FabFilter and FL ones (Pro-Q EQ with EQ Match, Pro-C compressor, OTT, YT-L limiter, reverb and others), and their settings are part of the document. That makes every mix decision an edit an automatic tool can make, check and undo. A native JUCE engine hosts VST3 and Audio Unit plugins and renders offline. An "audio intelligence" layer already measures rendered audio: BS.1770 LUFS, loudness range, true peak and band balance against pink noise.

### Cited Findings
- **Document model.** `MusicProject` is `settings` (tempo, time signature, swing, volume, scale) plus `channels`, `patterns`, `playlist`, `mixer`, `automations` and `modulators`. Ticks are 96 PPQ. Edits are pure functions and undo is `DocumentHistory` ([docs/claude/music.md:12-28](docs/claude/music.md); [shared/music/types.ts:1637](shared/music/types.ts)).
- **Mixer.**
  - `mixer.tracks` lists the master first (`MASTER_TRACK_ID = "master"`), then the inserts ([shared/music/project.ts:128](shared/music/project.ts)). Each track has `EFFECT_SLOTS = 10` ([shared/music/project.ts:133](shared/music/project.ts)).
  - `MixerTrack` fields: `setupRole, name, color, dock, volume 0..1, pan, muted, solo, soloSafe, invert, swap, stereo -1..1, latencyOffset, input, monitor, effects[], sends[]` ([shared/music/types.ts:1040](shared/music/types.ts)).
  - `MixerSend`: `to, level 0..1, preFader` ([shared/music/types.ts:1024](shared/music/types.ts)). `Mixer` also holds `groups` (VCA, linked) ([shared/music/types.ts:1140](shared/music/types.ts)).
  - Sends are post-fader unless set pre-fader, routing loops are refused (`canSend`, `trackOrder`), and solo, sidechains and modulators are covered at [docs/claude/music.md:33-91](docs/claude/music.md).
- **Fader law.** The fader is cubic: `faderGain = (volume / DEFAULT_FADER) ** 3` ([shared/music/compile.ts:365](shared/music/compile.ts)), with `DEFAULT_FADER = 0.8` ([shared/music/project.ts:156](shared/music/project.ts)). The helper `faderMoved(volume, db) = volume * 10 ** (db / 60)` turns a dB change into a fader value ([shared/music/audio-intelligence/vocal-mix.ts:89](shared/music/audio-intelligence/vocal-mix.ts)).
- **`MixerEffect` record.** Fields: `id, plugin, enabled, mix 0..1, sidechain`, plus each built-in's own settings: `grossBeat / echoBoy / autoTune / proQ / ott / proC / proL / panMan / pitchWheel / reverb` ([shared/music/types.ts:185-216](shared/music/types.ts)).
- **Built-in effects** ([docs/claude/music-effects.md](docs/claude/music-effects.md)):
  - Pro-Q (YT-EQ): 24 bands, dynamic bands, linear phase, EQ Match (lines 38-49).
  - OTT: multiband (50-58).
  - Pro-C (YT-C): 21 styles including Vintage FET, Opto and VCA, with an external sidechain (59-75).
  - YT-L: a Pro-L 2-style limiter with true peak, a BS.1770 meter, dither and a clipper (76-89).
  - Reverb: 6 modes, ducking and a de-esser (114-132).
  - Also Gross Beat, EchoBoy, Auto-Tune, PanMan and Pitch Wheel.
  - Every knob is automatable ([docs/claude/music.md:240-265](docs/claude/music.md)).
- **Mastering presets already exist for YT-L** ([shared/music/pro-l-presets.ts:288-291](shared/music/pro-l-presets.ts)):
  - "Master: Streaming −14": −1 dBTP, target −14.
  - "Streaming Loud": clipper, −2 dBTP, target −10.
  - "Chart Pop": target −8.
  - The loudness targets offered are listed at line 179.
- **EQ Match** compares the averaged input spectrum with a reference Pro-Q's post-EQ spectrum, fits bands, and flags collisions (masking). It runs live in the tab only ([src/suites/music/pro-q/match.ts](src/suites/music/pro-q/match.ts)).
- **Engine.** A C++/JUCE engine talks JSON lines over stdin/stdout and hosts VST3 and Audio Unit plugins.
  - Outside plugins keep their state in `plugins/<id>.bin` files, outside the document ([docs/claude/music.md:37-41](docs/claude/music.md)).
  - It has an `--offline` render ([docs/claude/music-engine.md:77-82](docs/claude/music-engine.md)) and multi-core playback (56-62).
  - Meters report each track's peak after the fader only (63-70).
  - It is under JUCE's Starter licence (110).
- **Export and bounce.**
  - Export renders 32-bit float WAVs in the running engine: the mix plus one stem per track, which add up to the mix sample for sample. It takes the audio device, works in 2048-sample blocks on all cores, and has `preventClipping` ([docs/claude/music.md:226-239](docs/claude/music.md)).
  - `exportGain(peak, settings, limiter)` turns down a mix that goes over full scale ([server/music/exports.ts:251](server/music/exports.ts)).
  - Bounce and consolidate exist ([docs/claude/music.md:186-192](docs/claude/music.md)).
- **Audio intelligence contracts.** `MixSnapshot`, `AudioArtifact`, `EvidenceReport`, `AudioJob` and `MixRun` are plain JSON, immutable, and identified by a hash of their content ([docs/claude/audio-intelligence.md:8-23](docs/claude/audio-intelligence.md)).
- **Measurements** (pure TypeScript):
  - `integratedLoudness` (BS.1770-4), `loudnessRange` (EBU), `truePeak` and `loudnessSummary` ([shared/music/audio-intelligence/loudness.ts:8,77,86,114,146](shared/music/audio-intelligence/loudness.ts)).
  - `bandBalance` across 7 bands against pink noise, and `listen`, which finds timed loudness and tone changes ([shared/music/audio-intelligence/spectrum.ts:13,103,181](shared/music/audio-intelligence/spectrum.ts)).
  - Server side: `measureAudio` ([server/music/audio-intelligence/measure.ts:10](server/music/audio-intelligence/measure.ts)).
- **Vocal analysis.** `VOCAL_LEVEL_TARGETS` (forward −1, balanced −3, blended −6 dB), `analyseVocal`, `proposeVocalChanges` and `checkVocalChange` ([shared/music/audio-intelligence/vocal-analysis.ts:14,87,206,253](shared/music/audio-intelligence/vocal-analysis.ts)). The run helpers are `levelMatch`, `applyVocalChange`, `candidateSong` and `auditionGains` ([shared/music/audio-intelligence/vocal-mix.ts:75,104,130,171](shared/music/audio-intelligence/vocal-mix.ts)).
- **"Fill inserts"** (Jev's mixer setup) sorts channels into the instr, bass and drums roles and builds buses for instruments, bass, drums, vocals and a mixbus ([shared/music/mixer-setup.ts:5,7,46](shared/music/mixer-setup.ts); [docs/audio-intelligence/jev-mixer-setup.md](docs/audio-intelligence/jev-mixer-setup.md)).
- **Tempo, beats, sections and drops:** pure analysis in [server/beats.ts](server/beats.ts). Key detection works from notes, not audio ([shared/music/auto-tune.ts:197](shared/music/auto-tune.ts)).

### Inferences
- An auto-mixer can write its whole result as ordinary document edits: faders, pans, Pro-Q, Pro-C and YT-L settings, sends and buses. The user then gets an editable, undoable mix instead of a black-box audio file. That fits the "one undo step" pattern the vocal run already uses.
- Mastering mostly needs orchestration, not new DSP. The limiter, its loudness presets and the LUFS and true-peak meters already exist. The missing piece is a loop that sets a master chain (EQ, glue compression, YT-L), renders, measures and adjusts until it hits a target.
- EQ Match's spectrum fit and collision detection is the nearest existing thing to "match a reference" and "fix masking". It lives in the tab and would need to move into `shared/` to serve a server-side auto-mix.

### Gaps
- I didn't check how fast the built-in DSP runs per effect, only the engine-wide render speed (section 3).
- I didn't read how `bandBalance` weights its bands, so it's unconfirmed whether it suits whole-mix tonal targets as well as vocal comparisons.

## 2. The assistant's mixing tools: what it is told, where it is blind, and which loops exist

### Takeaway
The assistant has a broad set of mixer and effect tools: routing, faders, sends, buses, sidechains and full control of Pro-Q, Pro-C, OTT, YT-L and Reverb. But its standard view of the mixer, `get_mixer` / `describeMixer`, is structure only, with no levels, loudness or spectrum, so ordinary mixing edits are made blind. One closed render→measure→propose→render→level-match→apply loop exists, and it covers only a vocal against its beat, with built-in effects only. There is no whole-mix balance run, no mastering run and no reference-track tool for the assistant. The prompt also contradicts itself about whether LUFS is available.

### Cited Findings
- **Tool registry:** `MUSIC_TOOLS` in [shared/music/tools.ts:218](shared/music/tools.ts); handlers are in [src/suites/music/tools.ts](src/suites/music/tools.ts) and mixer edits in [src/suites/music/mixer/tool-edits.ts](src/suites/music/mixer/tool-edits.ts).
- **Mixer tools** ([shared/music/tools.ts](shared/music/tools.ts)): `get_mixer` (630), `route_channels` (640), `update_mixer_track` (649), `set_send` (984), `solo_mixer_track` (1004), `add/remove/move_mixer_track` (1023-1037), `route_to_new_bus` (1044), `group_mixer_tracks` (1054), `add/update/move/remove_mixer_effect` (1073-1130), `set_sidechain` (1137), `duck_with_sidechain` (1153) and `copy_track_state` (1163).
- **Effect tools** (same file):
  - Pro-Q: 1172-1221.
  - OTT: 1245-1255.
  - Pro-C: 1290-1300 and 1425-1458, plus `add_vocal_compression` (1458).
  - Pro-L: 1363-1418.
  - Reverb: 1477-1581, plus `add_vocal_reverb` (1581).
  - Automation: `add_automation` (2422).
- **Audio intelligence tools** (same file):
  - Workflows, examples and engineer profiles: 225-230.
  - Vocal mix run tools: 231-239.
  - Rendering and hearing: `capture_audio_snapshot` (240), `render_audio_passage` (242), `register_audio_artifact` (245), `get_hearing_capabilities`, `hear_audio_artifact` and `get_hearing_receipt` (246-248), `analyse_audio_artifact` (249).
  - Jobs and reports: `get_audio_job`, cancel, retry and `get_audio_report` (250-253).
- **Clip tools:** `render_clips` (2127), `detect_tempo` (2181), `extract_stems` (2188), `convert_to_notes` (2207) and `add_audio_clip` (2300). **Output:** `export_song` (2484).
- **`describeMixer` is structure only.** It lists tracks, channels, slots, plugin names, bypass, mix, latency, sidechain key and sends, with no level, peak, LUFS or spectrum ([src/suites/music/mixer/tool-edits.ts:152](src/suites/music/mixer/tool-edits.ts)).
- **The system prompt** ([server/suites/music.ts:32-123](server/suites/music.ts)):
  - It says "You can't hear the song" (71-72).
  - The audio evidence paragraph (74-87) says the tools give "not listening opinions, LUFS or true peak" (81).
  - Lines 98-99 say `analyse_audio_artifact` reports loudness (LUFS, range, true peak). This contradicts line 81.
  - The vocal workflow is at 89-99.
- **The vocal mix run** ([docs/audio-intelligence/vocal-mix-workflow.md:8-37](docs/audio-intelligence/vocal-mix-workflow.md)):
  1. Render the beat with the vocal muted, and the song with the vocal's stem.
  2. `analyseVocal`.
  3. Bounded proposals: fader, YT-C, YT-EQ.
  4. Render each candidate and level-match it once.
  5. Compare at matched LUFS.
  6. Apply as one undo step.
- **Vocal run results and scope.** It was verified on real stems at about 10 s per run offline (lines 66-81). Remaining scope (114-118): only the vocal's insert changes, not the beat, sends or automation, and outside plugins can't be rendered faithfully.
- **Analysis renders refuse outside plugins.** The service throws "Analysis renders currently support built-in processors only. Outside plugin state restoration isn't verified." ([server/music/audio-intelligence/service.ts:182,299](server/music/audio-intelligence/service.ts); [docs/audio-intelligence/render-and-measure.md:34](docs/audio-intelligence/render-and-measure.md)).
- **Passage cap and cold start:** passages are limited to 120 s ([server/music/audio-intelligence/service.ts:305,616](server/music/audio-intelligence/service.ts); [docs/audio-intelligence/render-and-measure.md:38](docs/audio-intelligence/render-and-measure.md)), and renders start cold (line 40).
- **Hearing benchmark.** Measured level changes were found 8/8 and tonal changes 4/8 ([docs/audio-intelligence/render-and-measure.md:45-57](docs/audio-intelligence/render-and-measure.md)). No hosted listening task is promoted yet ([docs/claude/audio-intelligence.md:4-8](docs/claude/audio-intelligence.md)). The Gemini path is built, but its findings are withheld until certified ([docs/audio-intelligence/hosted-perception.md](docs/audio-intelligence/hosted-perception.md)).
- **The planned autonomous mixing loop** is §12 of [docs/audio-intelligence/audio-engineering-harness.md:222-242](docs/audio-intelligence/audio-engineering-harness.md), and its evaluation is §13 (244-262). In the backlog, Slice G is "prove usefulness" and Slice H is "train only for demonstrated gaps" ([docs/audio-intelligence/implementation-backlog.md:138,152](docs/audio-intelligence/implementation-backlog.md)).
- **ML pilots** (research scripts, not in the product):
  - ST-ITO settings search over native renders: most promising for delay. Cross-song chain and EQ optimisation didn't beat the best random start ([docs/audio-intelligence/st-ito-pilot.md:3-4,108-118](docs/audio-intelligence/st-ito-pilot.md)).
  - AFx-Rep: 72/126 (57.1%) against a 19/126 (15.1%) spectral baseline at identifying effects. It doesn't judge mix quality ([docs/audio-intelligence/afx-rep-real-stems.md](docs/audio-intelligence/afx-rep-real-stems.md)).
  - MixAssist: Qwen2-Audio-7B plus a LoRA (16.8 GB), advice only ([docs/audio-intelligence/mixassist-pilot.md](docs/audio-intelligence/mixassist-pilot.md)).
- **References stay advisory:** reference mix parameters never become executable settings ([docs/audio-intelligence/mixparams-reference-subset.md](docs/audio-intelligence/mixparams-reference-subset.md)).

### Inferences
- The user is right that the assistant "can't hear" during ordinary mixing. It can request a render plus measurement, but the default path (`get_mixer` followed by `update_mixer_track`) carries no audio evidence, and nothing makes it measure before or after an edit outside the vocal run.
- The vocal run is the template for an auto-mix. It already has the right pieces: render variants, measure, bounded proposals, level-matched comparison, one undo step and `MixRun` budgets. Generalising it to every stem (per-stem loudness and band targets, masking between stems, bus compression) and adding a master stage (target LUFS and true peak through YT-L) is the most natural extension.
- Deterministic DSP rules over measurements are a better first step than ML in this codebase. The repo's own pilots found the learned optimisers didn't beat simple baselines for EQ and chains, and the large models are advisory and heavy.
- The LUFS contradiction in the prompt (line 81 against 98-99) should be fixed whatever else is built.

### Gaps
- I didn't read §12 of the harness plan in full detail, nor the `MixRun` budget values.
- I didn't confirm whether `render_audio_passage` can render the master alone with chosen stems muted, beyond the `stemTrackId` option ([docs/claude/audio-intelligence.md:31](docs/claude/audio-intelligence.md)).

## 3. Offline render speed, the analysis render path, and ONNX/Python

### Takeaway
Offline rendering is fast: 45× real time with 24 Serum instances on an M5 Pro, against 4.3× when played. So a full-song render-and-measure loop costs seconds per iteration. The catch is that today's export and analysis renders share the running engine: one at a time, taking the audio device and the live plugin instances. One precedent shows how to avoid that: the song preview renders in an independent silent offline engine. ML runs on ONNX Runtime in a Node worker (HTDemucs stem separation, Basic Pitch). Python appears only in research scripts.

### Cited Findings
- **Speed:** "45× real time with 24 Serums on an M5 Pro, against 4.3× played" ([docs/fl-studio/export.md:265](docs/fl-studio/export.md)). A vocal run takes about 10 s offline ([docs/audio-intelligence/vocal-mix-workflow.md:66-81](docs/audio-intelligence/vocal-mix-workflow.md)).
- **Two render paths:** `renderExport` ([server/music/engine.ts:332](server/music/engine.ts)) and the `render(frames, file?, input?)` command ([server/music/engine.ts:612](server/music/engine.ts)) ([docs/audio-intelligence/engine-render-limits.md:16-36](docs/audio-intelligence/engine-render-limits.md)).
  - `EngineExportDone` returns frames, sampleRate, latency, seconds, files and missing ([shared/music/engine.ts:536](shared/music/engine.ts)).
  - `EngineRender` returns peak, rms, per-track meters, eq and scopes ([shared/music/engine.ts:696](shared/music/engine.ts)).
- **Render limits** ([docs/audio-intelligence/engine-render-limits.md](docs/audio-intelligence/engine-render-limits.md)):
  - One export at a time; it takes the device and the live plugin instances (40-43).
  - There is no isolated second engine (43).
  - Renders start cold (54-59).
  - Plugin state and determinism issues are at 62-77 and 86-103.
- **Isolated offline engine (precedent).** `renderSongPreview` builds `new AudioEngine(workerPaths, { ...options, projectDir: () => snapshot, offline: true })` with a separate data folder (it copies `plugins.xml`) and a throwaway copy of the plugin state, then calls `renderExport` with one thread ([server/music/project-preview.ts:23-53](server/music/project-preview.ts)).
- **ML:**
  - `onnxruntime-node` 1.30.0 and `onnxruntime-web` 1.30.0 ([package.json:53-54](package.json)).
  - The worker is [server/music/ml-worker.mjs](server/music/ml-worker.mjs), one process per job. Its header (1-17) gives HTDemucs as MIT and Basic Pitch as Apache 2.0.
  - Model URLs: HTDemucs 6-stem ([shared/music/models.ts:12](shared/music/models.ts)) and Basic Pitch (line 21).
  - `musicModels`, `decodeRaw` (ffmpeg) and `runWorker` are in [server/music/ml.ts](server/music/ml.ts). The worker path is `MUSIC_WORKER` ([server/config.ts:119](server/config.ts)).
  - `StemSeparator` runs HTDemucs at 44.1 kHz, one job at a time, and adopts the stems as media ([server/music/stems.ts](server/music/stems.ts)).
  - `placeStems` plays the stems into the master and mutes the original clip ([docs/claude/music.md:295-306](docs/claude/music.md)).
- **Python** appears only in research pilots: `scripts/afx-rep-pilot.py`, `st-ito-pilot.py`, `mixassist-pilot.py`, `prepare-vocal-mix-pilot.py` and others under [scripts/](scripts/). Nothing in `server/` or `src/` runs Python.

### Inferences
- An auto-mix job should render in a silent offline engine like `project-preview.ts`'s, not through the export queue. Then it doesn't take the device, can run while the user works, and can eventually load third-party plugins from a disposable state copy. It would also lift the 120 s passage cap, which exists for the shared-engine path.
- An MP3 input fits the existing pipeline: `extract_stems` (HTDemucs, 6 stems), then auto-mix the stems. The quality ceiling is the separation's, so this is remastering or rebalancing, not true mixing.
- Any new ML model (for example a learned EQ or compressor predictor) should ship as ONNX in `ml-worker.mjs`, not as Python, to match the packaged desktop app.

### Gaps
- I found no measured render speed on Windows or on an all-built-in project. The 45× figure is a Mac with Serum.
- Whether third-party plugins render faithfully in the isolated engine is unverified. The audio intelligence service deliberately refuses them.

## 4. Import: stems, MIDI, FLP (PyFLP and alternatives), FL's stem export and command line

### Takeaway
Audio and stems already import: files dropped on the rack become channels, and `add_audio_clip` exists. MP3 can be split by HTDemucs. MIDI files don't import (export only). `.flp` files are kept opaque: classified as a "session" and preserved, never decoded. PyFLP is the most complete FLP parser, but it is GPL-3.0 Python, has had no release since June 2023, and only reads parameters for a handful of native plugins. For everything else it returns opaque state bytes. Since native FL plugins can't render outside FL, the realistic `.flp` path is stems exported by FL: Split mixer tracks, possibly driven by FL's command line through the app's existing detection of the user's FL install.

### Cited Findings
- **Audio import:**
  - Rack drops accept `/\.(wav|aiff?|flac|mp3|ogg|m4a)$/i` ([src/suites/music/browser/drops.ts:15](src/suites/music/browser/drops.ts)).
  - The engine reads m4a, mp3 and wav, and other formats are converted to WAV ([server/web-media.ts:41-45](server/web-media.ts)). The engine itself uses JUCE `registerBasicFormats` (engine `Song.cpp:51`).
  - Tools: `add_audio_clip` ([shared/music/tools.ts:2300](shared/music/tools.ts)) and `extract_stems` (2188).
- **MIDI:** [shared/music/midi.ts](shared/music/midi.ts) writes an SMF from `compileSong`. I found no MIDI file import.
- **FLP kept opaque:**
  - `.flp` is classified as "session" ([server/music/audio-intelligence/dataset-service.ts:26](server/music/audio-intelligence/dataset-service.ts)), and "FLP/PTX and other native formats are preserved, not decoded or rendered" (line 174).
  - `get_dataset_package` says native FLP/PTX decoding is unsupported ([shared/music/tools.ts:221](shared/music/tools.ts)).
  - "PyFLP is a candidate, not a committed dependency" ([docs/audio-intelligence/dataset-ingestion.md:124](docs/audio-intelligence/dataset-ingestion.md)); see also [docs/audio-intelligence/ordinary-package-ingestion.md:109](docs/audio-intelligence/ordinary-package-ingestion.md).
  - An FLP plugin chunk isn't directly loadable as VST3 state. FL's MIDI scripting API (`getParamCount`, `getParamName`, `getParamValue`, `getParamValueString`) is a possible live route for capturing parameters ([docs/audio-intelligence/plugin-settings-research.md](docs/audio-intelligence/plugin-settings-research.md)).
- **PyFLP status:**
  - GPL-3.0 ([GitHub](https://github.com/demberto/PyFLP)).
  - The latest release is 2.2.1 (2023-06-05); 2.2.0 was 2023-05-28 ([changelog](https://pyflp.readthedocs.io/en/latest/changelog.html)).
  - From the GitHub API: not archived, last default-branch commit 2023-07-11 (a pre-commit autoupdate), 222 stars, 39 open issues ([GitHub](https://github.com/demberto/PyFLP)).
  - The README says the FLP format is undocumented and each FL version may break parsing.
- **What PyFLP extracts:**
  - Arrangements and playlist items with offsets and lengths (`pyflp/arrangement.py`).
  - The channel rack: instruments, layers, sampler, automations. `Sampler.sample_path` is a path reference, not audio, and `Channel.insert` gives the mixer routing (`pyflp/channel.py`).
  - Mixer inserts: volume, pan, stereo separation, polarity, routes, bypassed, enabled and a 3-band post EQ. Slots: enabled and mix (`pyflp/mixer.py`).
  - Patterns (notes, controllers), time markers, and project settings and metadata.
  - Native plugin parameter structs only for BooBass, Fruit Kick, Fruity Balance, Blood Overdrive, Center, Fast Dist, Notebook2, Send, Soft Clipper, Stereo Enhancer, Plucked and Soundgoodizer. VST plugins expose `fourcc, guid, name, plugin_path, vendor` and opaque `state` bytes (`pyflp/plugin.py`).
  - All from [github.com/demberto/PyFLP](https://github.com/demberto/PyFLP).
- **Other FLP parsers** (GitHub, checked 2026-10-29):
  - [SatyrDiamond/DawVert](https://github.com/SatyrDiamond/DawVert): Python, GPL-3.0, 431 stars, active (pushed 2026-10-29). A DAW-to-DAW converter.
  - [SatyrDiamond/flp-parser](https://github.com/SatyrDiamond/flp-parser): Python, GPL-3.0.
  - [SpendLessDaw/ts-flp](https://github.com/SpendLessDaw/ts-flp): TypeScript, MIT, 0 stars, new. Reads metadata, BPM, sample paths and VST names and vendors, and round-trips byte for byte.
  - [nikitacontreras/dawparse](https://github.com/nikitacontreras/dawparse): TypeScript, no licence.
  - [monadgroup/FLParser](https://github.com/monadgroup/FLParser): C#, archived, last push 2022-03.
  - [bishoyroufael/flp-parser](https://github.com/bishoyroufael/flp-parser): JavaScript, no licence, 2020.
- **FL's stem export** ([docs/fl-studio/export.md](docs/fl-studio/export.md)):
  - "Split mixer tracks" writes every used insert to its own WAV. It is WAV only, skips muted tracks, and applies master effects only to the master's file (104-110).
  - "Export all playlist tracks" goes through the master (129).
  - FL Cloud mastering is mentioned at 134.
  - The command-line render is `FL -R -Emp3 project.flp` (135).
  - Users report that bus and send effects appear only on the bus's own render ([routenote](https://routenote.com/blog/how-to-export-stems-in-fl-studio/); [Image-Line forum](https://forum.image-line.com/viewtopic.php?p=1938090)).
- **FL command-line switches:** `/R` render, `/E` formats (for example `/Emp3,ogg,wav`), `/F` folder, `/M` MIDI ([Image-Line forum, 2017](https://forum.image-line.com/viewtopic.php?p=1210668)). I found no switch for Split mixer tracks.
- **FL install detection:** the app already reads the user's local FL Studio install (`FLEngine_x64.dll`; `EDITOR_FL_STUDIO`) for its cursors ([server/music/fl-cursors.ts](server/music/fl-cursors.ts)).

### Inferences
- **Stems are the input that matters for mixing.** A folder of FL "Split mixer tracks" WAVs (or any DAW's stems) becomes one channel and one insert per file. `fillMixerInserts`-style classification can then assign roles and buses before the auto-mix runs.
- **A `.flp` is worth parsing for metadata only:** tempo, track names, insert names, routing, and fader and pan starting points to seed the stem mix. It can't give the audio, because third-party and most native plugin states are opaque and FL-only.
- **Licensing:** PyFLP and DawVert are GPL-3.0 and Python. Bundling them into the closed desktop app raises GPL questions and adds a Python runtime the product doesn't have. A small in-house TypeScript reader for the few events needed (tempo, insert names, routes, volumes), or the MIT ts-flp as a starting point, fits better.
- **FL command line:** rendering an `.flp` headlessly with FL's `/R` gives a full mixdown, which only suits mastering. Per-insert stems still need the user to run Split mixer tracks in FL, unless a switch exists that I didn't find.

### Gaps
- The Image-Line manual pages for WAV export returned 404, so the Split mixer tracks details come from the repo's own [docs/fl-studio/export.md](docs/fl-studio/export.md), not Image-Line directly.
- I didn't confirm whether current FL Studio versions (2025 and later) still support the `/R /E /F` switches, or whether any of them export split mixer tracks.
- I didn't test PyFLP against FL 2024/2025 `.flp` files. Its open issues suggest newer versions break parts of the parser.

## 5. Platform constraints for where the feature would plug in

### Takeaway
The feature should be a music-suite capability: server code in `server/music/`, pure logic in `shared/music/`, UI in `src/suites/music/`. Every UI action needs an assistant tool (the parity rule), and external programs start only through `process.ts`. It runs locally in the Electron desktop app on Windows and macOS, with ffmpeg and ONNX available and no Python.

### Cited Findings
- **Layering:** suites never import each other, and the platform reaches a suite only through the registries. `server/architecture.test.ts` checks every import ([CLAUDE.md](CLAUDE.md), section "Suites").
- **Assistant parity:** every feature gets a tool (name, description, JSON schema, kind) and a handler, and edit tools are pure with tests ([CLAUDE.md](CLAUDE.md), "How to add…").
- **Process and logging:** external programs start only through `server/process.ts`; env vars are read only in `server/config.ts`; logging goes through `log(scope)` ([CLAUDE.md](CLAUDE.md), "Conventions").
- **Desktop and server:** the desktop app is Electron, with the server in its own utility process and packaged without node_modules (esbuild bundle). The server is local Express on 127.0.0.1 ([CLAUDE.md](CLAUDE.md), "Layout: electron/"; "Gotchas").
- **Engine portability:** the engine runs on Windows (ASIO) and macOS ([docs/claude/music-engine.md:98-105](docs/claude/music-engine.md)). Music is the engine's own app on a Mac. On Windows, YTStudio (every suite) still serves as the music app ([CLAUDE.md](CLAUDE.md), "Apps").
- **Contracts and storage:** audio intelligence records are hash-identified, so changing what is hashed is a schema change ([docs/claude/audio-intelligence.md:8-17](docs/claude/audio-intelligence.md)). Jobs are durable under `data/audio-intelligence/` and survive closed tabs through `AssistantOptions.serverTool` (24-28).
- **Background analysis:** a chat's tool calls act on their own project even while another is open ([CLAUDE.md](CLAUDE.md), "Gotchas").

### Inferences
- **A natural architecture:**
  1. An `AutoMix` service in `server/music/audio-intelligence/` that reuses `MixRun`, `AudioJob` and `measureAudio`.
  2. Pure planners in `shared/music/audio-intelligence/` (per-stem gain staging, masking EQ, bus compression, a master chain to a LUFS and true-peak target), unit-tested against the existing synthetic fixtures.
  3. An isolated offline engine for renders, as in `project-preview.ts`.
  4. One tool such as `auto_mix` / `auto_master`, with a matching UI action.
  5. Results applied as one undoable document edit, reusing the existing Pro-Q, Pro-C and YT-L settings and presets.
- **The MP3, stems and FLP entry points** converge on "a song whose channels are stems": MP3 through `extract_stems`, stems through drops or a folder import, `.flp` through FL-exported stems plus optional metadata.

### Gaps
- I didn't check how the Windows desktop app packages the engine or ONNX models, or whether model downloads are on demand ([shared/music/models.ts](shared/music/models.ts) gives Hugging Face URLs, which suggests they are).
