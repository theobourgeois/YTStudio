# Layer Style and Blending Options: research and plan

Status: researched and planned 2026-10-06, after F3; measured in Photoshop 27.11 the same day. **L1 (Blending
Options) and L2 (seven effects) are built** (2026-10-06): see [L1 as built](#l1-as-built) and
[L2 as built](#l2-as-built). Decision 1 was taken as proposed (Photoshop's
compositing for new photos, A28 and A29 in the ledger); decision 4 as built: the window doesn't block the view, and an
edit elsewhere while it's open ends it (keeping what it showed). L2 onwards are still the plan.

What Théo asked for: Photoshop's **Blending Options**. Right-click a layer › Blending Options… opens the Layer Style
dialog, with every section of it (Bevel & Emboss, Stroke, Inner Shadow, the glows, Satin, the overlays, Drop
Shadow). The Layers panel gets a **blend-mode menu that previews each mode on the canvas while the pointer is over
it**.

![The Layer Style dialog on Blending Options, with its blend-mode list open](img/dialog-blend-mode-list.png)
*Théo's screenshot: Photoshop's Layer Style dialog, Blending Options, with the Blend Mode list open.*

## The research

Each document records what Photoshop does (controls, ranges, defaults, PSD keys, the maths as far as it's known), with
screenshots, and ends with implementation notes and open questions. Claims are labelled Verified (Adobe or source
code), Secondary (tutorials, forums, third-party renderers calibrated against Photoshop) or Inferred. Then
[photoshop-measurements.md](photoshop-measurements.md) **measured** the key ones in Théo's Photoshop 27.11 (blend
modes, Fill, the glow and shadow falloffs, contours, strokes, every bevel technique, the dialog's pages and the
live preview); where they disagree, the measurement wins.

| Document | Covers |
| --- | --- |
| [photoshop-measurements.md](photoshop-measurements.md) | **Measured in Photoshop 27.11**: every mode's formula, Fill and Opacity, the matte model behind shadows and glows, contour interpolation and the 30 preset contours, strokes, Chisel bevels, the dialog's pages and the hover preview, the stored keys |
| [dialog.md](dialog.md) | The dialog and the workflow around it: opening it, the list, multiple instances, the drawing order, Global Light, contours, the Layers panel's fx list, copy/paste, Styles, PSD storage |
| [blend-modes.md](blend-modes.md) | General Blending: all 27 modes with formulas (and where Photoshop departs from W3C and from its own help), opacity, the hover preview, encoded vs linear blending |
| [advanced-blending.md](advanced-blending.md) | Fill and the "special eight", Channels, Knockout, the five checkboxes, Blend If, one layer's full compositing order |
| [shadows-and-glows.md](shadows-and-glows.md) | Drop Shadow, Inner Shadow, Outer Glow, Inner Glow: spread/choke, Softer vs Precise, contours, range, noise, jitter |
| [stroke-satin-overlays.md](stroke-satin-overlays.md) | Stroke (distance bands, fill types), Satin, Color / Gradient / Pattern Overlay, gradient methods |
| [bevel-emboss.md](bevel-emboss.md) | Bevel & Emboss with Contour and Texture: the height field, the lighting model, styles and techniques |

### What the research says, in short

- **Most of it is a function of the layer's alpha.** Shadows, glows, strokes, satin and bevels are all derived from
  the layer's coverage (after its mask), never its colours: a matte, grown or shrunk, softened by a blur or a distance
  ramp, remapped through a contour, coloured and blended with the effect's own mode and opacity
  ([shadows-and-glows.md](shadows-and-glows.md#the-short-version)).
- **The drawing order is fixed**, bottom to top: Drop Shadow, Outer Glow, *the content at its Fill*, Pattern Overlay,
  Gradient Overlay, Color Overlay, Satin, Inner Glow, Inner Shadow, Stroke, Bevel & Emboss. Only instances of one
  type reorder among themselves (Stroke, Inner Shadow, Color Overlay, Gradient Overlay and Drop Shadow allow up to 10
  each) ([dialog.md](dialog.md#the-drawing-order)).
- **Two worlds, chosen by alpha.** Photoshop behaves as if it composited "inside" (backdrop, the content at its Fill,
  the interior effects) and "outside" (backdrop, the shadow and glow) and then mixed them by the layer's alpha, then
  applied Opacity. That explains Fill 0% still showing inner effects, and Layer Knocks Out Drop Shadow.
- **Fill and Opacity differ in eight modes** (Color Burn, Linear Burn, Color Dodge, Linear Dodge, Vivid Light, Linear
  Light, Hard Mix, Difference): Fill pulls the colour towards the mode's neutral before the blend; Opacity fades after.
- **Photoshop blends in encoded (gamma) values, mode, opacity and effects alike** (measured: 50% white over black is
  128, not 188; a 35% black Multiply shadow over grey 128 is 83, not 104). In linear light Overlay's 50% grey stops
  being neutral and the dodges and burns land elsewhere. This is [decision 1](#1-colour-space-of-blending).
- **Some of Photoshop's help is wrong** (measured): Soft Light is W3C's formula (the "Photoshop" one Wikipedia gives
  is 17 levels off), Darker/Lighter Color compare luminance not channel sums, and Hard Mix's tie at exactly 1 goes
  white only over a backdrop above half.
- **Known well enough to reproduce** (measured): every blend mode within 0–2 levels (the component modes within 7),
  Fill and the special eight, the shadows' and glows' falloff (Softer is two box blurs of width Size, Precise a
  straight ramp, Spread a share of Size), contours (natural cubic splines broken at corners; all 30 presets' points
  from Photoshop's own files), strokes (a Euclidean band), the shadow's angle, Classic gradients; Smooth bevels (an
  independent rebuild matched Photoshop's renders within 1–3 levels) and Chisel Hard (one flat facet Size wide).
- **Not known yet**: Chisel Soft's exact distance, Satin's exact model (fixtures kept), Noise and Jitter's patterns,
  gradient Methods other than Classic, Shape Burst's direction, Pattern Snap/Link, factory defaults, 16-bit.
  [photoshop-measurements.md](photoshop-measurements.md#still-open) lists them.

## Where this sits in our renderer

The photo suite renders **the view**, not tiles, with one evaluator for screen, thumbnails, merges, exports and the
assistant ([rendering.md](../rendering.md#the-render-plan-and-invalidation)):

- `compileRender` (`shared/photo/render-plan.ts`) turns the document into nodes: images and pixel layers (each with
  its mask), and adjustments. Each node has a key; `prefixKeys[i]` keys the composite after node i.
- `Compositor.evaluate` (`src/suites/photo/render/compositor.ts`) draws a **run of layers in one render pass with the
  GPU's fixed-function source-over**, and runs each adjustment as a pass reading one buffer and writing the other.
- The screen keeps composites below adjustments and resumes from them (A18); below 100%, a plan that doesn't commute
  with reduction is refined at level 0 over regions and reduced (A17).

What this feature needs that isn't there:

1. **A blend pass.** WebGPU can't read the target while drawing to it, and every mode but Normal needs the backdrop.
   A blended layer is drawn alone into a layer buffer, then a pass reads the backdrop and the layer and writes the
   other buffer: the adjustments' ping-pong, with a second input.
2. **Layer effects that read neighbours.** A layer's matte has to be rendered over the view grown by the effect's
   reach (an apron), then blurred, distance-transformed and shaded, then composited inside and outside.
3. **Non-commuting nodes.** Blend modes, Blend If, distance bands and bevels aren't linear, so reduced views refine at
   level 0, as Curves does. Refinement regions grow by the plan's reach as well as Mitchell's halo.

Everything else (masks, pixel layers, the publication gate, gestures, windows) is already there.

## Decisions for Théo

### 1. Colour space of blending

Photoshop evaluates each mode and mixes the result **in the document's encoded values** (gamma). Our foundations
composite Normal **in linear light** (rendering.md, "Operation domains"; product.md question 3, open until now).

| Option | Blend modes' formulas | Mixing (opacity, soft edges, effects) | Looks like Photoshop? | Cost |
| --- | --- | --- | --- | --- |
| **A. Photoshop's** | Encoded | Encoded, for every layer, Normal too | Yes: measured, every mode and opacity on encoded values | Every partly transparent layer needs a shader pass, not fixed-function (an extra full-view pass each) |
| **B. Hybrid** (GIMP's split) | Encoded | Linear | Opaque areas yes; soft edges, opacity and effects lighter (a 35% shadow: 0.82 of the backdrop vs 0.65) | Only blended and styled layers need the pass |
| **C. Linear** | Linear | Linear | No: Overlay, dodges, burns and lights change badly | Same as B |

**Proposed: A, as a versioned document setting** (`compositing: "photoshop" | "linear"`, Photoshop's by default for new
photos; "linear" is Photoshop's own "Blend RGB Colors Using Gamma 1.00", but per document). Light-adding effects
(F4's glow and flare) keep adding in linear light whatever the setting: they're effects with their own domain, not
layer blending. Existing documents (version ≤ 3) open as "linear", so nothing already made changes look.

### 2. Layer styles and F4's glow

F4 planned "glow as a layer effect", with `effects: EffectInstance[]` on layers. Photoshop has two different
things here: **layer styles** (fx: derived from the layer's alpha, drawn around and over it, the subject of this
plan) and **Smart Filters** (they process the layer's pixels: a bloom-style glow is one). Outer Glow is a style;
F4's glow, which thresholds the layer's light and blurs it, is a filter.

**Proposed:** keep them apart in the document: `style` (this plan) and, for F4, `filters` (renamed from the planned
`effects`), applied to the content before its mask and before the style. And **build the shared machinery once**:
this plan's phase L2 makes the apron, the block evaluation, the separable blurs and the "no seams, tiled matches
monolithic" gate that F4's glow also needs. Suggested order: **L1 (blending), then L2, then F4** on top of L2's
machinery, then L3 and L4. The other way round works too; it's a question of which Théo wants first.

### 3. Options that need what we don't have yet

Knockout, Blend Clipped Layers as Group, Pass Through, Vector Mask Hides Effects and groups' styles need groups,
clipping masks or vector masks, none of which exist. **Proposed:** not shown until those exist (ux.md: a control that
doesn't work isn't shown), with their research kept here. Pattern Overlay, a stroke's pattern fill and Bevel's
Texture need **patterns**, a resource of their own (L4).

### 4. The dialog is a window, not a modal

Photoshop's dialog is modal (only zoom and pan work, plus dragging the shadow or gradient on the canvas).
**Proposed:** one of the platform's windows (as Export is), keeping its keys, not blocking the view: zoom, pan and the
on-canvas drags for its page work; other edits wait until OK or Cancel (the store refuses them while its gesture is
open, saying why), because the whole dialog is one gesture.

### 5. Smaller ones

- **Hide All Effects**: Photoshop saves it in the file. Proposed: the same (`style.enabled`), since the Layers panel's
  "Effects" eye is the same switch per layer.
- **Make Default / Reset to Default**: this computer's photo preferences (`preferences.ts`), never the document.
- **Fidelity bar**: we match Photoshop's 8-bit sRGB renders within 2 levels where the maths is known, and say where
  we don't. A missing algorithm (Chisel) ships only once fixtures pin it.

## The document (version 4)

All new fields are absent at their defaults, as the music suite's are, so a plain layer stays as it is.
`normalizePhotoProject` validates each one (repairing to the default and reporting), and a version-3 document is a
valid version-4 one.

```ts
// shared/photo/types.ts
interface LayerBase {
  // ...id, name, visible, opacity, mask
  /** Absent: normal. Adjustment layers too (their result blended with what's below). */
  blend?: BlendMode;
  /** 0..1, absent 1. Fades the content and interior effects, not the exterior ones. */
  fill?: number;
  /** Blending Options' advanced part; absent when every option is at its default. */
  blending?: BlendingOptions;
  /** Layer effects (fx); image and pixel layers (later text, shapes, groups). */
  style?: LayerStyle;
}

type BlendMode = "normal" | "dissolve" | "darken" | "multiply" | "color-burn" | "linear-burn" | "darker-color"
  | "lighten" | "screen" | "color-dodge" | "linear-dodge" | "lighter-color" | "overlay" | "soft-light"
  | "hard-light" | "vivid-light" | "linear-light" | "pin-light" | "hard-mix" | "difference" | "exclusion"
  | "subtract" | "divide" | "hue" | "saturation" | "color" | "luminosity";

interface BlendingOptions {
  channels?: { r: boolean; g: boolean; b: boolean };
  /** Four ranges, as Photoshop keeps them: [black low, black high, white low, white high] on 0..255. */
  blendIf?: Record<"gray" | "red" | "green" | "blue", { layer: Range4; underlying: Range4 }>;
  interiorAsGroup?: boolean;       // Blend Interior Effects as Group
  transparencyShapes?: boolean;    // Transparency Shapes Layer, absent true
  maskHidesEffects?: boolean;      // Layer Mask Hides Effects
  // Later, with groups and clipping: knockout, clippedAsGroup, vectorMaskHidesEffects.
}

interface LayerStyle {
  /** The layer's "Effects" eye (Photoshop's masterFXSwitch). */
  enabled: boolean;
  /** Kept in drawing order (`orderStyleEffects`); several only of the five types that allow it, at most 10. */
  effects: StyleEffect[];
}

/** An `EffectInstance` whose type is a style definition: "drop-shadow", "inner-shadow", "outer-glow",
 *  "inner-glow", "bevel-emboss", "satin", "color-overlay", "gradient-overlay", "pattern-overlay", "stroke". */
type StyleEffect = EffectInstance;

interface PhotoProject {
  // ...
  /** Global Light (Layer › Layer Style › Global Light), absent { angle: 120, altitude: 30 }. */
  globalLight?: { angle: number; altitude: number };
  /** Decision 1. Absent: "linear" (documents before version 4); new photos are made "photoshop". */
  compositing?: "photoshop" | "linear";
}
```

Effect parameters reuse `EffectInstance` (ledger A13 meant this). New parameter kinds join `shared/photo/effects/params.ts`:
`colour` ("#rrggbb"), `angle` (degrees), `contour` (`{ preset } | { points: [x, y, corner][] }` on 0..255), `gradient`
(stops, opacity stops, midpoints, smoothness, method), `pattern` (a surface id, L4), and `blend` (a mode). Sizes and
distances are document pixels; Photoshop's percentages (Spread, Choke, Range, Depth) stay percentages, as it shows them.

## The renderer

### Blending (L1)

- **Layers stay fast when plain.** A Normal layer with no style, Fill 1, every channel and no Blend If keeps the
  fixed-function run (in "linear" documents; in "photoshop" ones a partly transparent layer takes the blend pass).
- **The blend pass**, one WGSL shader specialised per mode: read the backdrop and the layer (premultiplied linear),
  unpremultiply (guarded), encode with the sRGB curve in f32 when the mode's domain is encoded, compute `B(b, s, fill)`,
  apply Blend If's gate, channels and Fill, mix (`s' = (1 − αb)·s + αb·B`, then source-over at `shape · g · opacity`),
  decode, premultiply, `round_for_store`. Dissolve thresholds alpha with the output dither's u32 hash of document
  pixels, salted by the layer.
- **Adjustment layers' modes**: their pass already reads what's below; the mode blends the adjusted picture with it.
- **CPU reference** (`shared/photo/reference/blend.ts`): every mode, Fill, Blend If and channels, tested against the
  psd-tools measurements (3 440 samples of Photoshop 2026) and our own Photoshop probes; the GPU tested against it.
- **Keys and resuming**: blend, fill and blending go in the node's key. The screen keeps a composite below a blended
  layer as it does below an adjustment, so **hovering modes re-runs only that layer and what's above it**.
- **Reduced views**: a mode applied to averaged pixels isn't the average of the mode, so every mode but Normal (and
  Normal itself in "photoshop" documents, which mix encoded values) declares `commutes: false`: the settled view below
  100% is level 0 reduced (A17).

### Effects (L2, L3)

Per styled layer, as one sub-plan (keys per stage, so dragging a colour never re-blurs):

1. **Matte**: the layer's alpha after its mask (or before, with Layer Mask Hides Effects), rendered at the evaluation's
   level over the view grown by the style's reach (`r16float`). One matte serves every effect of the layer.
2. **Fields**, cached by the matte's key and their own parameters:
   - **Tent blur** (Softer, Smooth bevels, Satin): two box passes per axis in compute with running sums, O(1) per pixel
     whatever the Size.
   - **Distance field** (Spread/Choke, Precise, Stroke, Chisel): an exact separable EDT (Felzenszwalb–Huttenlocher) seeded
     sub-pixel from alpha (`0.5 − α`), capped at Size + 2. Jump flooding is the fallback if the EDT is too slow; both
     tested against a CPU reference.
   - **Height field** (bevels): `r32float` (f16 quantises a Size-250 slope's normals by ~12%).
3. **Shade**, pointwise: contour and range through a 4096-entry LUT texture, gradients through a 1-D LUT made in
   TypeScript (Perceptual in OKLab, Linear, Classic), noise hashed in document pixels with the effect's id, the bevel's
   lighting from Global Light.
4. **Composite**, one pass: the two worlds (outside: backdrop, Drop Shadow, Outer Glow; inside: backdrop, content at
   Fill, overlays, Satin, Inner Glow, Inner Shadow, Stroke, Bevel), mixed by the layer's alpha, then Opacity and the
   layer's mode, each effect in its own mode and the document's compositing space.

- **Reach**: each definition states it (Drop Shadow: Size + Distance; Outer Glow: Size; Stroke: Size; Bevel: Size +
  Soften + 3); the plan grows the layer's bounds and the refinement's regions by it. A 250-px Size is a 760-px apron
  around a 2048-px region at most: about 1.5× the work, never cropped.
- **Zoom**: everything is in document pixels. During a gesture, evaluate at the view's level with sizes scaled (and the
  "Refining…" state); the settled view and exports are level 0, reduced. Fixtures compare the two.
- **Merging and exports** render through the same evaluator, so a merged layer bakes its style in, as Photoshop's Merge
  does, and exports need nothing new.

## The interface

### Layers panel

- **Above the rows**, Photoshop's: the blend-mode menu, Opacity, Fill. The menu lists Photoshop's 27 modes in its six
  groups. **Hover previews**: opening the menu begins a gesture, the pointer over a mode (or the arrow keys) applies it
  live, choosing ends the gesture (one undo step), leaving with Escape or a click outside cancels it. On several
  selected layers it sets them all. ⇧+ / ⇧− cycle the mode, ⇧⌥ + letter picks one (checked against the app's keys).
- **On a row**: an fx badge, and an arrow that shows the layer's effects underneath (Photoshop's list), each with an eye,
  and an "Effects" row whose eye is `style.enabled`. Double-click an effect: the dialog on its page. Double-click the
  row's empty part: the dialog on Blending Options.
- **The Layers menu** (right-click): Blending Options…, Copy Layer Style, Paste Layer Style, Clear Layer Style, Hide /
  Show All Effects. **The fx button** at the panel's foot opens the same list as Photoshop's.
- Dragging an effect (or "Effects") onto another layer moves it; ⌥ copies.

### The Layer Style window

A platform window on the photo desktop, ~800 × 600, laid out as Photoshop's: the list on the left (Blending Options,
then the effects in Photoshop's order with their checkboxes and +, ↑ ↓ and trash at the foot), the page in the middle,
OK / Cancel (⌥: Reset) / Preview and the style's swatch on the right.

- **One gesture**: opening begins `photoGesture()`; every control applies to it (live on the canvas, nothing in
  undo); OK ends it ("Layer Style", one step); Cancel or Escape cancels it, Global Light included. Preview off draws the
  gesture's base for that layer without touching the document.
- **On the canvas while it's open**: dragging moves Drop / Inner Shadow and Satin (distance and angle), Gradient Overlay
  and Pattern Overlay (their offset), on the page that's showing.
- **Shared controls** to build, each with a gallery section: the angle dial; the light dial (angle and altitude);
  the contour picker (12 presets, saved contours) and Contour Editor (a small window over the dialog, its own gesture,
  reusing Curves' graph); the gradient picker and Gradient Editor (L2); Blend If's split sliders (⌥ splits a handle);
  colours through the platform's `ColorPicker`.
- **Make Default / Reset to Default** on each page, from the photo preferences.

## The assistant

At parity, as every feature: `set_layer_blending` (mode, opacity, fill, channels, Blend If, the advanced options),
`set_layer_style` (add, update, remove or move an instance, enable or hide), `set_global_light`, `copy_layer_style`
(from one layer to others). Pure edits in `tool-edits.ts`, tested; `describe` lists each layer's mode, fill and effects
in drawing order; the catalogue lists the modes and every effect's parameters.

## Phases

Each phase ends with a complete workflow, its gate and its docs updated (as F0–F3 did).

### L1: blending

The document's version 4 fields for blending (`blend`, `fill`, `blending`, `compositing`); the blend pass with all 27
modes, Fill and the special eight, Channels, Blend If, Transparency Shapes Layer; adjustment layers' modes; the Layers
panel's mode menu with hover preview, Opacity and Fill; the Layer Style window with its Blending Options page only (the
effects' rows appear as they're built); the right-click and double-click ways in; the assistant's `set_layer_blending`.

**Gate**: every mode matches the CPU reference on the GPU, and the reference matches the psd-tools measurements within
1.5/255; a grey Overlay layer changes nothing in a "photoshop" document; Cancel restores the document exactly; hovering
re-runs only the layer and above (counted); an unedited 8-bit export is still bit-exact; the e2e right-clicks a layer,
opens Blending Options, hovers modes and cancels.

### L1 as built

- `shared/photo/blending.ts`: the 27 modes (Photoshop's order, groups, ⇧⌥ letters), the special eight, a layer's
  blending with its defaults, normalising, `patchBlending`; `reference/blend.ts`: the CPU reference
  (`compositePixel`, `compositeAdjustment`), tested against 1 500 Photoshop samples (`blend-fixtures.json`, exported by
  `scripts/photoshop-probes/export_fixtures.py`); edits `setLayerBlending` (several layers) and `setCompositing`.
- The renderer: `render/blend.ts` (the same steps in WGSL), the blend pass, encoded composites and the decode at the
  end (rendering.md, "Blending (as built, L1)"). The e2e test checks every mode, Fill, Opacity, Blend If, channels
  and linear compositing on the GPU against the reference (2 × 10⁻³).
- The interface: the Layers panel's mode menu (hover previews, Escape puts back), Opacity and Fill; Blending
  Options… (menu, footer fx, double-click past a row's name) opens `layer-style/layer-style-window.tsx`; Blend If's
  bars (`blend-if-slider.tsx`, ⌥ splits a handle); ⇧⌥ letters and ⇧+ / ⇧−; Canvas › Layers mix (compositing). The
  assistant: `set_layer_blending`, `set_canvas`'s `compositing`, blending in `get_photo`.
- Not in L1: Dissolve's speckle isn't Photoshop's own noise (ours, fixed in document pixels); Darker / Lighter Color
  pick differently at near-ties (0.26% of random pairs) and the component modes are within 7 levels.

### L2: the effect machinery and seven effects

Matte, apron, tent blur, distance field, contour LUTs (Contour picker and editor), gradients (picker and editor),
noise, Global Light, the two-world composite; **Color Overlay, Gradient Overlay, Stroke (colour and gradient fills),
Drop Shadow, Inner Shadow, Outer Glow, Inner Glow**; multiple instances; on-canvas drags; the fx list in Layers;
copy / paste / clear style; Layer Mask Hides Effects and Blend Interior Effects as Group; `set_layer_style`,
`set_global_light`, `copy_layer_style`.

**Gate**: no seams between regions for any effect at Size 250; the view at 25% matches level 0 reduced; changing an
effect's colour doesn't recompute its field (counted); fixtures from Photoshop's renders within 2 levels; reopening,
undoing and merging keep every setting.

### L2 as built

- **The document**: a layer's `style` (`{ enabled, effects }`: `EffectInstance`s of the definitions in
  `shared/photo/style/definitions.ts`, Photoshop's factory defaults and units, kept in drawing order, at most 10 of the
  five that allow it) and the document's `globalLight` (120° / 30°); Blending Options' Blend Interior Effects as Group
  and Layer Mask Hides Effects. Adjustment layers have no effects. Contours are Photoshop's 12 presets
  (`style/contours.ts`, read from its own files) and splines; gradients its stops and Classic, Linear and Perceptual
  (`style/gradients.ts`). The edits are `style/style.ts`.
- **The reference** (`reference/style.ts`): a signed distance by an exact Euclidean transform, Softer's two box blurs
  of width Size, Precise's ramp, Spread and Choke as shares of Size, Range, contours, the outer fade, Krita's scattering
  Noise, gradient glows at 1 − c, strokes as distance bands; then the two worlds, mixed by the layer's coverage in the
  compositing's values. Tested against Photoshop's renders (`style-fixtures.json`): every glow falloff within 1
  level, strokes, inner glows within 2, a 35% Multiply shadow over 128 at 83.
- **The GPU** (`render/style.ts`): fields in the layer's own pixels (a level of its pyramid past 3072 px a side),
  kept by content and sizes (`StyleFields`), so moving, zooming or recolouring makes none; a style pass composites
  them. e2e: every effect within 1e-4 of the reference, in either compositing, and a colour change makes no field.
- **The window**: Photoshop's list (checkbox, + for more, ↑ ↓, bin), each effect's page from its specs (the angle
  dial, contour and gradient pickers and editors from `layer-style/controls/`), Make Default / Reset to Default (this
  computer's: `layer-style/defaults.ts`), the shadows and the gradient overlay dragged on the canvas. Layers: the fx
  badge, the effects listed under the layer with their eyes (double-click opens one), the fx menu, Copy / Paste /
  Clear Layer Style, Hide All Effects. The assistant: `set_layer_style`, `set_global_light`, `copy_layer_style`, and
  each layer's effects in `get_photo`.
- **Not yet**: Overprint is stored but draws as without it; Dither and Anti-aliased are stored and change nothing
  (the export dithers already); the Noise pattern is ours (Krita's scatter, seeded in the layer's pixels), not
  Photoshop's; distances are to pixel centres, so a wide stroke's outline is faceted when zoomed far in (exports at
  100% are right; sub-pixel seeds, Gustavson's, would fix it); gradient Method's Smooth and Stripes; the Global Light
  dialog itself (the shadows' dials set it).

### L3: Bevel & Emboss and Satin

Inner and Outer Bevel (Smooth) with Gloss Contour and the Contour sub-page first (measured), then Emboss, Pillow
Emboss and Stroke Emboss, then Chisel Hard and Soft once probes pin them; Satin.

**Gate**: Patchy's MIT Photoshop renders (`photoshop-bevel-*`, `photoshop-emboss-styles`, `photoshop-pillow-emboss`)
within 3 levels; Chisel only with its own fixtures.

### L3 as built

- **The document**: `bevel-emboss` (one a layer: Style, Technique, Depth, Direction, Size, Soften; Angle, Use Global
  Light, Altitude; Gloss Contour; Highlight and Shadow, each a mode, colour and opacity; the Contour page's
  `useContour`, contour and Range) and `satin` (mode, colour, opacity, Angle, Distance, Size, contour, Invert), at
  the factory defaults bevel-emboss.md and stroke-satin-overlays.md give. Satin draws between the overlays and Inner
  Glow, the bevel over everything, Stroke included. With Use Global Light a bevel's altitude is the document's too.
- **The reference** (`reference/style.ts`): the height field (Smooth: the tent of the coverage at the bevel's width;
  the chisels: `chiselShape`, fitted to Photoshop 27.11's renders, see photoshop-measurements.md; Stroke Emboss from
  the strokes' band; Soften a box each way), the light from its slopes (`bevelShade`, Gloss Contour, the Contour at
  Range as `100 / Range` on the slopes), each style's weights (`bevelParts`); Satin's tent read at two opposite
  offsets in whole pixels. `reference/bevel.test.ts` holds every style × technique and Satin to Photoshop's renders:
  within 6 levels (10 for Emboss's and Pillow's Smooth shadows and a Size 40 chisel's inner end), mean under 1.
  `scripts/photoshop-probes/bevel-sheet.ts` draws them side by side ([the sheet](img/l3-bevel-sheet.png)).
- **The GPU**: the height fields and Satin's tent are fields of `StyleFields` (kept as the others are); the style
  pass lights the bevel and draws its highlight then its shadow over the result. e2e: every style and technique,
  Soften, Gloss and Contour curves, Stroke Emboss and Satin within 1e-3 of the reference.
- **The window**: Bevel & Emboss heads the list, its Contour row under it (checkbox and page); Altitude beside the
  angle dial; Satin's page, its offset dragged on the canvas.
- **Not yet**: Texture (L4: patterns); the anti-aliased checkboxes are stored and change nothing; Range with a curved
  contour is our choice (the curve on the height, its slopes × 100 / Range: what a Linear contour measures), not
  measured; Photoshop's one light dial for angle and altitude is a dial and a slider here; Chisel Soft's radial
  streaks on curves aren't Photoshop's exact ones (both come from distances to pixel centres).

### With F4 (light)

Merged after F4 (2026-10-06): F4's filtered and generator layers go through the blend and style passes (`isolated.ts`
`prepare`, then the compositor's), keeping the GPU's own Normal and Add where a linear plan allows it
(`fixedComposite`). In a "photoshop" document light still blends in linear light (`blendsInLinear`; ledger A32), the
blend pass decoding what's below and encoding the result; a generator's blend is any mode now, its `blendSpace` kept.
Layer effects stay on image and pixel layers; their fields are made from the layer's pixels before its filters.

### L4: patterns and styles

Patterns as content-addressed surfaces in the package (a built-in set; Define Pattern from a selection); Pattern
Overlay, a stroke's pattern fill and Bevel's Texture; Styles (New Style…, a Styles panel of presets, applying with ⇧ to
add); Scale Effects.

### After groups and clipping

Pass Through, Knockout (Shallow, Deep), Blend Clipped Layers as Group, Vector Mask Hides Effects, groups' styles.

## Verifying against Photoshop

`scripts/photoshop-probes/` drives Théo's Photoshop (AppleScript's `do javascript`, ExtendScript) and measures what it
renders; [photoshop-measurements.md](photoshop-measurements.md) has the results and how to run them. Each phase's
fixtures come from these probes (renders in `data/photoshop-probes/`, small ones copied into the tests), and a new
open question is a new probe, not a guess. They need Photoshop on the machine, so the tests themselves never run it:
they read the fixtures.

## Where we differ from Photoshop (so far)

- The dialog doesn't block the app's view (decision 4).
- "Linear" compositing is a document setting, not an application one (decision 1).
- No 32-bit document mode: our float pipeline is closer to Photoshop's 16-bit behaviour, unclamped where a mode allows.
- Controls that need groups, clipping, vector masks or patterns wait for them (decision 3).
