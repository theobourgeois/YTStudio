# Rendering, color and large-image processing

Status: proposed contracts, 2026-10-03. These are our processing rules, not a claim of Photoshop parity.

## Pixel and color contracts

Start with an **extended linear sRGB** working space: sRGB primaries and white point, linear transfer,
floating-point channels. Extended values can represent highlights above 1 and out-of-gamut components
below 0. Keep source profiles and original bytes. This is a concrete first working space, not a promise
to support arbitrary working profiles or HDR monitors in the prototype.

Import decodes native samples and alpha, applies EXIF orientation once, interprets the embedded profile,
converts unassociated color to the working space, then premultiplies. Untagged RGB initially assumes
sRGB with a visible status indication; assign-profile and convert-profile are separate later commands.
Do not silently interpret tagged wide-gamut input as sRGB. Either support its conversion or report it.

Authoritative edited tiles use float32 channels initially; GPU color surfaces normally use RGBA16F,
with float32 computation/accumulation where precision requires it. Masks/selection coverage are single
channel float32 resources initially, with measured lower-precision GPU storage. Original 16-bit samples
are not routed through browser canvas decoding to 8-bit. The prototype must test imported precision
even though its initial user-facing formats can be 8-bit JPEG/PNG.

Do not confuse a 16-bit integer file, float16 GPU storage and float32 processing: they have different
precision/range properties. GPU rounding is acceptable only within each operation's documented error
budget; undo restores authoritative resources exactly. Float16 overflow, NaN/Inf and negative lobes
need explicit handling. Declare each kernel's valid range and use float32 fallback when required;
never silently clamp intermediate light to [0,1].

Premultiplied alpha is the compositing representation. Alpha/coverage stays in [0,1]; HDR RGB is not
constrained to be less than alpha. At alpha zero use RGB zero and guard unpremultiplication. Color
transforms and display-domain adjustments operate on guarded unassociated RGB, then premultiply.
Reference alpha/compositing algebra: [W3C Compositing and Blending](https://www.w3.org/TR/compositing-1/).

### Operation domains

| Operation | Proposed initial domain | Contract |
| --- | --- | --- |
| Exposure | Linear working RGB | Multiply RGB by `2^stops`; preserve alpha |
| Light addition/glow | Linear working RGB | Keep highlight energy through intermediate passes |
| Resampling/blur | Premultiplied linear RGBA | Avoid dark/colored transparent-edge fringes |
| Curves | Explicit sRGB-encoded unassociated RGB | Identity is exact; outside [0,1], preserve values initially |
| Normal compositing | Linear premultiplied RGBA | Source-over; masks scale both premultiplied color and alpha |
| Artistic blend modes | Explicit domain per definition | Initially test Multiply/Screen on bounded fixtures; define extended-range behavior before shipping |
| Coverage operations | Scalar coverage | No color-profile conversion or transfer function |

Curves' initial outside-range identity policy is deliberate and may introduce a derivative change at
the endpoints; test and document it. Later add explicit HDR curves rather than silently changing old
documents. Photoshop's display-space blending can differ from these choices. A compatibility mode,
if needed, belongs in a versioned document/operation setting, never a hidden backend discrepancy.

### Display and export

First output target: tagged SDR sRGB. A versioned SDR output transform preserves bounded in-gamut color
and defines highlight/gamut handling for extended values. Establish it with numeric/visual fixtures;
do not let individual effects bake competing display tone curves into the working image.

Pass sRGB-encoded presentation pixels into a correctly tagged canvas/VideoFrame and let Chromium/OS
perform monitor presentation once. Do not also apply the monitor transform in the engine. Validate
this path with tagged patches, gradients and actual screenshots; browser display behavior is not
proven by a correct file encoder. Wide-gamut/HDR presentation gets a separate milestone.

Export uses the same output transform for a chosen profile, then format quantization and encoding.
PNG preserves alpha; JPEG composites against an explicit matte in linear working space before output
conversion. Embed the output profile or standard color metadata consistently. A checkerboard is UI,
never image content. Metadata export defaults retain orientation-normalized dimensions and color
information; privacy-related metadata gets an explicit later export policy.

Color-profile assignment changes interpretation; conversion changes samples to retain appearance.
This distinction is documented by [Adobe: change color profiles](https://helpx.adobe.com/ie/photoshop/desktop/adjust-color/color-profiles/change-color-profile-for-documents.html).

## Coordinates, units and bounds

Document coordinates: pixel-edge origin at top-left, x right/y down, pixel centers at half-integers.
Layers have local pixel coordinates and invertible affine transforms into the document. Viewport
coordinates are CSS pixels; device-pixel ratio only changes presentation density. Define conversion
helpers centrally; brush size, feather, effect radius and stroke sampling do not change with zoom/DPR.

Masks default to layer-local coordinates and follow their layer. A selection is document-space
coverage. Unlinking a mask later requires its own transform. Effect centers default to layer-local
pixels; document generator layers use document pixels. Specify units in every parameter definition.

Source bounds, authored surface bounds, filter-expanded bounds, document crop and requested viewport
are distinct rectangles. Keep off-canvas source content. Effects can request expanded bounds beyond
their input, then document crop clips final output. Texture edges must specify transparent, clamp,
mirror or wrap; the initial photo default is transparent outside authored bounds.

## Tiles, mip levels and memory

Prototype candidate: 256×256 logical tiles, compared against 512×512 during benchmarking. Persist
tile-grid metadata so changing cache/upload sizes does not invalidate stored resources. Empty paint
tiles are implicit transparent; empty masks use an explicit manifest default such as fully visible.

Use immutable tile blobs and copy-on-write surface manifests. A small stroke creates changed tiles
and manifest entries, not a complete image copy. Cache decoded originals and mip levels separately
from authored data. Regenerate affected mip tiles from higher-resolution content; never bake a proxy
into the source or export.

At 48,000,000 pixels, RGBA16F is 384 MB (about 366 MiB), RGBA32F is 768 MB, and a float32 coverage
surface is 192 MB. These numbers exclude caches, buffers and overhead. Tiling bounds residency and
changes; it does not make ten fully populated layers consume the memory of one.

Track CPU, GPU, scratch and pinned-resource bytes separately. Admission control must reserve memory
before scheduling a pass. Cache eviction frees rebuildable tiles first; dirty/pinned resources are
persisted or kept, never discarded. Disk-full errors stop new edits safely. On unified-memory systems,
CPU/GPU accounting must still prevent the two budgets from overcommitting physical memory together.

Start with explicit configurable budgets and a bounded disk-backed authored tile store. Benchmark
default caps rather than guessing available VRAM. Scratch is rebuildable; authored tiles are not.
Initial GC is conservative. [libvips evaluation](https://www.libvips.org/API/current/how-it-works.html)
and [GEGL features](https://www.gegl.org/features.html) provide established examples of demand-driven
regions, tile storage and cached processing. Our interactive scheduler remains our responsibility.

## Render graph and invalidation

Compile semantic layers into an immutable DAG: source decode -> resample -> layer-local effects ->
layer mask -> blend, with adjustment/generator/group nodes as needed. This is the initial order;
filter masks and before/after-mask controls are explicit extensions. Effects see pre-layer-mask input
initially, so a mask hides output including its glow; masking the glow's source needs an upstream mask.

Adjustment layers process the backdrop accumulated below them. Their mask/mix interpolates between
unadjusted and adjusted backdrop; they are not colored overlays. An isolated group composites children
against transparent and blends once into its parent. Pass-through groups and clipping stacks require
their own scope rules; add them with tests, not by treating every group as a flattened bitmap.

Cache keys include node implementation version, parameters, input resource versions, color domain,
requested rectangle/tile/mip and quality. A dirty region propagates through dependency mappings, not
just identical tile indices. Transform nodes inverse-map output requests; blur expands by its support;
global statistics invalidate all affected dependent results when their sampled source changes.

Each operation declares its input region for an output region, output bounds, boundary mode,
resolution policy and global/temporal dependencies. Local filters request neighboring tiles plus halo;
crop the result only after processing. Huge glows use a multi-resolution pyramid with explicit global
alignment. Histogram/automatic adjustments use a separate reduction pass and versioned statistics.
Procedural grain/noise uses global coordinates and a saved seed to avoid seams and changing exports.

## Preview, export and device loss

Viewport rendering requests visible content at an appropriate mip, prioritizes current gestures, then
refines. Fast preview may use reduced sampling; settled/full quality uses defined final kernels.
Show refinement status without making the user manage backend details. Never present a stale view
revision as the current result after a pan, edit or project switch.

Export pins a committed render plan/resources, evaluates full-quality tiles with the same operation
implementations, and streams into the encoder. It does not allocate the whole flattened float image
unless a measured small-image optimization allows it. Export cancellation removes temporary output;
successful output is published only after encoding and finalization.

Device loss invalidates GPU caches, cancels GPU jobs and recreates the device. Reload resources from
durable tiles/sources. Basic CPU fallback can keep documents inspectable; unsupported effects must
show their unavailable state and export must fail explicitly rather than omit them. Preserve accepted
edits across device/engine failure.
