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

Above the rows (built, layer-style/README.md L1): Photoshop's blend-mode menu, Opacity and Fill for the selected
layers. Hovering a mode in the menu (or reaching it with the arrow keys) shows it on the canvas at once; choosing
keeps it (one undo step), Escape or a click away puts back what was there. Blending Options… (the Layers menu, the
footer's fx, or a double-click on a row past its name) opens the Layer Style window: one gesture, OK one undo step,
Cancel nothing, ⌥ Cancel is Reset, Preview off shows the layer as it was. An edit elsewhere while it's open ends it,
keeping what it showed (Photoshop's is modal; ours leaves the view free).

Layer effects (built, L2): the footer's fx menu (Blending Options…, then each effect), the Layer Style window's list
(a click on an effect ticks it and shows its page; + adds another of the five that allow it; ↑ ↓ move one among its
kind; the bin removes it), a styled row's fx badge and its effects listed under it (an eye each and one for all; a
double-click opens one). While a shadow's, Satin's or the gradient overlay's page shows, a drag on the canvas moves
it. Bevel & Emboss (L3) heads the list with its Contour row under it (its own checkbox and page, as Photoshop's);
its Altitude follows Global Light as its Angle does.
Copy / Paste / Clear Layer Style and Hide All Effects are in the Layers menu.

Patterns and styles (built, L4): Define Pattern (the Layers menu) makes a pattern of what the active layer shows in
the selection; every pattern control is a swatch that opens the built-in and the photo's patterns, with Snap to
Origin beside it, and a drag on the canvas moves the pattern while its page shows. The Styles panel (a tab beside
Properties) shows every style as a rendered swatch: hovering previews it on the selected layers, a click replaces
their style, ⇧-click adds its effects; + (and the Layer Style window's New Style…) keeps the active layer's style
as one of this computer's. Scale Effects… (the Layers menu) scales every effect's size at once.

Properties follows the selected layer, mask or effect. The tool options bar follows the active tool. These are
different selections, kept apart.

**Built: the layer's looks in place** (Figma's, Lightroom's and Lumetri's way, rather than Photoshop's dialogs). An
image or pixel layer's Properties has, under its transform, **Blending** (the mode, previewed while hovered,
Opacity and Fill; ↗ opens Blending Options), **Develop** and **Effects**. Develop is Camera Raw's sections with no
filter to add first: the first change adds the layer's Camera Raw filter, first in its filters, in the same undo
step; its header turns it off, Reset takes it off, ↗ opens it in the Camera Raw window (histogram, presets, the
eyedropper). Effects is the layer's style as a list, top of the drawing first: + adds one (this computer's
defaults), each has its eye and bin and unfolds to the same controls as the Layer Style window's page (Bevel's
Contour and Texture behind their checkboxes); ↗ opens the window for Blend If, styles and the canvas drags. Each
change is one undo step, a drag one too. Develop and Effects fold, remembered per section on this computer, and
start open when they do something. While a window has the layer, its section says so instead of competing with it.

First tools: Move/Transform, Rectangular Marquee, Brush, Hand, Zoom. Crop follows once off-canvas content and
coordinates are proven. A tool that doesn't work yet isn't shown.

## New photo

**Built:** images dropped on Home or on the tab strip start a photo the size of the first, named after it
("Screenshot 2026-10-05 at 8.57.28 PM"), as Photoshop names a document after its file; a new photo still called
"Untitled" takes the name of the image it's opened from too.

**Built:** New (the picker, Home's New tile, ⌘3) asks first, as Photoshop's New Document does: a window
(`new-photo-window.tsx`) before anything is made. Its presets are cards that show their shape, with their size and
ratio; any size can be typed in (Custom, up to 30 000 px a side), turned with Portrait / Landscape, on a White,
Black or Transparent background. Create makes the photo; Open an image… makes it from an image instead; closing the
window makes nothing. It starts on the last preset made (Settings › Photo). An open photo with no layers shows its
empty canvas: nothing over it.

**Presets**, short-form first like the rest of the app:

| Preset | Size |
| --- | --- |
| Story / Reel | 1080 × 1920 |
| Portrait post | 1080 × 1350 |
| Square | 1080 × 1080 |
| Square 1000 | 1000 × 1000 |
| Thumbnail | 1280 × 720 |
| HD | 1920 × 1080 |

**From an image**: the canvas takes the image's size and the image becomes the first layer. Images dropped alone on
Home start a photo project; a mix with video or audio starts a video.

**Into an open photo** (built): images dragged onto the editor (the canvas, Layers, Properties) are placed as layers
on top, as Photoshop places a file dragged into a document: fitted in the canvas, centred where they're dropped on
it (elsewhere, on its middle), and selected. The canvas keeps its size. Files that aren't images are turned away.

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
| V / B / E / H / Z | Move / Brush / Eraser / Hand / Zoom (built) |
| M / L / W | The Marquees (Rectangular, Elliptical), the Lassos (Lasso, Polygonal), Quick Selection and the Magic Wand: the group's tool; ⇧ steps through the group (built, selections.md) |
| ⇧⌘I / ⇧F6 | Select › Inverse / Feather (built) |
| ⌘Z / ⇧⌘Z | Undo / redo |
| ⌘0 / ⌘1 | Fit / 100% (the File menu's ⌘1 "New Video" only acts on Home: its accelerator isn't registered) |
| ⌘+ / ⌘− | Zoom in / out, centred on the pointer when it's over the canvas |
| [ / ] | Brush size, Photoshop's steps (1 px under 10, 10 under 100…), shown in the options bar; with ⇧, hardness by 25% (built) |
| D / X | Black and white / swap (on a mask, the grey of the colour is painted: black hides, white reveals; built) |
| ⌘A / ⌘D | Select the canvas / deselect (⌘D lets go of the selection, or with none of the layers; built) |
| ⇧⌘N | A new, empty pixel layer above the active one (built) |
| ⇧⌥ + a letter | The selected layers' blend mode, Photoshop's letters: N Normal, I Dissolve, K Darken, M Multiply, B Color Burn, A Linear Burn, G Lighten, S Screen, D Color Dodge, W Linear Dodge, O Overlay, F Soft Light, H Hard Light, V Vivid Light, J Linear Light, Z Pin Light, L Hard Mix, E Difference, X Exclusion, U Hue, T Saturation, C Color, Y Luminosity (built) |
| ⇧+ / ⇧− | The next / previous blend mode (built) |
| ⌘J | With a selection, Layer via Copy (what it covers of the active layer, as a new layer above); without, duplicate the selected layers (built) |
| ⇧⌘J | Layer via Cut (painted pixels only; built) |
| ⌘C / ⌘X / ⌘V | Copy / cut what the selection covers of the active layer (all of it with none); paste it as a new layer where it was, in this photo or another. An image copied in another app is placed (built) |
| Delete | With a selection, clear it (painted pixels go transparent; a mask takes the background colour); without, delete the selected layers (built) |
| ⌥⌫ / ⌘⌫ | Fill the selection (the whole layer with none) with the foreground / background colour (built) |
| ⌘E | Merge Down, or Merge Layers with several selected (built) |
| ⌥⌘A | Select all layers (built) |
| ⌥[ / ⌥] | Select the next layer down / up; with ⇧, add it to the selection (built) |
| ⌥, / ⌥. | Select the bottom / top layer; with ⇧, the run out to it (built) |
| ⌘[ / ⌘] | Send backward / bring forward (built) |
| Enter / Escape | Commit / cancel a transform, a selection being made or a handle drag |
| ⌘S | Save now (saving is automatic, as in every suite; this flushes and shows it) |
| ⇧⌘; | Snap on or off (Photoshop's View › Snap; built) |
| ⌘H / ⌥⌘H | Flip the selected layers horizontally / vertically (Edit › Transform; built) |

Where we differ from Photoshop's keys: ⇧⌘E is Export here (Photoshop's Merge Visible: ours is in the Layers menu),
and ⇧⌘[ / ⇧⌘] switch the app's tabs (Photoshop's Send to Back / Bring to Front: the Layers menu's). ⌘H and ⌥⌘H
flip (Théo's keys: Photoshop's are Hide Extras and macOS's Hide Others); the desktop app's menu leaves them to the page,
which hands an unused one back to macOS (`hide-app`), so they hide the app everywhere else. ⌘G (group) waits for groups.

## Gestures

Pointer capture keeps a gesture alive outside the canvas.
- **Commit and cancel**: pointer up commits; Escape cancels; pointer cancel or the window losing focus cancels
  unfinished work.
- **Switching**: switching tool, target or project resolves the gesture first.
- **Nudges**: arrow keys move by 1 px (⇧: 10). Repeated nudges within a moment are one undo step.
- **Reordering**: a row of the Layers panel dragged between two others moves there (a line shows where), one undo
  step; with several selected, they move together, in their order. Layers' thumbnails are the layer as it's placed on the canvas, alone, rendered by the same renderer.

## Transform and view

- **Handles** are in document space, showing size and angle. The aspect ratio is kept by default, ⇧ frees it, and ⌥
  scales from the centre. Mirroring is allowed; a singular matrix isn't.
- **Picking (Auto-Select, built)**: with Move, a click on the canvas picks the topmost layer under the pointer, and the
  layer a click would pick is outlined while the pointer is over it (Photoshop's). On by default; Settings › Photo turns
  it off, and ⌘ (Ctrl) held does the opposite for that click. A click where there's no layer selects nothing, and a
  drag from there draws a marquee that selects the layers it touches; ⇧ adds (to either), and ⇧-click on a layer
  adds it or takes it out. With Auto-Select off, a press anywhere moves the selection.

## Selecting layers (built)

Photoshop's: several layers can be selected, and what acts on a layer acts on all of them.
- **Layers panel**: a click selects one, ⌘-click (Ctrl) adds or removes one, ⇧-click selects the run from the active
  layer (⌘⇧ adds the run), a click below the rows selects none. Pressing one of several selected rows keeps them for
  a drag; a click without one selects it alone. Rows never select their text.
- **The active layer** is the last picked: Properties shows it, and a ⇧ range starts from it. With several selected,
  Properties says how many and offers Merge.
- **Moving and transforming several**: they move together (drag, arrows, ⌥-drag moves copies); their handles are one
  box around them, which scales and turns them as one (each also outlined). Edges and ⇧ (free proportions) show
  only when every one is at a right angle: stretching a turned layer one way would skew it.
- **The Layers menu** (right-click a row; a row outside the selection is selected first): Duplicate, Delete, Merge
  Down / Merge Layers, Merge Visible, Bring to Front, Bring Forward, Send Backward, Send to Back, Select All Layers,
  Deselect Layers.
- **Merging** (`shared/photo/merge.ts`): the layers merged are rendered alone, as an export is, into a new image of
  the project (16 bits when one of them is), placed where the topmost was, at 100%, keeping what's past the canvas.
  Merge Down takes the lower layer's name, the others the topmost's. Hidden layers are left as they are; an
  adjustment changes only the merged layers below it, and one with no merged image below it goes. Merging an
  adjustment layer alone into nothing, or into an adjustment below, is refused with the reason. One undo step; the
  originals' images stay in the project.
- **Pointers (built)**: each handle shows a double arrow along the way it pulls, turned with the layer (a corner of a
  layer turned 90° shows the other diagonal); just outside each corner a drag rotates, with a curved-arrow pointer,
  as Photoshop's.
- **Smart guides (built)**: moving a layer snaps its box's edges and centre, and resizing snaps the edges the handle
  moves, to the canvas's edges and centre and to other visible layers' edges and centres, within 6 screen pixels; a
  magenta line (`--snap-guide`) shows each alignment while it's held. A corner keeping its proportions snaps its
  nearer edge exactly and scales both ways. Layers at an angle other than a right angle snap only when moved (by
  their box). Snap is on by default: the magnet over the canvas, ⇧⌘; or Settings › Photo turn it off, and Control
  held during a drag turns it off for that drag. Equal-spacing guides and a document grid are later.
- **Lossless**: a drag previews by resampling the source, and committing changes a matrix. Scaling down and up again
  loses nothing until the user explicitly converts to pixels.
- **Zoom** centres on the pointer; panning doesn't touch the document.
- **Flips and turns (built, `shared/photo/orient.ts`)**: Edit › Transform's Rotate 180°, Rotate 90° Clockwise and
  Counter Clockwise, Flip Horizontal (⌘H) and Flip Vertical (⌥⌘H) act on the selected layers together, about the
  centre of the box around them (Properties has the quarter turns and flips beside the angle). They're exact: a flip
  negates its axis's scale and the angle (a flipped layer's width is −100%), a turn adds to the angle. Image › Image
  Rotation turns or flips the whole canvas: its sides swap on a quarter turn, every layer, point and the selection go
  with it, and the masks in document pixels (adjustments', generators', text's and shapes') are moved pixel for pixel
  (`surface-orient.ts`), as a canvas crop shifts them. Angles inside effects' settings stay, as in Photoshop.
- **100% means one image pixel per device pixel**, so on a Retina display the image looks half its CSS size. The zoom
  readout says this, and DPR changes, window resizes and fractional zooms are tested.
- **Zoom limits**: the smallest zoom fits any document; the largest shows pixel edges.
- **While the view is refining** (see rendering), a subtle indicator says so; it never blocks input.

## Selections, masks and brushes

Built in F3:
- **Selections**: a rectangle is document-space coverage with antialiased edges (a pixel half inside is covered by
  half). No selection means everything; an empty selection means nothing. Selection changes are undo steps
  (Photoshop's way). The Rectangular Marquee (M) drags whole pixels, clipped to the canvas (⇧ a square, ⌥ from its
  centre); a click deselects; the marching ants show under every tool, and the options bar says its size.
- **More selection tools** (selections.md): the Elliptical Marquee, the Lassos, the Magic Wand, Quick Selection and
  Select Subject, each meeting the selection by the options bar's mode (Shift adds, Alt subtracts, both intersect);
  the Select menu (All, Deselect, Inverse, Subject, Feather) and the canvas's right-click menu.
- **Masks**: Layers' Add a mask button (and the Layers menu) gives the active layer a mask: from the selection when
  there is one (that coverage in the layer's own pixels, following the layer from then on), else revealing
  everything. Its thumbnail sits beside the layer's; clicking either targets what the brush paints (outlined).
  Painting a mask: black hides, white reveals, and the source is untouched. Properties says what it does, and
  remakes it from the selection or deletes it.
- **The first brush** (B) is round, with size, hardness and strength in the options bar (numbers dragged sideways,
  clicked to type, as Premiere's). The Eraser (E) takes painted pixels away (on a mask it paints the background
  colour). The colours are every tool's: the foreground and background swatches at the foot of the tool strip, each
  opening the app's colour picker.
  Dabs are spaced in document pixels and come out the same at any zoom and pixel density (the same samples make the
  same tiles). The selection caps what a stroke paints by its coverage: a half-covered pixel gets half of the
  stroke. Its circle follows the pointer. A placed image asks first (New paint layer, or Convert to pixels); an
  adjustment paints its mask (given one when it has none); a hidden layer refuses, saying why. Escape mid-stroke
  drops it.
- **Later brush controls**: Opacity and Flow only once their accumulation equations are written and tested. Pressure,
  texture, scatter and smoothing follow their own research; nothing is guessed from browser pointer behaviour.

## Effects

- **Adding**: exposure and curves are adjustment layers, made from the Layers panel's half-filled circle (above the
  selected layer, as Photoshop's), shown in Layers with their icon and settings in a few words, edited in
  Properties (sliders with fields; Curves' graph, research/adjustments.md). **Built (F4)**: the same menu's "Light"
  heading adds a Glow to the selected layer (also the Layers menu's Add Glow Filter) and a Lens Flare as a new layer.
  A layer's filters are listed under it as Photoshop's Smart Filters (a "Filters" row whose eye bypasses all, then
  each with its eye, the last applied on top, dragged to reorder); a click shows one in Properties, Delete removes
  it. A flare's Properties has its handles, intensity, colour, blend (Add in linear light, or Normal), a preset menu
  and its elements (an eye each, + to add, dragged to reorder, the selected one's parameters below). Its source and
  optical centre are handles on the canvas with the Move tool (snapping; Escape cancels), and a Move drag where no
  layer is moves both. Folding a layer's filters away is still to come. **Built (F5)**: the header's **Filter**
  menu (Photoshop's): Last Filter (⌃⌘F, Ctrl+Alt+F elsewhere: the filter added last, again, on the active layer with
  its settings now), Filter Gallery…, then each category's filters, each a submenu of its looks. The **Filter
  Gallery** window lists every look as a card previewed on this photo (the active layer with it, or a generator
  added), searchable, by category; a click applies it (one undo step) and Properties then shows it. On an adjustment
  layer a filter's cards say they can't apply. Both are built from the catalogue, so a new filter appears in them
  with no UI of its own.
- **Undo**: a slider drag or a handle drag is one undo step.
- **Bypass and remove**: bypass keeps the settings; remove is undoable.
- **Presets**: preview without touching history, then apply in one step.
- **Compare**: views of the original or with an effect bypassed never change the document.

## Saving, progress and failure

- **The header's state**: saved, saving, not saved (with the reason) or failed. A preview updating doesn't mean an
  edit was saved.
- **Long work**: imports and exports show progress and can be cancelled, and editing stays responsive meanwhile.
  **Built (F5)**: an export's Cancel (or Esc) stops it while it renders and nothing is written; once every band is
  rendered the file is being written ("Writing the file…"), which can't be stopped. A stroke the GPU loses midway
  says so ("The GPU stopped mid-stroke"); a photo whose pixels are missing on opening says what opened instead.
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
