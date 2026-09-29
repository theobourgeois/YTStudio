/**
 * One row per parameter, rendered from its spec, so any effect (or anything
 * else with `ParamSpec`s, like transitions later) gets a panel for free.
 */
import { useEffect, useState, type ReactNode } from "react";
import { PiArrowCounterClockwise } from "react-icons/pi";
import type { ParamValue, ParamValues, Project, Vec2 } from "@shared/types";
import { type BooleanSpec, type ChoiceSpec, type NumberSpec, type ParamSpec, type Vec2Spec, sameValue } from "@shared/effects";
import { ColorControl, FontControl, FontStyleControl, TextControl } from "./text-controls";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EditGesture } from "@/lib/edit-gesture";
import { cn } from "@/lib/utils";
import { type DisplayContext, fromDisplay, numberDisplay, roundShown, toDisplay } from "./display";
import { ScrubNumber } from "./scrub-number";

/** Changing one parameter: continuous edits (`begin`/`set`.../`end`) are one undo step; a lone `set` is one too. */
export interface ParamEditor {
  key: string;
  begin: () => void;
  set: (value: ParamValue) => void;
  /** Set it together with others of the same effect (e.g. a font and its style). */
  patch: (values: ParamValues) => void;
  end: () => void;
  reset: () => void;
}

/** A `ParamEditor` factory backed by one gesture (one control is dragged at a time). */
export function useParamEditors(
  apply: (patch: ParamValues) => (p: Project) => Project,
  reset: (key: string) => void,
): (key: string) => ParamEditor {
  const [gesture] = useState(() => new EditGesture());
  // Never leave a gesture open if the panel goes away mid-drag.
  useEffect(() => () => gesture.end(), [gesture]);
  return (key) => ({
    key,
    begin: () => gesture.begin(),
    set: (value) => gesture.apply(apply({ [key]: value })),
    patch: (values) => gesture.apply(apply(values)),
    end: () => gesture.end(),
    reset: () => reset(key),
  });
}

interface ParamRowProps {
  spec: ParamSpec;
  /** The effect's values (for labels/disabled states that depend on other parameters). */
  values: ParamValues;
  /** All of the effect's specs (for controls that set several parameters together). */
  specs: ParamSpec[];
  ctx: DisplayContext;
  edit: ParamEditor;
}

export function ParamRow({ spec, values, specs, ctx, edit }: ParamRowProps) {
  const value = values[spec.key];
  const label = spec.labelFor?.(values) ?? spec.label;
  const disabled = spec.disabledFor?.(values) ?? false;
  const changed = !sameValue(value, spec.default);
  let control: ReactNode;
  switch (spec.kind) {
    case "number":
      control = <NumberControl spec={spec} value={value as number} label={label} disabled={disabled} edit={edit} />;
      break;
    case "vec2":
      control = <Vec2Control spec={spec} value={value as Vec2} label={label} disabled={disabled} ctx={ctx} edit={edit} />;
      break;
    case "boolean":
      control = <BooleanControl spec={spec} value={value as boolean} label={label} disabled={disabled} edit={edit} />;
      break;
    case "choice":
      control = <ChoiceControl spec={spec} value={value as string} label={label} disabled={disabled} edit={edit} />;
      break;
    case "text":
      control = <TextControl spec={spec} value={value as string} label={label} disabled={disabled} edit={edit} />;
      break;
    case "color":
      control = <ColorControl spec={spec} value={value as string} label={label} disabled={disabled} edit={edit} />;
      break;
    case "font": {
      const styleKey = specs.find((s) => s.kind === "fontStyle" && s.familyKey === spec.key)?.key;
      control = (
        <FontControl spec={spec} value={value as string} label={label} disabled={disabled} edit={edit} values={values} styleKey={styleKey} />
      );
      break;
    }
    case "fontStyle":
      control = (
        <FontStyleControl spec={spec} value={value as string} label={label} disabled={disabled} edit={edit} values={values} />
      );
      break;
  }
  return (
    <div
      className="grid min-h-8 grid-cols-[6.5rem_minmax(0,1fr)_1.25rem] items-center gap-x-1 pr-1 pl-3"
      data-param={spec.key}
    >
      <span className={cn("truncate text-xs", disabled ? "text-muted-foreground/60" : "text-muted-foreground")} title={label}>
        {label}
      </span>
      <div className="flex min-w-0 items-center">{control}</div>
      {changed && !disabled ? <ResetButton label={`Reset ${label}`} onClick={edit.reset} /> : <span />}
    </div>
  );
}

export function ResetButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={onClick}
          className="grid size-5 cursor-pointer place-items-center rounded text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <PiArrowCounterClockwise className="size-3" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="left">{label}</TooltipContent>
    </Tooltip>
  );
}

interface ControlProps<S extends ParamSpec, V> {
  spec: S;
  value: V;
  label: string;
  disabled: boolean;
  edit: ParamEditor;
}

function NumberControl({ spec, value, label, disabled, edit }: ControlProps<NumberSpec, number>) {
  const display = numberDisplay(spec, { canvas: { width: 1, height: 1 }, media: { width: 1, height: 1 } });
  const shown = toDisplay(spec, value);
  const set = (v: number) => edit.set(fromDisplay(spec, v));
  const scrub = (
    <ScrubNumber
      value={shown}
      display={display}
      label={label}
      disabled={disabled}
      onBegin={edit.begin}
      onChange={set}
      onEnd={edit.end}
    />
  );
  if (!spec.slider) return scrub;
  return (
    <div className="flex w-full min-w-0 items-center gap-2">
      <Slider
        aria-label={label}
        className="min-w-0 flex-1"
        min={display.min}
        max={display.max}
        step={display.step}
        disabled={disabled}
        value={[roundShown(shown, display.decimals)]}
        onPointerDown={(e) => {
          // Radix only captures (and later releases) the pointer for the primary button.
          if (e.button === 0) edit.begin();
        }}
        onPointerUp={edit.end}
        onLostPointerCapture={edit.end}
        onValueChange={([v]) => set(v)}
      />
      <span className="w-15 shrink-0 text-right">{scrub}</span>
    </div>
  );
}

function Vec2Control({ spec, value, label, disabled, ctx, edit }: ControlProps<Vec2Spec, Vec2> & { ctx: DisplayContext }) {
  const shown = toDisplay(spec, value, ctx);
  return (
    <div className="flex min-w-0 items-center gap-1">
      {([0, 1] as const).map((axis) => (
        <ScrubNumber
          key={axis}
          value={shown[axis]}
          display={numberDisplay(spec, ctx, axis)}
          label={`${label} ${axis === 0 ? "X" : "Y"}`}
          disabled={disabled}
          onBegin={edit.begin}
          onChange={(v) => {
            const next: Vec2 = axis === 0 ? [v, shown[1]] : [shown[0], v];
            edit.set(fromDisplay(spec, next, ctx));
          }}
          onEnd={edit.end}
        />
      ))}
    </div>
  );
}

function BooleanControl({ value, label, disabled, edit }: ControlProps<BooleanSpec, boolean>) {
  return (
    <Switch
      aria-label={label}
      checked={value}
      disabled={disabled}
      onCheckedChange={(checked) => edit.set(checked)}
      className="ml-1 scale-90"
    />
  );
}

function ChoiceControl({ spec, value, label, disabled, edit }: ControlProps<ChoiceSpec, string>) {
  return (
    <ToggleGroup
      type="single"
      size="sm"
      aria-label={label}
      disabled={disabled}
      value={value}
      onValueChange={(v) => v && edit.set(v)}
      className="ml-1 grid w-full max-w-40 grid-flow-col rounded-md bg-muted p-0.5"
    >
      {spec.options.map((o) => (
        <ToggleGroupItem
          key={o.value}
          value={o.value}
          className="h-6 min-w-0 rounded-[5px]! text-xs text-muted-foreground hover:bg-transparent hover:text-foreground data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-xs! dark:data-[state=on]:bg-accent"
        >
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
