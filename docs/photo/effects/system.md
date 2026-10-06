# Editable creative effects

Status: revised 2026-10-05 (first proposal 2026-10-03). See [rendering](../rendering.md) for domains, regions,
levels and the output transform.

## Product direction

Effects are a big reason to build this editor. Prioritise good-looking, adjustable systems over a long list of opaque
filters. Start with glow and a flare made of elements; then halation, light rays, depth-driven bokeh, lens distortion,
film treatments and procedural textures. Some later effects need depth maps or analysis passes: those are explicit
input resources, never magic parameters assumed to exist.

Optical Flares builds flares from core objects and photographic sprites, which supports an element-based editor
([Video Copilot](https://video-copilot.gitbook.io/opticalflaresnuke/using-optical-flares-for-nuke/creating-a-lens-flare-from-scratch)).
Our element types, defaults and assets are our own.

## Three kinds, kept distinct

- **Adjustment layers** process what's below them (exposure, curves).
- **Layer effects** process their layer's content before its mask (glow).
- **Generator layers** produce content (a flare, a texture) and are moved, masked and reordered like any layer.

They may share kernels; their semantics stay separate. Applying one never flattens a layer or changes its source.

## Definition and instance

A definition (`shared/photo/effects/<type>.ts`) declares:
- its type, version and kind;
- its parameters, with units, defaults, ranges and how they're shown;
- its colour domain;
- its region rule (input region for an output region, expanded bounds), whether it commutes with reduction (see
  rendering);
- its canvas handles;
- its GPU passes: WGSL in `src/suites/photo/render/kernels/`;
- its CPU reference in `shared/photo/reference/`, for the kernels that have one.

An instance (`EffectInstance`) stores id, type, version, enabled and parameters. Parameters are validated centrally,
in one place, for the UI, the assistant and `normalizePhotoProject` alike. Cache keys include the version.

Parameter specs are photo's own. `shared/params.ts` is the video editor's and photo can't import it (the layering
test forbids it). If the two turn out the same shape, move them into the platform rather than copying.

Processing uses a few node kinds: pointwise colour, resample, local kernel, multi-scale pyramid, reduction (global
statistics) and procedural generator. A new node kind is added only for a concrete effect. Panels never contain
effect-specific rendering code: they render a definition's parameters.

**As built (F2):** the definitions are in `shared/photo/effects/index.ts` (`EFFECTS`: exposure and curves, each
with `isIdentity`, `commutesWithReduction`, `reference`, `summary`), their parameter specs in `params.ts` (`number`:
unit, range, step, decimals; `curves`: a `CurveSet`), the curve maths in `curve-math.ts`, the references in
`shared/photo/reference/adjustments.ts`, and the GPU passes in `src/suites/photo/render/adjustments.ts`
(`ADJUSTMENT_KERNELS`: a WGSL `adjust` and how its parameters are packed). Properties renders a `number` spec as a
slider with its field (`panels/fields.tsx`) and a `curves` spec as the Curves graph (`panels/curves-editor.tsx`).
Adding an adjustment: a definition, a kernel, a reference and a test of each against the other; the panel, the
assistant's catalogue (`describeAdjustments`), validation and the render plan follow. Behaviour and what's
unverified: [research/adjustments.md](../research/adjustments.md).

**As built (F4):** `EffectKind` is `"adjustment" | "filter" | "generator"`; a definition says its `reach` (document
pixels) and region rule. The glow is a filter (Photoshop's Smart Filter: `filters` on a layer, applied in linear
light before its mask), defined in `glow.ts` (version 1: six octaves of σ = radius·2^−j / 2, weights 0.8^j, each on
the coarsest level keeping 1.5 texels, read by a cubic B-spline) with its CPU reference in
`reference/glow.ts`. The Lens Flare is a generator (`flare.ts`): elements (source glow, halo, ghost, anamorphic
streak), presets (Classic: the video editor's arrangement; Anamorphic; Subtle) sized by the canvas's diagonal, its
reference in `reference/flare.ts`. Light's alpha: `max(r, g, b)` where there was none, and no pixel brighter than
its coverage (up to white). Properties renders any parameter from its spec (`panels/params.tsx`), the flare's
elements as a list (`panels/light.tsx`).

## Glow: the first layer effect

Input is premultiplied linear RGBA. Steps:
1. Take each pixel's contribution above a threshold with a soft knee, in linear luminance.
2. Blur it at several scales with a pyramid (downsample, blur, upsample-and-add), aligned globally in document
   pixels so tiles and exports agree.
3. Tint it, scale by intensity, add in linear light.

The glow extends its layer's bounds, and alpha grows with its coverage. A glowing object exported over transparency
composites correctly over black, white and colour: it never injects colour at zero alpha.

Controls:
- radius (document pixels);
- intensity (stops);
- threshold;
- knee;
- tint and tint amount;
- mix.

Add is the first mode; screen and others follow their extended-range tests. No tone mapping inside: light above 1 is
left for the output transform.

## Flare: the first generator

A flare has:
- a source position (document pixels, a canvas handle);
- an optical centre (default: the canvas centre);
- global intensity and colour;
- an ordered list of elements, each with a stable id, type, size, position along the source-to-centre axis, offset,
  tint, intensity and shape parameters.

The first element types are source glow, halo/ring, ghost (disc or polygon, with a chromatic rim) and anamorphic
streak; starbursts, sprites, dirt and richer chromatic separation follow when those look good. Random elements use a
saved seed; nothing depends on time. The generator's output is premultiplied linear light whose alpha is its
coverage. A mask hides it behind objects. Automatic occlusion from a depth or matte resource is later, and it's never
described as physical optics.

## Porting from the video editor

`shared/effect-library/light.ts` has Deep Glow, Lens Flare, light rays, glint, light sweep, chromatic aberration,
flash, light leak and bokeh. Use them as references for the look and the controls, and port the algorithms, not the
code: they're GLSL for WebGL2, and built around 8-bit intermediate layers. What changes:

| Video (`light.ts`, `effect-gl.ts`) | Photo |
| --- | --- |
| `pow(2.2)` / `pow(1/2.2)` for linear light | The exact sRGB curve, once, at input and output |
| 8-bit intermediates, cube-root `enc`/`dec`, dither in every pass | Float intermediates, no dither until output quantisation |
| Output clamped to [0, 1], `rgb ≤ a` (`effect-gl.ts` `MAIN`) | Nothing clamped; colour may exceed alpha |
| `burn()`: highlight shoulder inside each effect | The document's output transform (`film`), applied once |
| Glow: 32-sample golden-angle spiral per pass, randomly rotated per pixel | A deterministic pyramid: no per-pixel noise, tile-aligned |
| Sizes as fractions of the clip's frame; a flare centre in media space | Document pixels |
| Flare: ghosts at fixed axis positions (0.55, 0.25, −0.2, −0.45, −0.7, −1.1, −1.35), hexagon or disc, ±4% chromatic rim | The same idea as editable elements; the video's arrangement becomes the default preset |

Never change video rendering to make photo work.

## Presets and extensibility

**As built (F5)**: a filter's or generator's built-in looks are `presets` in its definition, with its `category`
(`effects/index.ts`): each a label, a description and its parameters for a canvas (sizes as fractions of the
diagonal). The catalogue (`effects/catalog.ts`) lists them for the Filter menu, the Filter Gallery, the Layers menus
and the assistant (`add_filter`'s `preset`). Glow's: Bloom, Soft Haze, Neon, Dreamy, Halation; Lens Flare's:
Classic, Anamorphic, Subtle. Applying one adds an instance with its values: nothing refers back to the preset.

**As built (stylised filters, 2026-10-06)**: kernel filters, a generic pass for filters that are a function of the
point and its content within a reach ([stylized-filters.md](stylized-filters.md)): sixteen of them in six
categories. The Filter Gallery previews a look on the canvas before it's applied (the preview above, built).

Presets are versioned data referencing definitions and assets the preset owns. Applying one copies it into an
instance, so updating a preset never rewrites existing projects. Previewing a preset doesn't touch history; applying
it is one step. User shaders, third-party binary plugins and executable preset code are deferred: no plugin API until
several effect families have exercised the definitions.

## Acceptance fixtures

- Tiled vs monolithic, viewport vs export: within each kernel's declared tolerance.
- Glow and flare across tile boundaries: no seams, no cropped halos.
- Highlights keep their colour and structure until the output transform; intermediate energy is checked numerically.
- Alpha edges over black, white and saturated backdrops.
- The source handle at several zooms moves the same document point.
- Reorder, bypass, mask, undo, save and reopen keep every setting.
- An unknown effect version opens as unavailable with its settings intact.
