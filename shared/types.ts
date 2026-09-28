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
  /** Canvas background colour (hex), visible behind "contain" clips. */
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
 * - Exactly one video track, id `MAIN_TRACK_ID`, always first. It is *magnetic*:
 *   clips are packed back-to-back from t=0 with no gaps, in `start` order.
 * - Zero or more audio tracks. Clips are freely positioned but never overlap
 *   other clips on the same track.
 */
export interface Project {
  version: 1;
  name: string;
  settings: ProjectSettings;
  tracks: Track[];
  clips: Clip[];
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
// HTTP API (all JSON unless noted; errors are `ApiError` with a 4xx/5xx status)
//
//   GET    /api/health                  -> HealthResponse
//   GET    /api/media                   -> MediaAsset[]   (newest first)
//   POST   /api/media?name=<file name>  body: raw file bytes -> MediaAsset (201)
//                                        415 if the file has no audio/video stream
//   GET    /api/media/:id               -> MediaAsset
//   DELETE /api/media/:id               -> 204
//   GET    /api/project                 -> Project (a default project if none saved)
//   PUT    /api/project   body: Project -> 204
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
