# Camera Raw

Status: researched and planned 2026-10-06; CR0 (the measurements) done. What Théo asked for: Photoshop's
Camera Raw Filter, which he uses to "control the light and colour coming from a picture" and layers a lot, as
**one tool in one window**, not a set of separate effects. Labels as in the [README](README.md#labels).

Scope, decided with Théo (2026-10-06): the light (Light, Effects' presence), the colour (Color, the Color Mixer,
Color Grading), the Curve, Detail and Effects (vignette, grain, glow). **Out**: Profiles, Masking (a layer mask on
a Camera Raw adjustment layer does it the Photoshop way, below), Optics, Geometry, Remove, Red Eye, Crop, HDR,
Calibration.

## The research

### What Camera Raw is

**Verified reference (seen, Photoshop 27.11, Camera Raw 18.7 on Théo's Mac):** Camera Raw is Lightroom's
developing engine; Filter › Camera Raw Filter… (⇧⌘A) runs it on a layer's pixels, as a Smart Filter when the
layer is a Smart Object (otherwise it changes the pixels). Its window, as opened on `samples/photo-1600x1200.jpg`:

- **Title** "Camera Raw 18.7", the file's name, top-right buttons (save, settings, full screen).
- **The image** fills the left, with zoom (Fit, a percentage) and a before/after button below it.
- **The right column**, top to bottom: the **histogram** (RGB overlaid, a clipping triangle in each top corner,
  the R G B readout of the pixel under the pointer); then **Edit** with **Auto**, **B&W** and **HDR** buttons;
  **Profile** (a menu, "Color" for a rendered image, and a browse button); then the sections, each a disclosure
  triangle, a title and an **eye** at the right (hides what the section does):
  - **Light**: Exposure (shown 0.00), Contrast, Highlights, Shadows, Whites, Blacks (0 each).
  - **Color**: White balance (a menu, "As Shot", and an eyedropper), Temperature, Tint, Vibrance, Saturation;
    Temperature's, Tint's, Vibrance's and Saturation's tracks are drawn in their colours (blue to yellow, green
    to magenta, grey to colour).
  - **Effects**: Texture, Clarity, Dehaze, then Vignette, Grain and **Glow**, each of those three with a
    triangle that shows its further controls.
- **A tool strip** at the far right: Edit, Crop, Remove, Masking, Red Eye, Presets, Snapshots, More; then Info,
  Zoom, Hand, the colour sampler and a grid.
- **Cancel** and **OK** at the bottom right. It's modal: Photoshop waits until it's closed.

Screenshots of the window were taken during the research but not kept; the panels below Effects weren't scrolled
to (Théo was using the computer).

**Verified reference (Adobe's manual, and secondary sources for 18.6):** the rest of the Edit column is Curve
(parametric: Highlights, Lights, Darks, Shadows with three split points; point curves for RGB, Red, Green,
Blue), Color Mixer (HSL or Color, eight hues: Red, Orange, Yellow, Green, Aqua, Blue, Purple, Magenta; Point
Color), Color Grading (Shadows, Midtones, Highlights and Global wheels, each hue, saturation, luminance;
Blending, Balance), Detail (Sharpening: Amount, Radius, Detail, Masking; Noise Reduction: Luminance, Detail,
Contrast; Color Noise Reduction: Color, Detail, Smoothness), Optics, Geometry, Calibration. **Glow** arrived in
18.6: Glow (amount), Range (which tones), Spread (how far), Warmth (cool to warm), and a style: **Diffusion** (an
Orton-style softening), **Bloom** (from the brightest areas) or **Halation** (film's red bloom round lights)
([PetaPixel, 2026-09-04](https://petapixel.com/2026/09/04/im-really-digging-adobe-camera-raws-new-glow-effect/)).

**Unverified:** the order of the panels below Effects in 18.7; ranges and defaults below Effects (taken from
Adobe's manual for older versions: Sharpening Amount 0–150, Radius 0.5–3.0 (1.0), Detail 0–100 (25), Masking
0–100 (0); vignette Amount ±100, Midpoint (50), Roundness (0), Feather (50), Highlights (0); grain Amount, Size
(25), Roughness (50); for a rendered image Temperature and Tint are ±100 rather than kelvin). Check each in the
window and record it here.

### How it can be driven

**Measured (2026-10-06):** Camera Raw Filter runs from a script, `executeAction("Adobe Camera Raw Filter",
descriptor, DialogModes.NO)`, with no window, and returns the settings it used (those not at their defaults, plus
`CrVe` "18.7" and process version `PrVN` 6). Its **scripting dictionary** is in the plugin's resources (`Camera
Raw.rsrc`, the `$$$/CRaw/AETE/…` entries): every setting's name, four-letter key and type, e.g. `Exposure2012`
`Ex12` (double), `Contrast2012` `Cr12`, `Highlights2012` `Hi12`, `Shadows2012` `Sh12`, `Whites2012` `Wh12`,
`Blacks2012` `Bk12`, `Texture` `CrTx`, `Clarity2012` `Cl12`, `Dehaze` `Dhze`, `Vibrance` `Vibr`, `Saturation`
`Strt`, `ParametricShadows`… `PC_S PC_D PC_L PC_H PC_1 PC_2 PC_3`, `HueAdjustRed`… `HA_R`…, `SaturationAdjust…`
`SA_…`, `LuminanceAdjust…` `LA_…`, `SplitToneShadowHue` `STSH`, `ColorGradingMidtoneHue` `CgMH`, `ColorGradingBlending`
`CgBl`, `GrainAmount` `GRNA`, `PostCropVignettingAmount` `PCVA`, `ConvertToGrayscale` `CtoG`. A key `XMPp`
takes Camera Raw's settings as **XMP** (`crs:` names, as in a preset), which reaches what the dictionary lacks:
`Glow`, `GlowStyle` (a number: 0 Diffusion, the default; 1 Bloom; 2 Halation; names are ignored), `GlowRange`,
`GlowSpread`, `GlowWarmth`, and the point curve (`ToneCurvePV2012` as an `rdf:Seq` of "x, y"). **Unverified:** the
channel point curves (`ToneCurvePV2012Red`…) given that way change nothing; how to pass them is open.

`scripts/photoshop-probes/camera_raw.py` uses both. Every probe opens its own document and closes it unsaved: no
window, no clicks, nothing to interrupt. 222 runs take about two minutes.

### What's known of how it works

- **Verified reference (the plugin's own names, Camera Raw 18.7's binary):** its stages include
  `cr_laplacian_pyramid`, `cr_laplacian_filter_params` and `cr_stage_laplacian_render_incremental` ("Choosing RPTM
  Pyramid Level"): the **local Laplacian filter** (Paris, Hasinoff and Kautz, 2011, at Adobe) is in it, the
  usual account of how Highlights, Shadows and Clarity work. Dehaze's stages are `DehazeTrMDarkChannel`,
  `DehazeEstimateAirlight1–3` and `DehazeMin…DarkChannel…Radius1–6`: the **dark-channel prior** (He, Sun and Tang,
  2009) at six radii, with an estimated airlight. Noise reduction is `DenoiseCrossBilateral…`; the Glow is
  `cr_stage_glow_bloom`, extracted at a pyramid level ("Glow extract level coarser than bloom level").
- **Verified reference (Adobe's DNG SDK, open source):** the reference code has the exposure ramp
  (`dng_function_exposure_ramp`) and a hue-preserving RGB tone curve (`RefBaselineRGBTone`: the curve on the
  largest and smallest channel, the middle one placed between them in proportion, so a tone curve never turns
  hues).
- **Verified reference (secondary):** Camera Raw works in linear light with ProPhoto RGB's primaries.

### What CR0 measured

Fixtures: `shared/photo/reference/camera-raw-fixtures.json` (`camera_raw.py --fixtures`): for each of 160 runs on
the chart, its grey ramp at 65 levels and 96 patches (24 hues at saturation and value 0.5 and 1); for 13 runs on
the mixed image, a ramp in a black half and the same ramp in a white half. The tests read it, never Photoshop.

1. **Identity. Measured:** at its defaults the filter changes no pixel by more than 1 level (chart, ramps, scene).
2. **Exposure. Measured:** a shift of `ev` in a **tone coordinate** V (stops), not a gain in linear light:
   `out = V⁻¹(V(in) + ev)`. One V, fitted to all six runs (−2 to +2), explains the grey ramp within 0.08 stop RMS.
   V runs from −9.2 at code 1 to +4.5 at 255 (0 at code 118): about one stop per doubling of the code in the
   shadows, and a shoulder at the top, so white stays white when brightening (+1: 240 → 251, 255 → 255) and
   comes down when darkening (−2: 255 → 197). On colours it's applied **hue-preserving, on ProPhoto primaries**:
   RMS 3.4 to 7.7 levels over the patches at ±1, +2 (per channel in sRGB: 14 to 40). What's left is at the gamut
   edge: Camera Raw brings a colour that would leave the document's gamut back towards white, keeping its hue
   (red at +1: (255, 63, 63), where clipping would give (255, 57, 37)).
3. **Which sliders look at more than the pixel. Measured** (`loc-*`, `*-loc-mixed`):
   - *Pointwise*: **Exposure**, **Blacks** (the same ramp gives the same result whatever surrounds it).
   - *Global but adaptive*: **Contrast** and **Whites**. The ramp in the black half and the one in the white half
     come out identical, yet the same ramp on a mid grey, beside black blocks or beside white blocks comes out
     differently (Contrast +100 at code 64: 35, 72, 38). The curve depends on the **whole image's statistics**.
   - *Local*: **Highlights**, **Shadows**, **Clarity**, **Dehaze**: the two ramps of one image differ by up to 58,
     77, 167 and 99 levels.
   - **Texture** did nothing measurable to a smooth ramp (as it should: it acts on fine detail).
4. **Size. Measured:** each local slider on the scene at 768 and at 384 px wide, the larger result reduced to
   the smaller: their effects differ by 0.4 to 1.3 levels on average (Dehaze +100: 5). **The local radii are
   fractions of the image's size**, so a look is the same at any size.
5. **Point curve. Measured:** on the image's 8-bit sRGB values, through its points exactly (128 → 180 gives 180).
6. **Saturation, Vibrance, B&W. Measured:** greys are left exactly as they were.
7. **Glow. Measured:** the three styles differ as described: Halation's change is small and red (around the
   brightest edge only), Bloom's from the bright areas, Diffusion's everywhere.

Seen (the contact sheet of the scene, not kept): Highlights −100 recovers the sky without halos; Shadows +100 opens
the figure without lifting the sky; Clarity +100 brightens edges' outsides and darkens their insides over tens of
pixels, a clear but soft halo; Dehaze +100 deepens the sky's blue and darkens strongly, −100 washes everything
towards white; Vignette −50 darkens the corners round an ellipse; Grain is coarse, luminance-only noise.

**Unverified (CR1 and CR2 work them out against the fixtures):** what Blacks does in V; the statistic Contrast and
Whites adapt to; Temperature and Tint's gains; the Color Mixer's hue bands; Color Grading's luminance weights;
the parametric curve's shape; the order of operations (the `order` runs are in the fixtures).

## Decisions

### 1. One effect, many sections

**Product decision (Théo, 2026-10-06):** Camera Raw is **one effect**, `camera-raw`, whose parameters are grouped
into sections, edited in one window. Not a stack of Exposure, Curves, HSL… effects. Its order of operations is
fixed, as Adobe's is. That's what makes it one tool, and it's also faster: one pass instead of eight.

### 2. A filter and an adjustment layer

**Product decision:** the same definition works as a **filter** (Filter › Camera Raw Filter…, ⇧⌘A: a Smart Filter
on the layer's pixels, Photoshop's way) and as a **Camera Raw adjustment layer** (Layers › New Adjustment
Layer: everything below it). Photoshop has only the filter. Théo layers it, and the adjustment layer is the
better tool for that: opacity, a blend mode and a **layer mask** on each, with Select Subject, the brush and the
selections making the mask. That's Camera Raw's masking done the Photoshop way. Both stay editable for ever:
nothing has to be made a Smart Object first.

Today a definition has one `kind` (`unavailableReason`, `addFilter`, `addAdjustmentLayer` check it). **Proposed:**
`EffectDefinition.kinds?: EffectKind[]` (absent: `[kind]`), read by those three. Rejected: two definitions
sharing their parameters, which would make two types for one look in saved documents and in the assistant's
catalogue.

### 3. The window sits beside the canvas

**Product decision (Théo, 2026-10-06):** Adobe's window takes over the screen with its own preview because it's
modal. Ours is a tall window to the right of the canvas, and **the canvas is the preview**: zoom, pan, compare,
everything at full quality. It doesn't block the editor, like the Layer Style window.

### 4. Match Adobe where it can be measured, its feel elsewhere

**Proposed:** the global sliders (Exposure, Contrast, Whites, Blacks if they're global, Temperature, Tint,
Vibrance, Saturation, the curves, the Color Mixer, Color Grading, vignette) match the measured responses
(fixtures, within 2 levels in 8 bits). The local ones (Highlights, Shadows, Texture, Clarity, Dehaze, Glow)
match their *feel*: the same direction, strength at the same values, no halos. Their maths are Adobe's own and
unpublished; ours are written down here and tested against our reference.

### 5. Settings in Adobe's terms

**Proposed:** the parameters are named as Camera Raw's settings (Exposure2012 → `exposure`, Clarity2012 →
`clarity`, HueAdjustmentRed → `hueRed`…), on Adobe's ranges. The assistant can then work from what it knows of
Camera Raw. Later, an Adobe preset (`.xmp`) could be read straight in (Théo has none saved today, so this waits).

## The document

No new document version: a Camera Raw instance is an `EffectInstance` (`{ id, type: "camera-raw", version,
enabled, params }`) in a layer's `filters` or an adjustment layer's `effect`. A photo made before it opens
unchanged. A photo saved with one and opened by an older build keeps it untouched (F5: newer effects kept).

Its parameters, flat (as every effect's are), each with `group` (its section: the `Placement` the Layer Style
pages already use) and `showIf` where a control depends on another:

| Section | Parameters (default, range) |
| --- | --- |
| Light | `exposure` (0, ±5 stops, 0.01), `contrast`, `highlights`, `shadows`, `whites`, `blacks` (0, ±100) |
| Color | `whiteBalance` (as shot \| custom; the eyedropper sets custom), `temperature`, `tint`, `vibrance`, `saturation` (0, ±100), `treatment` (colour \| black & white: the B&W button) |
| Effects | `texture`, `clarity`, `dehaze` (0, ±100); `vignette` (0, ±100), `vignetteMidpoint` (50), `vignetteRoundness` (0, ±100), `vignetteFeather` (50), `vignetteHighlights` (0), `vignetteStyle` (highlight priority \| colour priority \| paint overlay); `grain` (0, 0–100), `grainSize` (25), `grainRoughness` (50); `glow` (0, 0–100), `glowRange`, `glowSpread`, `glowWarmth`, `glowStyle` (diffusion \| bloom \| halation) |
| Curve | `curveShadows`, `curveDarks`, `curveLights`, `curveHighlights` (0, ±100), `curveSplits` (25, 50, 75), `pointCurve` (a `CurveSet`, the type Curves already uses) |
| Color Mixer | `hue<Colour>`, `saturation<Colour>`, `luminance<Colour>` for Red, Orange, Yellow, Green, Aqua, Blue, Purple, Magenta (0, ±100: 24 numbers) |
| Color Grading | `shadowsHue`, `shadowsSaturation`, `shadowsLuminance`, the same for `midtones`, `highlights` and `global` (hue 0–359, saturation 0–100, luminance ±100); `gradingBlending` (50), `gradingBalance` (0, ±100) |
| Detail | `sharpen` (0, 0–150), `sharpenRadius` (1.0, 0.5–3.0), `sharpenDetail` (25), `sharpenMasking` (0); `noiseReduction` (0), `noiseDetail` (50), `noiseContrast` (0); `colourNoise` (0), `colourNoiseDetail` (50), `colourNoiseSmoothness` (50) |

Defaults are identity; the ranges and defaults marked unverified above are checked in the window (CR1) before
they're frozen, because changing them later changes saved photos (a new `version`). `isIdentity` is every value at its
default, so an untouched Camera Raw costs nothing (ledger A16). `summary` lists the sections that changed
("Light, Color Grading"). The definition's `presets` are the looks below.

## The renderer

### The pipeline

**Proposed order** (checked by the order probe):

1. **Noise reduction** (before anything amplifies the noise): colour noise, a chroma blur guided by luminance;
   luminance noise, edge-aware smoothing.
2. **White balance**: Temperature and Tint as channel gains in linear light (a Bradford adaptation about D65).
3. **Exposure**: a shift in Camera Raw's tone coordinate (CR0 2), hue-preserving on ProPhoto primaries.
4. **Dehaze**.
5. **Tone**: Blacks (pointwise), Contrast and Whites (one curve for the image, from its statistics), Highlights
   and Shadows (local).
6. **Presence**: Texture, Clarity.
7. **Curve**: parametric, then the point curves, applied hue-preserving (`RefBaselineRGBTone`) for RGB, per
   channel for Red, Green and Blue.
8. **Colour**, in linear ProPhoto primaries: the Color Mixer, Color Grading, Vibrance, Saturation; B&W.
9. **Sharpening**.
10. **Vignette**, **Glow**, **Grain**, last, as Adobe's are (they act on the finished picture).
11. **Into gamut**: a colour that would leave [0, 1] is brought back towards white along its hue, as Camera Raw
    does (CR0 2), rather than clipped channel by channel. **Proposed:** only what Camera Raw itself pushed out:
    light above white that was already in the layer passes through, as everywhere in our pipeline.

### Pointwise parts: one pass, from tables

Steps 2, 3, 5's Blacks, Contrast and Whites, 7, 8, the vignette and 11 are per pixel. They run as **one fused
WGSL pass**. Contrast and Whites take the image's statistics as two numbers in the parameters (CR1: fixed, as
for a typical picture; CR2: measured by the reduction below). Their parameters are
turned into **tables on the CPU** (the combined tone curve, a hue-indexed table for the mixer, a
luminance-indexed table for the grading), as Curves already sends its `curveTable`. The kernel and the CPU
reference read the same tables, so they agree by construction, and the kernel stays cheap. That also gets round
the adjustments' 256-byte uniform: about 90 parameters go into the table buffer.

Rejected: baking the whole colour part into one 3D LUT. It's simple, but it loses precision in saturated colours
and can't hold light above white (our pixels are extended linear: rendering.md).

### Local parts: on the document's pyramid

Steps 1, 4, 5 (Highlights and Shadows), 6, 9 and the Glow look at neighbours. **The rule, from the glow (ledger
A26):** every local operator is defined in document pixels on the document's 2^k grids, so the view at any zoom,
a tile, an export and the CPU reference compute the same thing. Its radii are **fractions of the document's
size** (Camera Raw's are of the image's: CR0 4), turned into document pixels, so a look is the same on any
canvas. A reduced view is then close to the settled one
(the refinement after a drag hardly moves anything), and the coarse levels can be cached.

- **Tone (Highlights, Shadows):** a base layer from an edge-aware smoothing of
  log-luminance (a fast local Laplacian, as Camera Raw's own, or a guided filter on the pyramid; CR2 picks by
  measuring halos and cost against the fixtures' local runs). The sliders move the base; the detail rides on top unchanged, so contrast across edges is kept and
  nothing halos.
- **Texture and Clarity:** band-pass detail of that pyramid's fine (Texture) and middle (Clarity) octaves,
  scaled. Clarity's band is edge-aware (the same base), Texture's damped where the picture is smooth.
- **Dehaze:** the dark-channel prior, as Camera Raw's: a haze estimate from each region's darkest channel on the pyramid, an airlight from a **global
  reduction** (the brightest of the haziest), the recovered picture mixed by the slider (negative adds haze). The
  reduction is a new node kind (rendering.md names it as planned).
- **Sharpening:** an unsharp mask at Radius, Detail damping its halos, Masking limiting it to edges.
- **Glow:** our glow's octaves and cache (`glow.ts`, `glow-cache.ts`). The styles are settings of it: Diffusion
  a low threshold and a soft mix, Bloom a high threshold, Halation a red-biased tint close in. Warmth is its tint.

Their contributions are cached by the input's content key and their own parameters (as `glow-cache.ts` does). So
dragging a colour slider re-runs only the fused pass, and dragging Clarity doesn't rebuild the haze estimate.

**Commutes with reduction:** never (nonlinear), so a zoomed-out view refines after an edit (ledger A17). The
pyramid rule keeps that refinement small.

### As an adjustment layer

The pointwise sections work as an adjustment today. **The local sections need adjustments that read
neighbours**: `inputRegion` grows an adjustment node by its `reach`, as it does a filter's. The screen already
keeps the composite below each adjustment (A18), so the local passes read that composite, padded by the reach.
This is CR2's renderer work.

### Histogram and Auto

The **reduction** (CR2) measures the effect's input once per change of it, from a render where the long side is at
most 512 px: the statistics Contrast and Whites adapt to, and Dehaze's airlight. The histogram is of the **whole
picture as it's shown** (the layer as filtered, or the composite at the
adjustment layer), from a render where the long side is at most 1024 px, counted by a compute pass (atomics in
256 bins a channel), read back once per settled frame. Auto (Camera Raw's auto tone) sets Exposure, Contrast,
Highlights, Shadows, Whites and Blacks from those statistics; its exact rules are Adobe's. **Proposed:** ours
places the picture's 0.1% and 99.9% points and its median, and is a single undo step like any slider.

## The interface

### The Camera Raw window

A `FloatingWindow` built as the Layer Style window is (`layer-style/layer-style-window.tsx`):

- **Opening:** Filter › Camera Raw Filter… (⇧⌘A, free today) on the active layer adds a `camera-raw` filter and
  opens the window on it. Layers › New Adjustment Layer › Camera Raw… adds one above the selected layer and
  opens it. A double-click on the filter's row or the adjustment layer's thumbnail opens the window on what's
  there.
- **One gesture:** the window holds a `photoGesture()`. Every slider applies to it, so the canvas updates live.
  **OK** is one undo step (adding the filter included). **Cancel** or Escape leaves nothing; ⌥ turns Cancel into
  Reset. **Preview** off shows the layer without it. An edit made elsewhere ends the gesture, keeping what was
  shown, and the window closes, as Layer Style's does.
- **Where:** a tall window, by default against the right of the canvas and level with it. Resizable in height;
  its sections scroll. It remembers its place and which sections are open (this computer's, not the photo's).

Top to bottom, Adobe's column:

1. **Histogram**, RGB overlaid, with Adobe's two clipping triangles. Clicking one shows clipped shadows in blue
   and clipped highlights in red on the canvas (a canvas overlay, never exported). Below it, the R G B under
   the pointer while it's over the canvas.
2. **Edit | Presets** tabs. Edit has **Auto** and **B&W** in its header.
3. **The sections**, each a header (triangle, title, eye) and its controls: **Light**, **Color**, **Effects**
   (Vignette, Grain and Glow folding their further controls under a triangle, as Adobe's), **Curve**, **Color
   Mixer**, **Color Grading**, **Detail**. The order follows 18.7's, confirmed by CR0. The **eye**, held, shows
   the picture without that section (a draft, not an edit).
4. **Before/after** (a toggle: the canvas shows the layer without Camera Raw while it's on), **Preview**,
   **Cancel**, **OK**.

Sliders behave like Adobe's: a double-click on the thumb or the label resets it; ↑ ↓ in its field nudge by 1 (⇧:
10); Temperature, Tint, Vibrance, Saturation and the Color Mixer's hues have tracks drawn in their colours; ⌥
while dragging Exposure, Whites or Blacks shows only what clips (Adobe's clipping view). White balance's
eyedropper: click a pixel on the canvas that should be neutral.

**Presets** list Camera Raw's looks as rendered swatches of the layer. Hovering one previews it, a click applies it
(one undo step), as the Styles panel does. They're ours: the Color Grade filter's looks (Faded Film, Teal &
Orange, Pink Dream, Cold Night…) redone with Camera Raw's controls, plus the user's own (+: saved on this
computer, as Styles are).

### Controls to build

None of these exists in `src/` yet. Each gets a gallery section:

- **Histogram** (a canvas, `--histogram-*` tokens).
- **Colour wheel** for Color Grading: a hue-and-saturation disc with a draggable dot (with Adobe's modifier
  keys for moving only the hue or only the saturation, checked in CR0), and its luminance slider under it. Adobe shows one large wheel and three small ones (a view
  switch).
- **Color Mixer**: Hue | Saturation | Luminance | All tabs, eight coloured sliders each.
- **Section header** with the eye, and the **coloured slider track** (on `ParamSlider`).
- `CurvesEditor` made generic (today it reads `AdjustmentLayer.effect.params.curves` itself), with the parametric
  curve's region sliders and split handles under it.

### In Properties

Properties shows the same sections (the same components) for a selected Camera Raw filter or adjustment layer;
there each slider drag is its own undo step, as everywhere in Properties. For quick touches without the window.

### Later

The targeted adjustment tool (drag on the canvas to move the curve or the mixer's hue under the pointer), Point
Color, reading Adobe `.xmp` presets.

## The assistant

The existing tools work once the definition exists: `add_filter { type: "camera-raw", preset? }`, `set_filter`,
`add_adjustment`, `set_effect_params`. Each takes a partial set of parameters, so "warmer and more contrast" is
two numbers. Work for the assistant:

- `describeEffects` explains Camera Raw by section, with Adobe's names, so a model's knowledge of Camera Raw
  carries over.
- `checkValue` validates every spec kind used: today it skips curves' and some others' cases.
- Auto: an `auto: true` option on `set_filter` and `set_effect_params` for Camera Raw, so the assistant can ask
  for it as the button does.
- `summary` (what the layer list and `get_layers` show) names the changed sections.

The assistant sees the result with its existing pictures of the photo.

## Phases

Each phase ends with typecheck, tests, the photo e2e, `scripts/photo-sheet.ts` (every section and preset, GPU
against reference) and a look at the sheet.

- **CR0, research (done 2026-10-06).** The probes, run on Théo's Photoshop by script, and their fixtures ("What
  CR0 measured"). Still to read off the window once with Théo: the order of the panels below Effects, and the
  ranges below Effects.
- **CR1, the tool.** The definition (`shared/photo/effects/camera-raw/`: parameters by section, tables, `kinds`),
  the CPU reference (`shared/photo/reference/camera-raw/`), the fused pass (`render/camera-raw.ts`), the filter and
  the adjustment layer. Sections: **Light** (Exposure, Contrast, Whites, Blacks; Contrast and Whites with fixed
  statistics), **Color** (white balance with its eyedropper, Vibrance, Saturation, B&W), **Curve**, **vignette**
  and **grain**. The window (sections, eyes, Preview, before/after, OK as one step), the same sections in
  Properties, ⇧⌘A, the assistant. Fixture tests for every global slider.
- **CR2, the light.** Neighbourhood adjustments in the render plan; the pyramid's tone base; **Highlights,
  Shadows, Texture, Clarity, Dehaze**; the reduction node, and Contrast and Whites adapting to its statistics. Gates: no visible halo on the test pictures (a
  step edge and a backlit portrait at ±100), a reduced view within 2 levels of the settled one, a slider drag
  over 60 fps at fit on a 24 MP photo for the pointwise sections and a settled local edit under a second on 48
  MP (photo-bench).
- **CR3, the colour.** **Color Mixer**, **Color Grading** (the wheels), the **histogram** with clipping, **Auto**,
  **Glow** (Diffusion, Bloom, Halation on our glow), **Presets** with hover previews; the Color Grade filter's
  looks redone as Camera Raw presets.
- **CR4, detail.** **Sharpening** and **colour noise reduction**, then **luminance noise reduction**, the one
  that needs care (cheap versions smear detail): measured against Adobe's on noisy fixtures before it ships.

## Where we differ from Photoshop (so far)

- Ours is also an adjustment layer, with a mask, opacity and a blend mode; Photoshop has only the filter.
- Ours isn't modal: the editor's canvas is its preview, at any zoom, and the rest of the editor stays usable.
- No Smart Object step: a Camera Raw filter is always editable.
- Out of scope: Profiles, Masking (a mask on the adjustment layer instead), Optics, Geometry, Remove, Red Eye,
  Crop, HDR, Calibration, snapshots.
- The local sliders match Adobe's feel, not its pixels (decision 4).
