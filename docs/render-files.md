# Render files (Premiere's preview files)

A heavy edit (raymarched scenes, stacked glows) can cost the GPU far more than a frame's time, so the Program
monitor can't play it live in full. Premiere's answer is **Render In to Out** (Enter): the sequence is rendered to
preview files on disk, the bar along the top of the timeline turns green where it has been, and playback plays those
files instead of drawing the effects. Editing a clip turns only the stretch it covers back to red.

## What Premiere does

- A render bar under the timeline's ruler: **red** (needs rendering to play in real time), **yellow** (may play),
  **green** (rendered), nothing (plays as it is).
- Sequence › Render In to Out (Enter) renders the sequence between its In and Out (the whole sequence when none are
  set) and plays it once done. Delete Render Files throws them away.
- Previews are made per **segment**: the timeline is cut at every edit point, so a change re-renders only the
  segments under it. Undo brings a segment's old preview back (the file is still there).
- Playback and scrubbing use the preview files where they're green.

## Ours

- **Segments** (`shared/render-files.ts`, pure, tested): frame ranges on the main sequence's frame grid, cut
  wherever a video track's clip starts or ends or a transition begins or ends, and every `MAX_SEGMENT` seconds
  besides, so a small change re-renders little. Each has a **key**: a hash of everything its frames depend on (the
  sequence's settings, the video tracks and the clips under it with their parents, the nested sequences and media
  they show, and, when anything there reacts to sound, every clip that sounds and the video's signals). The same
  function runs in the tab (the bar, playback) and on the server (the files' names), so they always agree.
  Red: an unrendered segment showing anything with effects, a transition, an adjustment layer, a nest or a 3D
  layer. Nothing: only plain media, text, solids and shapes. Green: rendered.
- **Files** are the package's own: `<project>.vaudio/render/<key>.mp4` (H.264 at the sequence's 1080p size,
  short GOPs so scrubbing seeks quickly, no sound: the sound is mixed live, as Premiere's video previews are). They
  survive closing the project and go with it. A stale file isn't deleted at once (undo brings it back); past
  `PREVIEW_BUDGET` the oldest go.
- **Rendering** (`server/render-files.ts`): the export's renderer exactly (`planRender` over a range of frames, the
  headless compositor), one Chromium session for each contiguous run of missing segments, each segment's frames
  written to its own encoder. A segment starting inside a clip with a time effect is drawn from a little earlier
  (pre-roll, not encoded), so its echoes are there; simulations step up from their clip's start as the export's do.
  Jobs run one at a time, in the background: the bar turns green segment by segment, and editing meanwhile is fine
  (a segment rendered from an older version is kept under that version's key).
- **Playback** (`PreviewEngine`, `stores/render-files.ts`): where the playhead is in a green segment, the monitor
  shows the segment's file (a pair of hidden videos, the current one and the next parked, like a track's) instead of
  compositing; the media elements still play for the sound. While the file loads or seeks, the picture shown stays
  (drawing the segment live meanwhile is the heavy work the file saves); only a file that won't load is drawn live.
  Anywhere else it draws live, as before. The canvas says which (`data-source`: `render` or `live`).
- **Commands**: Sequence › Render Effects In to Out (Enter, Premiere's name for rendering only what needs it) and
  Delete Render Files; the timeline toolbar's Render (how many parts are red, then how far a render is, Cancel); the
  assistant's `render_effects`. There's no sequence In/Out yet, so it renders the whole sequence (Premiere's
  behaviour with none set).

## Where we still differ

- No sequence In/Out marks; no yellow (we don't guess what plays in real time); main sequence only (a nested
  sequence opened in its tab has no bar).
- Fonts installed after a render don't make its segments red (the key has the text's settings, not its layout).
