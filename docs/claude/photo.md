# The photo suite

The planned **photo suite** is a Photoshop-style image editor with creative lighting/render effects.
Read [`docs/photo/README.md`](docs/photo/README.md) for its product, research and architecture (WebGPU in the
page renders and paints; content-addressed tiles in the package; a helper process decodes files) and the
foundations' milestones and gates. **F0–F4 are built**: the suite is registered (`SuiteId` `photo`), with
`shared/photo/` (the document: types.ts, project.ts, edits.ts, layers.ts; merge.ts plans merging layers; image, pixel, adjustment and generator layers, filters; effects/:
the effect definitions by kind (adjustments: Exposure, Curves; filters: glow.ts; generators: flare.ts, the Lens Flare) and their parameter specs (numbers, curves, colours, points, choices, booleans, element lists); render-plan.ts: `compileRender`, prefix keys,
`refinePlan`; reference/: the CPU references the GPU is tested against; colour and ICC, geometry, half floats,
surfaces, brush, the output transform; tools.ts), `server/photo/` (the helper process, the only code that parses
image files, with sharp; decoded sources in each package's `photo/cache/`; banded exports; the blob store; the lab),
`server/suites/photo.ts`, and `src/suites/photo/` (store.ts (history is a `PhotoState`: the document and the selection), ui.ts (several layers can be selected: selection.ts), keys.ts, layer-actions.ts (the Layers commands), merge.ts, painting.ts + paint-target.ts (the brush), uploads.ts (the publication gate), brush-options.ts, options-bar.tsx, workspace.tsx, panels/, canvas/,
tools.ts + tool-edits.ts, live.ts: the open photo's renderer (and, in development, `window.photoDebug` for e2e and
`window.photoBench` for the bench); render/: the WebGPU renderer, its atlas, page tables,
WGSL kernels and compositor.ts, the plan's evaluator, which draws the screen, exports, covers and the assistant's
pictures alike; renderer.ts keeps the composite below each adjustment and refines reduced views, never showing a
stale one; adjustments.ts the adjustments' passes; isolated.ts evaluates a layer with filters or a generator alone and
composites it; glow.ts the glow's passes (its octaves live on the document's 2^k grids, read at any grid by their
B-spline) and glow-cache.ts its contributions from level 0, kept per glow; flare.ts the flare's pass).
`scripts/photo-sheet.ts` renders and checks every filter and preset, as the video effect sheet does. `/photo-lab.html` in `pnpm dev` is F0's lab, kept for the
renderer's parts the suite doesn't use yet. Kernels and passes storing `rgba16float` must round first
(`round_for_store`): Metal truncates on store (docs/photo/rendering.md). Pixel layers and masks are surfaces
(`render/surface.ts`: tiles by hash, strokes on drafts); a saved photo only names pixels the server has (`uploads.ts`,
`SuiteBackend.checkSave`). Selections (docs/photo/selections.md: the Marquees, Lassos, Magic Wand, Quick Selection, Select
Subject, Object Selection (painted over a thing: SAM 2.1 prompted by the stroke's points, `sam.ts` and `object-model.ts`, a
second look at a small thing and the edge decided by colour, `sam-refine.ts` in `edge-worker.ts`; a model can be several
files, `PhotoModelSpec.files`), modes, Inverse, Feather, the canvas's right-click menu) are a rectangle or a `MaskSelection` (8-bit coverage
over its box: `shared/photo/selection*.ts`, `magic-wand.ts`, `quick-select.ts` on `graph-cut.ts` and `gmm.ts`); the
GPU gets a mask's coverage per tile from the CPU (`selectionCoverage`), keep rectangles' analytic path. The tools read
the photo through `PhotoRenderer.samplePixels` (`selecting.ts` keeps it). Select Subject's model (IS-Net) is
downloaded by the server into `MODELS_DIR` only when the user says yes, and run in the tab by ONNX Runtime Web
(`subject-model.ts`); e2e sets `EDITOR_PHOTO_MODELS=stand-in`. Light (docs/photo/f4-light.md): no pixel is brighter than its coverage (up to white), the
output's `film` rolls light above white off at the end (`output.ts`), and a glow's or flare's WGSL mirrors its CPU
reference in `shared/photo/reference/`: change both. Layer Style L1–L4 are built (docs/photo/layer-style/README.md:
blend modes and compositing in render/blend.ts, effects (Bevel & Emboss, Satin, patterns too) in shared/photo/style/ and
render/style.ts, their fields made in the layer's pixels and kept; reference/blend.ts and reference/style.ts are held
to Photoshop's own renders, `scripts/photoshop-probes/bevel-sheet.ts` shows the bevels beside them). Patterns are
the document's surfaces (`patterns`) or built in (`style/patterns.ts`), read by the style pass from a storage buffer
of their mip levels; Styles (presets) are this computer's (`layer-style/styles.ts`). A filtered or
generator layer (isolated.ts) composites by the GPU's own blending when it's Normal or light added in linear light,
otherwise through the blend or style pass (`fixedComposite`); light blends in linear light in a "photoshop" document
too (`blendsInLinear`: a layer with filters, a flare with `blendSpace`). F5 (harden) is built but for its gate (Théo's
walkthrough in the packaged app): the server side (`server/photo/recovery.ts`: the checkpoint and the check on open,
`SuiteBackend.keepPrevious`/`check`; documents and blobs written with `writeFileDurably`; `faults.test.ts`), the
Filter menu and Filter Gallery (`filters.tsx`, from the catalogue `shared/photo/effects/catalog.ts`: a filter's
`category` and `presets` in its definition, so a new filter needs no UI of its own), export cancel, and tight GPU
budgets: a full-resolution render draws a region only in the same task as the check that its tiles are all resident
(`whenResident` in renderer.ts); keep it so, or an export can silently read evicted tiles. The stylised filters (Gradient Map, Color Grade,
Halftone, Glitch, VHS, Film Grain…: docs/photo/effects/stylized-filters.md) are **kernel filters**
(`shared/photo/effects/kernel.ts`): a definition, a CPU reference and a WGSL `effect(p, c)` each, by category in
`effects/filters/`, `reference/filters/` and `render/filters/` (change both sides; `kernel.ts`'s prelude and the
reference's helpers share names), run by one generic pass in isolated.ts on the content grown by the filter's reach.
`scripts/photo-sheet.ts` holds every look's GPU result to its reference and, with `--thumbnails`, renders the Filter
Gallery's cards into `public/photo-filters/` (run it after adding or changing a look). The gallery previews a look on
the canvas without touching the document (`filterPreview` in ui.ts, `shownDoc` in filter-preview.ts) until Apply. **Scene maps**
(docs/photo/effects/scene-maps.md): a kernel filter can read its picture's depth (Depth Anything V2, a second
optional model) and subject (Select Subject's) through `scene_at(p)` / `env.scene` (`shared/photo/scene.ts`, a grid of
the document, no reach): its definition says `scene`, the renderer's `SceneMapStore` makes them in the tab from its
input (as Camera Raw's analysis is) and the plan leaves the filter out until they're there. Every kernel filter has
Apply To (subject / background); the Depth and Subject categories are built on them. `photo-sheet.ts --models`
uses the real models (the stand-ins otherwise). **Camera Raw** (docs/photo/camera-raw.md; CR0 to CR3
built) is one effect, `camera-raw`, a filter and an adjustment layer alike (`EffectDefinition.kinds`: check a kind with
`usableAs`, never `def.kind`). Its develop (`shared/photo/effects/camera-raw/develop.ts`) is built from Photoshop's
measured responses (`measured.ts`, generated by `scripts/photoshop-probes/camera_raw.py --tables`; `develop.test.ts`
holds it to CR0's fixtures run by run) and mirrored in WGSL by `render/camera-raw.ts`: change both. Its window and
sections are `src/suites/photo/camera-raw/` (⇧⌘A); its edits are absolute (`cameraRawEdit`), so its window's gesture
adds a new one and Cancel leaves nothing. Its local sliders and Contrast read an **analysis** of the picture it
develops (`analysis.ts`: guided-filter grids, haze, statistics, from a coarse render), handed in by `compileRender`'s
`cameraRaw` resolver by the input's key (its id, or "pending", in the node's key) and kept by
`render/camera-raw-analysis.ts`: the screen builds missing ones in the background, `settledPlan` waits for them.
Its Color Mixer and Color Grading are `colour.ts` (Grading in stops of linear ProPhoto, as Camera Raw's), Glow reads a
grid made from the analysis (`glowGrid`); the GPU's table carries them after the curves. Its presets are
`presets.ts` (the window's Presets tab, `add_filter`/`add_adjustment`'s `preset`), Auto is `auto.ts`.
**Content-Aware Fill** (docs/photo/content-aware-fill.md; ⇧⌫, the Edit menu, the canvas's right-click menu, `content_aware_fill`)
fills the selection from what's around it onto a new layer above the active one: LaMa (512 × 512) run in the tab as
Select Subject's model is (every photo model is `shared/photo/models.ts`, `/api/photo/models/<name>`, one download
question: `model-dialog.tsx`), a hole filled in crops about twice its size, never under 512, one after another
(`shared/photo/inpaint.ts`'s `planFill`), the photo's grain put back where a crop was shrunk (`content-aware-fill.ts`).
**Hue/Saturation** (docs/photo/hue-saturation.md; ⌘U, the header's Image menu) is one effect, `hue-saturation`, a
filter and an adjustment layer alike, as Camera Raw is: its window (`src/suites/photo/hue-saturation/`) is one gesture
on an `EffectTarget` (`effect-window.ts`: `targetEdit`, shared with Camera Raw's), its controls show in Properties too.
Its maths is `shared/photo/reference/hue-saturation.ts`, mirrored in WGSL by `render/hue-saturation.ts`: change both.
The **Online panel** (docs/photo/online.md; a tab beside Properties) searches Iconify's icons, Bing's images and
Openverse's photos, or reads a pasted link, and places a result as a layer: the server searches and downloads
(`server/photo/online.ts`; Iconify limits requests, so icons' shapes are fetched a set at a time and kept, never one
by one), the helper's `prepare` makes anything that isn't PNG, JPEG or WebP a PNG; e2e sets
`EDITOR_ONLINE_ASSETS=stand-in` (`online-stand-in.ts`).
The **Photoshop tools** past the selection tools and the brush (docs/photo/tools/: Crop, the Eyedropper, Type, the
shapes, Gradient, Paint Bucket, Dodge/Burn/Sponge, Background and Magic Eraser) are each a `ToolKit` (`src/suites/photo/toolbox/`: its
options, its press on the canvas, its overlay), registered in `toolbox/index.ts` and placed in the strip by
`tool-groups.ts` (Photoshop's groups and keys). Text and shape layers are drawn by the browser's 2D canvas through one
seam (`shared/photo/canvas-content.ts` → a `CanvasNode`, `render/canvas-content.ts`): a new kind of drawn layer is a
case there. A raster's key says what it draws within a pixel, never which pixel (the Move tool drags these layers by
whole pixels), so a move reuses the drawn raster: keep positions out of `CanvasRaster.key`. Only image and pixel layers crop (`isCroppable`). **Flips and right-angle turns** (Edit › Transform, ⌘H / ⌥⌘H; Image › Image Rotation) are `shared/photo/orient.ts`: exact in a layer's five numbers, the canvas's document-pixel masks moved pixel for pixel (`surface-orient.ts`); `layerMatrix` is exact at right angles (`cosSin`), so a turned layer is still drawn texel for texel. **Skew, Distort and Perspective** (⌘T Free Transform, `free-transform.ts`): `LayerTransform.skew`/`.perspective` (version 8), the maths in `shared/photo/projective.ts` (`layerProjection`, `transformFromQuad`); `layerMatrix` is only the affine part, so anything that maps a layer's pixels in perspective goes through `layerPoint`/`pointInLayer`/`corners` or the node's `projection` (the GPU passes divide by w: `render/layer-map.ts`). **Warp** (`LayerTransform.warp`, `shared/photo/warp.ts`): a 4 × 4 Bézier patch in the layer's own pixels, before its place; the GPU passes invert it by Newton's method (`WARP_WGSL`, `warpRows`), `layerPoint`/`pointInLayer`/`outlinePoints` on the CPU. Painting a layer in perspective or warped is refused (`isBent`, `perspectiveRefusal`). A placed image is never rasterised by these tools: the
Magic Eraser erases through its mask; the others ask (the paint-choice dialog). Every colour picker shown in the photo
editor samples the canvas, as Photoshop's Color Picker does (`ColorSamplerContext`, provided by `colour-sampling.tsx`:
a press on the canvas with one open goes to it, whatever the tool).

## Commands

```bash
pnpm tsx scripts/photo-fixtures.ts [--skip-large]   # the photo suite's test images (48/100 MP, P3, 16-bit, alpha, EXIF) into data/photo-fixtures
pnpm tsx scripts/photo-bench.ts [--runner chrome|electron] [--quick] [--lab [--tiles 256,512]] [--shots dir]   # the photo suite's targets, measured in the workspace (--lab: F0's lab)
python3 scripts/photoshop-probes/<probe>.py   # measure a real Photoshop (macOS, installed): docs/photo/layer-style/photoshop-measurements.md
```
