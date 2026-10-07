/**
 * The tool options bar (ux.md, "Workspace": it follows the active tool), in the header: the Brush's and the
 * Eraser's size, hardness and strength (the colours are every tool's, at the foot of the tool strip), and the
 * selection tools' (docs/photo/selections.md: the mode, Feather, Anti-alias, the Magic Wand's Tolerance, Sample Size,
 * Contiguous and Sample All Layers, Quick Selection's size and Auto-Enhance, Select Subject). And the question a
 * brush asks over an image layer (ux.md: never rasterised silently).
 */
import { cn } from "cn";
import { PiCheckSquareFill, PiIntersectSquare, PiSquare, PiSubtractSquare, PiUniteSquare, PiUserFocus } from "react-icons/pi";
import { findLayer } from "@shared/photo/edits";
import { SAMPLE_SIZES } from "@shared/photo/magic-wand";
import type { SelectionMode } from "@shared/photo/types";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
import { usePhotoDoc, useSelection } from "./store";
import { runSelectSubject } from "./select-commands";
import { type SelectOptions, useSelectOptions } from "./selecting";
import { useSubjectModel } from "./subject-model";
import { type PhotoTool, isSelectionTool, useActiveTool, usePhotoUi } from "./ui";
import { TOOLBOX } from "./toolbox";

export function ToolOptions() {
  const tool = useActiveTool();
  if (tool === "brush" || tool === "eraser") return <BrushOptionsBar />;
  if (isSelectionTool(tool)) return <SelectionOptionsBar tool={tool} />;
  const Options = TOOLBOX[tool]?.Options;
  return Options ? <Options /> : null;
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
    <div className="flex shrink-0 items-center gap-3 text-xs whitespace-nowrap" data-tool-options="brush">
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

const MODES: { mode: SelectionMode; label: string; Icon: typeof PiSquare }[] = [
  { mode: "new", label: "New selection", Icon: PiSquare },
  { mode: "add", label: "Add to selection (Shift)", Icon: PiUniteSquare },
  { mode: "subtract", label: "Subtract from selection (Alt)", Icon: PiSubtractSquare },
  { mode: "intersect", label: "Intersect with selection (Shift+Alt)", Icon: PiIntersectSquare },
];

const FEATHER = { min: 0, max: 250, step: 1, decimals: 0, unit: "px" };
const TOLERANCE = { min: 0, max: 255, step: 1, decimals: 0, unit: "" };
const QUICK_SIZE = { min: 1, max: 2500, step: 1, decimals: 0, unit: "px" };

/** The selection tools' options, Photoshop's: what each tool has, and what's selected. */
function SelectionOptionsBar({ tool }: { tool: PhotoTool }) {
  const o = useSelectOptions();
  const set = (patch: Partial<SelectOptions>) => useSelectOptions.getState().set(patch);
  const selection = useSelection();
  const running = useSubjectModel((s) => s.running);
  const wand = tool === "magicWand";
  const quick = tool === "quickSelect";
  // Quick Selection only adds and takes away.
  const modes = quick ? MODES.slice(0, 3) : MODES;
  return (
    <div className="flex shrink-0 items-center gap-3 text-xs whitespace-nowrap" data-tool-options="selection" data-tool-options-for={tool}>
      <div className="flex items-center" role="group" aria-label="Selection mode">
        {modes.map(({ mode, label, Icon }) => (
          <Tooltip key={mode}>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={label} aria-pressed={o.mode === mode} className={cn(o.mode === mode && "bg-accent text-foreground")} onClick={() => set({ mode })} data-select-mode={mode}>
                <Icon className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
          </Tooltip>
        ))}
      </div>
      {quick && <Scrub label="Size" value={o.quickSize} display={QUICK_SIZE} onChange={(v) => set({ quickSize: v })} />}
      {!wand && !quick && <Scrub label="Feather" value={o.feather} display={FEATHER} onChange={(v) => set({ feather: v })} />}
      {wand && (
        <span className="flex items-center gap-1" data-option="Sample Size">
          <span className="text-muted-foreground">Sample</span>
          <Select value={String(o.sampleSize)} onValueChange={(v) => set({ sampleSize: Number(v) })}>
            <SelectTrigger size="sm" className="h-6 w-24 text-xs" aria-label="Sample size">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SAMPLE_SIZES.map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n === 1 ? "Point" : `${n} × ${n} Average`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </span>
      )}
      {wand && <Scrub label="Tolerance" value={o.tolerance} display={TOLERANCE} onChange={(v) => set({ tolerance: v })} />}
      {tool !== "marquee" && !quick && <Toggle label="Anti-alias" checked={o.antiAlias} onChange={(antiAlias) => set({ antiAlias })} />}
      {wand && <Toggle label="Contiguous" checked={o.contiguous} onChange={(contiguous) => set({ contiguous })} />}
      {(wand || quick) && <Toggle label="All Layers" title="Sample All Layers: read the photo as it shows (else the active layer alone)" checked={o.sampleAll} onChange={(sampleAll) => set({ sampleAll })} />}
      {quick && <Toggle label="Auto-Enhance" checked={o.autoEnhance} onChange={(autoEnhance) => set({ autoEnhance })} />}
      {(wand || quick) && (
        <Button size="sm" variant="outline" disabled={running} onClick={() => void runSelectSubject(o.mode)} title="Select Subject" data-select-subject-button>
          <PiUserFocus /> Subject
        </Button>
      )}
      {selection && (
        <span className="tabular-nums text-muted-foreground" data-selection-size>
          {Math.round(selection.width)} × {Math.round(selection.height)} px
        </span>
      )}
    </div>
  );
}

/** An on/off option of a tool: a checkbox, as Photoshop's options bar has (they're many, and the bar is narrow). */
function Toggle({ label, title, checked, onChange }: { label: string; title?: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      title={title}
      className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
      onClick={() => onChange(!checked)}
      data-option={label}
    >
      {checked ? <PiCheckSquareFill className="size-4 text-brand" /> : <PiSquare className="size-4" />}
      {label}
    </button>
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
