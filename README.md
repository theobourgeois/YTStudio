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

## Using it

Every video is its own project with its own media. Start one with **New video** (or drop clips on the empty screen),
work on it, then hit **Settle** when it's done: it moves to the *Settled* pile at the bottom of the sidebar and the
editor jumps to your next video in progress. Open a settled video any time, and **Unsettle** it to put it back in
progress. Right-click a video in the sidebar (or use its **⋯** menu) to settle, duplicate or delete it; a duplicate
gets its own copy of the media. Toggle the sidebar with `⌘\`.

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
| Split | `S` (or ⌘B) at the playhead |
| Delete | `⌫` / `Delete` leaves a gap; `⇧⌫` ripple-deletes (closes it). Click an empty stretch of a track and `⌫` to close that gap |
| Play / pause | `Space` |
| Step | `←` `→` one frame, `⇧←` `⇧→` one second, `⌘←` `⌘→` (or `↑` `↓`) previous / next clip start or end, `Home` / `End`. Hold `⌘` while dragging the playhead to snap it to the nearest clip start or end |
| Zoom | `+` / `-`, or ⌘/Ctrl + scroll. Zooming all the way out shows the whole edit |
| Undo / redo | ⌘Z / ⇧⌘Z |
| Select on the canvas | Click a clip in the preview (the topmost one under the pointer); click empty canvas, or anywhere around it, to deselect |
| Move / scale / rotate | Drag the selected clip on the canvas; drag a handle to scale around the anchor point (⇧ stretches instead of keeping the proportions); drag just outside a corner to rotate (⇧ = 15° steps); drag the crosshair to move the anchor point. ⇧ keeps a move on one axis, ⌥ turns snapping off |
| Text | `T` (or the **T** button under the preview), then click the canvas where the text goes and type; `Esc` when done. Double-click a text to type into it again. Font (any font installed on your computer), style, size, colours, stroke, background box and shadow are in **Properties** |
| Properties | **Properties** tab (or double-click a clip): drag a blue number sideways to change it (⇧ faster, ⌥ finer), click it to type, ↺ resets |
| Left panel width | Drag its right edge (or focus it and use ←/→); double-click the edge for the usual width. It remembers a separate width for when the keyframes show |
| Video effects | **Effects** tab → **Video effects**: drag one onto a clip (on the timeline or the canvas), or select clips and press **+**. Change, animate, reorder (⋯) or remove it in **Properties** |
| Copy effects | Right-click a clip → **Copy effects** (`⌥⌘C`), select other clips, right-click → **Paste effects** (`⌥⌘V` pastes all of them, or pick one): values and keyframes, and video effects the clips don't have yet. A text keeps its own words |
| Transitions | **Effects** tab → **Transitions**: drag one onto a cut or a clip's edge, or **+** / `⇧⌘D` for the cut nearest the playhead. Click it on the timeline to select it, drag its edges to change its length, `⌫` removes it |
| Library | **Media** tab → **Library**: media and saved clips shared by every video. Drop files or folders on it, **Add to Library** from a media card's menu, or right-click clips → **Save to Library…**. Drag onto the timeline or double-click to use |
| Auto captions | **Captions** under the timeline (or right-click a clip → **Auto captions…**): pick a style, length and animation, **Generate captions**. Edit them all in the **Captions** tab |

### Video effects

The **Effects** tab's **Video effects** are shader effects you add to clips on video tracks, like Premiere's Video
Effects: colour (brightness & contrast, hue & saturation, temperature, black & white, sepia, duotone, invert,
vignette), blur (gaussian, directional, zoom, sharpen), stylize (mosaic, posterize, find edges, glow, film grain,
mirror, grid), distortions (wave warp, bulge, twirl), camera moves (shake, pulse) and glitches (RGB split, glitch,
VHS). Filter them by category or search; hover a card to compare before and after (moving effects play).

Drag one onto a clip on the timeline or on the canvas (onto a selected clip: all the selected clips get it), or select
clips and press **+** (with nothing selected it goes on the top clip under the playhead). A clip with effects shows
**fx** on the timeline. In **Properties** each effect has its own section below Volume: its settings (which can be
keyframed), the **fx** bypass switch, reset, and a **⋯** menu to move it up or down (effects are drawn in order,
each over the result of the one before) or remove it. Effects work on the clip's own picture before its Motion, so
they move and scale with it.

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
it, add effects and transitions, add text and captions, import files or links, organise the Library, and export.

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
  always edits its own video (in the background while you're elsewhere; it can still look at its frames), and the
  sidebar shows each video's chat: **Working** (and the step it's on), **Done** or **Failed** until you look at it, or
  **Needs you** when it's asking before deleting something.

Needs Claude Code (`claude` in a terminal) and/or Codex (`npm install -g @openai/codex`, then `codex login`) installed
and logged in. Set `CLAUDE_PATH` or `CODEX_PATH` if they aren't on the `PATH`.

**Other agents** can use the same tools: the server is an MCP server at `http://127.0.0.1:5311/mcp`. For Claude Code in
a terminal: `claude mcp add --transport http editor http://127.0.0.1:5311/mcp`. Its tools work on the video open in the
editor tab you used last (the editor must be open in a browser), and a notice there shows what they do.

### Auto captions

**Captions** (the timeline toolbar, the **Captions** tab, or right-click a clip) listens to the selected clips, or the
whole timeline, and writes what's said as captions timed to the speech. Choose the language (or let it detect it), a
style (Clean, Bold, Yellow, Boxed, Rounded, Subtitle), how long each caption is (one word, a few words, a line, two
lines), an animation (Pop, Fade, Rise, Blur, Glitch or any transition) and whether to keep punctuation. You can close
the dialog while it works. The captions land on a **Captions** track on top, as one undoable step.

The **Captions** tab edits them all at once: a preset, the animation, and the Text, Appearance and Motion values
(font, size, case, colours, stroke, box, position...). Below that is the transcript: click a line's time to go to it,
type to fix its words (`Enter` goes to the next one, `⇧Enter` for a new line), and hover a line to join it with the
next or delete it. Each caption is a normal text clip, so you can move, trim and split it on the timeline, and change
one caption's own look in **Properties**.

Transcribing happens on this Mac by default: Whisper large-v3 turbo through [whisper.cpp](https://github.com/ggml-org/whisper.cpp)
on the GPU, free, private and offline. The first time, **Set up** in the dialog installs whisper.cpp with Homebrew and
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
Mainstream songs baked into a video will likely get muted or claimed when posted, so the export dialog has
**Leave out music**: export without the audio tracks, then add the official sound in TikTok/Instagram when posting.

### Clip properties

The **Properties** tab in the left panel shows the selected clip's effects, like Premiere's Effect Controls:

- **Motion** (clips on video tracks): framing (fit the whole frame, or fill the canvas: that's 100%), position,
  scale, scale width (turn off *Uniform Scale* to stretch), rotation and anchor point. Positions are shown in pixels of
  the video at 1080p, anchor points in pixels of the clip's own media.
- **Opacity** (clips on video tracks).
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
- A retimed clip shows its speed on the timeline (with ⟲ when reversed). Keyframes stay on their frames, so an
  animation speeds up (or plays backwards) with its clip. Stills and text have no speed: trim them to change their
  length. Reversed speech isn't captioned.

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
  from it), **Ease In and Out** or **Hold** (keeps its value until the next keyframe).
- Keyframed clips show marks on the timeline, and an animated position draws its motion path on the canvas.

Keyframes stay on their frame of the media when a clip is moved, trimmed or split, and exports play them exactly.

## How it works

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
- **The assistant** — `shared/assistant-tools.ts` lists the editor's tools for AI agents; `server/assistant/` serves
  them over MCP (`mcp.ts`), runs Claude Code or Codex for the in-app chat (`claude.ts`, `codex.ts`, `service.ts`) and relays every tool call
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

Working on the code (architecture, conventions, how to add things): see [CLAUDE.md](CLAUDE.md).
