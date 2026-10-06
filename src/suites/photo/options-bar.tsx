/**
 * The tool options bar (ux.md, "Workspace": it follows the active tool), in the header: the Brush's and the
 * Eraser's size, hardness and strength (the colours are every tool's, at the foot of the tool strip), and what the
 * Rectangular Marquee has selected. And the question a brush asks over an image layer (ux.md: never rasterised
 * silently).
 */
import { findLayer } from "@shared/photo/edits";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { type NumberDisplay, ScrubNumber } from "@/components/scrub-number";
import { MAX_BRUSH, MIN_BRUSH, useBrush } from "./brush-options";
import { layerActions } from "./layer-actions";
import { usePhoto, usePhotoDoc, useSelection } from "./store";
import { useActiveTool, usePhotoUi } from "./ui";

export function ToolOptions() {
  const tool = useActiveTool();
  if (tool === "brush" || tool === "eraser") return <BrushOptionsBar />;
  if (tool === "marquee") return <MarqueeOptionsBar />;
  return null;
}

const SIZE = { min: MIN_BRUSH, max: MAX_BRUSH, step: 1, decimals: 0, unit: "px" };
const PERCENT = { min: 0, max: 100, step: 1, decimals: 0, unit: "%" };

/** The Brush's and the Eraser's options: numbers dragged sideways (Shift ×10, Alt ×0.1), clicked to type. */
export function BrushOptionsBar() {
  const size = useBrush((s) => s.size);
  const hardness = useBrush((s) => s.hardness);
  const strength = useBrush((s) => s.strength);
  const set = useBrush((s) => s.set);
  return (
    <div className="flex items-center gap-3 text-xs" data-tool-options="brush">
      <Scrub label="Size" value={size} display={SIZE} onChange={(v) => set({ size: v })} />
      <Scrub label="Hardness" value={Math.round(hardness * 100)} display={PERCENT} onChange={(v) => set({ hardness: v / 100 })} />
      <Scrub label="Strength" value={Math.round(strength * 100)} display={PERCENT} onChange={(v) => set({ strength: v / 100 })} />
    </div>
  );
}

/** A labelled scrubby number: an option of a tool (this browser's, not the photo's: no undo step). */
function Scrub({ label, value, display, onChange }: { label: string; value: number; display: NumberDisplay; onChange: (v: number) => void }) {
  return (
    <span className="flex items-center gap-0.5" data-option={label}>
      <span className="text-muted-foreground">{label}</span>
      <ScrubNumber label={label} value={value} display={display} onBegin={() => {}} onChange={onChange} onEnd={() => {}} />
    </span>
  );
}

function MarqueeOptionsBar() {
  const selection = useSelection();
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground" data-tool-options="marquee">
      {selection ? (
        <>
          <span className="tabular-nums" data-selection-size>
            {Math.round(selection.width)} × {Math.round(selection.height)} px
          </span>
          <Button size="sm" variant="outline" onClick={() => usePhoto.getState().select(null)}>
            Deselect (⌘D)
          </Button>
        </>
      ) : (
        <span>Drag to select a rectangle (Shift: a square, Alt: from its centre).</span>
      )}
    </div>
  );
}

/** A brush pressed on an image layer: paint a new layer above it, or make it pixels first. */
export function PaintChoiceDialog() {
  const layerId = usePhotoUi((s) => s.paintChoice);
  const name = usePhotoDoc((d) => (layerId ? (findLayer(d, layerId)?.name ?? null) : null));
  const close = () => usePhotoUi.getState().setPaintChoice(null);
  return (
    <AlertDialog open={!!layerId && name !== null} onOpenChange={(open) => !open && close()}>
      <AlertDialogContent data-paint-choice>
        <AlertDialogHeader>
          <AlertDialogTitle>Paint on “{name}”?</AlertDialogTitle>
          <AlertDialogDescription>
            It's a placed image, kept whole so it can be transformed without losing quality. Paint on a new layer above it, or convert it to pixels (its place
            and mask become part of its pixels; scaling it later resamples them).
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button
            variant="outline"
            onClick={() => {
              close();
              if (layerId) void layerActions.convertToPixels(layerId);
            }}
          >
            Convert to pixels
          </Button>
          <Button
            onClick={() => {
              close();
              if (layerId) layerActions.newLayer(layerId);
            }}
            data-autofocus
          >
            New paint layer
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
