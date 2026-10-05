# Foundations: implementation order and gates

Status: revised 2026-10-05 (first proposal 2026-10-03). Nothing is implemented. The capability probes in the
evidence log below were run on 2026-10-05.

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

## F1: the photo suite exists

**Platform first**:
- photo's folders in `server/architecture.test.ts`;
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

## F2: layers and adjustments

- Layers panel: visibility, opacity, order, rename, duplicate, delete.
- Properties panel following the selected layer; exposure and curves adjustment layers.
- `compileRender` with the region and reduction rules, and the view's refinement.
- Assistant: `add_adjustment`, `set_effect_params`, `set_layer` (visibility, opacity, order, name).

**Gate**:
- Identity curves are exact.
- Exposure at level k equals level 0 reduced, within tolerance.
- Curves below 100% refine to the level-0 result.
- A slider drag is one undo step and re-renders only what depends on it (counted).
- A stale render never replaces a newer one (scripted rapid edits).

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

## F4: light

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
| 2026-10-05 | Device limits | A plain `requestDevice()` gets spec defaults (8192 textures, 256 MiB buffers); `requiredLimits` from the adapter gets 16 384 and 4 GB. A lost device needs a new adapter |
| 2026-10-05 | Large readback | 4096² `rgba16float` (128 MiB) copy + map: 25–45 ms (3–5 GB/s); `writeTexture` of raw half-float bits is exact (subnormals, 65 504, −1) |
| 2026-10-05 | sharp gotchas | 16-bit needs `toColourspace("rgb16")`; its 16-bit path drops the profile without converting; TIFF defaults to JPEG compression (8-bit); float raw input is read as 0–65 535; prebuilt HEIC decoding fails (no HEVC) |
| 2026-10-05 | `sips` | HEIC → PNG/TIFF keeping depth (10-bit → 16-bit) and profile |
| 2026-10-05 | Page decoding | `<img>` → `copyExternalImageToTexture` keeps more than 8 bits and doesn't clip; `createImageBitmap(blob)` and `ImageDecoder` are 8-bit |
| 2026-10-05 | Electron windows | A hidden window has WebGPU and runs rAF; a fully covered window becomes `hidden` and throttles despite `backgroundThrottling: false` |
