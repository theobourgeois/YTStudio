# Foundations prototype: implementation and validation

Status: proposed next implementation task, 2026-10-03. Nothing below is implemented or benchmarked yet.
This milestone builds the application's first real foundation, with intentionally limited feature coverage.

## End-to-end result

Open a large JPEG/PNG; place a second image; transform it; add exposure/curves; select a region and
paint a layer mask; add editable flare/glow; undo/redo; save; close; reopen; export PNG/JPEG. The project
remains editable, portable and recoverable. Effects crossing tiles render without seams.

This workflow tests resources, commands, coordinate systems, color, rendering, UI and persistence
together. A polished workspace around a single mutable canvas does not pass this milestone.

## Implementation order

### F0: prove backend and presentation

Create a small independent C++20 photo target. Implement capability handshake, one test source, a
float surface, masked source-over, exposure and viewport output. Add one CPU reference kernel and
native headless fixture. Integrate a minimal canvas presenter in our development and packaged app.

First candidate is Dawn/WGSL. Exercise bounded viewport readback, then shared textures if necessary.
Check the installed Electron API, texture format/color tagging, synchronization and sandbox bridge.
Record build dependencies, binary size and latency. Force device loss/restart and verify cleanup.

**Gate:** select the backend/presenter using evidence. A standalone render that cannot reach our canvas
is insufficient. Failed presentation may justify changing that adapter/backend; the document/resource
contracts below should survive. Do not implement two complete backends speculatively.

### F1: resource/document/command skeleton

Define the minimum `PhotoProject`, layer/effect/resource IDs, pure edits, validation and a versioned
render-plan/protocol schema. Register the photo suite and a minimal workspace. Build source import,
immutable tile manifests, a configurable CPU/GPU budget, binary viewport delivery and revisions/epochs.

Initial authored tile formats are explicit float32 color and coverage; prototype tile candidates are
256 and 512. Imported source files belong to the existing project package. Decoder/color libraries
are selected using profile/orientation/precision fixtures. No image buffers in metadata/history.

**Gate:** open a 48 MP document; pan/zoom at several DPRs; change a layer transform; restart the engine;
render the same document again. Memory is accounted and old revision responses cannot overwrite new views.

### F2: masks, brush transactions and history

Add a basic round mask brush and rectangular selection. Capture input on the tool path, batch samples,
paint copy-on-write draft tiles, finalize/publish resources, commit one metadata/history operation.
Implement Escape/pointercancel, target capture, undo/redo and history/selection resource pins.

**Gate:** cross a tile boundary, undo, redo and compare exact authoritative coverage. Cancelled strokes
leave the committed document unchanged. A small edit shares unchanged tile IDs. Duplicate/out-of-order
input and stale transactions are rejected or deduplicated deterministically.

### F3: adjustments and creative processing

Add exposure, identity/composite curves, multi-scale glow and a flare generator with source glow,
halo, ghost and streak elements. Register central parameter definitions and canvas handles. Implement
region dependencies, halo expansion, deterministic noise and final SDR output mapping.

**Gate:** compare monolithic small-fixture rendering with tile rendering; test radii wider than a tile,
transparent edges and above-white color. Settled preview and export use the same evaluator. Save each
effect's implementation version. Changing a slider produces one history entry and invalidates only
the necessary graph nodes/dependencies.

### F4: durable save, export and recovery

Integrate resource publication with autosave/flush; save a verified checkpoint only after referenced
blobs exist. Keep prior recovery state. Package duplication/remapping includes photo resources. Export
pins a committed revision, streams full-quality tiles, embeds output color information and publishes
a completed file atomically. Editing can continue while that snapshot renders.

**Gate:** reopen after normal close, project move and duplicate; compare resource references and output.
Inject failure before/after each save publication step. Stop the engine during a stroke and during
export. Simulate disk full. Recover a consistent checkpoint and retain the previous successful output.

### F5: harden the usable workflow

Complete Layers/Properties/tool options, saved state and error handling; implement the assistant's
read/core edit tools through the same commands. Run the whole editing walkthrough in both development
browser and packaged desktop. Record benchmark results and limitations, then update the docs to match.

**Gate:** the owner can perform the complete workflow without using developer tools. No unresolved
data-loss, stale-response, color-tag or tile-seam failures remain. Backend tradeoffs and remaining
feature gaps are explicit.

## Proposed performance targets

Targets below need a named baseline machine. Record CPU/GPU, RAM, OS, Electron build, backend, output
viewport/DPR, build type and storage. Measure warm/cold separately and report p50/p95 plus worst visible
stall. Do not claim a target is achieved from averages or a tiny fixture.

| Scenario | Initial target | Method |
| --- | --- | --- |
| Tool/cursor response | Next display frame, independent of image jobs | Input timestamp -> overlay presentation |
| Simple pan/transform on warm 48 MP document | Aim for 60 Hz; p95 frame time <= 33 ms as initial gate | 1920×1080 device-pixel viewport, fixed scripted path |
| Mask stroke first visible response | p95 <= 50 ms | Input sample -> presented matching transaction |
| Exposure/curves interactive preview | p95 <= 50 ms | Parameter change -> current-revision preview |
| Heavy glow/flare preview | First approximate response <= 100 ms; refinement visibly progresses | High radius and several elements, fixed viewport |
| Small-stroke undo/redo | p95 <= 100 ms | Command -> correct resource/view presented |
| Memory | Within configured aggregate budget; bounded queues | Track CPU/GPU/scratch/pinned bytes throughout |
| Export | Correct and cancellable with progress; throughput recorded | Full-resolution 48 MP PNG/JPEG, fixed settings |

These are proposed acceptance thresholds, not universal guarantees. If targets miss, identify decode,
processing, readback, transport and presentation costs separately. Revise a target only with recorded
evidence and product consequences. Measure RAM-pressure behavior, not just an idle high-memory machine.

Benchmark datasets: 24/48/100 MP single images; 48 MP five-layer composite; sparse mask strokes; ten
fully populated layers as a stress case; huge glow support; out-of-canvas source; deep effect stack;
transparent colored edges; portrait cutout; tagged profiles and 16-bit ramps. Include synthetic
fixtures with redistribution-safe provenance and representative owner-provided images when available.

## Correctness and fault matrix

| Area | Required evidence |
| --- | --- |
| Domain edits | Stable IDs/order, validation, no-ops, migrations, bad references/cycles rejected |
| Coordinates | Pixel-center convention, inverse transforms, zoom/DPR, selection/mask spaces |
| Tiles | Boundary-crossing paint/filter, implicit defaults, halos, minified mip alignment |
| Precision | CPU/reference comparison, identity curves, source-over, 16-bit distinction, float range |
| Color/alpha | Known profile transforms, orientation once, no alpha color transform, no double display transform |
| History | One gesture/step, exact resource restoration, pins across undo/redo, cancellation |
| Async protocol | Stale view, project switch, duplicate finalize, engine epoch, bounded backpressure |
| Persistence | Reachability before save, old/new checkpoint consistency, move/duplicate and disk-full recovery |
| Export | Same snapshot despite later edits, full quality, profile/alpha/matte, cancellation/collision |
| UI | Active target, keyboard focus, tool cancellation, accessibility labels, dark/light |

Compare float-domain kernels against analytic CPU fixtures with declared per-kernel tolerances; choose
those tolerances from algorithm/precision analysis and commit them before reviewing results. Compare
settled viewport against the same full-quality crop at matched sampling/output settings. Bit-identical
results across different GPU drivers are not a blanket promise. Undo resource identity *is* exact.

Fault injection includes interrupted blob write, finalized blob before document commit, interrupted
checkpoint rename, stale save completion, engine death, GPU loss, missing source, corrupt manifest,
unsupported effect version, scratch exhaustion and output encoder failure.

## What persists beyond the prototype

Canonical document/migrations, immutable resource format, command/transaction contracts, versioned
effects, coordinate/color rules, dependency-aware evaluator, checkpoint lifecycle and fixture corpus.
Keep the backend/presenter replaceable. Prototype-only debug UI and temporary transport optimizations
must not leak into persisted files. An incomplete implementation is acceptable; unowned data lifetimes
or two conflicting sources of truth are not.

## Next milestones after foundations

1. Core depth: groups/isolation, clipping, crop/resize, richer selections, levels/saturation and masks.
2. Painting/retouch: actual opacity/flow, eraser/tablet, clone sampling, then healing research.
3. Composition: text, vector shapes/paths, layer styles, richer flare presets and additional effects.
4. Photography/interchange: 16-bit formats, RAW development and an explicitly supported PSD subset.

Each milestone starts with its feature research and ends with a complete workflow. Priorities can shift
with the owner's use without replacing the foundation.

## Evidence log

| Gate | State | Evidence |
| --- | --- | --- |
| F0 backend/presenter | Not started | No build or measurements yet |
| F1 document/resources | Not started | Architecture proposal only |
| F2 mask/history | Not started | Transaction contract only |
| F3 effects | Not started | Video kernels identified as possible references |
| F4 persistence/export | Not started | Existing package integration inspected |
| F5 usable workflow | Not started | UX/acceptance proposal only |
