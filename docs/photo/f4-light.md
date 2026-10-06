# F4: light, the detailed plan

Status: proposed 2026-10-06, before any F4 code; revised the same day for the compositing decision of the Layer Style
research (`docs/photo/layer-style/`, on `t3code/layer-blending-options`: its README's decision 1 and
`photoshop-measurements.md`). The milestone's scope and gate are in
[foundations-prototype.md](foundations-prototype.md#f4-light); the effects' intent is in
[effects/system.md](effects/system.md); the pixel rules are in [rendering.md](rendering.md). This document turns them
into decisions, a document change, an evaluation design and an order of work. Each step ends verified
(`pnpm typecheck && pnpm test`, and `pnpm test:e2e photo` for anything the UI or renderer touches) and committed.

**F4 builds on Layer Style's phase L1.** L1 brings the blend pass (it reads the backdrop: every mode but Normal, and
Normal with partial alpha in "photoshop" documents), blend modes and the document's `compositing`. F4's layers join
the stack through that pass, never through fixed-function blending.

## Where F3 leaves us

- The evaluator (`render/compositor.ts`) runs a flat plan into a **view-shaped target**: the screen, a 512-pixel
  export region and a refinement region are all a `View` (origin, zoom, size). Image and pixel layers draw
  source-over with fixed-function blending in one pass; an adjustment is a pointwise pass from one work buffer into
  the other. Nothing reads its neighbours, so no region ever needs a halo.
- A layer's mask multiplies it **inside the layer pass**, read in the layer's own pixels.
- Refinement (`needsRefinement`) is all-or-nothing: below 100%, if any node doesn't commute, the view is rendered at
  level 0 over 2048-pixel regions, reduced and resampled.
- `output.highlights` is in every document (default `film`), but **nothing reads it**. `encode_pixel` (WGSL) and
  `encodePixel` (`shared/photo/output.ts`) clip every channel to 1, so every photo so far has been rendered as `clip`.
- Effects are only adjustments (`EffectKind = "adjustment"`), and parameters are only `number` and `curves`.
- F0's lab still has the only neighbour-reading kernel (`blurTiled` / `blurMono`, the seam check).

## Given: compositing (Layer Style's decision 1)

Théo's decision, recorded here because F4 depends on it:

- **The document gets `compositing: "photoshop" | "linear"`.** New photos are "photoshop". Documents made before
  version 4 stay "linear", so they don't change look.
- **What "photoshop" means.** Layer blend modes, Opacity, Fill, partial coverage (soft edges, masks) and layer-style
  effects mix on unpremultiplied, sRGB-encoded values. Measured in Photoshop 27.11: 50% white over black gives 128,
  and a 35% black Multiply shadow over grey 128 gives 83. Storage doesn't change (premultiplied linear f16/f32); only
  the blend step encodes and decodes.
- **Encoding doesn't clamp.** The sRGB curve is extended past 1 and mirrored below 0, so light above white survives
  Normal, Linear Dodge (Add), Lighten and Screen. Only the modes that need [0, 1] clamp, each stating its rule.
- **Linear whatever the setting:**
  - resampling, the pyramid and reduction;
  - blurs and Exposure;
  - everything inside the glow (threshold, pyramid blur, energy);
  - the flare's elements.
- **The glow is a filter, not a style.** It's Photoshop's Smart Filter on its layer's content, not a layer style, so
  the planned `effects` field is `filters`. It adds its light to the layer's own pixels in linear light, before the
  layer's mask, so that addition doesn't depend on the document's setting. The layer then joins the stack through its
  blend mode, in the document's compositing.
- **Generator layers get `blendSpace?: "linear"`** (absent: the document's). A new flare is Linear Dodge (Add) with
  `blendSpace: "linear"`, so its light adds physically. Photoshop's Lens Flare is a filter that paints pixels in
  encoded space, so this is a deliberate difference, written down as one ("Where we differ" below).

## Decisions to confirm

Each had a recommendation; **Théo agreed to all five on 2026-10-06** (the film curve's `s` is 1 until he compares
the candidates). They're contracts, so they go in the ledger (A24 onwards).

**D1. What alpha light gets where its layer had none.** A filter's light can land where its layer was transparent (a
glow spilling past a cut-out's edge). There, the light `G` gets the coverage `a = min(1, max(r, g, b))` in linear
light: After Effects' *Unmult*, which the video editor's `addLight` also does. This happens inside the filter, in
linear, so it's the same in both compositing modes. *Recommended.* *Rejected:* emissive light with alpha 0. It would
be a true Add inside the app, but it can't be exported: unpremultiplying divides by 0, and `rendering.md` says colour
is 0 wherever alpha is 0.

What "exports correctly" then means, the gate's meaning in both modes: our render of the layer over a backdrop B
equals the exported PNG composited over B **in the document's compositing space**, within one level. That's encoded
mixing for "photoshop", which is what Photoshop does with that PNG, and linear for "linear". Colour is 0 wherever
alpha is 0. In "linear" the light over black is exactly the light. In "photoshop" no alpha below 1 can do that (an
encoded mix of partial light over black reads darker than the light), so a glow's soft spill past a cut-out's edge
looks tighter there. That's Photoshop's own behaviour for soft edges. It doesn't affect opaque layers (a photo): there
the glow's light simply adds to pixels whose alpha is already 1. The photo sheet shows the two modes side by side.

**D2. Documents made before F4 keep their look.** The highlight transform has always run as `clip`, so migrating
sets `output.highlights: "clip"` on older documents and keeps `film` the default for new ones. This is the same
principle as `compositing` for documents before version 4. The Canvas properties can switch it. *Recommended.*
*Alternative:* `film` everywhere. That changes old photos only where light already goes above white (Exposure pushed
up), which so far are only test photos.

**D3. The `film` curve.** Its requirements are already fixed: identity on [0, 1], continuous, monotonic, preserving
hue, rolling light above 1 towards white, and applied once, at output, on the linear composite. Proposed: for
unpremultiplied colour c with largest channel m > 1, `c' = (c / m)·(1 − w) + w`, where `w = 1 − m^(−s)`. The largest
channel stays at 1, the others rise towards it, and the hue (the mix's direction away from white) is kept. `s` sets
how fast highlights whiten: one stop over white is halfway to white at s = 1. The photo sheet renders s = ½, 1 and 2
on Théo's images and the fixtures, and Théo picks one (product.md question 2). Then it's a versioned constant.

**D4. The glow's definition doesn't depend on where it's shown.** Glow version 1 is a mathematical definition in
document pixels: its finest scale is tied to its radius, its levels are aligned to the document's 2^k grid, and it
upsamples with a cubic B-spline (no negative lobes, so no ringing and no negative light). The view, a region, an
export and the CPU reference all compute the same thing. How the renderer caches and splits that work (below) isn't
part of the definition and can change without a version bump.

**D5. Where the user finds them.** Photoshop adds Smart Filters from its Filter menu and lists them under the layer;
layer styles are the fx button's (Layer Style's L2).
- **Glow**: the layer row's menu gains **Filter ▸ Glow**, and the half-filled circle's menu gains a "Light" heading
  with Glow (a filter on the selected layer).
- **Lens Flare** sits under the same Light heading, as a new layer.
- A layer's filters show as rows under it, as Photoshop's Smart Filters do (below), apart from its style's fx rows.
- Properties follows the selected layer, mask or filter. *Recommended.*

## The document

L1 makes version 4 (`blend`, `fill`, `blending`, `compositing`). F4's fields come as **version 5**: an older app
would drop `filters` and generator layers on save, so the bump guards against that. If F4 happens to merge before
L1 ships a version, the two share version 4.

```ts
// Layers with content can carry filters (Photoshop's Smart Filters; glow first), applied in order to the
// layer's content in linear light, before its mask and before its style (Layer Style's `style` reads the result).
interface ImageLayer  { …; filters?: EffectInstance[] }  // absent: none (only fields that exist are written)
interface PixelLayer  { …; filters?: EffectInstance[] }

/**
 * A generator layer: content made by its effect (a lens flare), in document pixels. It has no transform; its
 * handles are document points in its parameters. Its mask is in document pixels, as an adjustment's is.
 */
interface GeneratorLayer extends LayerBase {
  kind: "generator";
  effect: EffectInstance;                // kind "generator"
  filters?: EffectInstance[];            // a glow on a flare is allowed: the evaluator treats them alike
  /** Absent: the document's compositing. A new flare is "linear" with blend "linear-dodge". */
  blendSpace?: "linear";
}

type PhotoLayer = ImageLayer | PixelLayer | AdjustmentLayer | GeneratorLayer;
```

- `EffectKind` becomes `"adjustment" | "filter" | "generator"` (and L2's style kinds). The normaliser refuses an
  instance of the wrong kind for where it is (a glow as an adjustment layer's effect, say). It reports it and keeps it
  as unavailable, never dropping it.
- New parameter kinds in `effects/params.ts`, each with sanitising, a default, a panel row and an assistant
  description. L1 and L2 add `colour`, `angle`, `contour`, `gradient` and `blend`; whichever lands first builds a
  shared one, never a second copy. F4 needs:
  - `colour`: `"#rrggbb"` sRGB, converted to linear light once by the definition's packing.
  - `point`: [x, y] in document pixels, `handle: true` to draw it on the canvas, and `nullable` for "the canvas
    centre" (the flare's optical centre).
  - `choice`: a string from a list.
  - `boolean`.
  - `elements`: an ordered list of `{ id, type, enabled, …params }`, each type with its own specs (the flare's
    elements). Ids are stable: editing an element never renumbers the others.
- `EffectParamValue` widens to match. Cache keys are `JSON.stringify(params)` as today, so they need nothing new.
- Migrations: older documents are valid version-5 ones, plus D2. Tests cover each kind, unknown types and versions
  kept, bad values repaired and reported, and ids unique across layers, filters and elements.
- Pure edits in `shared/photo/edits.ts` (each returns the same instance on a no-op): `addFilter`, `removeFilter`,
  `moveFilter`, `setFilter` (enabled, params), `addGeneratorLayer` and `setHandle`. `duplicateLayer`, copy/paste and
  `moveLayersBy` carry filters (new ids). Moving a generator moves its handles (`moveLayersBy`), so Move and the arrow
  keys work on a flare as on an image.

## Glow

### Definition (version 1)

For its layer's content L, premultiplied linear light in document pixels, before its mask:

1. **Contribution.** `C = L.rgb · k(Y(L.rgb / L.a))`. Y is linear-light luminance (sRGB weights) of the unassociated
   colour. k is a soft knee from 0 at `threshold · (1 − knee)` to 1 at `threshold` (smoothstep in Y). Pointwise, at
   level 0.
2. **Scales.** N = 6 octaves, σⱼ = radius · 2^(−j) / 2 for j = 0…5, so the finest is radius / 64. Weights wⱼ ∝
   0.8^j, normalised to sum to 1 (the video editor's Deep Glow falloff, kept as its default look).
3. **Pyramid.** Octave j is computed at level kⱼ, the coarsest at which σⱼ is at least 1.5 texels:
   `kⱼ = max(0, floor(log2(σⱼ / 1.5)))`.
   - Its input is the box reduction of C to level kⱼ (the pyramid's own 2 × 2 box, phase fixed at document pixel 0).
   - It's blurred there by a separable Gaussian of σⱼ / 2^kⱼ texels, reaching 3σ, with transparent outside.
   - Then it's upsampled to wherever it's read, by a cubic B-spline on the level-kⱼ grid.
4. **Light.** `G = 2^intensity · mix(Σ wⱼ·Bⱼ, tint · Y(Σ wⱼ·Bⱼ), tintAmount)`, with the tint normalised to its largest
   channel, as the video editor's is.
5. **Out.** `L + mix · G` in linear light, with alpha `L.a + a_G · (1 − L.a)`, where a_G follows D1. Nothing is
   clamped: light above white stays for the output transform. The layer then blends into the stack by its mode in the
   document's compositing (encoded, unclamped, for "photoshop").

**Parameters** (system.md's list; units in the specs):

| Parameter | Range | Default |
| --- | --- | --- |
| Radius | 1–4000 px | 60 |
| Intensity (stops) | −6…+6 | 0 |
| Threshold (% of white, linear luminance) | 0–400% | 75% |
| Knee | 0–100% | 25% |
| Tint | a colour | — |
| Tint amount | 0–100% | 0 |
| Mix | 0–100% | 100% |

**Region rule.** The reach is 3σ₀ plus the B-spline's two texels at level k₀, so `inputRegion` grows by that and the
layer's bounds expand by it. The glow doesn't commute with reduction (the threshold), but see "Levels" below.

**CPU reference** (`shared/photo/reference/glow.ts`): the definition computed monolithically on a small float image.
Tests:
- energy: the sum of G equals the sum of C × gain, within the B-spline's edge loss;
- symmetry under mirroring;
- a point light gives a radially monotonic falloff;
- threshold and knee behave at their ends;
- no NaN from extreme inputs (rendering.md, "Storage formats").

### Evaluation

The evaluator today draws layers straight into the view target. A layer with filters instead becomes an **isolated
layer**. It's the same apron machinery Layer Style's L2 needs for its matte, so whichever comes first builds it to
both specs (a reach per definition, refinement regions grown by the plan's reach).

1. **Content.** The layer is drawn alone, without its mask, into a scratch target. The scratch is the view grown by the
   filters' reach (in view pixels), with its origin snapped to the 2^K document grid of the coarsest level used, so its
   reductions line up with every other region's.
2. **Filters.** Each runs in order on that scratch, in linear light (glow: contribution → reduce → blur →
   upsample-and-add).
3. **Composite.** L1's blend pass draws the central part over the backdrop: the layer's mode, Opacity and Fill, in
   the document's compositing space (or `blendSpace`), multiplied by the layer's mask sampled through its inverse
   matrix. For a generator, the mask is in document pixels, as an adjustment's is.

Done this way for a 512-pixel export region, a 1000-pixel radius would draw a ~6500-pixel scratch each time: hundreds
of times the work. So the work is split by scale:

- **The coarse octaves** (levels kⱼ ≥ G, with G = 2) come from a **glow cache** per glow.
  - It holds C reduced to each level from G up, over the layer's extent clipped to the canvas plus the reach, as whole
    textures (level 2 of a 48 MP canvas is 3 MP), and their blurred versions Bⱼ.
  - It's built once, from level-0 renders of the layer in 2048-pixel regions, reduced (the refinement's machinery).
  - It's keyed by the layer's content key plus threshold and knee for C, and plus radius for B. Changing intensity,
    tint or mix rebuilds nothing; changing radius re-blurs the small textures; changing threshold or knee, or the
    layer itself, rebuilds C.
  - Caches count against the GPU budget, go first when it's tight (they're rebuildable), and go with a lost device.
- **The fine octaves** (kⱼ < G) are computed per evaluation, in the scratch, with a halo of only their own reach
  (about 2^G · 3 · 1.5 texels: tens of document pixels). Exports, refinements, merges and thumbnails all get the same
  numbers this way, region by region. There are no seams by construction: the cache is global, and the halos cover
  the fine octaves.

### Levels, refinement and drags

`needsRefinement` becomes per node and level: a node says from which level it **commutes**. With the cache, a glow
evaluated at view level v ≥ G reads C at level v from the cache. That is level 0 reduced, so it matches the
full-resolution render reduced, within tolerance (linear blurs commute with the box). So **at fit on a 48 MP photo
(level ≥ 2), a glow needs no refinement**. Between 25% and 100% it does, as Curves does today, and refinement's
regions now carry the fine octaves' halo. At 100% and above it's evaluated directly. Above 100%, as with Curves, the
threshold applies to the resampled light; this is written down, not hidden. The layer's own blend still decides
commuting as L1 says: anything but Normal, and Normal in "photoshop" documents, refines.

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
  every enabled element at each pixel of the target and writes premultiplied linear light with D1's alpha. Tiles
  agree trivially, and the handle is a document point at every zoom.
- **Its blend.** A new flare is Linear Dodge (Add) in `blendSpace: "linear"`. There, Add on premultiplied colours is
  exactly `backdrop + light` whatever either's alpha: it matches the linear reference exactly, and light above white
  survives to the output transform. The user can change either setting; then it blends as any layer does.
- **Reduced views.** Every element's edges are pre-filtered by the target pixel's footprint (a profile widened by
  the pixel's size in document pixels), so a reduced view matches level 0 reduced within a declared tolerance, which
  is measured. The flare's content commutes; its blend in linear Add commutes too, so it never needs refinement.
- **Presets.** "Classic" is the video editor's arrangement (ghosts at 0.55, 0.25, −0.2, −0.45, −0.7, −1.1 and −1.35,
  a halo, a source glow), plus "Anamorphic" and "Subtle". A preset stores sizes as fractions of the canvas's diagonal;
  applying it makes pixels for this canvas. Applying a preset is one undo step. Previewing presets without touching
  history is ux.md's intent, but **later**, not F4.
- **CPU reference** (`shared/photo/reference/flare.ts`): each element at a point, tested for symmetry about the axis,
  the chromatic order of the rim, and the source glow's falloff. The GPU is checked against it at sample points.

## Output transform

- `shared/photo/output.ts`: `highlights(c, mode)` is the CPU reference of D3. `encodePixel` and `quantize8` take the
  mode, and the 8-bit round-trip test runs under `film` too (identity on [0, 1], so it must still be bit for bit).
- WGSL: `encode_pixel(c, film)` in `wgsl.ts`. The present pass and both quantise pipelines take the flag from the
  document, so the view and the export run the same code. The output transform's encoding is the clamped one for SDR
  output; it's a different function from L1's unclamped blend encoding, and the two are named apart.
- Canvas properties (nothing selected) gets **Highlights: Film / Clip**, one undo step. The assistant's `set_canvas`
  takes it too.

## UI

- **Layers.**
  - A layer's filters show as rows under it (Photoshop's Smart Filters: a "Filters" row with an eye for all, then
    each filter with its own eye). Each can be bypassed (keeping its settings), selected, reordered by dragging within
    the layer (one undo step) and deleted.
  - The layer row shows a filter indicator, and can fold its filters away.
  - An unusable filter is shown with its reason and kept, as an unavailable adjustment is.
  - A generator's row shows its blend mode as any layer's does (L1's menu, hover previews included).
- **Selection.** `ui.ts` gets `selectedFilterId` (session state). Properties shows a selected filter's parameters from
  its specs: sliders, colour (the app's colour picker), choice, point (x and y fields) and the elements list.
- **The flare's Properties.** Its parameters, then its elements as a list: an eye, the type's icon, a name, drag to
  reorder, Add element ▸ (the four types), Delete. A selected element's own parameters follow, and a preset menu
  (Reset to preset).
- **Canvas handles.** A selected generator draws its handles: the source as a crosshair, the centre as a small
  circle, and the axis between them as a thin line. Dragging a handle is one undo step, Escape cancels it, and
  smart-guide snapping applies (to the canvas centre and other layers' edges). The Move tool on a generator moves its
  handles together.
- **Painting a generator** asks first, as an image does: New paint layer, or paint its mask.
- **Converting and merging.** Convert to Pixels renders a generator canvas-sized into a pixel layer, keeping its
  filters live. Merge and Layer via Copy render it (with every filter) through the evaluator, as they render images;
  Merge's bounds grow by the filters' reach.
- Layer thumbnails and Home's cover need nothing new (the same evaluator).

## Assistant

In `shared/photo/tools.ts`, with their handlers and pure edits (`src/suites/photo/tool-edits.ts`, tested). They're
named for filters, apart from L2's `set_layer_style`, replacing foundations' working name `add_effect`:

- `add_filter { layer, type, params? }`: a filter (glow) on an image, pixel or generator layer.
- `set_filter { layer, filter, enabled?, params?, index? }` and `remove_filter { layer, filter }`: a filter by id or
  its index.
- `set_effect_params` keeps editing an adjustment's or a generator's own effect.
- `add_generator { type: "lens-flare", preset?, source?, params?, above? }`: L1's `set_layer_blending` sets its blend
  and `blendSpace`.
- `move_handle { layer, handle: "source" | "centre", x, y }`.
- `describePhoto` lists filters (summary, bypassed), generators (handles, element count, blend), the highlights mode
  and the compositing; `describeAdjustments` becomes `describeEffects`, covering every kind with its parameters'
  units and ranges.
- The labels for steps (describeToolCall) and tool icons, with a test for each edit.

## Tools and checks

- **`scripts/photo-sheet.ts [type|preset ...] [--out f.png]`**, like the effect sheet. It reuses `photo-bench.ts`'s
  launcher (its own ports, a throwaway data dir, headless Chrome with WebGPU) and a `photoSheet` entry on
  `window.photoBench`. It renders every filter and preset over the fixtures (a night street, a portrait, a cut-out
  object over transparency, a 16-bit gradient), in both compositing modes, and checks:
  - every pipeline compiles;
  - each filter changes the picture;
  - tiled matches monolithic, with the seams measured;
  - energy is within the reference's tolerance;
  - nothing is NaN or negative.
  It writes a contact sheet. It also renders the film candidates (D3) side by side.
- The lab's blur check is retired once the suite's own seam test covers it (foundations-prototype.md, F3 results),
  with `blurTiled` and `blurMono`.
- **Bench scenarios** `glow` and `flare` (`src/suites/photo/bench.ts`, `scripts/photo-bench.ts`), on the 48 MP
  fixture at fit:
  - a radius-1000 glow: first response (the parameter change, to the GPU finishing the frame) and settled (the cache
    built and presented);
  - a flare's handle drag: frame p95.

## The gate, and how each part is checked

| Gate | Check |
| --- | --- |
| Radii wider than a tile have no seams | e2e: a radius-600 glow on a small photo, exported in 512 regions vs evaluated as one region (`photoDebug`); max difference ≤ the declared tolerance, and none larger along region edges than inside |
| Tiled matches monolithic | The same render vs the CPU reference (`reference/glow.ts`) on a 256² fixture, per channel, within f16 tolerance; the flare's elements at sample points |
| Above-white light survives to the output transform | e2e: the composite read back as floats (`readScreen`) has values > 1 where the glow is; exported with `clip` vs `film` they differ only where the composite is > 1 |
| …and through an encoded Normal and Add blend | e2e, in a "photoshop" document: a layer with light above 1, in Normal and in Linear Dodge, keeps values above 1 in the composite (L1's unclamped encoding) |
| An isolated glowing object over transparency exports correctly, in both compositing modes | e2e: a cut-out object with a glow on a transparent canvas exported as PNG. That PNG composited (CPU, straight alpha) over black, white and saturated red, **in the document's compositing space**, equals the app's own render over each as a background, within 1 level. Colour is 0 wherever alpha is 0. In "linear" the result over black equals the glow's light |
| A flare in `blendSpace: "linear"` matches the linear reference exactly | e2e: a flare in linear Add over a photo, read back as floats, equals the photo plus the reference flare (`reference/flare.ts`) within f16 rounding, in a "photoshop" document too |
| A source handle at several zooms lands on the same document point | e2e: the handle dragged to the same document point at 33%, 100% and 250% (and in a 2× page), giving the same `source` value and the same composite |
| Reordering, bypassing, masking, undoing and reopening keep every setting | e2e: two glows and a flare, each edited; their order changed, one bypassed, the layer masked, undone and redone; reloaded; the document's JSON and the screen's composite are identical before and after |

Performance (foundations-prototype.md): **Glow/flare, large radius: first response ≤ 100 ms; settled ≤ 1 s at fit
on 48 MP**, measured by the bench in Chrome and Electron, with p50/p95 and the worst stall.

## Order of work

Each step ends with its tests passing and a commit. Steps 2 and 3 are independent of L1; from step 5 on, L1's blend
pass and document fields must be in.

0. **Research and decisions.** A short `research/light-effects.md`, written before any panel is built (ux.md). It
   covers Photoshop's Smart Filters in the Layers panel (the Filters row, eyes, order), its Lens Flare filter, and
   Optical Flares' element editor. It ends with where we differ. Then Théo answers D1–D5.
1. **Spike: the glow's cost** (a day at most, thrown away if it's wrong). Build the cache from a 48 MP layer at fit in
   the workspace, and time the level-0 renders, the reduction and the blurs. If settling misses 1 s, the fallback is
   to build C from the layer's own pyramid when its transform is a plain scale (no level-0 render), or to raise G.
   That's decided here, with the numbers recorded in the evidence log.
2. **Output transform.** D3's curve: CPU reference, WGSL, the round-trip tests under `film`, Canvas › Highlights,
   `set_canvas`, D2's migration.
3. **Glow: reference.** `reference/glow.ts` and its tests. The flare's per-element reference can come here too.
4. **L1 (Layer Style), if it isn't in yet**: the blend pass, blend modes, `compositing`, version 4.
5. **Document v5.** The new param kinds, filters, the generator layer and `blendSpace`, normalisation and migration,
   the edits, tests.
6. **Render plan.** Filters on drawing nodes, the generator node, keys (the filters' and the content's), grown
   regions, per-level commuting and `needsRefinement` by level; tests in `render-plan.test.ts`.
7. **Evaluator: isolated layers.** The apron (shared with L2), the composite through L1's blend pass, the generator
   pass (the flare first, as the simplest to see), refinement and region halos, export, merge and pictures through
   it.
8. **Evaluator: glow.** Contribution, reduce, blur, B-spline upsample-and-add; the cache and its budget; the drag path;
   GPU vs reference checks through `photoDebug`.
9. **Flare.** Its definition, elements, presets and WGSL.
10. **UI.** Layers (filter rows), Properties (the new param rows, the element list), canvas handles, adding a flare
    and a glow, the painting prompt.
11. **Assistant.** The tools, descriptions and tests.
12. **photo-sheet.ts**, the bench scenarios, and Théo's film comparison.
13. **The gate** in `e2e/photo.spec.ts`, the measurements, and **F4 results** in foundations-prototype.md. Docs
    (architecture's document section, rendering's evaluator and operation domains, system.md's "as built", README,
    CLAUDE.md) say what was built; the ledger gets D1–D4 and the compositing decision's F4 parts.

## Where we differ from Photoshop

- **Lens Flare is a live generator layer**, adding light physically (linear Add) by default. Photoshop's Lens Flare
  filter paints into the layer's pixels in encoded space, and can't be moved or edited afterwards.
- **The glow is a light glow** (a threshold of the layer's light, blurred at many scales, in linear light), closer to
  After Effects' Deep Glow than to anything in Photoshop. Photoshop's Outer Glow is a layer style made from the layer's
  alpha (Layer Style's L2).
- **Light above white is kept** until the output transform (`film` or `clip`). Photoshop's 8- and 16-bit documents
  clip at every step.

## Risks

- **L1 is on the critical path.** F4's compositing can't be built on fixed-function blending (Théo's decision). Steps
  0–3 don't need L1, so they go first while it's built.
- **The glow's cache is the milestone's one new kind of state.** It's the first thing kept that isn't keyed by a view,
  and a stale cache would be a stale-view bug. So its key covers everything C and B depend on (the layer's content
  key already covers its media, surface, transform and opacity), and e2e's "rapid edits never show a stale
  refinement" gets a glow version.
- **f16 sums.** Blur accumulation is f32 in registers. The reductions store f16 (`round_for_store`), as the pyramid
  does. Energy is checked in the f16 and f32 composites.
- **WebGPU's four bind groups.** The glow passes read plain textures, not the atlas. Only the content draw uses the
  layer pass's groups, so no pass needs more than four.
- **Scope creep.** Starbursts, sprites, dirt, preset previews, halation and rays are out of F4 (system.md, foundations
  "After the foundations"), as are layer styles (Layer Style's L2–L4).
