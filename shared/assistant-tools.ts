/**
 * The video editor's tools for AI agents, served over MCP (`server/assistant/mcp.ts`)
 * to the in-app assistant (Claude Code run by the server) and to any MCP client,
 * e.g. Claude Code in a terminal: `claude mcp add --transport http editor http://127.0.0.1:5311/mcp`.
 * (Other suites list theirs in their own folder; `suite-tools.ts` gathers them.)
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
import { type Schema, type ToolSpec, arr, bool, int, num, obj, oneOf, str, tool } from "./tool-spec.ts";
import { EXPORT_FORMATS, EXPORT_QUALITIES } from "./export-formats.ts";

/** Parameter values of an effect or transition: keys and value types as listed by `get_catalog`. */
const params = (description: string): Schema => ({ type: "object", description, additionalProperties: true });

const clipIds = (description = "Clip ids (from get_timeline)."): Schema => arr(str("Clip id"), description, { minItems: 1 });
const time = (description: string): Schema => num(`${description} Timeline seconds.`, { minimum: 0 });

/** Every video tool, in the order clients list them. */
export const VIDEO_TOOLS = [
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
      "The video's imported media files (id, name, kind, length, size, frame rate, has audio, where it's used), " +
      "each followed by its subclips (named parts of it, see make_subclips). Add one to the timeline with add_clips.",
    inputSchema: obj({}),
  }),
  tool({
    name: "view_frames",
    title: "Look at the video",
    kind: "look",
    description:
      "Pictures of the edited video (the Program monitor, with every effect, text and transition) at timeline " +
      "times. Moves the playhead, so the user sees what you're looking at. Use it to check framing, text and " +
      "the look after edits. Give `times`, or `count` frames spread over `from`..`to`, or `at` the song's " +
      "beats, bars, drops or hits (e.g. at: \"onsetLow\", offset: 0.03 to see a picture react just after each " +
      "kick). `sheet` puts them in one picture (a contact sheet), cheaper for many frames.",
    inputSchema: obj({
      times: arr(time("A moment."), "Up to 16 timeline times.", { minItems: 1, maxItems: 16 }),
      from: num("Start of a stretch (timeline seconds) to take frames from (default 0).", { minimum: 0 }),
      to: num("End of the stretch (default the end)."),
      count: int("How many frames from the stretch (default 8, at most 16): evenly spread, or the first of `at`.", { minimum: 1, maximum: 16 }),
      at: oneOf(
        ["beats", "bars", "drops", "onset", "onsetLow", "onsetMid", "onsetHigh"],
        "Take frames at these moments of the sound in the stretch (hits: onsetLow kicks, onsetHigh hats).",
      ),
      offset: num("Seconds added to each `at` moment (e.g. 0.03 to see the reaction).", { minimum: -1, maximum: 1 }),
      source: str('With `at` hits: what to listen to: "master" (default), a track\'s name or a clip id.'),
      sheet: bool("One picture with every frame in a grid, each labelled (default: true for more than 4 frames)."),
      width: int("Width of each picture in px (default 480, or 240 in a sheet; at most 960).", { minimum: 64, maximum: 960 }),
    }),
  }),
  tool({
    name: "get_layout",
    title: "Measure the canvas",
    kind: "look",
    description:
      "Where everything is on the canvas at a moment, in px (the canvas at 1080p): each visible clip's box, its " +
      "centre (also as motion position fractions), where its anchor is, its scale and rotation, and for a text " +
      "the box around its letters (measured in its real font). Use it before placing or sizing things relative " +
      "to each other: a box or pill behind a title, an underline under a word, a sticker next to a face's frame, " +
      "two texts on one line, keeping something inside the canvas. Cheaper and more exact than reading positions " +
      "off view_frames; check the result with view_frames afterwards.",
    inputSchema: obj({
      time: time("The moment to measure (default: the playhead)."),
      clipIds: arr(str("Clip id"), "Only these clips (default: everything on the canvas then)."),
    }),
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
      "(remove ums, repeats, the boring part, find the hook). With `assetId` instead: a whole media file, in " +
      "source times, e.g. to find the parts of long footage worth keeping (make_subclips, add_clips in/out).",
    inputSchema: obj({
      clipIds: arr(str("Clip id"), "Clips to transcribe (default: every audible clip)."),
      assetId: str("A media file to transcribe instead (from list_media)."),
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
    name: "get_signals",
    title: "Listen to the sound",
    kind: "look",
    timeout: 600,
    description:
      "What the sound does over time, for making pictures react to it (expressions' audio(), sinceHit(), " +
      "beat()...): which files sound where, the song's beat, bars, sections and drops, every hit (onsetLow: " +
      "kicks, onsetMid: snares and notes, onsetHigh: hats) with how hard, the level's shape, and if asked " +
      "signals' values every `step` seconds. Timeline seconds; values 0..1 against the file's own loud parts. " +
      "Files are analysed first if they aren't yet. It also lists the video's own signals (define_signal). Look at " +
      "the shape of a song with plot_signals.",
    inputSchema: obj({
      source: str('What to listen to: "master" (everything heard, default), a track\'s name or id, or a clip id.'),
      from: num("Start, timeline seconds (default 0).", { minimum: 0 }),
      to: num("End (default the end of the sequence)."),
      signals: arr(
        str('A signal: "level", "peak", "sub", "bass", "lowMid", "mid", "upperMid", "presence", "air", "onset", "onsetLow", "onsetMid", "onsetHigh", "width", "balance", "brightness", or one of the video\'s own by name.'),
        "Signals to list values of (default none: the summary alone).",
      ),
      step: num("Seconds between values (default: about 100 values over the stretch).", { minimum: 0.01 }),
    }),
  }),
  tool({
    name: "plot_signals",
    title: "Plot the sound",
    kind: "look",
    timeout: 600,
    description:
      "A picture of signals over a stretch, a lane each, with the bars, drops and hits marked: the quickest " +
      "way to see a song's shape (where it builds, drops, goes quiet) and where its kicks and hats fall.",
    inputSchema: obj({
      source: str('What to listen to: "master" (default), a track\'s name or id, or a clip id.'),
      signals: arr(
        str('A signal: a built-in one ("level", "bass", "onsetLow"...: see get_signals) or one of the video\'s own by name.'),
        'Lanes, top to bottom (default "level", "bass", "onsetLow", "onsetHigh").',
        { maxItems: 6 },
      ),
      from: num("Start, timeline seconds (default 0).", { minimum: 0 }),
      to: num("End (default the end of the sequence)."),
      width: int("Width in px (default 960).", { minimum: 320, maximum: 1600 }),
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
      "What exists to use: `video_effects` (type, tags, parameters), `masks_and_shapes` (masks for any clip, and " +
      "what goes on a shape layer: shapes and their operators), `text_animators` (per-character/word/line text " +
      "animation and its presets), `expressions` (what set_expression scripts can use), `transitions` (type, tags, parameters), " +
      "`presets` (ready-made After Effects-style transitions and moves/looks built from effects and keyframes), " +
      "`clip_properties` (the built-in effects every clip has: motion, opacity, volume, text, appearance, solid), " +
      "`caption_styles` (presets, lengths, animations), `shader_api` (what set_shader's GLSL can use, in each dialect, with examples), or installed `fonts`. Parameters list key, kind, " +
      "default and range: values are in these units (e.g. scale 1 = 100%, position in canvas fractions).",
    inputSchema: obj(
      {
        kind: oneOf(
          ["video_effects", "masks_and_shapes", "text_animators", "expressions", "presets", "transitions", "clip_properties", "caption_styles", "shader_api", "fonts"],
          "What to list.",
        ),
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
      "file; or `subclipId` for a subclip's part), `start` (timeline seconds; default: after the last clip on a video track, 0 on audio) and " +
      "`trackId`. Pictures go on the bottom video track by default and sound on the top audio track. " +
      '`newTrack: true` puts them on new tracks (video on top). A clip never overlaps another: it moves to the ' +
      "nearest free spot.",
    inputSchema: obj(
      {
        items: arr(
          obj(
            {
              assetId: str("Media id."),
              subclipId: str("A subclip instead of `assetId`: its part of its file (`in`/`out` then default to it)."),
              in: num("Source in-point, seconds.", { minimum: 0 }),
              out: num("Source out-point, seconds."),
              start: time("Where it starts."),
              trackId: str("Track to put it on."),
            },
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
    name: "add_layer",
    title: "Add a layer",
    kind: "edit",
    description:
      "Add an adjustment layer, a solid or a shape layer (After Effects' layers). An adjustment layer draws nothing itself: its " +
      "video effects, Motion (scale, position, rotation: zooms or shakes everything below) and Opacity (how much " +
      "of the effect shows, and its blendMode) apply to every track below it while it lasts, so it's how you grade, " +
      "stylise or zoom/shake several clips at once, or put an effect across a cut (a transition built from effects). " +
      "A solid is a colour filling the canvas (`color`; Solid `fill` 0 makes it transparent) for generator effects " +
      "(noise, gradients, light) to draw on, or to tint with a blend mode. Both go on `trackId` when it's a free " +
      "video track there, else on the top video track or a new one on top (they must be above what they affect). " +
      "`effects` adds video effects to it with their parameter values, in order. A camera draws nothing: 3D layers " +
      "(clips with motion threeD: true, positionZ, rotationX, rotationY) are seen through it while it lasts; " +
      "`camera` sets its Camera values (angleOfView, pointOfInterest, interestZ, distance, orbitX, orbitY, roll, " +
      "depthOfField, focusDistance, aperture), which set_keyframes can animate (effect \"camera\") for camera moves. " +
      "A null object draws nothing either: it's a Motion for other clips to follow (set_parent), to move, scale or " +
      "spin several clips together, or to animate a group from one place. A shape layer draws vector shapes (boxes " +
      "behind text, circles, lines, badges, animated strokes): `shape` sets its first shape (kind rectangle | ellipse | " +
      "polygon | star | path, position, size in px at 1080p, fillColor, strokeWidth...: see get_catalog " +
      "\"masks_and_shapes\"); `effects` can add more shapes (type vector-shape) and operators (trim-paths, repeater...). " +
      "A visualizer draws what the sound does (Spectrum Bars by default, listening to the mix) alone over what's below: " +
      "give `effects` with Audio effects (audio-bars, audio-line, audio-circle, audio-oscilloscope, audio-vectorscope, " +
      "audio-spectrogram, audio-burst, audio-ring, audio-meter: get_catalog \"video_effects\") to choose them; it lasts " +
      "`duration` (give the song's length).",
    inputSchema: obj(
      {
        kind: oneOf(["adjustment", "solid", "shape", "camera", "null", "visualizer"], "What to add."),
        start: time("Where it starts."),
        duration: num("Seconds (default 5).", { minimum: 0.1 }),
        trackId: str("Put it on this video track."),
        color: str('A solid\'s colour, like "#000000".'),
        camera: params("A camera's Camera values."),
        shape: params("A shape layer's first shape (vector-shape values)."),
        effects: arr(
          obj({ type: str("Video effect type (or mask; on a shape layer also vector-shape and the operators)."), params: params("Parameter values by key.") }, ["type"]),
          "Video effects to put on it, drawn in this order.",
        ),
      },
      ["kind", "start"],
    ),
  }),
  tool({
    name: "apply_preset",
    title: "Apply a preset",
    kind: "edit",
    description:
      'Use a preset (get_catalog "presets"). A transition preset is an adjustment layer centred on the cut at ' +
      "`at` (a cut's timeline time from get_timeline), animating Motion (with motion blur and mirrored edges) and " +
      "effects across it: edit-style zooms, spins, whips, glitches. It changes every track below it, so it's the " +
      "stylish alternative to set_transition. An effect preset (a move or a look: punch-in, shake, entrance, " +
      "exit, VHS...) goes on `clipIds` (their own Motion/effects, timed from their start or to their end), or " +
      "with `at` instead, on an adjustment layer from there. Everything it adds is ordinary effects and keyframes " +
      "you can then change with set_properties / set_keyframes.",
    inputSchema: obj(
      {
        type: str("Preset type."),
        at: time("A transition: the cut. An effect preset without clips: where its adjustment layer starts."),
        clipIds: arr(str("Clip id"), "Effect presets: the clips to put it on."),
        trackId: str("Put its adjustment layer on this video track (when free)."),
      },
      ["type"],
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
    name: "set_speed",
    title: "Change clip speed",
    kind: "edit",
    description:
      "Speed clips up, slow them down or play them backwards (Premiere's Speed/Duration). `speed` is a factor " +
      "(2 = twice as fast and half as long, 0.5 = slow motion; 0.1 to 10), or give `duration` (timeline seconds) " +
      "to fit a clip to a length. Each clip keeps its media range and its start; the clips after it on its track " +
      "move with its end (no gap, no overlap). `reversed` plays it backwards; `keepPitch` (default true) keeps " +
      "voices natural at other speeds, false lets the pitch follow the speed. Only video and sound clips (not " +
      "stills or text). Keyframes stay on their frames, so animations speed up with the clip.",
    inputSchema: obj(
      {
        clipIds: clipIds(),
        speed: num("Playback speed factor, 0.1 to 10 (1 = normal).", { minimum: 0.1, maximum: 10 }),
        duration: num("Instead of `speed`: how long each clip should last, in timeline seconds.", { exclusiveMinimum: 0 }),
        reversed: bool("Play backwards (true) or forwards (false)."),
        keepPitch: bool("Keep the sound's pitch at other speeds (default true)."),
        interpolation: oneOf(
          ["frames", "blend", "flow"],
          "Time Interpolation for the frames in between (videos): frames repeats or skips them (default), blend cross-fades, flow makes new ones along the optical flow (smooth slow motion, like Twixtor).",
        ),
      },
      ["clipIds"],
    ),
  }),
  tool({
    name: "nest_clips",
    title: "Nest clips",
    kind: "edit",
    description:
      "Nest clips (Premiere's Nest, After Effects' Pre-compose): they become a nested sequence of their own (on " +
      "copies of their tracks, the earliest starting at 0), played by one new clip in their place. The nested clip " +
      "is then like a video clip of the sequence: trim it, move it, give it Motion/Opacity/effects/transitions, " +
      "speed it up or remap its time (remap_time) to act on everything inside at once, e.g. a speed ramp over a " +
      "whole edited section, or one zoom over several clips. Edit what's inside with open_sequence. Returns the " +
      "new sequence's and clip's ids.",
    inputSchema: obj({ clipIds: clipIds(), name: str("The sequence's name (default \"Nested Sequence N\").") }, ["clipIds"]),
  }),
  tool({
    name: "break_apart",
    title: "Break apart a nested clip",
    kind: "edit",
    description:
      "Put what a nested clip plays back on the timeline in its place (Premiere's Restore Unnested): the part of its " +
      "sequence it shows, each of the sequence's tracks on a new track. The nested clip's own Motion, Opacity and " +
      "effects are dropped. Only for a nested clip at normal speed, forwards and not remapped.",
    inputSchema: obj({ clipId: str("The nested clip.") }, ["clipId"]),
  }),
  tool({
    name: "edit_sequence",
    title: "Change a nested sequence",
    kind: "edit",
    description:
      "Change a nested sequence (see get_timeline's sequences): its name, its own frame (aspectRatio) and frame rate, " +
      "or its length (`duration` in seconds, or null for as long as its clips, the default). `delete: true` deletes " +
      "it and every clip that plays it.",
    inputSchema: obj(
      {
        sequenceId: str("The sequence."),
        name: str("New name."),
        aspectRatio: oneOf(["9:16", "16:9", "1:1", "4:5"], "Its frame."),
        fps: num("Frames per second.", { minimum: 1, maximum: 120 }),
        duration: { type: ["number", "null"], description: "Seconds, or null for as long as its clips." },
        delete: bool("Delete it (and the clips that play it)."),
      },
      ["sequenceId"],
    ),
  }),
  tool({
    name: "open_sequence",
    title: "Open a sequence",
    kind: "action",
    description:
      "Choose which sequence your next calls act on: a nested sequence (its id, from get_timeline) to edit what's " +
      "inside it, or null for the video's main sequence. Every other tool (get_timeline, add_clips, set_keyframes...) " +
      "then works on that sequence's tracks and clips, with times from its own start. In the open video it also " +
      "shows that sequence in the user's timeline.",
    inputSchema: obj({ sequenceId: { type: ["string", "null"], description: "A nested sequence's id, or null for the main one." } }, ["sequenceId"]),
  }),
  tool({
    name: "remap_time",
    title: "Remap a clip's time",
    kind: "edit",
    description:
      "Time remapping (After Effects' Time Remap, Premiere's speed keyframes, CapCut's speed curve) on a video or " +
      "nested clip: its speed can change within the clip, freeze, or run backwards. `enabled` turns it on (nothing " +
      "changes until shaped) or off. `speeds` replaces the whole curve with steps from the clip's first frame: each " +
      "plays at `speed` (1 normal, 0.2 slow motion, 3 fast, 0 a freeze, negative backwards) for `duration` timeline " +
      "seconds; `ease` (0..1, e.g. 0.6) smooths every change of speed into a ramp, the classic edit speed ramp " +
      "(fast, slow into the beat, fast again). `freeze` holds the frame at timeline time `at` for `duration` seconds. " +
      "`reverse` plays timeline span from..to backwards then forwards again. `stretch` sets the speed of one stretch " +
      "between remap keyframes (its index, see get_clips' remap). The clip's length changes with it and the clips " +
      "after it on its track move along. Its keyframes (effect \"time-remap\", param \"time\": the source time " +
      "shown, at timeline times) can also be set with set_keyframes, with Bézier handles for custom ramps.",
    inputSchema: obj(
      {
        clipId: str("A video, sound or nested clip."),
        enabled: bool("Turn remapping on or off."),
        speeds: arr(
          obj({ duration: num("Timeline seconds.", { exclusiveMinimum: 0 }), speed: num("Speed factor (0 = freeze, negative = backwards).") }, ["duration", "speed"]),
          "The whole curve as steps of speed.",
        ),
        ease: num("With `speeds`: how smoothly speed changes, 0 (cuts) to 1.", { minimum: 0, maximum: 1 }),
        freeze: obj({ at: time("Where."), duration: num("How long, seconds.", { exclusiveMinimum: 0 }) }, ["at", "duration"]),
        reverse: obj({ from: time("Start of the stretch."), to: time("End of the stretch.") }, ["from", "to"]),
        stretch: obj({ index: num("Which stretch (0 = the first)."), speed: num("Its speed (0.1 to 10).") }, ["index", "speed"]),
      },
      ["clipId"],
    ),
  }),
  tool({
    name: "set_markers",
    title: "Set markers",
    kind: "edit",
    description:
      "Add, change or remove markers (Premiere's): named points in time that clips, keyframes and the playhead " +
      "snap to, shown on the ruler. Use them for cues and notes for the user (a song's beats: mark_beats). Without " +
      "`clipId` a marker is on the timeline at a timeline time; with `clipId` it's on that clip and stays on its " +
      "frame when the clip moves or is trimmed. `add` makes them, `update` changes ones by id (get_timeline lists " +
      "them), `remove` deletes by id, `clear` removes every timeline marker first (e.g. before re-marking beats).",
    inputSchema: obj({
      add: arr(
        obj(
          {
            time: time("Where."),
            label: str("Its name."),
            color: oneOf(["green", "red", "orange", "yellow", "blue", "purple", "white"], "Its colour (default green)."),
            clipId: str("Put it on this clip instead of the timeline (the time must be inside the clip)."),
          },
          ["time"],
        ),
        "Markers to add.",
      ),
      update: arr(
        obj(
          {
            id: str("Marker id."),
            time: time("Move it here."),
            label: str('Its name ("" removes it).'),
            color: oneOf(["green", "red", "orange", "yellow", "blue", "purple", "white"], "Its colour."),
          },
          ["id"],
        ),
        "Markers to change.",
      ),
      remove: arr(str("Marker id"), "Markers to delete."),
      clear: bool("Remove every timeline marker first (clip markers stay)."),
    }),
  }),
  tool({
    name: "mark_beats",
    title: "Mark the beats",
    kind: "action",
    timeout: 600,
    description:
      "Beat sync, step 1: listen to a music clip and put its beats on it as markers (in place of the beat markers " +
      "it had; markers added by hand stay). `marks`: every beat, every bar (each 4th beat: a steadier cut), or only " +
      "the drops. The user sees them on the clip, and clips, keyframes and the playhead snap to them; they stay on " +
      "the music when the clip moves or is trimmed. Then cut_to_markers puts cuts on them. Returns the tempo and " +
      "the marked timeline times. `clear: true` just removes the clip's beat markers.",
    inputSchema: obj(
      {
        clipId: str("The clip with the music."),
        marks: oneOf(["beats", "bars", "drops"], "What to mark (default beats)."),
        clear: bool("Remove its beat markers instead of making them."),
      },
      ["clipId"],
    ),
  }),
  tool({
    name: "cut_to_markers",
    title: "Cut to the beat",
    kind: "edit",
    description:
      "Beat sync, step 2: make clips end on markers (the timeline's and other clips', e.g. a song's from " +
      "mark_beats), so every cut between them lands on the beat. Each clip's end is trimmed or extended to a " +
      "marker and whatever follows on its track moves along, so clips that were back to back stay so. Without " +
      "`every`, each ends on the marker nearest to where it ends now (the smallest change); with `every: N` each " +
      "lasts N markers (1 = a cut on every beat, 4 = every bar when beats are marked). A clip is never made longer " +
      "than its media. Lay the clips out roughly first (add_clips back to back from the first beat), then call this.",
    inputSchema: obj({ clipIds: clipIds("The clips to cut (not the music)."), every: int("A cut every N markers.", { minimum: 1, maximum: 64 }) }, ["clipIds"]),
  }),
  tool({
    name: "set_parent",
    title: "Parent clips",
    kind: "edit",
    description:
      "Parent clips to another clip (After Effects' pick-whip): they then follow the parent's Motion (position, " +
      "scale, rotation), on top of their own, like layers in a group. Often the parent is a null object (add_layer " +
      "kind \"null\"), animated with set_keyframes to carry several clips. Linking moves nothing at `at` (the parent's " +
      "pose then is where it's measured from); parents can have parents. `parentId: null` unparents (a clip whose " +
      "Motion isn't animated stays where it's seen). The parent must be a visual clip (not a camera) of this video, " +
      "and not one of the clips' own children. Children follow their parent wherever it is in time (it holds its " +
      "first/last Motion outside its clip).",
    inputSchema: obj(
      {
        clipIds: clipIds(),
        parentId: { type: ["string", "null"], description: "The clip to follow, or null to unparent." },
        at: time("Timeline time at which nothing should move (default: the playhead)."),
      },
      ["clipIds", "parentId"],
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
      "rotation, anchor, fit, edges: none/mirror/tile/extend for what shows past the frame when it's zoomed out " +
      "or turned, motionBlur and shutterAngle, threeD with positionZ, rotationX and rotationY for a 3D layer seen " +
      "through the camera), opacity (opacity, blendMode: normal, add, screen, multiply, overlay, soft-light, " +
      "difference, color-dodge, stencil-alpha... see get_catalog; trackMatte: alpha, alpha-inverted, luma, " +
      "luma-inverted to show the clip only through the clip on the video track right above it, which then isn't " +
      "drawn itself: text reveals, video inside text), volume (level), solid (color, fill), camera (a camera " +
      "clip's lens and orbit), text (text, font, size...), appearance (fill, stroke, shadow...) or the id of something " +
      "added to the clip: a video effect, a mask, a shape layer's shape or operator, a text animator " +
      "(see get_timeline). A parameter that's animated gets a keyframe at `at` (timeline seconds) instead; " +
      "without `at` animated parameters are skipped.",
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
      "Animate one number, point or path parameter (e.g. motion scale for a zoom, motion position for a pan, opacity " +
      "for a fade, volume level, any video effect's amount, a mask's path, which morphs) with keyframes at timeline times, replacing its " +
      "animation. An empty list stops animating it (it keeps `value`, or the value it had at the first " +
      "keyframe). Easing: linear, ease-in, ease-out, ease, hold; or, for the move that ARRIVES at a keyframe: " +
      "overshoot (shoots past the value and comes back: the pop of a title or a sticker landing), spring (swings " +
      "around it until it settles) or bounce (drops onto it and bounces), which make a move feel alive with two " +
      "keyframes; put it on the keyframe the move ends on. `influence` (0.01..1, default 0.33) is how far " +
      "an eased keyframe's handle reaches, like After Effects' keyframe velocity: 0.75-0.9 on both ends of a move " +
      "gives the snappy, lingering-then-whipping motion of edit-style zooms and spins; on overshoot it's how far past " +
      "it goes (0.33 = 10%), on spring how many times it swings. For full control (the graph " +
      "editor), `handleOut`/`handleIn` are Bézier handles [x, y] in the unit square of the segment leaving/arriving " +
      "at the keyframe: x = fraction of the time to the neighbouring keyframe, y = fraction of the change in value " +
      "(y beyond 0..1 overshoots, e.g. handleOut [0.2, 0.9] shoots off fast; handleIn [0.6, 1.3] overshoots then " +
      "settles). A handle overrides easing on its side. Turn on motion blur (set_properties motion motionBlur) for fast moves. " +
      "A point's keyframes (motion position) can also bend the path it travels (After Effects' motion path): " +
      "`spatialOut`/`spatialIn` are tangent handles [dx, dy] relative to the keyframe's value, in its units " +
      "(canvas fractions), leaving towards the next keyframe / arriving from the previous one, e.g. an arc instead " +
      "of a straight slide. The value keeps an even pace along the curve, shaped in time by the easing.",
    inputSchema: obj(
      {
        clipId: str("Clip id."),
        effect: str("Effect id (motion, opacity, volume, a video effect...)."),
        param: str("Parameter key, e.g. scale, position, opacity, level."),
        keyframes: arr(
          obj(
            {
              time: time("When."),
              value: { description: "Number, [x, y] for points, or a path (SVG path data in fractions of the clip's frame, or [[x, y], ...])." },
              easing: oneOf(["linear", "ease-in", "ease-out", "ease", "hold", "overshoot", "spring", "bounce"], "How it's passed, or arrived at (default linear)."),
              influence: num("How far its ease reaches, 0.01..1 (default 0.33).", { minimum: 0.01, maximum: 1 }),
              handleIn: arr(num("x, then y."), "Bézier handle arriving at it: [x 0..0.99, y] in the previous segment's unit square."),
              handleOut: arr(num("x, then y."), "Bézier handle leaving it: [x 0.01..1, y] in the next segment's unit square."),
              spatialIn: arr(num("dx, then dy."), "A point's path arriving at it: a tangent handle relative to its value."),
              spatialOut: arr(num("dx, then dy."), "A point's path leaving it: a tangent handle relative to its value."),
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
    name: "set_expression",
    title: "Set an expression",
    kind: "edit",
    description:
      "Put an expression on a number or point parameter (After Effects' expressions): a short script run at every " +
      "frame whose result is the parameter's value then, for motion that would take many keyframes. `value` is " +
      "what the parameter would be without it (its static value, or its keyframes at that moment), `time` the " +
      "clip's source time in seconds (the clock its keyframes are in; for text, shapes and solids: seconds since " +
      "the clip started). E.g. `wiggle(2, 0.02)` on motion position shakes it (2 times a second, by up to 2% of " +
      "the canvas: values are in the parameter's own units, see get_catalog), `wiggle(3, 5)` on rotation, " +
      '`loopOut("cycle")` or `loopOut("pingpong")` repeats the keyframes for the rest of the clip, ' +
      "`value + time * 90` spins 90° a second, `value + [0, Math.sin(time * 4) * 0.01]` bobs up and down, " +
      '`prop("motion.rotation") / 360` reads another parameter of the same clip ("effectId.paramKey"). The last ' +
      'statement is the result; variables (`a = 2; a * value`), `if`/`else`, `?:` and Math are there; see get_catalog ' +
      "\"expressions\" for every function. Not on volume. `expression: null` removes it. It fails with what's wrong if it can't run.",
    inputSchema: obj(
      {
        clipIds: clipIds(),
        effect: str("Effect id (motion, opacity, a video effect, a mask, a shape, an animator...)."),
        param: str("Parameter key (a number or a point), e.g. position, rotation, scale, opacity."),
        expression: { type: ["string", "null"], description: "The expression, or null to remove it." },
      },
      ["clipIds", "effect", "param", "expression"],
    ),
  }),
  tool({
    name: "link_param",
    title: "Link to a signal",
    kind: "edit",
    description:
      "Make a number or point parameter move with the sound, no code (the link button by a stopwatch): it follows a " +
      'signal by an amount. `signal` is a built-in one ("level", "bass", "sub", "mid", "air", "onset", "onsetLow" ' +
      'kicks, "onsetMid", "onsetHigh" hats, "width", "brightness"..., or "beat" / "downbeat" for the song\'s beat) or ' +
      "one of the video's own (define_signal) by name. `mode`: add (value + amount × signal, the default), multiply " +
      "(value × (1 + amount × signal): 0.3 is up to 30% more) or map (from the value towards `to`). Amounts are in " +
      "the parameter's own units (see get_catalog; a point's may be a point: [0, -0.05] lifts it). The response " +
      "shapes the 0..1 signal first: below `threshold` nothing moves, `curve` above 1 keeps only the loud parts, " +
      "`attack`/`release` (seconds) smooth its rise and fall, `invert` moves it when it's quiet. For hits (onsets, " +
      "beats, events) give `hit` {attack, hold, decay} to make a punch on each. Inside a nested sequence the mix is " +
      "the song of the video it's placed in. Wins over keyframes (it moves them), and an expression sees the linked " +
      "value. It says how far the parameter moves over the clip. `link: null` unlinks. Not on volume.",
    inputSchema: obj(
      {
        clipIds: clipIds(),
        effect: str("Effect id (motion, opacity, a video effect, a mask, a shape, an animator...)."),
        param: str("Parameter key (a number or a point), e.g. scale, position, opacity, rotation."),
        link: {
          type: ["object", "null"],
          description: "The link, or null to remove it.",
          properties: {
            signal: str('A built-in signal\'s name, "beat", "downbeat", or one of the video\'s own signals by name or id.'),
            source: str('For a built-in signal: "master" (the mix, default), "self" (the clip\'s own sound), a track\'s name or id, an audio track\'s number, or a clip id.'),
            mode: oneOf(["add", "multiply", "map"], "How the signal moves the value (default add)."),
            amount: { description: "add: how much at full signal; multiply: the fraction more (0.3); a number, or a point for points." },
            to: { description: "map: the value at full signal (a number, or a point for points)." },
            threshold: num("0..1: the signal under it moves nothing (default 0).", { minimum: 0, maximum: 0.99 }),
            curve: num("A power on the signal: 2 keeps the loud parts, 0.5 lifts the quiet ones (default 1).", { minimum: 0.1, maximum: 10 }),
            attack: num("Seconds to rise (default 0.01).", { minimum: 0, maximum: 10 }),
            release: num("Seconds to fall (default 0.12).", { minimum: 0, maximum: 10 }),
            invert: bool("Move when it's quiet instead."),
            hit: obj(
              {
                attack: num("Seconds up to full.", { minimum: 0, maximum: 10 }),
                hold: num("Seconds held.", { minimum: 0, maximum: 10 }),
                decay: num("Seconds back to nothing (default 0.25).", { minimum: 0, maximum: 10 }),
              },
              [],
              "For hits: the shape each one makes (scaled by how hard it is).",
            ),
          },
          required: ["signal"],
        },
      },
      ["clipIds", "effect", "param", "link"],
    ),
  }),
  tool({
    name: "set_shader",
    title: "Write a shader",
    kind: "edit",
    description:
      "Draw clips with your own GLSL: a Shader effect, drawn like any video effect (before Motion places the clip), in " +
      'the preview and the export. Read get_catalog "shader_api" first: what each dialect can use, and examples. ' +
      "`dialect`: native (ours, the default: `vec4 effect(vec2 uv)` over the clip's picture with getColor(uv), our helpers, " +
      "and the sound: spectrum(x), wave(x), audioBass, beatPhase, hitAge[]...), isf (an ISF file: JSON header + main) or " +
      "shadertoy (mainImage; iChannel0 is the sound, iChannel1 the clip's picture). Declare parameters in the code " +
      "(`// @param amount number 0 1 0.5 \"Amount\"`, int, bool, choice A|B|C, point x y, color #rrggbb; an ISF's INPUTS): " +
      "they then work like any other (set_properties, set_keyframes, link_param, set_expression) and `params` sets them here. " +
      "It's compiled first: if it doesn't compile nothing changes and the errors come back on your code's lines. " +
      "Without `effect` a new Shader effect is added to each clip (to draw a look on its own, put it on a solid: add_layer " +
      "kind solid); with `effect` (a Shader effect's id, from get_clips, which shows its code) that one's code is replaced, " +
      "keeping the values of parameters it still declares. Attribute shaders you adapt from elsewhere in a comment.",
    inputSchema: obj(
      {
        clipIds: clipIds(),
        code: str("The shader's code (up to 64 KB)."),
        dialect: oneOf(["native", "isf", "shadertoy"], "Which GLSL it is (default native)."),
        effect: str("A Shader effect's id to rewrite; leave out to add a new one."),
        params: params("Values for its declared parameters, by key."),
      },
      ["clipIds", "code"],
    ),
  }),
  tool({
    name: "define_signal",
    title: "Define a signal",
    kind: "edit",
    description:
      "Make (or change) one of the video's own signals, named for links (link_param) and expressions (signal(\"Kick\"), " +
      'sinceHit("Kick")): Trapcode Sound Keys\' way. A `band` listens to frequencies of a source and shapes them ' +
      "into 0..1 (a kick: 40–120 Hz, threshold 0.4, release 0.1, onsets on; a snare's crack: 2–5 kHz; hats: 8 kHz up; " +
      "a voice: 300 Hz–3 kHz), 1 as loud as the sound's own loud parts unless `autoGain` is off; with `onsets` it also " +
      "has a hit each time it rises out of silence. `events` is a list of hits (see set_events); `curve` a 0..1 " +
      "line through points. Times are the main timeline's seconds. Give it a `role` so looks made for \"the kick\" find it. " +
      "Check what it hears with get_signals (its name in `signals`) or plot_signals.",
    inputSchema: obj(
      {
        signal: str("The signal to change (id or name); absent: a new one."),
        name: str("Its name (unique in the video)."),
        kind: oneOf(["band", "events", "curve"], "What it is (needed for a new one)."),
        role: oneOf(["kick", "snare", "hats", "bass", "vocal", "lead", "mix"], "What it stands for."),
        color: str("#rrggbb."),
        source: str('band: what it listens to: "master" (the mix, default), a track\'s name or id, or a clip id.'),
        low: num("band: lowest frequency, Hz.", { minimum: 20, maximum: 20000 }),
        high: num("band: highest frequency, Hz.", { minimum: 20, maximum: 20000 }),
        gain: num("band: dB added first (default 0).", { minimum: -24, maximum: 24 }),
        threshold: num("band: 0..1, under it reads 0 (default 0).", { minimum: 0, maximum: 0.99 }),
        attack: num("band: seconds to rise (default 0.005).", { minimum: 0, maximum: 10 }),
        release: num("band: seconds to fall (default 0.1).", { minimum: 0, maximum: 10 }),
        curve: num("band: a power on what's over the threshold (default 1).", { minimum: 0.1, maximum: 10 }),
        autoGain: bool("band: against the sound's own loud parts (default true), or full scale."),
        onsets: bool("band: also a hit each time it rises out of silence."),
        events: arr(obj({ time: num("Timeline seconds.", { minimum: 0 }), velocity: num("0..1 (default 1).", { minimum: 0, maximum: 1 }), length: num("Seconds held."), key: int("A MIDI note.") }, ["time"]), "events: its hits."),
        points: arr(obj({ time: num("Timeline seconds.", { minimum: 0 }), value: num("0..1.", { minimum: 0, maximum: 1 }) }, ["time", "value"]), "curve: its points."),
      },
      ["name"],
    ),
  }),
  tool({
    name: "delete_signal",
    title: "Delete signals",
    kind: "edit",
    description: "Delete some of the video's own signals (by id or name), and every link to them.",
    inputSchema: obj({ signals: arr(str("Id or name."), "The signals.", { minItems: 1 }) }, ["signals"]),
  }),
  tool({
    name: "set_events",
    title: "Set a signal's hits",
    kind: "edit",
    description:
      "Edit an events signal's hits (made with this name if there's none): `clear` them, `remove` those in a stretch, " +
      "`add` some at times, add one `at` each beat, bar, drop or kind of hit of the sound between `from` and `to` " +
      "(`every` 2: every other one), then `quantize` them all to the beat (1: beats, 2: eighths, 4: sixteenths). " +
      "Links and expressions then punch on them: a flash on chosen beats, a cut look on the snare.",
    inputSchema: obj(
      {
        signal: str("An events signal (id or name)."),
        clear: bool("Remove every hit first."),
        remove: obj({ from: time("From."), to: time("To.") }, ["from", "to"], "Remove the hits in this stretch."),
        add: arr(obj({ time: time("When."), velocity: num("0..1 (default 1).", { minimum: 0, maximum: 1 }), length: num("Seconds held."), key: int("A MIDI note.") }, ["time"]), "Hits to add."),
        at: oneOf(["beats", "bars", "drops", "onset", "onsetLow", "onsetMid", "onsetHigh"], "Add a hit at each of these."),
        source: str('For `at` hits: "master" (default), a track\'s name or id, or a clip id.'),
        from: time("`at` from (default 0)."),
        to: time("`at` to (default the end)."),
        every: int("`at`: keep every nth (default 1).", { minimum: 1 }),
        velocity: num("`at`: how hard (default: each hit's own, 1 for beats).", { minimum: 0, maximum: 1 }),
        quantize: int("Snap every hit to this many divisions of a beat.", { minimum: 1, maximum: 16 }),
      },
      ["signal"],
    ),
  }),
  tool({
    name: "add_effect",
    title: "Add an effect",
    kind: "edit",
    description:
      'Add a video effect (see get_catalog "video_effects") to clips on video tracks, drawn over their other ' +
      "effects, optionally with parameter values. Returns each clip's new effect id (the type, or type_2...). " +
      'Also adds a mask (type "mask": the clip only shows inside `path`, given as SVG path data or [[x, y], ...] ' +
      "points in fractions of the clip's frame, e.g. [[0,0],[0.5,0],[0.5,1],[0,1]] keeps its left half; mode add | " +
      "subtract | intersect, inverted, feather and expansion in px; keyframe `path` with set_keyframes to animate " +
      'a reveal), and to a shape layer more shapes (type "vector-shape") and shape operators (trim-paths, repeater, ' +
      'offset-paths, round-corners, wiggle-paths, zig-zag, merge-paths): see get_catalog "masks_and_shapes". ' +
      'And to a text clip a text animator (type "text-animator"): a range over its characters, words or lines ' +
      "(start, end, offset: fractions of the text) and what the letters inside it get (position in px, scale, " +
      "rotation, opacity, blur, tracking, fill); keyframe the range with set_keyframes to sweep it across the text, " +
      'or pass `preset` for a ready-made one (fade-characters, typewriter, pop-words...): see get_catalog "text_animators".',
    inputSchema: obj(
      {
        clipIds: clipIds(),
        type: str('Video effect type, "mask", "text-animator" (text clips), or on a shape layer "vector-shape" or an operator.'),
        params: params("Parameter values by key."),
        preset: str('For "text-animator": a ready-made animator (get_catalog "text_animators"), animated from each clip\'s start.'),
      },
      ["clipIds", "type"],
    ),
  }),
  tool({
    name: "edit_effect",
    title: "Change an effect",
    kind: "edit",
    description:
      "Turn one of clips' effects on or off, reset its parameters to their defaults, move a video effect, a mask " +
      "or a shape layer's shape or operator earlier/later among the others of its kind, or remove it (not the " +
      "built-in effects).",
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
      "parameter values, their `position` (canvas fractions), and their `animation`: spoken-words (each word " +
      "appears as it's said), spoken-highlight (the word being said is coloured) or spoken-bounce (it grows), " +
      'which follow the speech; or a transition type each caption appears with; or "none". Their words and timing stay.',
    inputSchema: obj({
      preset: str("Caption style preset id."),
      text: params("Text parameters (font, fontStyle, size, textCase...)."),
      appearance: params("Appearance parameters (fill, strokeWidth, shadow...)."),
      position: arr(num("Fraction"), "[x, y] canvas fractions.", { minItems: 2, maxItems: 2 }),
      animation: str('spoken-words, spoken-highlight, spoken-bounce, a transition type, or "none".'),
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
    name: "make_subclips",
    title: "Make subclips",
    kind: "edit",
    description:
      "Keep parts of a long media file as subclips (Premiere's Make Subclip): each is listed in the user's Media " +
      "tab under the file, with a name, and goes on the timeline as that part (add_clips subclipId). Nothing is " +
      "copied. Use it to pull the good bits out of raw footage (find them with get_transcript assetId, " +
      "view_media, detect_scenes) so the user can pick from them. Names default to the file's name, numbered.",
    inputSchema: obj(
      {
        assetId: str("Media id (a video or sound file)."),
        items: arr(
          obj(
            {
              in: num("Start, source seconds.", { minimum: 0 }),
              out: num("End, source seconds."),
              name: str("What it is, e.g. \"Pricing question\"."),
            },
            ["in", "out"],
          ),
          "The parts to keep.",
          { minItems: 1, maxItems: 100 },
        ),
      },
      ["assetId", "items"],
    ),
  }),
  tool({
    name: "edit_subclips",
    title: "Edit subclips",
    kind: "edit",
    description:
      "Rename subclips, change their part of the file (`in`/`out`, source seconds) or delete them (`delete: true`). " +
      "Deleting one leaves the file and the timeline as they are.",
    inputSchema: obj(
      {
        items: arr(
          obj(
            {
              subclipId: str("Subclip id (from list_media)."),
              name: str("New name."),
              in: num("New start, source seconds.", { minimum: 0 }),
              out: num("New end, source seconds."),
              delete: bool("Delete it."),
            },
            ["subclipId"],
          ),
          "Changes, one per subclip.",
          { minItems: 1 },
        ),
      },
      ["items"],
    ),
  }),
  tool({
    name: "batch",
    title: "Make several edits",
    kind: "edit",
    description:
      "Run several edit tools in order as ONE undo step (the user undoes them together). Each step is " +
      '{ "tool": name, "input": {...} } with any edit tool (add_clips ... edit_subclips). Later steps see earlier ' +
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
      '(spoken-words, spoken-highlight or spoken-bounce to follow the speech word by word; or a transition type; or "none"), ' +
      "punctuation, language, engine.",
    inputSchema: obj({
      clipIds: arr(str("Clip id"), "Only these clips."),
      preset: str("Style preset id."),
      length: oneOf(["word", "short", "line", "lines"], "How much each caption shows."),
      animation: str('spoken-words, spoken-highlight, spoken-bounce, a transition type, or "none".'),
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
      "Save to the Library (shared by every video): media files (`assetIds`, one item each), subclips " +
      "(`subclipIds`, one item each: that part of the file), or timeline clips with their effects and transitions " +
      "as one reusable item (`clipIds` + `name`).",
    inputSchema: obj({
      assetIds: arr(str("Media id"), "Media files to add."),
      subclipIds: arr(str("Subclip id"), "Subclips to add."),
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
      "Render the video to a file and wait for it. Returns where the file is and its size. The user can also export " +
      "from the Export button. Formats: " +
      EXPORT_FORMATS.map((f) => `${f.id} (${f.label}, .${f.extension}: ${f.description.replace(/\.$/, "")})`).join("; ") +
      ". H.264 (the default) is what to post; ProRes or PNG when the user takes it into another program. `alpha` " +
      "makes what no clip covers transparent instead of black (prores-4444 and png only): for overlays such as a " +
      "visualizer or titles over footage edited elsewhere; leave out full-frame backgrounds then.",
    inputSchema: obj({
      resolution: oneOf(["720p", "1080p", "4k"], "Default 1080p."),
      fileName: str("File name without extension."),
      excludeAudio: bool("Leave out the audio tracks."),
      format: oneOf(EXPORT_FORMATS.map((f) => f.id), "Default h264."),
      quality: oneOf(EXPORT_QUALITIES.map((q) => q.id), "h264 and hevc only: standard (default), high or best (slower, larger)."),
      alpha: bool("Transparent background (prores-4444 and png only). Default false."),
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

export type VideoToolName = (typeof VIDEO_TOOLS)[number]["name"];

export type EditToolName = Extract<(typeof VIDEO_TOOLS)[number], { kind: "edit" }>["name"];
