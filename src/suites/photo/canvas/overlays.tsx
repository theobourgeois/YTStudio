/**
 * Overlays drawn over the canvas: the selection's marching ants (any tool, as Photoshop's) and the selection being
 * made, and the brush's circle at the pointer (its size on screen). They follow the view; they're UI, never in the
 * image.
 */
import { useEffect, useRef } from "react";
import { create } from "zustand";
import { selectionOutline } from "@shared/photo/selection-outline";
import type { PhotoSelection } from "@shared/photo/types";
import { useBrush } from "../brush-options";
import { useSelectOptions } from "../selecting";
import { useSelection } from "../store";
import { type SelectionDraft, usePhotoUi } from "../ui";

/** Where the pointer is over the canvas, in document pixels (null when it's elsewhere), and whether Alt is held. */
export const useCanvasPointer = create<{ at: { x: number; y: number } | null; alt: boolean; set: (at: { x: number; y: number } | null, alt?: boolean) => void }>((set) => ({
  at: null,
  alt: false,
  set: (at, alt = false) => set({ at, alt }),
}));

/** Each selection's ants as a path in document pixels, made once (selections are immutable). */
const paths = new WeakMap<object, Path2D>();

function pathOf(loops: readonly number[][], closed = true): Path2D {
  const path = new Path2D();
  for (const l of loops) {
    path.moveTo(l[0], l[1]);
    for (let i = 2; i < l.length; i += 2) path.lineTo(l[i], l[i + 1]);
    if (closed) path.closePath();
  }
  return path;
}

function selectionPath(s: PhotoSelection): Path2D {
  const key = s.kind === "mask" ? s.data : s;
  let path = paths.get(key);
  if (!path) paths.set(key, (path = pathOf(selectionOutline(s))));
  return path;
}

/** A selection being made, as a path in document pixels. */
function draftPath(draft: SelectionDraft): Path2D {
  if (draft.kind === "loops") return pathOf(draft.loops);
  if (draft.kind === "path") {
    const points = draft.next ? [...draft.points, draft.next] : draft.points;
    return pathOf([points.flatMap((p) => [p.x, p.y])], false);
  }
  const { x0, y0, x1, y1 } = draft.box;
  const path = new Path2D();
  if (draft.kind === "rect") path.rect(x0, y0, x1 - x0, y1 - y0);
  else path.ellipse((x0 + x1) / 2, (y0 + y1) / 2, Math.abs(x1 - x0) / 2, Math.abs(y1 - y0) / 2, 0, 0, 2 * Math.PI);
  return path;
}

/** How often the ants march (ms) and how far each step goes (CSS pixels). */
const MARCH_MS = 120;

/**
 * The selection's outline: black dashes marching over white (readable on any picture), along the edges of the
 * pixels it covers at least half of, and whatever selection is being made. Drawn on a canvas of its own: a wand's
 * selection can have thousands of edges.
 */
export function SelectionAnts() {
  const view = usePhotoUi((s) => s.view);
  const selection = useSelection();
  const draft = usePhotoUi((s) => s.selectionDraft);
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !view || (!selection && !draft)) return;
    const g = canvas.getContext("2d");
    if (!g) return;
    canvas.width = Math.max(1, Math.round(view.width));
    canvas.height = Math.max(1, Math.round(view.height));
    const dpr = devicePixelRatio;
    // Quick Selection's draft is the whole selection as it grows: the one there isn't drawn under it.
    const shapes = draft?.kind === "loops" ? [draftPath(draft)] : [...(selection ? [selectionPath(selection)] : []), ...(draft ? [draftPath(draft)] : [])];
    let step = 0;
    const draw = () => {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, canvas.width, canvas.height);
      // Document pixels to the canvas's device pixels; lines stay a CSS pixel wide at any zoom.
      g.setTransform(view.zoom, 0, 0, view.zoom, -view.x * view.zoom, -view.y * view.zoom);
      const unit = dpr / view.zoom;
      g.lineWidth = unit;
      for (const path of shapes) {
        g.setLineDash([]);
        g.strokeStyle = "white";
        g.stroke(path);
        g.setLineDash([4 * unit, 4 * unit]);
        g.lineDashOffset = -step * unit;
        g.strokeStyle = "black";
        g.stroke(path);
      }
    };
    draw();
    const timer = setInterval(() => {
      step = (step + 1) % 8;
      draw();
    }, MARCH_MS);
    return () => clearInterval(timer);
  }, [view, selection, draft]);
  if (!view || (!selection && !draft)) return null;
  return (
    <canvas
      ref={ref}
      className="pointer-events-none absolute inset-0 size-full"
      data-selection={selection ? `${selection.x},${selection.y},${selection.width},${selection.height}` : undefined}
      data-selection-kind={selection?.kind}
      data-selection-draft={draft?.kind}
    />
  );
}

/**
 * The brush's circle where the pointer is: its size and hardness, on screen (the pointer itself is hidden). Quick
 * Selection's (`quick`) is its own size, hard, with a + or − for what it does.
 */
export function BrushCursor({ quick = null }: { quick?: "add" | "subtract" | null }) {
  const view = usePhotoUi((s) => s.view);
  const at = useCanvasPointer((s) => s.at);
  const brushSize = useBrush((s) => s.size);
  const quickSize = useSelectOptions((s) => s.quickSize);
  const brushHardness = useBrush((s) => s.hardness);
  const size = quick ? quickSize : brushSize;
  const hardness = quick ? 1 : brushHardness;
  if (!view || !at) return null;
  const dpr = devicePixelRatio;
  const cx = ((at.x - view.x) * view.zoom) / dpr;
  const cy = ((at.y - view.y) * view.zoom) / dpr;
  const r = Math.max(1, (size / 2) * (view.zoom / dpr));
  return (
    <svg className="pointer-events-none absolute inset-0 size-full overflow-visible" data-brush-cursor={size}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="white" strokeWidth={2} opacity={0.7} />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="black" strokeWidth={1} />
      {hardness < 1 && <circle cx={cx} cy={cy} r={Math.max(0.5, r * hardness)} fill="none" stroke="black" strokeOpacity={0.4} strokeDasharray="2 3" strokeWidth={1} />}
      <path d={quick === "subtract" ? `M${cx - 4} ${cy}h8` : `M${cx - 4} ${cy}h8M${cx} ${cy - 4}v8`} stroke="black" strokeWidth={1} />
    </svg>
  );
}
