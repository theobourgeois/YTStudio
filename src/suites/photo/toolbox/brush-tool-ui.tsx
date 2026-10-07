/**
 * What the brushes that read their pixels share in the tab (Dodge, Burn, Sponge, the Background Eraser): their
 * options bar's controls (Photoshop's: numbers dragged sideways, menus, checkboxes), their circle on the canvas, and
 * the question a press on a placed image asks (convert it to pixels: never rasterised silently).
 */
import type { ReactNode } from "react";
import { create } from "zustand";
import { PiCheckSquareFill, PiSquare } from "react-icons/pi";
import { findLayer } from "@shared/photo/edits";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { type NumberDisplay, ScrubNumber } from "@/components/scrub-number";
import { MAX_BRUSH, MIN_BRUSH } from "../brush-options";
import { useCanvasPointer } from "../canvas/overlays";
import { layerActions } from "../layer-actions";
import { usePhotoDoc } from "../store";
import { usePhotoUi } from "../ui";

export const SIZE: NumberDisplay = { min: MIN_BRUSH, max: MAX_BRUSH, step: 1, decimals: 0, unit: "px" };
export const PERCENT: NumberDisplay = { min: 0, max: 100, step: 1, decimals: 0, unit: "%" };
/** Exposure, Flow: 1–100% (0 would do nothing). */
export const STRENGTH: NumberDisplay = { min: 1, max: 100, step: 1, decimals: 0, unit: "%" };

/** The options bar's row. */
export function OptionsRow({ tool, children }: { tool: string; children: ReactNode }) {
  return (
    <div className="flex shrink-0 items-center gap-3 text-xs whitespace-nowrap" data-tool-options={tool}>
      {children}
    </div>
  );
}

/** A labelled scrubby number: a tool's option (this browser's, not the photo's: no undo step). */
export function Scrub({ label, value, display, onChange, title }: { label: string; value: number; display: NumberDisplay; onChange: (v: number) => void; title?: string }) {
  return (
    <span className="flex items-center gap-0.5" data-option={label} title={title}>
      <span className="text-muted-foreground">{label}</span>
      <ScrubNumber label={label} value={value} display={display} onBegin={() => {}} onChange={onChange} onEnd={() => {}} />
    </span>
  );
}

/** An on/off option: a checkbox, as Photoshop's options bar has. */
export function Toggle({ label, title, checked, onChange }: { label: string; title?: string; checked: boolean; onChange: (on: boolean) => void }) {
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

/** One of a few choices, as a menu (Range, Mode, Limits…). */
export function Choice<T extends string>({ label, value, options, onChange, width = "w-28" }: { label: string; value: T; options: readonly { value: T; label: string }[]; onChange: (v: T) => void; width?: string }) {
  return (
    <span className="flex items-center gap-1" data-option={label}>
      <span className="text-muted-foreground">{label}</span>
      <Select value={value} onValueChange={(v) => onChange(v as T)}>
        <SelectTrigger size="sm" className={`h-6 ${width} text-xs`} aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </span>
  );
}

/**
 * The brush's circle where the pointer is (the pointer itself is hidden): its size on screen, its hardness as an inner
 * dashed circle, and with `hotspot` the Background Eraser's cross at the centre (what it samples).
 */
export function BrushRing({ size, hardness, hotspot = false, tool }: { size: number; hardness: number; hotspot?: boolean; tool: string }) {
  const view = usePhotoUi((s) => s.view);
  const at = useCanvasPointer((s) => s.at);
  if (!view || !at) return null;
  const dpr = devicePixelRatio;
  const cx = ((at.x - view.x) * view.zoom) / dpr;
  const cy = ((at.y - view.y) * view.zoom) / dpr;
  const r = Math.max(1, (size / 2) * (view.zoom / dpr));
  const cross = `M${cx - 6} ${cy}h12M${cx} ${cy - 6}v12`;
  return (
    <svg className="pointer-events-none absolute inset-0 size-full overflow-visible" data-brush-cursor={size} data-brush-tool={tool}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="white" strokeWidth={2} opacity={0.7} />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="black" strokeWidth={1} />
      {hardness < 1 && <circle cx={cx} cy={cy} r={Math.max(0.5, r * hardness)} fill="none" stroke="black" strokeOpacity={0.4} strokeDasharray="2 3" strokeWidth={1} />}
      {hotspot && (
        <>
          <path d={cross} stroke="white" strokeWidth={3} opacity={0.7} />
          <path d={cross} stroke="black" strokeWidth={1} />
        </>
      )}
    </svg>
  );
}

/** A press on a placed image or a generated layer: which layer, and the tool's verb ("dodge"). */
export const useConvertAsk = create<{ ask: { layerId: string; verb: string } | null; set: (ask: { layerId: string; verb: string } | null) => void }>((set) => ({
  ask: null,
  set: (ask) => set({ ask }),
}));

/**
 * The question: Dodge, Burn, Sponge and the Background Eraser change pixels, and a placed image is kept whole, so it's
 * converted to pixels first (Photoshop's "rasterise"), or nothing. A new paint layer isn't offered: it would be empty.
 */
export function ConvertDialog() {
  const ask = useConvertAsk((s) => s.ask);
  const name = usePhotoDoc((d) => (ask ? (findLayer(d, ask.layerId)?.name ?? null) : null));
  const kind = usePhotoDoc((d) => (ask ? (findLayer(d, ask.layerId)?.kind ?? null) : null));
  const close = () => useConvertAsk.getState().set(null);
  const verb = ask?.verb ?? "";
  return (
    <AlertDialog open={!!ask && name !== null} onOpenChange={(open) => !open && close()}>
      <AlertDialogContent data-convert-choice>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Convert “{name}” to pixels to {verb} it?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {kind === "generator" ? "It's a generated layer, made afresh from its settings." : "It's a placed image, kept whole so it can be transformed without losing quality."} To {verb}{" "}
            it, it becomes pixels: its place, filters and mask become part of them, and scaling it later resamples them. Duplicate it first to keep the original.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button
            onClick={() => {
              const layerId = ask?.layerId;
              close();
              if (layerId) void layerActions.convertToPixels(layerId);
            }}
            data-autofocus
          >
            Convert to pixels
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
