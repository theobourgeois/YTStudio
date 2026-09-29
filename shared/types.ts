/**
 * Domain + API types shared by the web client and the local render server.
 * All times are in seconds (floating point) unless the name says otherwise.
 */

// ---------------------------------------------------------------------------
// Media library
// ---------------------------------------------------------------------------

export type AssetKind = "video" | "audio";

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
  /** The project (video) this asset was imported into. Each project has its own media. */
  projectId: string;
  /** Original file name, e.g. "clip.mp4". */
  name: string;
  kind: AssetKind;
  duration: number;
  width: number | null;
  height: number | null;
  fps: number | null;
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
  /** Poster frame URL (video only). */
  poster: string | null;
  /** Timeline thumbnails (video only, null until generated). */
  filmstrip: Filmstrip | null;
  /** URL of a `WaveformData` JSON document (assets with audio, null until generated). */
  waveform: string | null;
}

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
  /** Canvas background colour (hex), visible behind "contain" clips. Always black for now. */
  background: string;
}

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  muted: boolean;
}

export interface Clip {
  id: string;
  assetId: string;
  trackId: string;
  /** Position on the timeline. */
  start: number;
  /** Source in-point. */
  in: number;
  /** Source out-point (exclusive), always > `in`. Clip duration = out - in. */
  out: number;
  /** Linear gain 0..1. */
  volume: number;
  /** How a video frame is fitted into the canvas. Ignored for audio. */
  fit: FitMode;
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

export interface ImportWebMediaRequest {
  projectId: string;
  url: string;
  /** Display name for the imported media. */
  title: string;
  kind: WebMediaKind;
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
//   DELETE /api/projects/:id            -> 204 (also deletes the project's media)
//
//   GET    /api/media?projectId=<id>    -> MediaAsset[]   (that project's media, newest first)
//   POST   /api/media?projectId=<id>&name=<file name>  body: raw file bytes -> MediaAsset (201)
//                                        415 if the file has no audio/video stream, 404 unknown project
//   GET    /api/media/:id               -> MediaAsset
//   DELETE /api/media/:id               -> 204
//   GET    /api/web/search?q=<query>    -> WebClip[] from YouTube  (503 if yt-dlp isn't installed)
//   GET    /api/web/resolve?url=<link>  -> WebClip  (400 for unsupported links, playlists, livestreams)
//   GET    /api/web/audio?url=<link>    -> audio file (downloaded on first request, then cached)
//   POST   /api/web/import  body: ImportWebMediaRequest -> MediaAsset (201)
//   POST   /api/exports   body: ExportRequest -> ExportJob (202)
//   GET    /api/exports/:id             -> ExportJob
//   DELETE /api/exports/:id             -> 204 (cancels if running)
//   GET    /api/exports/:id/download    -> file (attachment)
//   GET    /files/...                   -> static files from the data dir (range requests)
// ---------------------------------------------------------------------------

export interface ApiError {
  error: string;
}

export interface HealthResponse {
  ok: true;
  ffmpeg: { available: boolean; version: string | null };
}
