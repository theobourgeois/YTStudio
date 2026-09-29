/**
 * Domain + API types shared by the web client and the local render server.
 * All times are in seconds (floating point) unless the name says otherwise.
 */
import type { ToolResult } from "./assistant-tools.ts";

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
   * The asset this one is a copy of: the Library media it came from, or the
   * project media it was added to the Library from. Used to avoid copying twice.
   */
  origin?: string;
}

/**
 * A media file's reversed copy: `duration` long like the original, so source
 * time `s` is at `duration - s` in it (see `fileTime`).
 */
export type ReversedMedia =
  | { status: "processing" }
  | { status: "ready"; src: string }
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
}

export interface Clip {
  id: string;
  /** The media it shows or plays; "" for a text clip (see `isTextClip`). */
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

export type ParamValue = number | boolean | string | Vec2;

/** Parameter values of one effect, by parameter key. */
export type ParamValues = Record<string, ParamValue>;

/** How a keyframed value travels from one keyframe to the next. */
/**
 * How a keyframe is passed through, like Premiere's temporal interpolation:
 * straight through (`linear`), slowing down on the way in (`ease-in`), easing
 * away from it (`ease-out`) or both (`ease`), or holding its value until the
 * next keyframe (`hold`).
 */
export type Easing = "linear" | "ease-in" | "ease-out" | "ease" | "hold";

export interface Keyframe {
  /**
   * Source media time (the clock of `Clip.in`/`out`), so a keyframe stays on
   * its frame when the clip is moved, trimmed or split.
   */
  time: number;
  value: ParamValue;
  easing: Easing;
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
}

// ---------------------------------------------------------------------------
// Project list (the "workspace"): each video is a project that is either
// being worked on (`active`) or finished and put away (`settled`).
// ---------------------------------------------------------------------------

export type ProjectStatus = "active" | "settled";

export interface ProjectSummary {
  id: string;
  /** Mirrors `Project.name`. */
  name: string;
  status: ProjectStatus;
  /** Epoch milliseconds. */
  createdAt: number;
  /** Last time the project document was saved (epoch ms). */
  updatedAt: number;
  /** When it was last settled (epoch ms), null while active. */
  settledAt: number | null;
  aspectRatio: AspectRatio;
  /** Timeline length in seconds. */
  duration: number;
  clipCount: number;
  /** Poster URL of the earliest video clip, if any. */
  thumbnail: string | null;
}

export interface CreateProjectRequest {
  name?: string;
}

export interface UpdateProjectRequest {
  name?: string;
  status?: ProjectStatus;
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

export interface ExportRequest {
  project: Project;
  resolution: ExportResolution;
  /** Optional output name without extension. */
  fileName?: string;
  /** Render without the audio tracks (e.g. to add the song in-app when posting). */
  excludeAudioTracks?: boolean;
  /**
   * Every text clip drawn by the browser at the export's size (the server has
   * no way to lay out text in the user's fonts), by clip id: one drawing, or
   * one per change of an animated text's look.
   */
  texts?: Record<string, TextRaster[]>;
}

/** A text clip drawn to an image for the export. */
export interface TextRaster {
  /** Base64 PNG. It may be drawn larger than `width` x `height` so a scaled-up text stays sharp. */
  png: string;
  /** The text's frame at 100% scale, in output px (what its Motion places). */
  width: number;
  height: number;
  /** Source time this drawing is shown from, until the next one's (the first is shown from the start). */
  from?: number;
}

export type ExportStatus = "queued" | "rendering" | "done" | "error" | "cancelled";

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
  /** Inline URL, playable in a <video>, once done. */
  url: string | null;
  fileName: string;
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
  /** Display name for the imported media. */
  title: string;
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

/** Whether Claude Code can run the assistant on this computer. */
export interface AssistantStatus {
  available: boolean;
  version: string | null;
  loggedIn: boolean;
  /** "Claude Max", "API key"... */
  account: string | null;
  /** Why it can't be used, and what to do. */
  problem: string | null;
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
//   GET    /api/projects                -> ProjectSummary[] (most recently updated first)
//   POST   /api/projects  body: CreateProjectRequest -> ProjectSummary (201), status active
//   GET    /api/projects/:id            -> Project (normalized against its media)
//   PUT    /api/projects/:id  body: Project -> ProjectSummary (bumps updatedAt)
//   PATCH  /api/projects/:id  body: UpdateProjectRequest -> ProjectSummary
//                                        (rename; settle/unsettle sets/clears settledAt)
//   POST   /api/projects/:id/duplicate  -> ProjectSummary (201): a copy with its own copy of the media,
//                                        named "<name> copy", status active
//   DELETE /api/projects/:id            -> 204 (also deletes the project's media)
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
//   POST   /api/media/import-file  body: ImportFileRequest -> MediaAsset (201): a copy of a file on this computer
//   DELETE /api/media/:id               -> 204
//   GET    /api/web/search?q=<query>    -> WebClip[] from YouTube  (503 if yt-dlp isn't installed)
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
//   GET    /api/exports/:id             -> ExportJob
//   DELETE /api/exports/:id             -> 204 (cancels if running)
//   GET    /api/exports/:id/download    -> file (attachment)
//   GET    /api/transcription/engines   -> TranscriptionEngineInfo[]
//   POST   /api/transcription/engines/:id/setup  body: SetUpEngineRequest -> TranscriptionEngineInfo
//                                        (local: starts installing, poll the list; cloud: checks + saves the key)
//   DELETE /api/transcription/engines/:id/setup  -> TranscriptionEngineInfo (forgets a saved API key)
//   POST   /api/transcription/jobs  body: TranscribeRequest -> TranscriptionJob (202)
//   GET    /api/transcription/jobs/:id  -> TranscriptionJob
//   DELETE /api/transcription/jobs/:id  -> 204 (cancels if running)
//   GET    /api/assistant/status        -> AssistantStatus (is Claude Code installed and logged in)
//   GET    /api/assistant/chats/:projectId  -> ChatSnapshot (a video's chat with the assistant)
//   PATCH  /api/assistant/chats/:projectId  body: { model } -> ChatSnapshot
//   POST   /api/assistant/chats/:projectId/messages  body: SendChatMessageRequest -> 204 (the answer streams as events)
//   POST   /api/assistant/chats/:projectId/stop  -> 204
//   DELETE /api/assistant/chats/:projectId  -> ChatSnapshot (a new, empty chat)
//   GET    /api/assistant/images/:projectId/:name -> a picture the assistant looked at
//   GET    /api/assistant/events?tab=<id>&project=<id> -> text/event-stream of TabEvent (server/assistant/bridge.ts):
//                                        tool calls for the tab to run, and chat updates for its video
//   POST   /api/assistant/tabs/:tab/focus  -> 204 (outside MCP clients act in the tab used last)
//   POST   /api/assistant/calls/:id/result  body: ToolCallResultRequest -> 204
//   POST   /api/assistant/calls/:id/progress  body: ToolCallProgressRequest -> 204
//   POST   /mcp                         MCP (Streamable HTTP, JSON responses): the editor's tools for any agent
//   GET    /files/...                   -> static files from the data dir (range requests)
// ---------------------------------------------------------------------------

export interface ApiError {
  error: string;
}

export interface HealthResponse {
  ok: true;
  ffmpeg: { available: boolean; version: string | null };
}
