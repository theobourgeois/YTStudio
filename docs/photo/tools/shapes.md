# Shapes

The photo suite's shape tools (U): Rectangle (with rounded corners), Ellipse, Line and Arrow, each shape a layer of
its own that stays a vector until it's rasterised. What Théo asked for: "squares, circles, rounded squares, lines,
arrows. Basically an annotation tool I can use, kind of like Excalidraw or Figma", for annotating photos, UI
sketches and wireframes. Researched 2026-10-06; this is what Photoshop, Excalidraw and Figma do, what's built and
why, and where we still differ.

## What Photoshop does

- **Tools.** Rectangle, Ellipse, Triangle, Polygon, Line and Custom Shape share a place in the strip and U (Shift+U
  steps through them). Each has three modes in the options bar: Shape (a shape layer), Path and Pixels. Shape is the
  default and the one that matters here.
- **A shape layer** is a vector path filled and stroked, with live properties: a rectangle stays a rectangle (W, H,
  X, Y, angle, four corner radii) until an edit turns it into a plain path ("This operation will turn a live shape
  into a regular path"). It has a layer's every property (mode, opacity, Fill, mask, layer style, Smart Filters once
  it's a Smart Object); painting on it asks to rasterise it first (Layer › Rasterize › Shape).
- **The options bar**: Fill and Stroke (each none, a colour, a gradient or a pattern), the stroke's width (pt or px),
  its type (a popover: solid, dashed and dotted presets; Align Inside, Center or Outside; Caps Butt, Round or Square;
  Corners Miter, Round or Bevel; More Options: dash and gap in multiples of the width), W and H (linked or not), path
  operations and alignment, the gear (path thickness and colour on screen, constraints), and the Rectangle's corner
  radius. The Line tool has its own Weight (its thickness) and, under the gear, Arrowheads: Start, End, Width (% of
  the weight, 500% is usual), Length (1000%) and Concavity (−50% to 50%: how far the back of the head is swept in).
- **Drawing**: drag from corner to corner. Shift makes a square, a circle, or a line at 0°, 45° or 90°; Alt draws from
  the centre; Space held while dragging moves the shape being drawn. A click without a drag opens Create Rectangle
  (Ellipse, Line…): its width, height, radii and From Center.
- **Editing**: the Properties panel's Live Shape Properties (above), and on the canvas the rectangle's corner widgets
  (circles inside its corners: a drag rounds all four, Alt one). Free Transform (⌘T) or the Move tool scale and turn
  it; the stroke's width stays what it was. The tool stays the shape tool after drawing.
- **Defaults**: the fill is the foreground colour when the shape tool is chosen, the stroke off or 1 px black; the
  last settings are kept.

## What Excalidraw does

- **Tools**: Rectangle (R), Diamond, Ellipse (O), Arrow (A), Line (L), Draw, Text. After a shape is drawn the tool
  goes back to Selection, unless the lock (Q) is on. Shift constrains (squares, circles, 15° steps for lines), Alt
  draws from the centre.
- **Styles** (the panel on the left): Stroke (a colour), Background (a colour or transparent), Fill (hachure,
  cross-hatch, solid), Stroke width (thin, bold, extra bold: 1, 2, 4), Stroke style (solid, dashed, dotted),
  Sloppiness (Architect, Artist, Cartoonist), Edges (sharp, round), Arrowheads (none, arrow, bar, dot, triangle,
  diamond, their outline variants and crow's feet), arrow type (sharp, curved, elbow), Opacity.
- **Rendering** is rough.js (Shi, MIT): every line is drawn twice, each pass a cubic Bézier whose ends and control
  points are offset at random (`maxRandomnessOffset` 2 px × roughness, less on long lines) and bowed from the chord;
  ellipses are points around the curve, jittered and joined by a Catmull-Rom spline that overlaps where it starts;
  hachure fills are parallel lines at −41°, `strokeWidth × 4` apart, each a rough line `strokeWidth / 2` thick.
  Randomness is seeded by the element (`seed`), so an element looks the same every time it's drawn. Excalidraw's
  options: roughness 0, 1 or 2 (scaled down for small shapes), `disableMultiStroke` for dashed and dotted strokes
  (which are `[8, 8 + w]` and `[1.5, 6 + w]`), `preserveVertices` below Cartoonist.
- **Arrows**: an arrowhead is 25 px long (15 for the others) at ±20°, capped at half the last segment, drawn as two
  rough lines meeting at the tip (round caps and joins), and follows the curve's tangent when the arrow bends.
  Dragging an arrow's middle point bends it into a curve.
- **Rounded rectangles**: the corner radius is a quarter of the shorter side, up to 32 px.

## What Figma does

- Rectangle (R), Line (L), Arrow (⇧L), Ellipse (O), Polygon, Star. A click places a 100 × 100 shape; a drag draws one;
  Shift constrains, Alt/Option draws from the centre. The tool goes back to Move after drawing.
- Corner radius handles inside a selected rectangle's corners; strokes Inside, Center or Outside, dashes, and line
  ends (none, round, square, line arrow, triangle arrow, reversed triangle, circle, diamond). Resizing doesn't scale
  the stroke (the Scale tool does).

## What we build

**A shape layer** (`ShapeLayer`, `kind: "shape"`, document version 7) is a geometry and a style, placed by a
`LayerTransform` like an image or a pixel layer:

- `shape`: a rectangle (`radius`, document pixels), an ellipse, or a line (`from`, `to`, a `bend`, and a head at
  each end: none, arrow, triangle, circle, bar, diamond). An arrow is a line with heads; the Arrow tool draws one
  with an arrow at its end.
- `size`: the shape's box in its own pixels (a line's is the box around its ends), and `transform`: where that box
  is. So Move, its handles, Free Transform's scale and turn, arrow nudges, the assistant's `transform_layer` and
  everything else that moves layers moves shapes too. The transform scales the outline, never the stroke, the
  radius or the heads (Photoshop's and Figma's resizing).
- `paint`: fill (a colour or none), stroke (a colour or none), its width, dash (solid, dashed, dotted), alignment
  (inside, centre, outside: closed shapes), cap and join, and Excalidraw's sloppiness (0 precise, 1 Artist, 2
  Cartoonist) with its fill style (solid, hachure, cross-hatch).

**Drawn from the geometry, never stored as pixels.** `shared/photo/shape-drawing.ts` turns a layer into paths in
document pixels (fills and strokes, with clips for inside and outside strokes), `shape-rough.ts` is rough.js's
algorithm (lines, curves, ellipses, hachure) seeded by the layer's id, so the same layer looks the same in every
render. The tab plays those paths on a 2D canvas per tile of 256 pixels (`render/shape-raster.ts`): the renderer
shows a shape layer as a surface whose tiles it makes itself instead of fetching them. So it composites like any
pixel layer: blend modes, opacity, Fill, masks, layer styles, filters, thumbnails, the assistant's pictures,
merges, exports and Rasterize (Convert to Pixels) all see the same pixels. A shape is drawn at document resolution,
as Photoshop shows a shape layer: zoomed past 100% its pixels show, and what's shown is what's exported.

**The tools** (`toolbox/shapes.tsx`):

- **Drag** to draw from corner to corner (a line from end to end). Shift: a square, a circle, a line at a multiple of
  45°. Alt: from the centre. Escape cancels. The new shape is a layer above the active one, named after its kind
  ("Rectangle 2"), selected; the tool stays (Photoshop's way: annotating is drawing several in a row).
- **A click** on nothing makes a default shape there (a fifth of the canvas's shorter side; a line or arrow going
  right from the click), Figma's way rather than Photoshop's dialog: faster for annotating. A click on a shape layer
  selects it instead.
- **With a shape selected**, its handles show: a rectangle's and an ellipse's box handles (resize; Shift keeps the
  proportions, Alt from the centre) and the rectangle's corner-radius handle (Photoshop's widget, inside the
  top-left corner); a line's or an arrow's two ends (Shift: 45° steps) and its middle, which bends it into a curve
  (Excalidraw's). Each drag is one undo step.
- **The options bar**: Fill and Stroke swatches (none, the foreground colour, or a colour of their own), the stroke's
  width, dash, alignment, caps and corners, the rectangle's radius, the line's heads at each end (with a swap), and
  Sloppiness with its fill style. Changing one with shape layers selected restyles them (one undo step; a drag of a
  number is one too), as Photoshop and Excalidraw do; the options are this browser's and kept.
- **Properties** has a Shape section for a shape layer: its kind, W and H in pixels, the same style controls, and
  Rasterize; then Blending and Effects as for any layer.
- **Layers** shows the shape rendered as its thumbnail.

**The assistant**: `add_shape` (a rectangle or ellipse by its box `x, y, width, height`, or a line or arrow `from` A
`to` B, in canvas pixels; colours, width, dash, heads, radius, sloppiness, a name) and `set_shape` (any of it on an
existing shape layer, keeping the rest). `get_photo` describes each shape layer: its kind, its box or ends on the
canvas, and its style. So boxing something or pointing an arrow at it takes one call.

## Decisions

- **A transform, not document geometry.** A shape's geometry is in its own box, placed by the same transform every
  placed layer has: the Move tool, snapping, the transform box, multi-layer moves, `transform_layer` and the canvas
  anchoring need nothing new. Its shape tool handles edit the geometry and bake the scale back into the box (scale
  ±1), so the box's numbers stay the shape's pixel size.
- **The raster is anchored at the document's origin** (its tiles are the document's tile grid, as far right and down
  as the shape reaches): it doesn't depend on the canvas, so merges and Rasterize (which render with a canvas of
  their own) draw it in the same place. A shape's mask is in document pixels, as an adjustment's and a generator's
  are: it doesn't move with the shape.
- **Strokes don't scale** with the transform (Photoshop's, Figma's resizing, Excalidraw's): a box drawn around a face
  keeps its 8 px stroke when it's resized.
- **The tool stays** after drawing (Photoshop's), rather than Excalidraw's return to Selection: the Move tool is V.
- **Colours**: the stroke starts as "the foreground colour" (it follows the tool strip's swatch), the fill as none
  (annotations are outlines); either can be a colour of its own.

## Where we still differ

- No Triangle, Polygon, Custom Shape, Diamond or freehand; no Path or Pixels modes; no path operations (combine,
  subtract) or direct path editing (the Pen and Path Selection tools).
- One corner radius for all four corners (Photoshop has four).
- Fills and strokes are colours only (no gradients or patterns: a layer style's overlays and Stroke do that).
- No Create Rectangle dialog: a click makes a default shape; exact sizes are typed in Properties or given to
  `add_shape`.
- Arrowheads have fixed proportions (no Width, Length or Concavity), sized from the stroke's width; no outline
  variants or crow's feet; arrows bend into one curve, not elbows or several points.
- Space while drawing doesn't move the shape; Excalidraw's tool lock doesn't exist (the tool always stays).
- A shape is clipped at the document's top and left edges (its raster starts there), and its mask stays put when the
  shape moves.
- Zoomed past 100%, a shape shows its pixels (as Photoshop's do); the outline drawn over it while it's selected is
  the vector.

## Sources

- Adobe, [Draw shapes](https://helpx.adobe.com/photoshop/using/drawing-shapes.html), [Work with the Line tool](https://helpx.adobe.com/photoshop/using/line-tool.html), and [Live shape properties](https://helpx.adobe.com/photoshop/using/shape-properties.html).
- KelbyOne, [Where are the arrowheads?](https://insider.kelbyone.com/tip-tuesday-where-are-the-arrowheads/); Adobe Community, [Create and modify arrowheads in the Properties panel](https://community.adobe.com/t5/photoshop-beta-discussions/new-feature-create-and-modify-arrowheads-in-properties-panel/m-p/14572386).
- Excalidraw's source: `packages/element/src/shape.ts` (`generateRoughOptions`, dash arrays, `adjustRoughness`) and `bounds.ts` (`getArrowheadPoints`, sizes and angles).
- rough.js's source: `src/renderer.ts` (`_line`, `_curve`, `_computeEllipsePoints`), `src/generator.ts` (defaults), `src/math.ts` (the seeded random), `src/fillers/scan-line-hachure.ts`.
- Figma, [Shape tools](https://help.figma.com/hc/en-us/articles/360040450133-Shape-tools) and [Stroke properties](https://help.figma.com/hc/en-us/articles/360049283914).
