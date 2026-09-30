/**
 * Shape layers: what a shape clip draws at a moment. Its contents (the Shape effects and
 * the operators between them, `effect-library/shape.ts`) are walked in order: a shape
 * adds its path with its fill and stroke, an operator changes every path before it.
 * The result is a `VectorDrawing` the compositor draws with the browser's 2D canvas, in
 * the preview and the export alike, at whatever size the layer is shown.
 *
 * Everything is worked out in px of the layer's frame at 1080p (`frame`), which is the
 * canvas at 100%.
 */
import type { Affine, VectorDrawing, VectorOp, VectorPaint } from "./compositor.ts";
import { MERGE_PATHS, OFFSET_PATHS, REPEATER, ROUND_CORNERS, SHAPE, TRIM_PATHS, WIGGLE_PATHS, ZIG_ZAG } from "./effect-library/shape.ts";
import { effectDefinition, effectValuesAt, hasExpressions } from "./effects.ts";
import {
  type BezierPath,
  type LineJoin,
  type PathAffine,
  type Rect,
  bounds,
  containsPoint,
  distanceToPath,
  ellipsePath,
  polygonShapePath,
  rectPath,
  starPath,
  toSvgPathData,
  transformPath,
} from "./path.ts";
import { type MergeMode, mergePaths, offsetPath, roundCorners, trimPaths, wigglePath, zigZag } from "./shape-ops.ts";
import { timelineTime } from "./timeline.ts";
import type { Size } from "./transform.ts";
import type { Clip, ParamValues, Vec2 } from "./types.ts";

const RAD = Math.PI / 180;

/** How a shape is painted. */
interface Paint {
  fill: { color: string; opacity: number; gradient: "none" | "linear" | "radial"; end: string; angle: number } | null;
  stroke: { color: string; opacity: number; width: number; join: LineJoin; cap: "butt" | "round" | "square"; dash: number[]; dashOffset: number } | null;
}

/** One shape on its way to the drawing: its paths, its paint, and where a repeater put copies of it. */
interface Item {
  paths: BezierPath[];
  paint: Paint;
  copies: { transform: PathAffine; opacity: number }[];
}

const IDENTITY: PathAffine = [1, 0, 0, 1, 0, 0];

/** `a` after `b` (apply `b` first). */
function compose(a: PathAffine, b: PathAffine): PathAffine {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

/** Turned by `degrees` (clockwise, y down) and scaled by `k` around `c`, then moved by `move`. */
function around(c: Vec2, degrees: number, k: number, move: Vec2 = [0, 0]): PathAffine {
  const cos = Math.cos(degrees * RAD) * k;
  const sin = Math.sin(degrees * RAD) * k;
  return [cos, sin, -sin, cos, c[0] - (cos * c[0] - sin * c[1]) + move[0], c[1] - (sin * c[0] + cos * c[1]) + move[1]];
}

function rgba(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Math.round(Math.min(1, Math.max(0, alpha)) * 1000) / 1000})`;
}

/** The box around several paths. */
function boundsOf(paths: readonly BezierPath[]): Rect | undefined {
  let box: Rect | undefined;
  for (const path of paths) {
    const b = bounds(path);
    if (!b) continue;
    if (!box) {
      box = b;
      continue;
    }
    const x = Math.min(box.x, b.x);
    const y = Math.min(box.y, b.y);
    box = { x, y, width: Math.max(box.x + box.width, b.x + b.width) - x, height: Math.max(box.y + box.height, b.y + b.height) - y };
  }
  return box;
}

/** A Shape effect's path, in px of `frame` (see the top of this file). */
export function shapePath(v: ParamValues, frame: Size): BezierPath {
  const kind = v.kind as string;
  const roundness = v.roundness as number;
  if (kind === "path") {
    const path = transformPath(v.path as BezierPath, [frame.width, 0, 0, frame.height, 0, 0]);
    return roundness > 0 ? roundCorners(path, roundness) : path;
  }
  const [px, py] = v.position as Vec2;
  const [cx, cy] = [px * frame.width, py * frame.height];
  const [w, h] = v.size as Vec2;
  const rotation = v.rotation as number;
  let path: BezierPath;
  if (kind === "ellipse") path = ellipsePath(cx, cy, w / 2, h / 2);
  else if (kind === "rectangle") path = rectPath(cx - w / 2, cy - h / 2, w, h, roundness);
  else {
    // Drawn on a circle as wide as the shape, then squashed to its height.
    const r = w / 2;
    const unit = kind === "star" ? starPath(0, 0, v.points as number, r * (v.innerRadius as number), r) : polygonShapePath(0, 0, v.points as number, r);
    const rounded = roundness > 0 ? roundCorners(unit, roundness) : unit;
    path = transformPath(rounded, [1, 0, 0, w > 0 ? h / w : 1, cx, cy]);
  }
  return rotation ? transformPath(path, around([cx, cy], rotation, 1)) : path;
}

function paintOf(v: ParamValues): Paint {
  const width = v.strokeWidth as number;
  const dash = v.dash as number;
  return {
    fill:
      v.fill === true
        ? {
            color: v.fillColor as string,
            opacity: v.fillOpacity as number,
            gradient: v.gradient as "none" | "linear" | "radial",
            end: v.gradientColor as string,
            angle: v.gradientAngle as number,
          }
        : null,
    stroke:
      width > 0
        ? {
            color: v.strokeColor as string,
            opacity: v.strokeOpacity as number,
            width,
            join: v.lineJoin as LineJoin,
            cap: v.lineCap as "butt" | "round" | "square",
            dash: dash > 0 ? [dash, (v.gap as number) > 0 ? (v.gap as number) : dash] : [],
            dashOffset: v.dashOffset as number,
          }
        : null,
  };
}

/** A fill as the compositor paints it: a colour, or a gradient across the shape's box. */
function fillPaint(fill: NonNullable<Paint["fill"]>, box: Rect | undefined): VectorPaint {
  const start = rgba(fill.color, fill.opacity);
  if (fill.gradient === "none" || !box) return start;
  const end = rgba(fill.end, fill.opacity);
  const c: Vec2 = [box.x + box.width / 2, box.y + box.height / 2];
  if (fill.gradient === "radial") {
    return { type: "radial", from: c, to: [c[0] + Math.max(box.width, box.height) / 2, c[1]], stops: [[0, start], [1, end]] };
  }
  // From one side of the box to the other, along the angle (0° runs left to right, 90° top to bottom).
  const dir: Vec2 = [Math.cos(fill.angle * RAD), Math.sin(fill.angle * RAD)];
  const reach = (Math.abs(dir[0]) * box.width + Math.abs(dir[1]) * box.height) / 2;
  return {
    type: "linear",
    from: [c[0] - dir[0] * reach, c[1] - dir[1] * reach],
    to: [c[0] + dir[0] * reach, c[1] + dir[1] * reach],
    stops: [[0, start], [1, end]],
  };
}

/** Every copy's paths as paths of their own (before an operator that works on what's drawn, like Merge Paths). */
function baked(item: Item): BezierPath[] {
  if (item.copies.length === 1 && item.copies[0].transform === IDENTITY) return item.paths;
  return item.copies.flatMap((copy) => item.paths.map((p) => transformPath(p, copy.transform)));
}

/** A shape layer's shapes at source time `time`, after its operators, in px of `frame`. */
function itemsAt(clip: Pick<Clip, "id" | "effects" | "start" | "in" | "out" | "speed" | "reversed">, time: number, frame: Size): Item[] {
  const items: Item[] = [];
  const each = (change: (path: BezierPath) => BezierPath[]) => {
    for (const item of items) item.paths = item.paths.flatMap(change);
  };
  for (const effect of clip.effects) {
    const def = effectDefinition(effect.type);
    if (def?.stackable !== "shape" || !effect.enabled) continue;
    const v = effectValuesAt(def, effect, time, clip);
    if (def === SHAPE) {
      items.push({ paths: [shapePath(v, frame)], paint: paintOf(v), copies: [{ transform: IDENTITY, opacity: 1 }] });
    } else if (def === TRIM_PATHS) {
      for (const item of items) {
        item.paths = trimPaths(item.paths, v.start as number, v.end as number, (v.offset as number) / 360, v.mode as "simultaneously" | "individually");
      }
    } else if (def === OFFSET_PATHS) {
      each((p) => offsetPath(p, v.amount as number, v.lineJoin as LineJoin, v.miterLimit as number));
    } else if (def === ROUND_CORNERS) {
      each((p) => [roundCorners(p, v.radius as number)]);
    } else if (def === ZIG_ZAG) {
      each((p) => [zigZag(p, v.size as number, v.ridges as number, v.points as "corner" | "smooth")]);
    } else if (def === WIGGLE_PATHS) {
      // Seconds since the clip started on the timeline, so it wiggles the same wherever it's trimmed.
      const at = timelineTime(clip as Clip, time) - clip.start;
      let n = 0;
      each((p) => [
        wigglePath(p, {
          size: v.size as number,
          detail: v.detail as number,
          points: v.points as "corner" | "smooth",
          speed: v.speed as number,
          time: at,
          seed: (v.seed as number) * 7919 + n++,
        }),
      ]);
    } else if (def === MERGE_PATHS) {
      if (!items.length) continue;
      // One shape from all of them so far, painted like the first.
      const merged = mergePaths(items.flatMap(baked), v.mode as MergeMode);
      items.splice(0, items.length, { paths: merged, paint: items[0].paint, copies: [{ transform: IDENTITY, opacity: 1 }] });
    } else if (def === REPEATER) {
      const count = Math.max(0, Math.round(v.copies as number));
      const box = boundsOf(items.flatMap(baked));
      const c: Vec2 = box ? [box.x + box.width / 2, box.y + box.height / 2] : [frame.width / 2, frame.height / 2];
      const [dx, dy] = v.position as Vec2;
      const steps = Array.from({ length: count }, (_, i) => {
        const k = i + (v.offset as number);
        const f = count > 1 ? i / (count - 1) : 0;
        return {
          transform: around(c, (v.rotation as number) * k, (v.scale as number) ** k, [dx * k, dy * k]),
          opacity: (v.startOpacity as number) + ((v.endOpacity as number) - (v.startOpacity as number)) * f,
        };
      });
      // "Below": each copy goes under the one before it.
      if (v.composite === "below") steps.reverse();
      for (const item of items) {
        item.copies = steps.flatMap((step) =>
          item.copies.map((copy) => ({ transform: compose(step.transform, copy.transform), opacity: step.opacity * copy.opacity })),
        );
      }
    }
  }
  return items;
}

/**
 * What a shape layer draws at source time `time`, in a space of `frame` px (its frame at
 * 1080p). Shapes are drawn in order, so later ones cover earlier ones.
 */
export function shapeDrawingAt(clip: Clip, time: number, frame: Size): VectorDrawing {
  // Drawn again and again at the same moment (a paused preview, motion blur's samples): kept per clip.
  const key = `${time}|${frame.width}x${frame.height}|${clip.start}|${clip.in}|${clip.speed ?? 1}`;
  const kept = drawings.get(clip.effects);
  if (kept?.key === key) return kept.drawing;
  const drawing = drawShapes(clip, time, frame);
  drawings.set(clip.effects, { key, drawing });
  return drawing;
}

const drawings = new WeakMap<object, { key: string; drawing: VectorDrawing }>();

function drawShapes(clip: Clip, time: number, frame: Size): VectorDrawing {
  const ops: VectorOp[] = [];
  for (const item of itemsAt(clip, time, frame)) {
    const paths = item.paths.filter((p) => p.vertices.length > 1);
    if (!paths.length || (!item.paint.fill && !item.paint.stroke)) continue;
    const d = toSvgPathData(paths);
    const { fill, stroke } = item.paint;
    const box = fill && fill.gradient !== "none" ? boundsOf(paths) : undefined;
    for (const copy of item.copies) {
      if (!(copy.opacity > 0)) continue;
      ops.push({
        d,
        ...(copy.transform !== IDENTITY && { transform: copy.transform.map((n) => Math.round(n * 1e6) / 1e6) as Affine }),
        ...(copy.opacity < 1 && { opacity: copy.opacity }),
        ...(fill && fill.opacity > 0 && { fill: fillPaint(fill, box) }),
        ...(stroke &&
          stroke.opacity > 0 && {
            stroke: rgba(stroke.color, stroke.opacity),
            strokeWidth: stroke.width,
            join: stroke.join,
            cap: stroke.cap,
            ...(stroke.dash.length && { dash: stroke.dash, dashOffset: stroke.dashOffset }),
          }),
      });
    }
  }
  return { width: frame.width, height: frame.height, ops };
}

/** Whether a shape layer draws differently at source times `a` and `b` (something in it is animated, or wiggles). */
export function shapesChange(clip: Clip, a: number, b: number): boolean {
  if (a === b) return false;
  return clip.effects.some((e) => {
    const def = effectDefinition(e.type);
    if (def?.stackable !== "shape" || !e.enabled) return false;
    if (def === WIGGLE_PATHS && (e.params.speed as number) > 0 && (e.params.size as number) > 0) return true;
    return (!!e.keyframes || hasExpressions(e)) && JSON.stringify(effectValuesAt(def, e, a, clip)) !== JSON.stringify(effectValuesAt(def, e, b, clip));
  });
}

/**
 * The box around everything a shape layer draws at source time `time` (strokes included),
 * in px of `frame`: what the Program monitor's handles go around. Undefined when it draws nothing.
 */
export function shapeBounds(clip: Clip, time: number, frame: Size): Rect | undefined {
  let box: Rect | undefined;
  for (const item of itemsAt(clip, time, frame)) {
    const b = boundsOf(baked(item));
    if (!b) continue;
    const pad = (item.paint.stroke?.width ?? 0) / 2;
    const grown = { x: b.x - pad, y: b.y - pad, width: b.width + 2 * pad, height: b.height + 2 * pad };
    if (!box) {
      box = grown;
      continue;
    }
    const x = Math.min(box.x, grown.x);
    const y = Math.min(box.y, grown.y);
    box = { x, y, width: Math.max(box.x + box.width, grown.x + grown.width) - x, height: Math.max(box.y + box.height, grown.y + grown.height) - y };
  }
  return box;
}

/** Whether a point (px of `frame`) is on something a shape layer draws at source time `time`, within `slack` px. */
export function shapeContains(clip: Clip, time: number, frame: Size, point: Vec2, slack = 0): boolean {
  return itemsAt(clip, time, frame).some((item) => {
    const paths = baked(item);
    if (item.paint.fill && containsPoint(paths, point)) return true;
    // An outline (or a shape with no paint at all, which still has to be grabbable) by its line.
    const reach = (item.paint.stroke?.width ?? 0) / 2 + slack;
    return paths.some((p) => (distanceToPath(p, point)?.distance ?? Infinity) <= Math.max(reach, slack));
  });
}
