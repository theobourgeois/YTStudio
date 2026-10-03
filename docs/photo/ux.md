# UX: the first photo workflow

Status: proposed behavior, 2026-10-03. Photoshop references are in
[research/photoshop-foundations.md](research/photoshop-foundations.md). Shortcuts below are our proposal
until verified against the chosen Photoshop version and reconciled with app-wide shortcuts.

## Workspace

Central image canvas; left tool strip; right Layers and Properties panels; tool options across the
top; document/view status below. Keep project navigation, save state, assistant and existing theme
system shared with the other suites. No photo timeline. Use dockable workspace infrastructure where
it can be reused without importing video-specific state.

The first canvas shows image pixels, a transparency checkerboard, selection outline and tool overlays.
Only image content exports. Layers show content and mask thumbnails, visibility, name, effect indicator
and an obvious active-target border. Properties follows the selected layer, mask or effect; the tool
options bar follows the active tool. These are different selection concepts.

Initial tools: Move/Transform, Rectangular Selection, Brush and Hand/Zoom. Crop follows after the
foundation's coordinate and off-canvas behavior is proven. Avoid exposing nonfunctional tools.

## Targeting rules

Click the content thumbnail to edit pixels/content; click the mask thumbnail to edit coverage.
Changing the target updates cursor/options and visible labels. Brush on an imported placed image offers
an explicit conversion to an editable pixel layer or a new paint layer; do not silently rasterize it.
Masks never require rasterizing their owner's source.

The Move tool operates on selected layers. Canvas auto-select starts off, with a visible toggle; this
prevents accidental layer changes while painting. Multiple-layer manipulation is a later addition.
Rename and visibility changes go through the common command path. Panel scrolling is independent of
canvas zoom. Clicking empty canvas does not switch the brush to a different target.

## Gestures and keyboard proposal

| Interaction | Proposed behavior |
| --- | --- |
| Space held | Temporary Hand tool, returns to the prior tool on release |
| V / M / B / Z | Move / rectangle selection / brush / zoom when no text field is focused |
| Cmd/Ctrl+Z; Shift+Cmd/Ctrl+Z | Undo; redo through the common history |
| Cmd/Ctrl+S | Resolve active edit, flush resources and save checkpoint |
| Cmd/Ctrl+0; Cmd/Ctrl+1 | Fit document; 100% with its actual pixel relationship displayed |
| [ / ] | Brush size with visible numeric feedback |
| D / X | Default foreground/background; swap them (coverage black/white on masks) |
| Enter / Escape | Commit / cancel an active transform, selection creation or effect-placement gesture |

Audit app-wide shortcut handling before registering these. Text inputs retain typing/selection keys.
Platform differences belong in one shortcut registry; do not scatter macOS checks through tools.

Pointer capture keeps a gesture alive outside the canvas. Pointer-up commits; Escape cancels;
pointercancel/focus loss cancels uncommitted draft work. Tool/project switches resolve a gesture before
changing target. Save commits valid active work and awaits publication; invalid drafts ask for a
concrete correction or cancel safely. Keyboard nudges create/coalesce deliberate history entries.

## Transform and view

Transform handles operate in document space. Show dimensions and angle; preserve aspect ratio by
default, with an explicit modifier/toggle for free stretch. Negative scale/mirroring is defined rather
than producing a singular matrix. Preview samples preserved source pixels; commit changes a matrix.
Repeated scale-down/scale-up is nondestructive until the user explicitly rasterizes/resizes content.

Zoom centers on the cursor; panning does not modify the document. Test DPR changes, window resize and
fractional zoom. State exactly what 100% means when CSS and physical pixels differ. Minimum zoom must
still permit a large document to fit; maximum zoom shows inspectable pixel edges.

## Selections, masks and brushes

A rectangle produces document-space fractional coverage, including antialiased boundaries. A current
selection limits paint; no active selection means full coverage, while an active empty selection means
no coverage. Selection creation/deselect are session history entries; creating a layer mask copies
selection coverage into a persistent layer-local resource. These must not alias mutable data.

First brush: round tip, size, hardness and strength, deterministic spaced dabs. Record the target,
brush and selection at stroke start. Mask paint uses black to hide, white to reveal; preserve source
pixels. Implement opacity/flow distinction before advertising both controls. Tablet pressure, texture,
scatter and smoothing follow explicit brush research, not inferred browser pointer behavior.

## Effects workflow

Add exposure/curves as adjustment layers. Add glow to a layer's editable effect stack. Add a flare as
a generator layer so it can be moved, reordered and masked separately. Choosing an effect shows its
controls and optional canvas handles. One slider drag or handle movement is one undo entry.

Effect bypass preserves settings; remove is undoable. Presets copy settings and owned asset references,
never overwrite unrelated layer content. Preview presets without polluting undo, then apply once.
Provide compare-original/effect-bypass views that do not modify project content.

## Saving, progress and failure

Show dirty/saving/saved and failures accurately. A preview update is not proof an edit is saved.
Engine recovery preserves committed content and explains that an unfinished stroke was cancelled.
Heavy imports/exports show progress and cancel; regular editing stays responsive. Refinement is subtle
but visible when the image is temporarily coarse. Do not expose GPU/backend choices in normal editing
controls; diagnostics belong in settings/help when they help resolve a problem.

Export distinguishes editable project save from flattened output. Initially offer PNG with transparency
and JPEG with a matte, size and quality. Confirm destination collisions through existing native save
behavior. Retain the last successful document/output if disk or encoding fails.

## Accessibility and interaction validation

Panels, toggles, numeric values and layer selection work by keyboard with visible focus and labels.
Brush-only actions also have numeric settings; color is not the sole indication of selected target.
Small icon controls have accessible names. Canvas tools need meaningful status announcements without
announcing every brush sample. Validate dark/light themes and common window sizes.

Foundation walkthrough: open photo -> place second image -> transform -> add curves -> paint its mask ->
add flare/glow -> undo/redo -> save/reopen -> export. Every stage has an obvious target, reversible action
and visible saved/result state. Automated pixel checks accompany manual interaction review.
