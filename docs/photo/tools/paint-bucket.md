# The Paint Bucket

Photoshop's Paint Bucket (G, grouped with the Gradient): a click fills the area of similar colour around the point
with the foreground colour or a pattern. Researched 2026-10-06; this is what's built and why. Its sibling, the Magic
Eraser, is [magic-eraser.md](magic-eraser.md); both flood from a click as the Magic Wand does
([selections.md](../selections.md)).

## What Photoshop does

- **A click fills.** The pixels joined to the one clicked whose colour is within Tolerance of it are filled, on the
  active layer. There's no drag: each click is one fill and one history step.
- **The options bar**, left to right: the fill's source (**Foreground** or **Pattern**, with the pattern picker when
  it's Pattern), **Mode**, **Opacity**, **Tolerance**, **Anti-alias**, **Contiguous**, **All Layers**.
  - *Tolerance* 0–255, default 32: how far each channel may be from the colour clicked. 0 fills only that exact
    colour; 255 fills everything. It's the Magic Wand's measure (the bucket has no Sample Size: it reads the pixel).
  - *Anti-alias* softens the fill's edge: pixels a little past the tolerance are filled partly. It's why a fill
    inside anti-aliased line art leaves a light rim against the lines: those pixels are only partly within tolerance
    (Adobe's forums are full of this complaint; the answer is a higher tolerance, or a selection expanded and filled).
  - *Contiguous* (on by default) fills only what's joined to the click; off, that colour everywhere on the layer.
  - *All Layers* (off by default) decides by the picture as it shows, every visible layer merged, but still fills
    only the active layer. Off, it reads the active layer alone.
  - *Mode* is the painting modes: the layer modes (Multiply, Screen, Overlay, Color…) plus **Behind** (paints only
    where the layer is transparent, as if behind what's there) and **Clear** (makes what it fills transparent).
  - *Opacity* 1–100%: how much of the fill goes on (and how much of the layer shows through).
- **The selection limits it**: only what's selected is filled, a soft selection partly. A click outside the
  selection fills nothing.
- **On a transparent layer** with All Layers off, every transparent pixel is the same colour (transparent black), so
  a click on an empty layer fills the whole layer; on a layer with shapes, it fills the transparent area around them
  that's joined to the click. With All Layers on, it fills the shape of what shows below.
- **On a layer mask** (the mask targeted) it fills with the colour's grey: black hides, white reveals.
- **On a Smart Object, type or shape layer** it refuses: "the smart object is not directly editable" (it must be
  rasterised first). Adjustment layers fill their mask.
- Shift-click on the pasteboard fills the pasteboard with the foreground colour (a view setting).

## What we build

`toolbox/paint-bucket.tsx` (the kit: options and the click), `toolbox/flood-actions.ts` (the click's work, shared
with the assistant), `toolbox/fill-options.ts` (its options, kept in this browser as the brush's are),
`toolbox/surface-edit.ts` (a surface's tiles edited on the CPU), and the pure maths in `shared/photo/flood-fill.ts`
(which pixels) and `shared/photo/fill-compose.ts` (what they become).

- **Which pixels**: the Magic Wand's flood (`magic-wand.ts`): the largest of the red, green, blue and alpha
  differences against the pixel clicked decides; Anti-alias is the wand's falloff (whole up to the tolerance, partly
  up to 1.5 ×); Contiguous is its scanline flood, four ways. It reads the same pixels the selection tools read
  (`PhotoRenderer.samplePixels`, 8-bit sRGB): with All Layers the photo as it shows, without it the active layer
  alone, as its own pixels (its mask left out: the bucket reads what the layer is, not what it hides). A photo larger
  than 4096 px a side is read reduced, and the fill's edge comes back to the document's pixels between the reduced
  ones, as the wand's does.
- **The selection**: the flood is intersected with the selection there (soft selections multiply), so a click outside
  it does nothing.
- **What they become** (`composeFill`): each pixel by its coverage (the flood's and the selection's) × Opacity,
  through the mode: Normal mixes towards the colour; the other layer modes are the layer blend reference's
  (`compositePixel`, held to Photoshop's own renders), in the document's compositing (a "photoshop" document blends
  encoded values, as Photoshop does); Dissolve speckles by the layer's own seed; Behind adds the colour under what's
  there; Clear takes coverage away. Pattern fills from the pattern tiled from the canvas's top-left corner, at 100%
  (Photoshop's Paint Bucket pattern isn't scaled, and lines up with the document), a built-in one or the photo's own.
- **Where it goes**: the active layer's pixels, or its mask when the mask is targeted (or it's an adjustment layer:
  a mask is given to it, in the same undo step). A placed image asks first, as the brush does (a new paint layer, or
  Convert to Pixels): it's never rasterised silently. A hidden layer refuses, saying why. On a mask the colour's
  grey fills (a pattern's grey), and the modes act on that grey; Behind and Clear are Normal there (a mask has no
  transparency).
- **How**: on the CPU, not the GPU. The tiles the fill reaches are read from the surface's manifest (the bytes the
  tab holds, or the server's), composed, hashed and uploaded as a new manifest (`surface-edit.ts`): the same
  publication gate as a stroke (`uploads.ts`), one undo step, and the renderer shows the new surface as it shows
  undo. This was chosen over extending `renderer.fillSelection`: the GPU's limit kernel can only mix towards one
  colour, and the modes, Behind, Dissolve and patterns would each have needed WGSL mirroring the CPU reference;
  composing on the CPU uses the reference itself (tested against Photoshop), needs no change to the renderer, and a
  click's fill is a few tiles to a few hundred, done once.
- **The options bar**: Fill (Foreground or Pattern, then the pattern picker), Mode, Opacity, Tolerance, Anti-alias,
  Contiguous, All Layers, with Photoshop's defaults (Foreground, Normal, 100%, 32, on, on, off).
- **The cursor** is a crosshair with a small bucket beside it, the bucket's spout at the point that's read.
- **The assistant**: `bucket_fill` (a point, the colour or pattern, mode, opacity, tolerance, contiguous,
  anti-alias, all layers, the layer and its target).

## Where we still differ

- On a mask, the flood reads the layer's content (or, for an adjustment, the photo), not the mask's own grey as
  Photoshop's does when a channel is targeted.
- No Shift-click on the pasteboard: our pasteboard is the theme's.
- No Lock Transparent Pixels yet (Photoshop's way to fill only what's painted); Behind is its opposite and is here.
- A pattern fills at 100% only (Photoshop's bucket has no scale either; Edit › Fill's Script patterns aren't built).
- A fill is limited to the layer's own pixels: a pixel layer smaller than the canvas isn't grown to hold the fill
  (a new layer, ⇧⌘N, covers the canvas).

## Sources

- Adobe, [Fills and strokes](https://helpx.adobe.com/photoshop-elements/using/fills-strokes.html) (the Paint Bucket's
  options: Paint / Pattern, Opacity, Tolerance, Mode, All Layers, Contiguous, Anti-aliasing) and
  [Painting overview](https://helpx.adobe.com/photoshop-elements/using/painting-overview.html) (Behind and Clear).
- Adobe community, [Why is the paint bucket tool so inept?](https://community.adobe.com/t5/photoshop/why-is-the-paint-bucket-tool-so-inept/m-p/11015160)
  (the rim left inside anti-aliased line art, Tolerance 0 and 255) and
  [Paint bucket filling blank areas](https://community.adobe.com/questions-712/paint-bucket-tool-filling-blank-areas-1057600)
  (a transparent layer fills whole with All Layers off).
- Adobe, [Magic Wand tool](https://helpx.adobe.com/photoshop/using/tool-techniques/magic-wand-tool.html) (Tolerance's
  measure, shared with the bucket).
