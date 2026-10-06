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
 *   (forwards) from its media's reversed copy. Stills are decoded once. Frames are decoded at the size the
 *   clip is shown at, never bigger than its media.
 * - Text clips arrive laid out (by the browser tab, which knows the user's
 *   fonts); each frame says what to draw from the layout and the text's look
 *   then (`textDrawing`), and the page's compositor draws it, like the preview.
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
import { type Hearing, type SignalStore, createSignalReader, nestedHearing, withHearing, withSignals } from "../shared/audio-signals.ts";
import { type Adjustment, type Affine, type EffectPass, type Placed, matteIndex } from "../shared/compositor.ts";
import { effectPasses, effectShader } from "../shared/effect-gl.ts";
import type { FrameReadback } from "../shared/export-formats.ts";
import { type Camera3D } from "../shared/camera.ts";
import {
  VOLUME,
  atFrameRate,
  clipKind,
  definitionOf,
  effectDefinition,
  findEffect,
  hasMedia,
  isRemapped,
  isTextClip,
  lookAt,
  motionAt,
  opacityAt,
  solidColorAt,
  textStyleAt,
  volumeAt,
} from "../shared/effects.ts";
import { type TextLayout, textDrawing, textUnit } from "../shared/text-drawing.ts";
import { easesIn, easesOut, isPlainSegment, segmentProgress } from "../shared/keyframes.ts";
import { parentAt } from "../shared/parenting.ts";
import { EXPORT_SAMPLES, canvasAffine, clipLayer, placer, projectCamera, sortByDepth, withTrackMattes } from "../shared/layers.ts";
import { even } from "../shared/math.ts";
import { type Shown, sceneAt, transitionWindows } from "../shared/scene.ts";
import { shapeDrawingAt } from "../shared/shapes.ts";
import { allClips, getSequence, isNestedClip, nestedSequence, sequenceDuration, sequenceSize, sequenceView } from "../shared/sequences.ts";
import { mediaTime } from "../shared/time-remap.ts";
import { frameSourceTime } from "../shared/simulation.ts";
import {
  END_GUARD,
  TEXT_SOURCE_RANGE,
  clipEnd,
  clipSpeed,
  fileTime,
  outputSize,
  projectDuration,
  sourceEdge,
  sourceRange,
  sourceTime,
  trackClips,
  videoTracks,
} from "../shared/timeline.ts";
import { type UniformValue, transitionShader, transitionUniforms } from "../shared/transition-gl.ts";
import type { TransitionWindow } from "../shared/transition-windows.ts";
import { type Size, frameCorners, placeClip, placementAffine } from "../shared/transform.ts";
import type { Clip, Keyframe, MediaAsset, Project, TextLayoutAt } from "../shared/types.ts";
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
  /** The video's YCbCr matrix as ffprobe names it (`color_space`), when known. */
  colorSpace?: string | null;
};

export interface RenderOptions {
  width: number;
  height: number;
  fps: number;
  ffmpegPath?: string;
  /** The media's signals, by id, for what reacts to sound (`audio()` in expressions): those it uses. */
  signals?: SignalStore;
}

/** One clip's pictures: an ffmpeg writing raw frames to stdout. */
export interface RenderSource {
  /** The compositor's picture key. */
  key: string;
  clipId: string;
  /**
   * A still (an image) is one RGBA frame drawn all along; a video
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
    }
  /** A nested sequence: `layers` drawn into a `width` x `height` picture `key` (see `Compositor.beginGroup`), for later layers to place. */
  | { kind: "group"; key: string; width: number; height: number; layers: FrameLayer[] }
  /** A simulation's earlier frame, stepped and not drawn (`Compositor.advance`): what it needs before the frame drawn next. */
  | { kind: "advance"; picture: PlacedRef };

export interface RenderPlan {
  width: number;
  height: number;
  fps: number;
  /** Output frames. */
  frames: number;
  sources: RenderSource[];
  /** Fragment shader sources by key. */
  shaders: Record<string, string>;
  /** The user's shaders (the Shader effect's, keyed `fx:shader:...`): where each is first used, to say so if it won't compile. */
  shaderUses: Record<string, string>;
  /** The CSS fonts its texts are drawn in, for the page to have ready before the first frame. */
  fonts: string[];
  /** Whether it draws 3D scenes (the page loads their runtime first). */
  scenes: boolean;
  /** What output frame `f` draws, bottom layer first. */
  frame(f: number): FrameLayer[];
  /**
   * Media that's shown backwards somewhere (a remapped clip running back, or inside a nest
   * that does) without a reversed copy in `assets`: plan again once they have one.
   */
  needsReversed: string[];
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
  /** Text clips' layouts, by clip id: one, or several over time when the text's words or size change (see `TextLayoutAt.from`). */
  texts: Record<string, TextLayoutAt[]> = {},
): RenderPlan {
  const { width: W, height: H, fps: F } = opts;
  const total = projectDuration(project);
  if (!(total > 0)) throw new Error("Nothing to render: the timeline is empty.");
  const frames = frameAtFps(F)(total);
  const everyClip = allClips(project);
  for (const clip of everyClip) {
    if (hasPicture(clip)) renderAssetOf(clip, assets);
    if (isTextClip(clip) && !texts[clip.id]?.length) throw new Error(`Missing text layout for clip ${clip.id}.`);
  }
  const range = (clip: Clip) =>
    !hasMedia(clip) || isNestedClip(clip) || isRemapped(clip) ? TEXT_SOURCE_RANGE : sourceRange(renderAssetOf(clip, assets));
  // Nested sequences are drawn at the export's scale: their 1080p frame times this.
  const scale = Math.min(W, H) / 1080;

  /** A sequence as drawn: the main one (null) or a nested one, with what's needed to draw it. */
  interface Level {
    view: Project;
    canvas: Size;
    windows: Map<string, TransitionWindow[]>;
    camera: (t: number) => Camera3D;
    trackAbove: (id: string) => string | undefined;
    layerOptions: { canvas: Size; fps: number; maxSamples: number };
  }
  const levels = new Map<string, Level>();
  const levelOf = (id: string | null): Level => {
    const key = id ?? "";
    let level = levels.get(key);
    if (level) return level;
    const view = sequenceView(project, id);
    const seq = id === null ? null : getSequence(project, id);
    const size = seq ? sequenceSize(seq) : null;
    const canvas = size ? { width: even(size.width * scale), height: even(size.height * scale) } : { width: W, height: H };
    const ids = videoTracks(view).map((t) => t.id);
    level = {
      view,
      canvas,
      windows: transitionWindows(view),
      camera: projectCamera(view, canvas),
      trackAbove: (tid) => ids[ids.indexOf(tid) - 1],
      layerOptions: { canvas, fps: view.settings.fps, maxSamples: EXPORT_SAMPLES },
    };
    levels.set(key, level);
    return level;
  };
  const top = levelOf(null);
  const shotsAt = (level: Level, t: number) => sceneAt(level.view, level.windows, t, range);

  /** The time a nested clip shows of its sequence (null: past its sequence, nothing). */
  const innerTime = ({ clip, time }: Shown): number | null => {
    const seq = nestedSequence(project, clip);
    if (!seq) return null;
    const T = mediaTime(clip, time);
    return T >= -1e-6 && T < sequenceDuration(seq) - 1e-6 ? Math.max(0, T) : null;
  };

  /** A text clip's layout at source time `time`. */
  const layoutAt = (clip: Clip, time: number): TextLayout => {
    const layouts = texts[clip.id];
    let i = 0;
    while (i + 1 < layouts.length && (layouts[i + 1].from ?? -Infinity) <= time + 1e-9) i++;
    return layouts[i].layout;
  };

  /** A nested clip's sequence as the media it's placed like (its frame at 1080p). */
  const nestMedia = (clip: Clip): RenderAsset | null => {
    const seq = nestedSequence(project, clip);
    if (!seq) return null;
    return { ...sequenceSize(seq), kind: "video", hasAudio: false, hasVideo: true, duration: sequenceDuration(seq), path: "" };
  };

  /** Where a clip with a picture (or a nested sequence) is drawn at a moment, or null when none of it is visible. */
  const draw = (level: Level, shown: Shown): (Drawn & { id: string; asset: RenderAsset }) | null => {
    const { clip, time } = shown;
    const nest = isNestedClip(clip) ? nestMedia(clip) : null;
    if (!hasPicture(clip) && !nest) return null;
    const opacity = opacityAt(clip, time);
    if (!(opacity > 0)) return null;
    const { id, asset } = { id: clip.id, asset: nest ?? renderAssetOf(clip, assets) };
    const { canvas } = level;
    const media = mediaSize(asset, canvas);
    const motion = motionAt(clip, time);
    const p = placeClip(canvas, media, motion);
    if (!(Math.abs(p.scaleX) > 0 && Math.abs(p.scaleY) > 0)) return null;
    // A 3D layer can come into view however it's placed in 2D, and nearer the camera it's shown bigger: all its detail.
    // So can a parented one, carried wherever (and however big) its parents take it.
    if (motion.threeD || clip.parent) return { id, asset, affine: placementAffine(p, canvas) as Affine, opacity, density: [1, 1] };
    const corners = frameCorners(p);
    const xs = corners.map((c) => c[0]);
    const ys = corners.map((c) => c[1]);
    const onCanvas = Math.max(...xs) > 0 && Math.min(...xs) < canvas.width && Math.max(...ys) > 0 && Math.min(...ys) < canvas.height;
    if (!onCanvas) return null;
    return {
      id,
      asset,
      affine: placementAffine(p, canvas) as Affine,
      opacity,
      density: [(p.width * Math.abs(p.scaleX)) / media.width, (p.height * Math.abs(p.scaleY)) / media.height],
    };
  };

  /**
   * Whether a video clip is decoded at its media's own frame rate, frame by frame as the
   * output needs them: when time interpolation needs the frames either side, when it's
   * remapped (its speed changes), and inside a nested sequence (whose clips' speeds depend
   * on the clip playing the sequence). Everything else is decoded straight at the output rate.
   */
  const isNative = (path: string, clip: Clip, asset: RenderAsset) =>
    asset.kind === "video" && (path !== "" || isRemapped(clip) || (!!clip.timeInterpolation && (asset.fps ?? 0) > 0));
  /** The media time a clip shows (inside its media). */
  const mediaAt = (shown: Shown, asset: RenderAsset) =>
    Math.min(Math.max(mediaTime(shown.clip, shown.time), 0), Math.max(0, asset.duration - END_GUARD));

  // Every visible picture: the frames it's drawn in, the most detail it's ever drawn with, and
  // (decoded natively) the media time it shows in each of them.
  interface Seen {
    clip: Clip;
    asset: RenderAsset;
    first: number;
    end: number;
    density: [number, number];
    native: boolean;
    times: [number, number][];
  }
  const seen = new Map<string, Seen>();
  const see = (f: number, level: Level, path: string, shown: Shown | null, depth: number, hearing: Hearing | null) => {
    if (!shown) return;
    if (isNestedClip(shown.clip)) {
      const T = innerTime(shown);
      const seq = nestedSequence(project, shown.clip);
      if (T === null || !seq || depth > 16 || !(opacityAt(shown.clip, shown.time) > 0)) return;
      visit(f, levelOf(seq.id), `${path}${shown.clip.id}/`, T, depth + 1, nestedHearing(shown.clip, hearing));
      return;
    }
    const drawn = draw(level, shown);
    if (!drawn) return;
    const id = path + drawn.id;
    let s = seen.get(id);
    if (!s) {
      const native = isNative(path, shown.clip, drawn.asset);
      s = { clip: shown.clip, asset: drawn.asset, first: f, end: f + 1, density: [...drawn.density], native, times: [] };
      seen.set(id, s);
    } else {
      s.end = f + 1;
      s.density = [Math.max(s.density[0], drawn.density[0]), Math.max(s.density[1], drawn.density[1])];
    }
    if (s.native && s.times.at(-1)?.[0] !== f) s.times.push([f, mediaAt(shown, drawn.asset)]);
  };
  const shaders: Record<string, string> = {};
  // What expressions hear (here and in `layersOf`).
  const signals = createSignalReader(project, opts.signals ?? new Map());
  const visit = (f: number, level: Level, path: string, t: number, depth: number, hearing: Hearing | null) =>
    // Expressions are told this sequence's frame rate, and a nest hears where it's placed (here and in `layersOf`).
    withSignals(signals, () => withHearing(hearing, () => atFrameRate(level.view.settings.fps, () => {
      for (const shot of shotsAt(level, t)) {
        if (shot.kind === "clip") see(f, level, path, shot.shown, depth, hearing);
        else {
          see(f, level, path, shot.from, depth, hearing);
          see(f, level, path, shot.to, depth, hearing);
          const shader = transitionShader(shot.window.def);
          shaders[shader.key] = shader.source;
        }
      }
    })));
  const shaderUses: Record<string, string> = {};
  // Every video effect a visible clip has on, whenever it's shown.
  for (const clip of everyClip) {
    for (const pass of effectPasses(clip, clip.in)) {
      shaders[pass.shader.key] = pass.shader.source;
      if (pass.shader.key.startsWith("fx:shader:")) shaderUses[pass.shader.key] ??= shaderUse(clip, pass.shader.key);
      // A particle effect's own vertex shader travels under its key and "#vs".
      if (pass.shader.vertex) shaders[`${pass.shader.key}#vs`] = pass.shader.vertex;
      if (pass.shader.base) shaders[`${pass.shader.key}#base`] = pass.shader.base;
    }
  }
  // 3D layers' depth of field blurs with Gaussian Blur, whatever effects the clips have.
  if (everyClip.some((c) => findEffect(c, "motion")?.params.threeD === true)) {
    const blur = effectShader(effectDefinition("gaussian-blur")!);
    if (blur) shaders[blur.key] = blur.source;
  }
  for (let f = 0; f < frames; f++) visit(f, top, "", frameTime(f, F), 0, null);

  /** A natively decoded picture's runs: stretches of its frames where its media time only goes one way. */
  interface Run {
    key: string;
    first: number;
    end: number;
    /** Backwards: decoded from the media's reversed copy, where media time `m` is at `duration - m`. */
    backwards: boolean;
    fps: number;
    start: number;
    duration: number;
  }
  const runsOf = new Map<string, Run[]>();
  const keys = new Map<string, string>();
  const needsReversed = new Set<string>();
  const sources: RenderSource[] = [];
  let n = 0;
  const sizeOf = (asset: RenderAsset, density: [number, number], still: boolean, canvas: Size) => {
    const media = mediaSize(asset, canvas);
    // YUV 4:2:0 needs even sizes.
    const side = (length: number, d: number) => {
      const k = Math.max(1, Math.min(MAX_PICTURE, Math.ceil(length * Math.min(1, d) - 1e-6)));
      return still ? k : k + (k % 2);
    };
    return { width: side(media.width, density[0]), height: side(media.height, density[1]) };
  };
  for (const [id, { clip, asset, first, end, density, native, times }] of [...seen.entries()].sort(([, a], [, b]) => a.first - b.first)) {
    const base = { clipId: clip.id, first, end };
    const still = asset.kind === "image";
    const size = sizeOf(asset, density, still, top.canvas);
    if (still) {
      const key = `s${n++}`;
      keys.set(id, key);
      sources.push({ ...base, key, still, ...size, luma: null, argv: stillArgs(asset, size, opts) });
      continue;
    }
    const luma = lumaWeights(asset.colorSpace, asset.height);
    if (!native) {
      const key = `s${n++}`;
      keys.set(id, key);
      sources.push({ ...base, key, still, ...size, luma, argv: videoArgs(clip, asset, size, first, end, opts) });
      continue;
    }
    // Split where the media time turns around; a backwards stretch plays the reversed copy forwards.
    const fps = asset.fps && asset.fps > 0 ? asset.fps : F;
    const stretches: { backwards: boolean; times: [number, number][] }[] = [];
    let dir = 0;
    for (const [i, [f, m]] of times.entries()) {
      const d = i === 0 ? 0 : m - times[i - 1][1];
      const step = d > 1e-7 ? 1 : d < -1e-7 ? -1 : 0;
      const current = stretches.at(-1);
      if (!current || (step !== 0 && dir !== 0 && step !== dir)) {
        stretches.push({ backwards: false, times: [[f, m]] });
        dir = 0;
        continue;
      }
      if (step !== 0 && dir === 0) {
        dir = step;
        current.backwards = step < 0;
      }
      current.times.push([f, m]);
    }
    const runs: Run[] = [];
    for (const stretch of stretches) {
      const key = `s${n++}`;
      const file = (m: number) => (stretch.backwards ? asset.duration - END_GUARD - m : m);
      const at = stretch.times.map(([, m]) => file(m));
      const lo = Math.min(...at);
      const hi = Math.max(...at);
      const start = Math.max(0, Math.floor((lo - 1 / fps) * fps + 1e-6) / fps);
      const length = hi + 3 / fps - start;
      const path = stretch.backwards ? asset.reversedPath : asset.path;
      if (stretch.backwards && !asset.reversedPath) needsReversed.add(clip.assetId);
      const first = stretch.times[0][0];
      const endRun = stretch.times.at(-1)![0] + 1;
      runs.push({ key, first, end: endRun, backwards: stretch.backwards, fps, start, duration: asset.duration });
      sources.push({
        clipId: clip.id,
        key,
        first,
        end: endRun,
        still,
        ...size,
        luma,
        argv: nativeArgs(path ?? asset.path, fps, size, start, length, opts),
        native: { fps, start },
      });
    }
    runsOf.set(id, runs);
  }

  /** Each simulation's newest frame drawn (`EffectPass.simulation`), and whether earlier ones are being planned. */
  const simulated = new Map<string, number>();
  let warming = false;

  return {
    width: W,
    height: H,
    fps: F,
    frames,
    sources,
    shaders,
    shaderUses,
    fonts: [...new Set(Object.values(texts).flatMap((layouts) => layouts.map((l) => l.layout.font)))],
    scenes: everyClip.some((clip) => clip.effects.some((e) => e.enabled && !!definitionOf(e)?.shader?.scene)),
    needsReversed: [...needsReversed],
    frame(f) {
      return layersOf(top, "", frameTime(f, F), f, 0, null);
    },
  };

  /** A level's layers at its time `t` (output frame `f`), bottom first: groups (nested sequences) before what uses them. */
  function layersOf(level: Level, path: string, t: number, f: number, depth: number, hearing: Hearing | null): FrameLayer[] {
    return withSignals(signals, () => withHearing(hearing, () => atFrameRate(level.view.settings.fps, () => levelLayers(level, path, t, f, depth, hearing))));
  }

  function levelLayers(level: Level, path: string, t: number, f: number, depth: number, hearing: Hearing | null): FrameLayer[] {
    const { canvas, camera, layerOptions } = level;
    const groups: FrameLayer[] = [];
    const canvasAffineOf = (clip: Clip) => canvasAffine(clip, canvas, camera, parentAt(level.view, clip, canvas));
    /** A clip's layer, after the earlier frames its simulations need stepped first (as `groups`, which come first). */
    const placed = (shown: Shown | null): PlacedRef | null => {
      const picture = placedNow(shown);
      if (picture && shown && !warming) groups.push(...warmUps(shown, picture));
      return picture;
    };
    /**
     * The frames a clip's simulations need stepped before this one: none when the frame before was drawn
     * (the export draws in order), else from the newest one drawn (or the start, or as far back as they
     * remember). A video's earlier frames aren't decoded again: they step on this frame's picture.
     */
    const warmUps = (shown: Shown, picture: PlacedRef): FrameLayer[] => {
      const sims = (picture.effects ?? []).flatMap((fx) => (fx.simulation ? [fx.simulation] : []));
      if (!sims.length) return [];
      const { frame, fps } = sims[0];
      let from = frame;
      for (const sim of sims) {
        const last = simulated.get(sim.id);
        let start = last === undefined || last > frame ? 0 : last === frame ? frame : last + 1;
        if (sim.memory !== undefined) start = Math.max(start, frame - sim.memory);
        from = Math.min(from, start);
        simulated.set(sim.id, frame);
      }
      const { clip } = shown;
      const pure = clipKind(clip) !== "media";
      const steps: FrameLayer[] = [];
      warming = true;
      try {
        for (let k = Math.max(0, from); k < frame; k++) {
          const time = frameSourceTime(clip, k, fps);
          const step = pure ? placedNow({ ...shown, time }) : { ...picture, effects: byKey({ affine: picture.affine, opacity: 1, effects: effectPasses(clip, time, fps) }).effects, samples: undefined };
          if (step) steps.push({ kind: "advance", picture: step });
        }
      } finally {
        warming = false;
      }
      return steps;
    };
    const placedNow = (shown: Shown | null): PlacedRef | null => {
      if (!shown) return null;
      const { clip, time } = shown;
      if (clipKind(clip) === "solid") {
        const layer = clipLayer(clip, time, canvasAffineOf(clip), layerOptions);
        return layer && { ...byKey(layer), key: "", solid: { color: solidColorAt(clip, time), width: canvas.width, height: canvas.height } };
      }
      if (clipKind(clip) === "shape") {
        // Drawn by the page's 2D canvas, from the same drawing the preview makes.
        const layer = clipLayer(clip, time, canvasAffineOf(clip), layerOptions);
        return layer && { ...byKey(layer), key: "", vector: shapeDrawingAt(clip, time, outputSize(level.view.settings.aspectRatio, "1080p")) };
      }
      if (clipKind(clip) === "text") {
        // Laid out by the tab, drawn by the page's 2D canvas at the size it's shown (like the preview).
        const where = placer(
          clip,
          canvas,
          (s) => {
            const frame = layoutAt(clip, s);
            return placeClip(canvas, frame, motionAt(clip, s), frame);
          },
          camera,
          parentAt(level.view, clip, canvas),
        );
        const layer = clipLayer(clip, time, where, layerOptions);
        const unit = textUnit(canvas, level.view.settings.aspectRatio);
        return layer && { ...byKey(layer), key: "", text: textDrawing(textStyleAt(clip, time), layoutAt(clip, time), unit) };
      }
      const drawn = draw(level, shown);
      if (!drawn) return null;
      const where = placer(clip, canvas, (s) => placeClip(canvas, mediaSize(drawn.asset, canvas), motionAt(clip, s)), camera, parentAt(level.view, clip, canvas));
      if (isNestedClip(clip)) {
        // The sequence it plays, drawn into a picture of its own first.
        const seq = nestedSequence(project, clip);
        const T = innerTime(shown);
        if (!seq || T === null || depth > 16) return null;
        const inner = levelOf(seq.id);
        const key = `g:${path}${clip.id}`;
        groups.push({ kind: "group", key, ...inner.canvas, layers: layersOf(inner, `${path}${clip.id}/`, T, f, depth + 1, nestedHearing(clip, hearing)) });
        const layer = clipLayer(clip, time, where, layerOptions);
        return layer && { ...byKey(layer), key };
      }
      const id = path + drawn.id;
      const runs = runsOf.get(id);
      const layer = clipLayer(clip, time, where, layerOptions);
      if (!layer) return null;
      if (!runs) {
        const key = keys.get(id);
        return key ? { ...byKey(layer), key } : null;
      }
      // Decoded natively: the run this frame is in, and between which two of its frames this moment is.
      const run = runs.find((r) => f >= r.first && f < r.end);
      if (!run) return null;
      const m = mediaAt(shown, drawn.asset);
      const x = ((run.backwards ? run.duration - END_GUARD - m : m) - run.start) * run.fps;
      const blend = !!clip.timeInterpolation;
      // Without time interpolation, the nearest frame (frame sampling).
      const index = Math.max(0, blend ? Math.floor(x + 1e-6) : Math.round(x));
      const interpolate = { key: `${run.key}+`, amount: blend ? Math.min(1, Math.max(0, x - index)) : 0, flow: clip.timeInterpolation === "flow", index };
      return { ...byKey(layer), key: run.key, interpolate };
    };
    /** Each track's layer, bottom first, with how its clip wants a track matte. */
    const layers: { trackId: string; matte: number; layer: FrameLayer }[] = [];
    for (const shot of shotsAt(level, t)) {
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
      level.trackAbove,
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
    const drawnLayers = sortByDepth(matted, (l) => (l.layer.kind === "picture" ? (l.layer.picture as { depth?: number }).depth : undefined)).map((l) => l.layer);
    return [...groups, ...drawnLayers];
  }
}

/** Where a user's shader is used, for an export that can't start: `"Tunnel" on a solid at 3.2 s`. */
function shaderUse(clip: Clip, key: string): string {
  const effect = clip.effects.find((e) => e.type === "shader" && definitionOf(e)?.shader?.key === key);
  const kind = { media: "a clip", text: "a text", solid: "a solid", shape: "a shape layer", adjustment: "an adjustment layer", camera: "a camera", null: "a null object" }[clipKind(clip)];
  return `"${(effect && definitionOf(effect)?.label) ?? "Shader"}" on ${kind} at ${clip.start.toFixed(1)} s`;
}

/** Whether a clip's picture comes from a source (its media): not text, a solid, a shape or an adjustment layer, which the compositor draws. */
const hasPicture = (clip: Clip) => clipKind(clip) === "media" && !isNestedClip(clip);

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

/** A clip's media. */
function renderAssetOf(clip: Clip, assets: Record<string, RenderAsset>): RenderAsset {
  const asset = assets[clip.assetId];
  if (!asset) throw new Error(`Missing media for clip ${clip.id}.`);
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

/** Tags a stream as BT.709, limited range (what the export's pictures are). */
export const BT709 = ["-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv"];

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
 * A natively decoded clip's frames (`RenderSource.native`): `file` (its media, or the media's
 * reversed copy) from file time `start` for `length` seconds, at the media's own frame rate
 * `fps` (so frame i is at start + i / fps), at `size`, as YUV 4:2:0.
 */
function nativeArgs(file: string, fps: number, size: Size, start: number, length: number, opts: RenderOptions): string[] {
  return [
    opts.ffmpegPath ?? "ffmpeg", ...FFMPEG_QUIET,
    "-ss", sec(start), "-t", sec(length), "-i", file,
    "-vf", ["setpts=PTS-STARTPTS", `fps=${fps}`, `scale=${size.width}:${size.height}:out_range=tv`, "format=yuv420p"].join(","),
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
      // A remapped clip's sound, or what a nested sequence plays, goes in stretches of steady speed.
      if (isNestedClip(clip) || isRemapped(clip)) {
        for (const piece of soundPieces(project, assets, clip)) {
          const index = mixInputs.length;
          const at = sampleAt(piece.at);
          const samples = sampleAt(piece.at + piece.duration) - at;
          if (samples <= 0) continue;
          inputs.push("-ss", sec(piece.from), "-t", sec(piece.length), "-i", piece.file);
          const gain = piece.levels
            ? ["asetnsamples=n=64:p=0", `volume=volume='${keyframeExpression(piece.levels, piece.from)}*${piece.gain}':eval=frame`]
            : piece.gain !== 1
              ? [`volume=${piece.gain}`]
              : [];
          const chain = [
            AUDIO_FORMAT,
            "asetpts=PTS-STARTPTS",
            ...gain,
            ...(piece.backwards ? ["areverse"] : []),
            ...tempoFilters(piece.speed, piece.keepPitch),
            `apad=whole_len=${samples}`,
            `atrim=end_sample=${samples}`,
            `adelay=delays=${at}S:all=1`,
          ];
          graph.push(`[${index}:a]${chain.join(",")}[m${index}]`);
          mixInputs.push(`[m${index}]`);
        }
        continue;
      }
      const asset = renderAssetOf(clip, assets);
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

/** A stretch of a file's sound played at one speed (forwards or backwards) from timeline time `at`. */
export interface SoundPiece {
  file: string;
  /** File seconds read: from `from`, `length` long (for a backwards piece, the stretch that's reversed). */
  from: number;
  length: number;
  backwards: boolean;
  /** Timeline seconds it lasts, from `at`. */
  at: number;
  duration: number;
  speed: number;
  keepPitch: boolean;
  /** Its level: the clip's volume keyframes (in file time, forwards pieces of clips at steady speed only) times `gain`. */
  levels?: Keyframe[];
  gain: number;
}

/** How finely a changing speed is followed (timeline seconds), and how far a piece may drift from the curve. */
const SOUND_STEP = 1 / 100;
const SOUND_TOLERANCE = 2e-3;
/** Slower than this (a freeze, nearly), a piece is silent. */
const SILENT_SPEED = 0.05;

/**
 * The sound of a remapped clip, or of everything a nested clip's sequence plays (and the
 * sequences inside it), in stretches of steady speed: the time mapping is followed in
 * steps of `SOUND_STEP` and cut wherever it bends, turns round or stops. Levels multiply
 * down the nesting; muted tracks inside are silent.
 */
export function soundPieces(project: Project, assets: Record<string, RenderAsset>, clip: Clip): SoundPiece[] {
  const pieces: SoundPiece[] = [];
  /** What `c` plays, where `toLocal` maps timeline time to the time of the sequence it's in. */
  const walk = (c: Clip, toLocal: (t: number) => number | null, gain: (t: number) => number, from: number, to: number, depth: number) => {
    /** `c`'s own source time at timeline time t, or null when it isn't playing then. */
    const clockAt = (t: number) => {
      const local = toLocal(t);
      if (local === null || local < c.start - 1e-9 || local >= clipEnd(c) - 1e-9) return null;
      return sourceTime(c, local);
    };
    const level = (t: number) => {
      const s = clockAt(t);
      return s === null ? 0 : gain(t) * volumeAt(c, s);
    };
    if (isNestedClip(c)) {
      const seq = nestedSequence(project, c);
      if (!seq || depth > 16) return;
      const inner = sequenceView(project, seq.id);
      const innerAt = (t: number) => {
        const s = clockAt(t);
        return s === null ? null : mediaTime(c, s);
      };
      for (const track of inner.tracks) {
        if (track.muted) continue;
        for (const x of trackClips(inner, track.id)) if (hasMedia(x)) walk(x, innerAt, level, from, to, depth + 1);
      }
      return;
    }
    const asset = assets[c.assetId];
    if (!asset?.hasAudio) return;
    const last = Math.max(0, asset.duration - END_GUARD);
    const mediaAt = (t: number) => {
      const s = clockAt(t);
      return s === null ? null : Math.min(last, Math.max(0, isRemapped(c) ? mediaTime(c, s) : sourceEdge(c, toLocal(t)!)));
    };
    // Follow the curve, cutting into straight pieces.
    const steps = Math.ceil((to - from) / SOUND_STEP);
    let start: { t: number; m: number } | null = null;
    let prev: { t: number; m: number } | null = null;
    let slope = 0;
    const close = (end: { t: number; m: number }) => {
      if (!start || end.t - start.t < 1e-3) return;
      const duration = end.t - start.t;
      const change = end.m - start.m;
      const speed = Math.abs(change) / duration;
      if (speed < SILENT_SPEED) return;
      const mid = (start.t + end.t) / 2;
      const steady = !isRemapped(c) && change > 0 && gain(mid) > 0;
      const volume = findEffect(c, VOLUME.type);
      const keys = steady && volume?.enabled ? volume.keyframes?.level : undefined;
      pieces.push({
        file: asset.path,
        from: Math.min(start.m, end.m),
        length: Math.abs(change),
        backwards: change < 0,
        at: start.t,
        duration,
        speed: Math.min(100, speed),
        keepPitch: c.keepPitch !== false,
        ...(keys?.length ? { levels: keys, gain: Math.round(gain(mid) * 1e6) / 1e6 } : { gain: Math.round(level(mid) * 1e6) / 1e6 }),
      });
    };
    for (let i = 0; i <= steps; i++) {
      const t = Math.min(to, from + i * SOUND_STEP);
      const m = mediaAt(t);
      if (m === null) {
        if (prev) close(prev);
        start = prev = null;
        continue;
      }
      const here = { t, m };
      if (!start) {
        start = prev = here;
        slope = NaN;
        continue;
      }
      const s = (m - prev!.m) / (t - prev!.t || 1);
      if (Number.isNaN(slope)) slope = s;
      // Still on the line from where this piece started?
      const predicted = start.m + slope * (t - start.t);
      if (Math.abs(predicted - m) > SOUND_TOLERANCE || Math.sign(s) !== Math.sign(slope)) {
        close(prev!);
        start = prev!;
        slope = (m - prev!.m) / (t - prev!.t || 1);
      }
      prev = here;
    }
    if (prev) close(prev);
  };
  walk(clip, (t) => t, () => 1, clip.start, clipEnd(clip), 0);
  return pieces;
}

/** Bytes of one composited frame as the compositor hands it over (YUV 4:2:0, see `readYuv420`). */
/** An output frame's bytes as the page reads it back: YUV 4:2:0 (1.5 a pixel), or RGBA (4). */
export const frameBytes = (plan: Pick<RenderPlan, "width" | "height">, readback: FrameReadback = "yuv420") =>
  readback === "rgba" ? plan.width * plan.height * 4 : (plan.width * plan.height * 3) / 2;

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
