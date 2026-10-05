# Audio engineering harness implementation checklist

Planning only; no application work is authorised by this document. The [complete architecture](audio-engineering-harness.md) defines the design; this checklist translates it into reviewable implementation slices. Order is based on dependencies, not calendar estimates.

## Slice A: establish truthful inputs

Deliverables:

- Define immutable project snapshot, audio artifact, evidence, job, and mix-run contracts.
- Include document revision, media hashes, routing/automation, plugin identity/state, render settings, and capture completeness.
- Establish a small cleared fixture collection with vocal/beat roles and recording-family IDs.
- Document current engine rendering and plugin-state restoration limits.
- Audit CL 1B array layout, labels, fixed controls, input/output alignment, and original encoding; preserve unresolved units.
- Select a reviewed MixParams reference subset rather than automatically exposing every row as executable settings.

Acceptance: every example and render can be traced to an exact source/state; unknown controls remain unknown; dataset eligibility is recorded. No automatic neural training or full pickle execution is required.

### Slice A status: built (2026-10-04)

| Deliverable | Where | State |
| --- | --- | --- |
| Snapshot, artifact, evidence, job and mix-run contracts | `shared/music/audio-intelligence/` (`types.ts`, `snapshot.ts`, `artifact.ts`, `evidence.ts`, `job.ts`, `run.ts`, `validation.ts`) and `shared/music/hash.ts` | Built, pure, tested (ids pinned in `identity.test.ts`) |
| Document revision, media hashes, routing/automation, plugin identity/state, render settings, capture completeness | `MixSnapshot` and `coverage` (`snapshot.ts`); `server/music/audio-intelligence/` reads the files (`captureSnapshot`, `FileHasher`) | Built. Plugin version is recorded when known, and is not known today, so a song with outside plugins is `partial` by design |
| Small cleared fixture collection, vocal/beat roles, recording-family ids | `fixtures.ts` (ten synthetic fixtures with known levels, phrases, hits and correlations), `families.ts` (splits by family), `scripts/make-audio-fixtures.ts` | Built. Synthetic only: real, cleared recordings (the plan's pilot of 20 to 30) are still to be gathered |
| Engine rendering and plugin-state limits | [engine-render-limits.md](engine-render-limits.md) | Written from the code. Nothing was measured on the real engine (`engine/build` was absent): its statements say *read*, *tested* or *unverified* |
| CL 1B layout, labels, fixed controls, alignment, encoding | [cl1b-audit.md](cl1b-audit.md), `scripts/audit-cl1b.py` (static, never unpickles; its safety is tested by `scripts/audit-cl1b.test.py`) | Test member read in full, train member's first array and a prefix of the second. Ratio and threshold units, train pairing and train alignment are **unresolved**; closing them means reading the whole 6.7 GB train member, a decision for whoever owns the budget |
| Reviewed MixParams reference subset | [mixparams-reference-subset.md](mixparams-reference-subset.md), `shared/music/mix-reference.ts`, `scripts/select-mixparams.ts` | 143 lead-vocal compressor records, all `unitStatus: unverified`, none executable or trainable. MixParams has no licence: rows live only in the gitignored `data/` |

Decisions Slice A made that later slices depend on:

- A record is **refused, never repaired**, and its id must be the hash of its content: a manifest edited by hand fails.
- Permissions start **private**: hosted analysis and training are off until someone says otherwise, and a hosted observation about audio that may not leave the computer fails validation.
- A snapshot's identity leaves out the song's name, when it was captured and where from; renaming a song or capturing it twice gives the same snapshot.
- A mix's recording families are its sources' families, so a mix can never land in a different split from the vocal and beat in it.

## Slice B: render and measure through tools

Depends on A. Deliverables:

- Register immutable artifacts in project-scoped storage.
- Render selected passages with sufficient lead-in and tails using serialised engine access.
- Persist job state, progress, cancellation, failure, and restart recovery.
- Return supported level, dynamics, tonal, timing, and stereo measurements with method/version information.
- Add MCP capture/render/analyse/job-status tools and server-owned dispatch for background jobs.

Acceptance: the assistant can capture an existing song, render a passage, obtain a report, and cancel safely. Known-signal fixtures validate measurements. Closing a tab does not silently discard an already running server-owned job.

### Slice B status: built (2026-10-04)

See [render-and-measure.md](render-and-measure.md) for tools, storage, recovery, measurements and verified limits. Implementation: `server/music/audio-intelligence/service.ts`, `measure.ts`, `routes.ts`; MCP server dispatch in `AssistantService`, with live capture through the music tab. Engine exports share a serialized queue.

The capture → render → analysis → report path is implemented and tested, including closed-tab operation, native-engine source preservation, cancellation, restart recovery and project isolation. Initial render support is built-in processors only. Local methods cover level, dynamics, broad filter energy, activity timing and stereo; LUFS, true peak, musical judgement and hosted perception are explicitly unavailable. Audio stays private/local by default.

Real-audio verification (2026-10-05): [the vocal-mix workflow](vocal-mix-workflow.md)
exercises live capture/render/measure/report through the actual project-bound MCP
tools using aligned recorded vocal/accompaniment audio and the native engine.

## Slice C: add hosted perception

Status: [infrastructure and generated-audio pilot implemented](hosted-perception.md). The updated key works and one 3.7 Flash audio response completed; 3.8 returned HTTP 503. The completed generated case contained unsupported source claims. Held-out usefulness acceptance remains pending and Gemini tasks remain unverified.

Depends on artifact contracts from A/B. Deliverables:

- Build a replaceable perception adapter that receives audio bytes and task-specific questions.
- Prepare model-specific copies while preserving full-resolution measurement inputs.
- Record resampling/downmixing, source-time mappings, upload destinations, provider version, cost, and limitations.
- Validate timestamped observations and distinguish them from measured facts.
- Benchmark supported tonal/dynamic/context tasks against DSP-only evidence and no-change cases.
- Add bounded retries, caching, cancellation semantics, and unavailable-provider fallback.

Acceptance: the provider adds demonstrated useful evidence on held-out tasks; unsupported claims are suppressed. Do not select a provider solely because it can describe music in general.

## Slice D: expose workflows and examples

Status: the first [bounded vocal workflow](vocal-mix-workflow.md) is implemented
and available through assistant tools. General reviewed example/profile retrieval
and dataset eligibility indexing remain planned.

Depends on reviewed dataset records from A. Deliverables:

- Define EffectExample, DecisionExample, and PreferenceExample separately.
- Build eligibility/context filters and a small local search index.
- Provide provenance, native values/units, missing fields, and relevance limits in retrieval results.
- Author a vocal-compression workflow and an EQ workflow with tool prerequisites, comparisons, and stopping rules.
- Expose workflow discovery/retrieval through MCP; keep the current runtime's file/shell isolation.
- Load compact relevant material on demand rather than the entire dataset into the prompt.

Acceptance: Claude retrieves a relevant procedure/example, recognises missing context, and does not convert annotated or unknown units directly into plugin edits.

## Slice E: complete the first mixing task

Status: a first [local candidate comparison](vocal-mix-workflow.md) is implemented:
baseline plus three native vocal alternatives, two passages, matched playback,
stale/source checks and one-step apply/undo. These are fixed audition proposals.
General MixRun orchestration, learned proposals and held-out genre/listener quality
acceptance remain pending; this does not mark the full slice complete.

Depends on B/C/D. Deliverables:

- Persist a MixRun containing goal, constraints, snapshots, coverage, evidence, candidate IDs, and budgets.
- Create disposable candidates with built-in compressor/EQ patches validated in native units.
- Render the baseline and candidates using consistent conditions.
- Compare at matched listening levels while retaining unmatched audio for headroom checks.
- Check a second passage before claiming improvement.
- Present alternatives/ties/no-change outcomes, with a concise evidence-backed explanation.
- Accept a targeted candidate patch as one undoable transaction with document and plugin-state revision checks.
- Restore affected plugin files as well as document state during undo/redo.

Acceptance: on a previously unseen vocal/beat example, the assistant completes capture -> analysis -> proposal -> render -> comparison -> acceptance. User edits during the run cause a stale-state result rather than overwriting their work. Reverting restores the original mix.

## Slice F: ordinary engineer-package ingestion

Can start after A; integrate after D. Deliverables:

- Import generic folders/archives containing native sessions, media, stems, and final mixes.
- Preserve source hashes; classify song/version/role; surface unresolved relationships.
- Review raw/processed pairings, tap points, gain differences, offset/latency, and mastering status.
- Add FL Studio/Pro Tools adapters only for a declared tested format/version/plugin matrix.
- Record extracted, opaque-preserved, unsupported, missing, and failed coverage independently.
- Build reviewed engineer profiles from available evidence, retaining exceptions and source links.

Acceptance: the friend can send an ordinary package without running capture tools. Partial extraction is useful and honestly reported. Opaque plugin blobs are never displayed as known compressor settings.

## Slice G: prove usefulness and operate reliably

Depends on E. Deliverables:

- Build blind, matched-level comparison trials with independent recordings, ties, and judge disagreement.
- Compare against no processing, a sensible fixed workflow, and the current assistant.
- Test whether hearing, retrieval, workflows, and profiles each improve the result.
- Exercise engine/plugin crashes, provider timeouts, job restart, cancellation, and interrupted acceptance.
- Report cost and latency per completed run, including failed attempts.
- Add comparison playback, candidate diffs, progress, and undo controls to the music UI.
- Release read-only analysis first, candidate audition next, then bounded autonomous edits.

Acceptance: quality claims are supported by listening trials; state correctness and complete undo pass release checks. Available capabilities are clear during provider outages.

## Slice H: train only for demonstrated gaps

Depends on G and sufficient eligible data. Deliverables:

- Choose one measured failure: hearing, candidate proposals, retrieval, preference evaluation, or hardware emulation.
- Define its training target and held-out success criteria before generating labels.
- Create a conversion/label pipeline with recording-family splits and preserved provenance.
- Compare the fitted component against the existing untrained workflow.
- Deploy behind the existing adapter/tool interface only if improvement justifies cost and maintenance.
- Investigate self-hosted perception separately using the same capability benchmarks.

Acceptance: improvement survives held-out source recordings and relevant baselines. Successful compressor emulation is not presented as successful musical judgement.

## First reviewable implementation milestone

Slices A/B produce the first useful foundation: Claude obtains a passage render and truthful measurement report from the current song. Slices C/D/E produce the first complete mixing loop. Broader native session extraction and model training follow without blocking that loop.

During implementation, run the repository-required checks for changed code and UI, plus meaningful native audio fixtures. For this planning-only change, validate documents and references; the CL 1B archive has already passed published checksum and ZIP CRC checks.
