# Plan 1: Engineer dataset ingestion

Status: architecture proposal with [bounded ordinary-package intake implemented](ordinary-package-ingestion.md).
Local folders/ZIPs, preserved sources, reviewed relationships and source-linked
profiles are available through CLI/API. The broader workspace UI, full native
session extraction and compressed-source analysis registration remain proposed.
See [the overview](README.md) and [audio hearing API](audio-hearing-api.md).

## Product outcome

The ingestion target is a complete, useful capture of the engineer's session: plugin parameters and saved states, arrangement/layout, routing, automation, source media, and rendered audio. Engineer-supplied packages are the transport: a ZIP or folder containing the DAW session, referenced media, stems, a finished mix, and supplemental metadata/settings. Finished songs and stem-only packages remain supported with clearly reduced capture coverage. The app identifies what each item contains, asks for corrections where needed, and builds a dataset that can support a detailed report and a reusable mixing profile. The report distinguishes audible results from actual session decisions.

The first useful case is this user's friend supplying stem packages for vocals mixed over beats or full multitrack mixes. Genuine stems are the preferred analysis inputs; source separation is a fallback when a package lacks the relevant sources. A stereo beat does not expose independent kick, bass, and synth controls.

### Requested contribution package

Request one song/version per folder or ZIP, with:

- A finished mix for the full listening context.
- Processed vocal and beat/instrument stems, preferably individual lead, doubles, ad-libs, drums, bass, and other parts where available.
- The FL Studio or Pro Tools session and referenced media for session-level ingestion, plus plugin presets/state and a capture manifest where available.
- Optional matching raw/edited-dry tracks and a premaster.
- A short note naming the DAW/version, common export start, and which processing is printed into each group.

These are contribution targets, not a rigid naming requirement. Session files are required for the full-session workflow; missing them does not block the separate stem/reference workflow. Raw tracks enrich before/after analysis. Partial packages remain importable with a readiness report describing what cannot be inferred. All stems should share a documented time origin; effects returns and buses must be identified to avoid double-counting.

Three operations must be named separately in the interface:

- **Add audio references:** immediately analyzable finished mixes and exports.
- **Add session archive:** preserve the native project and discover included media; extraction coverage is displayed.
- **Capture from DAW:** a companion workflow running in the engineer's installed DAW to export verified metadata, settings, and renders. Its feasibility checks belong early in planning for session-level ingestion.

Accepting an FLP/PTX archive must never imply complete parsing, playback, conversion into a Vaudio song, or plugin parameter recovery.

## Full-session capture requirements

Capture everything available from the source session that can explain, reproduce, or contextualize the mix. Preserve the native archive even when the current adapter cannot interpret all of it. The structured representation must retain source IDs and provenance so new adapters can enrich old packages without asking for the original files again.

| Area | Target data |
| --- | --- |
| Session identity/time | DAW/version, session version, sample rate, tempo map, time signatures, timecode/origin, markers, song sections, loop/range settings |
| Arrangement layout | Ordered tracks and folders, names/colors, grouping, clip positions and source offsets, trims, overlaps, fades/crossfades, takes/playlists, active versions, MIDI notes/velocities, patterns |
| Mixer/signal graph | Channels/buses/returns/master, inputs/outputs, insert order, pre/post-fader sends and amounts, sidechains, gain/pan laws, stereo/channel configuration, mute/solo/bypass states, phase/polarity, latency compensation |
| Plugin instances | Stable instance ID and owner/slot, manufacturer/product/version/format, enabled state, preset identity when supplied, readable parameters, saved state/preset blobs, required sample/impulse-response references |
| Parameter records | Native parameter ID/index/name, raw and normalized values when exposed, display text, unit/range, stepped/enumerated choices, parameter mapping/version, retrieval method and status |
| Time-varying controls | Automation points/curves/interpolation, native timebase, automation modes, clip gain/envelopes, parameter links/macros/modulation, initial values and control precedence |
| Audio/edit processing | Original recordings and edited sources, tuning/warp/stretch data where extractable, offline processing/commit history when supplied, raw/processed pairs, track/bus/return/mix renders with tap points |
| External dependencies | Missing media, plugin versions, external hardware routing/latency and engineer notes, required libraries, unresolved dependencies |
| Visual organization | Track heights, collapsed folders, mixer organization, optional workspace screenshots and plugin-window screenshots where useful |

Prioritize the arrangement and signal graph over cosmetic window coordinates, but preserve useful visual context. UI screenshots supplement structured data; they cannot establish complete settings for hidden pages or automation. Do not collect unrelated machine or account data under the phrase “all data.”

### Plugin parameter and state strategy

Prefer live capture from the original DAW/plugin environment over writing private-state decoders. Verified FL/VST3 access routes and the remaining Pro Tools investigation are documented in [plugin settings research](plugin-settings-research.md). A readable manifest generated on the engineer's machine travels with the session package; hosted audio perception does not need commercial plugins installed to consume it.

For every plugin instance, attempt three separate captures:

1. Enumerate readable parameters through a supported DAW/format adapter, retaining their native identity and displayed meaning.
2. Preserve complete saved plugin state/presets as opaque artifacts even if not currently decodable. State may retain information outside the exposed parameter list.
3. Capture its audible outcome in context through documented renders, including relevant bus/sidechain behavior.

Fallback order is original-DAW parameter capture, native state/preset preservation, compatible plugin-assisted reading, targeted plugin/version mappings or decoders, and reviewed visual/manual evidence. Do not budget a decoder for every plugin before testing the exposed-parameter path. Prioritize a verified compressor capture pilot using the friend's actual products.

Some plugin settings may not be exposed as host parameters, and saved state may require the original plugin/version to interpret. Never claim “all parameters” solely because the host enumeration succeeded. Plugin-specific decoding is a versioned adapter capability; unrecognized state stays preserved and explicitly unreadable. Screenshots/manual notes can supplement a gap but must retain their evidence status.

Actual settings should drive the engineer report where available: for example, a documented chain and automated threshold can be linked to its track and time range. Comparable plugin controls need explicit unit/behavior mappings; the same normalized value on two different compressors is not equivalent processing.

### Coverage and completeness contract

Each field/category records `extracted`, `preserved-opaque`, `unsupported`, `missing`, `failed`, or `not-applicable`, with source version and capture method. An imported package may be audio-ready while parameter extraction is partial. Show separate statuses for audio readiness, structured session coverage, parameter readability, and reproduction readiness.

Provide a missing-data checklist at plugin-instance and session level. Do not collapse these into a misleading single completeness percentage. Native state preservation is valuable but is not readable parameter extraction; having every readable parameter is not proof of reproducible playback.

Release session capture against a declared DAW/version/plugin compatibility matrix. Validate representative sessions with EQ, compression, reverb/delay, tuning, sidechains, buses, third-party instruments, and automation. Compare extracted values against the source DAW at known times. Reopen state and compare renders where a compatible environment permits, allowing for documented nondeterministic plugins.

The full-session requirement moves FL/Pro Tools feasibility and plugin-access checks ahead of profile design. A first release may support a bounded tested matrix and retain other packages as partial captures; it must not market universal extraction from every plugin or native project.

## Supported material and evidence levels

| Level | Material | What it supports | What remains unknown |
| --- | --- | --- | --- |
| Reference | Finished stereo mix/master | Overall balance, dynamics, tone, width, arrangement-specific observations | Exact processing and the original recording |
| Stem | Genuine processed tracks/groups and mix | Track/group outcomes and approximate relationships | Processing causes without matching sources |
| Paired | Matching raw and processed tracks, plus full mix | Before/after transformations under documented conditions | Exact chains unless separately supplied |
| Session | Session, media, metadata, verified renders | Available routing/settings/automation and their relationship to audio | Unsupported plugin state, missing media, external hardware |

These levels describe available evidence rather than a single quality ranking. A session without usable audio has less listening value than a clean final WAV. Estimated stems are always marked derived, never promoted to genuine engineer exports or used as paired ground truth.

Accept WAV, AIFF, FLAC, and common compressed references through the existing decoder. Prefer lossless files for subtle analysis. Preserve compressed originals; converting MP3 to WAV does not restore missing detail. Initial scope is mono/stereo music, with multichannel material identified and retained but specialist analysis explicitly unavailable.

## Engineer contribution workflow

1. Create an engineer profile with a name, description, preferred genres, and optional notes about technique.
2. Drop files/folders/ZIP packages into a separate dataset workspace. Local desktop folder selection and browser uploads converge on the same importer.
3. Show a discovery preview grouped into songs and versions. Explain inferred roles in ordinary language and let the user change them.
4. Confirm final mix versus mastered release, who mixed/mastered it, and whether raw vocals/stems exist. Unknown is an allowed answer.
5. Display readiness: usable references, unresolved pairings, missing media, questionable alignment, and archive extraction coverage.
6. Analyze selected items with visible progress, optional separation, provider destination, and a bounded resource estimate.
7. Review observations and generate a profile. Corrections are saved independently of model outputs.

No DAW installation is needed for audio references. Session rendering is only offered when a compatible DAW/plugin environment is actually available. Store permission to use the recordings for private analysis separately from permission for hosted processing or future training; sharing a file alone is not a training permission record.

## FL Studio adapter

### First delivery: reliable audio and archive intake

Provide a versioned FL export recipe requesting:

- The finished full mix and, when available, an unmastered version.
- A Zipped Loop Package or a project folder with its used samples, retained as source material.
- Processed mixer-track exports from the same song start/range with meaningful track names.
- Optional raw vocal exports with their editing/tuning state described.
- Tempo, song start, export sample rate, tail behavior, and whether master processing is present.

FL's documentation distinguishes mixer-track exports from playlist exports. Split mixer tracks omit master effects from individual track renders; playlist exports have different behavior. The adapter must record export mode and avoid assuming that similarly named files represent identical signal stages. [Image-Line export documentation](https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/fformats_save_export.htm)

A Zipped Loop Package includes project data and associated samples; Project Bones exports presets plus score/automation files. These are useful source artifacts, but neither establishes that third-party plugins can be decoded or rendered by our app. [Image-Line File menu](https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/menu_file.htm)

Keep source recordings, edited dry vocals, tuned vocals, post-insert vocals, vocal buses, and wet returns distinct. A vocal recorded with hardware compression is not untreated merely because DAW inserts are bypassed. Export work should use a copy of the session and leave the engineer's original intact.

### Later delivery: session metadata extraction

Evaluate read-only FLP parsing against a small compatibility corpus. PyFLP is a candidate, not a committed dependency. Review its license and packaging compatibility before adopting it. [PyFLP repository](https://github.com/demberto/PyFLP)

Probe specific fields: tempo/time signatures, playlist placements, names, mixer assignments, track gains/pans, sends, insert order, automation, sample references, and recognized built-in plugin parameters. Store source version and field-level coverage. Preserve opaque plugin state with a checksum; do not invent readable settings from an undecoded blob.

An adapter that extracts only tempo and track names is still useful if it says exactly that. Unknown events or version changes should degrade metadata coverage without preventing ingestion of valid audio.

## Pro Tools adapter

### First delivery: session package and exports

Provide a versioned recipe requesting a copied session with audio, a final mix, optional premaster, and common-start track/bus renders. Avid documents using Save Copy In with Audio Files to gather session media. [Avid session/media guidance](https://kb.avid.com/pkb/articles/en_US/How_To/Relink-missing-files-in-Pro-Tools)

Also accept Session Info as Text as supplemental metadata. Supported fields must be established from representative exports and the installed version; this text file is not assumed to contain full plugin parameters. Avid describes the command in its reference guide. [Pro Tools reference guide](https://resources.avid.com/SupportFiles/PT/Pro_Tools_Reference_Guide_2019.10.pdf)

Preserve PTX, audio folders, and supplied settings files. Discover split-mono channel pairs using metadata and user confirmation, not filename alone. Raw clips found in Audio Files may be unused takes or fragments; they are not automatically aligned training pairs.

Do not treat Consolidate, Export Clips, Commit, and Bounce as interchangeable processing stages. Version-specific instructions must be verified in a real session. Record whether edits, clip gain, tuning, inserts, faders, sends, buses, and master processing are included.

AAF/OMF may later help with timeline/media exchange, but are not the proposed transport for complete mixing decisions or arbitrary AAX state.

### Later delivery: companion capture

Evaluate the official Pro Tools Scripting SDK for collecting session identity, track lists, available metadata, and supported export operations. Avid exposes a language-independent API, but each required command and version must be checked against the installed SDK. [Avid SDK](https://developer.avid.com/scripting/)

The companion runs where Pro Tools and required AAX plugins are installed. Produce a portable manifest and audio renders; do not attempt to load AAX state directly into Vaudio's existing VST3/AU host. Route unsupported fields to unknown and retain rendered outcomes.

SDK eligibility, licensing/distribution, export support, hardware inserts, sidechains, and parameter/automation access are investigation gates. UI automation is a separate fallback, not an assumed first implementation.

## Other DAWs and extension contract

All DAWs can contribute standard audio exports immediately. DAW-specific capture is prioritized by user demand and verified fixtures:

| Candidate | Planned route | Decision boundary |
| --- | --- | --- |
| REAPER | Export recipe, then a ReaScript companion | Documented APIs make it a useful structured-capture candidate; verify parameter/state semantics |
| Bitwig / Studio One | DAWproject plus renders | Parse supported interchange fields; plugin state may still be opaque |
| Ableton Live | Audio export recipe first | Record return/main processing and prevent duplicated buses in analysis |
| Logic Pro | Audio export recipe first | Record bypass/automation choices and rendered instrument state |
| Other DAWs | Common audio folder/manifest | Native capture deferred until fixtures and demand exist |

REAPER provides a scripting API; DAWproject specifies arrangement/mixer/plugin-related interchange data. Ableton and Logic document their track export options. These establish candidate integration paths, not guaranteed interoperability. [REAPER](https://www.reaper.fm/sdk/reascript/reascripthelp.html), [DAWproject](https://github.com/bitwig/dawproject), [Ableton](https://www.ableton.com/en/manual/managing-files-and-sets/), [Logic](https://support.apple.com/en-kw/guide/logicpro/lgcpb27f70f9/10.7/mac/11.0)

Each future adapter reports supported versions, detected version, extractable fields, unresolved references, warnings, and whether rendering requires an external DAW. Its operations are detect, inventory, extract metadata, validate exports, and optionally capture renders.

## Canonical records

Use shared types independent of any DAW:

| Record | Essential fields |
| --- | --- |
| Engineer | ID, name, credits, notes, dataset memberships |
| Song | ID, composition/recording family, genre/context, contributor |
| Mix version | ID, song ID, version label, mix/master state, engineer/mastering credits |
| Artifact | ID, byte hash, decoded PCM hash, format/rate/channels/frames, role, original filename |
| Timeline mapping | Artifact ID, common origin, source range, offset, optional drift mapping, confidence |
| Processing stage | Source/edit/tune/insert/bus/master status, fader/send inclusion, known/unknown fields |
| Pair relationship | Input/output IDs, correspondence, stage difference, alignment and review status |
| Session graph | Tracks, clips, buses, sends, insert order, parameters with units, automation/timebase |
| Plugin capture | Instance identity/version, parameter identity/raw/normalized/display values, state/preset hashes, dependencies, per-field coverage |
| Layout | Track/folder order, grouping, clip arrangement, visual organization and optional screenshots |
| Capture coverage | Category/instance/field status, method, compatibility version, unresolved gaps and reproduction readiness |
| Provenance | Import ID, source DAW/version, adapter version, parent artifacts, transformations, permission scope |
| Evidence | Song/section/artifact IDs, measurement or observation, analyzer version, limitations |
| Engineer profile | Version, reviewed findings, evidence IDs, applicability, exceptions, evaluation status |

An artifact can appear in multiple songs/profiles through references without duplicated bytes. A decoded PCM hash recognizes the same audio with different containers; audio fingerprints suggest near-duplicates but never silently merge distinct mixes. Source paths are private metadata, not provider identifiers.

Preserve time in source frames/sample rate as the authoritative representation. Tempo/PPQ/timecode conversion is explicit. Equal durations alone do not establish alignment.

## Import and analysis pipeline

Persist stage state and artifacts before advancing:

`discover → validate → store originals → inventory → classify → align → review readiness → analyze → aggregate → review profile`

Each stage can complete, fail, or require review independently. Stable identities and content/version keys make retry idempotent. Interrupted stages resume after restart; cancellation stops new work and retains completed results. A new analyzer version creates a new result rather than overwriting historical evidence.

Validation covers decodability, empty/silent audio, channel layouts, non-finite samples, clipping, missing media, file/range mismatch, and archive integrity. Archive extraction uses bounded file count/expanded size, rejects escaping paths and unsafe links, and never executes embedded content.

Preserve originals without normalization. Make analysis copies with explicit transforms. Common-start exports are preferred; infer offsets only where credible. Cross-correlation is useful for similar dry/processed audio but cannot reliably align unrelated arrangements or heavily changed signals. Estimate drift for long recordings, show confidence, and allow manual alignment. Do not silently time-stretch training sources.

Check summation only for verified, non-overlapping stem sets. Child tracks plus their buses duplicate content; individual nonlinear renders need not sum to the full mix. A mismatch is diagnostic evidence rather than proof of a bad engineer export.

Separation is opt-in or an explicit processing preset. Store the model/version and link estimated sources to their parent mix. Avoid drawing fine-grained reverb or compression conclusions from artifacts introduced by separation.

## From dataset to style report

Analyze multiple meaningful sections per song, including contrasting verses/choruses and exposed vocals where available. Aggregate by independent song, genre, arrangement density, singer/recording characteristics, and mix/master stage. Ten clips from one song remain one song's evidence.

Each proposed finding contains an audible description, applicable conditions, supporting song/section links, counterexamples, measured ranges where valid, evidence type, and confidence status. Report uncertainty rather than infer a compressor ratio or EQ setting from a stereo result.

Create a readable report and structured profile from the same evidence records. The engineer can confirm, reject, or annotate a finding; confirmations do not retroactively make an audio inference a measured parameter. Preserve model reports, reviews, and profile versions separately.

Start with a practical pilot of roughly 10–20 varied songs if available, plus a few paired examples. This is a collection target, not a claim that this amount can train a general mixing model. Small datasets can still produce a descriptive profile with provisional status.

Reserve entire song/recording families for evaluation before selecting examples or building profile rules. Keep remasters, alternate mixes, stems, and derived clips of the same recording in one split. A future learned model also needs broader artist/session/genre separation to test generalization.

Retrieval first filters by processing stage, source role, genre/arrangement relevance, and reviewed evidence, then ranks reference sections. Global audio embedding similarity is supplemental: similar instrumentation is not proof of similar mixing.

## Proposed storage, modules, and routes

Keep datasets outside `.vaudio` song packages, with explicit links from projects to engineer/profile IDs. A portable dataset export contains its manifest, originals or selected audio, reviews, and provenance; projects need not duplicate the whole library. Profile links should indicate whether they are pinned or follow newer versions.

Candidate module boundaries: `shared/music/datasets/` for pure records/validation; `server/music/datasets/` for store, importer, adapters, pairing, and profile service; `src/suites/music/datasets/` for the workspace; independent hearing modules as specified in the other plan.

Begin with atomic JSON manifests and content-addressed file storage consistent with the local app. Keep persistence behind a repository interface; use SQLite later if transactions, scale, or concurrent jobs demand it. Restart-safe job records are required either way; the existing in-memory concurrency limiter alone is insufficient.

Proposed local API contract:

| Operation | Route family | Result |
| --- | --- | --- |
| Create/list datasets | `/api/music/datasets` | Dataset metadata |
| Import uploads/archive | `/api/music/datasets/:id/imports` | Import job ID |
| Review inventory/pairings | `/api/music/datasets/:id/items` | Versioned inventory and corrections |
| Start analysis | `/api/music/datasets/:id/analyses` | Hearing job references |
| Generate/review profile | `/api/music/datasets/:id/profiles` | Immutable draft/reviewed version |
| Export dataset | `/api/music/datasets/:id/exports` | Portable package job |

Browser APIs accept uploads, not arbitrary filesystem paths. Desktop-only imports use existing trusted local-selection mechanisms and server validation. Never expose arbitrary path reads through an LLM tool.

## Work packages and acceptance

1. **Fixtures, capture feasibility, and manifest:** finish common records, full-session coverage definitions, versioned FL/Pro Tools recipes, and sample contributor packages. Probe plugin parameters/state, routing, layout, and automation on both target DAWs before committing session-level support. Gate: engineer verifies export semantics and the tested extraction matrix is explicit.
2. **Audio/archive importer:** original storage, deduplication, progress/resume, song/version grouping, readiness report. Gate: identical repeat imports do not duplicate artifacts; failure never loses originals.
3. **Alignment and review:** roles, stage labels, pairings, manual offsets, confidence, unknowns. Gate: no ambiguous source becomes a trusted pair automatically.
4. **Hearing connection and report:** analyzer jobs, evidence links, profile versioning, corrections. Gate: all findings trace to source sections and claims distinguish observation from extracted settings.
5. **FL session adapter:** fixture-based parameters/state, routing, arrangement/layout, and automation extraction with coverage. Gate: supported fields match known sessions; unknown versions fail gracefully and source state is preserved.
6. **Pro Tools companion/session adapter:** implement the early spike's verified SDK/capture route, manifest, state artifacts, and exports. Gate: parameter and session fields proven on the target versions; unsupported access is visible rather than inferred.
7. **Other DAWs:** add one adapter at a time against the same manifest and compatibility matrix.

Meaningful verification includes corrupt/missing audio, duplicate containers, archive traversal/size limits, interrupted import, mono/stereo pairing, variable tempo/timecode, tail offsets, master processing, shared buses, opaque state, and locale/version differences in exports. Use synthetic fixtures with known timing and a small consented real corpus; DAW-dependent checks remain a separate manual compatibility suite.

## Decisions still requiring evidence

- Friend's FL Studio/Pro Tools versions and whether session archives can be supplied.
- Availability of premaster, beat-only, raw vocal, genuine stems, and processing notes.
- Whether plugin extraction licensing is compatible with the app's distribution.
- Which SDK operations expose the required fields; no assumption of arbitrary parameter access.
- Dataset size, disk budget, and profile portability requirements.
- Hosted-analysis and training permission scope for each contribution.

None blocks finishing this plan. Native extraction and any later training commitment remain conditional on these answers.
