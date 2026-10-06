# Product: Photoshop-style editing with creative light effects

Status: revised 2026-10-05 (first proposal 2026-10-03). Théo's requirements are kept apart from our recommendations.

## Intent

Théo wants a Photoshop-style editor with a good share of its useful functionality, and a stronger playground for
creative effects: adjustable lens flares, glows and other light effects above all. It sits beside the video and music
suites. The first version is small in features, but its foundations are the application's, not a prototype's.

**The first audience is Théo's own work**: thumbnails, covers and stills for short-form video, composites, artwork and
stylised photos. Optimise for one person editing one document. A photo catalogue, collaboration and bulk RAW
development are separate, later workflows.

Photoshop is the behavioural reference. Use our own look and words where they help. Never copy its artwork or promise
interchangeable PSD rendering: a similar workflow and exact file fidelity are different commitments.

## Workflows that define useful

### Correct and finish a photograph

Open a photo; straighten and crop without discarding the source (crop follows the foundations); add exposure and
curves; paint a mask to limit an adjustment; compare before and after; export at the right size. Reopen and keep
editing the same adjustments and mask.

### Make a composite (a thumbnail)

Place two images; move, scale and rotate the foreground; select or paint away its background; organise the layers;
adjust the foreground on its own; add light; export with or without transparency. Transforming again and again
resamples the preserved source, never the previous result.

### Light it

Add a flare as editable content; place its source on the canvas; tune its elements and colour; add glow; mask it
behind an object; save a preset; reopen and move the light again. Controls are artistic and useful, and results are
the same at every zoom and export size.

### Retouch without losing the original (later)

Paint on a separate layer; clone or heal with an explicit sampling scope; repair a blemish; undo a stroke; compare.
Changing adjustments must not apply their correction twice to pixels sampled earlier.

## Scope by milestone

| Capability | Foundations (F1–F5) | First usable editor | Later |
| --- | --- | --- | --- |
| Documents | New from presets or an image; autosave, reopen, export | Crop, resize canvas, duplicate | Several open at once, interchange |
| Layers | Placed image, pixel layer, adjustment, generator; visibility, opacity, order | Groups, locks, clipping | Embedded documents, layer styles |
| Transforms | Move, scale, rotate, mirror; source preserved | Numeric fields, snapping, nondestructive crop | Perspective, warp, liquify |
| Masks and selections | Layer mask, rectangle selection, round brush | Lasso, add/subtract, feather, mask properties; magic wand, Quick Selection, subject selection (built early: selections.md) | Colour range, edge refinement, Object Selection |
| Adjustments | Exposure, curves | Levels, hue/saturation, colour balance, gradient map | Grading, RAW development |
| Effects | Glow; flare with four element types | Presets, reorder, bypass | Halation, rays, bokeh, distortion, textures |
| Painting | Round brush on masks and pixel layers | Opacity and flow, eraser, pressure | Textured tips, scatter, dynamics |
| Retouching | — | Clone, then researched healing | Patch, content-aware repair |
| Text and shapes | — | Text, basic shapes | Paths, typography, shape tools |
| Formats in | JPEG, PNG (8 and 16 bits); sRGB, Display P3, Adobe RGB, untagged | WebP, AVIF, TIFF; HEIC on macOS | RAW, PSD subset (with a report of what's unsupported) |
| Formats out | PNG (transparency), JPEG (matte) | 16-bit PNG and TIFF, WebP | Wide-gamut and HDR output, PSD subset |
| Assistant | Reads the document and sees it; every feature's tool as it lands | Parity with the UI | Higher-level recipes ("make a thumbnail from…") |

The table is an order of work, not a promise that every item is in the first release.

## What professional depth means here

- **Edits survive**: saving, reopening, moving and duplicating keep every edit. Originals, masks and editable effects
  stay available.
- **Undo**: one gesture is one step, and undo restores the exact pixels committed.
- **Composition**: layers, masks, selections and adjustments combine consistently, and what's being edited is always
  obvious.
- **Preview and export**: they use the same processing. A coarse preview is visibly coarse until it refines.
- **Large images**: no brush dab or undo step copies a whole image.
- **Export**: it states size, format, transparency and colour, and a failure never overwrites a good file.
- **Effects**: editable, maskable, reusable and responsive. More controls must mean more useful control.

Adobe describes adjustment layers, Smart Objects and masks as separate nondestructive mechanisms
([Adobe](https://helpx.adobe.com/photoshop/using/nondestructive-editing.html)); we give their benefits without its
whole object model.

## Boundaries

- **Platforms**: local and desktop-first, macOS first. The browser workflow (`pnpm dev`) keeps working with the same
  renderer. Windows portability is a design requirement (WebGPU runs on D3D12 there, and sharp has Windows builds),
  but Windows is unverified until it's tried.
- **WebGPU is required.** Every Mac and Windows machine the app targets has it. A machine without it gets a clear
  message, not a slow fallback.
- **Colour**: documents are RGB with transparency, displayed in SDR. Float internals are required for light effects.
  HDR display, CMYK, spot channels, print proofing and every Photoshop blend mode are separate features. Decoding a
  RAW file isn't a RAW developer.
- **Files**: a project is a `.vaudio` package, as every suite's is, and a flattened export is not a save. PSD, ABR,
  Adobe plugins and generative fill have no promise in the foundations; when interchange arrives, it reports what it
  couldn't carry.

## Quality targets

These are in [foundations-prototype.md](foundations-prototype.md), measured on Théo's machine. They're engineering
goals, not capabilities yet. Correctness, durable resources and bounded memory are release gates; responsiveness is
measured.

## Questions for Théo, answered with working examples

1. After glow and the flare, which effect deserves depth first: halation, rays, bokeh or distortion?
2. The output's highlight roll-off: `film` (light above white blooms towards white, the default) or `clip`. Compare
   on his own images in F4.
3. Should Photoshop-style blending in encoded space be offered beside linear light, for familiarity?
4. When does PSD interchange matter more than more native tools?
5. How much brush and tablet depth does his work need?

None of these blocks the foundations. Defaults: flare and glow first, linear light, native projects first, a basic
round brush first.
