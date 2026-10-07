# Dodge, Burn and Sponge

The photo suite's toning tools, Photoshop's: Dodge lightens, Burn darkens and Sponge changes saturation where they're
painted (O, and ⇧O through the group). Researched 2026-10-06; this is what's built and why.

## What Photoshop does

- **One group, three tools**, in the strip under the Gradient: Dodge (the darkroom's paddle), Burn (a hand) and Sponge.
  O picks the group's tool, ⇧O steps through it. **Alt held** switches Dodge to Burn and Burn to Dodge for as long as it's
  held (the darkroom habit of a dodge and burn in one hand).
- **They're brushes.** Size and hardness as any brush (`[` and `]`, ⇧ for hardness), the brush's circle as the
  pointer, each tool keeping its own brush. They change the pixels of the layer they're painted on (destructive: the
  usual way is to work on a duplicate, or on a 50% grey layer in Overlay, which these tools can paint too).
- **Dodge and Burn's options bar**: Range, Exposure, the Airbrush toggle, Protect Tones.
  - *Range*: Shadows, Midtones (the default) or Highlights: which tones change. With Shadows a stroke over a whole
    face lightens its dark parts and leaves its highlights almost alone. Photoshop's documentation puts the ranges at
    roughly a third of the scale each (0–85, 85–170, 170–255), but the curves overlap smoothly.
  - *Exposure* (1–100%, default 50%): how strong a stroke is. Advice everywhere is 5–20% and many strokes.
  - *Stroke build-up*: without Airbrush, **a stroke never goes past its Exposure**: scrubbing back and forth while the
    button is held changes nothing more. Each new stroke builds on the last ("the effect only builds each time you
    make a new mouse click"). With **Airbrush**, the effect keeps building while the button is held (still or moving),
    up to the Exposure.
  - *Protect Tones* (CS5, on by default): "minimises clipping in the shadows and highlights, and keeps colours from
    shifting hue". Without it, Photoshop's older tool works on each channel separately: shadows burnt go black, colours
    drift (a burnt orange goes red-brown and saturates), highlights dodged blow out to white. Adobe never published the
    new curves.
- **Sponge's options bar**: Mode (Desaturate, the default, or Saturate), Flow (default 50%), Airbrush, Vibrance.
  - *Flow*: how fast the change builds: **scrubbing over the same place in one stroke keeps adding**, unlike Dodge's
    Exposure (Flow is a rate, Exposure and Opacity a ceiling, as with the Brush's Flow and Opacity).
  - *Vibrance* (on by default): "minimises clipping for fully saturated or desaturated colours": Saturate raises muted
    colours more than strong ones and stops before a channel clips.
  - On a greyscale image (and so on a mask, a grey channel) Sponge changes contrast instead: Saturate moves greys away
    from the middle, Desaturate towards it.
- **What they paint on**: a layer's pixels, or its mask (a grey channel: Dodge lightens it, so reveals more; Burn hides
  more). A Smart Object refuses: it must be rasterised first. An adjustment layer's mask is what's painted. The
  selection limits the strokes.

Formulas: Adobe's are unpublished. GIMP's Dodge/Burn (`gimp:dodge-burn`, written to mimic Photoshop's) is the best
known approximation of the older tool and is what Pixelmator-style tutorials describe: per channel, sRGB-encoded,
`exposure` in 0..1:

| Range | Dodge | Burn |
| --- | --- | --- |
| Shadows | `x + e/3 · (1 − x)` | `c = e/3`: `x < c ? 0 : (x − c) / (1 − c)` |
| Midtones | `x^(1 / (1 + e))` | `x^(1 + e/3)` |
| Highlights | `x · (1 + e/3)` | `x · (1 − e/3)` |

## What we build

### Dodge and Burn

- The tools, keys, Alt switch, the options bar (Range, Exposure, Airbrush, Protect Tones; Photoshop's defaults:
  Midtones, 50%, off, on) and each tool's own brush (size and hardness, kept in this browser as the Brush's are; `[`
  `]` and ⇧ act on the active tool's), with the brush's circle as the pointer.
- **The curves** are GIMP's table above for Protect Tones off, per channel on sRGB-encoded straight colour (Photoshop's
  8-bit RGB values), alpha untouched. Values outside [0, 1] (light brighter than white, out-of-gamut colour) keep
  what's outside: `f(clamp(x)) + (x − clamp(x))`.
- **Protect Tones** (ours, to the brief Adobe gives): the range's curve moves the pixel's *lightness*, not each
  channel, and its colour keeps its chromaticity exactly:
  1. `L` = the straight colour's luminance in linear light (Rec. 709 weights), `ℓ` = `L` sRGB-encoded.
  2. `ℓ' = f(ℓ)`, with the two clipping curves replaced by ones that don't clip: Dodge Highlights `x + e·x²(1 − x)`
     (its strongest change near 2/3, white stays white) and Burn Shadows `x − e·x(1 − x)²` (black stays black, the
     darks deepen without crushing). Both are monotonic for `e ≤ 1`. The others never clip already.
  3. The colour is scaled by `L'/L` in linear light (a black pixel lifted becomes grey). Hue and saturation can't move.
  4. If a channel would pass white, the colour is desaturated towards `L'` just enough to fit: luminance kept,
     nothing clipped, as Photoshop's "minimises clipping".
- **Build-up** is Photoshop's: a stroke accumulates the brush's coverage the way the Brush does
  (`A ← A + k(1 − A)` for each dab's coverage `k`, its hardness falloff), and every pixel shows
  `tone(before the stroke, Exposure × A)`, so a stroke is capped at its Exposure however long it scrubs, and the next
  stroke starts from what this one left. **Airbrush** gives each dab a fraction of that (a single pass reaches about
  half the Exposure) and lays dabs where the pointer rests, 20 a second, so holding still builds to the Exposure.
- **The selection** scales the amount, pixel by pixel (a pixel half inside gets half the Exposure).

### Sponge

- Mode, Flow, Airbrush, Vibrance (Desaturate, 50%, off, on), its own brush.
- On sRGB-encoded straight colour, around the pixel's luma `Y` (Rec. 601, as the mask's grey): the colour's distance
  from `Y` is scaled by `1 − a` (Desaturate) or `1 + a` (Saturate), where `a` is the stroke's amount. With Vibrance,
  Saturate is weighted by how muted the colour is (`1 − s`, `s` HSV saturation) and limited so no channel leaves
  [0, 1]; Desaturate is weighted `(1 + s)/2`, so colours already muted keep some. Without Vibrance, Saturate clips.
- **Flow is a rate**: each dab adds `1 − (1 − Flow)^(spacing / c)` of coverage (spacing 10% of the diameter; `c` the
  brush's mean coverage along a diameter, `h + (1 − h)/2` for hardness `h`), so one pass over a pixel adds about Flow
  with a hard brush or a soft one, and scrubbing the same stroke keeps building to the full change (grey, or
  saturation doubled). Airbrush's dabs use the same law for half the Exposure.
- On a mask: contrast, as Photoshop's on greys (`0.5 + (v − 0.5)(1 ± a)`).

### Targets

`toningTargetOf` (pure, tested), after the Brush's `paintTargetOf`: a pixel layer's pixels; a mask when it's
targeted (Dodge and Burn change its grey with the same curves, Sponge its contrast); an adjustment's mask (made white
if it has none). A **placed image or a generated layer** is never rasterised silently: a press asks to convert it to
pixels (Photoshop's "rasterise first"), or Cancel. "New paint layer" (the Brush's other answer) isn't offered: toning
an empty layer does nothing. A hidden layer refuses, saying why.

### How it's built

- `shared/photo/reference/toning.ts`: the curves, `tonePixel` (premultiplied linear in, out), `spongePixel`, their
  mask versions and the dab rates: the CPU reference, tested (identity at 0, monotonic, the ranges' emphasis, no hue
  shift and no clipping with Protect Tones, greys kept by Sponge, Vibrance never clipping).
- **On the GPU** (`render/brush-effects.ts`, WGSL mirroring the reference: change both): a toning stroke's drafts
  keep, per tile, the tile *before* the stroke (`base`) and the stroke's coverage (`acc`). Each batch of dabs is two
  passes: the Brush's own stamp kernel adds the dabs to `acc` (colour white, source-over), then the **apply** pass
  writes `tone(base, cap × acc × selection)` into the shown draft. So the pixels are always computed from what was
  there before the stroke (no drift, no f16 round trips compounding), the Brush's stamp is reused unchanged, and a
  frame's work is the tiles its dabs touch. Every store rounds to the nearest half (`round_for_store`).
- `SurfaceImage.beginEffect` starts such a stroke; ending, cancelling (Escape), reading back, hashing, uploading and
  one undo step are the Brush's (`StrokeController`'s path).
- The assistant: `tone_area` dodges, burns or sponges a box (feathered, so it blends), the selection or the whole
  layer with a range and an exposure (or a mode and a flow), as one undo step: the stroke's law with its accumulation
  full where the region reaches (`SurfaceImage.effectFill`). A placed image is converted only when the call says
  `convert: true`.

## Where we still differ

- Protect Tones is our own model of Adobe's description, not their curves; with it off we follow GIMP's, the
  published imitation of Photoshop's older tool. Measured against a real Photoshop: not yet (the probes in
  `scripts/photoshop-probes/` could).
- No brush presets, angle, roundness, pen pressure, or Shift-click straight lines (the Brush has none yet either).
- Number keys don't set Exposure or Flow.
- Sponge on a mask is contrast, as Photoshop's on greys; we don't have Grayscale documents.

## Sources

- Adobe, [Dodge and burn images](https://helpx.adobe.com/photoshop/desktop/repair-retouch/adjust-light-tone/dodge-or-burn-image-areas.html),
  [Sponge tool](https://helpx.adobe.com/photoshop/ipad/retouch-and-adjust-images/sponge-tool-ipad.html).
- fstop Training, [The new Dodge and Burn tools](https://fstoptraining.com/dodge-burn-tools/) (Protect Tones against
  the legacy tool); Glen Smith, [Photoshop Dodge Tool and Options Explained](https://glensmith.co.uk/photoshop/dodge-tool);
  Lenscraft, [Photoshop Dodge and Burn tools](https://lenscraft.co.uk/photo-editing-tutorials/tutorial-mastering-the-photoshop-dodge-and-burn-tool/)
  (Airbrush builds up to the Exposure; without it a stroke doesn't).
- KelbyOne, [Flow vs opacity for brushes](https://insider.kelbyone.com/tip-tuesday-flow-vs-opacity-for-brushes/).
- GIMP, [Dodge/Burn](https://docs.gimp.org/2.10/en/gimp-tool-dodge-burn.html) and its `gimpdodgeburn` operation (the
  table); Andy Finnell, [How to implement dodge and burn tools](https://losingfight.com/blog/2007/09/27/how-to-implement-dodge-and-burn-tools/),
  [How to implement a sponge tool](https://losingfight.com/blog/2009/09/16/how-to-implement-a-sponge-tool/).
