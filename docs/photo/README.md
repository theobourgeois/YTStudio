# Photo suite

Status: plan revised and hardened 2026-10-05 (first written 2026-10-03). No photo code exists yet; the capability
probes behind the revision are in [foundations-prototype.md](foundations-prototype.md#evidence-log).

A Photoshop-style image editor with dependable layers, masks, painting and retouching, and a particularly strong set
of editable light effects. The foundations are the application's first version, so the document, resource, colour
and rendering contracts are real from the start.

## In one paragraph

The tab owns the document and its undo history, as in every suite. It renders and paints with **WebGPU** in the page,
and the same renderer draws the view, thumbnails, the assistant's pictures and exports. Pixels are **immutable,
content-addressed tiles** in the project's package, referenced by hash from small manifests, so undo is switching a
hash and a stroke writes only the tiles it touched. The server stores and verifies blobs; a **helper process** (sharp,
libvips) is the only code that parses image files. Colour is linear extended sRGB, premultiplied, converted from each
source's profile on the GPU without clipping, and leaves through one output transform.

## Read in this order

1. [Product](product.md): what it's for, the scope by milestone, boundaries, questions for Théo.
2. [Photoshop research](research/photoshop-foundations.md): reference behaviour and our differences.
3. [Architecture](architecture.md): where work happens, the document, resources, persistence, platform integration.
4. [Rendering](rendering.md): colour, formats and precision, resampling, the output transform, tiles, the evaluator.
5. [UX](ux.md): workspace, keys and interaction contracts for the first workflow.
6. [Effects](effects/system.md): definitions, glow, the flare, porting from the video editor.
7. [Foundations](foundations-prototype.md): milestones F0–F5, gates, targets, the evidence log.
8. [Engine options](research/engine-options.md): why WebGPU in the page, measured; the fallbacks.
9. [Sources](research/sources.md): references and what's still unverified.

## Labels

Use these in research: **Verified reference** (primary documentation or direct observation), **Measured** (we ran
it; the evidence log says where), **Product decision** (our chosen behaviour), **Proposed** (a default to validate)
and **Unverified** (an open question). Théo's corrections override the reference; record the resulting behaviour.

## Keeping these useful

- **Research before building**: research a feature family just before implementing it. Record the reference
  behaviour, our differences, gestures and keys, data and processing needs, failure cases and acceptance examples.
- **Keep them current**: update a document when the implementation or a decision changes. Add a dated entry to the
  ledger below when a foundational contract changes, with the reason, the rejected alternative and what has to
  migrate.
- **Decide openly**: don't turn an open question into an implicit implementation choice. Routine choices are made in
  the milestone, with evidence recorded.

## Decision ledger

| ID | Decision | Reason | Revisit if |
| --- | --- | --- | --- |
| P01 | Photoshop-style composition first, photography development later | What Théo asked for | The first complete workflow says otherwise |
| A01 | **Render and paint in the page with WebGPU (WGSL); no native photo engine** (2026-10-05, replaces the C++20 engine) | Photo has no native-only need (music's engine exists for plugins and the audio device); measured: Electron 44 and headless Chromium both expose Metal WebGPU with every feature needed; one renderer for view and export; removes the native-to-page presentation problem | F0 misses its gate → WebGL2, then native Dawn with the same WGSL |
| A02 | **Image files are parsed only by a helper process** (sharp/libvips), started by the server (2026-10-05, replaces the separate engine process) | A malformed file can't crash the app (the desktop server runs in Electron's main process); sharp decodes 48 MP in ~0.23 s; 16-bit in and out | Packaging sharp fails, or a format needs a platform decoder (HEIC: macOS) |
| A03 | Immutable tiles and manifests, **content-addressed** (SHA-256 of raw samples), constant tiles stored as values | Undo = switch a hash; small strokes share tiles; idempotent uploads; ids known in the tab at once | Stroke or memory measurements |
| A04 | **The publication gate**: a saved document only references blobs the server has; the server refuses otherwise | Ordering without a transaction protocol | — |
| A05 | Extended linear sRGB, premultiplied; **profiles converted on the GPU, unclipped** (matrix/TRC); LUT profiles via Little CMS to sRGB, reported | Measured: sharp's conversion clips P3 even into float | A profile family we must support isn't matrix/TRC |
| A06 | Same evaluator for view, thumbnails, assistant and export; **the settled view is the full-resolution render, reduced** | No divergence between what's seen and what's exported | — |
| A07 | `.vaudio` package; `photo/resources` authored, `photo/cache` rebuildable and never copied; media ids only in `project.json` | Portable projects; the platform remaps only the document | Duplicate/move/reopen tests |
| A08 | Formats: `rgba16f` for 8-bit sources and paint, `rgba32f` for 16-bit sources, `r16f` coverage; an unedited 8-bit sRGB round trip is bit-exact | Precision worked out in rendering.md | Precision fixtures |
| A09 | One output transform (`film` or `clip` highlights, 8-bit dither ±0.45 step), no tone curves inside effects | Effects compose; exact levels survive | Théo's comparison in F4 |

Progress, measurements and gates live in [foundations-prototype.md](foundations-prototype.md).
