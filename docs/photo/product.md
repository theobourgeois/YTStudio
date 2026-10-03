# Product: Photoshop-style editing with creative render effects

Status: proposed scope, 2026-10-03. Requirements from the owner are distinguished from recommendations.

## Product intent

The owner wants a Photoshop-style editor with a good amount of its useful functionality and a stronger
creative effects playground: particularly adjustable lens flares, glows and other render effects.
The app belongs beside the existing video and music suites. The first implementation is a prototype
in feature coverage, but its foundations should survive into the application.

The recommended first audience is someone making photo composites, artwork, cover images, thumbnails
and stylized photographs. Optimize for an individual editing one document; a photography catalog,
cloud collaboration and bulk RAW development are separate later workflows.

Photoshop is the behavioral reference. Use our own visual design and terminology where it helps;
do not copy artwork or claim interchangeable PSD rendering. Similar workflow and exact file fidelity
are different commitments.

## Workflows that define usefulness

### Correct and finish a photograph

Open a photo; crop and straighten without discarding the source; add exposure and curves; paint a mask
to limit an adjustment; compare before/after; save the editable document; export a correctly sized image.
Reopen it and continue editing the same adjustments and mask.

### Make a composite

Place two images; position, scale and rotate the foreground; select or paint away its background;
organize the layers; adjust the foreground independently; add lighting; export with or without transparency.
Changing the transform repeatedly must resample from preserved content, not the previous preview.

### Create a lighting treatment

Add a flare as editable content; place its source on the canvas; tune its elements and color; add glow;
mask the treatment behind an object; save a preset; reopen the project and move the light again.
Effects should expose useful artistic controls, with predictable results across zoom and export size.

### Retouch without losing the original (later milestone)

Create a separate paint layer; clone/heal using an explicit sampling scope; repair a blemish; undo a
stroke; compare the result. Changing adjustment layers should not accidentally apply their correction
twice to previously sampled retouch pixels.

## Scope by milestone

| Capability | Foundations prototype | First usable editor | Subsequent depth |
| --- | --- | --- | --- |
| Documents | One open photo project; import/save/reopen/export | New document presets, crop, resize, duplicate | Multiple documents, interchange |
| Layers | Placed image, paint resource, adjustment, flare generator | Groups, reorder, duplicate, locks, clipping | Embedded documents, richer layer styles |
| Transforms | Affine move/scale/rotate; source preserved | Numeric controls, snapping, nondestructive crop | Perspective, warp, liquify |
| Masks/selections | Grayscale layer mask, round mask brush, rectangle selection | Selection combinations, lasso, feather, mask properties | Color range, edge refinement, object selection |
| Adjustments | Exposure and composite curves | Levels, saturation, color balance, gradient map | Advanced grading, RAW development |
| Effects | Glow and editable flare with a small element set | Presets, effect masks, reorder/bypass | Halation, rays, bokeh, distortion, procedural textures |
| Painting | Basic deterministic raster/mask brush | Opacity/flow, eraser, pressure, paint layers | Textured tips, scattering, richer dynamics |
| Retouching | Deferred | Clone first, then researched healing | Patch, content-aware repair |
| Text/shapes | Deferred | Editable text and basic vector shapes after core gates | Paths, richer typography and shape tools |
| Formats | JPEG/PNG import; PNG/JPEG export | 16-bit PNG/TIFF after precision tests | RAW, PSD subset with capability reports |
| Assistant | Read document, core edits through the same commands | Parity for implemented workflows | Higher-level editing recipes |

This table is an order of work, not a promise that every item belongs in the first release. Rich
retouching, typography and effects each need their own research and acceptance milestones.

## What professional depth means here

- Document edits survive save/reopen and project moves. Originals, masks and editable effects remain available.
- Undo follows user gestures and restores exact committed resources. A drag or stroke is one step.
- Layers, masks, selections and adjustments compose consistently; the active editing target is obvious.
- Preview and export use the same processing rules. Temporary coarse previews are distinguishable from settled output.
- Large images do not require a full-document copy for every brush dab or history step.
- Export explicitly describes size, format, transparency and color conversion; failure does not overwrite a good file.
- Effects are editable, maskable, reusable and responsive. More controls must produce more useful control.

Adobe documents adjustment layers, Smart Objects and masks as distinct nondestructive mechanisms.
Our core workflow should provide their relevant benefits without requiring Photoshop's complete object
model. [Adobe: nondestructive editing](https://helpx.adobe.com/photoshop/using/nondestructive-editing.html).

## Explicit initial boundaries

Local desktop editing, macOS first, with portable core code. Keep the existing browser-plus-local-server
development workflow available through a presentation fallback. Windows build portability is a design
requirement; Windows performance and packaging remain unverified until exercised.

Initial document mode is RGB with transparency and SDR display output. Floating-point internals are
required for effects; HDR display, CMYK editing, spot channels, print proofing and every Photoshop blend
mode are separate features. RAW decoding alone does not constitute a production-quality RAW developer.

Use `.vaudio` as the editable format initially. A flattened export is not a project save. PSD import,
PSD export, ABR presets, Adobe plugins and generative models have no initial compatibility promise.
Unsupported features must be reported when interchange is introduced.

## Quality targets

Proposed targets and measurement procedures are in [foundations-prototype.md](foundations-prototype.md).
They are engineering goals, not current capabilities. Correctness, durable resources and bounded memory
are release gates; responsiveness gets measured on named hardware and realistic documents.

## Product questions to resolve with working examples

1. Which effects deserve depth first after flare/glow: halation, rays, bokeh or distortion?
2. How closely should legacy display-space Photoshop blending be available alongside linear light?
3. When does PSD interchange become more valuable than additional native editing tools?
4. How much brush/tablet depth is needed for the owner's actual workflow?

These do not block foundation work. Defaults: flare/glow first, explicit linear-light rendering, native
projects first, basic round brush first. Record owner feedback when those examples exist.
