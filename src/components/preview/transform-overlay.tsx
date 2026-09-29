/**
 * Direct manipulation on the canvas, like Premiere's Program Monitor: click a
 * clip to select it, drag it to move, drag a handle to scale (around the
 * anchor point; Shift stretches), drag just outside a corner to rotate, drag
 * the anchor point to move it without moving the picture. Every drag is one
 * undo step. With the Type tool, a click adds a text there; double-clicking
 * a text types into it.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { ParamValues, Vec2 } from "@shared/types";
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
import { EditGesture } from "@/lib/edit-gesture";
import { cn } from "@/lib/utils";
import { useEditor } from "@/stores/editor";
import { useFonts } from "@/stores/fonts";
import { useLayout } from "@/stores/layout";
import { usePlayback } from "@/stores/playback";
import { createText, editText, finishTextEditing, typeText, useTextEditing } from "@/stores/text-editing";
import { type OnCanvas, clipAtPoint, clipsOnCanvas, snapMove } from "./placement";

type Mode =
  | { kind: "move" }
  | { kind: "scale"; handle: Vec2 }
  | { kind: "rotate" }
  | { kind: "anchor" };

/** Pixels the pointer must travel before a press becomes a drag. */
const DRAG_THRESHOLD = 3;
const SNAP_PX = 6;
const ROTATE_STEP = 15;

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

export function TransformOverlay({ canvas }: { canvas: Size }) {
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

  const startDrag = (e: ReactPointerEvent, target: OnCanvas, mode: Mode, cursor: string) => {
    e.stopPropagation();
    e.preventDefault();
    usePlayback.getState().pause();
    // Working on a clip on the canvas: show its properties.
    useLayout.getState().setLeftPanel("properties");
    const { clip, placement: p0, time: sourceTime } = target;
    const start = pointAt(e);
    const uniform = findEffect(clip, MOTION.type)?.params.uniformScale !== false;
    const gesture = new EditGesture();
    let started = false;
    let prevAngle = angleAround([p0.x, p0.y], start);
    let turned = 0;
    const prevCursor = document.body.style.cursor;

    const onMove = (ev: PointerEvent) => {
      const pt = pointAt(ev);
      if (!started) {
        if (Math.hypot(pt[0] - start[0], pt[1] - start[1]) < DRAG_THRESHOLD) return;
        started = true;
        gesture.begin();
        document.body.style.cursor = cursor;
        setDragging(true);
      } else if (!gesture.active) {
        // Another edit ended the gesture (e.g. an upload landed); stop here.
        return finish(false);
      }
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
      gesture.apply((p) => setParams(p, clip.id, MOTION.type, patch, sourceTime));
      setGuides(nextGuides);
    };

    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      ev.preventDefault();
      ev.stopPropagation();
      finish(true);
    };

    function finish(cancel: boolean) {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey, true);
      document.body.style.cursor = prevCursor;
      setGuides({ x: null, y: null });
      setDragging(false);
      if (!started) return;
      if (cancel) gesture.cancel();
      else gesture.end();
    }
    const onUp = () => finish(false);
    const onCancel = () => finish(true);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey, true);
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

  const onDoubleClick = (e: ReactMouseEvent) => {
    const target = clipAtPoint(onCanvas, pointAt(e));
    if (target && isTextClip(target.clip)) editText(target.clip.id);
  };

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
    >
      {editing?.text && <TextEditor target={editing} />}
      <svg className="pointer-events-none absolute inset-0 size-full overflow-visible" aria-hidden>
        {guides.x !== null && (
          <line x1={guides.x} x2={guides.x} y1={0} y2={canvas.height} className="stroke-playhead" strokeWidth={1} />
        )}
        {guides.y !== null && (
          <line y1={guides.y} y2={guides.y} x1={0} x2={canvas.width} className="stroke-playhead" strokeWidth={1} />
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
        width: layout.width,
        height: layout.height,
        padding: `${layout.y}px ${layout.x}px`,
        transform: cssMatrix(target.placement),
        caretColor: style.fill,
      }}
    />
  );
}
