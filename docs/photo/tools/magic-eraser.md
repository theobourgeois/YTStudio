# The Magic Eraser

Photoshop's Magic Eraser (E, in the Eraser group with the Eraser and the Background Eraser): a click erases the area
of similar colour around the point to transparency. It's what people reach for to take a white background off a
picture. Researched 2026-10-06; this is what's built and why. It floods as the Paint Bucket does
([paint-bucket.md](paint-bucket.md)).

## What Photoshop does

- **A click erases**: the pixels joined to the one clicked whose colour is within Tolerance of it become
  transparent, on the active layer. One click, one history step.
- **The options bar**: **Tolerance** (0–255, default 32: the Magic Wand's measure), **Anti-alias** (a soft edge:
  pixels a little past the tolerance are erased partly), **Contiguous** (on: only what's joined to the click; off:
  that colour everywhere on the layer), **Sample All Layers** (decide by the picture as it shows, but erase only the
  active layer), **Opacity** (1–100%: how much is erased; 50% leaves half).
- **The Background layer** becomes an ordinary layer (Layer 0) at the first click, so it can hold transparency.
  With Lock Transparent Pixels on, the pixels take the background colour instead of going transparent.
- **A Smart Object, type or shape layer** isn't directly editable: Photoshop asks to rasterise it first.
- **The selection limits it**, as it limits every painting tool.
- **Its edges keep their fringe.** The pixels along the edge of what's erased were part background, part subject
  (anti-aliasing, a lens's softness, JPEG): they're left as they are, so a subject cut off white shows a thin white
  rim (a halo) over anything darker. Photoshop's answers are after the fact: Layer › Matting › Defringe (an edge's
  colour replaced by its neighbours'), Remove White Matte / Remove Black Matte (the edge's colour unmixed from white
  or black), Color Decontaminate in Select and Mask, or a selection contracted first.

## What we build

`toolbox/magic-eraser.tsx` (the kit), `toolbox/flood-actions.ts` (the click's work, shared with the assistant and
the Paint Bucket), `toolbox/fill-options.ts`, `toolbox/surface-edit.ts`, and the pure maths in
`shared/photo/flood-fill.ts` and `shared/photo/fill-compose.ts`.

- **Which pixels**: the Paint Bucket's flood: the Magic Wand's tolerance, falloff and scanline flood, on the pixels
  the selection tools read (the photo as it shows with Sample All Layers, else the active layer's own pixels with its
  mask left out, so a second click decides by the picture, not by what the first one hid). Intersected with the
  selection.
- **Defringe** (on by default, our addition): the edge of what's erased is unmixed from the colour clicked. Each
  pixel just outside the erased area is taken as a mix of the colour clicked and a colour of the subject, and the
  least of the colour clicked that explains it (the "colour to alpha" estimate: the smallest share of it that leaves
  the rest a valid colour) is erased too. The ring grows inwards, up to three pixels, only while that share keeps
  falling (a real soft edge fades into the subject; a subject's flat interior doesn't), so a light subject's interior
  is left whole and only its outermost pixel softens. On a pixel layer what's left of an edge pixel is also
  decontaminated: its colour becomes the subject's, the colour clicked taken out (Photoshop's Remove White Matte,
  for any colour), so no rim shows over anything. It's a toggle, so a hard-edged erase (Photoshop's) is a click away.
- **Where it erases**:
  - **A pixel layer**: its pixels go transparent, each by its coverage × Opacity (and decontaminated, above).
  - **A placed image** (the common case: a picture dropped in with a white background): **through its mask**, never
    by rasterising it. The image is given a mask if it has none (in the same undo step), and what's erased is
    hidden there; the mask becomes the target, so the brush (black hides, white reveals) refines what the click did,
    and Properties can delete the mask to get everything back. The mask is in the image's own pixels
    (`LayerMask`), so the erased area, found in document pixels, is mapped back through the layer's transform and
    covered pixel by pixel (`selectionCoverage`). **This is a deliberate difference from Photoshop**, which asks to
    rasterise a Smart Object: ux.md's rule is that nothing is rasterised silently, and a mask keeps the image whole,
    transformable and undoable. Over a mask the edge can't be decontaminated (only hidden by how much it's
    background), so a faint rim may remain over dark colours; Convert to Pixels first gives the full defringe.
  - **The mask targeted** (any layer): the mask is erased (what's erased is hidden).
  - **An adjustment or generator layer**: its mask, as for an image (an adjustment has no pixels; it decides by the
    photo as it shows).
  - A hidden layer refuses, saying why.
- **How**: as the Paint Bucket: the tiles reached are composed on the CPU from the surface's manifest and committed
  as a new surface, one undo step, through the publication gate (`uploads.ts`).
- **The options bar**: Tolerance, Anti-alias, Contiguous, Sample All Layers, Opacity, Defringe, with Photoshop's
  defaults (32, on, on, off, 100%) and Defringe on.
- **The cursor** is a crosshair with the tool's sparkle beside it.
- **The assistant**: `magic_erase` (a point, tolerance, contiguous, anti-alias, sample all layers, opacity, defringe,
  the layer): "remove the white background" is one call at a corner of the background (more for areas the subject
  encloses, or contiguous: false).

## Where we still differ

- A placed image is erased through its mask instead of being rasterised (above, deliberate).
- Defringe is ours (Photoshop leaves the fringe for Layer › Matting).
- No Background layer or Lock Transparent Pixels: there's nothing to unlock, and no erasing to the background
  colour.
- A photo larger than 4096 px a side is flooded reduced (as the Magic Wand is); the edge comes back soft by one
  reduced pixel.

## Sources

- Adobe, [Erase parts of an image with the Magic Eraser tool](https://helpx.adobe.com/photoshop/using/tool-techniques/magic-eraser-tool.html)
  (Tolerance, Anti-aliased, Contiguous, Sample All Layers, Opacity).
- Adobe community, on the eraser's Background layer becoming Layer 0 and erasing to the background colour with
  locked transparency ([basic eraser tool no longer produces transparency](https://community.adobe.com/t5/photoshop/basic-eraser-tool-no-longer-produces-transparency/m-p/6968856)).
- Defringe, Remove White Matte and Color Decontaminate: [How to Defringe in Photoshop](https://tutvid.com/photoshop/how-to-defringe-in-photoshop-perfect-selection-edges-matte-color/),
  [Fix Undesirable Edges](https://www.oreilly.com/library/view/photoshop-cs4-bible/9780470345177/9780470345177_fix_undesirable_edges.html).
- GIMP's Color to Alpha (the least share of a colour that leaves a valid remainder), the edge estimate Defringe uses.
