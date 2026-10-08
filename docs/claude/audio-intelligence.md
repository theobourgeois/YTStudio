# Audio intelligence (the music suite)

- **Audio intelligence** (`docs/audio-intelligence/`: the plan is `audio-engineering-harness.md`, its slices
  `implementation-backlog.md`): giving the assistant truthful ears and hands. **A/B, D retrieval/workflows and bounded
  F package intake are built. C infrastructure and its held-out benchmark (`scripts/hearing-benchmark.ts`,
  `hearing-pack.ts`, `docs/audio-intelligence/hearing-benchmark.md`) are built and run; no listening task is promoted: the
  local measurements (`loudness.ts`: BS.1770 LUFS, EBU range, true peak; `spectrum.ts`: band balance, timed loudness and
  tone changes) are the ears. E's vocal run is built (`vocal-analysis.ts`, `vocal-mix.ts`, see below); G/H are planned.** `shared/music/audio-intelligence/` holds the contracts, all plain JSON, immutable, identified by a
  hash of what's in them (`shared/music/hash.ts`; their ids are fixed values in `identity.test.ts`: changing what
  is hashed orphans every stored record, so it's a schema change): `MixSnapshot` (`snapshot.ts`: the song's parts
  by hash, its media and plugins' state files by hash, and a `coverage` that says what couldn't be captured, so a
  capture never looks complete when it isn't; `diffSnapshots` is the stale check), `AudioArtifact` (`artifact.ts`:
  audio by content hash, its passage on the song's clock, what was done to it, and per-use permissions that start
  private), `EvidenceReport` (`evidence.ts`: measurements, observations and hypotheses kept apart, each naming its
  method or source, and what was inspected), `AudioJob` (`job.ts`: the state machine, cancel, retry, restart
  recovery) and `MixRun` (`run.ts`: phases and the budgets the service enforces whatever the agent asks).
  Validators refuse a record, never repair it, and check the id against the content. `families.ts` splits by
  recording family (a mix joins its sources' families) and `fixtures.ts` is the cleared collection, synthetic
  audio whose levels and correlations are known by construction. `server/music/audio-intelligence/` reads the
  files the pure builder can't (`captureSnapshot`, `FileHasher`). **Unknown stays unknown**: a null, a coverage
  gap or `unverified` is never filled with a guess (a plugin's version isn't recorded by the engine today, so
  a snapshot with outside plugins is `partial`; `docs/audio-intelligence/engine-render-limits.md` lists what a
  render can and can't promise: it starts cold, takes the device, and uses the live plugin instances).
  Slice B (`render-and-measure.md`) adds `AudioIntelligence` (`server/music/audio-intelligence/service.ts`):
  project-scoped source copies, artifacts, reports and durable jobs under `data/audio-intelligence/`. Capture uses
  the chat's live tab; render/analyse/status/cancel/retry/report/registration dispatch on the server via the
  platform's optional `AssistantOptions.serverTool` callback (wired in `app.ts`), so closed tabs don't lose jobs.
  Running jobs recover as interrupted; retry is explicit and bounded. Built-in-only song-mode renders share the
  engine's export queue and use a trusted resolver for immutable source copies. Measurements (`measure.ts`)
  inspect only passage frames, keeping lead-in/tails intact; no hosted hearing or musical opinions. A render can keep a
  track's stem (`stemTrackId`). E (`vocal-mix-workflow.md`): `create_vocal_mix_run` renders the beat (vocal muted) and the
  song with the vocal's stem, `analyseVocal` measures one against the other, `proposeVocalChanges` turns findings both
  passages share into bounded changes (fader, YT-C, YT-EQ: `applyVocalChange`; the fader is cubic, `faderMoved`), each
  rendered, measured, level-matched once (`levelMatch`) and compared at matched LUFS, on a `MixRun`; candidates are
  measured over the baseline's singing (`VocalAnalysis.sounding`).
  D (`workflows-and-examples.md`) adds curated workflow discovery, separately typed effect/decision/preference
  examples, reviewed use/context filters and source-backed profiles. `ExampleLibrary` stores project-local data
  separately from songs; references retain unknown units/intent and never become executable settings. F
  (`ordinary-package-ingestion.md`) adds `DatasetService`: bounded folder/ZIP imports, hash-preserved originals,
  durable import/review records, honest native extraction coverage, reviewed pair/tap/gain/latency context and
  profile/source links. `scripts/engineer-package.ts` is the local intake/review CLI. Only registered-ID inspection
  and analysis tools reach MCP; review/permission/profile writes are user routes. Native FLP/PTX/presets stay
  opaque until a tested adapter exists. Reviewed WAV excerpts retain parent/crop provenance and use B's local
  measurements; hosted listening additionally rechecks the dataset source's grant.
