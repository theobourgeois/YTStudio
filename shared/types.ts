/**
 * Domain + API types shared by the web client and the local render server.
 * All times are in seconds (floating point) unless the name says otherwise.
 */
import type { AssistantModelInfo, AssistantProvider } from "./assistant.ts";
import type { BezierPath } from "./path.ts";
import type { TextLayout } from "./text-drawing.ts";
import type { SuiteId } from "./suites.ts";
import type { ToolResult } from "./tool-spec.ts";

// ---------------------------------------------------------------------------
// Media library
// ---------------------------------------------------------------------------

export type AssetKind = "video" | "audio" | "image";

/** `processing` = probed and usable, but filmstrip/waveform still generating. */
export type AssetStatus = "processing" | "ready" | "error";

export interface Filmstrip {
  /** Number of frames. Frame `i` (0-based) shows source time `i * duration / count`. */
  count: number;
  /** Pixel size of every frame image. */
  width: number;
  height: number;
  /** URL with a `{i}` placeholder for the 1-based, zero-padded (3 digits) frame number. */
  urlPattern: string;
}

export interface MediaAsset {
  id: string;
  /**
   * The project (video) this asset was imported into; each project has its own media.
   * `null` for media in the shared Library (see `LibraryItem`).
   */
  projectId: string | null;
  /** Original file name, e.g. "clip.mp4". */
  name: string;
  kind: AssetKind;
  /** Seconds. A still image has no length of its own: this is how long a new clip of it is. */
  duration: number;
  width: number | null;
  height: number | null;
  fps: number | null;
  /** Has a picture: a video stream or a still image. */
  hasVideo: boolean;
  hasAudio: boolean;
  /** File size in bytes. */
  size: number;
  /** Epoch milliseconds. */
  createdAt: number;
  status: AssetStatus;
  error?: string;
  /** URL of the original media file (supports HTTP range requests). */
  src: string;
  /** Poster frame / thumbnail URL (video and images). */
  poster: string | null;
  /** Timeline thumbnails (video only, null until generated). */
  filmstrip: Filmstrip | null;
  /** URL of a `WaveformData` JSON document (assets with audio, null until generated). */
  waveform: string | null;
  /**
   * A copy of the media played backwards, for reversed clips (`Clip.reversed`).
   * Made on demand (`POST /api/media/:id/reversed`), then kept. Absent until asked for.
   */
  reversed?: ReversedMedia;
  /**
   * What its sound does at every moment (`shared/signals/`): made after its waveform for every file with
   * sound, or when first needed (`POST /api/media/:id/signals`). Absent until then.
   */
  signals?: MediaSignals;
  /**
   * The asset this one is a copy of: the Library media it came from, or the
   * project media it was added to the Library from; or for a file of the music
   * Browser's, `file:<path>:<size>:<modified>`. Used to avoid copying twice.
   */
  origin?: string;
  /**
   * What an image's pixels are, beyond what ffprobe says (the photo suite's probe, when there is one):
   * absent for other kinds, and for images imported without it.
   */
  image?: ImageInfo;
  /**
   * Not a file: a nested sequence of the project, standing in for media so its clips can be
   * trimmed, retimed and placed like a video's (see `sequenceAsset`). Never sent to the server.
   */
  sequence?: true;
}

/** An image file's samples as stored (validated by `normalizeImageInfo`, `shared/media.ts`). */
export interface ImageInfo {
  /** Bits a sample. */
  bits: 8 | 16;
  hasAlpha: boolean;
  /** EXIF orientation (1-8; 1 is upright). `MediaAsset.width`/`height` are already after it. */
  orientation: number;
  /** The embedded ICC profile, base64; null when there's none (sRGB is assumed). */
  icc: string | null;
  /** The file's format as its decoder names it ("png", "jpeg", "webp"...). */
  format: string;
}

/**
 * A media file's reversed copy: `duration` long like the original, so source
 * time `s` is at `duration - s` in it (see `fileTime`).
 */
export type ReversedMedia =
  | { status: "processing" }
  | { status: "ready"; src: string }
  | { status: "error"; error: string };

/** A media file's signals: `src` is the file (`SignalData`), of the analysis `version` (an older one is made again). */
export type MediaSignals =
  | { status: "processing" }
  | { status: "ready"; src: string; version: number }
  | { status: "error"; error: string };

export interface WaveformData {
  peaksPerSecond: number;
  /** Normalised peak amplitude per bucket, 0..1. */
  peaks: number[];
}

// ---------------------------------------------------------------------------
// Project / timeline
// ---------------------------------------------------------------------------

export type AspectRatio = "9:16" | "16:9" | "1:1" | "4:5";
export type FitMode = "contain" | "cover";
export type TrackKind = "video" | "audio";

export interface ProjectSettings {
  aspectRatio: AspectRatio;
  fps: number;
}

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  muted: boolean;
  /** A video track whose pictures aren't drawn (Premiere's Toggle Track Output); its sound still plays. Absent: shown. */
  hidden?: boolean;
}

export interface Clip {
  id: string;
  /** The media it shows or plays; "" for a clip without media: text, a solid or an adjustment layer (see `clipKind`). */
  assetId: string;
  trackId: string;
  /** Position on the timeline. */
  start: number;
  /** Source in-point. Stills have no source range, so theirs may be any value (even negative). */
  in: number;
  /** Source out-point (exclusive), always > `in`. Clip duration = (out - in) / speed. */
  out: number;
  /**
   * How fast the media plays (Premiere's Speed/Duration): 2 plays twice as fast
   * (so the clip is half as long), 0.5 in slow motion. Absent means 1. Only
   * clips of videos and sounds have one (see `clipSpeed`).
   */
  speed?: number;
  /**
   * Plays backwards, from `out` down to `in` (Premiere's Reverse Speed). The
   * preview and the export play a reversed copy of the media (`MediaAsset.reversed`).
   */
  reversed?: true;
  /**
   * `false`: at a speed other than 1 the sound's pitch follows the speed (faster
   * sounds higher). By default the pitch is kept (Premiere's Maintain Audio Pitch).
   */
  keepPitch?: false;
  /**
   * How the frames between its media's own are made when it's slowed down (or sped up, or at
   * another frame rate), Premiere's Time Interpolation: absent is Frame Sampling (the nearest
   * frame is shown), `blend` cross-fades the two frames either side, `flow` warps both along
   * the optical flow between them to where things are in between (smooth slow motion, like
   * Twixtor). Only clips of videos.
   */
  timeInterpolation?: "blend" | "flow";
  /**
   * Everything else about the clip (framing, position, scale, opacity, volume...),
   * as effects in the order they apply. See `shared/effects.ts`.
   */
  effects: Effect[];
  /**
   * Transition at the clip's start: from the clip that ends right where this
   * one starts (when that clip has no out-transition of its own), otherwise
   * from nothing. See `shared/transitions.ts`.
   */
  transitionIn?: Transition;
  /** Transition at the clip's end: into the clip right after it, otherwise into nothing. */
  transitionOut?: Transition;
  /**
   * A text clip made by Auto captions. The Captions tab edits the style of
   * every caption at once (see `shared/captions.ts`).
   */
  caption?: true;
  /**
   * An adjustment layer (Premiere's and After Effects'): it draws nothing of its
   * own; its video effects, Motion and Opacity apply to everything drawn below
   * it. Only on clips without media, on a video track.
   */
  adjustment?: true;
  /**
   * A null object (After Effects'): draws nothing, but has a Motion that the clips parented
   * to it follow. Only on clips without media, on a video track.
   */
  nullObject?: true;
  /** The clip this one follows (After Effects' parenting, see `shared/parenting.ts`). */
  parent?: ClipParent;
  /** Clip markers, in source time and in order (see `shared/markers.ts`). */
  markers?: Marker[];
}

export type MarkerColor = "green" | "red" | "orange" | "yellow" | "blue" | "purple" | "white";

/**
 * A marker (Premiere's): a named point in time to cut, snap and animate to. On a
 * sequence its `time` is timeline time; on a clip, source time.
 */
export interface Marker {
  id: string;
  time: number;
  label?: string;
  /** Absent: green. */
  color?: MarkerColor;
  /** Put there by beat sync (a song's beat, bar or drop): marking the beats again replaces these, and leaves the others. */
  beat?: true;
}

/**
 * A clip's parent: another clip of the same sequence whose Motion carries this one. What
 * carries it is how far the parent's Motion has moved from `rest`, its pose when they were
 * linked (absent: its defaults, centred at 100% and upright), so linking moves nothing.
 */
export interface ClipParent {
  id: string;
  rest?: { position: Vec2; scale: Vec2; rotation: number };
}

// ---------------------------------------------------------------------------
// Transitions (see `shared/transitions.ts` for the definitions)
// ---------------------------------------------------------------------------

/** Where a transition between two clips sits: centred on the cut, starting at it or ending at it. */
export type TransitionAlignment = "center" | "start" | "end";

export interface Transition {
  /** Which definition in `TRANSITIONS` this is, e.g. "cross-dissolve". */
  type: string;
  /** Seconds. */
  duration: number;
  /** Only used between two clips; at a free edge the transition always sits inside the clip. */
  alignment: TransitionAlignment;
  /** Values of the definition's parameters. */
  params: ParamValues;
}

// ---------------------------------------------------------------------------
// Effects and their parameters (see `shared/effects.ts` for the definitions)
// ---------------------------------------------------------------------------

/** A 2D value, e.g. a position as fractions of the canvas. */
export type Vec2 = [number, number];

/** A number, a switch, text (or a choice, a colour, a font), a point, or a Bézier path (a mask's or a shape's outline). */
export type ParamValue = number | boolean | string | Vec2 | BezierPath;

/** Parameter values of one effect, by parameter key. */
export type ParamValues = Record<string, ParamValue>;

/** How a keyframed value travels from one keyframe to the next. */
/**
 * How a keyframe is passed through, like Premiere's temporal interpolation:
 * straight through (`linear`), slowing down on the way in (`ease-in`), easing
 * away from it (`ease-out`) or both (`ease`), or holding its value until the
 * next keyframe (`hold`). Or it's arrived at with a movement of its own (see
 * `dynamicProgress`): shooting past it and coming back (`overshoot`), swinging
 * around it until it settles (`spring`), or dropping onto it and bouncing
 * (`bounce`). Those shape the whole stretch from the keyframe before.
 */
export type Easing = "linear" | "ease-in" | "ease-out" | "ease" | "hold" | "overshoot" | "spring" | "bounce";

export interface Keyframe {
  /**
   * Source media time (the clock of `Clip.in`/`out`), so a keyframe stays on
   * its frame when the clip is moved, trimmed or split.
   */
  time: number;
  value: ParamValue;
  easing: Easing;
  /**
   * How far (0..1 of the time to the neighbouring keyframe) an eased side's
   * handle reaches, like After Effects' keyframe velocity influence: the
   * higher, the longer the value lingers near the keyframe and the snappier
   * the move in between. Absent means 1/3 (Premiere's Ease In/Out).
   */
  influence?: number;
  /**
   * The graph editor's Bézier handles (After Effects' temporal handles), each a point in its
   * segment's unit square: x is the fraction of the time between the two keyframes, y the
   * fraction of the change in value (it may overshoot, below 0 or above 1). `handleOut`
   * leaves this keyframe (in the segment after it), `handleIn` arrives at it (in the segment
   * before it, so its x is near 1). A side with a handle ignores `easing` and `influence`.
   */
  handleIn?: Vec2;
  handleOut?: Vec2;
  /**
   * A point's spatial Bézier handles (After Effects' motion path tangents), relative to its
   * value and in the value's own units: `spatialOut` leaves towards the next keyframe,
   * `spatialIn` arrives from the one before. Between two keyframes the point then travels
   * along that curve (at the pace the temporal curve says) instead of a straight line. Only
   * on keyframes of points.
   */
  spatialIn?: Vec2;
  spatialOut?: Vec2;
}

/** One effect on a clip (Premiere's "Effect Controls" entries). */
export interface Effect {
  /** Unique within the clip. Built-in effects use their type as id. */
  id: string;
  /** Which definition in `EFFECTS` this is, e.g. "motion". */
  type: string;
  /** Off = bypassed: every parameter acts as its default. */
  enabled: boolean;
  /** Static values, one per parameter of the definition. */
  params: ParamValues;
  /**
   * Animated parameters (sorted by time). A parameter with keyframes ignores
   * its static value. Nothing creates keyframes yet.
   */
  keyframes?: Record<string, Keyframe[]>;
  /**
   * Expressions (After Effects'), by parameter key: a short script run for every frame whose
   * result is the parameter's value then, e.g. `wiggle(2, 0.02)` or `loopOut()` (see
   * `shared/expressions.ts`). It sees the value the parameter would have without it (static,
   * or keyframed). Only on numbers and points.
   */
  expressions?: Record<string, string>;
  /**
   * Links to signals, by parameter key: the parameter moves with a sound (the bass, the kick, a custom
   * signal) by an amount (see `shared/links.ts`). Worked out after keyframes and before an expression,
   * which sees the linked value. Only where an expression can be (numbers and points).
   */
  links?: Record<string, ParamLink>;
  /**
   * The Shader effect's own code (type "shader" only; absent: the starting shader). Its parameters
   * are declared in it, so its definition is the instance's: `definitionOf` (`shared/shader-code.ts`).
   */
  shader?: ShaderCode;
}

/** Which GLSL a Shader effect's code is: ours (`effect(uv)`), the Interactive Shader Format, or Shadertoy's. */
export type ShaderDialect = "native" | "isf" | "shadertoy";

/** A Shader effect's code, up to 64 KB. */
export interface ShaderCode {
  code: string;
  dialect: ShaderDialect;
}

// ---------------------------------------------------------------------------
// Signals and links (the visualizer: docs/visualizer/README.md)
// ---------------------------------------------------------------------------

/** What a signal is read from, in a sequence: the whole mix, one track, or one clip. */
export type SignalSource = { kind: "master" } | { kind: "track"; trackId: string } | { kind: "clip"; clipId: string };

/** What a custom signal stands for, so looks made for "the kick" find it in any video. */
export type SignalRole = "kick" | "snare" | "hats" | "bass" | "vocal" | "lead" | "mix";

/** A hit of an events signal: a pad pressed, a note played, a moment the assistant chose (timeline seconds). */
export interface SignalEvent {
  time: number;
  /** 0..1. */
  velocity: number;
  /** Seconds it's held (a note's length), when it has one. */
  length?: number;
  /** A MIDI note number, when it came from one. */
  key?: number;
}

/**
 * A signal of the video's own, by name (Trapcode Sound Keys'): a band of frequencies of a source
 * shaped into 0..1, a list of hits, or a curve. Times are on the main sequence's timeline.
 */
export type SignalDef = {
  id: string;
  name: string;
  /** A CSS colour (#rrggbb). */
  color: string;
  role?: SignalRole;
} & (
  | {
      kind: "band";
      source: SignalSource;
      /** Hz, low < high. */
      low: number;
      high: number;
      /** dB added before the threshold. */
      gain: number;
      /** 0..1: below it the signal reads 0, and what's above is stretched to 0..1. */
      threshold: number;
      /** Seconds to rise and to fall (0: at once). */
      attack: number;
      release: number;
      /** A power: 1 straight, above 1 only the loud parts count, below 1 the quiet ones too. */
      curve: number;
      /** 0..1 against the sound's own loud parts (true), or against full scale. */
      autoGain: boolean;
      /** Also a hit each time it rises out of silence. */
      onsets: boolean;
    }
  | { kind: "events"; events: SignalEvent[] }
  | { kind: "curve"; points: { time: number; value: number }[] }
);

/**
 * Which signal: a built-in one by name (`level`, `bass`, `onsetLow`, `beat`...; see `LINK_SIGNALS`)
 * of a source (absent: the mix), or a custom one by id.
 */
export type SignalRef = { name: string; source?: SignalSource } | { id: string };

/** How a signal's 0..1 is shaped before it moves anything. */
export interface SignalResponse {
  /** 0..1: below it nothing moves. */
  threshold: number;
  /** A power on what's above the threshold. */
  curve: number;
  /** Seconds to rise and to fall. */
  attack: number;
  release: number;
  /** 1 - the value: moves when it's quiet. */
  invert: boolean;
}

/** What one hit does over time (attack up to its velocity, hold, decay to 0), in seconds. */
export interface HitShape {
  attack: number;
  hold: number;
  decay: number;
}

/**
 * A parameter linked to a signal (`Effect.links`). `add`: plus `amount` times the signal;
 * `multiply`: times 1 + `amount` times the signal (0.5: up to 50% more); `map`: from its own value
 * towards `to` as the signal goes from 0 to 1. A point's amounts may be points.
 */
export interface ParamLink {
  signal: SignalRef;
  mode: "add" | "multiply" | "map";
  amount: number | Vec2;
  to?: number | Vec2;
  response: SignalResponse;
  /** For hits (events, onsets, the beat): the shape each one makes. Absent: they're read as they come. */
  hit?: HitShape;
}

/**
 * A song's beat as its music project knew it (its tempo map), so nothing has to guess it: the clips
 * playing its files (its mix and stems) take it, in their own seconds, instead of the beat analysis
 * found in them, wherever they're moved, trimmed or sped up.
 */
export interface SongTempo {
  /** The song's files, which all start on its first beat. */
  assetIds: string[];
  /** Beats in a bar (the first beat starts one). */
  beatsPerBar: number;
  /** Every beat, in the files' seconds, in order. */
  beats: number[];
}

/**
 * Timeline rules:
 * - `tracks` is in display order: one or more video tracks, then zero or more
 *   audio tracks. The first video track is drawn on top of the ones below it.
 * - Clips are freely positioned (gaps allowed) but never overlap other clips
 *   on the same track, and never start before 0.
 */
export interface Project {
  version: 1;
  name: string;
  settings: ProjectSettings;
  tracks: Track[];
  clips: Clip[];
  /** The (main) sequence's markers, in time order (see `shared/markers.ts`). */
  markers?: Marker[];
  /** Parts of media files kept as media of their own (see `Subclip`), in the order they were made. */
  subclips?: Subclip[];
  /** The video's own signals (`SignalDef`), for every sequence, in the order they were made. */
  signals?: SignalDef[];
  /** A song's exact beat, handed over by the music suite (Make visualizer): what `beat()` hears in its files. */
  tempo?: SongTempo;
  /**
   * Nested sequences (Premiere's nests, After Effects' precomps), in the order they were made.
   * The project's own tracks and clips are its main sequence. A clip plays a sequence by
   * having the sequence's id as its `assetId` (see `shared/sequences.ts`).
   */
  sequences?: Sequence[];
}

/**
 * A sequence nested in a video: a timeline of its own, with its own size, frame rate and
 * (optionally) length, played by clips like a video file is. Its tracks and clips follow
 * the same rules as the project's.
 */
export interface Sequence {
  id: string;
  name: string;
  settings: ProjectSettings;
  tracks: Track[];
  clips: Clip[];
  /** Seconds. Absent: as long as its clips (they end where its last clip ends). */
  duration?: number;
  /** Its own markers, in time order. */
  markers?: Marker[];
}

/**
 * A named part of a media file (Premiere's subclip), made in the source preview with In/Out
 * and ⌘U. It's listed in the Media tab like a file and goes on the timeline as that part.
 * It only points at the file (nothing is copied), and belongs to the project, so it's undoable.
 */
export interface Subclip {
  id: string;
  /** The video or sound file it's part of (never an image). */
  assetId: string;
  name: string;
  /** Source seconds: at least `MIN_CLIP_DURATION` apart, inside the file. */
  in: number;
  out: number;
}

// ---------------------------------------------------------------------------
// Projects: each one is a package on disk (`Name.yt/`, see `server/packages.ts`) of one suite (a
// video, a song... see `shared/suites.ts`), wherever the user keeps it. The app lists the ones this
// computer has opened, its recents, the latest first, on the Home screen.
// ---------------------------------------------------------------------------

interface ProjectSummaryBase {
  id: string;
  /** Mirrors the document's `name` (and its package's, once it's closed). */
  name: string;
  /** Epoch milliseconds. */
  createdAt: number;
  /** Last time the project document was saved (epoch ms). */
  updatedAt: number;
  /** Last time it was opened on this computer (epoch ms; when it was made or added, until then). */
  openedAt: number;
  /** Its package on this computer (`.../Summer edit.yt`). */
  path: string;
  /**
   * It isn't where it was last seen (moved or renamed in Finder, deleted, on a drive that's gone): the rest is
   * what was known of it then. Locate it (open it where it is now) or remove it from the recents.
   */
  missing?: true;
  /**
   * Its document (`project.json`) is there but damaged, so it can't be opened: what to tell the user (a copy
   * was kept in its package, and nothing will write over it). The rest is what its folder says.
   */
  damaged?: string;
  /** Length in seconds (0 when empty). */
  duration: number;
  /** A picture for its card, if it has one. */
  thumbnail: string | null;
}

/** A cached rendition of the first 30 seconds of the saved project. */
export interface ProjectPreview {
  revision: number;
  state: "idle" | "queued" | "rendering" | "ready" | "empty" | "error";
  src?: string;
  poster?: string;
  duration?: number;
  /** Small, normalised amplitude buckets of the rendered mix, not its source samples. */
  peaks?: number[];
  error?: string;
}

/** What the Home screen knows of each suite's projects without opening them (see `server/suites/`). */
export interface SuiteSummaries {
  video: {
    aspectRatio: AspectRatio;
    clipCount: number;
  };
  music: {
    tempo: number;
  };
  photo: {
    width: number;
    height: number;
    layerCount: number;
  };
}

/** A project in the list: the common fields, plus its suite's (`suite` tells which). */
export type ProjectSummary = {
  [S in SuiteId]: ProjectSummaryBase & { suite: S } & SuiteSummaries[S];
}[SuiteId];

export type SuiteProjectSummary<S extends SuiteId> = Extract<ProjectSummary, { suite: S }>;

/**
 * The header of `GET /api/projects/:id` that says what the check on opening changed (the photo suite's: pixels
 * were missing, so an earlier version opened), URI-encoded. Absent when the document opened as it was saved.
 */
export const PROJECT_NOTICE_HEADER = "X-Project-Notice";

export interface CreateProjectRequest {
  name?: string;
  /** Which app it's for (default: video). */
  suite?: SuiteId;
  /** Start from nothing, even if the suite has a starting point. */
  blank?: boolean;
  /** The suite's own choices for a new document, kept in the tab (the music suite's default tempo). */
  options?: unknown;
}

/**
 * A suite's starting point: a copy of a project (its document, media and plugin settings) that every
 * new project of that suite starts as. `name` is the project it was saved from.
 */
export interface ProjectTemplate {
  name: string;
  savedAt: number;
}
export type ProjectTemplates = Partial<Record<SuiteId, ProjectTemplate>>;

export interface UpdateProjectRequest {
  /** Renames the project and its package. */
  name: string;
}

/** `POST /api/projects/open`: a package on this computer (its folder, or a file inside it). */
export interface OpenProjectRequest {
  path: string;
}

/** Where new projects are made (`~/Documents/YTStudio` unless the user picked another folder). */
export interface ProjectLocation {
  path: string;
  /** Where they go unless the user picks another. */
  default: string;
}

// ---------------------------------------------------------------------------
// Library: media and saved clips shared by every project (see `shared/library.ts`).
// Using an item copies its media into the project, so projects stay self-contained.
// ---------------------------------------------------------------------------

export interface LibraryFolder {
  id: string;
  name: string;
  /** The folder it's in; null at the top level. */
  parentId: string | null;
  /** Epoch milliseconds. */
  createdAt: number;
}

/** Clips saved from a timeline, laid out like a small project: tracks in display order, times from 0. */
export interface ClipTemplate {
  tracks: Track[];
  /** `assetId`s are Library media ids ("" for text). */
  clips: Clip[];
}

interface LibraryItemBase {
  id: string;
  name: string;
  /** null at the top level. */
  folderId: string | null;
  /** Epoch milliseconds. */
  createdAt: number;
  /** Last time it was put in a project (epoch ms), null if never. */
  usedAt: number | null;
  favorite: boolean;
}

/** One file (a sound effect, a logo...). */
export interface LibraryMediaItem extends LibraryItemBase {
  kind: "media";
  mediaId: string;
}

/** Clips with their settings (a placed logo, a styled title, an intro with its transition...). */
export interface LibraryClipsItem extends LibraryItemBase {
  kind: "clips";
  template: ClipTemplate;
}

export type LibraryItem = LibraryMediaItem | LibraryClipsItem;

export interface Library {
  folders: LibraryFolder[];
  items: LibraryItem[];
  /** Every file the items use. */
  media: MediaAsset[];
}

/** A new item and the Library media it uses. */
export interface LibraryEntry {
  item: LibraryItem;
  media: MediaAsset[];
}

export interface CreateLibraryFolderRequest {
  name: string;
  parentId?: string | null;
}

export interface UpdateLibraryFolderRequest {
  name?: string;
  parentId?: string | null;
}

export interface UpdateLibraryItemRequest {
  name?: string;
  folderId?: string | null;
  favorite?: boolean;
}

/** Add a project's media file to the Library. */
export interface SaveMediaToLibraryRequest {
  assetId: string;
  folderId?: string | null;
  name?: string;
}

/** Save timeline clips (with their effects and transitions) to the Library. */
export interface SaveClipsToLibraryRequest {
  projectId: string;
  name: string;
  folderId?: string | null;
  /** The tracks the clips are on, in display order. */
  tracks: Track[];
  clips: Clip[];
}

export interface UseLibraryItemRequest {
  projectId: string;
}

export interface UseLibraryItemResponse {
  /** The item's media, copied into the project (or copies already there). */
  assets: MediaAsset[];
  /** For saved clips: the template with its `assetId`s pointing at `assets`. */
  template: ClipTemplate | null;
  /** The item with its `usedAt` updated. */
  item: LibraryItem;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export type ExportResolution = "720p" | "1080p" | "4k";
/** What an export makes (described in `shared/export-formats.ts`). */
export type ExportFormat = "h264" | "hevc" | "prores-hq" | "prores-4444" | "png";
/** H.264's and HEVC's quality. */
export type ExportQuality = "standard" | "high" | "best";

export interface ExportRequest {
  project: Project;
  resolution: ExportResolution;
  /** Optional output name without extension. */
  fileName?: string;
  /** Render without the audio tracks (e.g. to add the song in-app when posting). */
  excludeAudioTracks?: boolean;
  /** What to make (`shared/export-formats.ts`); absent: H.264. */
  format?: ExportFormat;
  /** H.264's and HEVC's quality; absent: standard. */
  quality?: ExportQuality;
  /** Transparent where no clip covers the frame (ProRes 4444 and PNG sequences only); the canvas's black otherwise. */
  alpha?: boolean;
  /**
   * Every text clip laid out by the browser at the export's size (the server has
   * no way to measure text in the user's fonts), by clip id: one layout, or
   * one per change when its words, size or font are animated. The export's page
   * draws the text itself from these.
   */
  texts?: Record<string, TextLayoutAt[]>;
}

/** A text clip's layout for the export, in output px (see `shared/text-drawing.ts`). */
export interface TextLayoutAt {
  layout: TextLayout;
  /** Source time this layout holds from, until the next one's (the first holds from the start). */
  from?: number;
}

export type ExportStatus = "queued" | "rendering" | "done" | "error" | "cancelled";

/**
 * Render a video's heavy segments to render files (Premiere's Render Effects In to Out, docs/render-files.md):
 * the main sequence as the tab has it, with its texts laid out as an export's are.
 */
export interface RenderRequest {
  project: Project;
  texts?: Record<string, TextLayoutAt[]>;
}

/** A render of a video's segments: how far it is, and the segments' keys rendered so far. */
export interface RenderJob {
  id: string;
  projectId: string;
  status: ExportStatus;
  /** 0..1 */
  progress: number;
  /** Segments it renders, and the keys of those done (their files are there). */
  segments: number;
  rendered: string[];
  error?: string;
}

/** The render files a video has (by segment key), and its render running (or last finished), if any. */
export interface RenderFilesState {
  keys: string[];
  job: RenderJob | null;
}

export interface ExportJob {
  id: string;
  status: ExportStatus;
  /** 0..1 */
  progress: number;
  error?: string;
  createdAt: number;
  width: number;
  height: number;
  duration: number;
  /** Download URL (served with Content-Disposition: attachment) once done. */
  downloadUrl: string | null;
  /** Inline URL, playable in a <video>, once done (an MP4's; null for a MOV or a ZIP). */
  url: string | null;
  /** Without its extension. */
  fileName: string;
  format: ExportFormat;
  quality: ExportQuality;
  alpha: boolean;
  /** The file's extension (mp4, mov, zip). */
  extension: string;
  /** The file's size once done. */
  bytes?: number;
}

// ---------------------------------------------------------------------------
// Online media (YouTube search, or a link to any site yt-dlp supports)
// ---------------------------------------------------------------------------

export interface WebClip {
  /** Page URL; YouTube links are canonical (`https://www.youtube.com/watch?v=<id>`). */
  url: string;
  title: string;
  /** Uploading channel or account (usually the artist or creator). */
  channel: string;
  /** Seconds; 0 when the site doesn't say. */
  duration: number;
  thumbnail: string | null;
  /** Uploaded by a verified channel (usually the official upload). */
  verified: boolean;
  /** Where it's from, e.g. "YouTube", "TikTok". */
  site: string;
}

/** A page of a search's results, and whether there's another after it (`GET /api/web/search`). */
export interface WebSearchPage {
  clips: WebClip[];
  more: boolean;
}

/** What to take from an online clip: just its sound, or the whole video. */
export type WebMediaKind = "audio" | "video";

/** How far a download from the Online tab has got (`GET /api/web/progress`). */
export interface WebDownloadProgress {
  /** `waiting`: queued behind other downloads (or not downloading). `processing`: downloaded, being merged or converted. */
  status: "waiting" | "downloading" | "processing";
  /** 0..1 while downloading; null until the size is known. */
  progress: number | null;
}

export interface ImportWebMediaRequest {
  projectId: string;
  url: string;
  /** Display name for the imported media (default: the link's own title). */
  title?: string;
  kind: WebMediaKind;
}

// ---------------------------------------------------------------------------
// Fonts installed on the computer running the server
// ---------------------------------------------------------------------------

export interface FontStyleInfo {
  /** Style name, e.g. "Bold Italic". */
  name: string;
  /** CSS weight, 100..900. */
  weight: number;
  italic: boolean;
  /** CSS font-stretch keyword ("normal", "condensed"...). */
  stretch: string;
}

export interface FontFamily {
  family: string;
  /** Normal width first, then by weight, upright before italic. */
  styles: FontStyleInfo[];
}

// ---------------------------------------------------------------------------
// Transcription (Auto captions): speech to timed words, on this computer or
// with a cloud API. See `server/transcription/`.
// ---------------------------------------------------------------------------

export type TranscriptionEngineId = "local" | "openai" | "groq";

export interface TranscriptionEngineInfo {
  id: TranscriptionEngineId;
  label: string;
  /** One line on what it is (model, cost, privacy). */
  description: string;
  kind: "local" | "cloud";
  /** `missing`: needs setting up (installing, or an API key). `installing`: being set up now. */
  status: "ready" | "missing" | "installing" | "error";
  /** What's missing, what setup is doing, or what went wrong. */
  message: string | null;
  /** Setup progress 0..1, null when it can't be told. */
  progress: number | null;
  /** The app can set it up by itself (local: Homebrew is installed). */
  canSetUp: boolean;
  /** Cloud: the API key comes from an environment variable. */
  keyFromEnv?: boolean;
  /** Cloud: an API key is saved in the app's settings (it can be removed). */
  hasSavedKey?: boolean;
  /** Cloud: where to get an API key. */
  keyUrl?: string;
}

export interface SetUpEngineRequest {
  /** Cloud engines: the API key to check and save. */
  apiKey?: string;
}

/** A stretch of a media file to transcribe (source time). */
export interface TranscriptionSource {
  assetId: string;
  in: number;
  out: number;
}

export interface TranscribeRequest {
  engine: TranscriptionEngineId;
  /** "auto" to detect it, or an ISO 639-1 code ("en", "fr"...). */
  language: string;
  sources: TranscriptionSource[];
}

export interface TranscriptWord {
  /** As spoken, with its leading space (none inside words, or in languages written without spaces). */
  text: string;
  /** Source time, seconds. */
  start: number;
  end: number;
}

/** The words spoken in one stretch of a media file. */
export interface Transcript {
  assetId: string;
  in: number;
  out: number;
  /** Detected (or requested) language code, when known. */
  language: string | null;
  words: TranscriptWord[];
}

export type TranscriptionStatus = "queued" | "running" | "done" | "error" | "cancelled";

export interface TranscriptionJob {
  id: string;
  status: TranscriptionStatus;
  /** 0..1 */
  progress: number;
  error?: string;
  /** Once done: one per stretch transcribed (overlapping sources of one file are merged). */
  transcripts: Transcript[] | null;
}

// ---------------------------------------------------------------------------
// Looking into media files (frames, sound, shots), and the in-app assistant
// (see `shared/assistant.ts` for its chats and `shared/assistant-tools.ts` for its tools)
// ---------------------------------------------------------------------------

/** A quiet stretch of a file's sound, in source seconds. */
export interface Silence {
  start: number;
  end: number;
}

export interface SoundAnalysis {
  silences: Silence[];
  /** dBFS; null when there's no telling (e.g. no sound at all). */
  meanVolume: number | null;
  maxVolume: number | null;
}

/** A stretch of music of about the same loudness. */
export interface MusicSection {
  start: number;
  end: number;
  /** Mean loudness, dBFS. */
  db: number;
  /** Compared with the loudest part: 1 = the loudest, 0 = 30 dB or more below it. */
  level: number;
}

/** The rhythm and shape of a file's music, in source seconds. */
export interface MusicAnalysis {
  /** Null when there's no steady beat (speech, ambient sound...). */
  bpm: number | null;
  /** How regular the beat is, 0..1 (0.15 or less: no real beat). */
  confidence: number;
  beats: number[];
  /** The first beat of each bar (of 4). */
  downbeats: number[];
  sections: MusicSection[];
  /** Where the energy jumps up (a drop, the beat coming in), biggest first, on a bar where there is one. */
  drops: { time: number; rise: number }[];
}

export interface SceneCuts {
  /** Source seconds where the picture cuts to a new shot. */
  cuts: number[];
}

/** Import a file from this computer by its path. */
export interface ImportFileRequest {
  projectId: string;
  /** Absolute (or starting with ~). */
  path: string;
}

/** Whether a provider's CLI (Claude Code, Codex) can run the assistant on this computer, and its models. */
export interface AssistantProviderStatus {
  provider: AssistantProvider;
  available: boolean;
  version: string | null;
  loggedIn: boolean;
  /** "Claude Max", "ChatGPT Plus", "API key"... */
  account: string | null;
  /** Why it can't be used, and what to do. */
  problem: string | null;
  /** What the picker offers (newest first; `legacy` ones last). */
  models: AssistantModelInfo[];
}

export interface AssistantStatus {
  providers: AssistantProviderStatus[];
}

export interface SendChatMessageRequest {
  text: string;
  /** The editor's state for the model, and its short label shown in the chat. */
  context?: string;
  contextLabel?: string;
  /** The tab sending it (it runs the tools). */
  tab: string;
}

/** A tool call's result posted back by the tab that ran it. */
export interface ToolCallResultRequest {
  tab: string;
  result: ToolResult;
}

export interface ToolCallProgressRequest {
  tab: string;
  fraction: number | null;
  label?: string;
}

// ---------------------------------------------------------------------------
// HTTP API (all JSON unless noted; errors are `ApiError` with a 4xx/5xx status)
//
//   GET    /api/health                  -> HealthResponse
//
//   GET    /api/projects                -> ProjectSummary[] (this computer's recents, every suite, the
//                                        latest opened or saved first; missing ones too, flagged `missing`,
//                                        and ones whose document is damaged, flagged `damaged`)
//   POST   /api/projects  body: CreateProjectRequest -> ProjectSummary (201): a new package in the location
//   POST   /api/projects/open  body: OpenProjectRequest -> ProjectSummary: a package from anywhere, added to
//                                        the recents (a copy of one already open gets ids of its own)
//   GET    /api/projects/location       -> ProjectLocation;  PUT body: { path } -> ProjectLocation
//   GET    /api/projects/:id            -> SuiteDocument (its suite's; a video's normalized against its media)
//                                        422 if its project.json is damaged (kept aside, never replaced); after
//                                        its suite's check on opening, which may open (and save) another
//                                        version, saying why in PROJECT_NOTICE_HEADER
//   PUT    /api/projects/:id  body: SuiteDocument -> ProjectSummary (bumps updatedAt; 422 while it's damaged;
//                                        409 if a photo names pixels the package hasn't got; 507 if the disk is full)
//   PUT    /api/projects/:id/cover  body: JPEG or PNG bytes (≤ 4 MB) -> 204: the picture a tab drew of it for
//                                        its card (`thumbnail`, when it has no media poster); 413 too big,
//                                        415 not a JPEG or PNG
//   GET    /api/projects/:id/cover      -> image/jpeg | image/png (404 if none was saved)
//   PATCH  /api/projects/:id  body: UpdateProjectRequest -> ProjectSummary (renames it and its package)
//   POST   /api/projects/:id/opened     -> ProjectSummary (bumps openedAt)
//   POST   /api/projects/:id/closed     -> ProjectSummary: its package takes its name, if it was renamed open
//   POST   /api/projects/:id/reveal     -> 204: shows its package in Finder
//   POST   /api/projects/:id/duplicate  -> ProjectSummary (201): a copy beside it with its own copy of the
//                                        media, named "<name> copy" (cloned files; caches left out)
//   DELETE /api/projects/:id            -> 204: its package goes to the Trash
//   DELETE /api/projects/:id/recent     -> 204: forgotten by the recents; its package stays where it is
//   GET    /api/projects/templates      -> ProjectTemplates (each suite's starting point, if it has one)
//   POST   /api/projects/:id/template   -> ProjectTemplates: a copy of the project (document, media and the
//                                        files beside it) becomes its suite's starting point, replacing any
//                                        other; POST /api/projects then starts from it unless `blank`
//   DELETE /api/projects/templates/:suite -> ProjectTemplates: new projects of that suite start blank again
//
//   GET    /api/media?projectId=<id>    -> MediaAsset[]   (that project's media, newest first)
//   POST   /api/media?projectId=<id>&name=<file name>  body: raw file bytes -> MediaAsset (201)
//                                        415 if the file has no audio/video stream, 404 unknown project
//   GET    /api/media/:id               -> MediaAsset
//   GET    /api/media/:id/frame?t=<s>&w=<px> -> image/jpeg: the frame at source time t, w px wide
//   GET    /api/media/:id/sound?from&to&threshold=<dB>&min=<s> -> SoundAnalysis (silences, loudness)
//   GET    /api/media/:id/music?from&to     -> MusicAnalysis (tempo, beats, bars, sections, drops)
//   GET    /api/media/:id/scenes?threshold=<0..1> -> SceneCuts
//   POST   /api/media/:id/reversed      -> MediaAsset: starts making its reversed copy (for reversed clips), if not made yet
//   POST   /api/media/:id/signals       -> MediaAsset: starts making its signals (what its sound does over time), if not made yet
//   POST   /api/media/import-file  body: ImportFileRequest -> MediaAsset (201): a copy of a file on this computer
//   DELETE /api/media/:id               -> 204
//   GET    /api/web/search?q=<query>&page=<n> -> WebSearchPage from YouTube, 15 a page from 0 (503 if yt-dlp isn't installed)
//   GET    /api/web/resolve?url=<link>  -> WebClip  (400 for unsupported links, playlists, livestreams)
//   GET    /api/web/audio?url=<link>    -> audio file (downloaded on first request, then cached)
//   GET    /api/web/progress?url=<link>&kind=audio|video -> WebDownloadProgress (poll while importing)
//   POST   /api/web/import  body: ImportWebMediaRequest -> MediaAsset (201)
//   GET    /api/library                 -> Library (every folder, item and the media they use)
//   POST   /api/library/folders  body: CreateLibraryFolderRequest -> LibraryFolder (201)
//   PATCH  /api/library/folders/:id  body: UpdateLibraryFolderRequest -> LibraryFolder (rename/move)
//   DELETE /api/library/folders/:id     -> 204 (with everything in it)
//   POST   /api/library/items?folderId=<id>&name=<file name>  body: raw file bytes -> LibraryEntry (201)
//   POST   /api/library/items/media  body: SaveMediaToLibraryRequest -> LibraryEntry (201)
//   POST   /api/library/items/clips  body: SaveClipsToLibraryRequest -> LibraryEntry (201)
//   PATCH  /api/library/items/:id  body: UpdateLibraryItemRequest -> LibraryItem
//   DELETE /api/library/items/:id       -> 204 (projects keep their copies)
//   POST   /api/library/items/:id/use  body: UseLibraryItemRequest -> UseLibraryItemResponse
//   GET    /api/library/media/:id       -> MediaAsset (a Library file)
//   GET    /api/fonts                   -> FontFamily[] installed on this computer (A to Z)
//   POST   /api/exports   body: ExportRequest -> ExportJob (202)
//   GET    /api/exports/formats         -> ExportFormat[] (what this computer's ffmpeg can make)
//   GET    /api/exports/:id             -> ExportJob
//   DELETE /api/exports/:id             -> 204 (cancels if running)
//   GET    /api/exports/:id/download    -> file (attachment)
//   GET    /api/render-files/:projectId  -> RenderFilesState (the render files a video has, and its render running)
//   POST   /api/render-files/:projectId  body: RenderRequest -> RenderJob (202; renders its heavy segments not rendered yet)
//   DELETE /api/render-files/:projectId  -> RenderFilesState (Delete Render Files; cancels a render running)
//   DELETE /api/render-files/jobs/:id    -> 204 (cancels a render)
//   GET    /api/render-files/:projectId/:key.mp4 -> a segment's render file (range requests; shared/render-files.ts)
//   GET    /api/transcription/engines   -> TranscriptionEngineInfo[]
//   POST   /api/transcription/engines/:id/setup  body: SetUpEngineRequest -> TranscriptionEngineInfo
//                                        (local: starts installing, poll the list; cloud: checks + saves the key)
//   DELETE /api/transcription/engines/:id/setup  -> TranscriptionEngineInfo (forgets a saved API key)
//   POST   /api/transcription/jobs  body: TranscribeRequest -> TranscriptionJob (202)
//   GET    /api/transcription/jobs/:id  -> TranscriptionJob
//   DELETE /api/transcription/jobs/:id  -> 204 (cancels if running)
//   GET    /api/assistant/status        -> AssistantStatus (are Claude Code and Codex installed and logged in; their models)
//   GET    /api/assistant/chats/:projectId  -> ChatSnapshot (a video's chat with the assistant)
//   PATCH  /api/assistant/chats/:projectId  body: { provider, model, effort } -> ChatSnapshot
//   POST   /api/assistant/chats/:projectId/messages  body: SendChatMessageRequest -> 204 (the answer streams as events)
//   POST   /api/assistant/chats/:projectId/stop  -> 204
//   DELETE /api/assistant/chats/:projectId  -> ChatSnapshot (a new, empty chat)
//   GET    /api/assistant/images/:projectId/:name -> a picture the assistant looked at
//   GET    /api/assistant/events?tab=<id>&project=<id> -> text/event-stream of TabEvent (server/assistant/bridge.ts):
//                                        tool calls for the tab to run, chat updates for its video, every chat's activity
//   POST   /api/assistant/tabs/:tab/focus  -> 204 (outside MCP clients act in the tab used last)
//   POST   /api/assistant/calls/:id/result  body: ToolCallResultRequest -> 204
//   POST   /api/assistant/calls/:id/progress  body: ToolCallProgressRequest -> 204
//   GET    /api/engine/plugins         -> EnginePlugin[] (the plugins the audio engine found; shared/music/engine.ts)
//   POST   /api/engine/song  body: SetSongRequest -> SetSongResponse (the song the engine plays, on every edit)
//   POST   /api/engine/record  body: RecordRequest -> RecordResponse (play and record the armed tracks; takes come as EngineTakeEvent)
//   POST   /api/engine/states           -> 204 (writes the song's plugins' states now)
//   POST   /api/engine/states/copy  body: CopyStatesRequest -> { copied } (a plugin's settings file to another's id)
//   GET    /api/engine/events           -> text/event-stream of EngineEvent (where the song is, the meter)
//   GET    /api/browser                 -> BrowserState (the music Browser's folders and favourites; shared/music/browser.ts)
//   POST   /api/browser/roots  body: AddBrowserRootRequest -> BrowserState (a folder dropped from Finder)
//   DELETE /api/browser/roots?path=     -> BrowserState
//   POST   /api/browser/favourites  body: SetBrowserFavouriteRequest -> BrowserState
//   POST   /api/browser/rescan          -> BrowserState (reads every folder again)
//   GET    /api/browser/list?path=      -> BrowserItem[] (a folder's subfolders and audio files)
//   GET    /api/browser/search?q=&limit= -> BrowserSearchResult
//   GET    /api/browser/file?path=      -> the audio file (only inside the Browser's folders)
//   POST   /api/browser/use  body: UseBrowserFileRequest -> MediaAsset (the project's copy of the file or online clip, made once)
//   POST   /api/browser/reveal  body: { path } -> 204 (shows it in Finder)
//   POST   /api/browser/preview  body: PreviewFileRequest -> EngineStatus (hear a file or an online clip; POST /api/engine/stopPreview stops it; 204: another was asked for while it downloaded)
//   GET    /api/engine/devices          -> EngineDevices (the output and input devices and their options)
//   POST   /api/engine/devices  body: SetDeviceRequest -> EngineDevices
//   POST   /api/engine/:command  body: EngineCommands[command] -> EngineStatus (starts the engine if needed)
//   POST   /mcp?chat=<projectId>|suite=<suite>  MCP (Streamable HTTP, JSON responses): a suite's tools for any agent
//                                        (the chat's project's suite, else `suite`, else video)
//   GET    /files/...                   -> static files from the data dir (range requests)
// ---------------------------------------------------------------------------

export interface ApiError {
  error: string;
}

export interface HealthResponse {
  ok: true;
  ffmpeg: { available: boolean; version: string | null };
}
