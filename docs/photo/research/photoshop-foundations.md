# Photoshop research: core editing contracts

Researched 2026-10-03 from primary Adobe documentation. Desktop Photoshop is the workflow reference;
documentation spans legacy and newer reorganised pages. These notes establish concepts, not a complete
version-specific shortcut specification. No hands-on Photoshop comparison was performed in this task.
Before implementing a complex interaction, verify it in a named desktop version or mark it unverified.

## Layers and compositing

**Verified reference:** Photoshop distinguishes layer opacity and fill. A group's default Pass Through
mode allows effects on its children to interact with the surrounding stack; another group blend mode
composites its children together before blending that group into the parent. Adjustment scope therefore
changes with group isolation. [Adobe: layer opacity and blending](https://helpx.adobe.com/photoshop/using/layer-opacity-blending.html).

**Proposed:** support ordered layers and opacity first. Add isolated groups before pass-through groups;
label this difference. Fill, Blend If, knockout and the full blend-mode set follow separate research.
Clipping to a lower layer's transparency is distinct from a painted mask and needs an explicit compiler
scope. Do not implement it by permanently multiplying the source pixels.

Acceptance: changing opacity preserves underlying pixels; moving a layer changes stack order; an
adjustment inside an isolated group cannot affect a lower layer outside it. When pass-through ships,
an otherwise identical group produces the expected different scope.

**Layers panel keys (Adobe's "Keys for the Layers panel"):** ⌥[ / ⌥] select the next layer down / up,
⇧⌥[ / ⇧⌥] add it to the selection, ⌥, / ⌥. the bottom / top layer, ⌥⌘A all layers, ⌘E Merge Down (Merge Layers
with several selected), ⇧⌘E Merge Visible, ⌘[ / ⌘] send backward / bring forward, ⇧⌘[ / ⇧⌘] send to back / bring
to front, ⌘J layer via copy, ⌘G group. ⌘-click a row adds or removes it, ⇧-click selects the run. With the Move
tool, ⇧-click adds the layer under the pointer, and with Auto-Select a drag from empty canvas selects the layers it
touches. [Adobe: keys for the Layers panel](https://helpx.adobe.com/vn_en/photoshop-elements/desktop/keyboard-shortcuts/keys-layers-panel.html).
Ours, and where they differ (the app's own ⇧⌘E and ⇧⌘[ ]), are in [ux.md](../ux.md), "Keys".

## Nondestructive sources, transforms and filters

**Verified reference:** adjustment layers retain original pixel values; Smart Objects preserve content
for transformations; Smart Filters retain editable filter settings; masks hide rather than delete.
Separate retouch layers can sample other layers, and excluding adjustments prevents correction being
sampled and subsequently applied twice. [Adobe: nondestructive editing](https://helpx.adobe.com/photoshop/using/nondestructive-editing.html).

**Proposed:** placed image content is preserved by default, with an editable transform and filter stack.
Painting requires an explicit editable pixel target. This delivers a focused subset of Smart Object
benefits; it is not the entire embedded-document, linked-file and replacement-content system.

Adobe supports creating embedded Smart Objects through several entry paths, including conversion and
placement. Our embedded source initially belongs to the project package; linked external source
resolution/relinking is deferred. [Adobe: embedded Smart Objects](https://helpx.adobe.com/photoshop/desktop/create-manage-layers/smart-objects/create-embedded-smart-objects.html).

Acceptance: scale down, commit, scale back up, save and reopen; final rendering samples original content.
Bypass a filter and restore it with the same parameters. No source file is modified during editing.

## Masks and selections

**Verified reference:** layer masks can be added from selection/transparency and edited by painting;
Adobe documents duplicating masks and reversing the selected region when creating one.
[Adobe: add/edit layer masks](https://helpx.adobe.com/photoshop/desktop/create-masks/layer-masks/add-layer-masks.html).

**Proposed:** grayscale layer-local coverage, with white visible and black hidden, an explicit active
mask thumbnail, enable/disable and inversion. First masks are linked to their layer transform. Density,
feather, unlinking, vector masks and per-filter masks are later extensions. Selection coverage is a
separate document-space resource, not a boolean outline.

Select and Mask offers a dedicated refinement workflow and tools for improving edges.
[Adobe: refine selections](https://helpx.adobe.com/photoshop/desktop/make-selections/refine-modify-selections/refine-your-selection-and-mask.html).
**Proposed:** rectangle/lasso, combine modes and feather first; hair/object edge refinement later.
Do not claim subject selection or hair-quality extraction based on a basic feathered mask.

Acceptance: paint a mask across a tile boundary; source pixels are unchanged; disable restores the full
layer; undo restores the previous coverage exactly; moving the layer moves its mask. A fractional
selection limits paint fractionally, not just inside/outside the marching-ants boundary.

## Brushes

**Verified reference:** Photoshop's painting tools expose opacity, flow and preset settings; these
are separate controls. Brush presets and tool presets store different scopes of settings.
[Adobe: painting tools](https://helpx.adobe.com/photoshop/using/painting-tools.html),
[Adobe: brush presets](https://helpx.adobe.com/photoshop/desktop/apply-painting-techniques/brushes-presets/get-started-with-brush-presets.html).

Adobe also documents stroke smoothing as a distinct feature.
[Adobe: stroke smoothing](https://helpx.adobe.com/photoshop/desktop/repair-retouch/clean-restore-images/create-smoother-more-polished-brush-strokes-with-stroke-smoothing.html).

**Proposed:** implement a small round brush first with defined dab spacing and stroke-level strength.
Before adding opacity/flow, write their accumulation equations and verify repeated-dab, overlapping
stroke and pressure behaviour. Opacity cannot simply be renamed flow. Stabilisation needs latency and
pointer-up-tail rules. ABR compatibility is deferred; save our own versioned brush definitions.

Acceptance: the same sampled input yields the same authoritative mask across zoom/DPR; a fast stroke
has no gaps; cancellation leaves no committed tiles; undo/redo uses stored pixels rather than replay.

## Colour and document modes

**Verified reference:** profile assignment changes interpretation without changing colour values;
conversion changes values into a chosen profile. Photoshop has explicit colour-management policies.
[Adobe: change profiles](https://helpx.adobe.com/ie/photoshop/desktop/adjust-color/color-profiles/change-color-profile-for-documents.html),
[Adobe: colour settings](https://helpx.adobe.com/uk/photoshop/using/color-settings.html).

Photoshop supports different bit depths with different capabilities; more stored precision increases
the amount of colour data. [Adobe: bit depth](https://helpx.adobe.com/photoshop/using/bit-depth.html).

**Proposed:** extended linear RGB processing, explicit per-operation domains, sRGB SDR output first.
We do not promise Photoshop's exact legacy blend/curve appearance or its CMYK/Lab/spot/HDR workflows.
An 8-bit-only decoding path is insufficient for later high-precision import even if intermediate
textures are floating point.

Acceptance: tagged sRGB and equivalent tagged wide-gamut colours convert as expected; alpha is not
profile-transformed; export profile matches the actual output values. A 16-bit gradient remains
distinguishable internally from its 8-bit counterpart.

## Crop and retouching follow-up

Nondestructive crop must retain off-canvas resources and change output bounds independently of source
bounds. Clone/heal sampling must declare current layer, current-and-below or all-layers scope, with
an explicit adjustment policy. These are our required contracts; exact crop modifiers and retouch
algorithms need feature-specific research before implementation.

## Unverified interaction details

- Transform modifier behaviour and aspect-ratio defaults in the selected Photoshop version.
- Full keyboard bindings, temporary tools and platform conflicts with this app.
- Mask density/feather ordering relative to filter masks and layer styles.
- Exact Photoshop opacity/flow/dab maths and colour-domain differences.
- Every blend mode's HDR, fill and group interactions.
- Selection history and mask-thumbnail modifiers beyond the documented procedures.

Use [ux.md](../ux.md) as our proposed interaction contract. Do not present those choices as empirically
verified Photoshop parity. Add targeted comparison fixtures as the corresponding feature is built.
