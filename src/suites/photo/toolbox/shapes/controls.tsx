/**
 * The shape tools' style controls (docs/photo/tools/shapes.md): fill and stroke swatches, the stroke's width and dash,
 * its alignment, caps and corners, the rectangle's radius, a line's heads, and the sloppiness with its fill style.
 * The options bar shows them for new shapes and the selected ones; Properties for one shape layer. Each change says
 * whether it's a one-off (one undo step) or part of a drag (begin, move…, end: one too).
 */
import { useRef } from "react";
import { cn } from "cn";
import { PiArrowsLeftRight, PiSlidersHorizontal } from "react-icons/pi";
import type { Arrowhead, ShapePaint } from "@shared/photo/types";
import { ARROWHEADS, MAX_STROKE_WIDTH } from "@shared/photo/shapes";
import { ColorPicker } from "@/components/color-picker";
import { ScrubNumber } from "@/components/scrub-number";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { PaintChoice, ShapeOptions } from "./options";

export type Phase = "once" | "begin" | "move" | "end";
export type OnShapeChange = (patch: Partial<ShapeOptions>, phase: Phase) => void;

/** What the controls show: the options, or a layer's paint and geometry as options. */
export type ControlValues = Pick<ShapeOptions, "fill" | "stroke" | "strokeWidth" | "dash" | "align" | "cap" | "join" | "sloppiness" | "fillStyle" | "radius" | "startHead" | "endHead">;

/** Which controls apply: a fill and an alignment for closed shapes, the radius for rectangles, heads for lines. */
export interface ControlSet {
  fill: boolean;
  radius: boolean;
  heads: boolean;
}

const WIDTH = { min: 0, max: MAX_STROKE_WIDTH, step: 1, decimals: 0, unit: "px" };
const RADIUS = { min: 0, max: 100_000, step: 1, decimals: 0, unit: "px" };

const HEAD_LABELS: Record<Arrowhead, string> = { none: "None", arrow: "Arrow", triangle: "Triangle", circle: "Dot", bar: "Bar", diamond: "Diamond" };

export function ShapeControls({ values, set, foreground, onChange, className }: { values: ControlValues; set: ControlSet; foreground: string; onChange: OnShapeChange; className?: string }) {
  const sloppy = values.sloppiness > 0;
  return (
    <div className={cn("flex items-center gap-3 text-xs whitespace-nowrap", className)} data-shape-controls>
      {set.fill && <PaintSwatch label="Fill" value={values.fill} foreground={foreground} onChange={(fill, phase) => onChange({ fill }, phase)} />}
      <PaintSwatch label="Stroke" value={values.stroke} foreground={foreground} onChange={(stroke, phase) => onChange({ stroke }, phase)} />
      <Scrub label="Width" value={values.strokeWidth} display={WIDTH} onChange={(strokeWidth, phase) => onChange({ strokeWidth }, phase)} />
      <DashSelect value={values.dash} onChange={(dash) => onChange({ dash }, "once")} />
      <StrokeMore values={values} closed={set.fill} onChange={onChange} />
      {set.radius && <Scrub label="Radius" value={values.radius} display={RADIUS} onChange={(radius, phase) => onChange({ radius }, phase)} />}
      {set.heads && <Heads start={values.startHead} end={values.endHead} onChange={(patch) => onChange(patch, "once")} />}
      <Sloppiness value={values.sloppiness} onChange={(sloppiness) => onChange({ sloppiness }, "once")} />
      {sloppy && set.fill && values.fill !== "none" && (
        <OptionSelect
          label="Fill style"
          value={values.fillStyle}
          options={[
            ["solid", "Solid"],
            ["hachure", "Hachure"],
            ["cross-hatch", "Cross-hatch"],
          ]}
          onChange={(fillStyle) => onChange({ fillStyle }, "once")}
        />
      )}
    </div>
  );
}

/** A labelled scrubby number, its drag one undo step. */
function Scrub({ label, value, display, onChange }: { label: string; value: number; display: typeof WIDTH; onChange: (v: number, phase: Phase) => void }) {
  const dragging = useRef(false);
  return (
    <span className="flex items-center gap-0.5" data-option={label}>
      <span className="text-muted-foreground">{label}</span>
      <ScrubNumber
        label={label}
        value={value}
        display={display}
        onBegin={() => {
          dragging.current = true;
          onChange(value, "begin");
        }}
        onChange={(v) => onChange(v, dragging.current ? "move" : "once")}
        onEnd={() => {
          if (!dragging.current) return;
          dragging.current = false;
          onChange(value, "end");
        }}
      />
    </span>
  );
}

/** A colour that can be none or the foreground colour: its swatch, and a popover to choose. */
export function PaintSwatch({ label, value, foreground, onChange }: { label: string; value: PaintChoice; foreground: string; onChange: (v: PaintChoice, phase: Phase) => void }) {
  const shown = value === "foreground" ? foreground : value === "none" ? null : value;
  return (
    <span className="flex items-center gap-1" data-option={label}>
      <span className="text-muted-foreground">{label}</span>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`${label}: ${value === "none" ? "none" : value === "foreground" ? "the foreground colour" : value}`}
            className="relative size-5 shrink-0 overflow-hidden rounded border border-line shadow-xs"
            style={shown ? { background: shown } : undefined}
            data-paint={value}
          >
            {!shown && <NoneMark />}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="flex w-60 flex-col gap-2 p-2.5" onOpenAutoFocus={(e) => e.preventDefault()} data-paint-popover={label}>
          <div className="flex gap-1.5">
            <Button size="sm" variant={value === "none" ? "secondary" : "outline"} className="flex-1" onClick={() => onChange("none", "once")} data-paint-choice="none">
              <span className="relative size-3.5 overflow-hidden rounded-sm border border-line">
                <NoneMark />
              </span>
              None
            </Button>
            <Button size="sm" variant={value === "foreground" ? "secondary" : "outline"} className="flex-1" onClick={() => onChange("foreground", "once")} title="The foreground colour (the tool strip's), following it" data-paint-choice="foreground">
              <span className="size-3.5 rounded-sm border border-line" style={{ background: foreground }} />
              Foreground
            </Button>
          </div>
          <ColorPicker
            value={shown ?? foreground}
            edit={{ begin: () => onChange(shown ?? foreground, "begin"), set: (hex) => onChange(hex, "move"), end: () => onChange(value, "end") }}
          />
        </PopoverContent>
      </Popover>
    </span>
  );
}

/** "None": a white square struck through in red, as Photoshop shows a fill or stroke that's off. */
function NoneMark() {
  return (
    <svg viewBox="0 0 10 10" className="absolute inset-0 size-full bg-white" aria-hidden>
      <line x1="0" y1="10" x2="10" y2="0" stroke="#e5484d" strokeWidth="1.2" />
    </svg>
  );
}

/** A menu of choices; `shown` is what its button shows of the one chosen (a picture alone, where room is short). */
function OptionSelect<T extends string>({
  label,
  value,
  options,
  onChange,
  width = "w-28",
  shown,
}: {
  label: string;
  value: T;
  options: [T, React.ReactNode][];
  onChange: (v: T) => void;
  width?: string;
  shown?: (v: T) => React.ReactNode;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as T)}>
      <SelectTrigger size="sm" className={cn("h-6 text-xs", width)} aria-label={label} title={label} data-option={label} data-value={value}>
        {shown ? shown(value) : options.find(([v]) => v === value)?.[1]}
      </SelectTrigger>
      <SelectContent>
        {options.map(([v, text]) => (
          <SelectItem key={v} value={v} data-value={v}>
            {text}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** A dash's look, drawn: the menu shows them rather than names alone. */
function DashSample({ dash }: { dash: ShapePaint["dash"] }) {
  return (
    <svg viewBox="0 0 28 6" className="h-1.5 w-7" aria-hidden>
      <line x1="2" y1="3" x2="26" y2="3" stroke="currentColor" strokeWidth="2" strokeLinecap={dash === "dotted" ? "round" : "butt"} strokeDasharray={dash === "dashed" ? "6 3" : dash === "dotted" ? "0 4" : undefined} />
    </svg>
  );
}

function DashSelect({ value, onChange }: { value: ShapePaint["dash"]; onChange: (v: ShapePaint["dash"]) => void }) {
  const option = (dash: ShapePaint["dash"], text: string): [ShapePaint["dash"], React.ReactNode] => [
    dash,
    <span key={dash} className="flex items-center gap-1.5">
      <DashSample dash={dash} />
      {text}
    </span>,
  ];
  return <OptionSelect label="Stroke style" value={value} width="w-14" shown={(dash) => <DashSample dash={dash} />} options={[option("solid", "Solid"), option("dashed", "Dashed"), option("dotted", "Dotted")]} onChange={onChange} />;
}

/** Photoshop's stroke options popover: where the stroke sits, its caps and its corners. */
function StrokeMore({ values, closed, onChange }: { values: ControlValues; closed: boolean; onChange: OnShapeChange }) {
  const row = <T extends string>(label: string, value: T, items: [T, string][], set: (v: T) => void) => (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <ToggleGroup type="single" size="sm" variant="outline" value={value} onValueChange={(v) => v && set(v as T)} aria-label={label}>
        {items.map(([v, text]) => (
          <ToggleGroupItem key={v} value={v} className="px-2 text-xs" data-value={v}>
            {text}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Stroke options" title="Stroke options: alignment, caps, corners" data-option="Stroke options">
          <PiSlidersHorizontal className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="flex w-72 flex-col gap-2 p-2.5 text-xs">
        {closed &&
          row("Align", values.align, [
            ["inside", "Inside"],
            ["centre", "Centre"],
            ["outside", "Outside"],
          ], (align) => onChange({ align }, "once"))}
        {row("Caps", values.cap, [
          ["butt", "Butt"],
          ["round", "Round"],
          ["square", "Square"],
        ], (cap) => onChange({ cap }, "once"))}
        {row("Corners", values.join, [
          ["miter", "Miter"],
          ["round", "Round"],
          ["bevel", "Bevel"],
        ], (join) => onChange({ join }, "once"))}
      </PopoverContent>
    </Popover>
  );
}

/** A head drawn small, pointing right (the end's) or left (the start's). */
function HeadSample({ head, start }: { head: Arrowhead; start?: boolean }) {
  const tip = start ? 3 : 21;
  const back = start ? 10 : 14;
  return (
    <svg viewBox="0 0 24 10" className="h-2.5 w-6" aria-hidden>
      <line x1={start ? (head === "triangle" || head === "diamond" ? back : 3) : 3} y1="5" x2={start ? 21 : head === "triangle" || head === "diamond" ? back : 21} y2="5" stroke="currentColor" strokeWidth="1.5" />
      {head === "arrow" && <polyline points={`${back},1.5 ${tip},5 ${back},8.5`} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />}
      {head === "triangle" && <polygon points={`${back},1.5 ${tip},5 ${back},8.5`} fill="currentColor" />}
      {head === "diamond" && <polygon points={`${(back + tip) / 2},2 ${tip},5 ${(back + tip) / 2},8 ${start ? tip + 7 : tip - 7},5`} fill="currentColor" />}
      {head === "circle" && <circle cx={tip} cy="5" r="2.6" fill="currentColor" />}
      {head === "bar" && <line x1={tip} y1="1" x2={tip} y2="9" stroke="currentColor" strokeWidth="1.5" />}
    </svg>
  );
}

function Heads({ start, end, onChange }: { start: Arrowhead; end: Arrowhead; onChange: (patch: { startHead?: Arrowhead; endHead?: Arrowhead }) => void }) {
  const options = (atStart: boolean) => ARROWHEADS.map((h): [Arrowhead, React.ReactNode] => [h, <span key={h} className="flex items-center gap-1.5"><HeadSample head={h} start={atStart} />{HEAD_LABELS[h]}</span>]);
  return (
    <span className="flex items-center gap-1" data-option="Arrowheads">
      <span className="text-muted-foreground">Heads</span>
      <OptionSelect label="Start head" value={start} width="w-14" shown={(h) => <HeadSample head={h} start />} options={options(true)} onChange={(startHead) => onChange({ startHead })} />
      <Button variant="ghost" size="icon-xs" aria-label="Swap the heads" title="Swap the heads" onClick={() => onChange({ startHead: end, endHead: start })}>
        <PiArrowsLeftRight />
      </Button>
      <OptionSelect label="End head" value={end} width="w-14" shown={(h) => <HeadSample head={h} />} options={options(false)} onChange={(endHead) => onChange({ endHead })} />
    </span>
  );
}

/** Excalidraw's Sloppiness: precise, Artist, Cartoonist, drawn as the line each makes. */
function Sloppiness({ value, onChange }: { value: 0 | 1 | 2; onChange: (v: 0 | 1 | 2) => void }) {
  const icons: Record<0 | 1 | 2, string> = { 0: "M2 9 C 7 3, 13 3, 18 9", 1: "M2 9 C 6 2, 11 5, 13 4 S 16 6, 18 9", 2: "M2 10 C 4 2, 7 9, 9 4 S 13 9, 14 3 S 17 8, 18 9" };
  const titles = { 0: "Precise", 1: "Hand-drawn: Artist", 2: "Hand-drawn: Cartoonist" };
  return (
    <ToggleGroup type="single" size="sm" variant="outline" value={String(value)} onValueChange={(v) => v && onChange(Number(v) as 0 | 1 | 2)} aria-label="Sloppiness" data-option="Sloppiness">
      {([0, 1, 2] as const).map((s) => (
        <ToggleGroupItem key={s} value={String(s)} aria-label={titles[s]} title={titles[s]} className="px-1.5" data-value={s}>
          <svg viewBox="0 0 20 12" className="h-3 w-5" aria-hidden>
            <path d={icons[s]} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
