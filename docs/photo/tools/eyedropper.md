# The Eyedropper

Photoshop's Eyedropper (I) and its Color Picker's sampling: picking a colour off the photo. Written 2026-10-07; this
is what's built and why.

## What Photoshop does

- **A click picks the foreground colour**; Alt-click picks the background. A drag follows the pointer, the colour
  changing as it goes, and lands where it's let go.
- **The sampling ring**, while the button is down: a ring around the pointer, the new colour in its top half, the
  colour it replaces in the bottom half, inside a grey ring so either reads against the image.
- **The options bar**: **Sample Size** (Point Sample, 3 by 3 Average, 5 by 5, 11 by 11, 31 by 31, 51 by 51, 101 by
  101), **Sample** (Current Layer, Current & Below, All Layers, and the same without adjustments), **Show Sampling
  Ring**.
- **The Color Picker samples too**: while it's open, the pointer over the image is an eyedropper, and a click picks
  the colour there into the picker (which stays open). It reads the Eyedropper's options. The Gradient Editor's
  stops, a layer style's colours and the type and shape colours do the same.
- **Alt with a painting tool** (the Brush, the Pencil…) is the Eyedropper for as long as it's held: Alt-click picks
  the foreground.
- Off the image, a click picks nothing (with a drag started on the image, Photoshop reads the screen under the
  pointer, its own panels too).

## What we build

`toolbox/eyedropper.tsx` (the kit: its options bar and its press), `toolbox/eyedropper-options.ts` (its options,
kept in this browser as the other tools' are), `colour-sampling.tsx` (the press's work: the drag, the ring, and the
colour pickers' sampling) and the pure maths in `shared/photo/eyedropper.ts` (which pixels a sample reads, and their
average weighted by alpha).

- A sample renders just its square (`PhotoRenderer.sampleView` at 100%, the active layer alone through the same
  isolation as the selection tools' `samplePixels`), so it's exact at any zoom; samples during a drag go one at a
  time, the latest point winning, and the gesture ends once the last one is in.
- **Every colour picker in the photo editor samples the canvas.** The platform's `ColorPicker` claims a
  `ColorSamplerContext` while it's shown; the photo workspace provides it (`photoColourSampler`), and a press on the
  canvas with a picker open samples into the last one shown, whatever the tool, through the picker's own `ColorEdit`
  (one undo step where its edits are undoable). The press stops there, so the picker's popover doesn't take it for a
  click away and close. A line under the picker says so.
- Alt with the Brush picks the foreground; the Eraser keeps Alt to itself.
- The assistant's `sample_colour` reads the colour at a point (Sample Size, All Layers) and can make it the
  foreground or background colour.

## Where we differ

- Sample is Current Layer or All Layers only (no Current & Below, nor the "No Adjustments" variants).
- A drag off the canvas reads nothing: the page can't read the screen under the pointer during a drag. (The
  picker's own eyedropper button is the browser's, which reads anywhere on the screen.)
- There's no Color Sampler, Ruler, Note or Count tool in its group yet.
