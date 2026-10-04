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

## Slice B: render and measure through tools

Depends on A. Deliverables:

- Register immutable artifacts in project-scoped storage.
- Render selected passages with sufficient lead-in and tails using serialised engine access.
- Persist job state, progress, cancellation, failure, and restart recovery.
- Return supported level, dynamics, tonal, timing, and stereo measurements with method/version information.
- Add MCP capture/render/analyse/job-status tools and server-owned dispatch for background jobs.

Acceptance: the assistant can capture an existing song, render a passage, obtain a report, and cancel safely. Known-signal fixtures validate measurements. Closing a tab does not silently discard an already running server-owned job.

## Slice C: add hosted perception

Depends on artifact contracts from A/B. Deliverables:

- Build a replaceable perception adapter that receives audio bytes and task-specific questions.
- Prepare model-specific copies while preserving full-resolution measurement inputs.
- Record resampling/downmixing, source-time mappings, upload destinations, provider version, cost, and limitations.
- Validate timestamped observations and distinguish them from measured facts.
- Benchmark supported tonal/dynamic/context tasks against DSP-only evidence and no-change cases.
- Add bounded retries, caching, cancellation semantics, and unavailable-provider fallback.

Acceptance: the provider adds demonstrated useful evidence on held-out tasks; unsupported claims are suppressed. Do not select a provider solely because it can describe music in general.

## Slice D: expose workflows and examples

Depends on reviewed dataset records from A. Deliverables:

- Define EffectExample, DecisionExample, and PreferenceExample separately.
- Build eligibility/context filters and a small local search index.
- Provide provenance, native values/units, missing fields, and relevance limits in retrieval results.
- Author a vocal-compression workflow and an EQ workflow with tool prerequisites, comparisons, and stopping rules.
- Expose workflow discovery/retrieval through MCP; keep the current runtime's file/shell isolation.
- Load compact relevant material on demand rather than the entire dataset into the prompt.

Acceptance: Claude retrieves a relevant procedure/example, recognises missing context, and does not convert annotated or unknown units directly into plugin edits.

## Slice E: complete the first mixing task

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
