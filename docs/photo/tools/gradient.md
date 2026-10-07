# The Gradient tool

Photoshop's Gradient tool (G, grouped with the Paint Bucket): a drag lays a gradient along a line. Since 24.5 a drag
makes a **live gradient**, a Gradient Fill layer edited on the canvas afterwards; **Classic gradient** paints it into
the active layer's pixels or mask, as it always did. Researched 2026-10-06; this is what Photoshop does, what we
build, and where we still differ. Labels as in [the README](../README.md#labels).

## What Photoshop does

**Two modes** (Verified reference: Adobe's "Apply gradient fills", 24.5, May 2023). A menu at the left of the options
bar switches between **Gradient** (the default) and **Classic gradient**, and the choice is remembered.

- **Gradient**: the drag makes a Gradient Fill layer above the selected layer. While dragging, the gradient shows
  live and the line's angle and length follow the pointer. The layer stays editable: its widget on the canvas, its
  Properties. With a selection, the new layer only shows inside it (as any new fill layer: the selection becomes its
  mask; Phlearn shows it, Adobe doesn't say it in so many words).
- **With a Gradient Fill layer selected**, the widget comes back and a new drag **redefines that layer**: "you can go
  back and change the length and angle by clicking and dragging again". To make another, select another layer.
  The options bar's settings apply only to new gradients; an existing one is edited in Properties.
- **Classic gradient** paints pixels into the active layer, limited by the selection (the drag may start and end
  outside it, or outside the canvas). It adds **Mode** (the painting modes: the blend modes plus Behind and Clear),
  **Opacity** and **Transparency** (off: the opacity stops are ignored, the gradient is opaque). Without
  Transparency, a new gradient covers what was there; with it, or with a mode, they build up.
- **On a layer mask**, the gradient goes in as greys: black hides, white reveals. Fading a layer out with a gradient on
  its mask is the commonest use of the tool. 24.5 keeps a gradient on a mask live, but only the latest one, and only
  until the file is closed (Ask Tim Grey, 2024).
- **A Smart Object, type or shape layer** can't take Classic: "Could not use the gradient tool because the smart
  object is not directly editable".

**The widget** (Verified reference: Adobe; Photoshop Essentials; Glen Smith's screenshots): a white line between two
hollow circles, its ends; the gradient's colour stops as circles along the line; a small diamond above the line
between two stops, their midpoint.

- Drag an end to move it (Shift: in 15° steps); drag the line to move the whole gradient.
- Hover just beside the line and a + shows: a click adds a colour stop there.
- Drag a stop along the line to move it, away from the line to remove it; Delete removes the selected one.
- Double-click a stop to pick its colour; a click anywhere else on the canvas deselects the stops.
- Drag a diamond to move the midpoint.
- Right-click: the gradients list (no stop selected) or a colour panel (a stop selected); Alt-click with a stop
  selected samples the image's colour into it.

**Drawing**: Shift constrains the line to multiples of 45° (Adobe's Classic help; Photoshop Essentials says
horizontal or vertical for the live one).

**Types** (Verified reference: Adobe):

| Type | What it does |
| --- | --- |
| Linear | From the start to the end in a straight line; bands at right angles to the line. |
| Radial | In a circle around the start, the line its radius. |
| Angle | "A counterclockwise sweep around the starting point", from the line's direction. |
| Reflected | The linear gradient mirrored on both sides of the start. |
| Diamond | From the start out to a diamond; the end is one of its corners (Unverified: the corner and its turning with the line). |

Past its ends a gradient keeps its end colours (Unverified, but universal).

**The options bar**, in order: tool preset, the mode menu, the gradient picker (a swatch that opens the Gradient
Editor, an arrow that opens the presets), the five type buttons, then in Classic Mode, Opacity, then Reverse, Dither,
(Classic) Transparency, Method.

**Method** (Verified reference: Adobe's "Gradient interpolation", 23.0): **Perceptual** (the default) mixes in OKLab;
**Linear** in linear light; **Classic** in the document's encoded values, eased ("cubic interpolation"). The menu also
offers **Smooth** and **Stripes**, which Adobe's page doesn't describe: Stripes makes hard steps, a two-stop one all
its second colour past the start (Glen Smith's screenshot); Smooth looks like an eased Perceptual (Unverified).

**Presets** (Verified reference): since Photoshop 2020 in groups; **Basics** is Foreground to Background, Foreground to
Transparent, and Black, White. Foreground to Background always follows the current colours. Legacy gradients can be
loaded.

**Dither** (on by default) adds a little noise so the gradient doesn't band. **Reverse** runs it the other way.

**The Gradient Fill layer** (Layer › New Fill Layer › Gradient): Style, Angle, Scale, Reverse, Dither, Align with
Layer, Method, an offset dragged in the image; its Properties show the preset, Style, Angle, Scale, Reverse, Dither,
Type (Solid or Noise), Method, Smoothness and the gradient's stops.

## What we build

**The live gradient is a generator layer**, a Gradient Fill (`shared/photo/effects/gradient.ts`, type
`gradient-fill`), as the Lens Flare is (ledger A27's kind). Its parameters are the tool's: the `gradient` (the Layer
Style's `Gradient`: colour and opacity stops, midpoints, a method; the same picker and Gradient Editor), the type
(`style`), `start` and `end` (document points, handles on the canvas, as the flare's source), `reverse` and
`dither`. It blends as any layer does: Normal, its opacity, mask, blend mode and styles the Layers panel's. Every
pixel is a closed-form function of its document point (`gradientT`: the Gradient Overlay's `gradientPosition` on the
tool's line), so tiles, regions, exports and the reference agree. It's also the catalogue's (Filter menu, Filter
Gallery, `add_generator`'s presets), in Colour: each stock gradient across the canvas.

**The gesture** (`src/suites/photo/toolbox/gradient.tsx`): a drag from start to end (Shift: 45°), the line drawn over
the canvas and the result shown live; a click without a drag does nothing. Releasing commits one undo step; Escape
or losing the pointer drops it. What the drag does:

| The active layer (and target) | Gradient mode | Classic gradient |
| --- | --- | --- |
| A Gradient Fill | Redraws its line (the options bar doesn't change it) | Refused: it isn't pixels (its mask: target it) |
| Its mask targeted (any layer) | Classic into the mask | Classic into the mask |
| A pixel layer | A new Gradient Fill above it | Into its pixels |
| An image (placed) | A new Gradient Fill above it | Asks: a new paint layer, or convert it to pixels (ux.md) |
| An adjustment layer | A new Gradient Fill above it | Into its mask (given one, as the brush does) |
| Another generator | A new Gradient Fill above it | Refused, as a Gradient Fill |
| Nothing selected | A new Gradient Fill on top | Asks for a layer |
| A hidden layer | A new Gradient Fill above it | Refused, saying why |

A new Gradient Fill is named as Photoshop names them ("Gradient Fill 1", 2…), is selected, and with a selection gets
a mask made from it in the same undo step. Product decision: a gradient on a mask is always Classic. Photoshop's
live one on a mask is live only until the file closes; ours is the same pixels, painted now.

**The widget** (with the Gradient tool, the active layer a visible Gradient Fill): its ends as hollow circles (a
colour stop at an end fills its circle), its colour stops as circles on the line in their colours, its midpoints as
diamonds just above the line. An end dragged moves (Shift: 15° steps around the other end); the line dragged moves
the whole gradient; a stop dragged slides along the line (whole percent, as the Gradient Editor's) and dragged more
than 24 px away from it comes off (two stay); a press on the line away from a stop adds one there, in the gradient's
colour at that point; the selected stop's Delete removes it; a double-click on a stop opens the colour picker by it;
a diamond dragged moves its midpoint (5% to 95%). A press elsewhere on the canvas deselects the stop and starts a new
drag (which redraws the layer). Every drag is one undo step, and Escape cancels it. With a type other than Linear
the same line edits it (Radial's radius, Angle's direction).

**Classic** paints with the GPU into the surface's tiles (`render/gradient.ts`'s kernel, `SurfaceImage.paintTiles`):
a stroke whose drafts keep each tile as it was beside it, painted again from that on every pointer move (only the
tiles the selection reaches; all of the layer's without one), so the preview is the result, not an approximation. The
selection then limits it as it limits the brush (it caps the result: ledger A21). Releasing reads the drafts back,
hashes them and commits the new surface (one undo step; the publication gate as any stroke). Why the GPU and not the
CPU: it's the same arithmetic as the generator's (one table, one line function), a 48 MP layer is a few batches of
64 tiles, and nothing is read back until the end. The kernel goes through the layer's transform (each tile texel's
document point), so a moved, scaled or turned layer takes the gradient where it shows. On pixels it mixes as the
photo mixes its layers (`compositePixel`, in encoded values in a Photoshop-compositing photo), at the options bar's
Opacity and Mode (the 27 blend modes, Behind, Clear); on a mask it mixes the gradient's grey (Rec. 601 luma of its
encoded colour, as the brush's `strokeColour`) by its opacity and mode. Transparency off makes it opaque.

**Types**: as Photoshop's table above. Angle sweeps anticlockwise on the screen from the line's direction, its seam
along the line; Diamond's corner is the end, turning with the line. Past the ends, the ends' colours.

**Methods** (`style/gradients.ts`'s `gradientAt`, shared with Layer Style): Perceptual (OKLab, the default), Linear
(linear light), Classic (encoded, the measured ease), and two of ours where Photoshop's are undocumented: **Smooth**
is Perceptual eased by smoothstep between stops (nothing turns a corner at a stop), **Stripes** doesn't mix: each
stretch is the colour and opacity of the stop it ends at, the first stop's before it.

**The table**: the GPU and the reference read the gradient sampled at 4096 points, mixed between neighbours
(`reference/gradient.ts`'s `tableAt`), so they agree to f16's rounding whatever the method; a stripe's edge on a
4096-px gradient is a pixel wide.

**Dither**: a triangular noise of under one 8-bit level, the same at a document pixel wherever it's drawn
(`gradientDither`, the output dither's hash salted apart). Our pipeline is float and every 8-bit output is dithered
already (ledger A09), so a gradient doesn't band either way; Dither is kept for what it does in Photoshop (its pixels
when exported at 16 bits, or painted into an 8-bit-looking flat area).

**The options bar** (this computer's, kept as the brush's: `toolbox/gradient-options.ts`): the mode menu, the
gradient picker (Basics first: Foreground to Background and Foreground to Transparent following the colour swatches,
Black, White; then the stock gradients), the five type buttons, Classic's Mode and Opacity, Reverse, Dither,
Classic's Transparency, and Method.

**Properties** shows a Gradient Fill's parameters from their specs (`panels/params.tsx`): the gradient's picker and
editor, the type, the start and end, Reverse, Dither; its blend (Normal or Add) and the layer's blending above.

**The assistant**: `add_generator` with `type: "gradient-fill"` (a preset, `params`: `gradient`, `style`, `start`,
`end`, `reverse`, `dither`), `set_effect_params` and `move_handle` (`start`, `end`) on it, and `paint_gradient`: a
Classic gradient into a layer's pixels or its mask, within the selection, with a mode and opacity. `get_photo`
describes a Gradient Fill's type, gradient, line and options.

## Where we still differ

- The line is two document points, not Photoshop's Angle, Scale, offset and Align with Layer; a Gradient Fill made in
  Properties isn't fitted to a layer's box. No Noise gradients and no Smoothness (Classic is Photoshop's at 100%).
- Smooth and Stripes are our reading of two undocumented methods; Photoshop's Smooth may differ.
- The widget has no right-click (gradients list, colour panel) or Alt-click sampling, doesn't show opacity stops, and
  Shift doesn't make a new layer over a Gradient Fill: select another layer first.
- A gradient on a mask is never live (Photoshop's is, until the file closes).
- No tool presets, no colour groups of presets (Blues, Pinks…), no Legacy Gradients, no saving a gradient as a preset.
- Classic on a Background layer and on channels doesn't apply here: there's no Background layer, and channels aren't
  editable.
- A live gradient doesn't take the options bar's Mode or Opacity (Photoshop's doesn't either): set the layer's.

## Sources

- Adobe, [Apply gradient fills](https://helpx.adobe.com/photoshop/using/gradients.html) (Wayback, 29 Dec 2024),
  [Apply a gradient fill](https://helpx.adobe.com/photoshop/desktop/adjust-color/color-effects-techniques/apply-gradient-fill.html),
  [Edit a gradient](https://helpx.adobe.com/photoshop/desktop/adjust-color/color-effects-techniques/edit-a-gradient.html),
  [Gradient interpolation](https://helpx.adobe.com/photoshop/using/gradient-interpolation.html),
  [Adjustment and fill layers](https://helpx.adobe.com/photoshop/using/adjustment-fill-layers.html).
- Photoshop Essentials, [How to use live gradients in Photoshop 2023](https://www.photoshopessentials.com/basics/how-to-use-live-gradients-in-photoshop-2023/),
  [How to draw gradients](https://www.photoshopessentials.com/basics/how-to-draw-gradients-with-the-gradient-tool-in-photoshop/).
- Glen Smith, [Classic gradient](https://glensmith.co.uk/photoshop/gradient-classic), [Gradient tool](https://glensmith.co.uk/photoshop/gradient-tool).
- Phlearn, [Add a gradient](https://phlearn.com/tutorial/add-gradient-in-photoshop/), [Change a colour into a gradient](https://phlearn.com/tutorial/change-color-into-gradient-in-photoshop/).
- Tim Grey, [Live gradient with a layer mask](https://asktimgrey.com/2024/07/25/live-gradient-with-layer-mask/).
- Adobe Community: [Are Classic and Linear reversed?](https://community.adobe.com/t5/photoshop-ecosystem-discussions/are-classic-and-linear-gradient-methods-reversed/m-p/12692176),
  [Several issues with the gradient fill tool in 24.5](https://community.adobe.com/t5/photoshop-ecosystem-discussions/several-issues-with-gradient-fill-tool-in-ps-24-5-0/td-p/13877578).
