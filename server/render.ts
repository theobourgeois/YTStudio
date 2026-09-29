/**
 * Project -> ffmpeg command. Must match the web preview:
 *
 * - The canvas is the background colour. Video tracks are layered on top of
 *   it, bottom track first, so the first track in `project.tracks` ends up on
 *   top. "Contain" clips are padded with transparency, so lower layers (or the
 *   background) show around them.
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
import { clipDuration, clipEnd, projectDuration, trackClips } from "../shared/timeline.ts";
import type { Clip, MediaAsset, Project } from "../shared/types.ts";
import { run } from "./ffmpeg.ts";

export const SAMPLE_RATE = 48_000;
const AUDIO_FORMAT = `aformat=sample_fmts=fltp:sample_rates=${SAMPLE_RATE}:channel_layouts=stereo`;
const LIMITER = "alimiter=limit=0.98:level=0:latency=1";

export type RenderAsset = Pick<MediaAsset, "hasAudio" | "hasVideo"> & { path: string };

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
): string[] {
  const { width: W, height: H, fps: F } = opts;
  const total = projectDuration(project);
  if (!(total > 0)) throw new Error("Nothing to render: the timeline is empty.");

  const background = project.settings.background.replace("#", "0x");
  /** Index of the first output frame at or after time t. */
  const frameAt = (t: number) => Math.ceil(t * F - 1e-3);
  const sampleAt = (t: number) => Math.round(t * SAMPLE_RATE);
  /** Resample, rebase to 0, apply gain and cut/pad to exactly `samples`. */
  const audioChain = (clip: Clip, samples: number) =>
    [AUDIO_FORMAT, "asetpts=PTS-STARTPTS", ...(clip.volume !== 1 ? [`volume=${clip.volume}`] : []),
      `apad=whole_len=${samples}`, `atrim=end_sample=${samples}`].join(",");

  const inputs: string[] = [];
  const graph: string[] = [];
  const inputOf = new Map<string, number>();
  const assetOf = (clip: Clip) => {
    const asset = assets[clip.assetId];
    if (!asset) throw new Error(`Missing media for clip ${clip.id}.`);
    return asset;
  };
  /** The clip's source range as an input (accurate seek), added once; returns its index. */
  const input = (clip: Clip) => {
    let index = inputOf.get(clip.id);
    if (index === undefined) {
      index = inputOf.size;
      inputOf.set(clip.id, index);
      inputs.push("-ss", sec(clip.in), "-t", sec(clipDuration(clip)), "-i", assetOf(clip).path);
    }
    return index;
  };

  // --- Video ------------------------------------------------------------------
  const totalFrames = frameAt(total);
  graph.push(`color=c=${background}:s=${W}x${H}:r=${F},setsar=1,format=yuv420p,trim=end_frame=${totalFrames}[bg]`);
  let canvas = "[bg]";
  const layers = project.tracks.filter((t) => t.kind === "video").reverse();
  layers.forEach((track, l) => {
    const clips = trackClips(project, track.id);
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
    for (const clip of clips) {
      gap(cursor, clip.start);
      const frames = frameAt(clipEnd(clip)) - frameAt(clip.start);
      if (frames > 0) {
        const label = `[c${l}_${segments.length}]`;
        graph.push(`[${input(clip)}:v]${videoChain(clip.fit, W, H, F, frames)}${label}`);
        segments.push(label);
      }
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

/** Rebase, conform to the output frame rate and canvas (transparent padding), then cut to exactly `frames`. */
function videoChain(fit: Clip["fit"], W: number, H: number, F: number, frames: number): string {
  const fitFilters =
    fit === "cover"
      ? [`scale=${W}:${H}:force_original_aspect_ratio=increase:reset_sar=1`, `crop=${W}:${H}`, "format=yuva420p"]
      : [
          `scale=${W}:${H}:force_original_aspect_ratio=decrease:force_divisible_by=2:reset_sar=1`,
          "format=yuva420p",
          `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black@0`,
        ];
  return [
    "setpts=PTS-STARTPTS",
    `fps=${F}`,
    ...fitFilters,
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
