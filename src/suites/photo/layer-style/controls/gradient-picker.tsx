/**
 * A Layer Style page's Gradient row (docs/photo/layer-style/dialog.md, "Gradient and pattern pickers"): the
 * gradient over a checkerboard, which opens the Gradient Editor, and the arrow beside it, which opens the presets.
 *
 * The Gradient Editor is Photoshop's: the bar with opacity stops above it and colour stops below; a click above or
 * below adds a stop of that kind (taking the gradient's colour or opacity there), a stop dragged moves along the bar
 * and dragged well away comes off (one of each kind stays); the selected stop's Opacity or Color and Location below,
 * and the Method. Every edit calls `onChange` live, named "Custom"; Escape mid-drag puts the gradient back.
 * Midpoints aren't shown, but a gradient's are kept.
 */
import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { PiCaretDown } from "react-icons/pi";
import { cn } from "cn";
import { GRADIENT_PRESETS, gradientAt } from "@shared/photo/style/gradients";
import type { Gradient } from "@shared/photo/types";
import { ColorSwatchPicker } from "@/components/color-picker";
import { ScrubNumber } from "@/components/scrub-number";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { startPointerDrag } from "@/lib/pointer-drag";
import { ownerWindow } from "@/lib/window-events";
import {
  addGradientStop,
  type GradientStopKind,
  gradientStops,
  moveGradientStop,
  nearestStop,
  pulledOff,
  removeGradientStop,
  setGradientStop,
} from "./geometry";

/** The checkerboard under a gradient's transparent parts (content, the same in every theme). */
const CHECKER: CSSProperties = { background: "repeating-conic-gradient(#c8c8c8 0 25%, #f2f2f2 0 50%) 0 0 / 8px 8px" };

/** A gradient drawn across its box, a sample per device pixel column, over the checkerboard. */
export function GradientStrip({ gradient, className, style }: { gradient: Gradient; className?: string; style?: CSSProperties }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const draw = () => {
      const width = Math.max(1, Math.round(c.clientWidth * ownerWindow(c).devicePixelRatio));
      if (c.width !== width) c.width = width;
      c.height = 1;
      const ctx = c.getContext("2d");
      if (!ctx) return;
      const image = ctx.createImageData(width, 1);
      for (let x = 0; x < width; x++) {
        const [r, g, b, a] = gradientAt(gradient, width === 1 ? 0 : x / (width - 1));
        image.data.set([r * 255, g * 255, b * 255, a * 255], x * 4);
      }
      ctx.putImageData(image, 0, 0);
    };
    draw();
    const resized = new ResizeObserver(draw);
    resized.observe(c);
    return () => resized.disconnect();
  }, [gradient]);
  return (
    <div className={cn("relative overflow-hidden", className)} style={{ ...CHECKER, ...style }}>
      <canvas ref={canvas} className="absolute inset-0 size-full" aria-hidden />
    </div>
  );
}

export function GradientPicker({ value, onChange, disabled }: { value: Gradient; onChange: (gradient: Gradient) => void; disabled?: boolean }) {
  const [editing, setEditing] = useState(false);
  return (
    <div className={cn("inline-flex shrink-0 overflow-hidden rounded-sm border border-line", disabled && "opacity-50")} data-gradient-picker>
      <Popover open={editing} onOpenChange={setEditing}>
        <PopoverTrigger asChild disabled={disabled}>
          <button type="button" aria-label={`Gradient: ${value.name}. Edit the gradient`} className="block outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed">
            <GradientStrip gradient={value} style={{ width: 120, height: 22 }} />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 p-3" onOpenAutoFocus={(e) => e.preventDefault()}>
          <GradientEditor value={value} onChange={onChange} />
        </PopoverContent>
      </Popover>
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={disabled}>
          <button
            type="button"
            aria-label="Gradient presets"
            className="grid w-4 place-items-center border-l border-line bg-surface-2 text-muted-foreground outline-none hover:text-foreground hover:raised-hover focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed"
          >
            <PiCaretDown className="size-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-52">
          {GRADIENT_PRESETS.map((preset) => (
            <DropdownMenuItem key={preset.name} onSelect={() => onChange(preset)} className={cn(preset.name === value.name && "font-medium")}>
              <GradientStrip gradient={preset} className="h-4 w-14 shrink-0 rounded-[2px] border border-line" />
              {preset.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

const PERCENT = { min: 0, max: 100, step: 1, decimals: 0, unit: "%" };
const METHODS: { value: Gradient["method"]; label: string }[] = [
  { value: "classic", label: "Classic" },
  { value: "linear", label: "Linear" },
  { value: "perceptual", label: "Perceptual" },
];
const noop = () => {};

/** How near (px) a press must be to a stop to take it rather than add one. */
const HIT = 6;

type Selection = { kind: GradientStopKind; index: number } | null;

/** The Gradient Editor: the popover's content (its own, so a page could show it elsewhere). */
export function GradientEditor({ value, onChange }: { value: Gradient; onChange: (gradient: Gradient) => void }) {
  const [selection, setSelection] = useState<Selection>({ kind: "colour", index: 0 });
  const track = useRef<HTMLDivElement>(null);
  const selected = selection && selection.index < gradientStops(value, selection.kind).length ? selection : null;

  /** Drags stop `index` of `kind` in `base` (maybe with the stop just added); Escape puts `original` back. */
  const drag = (e: React.PointerEvent<Element>, base: Gradient, kind: GradientStopKind, index: number, original: Gradient) => {
    setSelection({ kind, index });
    const box = track.current!.getBoundingClientRect();
    startPointerDrag(e, {
      threshold: 1,
      cursor: "grabbing",
      onMove: (ev) => {
        const away = ev.clientY < box.top ? ev.clientY - box.top : ev.clientY > box.bottom ? ev.clientY - box.bottom : 0;
        if (pulledOff(away) && gradientStops(base, kind).length > 1) {
          onChange(removeGradientStop(base, kind, index));
          setSelection(null);
          return;
        }
        const moved = moveGradientStop(base, kind, index, (ev.clientX - box.left) / box.width);
        onChange(moved.gradient);
        setSelection({ kind, index: moved.index });
      },
      onCancel: () => {
        onChange(original);
        setSelection(null);
      },
    });
  };

  /** A press above (opacity) or below (colour) the bar: takes the stop there, or adds one. */
  const press = (e: React.PointerEvent<HTMLDivElement>, kind: GradientStopKind) => {
    if (e.button !== 0) return;
    e.preventDefault();
    track.current!.focus();
    const box = track.current!.getBoundingClientRect();
    const at = (e.clientX - box.left) / box.width;
    const near = nearestStop(gradientStops(value, kind), at, HIT / box.width);
    if (near >= 0) return drag(e, value, kind, near, value);
    const added = addGradientStop(value, kind, at);
    onChange(added.gradient);
    drag(e, added.gradient, kind, added.index, value);
  };

  const remove = () => {
    if (!selected) return;
    const next = removeGradientStop(value, selected.kind, selected.index);
    if (next === value) return;
    onChange(next);
    setSelection(null);
  };

  const opacity = selected?.kind === "opacity" ? value.opacities[selected.index] : null;
  const colour = selected?.kind === "colour" ? value.colours[selected.index] : null;
  const locate = (kind: GradientStopKind) => (percent: number) => {
    if (!selected || selected.kind !== kind) return;
    const moved = moveGradientStop(value, kind, selected.index, percent / 100);
    onChange(moved.gradient);
    setSelection({ kind, index: moved.index });
  };

  return (
    <div className="flex flex-col gap-3 text-xs" data-gradient-editor>
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium">Gradient Editor</span>
        <span className="truncate text-muted-foreground" data-gradient-name>
          {value.name}
        </span>
      </div>
      <div
        ref={track}
        tabIndex={0}
        role="application"
        aria-label="Gradient stops"
        className="relative mx-1.5 touch-none outline-none select-none"
        onKeyDown={(e) => {
          if (e.key !== "Delete" && e.key !== "Backspace") return;
          e.preventDefault();
          e.stopPropagation();
          remove();
        }}
      >
        <div className="relative h-4 cursor-pointer" data-stops="opacity" onPointerDown={(e) => press(e, "opacity")}>
          {value.opacities.map((s, i) => (
            <StopMarker key={i} at={s.at} kind="opacity" fill={grey(s.opacity)} selected={selected?.kind === "opacity" && selected.index === i} />
          ))}
        </div>
        <GradientStrip gradient={value} className="h-7 rounded-[2px] border border-line" />
        <div className="relative h-4 cursor-pointer" data-stops="colour" onPointerDown={(e) => press(e, "colour")}>
          {value.colours.map((s, i) => (
            <StopMarker key={i} at={s.at} kind="colour" fill={s.colour} selected={selected?.kind === "colour" && selected.index === i} />
          ))}
        </div>
      </div>
      <div className="grid grid-cols-[3.5rem_4.5rem_auto_1fr_auto] items-center gap-x-1.5 gap-y-1.5">
        <StopLabel on={!!opacity}>Opacity:</StopLabel>
        {opacity ? <ScrubNumber value={opacity.opacity * 100} display={PERCENT} label="Opacity" onBegin={noop} onChange={(v) => selected && onChange(setGradientStop(value, "opacity", selected.index, v / 100))} onEnd={noop} /> : <Blank />}
        <StopLabel on={!!opacity}>Location:</StopLabel>
        {opacity ? <ScrubNumber value={opacity.at * 100} display={PERCENT} label="Opacity stop location" onBegin={noop} onChange={locate("opacity")} onEnd={noop} /> : <Blank />}
        <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" disabled={!opacity || value.opacities.length < 2} onClick={remove}>
          Delete
        </Button>

        <StopLabel on={!!colour}>Color:</StopLabel>
        {colour && selected ? (
          <ColorSwatchPicker
            value={colour.colour}
            label="Stop colour"
            className="h-5 w-10"
            edit={{ begin: noop, set: (hex) => onChange(setGradientStop(value, "colour", selected.index, hex)), end: noop }}
          />
        ) : (
          <Blank />
        )}
        <StopLabel on={!!colour}>Location:</StopLabel>
        {colour ? <ScrubNumber value={colour.at * 100} display={PERCENT} label="Colour stop location" onBegin={noop} onChange={locate("colour")} onEnd={noop} /> : <Blank />}
        <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" disabled={!colour || value.colours.length < 2} onClick={remove}>
          Delete
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">Method:</span>
        <Select value={value.method} onValueChange={(method) => onChange({ ...value, name: "Custom", method: method as Gradient["method"] })}>
          <SelectTrigger size="sm" className="h-7 w-32 text-xs" aria-label="Method">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {METHODS.map((m) => (
              <SelectItem key={m.value} value={m.value} className="text-xs">
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

/** An opacity stop's fill: black when opaque, white when clear, as Photoshop's. */
const grey = (opacity: number) => {
  const v = Math.round((1 - opacity) * 255);
  return `rgb(${v} ${v} ${v})`;
};

/** A stop's marker: a little house pointing at the bar (down from above for opacity, up from below for colour). */
function StopMarker({ at, kind, fill, selected }: { at: number; kind: GradientStopKind; fill: string; selected: boolean }) {
  const d = kind === "opacity" ? "M1 1 H10 V9 L5.5 14 L1 9 Z" : "M5.5 1 L10 6 V14 H1 V6 Z";
  return (
    <svg
      className={cn("pointer-events-none absolute -translate-x-1/2 overflow-visible", kind === "opacity" ? "bottom-0" : "top-0", selected ? "text-brand" : "text-muted-foreground")}
      style={{ left: `${at * 100}%` }}
      width={11}
      height={15}
      viewBox="0 0 11 15"
      aria-hidden
      data-stop={kind}
      data-selected={selected || undefined}
    >
      <path d={d} fill={fill} stroke="currentColor" strokeWidth={selected ? 2 : 1} strokeLinejoin="round" />
    </svg>
  );
}

function StopLabel({ on, children }: { on: boolean; children: React.ReactNode }) {
  return <span className={cn("text-right", !on && "text-muted-foreground/60")}>{children}</span>;
}

const Blank = () => <span className="px-1 font-mono text-muted-foreground/60">–</span>;
