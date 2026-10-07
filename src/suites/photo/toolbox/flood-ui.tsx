/**
 * What the Paint Bucket and the Magic Eraser share on the canvas: the pointer (a crosshair, the tool's icon beside
 * it, as Photoshop's bucket shows its spout at the point read) and what a click's outcome tells the user.
 */
import type { ComponentType } from "react";
import { toast } from "sonner";
import { useCanvasPointer } from "../canvas/overlays";
import { usePhotoUi } from "../ui";
import type { FloodOutcome } from "./flood-actions";

/** The tool's icon just below and right of the crosshair's centre, following the pointer. */
export function floodCursor(Icon: ComponentType<{ className?: string }>, name: string) {
  return function FloodCursor() {
    const view = usePhotoUi((s) => s.view);
    const at = useCanvasPointer((s) => s.at);
    if (!view || !at) return null;
    const dpr = devicePixelRatio;
    const x = ((at.x - view.x) * view.zoom) / dpr;
    const y = ((at.y - view.y) * view.zoom) / dpr;
    return (
      <div className="pointer-events-none absolute" style={{ left: x + 7, top: y + 5 }} data-flood-cursor={name}>
        <Icon className="size-4 text-white [filter:drop-shadow(0_0_1px_black)_drop-shadow(0_0_1px_black)]" />
      </div>
    );
  };
}

/** A click's outcome, told: an image asks first (the brush's question), a reason is a toast; done is the canvas's to show. */
export function tellOutcome(outcome: FloodOutcome, tool: string) {
  if (outcome.kind === "choice") usePhotoUi.getState().setPaintChoice(outcome.layerId);
  else if (outcome.kind === "error") toast.error(`The ${tool} couldn't run`, { description: outcome.message });
}
