# The Background Eraser

Photoshop's Background Eraser (in the Eraser group, E, ⇧E through it): a brush that erases only the colour under
its centre, so a background can be painted away around a subject without tracing it. Researched 2026-10-06; this is
what's built and why.

## What Photoshop does

- **The hotspot.** "The background eraser samples the colour in the centre of the brush, also called the hot spot, and
  deletes that colour wherever it appears inside the brush." The pointer is the brush's circle with a small cross at
  its centre: the cross is what's sampled. "It also performs colour extraction at the edges of any foreground
  objects, so colour halos aren't visible if the foreground object is later pasted into another image."
- **Its options bar**:
  - *Sampling*: **Continuous** (the default: samples at every step as it's dragged, so it follows a background that
    changes), **Once** (the colour first clicked, for the whole stroke), **Background Swatch** (the background colour).
  - *Limits*: **Contiguous** (the default: the sampled colour connected to the hotspot, within the brush),
    **Discontiguous** (the sampled colour anywhere under the brush: through gaps, between hairs), **Find Edges**
    (connected, "while better preserving the sharpness of shape edges").
  - *Tolerance* (0–100%, default 50%): low erases colours very like the sample, high a broader range.
  - *Protect Foreground Color*: never erases colours near the foreground colour (pick a subject's colour with the
    eyedropper first).
  - Its brush: size and hardness (`[`, `]`, ⇧), hard by default.
- **What it erases**: a layer's pixels, to transparency. It overrides Lock Transparency. On the Background layer it
  makes a normal layer first; a Smart Object (and a type layer) must be rasterised first. It doesn't paint masks.
- **The edges** it leaves are partly transparent where a pixel's colour is between the subject's and the sample's,
  and those pixels lose the background's colour (the "colour extraction"), so a subject cut from a green screen
  doesn't keep a green rim.

## What we build

- The tool in the Eraser group (E, ⇧E), the options bar (Sampling, Limits, Tolerance, Protect Foreground Color, and
  its own Size and Hardness; Photoshop's defaults: Continuous, Contiguous, 50%, off, hard), kept in this browser. Its
  pointer is Photoshop's: the brush's circle with a crosshair at the hotspot.
- **Matching**, per pixel under a dab, on sRGB-encoded straight colour (0..255, the values Photoshop's tolerance is
  about): `d` is the largest of the red, green and blue differences from the sample (the Magic Wand's measure), `T` the
  Tolerance as levels. A pixel is erased wholly up to `T/2`, then less and less to nothing at `T`: background noise
  goes cleanly and edge pixels, which are a mix, are erased in part. Tolerance 0 erases the exact colour. With Protect
  Foreground Color the same measure against the foreground colour spares what's near it.
- **Limits**: Discontiguous takes the match as it is. Contiguous keeps only what's joined (four ways) to the hotspot
  through matching pixels inside the dab: a scanline flood fill over the dab's window, on the CPU (below). Find Edges
  is Contiguous with a hard threshold at `T` (no partial band) whose flood also stops at pixels on a strong edge (a
  neighbour more than `T/2` away), so a subject's outline stays crisp.
- **Sampling**: Continuous samples the pixel under the hotspot at each dab (a transparent one samples nothing: that
  dab erases nothing); Once keeps the first; Background Swatch is the background colour. Pixels are read as they were
  before the stroke, so going back over erased ground erases by what was there.
- **The stroke** accumulates, per pixel, how much is erased and the background colour taken out, the Brush's way:
  for each dab `w = k · m` (the brush's coverage, its hardness falloff, times the match), and
  `acc ← (B·w, w) + acc·(1 − w)` with `B` the dab's sample in linear light. Dabs every 25% of the diameter
  (Photoshop's spacing for this brush).
- **Colour extraction** (`shared/photo/reference/background-erase.ts`, mirrored in WGSL): a pixel `C` (straight,
  linear light) with alpha `α`, erased by `A` of background `B`, is taken as the mix `C = (1 − A)·F + A·B` and
  solved for its foreground: `F = (C − A·B) / (1 − A)`, kept within [0, max(1, C)]. Its alpha becomes `α(1 − A)`, so
  premultiplied it's simply `α(C − A·B)`, clamped. Pixels wholly erased go to nothing; a soft rim keeps the subject's
  colour without the background's.
- **The selection** limits it as it limits the Brush (it scales `A`).

### How it's built

- `shared/photo/background-eraser.ts` (pure, tested): the options, the match, the floods (contiguous, find edges),
  a dab's contribution over a window and a whole region's (the assistant's).
- **CPU and GPU.** The flood fill needs the pixels on the CPU, and a dab's window is small (a 200 px brush is 40 000
  pixels: under a millisecond to match and flood), so the CPU decides what's erased and the GPU applies it. The
  layer's tiles under the dabs are read back once per stroke, as they were before it (asynchronously: dabs wait in
  order for their tiles), kept as 8-bit encoded colour; the stroke's accumulation lives per tile on the CPU and the
  changed rows are written into an `acc` slot of each draft; the **apply** pass (`render/brush-effects.ts`, the same
  one toning uses, in its erase mode) writes `extract(base, acc × selection)` into the shown tile. A GPU flood (jump
  flooding, or label propagation in workgroup memory) was considered: it needs a pass per step across the window,
  hundreds per dab at pointer rate, against one cheap CPU pass.
- Undo, Escape, readback, hashing and uploading are the Brush's (`SurfaceImage` drafts, `StrokeController`'s path).

### Targets

A pixel layer's pixels. A **placed image or a generated layer** asks to convert it to pixels first (Photoshop's
rasterise question), or Cancel: erasing through the layer's mask wouldn't do the colour extraction, which needs real
pixels. A mask, an adjustment layer and a hidden layer refuse, saying why.

### The assistant

`remove_colour` erases a colour from a pixel layer over the selection, a box or the whole layer: a colour given, or
the one at a point, a tolerance, contiguous (from the point) or everywhere, with the edge colour extraction, as one
undo step. "Remove the white background" is `remove_colour` with the colour at a corner.

## Where we still differ

- The match is ours (the Magic Wand's measure and a soft band); Photoshop's exact falloff isn't published.
- Find Edges is our model of "preserving the sharpness of shape edges".
- No pen pressure, brush angle, roundness or spacing control; Lock Transparency doesn't exist yet to override.
- Very large brushes (thousands of pixels) match on the CPU per dab and get slower; Photoshop's does too.

## Sources

- Adobe, Erase parts of an image (Background Eraser), as quoted in Adobe's community answers:
  [Background eraser won't erase everything within brush circle](https://community.adobe.com/questions-712/background-eraser-won-t-erase-everything-within-brush-circle-even-though-settings-maxed-out-1059638);
  TeachUcomp, [The Background Eraser Tool in Photoshop](https://www.teachucomp.com/?p=10491) (hot spot, colour
  extraction, Lock Transparency).
- Adorama, [How to remove the background of an image in Photoshop](https://www.adorama.com/alc/how-to-remove-the-background-of-an-image-in-photoshop)
  (Limits, Sampling, Protect Foreground); icons8, [Background Eraser tool](https://blog.icons8.com/articles/background-eraser-tool-photoshop/).
- Porter and Duff, Compositing Digital Images (1984), and Smith and Blinn, Blue Screen Matting (1996): solving the
  compositing equation for the foreground once alpha and the background are known.
