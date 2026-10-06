/**
 * Properties' controls: a number typed in, and a parameter's slider with its field (any `NumberParam` of an
 * effect definition: the panel renders specs, never an effect's own UI). A typed value is one undo step, a slider
 * drag is one too.
 */
import { useRef, useState } from "react";
import type { NumberParam } from "@shared/photo/effects/params";
import { Slider } from "@/components/ui/slider";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { photoGesture } from "../store";
import type { PhotoProject } from "@shared/photo/types";

/** A number typed in: Enter or leaving the field commits (one undo step), Escape puts it back. */
export function NumberField({
  label,
  value,
  onCommit,
  suffix,
  disabled,
  hideLabel,
}: {
  label: string;
  value: number;
  onCommit: (v: number) => void;
  suffix?: string;
  disabled?: boolean;
  /** Named for assistive technology only (the row says it already). */
  hideLabel?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);
  const finish = (text: string) => {
    setDraft(null);
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    const v = Number(text);
    if (text.trim() !== "" && Number.isFinite(v) && v !== value) onCommit(v);
  };
  return (
    <label className="flex min-w-0 flex-col gap-0.5">
      {!hideLabel && <span className="text-xs text-muted-foreground">{label}</span>}
      <span className="flex items-center rounded border border-line bg-surface-0 pr-1.5 focus-within:border-brand">
        <input
          inputMode="decimal"
          aria-label={label}
          disabled={disabled}
          value={draft ?? String(value)}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => finish(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              cancelled.current = true;
              e.currentTarget.blur();
            }
          }}
          className="h-7 min-w-0 flex-1 bg-transparent px-1.5 tabular-nums outline-none disabled:opacity-50"
        />
        {suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}
      </span>
    </label>
  );
}

const shown = (v: number, decimals: number) => Number(v.toFixed(decimals));

/** A number parameter: its label, a slider over its range (one undo step a drag), and its value typed. */
export function ParamSlider({ spec, value, edit }: { spec: NumberParam; value: number; edit: (value: number) => (doc: PhotoProject) => PhotoProject }) {
  const [gesture] = useState(() => photoGesture());
  return (
    <div className="flex flex-col gap-1" data-param={spec.key}>
      <div className="flex items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="flex-1 text-xs">{spec.label}</span>
          </TooltipTrigger>
          <TooltipContent className="max-w-64">{spec.description}</TooltipContent>
        </Tooltip>
        <span className="w-24">
          <NumberField label={spec.label} hideLabel value={shown(value, spec.decimals)} suffix={spec.unit || undefined} onCommit={(v) => gesture.apply(edit(v))} />
        </span>
      </div>
      <Slider
        aria-label={`${spec.label} slider`}
        min={spec.min}
        max={spec.max}
        step={spec.step}
        value={[value]}
        onPointerDown={() => gesture.begin()}
        onValueChange={([v]) => gesture.apply(edit(v))}
        onValueCommit={() => gesture.end()}
      />
    </div>
  );
}
