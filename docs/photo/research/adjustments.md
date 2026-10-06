# Adjustments: Exposure and Curves

Researched 2026-10-05, before F2 built them. Labels as in the [README](../README.md#labels). Adobe's own Exposure
page (helpx "Adjust HDR exposure and toning") refused automated fetching (403), so what it says is quoted from
memory of it and secondary sources and is labelled accordingly; nothing here was compared hands-on in a desktop
Photoshop yet. **Check each "Unverified" item in Photoshop 2026 on Théo's machine and record the result here.**

## What an adjustment layer is

**Verified reference:** an adjustment layer applies a colour or tonal adjustment to the layers below it without
changing their pixels; it can be hidden, deleted, re-edited at any time, faded by its opacity and limited by its
mask ([Adobe: nondestructive editing](https://helpx.adobe.com/photoshop/using/nondestructive-editing.html)). New
ones are made from the Adjustments panel or the Layers panel's half-filled circle button, and go **above the
selected layer**. Their settings are in the Properties panel.

**Product decision (built):** the same. `AdjustmentLayer { kind: "adjustment", effect: EffectInstance }`; it has
no transform (Move does nothing to it; the assistant is told why). Its opacity mixes the adjusted composite with
what was below, in premultiplied linear light. Its mask is F3's.

## Exposure

**Verified reference (secondary, consistent across sources):** Exposure has three controls meant above all for
HDR (32-bit) images, and **all three work in linear light**, whatever the document's mode: *Exposure* moves the
highlight end of the scale (in stops), *Offset* moves the black end (lifting or sinking shadows and midtones,
highlights hardly), *Gamma Correction* is a power curve. Ranges: Exposure −20 to +20, Offset −0.5 to +0.5, Gamma
9.99 to 0.01, defaults 0, 0, 1.00
([discussion with the same account](https://www.fredmiranda.com/forum/topic/1178708/),
[how-to](https://bwillcreative.com/how-to-change-exposure-in-photoshop/)).

**Unverified:** Adobe's page says Gamma Correction "adjusts the image gamma using a simple power function" and
that "negative values are mirrored around zero" (they stay negative but are adjusted as if positive). We do
exactly that. **Which way the power goes is unverified**: one secondary source says Adobe's convention is that a
gamma above 1 darkens. Check: a mid-grey document, Exposure's gamma at 2.00, does it brighten?

**Product decision (built), per pixel on unassociated linear colour, alpha unchanged:**

```text
v = colour × 2^exposure + offset
out = sign(v) × |v|^(1 / gamma)          (gamma 1: out = v)
```

so a gamma above 1 brightens the midtones (Levels' midtone convention). If Photoshop turns out the other way,
that's a new version of the definition (`exposure@2`), never a silent change to saved documents. Light above
white isn't clipped (rendering.md: nothing clamps between operations). With gamma 1 the whole adjustment is
linear in premultiplied light (`c × 2^e + offset × α`), so it **commutes with reduction**; with any other gamma it
doesn't (the render plan then refines reduced views).

## Curves

**Verified reference:** Curves maps input tones to output tones with a curve per channel and a composite (RGB)
curve; points are added by clicking the graph, moved by dragging, removed by dragging them off the graph (or
selecting one and pressing Delete); up to **16 points** a curve
([Adobe forum on the 16-point limit](https://community.adobe.com/questions-712/scripting-help-how-to-modify-an-auto-generated-curves-layer-to-have-16-points-1182076),
[O'Reilly, Photoshop CC: The Missing Manual](https://oreilly.com/library/view/photoshop-cc-the/9781491905593/ch09s05.html)).
Values are shown 0–255 in RGB documents, on the document's **encoded** values (8- and 16-bit documents are
gamma-encoded). The curve passes smoothly through its points and is flat beyond the first and last.

**Unverified:**
- The interpolation. We use a **natural cubic spline** (second derivative 0 at both ends), output held to
  [0, 1]; Photoshop's is a smooth spline of this kind, but its exact end conditions aren't documented. Check: the
  points (0, 0), (64, 100), (255, 255); read Output at Input 32 and 160 in Photoshop's Info panel.
- The order of a channel's curve and the composite. We apply **the channel's own curve first, then the
  composite** (GIMP's order). Check: Red (0, 0)→(128, 200) and RGB (0, 0)→(128, 60) on a mid-grey; compare
  the red channel's result with both orders.
- Whether input values collide: we keep inputs strictly increasing, one point per input (a dragged point stops
  one level short of its neighbour).

**Product decision (built), from rendering.md's operation domains:** on sRGB-encoded unassociated colour; values
outside [0, 1] in linear light (light above white, colours outside sRGB) **pass through unchanged** (a documented
kink at the ends; HDR curves are a later, separate definition); a channel whose own curve and the composite are
both straight is left exactly as it was. An identity curve set is left out of the render plan altogether, so it's
exact by construction. Points are stored as Photoshop shows them, `[input, output]` on 0..255 (fractions allowed,
the panel writes whole levels), so what the user types, the assistant writes and the document holds agree. Curves
never commutes with reduction: below 100% the view is refined to the full-resolution render reduced.

## Gestures and keys (built)

| Action | Gesture | Undo |
| --- | --- | --- |
| New adjustment | Layers' half-filled circle → Exposure… / Curves…; added above the selected layer and selected | One step |
| Exposure value | Slider drag, or type it (Enter commits, Escape cancels) | One step a drag or a typed value |
| Curves point | Click the graph to add one (and drag it); drag a point; drag off the graph or Delete removes; Input/Output typed | One step a drag (adding included) |
| Channel | RGB / Red / Green / Blue above the graph; other channels' shaped curves show faintly under RGB | — |
| Reset | Properties' Reset: the definition's defaults | One step |

## Failure cases

- An effect type this app doesn't know, or a newer version of one: kept exactly as saved, shown as unavailable in
  Layers and Properties, left out of rendering; never edited (tested).
- Bad parameters from disk or the assistant: repaired on load and reported (`normalizePhotoProject`'s report);
  the assistant's tools refuse instead, saying the range or the points' rules.
- A curve with more than 16 points, or fewer than 2 valid ones: held to 16, or the identity.

## Acceptance (tested)

- Identity curves export an 8-bit photo bit for bit (e2e: `differing: 0` with a reset Curves layer present).
- The GPU's Exposure and Curves equal the CPU references (`shared/photo/reference/adjustments.ts`) within f16 and
  table tolerance (e2e).
- Exposure at reduced levels equals the level-0 render reduced (e2e: three levels, within 4 × 10⁻³ relative).
- Curves below 100% refine to the CPU's reduction of the level-0 render (e2e, two levels).
- A slider drag is one undo step and re-runs only the adjustment (e2e counts the screen's work).
