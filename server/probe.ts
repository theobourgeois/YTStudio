import { STILL_DURATION } from "../shared/media.ts";
import type { AssetKind } from "../shared/types.ts";
import { FFPROBE } from "./config.ts";
import { type PcmHeader, readPcmHeader } from "./pcm.ts";
import { run } from "./process.ts";
import { HttpError } from "./storage.ts";

export interface ProbeResult {
  kind: AssetKind;
  duration: number;
  /** Display size (rotation and pixel aspect ratio applied). */
  width: number | null;
  height: number | null;
  fps: number | null;
  /** Has a picture: a video stream or a still image. */
  hasVideo: boolean;
  hasAudio: boolean;
  /** ffprobe's container name list, e.g. "mov,mp4,m4a,3gp,3g2,mj2". */
  formatName: string;
}

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  sample_aspect_ratio?: string;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  nb_frames?: string;
  duration?: string;
  disposition?: Record<string, number>;
  tags?: Record<string, string>;
  side_data_list?: { rotation?: number }[];
}

interface FfprobeOutput {
  streams?: FfprobeStream[];
  format?: { format_name?: string; duration?: string };
  frames?: { side_data_list?: { rotation?: number }[] }[];
}

const IMAGE_FORMAT = /_pipe$|^image2$|^gif$|^webp$|^apng$/;
const IMAGE_CODECS = new Set([
  "png", "apng", "mjpeg", "jpeg2000", "jpegls", "jpegxl", "gif", "webp", "bmp", "tiff", "qoi",
]);
/** Still images both ffmpeg (export) and browsers (preview) can show. */
const PREVIEWABLE_IMAGES = new Set(["png", "mjpeg", "webp", "gif", "bmp"]);
const IMAGE_UNSUPPORTED = "This image format isn't supported. Use PNG, JPEG or WebP.";

// What the browser preview can actually play. Anything else would import fine
// and export fine, but show "Media offline" in the editor, so reject it upfront.
const PREVIEWABLE_CONTAINERS = ["mp4", "mov", "webm", "matroska", "mp3", "wav", "ogg", "flac", "aac"];
const PREVIEWABLE_VIDEO = new Set(["h264", "hevc", "vp8", "vp9", "av1"]);
const PREVIEWABLE_AUDIO = new Set(["aac", "mp3", "opus", "vorbis", "flac"]);
const previewableAudio = (codec: string) => PREVIEWABLE_AUDIO.has(codec) || codec.startsWith("pcm_");

/** Probe a media file. Throws `HttpError(415)` for anything that isn't playable audio/video. */
export async function probeMedia(file: string): Promise<ProbeResult> {
  // WAV and AIFF are read here: ffprobe takes half a second to start on Windows, whatever the file.
  const pcm = await readPcmHeader(file);
  return pcm ? probePcm(pcm) : ffprobeMedia(file);
}

/** `probeMedia` by ffprobe, whatever the file. */
export async function ffprobeMedia(file: string): Promise<ProbeResult> {
  let data: FfprobeOutput;
  try {
    const out = await run(FFPROBE, [
      "-v", "error", "-print_format", "json", "-show_format", "-show_streams", file,
    ]);
    data = JSON.parse(out) as FfprobeOutput;
  } catch {
    throw new HttpError(415, "This file doesn't look like audio or video ffmpeg can read.");
  }

  const streams = data.streams ?? [];
  const formatName = data.format?.format_name ?? "";
  const hasAudio = streams.some((s) => s.codec_type === "audio");
  // Cover art in music files is a "video" stream flagged as an attached picture.
  const video = streams.find((s) => s.codec_type === "video" && !s.disposition?.attached_pic);

  if (video && isStillImage(video, formatName)) return probeImage(file, video, formatName);
  if (!video && !hasAudio) {
    throw new HttpError(415, "This file has no audio or video stream.");
  }

  assertPreviewable(formatName, video, streams);

  const duration = mediaDuration(data);
  if (!(duration > 0)) throw new HttpError(415, "Couldn't determine how long this file is.");

  const size = video ? displaySize(video) : null;
  return {
    kind: video ? "video" : "audio",
    duration,
    width: size?.width ?? null,
    height: size?.height ?? null,
    fps: video ? frameRate(video) : null,
    hasVideo: !!video,
    hasAudio,
    formatName,
  };
}

/** What ffprobe says of an uncompressed audio file, from its header (`server/pcm.ts`). */
export function probePcm(pcm: PcmHeader): ProbeResult {
  const formatName = pcm.container;
  assertPreviewable(formatName, undefined, [{ codec_type: "audio", codec_name: pcm.codec }]);
  return {
    kind: "audio",
    duration: pcm.duration,
    width: null,
    height: null,
    fps: null,
    hasVideo: false,
    hasAudio: true,
    formatName,
  };
}

async function probeImage(file: string, image: FfprobeStream, formatName: string): Promise<ProbeResult> {
  if (!PREVIEWABLE_IMAGES.has(image.codec_name ?? "")) throw new HttpError(415, IMAGE_UNSUPPORTED);
  if (Number(image.nb_frames) > 1) throw new HttpError(415, "Animated images aren't supported yet.");
  // EXIF orientation (phone photos) only shows up as frame side data. Browsers and
  // ffmpeg both apply it when drawing the image, so the size must account for it.
  let rotation = 0;
  try {
    const out = await run(FFPROBE, [
      "-v", "error", "-print_format", "json", "-show_frames", "-read_intervals", "%+#1", file,
    ]);
    const data = JSON.parse(out) as FfprobeOutput;
    rotation = data.frames?.[0]?.side_data_list?.find((d) => typeof d.rotation === "number")?.rotation ?? 0;
  } catch {
    // Unreadable frames fail the import when the thumbnail is made.
  }
  const size = displaySize({ ...image, side_data_list: [{ rotation }] });
  if (!size) throw new HttpError(415, "Couldn't read this image's size.");
  return {
    kind: "image",
    duration: STILL_DURATION,
    width: size.width,
    height: size.height,
    fps: null,
    hasVideo: true,
    hasAudio: false,
    formatName,
  };
}

function assertPreviewable(formatName: string, video: FfprobeStream | undefined, streams: FfprobeStream[]) {
  const unsupported = (what: string) =>
    new HttpError(
      415,
      `This file uses ${what}, which the browser preview can't play. Convert it to MP4 (H.264 + AAC) and import it again.`,
    );
  const containers = formatName.split(",");
  if (!PREVIEWABLE_CONTAINERS.some((c) => containers.includes(c))) {
    throw unsupported(`the ${containers[0] || "unknown"} format`);
  }
  if (video && !PREVIEWABLE_VIDEO.has(video.codec_name ?? "")) {
    throw unsupported(`the ${video.codec_name ?? "unknown"} video codec`);
  }
  const audio = streams.find((s) => s.codec_type === "audio");
  if (audio && !previewableAudio(audio.codec_name ?? "")) {
    throw unsupported(`the ${audio.codec_name ?? "unknown"} audio codec`);
  }
}

function isStillImage(s: FfprobeStream, formatName: string): boolean {
  if (IMAGE_FORMAT.test(formatName) || s.disposition?.still_image) return true;
  if (s.nb_frames === "1") return true;
  return IMAGE_CODECS.has(s.codec_name ?? "") && !(Number(s.duration) > 0);
}

/** Container duration when known, else the longest stream. */
function mediaDuration(data: FfprobeOutput): number {
  const format = Number(data.format?.duration);
  if (format > 0) return format;
  return Math.max(0, ...(data.streams ?? []).map((s) => Number(s.duration) || 0));
}

function displaySize(s: FfprobeStream): { width: number; height: number } | null {
  if (!s.width || !s.height) return null;
  const [num, den] = (s.sample_aspect_ratio ?? "1:1").split(":").map(Number);
  const sar = num > 0 && den > 0 ? num / den : 1;
  const width = Math.round(s.width * sar);
  const rotation = s.side_data_list?.find((d) => typeof d.rotation === "number")?.rotation
    ?? Number(s.tags?.rotate ?? 0);
  return Math.abs(Math.round(rotation)) % 180 === 90
    ? { width: s.height, height: width }
    : { width, height: s.height };
}

function frameRate(s: FfprobeStream): number | null {
  for (const rate of [s.avg_frame_rate, s.r_frame_rate]) {
    const [num, den] = (rate ?? "").split("/").map(Number);
    const fps = num / den;
    if (Number.isFinite(fps) && fps > 0 && fps < 1000) return Math.round(fps * 1000) / 1000;
  }
  return null;
}

/**
 * A video's YCbCr matrix as ffprobe names it (`color_space`, e.g. "bt709"),
 * or null when the file doesn't say (or can't be read).
 */
export async function probeColorSpace(file: string): Promise<string | null> {
  try {
    const out = await run(FFPROBE, [
      "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=color_space", "-print_format", "json", file,
    ]);
    const space = (JSON.parse(out) as { streams?: { color_space?: string }[] }).streams?.[0]?.color_space;
    return space && space !== "unknown" ? space : null;
  } catch {
    return null;
  }
}
