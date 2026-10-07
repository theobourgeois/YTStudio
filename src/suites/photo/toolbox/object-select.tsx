/**
 * The Object Selection tool (W: docs/photo/selections.md), Lightroom's Select Objects brush: paint roughly over a
 * thing in translucent red, let go, and the model (SAM 2.1) selects that thing (`selectObject`). Shift adds, Alt
 * subtracts, both intersect (else the options bar's mode). Its options are the selection tools' bar's.
 */
import type { PointerEvent as ReactPointerEvent } from "react";
import { cn } from "cn";
import { toast } from "sonner";
import { create } from "zustand";
import { errorMessage } from "@shared/errors";
import { modeFor } from "@shared/photo/selection";
import type { SelectionMode } from "@shared/photo/types";
import { startPointerDrag } from "@/lib/pointer-drag";
import { BrushCursor, useCanvasPointer } from "../canvas/overlays";
import { ModelMissing, askForModel } from "../models";
import { useSelectOptions } from "../selecting";
import { currentDoc } from "../store";
import { selectObject, useObjectModel, warmObjectModel } from "../object-model";
import { usePhotoUi } from "../ui";
import type { DocPointOf, ToolKit } from "./kit";

type Point = { x: number; y: number };

/** The stroke on the canvas: painted (its points grow in place; `version` says when) until the model has answered. */
const useObjectStroke = create<{ points: Point[]; size: number; finding: boolean; version: number }>(() => ({ points: [], size: 0, finding: false, version: 0 }));

const clear = () => useObjectStroke.setState({ points: [], finding: false });

/** The model looks for the thing painted over; it meets the selection by `mode`. */
async function find(points: Point[], size: number, mode: SelectionMode) {
  useObjectStroke.setState((s) => ({ points, size, finding: true, version: s.version + 1 }));
  try {
    const shape = await selectObject([points], size, mode);
    if (!shape && currentDoc()) toast("Nothing was found where you painted: paint over more of the thing.");
  } catch (error) {
    if (error instanceof ModelMissing) askForModel(error, () => void find(points, size, mode));
    else toast.error("Object Selection didn't work", { description: errorMessage(error) });
  } finally {
    clear();
  }
}

function press(e: ReactPointerEvent<HTMLDivElement>, docPoint: DocPointOf) {
  // One at a time: the model is busy with the stroke before.
  if (!currentDoc() || useObjectModel.getState().running || useObjectStroke.getState().finding) return;
  const o = useSelectOptions.getState();
  const mode = modeFor(e, o.mode);
  const size = o.objectSize;
  warmObjectModel(o.sampleAll);
  const points = [docPoint(e.clientX, e.clientY)];
  useObjectStroke.setState((s) => ({ points, size, finding: false, version: s.version + 1 }));
  const done = () => void find(points, size, mode);
  startPointerDrag(e, {
    threshold: 0,
    cursor: "none",
    onMove: (ev) => {
      const samples = ev.getCoalescedEvents?.() ?? [];
      for (const s of samples.length ? samples : [ev]) points.push(docPoint(s.clientX, s.clientY));
      useObjectStroke.setState((s) => ({ version: s.version + 1 }));
    },
    onEnd: done,
    onClick: done,
    onCancel: clear,
  });
}

/** Over the photo, whatever the theme: the red of a Quick Mask, Lightroom's mask overlay. */
const STROKE_RED = "rgb(255 32 32)";

/** The stroke as it's painted (pulsing while the model looks), and the brush's circle. */
function ObjectOverlay() {
  const view = usePhotoUi((s) => s.view);
  const { points, size, finding } = useObjectStroke();
  useObjectStroke((s) => s.version);
  const objectSize = useSelectOptions((s) => s.objectSize);
  const alt = useCanvasPointer((s) => s.alt);
  const mode = useSelectOptions((s) => s.mode);
  const dpr = devicePixelRatio;
  let d = "";
  if (view && points.length) {
    const at = (p: Point) => `${((p.x - view.x) * view.zoom) / dpr} ${((p.y - view.y) * view.zoom) / dpr}`;
    // A press alone is a dab: a line of no length, drawn with its round caps.
    d = `M${at(points[0])}` + (points.length === 1 ? `L${at(points[0])}` : points.slice(1).map((p) => `L${at(p)}`).join(""));
  }
  return (
    <>
      {d && view && (
        <svg className="pointer-events-none absolute inset-0 size-full overflow-visible">
          <path
            d={d}
            fill="none"
            stroke={STROKE_RED}
            strokeWidth={Math.max(1, (size * view.zoom) / dpr)}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={0.4}
            className={cn(finding && "animate-pulse")}
            data-object-stroke={finding ? "finding" : "painting"}
          />
        </svg>
      )}
      {!finding && <BrushCursor quick={alt || mode === "subtract" ? "subtract" : "add"} size={objectSize} />}
    </>
  );
}

export const objectSelectKit: ToolKit = {
  press,
  Overlay: ObjectOverlay,
  cursor: "cursor-none",
  brush: {
    get: () => ({ size: useSelectOptions.getState().objectSize, hardness: 1 }),
    set: ({ size }) => size !== undefined && useSelectOptions.getState().set({ objectSize: size }),
  },
};
