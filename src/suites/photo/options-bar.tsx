/**
 * The tool options bar (ux.md, "Workspace": it follows the active tool), in the header: the Brush's size, hardness
 * and strength and the colours it paints (Photoshop's swatches: D for black and white, X to swap), and what the
 * Rectangular Marquee has selected. And the question a brush asks over an image layer (ux.md: never rasterised
 * silently).
 */
import { PiArrowsLeftRight } from "react-icons/pi";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MAX_BRUSH, MIN_BRUSH, useBrush } from "./brush-options";
import { layerActions } from "./layer-actions";
import { NumberField } from "./panels/fields";
import { usePhoto, usePhotoDoc, useSelection } from "./store";
import { useActiveTool, usePhotoUi } from "./ui";

export function ToolOptions() {
  const tool = useActiveTool();
  if (tool === "brush") return <BrushOptionsBar />;
  if (tool === "marquee") return <MarqueeOptionsBar />;
  return null;
}

const percent = (v: number) => Math.round(v * 100);

function BrushOptionsBar() {
  const size = useBrush((s) => s.size);
  const hardness = useBrush((s) => s.hardness);
  const strength = useBrush((s) => s.strength);
  const set = useBrush((s) => s.set);
  return (
    <div className="flex items-center gap-2 text-xs" data-tool-options="brush">
      <Labelled label="Size">
        <NumberField label="Size" hideLabel value={size} suffix="px" onCommit={(v) => set({ size: Math.max(MIN_BRUSH, Math.min(MAX_BRUSH, v)) })} />
      </Labelled>
      <Labelled label="Hardness">
        <NumberField label="Hardness" hideLabel value={percent(hardness)} suffix="%" onCommit={(v) => set({ hardness: v / 100 })} />
      </Labelled>
      <Labelled label="Strength">
        <NumberField label="Strength" hideLabel value={percent(strength)} suffix="%" onCommit={(v) => set({ strength: v / 100 })} />
      </Labelled>
      <ColourSwatches />
    </div>
  );
}

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="w-16">{children}</span>
    </span>
  );
}

/** The foreground over the background, Photoshop's way; a click picks one, the arrows swap them (X). */
function ColourSwatches() {
  const foreground = useBrush((s) => s.foreground);
  const background = useBrush((s) => s.background);
  const set = useBrush((s) => s.set);
  return (
    <span className="flex items-center gap-1">
      <span className="relative h-7 w-9">
        <Swatch label="Background colour" colour={background} className="right-0 bottom-0" onPick={(c) => set({ background: c })} />
        <Swatch label="Foreground colour (what the brush paints; on a mask black hides, white reveals)" colour={foreground} className="top-0 left-0" onPick={(c) => set({ foreground: c })} />
      </span>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Swap colours (X)" onClick={() => useBrush.getState().swapColours()}>
            <PiArrowsLeftRight />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Swap colours (X); D for black and white</TooltipContent>
      </Tooltip>
    </span>
  );
}

function Swatch({ label, colour, className, onPick }: { label: string; colour: string; className: string; onPick: (c: string) => void }) {
  return (
    <label className={`absolute size-5 cursor-pointer rounded-sm border border-line shadow-sm ${className}`} style={{ background: colour }} title={label}>
      <input type="color" aria-label={label} value={colour} onChange={(e) => onPick(e.target.value)} className="sr-only" />
    </label>
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
