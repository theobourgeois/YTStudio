/**
 * Project -> ffmpeg command. Must match the web preview:
 *
 * - The main track is a sequence of segments (one per clip, then a background
 *   filler up to the project end). Video and audio are concatenated *separately*
 *   so each can be cut to an exact, drift-free length:
 *     - video: segment i owns output frames [frameAt(start_i), frameAt(end_i)),
 *       i.e. exactly the frames whose timestamp falls inside the clip;
 *     - audio: segment i owns samples [sampleAt(start_i), sampleAt(end_i)).
 *   Because the boundaries are computed from absolute timeline times, rounding
 *   never accumulates across segments.
 * - Audio-track clips are cut to their exact sample length, delayed to their
 *   timeline start and summed (no normalisation) with the main audio.
 */
import {
  MAIN_TRACK_ID,
  clipDuration,
  clipEnd,
  projectDuration,
  trackClips,
} from "../shared/timeline.ts";
import type { Clip, MediaAsset, Project } from "../shared/types.ts";
import { run } from "./ffmpeg.ts";

export const SAMPLE_RATE = 48_000;
const AUDIO_FORMAT = `aformat=sample_fmts=fltp:sample_rates=${SAMPLE_RATE}:channel_layouts=stereo`;

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
  const silence = (samples: number) =>
    `anullsrc=r=${SAMPLE_RATE}:cl=stereo,${AUDIO_FORMAT},atrim=end_sample=${samples}`;
  /** Resample, rebase to 0, apply gain and cut/pad to exactly `samples`. */
  const audioChain = (clip: Clip, samples: number) =>
    [AUDIO_FORMAT, "asetpts=PTS-STARTPTS", ...(clip.volume !== 1 ? [`volume=${clip.volume}`] : []),
      `apad=whole_len=${samples}`, `atrim=end_sample=${samples}`].join(",");

  const inputs: string[] = [];
  const graph: string[] = [];
  const videoSegments: string[] = [];
  const audioSegments: string[] = [];

  let inputCount = 0;
  const assetOf = (clip: Clip) => {
    const asset = assets[clip.assetId];
    if (!asset) throw new Error(`Missing media for clip ${clip.id}.`);
    return asset;
  };
  /** Add the clip's source range as an input (accurate seek); returns its index. */
  const addInput = (clip: Clip) => {
    inputs.push("-ss", sec(clip.in), "-t", sec(clipDuration(clip)), "-i", assetOf(clip).path);
    return inputCount++;
  };

  // --- Main track -----------------------------------------------------------
  const mainMuted = project.tracks.find((t) => t.id === MAIN_TRACK_ID)?.muted ?? false;
  const mainClips = trackClips(project, MAIN_TRACK_ID);
  mainClips.forEach((clip, i) => {
    const index = addInput(clip);
    const start = clip.start;
    const end = i + 1 < mainClips.length ? mainClips[i + 1].start : clipEnd(clip);
    const frames = frameAt(end) - frameAt(start);
    const samples = sampleAt(end) - sampleAt(start);

    if (frames > 0) {
      graph.push(`[${index}:v]${videoChain(clip.fit, W, H, F, background, frames)}[v${i}]`);
      videoSegments.push(`[v${i}]`);
    }
    graph.push(
      !mainMuted && assetOf(clip).hasAudio
        ? `[${index}:a]${audioChain(clip, samples)}[a${i}]`
        : `${silence(samples)}[a${i}]`,
    );
    audioSegments.push(`[a${i}]`);
  });

  // Background filler when audio tracks outlast the main track (or it's empty).
  const mainEnd = mainClips.length ? clipEnd(mainClips[mainClips.length - 1]) : 0;
  const fillFrames = frameAt(total) - frameAt(mainEnd);
  const fillSamples = sampleAt(total) - sampleAt(mainEnd);
  if (fillFrames > 0) {
    graph.push(
      `color=c=${background}:s=${W}x${H}:r=${F},setsar=1,format=yuv420p,trim=end_frame=${fillFrames}[vfill]`,
    );
    videoSegments.push("[vfill]");
  }
  if (fillSamples > 0) {
    graph.push(`${silence(fillSamples)}[afill]`);
    audioSegments.push("[afill]");
  }

  graph.push(`${videoSegments.join("")}concat=n=${videoSegments.length}:v=1:a=0[vout]`);
  graph.push(`${audioSegments.join("")}concat=n=${audioSegments.length}:v=0:a=1[amain]`);

  // --- Audio tracks -------------------------------------------------------------
  const mixInputs: string[] = [];
  for (const track of project.tracks) {
    if (track.kind !== "audio" || track.muted) continue;
    for (const clip of trackClips(project, track.id)) {
      if (!assetOf(clip).hasAudio) continue;
      const index = addInput(clip);
      const samples = sampleAt(clipEnd(clip)) - sampleAt(clip.start);
      const label = `m${mixInputs.length}`;
      graph.push(
        `[${index}:a]${audioChain(clip, samples)},adelay=delays=${sampleAt(clip.start)}S:all=1[${label}]`,
      );
      mixInputs.push(`[${label}]`);
    }
  }
  graph.push(
    mixInputs.length
      ? `[amain]${mixInputs.join("")}amix=inputs=${mixInputs.length + 1}:duration=first:normalize=0[aout]`
      : "[amain]anull[aout]",
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

/** Rebase, conform to the output frame rate and canvas, then cut to exactly `frames`. */
function videoChain(
  fit: Clip["fit"],
  W: number,
  H: number,
  F: number,
  background: string,
  frames: number,
): string {
  const fitFilters =
    fit === "cover"
      ? [`scale=${W}:${H}:force_original_aspect_ratio=increase:reset_sar=1`, `crop=${W}:${H}`]
      : [
          `scale=${W}:${H}:force_original_aspect_ratio=decrease:force_divisible_by=2:reset_sar=1`,
          `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=${background}`,
        ];
  return [
    "setpts=PTS-STARTPTS",
    `fps=${F}`,
    ...fitFilters,
    "setsar=1",
    "format=yuv420p",
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
