# The Crop tool

The photo suite's Crop tool (C): Photoshop's, for the canvas, and Figma's or Canva's, for one layer. Researched
2026-10-06; this is what Photoshop does, what we build, and where we still differ.

## What Photoshop does

- **The box is there at once.** Choosing the tool puts a crop box over the whole image with eight handles (corners
  and edges). With a selection, the box starts at the selection's bounding rectangle instead. What's outside the box
  is covered by the *crop shield*, the pasteboard's colour at 75% by default (Settings in the options bar: colour,
  opacity, Auto Adjust Opacity). H (or /) hides the cropped area altogether.
- **Dragging.** A drag inside the box moves it; a drag outside it draws a new box (from where it was pressed). The
  handles resize it. Shift on a corner keeps the box's proportions, Alt resizes from its centre, both together do
  both. Just outside a corner, the pointer turns into a curved arrow and a drag rotates the box (straightening); a
  Straighten tool (⌘ held) draws a line that should be level. Arrow keys nudge the box. The box snaps to the
  document's edges (View › Snap To).
- **Two modes.** Since CS6 the box stays put and the image moves under it (with Auto Center Preview on); P toggles
  Classic Mode, in which the box moves over a still image, as before CS6.
- **The overlay** (O cycles): Rule of Thirds by default, then Grid, Diagonal, Triangle, Golden Ratio, Golden Spiral
  (⇧O turns the last two); shown Always, Never, or Auto (while the box is dragged).
- **The options bar**, left to right: the preset menu (Ratio, W × H × Resolution, Original Ratio, 1:1 (Square),
  4:5 (8:10), 5:7, 2:3 (4:6), 16:9, Front Image, then sizes such as 4 × 5 in 300 ppi; New Crop Preset…), the two
  ratio fields with ⇄ between them (X swaps them too: portrait and landscape), Clear, Straighten, the overlay menu,
  the settings gear, **Delete Cropped Pixels**, **Content-Aware**, then ✕ (cancel) and ✓ (commit). I fills the
  fields with the document's own size.
- **Committing.** Enter, ✓, or a double-click inside the box crops; Escape or ✕ cancels. Choosing another tool with
  the box changed asks: Crop, Don't Crop, or Cancel (earlier versions just applied it). After a crop the tool stays,
  with a new box over the whole (new) image. ⌘Z undoes it: one step.
- **Past the canvas.** Dragging a handle beyond the image adds canvas: transparent on layers, the background colour on
  the Background layer, or filled by Content-Aware Fill when Content-Aware is on.
- **Delete Cropped Pixels.** On, what's outside the box is gone. Off, the layers keep their pixels beyond the canvas
  (the Background becomes an ordinary layer), so Move can bring them back and Image › Reveal All grows the canvas
  around them again.
- **Rotation commits by resampling**: the canvas turns and every layer is redrawn rotated.
- **Layers.** Photoshop's Crop tool always crops the canvas. To crop one layer, people mask it, or crop a Smart
  Object's contents, or use the Frame tool. In Figma, Canva and Keynote, cropping an image is part of the image: a
  crop box around it, the hidden part shown dimmed while cropping, and the crop kept so it can be widened again.

## What we build

**Two kinds of crop, chosen by what's selected.** With no layer selected the tool crops the canvas, as Photoshop's.
With an image or pixel layer selected (one), it crops that layer alone, as Figma's and Canva's do. The options bar
says which, as a Canvas | Layer switch (Layer names the layer), so either can be chosen with a layer selected;
picking another layer starts with Layer again. With several layers selected, or an adjustment or generator layer,
it's the canvas.

**Cropping the canvas.**
- The box starts over the canvas, or at the selection's bounds (whole pixels). The crop shield (the stage's colour
  at 75%) covers what's outside it, on the canvas and the pasteboard alike; the box has eight handles; a
  rule-of-thirds grid shows while it's dragged (Photoshop's Auto Show Overlay), and its size shows beside it.
- A drag inside moves the box, a drag outside draws a new one, the handles resize it. Shift keeps its proportions,
  Alt works from its centre. A ratio chosen in the options bar holds every drag to it. The box snaps to the canvas's
  edges and centre (Snap on: the header's magnet; Control: not). It can go past the canvas to grow it.
- Enter, ✓ or a double-click inside crops; Escape or ✕ puts the box back. Box positions are whole document pixels,
  as Photoshop's are.
- **The edit** (`cropCanvas`, `shared/photo/crop.ts`) is one undo step of the document and the selection: the canvas
  takes the box's size and everything placed in document pixels shifts by the box's corner: each image's and pixel
  layer's transform, a generator's handles (a flare's source; one that follows the canvas's centre follows the new
  one), and the selection (clipped to the new canvas). Nothing is resampled and nothing is deleted: layers keep
  their pixels past the canvas (Photoshop's with Delete Cropped Pixels off), so Move brings them back and a larger
  crop shows them again.
- **Masks in document pixels** (adjustment and generator layers'): they're the canvas's surfaces, so they're moved
  by the box's corner too, by whole pixels, exactly (`shiftSurface`, `shared/photo/surface-shift.ts`): a shift by a
  whole number of tiles just renumbers the manifest's tiles; any other one is made from the four tiles under each new
  one, in the tab, hashed and uploaded like a stroke's tiles. Image and pixel layers' masks are in their own pixels
  and follow their transform. Canvas grown past a document mask is the mask's fill (revealed).
- What follows the canvas follows the new one: a kernel filter's centre (a vignette), Align with Layer off (a
  gradient overlay laid out on the canvas), patterns anchored at the document's origin.

**Cropping a layer.**
- The box is drawn around the layer in its own (turned, scaled) frame: its current crop, or the whole layer. While
  cropping, the layer shows whole, its hidden part dimmed under the shield, so a crop can be widened again. Handles,
  Shift, Alt, the ratio and moving the box work as for the canvas, in the layer's own pixels; the box stays inside
  the layer.
- Committing (Enter, ✓, a double-click) sets the layer's **crop**: a rectangle of its own pixels (`crop` on image
  and pixel layers, version 7), one undo step. Clear (or a box over the whole layer) takes the crop off.
- **The crop is non-destructive** and every path sees it: the render plan carries it on the layer's node
  (`DrawNode.crop`), part of its keys, and the compositor's layer pass hides what's outside it (exact, pixel for
  pixel, when the layer lands on whole pixels; an antialiased edge otherwise), before the layer's filters, mask and
  style. So the screen, exports, covers, the assistant's pictures, thumbnails, Convert to pixels and Merge show the
  cropped layer; a filter's blur spreads from the cropped edge; a stroke follows it. The Move tool's box and handles,
  picking (`layerAt`), smart guides and the assistant's description use the cropped box (`croppedPlace`), and scaling
  or turning a cropped layer moves its whole self so the crop stays where it is on it.

**Ours, which Photoshop doesn't have: targeting.** Escape with nothing to commit deselects the layers (back to the
canvas), and so does a click outside every layer (on the pasteboard, or where nothing shows). While a layer is
cropped, a click on another layer crops that one instead. Clicks on the canvas while it's the canvas that's cropped
select nothing, as in Photoshop: a photo filling the canvas would otherwise be picked by every stray click. Nothing
changes target while a crop is pending.

**Switching tools with a crop pending applies it** (with a toast that says so and offers Undo), as Photoshop did before
its question was added: our windows never stop the editor for a question, and the crop is one undo step away.
Holding Space for the Hand keeps it pending.

**The options bar**: Canvas | Layer, the ratio menu (Free, Original, 1:1, 4:5, 9:16, 16:9, 3:2, and the fields:
typing a W × H ratio makes it Custom), ⇄ (or X) to swap its sides, Clear, the box's size in pixels, ✕ and ✓.

**The assistant**: `crop_canvas` (a box in canvas pixels, or a ratio centred on the canvas or the selection) and
`crop_layer` (a box in canvas pixels, taken into the layer's own pixels, or `clear`). `get_photo` describes a layer's
crop (its own pixels and its box on the canvas).

## Where we still differ

- **No rotation or Straighten.** Turning the canvas would resample every document-pixel surface (adjustment masks,
  generator masks), which the document never does silently; a layer can still be turned (the Move tool) before or
  after it's cropped.
- No Classic Mode switch: our box always moves over a still canvas (Photoshop's Classic Mode). No Auto Center Preview.
- No Delete Cropped Pixels (we never delete: Photoshop's with it off), no Content-Aware fill of new canvas, no W × H ×
  Resolution presets, Front Image, saved crop presets, or the other overlays (Grid, Diagonal, Triangle, Golden Ratio,
  Spiral); no O, H, P or I keys; the shield's colour and opacity aren't settings.
- Arrow keys don't nudge the box.
- Switching tools applies a pending crop instead of asking.
- A document mask's part pushed off the canvas by a crop is gone (it was the canvas's size); a larger crop afterwards
  finds it revealed there, where an image's or a pixel layer's pixels come back.
- Layer crops are ours (Photoshop crops layers through masks, Smart Objects or frames). A cropped layer's hidden
  pixels are still its own: painting there, Layer via Copy or Define Pattern may reach them.

## Sources

- Adobe, Crop and straighten photos (Photoshop User Guide); Julieanne Kost, [Essential Tips for Cropping in Photoshop](https://jkost.com/blog/2017/05/essential-tips-for-cropping-in-photoshop-cc.html).
- Photoshop Essentials, [Photoshop Crop Tool Tips and Tricks](https://www.photoshopessentials.com/basics/photoshop-crop-tool-tips-and-tricks/).
- Photoshop Training Channel, [Adjust the Crop Shield's Opacity and Color](https://photoshoptrainingchannel.com/tips/adjust-crop-shields-opacity-color/).
- Planet Photoshop, [Escape From The Crop Tool](https://planetphotoshop.com/escape-from-the-crop-tool-or-die.html) (the question on switching tools).
