# Content-Aware Fill

Photoshop's Content-Aware Fill, kept to its simplest: select something, press ⇧⌫ (or right-click › Content-Aware
Fill), and it's gone, filled from what's around it. Built 2026-10-07; this is what's built and why.

## What Photoshop does

- **Edit › Content-Aware Fill…** opens a workspace (a sampling area painted over the photo, Color/Rotation/Scale
  Adaptation, a live preview, output to the layer, a new layer or a duplicate). **Edit › Fill… (⇧⌫)** with Contents
  set to Content-Aware does it in one step. The **Remove tool** paints over a thing to remove it. Since 2023 its
  fills are made by a model.
- People are told to select generously: the object's edge, halo and shadow, or they come back.

## What we build

One command, everywhere the selection's commands are: **⇧⌫** (Shift+Delete elsewhere), the header's **Edit** menu and
the canvas's right-click menu (each above Fill with Foreground), and the assistant's `content_aware_fill`. No dialog
and no options:

- **It needs a selection.** Without one it says "Select what to remove first".
- **The result is a new pixel layer**, "Content-Aware Fill", right above the active layer, as Photoshop's output to a
  new layer: the photo's own pixels never change, undo is one step, and deleting the layer takes it back. The new
  layer is selected; the selection stays.
- **It reads the active layer and those under it, as they show** (Photoshop's "Current & Below"), so the layers above
  (an adjustment, a text) act on the result once, as they did on what it replaced.
- **The selection grows a little first** (0.3% of the photo's longer side, at least 4 px), so an object's anti-aliased
  edge and halo go too, as the Remove tool does; the fill's edge is soft over a third of that, and whatever was
  selected (a soft selection's edge too) is replaced entirely.
- **Its model asks before it downloads**, as Select Subject's does: the same question (`ModelDialog`), once per
  computer, and the fill runs once it's here.

## How

The model is **LaMa** (big-lama, Suvorov et al., WACV 2022; Apache-2.0), Carve's ONNX export (`lama_fp32.onnx`,
208 MB, opset 17, fixed 512 × 512): input `image` [1, 3, 512, 512] RGB in 0..1 with the hole's pixels 0, `mask`
[1, 1, 512, 512] (1 fills); output `output` [1, 3, 512, 512] RGB in 0..255. Measured on Théo's Mac (Apple M-series,
Metal): 0.35 s a pass on WebGPU after a 4.5 s first load, identical to the CPU's answer to within 0.001; 2.4 s a
pass on WebAssembly.

A model that reads 512 pixels a side can't be handed a 24 MP photo whole: squeezed into 512 × 512 and stretched back,
a person 200 px tall comes back as a smudge (tried on eight photos before building it). So (`shared/photo/inpaint.ts`):

- **Crops.** The hole is split into its parts (16-pixel blocks; touching blocks are one part). Each gets a square crop
  2.2 times its longer side (the hole is under half of it across), **never smaller than 512**, so a small thing is
  filled at the photo's own resolution, and never longer than the canvas's longer side; past the canvas it's
  reflected. Two parts share a crop only if it's at most 25% bigger than the larger one's own: a tree and the sheep
  beside it are filled apart, the sheep at full resolution.
- **In turn.** Crops are filled largest first. Whatever is still to fill is masked out of every crop, so no object is
  ever read as background, and what's been filled shows in the later crops as it will.
- **Back up.** A shrunk crop's answer is read back bicubic, for its own holes only.
- **Grain.** A shrunk crop's fill is as soft as 512 pixels across it; a photo isn't. The photo's grain is measured
  beside the hole at full resolution (four 96-pixel patches, the hole left out; 1.4826 × the median absolute 3 × 3
  high-pass, so edges and texture don't count), and what the fill lacks is added as luminance noise, seeded by the
  crop (the same fill twice is the same).

Colour: the model reads what the screen shows (8-bit sRGB through the output transform, `PhotoRenderer.sampleView`),
and its answer goes back as the layer's linear light the way a colour picked does (`strokeColour`, `surfaceFromSrgb`).
Tiles nothing covers aren't stored.

Where: `shared/photo/inpaint.ts` (the plan, the hole and its edge, the way back; tested), `shared/photo/models.ts`
(every photo model, by name), `server/photo/models.ts` (`/api/photo/models/<name>`: status, setup, file),
`src/suites/photo/models.ts` + `model-dialog.tsx` (running and asking, shared with Select Subject),
`src/suites/photo/content-aware-fill.ts` (the command), `e2e/photo-content-aware.spec.ts`. Tests never download a
model: `EDITOR_PHOTO_MODELS=stand-in` makes the server say both are stand-ins, and the fill is then the mean of
what's around the hole (`standInFill`).

## Where we differ, and what's next

- No workspace: no sampling area, no adaptation sliders, no live preview. The model decides what to sample.
- No prompt: it removes, it doesn't generate something asked for (Photoshop's Generative Fill).
- A hole that's most of the photo is filled from a crop shrunk many times: smooth surfaces (sky, water, snow) hide
  it, fine textures come back softer. The grain helps; texture taken from the photo at full resolution (PatchMatch
  guided by the model's answer) would be the next step.
- The model sometimes keeps an object's shadow: select it too.
- The Remove tool (paint over it) and the Spot Healing Brush would run the same command on a stroke's selection.
