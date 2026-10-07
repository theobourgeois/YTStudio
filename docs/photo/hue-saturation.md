# Hue/Saturation

Photoshop's Image › Adjustments › Hue/Saturation… (⌘U), kept editable: one effect, `hue-saturation`, usable as a
filter on a layer (what ⌘U adds) and as an adjustment layer (Layers' New adjustment layer menu), as Camera Raw is
(`EffectDefinition.kinds`).

## Where it is

- **⌘U**, or **Image › Hue/Saturation…** in the header: the window on a new Hue/Saturation filter on the active
  layer. With a Hue/Saturation filter shown in Properties, or a Hue/Saturation adjustment layer selected, that one
  instead. On another adjustment layer (which has no pixels of its own), a new Hue/Saturation adjustment layer above
  it.
- The window is one gesture, as Camera Raw's: the canvas follows every change, OK makes them one undo step, Cancel or
  Escape leaves nothing (a new one is gone), ⌥ turns Cancel into Reset, Preview (P) shows the picture without it.
- **Properties** shows the same controls for a Hue/Saturation filter or adjustment layer (Photoshop shows an
  adjustment layer's there), each change one undo step. Double-clicking its Layers row opens the window.
- The assistant: `add_filter` / `add_adjustment` with `type: "hue-saturation"`, its presets, `set_filter` /
  `set_effect_params`.

## The controls

Preset (Photoshop's names: Cyanotype, Increase Saturation, Old Style, Red Boost, Sepia, Yellow Boost…; the values are
ours, Photoshop doesn't publish its own), Edit (Master or a range: Reds, Yellows, Greens, Cyans, Blues, Magentas),
Hue (−180..180°), Saturation and Lightness (−100..100), Colorize (its own Hue 0..360° and Saturation 0..100, 25 at
first; Lightness is shared), and the two colour bars: every hue as it was, and as it comes out, the range edited lit.

## The maths (`shared/photo/reference/hue-saturation.ts`, mirrored in `src/suites/photo/render/hue-saturation.ts`)

On the sRGB-encoded colour, as Photoshop works:

1. **Hue**: turned round the HSL wheel, its saturation and lightness kept.
2. **Saturation**: positive pushes the channels out from the HSL lightness by `1 / (1 − s) − 1`, reaching full
   saturation at +100 (never past it); negative pulls them in towards it, grey at −100. This is the widely used
   reconstruction of Photoshop's; it hasn't been measured against a real Photoshop yet.
3. **Lightness**: mixed towards white (positive) or black (negative).

A range's settings are added to Master's, weighted by how much the pixel's hue is in the range: Photoshop's default
range widths (full within 15° of its centre, falling to nothing at 45°), so neighbouring ranges cross and the weights
always sum to 1. Close to grey (chroma below 4/255) a hue is mostly noise, so the ranges' settings fade out there; a
grey takes Master's alone. **Colorize** gives each pixel its own HSL lightness with Colorize's hue and saturation, then
Lightness: pure red and pure blue colorize alike, as in Photoshop.

Light above white (or below black) is worked on held to [0, 1], and what was past it is added back unchanged.

`scripts/photo-sheet.ts hue-saturation` holds the GPU to the reference (as a filter, on the photo, the cut-out's
soft edges and light above white) and the adjustment layer to the filter.

## Still to do

- Photoshop's range sliders (dragging a range's width and falloff on the colour bars) and its eyedroppers (pick a
  range from the canvas, add to or take from it).
- The targeted adjustment tool (drag on the canvas to change the colour under the pointer).
- Measure Saturation and Colorize against a real Photoshop (`scripts/photoshop-probes/`).
