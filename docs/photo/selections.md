# Selections

The photo suite's selection tools, Photoshop's: the Marquees (M), the Lassos (L), Object Selection, Quick Selection
and the Magic Wand (W), Select Subject, and what's done to a selection (modes, Inverse, Feather, the right-click menu). Researched
2026-10-06; this is what's built and why.

## What Photoshop does

- **Tools in groups.** One button per group in the tool strip, showing the tool used last; a right-click (or a long
  press) lists the group; the key picks the group's tool and Shift + the key steps through it. Marquees: Rectangular,
  Elliptical (M). Lassos: Lasso, Polygonal Lasso, Magnetic Lasso (L). Object Selection, Quick Selection, Magic Wand
  (W).
- **Modes**, in every selection tool's options bar: New, Add, Subtract, Intersect. Shift at the press adds, Alt
  subtracts, both intersect. Shift or Alt pressed after the press constrain instead (a square or circle; from the
  centre).
- **Marquees and Lassos**: Feather (px) and Anti-alias. The Lasso closes its outline back to where it began; the
  Polygonal Lasso clicks corners and closes on a double-click, a click on the first corner or Enter; Backspace takes
  the last corner back, Escape drops it.
- **The Magic Wand**: Sample Size (Point, 3×3 … 101×101 average), Tolerance 0–255 (default 32), Anti-alias,
  Contiguous, Sample All Layers. A low tolerance selects colours very like the one clicked; Contiguous only what's
  joined to it.
- **Quick Selection** (what Théo called the "magic wand brush"): a round brush; paint over part of something and the
  selection grows out to its edges, stroke after stroke. After the first stroke the mode becomes Add on its own, so
  strokes keep adding; Alt subtracts. Its own brush size ([ and ]), Sample All Layers, Auto-Enhance (smoother edges),
  Select Subject.
- **Select Subject** (Select › Subject, and a button in the W tools' options bar): a model finds the photo's main
  subject. Photoshop runs it in the cloud or on the device.
- **Object Selection**: Photoshop's draws a rectangle or a lasso around a thing and a model selects the thing inside.
  Ours is painted instead, as Lightroom's and Camera Raw's Select Objects brush is (Théo's call, 2026-10-07): a big
  round brush paints over the thing in translucent red, and when it's let go the thing is selected.
- **Select menu**: All (⌘A), Deselect (⌘D), Inverse (⇧⌘I), Subject, Modify › Feather (⇧F6).
- **Right-click on the canvas with a selection tool**: Deselect, Select Inverse, Feather…, Select and Mask…, Layer via
  Copy, Layer via Cut, Fill…, Stroke…, and with no selection Select All.

## How it's built

**The selection is a rectangle or a mask** (`PhotoSelection`, `shared/photo/types.ts`; ledger A38, which supersedes
A20's "rectangles only"). A rectangle stays analytic (exact fractional edges, what the GPU's `selection_coverage`
computes); anything else (a lasso, an ellipse, the wand, Quick Selection, Select Subject, any combination, an
inverse) is a `MaskSelection`: 8-bit coverage, Photoshop's selection channel, over its box only. Selections are
immutable and kept in history; `document-history.ts` compares typed arrays by identity, so a gesture's end never
turns megabytes of mask into JSON. The pure maths:

- `selection.ts`: coverage of a pixel, a box, a turned layer's pixel (`layerPixelCoverage`) and a whole surface tile
  (`selectionCoverage`, what the GPU is handed); `combineSelections` (Add keeps the larger coverage, Subtract
  multiplies by what's left, Intersect multiplies; two rectangles intersect as a rectangle); `invertSelection`;
  `trimMask` keeps a mask's box to what's covered (nothing left is no selection).
- `selection-shapes.ts`: outlines filled by the nonzero rule (a loop drawn over itself stays in), anti-aliased with
  four rows of samples a pixel, each crossing exact along its row (without anti-alias, a pixel is in when its centre
  is); the ellipse as an outline of chords under a hundredth of a pixel's sag; Feather as three box blurs (Kovesi's
  widths for a Gaussian of that sigma).
- `selection-outline.ts`: the marching ants follow the edges between pixels covered at least half and the rest,
  traced into loops (pixels meeting at a corner kept apart). The canvas draws them on a 2D canvas of their own (a
  wand's selection can have thousands of edges), stroked white then dashed black, marching.
- `magic-wand.ts`: the largest of the red, green, blue and alpha differences against the colour clicked (averaged
  over Sample Size) decides. Anti-alias is GIMP's falloff: whole up to the tolerance, partly up to 1.5 × it, so the edge
  isn't stair-stepped. Contiguous is a scanline flood, four ways.
- `quick-select.ts`, `graph-cut.ts`, `gmm.ts`: Quick Selection is **Paint Selection** (Liu, Sun and Shum, SIGGRAPH
  2009), the method Photoshop's tool follows. When the brush reaches unselected pixels (the seeds), a graph cut decides
  which unselected pixels join, over the whole photo reduced to about 400 × 400 and then at full detail in a band a
  block wide around that answer's edge (the paper's multilevel banded cut, on two levels): a foreground model (a 4-component Gaussian mixture of the seeds
  and the selected pixels near them), a background model (8 components fitted to 1,200 random unselected pixels, those
  taken since replaced each time), and the paper's contrast term, λ = 60 × exp(−β‖ΔI‖²), β from the window's mean
  squared step. Pixels already selected are fixed foreground, so the selection only grows and leans out from its own
  edge (the paper's frontal pixels); pixels past the band's box are fixed by what they are; and only what's joined to the seeds through new pixels joins (the paper's fluctuation
  removal), so a same-coloured thing elsewhere isn't picked up. Subtracting is the same on what isn't selected. The
  cut is Boykov and Kolmogorov's max-flow with Kolmogorov's timestamp/distance heuristics, tested against every
  labelling of random small grids. It works on the photo reduced until the brush is at most 40 working pixels across
  (`quickLevel`), so a big brush stays quick; the result comes back to the document's pixels read between the
  working ones (its edge as soft as a working pixel; Auto-Enhance smooths it more). The paper's adaptive band
  upsampling, its multi-core cut and its viewport-sized local window when zoomed in aren't built.
- `subject.ts`: Select Subject's model and what's around it (below).
- `sam.ts`: the Object Selection tool's model, SAM 2.1 (below), and its maths: the photo as its input, the strokes as
  its points, which of its masks the stroke meant, a mask as a selection.
- `object-select.ts`: what the strokes painted on a model's grid (`paintedGrid`, which `chooseMask` weighs SAM's
  masks by), and the tests' stand-in for SAM: the part around the strokes (`objectBox`: their bounds grown by a
  quarter), what's unlike its border, and of that the things the strokes cover 30% of, or lie on 15% of themselves,
  or lie on most (`objectProbabilities`). This was the tool's first model, Select Subject's IS-Net shown that part:
  it could only say what stood out there, so a cat lying on a deck came with the deck.
- `pixel-sample.ts`: what the tools look at: the photo as it shows, or the active layer alone (its pixels and filters,
  without its style or blending), rendered by the tab's renderer through the output transform into 8-bit sRGB with
  straight alpha (`PhotoRenderer.samplePixels`), at most 4096 pixels a side (a phone's 12 MP photo is read whole),
  halved as often as a tool needs, kept while the photo doesn't change (`selecting.ts`).

**The GPU** keeps a rectangle's analytic path (`hasSelection` 1). A mask (`hasSelection` 2) is handed over per tile:
the CPU works out the selection's coverage of each tile of the layer's own pixels (`selectionCoverage`, 4 × 4 points a
pixel through a turned layer, exact box coverage through one at a right angle), writes it into an atlas slot, and the
limit kernel mixes a stroke or a fill by it. A mask made from a mask selection is those tiles stored directly
(constant tiles wholly inside, nothing outside). So painting, Fill, Clear, Layer via Copy and Cut, copy, Define
Pattern and masks work with any selection, through the same code as before.

**The tools** are `canvas/select-tools.ts` (the gestures; what's being made shows as ants of its own, the
`selectionDraft`, and becomes one undo step when let go), `selecting.ts` (options, samples, commands, Quick
Selection's session shared with the assistant), `select-commands.tsx` (the Select menu, Feather's window, the model's
download question), `canvas/selection-menu.tsx` (the right-click menu), `tool-groups.ts` and the options bar.

## Select Subject's model

Researched options (2026-10-06):

| Model | Licence | Size (ONNX) | Notes |
| --- | --- | --- | --- |
| IS-Net general use (DIS, Qin et al. ECCV 2022) | Apache-2.0 weights | 176 MB fp32, 88 MB fp16 | Dichotomous segmentation; runs on ONNX Runtime Web's WebGPU (img.ly ships it there: ~100 ms fp16 on WebGPU) |
| BiRefNet lite | MIT | 224 MB fp32, 115 MB fp16 | Better edges, but its upstream ONNX has nodes WebGPU can't compile (a 32-output Split over the 8-storage-buffer limit); only a third party's patched export runs (3.4 s at 1024) |
| BRIA RMBG 1.4 / 2.0 | CC BY-NC | 44–176 MB | Non-commercial: not used |
| U²-Net small | Apache-2.0 | 4.7 MB | Too coarse for a selection |
| SAM family | Apache-2.0 | 40 MB+ | Prompted (points or a box): the Object Selection tool's (below) |

Chosen: **IS-Net general use, fp16** (`imgly/isnet-general-onnx`, `onnx/model_fp16.onnx`, 88,152,708 bytes, SHA-256
`2eb4b5dd…f20`), verified here with ONNX Runtime: input `input` [1, 3, 1024, 1024] float32, planar RGB normalised
(v − 128) / 256; output `output` [1, 1, 1024, 1024], sigmoid probabilities (a test disc came out 0.9999 inside,
0.0004 outside).

- **The server** keeps it (`server/photo/models.ts`): downloaded once per computer into `MODELS_DIR` (as the speech
  model is), its size and checksum checked, only when the user says yes to the question Select Subject asks the first
  time; `GET /api/photo/models/subject` (where it is), `POST …/setup` (download), `GET …/file`.
- **The tab** runs it (`subject-model.ts`) with ONNX Runtime Web: WebGPU, WebAssembly where there's none (its
  `ort-wasm-simd-threaded.asyncify.wasm` handed to Vite by URL). The photo's sample is squeezed to 1024 × 1024 (over
  white where it's transparent), the answer stretched back, values under 0.02 dropped and over 0.98 made whole, and
  read up to the document's pixels. Nothing of the photo leaves the computer.
- **Tests** never download it: `EDITOR_PHOTO_MODELS=stand-in` (the e2e config) makes the server say the model is a
  stand-in, and the tab selects what's unlike the photo's border instead (`standInProbabilities`).

## Object Selection's model

The tool is prompted, which Select Subject's model isn't: the user says which thing. Researched 2026-10-07: SAM 2.1
(Meta, Apache-2.0 weights) is the prompted segmenter with ONNX exports that run in ONNX Runtime Web. onnx-community's
(made for Transformers.js) are two graphs, each with its weights in a file beside it (ONNX's external data): a vision
encoder, `pixel_values` [1, 3, 1024, 1024] to three embeddings (32 × 256², 64 × 128², 256 × 64²), and a prompt
encoder and mask decoder, the embeddings and `input_points` [1, 1, n, 2] (the 1024 square's pixels), `input_labels`
(int64; 1 is the thing) and `input_boxes` [1, 0, 4] to `pred_masks` (three masks' logits, 256²), `iou_scores` and
`object_score_logits`. Chosen: **SAM 2.1 Hiera small, fp16** (`onnx-community/sam2.1-hiera-small-ONNX` at
`a7df49d8`, four files, 92,289,100 bytes: `SAM_FILES`), verified here with ONNX Runtime on a photo of a cat lying on a
deck (which Select Subject took with the deck): the cat alone, ears and all. Tiny (78 MB) was less steady: its best
mask moved between its three outputs and one was ragged.

- **Prompts**: the strokes' points (`samPoints`: along their middles, up to six, each the farthest from those taken
  from the one nearest their middle). A box from the strokes' bounds was tried and dropped: a rough stroke rarely
  reaches a thing's ends, and the box cut the cat's ears off. Points alone let SAM find the whole thing.
- **Which mask** (`chooseMask`): SAM answers three (a part, the thing, the thing and more); the one kept is the best
  its own score rates, weighed by how much of what was painted it holds. An object score under 0 is nothing.
- **The edge** (`samSelection`): SAM's answer is where its logits are over 0. They're read between the 256 grid's
  cells at the sample's size and each pixel covered by its distance inside that line (the logit over its slope), so
  the edge is anti-aliased over a pixel. A sigmoid of the logits also half-selected wide places the model was unsure
  of, all over the photo.
- **The tab** (`object-model.ts`) runs the encoder once per photo (the photo as Select Subject reads it, at most 2048
  a side, squeezed to 1024 × 1024, ImageNet's normalisation) and keeps what it made while the photo doesn't change; a
  press of the brush starts it, so it's often done when the stroke ends. Each stroke is then the decoder's tens of
  milliseconds (measured in Chromium on WebGPU: the first stroke 1.1 s after it was let go, model loading included,
  the next 91 ms). A model of several files is downloaded, checked and served file by file
  (`/api/photo/models/object/files/<file>`); the tab hands a graph its weights as external data, by the name the
  graph knows them by (`PhotoModelFile.location`).
- **Tests** use the stand-in in `object-select.ts` (above), as Select Subject's do.

## The assistant

`select_rect` (now also an ellipse, a mode, feather), `select_polygon` (the lasso), `select_magic_wand`,
`select_quick` (strokes), `select_object` (strokes over a thing), `select_subject`, `modify_selection` (invert, feather), and `view_photo`'s
`show_selection` (Photoshop's Quick Mask: red over what isn't selected), since the model can't see ants. A selection
is described by its box and how much it covers.

## Where we still differ

- No Magnetic Lasso, Select and Mask (edge refinement, decontaminate
  colours), Color Range, Focus Area, Save/Load Selection, Quick Mask mode, Transform Selection, or moving the
  selection's outline by dragging inside it.
- Quick Selection works on the photo reduced for big brushes, and its first cut on the whole photo reduced: a part
  thinner than a few pixels of that may be missed until a smaller brush paints it.
- The Polygonal Lasso doesn't snap its sides to 45° with Shift, and Alt doesn't switch a Lasso drag to polygonal.
- Select Subject has no cloud or "detailed" mode; hair is as fine as IS-Net at 1024 × 1024 gives.
- Object Selection is painted, not a rectangle or a lasso, and has no Object Finder (Photoshop's hover that outlines
  each thing before a click). Its edge is SAM's (a 256² mask over the photo), so hair and fur aren't picked out yet:
  edge refinement in a band around the outline is next. It reads the whole photo at 1024 × 1024, so a small thing in
  a big photo gets few of SAM's cells.

## Sources

- Liu, Sun, Shum, [Paint Selection](https://www.microsoft.com/en-us/research/wp-content/uploads/2009/08/PaintSelection_SIGGRAPH09.pdf), SIGGRAPH 2009 (and GIMP's [Paint Select](https://developer.gimp.org/core/algorithm/paint-select/), built on it).
- Boykov, Kolmogorov, An Experimental Comparison of Min-Cut/Max-Flow Algorithms for Energy Minimization in Vision, PAMI 2004.
- Rother, Kolmogorov, Blake, GrabCut, SIGGRAPH 2004 (the mixtures).
- Adobe, [Magic Wand tool](https://helpx.adobe.com/photoshop/using/tool-techniques/magic-wand-tool.html); Photoshop Essentials, [The Magic Wand Tool](https://www.photoshopessentials.com/basics/magic-wand-tool/).
- Qin et al., Highly Accurate Dichotomous Image Segmentation (IS-Net), ECCV 2022; [imgly/isnet-general-onnx](https://huggingface.co/imgly/isnet-general-onnx); img.ly, [Browser background removal using ONNX Runtime WebGPU](https://img.ly/blog/browser-background-removal-using-onnx-runtime-webgpu/).
- [onnx-community/BiRefNet_lite-ONNX](https://huggingface.co/onnx-community/BiRefNet_lite-ONNX), [birefnet-lite-1024-webgpu](https://huggingface.co/jiabins0303/birefnet-lite-1024-webgpu) (why not BiRefNet yet).
- ONNX Runtime, [Deploying ONNX Runtime Web](https://onnxruntime.ai/docs/tutorials/web/deploy.html) (Vite and `wasmPaths`).
