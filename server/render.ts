/**
 * Project -> ffmpeg command. Must match the web preview:
 *
 * - The canvas is the background colour. Video tracks are layered on top of
 *   it, bottom track first, so the first track in `project.tracks` ends up on
 *   top. Each clip is placed by its Motion (`shared/transform.ts`), faded by
 *   its Opacity and padded with transparency, so lower layers (or the
 *   background) show around it.
 * - Keyframes aren't exported yet (nothing creates them): every value is the
 *   one at the clip's first frame.
 * - Text clips arrive already drawn (by the browser, in the user's fonts) as
 *   still images with their frame size; they're placed like any other still.
 * - Each video track is one stream of segments (clips and transparent gaps)
 *   covering the whole timeline. Segment boundaries are computed from absolute
 *   timeline times: a segment from `a` to `b` owns output frames
 *   [frameAt(a), frameAt(b)), i.e. exactly the frames whose timestamp falls
 *   inside it, so rounding never accumulates across segments.
 * - Every clip with sound on an unmuted track (video or audio) is cut to its
 *   exact sample length, delayed to its timeline start and summed (no
 *   normalisation) on top of silence covering the whole timeline. A
 *   look-ahead limiter (delay-compensated, no auto-gain) catches the peaks
 *   where overlapping sources add up past full scale instead of clipping.
 */
import { isTextClip, motionAt, opacityAt, volumeAt } from "../shared/effects.ts";
import { clipDuration, clipEnd, projectDuration, trackClips } from "../shared/timeline.ts";
import { type Placement, type Size, placeClip, toCanvas, toFrame } from "../shared/transform.ts";
import type { Clip, MediaAsset, Project } from "../shared/types.ts";
import { run } from "./ffmpeg.ts";

export const SAMPLE_RATE = 48_000;
const AUDIO_FORMAT = `aformat=sample_fmts=fltp:sample_rates=${SAMPLE_RATE}:channel_layouts=stereo`;
const LIMITER = "alimiter=limit=0.98:level=0:latency=1";

export type RenderAsset = Pick<MediaAsset, "kind" | "hasAudio" | "hasVideo" | "width" | "height"> & {
  path: string;
  /** Size at 100% on the output canvas when it isn't the media fitted to it (a drawn text). */
  frame?: Size;
};

export interface RenderOptions {
  width: number;
  height: number;
  fps: number;
  outputPath: string;
  ffmpegPath?: string;
}

/** Seconds as a plain decimal string (never exponent notation). */
const sec = (t: number) => Math.max(0, t).toFixed(6);

/** Build the full ffmpeg argv (argv[0] is the ffmpeg binary). Pure. */
export function buildRenderArgs(
  project: Project,
  assets: Record<string, RenderAsset>,
  opts: RenderOptions,
  /** Drawn text clips, by clip id. */
  texts: Record<string, RenderAsset> = {},
): string[] {
  const { width: W, height: H, fps: F } = opts;
  const total = projectDuration(project);
  if (!(total > 0)) throw new Error("Nothing to render: the timeline is empty.");

  const background = project.settings.background.replace("#", "0x");
  /** Index of the first output frame at or after time t. */
  const frameAt = (t: number) => Math.ceil(t * F - 1e-3);
  const sampleAt = (t: number) => Math.round(t * SAMPLE_RATE);
  /** Resample, rebase to 0, apply gain and cut/pad to exactly `samples`. */
  const audioChain = (clip: Clip, samples: number) => {
    const volume = volumeAt(clip, clip.in);
    return [AUDIO_FORMAT, "asetpts=PTS-STARTPTS", ...(volume !== 1 ? [`volume=${volume}`] : []),
      `apad=whole_len=${samples}`, `atrim=end_sample=${samples}`].join(",");
  };

  const inputs: string[] = [];
  const graph: string[] = [];
  const inputOf = new Map<string, number>();
  const assetOf = (clip: Clip) => {
    const text = isTextClip(clip);
    const asset = text ? texts[clip.id] : assets[clip.assetId];
    if (!asset) throw new Error(text ? `Missing text image for clip ${clip.id}.` : `Missing media for clip ${clip.id}.`);
    return asset;
  };
  /** The clip's source range as an input (accurate seek; a still is looped), added once; returns its index. */
  const input = (clip: Clip) => {
    let index = inputOf.get(clip.id);
    if (index === undefined) {
      index = inputOf.size;
      inputOf.set(clip.id, index);
      const asset = assetOf(clip);
      const range = asset.kind === "image"
        ? ["-loop", "1", "-framerate", String(F), "-t", sec(clipDuration(clip))]
        : ["-ss", sec(clip.in), "-t", sec(clipDuration(clip))];
      inputs.push(...range, "-i", asset.path);
    }
    return index;
  };

  // --- Video ------------------------------------------------------------------
  const totalFrames = frameAt(total);
  graph.push(`color=c=${background}:s=${W}x${H}:r=${F},setsar=1,format=yuv420p,trim=end_frame=${totalFrames}[bg]`);
  let canvas = "[bg]";
  const layers = project.tracks.filter((t) => t.kind === "video").reverse();
  const canvasSize = { width: W, height: H };
  layers.forEach((track, l) => {
    // Clips entirely off the canvas (or invisible) are just more gap.
    const clips = trackClips(project, track.id).flatMap((clip) => {
      const frames = frameAt(clipEnd(clip)) - frameAt(clip.start);
      const asset = assetOf(clip);
      const media = asset.width && asset.height ? { width: asset.width, height: asset.height } : canvasSize;
      const opacity = opacityAt(clip, clip.in);
      const piece = frames > 0 && opacity > 0
        ? planPiece(canvasSize, media, placeClip(canvasSize, media, motionAt(clip, clip.in), asset.frame))
        : null;
      return piece ? [{ clip, frames, media, opacity, piece }] : [];
    });
    if (clips.length === 0) return;
    const segments: string[] = [];
    const gap = (from: number, to: number) => {
      const frames = frameAt(to) - frameAt(from);
      if (frames <= 0) return;
      const label = `[g${l}_${segments.length}]`;
      graph.push(`${transparent(W, H, F)},trim=end_frame=${frames}${label}`);
      segments.push(label);
    };
    let cursor = 0;
    for (const { clip, frames, media, opacity, piece } of clips) {
      gap(cursor, clip.start);
      const label = `[c${l}_${segments.length}]`;
      graph.push(`[${input(clip)}:v]${videoChain(piece, media, opacity, W, H, F, frames)}${label}`);
      segments.push(label);
      cursor = clipEnd(clip);
    }
    gap(cursor, total);
    graph.push(`${segments.join("")}concat=n=${segments.length}:v=1:a=0[t${l}]`);
    graph.push(`${canvas}[t${l}]overlay=x=0:y=0:format=yuv420:eof_action=pass[o${l}]`);
    canvas = `[o${l}]`;
  });
  graph.push(`${canvas}format=yuv420p[vout]`);

  // --- Audio ------------------------------------------------------------------
  const totalSamples = sampleAt(total);
  graph.push(`anullsrc=r=${SAMPLE_RATE}:cl=stereo,${AUDIO_FORMAT},atrim=end_sample=${totalSamples}[abase]`);
  const mixInputs: string[] = [];
  for (const track of project.tracks) {
    if (track.muted) continue;
    for (const clip of trackClips(project, track.id)) {
      if (!assetOf(clip).hasAudio) continue;
      const samples = sampleAt(clipEnd(clip)) - sampleAt(clip.start);
      if (samples <= 0) continue;
      const label = `m${mixInputs.length}`;
      graph.push(
        `[${input(clip)}:a]${audioChain(clip, samples)},adelay=delays=${sampleAt(clip.start)}S:all=1[${label}]`,
      );
      mixInputs.push(`[${label}]`);
    }
  }
  graph.push(
    mixInputs.length
      ? `[abase]${mixInputs.join("")}amix=inputs=${mixInputs.length + 1}:duration=first:normalize=0,${LIMITER}[aout]`
      : "[abase]anull[aout]",
  );

  const crf = Math.min(W, H) <= 720 ? "23" : "20";
  return [
    opts.ffmpegPath ?? "ffmpeg",
    "-hide_banner", "-nostdin", "-loglevel", "error", "-nostats", "-progress", "pipe:1",
    ...inputs,
    "-filter_complex", graph.join(";"),
    "-map", "[vout]", "-map", "[aout]", "-map_metadata", "-1",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", crf, "-pix_fmt", "yuv420p", "-r", String(F),
    "-c:a", "aac", "-b:a", "192k", "-ar", String(SAMPLE_RATE), "-ac", "2",
    "-movflags", "+faststart",
    "-t", sec(total),
    "-y", opts.outputPath,
  ];
}

/** A fully transparent canvas-sized source (for gaps between clips on a track). */
function transparent(W: number, H: number, F: number): string {
  return `color=c=black@0:s=${W}x${H}:r=${F},format=yuva420p,setsar=1`;
}

/** Integer pixel rectangle. */
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * How to draw a placed clip with plain crop/scale/rotate/pad filters: the part
 * of the source that can end up on the canvas (so a zoomed-in clip never gets
 * scaled to a huge size), its scaled size, the rotated piece's size and where
 * it lands, and the part of that piece inside the canvas. Null when none of
 * the clip is on the canvas.
 */
export interface Piece {
  /** Source pixels to keep. */
  crop: Rect;
  /** Size after scaling. */
  scaled: { w: number; h: number };
  /** Rotation (radians, clockwise) and the rotated piece's size; null when upright. */
  rotate: { angle: number; w: number; h: number } | null;
  /** The rotated piece's top-left on the canvas. */
  at: { x: number; y: number };
  /** The part of the rotated piece inside the canvas, in piece pixels. */
  visible: Rect;
}

export function planPiece(canvas: Size, media: Size, p: Placement): Piece | null {
  const { width: W, height: H } = canvas;
  // Frame px -> source px.
  const kx = media.width / p.width;
  const ky = media.height / p.height;
  // The canvas corners seen in the source; their bounding box is all that can be visible.
  const seen = [[0, 0], [W, 0], [W, H], [0, H]].map((c) => toFrame(p, c as [number, number]));
  if (seen.some((f) => !f)) return null;
  const xs = seen.map((f) => f![0] * kx);
  const ys = seen.map((f) => f![1] * ky);
  // A pixel of margin keeps the edges' filtering the same as without the crop.
  const x0 = Math.max(0, Math.floor(Math.min(...xs)) - 1);
  const y0 = Math.max(0, Math.floor(Math.min(...ys)) - 1);
  const x1 = Math.min(media.width, Math.ceil(Math.max(...xs)) + 1);
  const y1 = Math.min(media.height, Math.ceil(Math.max(...ys)) + 1);
  if (x1 <= x0 || y1 <= y0) return null;
  const crop = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };

  const scaled = {
    w: Math.round((crop.w / kx) * p.scaleX),
    h: Math.round((crop.h / ky) * p.scaleY),
  };
  if (scaled.w < 1 || scaled.h < 1) return null;

  const turn = ((p.rotation % 360) + 360) % 360;
  let rotate: Piece["rotate"] = null;
  let size = scaled;
  if (Math.abs(turn) > 1e-9 && Math.abs(turn - 360) > 1e-9) {
    const angle = (turn * Math.PI) / 180;
    // Rounded first so exact right angles don't grow a pixel from float noise.
    const cos = Math.abs(Math.round(Math.cos(angle) * 1e9) / 1e9);
    const sin = Math.abs(Math.round(Math.sin(angle) * 1e9) / 1e9);
    size = {
      w: Math.max(1, Math.ceil(scaled.w * cos + scaled.h * sin - 1e-6)),
      h: Math.max(1, Math.ceil(scaled.w * sin + scaled.h * cos - 1e-6)),
    };
    rotate = { angle, ...size };
  }

  // The rotate filter keeps the piece centred, so place it by its centre.
  const [cx, cy] = toCanvas(p, [(crop.x + crop.w / 2) / kx, (crop.y + crop.h / 2) / ky]);
  const at = { x: Math.round(cx - size.w / 2), y: Math.round(cy - size.h / 2) };
  const vx0 = Math.max(0, at.x);
  const vy0 = Math.max(0, at.y);
  const vx1 = Math.min(W, at.x + size.w);
  const vy1 = Math.min(H, at.y + size.h);
  if (vx1 <= vx0 || vy1 <= vy0) return null;
  return { crop, scaled, rotate, at, visible: { x: vx0 - at.x, y: vy0 - at.y, w: vx1 - vx0, h: vy1 - vy0 } };
}

/**
 * Rebase and conform to the output frame rate, draw the clip's piece at its
 * place on a transparent canvas, then cut to exactly `frames`.
 */
function videoChain(piece: Piece, media: Size, opacity: number, W: number, H: number, F: number, frames: number): string {
  const { crop, scaled, rotate, at, visible } = piece;
  const whole = crop.x === 0 && crop.y === 0 && crop.w === media.width && crop.h === media.height;
  const fullyVisible = visible.x === 0 && visible.y === 0 && visible.w === (rotate?.w ?? scaled.w) && visible.h === (rotate?.h ?? scaled.h);
  return [
    "setpts=PTS-STARTPTS",
    `fps=${F}`,
    // Square pixels at the size the placement was computed for (a no-op for most media).
    `scale=${media.width}:${media.height}`,
    "setsar=1",
    ...(whole ? [] : [`crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}:exact=1`]),
    `scale=${scaled.w}:${scaled.h}`,
    "format=rgba",
    ...(rotate ? [`rotate=a=${rotate.angle.toFixed(9)}:ow=${rotate.w}:oh=${rotate.h}:c=black@0`] : []),
    ...(opacity < 1 ? [`colorchannelmixer=aa=${opacity}`] : []),
    ...(fullyVisible ? [] : [`crop=${visible.w}:${visible.h}:${visible.x}:${visible.y}`]),
    `pad=${W}:${H}:${at.x + visible.x}:${at.y + visible.y}:color=black@0`,
    "format=yuva420p",
    "setsar=1",
    // Clone the last frame in case the source runs short, then cut exactly.
    `tpad=stop_mode=clone:stop=${frames}`,
    `trim=end_frame=${frames}`,
  ].join(",");
}

/** Run a render built by `buildRenderArgs`, reporting progress 0..1. */
export async function runRender(
  argv: string[],
  duration: number,
  onProgress: (fraction: number) => void,
  signal: AbortSignal,
): Promise<void> {
  let pending = "";
  const onStdout = (chunk: Buffer) => {
    const lines = (pending + chunk.toString("utf8")).split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) {
      const match = /^out_time_us=(\d+)/.exec(line);
      if (match) onProgress(Math.min(1, Math.max(0, Number(match[1]) / 1e6 / duration)));
    }
  };
  await run(argv[0], argv.slice(1), { signal, onStdout });
}
