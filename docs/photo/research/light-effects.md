# Light effects: Smart Filters, Lens Flare, flare editors

Status: researched 2026-10-06, before F4 ([f4-light.md](../f4-light.md)). Labels as in the README: **Verified
reference**, **Secondary** (tutorials), **Product decision**.

## Photoshop's Smart Filters (where F4's glow lives)

A filter applied to a Smart Object stays editable: a Smart Filter (Secondary:
[Photoshop Essentials](https://www.photoshopessentials.com/basics/how-to-use-smart-filters-in-photoshop/),
[CreativePro](https://creativepro.com/how-use-photoshop-smart-filters/)).

- **In the Layers panel**: under the layer, a "Smart Filters" row with the filter mask's thumbnail, then the filters
  in a list. The row's eye hides all of them; each filter has its own eye.
- **Order**: the list applies from the bottom up (the lowest filter runs first), and filters are reordered by dragging
  them up or down.
- **Editing**: double-clicking a filter opens its dialog again. Each filter also has a Blending Options icon (two
  sliders) for its own mode and opacity over the filter below.
- **The filter mask** is one per layer, shared by all its filters.

**Product decisions (F4):**
- Our filters list under the layer in the same order, bottom first. The "Filters" row's eye bypasses all of them
  (each filter's `enabled` stays as it was), and each filter has its own eye.
- Clicking a filter selects it, and Properties shows its parameters (no modal dialog).
- Per-filter blending options and a filter mask are later: the glow has its own Mix.

## Photoshop's Lens Flare (what our flare replaces)

Filter › Render › Lens Flare (Secondary: [Computer Hope](https://computerhope.com/jargon/p/photoshop-lens-flare.htm),
[Photoshop Essentials](https://photoshopessentials.com/?p=7106)):
- A dialog with a preview, where a click or drag sets the flare's centre, a Brightness slider (10–300%), and four lens
  types: 50–300 mm Zoom (the default), 35 mm Prime, 105 mm Prime and Movie Prime.
- It paints into the layer's pixels. It needs pixels to paint on: the usual workaround is a layer filled with black in
  Screen mode. On a Smart Object it can be re-opened, but the flare's elements are never editable one by one.

**Product decision:** a live generator layer whose elements are editable, with source and centre handles on the
canvas, adding light physically by default (Linear Dodge in linear light). The lens types become presets.

## Optical Flares (the element editor we follow)

Video Copilot's Optical Flares builds a flare from a stack of elements (Glow, Streak, Ring, Hoop, Iris, Multi-Iris,
Spike Ball, Sparkle…). Each has its own brightness, scale, colour and position on the axis from the light to the
frame's centre, with show/hide in the stack, and presets of whole stacks
([Video Copilot](https://video-copilot.gitbook.io/opticalflaresnuke/using-optical-flares-for-nuke/creating-a-lens-flare-from-scratch)).

**Product decision:** our first element types are Source glow, Halo, Ghost (disc or polygon) and Anamorphic streak,
listed in Properties with an eye each, added from a menu, reordered by dragging. Element types, defaults and looks are
our own, starting from the video editor's Lens Flare.

## Where we differ

- The glow is a light glow (a threshold of the layer's light, blurred at many scales, in linear light): a filter, not
  Photoshop's Outer Glow style.
- The flare is a layer, not pixels painted by a filter, and adds light in linear light unless its blend says otherwise.
- No filter dialogs: Properties edits a filter live, each drag one undo step.
