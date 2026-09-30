/**
 * Project -> export plan (pure, unit-tested). The export draws every frame
 * with the same compositor as the preview (`shared/compositor.ts`), in a
 * headless browser (`frame-render.ts`); ffmpeg only decodes, mixes the sound
 * and encodes:
 *
 * - Output frame f shows timeline time f / fps: what `sceneAt` says each video
 *   track shows then (a clip, or a transition with both sides), with its video
 *   effects, placed by its Motion and faded by its Opacity at that moment
 *   (averaged over the shutter with motion blur, see `shared/layers.ts`),
 *   bottom track first over a black canvas. Solids are drawn by the compositor
 *   and adjustment layers change what's below them, so neither has a source.
 * - Each clip that's ever visible is decoded once by its own ffmpeg
 *   (`RenderSource`) into raw RGBA frames, one per output frame from the
 *   first it's drawn in to the last, so the stream stays in step with the
 *   output. A transition may show a clip past its edges (the media's
 *   handles); where the media ends, its first or last frame is held. A clip
 *   at another speed is decoded at that rate; one played backwards is decoded
 *   (forwards) from its media's reversed copy. Stills (and drawn texts) are decoded once. Frames are decoded at the size the
 *   clip is shown at, never bigger than its media.
 * - Text clips arrive already drawn (by the browser, in the user's fonts) as
 *   images with their frame size; they're placed like any other still.
 * - Every clip with sound on an unmuted track (video or audio) is cut to its
 *   exact sample length, delayed to its timeline start and summed (no
 *   normalisation) on top of silence covering the whole timeline, in a pass of
 *   its own (`audioArgs`). Sped up or slowed down, it keeps its pitch (or not:
 *   `Clip.keepPitch`); played backwards, it's the reversed copy's sound. A look-ahead limiter (delay-compensated, no
 *   auto-gain) catches the peaks where overlapping sources add up past full
 *   scale instead of clipping.
 * - Colour: videos are decoded as YUV and turned into RGB by the compositor
 *   with their own YCbCr matrix; the output is BT.709, tagged as such.
 */
import { type Adjustment, type Affine, type EffectPass, type Placed, matteIndex } from "../shared/compositor.ts";
import { effectPasses, effectShader } from "../shared/effect-gl.ts";
import { VOLUME, clipKind, effectDefinition, findEffect, hasMedia, isTextClip, lookAt, motionAt, opacityAt, solidColorAt, volumeAt } from "../shared/effects.ts";
import { easesIn, easesOut, isPlainSegment, segmentProgress } from "../shared/keyframes.ts";
import { parentAt } from "../shared/parenting.ts";
import { EXPORT_SAMPLES, canvasAffine, clipLayer, placer, projectCamera, sortByDepth, withTrackMattes } from "../shared/layers.ts";
import { type Shown, handleTime, sceneAt, transitionWindows } from "../shared/scene.ts";
import {
  END_GUARD,
  TEXT_SOURCE_RANGE,
  clipEnd,
  clipSpeed,
  fileTime,
  projectDuration,
  sourceRange,
  trackClips,
  videoTracks,
} from "../shared/timeline.ts";
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

export type RenderAsset = Pick<MediaAsset, "kind" | "hasAudio" | "hasVideo" | "width" | "height" | "duration"> & Partial<Pick<MediaAsset, "fps">> & {
  path: string;
  /** Its reversed copy (see `MediaAsset.reversed`), needed when a clip plays it backwards. */
  reversedPath?: string;
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
  /**
   * Time interpolation (`Clip.timeInterpolation`): the media is decoded at its own frame rate
   * (`fps`) from file time `start`, one frame at a time as the output needs them, and each
   * output frame gets the two either side of its moment (see `Placed.interpolate`).
   */
  native?: { fps: number; start: number };
}

/** Bytes of one of a source's frames. */
export const sourceFrameBytes = (s: Pick<RenderSource, "still" | "width" | "height">) =>
  s.still ? s.width * s.height * 4 : (s.width * s.height * 3) / 2;

/** A picture placed on an output frame; its effects' shaders are keys into `RenderPlan.shaders`. */
export type PlacedRef = Placed<string>;

/** One layer of an output frame, bottom first. */
export type FrameLayer =
  | { kind: "picture"; picture: PlacedRef }
  | { kind: "adjustment"; adjustment: Adjustment<string> }
  | {
      kind: "transition";
      /** Key into `RenderPlan.shaders`. */
      shader: string;
      uniforms: UniformValue[];
      progress: number;
      from: PlacedRef | null;
      to: PlacedRef | null;
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
  for (const clip of project.clips) if (hasPicture(clip)) renderAssetOf(clip, assets, texts);
  const range = (clip: Clip) => (!hasMedia(clip) ? TEXT_SOURCE_RANGE : sourceRange(renderAssetOf(clip, assets, texts)));
  const layerOptions = { canvas, fps: F, maxSamples: EXPORT_SAMPLES };
  const camera = projectCamera(project, canvas);
  const canvasAffineOf = (clip: Clip) => canvasAffine(clip, canvas, camera, parentAt(project, clip, canvas));
  const videoTrackIds = videoTracks(project).map((t) => t.id);
  const trackAbove = (id: string) => videoTrackIds[videoTrackIds.indexOf(id) - 1];
  const shotsAt = (f: number) => sceneAt(project, windows, frameTime(f, F), range);

  /** The picture a clip shows at a moment: its media, or its text's drawing then. */
  const pictureAt = ({ clip, time }: Shown): { id: string; asset: RenderAsset } => {
    if (!isTextClip(clip)) return { id: clip.id, asset: renderAssetOf(clip, assets, texts) };
    const drawings = texts[clip.id];
    let i = 0;
    while (i + 1 < drawings.length && (drawings[i + 1].from ?? -Infinity) <= time + 1e-9) i++;
    return { id: `${clip.id}#${i}`, asset: drawings[i] };
  };

  /** Where a clip with a picture is drawn at a moment, or null when none of it is visible. */
  const draw = (shown: Shown): (Drawn & { id: string; asset: RenderAsset }) | null => {
    const { clip, time } = shown;
    if (!hasPicture(clip)) return null;
    const opacity = opacityAt(clip, time);
    if (!(opacity > 0)) return null;
    const { id, asset } = pictureAt(shown);
    const media = mediaSize(asset, canvas);
    const motion = motionAt(clip, time);
    const p = placeClip(canvas, media, motion, asset.frame);
    if (!(Math.abs(p.scaleX) > 0 && Math.abs(p.scaleY) > 0)) return null;
    // A 3D layer can come into view however it's placed in 2D, and nearer the camera it's shown bigger: all its detail.
    // So can a parented one, carried wherever (and however big) its parents take it.
    if (motion.threeD || clip.parent) return { id, asset, affine: placementAffine(p, canvas) as Affine, opacity, density: [1, 1] };
    const corners = frameCorners(p);
    const xs = corners.map((c) => c[0]);
    const ys = corners.map((c) => c[1]);
    const onCanvas = Math.max(...xs) > 0 && Math.min(...xs) < W && Math.max(...ys) > 0 && Math.min(...ys) < H;
    if (!onCanvas) return null;
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
  // Every video effect a visible clip has on, whenever it's shown.
  for (const clip of project.clips) {
    for (const pass of effectPasses(clip, clip.in)) {
      shaders[pass.shader.key] = pass.shader.source;
      // A particle effect's own vertex shader travels under its key and "#vs".
      if (pass.shader.vertex) shaders[`${pass.shader.key}#vs`] = pass.shader.vertex;
      if (pass.shader.base) shaders[`${pass.shader.key}#base`] = pass.shader.base;
    }
  }
  // 3D layers' depth of field blurs with Gaussian Blur, whatever effects the clips have.
  if (project.clips.some((c) => findEffect(c, "motion")?.params.threeD === true)) {
    const blur = effectShader(effectDefinition("gaussian-blur")!);
    if (blur) shaders[blur.key] = blur.source;
  }
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
      const fps = asset.fps ?? 0;
      if (clip.timeInterpolation && fps > 0) {
        // The file times it shows, a frame's margin either side, on the media's own frame grid.
        const fileAt = (f: number) => fileTime(clip, handleTime(clip, frameTime(f, F), range(clip)), asset.duration);
        const [a, b] = [fileAt(first), fileAt(end - 1)];
        const start = Math.max(0, Math.floor((Math.min(a, b) - 1 / fps) * fps + 1e-6) / fps);
        const length = Math.max(a, b) + 3 / fps - start;
        return { ...base, still, ...size, luma, argv: nativeArgs(clip, asset, size, start, length, opts), native: { fps, start } };
      }
      return { ...base, still, ...size, luma, argv: videoArgs(clip, asset, size, first, end, opts) };
    });
  const nativeOf = new Map(sources.flatMap((s) => (s.native ? [[s.key, s.native] as const] : [])));

  return {
    width: W,
    height: H,
    fps: F,
    frames,
    sources,
    shaders,
    frame(f) {
      const placed = (shown: Shown | null): PlacedRef | null => {
        if (!shown) return null;
        const { clip, time } = shown;
        if (clipKind(clip) === "solid") {
          const layer = clipLayer(clip, time, canvasAffineOf(clip), layerOptions);
          return layer && { ...byKey(layer), key: "", solid: { color: solidColorAt(clip, time), width: W, height: H } };
        }
        const drawn = draw(shown);
        const key = drawn && keys.get(drawn.id);
        if (!drawn || !key) return null;
        const media = mediaSize(drawn.asset, canvas);
        const where = placer(clip, canvas, (t) => placeClip(canvas, media, motionAt(clip, t), drawn.asset.frame), camera, parentAt(project, clip, canvas));
        const layer = clipLayer(clip, time, where, layerOptions);
        const native = nativeOf.get(key);
        if (!layer || !native) return layer && { ...byKey(layer), key };
        // Between which two of the media's frames this moment is, and how far along.
        const x = (fileTime(clip, time, drawn.asset.duration) - native.start) * native.fps;
        const index = Math.max(0, Math.floor(x + 1e-6));
        const interpolate = { key: `${key}+`, amount: Math.min(1, Math.max(0, x - index)), flow: clip.timeInterpolation === "flow", index };
        return { ...byKey(layer), key, interpolate };
      };
      /** Each track's layer, bottom first, with how its clip wants a track matte. */
      const layers: { trackId: string; matte: number; layer: FrameLayer }[] = [];
      for (const shot of shotsAt(f)) {
        const { trackId } = shot;
        if (shot.kind === "clip") {
          const { clip, time } = shot.shown;
          // A camera draws nothing (3D layers are seen through it), nor does a null object.
          if (clipKind(clip) === "camera" || clipKind(clip) === "null") continue;
          const matte = matteIndex(lookAt(clip, time).trackMatte);
          if (clipKind(clip) === "adjustment") {
            const layer = clipLayer(clip, time, canvasAffineOf(clip), layerOptions);
            if (layer) layers.push({ trackId, matte, layer: { kind: "adjustment", adjustment: byKey(layer) } });
            continue;
          }
          const picture = placed(shot.shown);
          if (picture) layers.push({ trackId, matte, layer: { kind: "picture", picture } });
          continue;
        }
        const def = shot.window.def;
        layers.push({
          trackId,
          matte: 0,
          layer: {
            kind: "transition",
            shader: def.type,
            uniforms: transitionUniforms(def, shot.window.transition.params),
            progress: shot.progress,
            from: placed(shot.from),
            to: placed(shot.to),
          },
        });
      }
      const matted = withTrackMattes(
        layers,
        trackAbove,
        (l) => l.matte,
        (l) => l.layer.kind === "picture",
        (l, m, mode) => {
          const matte = { mode, layer: (m.layer as Extract<FrameLayer, { kind: "picture" }>).picture };
          if (l.layer.kind === "picture") return { ...l, layer: { ...l.layer, picture: { ...l.layer.picture, matte } } };
          if (l.layer.kind === "adjustment") return { ...l, layer: { ...l.layer, adjustment: { ...l.layer.adjustment, matte } } };
          return l;
        },
      );
      // 3D layers on neighbouring tracks are drawn far first.
      return sortByDepth(matted, (l) => (l.layer.kind === "picture" ? (l.layer.picture as { depth?: number }).depth : undefined)).map((l) => l.layer);
    },
  };
}

/** Whether a clip's picture comes from a source (its media, or its text's drawing): not a solid or an adjustment layer. */
const hasPicture = (clip: Clip) => {
  const kind = clipKind(clip);
  return kind === "media" || kind === "text";
};

/** A layer's shaders named by key (their sources travel separately, in `RenderPlan.shaders`). */
function byKey(layer: Omit<Placed, "key">): Omit<PlacedRef, "key"> {
  const keyed = (effects: EffectPass[]) => effects.map((pass) => ({ ...pass, shader: pass.shader.key }));
  const { effects, samples, matte, ...rest } = layer;
  return {
    ...rest,
    ...(effects && { effects: keyed(effects) }),
    ...(samples && { samples: samples.map(({ effects: e, ...sample }) => ({ ...sample, ...(e && { effects: keyed(e) }) })) }),
    ...(matte && { matte: { mode: matte.mode, layer: { ...byKey(matte.layer), key: matte.layer.key } } }),
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

/** The file a clip plays: its media, or the media's reversed copy when it plays backwards. */
function playedFile(clip: Clip, asset: RenderAsset): string {
  if (!clip.reversed) return asset.path;
  if (!asset.reversedPath) throw new Error(`Clip ${clip.id} plays backwards, but its media has no reversed copy.`);
  return asset.reversedPath;
}

/**
 * A clip's frames for output frames [first, end): the clip's first frame
 * shows its first source frame (its in-point, or played backwards the frame
 * before its out-point), later ones carry on at the output rate times the
 * clip's speed, holding the file's first or last frame past its ends.
 */
function videoArgs(clip: Clip, asset: RenderAsset, size: Size, first: number, end: number, opts: RenderOptions): string[] {
  const F = opts.fps;
  const n = end - first;
  const speed = clipSpeed(clip);
  // Where the first frame is in the file played (a reversed copy runs forwards too).
  const played = ((first - frameAtFps(F)(clip.start)) / F) * speed;
  const firstSource = clip.reversed ? clip.out - END_GUARD - played : clip.in + played;
  const s0 = fileTime(clip, firstSource, asset.duration);
  const { min, max } = sourceRange(asset);
  const holdFirst = s0 < min ? Math.min(n, Math.ceil(((min - s0) * F) / speed - 1e-6)) : 0;
  const seek = Math.min(Math.max(s0, min), Math.max(min, max - 1 / F));
  return [
    opts.ffmpegPath ?? "ffmpeg", ...FFMPEG_QUIET,
    // A little extra so the frame rate conversion always has the last frame's successor.
    "-ss", sec(seek), "-t", sec(((n - holdFirst) / F) * speed + 0.25), "-i", playedFile(clip, asset),
    "-vf", [
      speed === 1 ? "setpts=PTS-STARTPTS" : `setpts=(PTS-STARTPTS)/${speed}`,
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

/**
 * A time-interpolated clip's frames (`RenderSource.native`): its media from file time
 * `start` for `length` seconds, at the media's own frame rate (so frame i is at
 * start + i / fps), at `size`, as YUV 4:2:0.
 */
function nativeArgs(clip: Clip, asset: RenderAsset, size: Size, start: number, length: number, opts: RenderOptions): string[] {
  return [
    opts.ffmpegPath ?? "ffmpeg", ...FFMPEG_QUIET,
    "-ss", sec(start), "-t", sec(length), "-i", playedFile(clip, asset),
    "-vf", ["setpts=PTS-STARTPTS", `fps=${asset.fps}`, `scale=${size.width}:${size.height}:out_range=tv`, "format=yuv420p"].join(","),
    ...rawOut("yuv420p"),
  ];
}

/**
 * Filters that play sound at `speed`: time-stretched with its pitch kept
 * (`atempo`, chained since each one goes no slower than half speed), or
 * resampled so the pitch follows the speed.
 */
export function tempoFilters(speed: number, keepPitch: boolean): string[] {
  if (speed === 1) return [];
  if (!keepPitch) return [`asetrate=${Math.round(SAMPLE_RATE * speed)}`, `aresample=${SAMPLE_RATE}`];
  const filters: string[] = [];
  let rest = speed;
  while (rest < 0.5 - 1e-9) {
    filters.push("atempo=0.5");
    rest /= 0.5;
  }
  filters.push(`atempo=${Math.round(rest * 1e6) / 1e6}`);
  return filters;
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
      // Text, solids and adjustment layers are silent.
      if (!hasMedia(clip)) continue;
      const asset = renderAssetOf(clip, assets, texts);
      if (!asset.hasAudio) continue;
      const samples = sampleAt(clipEnd(clip)) - sampleAt(clip.start);
      if (samples <= 0) continue;
      const index = mixInputs.length;
      // Played backwards, the sound comes from the reversed copy, where the clip's out-point comes first.
      const from = clip.reversed ? asset.duration - clip.out : clip.in;
      inputs.push("-ss", sec(from), "-t", sec(clip.out - clip.in), "-i", playedFile(clip, asset));
      // Resample, rebase to 0, apply gain (in source time, `t` seconds into the file played), change
      // speed, cut/pad to exactly its samples and delay to its start.
      const volume = findEffect(clip, VOLUME.type);
      const levels = volume?.enabled ? volume.keyframes?.level : undefined;
      const gain = levels?.length
        ? // Animated: evaluated in short blocks so the level glides without steps.
          [
            "asetnsamples=n=64:p=0",
            `volume=volume='${clip.reversed ? keyframeExpression(levels, 0, `(${sec(clip.out)}-t)`) : keyframeExpression(levels, clip.in)}':eval=frame`,
          ]
        : volumeAt(clip, clip.in) !== 1
          ? [`volume=${volumeAt(clip, clip.in)}`]
          : [];
      const chain = [
        AUDIO_FORMAT,
        "asetpts=PTS-STARTPTS",
        ...gain,
        ...tempoFilters(clipSpeed(clip), clip.keepPitch !== false),
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
 * A number's keyframes as an ffmpeg expression of `time` (an expression of
 * the seconds since source time `offset`, by default `t`): the same curve as
 * `keyframeValue`, piece by piece.
 */
export function keyframeExpression(keys: readonly Keyframe[], offset: number, time = "t"): string {
  const n = (x: number) => String(Math.round(x * 1e6) / 1e6);
  const value = (k: Keyframe) => n(k.value as number);
  const at = (k: Keyframe) => n(k.time - offset);
  let expr = value(keys[keys.length - 1]);
  for (let i = keys.length - 2; i >= 0; i--) {
    const [a, b] = [keys[i], keys[i + 1]];
    let piece = value(a);
    if (a.easing !== "hold" && b.value !== a.value) {
      const f = `((${time}-${at(a)})/${n(b.time - a.time)})`;
      const change = n((b.value as number) - (a.value as number));
      if (isPlainSegment(a, b)) {
        // easedProgress at 33% influence: 3(1-f)²f·y1 + 3(1-f)f²·y2 + f³.
        const g = `(1-${f})`;
        const y1 = easesOut(a.easing) ? 0 : 1 / 3;
        const y2 = easesIn(b.easing) ? 1 : 2 / 3;
        const curve = `(${n(3 * y1)}*${g}*${g}*${f}+${n(3 * y2)}*${g}*${f}*${f}+${f}*${f}*${f})`;
        piece = `${value(a)}+${change}*${curve}`;
      } else {
        // Other influences and the graph editor's handles need the curve solved for time: follow it in short straight pieces.
        const PIECES = 48;
        let curve = "1";
        for (let j = PIECES - 1; j >= 0; j--) {
          const [f0, f1] = [j / PIECES, (j + 1) / PIECES];
          const [p0, p1] = [segmentProgress(a, b, f0), segmentProgress(a, b, f1)];
          curve = `if(lt(${f},${n(f1)}),${n(p0)}+${n((p1 - p0) * PIECES)}*(${f}-${n(f0)}),${curve})`;
        }
        piece = `${value(a)}+${change}*(${curve})`;
      }
    }
    expr = `if(lt(${time},${at(b)}),${piece},${expr})`;
  }
  return `if(lt(${time},${at(keys[0])}),${value(keys[0])},${expr})`;
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
