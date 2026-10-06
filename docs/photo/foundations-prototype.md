# Foundations: implementation order and gates

Status: revised 2026-10-06 (first proposal 2026-10-03). **F0, F1, F2, F3 and F4 are done** (F0–F2 2026-10-05,
F3 and F4 2026-10-06): their gates passed (F4's in linear compositing: its "photoshop" lines wait for Layer Style's
L1, which has since merged: both halves hold); results and what each changed in the plan are under "F0 results" to
"F4 results". **F5 is built but for its gate** ("F5 progress"): Théo's walkthrough in the packaged app.

The foundations are the application's first real version with deliberately few features, not a throwaway prototype.
Each milestone ends with something Théo can use and a gate that's checked, not argued. Lasting contracts (the
document, resources, colour, effect definitions) are decided before the code that depends on them; hardening
machinery waits for F5.

## The end-to-end result

Open a large photo; place a second image; transform it; add exposure and curves; select a region and paint a layer
mask; add glow and an editable flare; undo and redo all of it; close; reopen; export PNG and JPEG. The project stays
editable, portable (moved, duplicated) and recoverable. Effects crossing tiles have no seams; preview and export agree.

## F0: measure the risky assumptions (days, not weeks)

Build the real renderer modules (`src/suites/photo/render/`) behind a development page, plus the helper process, and
measure. Code that survives the gate stays; the page is deleted once F1's workspace exists.

1. Helper process: sharp decode of JPEG/PNG (8 and 16 bits) to raw tiles with orientation and ICC bytes; in `pnpm dev`
   and **in the packaged desktop app** (sharp in `extraResources`, run through Electron in Node mode).
2. GPU source conversion: TRC + matrix, unclipped; the P3 fixture.
3. Level 0 → levels, the view at any zoom with bicubic final quality, pan and zoom.
4. A blur across tile boundaries, compared with a monolithic render of the same small image.
5. A stroke's end: read back, hash in a Worker, upload, verify on the server.
6. `device.destroy()` mid-session; recovery.
7. A 1 GB budget on a 48 MP image: eviction and refetching.
8. Tile size 256 vs 512 on all of the above.

**Gate** (Electron and dev Chrome, on the baseline machine):

| Check | Pass |
| --- | --- |
| 48 MP JPEG, cold: first coarse picture / settled fit view | ≤ 1 s / ≤ 3 s |
| Pan and zoom, warm, 1920 × 1080 device-pixel view | p95 frame ≤ 16.7 ms (hard limit 33 ms) |
| Stroke end (20 tiles) → committed to history | ≤ 30 ms |
| Blur, tiled vs monolithic | max difference within the kernel's declared tolerance; no seam |
| Display P3 green | ≈ `[-0.2249, 1.0421, -0.0786]` to 1 × 10⁻³ |
| 8-bit sRGB round trip through f16 tiles | bit-exact |
| Device loss | view back from the server's data ≤ 2 s; nothing committed lost |
| 1 GB budget | no out-of-memory error; panning works, refetching visibly |
| Packaged app | the helper decodes and encodes |

**If it fails**, use the ladder, in order, and record why. The document and resource formats don't change:
1. **WebGL2** in the same architecture, if a WebGPU feature or driver problem is the blocker. Float targets are
   available through `EXT_color_buffer_float`; brush and levels become fragment passes.
2. **A native Dawn engine running the same WGSL**, if page-based rendering can't meet memory or throughput. That's
   the original plan, with its kernels already written; presentation is then the problem
   ([engine options](research/engine-options.md)).

### F0 results (2026-10-05)

**Passed.** Measured with `pnpm tsx scripts/photo-bench.ts` (both runners, both tile sizes, cold decodes) on the
baseline machine, in Electron 44.5.0 (Chrome 152, a hidden window with the app's web preferences) and headless
Chrome 154 (the export's launch flags). Each cell is Electron / Chrome, 256-pixel tiles unless it says otherwise.

| Check | Pass | Measured |
| --- | --- | --- |
| 48 MP JPEG, cold: first coarse picture / settled fit view | ≤ 1 s / ≤ 3 s | 0.53 / 0.75 s · 0.45 / 0.67 s (the helper's decode is 0.43–0.52 s of it) |
| 100 MP JPEG, cold | (dataset) | 0.88 / 1.21 s · 0.86 / 1.22 s |
| Pan and zoom, warm, 1920 × 1080 device pixels, 240 frames | p95 ≤ 16.7 ms | GPU p95 4.0 ms (max 4.5) · 5.1 ms (max 5.8); CPU p95 ≤ 0.3 ms; a Mitchell frame at fit ≈ 10 ms |
| Stroke end (20 tiles) → committed | ≤ 30 ms | 12.1 ms · 14.9 ms (readback 3.5–4, hashing 7–10); uploaded 0.1–0.25 s later |
| Blur, tiled vs monolithic | within tolerance, no seam | identical: maximum difference 0, at the seams too (both tile sizes) |
| Display P3 green | ≈ (−0.2249, 1.0421, −0.0786) to 10⁻³ | (−0.22498, 1.04199, −0.07874); every patch within 2 × 10⁻⁴ of the CPU reference |
| 8-bit sRGB round trip through f16 tiles | bit-exact | 0 samples differ: 48 MP JPEG, an 8-bit ramp, an EXIF-rotated JPEG, a PNG with an alpha gradient (fully transparent pixels' colour isn't kept: rendering.md) |
| Device loss | ≤ 2 s, nothing committed lost | 0.20 s · 0.21 s; the committed stroke restored from the server |
| 1 GB budget | no out-of-memory error, refetching works | 100 MP at 1 GB and 48 MP at 256 MB: no GPU errors; 105–768 tiles evicted and fetched again; settle p95 17–28 ms |
| Packaged app | the helper decodes and encodes | `pnpm test:desktop`: WebGPU (Metal) in the app's window, the helper from its resources, an exact round trip |
| 16-bit precision | — | `rgba32f` tiles within 0.001 of a 16-bit step; `rgba16f` would be 7 steps off (so A08 holds) |
| 48 MP PNG export | correct, throughput recorded | 3.2 s in Electron (quantise 0.3 s, encode 2.2 s); headless Chrome's 7.4 s is Playwright inspecting each band's upload |

**Tile size: 256.** Pan and zoom are the same at both (4.0 vs 4.0 ms p95 in Electron). With a tight budget 256 is
clearly better (100 MP at 1 GB: settle p95 17 ms vs 39 ms; 512 evicts and refetches four times the pixels per miss),
and a small stroke writes less (20 tiles of 0.5 MB against 9 of 2 MB, uploaded in 0.1 s against 0.06–0.5 s). F1
fixes 256; manifests still record it.

**What F0 changed in the plan** (each written into the docs it concerns):

- Metal *truncates* f32 → f16 on storage writes, and the compiler folds `quantizeToF16` away: kernels round the
  mantissa themselves (ledger A10). The f16 round-trip error is 0.037 of a step opaque and 0.092 premultiplied, not
  the 0.03 first worked out, so the 8-bit dither is ±0.375, not ±0.45 (A09; `shared/photo/output.test.ts` checks
  every code at every alpha).
- Shaders compile when a session starts (async pipelines): compiled on first use they added 0.5 s to the first open.
- sharp tags 16-bit output sRGB by *changing* its samples (by up to 25 000): 16-bit output is untagged until the
  profile chunk is written by hand. sharp's 16-bit raw input must be a `Uint16Array` (a Buffer is read as 8-bit).
- Exports go to the server in bands (begin, rows, finish): one 192 MB body was too much for the test harness, and
  bands mean neither side holds the whole image.
- The packaged helper: electron-builder drops folders called `node_modules` from resources, so sharp's native
  packages ship in `photo-helper/native/`. Mac packaging was broken on main since the Windows port (`electronDist`
  pointed inside Electron.app); fixed.
- A helper crash retries its requests one at a time, so only the request that crashes it fails.

**Built in F0, and kept** (F1 builds on these): `shared/photo/` (colour and ICC, geometry, half floats, surfaces,
brush spacing, the output transform; tested), `server/photo/` (the helper and its supervisor, the blob store, the
lab's service and routes; tested with the real sharp), `src/suites/photo/render/` (the device, atlas, virtual
images, kernels, source loading, paint surfaces, the view, checks, the session with device-loss recovery). **Goes in
F1:** the lab (`photo-lab.html`, `src/suites/photo/lab/`, `/api/photo/lab`), replaced by the suite's workspace and
project routes; `scripts/photo-bench.ts` stays, pointed at the suite.

## F1: the photo suite exists

**Platform first** (all done in F1):
- photo's folders in `server/architecture.test.ts` (F0 added them; F1 adds `server/suites/photo.ts`);
- never replace a corrupt `project.json` (all suites);
- media import that accepts photo formats with the helper's probe (TIFF later, 16-bit PNG now, ICC, bit depth);
- Home: images dropped alone start a photo project;
- a still cover for photo projects;
- "New Photo" in the desktop File menu;
- Playwright's GPU flags.

**Then the suite**:
- `SuiteId` `photo`: `PhotoProject`, `normalizePhotoProject` (tested), `SuiteBackend`, `ClientSuite`.
- New photo from a size preset (1080 × 1920 first, the app being short-form first; also 1080 × 1350, 1080 × 1080,
  1280 × 720, 1920 × 1080) or from an image (canvas = its size).
- The docked workspace (canvas, Layers and Properties stubs, tool options), Hand, Zoom, Move/Transform with handles
  (one gesture, one undo step), placing a second image.
- Autosave and reopen; PNG and JPEG export from the open tab, with the output transform's `clip` and `film` written
  in F4 (F1 ships `film` as identity on [0, 1], which is all an unedited photo needs).
- Assistant: `get_document`, `view_image`, `transform_layer`, `add_image_layer`, `export_image`.
- `e2e/photo.spec.ts`: create from the picker, place, transform, undo, reload, export.

**Gate**: an unedited 8-bit sRGB photo exports bit-exact. Transforming down to 10% and back up is lossless. Reopen
restores everything. Duplicating and moving the package keep it working. The e2e spec passes alone (`pnpm test:e2e
photo`).

### F1 results (2026-10-05)

**Passed.** `e2e/photo.spec.ts` (8 tests, about 25 s alone) checks each gate item in the real app, with WebGPU on:

| Gate | How it's checked |
| --- | --- |
| An unedited 8-bit sRGB photo exports bit-exact | The sample JPEG opened as the canvas, exported as PNG through the export window (in bands), compared by the helper with the file: 0 samples differ |
| Down to 10% and back up is lossless | W typed 10 then 100 in Properties: the saved transform equals the original exactly, and the source is what's resampled |
| Reopen restores everything | Reload after transforms, hiding, renaming, reordering: the saved document and the panels agree |
| Duplicate and move keep it working | A duplicated project's layer loads (`data-source="ready"`); a renamed one's package moves to `Moved.vaudio` and reopens with its images |
| The spec passes alone | `pnpm test:e2e photo` |

Also checked there: a new photo from the New tile, its size presets (undoable), images dropped on Home starting a
photo the size of the first, a corner handle scaling about the opposite corner as one undo step, nudges coalescing
into one undo step, and the assistant (`get_photo`, `set_canvas`, `transform_layer` with `fit`, a refused
`update_layer`, `view_photo`). The canvas's own pixels are compared with the file's.

**Platform work F1 needed** (all suites benefit): a damaged `project.json` is kept aside (`project.corrupt-<time>.json`)
and refused, never replaced by an empty document (Home marks the project damaged); duplicating clones files and
skips rebuildable `cache` folders and previews; the media store is platform code with an image probe the photo
helper supplies (`MediaAsset.image`: bit depth, alpha, orientation, ICC); a project can have a cover the tab renders
(`PUT /api/projects/:id/cover`); "New Photo" (⌘3) in the desktop File menu; Playwright launches with the GPU on.

**What F1 changed in the plan:**
- A layer's place is five numbers (`LayerTransform`: centre, scale, rotation), not a matrix, so that typing 100%
  gives exactly 100%; skew and perspective would bring a matrix, by migration. F1's document has only what it
  renders: no `blend`, `mask` or `effects` fields yet (architecture.md).
- One compositor (`render/compositor.ts`) draws every layer into a float accumulator through its inverse transform;
  the screen, exports, Home's cover and the assistant's pictures all use it. A layer whose pixels land exactly on
  the target's (scale ±1, right angles, whole-pixel offsets) is read texel for texel: Mitchell softens even at 100%,
  which would have broken the bit-exact export.
- The canvas is drawn in the view's own resolution: the settled view samples layers at the view's level rather than
  reducing a full-resolution composite. Identical for aligned layers; for transformed ones the difference is
  resampling order. The full rule (rendering.md, "The render plan") arrives with F2's render plan.
- The lab (`photo-lab.html`) and its bench stay for now: they measure the renderer's parts, which the suite uses
  as they are. They move onto the suite when F2 adds what they'd measure there. (Done in F2, below.)

## F2: layers and adjustments

- Layers panel (F1 has visibility, order, rename, duplicate, delete; opacity is in Properties): thumbnails of the
  layer as composited, drag to reorder, groups' groundwork.
- Exposure and curves adjustment layers in Properties.
- `compileRender` with the region and reduction rules, and the view's refinement.
- Assistant: `add_adjustment`, `set_effect_params`, `set_layer` (visibility, opacity, order, name).

**Gate**:
- Identity curves are exact.
- Exposure at level k equals level 0 reduced, within tolerance.
- Curves below 100% refine to the level-0 result.
- A slider drag is one undo step and re-renders only what depends on it (counted).
- A stale render never replaces a newer one (scripted rapid edits).

### F2 results (2026-10-05)

**Passed.** Every gate is checked in the real app with WebGPU on (`e2e/photo.spec.ts`, 15 tests, about a minute
alone), reading the GPU's own numbers through `window.photoDebug` (development only):

| Gate | How it's checked |
| --- | --- |
| Identity curves are exact | A Curves layer drawn, then reset: the 8-bit photo under it exports with 0 samples differing (identity adjustments are left out of the plan: exact by construction) |
| Exposure at level k equals level 0 reduced | Exposure +n stops at 50%, 25% and 12.5%: the view's level against the refinement (level 0, box-reduced, Mitchell-sampled), worst 4 × 10⁻³ relative |
| Curves below 100% refine to the level-0 result | A curve drawn on the graph; at fit and at half of it, screen pixels against the CPU's reduction (`shared/photo/reference/reduce.ts`) of the GPU's level-0 render around each, within 4 × 10⁻³ |
| A slider drag is one undo step and re-renders only what depends on it | Exposure's slider dragged over a photo: the screen ran the adjustment ≥ 3 times, drew the image at most once (the first frame keeps the composite below), resumed from it every other frame; one ⌘Z undoes the drag |
| A stale render never replaces a newer one | 15 scripted curve edits 10–400 ms apart below 100%: every frame showed the plan current when it was drawn; the last is the refinement of the last edit, identical (≤ 10⁻⁶) to a fresh one; the scheduler's ordering is unit-tested (`render/latest.test.ts`) |

Also checked there: the GPU's Exposure and Curves against the CPU references; layers reordered by dragging (one
undo step); thumbnails rendered; the assistant's `add_adjustment`, `set_effect_params` (a refused out-of-range
value), `set_layer`.

**Closing F1's gaps** (found reviewing F0 and F1): the research F2 needed first
([research/adjustments.md](research/adjustments.md)); the settled view below 100% is now the full-resolution
render reduced, through the render plan; the evaluator runs adjustments (two buffers, revisions, refining); a
16-bit source's composite is f32 (it was always f16: a 16-bit PNG export of a 16-bit ramp is now within 1 step,
with an f16 composite it was 21 steps off, both measured in e2e), with 16-bit PNG export in the window and for the
assistant; adjustment layers in the document (version 2, `EffectInstance`, photo's own parameter specs); the bench
moved onto the suite, and `set_layer` replaced `update_layer` (order included).

**Measured** with `pnpm tsx scripts/photo-bench.ts` (the suite's scenarios in the workspace, `src/suites/photo/bench.ts`;
fresh projects, so the server's decode is cold) on the baseline machine. Each cell is Electron 44.5.0 / headless
Chrome 154; the canvas panel was 2305 × 1394 / 1725 × 1188 device pixels.

| Scenario | Target | Measured |
| --- | --- | --- |
| Open 48 MP JPEG cold: first picture / settled | ≤ 1 s / ≤ 3 s | 0.49 / 0.66 s · 0.50 / 0.71 s (three more Electron runs: 0.50–0.57 / 0.68–0.79 s) |
| Open 100 MP JPEG cold | (dataset) | 0.95 / 1.27 s · 0.99 / 1.36 s |
| Reopen 48 MP (server's decode cached, a new device) | — | 0.03 / 0.18 s · 0.05 / 0.21 s |
| Pan and zoom, warm 48 MP, 240 frames | p95 ≤ 16.7 ms | GPU p95 6.2 ms · 4.9 ms |
| Exposure drag at fit on 48 MP, 60 frames | p95 ≤ 33 ms; settled ≤ 500 ms | p95 2.6 ms · 5.2 ms; settled with its last frame (it commutes) |
| Curves drag at fit on 48 MP, 60 frames | p95 ≤ 33 ms; settled ≤ 500 ms | p95 2.7 ms · 4.5 ms; refined 194 ms after the last edit · 194 ms (150 ms of it is the wait for stillness) |
| Work during a drag | only the adjustment | 0 or 2 image draws for 60 frames (the first frame), every other frame resumed |
| Export 48 MP PNG (with an exposure and curves) | correct, throughput recorded | 2.6 s · 7.3 s (Playwright inspects each band's upload) |
| Device loss: new device / first picture / every tile back | ≤ 2 s | 9 / 22 / 174 ms · 12 / 20 / 253 ms |
| Budget walk, 16 stops at 100% | no out-of-memory error | 48 MP in 256 MB and 100 MP in 1 GB: settle p95 ≤ 141 ms (120 ms of it the settle wait), no GPU errors |

**What F2 changed in the plan:**
- Curves' order, spline and Exposure's gamma direction are product decisions over unverified references
  (ledger A14, A15): Théo checks them in Photoshop; a difference becomes a new definition version.
- Identity adjustments are left out of the plan rather than computed exactly (A16).
- A refinement is the sources' own pyramid applied to the composite (A17), so "commutes" holds measurably, not
  just in principle; it runs 150 ms after stillness, one at a time, latest only.
- The screen keeps the composite below each adjustment (A18). Its key includes the sources' residency, so tiles
  arriving re-render; a full-resolution refinement doesn't depend on residency (it waits for every image).
- Only the first picture's pipelines are compiled before a photo opens; the rest (f32, adjustments, refinement,
  16-bit output) compile meanwhile. With all of them up front, a cold open's first picture took up to 1.36 s in
  Electron (measured), over the 1 s target.
- The lab stays only for the renderer's parts the suite doesn't use yet (strokes, the blur's seams, P3 patches,
  f16 rounding, 16-bit precision): `scripts/photo-bench.ts --lab`. It's deleted when F3 brings painting into the
  suite and those scenarios move too.

## F3: resources, selections, masks and the brush

- The blob store: content addressing, verification, the publication gate, collection on open.
- Rectangle selection with marching ants; a layer mask from the selection; the round brush with size, hardness and
  strength, on masks and on new pixel layers. Brushing a placed image offers "New paint layer" or "Convert to pixels",
  never rasterising silently.
- The selection limits paint by its coverage, fractionally.
- Assistant: `select_rect`, `add_mask` (from the selection, or empty), `add_pixel_layer`.

**Gate**:
- A stroke across tile boundaries, undone and redone, restores exact coverage.
- A cancelled stroke changes nothing.
- A small stroke shares every untouched tile's hash.
- A duplicate upload is a no-op.
- A document referencing a missing blob is refused.
- Collection deletes only what's unreachable (fixture with history roots excluded, saved roots kept).
- Same samples give the same result at every zoom and DPR.

### F3 results (2026-10-06)

**Passed.** Every gate is checked in the real app with WebGPU on (`e2e/photo.spec.ts`, 25 tests, about two minutes
alone), reading the GPU's own tiles through `window.photoDebug` (`paint`: a stroke from exact samples;
`readSurfaceTile`) and the server's routes:

| Gate | How it's checked |
| --- | --- |
| A stroke across tile boundaries, undone and redone, restores exact coverage | A mask stroke across x = 256 and 512: the crossed tiles' floats hashed; undone they're the fill again; redone, the same hashes, and the screen's composite identical |
| A cancelled stroke changes nothing | A stroke begun and dropped: the document names the same surface, the screen's composite is identical |
| A small stroke shares every untouched tile's hash | A dab in another tile: the new manifest is the old one plus that tile, every other entry the same |
| A duplicate upload is a no-op | A tile the server has `PUT` again: 200, `{ stored: false }` |
| A document referencing a missing blob is refused | A save naming an unknown surface: 409, and `project.json` keeps the last good document (also `server/photo/gate.test.ts`) |
| Collection deletes only what's unreachable | Two strokes, the first only in history; the project closed and opened: the first's manifest is gone, the saved one and its tiles kept (fixtures in `server/photo/blobs.test.ts`: saved roots kept, history's collected, shared tiles kept, recent uploads kept) |
| Same samples give the same result at every zoom and DPR | The same samples on new pixel layers at fit, at 200% and in a page at twice the pixel density: the same surface id (content-addressed, so the same bytes) |

Also checked there: the Rectangular Marquee selecting whole pixels as one undo step; the brush on a placed image
asking first (New paint layer); a selection's fractional edge (x = 300.5) leaving half of a stroke on that column;
a mask from the selection (tiles inside constant, outside the fill, edges stored); the canvas showing the photo
inside it and the checkerboard outside; painting the mask with the mouse as one undo step; the assistant's
`add_pixel_layer`, `select_rect`, `add_mask` (from the selection, and removing one).

**Measured** with `pnpm tsx scripts/photo-bench.ts --quick` (`paintMask`: a mask on the 48 MP photo at fit, a
segment of samples a frame), Electron 44.5.0 / headless Chrome 154:

| Scenario | Target | Measured |
| --- | --- | --- |
| Mask stroke, first visible dab | p95 ≤ 16.7 ms | first 11.2 ms · 13.3 ms; every dab p95 9.1 ms · 12.8 ms (samples to the GPU finishing the frame showing them) |
| Stroke end → history | ≤ 30 ms | 7.6 ms · 8.4 ms for 13 tiles (readback 6–7, hashing 1); a 166-tile stroke 38 ms · 45 ms |
| Undo/redo of a stroke | ≤ 50 ms | p95 13.7 / 13.3 ms · 28.1 / 26.6 ms (the command to the GPU finishing the frame) |
| Open 48 MP JPEG cold (unchanged) | ≤ 1 s / ≤ 3 s | 0.51–0.54 / 0.68–0.72 s · 0.48 / 0.68 s (a first run after the fixtures were made: 1.06 s, the disk cold) |

**What F3 changed in the plan:**
- The selection is an analytic rectangle kept in history (`PhotoState`), not a coverage surface (ledger A20): F3 has
  only rectangles, and their coverage is exact for nothing. Lasso and feather bring a surface, by the selection's kind.
- A selection caps a stroke's *result* (A21): per-dab limiting builds a half-covered pixel back to full, which the
  e2e test caught. With a selection a stroke paints into a tile of its own, and `limit` shows what was there mixed
  towards it by coverage.
- Masks live in their layer's atlas, RGBA on the GPU (A22): a layer pass binds one atlas, and WebGPU allows four
  bind groups.
- An empty pixel layer or a mask that reveals everything is `null` (A19): nothing to upload until it's painted.
- The publication gate and collection are hooks every suite can have (`SuiteBackend.checkSave`, `opened`; A23).
  Collection keeps blobs written since it started, so an upload racing a reopen is never lost.
- Picking a pixel layer on the canvas goes by its painted tiles (a full-canvas paint layer would be picked
  everywhere); its transform box is still its whole surface.
- The lab keeps its blur seams, P3 patches, f16 rounding and 16-bit checks until F4 brings blur into the suite; its
  stroke scenario moved to the suite's bench (`paintMask`).

## F4: light

The detailed plan (decisions, the document, the glow's evaluation, order of work): [f4-light.md](f4-light.md). F4
builds on Layer Style's phase L1 (the blend pass, blend modes, the document's `compositing`); the glow is a filter
(`filters`), and its tools are `add_filter` / `set_filter` rather than `add_effect`.

- Glow as a layer effect; the flare as a generator layer with a source handle and its elements (source glow, halo,
  ghosts, anamorphic streak).
- The output transform's `film` curve fixed with fixtures.
- `pnpm tsx scripts/photo-sheet.ts`, like the video effect sheet.
- Assistant: `add_effect`, `add_generator`, `move_handle`.

**Gate**:
- Radii wider than a tile have no seams.
- Tiled matches monolithic.
- Above-white light survives to the output transform.
- An isolated glowing object over transparency exports correctly over black, white and saturated backdrops.
- A source handle at several zooms lands on the same document point.
- Reordering, bypassing, masking, undoing and reopening keep every setting.

### F4 results (2026-10-06)

**Passed in linear compositing; the "photoshop" half waits for Layer Style's L1.** Every gate is checked in the
real app with WebGPU on (`e2e/photo.spec.ts`, the last seven tests), reading the GPU's floats through
`window.photoDebug` and the export's own path (`renderBands`):

| Gate | How it's checked |
| --- | --- |
| Radii wider than a tile have no seams | A radius-100 glow rendered in 64-pixel regions and as one region: identical (under 1e-5); the sheet's radius-120 glow in 200-pixel regions: 0 |
| Tiled matches monolithic | The GPU's glow against the CPU reference (`shared/photo/reference/glow.ts`) on a painted 320 × 224 photo: within 4e-3 relative; a Lens Flare in linear Add against the background plus `reference/flare.ts`: within 2e-3 |
| Above-white light survives to the output transform | The composite read back holds values above 1 around the glow; a flare's source above 1 |
| An isolated glowing object exports correctly over black, white and saturated backdrops | A glowing cut-out on transparency exported (16 bits, undithered), composited on the CPU over black, white and red in linear light: within 1 level of the app's own render over each; colour 0 wherever alpha is 0 |
| A source handle at several zooms lands on the same document point | The handle dragged to (430, 310) at 33%, 100% and 250%: within half a screen pixel each time; Escape cancels a drag |
| Reordering, bypassing, masking, undoing and reopening keep every setting | Two glows (one tinted) and a flare: a filter dragged below the other, the Filters eye off and on, a mask added and painted, undone and redone, reloaded: the same layers and the same pixels (a SHA-256 of a refined render) |

The "photoshop" half, once Layer Style's L1 merged (2026-10-06): the backdrop gate runs in both compositings (L1's
merge), the flare's reference test and the glow's run in new photos, which are "photoshop" (the flare's in
`blendSpace: "linear"`), and light above 1 survives a new photo's Normal and its Linear Dodge (F5's line in the glow's
test). Every F4 gate now holds in both compositings.

**Measured** with `pnpm tsx scripts/photo-bench.ts --quick` (`glow`: a radius-1000 glow on the 48 MP photo at fit;
`flare`: a flare added and its source dragged, a frame an edit), headless Chrome 154 / Electron 44.5.0:

| Scenario | Target | Measured |
| --- | --- | --- |
| Glow, large radius: first response | ≤ 100 ms | 18.5 ms · 17.3 ms (the edit to the GPU finishing the frame: its preview) |
| Glow, large radius: settled | ≤ 1 s | 285 ms · 303 ms (its cache built from level 0, and a frame drawn with it) |
| Glow: threshold changed (cache rebuilt) | — | first 14.6 ms, settled 186 ms · 15.4 ms, 191 ms |
| Glow: radius dragged (cache re-blurred) | — | frame p95 11.8 ms in Chrome; 56 ms in Electron, measured while another checkout's e2e suite held the GPU (its flare drag read 47 ms then, 13–19 ms before): to measure again quiet |
| Flare: first frame, handle drag | — | 17.5 ms, p95 9.2 ms · 12.8 ms, p95 19.2 ms (quiet run) |

The sheet (`pnpm tsx scripts/photo-sheet.ts`): every pipeline compiles; each filter and preset changes each scene
(a night of lights, the sample photo, a cut-out); nothing is NaN; tiles match; and the film strengths side by side.

**What F4 changed in the plan:**
- A glowing layer's pixel is never brighter than its coverage, up to white (D1 generalised): light gets coverage
  `max(r, g, b)` where its layer had none, and the result anywhere. Without it a soft edge of light above white
  can't be held by a straight-alpha file, and the export composited over a backdrop missed by 44 levels.
- The backdrop gate is measured on a 16-bit export: 8 bits can't hold faint light (alpha under about 1% rounds by
  a whole step: up to 7 levels over black), a limit of the format, not of the light.
- A pixel stored with alpha 0 keeps no colour (`quantize8`, WGSL `QUANTIZE`): a faint light's unpremultiplied colour
  was its full brightness.
- Octaves read at a coarser level than their own (finer than the view's pixels) are read by Mitchell, as a
  refinement samples, not by their B-spline: 0.149 → 0.022 of level 0 reduced at 25%.
- A glow's cache, whoever builds it (a thumbnail, an export), redraws the screen, and the screen's own build retries
  until its images are in.
- Pyramids end at the first level that fits in a tile, so a small layer at 25% reads a coarser level stretched: up
  to 0.15 off level 0 reduced at a tiny, very bright dab (measured; F2's commuting claim holds for images with the
  level). Recorded in rendering.md, not changed.
- The lab's blur seam check is retired with its kernels: the glow's tests cover tiles in the suite.

## F5: harden

- Durability:
  - blobs flushed before they're acknowledged;
  - documents flushed with their folder;
  - the checkpoint;
  - the check on open.
- Fault injection:
  - interrupted blob write;
  - interrupted document write;
  - helper killed mid-decode and mid-encode;
  - server killed with uploads pending;
  - disk full (a small disk image);
  - device loss mid-stroke;
  - a missing source;
  - a corrupt manifest;
  - an unknown effect version.
- Budgets under pressure.
- Export by strips with progress, cancel and collision handling.
- The whole walkthrough in the packaged app.
- Benchmarks recorded.
- Docs updated to what was built.

**Gate**: Théo does the whole workflow without developer tools. No open data-loss, stale-view, colour or seam bug.
Limitations are written down.

### F5 progress (2026-10-06)

**Built: everything but the walkthrough in the packaged app**, which is Théo's gate. First the server side, apart from
Layer Style (it changes the compositor, the document and the tools); then, once L1–L3 merged, the rest, with a way
to find filters, which the workflow needs without developer tools.

The server side:

| Item | As built | Checked by |
| --- | --- | --- |
| Blobs flushed before they're acknowledged | `writeFileDurably` (`server/storage.ts`): temporary file, flushed, renamed, its folder flushed (and the folders made for it) | `storage.test.ts` |
| Documents flushed with their folder | Every suite's `project.json` and `meta.json` (`ProjectStore`), not only photo's | `projects.test.ts`, `faults.test.ts` |
| The checkpoint | `SuiteBackend.keepPrevious`: before a save replaces `project.json`, photo links it as `photo/recovery/previous.json` (a copy where the disk can't link); every document in `photo/recovery/` is a root of collection | `recovery.test.ts`, `faults.test.ts` |
| The check on open | `SuiteBackend.check`, run by `GET /api/projects/:id` (`ProjectStore.openDoc`): every manifest whole and every tile it lists present. If not, the document is set aside (`photo/recovery/incomplete-<time>.json`) and the checkpoint opens, if it's whole; else this one with only the lost surfaces emptied. The platform saves what opened; `X-Project-Notice` says why, and the photo tab shows it | `recovery.test.ts`, `faults.test.ts` |
| Interrupted blob write | Leftover temporary files in `photo/resources` are swept by collection once older than its start; the blob is absent, so the tab uploads it again | `blobs.test.ts`, `faults.test.ts` |
| Interrupted document write | The saved document opens; the half-written temporary file is ignored | `faults.test.ts` |
| Helper killed mid-decode and mid-encode | Retried once on a new helper (as before); what the killed one half-wrote (`<file>.<pid>.<time>.tmp`: a decoded source's hundreds of MB, an export's beside the user's file) is deleted once the request settles (`removeLeftovers`) | `helper.test.ts` |
| Server killed with uploads pending | The saved document is intact; uploads it never named are collected on the next open | `faults.test.ts` |
| Disk full (a small disk image) | A 507 saying the disk is full, for uploads and saves; nothing saved is changed, no temporary file is left; the same requests go through once there's room | `faults.test.ts` (macOS: a 4 MB `hdiutil` image, filled to the last byte) |
| A missing source | A 404 naming the file (`media/<id>`), not "couldn't decode" | `faults.test.ts` |
| A corrupt manifest (and tile) | Read blobs are checked against their names: a damaged one is a 500 saying so, never served; an upload of it mends it; opening treats a surface with a damaged manifest as lost | `blobs.test.ts`, `recovery.test.ts` |

The rest:

| Item | As built | Checked by |
| --- | --- | --- |
| Filters found without a hidden menu | The header's **Filter** menu (Photoshop's): Last Filter (⌃⌘F; Ctrl+Alt+F elsewhere: the filter added last, again, with its settings now), Filter Gallery…, then each category's filters and their looks. The **Filter Gallery** window: every look as a card previewed on this photo (the active layer filtered, or a generator added), searchable, by category, a click applying it; filters can't go on an adjustment layer and say so. Built from the catalogue (`shared/photo/effects/catalog.ts`): a filter's `category` and `presets` in its definition, so a new filter needs no UI of its own. Glow gets five looks (Bloom, Soft Haze, Neon, Dreamy, Halation: radii as fractions of the canvas's diagonal); the assistant's `add_filter` takes a `preset` | `catalog.test.ts`, `keys.test.ts`, `tool-edits.test.ts`, e2e "the Filter menu and the Filter Gallery…" |
| Export by strips with progress, cancel and collision handling | Strips and progress were there (bands of 512 rows, the bar). Cancel (and Esc) now stop an export while it renders: nothing is written and the server lets go of its samples; once every band is sent the helper encodes, which finishes. One export per file at a time (a second to the same file is a 409); an export a tab abandoned (nothing sent for 10 minutes) is let go of. The assistant's `export_photo` stops with its turn | `exports.test.ts`, e2e "an export cancelled while it renders…" |
| Device loss mid-stroke | The stroke is lost with its drafts; the renderer counts it (`lostStrokes`) and the stroke's controller says so ("The GPU stopped mid-stroke"); the photo is drawn again as it was and painting goes on | e2e "the GPU lost mid-stroke…" (the device destroyed between two pointer moves) |
| An unknown effect version | Filters, adjustments, generators and layer effects from a newer app (or of a type unknown here) are kept byte for byte through save and reopen, say they're unavailable (Layers, Properties), and draw nothing (the render equals the photo without them) | e2e "effects from a newer app…" (with `light.test.ts`, `style.test.ts`, `render-plan.test.ts`) |
| Budgets under pressure | **A bug found and fixed**: under a budget smaller than the photo's tiles, a full-resolution render (an export, a refinement, a glow's cache) could read tiles evicted by its own loading or by another render's, and export wrong pixels without a word (Settings' smallest budget, 1 GB, is 2 048 tiles: a 48 MP photo with two full painted layers and a mask needs ~2 400). Now a surface fetches only what a region needs, what's resident is marked as just used before fetching the rest, the region is drawn in the same task as the check that it's all there (`whenResident`), and a region the budget can't hold is an error saying so. A glow's cache reads only its own layer, in regions the budget holds (`glowBuildRegion`: 2 048 at every budget Settings offers) | e2e "a tight GPU budget…": an export and a 100% view at 48 MB equal a 2 GB one's bit for bit, with tiles evicted (12 runs in a row); at 24 MB the export says the budget is too small |
| Benchmarks recorded | `photo-bench.ts --quick` after all of it: every target met, nothing slower (below) | evidence log |

**Measured after F5** (`pnpm tsx scripts/photo-bench.ts --quick`, 48 MP at fit, headless Chrome 154 · Electron 44.5.0):
open 721 · 969 ms (reopen 477 · 407); pan and zoom p95 5.1 · 6.3 ms; Exposure drag p95 8.9 · 4.3 ms; mask dab p95 8.9 ·
8.6 ms (first 11.2 · 11.1, stroke end 7.6 · 8.6 ms, undo 24.5 · 13.8 ms); glow first response 18.4 · 13.4 ms, settled
302 · 290 ms; flare drag p95 9.3 · 4.5 ms; 48 MP PNG export 7.2 · 2.8 s; device loss back in 210 · 174 ms; the 256 MB
budget walk settles a view in p95 133 · 136 ms. Still open: a glow's radius drag in Electron, p95 47 ms (9.6 in
Chrome), as F4 measured it; Chrome's export is slow because Playwright inspects each band's upload.

What's left for the gate: Théo's walkthrough in the packaged app (`pnpm build:desktop`). Known limitations, written
down: a damaged `project.json` is refused, not recovered (below); a tile is only checked for presence on open; ⌃⌘F
is also the desktop app's View › Enter Full Screen, and which wins there hasn't been checked (Chrome hands a page
its keys first); an export's encoding can't be cancelled once every band is sent.

What opening can't do: a **damaged** `project.json` (not JSON, refused by `normalize`) is still refused with its
message (F1's platform rule) rather than opening the checkpoint, because the tab won't open a project whose
summary says it's damaged; the checkpoint is in `photo/recovery/previous.json` to put back by hand. Tiles are only
checked for presence on open (hashing every tile of a large photo is too slow); a damaged one is found when it's
drawn.

## Performance targets

The baseline machine is Théo's: Apple M5 Pro, 64 GB, macOS 26.5. Report the Electron and Chromium versions, the
budget, the view size and DPR, warm or cold, and p50/p95 plus the worst stall. Never claim a target from averages or a
tiny fixture. A constrained run with a 1 GB GPU budget stands in for smaller machines.

| Scenario | Target | Method |
| --- | --- | --- |
| Cursor and overlays | Next frame, whatever the renderer is doing | Input timestamp → overlay presented |
| Pan and zoom, warm 48 MP | p95 ≤ 16.7 ms (gate 33 ms) | Scripted path, 1920 × 1080 device pixels |
| Mask stroke, first visible dab | p95 ≤ 16.7 ms | Pointer sample → presented |
| Stroke end → history | ≤ 30 ms | Pointer up → committed |
| Exposure/curves drag | p95 ≤ 33 ms preview; settled ≤ 500 ms at fit on 48 MP | Parameter change → current revision presented |
| Glow/flare, large radius | first response ≤ 100 ms; settled ≤ 1 s at fit on 48 MP | Fixed view and settings |
| Undo/redo of a stroke | ≤ 50 ms | Command → view |
| Open 48 MP JPEG (cold) | coarse ≤ 1 s, settled ≤ 3 s | Open → presented |
| Export 48 MP PNG | correct, cancellable, throughput recorded | Fixed settings |

If a target misses, split the time into decode, transfer, conversion, evaluation and presentation before changing
anything. A target only moves with recorded evidence and its consequence for the product.

Datasets: 24/48/100 MP single images; a 48 MP five-layer composite; sparse mask strokes; ten full layers (stress);
huge glow support; content past the canvas; a deep effect stack; transparent coloured edges; a portrait cutout;
tagged P3 and Adobe RGB images; 8- and 16-bit ramps. Synthetic fixtures are generated (their provenance is the
script), and Théo's own photos are used where he provides them, never committed.

## Correctness matrix

| Area | Evidence |
| --- | --- |
| Document | Stable ids and order, validation and repair, no-ops, migrations, dangling references reported not dropped |
| Coordinates | Pixel centres, inverse transforms, mirroring, zoom/DPR independence, layer vs document spaces |
| Tiles | Boundary-crossing paint and filters, constant tiles, fills, halos, level alignment |
| Precision | GPU vs CPU reference per kernel, with tolerances fixed before results are looked at; identity curves; 8-bit round trip; 16-bit stays distinct from 8-bit |
| Colour and alpha | Profile conversions (P3, Adobe RGB, untagged), orientation once, alpha never colour-converted, one display transform |
| History | One gesture per step, exact restoration, the selection in history, cancellation |
| Async | Stale renders, project switches, duplicate uploads, uploads after the tab closed, helper restarts |
| Persistence | Publication gate, checkpoint, check on open, move/duplicate, disk full |
| Export | Pinned state despite later edits, profile/alpha/matte, cancel, collision, previous output kept on failure |
| UI | Obvious target, tool cancellation, keyboard access, labels, both themes, no focus rings on clicks |

Bit-identical results across GPUs aren't promised. Undo restoring the exact bytes is.

## What lasts beyond the foundations

The document and its migrations, the resource format, the publication gate, effect definitions and versions, the
coordinate and colour rules, the evaluator's region and reduction rules, the output transform, and the fixtures. The
backend stays replaceable. Development pages and temporary optimisations never reach a saved file.

## After the foundations

1. Core depth: groups (isolated first, then pass-through), clipping, crop and resize, lasso and selection modes,
   feather, levels, hue/saturation.
2. Painting and retouching: opacity vs flow (equations first), eraser, pressure, clone, then researched healing.
3. Composition: text (the browser lays it out, as in the video suite), shapes, layer styles, flare presets, halation,
   rays, bokeh.
4. Photography and interchange: HEIC (macOS's decoder), 16-bit TIFF, wide-gamut and HDR display, RAW, a stated PSD
   subset.

Each starts with its research (`docs/photo/`, Photoshop's behaviour per panel, as `docs/fl-studio/` is for music) and
ends with a complete workflow.

## Evidence log

| Date | What | Result |
| --- | --- | --- |
| 2026-10-05 | WebGPU in Electron 44.5.0 (Chrome 152), M5 Pro | Apple Metal 3 adapter, not a fallback; `shader-f16`, `float32-filterable`, `float32-blendable`, `texture-formats-tier1/2`, `timestamp-query`; 2D textures to 16 384; buffers to 4 GB; read-write `rgba16float` storage textures compile |
| 2026-10-05 | Secure context | `navigator.gpu` is absent on a `data:` URL; present on `file:` and `http://127.0.0.1` (how the app loads) |
| 2026-10-05 | 48 MP tile traffic | `rgba16f` upload 151 ms; `rgba32f` allocation 237 ms, no out-of-memory error; 20-tile readback 2 ms |
| 2026-10-05 | Canvas | `rgba16float` + `display-p3` + `extended` tone mapping accepted; the display reports P3 and high dynamic range |
| 2026-10-05 | Headless Chromium 153 (Playwright) | With `server/gl-browser.ts`'s flags: same Metal adapter and features. Default launch: `navigator.gpu` but no adapter |
| 2026-10-05 | sharp 0.35.5 (libvips 8.18.7, lcms 2.19.1) | 48 MP noisy JPEG → raw 226 ms; a 512² region re-decodes in 128 ms (so decode once to a cache); 2000-px preview 210 ms; 16-bit raw in and out; 16-bit PNG out; libvips binaries 17 MB |
| 2026-10-05 | sharp colour | Converts embedded profiles to sRGB but clips: Display P3 green → `[0, 1, 0]` even as float scRGB. Hence GPU conversion |
| 2026-10-05 | Profiles | macOS's Display P3 (v4, `para`), sRGB and Adobe RGB (v2, `curv`) are matrix/TRC |
| 2026-10-05 | ffmpeg 8.1 (local) | No ICC filters (built without lcms): not a colour-managed decoder |
| 2026-10-05 | f16 stores (F0) | Every differing sample truncated by a plain `textureStore` to `rgba16float`; `quantizeToF16` rounds in isolation but is dropped when its result is stored; integer rounding works (`rounding` check: all nearest) |
| 2026-10-05 | sharp 16-bit tagging | `withIccProfile("srgb")` on 16-bit output changes samples by up to 25 032; on 8-bit output it changes none |
| 2026-10-05 | F0 gate | See "F0 results": every check passed in Electron 44.5.0 and Chrome 154 |
| 2026-10-05 | Device limits | A plain `requestDevice()` gets spec defaults (8192 textures, 256 MiB buffers); `requiredLimits` from the adapter gets 16 384 and 4 GB. A lost device needs a new adapter |
| 2026-10-05 | Large readback | 4096² `rgba16float` (128 MiB) copy + map: 25–45 ms (3–5 GB/s); `writeTexture` of raw half-float bits is exact (subnormals, 65 504, −1) |
| 2026-10-05 | sharp gotchas | 16-bit needs `toColourspace("rgb16")`; its 16-bit path drops the profile without converting; TIFF defaults to JPEG compression (8-bit); float raw input is read as 0–65 535; prebuilt HEIC decoding fails (no HEVC) |
| 2026-10-05 | `sips` | HEIC → PNG/TIFF keeping depth (10-bit → 16-bit) and profile |
| 2026-10-05 | Page decoding | `<img>` → `copyExternalImageToTexture` keeps more than 8 bits and doesn't clip; `createImageBitmap(blob)` and `ImageDecoder` are 8-bit |
| 2026-10-05 | Electron windows | A hidden window has WebGPU and runs rAF; a fully covered window becomes `hidden` and throttles despite `backgroundThrottling: false` |
| 2026-10-05 | F2 gate | See "F2 results": every check passed in the app (e2e) and every target in Electron 44.5.0 and Chrome 154 (bench) |
| 2026-10-05 | f32 composites | `float32-blendable` and `float32-filterable` are on the Metal adapter in both; blending into `rgba32float` works. A 16-bit ramp through an f16 composite exports 21 steps off at worst, through f32 within 1 |
| 2026-10-05 | Pipelines at open | Compiling all 13 of F2’s pipelines before the first picture: cold 48 MP opens' first picture 0.49–1.36 s in Electron; the first picture's 3 first, the rest meanwhile: 0.49–0.57 s |
| 2026-10-06 | F3 gate | See "F3 results": every check passed in the app (e2e) and every target in Electron 44.5.0 and Chrome 154 (bench) |
| 2026-10-06 | F4 gate | See "F4 results": every check passed in the app (e2e) in linear compositing, and every target in Electron 44.5.0 and Chrome 154 (bench) |
| 2026-10-06 | Straight alpha and light | A soft edge of light above white (colour over alpha) exported as a PNG and composited over black missed the app's own render by 44 levels: hence coverage at least the light's brightest channel. 8-bit alpha under ~1% moves faint light up to 7 levels: the gate uses 16 bits |
| 2026-10-06 | Tight GPU budgets (F5) | At 24 MB a 1600 × 1200 photo's export differed from a 2 GB one's, run to run, with every variant (no glow, no mask, no paint): a region's tiles evicted by its own loading and by the screen's. Fixed (`whenResident`); 48 MB then matches bit for bit with 50–800 evictions per export |
| 2026-10-06 | Durable writes, M5 Pro, APFS | A 200 kB file written and renamed: p50 0.22 ms; flushed too: 4.05 ms (libuv's `fsync` is `F_FULLFSYNC` on macOS); flushed with its folder: 8.03 ms (p95 10.1). So a blob upload costs ~8 ms more in the background, and a save (`project.json`, `meta.json`, the checkpoint's link) ~20 ms |
| 2026-10-06 | Selection limiting | Limiting each dab by a pixel's coverage: a pixel half inside the selection ended at 0.998 alpha after a stroke (overlapping dabs); limiting the stroke's result: 0.500 |
