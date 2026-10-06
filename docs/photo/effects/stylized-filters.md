# Stylised filters

Status: built 2026-10-06. What Théo asked for: "cool stylised filters" for album covers and edits, the kind of
thing done in Photoshop with blending, Camera Raw grades and a stack of filters. His covers show the vocabulary:
heavy saturated grades and crushed, sharpened, "deep fried" photos (*ytcalling*), purple duotones with glow and
faded film (*bleseed*), mirrored pink-graded photos with grain, glow and soft chromatic fringes (*1day*).

The filters are **kernel filters** (`shared/photo/effects/kernel.ts`): Smart Filters (on a layer's own pixels,
before its mask, editable, in order with the glow) whose result at a document point is a function of the layer's
content there and within a stated reach. That one shape covers colour looks (pointwise), print looks (a cell's
centre), glitches and distortions (displaced reads) and edges (neighbours), and it keeps the photo suite's rules:

- **Document pixels.** Every size, cell and random pattern is anchored to the document, so the screen, export
  regions and refinements compute the same thing (`reach` grows the region a kernel's input is made over).
- **Repeatable.** Nothing depends on time; anything random is a hash of integer document cells and a Seed.
- **One definition, two implementations.** Each filter is a WGSL `effect(p, c)` and a CPU reference with the same
  helpers (`KERNEL_PRELUDE` and `reference/kernel.ts`), held together by `scripts/photo-sheet.ts` (GPU vs reference
  on every look, transparency included) and `reference/filters/filters.test.ts` (Mix 0 is identity, values finite,
  nothing read past the reach, repeatable, every look changes the picture).
- **Colour.** Content is linear light and may be above white. Stylised colour work is done on sRGB-encoded
  colour, as Photoshop's filters are (`enc3`/`from_encoded`), which clips light above white; displacements read
  linear light as it is; light added (a light leak) is added in linear light, with the glow's coverage rule.
- **Mix.** Every kernel filter ends with Mix (Photoshop's Fade), applied by the pass, not by each filter.
- **Reduced views.** None commutes with reduction: a zoomed-out view shows them evaluated at its own level first,
  then refined from level 0, as Curves is. Patterns finer than the view's pixels average out there, as they do in
  the exported picture seen that small.

## The Filter Gallery

Photoshop's Filter Gallery is a dialog with a large preview, the filters as thumbnails by folder, and the chosen
filter's settings beside them; OK applies. Ours (`src/suites/photo/filters.tsx`) follows it:

- Each card is a picture of its look on a **sample scene** (`scripts/photo-filter-scene.ts`, a dusk city drawn as
  SVG: a sun and windows to glow, neon, gradients, hard edges, water, fine texture), rendered once by
  `photo-sheet.ts --thumbnails` into `public/photo-filters/`. Cards are never rendered live: that was eight full
  renders (each building its glow's cache) every time the photo changed.
- **A click previews** the look on the photo itself (the canvas is the large preview): the live renderer shows the
  document with the look (`filterPreview`, `shownDoc`); the document doesn't change (no undo step, nothing saved).
- The look's **settings** are beside the grid, changed live; **Apply** (or Enter, or a double-click on a card)
  adds it, one undo step, and closes the gallery; **Cancel** (or Escape) drops the preview.

## The filters

By category (the Filter menu's and the gallery's order). Sizes in presets are fractions of the canvas's diagonal,
so a look is the same on any canvas. 18 filters with Glow and Lens Flare, 80 looks.

### Colour
- **Gradient Map**: the encoded luminance picks a colour along a gradient (Photoshop's Gradient Map, the usual way
  duotones and purple "haze" covers are made). Purple Haze, Cyber Night, Infrared, Toxic, Blood Moon, Gold, Sepia,
  Noir.
- **Color Grade**: temperature, saturation, contrast (an S-curve), split toning (each tint soft-lit by how dark or
  bright the pixel is, Balance moving the crossover) and a matte fade: Camera Raw's grading, briefly. Faded Film,
  Teal & Orange, Pink Dream, Cold Night, Cross Process, Bleach Bypass, Golden Hour, Vaporwave.
- **Posterize**: levels per encoded channel, the steps optionally smoothed. Screenprint, Pop, Retro, Comic.
- **Psychedelic**: hues turned about the grey axis by Shift plus Cycles turns of brightness (grey midtones first
  given colour by Rainbow, or they couldn't turn), saturation, solarisation. Acid Trip, Oil Slick, Invert Hues,
  Solarized, Thermal Dream.

### Light
Glow and Lens Flare (f4-light.md), and **Light Leak**: light bleeding in from an edge, as on expired film, added in
linear light with the glow's coverage rule; a seeded wobble, and a second leak opposite (Double). Warm Leak, Red
Burn, Sunset, Cool Leak, Double.

### Stylize
- **Halftone**: a screen of dots, lines or squares in document pixels: mono ink on paper, CMYK at 15/75/0/45°
  (process inks over paper, black only in the shadows), or each cell's own colour. A dot's area follows the ink at
  its cell's centre; the four nearest cells are drawn so big dots aren't cut. Newsprint, Comic Dots, Pop Art,
  Engraving, Bold Dots.
- **Dither**: Bayer 4×4, 8×8 or noise dithering of blocky pixels (each the average of a 4×4 grid of reads), mono
  between two colours or per channel. 1-Bit, Game Boy, Retro PC, Grit.
- **Pixelate**: mosaic cells or LED dots, with a gap. Mosaic, Big Pixels, LED Wall.
- **Deep Fry**: the meme look, from how it's made by hand: unsharp-mask sharpening far past taste (a fixed ring of
  reads), saturation and contrast pushed, reds pushed, tones crushed, noise. Lightly Fried, Deep Fried, Nuclear.
- **Neon Edges**: Sobel edges as light in their own colour, a tint or by direction (a rainbow), over black, over the
  image or as dark lines on paper. Glowing Edges (Photoshop's), Neon Outline, Rainbow Edges, Sketch.

### Glitch
- **RGB Split**: red one way and blue the other (or red against cyan: an anaglyph), across the picture or out from
  its centre as a lens's fringes. Fringe, Wide Split, Anaglyph 3D, Lens Fringe.
- **Glitch**: slices on two grids shoved sideways, blocks copied, dragged into one-line stripes or posterised,
  channels split (more where something moved): seeded, whole pixels. Slice, Data Mosh, Light Glitch, Wrecked.
- **VHS**: lines jittered (more in a tracking band), colour averaged to the left so it trails the brightness,
  washed out and warm, scanlines (faded where finer than the pixels shown), snow. VHS Tape, Worn Tape, CRT.

### Film
- **Film Grain**: two octaves of value noise in document pixels, strongest in the midtones, mono or colour; seeded
  dust and broken scratches. Fine 35mm, Heavy Grain, 16mm Colour, Dusty.
- **Vignette**: edges darkened towards a colour (negative Amount) or lightened towards white, from the canvas's
  shape to a circle. Classic, Heavy, Soft White, Purple Edge.

### Distort
- **Wave**: sine waves (horizontal, vertical or both) or a liquid noise warp; reads past the canvas's edge are held
  on it, so edges stretch rather than tear. Wavy, Liquid, Heat Haze, Ripple.

Glitch, Neon Edges and Wave read the canvas's edge pixels again rather than past them (`onCanvas`), never farther
from the point than they'd have read: a shoved slice repeats the edge instead of leaving a hole.

## Where we differ from Photoshop

- Its Filter Gallery shows its own preview inside the dialog; ours previews on the canvas, the photo at the size
  and zoom it's being worked at, with every other layer around it.
- Its stylised filters are destructive unless the layer is a Smart Object; ours are always Smart Filters.
- Its filters' patterns are in the image's pixels at its resolution; ours are in document pixels too, but a reduced
  view shows them refined from full resolution, so a halftone seen small averages to the picture rather than
  aliasing.

## Later

Mirror and kaleidoscope (their input is the mirrored region, not a reach around the point), zoom and radial blur
(their reach is a fraction of the canvas), a blur family, and user-saved looks.
