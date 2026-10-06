# F4: light, the detailed plan

Status: proposed 2026-10-06, before any F4 code. The milestone's scope and gate are in
[foundations-prototype.md](foundations-prototype.md#f4-light); the effects' intent is in
[effects/system.md](effects/system.md); the pixel rules are in [rendering.md](rendering.md). This document turns them
into decisions, a document change, an evaluation design and an order of work. Each step ends verified
(`pnpm typecheck && pnpm test`, and `pnpm test:e2e photo` for anything the UI or renderer touches) and committed.

## Where F3 leaves us

- The evaluator (`render/compositor.ts`) runs a flat plan into a **view-shaped target**: the screen, a 512-pixel
  export region and a refinement region are all a `View` (origin, zoom, size). Image and pixel layers draw
  source-over in one pass; an adjustment is a pointwise pass from one work buffer into the other. Nothing reads its
  neighbours, so no region ever needs a halo.
- A layer's mask multiplies it **inside the layer pass**, read in the layer's own pixels.
- Refinement (`needsRefinement`) is all-or-nothing: below 100%, if any node doesn't commute, the view is rendered at
  level 0 over 2048-pixel regions, reduced and resampled.
- `output.highlights` is in every document (default `film`), but **nothing reads it**. `encode_pixel` (WGSL) and
  `encodePixel` (`shared/photo/output.ts`) clip every channel to 1, so every photo so far has been rendered as `clip`.
- Effects are only adjustments (`EffectKind = "adjustment"`), and parameters are only `number` and `curves`.
- F0's lab still has the only neighbour-reading kernel (`blurTiled` / `blurMono`, the seam check).

## Decisions to confirm

Each has a recommendation. They're contracts, so they go in the ledger (A24 onwards) once Théo agrees.

**D1. What alpha light gets.** The gate says a glowing object exported over transparency must composite correctly
over black, white and saturated backdrops, and `rendering.md` says colour is 0 wherever alpha is 0. So light that
lands where its layer has no coverage gets the coverage `a = min(1, max(r, g, b))`: After Effects' *Unmult*, which is
also what the video editor's `addLight` does ("on its own where it's clear, as it would look over black").
*Recommended.* What "correctly" then means, and what the gate measures: our render of the layer over a backdrop B
equals the exported PNG composited source-over on B, within quantisation, for black, white and saturated B; over black
it equals the light itself. Over bright backdrops, light composited this way behaves like Screen, not Add: that's what
a straight-alpha PNG can carry. *Rejected:* emissive light with alpha 0 (true Add inside the app, but it can't be
exported: unpremultiplying divides by 0).

**D2. No layer blend modes in F4.** With D1, a flare layer in Normal composites like the video editor's Lens Flare
(Screen-like), which is the look we want. Blend modes each need their own domain and extended-range rule (rendering.md,
"Operation domains"), so they wait until a feature needs them. *Recommended.* The glow's own "Add" (object plus its
light) is inside the effect, not a layer blend mode.

**D3. Documents made before F4 keep their look.** The highlight transform has always run as `clip`. Migrating to
version 4 sets `output.highlights: "clip"` on older documents and keeps `film` the default for new ones. Nothing
already made changes, and the Canvas properties can switch it. *Recommended.* *Alternative:* `film` everywhere. That
changes old photos only where light already goes above white (Exposure pushed up), which so far are only test photos.

**D4. The `film` curve.** Its requirements are already fixed: identity on [0, 1], continuous, monotonic, preserving
hue, rolling light above 1 towards white, and applied once, at output. Proposed: for unpremultiplied colour c with
largest channel m > 1, `c' = (c / m)·(1 − w) + w`, where `w = 1 − m^(−s)`. The largest channel stays at 1, the others
rise towards it, and the hue (the mix's direction away from white) is kept. `s` sets how fast highlights whiten: one
stop over white is halfway to white at s = 1. The photo sheet renders s = ½, 1 and 2 on Théo's images and the
fixtures, and Théo picks one (product.md question 2). Then it's a versioned constant.

**D5. The glow's definition doesn't depend on where it's shown.** Glow version 1 is a mathematical definition in
document pixels: its finest scale is tied to its radius, its levels are aligned to the document's 2^k grid, and it
upsamples with a cubic B-spline (no negative lobes, so no ringing and no negative light). The view, a region, an
export and the CPU reference all compute the same thing. How the renderer caches and splits that work (below) isn't
part of the definition and can change without a version bump.

**D6. Where the user finds them** (Photoshop-shaped, ux.md "Effects"): glow through an **fx** button and menu in
Layers (Photoshop's Add a layer style), with the layer's effects listed under it, each with an eye. The flare is
**New ▸ Lens Flare** in the same menu as the adjustments (the half-filled circle), under a "Light" heading. Properties
follows the selected layer, mask or effect.

## The document: version 4

```ts
export const PHOTO_VERSION = 4;

// Layers with content can carry layer effects (Photoshop's layer styles; glow first), applied in order to the
// layer's content before its mask (rendering.md: "Effects see the layer before its mask").
interface ImageLayer  { …; effects?: EffectInstance[] }   // absent: none (only fields that exist are written)
interface PixelLayer  { …; effects?: EffectInstance[] }

/**
 * A generator layer: content made by its effect (a lens flare), in document pixels. It has no transform; its
 * handles are document points in its parameters. Its mask is in document pixels, as an adjustment's is.
 */
interface GeneratorLayer extends LayerBase {
  kind: "generator";
  effect: EffectInstance;                // kind "generator"
  effects?: EffectInstance[];            // a glow on a flare is allowed: the evaluator treats them alike
}

type PhotoLayer = ImageLayer | PixelLayer | AdjustmentLayer | GeneratorLayer;
```

- `EffectKind` becomes `"adjustment" | "layer" | "generator"`. The normaliser refuses an instance of the wrong kind
  for where it is (a glow as an adjustment layer's effect, say), reporting it and keeping it as unavailable, never
  dropping it.
- New parameter kinds in `effects/params.ts`, each with sanitising, a default, a panel row and an assistant
  description:
  - `point`: [x, y] in document pixels, `handle: true` to draw it on the canvas, and `nullable` for "the canvas
    centre" (the flare's optical centre).
  - `colour`: `"#rrggbb"` sRGB, converted to linear light once by the definition's packing.
  - `choice`: a string from a list.
  - `boolean`.
  - `elements`: an ordered list of `{ id, type, enabled, …params }`, each type with its own specs (the flare's
    elements). Ids are stable: editing an element never renumbers the others.
- `EffectParamValue` widens to match. Cache keys are `JSON.stringify(params)` as today, so they need nothing new.
- Migrations: v1–3 are valid v4 documents, plus D3. Tests for each kind, unknown types and versions kept, bad
  values repaired and reported, ids unique across layers, effects and elements.
- Pure edits in `shared/photo/edits.ts` (each returns the same instance on a no-op): `addLayerEffect`,
  `removeLayerEffect`, `moveLayerEffect`, `setLayerEffect` (enabled, params), `addGeneratorLayer` and `setHandle`.
  `duplicateLayer`, copy/paste and `moveLayersBy` carry effects (new ids). Moving a generator moves its handles
  (`moveLayersBy`), so Move and the arrow keys work on a flare as on an image.

## Glow

### Definition (version 1)

For its layer's content L, premultiplied linear light in document pixels, before its mask:

1. **Contribution.** `C = L.rgb · k(Y(L.rgb / L.a))`, where Y is linear-light luminance (sRGB weights) of the
   unassociated colour and k is a soft knee from 0 at `threshold · (1 − knee)` to 1 at `threshold` (smoothstep in Y).
   Pointwise, at level 0.
2. **Scales.** N = 6 octaves, σⱼ = radius · 2^(−j) / 2 for j = 0…5, so the finest is radius / 64. Weights wⱼ ∝
   0.8^j, normalised to sum to 1 (the video editor's Deep Glow falloff, kept as its default look).
3. **Pyramid.** Octave j is computed at level kⱼ, the coarsest at which σⱼ is at least 1.5 texels:
   `kⱼ = max(0, floor(log2(σⱼ / 1.5)))`. Its input is the box reduction of C to level kⱼ (the pyramid's own 2 × 2 box,
   phase fixed at document pixel 0). It's blurred there by a separable Gaussian of σⱼ / 2^kⱼ texels, reaching 3σ, with
   transparent outside, then upsampled to wherever it's read by a cubic B-spline on the level-kⱼ grid.
4. **Light.** `G = 2^intensity · mix(Σ wⱼ·Bⱼ, tint · Y(Σ wⱼ·Bⱼ), tintAmount)`, with the tint normalised to its largest
   channel, as the video editor's is.
5. **Out.** `L + mix · G`, with alpha `L.a + a_G · (1 − L.a)`, where a_G follows D1. Nothing is clamped: light above
   white stays for the output transform.

Parameters (system.md's list; units in the specs): Radius 1–4000 px (default 60), Intensity in stops −6…+6 (0),
Threshold 0–400% of white in linear luminance (75%), Knee 0–100% (25%), Tint colour and Tint amount 0–100% (0), and
Mix 0–100% (100%). Its region rule: the reach is 3σ₀ plus the B-spline's two texels at level k₀, so `inputRegion`
grows by that and its bounds expand by it. It doesn't commute with reduction (the threshold), but see "Levels" below.

**CPU reference** (`shared/photo/reference/glow.ts`): the definition computed monolithically on a small float image.
Tests:
- energy: the sum of G equals the sum of C × gain, within the B-spline's edge loss;
- symmetry under mirroring;
- a point light gives a radially monotonic falloff;
- threshold and knee behave at their ends;
- no NaN from extreme inputs (rendering.md, "Storage formats").

### Evaluation

The evaluator today draws layers straight into the view target. A layer with effects instead becomes an **isolated
layer** (groundwork for groups, which the render plan's comment already expects):

1. **Content.** The layer is drawn alone, without its mask, into a scratch target. The scratch is the view grown by the
   effect's reach (in view pixels), with its origin snapped to the 2^K document grid of the coarsest level used, so its
   reductions line up with every other region's.
2. **Effects.** Each runs in order on that scratch (glow: contribution → reduce → blur → upsample-and-add).
3. **Composite.** A new pass draws the central part over the main buffer source-over, multiplied by the layer's
   opacity and by its mask, sampled through the layer's inverse matrix (the layer pass's `mask_at`, moved into a
   shared function). For a generator, the mask is in document pixels, as an adjustment's is.

Done this way for a 512-pixel export region, a 1000-pixel radius would draw a ~6500-pixel scratch each time: hundreds
of times the work. So the work is split by scale:

- **The coarse octaves** (levels kⱼ ≥ G, with G = 2) come from a **glow cache** per glow node. It holds C reduced
  to each level from G up, over the layer's extent clipped to the canvas plus the reach, as whole textures (level 2 of
  a 48 MP canvas is 3 MP), and their blurred versions Bⱼ. It's built once, from level-0 renders of the layer in
  2048-pixel regions, reduced (the refinement's machinery), and keyed by the layer's content key plus threshold and
  knee for C, and plus radius for B. Changing intensity, tint or mix rebuilds nothing; changing radius re-blurs the
  small textures; changing threshold or knee, or the layer itself, rebuilds C. Caches count against the GPU budget,
  go first when it's tight (they're rebuildable), and go with a lost device.
- **The fine octaves** (kⱼ < G) are computed per evaluation, in the scratch, with a halo of only their own reach
  (about 2^G · 3 · 1.5 texels: tens of document pixels). Exports, refinements, merges and thumbnails all get the same
  numbers this way, region by region, with no seams by construction (the cache is global; the halos cover the fine
  octaves).

### Levels, refinement and drags

`needsRefinement` becomes per node and level: a node says from which level it **commutes**. With the cache, a glow
evaluated at view level v ≥ G reads C at level v from the cache, which is level 0 reduced, so it matches the
full-resolution render reduced within tolerance (linear blurs commute with the box). So at **fit on a 48 MP photo
(level ≥ 2) a glow needs no refinement**. Between 25% and 100% it does, as Curves does today, and refinement's
regions now carry the fine octaves' halo. At 100% and above it's evaluated directly. Above 100%, as with Curves, the
threshold applies to the resampled light; this is written down, not hidden.

While a gesture is under way (a slider drag, moving the layer), the cache isn't rebuilt each frame. C comes from the
layer drawn at the view's own level instead: the "first response" path, shown with the existing "Refining…" state. It
settles to the cached result 150 ms after the document is still, through the same `LatestOnly` rule, so a stale
result is never shown as current.

## Lens Flare (the first generator)

`effects/flare.ts`, kind `generator`, version 1:

- **Parameters.**
  - Source: a point and a handle, by default at the upper third.
  - Optical centre: a point, or null for the canvas centre, also a handle.
  - Intensity (stops) and colour.
  - Seed, for any randomness; nothing depends on time.
  - Elements: an ordered list.
- **Element types** (system.md). Each has a position along the source-to-centre axis (1 at the source, 0 at the
  centre, negative past it), an offset, a size in document pixels, a tint and an intensity, plus its own:
  - **Source glow**: core size and falloff.
  - **Halo / ring**: radius, thickness and chromatic spread.
  - **Ghost**: disc or polygon (sides, rotation), softness, and a chromatic rim (the video editor's ±4%).
  - **Anamorphic streak**: length, thickness and angle.
- **Pointwise and closed form.** Each element is a function of the document point. One generator pass evaluates
  every enabled element at each pixel of the target and writes premultiplied light with D1's alpha. Tiles agree
  trivially, and the handle is a document point at every zoom.
- **Reduced views.** Every element's edges are pre-filtered by the target pixel's footprint (a profile widened by
  the pixel's size in document pixels), so a reduced view matches level 0 reduced within a declared tolerance, which
  is measured. The flare commutes, and it never needs refinement.
- **Presets.** "Classic" is the video editor's arrangement (ghosts at 0.55, 0.25, −0.2, −0.45, −0.7, −1.1 and −1.35,
  a halo, a source glow), plus "Anamorphic" and "Subtle". A preset stores sizes as fractions of the canvas's diagonal;
  applying it makes pixels for this canvas. Applying a preset is one undo step. Previewing presets without touching
  history is ux.md's intent, but **later**, not F4.
- **CPU reference** (`shared/photo/reference/flare.ts`): each element at a point, tested for symmetry about the axis,
  the chromatic order of the rim, and the source glow's falloff. The GPU is checked against it at sample points.

## Output transform

- `shared/photo/output.ts`: `highlights(c, mode)` is the CPU reference of D4. `encodePixel` and `quantize8` take the
  mode, and the 8-bit round-trip test runs under `film` too (identity on [0, 1], so it must still be bit for bit).
- WGSL: `encode_pixel(c, film)` in `wgsl.ts`. The present pass and both quantise pipelines take the flag from the
  document, so the view and the export run the same code.
- Canvas properties (nothing selected) gets **Highlights: Film / Clip**, one undo step. The assistant's `set_canvas`
  takes it too.

## UI

- **Layers.**
  - An **fx** button at the foot and the row menu's "Add effect ▸ Glow" add a glow.
  - A layer's effects show as rows under it (Photoshop's), each with an eye (bypass, keeping its settings), selectable,
    reorderable by dragging within the layer (one undo step) and deletable.
  - The layer row shows an fx indicator, and can fold its effects away.
  - An effect that can't be used is shown with its reason and kept, as an unavailable adjustment is.
- **Selection.** `ui.ts` gets `selectedEffectId` (session state). Properties shows a selected effect's parameters from
  its specs: sliders, colour (the app's colour picker), choice, point (x and y fields) and the elements list.
- **The flare's Properties.** Its parameters, then its elements as a list: an eye, the type's icon, a name, drag to
  reorder, Add element ▸ (the four types), Delete. A selected element's own parameters follow, and a preset menu
  (Reset to preset).
- **Canvas handles.** A selected generator draws its handles: the source as a crosshair, the centre as a small
  circle, and the axis between them as a thin line. Dragging a handle is one undo step, Escape cancels it, and
  smart-guide snapping applies (to the canvas centre and other layers' edges). The Move tool on a generator moves its
  handles together.
- **Painting a generator** asks first, as an image does: New paint layer, or paint its mask. Convert to Pixels renders
  it canvas-sized into a pixel layer, keeping its effects live. Merge and Layer via Copy render it (with every effect)
  through the evaluator, as they render images. Merge's bounds grow by the effects' reach.
- Layer thumbnails and Home's cover need nothing new (the same evaluator).

## Assistant

`shared/photo/tools.ts` and their handlers and pure edits (`src/suites/photo/tool-edits.ts`, tested):

- `add_effect { layer, type, params? }`: a layer effect (glow) on an image, pixel or generator layer.
- `set_effect { layer, effect?, enabled?, params?, index? }`: params, bypass and order for any effect on a layer,
  whether a layer effect (by id or its index) or the layer's own effect. It absorbs `set_effect_params`, which stays
  as an alias for one release of the prompt. `remove_effect { layer, effect }`.
- `add_generator { type: "lens-flare", preset?, source?, params?, above? }`.
- `move_handle { layer, handle: "source" | "centre", x, y }`.
- `describePhoto` lists effects (summary, bypassed), generators (handles, element count) and the highlights mode;
  `describeAdjustments` becomes `describeEffects` (all three kinds, with their parameters' units and ranges).
- The labels for steps (describeToolCall) and tool icons, with tests for each edit.

## Tools and checks

- `scripts/photo-sheet.ts [type|preset ...] [--out f.png]`, like the effect sheet. It reuses `photo-bench.ts`'s
  launcher (its own ports, a throwaway data dir, headless Chrome with WebGPU) and a `photoSheet` entry on
  `window.photoBench`. It renders every effect and preset over the fixtures (a night street, a portrait, a cut-out
  object over transparency, a 16-bit gradient) and checks:
  - every pipeline compiles;
  - each effect changes the picture;
  - tiled matches monolithic, with the seams measured;
  - energy is within the reference's tolerance;
  - nothing is NaN or negative.
  It writes a contact sheet. It also renders the film candidates (D4) side by side.
- The lab's blur check is retired once the suite's own seam test covers it (foundations-prototype.md, F3 results),
  with `blurTiled` and `blurMono`.
- Bench scenarios `glow` and `flare` (`src/suites/photo/bench.ts`, `scripts/photo-bench.ts`), on the 48 MP fixture
  at fit:
  - a radius-1000 glow: first response (the parameter change, to the GPU finishing the frame) and settled (the cache
    built and presented);
  - a flare's handle drag: frame p95.

## The gate, and how each part is checked

| Gate | Check |
| --- | --- |
| Radii wider than a tile have no seams | e2e: a radius-600 glow on a small photo, exported in 512 regions vs evaluated as one region (`photoDebug`); max difference ≤ the declared tolerance, and none larger along region edges than inside |
| Tiled matches monolithic | The same render vs the CPU reference (`reference/glow.ts`) on a 256² fixture, per channel, within f16 tolerance; the flare's elements at sample points |
| Above-white light survives to the output transform | e2e: the composite read back as floats (`readScreen`) has values > 1 where the glow is; exported with `clip` vs `film` they differ only where the composite is > 1 |
| An isolated glowing object over transparency exports correctly | e2e: a cut-out object with a glow on a transparent canvas exported as PNG; that PNG composited (CPU, straight alpha) over black, white and saturated red equals the app's own render over each as a background, within 1 step; colour is 0 wherever alpha is 0 |
| A source handle at several zooms lands on the same document point | e2e: the handle dragged to the same document point at 33%, 100% and 250% (and in a 2× page), giving the same `source` value and the same tiles |
| Reordering, bypassing, masking, undoing and reopening keep every setting | e2e: two glows and a flare, each edited; their order changed, one bypassed, the layer masked, undone and redone; reloaded; the document's JSON and the screen's composite are identical before and after |

Performance (foundations-prototype.md): **Glow/flare, large radius: first response ≤ 100 ms; settled ≤ 1 s at fit
on 48 MP**, measured by the bench in Chrome and Electron, with p50/p95 and the worst stall.

## Order of work

Each step ends with its tests passing and a commit. Steps 2 and 3 are independent.

0. **Research.** A short `research/light-effects.md`, written before building any panel (ux.md): Photoshop's layer
   styles in the Layers panel (fx, effects listed under the layer, eyes), its Outer Glow and its Lens Flare filter,
   and Optical Flares' element editor. It ends with where we differ (ours is a light glow, not a shape glow, and the
   flare is a live layer, not a filter). Then Théo answers D1–D6.
1. **Spike: the glow's cost** (a day at most, thrown away if it's wrong). Build the cache from a 48 MP layer at
   fit in the workspace, and time the level-0 renders, the reduction and the blurs. If settling misses 1 s, the
   fallback is to build C from the layer's own pyramid when its transform is a plain scale (no level-0 render), or to
   raise G. That's decided here, with the numbers recorded in the evidence log.
2. **Output transform.** D4's curve: CPU reference, WGSL, the round-trip tests under `film`, Canvas › Highlights,
   `set_canvas`, D3's migration.
3. **Document v4.** Param kinds, layer effects, the generator layer, normalisation and migration, edits, tests.
4. **Glow: reference.** `reference/glow.ts` and its tests.
5. **Render plan.** Effects on drawing nodes and the generator node, keys (the effects' and content's), grown
   regions, per-level commuting, and `needsRefinement` by level; tests in `render-plan.test.ts`.
6. **Evaluator: isolated layers.** Scratch, composite-with-mask pass, generator pass (the flare first, as the
   simplest effect to see), refinement and region halos, export, merge and pictures through it.
7. **Evaluator: glow.** Contribution, reduce, blur, B-spline upsample-and-add; the cache and its budget; the drag
   path; GPU vs reference checks through `photoDebug`.
8. **Flare.** Its definition, elements, presets, reference and WGSL.
9. **UI.** Layers (fx, effect rows), Properties (new param rows, the element list), canvas handles, adding a flare,
   the painting prompt.
10. **Assistant.** The tools, descriptions and tests.
11. **photo-sheet.ts**, the bench scenarios, and Théo's film comparison.
12. **The gate** in `e2e/photo.spec.ts`, the measurements, and **F4 results** in foundations-prototype.md. Docs
    (architecture's document section, rendering's evaluator section, system.md "as built", README, CLAUDE.md) say
    what was built; the ledger gets D1–D5.

## Risks

- **The glow's cache is the milestone's one new kind of state.** It's the first thing kept that isn't keyed by a
  view. A stale cache would be a stale-view bug, so its key covers everything C and B depend on (the layer's content
  key already covers its media, surface, transform and opacity), and e2e's "rapid edits never show a stale refinement"
  gets a glow version.
- **f16 sums.** Blur accumulation is f32 in registers. The reductions store f16 (`round_for_store`) as the pyramid
  does. Energy is checked in the f16 and f32 composites.
- **WebGPU's four bind groups.** The glow passes read plain textures, not the atlas. Only the content draw uses the
  layer pass's groups, so no pass needs more than four.
- **Scope creep.** Starbursts, sprites, dirt, blend modes, preset previews, halation and rays are out of F4
  (system.md, foundations "After the foundations").
