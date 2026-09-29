/**
 * Direct manipulation on the canvas, like Premiere's Program Monitor: click a
 * clip to select it, drag it to move, drag a handle to scale (around the
 * anchor point; Shift stretches), drag just outside a corner to rotate, drag
 * the anchor point to move it without moving the picture. Every drag is one
 * undo step. With the Type tool, a click adds a text there; double-clicking
 * a text types into it. Pinching on a trackpad (or ⌃/⌘-scrolling) over the
 * monitor scales the selected clip, or the one under the pointer.
 */
import { type RefObject, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { Clip, ParamValue, ParamValues, Vec2 } from "@shared/types";
import { keyframeTime } from "@shared/animation";
import { keyframeValue } from "@shared/keyframes";
import { MOTION, findEffect, isTextClip, setParams, textStyleAt } from "@shared/effects";
import {
  type Placement,
  type Size,
  anchorAt,
  angleAround,
  cssMatrix,
  frameCorners,
  scaleFromHandle,
  toCanvas,
  wrapDegrees,
} from "@shared/transform";
import { dragKind, getEffectDragData } from "@/lib/dnd";
import { EditGesture } from "@/lib/edit-gesture";
import { cancelActiveDrag, startPointerDrag } from "@/lib/pointer-drag";
import { cn } from "cn";
import { useEditor } from "@/stores/editor";
import { useFonts } from "@/stores/fonts";
import { useLayout } from "@/stores/layout";
import { usePlayback } from "@/stores/playback";
import { createText, editText, finishTextEditing, typeText, useTextEditing } from "@/stores/text-editing";
import { DRAG_THRESHOLD_PX } from "@/components/timeline/constants";
import { type OnCanvas, clipAtPoint, clipsOnCanvas, snapMove } from "./placement";

type Mode =
  | { kind: "move" }
  | { kind: "scale"; handle: Vec2 }
  | { kind: "rotate" }
  | { kind: "anchor" };

const SNAP_PX = 6;
const ROTATE_STEP = 15;
/** How fast a pinch scales (per pixel of wheel delta), and when it counts as finished. */
const PINCH_RATE = 0.01;
const PINCH_IDLE_MS = 300;
const MIN_SCALE = 0.01;

/** Handles as fractions of the frame: corners, then edge midpoints. */
const HANDLES: Vec2[] = [
  [0, 0], [1, 0], [1, 1], [0, 1],
  [0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5],
];

const ROTATE_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'>" +
    "<g fill='none' stroke-linecap='round' stroke-linejoin='round'>" +
    "<path d='M18 13.5A6.5 6.5 0 1 1 15.6 7.2M15.8 3.2l.2 4.3-4.3.3' stroke='white' stroke-width='4'/>" +
    "<path d='M18 13.5A6.5 6.5 0 1 1 15.6 7.2M15.8 3.2l.2 4.3-4.3.3' stroke='black' stroke-width='1.75'/>" +
    "</g></svg>",
)}") 12 12, alias`;

const RESIZE_CURSORS = ["ew-resize", "nwse-resize", "ns-resize", "nesw-resize"];

/** The resize cursor pointing from the frame's centre towards a handle. */
function resizeCursor(p: Placement, handle: Vec2): string {
  const [cx, cy] = toCanvas(p, [p.width / 2, p.height / 2]);
  const [hx, hy] = toCanvas(p, [handle[0] * p.width, handle[1] * p.height]);
  const angle = ((Math.atan2(hy - cy, hx - cx) * 180) / Math.PI + 180) % 180;
  return RESIZE_CURSORS[Math.round(angle / 45) % 4];
}

export function TransformOverlay({ canvas, area }: { canvas: Size; area: RefObject<HTMLElement | null> }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const time = usePlayback((s) => s.time);
  const project = useEditor((s) => s.project);
  const assets = useEditor((s) => s.assets);
  const selectedId = useEditor((s) => s.selectedClipIds.at(-1) ?? null);
  const tool = useLayout((s) => s.tool);
  const editingId = useTextEditing((s) => s.clipId);
  // Knowing the installed fonts can change how texts are laid out.
  const fonts = useFonts((s) => s.status);
  const [guides, setGuides] = useState<{ x: number | null; y: number | null }>({ x: null, y: null });
  const [dragging, setDragging] = useState(false);
  // The clip a video effect being dragged over the canvas would be added to.
  const [effectDropId, setEffectDropId] = useState<string | null>(null);
  useEffect(() => {
    const reset = () => setEffectDropId(null);
    window.addEventListener("dragend", reset);
    return () => window.removeEventListener("dragend", reset);
  }, []);

  const onCanvas = useMemo(
    () => clipsOnCanvas(project, assets, canvas, time),
    [project, assets, canvas, time, fonts], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const selected = onCanvas.find((c) => c.clip.id === selectedId);
  const editing = onCanvas.find((c) => c.clip.id === editingId);

  // Stop typing once the text is no longer on the canvas (the playhead moved off it, it was deleted...).
  const editingGone = !!editingId && !editing;
  useEffect(() => {
    if (editingGone) finishTextEditing();
  }, [editingGone]);

  const pointAt = (e: { clientX: number; clientY: number }): Vec2 => {
    const r = rootRef.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  // A drag of this overlay's must not outlive it (its gesture would stay open).
  const ownsDrag = useRef(false);
  useEffect(
    () => () => {
      if (ownsDrag.current) cancelActiveDrag();
    },
    [],
  );

  const startDrag = (e: ReactPointerEvent, target: OnCanvas, mode: Mode, cursor: string) => {
    e.stopPropagation();
    e.preventDefault();
    usePlayback.getState().pause();
    // Working on a clip on the canvas: show its properties.
    useLayout.getState().setLeftPanel("properties");
    const { clip, placement: p0 } = target;
    // An animated value is keyframed at the frame under the playhead (or a keyframe right next to it).
    const editTime = keyframeTime(clip, usePlayback.getState().time, useEditor.getState().project.settings.fps);
    const start = pointAt(e);
    const uniform = findEffect(clip, MOTION.type)?.params.uniformScale !== false;
    const gesture = new EditGesture();
    let prevAngle = angleAround([p0.x, p0.y], start);
    let turned = 0;

    const onMove = (ev: PointerEvent) => {
      // Another edit ended the gesture (e.g. an upload landed); stop here.
      if (!gesture.active) return cancelActiveDrag();
      const pt = pointAt(ev);
      let patch: ParamValues;
      let nextGuides = { x: null as number | null, y: null as number | null };
      switch (mode.kind) {
        case "move": {
          let delta: Vec2 = [pt[0] - start[0], pt[1] - start[1]];
          if (ev.shiftKey) delta = Math.abs(delta[0]) > Math.abs(delta[1]) ? [delta[0], 0] : [0, delta[1]];
          if (useEditor.getState().snapping && !ev.altKey) {
            const snapped = snapMove(p0, delta, canvas, SNAP_PX);
            // Shift keeps the constrained axis where it is.
            delta = ev.shiftKey ? [delta[0] && snapped.delta[0], delta[1] && snapped.delta[1]] : snapped.delta;
            nextGuides = {
              x: delta[0] === snapped.delta[0] ? snapped.guides.x : null,
              y: delta[1] === snapped.delta[1] ? snapped.guides.y : null,
            };
          }
          patch = { position: [(p0.x + delta[0]) / canvas.width, (p0.y + delta[1]) / canvas.height] };
          break;
        }
        case "scale": {
          // Shift flips the clip's Uniform Scale for this drag: a uniform clip
          // stretches freely (turning Uniform Scale off), a stretched one keeps its proportions.
          const proportional = uniform !== ev.shiftKey;
          const s = scaleFromHandle(p0, mode.handle, pt, proportional);
          patch = uniform && proportional
            ? { uniformScale: true, scale: s.scaleY }
            : { uniformScale: false, scale: s.scaleY, scaleWidth: s.scaleX };
          break;
        }
        case "rotate": {
          const angle = angleAround([p0.x, p0.y], pt);
          turned += wrapDegrees(angle - prevAngle);
          prevAngle = angle;
          const rotation = p0.rotation + turned;
          patch = { rotation: ev.shiftKey ? Math.round(rotation / ROTATE_STEP) * ROTATE_STEP : rotation };
          break;
        }
        case "anchor": {
          const moved = anchorAt(p0, canvas, pt);
          if (!moved) return;
          patch = moved;
          break;
        }
      }
      gesture.apply((p) => setParams(p, clip.id, MOTION.type, patch, editTime));
      setGuides(nextGuides);
    };

    const finish = () => {
      ownsDrag.current = false;
      setGuides({ x: null, y: null });
      setDragging(false);
    };
    ownsDrag.current = startPointerDrag(e, {
      threshold: DRAG_THRESHOLD_PX,
      cursor,
      onStart() {
        gesture.begin();
        setDragging(true);
      },
      onMove,
      onEnd() {
        finish();
        gesture.end();
      },
      onCancel() {
        finish();
        gesture.cancel();
      },
    });
  };

  // A press on the canvas: drag the selected clip when it's under the pointer,
  // else select (and drag) the topmost clip there, else clear the selection.
  // With the Type tool: type into the text there, or add one.
  const onCanvasPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    finishTextEditing();
    if (useEditor.getState().gestureBase) return;
    e.stopPropagation();
    const pt = pointAt(e);
    const inSelected = selected && clipAtPoint([selected], pt);
    const target = inSelected ?? clipAtPoint(onCanvas, pt);
    if (tool === "text") {
      if (target && isTextClip(target.clip)) editText(target.clip.id);
      else createText([pt[0] / canvas.width, pt[1] / canvas.height]);
      return;
    }
    if (!target) {
      useEditor.getState().select(null);
      return;
    }
    if (target !== selected) useEditor.getState().select(target.clip.id);
    startDrag(e, target, { kind: "move" }, "move");
  };

  // Pinch to scale (browsers send a pinch as a wheel event with ctrlKey). One pinch is one undo step.
  const pinchState = useRef({ onCanvas, selected, canvas, tool });
  pinchState.current = { onCanvas, selected, canvas, tool };
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    let pinch: { gesture: EditGesture; clipId: string; scale: number; scaleWidth: number; factor: number; time: number; timer?: ReturnType<typeof setTimeout> } | null = null;
    const finish = () => {
      pinch?.gesture.end();
      pinch = null;
    };
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      // Never the page zoom over the monitor.
      e.preventDefault();
      const { onCanvas: clips, selected: current, tool: activeTool } = pinchState.current;
      if (activeTool !== "select" || (!pinch && useEditor.getState().gestureBase)) return;
      if (pinch && !pinch.gesture.active) pinch = null;
      if (!pinch) {
        const r = rootRef.current?.getBoundingClientRect();
        const under = r ? clipAtPoint(clips, [e.clientX - r.left, e.clientY - r.top]) : undefined;
        const target = current ?? under;
        if (!target) return;
        if (target !== current) useEditor.getState().select(target.clip.id);
        usePlayback.getState().pause();
        const t = target.time;
        const motion = findEffect(target.clip, MOTION.type);
        const at = (key: string) => {
          const keys = motion?.keyframes?.[key];
          return (keys?.length ? keyframeValue(keys, t) : motion?.params[key]) as number;
        };
        const gesture = new EditGesture();
        gesture.begin();
        const editTime = keyframeTime(target.clip, usePlayback.getState().time, useEditor.getState().project.settings.fps);
        pinch = { gesture, clipId: target.clip.id, scale: at("scale") ?? 1, scaleWidth: at("scaleWidth") ?? 1, factor: 1, time: editTime };
      }
      const p = pinch;
      // Scrolling with a mouse wheel moves in bigger steps than a trackpad's pinch.
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      p.factor *= Math.exp(-delta * PINCH_RATE);
      const scale = Math.max(MIN_SCALE, p.scale * p.factor);
      const scaleWidth = Math.max(MIN_SCALE, p.scaleWidth * p.factor);
      p.gesture.apply((proj) => setParams(proj, p.clipId, MOTION.type, { scale, scaleWidth }, p.time));
      clearTimeout(p.timer);
      p.timer = setTimeout(finish, PINCH_IDLE_MS);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      if (pinch) {
        clearTimeout(pinch.timer);
        finish();
      }
    };
  }, [area]);

  const onDoubleClick = (e: ReactMouseEvent) => {
    const target = clipAtPoint(onCanvas, pointAt(e));
    if (target && isTextClip(target.clip)) editText(target.clip.id);
  };

  // A video effect dropped on the canvas goes on the clip under the pointer
  // (or on every selected clip, when it's one of them).
  const onDragOver = (e: DragEvent) => {
    if (dragKind(e.dataTransfer) !== "effect") return;
    e.preventDefault();
    const target = clipAtPoint(onCanvas, pointAt(e));
    e.dataTransfer.dropEffect = target ? "copy" : "none";
    setEffectDropId(target?.clip.id ?? null);
  };
  const onDrop = (e: DragEvent) => {
    setEffectDropId(null);
    const type = getEffectDragData(e.dataTransfer);
    const target = type && clipAtPoint(onCanvas, pointAt(e));
    if (!type || !target) return;
    e.preventDefault();
    const selectedIds = useEditor.getState().selectedClipIds;
    const id = target.clip.id;
    useEditor.getState().addEffectTo(selectedIds.includes(id) ? selectedIds : [id], type);
  };
  const effectDrop = effectDropId ? onCanvas.find((c) => c.clip.id === effectDropId) : undefined;

  if (!(canvas.width > 0 && canvas.height > 0)) return null;
  const p = selected?.placement;
  const corners = p ? frameCorners(p) : null;
  // No handles while typing: the text box is being edited, not transformed.
  const handles = selected && selected !== editing;

  return (
    <div
      ref={rootRef}
      data-slot="transform-overlay"
      className={cn("absolute inset-0 z-10", tool === "text" && "cursor-text")}
      onPointerDown={onCanvasPointerDown}
      onDoubleClick={onDoubleClick}
      onDragOver={onDragOver}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setEffectDropId(null);
      }}
      onDrop={onDrop}
    >
      {editing?.text && <TextEditor target={editing} />}
      <svg className="pointer-events-none absolute inset-0 size-full overflow-visible" aria-hidden>
        {guides.x !== null && (
          <line x1={guides.x} x2={guides.x} y1={0} y2={canvas.height} className="stroke-playhead" strokeWidth={1} />
        )}
        {guides.y !== null && (
          <line y1={guides.y} y2={guides.y} x1={0} x2={canvas.width} className="stroke-playhead" strokeWidth={1} />
        )}
        {selected && !editing && <MotionPath clip={selected.clip} canvas={canvas} />}
        {effectDrop && (
          <polygon
            points={frameCorners(effectDrop.placement).map((c) => c.join(",")).join(" ")}
            className="fill-brand/15 stroke-brand"
            strokeWidth={2}
          />
        )}
        {editing && (
          <polygon
            points={frameCorners(editing.placement).map((c) => c.join(",")).join(" ")}
            className="fill-none stroke-brand"
            strokeWidth={1}
            strokeDasharray="4 3"
          />
        )}
        {handles && p && corners && (
          <>
            {/* Rotate zones just outside the corners (the frame itself, drawn over them, moves). */}
            {!dragging &&
              corners.map(([x, y], i) => (
                <circle
                  key={`r${i}`}
                  data-handle="rotate"
                  cx={x}
                  cy={y}
                  r={18}
                  className="pointer-events-auto fill-transparent"
                  style={{ cursor: ROTATE_CURSOR }}
                  onPointerDown={(e) => e.button === 0 && startDrag(e, selected, { kind: "rotate" }, ROTATE_CURSOR)}
                />
              ))}
            <polygon
              points={corners.map((c) => c.join(",")).join(" ")}
              className="pointer-events-auto cursor-move fill-transparent stroke-black/40"
              strokeWidth={3}
              onPointerDown={(e) => e.button === 0 && startDrag(e, selected, { kind: "move" }, "move")}
            />
            <polygon points={corners.map((c) => c.join(",")).join(" ")} className="fill-none stroke-brand" strokeWidth={1.5} />
            {HANDLES.map((h) => {
              const [x, y] = toCanvas(p, [h[0] * p.width, h[1] * p.height]);
              const cursor = resizeCursor(p, h);
              return (
                <rect
                  key={h.join()}
                  data-handle={h.join()}
                  x={x - 4}
                  y={y - 4}
                  width={8}
                  height={8}
                  className="pointer-events-auto fill-white stroke-brand"
                  strokeWidth={1.5}
                  style={{ cursor }}
                  onPointerDown={(e) => e.button === 0 && startDrag(e, selected, { kind: "scale", handle: h }, cursor)}
                />
              );
            })}
            <g
              className="pointer-events-auto cursor-crosshair"
              data-handle="anchor"
              onPointerDown={(e) => e.button === 0 && startDrag(e, selected, { kind: "anchor" }, "crosshair")}
            >
              <circle cx={p.x} cy={p.y} r={6.5} className="fill-transparent" />
              <circle cx={p.x} cy={p.y} r={5} className="fill-none stroke-black/50" strokeWidth={3} />
              <circle cx={p.x} cy={p.y} r={5} className="fill-none stroke-white" strokeWidth={1.5} />
              <path d={`M${p.x - 8} ${p.y}h16M${p.x} ${p.y - 8}v16`} className="stroke-white" strokeWidth={1} />
            </g>
          </>
        )}
      </svg>
    </div>
  );
}

/**
 * Typing into a text on the canvas: a <textarea> laid out exactly like the
 * drawn text and transformed with it. Its own letters are invisible (the
 * preview draws the real ones underneath), so only the caret and the
 * selection show.
 */
function TextEditor({ target }: { target: OnCanvas }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const layout = target.text!;
  const style = textStyleAt(target.clip, target.time);

  useEffect(() => {
    // After the click that started editing has finished moving the focus.
    const id = setTimeout(() => {
      ref.current?.focus();
      ref.current?.select();
    });
    return () => clearTimeout(id);
  }, []);
  // The box grows with the text, but a textarea scrolls its content while it's briefly too small.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && (el.scrollLeft || el.scrollTop)) el.scrollLeft = el.scrollTop = 0;
  });

  return (
    <textarea
      ref={ref}
      aria-label="Text on canvas"
      value={style.text}
      spellCheck={false}
      wrap="off"
      onChange={(e) => typeText(e.target.value)}
      onBlur={() => finishTextEditing()}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) {
          e.preventDefault();
          e.stopPropagation();
          finishTextEditing();
        }
      }}
      className="absolute top-0 left-0 m-0 origin-top-left resize-none overflow-hidden border-0 bg-transparent whitespace-pre text-transparent outline-none selection:bg-brand/40"
      style={{
        // `font` resets the other font properties, so it goes first.
        font: layout.font,
        fontStretch: layout.stretch,
        lineHeight: `${layout.lineHeight}px`,
        letterSpacing: `${layout.letterSpacing}px`,
        textAlign: style.align,
        textTransform: style.textCase === "upper" ? "uppercase" : style.textCase === "lower" ? "lowercase" : "none",
        width: layout.width,
        height: layout.height,
        padding: `${layout.y}px ${layout.x}px`,
        transform: cssMatrix(target.placement),
        caretColor: style.fill,
      }}
    />
  );
}

/** Samples drawn per stretch between two position keyframes. */
const PATH_SAMPLES = 24;

/** Where an animated clip travels (its anchor point), with a dot at each position keyframe, like Premiere's motion path. */
function MotionPath({ clip, canvas }: { clip: Clip; canvas: Size }) {
  const motion = findEffect(clip, MOTION.type);
  const keys = motion?.enabled ? motion.keyframes?.position : undefined;
  if (!keys || keys.length < 2) return null;
  const toPx = (v: ParamValue): Vec2 => [(v as Vec2)[0] * canvas.width, (v as Vec2)[1] * canvas.height];
  const points: Vec2[] = [];
  for (let i = 0; i < keys.length - 1; i++) {
    const [a, b] = [keys[i].time, keys[i + 1].time];
    for (let n = 0; n < PATH_SAMPLES; n++) points.push(toPx(keyframeValue(keys, a + ((b - a) * n) / PATH_SAMPLES)));
  }
  points.push(toPx(keys[keys.length - 1].value));
  return (
    <g data-motion-path>
      <polyline points={points.map((p) => p.join(",")).join(" ")} className="fill-none stroke-white/70" strokeWidth={1} strokeDasharray="3 3" />
      {keys.map((k) => {
        const [x, y] = toPx(k.value);
        return <circle key={k.time} cx={x} cy={y} r={3} className="fill-white stroke-brand" strokeWidth={1.5} />;
      })}
    </g>
  );
}
