/**
 * Paths on the Program monitor, like After Effects' masks and shape paths: the selected
 * clip's paths show as outlines; the one being edited shows its vertices and the Bézier
 * handles of the selected ones. With the Selection tool, drag vertices, handles or a
 * segment; ⌥-click a vertex to turn it from a corner into a smooth point and back. The
 * Pen tool draws a new path click by click (drag to pull handles out, click the first
 * point to close it, Enter or Esc to stop), adds a vertex where it clicks an outline, and
 * converts a vertex it clicks. The Rectangle and Ellipse tools drag one out.
 *
 * What a new path is depends on what's selected, as in After Effects: a mask on the
 * selected clip, a shape on the selected shape layer, or with nothing selected a new
 * shape layer.
 */
import type { PointerEvent as ReactPointerEvent } from "react";
import { MASK, SHAPE, addEffect, effectDefinition, isShapeClip, storedValuesAt } from "@shared/effects";
import { roundTime } from "@shared/math";
import { isPath } from "@shared/params";
import {
  type BezierPath,
  ellipsePath,
  insertVertex,
  moveVertices,
  rectPath,
  setHandle,
  toSvgPathData,
  toggleSmooth,
} from "@shared/path";
import { addLayerClip, newLayerClip } from "@shared/timeline";
import type { Size } from "@shared/transform";
import type { Clip, ParamValues, Project, Vec2 } from "@shared/types";
import { EditGesture } from "@/lib/edit-gesture";
import { cancelActiveDrag, startPointerDrag } from "@/lib/pointer-drag";
import { useEditor } from "@/stores/editor";
import { type CanvasTool, useLayout } from "@/stores/layout";
import { type PathTarget, sameTarget, usePathEditing, writePath } from "@/stores/path-editing";
import { usePlayback } from "@/stores/playback";
import { newLayerDuration } from "@/stores/video-preferences";
import { canvasToFrame, dragBox, hitPath, pathOnCanvas } from "./path-geometry";
import type { OnCanvas } from "./placement";
import { showPanel } from "@/stores/video-dock";

/** How near (px) the pointer must be to a vertex, a handle or an outline. */
const HIT_PX = 7;
const DRAG_PX = 3;

/** A clip's paths that can be edited on the monitor, with what each holds at source time `time`. */
export function clipPaths(clip: Clip, time: number): { target: PathTarget; path: BezierPath }[] {
  const out: { target: PathTarget; path: BezierPath }[] = [];
  for (const effect of clip.effects) {
    const def = effectDefinition(effect.type);
    if (!def) continue;
    const values = storedValuesAt(def, effect, time);
    for (const spec of def.params) {
      if (spec.kind !== "path" || spec.hiddenFor?.(values)) continue;
      const path = values[spec.key];
      if (isPath(path)) out.push({ target: { clipId: clip.id, effectId: effect.id, key: spec.key }, path });
    }
  }
  return out;
}

/** The selected clip's paths on the canvas: outlines, and the edited one's vertices and handles. */
export function PathLayer({ shown }: { shown: OnCanvas }) {
  const target = usePathEditing((s) => s.target);
  const selected = usePathEditing((s) => s.selected);
  const drawing = usePathEditing((s) => s.drawing);
  const paths = clipPaths(shown.clip, shown.time);
  if (!paths.length) return null;
  return (
    <g data-path-layer>
      {paths.map(({ target: t, path }) => {
        const onCanvas = pathOnCanvas(path, shown.placement);
        const editing = sameTarget(t, target);
        // A path still being drawn isn't closed yet, whatever it fills like.
        const d = toSvgPathData(onCanvas);
        return (
          <g key={`${t.effectId}:${t.key}`} data-path={t.effectId} data-editing={editing || undefined}>
            <path d={d} className="fill-none stroke-black/50" strokeWidth={3} />
            <path d={d} className={editing ? "fill-none stroke-brand" : "fill-none stroke-brand/70"} strokeWidth={1.5} strokeDasharray={editing ? undefined : "5 3"} />
            {editing &&
              onCanvas.vertices.map((v, i) => {
                if (!selected.includes(i)) return null;
                return (["in", "out"] as const).map((side) => {
                  const h = v[side];
                  if (!h[0] && !h[1]) return null;
                  const [x, y] = [v.point[0] + h[0], v.point[1] + h[1]];
                  return (
                    <g key={`${i}${side}`} data-path-handle={side}>
                      <line x1={v.point[0]} y1={v.point[1]} x2={x} y2={y} className="stroke-brand" strokeWidth={1} />
                      <circle cx={x} cy={y} r={3.5} className="fill-white stroke-brand" strokeWidth={1.5} />
                    </g>
                  );
                });
              })}
            {editing &&
              onCanvas.vertices.map((v, i) => (
                <rect
                  key={i}
                  data-path-vertex={i}
                  data-selected={selected.includes(i) || undefined}
                  x={v.point[0] - 3.5}
                  y={v.point[1] - 3.5}
                  width={7}
                  height={7}
                  className={selected.includes(i) ? "fill-brand stroke-white" : "fill-white stroke-brand"}
                  strokeWidth={1.5}
                />
              ))}
            {/* Where a click closes the path being drawn. */}
            {editing && drawing && onCanvas.vertices.length > 2 && (
              <circle cx={onCanvas.vertices[0].point[0]} cy={onCanvas.vertices[0].point[1]} r={7} className="fill-none stroke-brand" strokeWidth={1} />
            )}
          </g>
        );
      })}
    </g>
  );
}

interface PressContext {
  pointAt: (e: { clientX: number; clientY: number }) => Vec2;
  canvas: Size;
  tool: CanvasTool;
  /** The selected clip on the canvas, when it's flat (a 3D layer's paths aren't edited here). */
  selected: OnCanvas | undefined;
}

const editor = () => useEditor.getState();
const playhead = () => usePlayback.getState().time;

/** Dragging something of the path being edited: one undo step, every move worked out from the path at the press. */
function dragPath(e: ReactPointerEvent, target: PathTarget, change: (delta: Vec2, ev: PointerEvent) => BezierPath, ctx: PressContext, shown: OnCanvas, onClick?: () => void) {
  const from = canvasToFrame(shown.placement, ctx.pointAt(e));
  if (!from) return;
  const gesture = new EditGesture();
  startPointerDrag(e, {
    threshold: DRAG_PX,
    cursor: "default",
    onStart: () => gesture.begin(),
    onMove(ev) {
      if (!gesture.active) return cancelActiveDrag();
      const to = canvasToFrame(shown.placement, ctx.pointAt(ev));
      if (to) gesture.apply(writePath(target, change([to[0] - from[0], to[1] - from[1]], ev)));
    },
    onEnd: () => gesture.end(),
    onCancel: () => gesture.cancel(),
    onClick,
  });
}

/**
 * A press on the monitor while a path is being edited or a path tool is on. True when it
 * was the path's (the clip under it is then left alone).
 */
export function pressPath(e: ReactPointerEvent, ctx: PressContext): boolean {
  const { tool, selected: shown } = ctx;
  const state = usePathEditing.getState();
  const pt = ctx.pointAt(e);
  if (tool === "rectangle" || tool === "ellipse") {
    dragShape(e, ctx, tool);
    return true;
  }
  usePlayback.getState().pause();

  // The path being edited, when its clip is the one selected.
  const current = shown && state.target?.clipId === shown.clip.id ? clipPaths(shown.clip, shown.time).find((p) => sameTarget(p.target, state.target)) : undefined;
  if (shown && current) {
    const { target, path } = current;
    const onCanvas = pathOnCanvas(path, shown.placement);
    if (state.drawing && tool === "pen") {
      const hit = hitPath(onCanvas, pt, [], HIT_PX);
      if (hit?.kind === "vertex" && hit.index === 0 && path.vertices.length > 2) {
        editor().commit(writePath(target, { ...path, closed: true }));
        usePathEditing.getState().edit(target, { selected: [0] });
        return true;
      }
      addVertex(e, ctx, shown, target, path);
      return true;
    }
    const hit = hitPath(onCanvas, pt, state.selected, HIT_PX);
    if (hit?.kind === "handle") {
      const v = path.vertices[hit.index];
      const start = v[hit.side];
      // ⌥ breaks the handles apart (a cusp); otherwise the other one stays opposite.
      dragPath(e, target, (d, ev) => setHandle(path, hit.index, hit.side, [start[0] + d[0], start[1] + d[1]], !ev.altKey), ctx, shown);
      return true;
    }
    if (hit?.kind === "vertex") {
      if (tool === "pen" || e.altKey) {
        editor().commit(writePath(target, toggleSmooth(path, hit.index)));
        usePathEditing.getState().select([hit.index]);
        return true;
      }
      const already = state.selected.includes(hit.index);
      const moving = e.shiftKey
        ? already
          ? state.selected.filter((i) => i !== hit.index)
          : [...state.selected, hit.index]
        : already
          ? state.selected
          : [hit.index];
      usePathEditing.getState().select(moving);
      if (moving.includes(hit.index)) dragPath(e, target, (d) => moveVertices(path, moving, d), ctx, shown, () => !e.shiftKey && usePathEditing.getState().select([hit.index]));
      return true;
    }
    if (hit?.kind === "segment") {
      if (tool === "pen") {
        editor().commit(writePath(target, insertVertex(path, hit.segmentIndex, hit.t)));
        usePathEditing.getState().select([hit.segmentIndex + 1]);
        return true;
      }
      // The segment's two ends move together.
      const ends = [hit.segmentIndex, (hit.segmentIndex + 1) % path.vertices.length];
      usePathEditing.getState().select(ends);
      dragPath(e, target, (d) => moveVertices(path, ends, d), ctx, shown);
      return true;
    }
  }

  if (tool === "pen") {
    startPath(e, ctx);
    return true;
  }
  // The Selection tool on another of the clip's paths: edit that one.
  if (shown) {
    for (const { target, path } of clipPaths(shown.clip, shown.time)) {
      if (sameTarget(target, state.target)) continue;
      if (hitPath(pathOnCanvas(path, shown.placement), pt, [], HIT_PX)) {
        usePathEditing.getState().edit(target);
        showPanel("properties");
        return true;
      }
    }
  }
  // Anywhere else: done with the path.
  if (state.target) usePathEditing.getState().edit(null);
  return false;
}

/** The pen adds a vertex to the end of the path it's drawing; dragging pulls its handles out. */
function addVertex(e: ReactPointerEvent, ctx: PressContext, shown: OnCanvas, target: PathTarget, path: BezierPath) {
  const at = canvasToFrame(shown.placement, ctx.pointAt(e));
  if (!at) return;
  const index = path.vertices.length;
  const withVertex = (out: Vec2): BezierPath => ({
    vertices: [...path.vertices, { point: at, in: [-out[0], -out[1]], out }],
    closed: false,
  });
  usePathEditing.getState().edit(target, { drawing: true, selected: [index] });
  const gesture = new EditGesture();
  startPointerDrag(e, {
    threshold: DRAG_PX,
    cursor: "crosshair",
    onStart: () => gesture.begin(),
    onMove(ev) {
      if (!gesture.active) return cancelActiveDrag();
      const to = canvasToFrame(shown.placement, ctx.pointAt(ev));
      if (to) gesture.apply(writePath(target, withVertex([to[0] - at[0], to[1] - at[1]])));
    },
    onEnd: () => gesture.end(),
    onCancel: () => gesture.cancel(),
    onClick: () => editor().commit(writePath(target, withVertex([0, 0]))),
  });
}

/**
 * What a new path goes on (see the top of this file): an edit that makes it from its first
 * values, and where it's measured (the clip it's on; none for a new layer, whose frame is
 * the canvas).
 */
function newPathOn(ctx: PressContext): { shown: OnCanvas | undefined; make: (params: ParamValues, mask: ParamValues) => { edit: (p: Project) => Project; target: () => PathTarget | null } } {
  const shown = ctx.selected;
  if (shown) {
    const type = isShapeClip(shown.clip) ? SHAPE.type : MASK.type;
    return {
      shown,
      make(params, mask) {
        let effectId: string | null = null;
        return {
          edit(p) {
            const made = addEffect(p, [shown.clip.id], type, type === MASK.type ? mask : params);
            effectId = made.added.get(shown.clip.id) ?? null;
            return made.project;
          },
          target: () => (effectId ? { clipId: shown.clip.id, effectId, key: "path" } : null),
        };
      },
    };
  }
  return {
    shown: undefined,
    make(params) {
      const clip = newLayerClip("shape", roundTime(playhead()), newLayerDuration(), params);
      return {
        edit: (p) => addLayerClip(p, clip).project,
        target: () => ({ clipId: clip.id, effectId: SHAPE.type, key: "path" }),
      };
    },
  };
}

/** A canvas point as fractions of the frame a new path is measured in. */
function toNewFrame(shown: OnCanvas | undefined, canvas: Size, pt: Vec2): Vec2 | null {
  return shown ? canvasToFrame(shown.placement, pt) : [pt[0] / canvas.width, pt[1] / canvas.height];
}

/** The pen starts a path with its first click. */
function startPath(e: ReactPointerEvent, ctx: PressContext) {
  const { shown, make } = newPathOn(ctx);
  const at = toNewFrame(shown, ctx.canvas, ctx.pointAt(e));
  if (!at) return;
  const path: BezierPath = { vertices: [{ point: at, in: [0, 0], out: [0, 0] }], closed: false };
  const made = make({ kind: "path", path }, { path });
  editor().commit(made.edit);
  const target = made.target();
  if (!target) return;
  if (!shown) editor().select(target.clipId);
  showPanel("properties");
  usePathEditing.getState().edit(target, { drawing: true, selected: [0] });
}

/** The Rectangle and Ellipse tools: drag one out (⇧ keeps it square). A press without a drag does nothing. */
function dragShape(e: ReactPointerEvent, ctx: PressContext, kind: "rectangle" | "ellipse") {
  const { shown, make } = newPathOn(ctx);
  const from = toNewFrame(shown, ctx.canvas, ctx.pointAt(e));
  if (!from) return;
  usePlayback.getState().pause();
  // The frame's size in canvas px, so ⇧ makes a square on screen rather than in fractions.
  const frame = shown ? { width: shown.placement.width, height: shown.placement.height } : ctx.canvas;
  const reference = shown?.shape?.reference;
  const gesture = new EditGesture();
  let made: ReturnType<typeof make> | null = null;
  const values = (ev: PointerEvent): { params: ParamValues; mask: ParamValues } | null => {
    const to = toNewFrame(shown, ctx.canvas, ctx.pointAt(ev));
    if (!to) return null;
    const px = dragBox([from[0] * frame.width, from[1] * frame.height], [to[0] * frame.width, to[1] * frame.height], ev.shiftKey);
    const box = { x: px.x / frame.width, y: px.y / frame.height, width: px.width / frame.width, height: px.height / frame.height };
    const path = kind === "ellipse" ? ellipsePath(box.x + box.width / 2, box.y + box.height / 2, box.width / 2, box.height / 2) : rectPath(box.x, box.y, box.width, box.height);
    // A shape's size is px of its layer's frame at 1080p.
    const ref = reference ?? { width: (1080 * frame.width) / Math.min(frame.width, frame.height), height: (1080 * frame.height) / Math.min(frame.width, frame.height) };
    return {
      mask: { path },
      params: { kind, position: [box.x + box.width / 2, box.y + box.height / 2], size: [box.width * ref.width, box.height * ref.height] },
    };
  };
  startPointerDrag(e, {
    threshold: DRAG_PX,
    cursor: "crosshair",
    onStart: () => gesture.begin(),
    onMove(ev) {
      if (!gesture.active) return cancelActiveDrag();
      const v = values(ev);
      if (!v) return;
      const next = (made = make(v.params, v.mask));
      // From how things were at the press, not from the last move's shape.
      gesture.apply((p) => next.edit(editor().gestureBase ?? p));
    },
    onEnd() {
      gesture.end();
      const target = made?.target();
      if (!target) return;
      if (!shown) editor().select(target.clipId);
      showPanel("properties");
      useLayout.getState().setTool("select");
      // A mask shows its path; a shape is a rectangle or an ellipse, with handles of its own.
      if (shown && !isShapeClip(shown.clip)) usePathEditing.getState().edit(target);
    },
    onCancel: () => gesture.cancel(),
  });
}
