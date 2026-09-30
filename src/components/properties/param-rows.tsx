/**
 * One row per parameter, rendered from its spec, so anything with
 * `ParamSpec`s (effects, transitions) gets a panel for free.
 */
import { useEffect, useState, type ReactNode } from "react";
import { PiArrowCounterClockwise, PiBezierCurve, PiFunction } from "react-icons/pi";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu";
import type { BezierPath } from "@shared/path";
import type { ParamValue, ParamValues, Project, Vec2 } from "@shared/types";
import { type BooleanSpec, type ChoiceSpec, type NumberSpec, type ParamSpec, type PathSpec, type Vec2Spec, sameValue } from "@shared/params";
import { sameTarget, usePathEditing } from "@/stores/path-editing";
import { useLayout } from "@/stores/layout";
import { ColorControl, FontControl, FontStyleControl, TextControl } from "./text-controls";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EditGesture } from "@/lib/edit-gesture";
import { cn } from "cn";
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
  /** The stopwatch cell of a clip's property (null: can't be animated, but keep the column). */
  animation?: ReactNode;
  /** The keyframe navigator, while the property is animated. */
  navigator?: ReactNode;
  /** The clip's effect these are the values of (a path is edited on the Program monitor through it). */
  owner?: { clipId: string; effectId: string };
  /** The property can have an expression: whether it has one, and adding or removing it (its name's menu). */
  expression?: { on: boolean; toggle: () => void };
}

export function ParamRow({ spec, values, specs, ctx, edit, animation, navigator, owner, expression }: ParamRowProps) {
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
    case "path":
      control = <PathControl spec={spec} value={value as BezierPath} label={label} disabled={disabled} edit={edit} owner={owner} />;
      break;
  }
  const animatable = animation !== undefined;
  return (
    <div
      className={cn(
        "grid min-h-8 items-center gap-x-1 pr-1",
        animatable ? "grid-cols-[1.25rem_5.5rem_minmax(0,1fr)_auto_1.25rem] pl-1.5" : "grid-cols-[6.5rem_minmax(0,1fr)_1.25rem] pl-3",
      )}
      data-param={spec.key}
    >
      {animatable && (animation ?? <span />)}
      {expression ? (
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <span
              className={cn("truncate text-xs", expression.on ? "text-brand" : disabled ? "text-muted-foreground/60" : "text-muted-foreground")}
              title={expression.on ? `${label} (has an expression)` : label}
              data-has-expression={expression.on || undefined}
            >
              {label}
            </span>
          </ContextMenuTrigger>
          <ContextMenuContent className="w-52">
            <ContextMenuItem onSelect={expression.toggle}>
              <PiFunction /> {expression.on ? "Remove expression" : "Add expression"}
            </ContextMenuItem>
            <ContextMenuItem disabled={!changed || disabled} onSelect={edit.reset}>
              <PiArrowCounterClockwise /> Reset {label}
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      ) : (
        <span className={cn("truncate text-xs", disabled ? "text-muted-foreground/60" : "text-muted-foreground")} title={label}>
          {label}
        </span>
      )}
      <div className="flex min-w-0 items-center">{control}</div>
      {animatable && (navigator ?? <span />)}
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

/** A path: how many points it has, and a switch that shows them on the Program monitor to edit. */
function PathControl({ spec, value, label, disabled, edit, owner }: ControlProps<PathSpec, BezierPath> & { owner?: { clipId: string; effectId: string } }) {
  const target = owner ? { ...owner, key: spec.key } : null;
  const editing = usePathEditing((s) => sameTarget(s.target, target));
  const count = value.vertices.length;
  return (
    <div className="ml-1 flex min-w-0 items-center gap-1.5">
      {target && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={`Edit ${label}`}
              aria-pressed={editing}
              disabled={disabled}
              onClick={() => {
                usePathEditing.getState().edit(editing ? null : target);
                useLayout.getState().setTool("select");
              }}
              className={cn(
                "flex h-7 cursor-pointer items-center gap-1 rounded-md px-2 text-xs transition-colors outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
                editing ? "bg-accent text-brand" : "bg-muted text-foreground",
              )}
            >
              <PiBezierCurve className="size-3.5" />
              {editing ? "Editing" : "Edit"}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Show its points on the monitor: drag them, ⌥-click to smooth, P to add more</TooltipContent>
        </Tooltip>
      )}
      <span className="truncate text-xs text-muted-foreground tabular-nums">
        {count} {count === 1 ? "point" : "points"}
        {count > 1 && !value.closed && ", open"}
      </span>
      {target && count > 1 && (
        <button
          type="button"
          className="ml-auto cursor-pointer truncate rounded px-1 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
          onClick={() => edit.set({ ...value, closed: !value.closed })}
        >
          {value.closed ? "Open it" : "Close it"}
        </button>
      )}
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

/** Room for a row of choice buttons (px), and roughly how wide a label's letters are at text-xs. */
const BUTTONS_WIDTH = 160;
const LETTER_PX = 6.4;

/** Whether a choice's options fit side by side as buttons; otherwise it's a menu. */
export function fitsAsButtons(options: readonly { label: string }[]): boolean {
  const each = BUTTONS_WIDTH / options.length;
  return options.length <= 4 && options.every((o) => o.label.length * LETTER_PX + 10 <= each);
}

function ChoiceControl({ spec, value, label, disabled, edit }: ControlProps<ChoiceSpec, string>) {
  if (!fitsAsButtons(spec.options)) {
    return (
      <Select value={value} onValueChange={(v) => edit.set(v)} disabled={disabled}>
        <SelectTrigger size="sm" aria-label={label} className="ml-1 h-7! w-full max-w-40 min-w-0 rounded px-2 text-xs shadow-none">
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper" align="start" className="max-h-80">
          {spec.options.map((o) => (
            <SelectItem key={o.value} value={o.value} className="text-xs">
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
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
