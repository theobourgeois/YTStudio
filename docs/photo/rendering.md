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
| Sources from 8-bit files | `rgba16f` | An 8-bit step near white is ≈ 8.9 × 10⁻³ linear; f16 is ~18× finer. Round trip error ≤ 0.03 of an 8-bit step (worked out below) |
| Sources from 16-bit files | `rgba32f` | A 16-bit step near white is ≈ 3.5 × 10⁻⁵ linear; f16 would be ~14× coarser and lose the file's precision |
| Painted pixels | `rgba16f` | Painting adds no precision a 16-bit file needs; half the memory and disk of f32 |
| Masks, selections | `r16f` | ~2 000 levels near white, ~8× an 8-bit mask; feathered edges don't band |
| Intermediates, composite | `rgba16f`, or `rgba32f` when any source is 16-bit | The document's precision follows its sources, not a switch |
| Accumulation inside kernels (blur sums, dab coverage) | f32 in registers | f16 sums drift |

f16 tops out at 65 504: enough for any light we make. NaN and infinity can't be produced by a kernel (inputs are
guarded, divisions protected); a fixture feeds each kernel extreme values to check.

**The lossless round-trip rule.** Importing an 8-bit sRGB JPEG or PNG and exporting it unedited at 8 bits gives the
same samples, bit for bit, including through 8-bit dithering (below). Worked out: f16's error at linear 1.0 is at most
2.4 × 10⁻⁴, and sRGB's slope there is 1/2.275, so the encoded error is ≤ 1.1 × 10⁻⁴, about 0.027 of an 8-bit step.
Mid-grey is about 0.017 of a step. This is a test, not an assumption.

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
| Exposure | Linear RGB | Multiply by `2^stops`, alpha unchanged |
| Glow, flare (adding light) | Linear RGB | Energy is kept through every pass; nothing clamped |
| Blur, resampling | Premultiplied linear RGBA | No dark or coloured fringes at transparent edges |
| Curves | sRGB-encoded unassociated RGB | Identity is exact. Outside [0, 1] values pass through unchanged (a documented kink at the ends); HDR curves are a later, separate definition |
| Normal compositing | Premultiplied linear RGBA | Source-over; a mask scales colour and alpha alike |
| Other blend modes | Stated per mode | Not in the foundations. Each gets its domain and extended-range rule, with fixtures, before shipping |
| Coverage (masks, selections) | Scalar | No colour conversion, no transfer curve |

Photoshop blends in its document's encoded space by default, so some modes will look different from it. A
compatibility mode, if wanted, is a versioned document setting, never a hidden backend difference.

## The output transform

Every displayed or exported pixel leaves through one versioned transform. It's applied identically in the view and
the export, and nothing else maps light to display:

1. Composite over transparent (PNG), or over the matte colour in linear light (JPEG).
2. **Highlights**: `output.highlights` in the document. `clip` clips each channel to 1. `film` (the default) is
   identity on [0, 1] and rolls light above 1 towards white, hue-preserving, continuous and monotonic: the look the
   video suite's lighting effects get from their `burn`, but done once at output instead of per effect. Effects
   never apply their own tone curves. The exact curve is fixed in F3 with fixtures; values in [0, 1] are untouched
   either way, so ordinary photos are unaffected.
3. Out-of-gamut (negative) components: clipped per channel for SDR sRGB output. Wide-gamut output is a later milestone.
4. Encode with the sRGB transfer curve, unpremultiplied for formats that store straight alpha.
5. **Quantise.** For 8 bits: rectangular dither of ±0.45 of a step, deterministic per document pixel (a hash of its
   coordinates). That breaks up gradient banding in glows and skies, yet leaves exact 8-bit levels exact (the margin
   is above the 0.03-step f16 error). For 16 bits: no dither.

The view uses the same transform into an `srgb` canvas (`bgra8unorm`, the adapter's preferred format), with the
checkerboard drawn under transparent pixels by the presenter: it's UI, never image content. Chromium then
colour-manages to the display, once; we never apply a monitor profile ourselves. Later, a `display-p3` canvas with an
`rgba16float` format and `extended` tone mapping (all three accepted here, measured) gives wide-gamut and HDR display
without touching the working space.

## Tiles, levels and memory

- Tiles are 256 or 512 pixels square; F0 measures both and the choice is recorded per manifest. A manifest's tile
  size can't change, but a new manifest can use another.
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
