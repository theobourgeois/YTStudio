# The Type tool and text layers

The photo suite's Type tool (T), Photoshop's Horizontal Type tool, and the layer kind it makes: a text layer (Photoshop's
type layer), whose words stay editable and are drawn by the browser's own text engine in the user's installed fonts.
Researched 2026-10-06; this is what's built and why. Labels as in [README.md](../README.md#labels).

## What Photoshop does

- **Point text and paragraph text.** A click with the Type tool sets an insertion point and makes *point text*: each
  line grows as it's typed and never wraps; Enter starts a new line. A drag draws a box and makes *paragraph text*:
  the words wrap inside it, and what doesn't fit below its bottom edge is hidden (the box's corner shows a ⊞ that
  says so). Alt-click asks for the paragraph box's size. Layer › Type converts one into the other. (Verified
  reference: Adobe's *Create type*, Envato's *Introduction to the Type tool*.)
- **Where the click is.** The insertion point's crossbar is the baseline: the first line's baseline sits on the click,
  starting there (left aligned), centred on it or ending at it. A paragraph box's first line hangs from its top edge.
- **Typing on the canvas.** The words are typed right on the canvas in the layer's own font, size and colour, with a
  caret and a selection; everything a text field does (arrows, selection by Shift and the mouse, copy and paste,
  input methods) works. Every key the editor would otherwise take is the text's while typing.
- **Committing.** The options bar's ✓, ⌘Enter (Ctrl+Enter), Enter on the numeric keypad, choosing another tool, or a
  click outside the text commit it; since Photoshop CC 2019 Escape commits too, by default (Preferences › Type › *Use
  Esc key to commit text*; unticked it cancels). The options bar's ⊘ cancels: the text goes back to what it was, and
  a new layer goes. A committed type layer with no characters is deleted. The whole typing session is one history
  step ("Type Tool" / "Edit Type Layer"). (Verified reference: Adobe's *Edit text*, Adobe Community threads on the
  Esc preference.)
- **Editing a type layer.** A click with the Type tool on a type layer's words puts the caret there and edits it;
  Shift-click makes a new layer instead, even over existing type. Double-clicking a type layer's thumbnail in Layers
  selects all its words for editing.
- **The new layer.** It goes above the active layer, selected, named after its words (the name follows the words until
  it's renamed). Its colour is the foreground colour. Layers shows it with a **T** for a thumbnail.
- **The options bar** (left to right): orientation, font family (a searchable list, each shown in itself), font style,
  size, anti-aliasing, alignment (left, centre, right), colour, warp, the Character and Paragraph panels, and while
  editing ⊘ and ✓. Changed while a type layer is selected but not being edited, an option restyles the whole layer;
  while typing it styles the selected characters (or what's typed next). With nothing selected it sets what the
  next text is made with.
- **Character panel**: family, style, size, leading (Auto, 120% of the size, or a value), kerning, tracking (in
  thousandths of an em), vertical and horizontal scale, baseline shift, colour, faux bold and italic, caps, super-
  and subscript, underline, strike-through, language, anti-aliasing. **Paragraph panel**: alignment (left, centre,
  right, and four justifications for paragraph text: last line left, centred, right, or all), indents, space before
  and after, hyphenation.
- **Transforming.** Move, scale and rotate type with the Move tool or Free Transform: it stays type, redrawn sharp at
  its new size (a uniform scale shows in the Character panel as a larger size). The type is rasterised at the
  document's resolution: zoomed in past 100% its pixels show, as any layer's do.
- **Everything layers have.** Opacity, Fill, blend modes, layer masks, layer styles (a Stroke and a Drop Shadow on
  words are the commonest of all styles), clipping. Painting or filtering a type layer asks first: *"This type layer
  must be rasterized before proceeding. Its text will no longer be editable."* Layer › Rasterize › Type makes it a
  pixel layer in place, keeping its style.

## What we build

### The document (version 7)

A **text layer** (`TextLayer`, `shared/photo/types.ts`) holds its words and how they're set, and a place:

```ts
interface TextLayer extends LayerBase, Filtered {
  kind: "text";
  text: string;                  // "\n" between lines (point text's breaks; paragraph text's hard returns)
  font: { family: string; style: string; weight: number; italic: boolean; stretch?: string; size: number }; // size in px
  colour: string;                // sRGB "#rrggbb"
  align: "left" | "center" | "right" | "justify";   // justify: paragraph text, its last line left
  leading: number | null;        // px between baselines; null: Auto (1.2 × size)
  tracking: number;              // thousandths of an em, added after every character
  // The Character panel's others (`TextCharacter`), each absent at its default:
  kerning?: "none";              // the font's pair kerning off (Photoshop's 0); absent: Metrics
  horizontalScale?: number;      // glyphs stretched across / up, 1 = 100% (0.01 to 10)
  verticalScale?: number;
  fauxBold?: true; fauxItalic?: true;
  caps?: "all" | "small";        // All Caps draws capitals (the words stay as typed), Small Caps the font's
  underline?: true; strikethrough?: true;
  box: { width: number; height: number } | null;    // paragraph text's box (layer px); null: point text
  size: { width: number; height: number };          // its frame: the words' ink and their lines, in layer px
  origin: { x: number; y: number };                 // the text's origin in its frame
  transform: LayerTransform;                         // places the frame, as an image's or a pixel layer's
}
```

The words are laid out from their **origin**: point text's is its anchor, the first baseline at the alignment's point;
paragraph text's is its box's top-left. The **frame** is measured by the tab when the words or their setting change
(the lines' boxes and the glyphs' ink, rounded out), so the Move tool, snapping, handles and the assistant know a
text layer's box without measuring fonts, and the server can check one. An edit that changes the frame keeps the
origin where it was on the canvas: typing grows left-aligned point text to the right, centred text both ways, and a
paragraph box stays put. `size` and `origin` are trusted only as a frame: drawn on a computer without the font, the
fallback font's glyphs may reach past it (they're drawn, clipped to the canvas's reach).

A text layer is **placed** (`isPlaced`): Move moves, scales and rotates it through its transform, with the same
handles as an image's. Its **mask is in document pixels**, as an adjustment's and a generator's are: it doesn't
follow the layer when it moves, but it doesn't drift when the words change either (see "Where we still differ").

`normalizePhotoProject` checks every field (a family of up to 200 characters, a weight 1–1000, a size of 1 to 5000
px, a colour, an alignment, a leading of 1 to 10 000 px or Auto, tracking −1000 to 10 000, a box and a frame of
positive sizes, words up to 100 000 characters, the character settings), repairing what's wrong to its default.
Version 7 describes text layers; an older document is a valid version 7. The character settings came later without a
new version: each is absent at its default, so a text without them is stored, keyed and drawn as before.

### Drawing it: a text raster in document pixels

The browser draws the words, in the tab, with the 2D canvas's `fillText`: any installed font, the same engine that
measured them. Where it joins the renderer was the main choice:

- **Rejected: a surface of tiles in the document**, as a pixel layer's. The words would be pixels on the server (the
  publication gate, uploads) and stale the moment the font or the words change.
- **Rejected: the words drawn in the layer's own pixels and resampled through its transform**, as an image is.
  Scaled up with the Move tool they'd blur, which type never does in Photoshop.
- **Chosen: the words drawn in document pixels through the layer's whole transform**, by a seam any content the 2D
  canvas draws can use (vector shapes next): `shared/photo/canvas-content.ts` says what of a layer is drawn
  (`canvasContentOf`: a `CanvasContent`, its transform, its frame and how far its ink may pass it) and where
  (`canvasRaster`: a `CanvasRaster`, the content, its matrix into the raster and an integer box on the canvas grid,
  keyed). The plan (`compileRender`) turns such a layer into a `CanvasNode`, a draw node like a pixel layer's. The
  renderer keeps a `CanvasImage` per raster key (`render/canvas-content.ts`; `drawCanvasContent` draws each kind, a
  text by `render/text-draw.ts`): text's coverage is drawn once in white on a transparent canvas, then made
  premultiplied linear light in the layer's colour (exactly its colour: coverage only scales it), its pyramid's
  levels reduced on the CPU (`text-pyramid.ts`), in pinned atlas slots (nothing to fetch, so always resident). The
  node's matrix is a whole-pixel translation, so the layer pass reads it texel for texel. Everything else is the
  layer pass's: opacity, Fill, blend modes and Blend If, the mask (its frame is the canvas when the layer has a mask,
  so the mask's pixels and the raster's are the same), layer styles (their fields are made from the raster's pixels,
  the layer's box for Align with Layer), filters (the raster is the content they run on), and Rasterize Type.

So the view, exports, Home's cover, the Layers thumbnails and the assistant's pictures all draw it through the same
evaluator, at the document's resolution, as Photoshop rasterises type. Moving, scaling or rotating the layer draws it
again (a few milliseconds for a headline). Zoomed past 100% its pixels are magnified, as Photoshop's are: "what's
seen is what exports" (ledger A06) rules out drawing the screen sharper than the export.

### Layout (`shared/photo/text.ts`, pure)

`layoutText` lays the words out with a measurer (the tab's: a 2D context with the layer's font, letter spacing and
stretch; tests use a fixed-width one): lines, each one's start in the words, its x and baseline, its advance and its
ink. Point text breaks only at "\n". Paragraph text wraps greedily at spaces as a `<textarea>`'s `pre-wrap` does
(spaces hang at a line's end; a word wider than the box breaks between characters), and lines whose bottom passes the
box's are hidden. The baseline sits in each line box as CSS puts it (half the leading above the font's ascent), so a
`<textarea>` set in the same font, line height and letter spacing lines up with the drawn words letter for letter.
`textFrame` is the frame and origin; `caretAt` the character under a point (a click that starts editing puts the caret
there).

The character settings go through the measurer (the tab's measures in the font's kerning or none, in small caps, in
capitals for All Caps, and scales advances, ink and ascent by the horizontal and vertical scale), so the layout is
unchanged by them. The frame adds Faux Italic's slant (0.2 of the ink's ascent right, of its descent left), Faux
Bold's outline (0.035 em, half outside) and the underline's bar. The drawing (`render/text-draw.ts`) places each
piece of a line on its baseline through the glyphs' own map (scale, then the slant), strokes the outline for Faux
Bold, and draws the bars along each line. The editing field is set unscaled and scaled as a whole (its line height
divided by the vertical scale), with `font-kerning`, `font-variant-caps` and `text-transform`, so its caret still
falls between the drawn letters.

### The tool (`src/suites/photo/toolbox/type-tool.tsx`, `toolbox/type/`)

- **A click** on the canvas makes point text there (the click on the first baseline); **a drag** draws a dashed box and
  makes paragraph text in it. **A click on a text layer's words** edits it, the caret where it was clicked;
  **Shift-click** makes a new one even there. The pointer is the I-beam. **A double-click on text with the Move tool**
  edits it too (the Type tool is picked), the caret where it was clicked.
- **Moving text.** The Move tool drags text (and shapes) by whole document pixels, as Photoshop's layers move: the
  raster's key holds where its content falls within a pixel but not which pixel, so a whole-pixel move places the raster
  already drawn again rather than drawing and uploading it at every step of the drag (which made dragging text slow).
- **Editing** is a `<textarea>` over the layer (`TypeEditor`), transformed with it (its matrix to the screen), in the
  layer's font, size, letter spacing, line height and alignment: its letters are transparent and the renderer draws
  the real ones under it, so only the caret and the selection (the theme's brand colour) show. A dashed outline shows
  the frame; a paragraph box has handles that resize it (the words reflow). Every keystroke is an edit of the open
  gesture, drawn at once; the whole session is **one undo step**, made when it's committed.
- **Commit**: Escape, ⌘Enter (Ctrl+Enter), Enter on the numeric keypad, the options bar's ✓, another tool, another
  layer selected, a press on the canvas outside the text (that press does nothing else), or the photo closing. A new
  layer still empty is dropped (nothing in history); an edited one emptied is deleted in that step. **Cancel** (the
  options bar's ✕) puts everything back.
- The photo's keys stay out of the way while typing: the editor's key listener skips text fields (`isTyping`), so V,
  Delete, Space, ⌘J and the rest are the text's.
- **The options bar**: font family (a searchable list of installed fonts, each in itself, `src/stores/fonts.ts`, now
  the platform's; styled as every select is), style (the family's installed styles), size (px, dragged or typed),
  alignment, colour, the Character button (a popover of the Character panel's other settings), and while editing ✕
  and ✓. **Font preview**: the family under the pointer in the list (or reached with the arrows) is drawn on the text
  the choice would restyle (`PhotoUi.textPreview`, applied where the canvas's document is made, `live.ts`), never in
  the document; closing the list takes it away. The families chosen lately (in any font picker, the video editor's too: `useRecentFonts`, ten, this
  computer's) head the list under **Recent**, as Photoshop's menu does, until a search. While typing they set the layer being typed; with text layers selected they restyle them all, one
  undo step; otherwise they're what the next text is made with (kept on this computer). The colour swatch shows the
  foreground colour when no text layer is selected, and new text takes it.
- **Properties** has a **Character** section (family, style, colour, size, leading with Auto, tracking, kerning,
  horizontal and vertical scale, and the type buttons: Faux Bold, Faux Italic, All Caps, Small Caps, Underline,
  Strikethrough; `type/character.tsx`, also the options bar's popover) and a **Paragraph** section (alignment, point or paragraph text, the box's size) for a text layer, under its transform.
- **Layers** shows a text layer's thumbnail as a **T** and its name, which follows its words until it's renamed.
  Double-clicking the T edits it with every word selected.
- **Painting a text layer** asks first, as an image does (a new paint layer above it, or *Rasterize Type*). Layer ›
  Rasterize Type (the Layers menu) makes it a pixel layer in place: its words, filters and mask baked in, its style
  kept as a style.

### The assistant

`add_text_layer` (words, where: a point for point text or a box for paragraph text, font, style, size, colour,
alignment, leading, tracking, kerning, horizontal and vertical scale, faux bold and italic, caps, underline,
strikethrough, above), `set_text` (any of the words, setting, box: `null` makes it point text) and
`rasterize_type`. `get_photo` describes a text layer by its words and setting, point or paragraph, and its frame.
Their edits measure through the tab's layout (`PhotoEditEnv.measureText`); a test's is fixed-width.

## Where we still differ

- **One style per layer.** Photoshop styles any run of characters (one word bold, another red); here the setting is
  the whole layer's, and an option changed while typing restyles all of it.
- **No** vertical type, warp, type on a path, type masks, manual kerning between two characters or Optical kerning
  (Metrics or 0 only: the canvas has no optical kerning), baseline shift, super- and subscript, hyphenation, indents,
  space before and after, OpenType features, Glyphs panel, or anti-aliasing methods (the browser's own smoothing,
  greyscale, always). Underline and strike-through sit where a fraction of the em says, not where the font's own
  metrics would (the canvas doesn't report them); Faux Bold and Faux Italic are our own amounts.
- **Justify** is one of Photoshop's four (last line left).
- **Masks don't follow the text** when it's moved (they're in document pixels, as an adjustment's are), so a moved
  text layer's mask stays where it was. Photoshop's linked mask moves with the layer.
- **Leading and the first line** follow CSS's half-leading (so the editing field matches the drawn words) rather than
  Photoshop's: a paragraph's first baseline is slightly lower with a large leading.
- **The font size isn't changed by scaling**: a text layer scaled with the Move tool keeps its size and has a scale in
  its transform (drawn sharp all the same); Properties shows both.
- **Fonts are this computer's.** A photo opened where its font isn't installed draws in the browser's fallback (the
  font picker warns), and its stored frame may no longer fit the words exactly.
- No Alt-click paragraph size dialog, no Shift-drag to constrain the box, no ⌘-drag to move text while typing, no
  overflow ⊞ on a paragraph box (its hidden lines are just hidden), no Esc preference (it always commits; ✕ cancels).
- A text layer with filters is drawn as any layer with filters is (Photoshop asks to rasterise it or make it a Smart
  Object first).

## Sources

- Adobe, [Create type](https://helpx.adobe.com/photoshop/using/creating-type.html) and [Edit text](https://helpx.adobe.com/photoshop/using/editing-text.html) (Photoshop User Guide).
- Envato Tuts+, [A comprehensive introduction to the Type tool](https://design.tutsplus.com/tutorials/a-comprehensive-introduction-to-the-type-tool--psd-2905) (the options bar's order, the Character panel's units).
- Adobe Community, [Esc to cancel / commit text](https://community.adobe.com/t5/photoshop-ecosystem-discussions/esc-to-cancel-commit-text-alert-keeps-reappearing/td-p/9957229) (the Esc preference, CC 2015 on).
- CreativePro, [Secrets of the Esc key](https://creativepro.com/?p=25644).
- O'Reilly, Photoshop CS4 Bible, [Paragraph Type](https://www.oreilly.com/library/view/photoshop-cs4-bible/9780470345177/9780470345177_paragraph_type.html).
