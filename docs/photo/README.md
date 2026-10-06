# Photo suite

Status: plan revised and hardened 2026-10-05 (first written 2026-10-03). **F0, F1, F2 and F3 are built**: the
renderer, the helper and the blob store (F0); the photo suite itself (F1: new photos, image layers, transforms,
export, the assistant); layers and adjustments (F2: Exposure and Curves adjustment layers, the render plan, refined
views, f32 composites for 16-bit sources); resources, selections, masks and the brush (F3: pixel layers, layer masks,
the Rectangular Marquee, the round brush, the publication gate and collection). Results in
[foundations-prototype.md](foundations-prototype.md#f3-results-2026-10-06). Layer Style's first two phases are built
(L1: Blending Options, Photoshop's 27 blend modes, Fill, channels, Blend If and its compositing, the mode menu's live
preview, the Layer Style window; L2: Drop and Inner Shadow, Outer and Inner Glow, Color and Gradient Overlay, Stroke,
contours, gradients, Global Light): [layer-style/README.md](layer-style/README.md). F4 (light: glow and the flare) is next.

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
2. [Photoshop research](research/photoshop-foundations.md): reference behaviour and our differences; per feature
   family: [adjustments](research/adjustments.md) (Exposure, Curves).
3. [Architecture](architecture.md): where work happens, the document, resources, persistence, platform integration.
4. [Rendering](rendering.md): colour, formats and precision, resampling, the output transform, tiles, the evaluator.
5. [UX](ux.md): workspace, keys and interaction contracts for the first workflow.
6. [Effects](effects/system.md): definitions, glow, the flare, porting from the video editor.
   [Layer Style](layer-style/README.md): Blending Options and layer effects, researched and planned (not built).
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
| A09 | One output transform (`film` or `clip` highlights, 8-bit dither ±0.375 step), no tone curves inside effects | Effects compose; exact levels survive (0.092-step worst f16 error, measured) | Théo's comparison in F4 |
| A10 | Kernels round to the nearest half themselves before storing f16 (2026-10-05, F0) | Metal truncates on f16 storage writes and the compiler drops `quantizeToF16`: both measured | A backend that rounds on store |
| A11 | A layer's place is centre, scale and rotation (`LayerTransform`), not a matrix (2026-10-05, F1) | Typed values stay exact (100% is 1, not 0.9999…); the UI and the assistant speak in these | Skew or perspective: a matrix, by migration |
| A12 | Layers whose pixels land on the target's are read texel for texel (2026-10-05, F1) | Mitchell softens even at 100%: an unedited export wouldn't be bit-exact | — |
| A13 | An adjustment layer holds one `EffectInstance` (id, type, version, enabled, params); document version 2 (2026-10-05, F2) | Layer effects (F4) reuse the instance; an unknown or newer one is kept as it was | — |
| A14 | Curves' points are stored as Photoshop shows them, `[input, output]` on 0..255; channel curve, then the composite; natural cubic spline (2026-10-05, F2) | Typed, written by the assistant and saved alike; the order and spline's ends are unverified (research/adjustments.md) | Théo's check in Photoshop says otherwise: a new definition version |
| A15 | Exposure keeps Photoshop's three controls in linear light; gamma's power is 1 / gamma, mirrored below 0 (2026-10-05, F2) | Photoshop's control set; with gamma 1 it commutes with reduction | The direction is unverified: a new version if Photoshop's is the other way |
| A16 | Identity adjustments are left out of the render plan (2026-10-05, F2) | Identity is then exact by construction, whatever the kernel's rounding | — |
| A17 | A refined view is the plan at level 0 over regions, reduced by the sources' own 2 × 2 box to the view's level, then sampled with Mitchell as a source is; shown only while it's still what the screen should show (2026-10-05, F2) | Commuting plans then give the same result at the view's level (measured within 4 × 10⁻³); the newest edit always wins | Large glows (F4) need their pyramid's alignment |
| A18 | The screen keeps the composite below each adjustment (by its prefix key) and resumes from it (2026-10-05, F2) | A slider drag re-runs only the adjustment and what's above (counted) | Memory: four screen-sized buffers |
| A19 | Document version 3: a pixel layer is a surface (null: empty), a size and a `LayerTransform` (a new one covers the canvas at 100%); any layer's mask is `{ surface }` in the layer's own pixels (an adjustment's: the document's), null revealing everything (2026-10-06, F3) | An empty layer or mask needs no upload; a pixel layer moves like an image; a mask follows its layer | Content past the canvas: a surface that grows |
| A20 | The selection is an analytic rectangle in history (`PhotoState`), not a coverage surface (2026-10-06, F3, replaces "a selection is a surface") | Exact fractional coverage at no cost; F3 has only rectangles; selecting is an undo step, never saved | Lasso, feather, selection modes: a surface then, by `PhotoSelection`'s kind |
| A21 | A selection caps a stroke's result (what was there mixed towards the unlimited stroke by its coverage), not each dab (2026-10-06, F3) | Photoshop's behaviour: a half-covered pixel gets half the stroke; per-dab limiting builds it back to full (measured) | — |
| A22 | Masks are `r16f` in the package and RGBA on the GPU (the value in every channel), in their layer's atlas: a 16-bit image's mask is f32 (2026-10-06, F3) | One atlas per layer pass (WebGPU's four bind groups); the stamp kernel paints masks as colour (v, v, v, 1) | Masks' GPU memory under a tight budget (×4) |
| A23 | The publication gate and collection are the platform's `SuiteBackend.checkSave` (409) and `opened` (when no tab has the project); collection keeps blobs newer than its start (2026-10-06, F3) | A suite says what its documents need; an upload racing a reopen is never collected | A checkpoint (F5) is a second root |
| A24 | Document version 4: a layer's `blend`, `fill` and `blending` (channels, Blend If), absent at their defaults; the document's `compositing`, `photoshop` (encoded values, Photoshop's mixing: new photos) or `linear` (older ones) (2026-10-06, Layer Style L1) | Photoshop's look is its encoded mixing, measured in 27.11 (50% white over black is 128; a 35% shadow 83 over 128); older photos keep how they looked | Light effects (F4) add light in linear whatever the setting |
| A25 | A `photoshop` plan composites encoded values (premultiplied, f32) and decodes once at the end; a blended layer is drawn alone and blended by a pass reading the composite below (2026-10-06, L1) | Normal stays the GPU's source-over, exactly Photoshop's mix; everything after the evaluator still sees linear light; f32 keeps unedited 8-bit exports exact | Memory: view-sized f32 buffers |
| A26 | A layer's style is `{ enabled, effects }` of `EffectInstance`s in drawing order; the document's `globalLight` (2026-10-06, L2). F4's planned `effects` (Smart Filters: the glow) becomes `filters` | Photoshop's model: effects (fx) from the layer's coverage, distinct from filters on its pixels | — |
| A27 | Effects' fields are made in the layer's own pixels (a pyramid level past 3072 px), kept by content and sizes, and sampled through the layer's transform (2026-10-06, L2) | Exact at every zoom with no view-sized apron; moving, zooming and recolouring never remake them | Memory: fields of very large layers |

Progress, measurements and gates live in [foundations-prototype.md](foundations-prototype.md).
