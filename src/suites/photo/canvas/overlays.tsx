/**
 * Overlays drawn over the canvas in CSS pixels: the selection's marching ants (any tool, as Photoshop's) and the
 * brush's circle at the pointer (its size on screen). They follow the view; they're UI, never in the image.
 */
import { create } from "zustand";
import { useBrush } from "../brush-options";
import { useSelection } from "../store";
import { usePhotoUi } from "../ui";

/** Where the pointer is over the canvas, in document pixels (null when it's elsewhere). */
export const useCanvasPointer = create<{ at: { x: number; y: number } | null; set: (at: { x: number; y: number } | null) => void }>((set) => ({
  at: null,
  set: (at) => set({ at }),
}));

/** The selection's outline: black dashes marching over white (readable on any picture). */
export function SelectionAnts() {
  const view = usePhotoUi((s) => s.view);
  const selection = useSelection();
  if (!view || !selection) return null;
  const dpr = devicePixelRatio;
  const x = ((selection.x - view.x) * view.zoom) / dpr;
  const y = ((selection.y - view.y) * view.zoom) / dpr;
  const width = (selection.width * view.zoom) / dpr;
  const height = (selection.height * view.zoom) / dpr;
  return (
    <svg className="pointer-events-none absolute inset-0 size-full overflow-visible" data-selection={`${selection.x},${selection.y},${selection.width},${selection.height}`}>
      <rect x={x + 0.5} y={y + 0.5} width={Math.max(0, width - 1)} height={Math.max(0, height - 1)} fill="none" stroke="white" strokeWidth={1} />
      <rect className="photo-ants" x={x + 0.5} y={y + 0.5} width={Math.max(0, width - 1)} height={Math.max(0, height - 1)} fill="none" stroke="black" strokeWidth={1} strokeDasharray="4 4" />
    </svg>
  );
}

/** The brush's circle where the pointer is: its size and hardness, on screen (the pointer itself is hidden). */
export function BrushCursor() {
  const view = usePhotoUi((s) => s.view);
  const at = useCanvasPointer((s) => s.at);
  const size = useBrush((s) => s.size);
  const hardness = useBrush((s) => s.hardness);
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
      <path d={`M${cx - 4} ${cy}h8M${cx} ${cy - 4}v8`} stroke="black" strokeWidth={1} />
    </svg>
  );
}
