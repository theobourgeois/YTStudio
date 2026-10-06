# Rendering, colour and large images

Status: revised 2026-10-05 (first proposal 2026-10-03). These are our processing rules, not a claim of Photoshop
parity. Everything here runs in the page's WebGPU renderer, with CPU references in `shared/photo/reference/` that
the GPU is tested against.

## Working space and alpha

- **Extended linear sRGB**: sRGB primaries and white point, linear transfer, floating point. Values above 1 are light
  brighter than white (a glow's core); values below 0 are colours outside sRGB's gamut (a P3 photo's greens). Neither
  is clamped between operations.
- **Premultiplied alpha** is the compositing representation. Alpha stays in [0, 1]; colour isn't limited to alpha.
  At alpha 0, colour is 0, and unpremultiplying is guarded. Colour conversions and display-referred operations work on
  guarded unassociated colour, then premultiply again. Reference algebra: [W3C Compositing](https://www.w3.org/TR/compositing-1/).
- One working space for now. Wide-gamut and HDR *display* are separate later milestones; the working space doesn't
  change for them.

### Getting sources in

Import decodes the file's samples and alpha at their own depth and applies EXIF orientation once (the helper does
both). The GPU then converts each source tile once, into the working space:

1. Samples to [0, 1] floats (8 or 16 bits).
2. The profile's transfer curve to linear: parametric (`para`) or sampled (`curv`) curves, evaluated in f32.
3. The profile's colorants (already adapted to the D50 connection space, so `chad` is not applied again) to XYZ,
   then sRGB's own D50 matrix inverted, to linear sRGB, **not clipped**. Both matrices fold into one 3×3.
4. Premultiply.

This handles matrix/TRC profiles, v2 and v4: Display P3, sRGB and Adobe RGB, which is what cameras and phones write
(checked on macOS's own profiles). LUT-based profiles go through the helper's Little CMS to sRGB, and the layer says
that colours outside sRGB were clipped. Untagged files are sRGB, said so in the layer's properties. Assigning and
converting profiles are later, separate commands
([Adobe: assign vs convert](https://helpx.adobe.com/ie/photoshop/desktop/adjust-color/color-profiles/change-color-profile-for-documents.html)).

The CPU reference (`shared/photo/colour.ts`) parses the profile and converts; fixtures check the GPU against it and
against known values (Display P3 pure green → about `[-0.2249, 1.0421, -0.0786]` linear sRGB).

## Storage formats and their precision

f16 has an 11-bit significand: between 0.5 and 1 its step is 2⁻¹¹ ≈ 4.9 × 10⁻⁴ in linear light.

| Content | Format | Why |
| --- | --- | --- |
| Sources from 8-bit files | `rgba16f` | An 8-bit step near white is ≈ 8.9 × 10⁻³ linear; f16 is ~18× finer. Round trip error ≤ 0.037 of an 8-bit step, 0.092 premultiplied (below) |
| Sources from 16-bit files | `rgba32f` | A 16-bit step near white is ≈ 3.5 × 10⁻⁵ linear; f16 would be ~14× coarser and lose the file's precision |
| Painted pixels | `rgba16f` | Painting adds no precision a 16-bit file needs; half the memory and disk of f32 |
| Masks, selections | `r16f` | ~2 000 levels near white, ~8× an 8-bit mask; feathered edges don't band |
| Intermediates, composite | `rgba16f`, or `rgba32f` when any source is 16-bit | The document's precision follows its sources, not a switch |
| Accumulation inside kernels (blur sums, dab coverage) | f32 in registers | f16 sums drift |

f16 tops out at 65 504: enough for any light we make. NaN and infinity can't be produced by a kernel (inputs are
guarded, divisions protected); a fixture feeds each kernel extreme values to check.

**The lossless round-trip rule.** Importing an 8-bit sRGB JPEG or PNG and exporting it unedited at 8 bits gives the
same samples, bit for bit, including through 8-bit dithering (below), for every pixel with any alpha. A fully
transparent pixel's colour isn't kept: premultiplied light has none there, so it exports as 0 (as Photoshop's does).
Worked out exhaustively over every 8-bit code and alpha (`shared/photo/output.test.ts`) and measured on the GPU in F0:
f16 storage moves an 8-bit sample at most 0.037 of a step when opaque (worst near code 192, where linear light
crosses 0.5 and f16's step doubles) and 0.092 premultiplied by a low alpha (dividing by alpha magnifies the error).

**Stores round explicitly.** Metal's conversion when a kernel writes an `rgba16float` storage texture *truncates*,
which doubles those errors (0.080 measured), and `quantizeToF16` before the store is folded away by the shader
compiler (measured too). So every kernel that stores f16 rounds the mantissa itself first, to nearest, ties to even,
by integer arithmetic (`round_half` in `kernels.ts`); F0's `rounding` check confirms every stored half is the nearest.

## Coordinates, units and bounds

Document coordinates: origin at the top-left pixel *edge*, x right, y down, pixel centres at half-integers. Layers have
local pixel coordinates and an invertible affine transform into the document (mirroring is allowed; a singular matrix
is refused by the edit). Viewport coordinates are CSS pixels; DPR only changes how densely the canvas is drawn. Brush
size, feather, effect radii and stroke sampling are in document (or layer) pixels, never screen pixels. Conversions
live in `shared/photo/geometry.ts` alone.

Masks are layer-local and follow their layer. Selections are document-space. Generator layers' handles (a flare's
source) are document pixels. Every parameter definition states its unit.

Source bounds, a surface's bounds, an effect's expanded bounds, the canvas and the requested view are distinct
rectangles. Content past the canvas is kept. Outside a surface's tiles is its `fill` (transparent, or 1 for masks).
Sampling past a source's edge is transparent.

## Resampling

Placing a source (move, scale, rotate) samples it through the inverse transform:

- **Reduction never aliases**: the sampler reads from the source's level whose scale is the nearest at or above the
  one needed, then interpolates.
- **Final quality** (the settled view and exports): Mitchell–Netravali bicubic (B = C = ⅓), in linear premultiplied
  light. It has small negative lobes, and its alpha is clamped to [0, 1]. **Interactive quality** (during a drag):
  bilinear. Quality is a parameter of the resample node, versioned like an effect.
- Transforms always resample the *source*, never the previous result: scaling down and back up is lossless, because the
  matrix is what's edited.

Levels (the pyramid) are a 2 × 2 box reduction in linear premultiplied light, built on the GPU from level 0. They're
rebuildable and never saved.

## Operation domains

| Operation | Domain | Contract |
| --- | --- | --- |
| Exposure | Linear RGB | Unassociated: × `2^stops`, + offset, then the gamma correction's power (1 / gamma, mirrored below 0); alpha unchanged (research/adjustments.md) |
| Glow, flare (adding light) | Linear RGB | Energy is kept through every pass; nothing clamped |
| Blur, resampling | Premultiplied linear RGBA | No dark or coloured fringes at transparent edges |
| Curves | sRGB-encoded unassociated RGB | Each channel's own curve, then the composite. Identity is exact (left out of the plan; an untouched channel is never re-encoded). Outside [0, 1] values pass through unchanged (a documented kink at the ends); HDR curves are a later, separate definition |
| Compositing (modes, opacity, Fill, soft edges) | The document's: `photoshop`, sRGB-encoded (premultiplied); `linear`, linear light | Photoshop's look (measured: layer-style/photoshop-measurements.md). Source-over for Normal; a mask scales colour and alpha alike. Pixels, sources and every other operation stay linear |
| Blend modes | Encoded straight colour (in `linear` documents, linear) | `shared/photo/reference/blend.ts`, matched to Photoshop 27.11 within 0–2 levels (the component modes 7). A mode's result never leaves [0, 1] further than its inputs did: within sRGB it clips as Photoshop's does, light above white goes through Normal, Darken/Lighten, Multiply, Screen, Add, Difference and Subtract |
| Coverage (masks, selections) | Scalar | No colour conversion, no transfer curve |

Photoshop blends in its document's encoded space by default, and so does a `photoshop` document (version 4,
the default for new photos; README.md, A24). Older photos, and those set to it, composite in linear light
(`linear`): a versioned document setting, never a hidden backend difference.

### Blending (as built, L1)

- A `photoshop` plan's composite holds encoded values, premultiplied, in **f32** (when the device blends f32): an
  8-bit sample's trip through f16 linear tiles and then an f16 encoded composite could leave its 8-bit level. Layers
  are encoded as they're drawn, so Normal is still the GPU's own source-over (and exactly Photoshop's mix);
  adjustments decode, adjust in linear light and encode again; and one pass decodes the result at the end, so
  the screen, refinement, exports and Convert to Pixels all get linear light as before.
- A layer with a mode, Blend If or excluded channels is drawn alone into a scratch buffer, then the blend pass
  reads it and the composite below (`render/blend.ts`, the reference's steps). Plain Normal layers draw in runs, with
  Fill folded into their opacity. The screen keeps composites below blended layers as it does below adjustments,
  so hovering modes re-renders only from that layer up.
- Blend modes don't commute with reduction (a mode of averages isn't the average of the modes): reduced views of
  a plan with one refine at level 0. Normal does, in either compositing (within tolerance at soft edges).

## The output transform

Every displayed or exported pixel leaves through one versioned transform. It's applied identically in the view and
the export, and nothing else maps light to display:

1. Composite over transparent (PNG), or over the matte colour in linear light (JPEG).
2. **Highlights**: `output.highlights` in the document. `clip` clips each channel to 1. `film` (the default) is
   identity on [0, 1] and rolls light above 1 towards white, hue-preserving, continuous and monotonic: the look the
   video suite's lighting effects get from their `burn`, but done once at output instead of per effect. Effects
   never apply their own tone curves. The exact curve is fixed in F4 with fixtures; values in [0, 1] are untouched
   either way, so ordinary photos are unaffected.
3. Out-of-gamut (negative) components: clipped per channel for SDR sRGB output. Wide-gamut output is a later milestone.
4. Encode with the sRGB transfer curve, unpremultiplied for formats that store straight alpha.
5. **Quantise.** For 8 bits: rectangular dither of ±0.375 of a step, deterministic per document pixel (a hash of
   its coordinates, the same u32 arithmetic in WGSL and `shared/photo/output.ts`). That breaks up gradient banding
   in glows and skies, yet leaves exact 8-bit levels exact: ½ − 0.375 leaves 0.125, above the 0.092 worst f16 error.
   For 16 bits: no dither.

The view uses the same transform into an `srgb` canvas (`bgra8unorm`, the adapter's preferred format), with the
checkerboard drawn under transparent pixels by the presenter: it's UI, never image content. Chromium then
colour-manages to the display, once; we never apply a monitor profile ourselves. Later, a `display-p3` canvas with an
`rgba16float` format and `extended` tone mapping (all three accepted here, measured) gives wide-gamut and HDR display
without touching the working space.

## Tiles, levels and memory

- Tiles are 256 pixels square (F0 compared 256 and 512: the same speed panning, and 256 wastes far less when the
  budget is tight or a stroke is small). The size is recorded per manifest, so a later change needs no migration.
- Empty colour tiles are implicit (the manifest's `fill`); constant tiles are a value, not a blob.
- **GPU memory**: an LRU cache of tile textures by hash, plus scratch. It has a budget (Settings › Photo, default
  2 GB) because Chrome reports neither VRAM nor true RAM. What's rebuildable goes first: levels, composite tiles,
  converted source tiles (refetched from the server's raw cache). Drafts are pinned for the stroke. A finished
  stroke's tiles also wait in the upload queue as bytes in memory until the server acknowledges them, so evicting
  their GPU copies loses nothing.
- For scale: a 48 MP layer is 384 MB as `rgba16f`, 768 MB as `rgba32f`, 96 MB as an `r16f` mask. Tiling bounds what's
  resident; it doesn't make ten full layers cost one.
- Measured on an M5 Pro (64 GB): uploading 48 MP of `rgba16f` tiles (732 × 256²) took 151 ms; allocating 48 MP of
  `rgba32f` gave no out-of-memory error. A smaller machine is simulated by lowering the budget, and F0 records
  behaviour at 1 GB.

## The render plan and invalidation

`compileRender(document)` (pure, tested) turns layers into a plan: for each layer, source → resample → layer effects
→ mask → blend, bottom to top. Adjustment layers act on what's below them; generators produce content. The plan is
derived, never saved. Effects see the layer before its mask, so a mask hides a glow too. Masking a glow's *source*
needs a mask upstream (later: filter masks).

Each node declares:

- **its input region for an output region**: a pointwise node needs the same rectangle; a blur needs it grown by its
  support; a resample needs the inverse-mapped bounds; a global node (auto levels, later) needs everything, through a
  separate reduction pass;
- **whether it commutes with reduction**: linear pointwise nodes (exposure, normal compositing, masks, resampling)
  do; nonlinear ones (curves, glow's threshold) don't;
- **a version**, part of every cache key with its parameters, input hashes, level, tile and quality.

**The settled view is the full-resolution render, reduced.** At 100% and above that's literal. Below 100%, the
renderer evaluates at the view's level directly when every node on the path commutes with reduction (then it's the
same result), and otherwise renders level 0 for the visible region and reduces it. While a gesture is under way it
may evaluate at the view's level anyway, showing a subtle "refining" state until the settled result replaces it. A
stale result is never shown as current: every request carries the view and document revision it was made for.

### As built (F2)

- `compileRender(doc, sources)` (`shared/photo/render-plan.ts`) leaves out hidden and fully transparent layers,
  identity adjustments (so identity is exact by construction) and what can't draw (missing media, unavailable
  effects: listed as `skipped`). Each node has a key (type, version, parameters, opacity; an image's media, size and
  transform); `prefixKeys[i]` keys the result after node i, so an edit above leaves every key below it alone. The
  plan's `format` is `rgba32float` when any image is 16-bit and the device blends f32 (`float32-blendable`, asked
  for when the device is made; without it composites stay f16).
- The evaluator (`render/compositor.ts`) draws runs of images source-over into one buffer and runs each adjustment
  as a pass reading that buffer and writing the other (two take turns). Fragment outputs to f16 round first
  (`round_for_store`), as kernels' stores do.
- The screen keeps the composite below each adjustment it drew (four at most), keyed by the prefix key, the view,
  the quality and the sources' residency, and starts from the highest one still valid: dragging an adjustment's
  slider re-runs that adjustment and what's above it, nothing below (counted in e2e). The canvas is drawn bilinear
  only while the view or a layer's place moves; other edits stay final, so kept composites are reused.
- **Refinement** (`needsRefinement`: below 100% and some node doesn't commute): the view is drawn at its own level
  at once, the status bar says "Refining…", and 150 ms after the view and the document are still (every image
  loaded) the renderer renders the plan at level 0 over regions (`refinePlan`: at most 2048 document pixels a side,
  aligned to the view's level 2^k, clipped to the canvas plus Mitchell's halo), reduces each by the pyramid's own
  2 × 2 box to level k, and samples it at the view's pixels with Mitchell stretched as a source's level would be
  read. So for a plan that commutes, the view's level and the refinement agree (measured within 4 × 10⁻³). A
  refinement renders into a buffer of its own and is swapped in only if it's still for the plan and view the
  screen shows (`render/latest.ts`, `LatestOnly`: one at a time, told to stop as soon as it isn't wanted, never
  kept late). The assistant's pictures, Home's cover and the Layers thumbnails refine the same way.
- At 100% and above the view's level is level 0, evaluated directly (above 100% a curve then applies to the
  resampled light, not before it: what Photoshop shows at 200% is the pixels enlarged; ours is smooth).

### Masks and painted pixels (as built, F3)

- A pixel layer is drawn by the same layer pass as an image (its surface is a virtual image with a pyramid built by
  `reduce` where level 0 changed), so it resamples, refines and exports alike.
- A layer's mask is read in the layer's own pixels at the level the layer is read at, bilinear (texel for texel when
  the layer is), and multiplies what the layer adds; an adjustment's mask is read in document pixels at the view's
  level and multiplies how much it changes. Masks are linear: plans with them still commute with reduction.
- A stroke stamps dabs into draft tiles (copies made on first touch) with the coverage curve of
  `shared/photo/brush.ts`; with a selection, the dabs go into a tile of their own and the shown tile is what was
  there mixed towards it by `selection_coverage` (the CPU reference is `shared/photo/selection.ts`). Every store
  rounds to the nearest half first, as other kernels' do.

Large glows use a pyramid with one global alignment (phase fixed in document pixels), so a tile and its neighbour
agree and the view and the export agree. Procedural noise (grain, flare dust) uses document coordinates and a saved
seed. Tile boundaries are tested for seams for every kernel that reads neighbours.

## Export

Export renders level-0 composite tiles in strips with final quality and the same kernels, applies the output
transform, and sends each strip to the server, which hands it to the helper for encoding. It never allocates the
whole float image. (The helper may hold the quantised 8- or 16-bit image while encoding: 192 MB for 48 MP RGBA8. That's
measured in F4 and streamed through libvips's raw loader if it's too much.) It pins one document state; editing
continues. PNG keeps alpha; JPEG is composited over its matte in linear light first. The output profile is embedded:
sRGB now, Display P3 when wide-gamut output exists. Privacy metadata (GPS, camera serials) isn't copied by default.

## Device loss

`device.lost` drops every GPU resource. The renderer recreates the device and rebuilds from the server (blobs,
source tiles). Drafts of a stroke in progress are lost and the user is told the stroke was cancelled. Finished strokes
are safe: their tiles were read back at pointer-up and wait in the upload queue as bytes in memory, not on the GPU.
F0 forces a loss with `device.destroy()` and checks this.
