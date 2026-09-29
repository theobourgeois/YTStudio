/**
 * Project -> export plan (pure, unit-tested). The export draws every frame
 * with the same compositor as the preview (`shared/compositor.ts`), in a
 * headless browser (`frame-render.ts`); ffmpeg only decodes, mixes the sound
 * and encodes:
 *
 * - Output frame f shows timeline time f / fps: what `sceneAt` says each video
 *   track shows then (a clip, or a transition with both sides), placed by its
 *   Motion and faded by its Opacity at that moment, bottom track first over
 *   a black canvas.
 * - Each clip that's ever visible is decoded once by its own ffmpeg
 *   (`RenderSource`) into raw RGBA frames, one per output frame from the
 *   first it's drawn in to the last, so the stream stays in step with the
 *   output. A transition may show a clip past its edges (the media's
 *   handles); where the media ends, its first or last frame is held. Stills
 *   (and drawn texts) are decoded once. Frames are decoded at the size the
 *   clip is shown at, never bigger than its media.
 * - Text clips arrive already drawn (by the browser, in the user's fonts) as
 *   images with their frame size; they're placed like any other still.
 * - Every clip with sound on an unmuted track (video or audio) is cut to its
 *   exact sample length, delayed to its timeline start and summed (no
 *   normalisation) on top of silence covering the whole timeline, in a pass of
 *   its own (`audioArgs`). A look-ahead limiter (delay-compensated, no
 *   auto-gain) catches the peaks where overlapping sources add up past full
 *   scale instead of clipping.
 * - Colour: videos are decoded as YUV and turned into RGB by the compositor
 *   with their own YCbCr matrix; the output is BT.709, tagged as such.
 */
import type { Affine, Placed } from "../shared/compositor.ts";
import { VOLUME, findEffect, isTextClip, motionAt, opacityAt, volumeAt } from "../shared/effects.ts";
import { easesIn, easesOut } from "../shared/keyframes.ts";
import { type Shown, sceneAt, transitionWindows } from "../shared/scene.ts";
import { TEXT_SOURCE_RANGE, clipDuration, clipEnd, projectDuration, sourceRange, trackClips } from "../shared/timeline.ts";
import { type UniformValue, transitionShader, transitionUniforms } from "../shared/transition-gl.ts";
import { type Size, frameCorners, placeClip, placementAffine } from "../shared/transform.ts";
import type { Clip, Keyframe, MediaAsset, Project } from "../shared/types.ts";
import { FFMPEG_QUIET } from "./ffmpeg.ts";
import { run } from "./process.ts";

export const SAMPLE_RATE = 48_000;
const AUDIO_FORMAT = `aformat=sample_fmts=fltp:sample_rates=${SAMPLE_RATE}:channel_layouts=stereo`;
const LIMITER = "alimiter=limit=0.98:level=0:latency=1";
/** Largest picture decoded, per side (well within any WebGL 2 texture limit). */
const MAX_PICTURE = 8192;

export type RenderAsset = Pick<MediaAsset, "kind" | "hasAudio" | "hasVideo" | "width" | "height" | "duration"> & {
  path: string;
  /** Size at 100% on the output canvas when it isn't the media fitted to it (a drawn text). */
  frame?: Size;
  /** The video's YCbCr matrix as ffprobe names it (`color_space`), when known. */
  colorSpace?: string | null;
  /** A drawn text: the PNG itself (`path` is unused). */
  png?: Buffer;
  /** A drawn text's drawing is shown from this source time on (the first one: from the start). */
  from?: number;
};

export interface RenderOptions {
  width: number;
  height: number;
  fps: number;
  ffmpegPath?: string;
}

/** One clip's pictures: an ffmpeg writing raw frames to stdout. */
export interface RenderSource {
  /** The compositor's picture key. */
  key: string;
  clipId: string;
  /**
   * A still (an image or a text) is one RGBA frame drawn all along; a video
   * is one YUV 4:2:0 frame (limited range, in its own matrix: `luma`) per output frame.
   */
  still: boolean;
  /** The output frames [first, end) it's drawn in; a video writes exactly one frame for each. */
  first: number;
  end: number;
  /** Size of the frames it writes (even for a video). */
  width: number;
  height: number;
  /** A video's YCbCr matrix, as the luma weights of red and blue. */
  luma: [number, number] | null;
  /** A drawn text's PNG, sent as it is (then `argv` is empty). */
  png?: Buffer;
  argv: string[];
}

/** Bytes of one of a source's frames. */
export const sourceFrameBytes = (s: Pick<RenderSource, "still" | "width" | "height">) =>
  s.still ? s.width * s.height * 4 : (s.width * s.height * 3) / 2;

/** One layer of an output frame, bottom first. */
export type FrameLayer =
  | { kind: "picture"; picture: Placed }
  | {
      kind: "transition";
      /** Key into `RenderPlan.shaders`. */
      shader: string;
      uniforms: UniformValue[];
      progress: number;
      from: Placed | null;
      to: Placed | null;
    };

export interface RenderPlan {
  width: number;
  height: number;
  fps: number;
  /** Output frames. */
  frames: number;
  sources: RenderSource[];
  /** Fragment shader sources by key. */
  shaders: Record<string, string>;
  /** What output frame `f` draws, bottom layer first. */
  frame(f: number): FrameLayer[];
}

/** Index of the first output frame at or after time t. */
const frameAtFps = (fps: number) => (t: number) => Math.ceil(t * fps - 1e-3);

/** Seconds as a plain decimal string (never exponent notation). */
const sec = (t: number) => Math.max(0, t).toFixed(6);

/** What frame f shows: a hair after its timestamp, so a cut that's a rounding error late still lands on it. */
const frameTime = (f: number, fps: number) => (f + 1e-3) / fps;

/** A clip drawn at one moment: where, how opaque, and how many canvas px each media px covers. */
interface Drawn {
  affine: Affine;
  opacity: number;
  density: [number, number];
}

/** Plan the video of an export (see the top of this file). Throws when there's nothing to render or media is missing. */
export function planRender(
  project: Project,
  assets: Record<string, RenderAsset>,
  opts: RenderOptions,
  /** Drawn text clips, by clip id: one drawing, or several over time for an animated text (see `RenderAsset.from`). */
  texts: Record<string, RenderAsset[]> = {},
): RenderPlan {
  const { width: W, height: H, fps: F } = opts;
  const total = projectDuration(project);
  if (!(total > 0)) throw new Error("Nothing to render: the timeline is empty.");
  const frames = frameAtFps(F)(total);
  const canvas = { width: W, height: H };
  const windows = transitionWindows(project);
  for (const clip of project.clips) renderAssetOf(clip, assets, texts);
  const range = (clip: Clip) => (isTextClip(clip) ? TEXT_SOURCE_RANGE : sourceRange(renderAssetOf(clip, assets, texts)));
  const shotsAt = (f: number) => sceneAt(project, windows, frameTime(f, F), range);

  /** The picture a clip shows at a moment: its media, or its text's drawing then. */
  const pictureAt = ({ clip, time }: Shown): { id: string; asset: RenderAsset } => {
    if (!isTextClip(clip)) return { id: clip.id, asset: renderAssetOf(clip, assets, texts) };
    const drawings = texts[clip.id];
    let i = 0;
    while (i + 1 < drawings.length && (drawings[i + 1].from ?? -Infinity) <= time + 1e-9) i++;
    return { id: `${clip.id}#${i}`, asset: drawings[i] };
  };

  /** Where a clip is drawn at a moment, or null when none of it is visible. */
  const draw = (shown: Shown): (Drawn & { id: string; asset: RenderAsset }) | null => {
    const { clip, time } = shown;
    const opacity = opacityAt(clip, time);
    if (!(opacity > 0)) return null;
    const { id, asset } = pictureAt(shown);
    const media = mediaSize(asset, canvas);
    const p = placeClip(canvas, media, motionAt(clip, time), asset.frame);
    const corners = frameCorners(p);
    const xs = corners.map((c) => c[0]);
    const ys = corners.map((c) => c[1]);
    const onCanvas = Math.max(...xs) > 0 && Math.min(...xs) < W && Math.max(...ys) > 0 && Math.min(...ys) < H;
    if (!onCanvas || !(Math.abs(p.scaleX) > 0 && Math.abs(p.scaleY) > 0)) return null;
    return {
      id,
      asset,
      affine: placementAffine(p, canvas) as Affine,
      opacity,
      density: [(p.width * Math.abs(p.scaleX)) / media.width, (p.height * Math.abs(p.scaleY)) / media.height],
    };
  };

  // Every visible picture: the frames it's drawn in and the most detail it's ever drawn with.
  const seen = new Map<string, { clip: Clip; asset: RenderAsset; first: number; end: number; density: [number, number] }>();
  const see = (f: number, shown: Shown | null) => {
    const drawn = shown && draw(shown);
    if (!shown || !drawn) return;
    const s = seen.get(drawn.id);
    if (!s) {
      seen.set(drawn.id, { clip: shown.clip, asset: drawn.asset, first: f, end: f + 1, density: [...drawn.density] });
      return;
    }
    s.end = f + 1;
    s.density = [Math.max(s.density[0], drawn.density[0]), Math.max(s.density[1], drawn.density[1])];
  };
  const shaders: Record<string, string> = {};
  for (let f = 0; f < frames; f++) {
    for (const shot of shotsAt(f)) {
      if (shot.kind === "clip") see(f, shot.shown);
      else {
        see(f, shot.from);
        see(f, shot.to);
        const shader = transitionShader(shot.window.def);
        shaders[shader.key] = shader.source;
      }
    }
  }

  const keys = new Map<string, string>();
  const sources = [...seen.entries()]
    .sort(([, a], [, b]) => a.first - b.first)
    .map(([id, { clip, asset, first, end, density }], i): RenderSource => {
      const key = `s${i}`;
      keys.set(id, key);
      const base = { key, clipId: clip.id, first, end };
      // A drawn text is sent as it is (already at the size it needs), for the page to decode.
      if (asset.png) return { ...base, still: true, width: asset.width!, height: asset.height!, luma: null, png: asset.png, argv: [] };
      const media = mediaSize(asset, canvas);
      const still = asset.kind === "image";
      // YUV 4:2:0 needs even sizes.
      const side = (length: number, d: number) => {
        const n = Math.max(1, Math.min(MAX_PICTURE, Math.ceil(length * Math.min(1, d) - 1e-6)));
        return still ? n : n + (n % 2);
      };
      const size = { width: side(media.width, density[0]), height: side(media.height, density[1]) };
      if (still) return { ...base, still, ...size, luma: null, argv: stillArgs(asset, size, opts) };
      const luma = lumaWeights(asset.colorSpace, asset.height);
      return { ...base, still, ...size, luma, argv: videoArgs(clip, asset, size, first, end, opts) };
    });

  return {
    width: W,
    height: H,
    fps: F,
    frames,
    sources,
    shaders,
    frame(f) {
      const placed = (shown: Shown | null): Placed | null => {
        const drawn = shown && draw(shown);
        const key = drawn && keys.get(drawn.id);
        return drawn && key ? { key, affine: drawn.affine, opacity: drawn.opacity } : null;
      };
      const layers: FrameLayer[] = [];
      for (const shot of shotsAt(f)) {
        if (shot.kind === "clip") {
          const picture = placed(shot.shown);
          if (picture) layers.push({ kind: "picture", picture });
          continue;
        }
        const def = shot.window.def;
        layers.push({
          kind: "transition",
          shader: def.type,
          uniforms: transitionUniforms(def, shot.window.transition.params),
          progress: shot.progress,
          from: placed(shot.from),
          to: placed(shot.to),
        });
      }
      return layers;
    },
  };
}

/** A clip's media, or its (first) text drawing. */
function renderAssetOf(clip: Clip, assets: Record<string, RenderAsset>, texts: Record<string, RenderAsset[]>): RenderAsset {
  const text = isTextClip(clip);
  const asset = text ? texts[clip.id]?.[0] : assets[clip.assetId];
  if (!asset) throw new Error(text ? `Missing text image for clip ${clip.id}.` : `Missing media for clip ${clip.id}.`);
  return asset;
}

/** The media's own size (the canvas when it has none). */
function mediaSize(asset: RenderAsset, canvas: Size): Size {
  return asset.width && asset.height ? { width: asset.width, height: asset.height } : canvas;
}

/**
 * A video's YCbCr matrix as the luma weights of red and blue: its own, else
 * what players assume for its size (BT.709 for HD, BT.601 below).
 */
export function lumaWeights(colorSpace: string | null | undefined, height: number | null): [number, number] {
  switch (colorSpace) {
    case "bt709":
      return [0.2126, 0.0722];
    case "smpte170m":
    case "bt470bg":
      return [0.299, 0.114];
    case "bt2020nc":
    case "bt2020c":
      return [0.2627, 0.0593];
    case "smpte240m":
      return [0.212, 0.087];
    case "fcc":
      return [0.3, 0.11];
    default:
      return (height ?? 0) >= 720 ? [0.2126, 0.0722] : [0.299, 0.114];
  }
}

const BT709 = ["-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv"];

const rawOut = (pixelFormat: string) => ["-an", "-sn", "-f", "rawvideo", "-pix_fmt", pixelFormat, "pipe:1"];

function stillArgs(asset: RenderAsset, size: Size, opts: RenderOptions): string[] {
  return [
    opts.ffmpegPath ?? "ffmpeg", ...FFMPEG_QUIET,
    "-i", asset.path, "-frames:v", "1",
    "-vf", `scale=${size.width}:${size.height},format=rgba`,
    ...rawOut("rgba"),
  ];
}

/**
 * A clip's frames for output frames [first, end): the clip's first frame
 * shows its in-point, later ones carry on at the output rate, holding the
 * media's first or last frame past its ends.
 */
function videoArgs(clip: Clip, asset: RenderAsset, size: Size, first: number, end: number, opts: RenderOptions): string[] {
  const F = opts.fps;
  const n = end - first;
  const s0 = clip.in + (first - frameAtFps(F)(clip.start)) / F;
  const { min, max } = sourceRange(asset);
  const holdFirst = s0 < min ? Math.min(n, Math.ceil((min - s0) * F - 1e-6)) : 0;
  const seek = Math.min(Math.max(s0, min), Math.max(min, max - 1 / F));
  return [
    opts.ffmpegPath ?? "ffmpeg", ...FFMPEG_QUIET,
    // A little extra so the frame rate conversion always has the last frame's successor.
    "-ss", sec(seek), "-t", sec((n - holdFirst) / F + 0.25), "-i", asset.path,
    "-vf", [
      "setpts=PTS-STARTPTS",
      `fps=${F}`,
      // Kept in YUV (the compositor turns it into RGB), in limited range.
      `scale=${size.width}:${size.height}:out_range=tv`,
      "format=yuv420p",
      // Hold the first frame where the media starts late; clone the last in case
      // the source runs short, then cut exactly.
      `tpad=${holdFirst ? `start_mode=clone:start=${holdFirst}:` : ""}stop_mode=clone:stop=${n}`,
      `trim=end_frame=${n}`,
    ].join(","),
    ...rawOut("yuv420p"),
  ];
}

/** The ffmpeg that mixes the export's sound into `outputPath` (lossless), covering the whole timeline. */
export function audioArgs(
  project: Project,
  assets: Record<string, RenderAsset>,
  opts: Pick<RenderOptions, "ffmpegPath"> & { outputPath: string },
  texts: Record<string, RenderAsset[]> = {},
): string[] {
  const total = projectDuration(project);
  if (!(total > 0)) throw new Error("Nothing to render: the timeline is empty.");
  const sampleAt = (t: number) => Math.round(t * SAMPLE_RATE);
  const inputs: string[] = [];
  const graph: string[] = [];
  const totalSamples = sampleAt(total);
  graph.push(`anullsrc=r=${SAMPLE_RATE}:cl=stereo,${AUDIO_FORMAT},atrim=end_sample=${totalSamples}[abase]`);
  const mixInputs: string[] = [];
  for (const track of project.tracks) {
    if (track.muted) continue;
    for (const clip of trackClips(project, track.id)) {
      const asset = renderAssetOf(clip, assets, texts);
      if (!asset.hasAudio) continue;
      const samples = sampleAt(clipEnd(clip)) - sampleAt(clip.start);
      if (samples <= 0) continue;
      const index = mixInputs.length;
      inputs.push("-ss", sec(clip.in), "-t", sec(clipDuration(clip)), "-i", asset.path);
      // Resample, rebase to 0, apply gain, cut/pad to exactly its samples and delay to its start.
      const volume = findEffect(clip, VOLUME.type);
      const levels = volume?.enabled ? volume.keyframes?.level : undefined;
      const gain = levels?.length
        ? // Animated: evaluated in short blocks so the level glides without steps.
          ["asetnsamples=n=64:p=0", `volume=volume='${keyframeExpression(levels, clip.in)}':eval=frame`]
        : volumeAt(clip, clip.in) !== 1
          ? [`volume=${volumeAt(clip, clip.in)}`]
          : [];
      const chain = [
        AUDIO_FORMAT,
        "asetpts=PTS-STARTPTS",
        ...gain,
        `apad=whole_len=${samples}`,
        `atrim=end_sample=${samples}`,
        `adelay=delays=${sampleAt(clip.start)}S:all=1`,
      ];
      graph.push(`[${index}:a]${chain.join(",")}[m${index}]`);
      mixInputs.push(`[m${index}]`);
    }
  }
  graph.push(
    mixInputs.length
      ? `[abase]${mixInputs.join("")}amix=inputs=${mixInputs.length + 1}:duration=first:normalize=0,${LIMITER}[aout]`
      : "[abase]anull[aout]",
  );
  return [
    opts.ffmpegPath ?? "ffmpeg",
    ...FFMPEG_QUIET, "-nostats", "-progress", "pipe:1",
    ...inputs,
    "-filter_complex", graph.join(";"),
    "-map", "[aout]", "-c:a", "flac",
    "-t", sec(total),
    "-y", opts.outputPath,
  ];
}

/** Bytes of one composited frame as the compositor hands it over (YUV 4:2:0, see `readYuv420`). */
export const frameBytes = (plan: Pick<RenderPlan, "width" | "height">) => (plan.width * plan.height * 3) / 2;

/**
 * A number's keyframes as an ffmpeg expression of `t` (seconds since source
 * time `offset`): the same curve as `keyframeValue`, piece by piece.
 */
export function keyframeExpression(keys: readonly Keyframe[], offset: number): string {
  const n = (x: number) => String(Math.round(x * 1e6) / 1e6);
  const value = (k: Keyframe) => n(k.value as number);
  const at = (k: Keyframe) => n(k.time - offset);
  let expr = value(keys[keys.length - 1]);
  for (let i = keys.length - 2; i >= 0; i--) {
    const [a, b] = [keys[i], keys[i + 1]];
    let piece = value(a);
    if (a.easing !== "hold" && b.value !== a.value) {
      // easedProgress: 3(1-f)²f·y1 + 3(1-f)f²·y2 + f³.
      const f = `((t-${at(a)})/${n(b.time - a.time)})`;
      const g = `(1-${f})`;
      const y1 = easesOut(a.easing) ? 0 : 1 / 3;
      const y2 = easesIn(b.easing) ? 1 : 2 / 3;
      const curve = `(${n(3 * y1)}*${g}*${g}*${f}+${n(3 * y2)}*${g}*${f}*${f}+${f}*${f}*${f})`;
      piece = `${value(a)}+${n((b.value as number) - (a.value as number))}*${curve}`;
    }
    expr = `if(lt(t,${at(b)}),${piece},${expr})`;
  }
  return `if(lt(t,${at(keys[0])}),${value(keys[0])},${expr})`;
}

/**
 * The ffmpeg that encodes the composited frames (raw BT.709 YUV 4:2:0 on
 * stdin, exactly `plan.frames` of them) with the mixed sound into the final MP4.
 */
export function encoderArgs(
  plan: Pick<RenderPlan, "width" | "height" | "fps" | "frames">,
  opts: Pick<RenderOptions, "ffmpegPath"> & { audioPath: string; outputPath: string },
): string[] {
  const { width: W, height: H, fps: F } = plan;
  const crf = Math.min(W, H) <= 720 ? "23" : "20";
  return [
    opts.ffmpegPath ?? "ffmpeg", ...FFMPEG_QUIET,
    "-f", "rawvideo", "-pix_fmt", "yuv420p", "-s", `${W}x${H}`, "-framerate", String(F),
    ...BT709, "-i", "pipe:0",
    "-i", opts.audioPath,
    "-map", "0:v", "-map", "1:a", "-map_metadata", "-1",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", crf, "-pix_fmt", "yuv420p", "-r", String(F), ...BT709,
    "-c:a", "aac", "-b:a", "192k", "-ar", String(SAMPLE_RATE), "-ac", "2",
    "-movflags", "+faststart",
    "-frames:v", String(plan.frames),
    "-y", opts.outputPath,
  ];
}

/** Run an ffmpeg that reports `-progress` on stdout, reporting progress 0..1 of `duration`. */
export async function runWithProgress(
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
