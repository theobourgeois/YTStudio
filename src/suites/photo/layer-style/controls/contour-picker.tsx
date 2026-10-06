/**
 * A Layer Style page's Contour row (docs/photo/layer-style/dialog.md, "Contour (picker and editor)"): the contour's
 * thumbnail, which opens the Contour Editor, and the arrow beside it, which opens Photoshop's 12 presets. The
 * thumbnail is Photoshop's: white above the curve, dark below it.
 *
 * The Contour Editor is Curves' graph (panels/curves-editor.tsx) on 0..255 both ways: click to add a point and drag
 * it, drag a point to move it (the ends only up and down), drag it off the graph or press Delete to remove it;
 * Input and Output (%, as Photoshop's) scrub or type the selected point, Corner makes it a sharp corner. Every edit
 * calls `onChange` live, named "Custom"; Escape mid-drag puts the contour back.
 */
import { useMemo, useRef, useState } from "react";
import { PiCaretDown } from "react-icons/pi";
import { cn } from "cn";
import { CONTOUR_PRESETS } from "@shared/photo/style/contours";
import type { Contour, ContourPoint } from "@shared/photo/types";
import { ScrubNumber } from "@/components/scrub-number";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { startPointerDrag } from "@/lib/pointer-drag";
import {
  addContourPoint,
  contourArea,
  contourPath,
  moveContourPoint,
  nearestContourPoint,
  offGraph,
  removeContourPoint,
  setContourCorner,
} from "./geometry";

/** The thumbnail's two tones: content, as Photoshop draws it in every theme. */
const ABOVE = "#ffffff";
const BELOW = "#3b3b3b";

/** A contour's thumbnail: the area under its curve dark, above it white. */
export function ContourThumbnail({ contour, size = 32, className }: { contour: Contour; size?: number; className?: string }) {
  const area = useMemo(() => contourArea(contour), [contour]);
  return (
    <svg width={size} height={size} viewBox="0 0 255 255" preserveAspectRatio="none" className={cn("block shrink-0", className)} aria-hidden>
      <rect width={255} height={255} fill={ABOVE} />
      <path d={area} fill={BELOW} />
    </svg>
  );
}

export function ContourPicker({ value, onChange, disabled }: { value: Contour; onChange: (contour: Contour) => void; disabled?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [choosing, setChoosing] = useState(false);
  return (
    <div className={cn("inline-flex shrink-0 overflow-hidden rounded-sm border border-line", disabled && "opacity-50")} data-contour-picker>
      <Popover open={editing} onOpenChange={setEditing}>
        <PopoverTrigger asChild disabled={disabled}>
          <button type="button" aria-label={`Contour: ${value.name}. Edit the contour`} className="block outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed">
            <ContourThumbnail contour={value} />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-2.5" onOpenAutoFocus={(e) => e.preventDefault()}>
          <ContourEditor value={value} onChange={onChange} />
        </PopoverContent>
      </Popover>
      <Popover open={choosing} onOpenChange={setChoosing}>
        <PopoverTrigger asChild disabled={disabled}>
          <button
            type="button"
            aria-label="Contour presets"
            className="grid w-4 place-items-center border-l border-line bg-surface-2 text-muted-foreground outline-none hover:text-foreground hover:raised-hover focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed"
          >
            <PiCaretDown className="size-3" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-1.5" onOpenAutoFocus={(e) => e.preventDefault()}>
          <div role="listbox" aria-label="Contour presets" className="grid grid-cols-6 gap-1">
            {CONTOUR_PRESETS.map((preset) => (
              <Tooltip key={preset.name}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    role="option"
                    aria-selected={preset.name === value.name}
                    aria-label={preset.name}
                    className={cn("rounded-sm border p-px outline-none hover:border-brand focus-visible:ring-2 focus-visible:ring-ring/50", preset.name === value.name ? "border-brand" : "border-line")}
                    onClick={() => {
                      onChange(preset);
                      setChoosing(false);
                    }}
                  >
                    <ContourThumbnail contour={preset} size={30} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{preset.name}</TooltipContent>
              </Tooltip>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

const PERCENT = { min: 0, max: 100, step: 1, decimals: 0, unit: "%" };
const noop = () => {};

/** The Contour Editor: the popover's content (its own, so a page could show it elsewhere). */
export function ContourEditor({ value, onChange }: { value: Contour; onChange: (contour: Contour) => void }) {
  const [selected, setSelected] = useState<number | null>(null);
  const graph = useRef<SVGSVGElement>(null);
  const points = value.points;
  const index = selected !== null && selected < points.length ? selected : null;
  const point = index !== null ? points[index] : null;
  const isEnd = (i: number, list: readonly ContourPoint[]) => i === 0 || i === list.length - 1;
  const emit = (next: readonly ContourPoint[]) => onChange({ name: "Custom", points: [...next] });
  const curve = useMemo(() => contourPath(value), [value]);

  /** A pointer position in levels: input along the bottom, output up the side (may be past the graph). */
  const levelsAt = (clientX: number, clientY: number) => {
    const r = graph.current!.getBoundingClientRect();
    return { x: ((clientX - r.left) / r.width) * 255, y: (1 - (clientY - r.top) / r.height) * 255 };
  };

  /** Drags point `i` of `base` (the contour, maybe with the point just added); Escape puts `original` back. */
  const drag = (e: React.PointerEvent<Element>, base: readonly ContourPoint[], i: number, original: Contour) => {
    setSelected(i);
    startPointerDrag(e, {
      threshold: 0,
      cursor: "grabbing",
      onMove: (ev) => {
        const at = levelsAt(ev.clientX, ev.clientY);
        if (offGraph(at.x, at.y) && !isEnd(i, base)) {
          emit(removeContourPoint(base, i));
          setSelected(null);
        } else {
          emit(moveContourPoint(base, i, at.x, at.y));
          setSelected(i);
        }
      },
      onCancel: () => {
        onChange(original);
        setSelected(null);
      },
    });
  };

  const onGraphDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    graph.current!.focus();
    const at = levelsAt(e.clientX, e.clientY);
    const near = nearestContourPoint(points, at.x, at.y);
    if (near >= 0) return drag(e, points, near, value);
    const added = addContourPoint(points, at.x, at.y);
    if (!added) return;
    emit(added.points);
    drag(e, added.points, added.index, value);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (index === null || !point) return;
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      e.stopPropagation();
      if (isEnd(index, points)) return;
      emit(removeContourPoint(points, index));
      setSelected(null);
      return;
    }
    const by = e.shiftKey ? 10 : 1;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-by, 0], ArrowRight: [by, 0], ArrowUp: [0, by], ArrowDown: [0, -by] };
    const move = moves[e.key];
    if (!move) return;
    e.preventDefault();
    emit(moveContourPoint(points, index, point.x + move[0], point.y + move[1]));
  };

  return (
    <div className="flex flex-col gap-2 text-xs" data-contour-editor>
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium">Contour Editor</span>
        <span className="truncate text-muted-foreground" data-contour-name>
          {value.name}
        </span>
      </div>
      <svg
        ref={graph}
        viewBox="0 0 255 255"
        preserveAspectRatio="none"
        tabIndex={0}
        role="application"
        aria-label="Contour mapping"
        className="sunken aspect-square w-full cursor-crosshair touch-none overflow-visible rounded text-foreground outline-none"
        onPointerDown={onGraphDown}
        onKeyDown={onKey}
      >
        {[25.5, 51, 76.5, 102, 127.5, 153, 178.5, 204, 229.5].map((v) => (
          <g key={v} className="stroke-line" strokeWidth={v === 127.5 ? 0.9 : 0.5}>
            <line x1={v} y1={0} x2={v} y2={255} vectorEffect="non-scaling-stroke" />
            <line x1={0} y1={v} x2={255} y2={v} vectorEffect="non-scaling-stroke" />
          </g>
        ))}
        <path d={curve} fill="none" stroke="currentColor" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        {points.map((p, i) => (
          <rect
            key={i}
            x={p.x - 3.5}
            y={255 - p.y - 3.5}
            width={7}
            height={7}
            transform={p.corner ? `rotate(45 ${p.x} ${255 - p.y})` : undefined}
            className={cn("cursor-grab", i === index ? "fill-foreground" : "fill-surface-1")}
            stroke="currentColor"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
            data-point={i}
          />
        ))}
      </svg>
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1">
          <span className="text-muted-foreground">Input:</span>
          <ScrubNumber
            value={point ? (point.x / 255) * 100 : 0}
            display={PERCENT}
            label="Input"
            disabled={!point || index === null || isEnd(index, points)}
            onBegin={noop}
            onChange={(v) => index !== null && point && emit(moveContourPoint(points, index, (v / 100) * 255, point.y))}
            onEnd={noop}
          />
        </span>
        <span className="flex items-center gap-1">
          <span className="text-muted-foreground">Output:</span>
          <ScrubNumber
            value={point ? (point.y / 255) * 100 : 0}
            display={PERCENT}
            label="Output"
            disabled={!point}
            onBegin={noop}
            onChange={(v) => index !== null && point && emit(moveContourPoint(points, index, point.x, (v / 100) * 255))}
            onEnd={noop}
          />
        </span>
        <label className={cn("ml-auto flex items-center gap-1.5", !point && "text-muted-foreground")}>
          <input
            type="checkbox"
            disabled={!point}
            checked={point?.corner === true}
            onChange={(e) => index !== null && emit(setContourCorner(points, index, e.target.checked))}
            className="accent-[var(--brand)]"
          />
          Corner
        </label>
      </div>
    </div>
  );
}
