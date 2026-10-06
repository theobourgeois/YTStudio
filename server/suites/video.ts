import { hasMedia } from "../../shared/effects.ts";
import { normalizeProject } from "../../shared/normalize.ts";
import { nestedSequence, sequenceView } from "../../shared/sequences.ts";
import { createDefaultProject, isOnVideoTrack, projectDuration } from "../../shared/timeline.ts";
import type { Project } from "../../shared/types.ts";
import { isObject } from "../storage.ts";
import type { SuiteBackend } from "./suite.ts";

/**
 * The earliest media clip on any video track (the bottom-most track wins a tie); for a nested
 * sequence there, the earliest in that sequence, and so on.
 */
function firstVideoClip(doc: Project, depth = 0): Project["clips"][number] | undefined {
  const layer = (trackId: string) => doc.tracks.findIndex((t) => t.id === trackId);
  const first = doc.clips
    .filter((c) => isOnVideoTrack(doc, c) && hasMedia(c))
    .sort((a, b) => a.start - b.start || layer(b.trackId) - layer(a.trackId))[0];
  const seq = first && nestedSequence(doc, first);
  if (!seq || depth > 8) return first;
  return firstVideoClip(sequenceView(doc, seq.id), depth + 1);
}

/** The video editor: `Project` documents (`shared/types.ts`), normalised by `normalizeProject`. */
export const videoSuite: SuiteBackend<"video"> = {
  suite: "video",
  create: (name) => ({ ...createDefaultProject(), name }),
  normalize(doc, media) {
    if (!isObject(doc)) throw new Error("Not a project.");
    return normalizeProject(doc as unknown as Project, media);
  },
  stats: (doc) => ({
    name: doc.name,
    aspectRatio: doc.settings.aspectRatio,
    duration: projectDuration(doc),
    clipCount: doc.clips.length,
    coverAssetId: firstVideoClip(doc)?.assetId ?? null,
  }),
  remapMedia(doc, ids) {
    const copied = <T extends { assetId: string }>(x: T): T => (ids.has(x.assetId) ? { ...x, assetId: ids.get(x.assetId)! } : x);
    const subclips = doc.subclips?.map(copied);
    // Nested sequences' clips play the copies too (a clip of a sequence keeps its sequence's id).
    const sequences = doc.sequences?.map((seq) => ({ ...seq, clips: seq.clips.map(copied) }));
    return { ...doc, clips: doc.clips.map(copied), ...(subclips && { subclips }), ...(sequences && { sequences }) };
  },
  assistant: {
    context: "the playhead and the selection at the moment they sent it. \"This clip\", \"these\", \"here\" refer to that selection and playhead",
    background: "the playhead is at 0 and nothing is selected, and focus does nothing",
    instructions: `\
Tools for a local video editor that works like Premiere Pro, made for short-form video (9:16 by default). \
They act on the video open in the editor tab (unless you're told otherwise), live: the user sees every change as it happens, and each edit \
tool call is one undo step for them.

How the timeline works:
- Times are seconds. "Timeline" times are positions in the edit; "source" times are positions in a media file. \
A clip plays its media from \`in\` to \`out\` (source) starting at \`start\` (timeline), so it covers \
start..start+(out-in), and source time s shows at timeline time start+(s-in).
- Tracks are listed top to bottom: video tracks first (the first one is drawn on top of the others), then \
audio tracks. Clips never overlap on a track; gaps are allowed and show black (or what's below).
- Every clip has built-in effects: motion (position, scale, rotation, anchor; scale 1 = the framed size, \
position in canvas fractions with [0.5, 0.5] the centre), opacity (0..1) and volume (level 0..1). Text clips \
also have text and appearance. Video effects (blur, colour, glitch...) can be added and stacked. Numbers and \
points can be keyframed.
- Transitions sit on clip edges: across a cut between two touching clips on a video track, or at a free edge \
(fading from or to what's below).
- Captions are text clips flagged as captions on their own track; style_captions changes all of them at once.
- Motion graphics, After Effects style: nest_clips turns clips into a nested sequence played by one clip \
(then Motion, effects, speed and remap_time act on the whole group; open_sequence edits inside it); set_parent \
makes clips follow another clip's Motion (often a null object from add_layer kind "null"); remap_time does speed \
ramps, freeze frames and reverses within a clip; set_keyframes takes Bézier handles for custom easing curves, \
and spatial handles that bend a position's path.
- More motion tools: masks (add_effect type "mask": a path the clip only shows inside, in fractions of its frame; \
keyframe the path to animate a reveal); shape layers (add_layer kind "shape": rectangles, ellipses, stars and \
drawn paths with fills and strokes, plus operators such as trim-paths, which draws a line on, and repeater); text \
animators (add_effect type "text-animator", or its presets: text appearing letter by letter or word by word); \
expressions (set_expression: wiggle, loopOut, or a property following another); markers (set_markers: named \
points that clips and keyframes snap to, e.g. a song's beats). get_catalog lists each of them.

How to work:
- Look before you edit: get_timeline first; list_media for what's imported; view_media to watch raw \
footage; get_transcript for what's said (word timings let you cut precisely); analyze_audio for silences; \
analyze_music for a song's tempo, beats, bars and drops; get_layout for where things are on the canvas in px \
(measure before sizing or aligning one thing to another, e.g. a box behind a title); view_frames to check the result. Use get_catalog \
before using an effect, transition or style you haven't seen the parameters of.
- Use ids exactly as tools return them; never invent them. Re-read the timeline after edits that change ids \
(splits, adds) if you need the new ones.
- Pulling the good parts out of long footage (an interview, a stream): find them (get_transcript with \
assetId, view_media, detect_scenes), then make_subclips with names saying what each is. They show in the \
user's Media tab to pick from; put them on the timeline with add_clips subclipId.
- Group related edits with batch so the user can undo them in one go (e.g. cutting every silence).
- Cutting out a stretch inside a clip: split_clips at its start and end, then delete_clips the middle part \
with ripple: true. Work from the end of the timeline backwards when making many cuts, so earlier times don't shift.
- Editing to music: mark_beats on the music clip (its beats become markers the user sees), lay the shots out \
back to back from the first beat, then cut_to_markers: every cut lands on a marker (\`every: 4\` on beats for a \
steady feel, 1 or 2 for a fast montage). analyze_music tells you the song's shape first: land the video's big \
moment on a drop, and to use the best part of a song, start the clip (its \`in\`) a bar or two before a drop.
- Making pictures react to sound (a visualizer, a pulse, a punch on each kick): you can't hear, so find the \
song's shape first (get_signals: its beat, sections, drops and hits; plot_signals to see it). Then link_param \
(the link button by a stopwatch: scale up with the bass, opacity flashing on "onsetLow" kicks with a \`hit\` shape, \
position bouncing on the beat), no code needed; set_expression with audio(), sinceHit(), envelope(), beat() for \
anything a link can't say. define_signal makes the video's own signals (a kick from 40–120 Hz with onsets, a \
snare's crack, a vocal), named so links and expressions can use them; set_events places hits by hand or on beats. \
A look inside a nested sequence hears the song of the video it's placed in. Check it at the hits with \
view_frames \`at\`.
- A look no effect makes (a tunnel, a fractal, a custom visualizer): write it with set_shader (read get_catalog \
"shader_api" first), on a solid for a look of its own or on a clip to change its picture. Declare its knobs as \
parameters so the user can tweak, keyframe and link them; it can read the sound itself (spectrum(), audioBass, \
beatPhase...). If it doesn't compile you get the errors on your lines: fix and call again. Look at it with view_frames.
- After edits, check what you did with get_timeline or view_frames when it matters.`,
  },
};
