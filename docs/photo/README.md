# Photo suite foundations

Status: initial product and architecture proposal, researched 2026-10-03. No photo implementation exists yet.

Build a Photoshop-style image editor with dependable layers, masks, painting and retouching, plus a
particularly strong library of editable lighting and render effects. The foundations prototype is
intended to become the application, so its document, resource and rendering contracts must be real.

## Read in this order

1. [Product](product.md): intended work, scope, priorities and completion criteria.
2. [Photoshop research](research/photoshop-foundations.md): confirmed reference behavior and our differences.
3. [Architecture](architecture.md): module ownership, document/resource model, transactions and integration.
4. [Rendering](rendering.md): pixels, color, tiles, compositing and effects.
5. [UX](ux.md): workspace and interaction contracts for the first workflow.
6. [Effects](effects/system.md): extensibility and the first flare/glow implementation.
7. [Foundations prototype](foundations-prototype.md): implementation order, experiments and acceptance gates.
8. [Engine research](research/engine-options.md): alternatives and the evidence behind the recommendation.
9. [Sources](research/sources.md): primary references, repository evidence and remaining verification.

## What is decided, and what is proposed

**User requirements:** Photoshop-style workflow; substantial feature depth; creative effects including
excellent lens flares; modular foundations that can become the lasting application. The current task
authorizes research and documentation. Prototype implementation is the next task.

**Recommended defaults:** React/TypeScript interface; independent C++20 photo engine; tile-based resources;
one canonical document and undo history; floating-point rendering; native GPU execution; local project
packages; preview and export using the same evaluator. These are architectural proposals, not measured
results or claims of Photoshop file compatibility.

**Experiment before commitment:** GPU backend, native-to-Electron presentation, decoder dependency,
tile size, memory budgets and performance targets. The prototype has an explicit gate for each.

Use these labels in future research: **Verified reference** (primary documentation or direct observation),
**Product decision** (our chosen behavior), **Proposed** (a default to validate), **Unverified** (a question).
The owner's corrections override the reference; record the resulting behavior and its implications.

## How these docs stay useful

Research a feature family just before implementing it. Record reference behavior, our differences,
gestures/shortcuts, data and processing requirements, failure cases and end-to-end acceptance examples.
Update the document when the implementation or decision changes. Add a short dated decision entry when
changing a foundational contract; include the reason, rejected alternative and migration consequences.

Do not turn an unresolved question into an implicit implementation choice. Resolve routine choices in
the milestone and record evidence. Product tradeoffs can be reviewed through concrete working examples.
Do not require approval for every internal module or reversible experiment.

## Decision ledger

| ID | Proposal | Reason | Validation/change trigger |
| --- | --- | --- | --- |
| P01 | Photoshop-style composition first, photography development later | Matches requested product | First complete editing workflow |
| A01 | C++20 engine; TypeScript document semantics and UI | Fits existing native integration; separates pixel work | Protocol and transaction tests |
| A02 | Separate photo target/process from audio | Independent lifecycle and dependencies | Build/package/restart smoke test |
| A03 | Immutable tiled pixel resources referenced by document | Large images and efficient undo | Mask stroke and memory measurements |
| A04 | Native GPU pipeline; Dawn/WGSL first candidate | Compute and a portable native API | Backend/presentation experiment |
| A05 | Extended linear sRGB first working space; explicit operation domains | Defined light math and unclipped intermediate values | Color and transparency fixtures |
| A06 | Same renderer for viewport, thumbnails and export | Avoid divergent effects | Full-resolution comparison fixtures |
| A07 | Existing `.vaudio` package with photo-owned resources | Portable projects and existing shell | Duplicate, move, reopen, interrupted-save tests |

Implementation progress and benchmark evidence belong in [foundations-prototype.md](foundations-prototype.md).
