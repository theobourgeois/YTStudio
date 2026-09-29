/**
 * The editor's tools for AI agents, served over MCP (`server/assistant/mcp.ts`)
 * to the in-app assistant (Claude Code run by the server) and to any MCP client,
 * e.g. Claude Code in a terminal: `claude mcp add --transport http editor http://127.0.0.1:5311/mcp`.
 *
 * Every tool runs in the editor tab (`src/assistant/tools.ts`): edits go
 * through the editor store like the user's own (one undo step each, live on
 * screen), and what the browser can't do (frames from files, audio analysis)
 * it asks the server for. The server only relays calls (`server/assistant/bridge.ts`).
 *
 * The assistant should be able to do anything the user can. When a feature is
 * added to the editor, add (or extend) a tool here and its handler in
 * `src/assistant/`; TypeScript then insists every tool has a handler.
 */

type Schema = Record<string, unknown>;

const num = (description: string, extra: Schema = {}): Schema => ({ type: "number", description, ...extra });
const int = (description: string, extra: Schema = {}): Schema => ({ type: "integer", description, ...extra });
const str = (description: string, extra: Schema = {}): Schema => ({ type: "string", description, ...extra });
const bool = (description: string): Schema => ({ type: "boolean", description });
const oneOf = (values: readonly string[], description: string): Schema => ({ type: "string", enum: values, description });
const arr = (items: Schema, description: string, extra: Schema = {}): Schema => ({ type: "array", items, description, ...extra });
const obj = (properties: Record<string, Schema>, required: string[] = [], description?: string): Schema => ({
  type: "object",
  properties,
  ...(required.length && { required }),
  additionalProperties: false,
  ...(description && { description }),
});
/** Parameter values of an effect or transition: keys and value types as listed by `get_catalog`. */
const params = (description: string): Schema => ({ type: "object", description, additionalProperties: true });

const clipIds = (description = "Clip ids (from get_timeline)."): Schema => arr(str("Clip id"), description, { minItems: 1 });
const time = (description: string): Schema => num(`${description} Timeline seconds.`, { minimum: 0 });

/** What a tool does to the video, which decides how it's run and shown. */
export type ToolKind =
  /** Only reads (safe to repeat, no undo step). */
  | "look"
  /** A synchronous edit of the timeline: one undo step, can go in a `batch`. */
  | "edit"
  /** Anything slower or outside the timeline (captions, imports, the Library, export). */
  | "action";

export interface ToolSpec {
  name: string;
  /** Short title for people (the chat shows `describeToolCall` instead where it can). */
  title: string;
  description: string;
  inputSchema: Schema;
  kind: ToolKind;
  /** Deletes something undo can't bring back: the user confirms it in the app first. */
  destructive?: boolean;
  /** How long the tab may take (seconds); 120 by default. */
  timeout?: number;
}

const tool = <N extends string, K extends ToolKind>(spec: ToolSpec & { name: N; kind: K }) => spec;

/** Every tool, in the order clients list them. */
export const ASSISTANT_TOOLS = [
  // -------------------------------------------------------------------------
  // Looking
  // -------------------------------------------------------------------------
  tool({
    name: "get_timeline",
    title: "Read the timeline",
    kind: "look",
    description:
      "The open video: settings, length, playhead, selection, and every track with its clips (id, timeline range, " +
      "source range, media, non-default properties, effects, transitions, keyframes). Start here. Captions are " +
      "summarised unless `captions` is true.",
    inputSchema: obj({
      from: time("Only clips that end after this."),
      to: time("Only clips that start before this."),
      trackId: str("Only this track."),
      captions: bool("List every caption clip with its text (default: a summary)."),
    }),
  }),
  tool({
    name: "get_clips",
    title: "Read clips",
    kind: "look",
    description:
      "Everything about some clips: every property of every effect (with keyframes, at timeline times), " +
      "transitions, the source range and the media.",
    inputSchema: obj({ clipIds: clipIds() }, ["clipIds"]),
  }),
  tool({
    name: "list_media",
    title: "List media",
    kind: "look",
    description:
      "The video's imported media files (id, name, kind, length, size, frame rate, has audio, where it's used). " +
      "Add one to the timeline with add_clips.",
    inputSchema: obj({}),
  }),
  tool({
    name: "view_frames",
    title: "Look at the video",
    kind: "look",
    description:
      "Pictures of the edited video (the Program monitor, with every effect, text and transition) at timeline " +
      "times. Moves the playhead, so the user sees what you're looking at. Use it to check framing, text and " +
      "the look after edits.",
    inputSchema: obj(
      {
        times: arr(time("A moment."), "Up to 8 timeline times.", { minItems: 1, maxItems: 8 }),
        width: int("Width of each picture in px (default 480, at most 960).", { minimum: 64, maximum: 960 }),
      },
      ["times"],
    ),
  }),
  tool({
    name: "view_media",
    title: "Look at footage",
    kind: "look",
    description:
      "Frames of a media file itself (source time, no edits applied): at given source times, or `count` frames " +
      "spread evenly over `from`..`to` (default the whole file), like a contact sheet. Use it to find the good " +
      "parts of raw footage before putting it on the timeline.",
    inputSchema: obj(
      {
        assetId: str("Media id (from list_media)."),
        times: arr(num("Source seconds."), "Source times (up to 16).", { maxItems: 16 }),
        count: int("Evenly spread frames instead of `times` (default 6, at most 16).", { minimum: 1, maximum: 16 }),
        from: num("Start of the range for `count` (source seconds).", { minimum: 0 }),
        to: num("End of the range for `count` (source seconds)."),
        width: int("Width of each frame in px (default 320, at most 960).", { minimum: 64, maximum: 960 }),
      },
      ["assetId"],
    ),
  }),
  tool({
    name: "get_transcript",
    title: "Read the transcript",
    kind: "look",
    timeout: 1800,
    description:
      "What's said in clips, word by word with timeline times ([start, end, word]). Transcribes on first use " +
      "(can take a while; later calls are cached). Default: every clip that's heard. Use it to cut by content " +
      "(remove ums, repeats, the boring part, find the hook).",
    inputSchema: obj({
      clipIds: arr(str("Clip id"), "Clips to transcribe (default: every audible clip)."),
      language: str('"auto" (default) or an ISO 639-1 code like "en".'),
      engine: oneOf(["local", "openai", "groq"], "Transcription engine (default: the first one that's set up)."),
    }),
  }),
  tool({
    name: "analyze_audio",
    title: "Analyse the sound",
    kind: "look",
    timeout: 600,
    description:
      "Silences (quiet stretches, with timeline times) and loudness of clips with sound. Use it to cut dead air " +
      "or balance levels. Default: every clip with sound. For music's beats and drops, use analyze_music.",
    inputSchema: obj({
      clipIds: arr(str("Clip id"), "Clips to analyse (default: every clip with sound)."),
      minSilence: num("Shortest silence to report, seconds (default 0.4).", { minimum: 0.05 }),
      threshold: num("Quieter than this counts as silence, dB (default -35).", { maximum: 0 }),
    }),
  }),
  tool({
    name: "analyze_music",
    title: "Find the beat",
    kind: "look",
    timeout: 600,
    description:
      "The rhythm and shape of music: tempo (BPM), every beat, the bars (every 4th beat, where a new phrase " +
      "feels right), loud and quiet sections, and the drops (where the energy jumps up, e.g. the beat coming " +
      "in). Give a clip (timeline times, only inside the clip) or a media file (source times, optionally " +
      "`from`..`to`). Use it to cut on the beat or the bar, to line an edit's big moment up with a drop, or to " +
      "pick which part of a song to use.",
    inputSchema: obj({
      clipId: str("A clip with sound (answers in timeline times)."),
      assetId: str("Or a media file with sound (answers in source times)."),
      from: num("Media files: start of the range, source seconds.", { minimum: 0 }),
      to: num("Media files: end of the range, source seconds."),
    }),
  }),
  tool({
    name: "detect_scenes",
    title: "Find shot changes",
    kind: "look",
    timeout: 600,
    description: "Where the picture cuts to a new shot in a video file (source times). Use it to split raw footage into shots.",
    inputSchema: obj(
      {
        assetId: str("Media id."),
        threshold: num("How different frames must be, 0..1 (default 0.3; lower finds more).", { minimum: 0.05, maximum: 1 }),
      },
      ["assetId"],
    ),
  }),
  tool({
    name: "get_catalog",
    title: "Browse the catalogue",
    kind: "look",
    description:
      "What exists to use: `video_effects` (type, tags, parameters), `transitions` (type, tags, parameters), " +
      "`clip_properties` (the built-in effects every clip has: motion, opacity, volume, text, appearance), " +
      "`caption_styles` (presets, lengths, animations), or installed `fonts`. Parameters list key, kind, " +
      "default and range: values are in these units (e.g. scale 1 = 100%, position in canvas fractions).",
    inputSchema: obj(
      {
        kind: oneOf(["video_effects", "transitions", "clip_properties", "caption_styles", "fonts"], "What to list."),
        query: str("Filter by name or tag."),
      },
      ["kind"],
    ),
  }),
  tool({
    name: "search_online",
    title: "Search online",
    kind: "look",
    timeout: 120,
    description:
      "Search YouTube (like the Online tab) for a song or clip: title, channel, length, whether the channel is " +
      "verified (usually the official upload), and its URL. To use one, import_media with its URL (urlKind " +
      '"audio" for a song, "video" for footage), then add_clips.',
    inputSchema: obj(
      {
        query: str('What to look for, e.g. "Blinding Lights The Weeknd".'),
        limit: int("Most results (default 8, at most 20).", { minimum: 1, maximum: 20 }),
      },
      ["query"],
    ),
  }),
  tool({
    name: "get_library",
    title: "Browse the Library",
    kind: "look",
    description:
      "The Library shared by every video: folders (tree) and items (media files, and saved clips), with ids. " +
      "Filter with `query` or `folderId`.",
    inputSchema: obj({
      query: str("Search item names."),
      folderId: str("Only this folder's contents (and its subfolders)."),
    }),
  }),

  // -------------------------------------------------------------------------
  // Editing the timeline (each call is one undo step; `batch` makes several one)
  // -------------------------------------------------------------------------
  tool({
    name: "add_clips",
    title: "Add clips",
    kind: "edit",
    description:
      "Put media on the timeline. Each item: `assetId`, optional `in`/`out` (source seconds, to use part of the " +
      "file), `start` (timeline seconds; default: after the last clip on a video track, 0 on audio) and " +
      "`trackId`. Pictures go on the bottom video track by default and sound on the top audio track. " +
      '`newTrack: true` puts them on new tracks (video on top). A clip never overlaps another: it moves to the ' +
      "nearest free spot.",
    inputSchema: obj(
      {
        items: arr(
          obj(
            {
              assetId: str("Media id."),
              in: num("Source in-point, seconds.", { minimum: 0 }),
              out: num("Source out-point, seconds."),
              start: time("Where it starts."),
              trackId: str("Track to put it on."),
            },
            ["assetId"],
          ),
          "Clips to add; items without `start` follow each other.",
          { minItems: 1 },
        ),
        newTrack: bool("Put them on new tracks."),
      },
      ["items"],
    ),
  }),
  tool({
    name: "add_text",
    title: "Add text",
    kind: "edit",
    description:
      "Add a text clip (a title, a label...). It goes on the top video track when that's free, else on a new " +
      "track on top. `style` takes Text and Appearance parameters (font, fontStyle, size in px of a 1080p canvas, " +
      'fill, strokeWidth, strokeColor, background, shadow... see get_catalog "clip_properties"). `position` is ' +
      "where its centre sits, as fractions of the canvas ([0.5, 0.5] = middle, [0.5, 0.8] = lower third).",
    inputSchema: obj(
      {
        text: str("What it says (\\n for new lines)."),
        start: time("Where it starts."),
        duration: num("Seconds (default 3).", { minimum: 0.1 }),
        trackId: str("Put it on this video track instead."),
        style: params("Text and Appearance parameter values."),
        position: arr(num("Fraction"), "[x, y] canvas fractions.", { minItems: 2, maxItems: 2 }),
      },
      ["text", "start"],
    ),
  }),
  tool({
    name: "move_clips",
    title: "Move clips",
    kind: "edit",
    description:
      "Move clips in time (`to`: where the earliest one starts, or `by`: seconds) and/or to another track of " +
      "the same kind. They keep their spacing. If they'd overlap other clips they land at the nearest spot that fits.",
    inputSchema: obj(
      {
        clipIds: clipIds(),
        to: time("New start of the earliest clip."),
        by: num("Seconds to move (negative = earlier)."),
        trackId: str("Track to move them to."),
      },
      ["clipIds"],
    ),
  }),
  tool({
    name: "trim_clip",
    title: "Trim a clip",
    kind: "edit",
    description:
      "Move a clip's edges: `start` and/or `end` are the new timeline times of its left and right edges. Moving " +
      "the left edge changes the source in-point (the clip's later frames stay where they are). Limited by the " +
      "media's length and the neighbouring clips. `ripple: true` (shortening only) also slides the rest of the " +
      "track left to close the gap.",
    inputSchema: obj(
      {
        clipId: str("Clip id."),
        start: time("New left edge."),
        end: time("New right edge."),
        ripple: bool("Close the gap left by shortening it."),
      },
      ["clipId"],
    ),
  }),
  tool({
    name: "split_clips",
    title: "Split clips",
    kind: "edit",
    description:
      "Cut clips in two at a timeline time (like the razor). Default: every clip on a video track under that time. " +
      "Returns the ids of the new right-hand parts.",
    inputSchema: obj({ at: time("Where to cut."), clipIds: arr(str("Clip id"), "Only these clips.") }, ["at"]),
  }),
  tool({
    name: "delete_clips",
    title: "Delete clips",
    kind: "edit",
    description: "Remove clips from the timeline. `ripple: true` also closes the gaps they leave on their tracks.",
    inputSchema: obj({ clipIds: clipIds(), ripple: bool("Close the gaps.") }, ["clipIds"]),
  }),
  tool({
    name: "close_gaps",
    title: "Close gaps",
    kind: "edit",
    description:
      "Slide clips left to remove empty space on a track: the gap at `at`, or every gap on the track (including " +
      "one at the very start) when `at` is left out.",
    inputSchema: obj({ trackId: str("Track id."), at: time("A time inside the gap.") }, ["trackId"]),
  }),
  tool({
    name: "duplicate_clips",
    title: "Duplicate clips",
    kind: "edit",
    description: "Copy clips (with their effects) and paste them at `at` (default: right after them).",
    inputSchema: obj({ clipIds: clipIds(), at: time("Where the copies start.") }, ["clipIds"]),
  }),
  tool({
    name: "set_properties",
    title: "Change properties",
    kind: "edit",
    description:
      "Set parameters of one effect on clips. `effect` is an effect id on the clip: motion (position, scale, " +
      "rotation, anchor, fit), opacity, volume (level), text (text, font, size...), appearance (fill, stroke, " +
      "shadow...) or a video effect's id (see get_timeline). A parameter that's animated gets a keyframe at `at` " +
      "(timeline seconds) instead; without `at` animated parameters are skipped.",
    inputSchema: obj(
      {
        clipIds: clipIds(),
        effect: str('Effect id, e.g. "motion", "opacity", "volume", "text", "appearance", "gaussian-blur".'),
        params: params("Parameter values by key."),
        at: time("Keyframe animated parameters here."),
      },
      ["clipIds", "effect", "params"],
    ),
  }),
  tool({
    name: "set_keyframes",
    title: "Animate a property",
    kind: "edit",
    description:
      "Animate one number or point parameter (e.g. motion scale for a zoom, motion position for a pan, opacity " +
      "for a fade, volume level) with keyframes at timeline times, replacing its animation. An empty list stops " +
      "animating it (it keeps `value`, or the value it had at the first keyframe). Easing: linear, ease-in, " +
      "ease-out, ease, hold.",
    inputSchema: obj(
      {
        clipId: str("Clip id."),
        effect: str("Effect id (motion, opacity, volume, a video effect...)."),
        param: str("Parameter key, e.g. scale, position, opacity, level."),
        keyframes: arr(
          obj(
            {
              time: time("When."),
              value: { description: "Number, or [x, y] for points." },
              easing: oneOf(["linear", "ease-in", "ease-out", "ease", "hold"], "How it's passed (default linear)."),
            },
            ["time", "value"],
          ),
          "Keyframes (inside the clip).",
        ),
        value: { description: "Static value to keep when `keyframes` is empty." },
      },
      ["clipId", "effect", "param", "keyframes"],
    ),
  }),
  tool({
    name: "add_effect",
    title: "Add an effect",
    kind: "edit",
    description:
      'Add a video effect (see get_catalog "video_effects") to clips on video tracks, drawn over their other ' +
      "effects, optionally with parameter values. Returns each clip's new effect id (the type, or type_2...).",
    inputSchema: obj(
      { clipIds: clipIds(), type: str("Video effect type."), params: params("Parameter values by key.") },
      ["clipIds", "type"],
    ),
  }),
  tool({
    name: "edit_effect",
    title: "Change an effect",
    kind: "edit",
    description:
      "Turn one of clips' effects on or off, reset its parameters to their defaults, move a video effect " +
      "earlier/later in the drawing order, or remove it (video effects only).",
    inputSchema: obj(
      {
        clipIds: clipIds(),
        effect: str("Effect id."),
        enabled: bool("On or off (bypassed)."),
        reset: bool("Put every parameter back to its default (dropping keyframes)."),
        move: oneOf(["earlier", "later"], "Swap with its neighbour in the drawing order."),
        remove: bool("Remove it."),
      },
      ["clipIds", "effect"],
    ),
  }),
  tool({
    name: "copy_effects",
    title: "Copy effects",
    kind: "edit",
    description:
      "Paste one clip's effects (all, or just `types`) onto other clips, like Premiere's Paste Attributes. " +
      "Text clips keep their own words.",
    inputSchema: obj(
      {
        fromClipId: str("Clip to copy from."),
        toClipIds: clipIds("Clips to paste onto."),
        types: arr(str("Effect type"), 'Only these, e.g. ["motion"].'),
      },
      ["fromClipId", "toClipIds"],
    ),
  }),
  tool({
    name: "set_transition",
    title: "Set a transition",
    kind: "edit",
    description:
      "Put a transition on a clip edge on a video track, change it, or remove it (`type: null`). Between two " +
      'touching clips it plays across the cut (on the outgoing clip\'s "out" edge); on a free edge it fades from ' +
      "or to what's below. Types: get_catalog \"transitions\" (cross-dissolve is the classic).",
    inputSchema: obj(
      {
        clipId: str("Clip id."),
        edge: oneOf(["in", "out"], "The clip's start (in) or end (out)."),
        type: { type: ["string", "null"], description: "Transition type, or null to remove it." },
        duration: num("Seconds (0.1..5).", { minimum: 0.1, maximum: 5 }),
        alignment: oneOf(["center", "start", "end"], "Across a cut: centred on it, starting or ending at it."),
        params: params("The transition's parameter values."),
      },
      ["clipId", "edge"],
    ),
  }),
  tool({
    name: "add_track",
    title: "Add a track",
    kind: "edit",
    description: "Add an empty track: video tracks go on top (drawn over the others), audio tracks at the bottom.",
    inputSchema: obj({ kind: oneOf(["video", "audio"], "Kind of track.") }, ["kind"]),
  }),
  tool({
    name: "edit_track",
    title: "Change a track",
    kind: "edit",
    description: "Mute or unmute a track, or remove it with its clips (the last video track can't be removed).",
    inputSchema: obj({ trackId: str("Track id."), muted: bool("Muted."), remove: bool("Remove it.") }, ["trackId"]),
  }),
  tool({
    name: "set_project",
    title: "Video settings",
    kind: "edit",
    description: "Rename the video, or change its aspect ratio (9:16, 16:9, 1:1, 4:5) or frame rate.",
    inputSchema: obj({
      name: str("New name."),
      aspectRatio: oneOf(["9:16", "16:9", "1:1", "4:5"], "Aspect ratio."),
      fps: int("Frames per second.", { enum: [24, 25, 30, 60] }),
    }),
  }),
  tool({
    name: "style_captions",
    title: "Style captions",
    kind: "edit",
    description:
      'Change the look of every caption at once (get_catalog "caption_styles"): a `preset`, Text/Appearance ' +
      "parameter values, their `position` (canvas fractions), and their `animation` (a transition type, or " +
      '"none"). Their words and timing stay.',
    inputSchema: obj({
      preset: str("Caption style preset id."),
      text: params("Text parameters (font, fontStyle, size, textCase...)."),
      appearance: params("Appearance parameters (fill, strokeWidth, shadow...)."),
      position: arr(num("Fraction"), "[x, y] canvas fractions.", { minItems: 2, maxItems: 2 }),
      animation: str('Transition type each caption appears with, or "none".'),
    }),
  }),
  tool({
    name: "merge_captions",
    title: "Merge captions",
    kind: "edit",
    description: "Join a caption with the next one: one caption over both, saying both.",
    inputSchema: obj({ clipId: str("Caption clip id.") }, ["clipId"]),
  }),
  tool({
    name: "batch",
    title: "Make several edits",
    kind: "edit",
    description:
      "Run several edit tools in order as ONE undo step (the user undoes them together). Each step is " +
      '{ "tool": name, "input": {...} } with any edit tool (add_clips ... merge_captions). Later steps see earlier ' +
      "steps' results, so use ids you already know. Stops at the first failing step and changes nothing.",
    inputSchema: obj(
      {
        steps: arr(
          obj({ tool: str("Edit tool name."), input: { type: "object", description: "Its input." } }, ["tool", "input"]),
          "The edits, in order.",
          { minItems: 1, maxItems: 200 },
        ),
      },
      ["steps"],
    ),
  }),

  // -------------------------------------------------------------------------
  // Other actions
  // -------------------------------------------------------------------------
  tool({
    name: "generate_captions",
    title: "Auto captions",
    kind: "action",
    timeout: 1800,
    description:
      "Transcribe speech and add captions (text clips flagged as captions, on a Captions track), replacing " +
      "captions already over those clips. Default: every clip that's heard, the last options the user chose. " +
      'Options: preset (see get_catalog "caption_styles"), length (word | short | line | lines), animation ' +
      '(transition type or "none"), punctuation, language, engine.',
    inputSchema: obj({
      clipIds: arr(str("Clip id"), "Only these clips."),
      preset: str("Style preset id."),
      length: oneOf(["word", "short", "line", "lines"], "How much each caption shows."),
      animation: str('Transition type, or "none".'),
      punctuation: bool("Keep punctuation."),
      language: str('"auto" or an ISO 639-1 code.'),
      engine: oneOf(["local", "openai", "groq"], "Transcription engine."),
    }),
  }),
  tool({
    name: "import_media",
    title: "Import media",
    kind: "action",
    timeout: 1800,
    description:
      "Import files into this video's media: `paths` (absolute paths of files on this computer) and/or `urls` " +
      "(YouTube or any site yt-dlp supports, e.g. from search_online; `urlKind` audio for just the sound, like a " +
      "song, or video). Returns the new media ids; put them on the timeline with add_clips.",
    inputSchema: obj({
      paths: arr(str("Absolute file path"), "Files on this computer."),
      urls: arr(str("URL"), "Online videos."),
      urlKind: oneOf(["video", "audio"], "Take the whole video (default) or just its sound."),
    }),
  }),
  tool({
    name: "delete_media",
    title: "Delete media",
    kind: "action",
    destructive: true,
    description: "Delete a media file from this video, and its clips. The user confirms first. Can't be undone.",
    inputSchema: obj({ assetId: str("Media id.") }, ["assetId"]),
  }),
  tool({
    name: "library_create_folder",
    title: "New Library folder",
    kind: "action",
    description: "Create a folder in the Library (inside `parentId`, else at the top level).",
    inputSchema: obj({ name: str("Folder name."), parentId: str("Parent folder id.") }, ["name"]),
  }),
  tool({
    name: "library_update",
    title: "Organise the Library",
    kind: "action",
    description:
      "Rename, move or star Library things. For a folder (`folderId`): `name`, `parentId` (null = top level). " +
      "For an item (`itemId`): `name`, `parentId` (the folder to move it into, null = top level), `favorite`.",
    inputSchema: obj({
      folderId: str("Folder to change."),
      itemId: str("Item to change."),
      name: str("New name."),
      parentId: { type: ["string", "null"], description: "Folder to move it into (null = top level)." },
      favorite: bool("Star it (items only)."),
    }),
  }),
  tool({
    name: "library_delete",
    title: "Delete from the Library",
    kind: "action",
    destructive: true,
    description: "Delete a Library folder (with everything in it) or item. The user confirms first. Can't be undone.",
    inputSchema: obj({ folderId: str("Folder id."), itemId: str("Item id.") }),
  }),
  tool({
    name: "library_save",
    title: "Save to the Library",
    kind: "action",
    description:
      "Save to the Library (shared by every video): media files (`assetIds`, one item each), or timeline clips " +
      "with their effects and transitions as one reusable item (`clipIds` + `name`).",
    inputSchema: obj({
      assetIds: arr(str("Media id"), "Media files to add."),
      clipIds: arr(str("Clip id"), "Clips to save together."),
      name: str("Name of the saved clips."),
      folderId: str("Folder to save into (default: top level)."),
    }),
  }),
  tool({
    name: "library_use",
    title: "Use a Library item",
    kind: "action",
    description:
      "Put a Library item on this video's timeline (its media is copied into the video): at `start` (default " +
      "the playhead), on `trackId` if it fits there.",
    inputSchema: obj({ itemId: str("Library item id."), start: time("Where it goes."), trackId: str("Track id.") }, [
      "itemId",
    ]),
  }),
  tool({
    name: "export_video",
    title: "Export",
    kind: "action",
    timeout: 3600,
    description:
      "Render the video to an MP4 and wait for it. Returns where the file is. The user can also export " +
      "from the Export button.",
    inputSchema: obj({
      resolution: oneOf(["720p", "1080p", "4k"], "Default 1080p."),
      fileName: str("File name without extension."),
      excludeAudio: bool("Leave out the audio tracks."),
    }),
  }),
  tool({
    name: "focus",
    title: "Show the user",
    kind: "action",
    description: "Point the user at something: move the playhead to `time` and/or select clips.",
    inputSchema: obj({ time: time("Playhead."), clipIds: arr(str("Clip id"), "Clips to select (empty = none).") }),
  }),
] as const satisfies readonly ToolSpec[];

export type ToolName = (typeof ASSISTANT_TOOLS)[number]["name"];

export type EditToolName = Extract<(typeof ASSISTANT_TOOLS)[number], { kind: "edit" }>["name"];

const byName = new Map<string, ToolSpec>(ASSISTANT_TOOLS.map((t) => [t.name, t]));

export function toolSpec(name: string): ToolSpec | undefined {
  return byName.get(name);
}

/** The MCP server's name: Claude Code calls its tools `mcp__editor__<tool>`. */
export const MCP_SERVER_NAME = "editor";

/** A tool's own name from what an MCP client calls it (`mcp__editor__split_clips` -> `split_clips`). */
export function bareToolName(name: string): string {
  const prefix = `mcp__${MCP_SERVER_NAME}__`;
  return name.startsWith(prefix) ? name.slice(prefix.length) : name;
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

/** MCP tool result content. */
export type ToolContent = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

/** What an edit did to the timeline, for highlighting it and for the chat's summary. */
export interface ToolChanges {
  added: string[];
  changed: string[];
  removed: number;
}

export interface ToolResult {
  content: ToolContent[];
  isError?: boolean;
  /** Not sent to the model: what changed (edits). */
  changes?: ToolChanges;
}

export const textResult = (text: string, changes?: ToolChanges): ToolResult => ({
  content: [{ type: "text", text }],
  ...(changes && { changes }),
});

export const errorResult = (message: string): ToolResult => ({ content: [{ type: "text", text: message }], isError: true });
