# UX: the first photo workflow

Status: revised 2026-10-05 (first proposal 2026-10-03). Photoshop references are in
[research/photoshop-foundations.md](research/photoshop-foundations.md). Shortcuts are our proposal until checked in
a named Photoshop version and against the app's own. Before building a panel, write down what Photoshop's does (its
manual, screenshots, Théo's use), as `docs/fl-studio/` does for music, and end that note with where we differ.

## Workspace

- A central canvas. The tool strip is on the left; Layers and Properties are on the right; the tool options bar runs
  across the top; zoom, document size and the saved state are along the bottom.
- Docked panels, as Photoshop's are, through the platform's dock (`components/dock`, `createDock` with photo's own
  panels and layout key): they can be moved, tabbed and floated, and Reset layout restores the default.
- No timeline. The project tabs, Home button, assistant panel, Settings and themes are the platform's, unchanged.

The canvas shows:
- the image;
- a checkerboard under transparency (UI, never exported);
- the selection's marching ants;
- tool overlays: handles, brush cursor, the flare's source handle.

Layers show:
- content and mask thumbnails;
- visibility;
- the name;
- an effects indicator;
- an obvious border on the active target (content or mask), which is never shown by colour alone.

Properties follows the selected layer, mask or effect. The tool options bar follows the active tool. These are
different selections, kept apart.

First tools: Move/Transform, Rectangular Marquee, Brush, Hand, Zoom. Crop follows once off-canvas content and
coordinates are proven. A tool that doesn't work yet isn't shown.

## New photo

From the picker or Home's New tile: a size preset or an image.

**Presets**, short-form first like the rest of the app:

| Preset | Size |
| --- | --- |
| Story / Reel | 1080 × 1920 |
| Portrait post | 1080 × 1350 |
| Square | 1080 × 1080 |
| Thumbnail | 1280 × 720 |
| HD | 1920 × 1080 |

**From an image**: the canvas takes the image's size and the image becomes the first layer. Images dropped alone on
Home start a photo project; a mix with video or audio starts a video.

## Targeting

- Click the content thumbnail to edit pixels or content; click the mask thumbnail to edit coverage. Changing the target
  updates the cursor, the options and the labels.
- Brushing a placed image asks: a new paint layer above it, or convert it to pixels (its transform baked, said so).
  Nothing is rasterised silently.
- Masks never require rasterising their layer.
- Move acts on the selected layer. Auto-select on the canvas starts off, with a visible toggle, so painting never
  switches layers by accident.
- Rename and visibility go through the same edits as everything else (undoable).
- Clicking empty canvas never retargets the brush.

## Keys

Photo's own `keys.ts`, pure and tested, as music's is. Its listener skips text fields and windows that keep their keys
(`keptByWindow`). App-wide keys are left alone: ⌘W, ⌘, (Settings), ⌘O, ⇧⌘H, tab switching.

| Key | Proposed |
| --- | --- |
| Space held | Hand, back to the previous tool on release |
| V / M / B / H / Z | Move / Marquee / Brush / Hand / Zoom |
| ⌘Z / ⇧⌘Z | Undo / redo |
| ⌘0 / ⌘1 | Fit / 100% (the File menu's ⌘1 "New Video" only acts on Home: its accelerator isn't registered) |
| ⌘+ / ⌘− | Zoom in / out, centred on the pointer when it's over the canvas |
| [ / ] | Brush size, with its value shown |
| D / X | Default colours / swap (on a mask: white and black) |
| ⌘A / ⌘D | Select all / deselect |
| ⌘J | Duplicate layer |
| Delete | Delete layer (or the selection's pixels, later) |
| Enter / Escape | Commit / cancel a transform, a selection being made or a handle drag |
| ⌘S | Save now (saving is automatic, as in every suite; this flushes and shows it) |

## Gestures

Pointer capture keeps a gesture alive outside the canvas.
- **Commit and cancel**: pointer up commits; Escape cancels; pointer cancel or the window losing focus cancels
  unfinished work.
- **Switching**: switching tool, target or project resolves the gesture first.
- **Nudges**: arrow keys move by 1 px (⇧: 10). Repeated nudges within a moment are one undo step.

## Transform and view

- **Handles** are in document space, showing size and angle. The aspect ratio is kept by default, ⇧ frees it, and ⌥
  scales from the centre. Mirroring is allowed; a singular matrix isn't.
- **Lossless**: a drag previews by resampling the source, and committing changes a matrix. Scaling down and up again
  loses nothing until the user explicitly converts to pixels.
- **Zoom** centres on the pointer; panning doesn't touch the document.
- **100% means one image pixel per device pixel**, so on a Retina display the image looks half its CSS size. The zoom
  readout says this, and DPR changes, window resizes and fractional zooms are tested.
- **Zoom limits**: the smallest zoom fits any document; the largest shows pixel edges.
- **While the view is refining** (see rendering), a subtle indicator says so; it never blocks input.

## Selections, masks and brushes

- **Selections**: a rectangle is document-space coverage with antialiased edges. No selection means everything; an
  empty selection means nothing. Selection changes are undo steps (Photoshop's way).
- **Masks**: a mask made from the selection is that coverage in the layer's own pixels, and follows the layer from
  then on. Painting a mask: black hides, white reveals, and the source is untouched.
- **The first brush** is round, with size, hardness and strength. Dabs are spaced in document pixels and come out the
  same at any zoom. The selection limits paint by its coverage.
- **Later brush controls**: Opacity and Flow only once their accumulation equations are written and tested. Pressure,
  texture, scatter and smoothing follow their own research; nothing is guessed from browser pointer behaviour.

## Effects

- **Adding**: exposure and curves are adjustment layers. Glow goes on a layer's effects. A flare is a generator layer
  with a source handle on the canvas.
- **Undo**: a slider drag or a handle drag is one undo step.
- **Bypass and remove**: bypass keeps the settings; remove is undoable.
- **Presets**: preview without touching history, then apply in one step.
- **Compare**: views of the original or with an effect bypassed never change the document.

## Saving, progress and failure

- **The header's state**: saved, saving, not saved (with the reason) or failed. A preview updating doesn't mean an
  edit was saved.
- **Long work**: imports and exports show progress and can be cancelled, and editing stays responsive meanwhile.
- **Recovery**: after a GPU or helper restart the user sees their committed work and is told that an unfinished
  stroke was cancelled.
- **Backend details** never appear in editing controls; diagnostics go in Settings.
- **Export is its own window**, distinct from saving. It offers PNG with transparency, or JPEG with a matte, size and
  quality. It uses the desktop app's save dialog as music's export does; an existing file is replaced only after the
  new one is complete.

## Accessibility and validation

- **Keyboard**: panels, toggles, numeric fields and layer selection work by keyboard, with a focus ring only for
  keyboard and text fields (never on clicked controls, as everywhere in the app).
- **Labels**: brush-only actions have numeric equivalents; small icon buttons have names.
- **Announcements**: canvas tools announce meaningful changes, not every dab.
- **Coverage**: both themes and common window sizes are checked.

**Walkthrough**: open a photo → place a second image → transform → curves → paint its mask → flare and glow →
undo/redo → reopen → export. Every step has an obvious target, can be undone, and shows its result. Automated pixel
checks go with the manual review.
