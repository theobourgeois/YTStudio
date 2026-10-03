# Editor

A simple, clean video editor for cutting clips together — short-form first (9:16 by default), but any aspect works.
Drag clips and images in, arrange and trim them on the timeline, position them on the canvas, drop music
underneath, export an MP4.

## Quick start

```bash
brew install ffmpeg      # required for import (thumbnails/waveforms) and export
brew install yt-dlp deno # optional: Media → Online (YouTube search, links from TikTok, Instagram, X...)
pnpm install
pnpm samples             # optional: generate a few test clips + a music track in ./samples
pnpm dev                 # server on :5311, app on http://localhost:5310 (next free pair if taken)
```

Then drag files from `./samples` (or anywhere) into the media panel or straight onto the timeline.

### Desktop app (Vaudio)

The same editor in its own window (Electron), with the server running inside the app:

```bash
pnpm dev:desktop         # a window with hot reload, using ./data like pnpm dev (don't run both at once)
pnpm build:desktop       # release/mac-arm64/Vaudio.app: drag it into Applications (unsigned: right-click → Open the first time)
```

Projects are files of their own, in `~/Documents/Vaudio` by default (see below). The built app keeps the rest (its
recents, the Library, settings) in `~/Library/Application Support/Vaudio/data` (Help → Show Data Folder), separate
from `./data`. Double-click a project in Finder to open it, or pick one from File › Open Recent. It finds ffmpeg and
the rest through your shell's PATH, and draws exports in its own Chromium.

## Using it

Every project (a video, a song) is a file of its own: a `.vaudio` package holding its document, its media and
anything else it keeps (a song's plugin settings and recordings). New ones are saved in `~/Documents/Vaudio` (change
it in Settings › General); move, copy, back up or send them in Finder like any other file.

The app opens on **Home**: a tile per kind of project (**New video** `⌘1`, **New song** `⌘2`; `⌥`-click starts blank
when it has a starting point), **Open a project…** (`⌘O`: any `.vaudio` file, from anywhere), and your recent
projects as cards, the latest first, with a search (`⌘F`) and a Videos / Songs filter. Drop clips on Home to start a
video with them. Click a card to open it; right-click it (or its **⋯**) to **Rename** (its file too), **Duplicate**
(a copy beside it, with its own media), **Show in Finder**, **Use as starting point**, **Remove from Recents** (its
file stays: Open… brings it back) or **Move to Trash**. A project moved, renamed or deleted in Finder shows as missing:
**Locate…** it where it is now, or remove it. Inside a project, the house in the top-left corner (`⇧⌘H`) goes back
Home, and `⇧⌘H` again returns to it; `⌘P` finds any project from anywhere and `⇧⌘O` starts a new one. A project
renamed while it's open takes its new file name when it's closed.

| Action | How |
| --- | --- |
| Import | Drop files (video, audio, images) on the media panel / timeline (or click the empty media panel to browse) |
| Add to timeline | Drag from the media panel, double-click, or hover → **+**. Move the mouse across a video's card to skim through it |
| Trim before adding | Click a media card to open it in the preview, then mark the part you want in the trimmer under it (the whole file as a filmstrip, or a waveform for sound): drag the frame's handles, or press `I` / `O` at the playhead (or the `{` `}` buttons). Press anywhere else on it to scrub. **Add to timeline**, dragging the picture, or adding the card later all use only that part (a blue bar on the card shows it). `⇧I` / `⇧O` go to the marks, `⌥X` clears them, `Esc` goes back to the timeline |
| Subclips | Pull several parts out of a long file: in the preview, mark a part (`I`, `O`) and press `⌘U` (or **Make subclip**). It's kept in Media right after its file, named after it ("Interview 1", "Interview 2"…), and the marks clear so you can carry on to the next part. Bars under the trimmer show the parts already kept (click one to open it). A subclip is used like a file (drag, double-click, **+**, save to the Library) and adds just its part. Opening one shows its part of the file: moving its In/Out changes it (undoable), and **of Interview.mp4** in the badge goes back to the whole file. Rename or delete it from its menu; the file stays |
| Select media | In **This video** or the **Library**: `⌘`-click to add or remove a card, `⇧`-click for a run, or drag a box from empty space. Dragging, the right-click menu and `⌫` then act on all of them; `⌘A` selects every card, `Esc` clears |
| Move | Drag clips anywhere on a track (they snap to edges and the playhead; the magnet toggles snapping). Drop above the top track for a new video track. `⌥←` `⌥→` nudge, `⌥↑` `⌥↓` move between tracks |
| Trim | Drag a clip's left/right edge |
| Auto ripple | The chain button under the timeline (off by default). While it's on, deleting a clip closes its gap, trimming or stretching a clip moves the clips after it on its track to keep them joined (the clip keeps its start), and media dropped onto a track pushes the clips after it along instead of looking for a free spot. Moving clips stays free |
| Speed / reverse | Select clips → the gauge button under the timeline (or `⌘R`, or right-click → **Speed** / **Reverse**). `⌥`-drag a clip's edge to stretch its speed to fit. See [Speed and reverse](#speed-and-reverse) |
| Nest | Select clips → `⌥G` (or right-click → **Nest**); double-click the nested clip to edit inside it. See [Nested sequences](#nested-sequences) |
| Parent | **Parent** in a clip's Properties, or drag its pick-whip onto another clip. See [Parenting and null objects](#parenting-and-null-objects) |
| Preview resolution | **Full**, **1/2** or **1/4** next to the canvas tools: fewer pixels keep a heavy edit playing smoothly (exports are always full) |
| Split | `S` (or ⌘B) at the playhead |
| Delete | `⌫` / `Delete` leaves a gap; `⇧⌫` ripple-deletes (closes it). Click an empty stretch of a track and `⌫` to close that gap |
| Play / pause | `Space` |
| Step | `←` `→` one frame, `⇧←` `⇧→` one second, `⌘←` `⌘→` (or `↑` `↓`) previous / next clip start or end, `Home` / `End`. Hold `⌘` while dragging the playhead to snap it to the nearest clip start or end |
| Zoom | `+` / `-`, or ⌘/Ctrl + scroll. Zooming all the way out shows the whole edit |
| Undo / redo | ⌘Z / ⇧⌘Z |
| Select on the canvas | Click a clip in the preview (the topmost one under the pointer); click empty canvas, or anywhere around it, to deselect |
| Move / scale / rotate | Drag the selected clip on the canvas; drag a handle to scale around the anchor point (⇧ stretches instead of keeping the proportions); drag just outside a corner to rotate (⇧ = 15° steps); drag the crosshair to move the anchor point. ⇧ keeps a move on one axis, ⌥ turns snapping off |
| Text | `T` (or the **T** button under the preview), then click the canvas where the text goes and type; `Esc` when done. Double-click a text to type into it again. Font (any font installed on your computer), style, size, colours, stroke, background box and shadow are in **Properties**; **Animator** there animates it letter by letter. See [Text animators](#text-animators) |
| Masks | Select a clip, then **Mask** at the bottom of its Properties (a rectangle or an ellipse), or draw one on the canvas with the Pen (`P`), Rectangle (`R`) or Ellipse (`E`) tool. See [Masks](#masks) |
| Shapes | With nothing selected, the Pen, Rectangle and Ellipse tools draw a shape layer instead (or **Layer** → **Shape layer**). See [Shape layers](#shape-layers) |
| Markers | `M` at the playhead: on the selected clip under it, else on the timeline. `⇧M` / `⇧⌘M` go to the next / previous one, `⌥M` deletes the one at the playhead. See [Markers](#markers) |
| Expressions | `⌥`-click a property's stopwatch (or right-click its name) to drive it with a short script like `wiggle(2, 5)`. See [Expressions](#expressions) |
| Properties | **Properties** tab (or double-click a clip): drag a blue number sideways to change it (⇧ faster, ⌥ finer), click it to type, ↺ resets |
| Panels | Drag a panel's tab onto another panel's tabs to group them, or towards one of its edges to put it beside it; drag the line between two panels to resize them (or focus it and use the arrows). Each panel's **⋯** menu floats it out as a window (its × docks it back), picks a workspace (**Editing**, **Captions**, **Effects**, **Compact**) or resets the layout. The layout is the same in every video. While a clip's keyframes show, Properties takes the room they need |
| Video effects | **Effects** tab → **Video effects**: drag one onto a clip (on the timeline or the canvas) or onto the Properties panel (it goes on the clips it shows), or select clips and press **+**. Change, animate, reorder (⋯) or remove it in **Properties** |
| Copy effects | Right-click a clip → **Copy effects** (`⌥⌘C`), select other clips, right-click → **Paste effects** (`⌥⌘V` pastes all of them, or pick one): values and keyframes, and video effects the clips don't have yet. A text keeps its own words |
| Transitions | **Effects** tab → **Transitions**: drag one onto a cut or a clip's edge, or **+** / `⇧⌘D` for the cut nearest the playhead. Click it on the timeline to select it, drag its edges to change its length, `⌫` removes it |
| Library | **Media** tab → **Library**: media and saved clips shared by every video. Drop files or folders on it, **Add to Library** from a media card's menu, or right-click clips → **Save to Library…**. Drag onto the timeline or double-click to use |
| Auto captions | **Captions** under the timeline (or right-click a clip → **Auto captions…**): pick a style, length and animation, **Generate captions**. Edit them all in the **Captions** tab |

### Video effects

The **Effects** tab's **Video effects** are shader effects you add to clips on video tracks, like Premiere's Video
Effects and After Effects' effects and plugins:

- **Color:** brightness & contrast, hue & saturation, temperature, black & white, sepia, duotone, invert, vignette,
  levels, curves, exposure, vibrance, tint, gradient map, color balance, channel mixer, looks (teal & orange, bleach
  bypass, cross process, noir, warm film, cold night, faded, vintage), leave color, threshold.
- **Blur:** gaussian, directional, zoom, radial (spin/zoom), camera lens blur (bokeh), channel blur, smart blur, sharpen.
- **Light:** Deep Glow, light rays, glint, lens flare, light sweep, chromatic aberration, flash, light leak, bokeh.
- **Stylize:** mosaic, posterize, find edges, glow, film grain, mirror, grid, halftone, CRT, emboss, cartoon, pixel
  sort, dither, ASCII, neon edges, strobe light.
- **Distort:** lens (CC Lens), optics compensation, turbulent displace, polar coordinates, ripple, kaleida, bend,
  offset, transform, wiggle, spherize, motion tile, wave warp, bulge, twirl.
- **Camera and glitch:** shake, pulse, RGB split, glitch, VHS, block glitch, scan tear, digital noise, RGB wave,
  glitch slice.
- **Generate** (best on a solid): fractal noise, gradient ramp, 4-color gradient, shape, checkerboard, particles
  (dust, snow, rain, sparks, stars), cell pattern, radio waves, lines, beam.
- **Keying:** chroma key, luma key, matte choker, invert alpha, fill, drop shadow, outline.
- **Shake:** Shake (Sapphire S_Shake-style: position, rotation, zoom and 3D tilt, with its own motion blur, jaggedness
  and chromatic split) and Impact Shake (a hit that settles).
- **Time:** Echo, Posterize Time, Time Displacement (slit-scan), Frame Blend, Trails (feedback: tunnels, spirals),
  Pixel Motion Blur (optical-flow motion blur, like ReelSmart Motion Blur) and Datamosh. They use the frames
  before, so they show while the video plays and in the export; paused, the preview shows the frame as it is.
- **Particle World:** simulated particles (like CC Particle World and Particular): emit from a point, line, box,
  circle, the layer's own shape, or the edge of the layer dissolving (Thanos-style disintegrate), with velocity,
  spread, gravity, wind, air resistance, turbulence, life, size and colour over life, shapes (glow dots, discs,
  sparkles, squares, rings, bokeh, shards), motion-blurred streaks and bursts. Any frame is exact, however you seek.

Every amount can be keyframed, and each effect also works on an adjustment layer, where it changes everything below.
Filter them by category or search; hover a card to compare before and after (moving effects play).

Drag one onto a clip on the timeline or on the canvas (onto a selected clip: all the selected clips get it), or select
clips and press **+** (with nothing selected it goes on the top clip under the playhead). A clip with effects shows
**fx** on the timeline. In **Properties** each effect has its own section below Volume: its settings (which can be
keyframed), the **fx** bypass switch, reset, and a **⋯** menu to move it up or down (effects are drawn in order,
each over the result of the one before) or remove it. Effects work on the clip's own picture before its Motion, so
they move and scale with it.

### Adjustment layers and solids

Like After Effects and Premiere, layers can change or add to the picture instead of showing media:

- An **adjustment layer** draws nothing itself: its video effects, **Motion** and **Opacity** apply to everything on
  the tracks below it while it lasts. Grade or stylise many clips at once, shake or zoom the whole picture, or put
  effects across a cut. Add one with the **Layer** button under the timeline (over the selected clips, or at the
  playhead), right-click empty track space → **New adjustment layer here**, or `⌥⌘Y`. Dropping a video effect on
  empty track space makes one with that effect (CapCut's effects track).
- A **solid** is a colour filling the canvas (**Layer** → **Solid**, or `⌥⇧⌘Y`). Put generator effects on it (noise,
  gradients, shapes, particles, light), set its **Fill** to 0% for a transparent layer, or tint what's below with a
  blend mode.

Both go on a track above what they should affect. Clicks on the canvas go through adjustment layers to the clips below.

### 3D, cameras and track mattes

- **3D layers:** turn on Motion's **3D Layer** and a clip becomes a card in space: **Position Z** moves it nearer or
  further, **X Rotation** and **Y Rotation** turn it, with true perspective (and motion blur). 3D layers on
  neighbouring tracks are drawn far first. An adjustment layer can be 3D too: the whole picture below as a card
  (the 3D Flip, Tumble and Swing presets).
- **Camera:** **Layer** → **Camera** (`⌥⇧⌘C`) adds a camera clip. While it lasts, 3D layers are seen through it:
  angle of view, point of interest, distance (dolly), orbit X/Y, roll, and depth of field (focus distance and blur
  level). Keyframe them for camera moves around 3D text and pictures.
- **Track mattes:** a clip's Opacity **Track Matte** (Alpha, Alpha Inverted, Luma, Luma Inverted) shows it only through
  the clip on the video track right above it, which then isn't drawn itself: video inside text, text reveals, wipes
  with a moving shape.

### Masks

A mask keeps only part of a clip's picture (After Effects' masks): anything with a picture can have any number of
them, and an adjustment layer's masks say where it changes what's below it.

- **Mask** at the bottom of a clip's Properties adds a **Rectangle** or an **Ellipse**; or draw one straight on the
  canvas with a clip selected: the **Rectangle** (`R`) and **Ellipse** (`E`) tools drag one out (`⇧` keeps it
  square), and the **Pen** (`P`) places it point by point: click for a corner, drag to pull out curve handles,
  click the first point to close it (`Enter` or `Esc` stops).
- A mask's points show on the canvas while it's being edited (**Edit** on its **Mask Path** row, or click its
  outline): drag points, a segment or a curve's handles (`⌥`-drag moves one handle on its own), `⌥`-click a point
  to turn a corner into a smooth point and back, `⇧`-click to select several, `⌫` deletes the selected ones. With
  the Pen, click the outline to add a point. Click anywhere else to go back to moving the clip.
- Each mask has a **Mode** (Add, Subtract, Intersect: they combine in order), **Inverted**, **Feather** (a soft
  edge), **Mask Opacity** and **Expansion** (grown or shrunk). The ⋯ menu reorders and removes them.
- The **Mask Path** has a stopwatch like any property: keyframed, the mask morphs from one shape to the next (a
  wipe, a reveal, following something by hand). Masks cut the picture out before its video effects run, and they
  export exactly as they preview.

### Shape layers

A shape layer draws vector shapes (After Effects' shape layers): boxes and pills behind text, circles, lines,
badges, animated strokes. It's a clip on a video track, with Motion, Opacity, effects, masks and transitions like
any other.

- **Layer** → **Shape layer**, or draw one: with nothing selected, the **Rectangle** (`R`), **Ellipse** (`E`) and
  **Pen** (`P`) tools make a new shape layer; with a shape layer selected they add a shape to it.
- Each **Shape** is a Rectangle, Ellipse, Polygon, Star or a drawn Path, with its position, size, rotation and
  roundness, a **fill** (a colour, or a linear or radial gradient to a second colour) and a **stroke** (width,
  colour, join, cap, dashes). Everything that's a number is animatable.
- **Shape** at the bottom of its Properties adds more shapes and the operators, which change every shape before
  them in the list: **Trim Paths** (animate End from 0% to 100% to draw a line on), **Repeater** (copies, each
  moved, scaled, turned and faded a bit more), **Offset Paths**, **Round Corners**, **Wiggle Paths**, **Zig Zag**
  and **Merge Paths** (add, subtract, intersect or exclude the shapes so far). Reorder them with each one's ⋯ menu.
- On the canvas the handles go around what the layer draws, and a click only selects it on its shapes. Shapes are
  drawn by the browser at whatever size they're shown, so they stay sharp at any scale, in the export too.

### Text animators

An **Animator** (at the bottom of a text's Properties) changes part of a text, After Effects' way: a **range**
over its characters, words or lines (Start, End, Offset), and what the letters inside it get: Position, Scale,
Rotation, Opacity, Blur, Tracking and a Fill Color. Animate the range and the change sweeps across the text.

- The menu has ready-made ones, their range already keyframed from the clip's start (longer for longer texts):
  **Fade in by character**, **Typewriter**, **Pop in by word**, **Rise by word**, **Slide up by line**, **Blur in
  by character**, **Drop in by character**, **Tracking in**. **Blank animator** starts from nothing.
- **Shape** says how the change falls off across the range: all at once (Square), building up or fading out
  (Ramp Up / Down, for soft reveals), or peaking in the middle (Triangle, Round, Smooth: a wave running along).
  **Random Order** picks the letters out of order.
- A text can have several animators, and they're ordinary properties: keyframes, the graph editor and expressions
  all work on them. Captions use them to follow the speech (see [Auto captions](#auto-captions)).

### Markers

Markers are named points in time (Premiere's): for beats, cues and notes.

- `M` adds one at the playhead: on the **selected clip** when the playhead is on it (a clip marker, which stays on
  its frame when the clip moves, is trimmed or split), otherwise on the **timeline's ruler**.
- Click a marker to go to it; **double-click** it (or press `M` on it) for its name and colour; drag a ruler
  marker to move it. `⇧M` and `⇧⌘M` jump to the next and previous marker, `⌥M` deletes the one at the playhead.
- Clips, trims, keyframes and markers themselves **snap** to markers. Each nested sequence has its own.

### Beat sync

Cutting on the beat, without placing the beats by hand:

- Right-click a clip with music → **Mark beats** → **Every beat**, **Every bar** or **Drops only**. The editor
  listens to the song and puts its beats on the clip as markers (bars in blue, drops in red and named), so clips,
  trims, keyframes and the playhead snap to them. They stay on the music when the clip moves or is trimmed.
  **Clear beat markers** removes them and keeps the markers you added yourself.
- Select the clips to cut (lay them out back to back first), right-click → **Cut to the beat**: **Nearest marker**
  ends each clip on the marker closest to where it ends now; **Every marker / 2 / 4 / 8 markers** gives each clip
  that many beats. Clips after them on the track move along, so every cut lands on a marker. A clip is never made
  longer than its media. It cuts to any marker, so markers you tapped in with `M` work too.

### Expressions

An expression is a short script on a property (After Effects' expressions): it runs for every frame, and its
result is the property's value then. Motion that would take dozens of keyframes is one line.

- `⌥`-click a number's or point's **stopwatch**, or right-click its name → **Add expression**. A box opens under
  it, starting with `value` (what the property would be without the expression: its own value or keyframes).
  Under the box is what it gives at the playhead, or what's wrong with it.
- The **ƒ** menu has examples sized for the property: `wiggle(2, 5)` (shake: twice a second, by up to 5),
  `loopOut("cycle")` / `loopOut("pingpong")` (repeat the keyframes for the rest of the clip), `value + time * 90`
  (keep turning), `value + Math.sin(time * 3) * 5` (swing), `posterizeTime(12); value` (stutter).
- The **pick-whip** (the spiral) links properties: drag it onto another property of the clip and the expression
  reads it, e.g. `prop("motion.rotation") / 360` on Opacity.
- It's JavaScript-like (numbers, `[x, y]` points, `+ - * /`, `?:`, `if`/`else`, variables, `Math`) with After
  Effects' helpers (`wiggle`, `loopIn`/`loopOut`, `linear`, `ease`, `clamp`, `random`, `noise`, `valueAtTime`...),
  but it isn't run as JavaScript: the editor interprets it itself, so a project (or the assistant) can't run code
  on your computer. `time` is the clip's own clock in seconds, the one its keyframes are in. Everything random is
  repeatable, so the export matches the preview. Volume can't have one.

### Nested sequences

Like Premiere's nests and After Effects' precomps, clips can become a sequence of their own, played by one clip:

- Select clips and press `⌥G` (or right-click → **Nest**). They move into a new sequence (on copies of their tracks)
  and one clip plays it in their place. Trim it, move it, give it Motion, effects, transitions, a speed or time
  remapping, and it acts on everything inside at once: one zoom over a whole section, a speed ramp over an edited
  montage.
- **Double-click** a nested clip (or its card in the Media tab) to open it in a **tab** above the timeline and edit
  what's inside; changes show wherever it's used. **Main** goes back. Double-click a tab to rename the sequence.
- With a nested sequence open, the **video settings** (the button next to the video's name) are that sequence's own:
  its frame, frame rate and **Length** (as long as its clips, or a set length).
- Nested sequences are listed in the Media tab: drag one onto the timeline to use it again (a sequence can't go
  inside itself). Deleting one there deletes the clips that play it.
- Right-click a nested clip → **Break apart** puts its clips back in its place (for a nest at normal speed).

### Parenting and null objects

- **Parent** (at the top of a clip's Properties) makes a clip follow another one's Motion, like After Effects'
  parenting: moving, scaling or turning the parent carries it along, on top of its own Motion. Pick the parent from
  the menu or drag the **pick-whip** (the spiral) onto a clip in the timeline. Parenting never makes anything jump;
  parents can have parents. Parented clips show a spiral on the timeline.
- **Layer** → **Null object** adds a clip that draws nothing (just an outline on the canvas while editing): parent
  clips to it and animate the null to move them all together.

### Presets

The **Effects** tab's **Presets** are ready-made After Effects-style moves, made from the editor's own effects and
keyframes, so everything they do can be changed afterwards:

- **Transitions** (zoom through, spin, whip pans, glitch cut, twirl, impact shake...) are an adjustment layer centred
  on a cut: the picture speeds away from the outgoing shot with motion blur and mirrored edges and lands in the
  incoming one. Drag one onto a cut, or double-click it / press **+** to put it on the cut nearest the playhead.
  Lengthen the layer or edit its keyframes to retime it.
- **Moves and looks** (punch in, slow push in, entrances and exits, fades, shakes, VHS, dreamy glow...) go on the
  clips you drop them on (or the selected clips): entrances from the clip's start, exits at its end, slow moves over
  all of it. Dropped on empty track space, they make an adjustment layer.

### Transitions

The **Effects** tab's **Transitions** are a library of shader transitions: dissolves and dips, pushes, slides and whips, wipes
and shape irises, camera zooms and spins, 3D cubes, flips, page curls and doorways, glitches (RGB split, VHS,
datamosh, pixelate), light (flash, film burn, light leaks) and distortions (ripple, swirl, liquid). Filter them by tag
or search; hover a card to watch it.

Like Premiere, a transition sits on a clip edge. Between two touching clips it plays across the cut (centred on it,
or starting or ending there: **Alignment**), borrowing media from past the clips' in/out points; where the media runs
out, the first or last frame is held. On a free edge it plays inside the clip, from or into whatever is underneath
(lower tracks, or black). Select a transition to change its duration, alignment and its own settings in the
**Properties** tab.

Exports are drawn frame by frame by the same WebGL compositor as the preview, run in a headless Chromium: Playwright's
(`pnpm exec playwright install chromium-headless-shell`) or your installed Google Chrome (or set `CHROMIUM_PATH`).

### Library

**Media** → **Library** holds things you reuse across videos, like sound effects, logos, intros and music, in folders
(like Resolve's Power Bins or Premiere's Libraries, but local). Every video sees the same Library.

- **Fill it**: drop files on it, or whole folders from Finder (they keep their subfolders, and merge into folders
  with the same name). Use **Import files**, or **Add to Library** in a media card's **⋯** menu. Holding a drag over
  **Library** opens it.
- **Save clips with their settings**: right-click clips on the timeline → **Save to Library…**. This keeps their
  trim, position, scale, opacity, volume, text and transitions, and the tracks they're on. A logo placed in a corner
  or a styled title then drops into any video as is.
- **Find things**: search looks through every folder. You can filter by kind (video, audio, image, saved clips),
  star items to find them in **Favourites**, and **Recent** lists what you used last. Hover a video to scrub through
  it and a sound to hear it; click a file to preview it.
- **Use it**: drag onto the timeline (onto a track, or above/below them for a new one) or double-click (saved clips
  go in at the playhead). The files are copied into the video (cloned, so no extra disk space on APFS). Each file is
  copied only once per video, and deleting something from the Library never breaks a video that used it.
- **Organise it**: drag items and folders onto a folder, or onto the path above the grid to move them up. Rename,
  move or delete from the **⋯** menus.

It lives in `data/library`.

### Assistant (Claude or Codex)

The chat button at the top right (`⌘I`) opens the **Assistant**: ask it to edit the video in plain words ("cut the
silences", "add captions in the yellow style", "put the clips in a good order with the music underneath", "organise my
Library"). It's [Claude Code](https://claude.com/claude-code) or [Codex](https://developers.openai.com/codex) running on
this computer with your own login and subscription, using only the editor's tools: no shell, no files outside the editor.

It can see what you see: the timeline, frames of the edited video (the Program monitor), frames of the raw footage,
what's said (word-timed transcripts), silences and loudness, a song's tempo, beats, bars and drops, shot changes,
the effects and transitions available, and the Library. So "cut this to the music" puts the cuts on the bars and the
big moment on the drop. It can search online like the Online tab ("use Blinding Lights as the music" finds the song,
downloads its sound and puts it under the video). And it can do what you can: add, move, trim, split and delete clips, set any property and keyframe
it, add effects and transitions, add text and captions, mask clips, build shape layers, animate text letter by
letter, write expressions, set markers, mark a song's beats and cut clips to them, import files or links, organise
the Library, and export. It can also measure the canvas (where each clip, and each text's letters, sit in pixels), so
"put a box behind the title" fits the title.

- Every step shows in the chat as it runs; what it changes flashes on the timeline, and a pill over the preview says
  what it's doing. Click a step for its details, or the ⌖ on it to select what it changed.
- Each edit is an undo step (`⌘Z`), and **Revert** under an answer takes back everything it changed at once.
  Anything undo can't bring back (deleting media, deleting from the Library) asks you first.
- Your selection and playhead go with each message, so "this clip" and "here" work. Times in its answers are links.
- Pick the agent and model under the message box: Claude's models (Opus 5.5, Sonnet 5.5, Fable 5.1...) or Codex's
  (the list Codex itself offers). Search them, star favourites, or press `⌘1`–`⌘9` in the picker. Next to it, pick how
  hard it thinks (the levels that model has; **Auto** is its default). You can switch mid-chat: the new agent is told
  what was said so far.
- Each video keeps its own chat, and the conversation carries on after a restart; **New chat** starts over.
- Chats run side by side: ask one video's chat for something, switch to another video and start its chat too. A chat
  always edits its own video (in the background while you're elsewhere; it can still look at its frames), and its
  card on Home says how it's going: **Working** (and the step it's on), **Done** or **Failed** until you look at it,
  or **Needs you** when it's asking before deleting something.

Needs Claude Code (`claude` in a terminal) and/or Codex (`npm install -g @openai/codex`, then `codex login`) installed
and logged in. Set `CLAUDE_PATH` or `CODEX_PATH` if they aren't on the `PATH`.

**Other agents** can use the same tools: the server is an MCP server at `http://127.0.0.1:5311/mcp`. For Claude Code in
a terminal: `claude mcp add --transport http editor http://127.0.0.1:5311/mcp`. Its tools work on the video open in the
editor tab you used last (the editor must be open in a browser), and a notice there shows what they do.

### Auto captions

**Captions** (the timeline toolbar, the **Captions** tab, or right-click a clip) listens to the selected clips, or the
whole timeline, and writes what's said as captions timed to the speech. Choose the language (or let it detect it), a
style (Clean, Bold, Yellow, Boxed, Rounded, Subtitle), how long each caption is (one word, a few words, a line, two
lines), an animation and whether to keep punctuation. **Word by word**, **Highlight** and **Bounce** follow the
speech: each word appears as it's said, or the word being said is coloured or grows (a text animator on each
caption, stepping from word to word at the times they're spoken). Pop, Fade, Rise, Blur, Glitch or any transition
play as each caption appears instead. You can close
the window while it works. The captions land on a **Captions** track on top, as one undoable step.

The **Captions** tab edits them all at once: a preset, the animation, and the Text, Appearance and Motion values
(font, size, case, colours, stroke, box, position...). Below that is the transcript: click a line's time to go to it,
type to fix its words (`Enter` goes to the next one, `⇧Enter` for a new line), and hover a line to join it with the
next or delete it. Each caption is a normal text clip, so you can move, trim and split it on the timeline, and change
one caption's own look in **Properties**.

Transcribing happens on this Mac by default: Whisper large-v3 turbo through [whisper.cpp](https://github.com/ggml-org/whisper.cpp)
on the GPU, free, private and offline. The first time, **Set up** in the window installs whisper.cpp with Homebrew and
downloads the model (574 MB, into `~/.cache/editor/models`, shared by every checkout). Or pick **OpenAI** or **Groq** and
paste an API key (checked, then saved in `data/settings.json`, or set `OPENAI_API_KEY` / `GROQ_API_KEY`). Before any
engine hears the audio, long silences are squeezed out and the word timings are lined up with where the sound actually
is, so captions don't appear early after a pause. Transcripts are cached per clip, so making the captions again in
another length or style is instant.

### Online media (music and clips)

**Media** → **Online** searches YouTube, or takes a pasted link from any site `yt-dlp` supports
(TikTok, Instagram, X, ...). The **Audio / Video** switch picks what **+** adds: just the sound, dropped on an audio
track, or the whole video (up to 1080p, H.264), appended to the main track. Click a thumbnail to hear it first.
Audio is cached in `data/music`, so previewing then adding (or reusing a song in another video) only downloads once.

Sites regularly break `yt-dlp`; if searches or downloads start failing, run `brew upgrade yt-dlp`.
Mainstream songs baked into a video will likely get muted or claimed when posted, so the export window has
**Leave out music**: export without the audio tracks, then add the official sound in TikTok/Instagram when posting.

### Clip properties

The **Properties** panel (right of the monitor, at first) shows the selected clip's effects, like Premiere's Effect Controls:

- **Motion** (clips on video tracks): framing (fit the whole frame, or fill the canvas: that's 100%), position,
  scale, scale width (turn off *Uniform Scale* to stretch), rotation and anchor point. Positions are shown in pixels of
  the video at 1080p, anchor points in pixels of the clip's own media.
- **Motion** also has **Edges** (what shows past the frame when it's zoomed out or turned: mirrored, tiled or its
  edge pixels stretched, instead of black) and **Motion Blur** with a **Shutter Angle** (180° is film's), like After
  Effects' layer switch: fast moves and spins blur along their path.
- **Opacity** (clips on video tracks), with a **Blend Mode**: Normal, Darken, Multiply, Color Burn, Linear Burn,
  Lighten, Screen, Color Dodge, Add, Overlay, Soft/Hard/Linear/Vivid/Pin Light, Hard Mix, Difference, Exclusion,
  Subtract, Divide, Hue, Saturation, Color, Luminosity, and After Effects' Stencil and Silhouette (the layer's alpha
  or luma keeps, or cuts out, everything below it).
- **Solid** (solids): its colour and fill.
- **Volume** (clips with sound).
- Any **video effects** added to it (see above).

Each effect has an **fx** switch to bypass it and a reset button. Images are placed like video. A new image clip is 5
seconds long and can be trimmed to any length, and transparent PNGs show the layers underneath.

### Speed and reverse

Like Premiere's Speed/Duration, any video or sound clip can play faster, slower or backwards:

- Select clips and press the gauge button under the timeline (or `⌘R`): pick a preset (0.25× to 4×), drag the slider
  (0.1× to 10×) or type a speed (`2`, `0.5x`, or a percentage like `50%`). It shows how long the clip lasts then.
  Right-click a clip → **Speed** has the presets too, and the **Speed** section in **Properties** has the same controls.
- **Reverse** plays it backwards. The first time a file is reversed the app makes a reversed copy of it in the
  background (the preview steps through it frame by frame, silently, until that's ready); after that it plays
  smoothly.
- **Keep pitch** (on by default) keeps voices sounding natural at other speeds; turn it off for the chipmunk effect.
- The clip keeps its start, and the clips after it on its track move with its end, so speeding up leaves no gap and
  slowing down never overlaps the next clip.
- **Rate stretch:** hold `⌥` while dragging a clip's edge to change its speed so the same footage fills the new length.
- **Time interpolation** (videos), like Premiere's: **Frame Sampling** repeats or skips frames, **Frame Blending**
  cross-fades them, and **Optical Flow** makes new frames in between from the motion (smooth slow motion, like
  Twixtor). The export is exact; the preview shows it while playing.
- A retimed clip shows its speed on the timeline (with ⟲ when reversed). Keyframes stay on their frames, so an
  animation speeds up (or plays backwards) with its clip. Stills and text have no speed: trim them to change their
  length. Reversed speech isn't captioned.

### Time remapping

Like After Effects' Time Remap and Premiere's speed keyframes, a clip's speed can change within it:

- Turn on **Time Remapping** in the clip's **Speed** section (Properties). Nothing changes until you shape it.
- **Freeze frame** holds the frame at the playhead for a second; **Reverse section** plays the stretch under the
  playhead backwards and then forwards again. The Speed section lists each stretch with its speed: drag or type one
  (a velocity edit). The clip gets longer or shorter and the clips after it move along.
- For ramps, add keyframes to **Time Remapping → Source Time** (the frame shown) and shape them in its **Speed
  graph** (see below): the classic fast–slow–fast edit ramp is two keyframes with long, flat handles.
- It works on nested clips too, so a whole edited section can be ramped at once. The export follows the curve exactly
  (sound included, pieces played faster, slower or backwards); the preview plays it at the curve's speed, and shows
  frozen or backwards stretches frame by frame.

### Keyframes

Any number or point (position, scale, rotation, opacity, volume, text size, stroke...) can be animated, like in
Premiere:

- Click a property's **stopwatch** to animate it: that sets a keyframe at the playhead. From then on, changing the
  value (in the panel, by dragging on the canvas, or with the volume slider) sets a keyframe at the playhead. Turning
  the stopwatch off removes the keyframes and keeps the value showing.
- The **◀ ◆ ▶** navigator next to an animated value jumps to the previous/next keyframe, or adds/removes one at the
  playhead. `[` and `]` jump between all of the selected clip's keyframes.
- **Show keyframes** (the ◆ button next to the clip's name) opens a timeline beside the properties: drag on its ruler
  to move the playhead, click keyframes (⇧/⌘ to add) or drag a box around them, drag them in time (they snap to the
  playhead, other keyframes and frames), double-click one to go to it, and press ⌫ to delete. An effect's own row
  shows all of its keyframes.
- Right-click a keyframe for its interpolation: **Linear**, **Ease In** (slows down into it), **Ease Out** (eases away
  from it), **Ease In and Out** or **Hold** (keeps its value until the next keyframe), and for an eased one its
  **Influence** (After Effects' keyframe velocity): 33% is Premiere's ease; 75–100% hangs near the keyframes and
  whips through the middle, the snappy curve of edit-style zooms and spins.
- The same menu has three ways of **arriving** at a keyframe with a movement of its own, which would otherwise take
  several keyframes: **Overshoot** (goes past the value and settles back; its Influence is how far), **Spring**
  (swings around it and comes to rest; its Influence is how many swings) and **Bounce** (drops onto it and bounces).
  Such a keyframe shows a zigzag on its left side. Dragging a handle in the graph editor takes over the curve.
- **Copy and paste:** with keyframes selected, `⌘C` copies them and `⌘V` pastes them with the first at the
  playhead, on the same properties of whichever clip is selected. Right-click another property's lane → **Paste
  onto…** to put one property's keyframes on another (a number's on a number, a point's on a point).
- **Easy Ease:** `F9` eases the selected keyframes in and out (`⇧F9` in, `⇧⌘F9` out). **Stretch:** `⌥`-drag the
  first or last of several selected keyframes to scale their timing about the other end. **Rove across time**
  (right-click, three or more selected) re-times the ones in between so the value travels at one even speed.
- Keyframed clips show marks on the timeline, and an animated position draws its **motion path** on the canvas,
  with a dot for each keyframe: drag a dot to move that keyframe, `⌥`-click it to make the path pass smoothly
  through it (or straight again), and drag the handles that appear to bend the path (`⌥` moves one on its own).
  The clip keeps an even pace along a curved path; the easing still shapes it in time.
- **Graph editor:** with the keyframes shown, the chart button at the end of a number's (or point's) row opens its
  graph below it: the **Value** graph draws the curve, the **Speed** graph how fast it changes. Drag keyframes (in
  time, and in the value graph up and down), and drag each keyframe's **Bézier handles** to shape the curve, like
  After Effects' Graph Editor: handles stay in line (a smooth keyframe) unless you hold `⌥`; `⇧` keeps a drag
  straight. Choosing an interpolation from the right-click menu puts the handles back.

Keyframes stay on their frame of the media when a clip is moved, trimmed or split, and exports play them exactly.

## How it works

- **Suites** — the editor is growing into a creative suite: every project belongs to one app (`SuiteId`: video, music…),
  chosen when it's made. Projects (each a `.vaudio` package on disk), the Home screen, the URL, assistant chats and the MCP server are shared; each suite brings
  its document (`shared/suites.ts`, `server/suites/`), its workspace and store (`src/suites/`) and its assistant's
  prompt and tools (`shared/suite-tools.ts`). The video editor is below; music is a shell (`shared/music/`, `src/suites/music/`).
- **`src/`** — React + Vite + Tailwind + shadcn/ui. The document lives in the zustand store `stores/editor.ts`
  (project, media library, selection, undo history; autosave is in `stores/autosave.ts`), the playback clock in
  `stores/playback.ts`.
- **`shared/`** — domain types and the pure timeline logic (`timeline.ts`) used by both sides. Every edit is a pure
  `Project -> Project` function, which is what makes undo/redo and testing simple. `normalize.ts` validates any
  stored or received project.
  - `effects.ts`: clip properties. A clip carries a list of effects; each effect definition is a list of typed
    parameter specs (`params.ts`: number, point, switch, choice, text, colour, font) that drive defaults, validation,
    the properties panel and evaluation. Numbers and points can be keyframed (`keyframes.ts`: stored in source-media
    time, with Premiere-style interpolation; `animation.ts`: the edits). To add a property, add a spec (or a
    definition to `EFFECTS`), then draw it in `src/components/preview/engine.ts` and `server/render.ts`.
  - `compositor.ts`: the renderer. One WebGL 2 compositor draws every frame (clips placed by their motion and faded
    by their opacity, transitions mixed by their shaders), in the preview, the library thumbnails and the export.
    `scene.ts` says what each video track shows at a point in time, for both the preview and the export.
  - `effect-library/`, `effect-gl.ts`: video effects, GLSL shaders run over a clip's own picture before it's placed.
    To add one, add a definition to an `effect-library` file; `pnpm tsx scripts/effect-sheet.ts <type or tag>` renders
    a contact sheet and checks it compiles and changes the picture.
  - `transitions.ts`, `transition-windows.ts`, `transition-gl.ts`, `transition-library/`: transitions. Each one is a
    GLSL shader plus parameter specs (like effects). `transition-windows.ts` works out where they play on the timeline,
    `transition-gl.ts` has the shader prelude they're written against. To add one,
    add a definition to a `transition-library` file; `pnpm tsx scripts/transition-sheet.ts <type or tag>` renders a
    contact sheet and checks it starts and ends on the right pictures.
  - `transform.ts`: where a clip lands on the canvas (fit, then scale and rotate around the anchor point, which sits at
    the position). The compositor, the canvas handles and the export all use it.
- **The assistant** — `shared/assistant-tools.ts` lists the video editor's tools for AI agents (each suite has its own,
  gathered in `shared/suite-tools.ts`); `server/assistant/` serves a chat's suite's tools over MCP (`mcp.ts`), runs Claude Code or Codex for the in-app chat (`claude.ts`, `codex.ts`, `service.ts`) and relays every tool call
  to the editor tab (`bridge.ts`), which runs it with the same stores and pure edits as the UI (`src/assistant/`).
  So an agent's edits are live, undoable and can't conflict with the document the tab owns.
- **`server/`** — a small Express server (one router per resource in `server/routes/`) that stores projects and their media in `./data`, probes media and generates
  thumbnails/waveforms with ffmpeg, and renders exports. `render.ts` plans an export (pure): an ffmpeg per visible clip
  decodes its frames at the size they're shown, a headless Chromium page (`gl-browser.ts`) composites every output
  frame with the preview's compositor (`frame-render.ts` drives it), and ffmpeg encodes the result with the sound,
  which is mixed in a pass of its own.

The browser preview plays the original files with hidden `<video>`/`<img>`/`<audio>` elements synced to the playback
clock and draws them on one WebGL canvas with the compositor, so preview and export are drawn by the same code.

Projects, media, the Library and exports are stored in `./data` (override with `EDITOR_DATA_DIR`). Ports: `EDITOR_WEB_PORT`
(5310) and `EDITOR_SERVER_PORT` (5311); if they're taken (another checkout or worktree running), `pnpm dev` moves
to 5410/5411, 5510/5511, ...

Import accepts what the browser preview can play: MP4/MOV/WebM/MKV with H.264, HEVC, VP8/9 or AV1 video,
MP3/AAC/WAV/FLAC/Ogg/Opus audio, and PNG/JPEG/WebP/BMP (or single-frame GIF) images. Phone photos are shown upright
(EXIF orientation). Anything else (e.g. old AVI files, animated GIFs, HEIC) is rejected with a hint.

## Scripts

| Script | |
| --- | --- |
| `pnpm dev` | server + app with hot reload |
| `pnpm test` | unit + server integration tests (vitest; integration tests need ffmpeg) |
| `pnpm test:e2e` | Playwright end-to-end tests in Chromium (isolated server + data dir) |
| `pnpm typecheck` | TypeScript |
| `pnpm build && pnpm start` | production build served by the server on :5311 |
| `pnpm samples` | generate test media into `./samples` |
| `pnpm dev:desktop` | the desktop app with hot reload |
| `pnpm build:desktop` / `pnpm package:desktop` | `release/`: Vaudio.app / a .dmg and .zip |
| `pnpm test:desktop` | launch the built app on throwaway data, export a transition, check it |

Working on the code (architecture, conventions, how to add things): see [CLAUDE.md](CLAUDE.md).
