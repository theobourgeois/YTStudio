/**
 * The Gradient tool (G; docs/photo/tools/gradient.md): a drag lays a gradient along a line, Shift in 45° steps. In
 * Gradient mode it makes a Gradient Fill layer (a generator: `shared/photo/effects/gradient.ts`), or draws the active
 * one's line again; in Classic it paints into the active layer's pixels or mask on the GPU (`render/gradient.ts`),
 * limited by the selection. Either shows live while dragging and is one undo step when let go; Escape drops it. With a
 * Gradient Fill active, its widget is drawn over the canvas: ends, colour stops and midpoints to drag, the line to
 * move it all or click a stop onto, a double-click to pick a stop's colour.
 */
import { useEffect, useState } from "react";
import { cn } from "cn";
import { PiCheckSquareFill, PiSquare } from "react-icons/pi";
import { toast } from "sonner";
import { createId } from "@shared/ids";
import { BLEND_MODES, compositingOf } from "@shared/photo/blending";
import { addGeneratorLayer, findLayer, setEffectParams, setMask } from "@shared/photo/edits";
import { GRADIENT_FILL, GRADIENT_TYPE_DESCRIPTIONS, GRADIENT_TYPE_LABELS, GRADIENT_TYPES, type GradientFillShape, type GradientType, gradientFillShape } from "@shared/photo/effects/gradient";
import type { GradientPaintMode } from "@shared/photo/reference/gradient";
import type { DocPoint, Gradient } from "@shared/photo/types";
import { ColorPicker } from "@/components/color-picker";
import { type NumberDisplay, ScrubNumber } from "@/components/scrub-number";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectGroup, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { startPointerDrag } from "@/lib/pointer-drag";
import { addWindowListener } from "@/lib/window-events";
import { create } from "zustand";
import { useColours } from "../colours";
import { GradientPicker } from "../layer-style/controls/gradient-picker";
import { setGradientStop } from "../layer-style/controls/geometry";
import { liveRenderer } from "../live";
import { currentSelection, photoGesture, usePhoto, usePhotoDoc } from "../store";
import { usePhotoUi } from "../ui";
import { addStopOnLine, alongLine, constrainLine, dragMid, dragStop, gradientFillName, type Point, STOP_OFF, stopAtEnd, widgetLayout } from "./gradient-geometry";
import { type GradientOptions, classicGradient, classicPaint, liveParams, pickGradient, toolGradient, toolPresets, useGradientOptions } from "./gradient-options";
import { ClassicGradient } from "./gradient-actions";
import { gradientPlan, isGradientFill } from "./gradient-plan";
import type { DocPointOf, ToolKit } from "./kit";

/** The widget's state outside the document: the line being drawn, the selected stop, the stop whose colour is being picked. */
const useGradientWidget = create<{ drawing: { start: DocPoint; end: DocPoint } | null; stop: number | null; picking: number | null }>(() => ({ drawing: null, stop: null, picking: null }));

const round = (p: { x: number; y: number }): DocPoint => [Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100];

// --- the options bar ---

const PERCENT: NumberDisplay = { min: 0, max: 100, step: 1, decimals: 0, unit: "%" };
const METHODS: { value: Gradient["method"]; label: string; tip: string }[] = [
  { value: "perceptual", label: "Perceptual", tip: "Mixed as the eye sees colour (OKLab): even steps of brightness. Photoshop's default." },
  { value: "linear", label: "Linear", tip: "Mixed in linear light, as light mixes: brighter in the middle." },
  { value: "classic", label: "Classic", tip: "Photoshop's older way: the encoded values, eased between stops." },
  { value: "smooth", label: "Smooth", tip: "Perceptual, eased so nothing turns a corner at a stop." },
  { value: "stripes", label: "Stripes", tip: "No mixing: bands of the stops' colours." },
];
const PAINT_MODES: { value: GradientPaintMode; label: string; group: number }[] = [
  ...BLEND_MODES.slice(0, 2).map((m) => ({ value: m.id as GradientPaintMode, label: m.label, group: m.group })),
  { value: "behind", label: "Behind", group: 0 },
  { value: "clear", label: "Clear", group: 0 },
  ...BLEND_MODES.slice(2).map((m) => ({ value: m.id as GradientPaintMode, label: m.label, group: m.group })),
];

/** A type's button face: the gradient's shape drawn in bands of the text colour, as Photoshop's buttons show it. */
function TypeIcon({ type }: { type: GradientType }) {
  const steps = [1, 0.7, 0.45, 0.25, 0.1];
  return (
    <svg viewBox="0 0 16 16" className="size-4" aria-hidden>
      <rect x="0.5" y="0.5" width="15" height="15" rx="1.5" fill="none" stroke="currentColor" strokeOpacity={0.5} />
      {type === "linear" && steps.map((o, i) => <rect key={i} x={2 + i * 2.4} y={2} width={2.4} height={12} fill="currentColor" fillOpacity={o} />)}
      {type === "reflected" && [...steps].reverse().concat(steps.slice(1)).map((o, i) => <rect key={i} x={2 + i * (12 / 9)} y={2} width={12 / 9} height={12} fill="currentColor" fillOpacity={o} />)}
      {type === "radial" && steps.map((o, i) => <circle key={i} cx={8} cy={8} r={6 - i * 1.2} fill="currentColor" fillOpacity={1 - o} />).reverse()}
      {type === "diamond" && steps.map((o, i) => <path key={i} d={`M8 ${2 + i * 1.2}L${14 - i * 1.2} 8L8 ${14 - i * 1.2}L${2 + i * 1.2} 8Z`} fill="currentColor" fillOpacity={1 - o} />)}
      {type === "angle" &&
        Array.from({ length: 8 }, (_, i) => {
          const a = (i / 8) * Math.PI * 2;
          const b = ((i + 1) / 8) * Math.PI * 2;
          return <path key={i} d={`M8 8L${8 + 6 * Math.cos(a)} ${8 - 6 * Math.sin(a)}A6 6 0 0 0 ${8 + 6 * Math.cos(b)} ${8 - 6 * Math.sin(b)}Z`} fill="currentColor" fillOpacity={0.1 + (i / 7) * 0.9} />;
        })}
    </svg>
  );
}

/** An on/off option (a checkbox, as the options bar's others). */
function Check({ label, title, checked, onChange }: { label: string; title: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <button type="button" role="checkbox" aria-checked={checked} aria-label={label} title={title} className="flex items-center gap-1 text-muted-foreground hover:text-foreground" onClick={() => onChange(!checked)} data-option={label}>
      {checked ? <PiCheckSquareFill className="size-4 text-brand" /> : <PiSquare className="size-4" />}
      {label}
    </button>
  );
}

function GradientOptionsBar() {
  const o = useGradientOptions();
  const foreground = useColours((c) => c.foreground);
  const background = useColours((c) => c.background);
  const colours = { foreground, background };
  const set = (patch: Partial<GradientOptions>) => useGradientOptions.getState().set(patch);
  const classic = o.mode === "classic";
  const gradient = toolGradient(o, colours);
  return (
    <div className="flex shrink-0 items-center gap-3 text-xs whitespace-nowrap" data-tool-options="gradient">
      <Select value={o.mode} onValueChange={(mode) => set({ mode: mode as GradientOptions["mode"] })}>
        <SelectTrigger size="sm" className="h-6 w-32 text-xs" aria-label="Gradient mode" data-option="Mode switch">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="live" className="text-xs">
            Gradient
          </SelectItem>
          <SelectItem value="classic" className="text-xs">
            Classic gradient
          </SelectItem>
        </SelectContent>
      </Select>
      <GradientPicker value={gradient} presets={toolPresets(colours)} onChange={(g) => useGradientOptions.getState().set(pickGradient(useGradientOptions.getState(), g))} />
      <div className="flex items-center" role="radiogroup" aria-label="Gradient type">
        {GRADIENT_TYPES.map((type) => (
          <Tooltip key={type}>
            <TooltipTrigger asChild>
              <button
                type="button"
                role="radio"
                aria-checked={o.style === type}
                aria-label={`${GRADIENT_TYPE_LABELS[type]} gradient`}
                className={cn("grid size-6 place-items-center rounded-sm text-muted-foreground hover:text-foreground", o.style === type && "bg-accent text-foreground")}
                onClick={() => set({ style: type })}
                data-gradient-type={type}
              >
                <TypeIcon type={type} />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              {GRADIENT_TYPE_LABELS[type]}: {GRADIENT_TYPE_DESCRIPTIONS[type]}
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
      {classic && (
        <span className="flex items-center gap-1" data-option="Mode">
          <span className="text-muted-foreground">Mode</span>
          <Select value={o.paintMode} onValueChange={(paintMode) => set({ paintMode: paintMode as GradientPaintMode })}>
            <SelectTrigger size="sm" className="h-6 w-28 text-xs" aria-label="Paint mode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[0, 1, 2, 3, 4, 5].map((group) => (
                <SelectGroup key={group}>
                  {group > 0 && <SelectSeparator />}
                  {PAINT_MODES.filter((m) => m.group === group).map((m) => (
                    <SelectItem key={m.value} value={m.value} className="text-xs">
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </span>
      )}
      {classic && (
        <span className="flex items-center gap-0.5" data-option="Opacity">
          <span className="text-muted-foreground">Opacity</span>
          <ScrubNumber label="Opacity" value={Math.round(o.opacity * 100)} display={PERCENT} onBegin={() => {}} onChange={(v) => set({ opacity: v / 100 })} onEnd={() => {}} />
        </span>
      )}
      <Check label="Reverse" title="Run the gradient from its last stop to its first" checked={o.reverse} onChange={(reverse) => set({ reverse })} />
      <Check label="Dither" title="A little noise, so the gradient never bands" checked={o.dither} onChange={(dither) => set({ dither })} />
      {classic && <Check label="Transparency" title="Use the gradient's opacity stops (off: it's opaque)" checked={o.transparency} onChange={(transparency) => set({ transparency })} />}
      <span className="flex items-center gap-1" data-option="Method">
        <span className="text-muted-foreground">Method</span>
        <Select value={o.method} onValueChange={(method) => set({ method: method as Gradient["method"] })}>
          <SelectTrigger size="sm" className="h-6 w-28 text-xs" aria-label="Method">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {METHODS.map((m) => (
              <SelectItem key={m.value} value={m.value} className="text-xs" title={m.tip}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </span>
    </div>
  );
}

// --- a drag on the canvas ---

/** A drag on the canvas: a new Gradient Fill, the active one's line again, or a Classic gradient (`gradientPlan`). */
function press(e: React.PointerEvent<HTMLDivElement>, docPoint: DocPointOf) {
  if (e.button !== 0) return;
  const history = usePhoto.getState().history;
  if (!history) return;
  const doc = history.doc.doc;
  const ui = usePhotoUi.getState();
  const o = useGradientOptions.getState();
  const colours = useColours.getState();
  useGradientWidget.setState({ stop: null, picking: null });
  const plan = gradientPlan(doc, ui.selectedLayerId, ui.target, o.mode);
  if (plan.kind === "error") return void toast.error(plan.message);
  if (plan.kind === "choice") return ui.setPaintChoice(plan.layerId);
  const from = round(docPoint(e.clientX, e.clientY));
  const lineTo = (ev: PointerEvent): DocPoint => {
    const to = round(docPoint(ev.clientX, ev.clientY));
    return ev.shiftKey ? constrainLine(from, to, 45) : to;
  };
  const show = (end: DocPoint | null) => useGradientWidget.setState({ drawing: end ? { start: from, end } : null });

  if (plan.kind === "classic") {
    const selection = currentSelection();
    const shape = (start: DocPoint, end: DocPoint): GradientFillShape => ({ style: o.style, start, end, gradient: classicGradient(o, colours), reverse: o.reverse, dither: o.dither });
    let stroke: ClassicGradient | null = null;
    startPointerDrag(e, {
      threshold: 3,
      onStart: () => {
        if (plan.addMask) {
          usePhoto.getState().commit((d) => setMask(d, plan.layerId, null));
          usePhotoUi.getState().setTarget("mask");
        }
        stroke = new ClassicGradient(plan.layerId, plan.part, selection, shape, classicPaint(o, compositingOf(doc)));
      },
      onMove: (ev) => {
        const end = lineTo(ev);
        show(end);
        stroke?.setLine(from, end);
      },
      onEnd: () => {
        show(null);
        void stroke?.end();
      },
      onCancel: () => {
        show(null);
        stroke?.cancel();
      },
    });
    return;
  }

  const gesture = photoGesture();
  const id = plan.kind === "redraw" ? plan.layerId : createId("layer");
  const name = gradientFillName(doc);
  startPointerDrag(e, {
    threshold: 3,
    onStart: () => gesture.begin(),
    onMove: (ev) => {
      const end = lineTo(ev);
      show(end);
      gesture.apply((d) =>
        findLayer(d, id) ? setEffectParams(d, id, { start: from, end }) : addGeneratorLayer(d, { id, type: GRADIENT_FILL, name, params: liveParams(o, colours, from, end) }, plan.kind === "new" ? plan.above : null),
      );
    },
    onEnd: () => {
      show(null);
      void (async () => {
        // A new one with a selection shows only inside it: its mask, made from the selection, in the same undo step.
        const selection = plan.kind === "new" ? currentSelection() : null;
        if (selection) {
          try {
            const renderer = await liveRenderer();
            const now = usePhoto.getState().history?.doc.doc;
            if (renderer && now && findLayer(now, id)) {
              const mask = await renderer.maskFromSelection(now, id, selection);
              gesture.apply((d) => setMask(d, id, mask));
            }
          } catch (error) {
            toast.error("The selection couldn't become the gradient's mask", { description: String(error) });
          }
        }
        gesture.end();
        if (plan.kind === "new" && usePhoto.getState().history && findLayer(usePhoto.getState().history!.doc.doc, id)) usePhotoUi.getState().select(id);
      })();
    },
    onCancel: () => {
      show(null);
      gesture.cancel();
    },
  });
}

// --- the widget ---

/** The line being drawn, and the active Gradient Fill's widget. */
function GradientOverlay({ docPoint }: { docPoint: DocPointOf }) {
  const view = usePhotoUi((s) => s.view);
  const activeId = usePhotoUi((s) => s.selectedLayerId);
  const layer = usePhotoDoc((d) => {
    const l = activeId ? findLayer(d, activeId) : undefined;
    return isGradientFill(l) && l.visible ? l : null;
  });
  const drawing = useGradientWidget((s) => s.drawing);
  const selected = useGradientWidget((s) => s.stop);
  const picking = useGradientWidget((s) => s.picking);
  const [hover, setHover] = useState<number | null>(null);

  // Delete (or Backspace) takes the selected stop off, before the editor's keys (which would delete the layer).
  useEffect(
    () =>
      addWindowListener(
        "keydown",
        (e) => {
          const stop = useGradientWidget.getState().stop;
          if (stop === null || (e.key !== "Delete" && e.key !== "Backspace")) return;
          const target = e.target as HTMLElement | null;
          if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
          const l = usePhoto.getState().history?.doc.doc.layers.find((x) => x.id === usePhotoUi.getState().selectedLayerId);
          if (!isGradientFill(l)) return;
          e.preventDefault();
          e.stopPropagation();
          const g = l.effect.params.gradient as Gradient;
          if (g.colours.length > 2) usePhoto.getState().commit((d) => setEffectParams(d, l.id, { gradient: dragStop(g, stop, 0, false, true).gradient }));
          useGradientWidget.setState({ stop: null });
        },
        true,
      ),
    [],
  );
  // Another layer, or none: no stop is selected.
  useEffect(() => useGradientWidget.setState({ stop: null, picking: null }), [activeId]);

  if (!view) return null;
  const dpr = devicePixelRatio;
  const screen = ([x, y]: DocPoint): Point => ({ x: ((x - view.x) * view.zoom) / dpr, y: ((y - view.y) * view.zoom) / dpr });
  const line = drawing ?? (layer ? { start: layer.effect.params.start as DocPoint, end: layer.effect.params.end as DocPoint } : null);
  if (!line) return null;
  const a = screen(line.start);
  const b = screen(line.end);
  const shape = layer ? gradientFillShape(layer.effect.params) : null;
  const widget = layer && shape && !drawing ? widgetLayout(shape.gradient, shape.reverse, a, b) : null;

  /** Edits the layer's parameters through one gesture while the pointer drags (`from` is where it was pressed). */
  const drag = (e: React.PointerEvent, onMove: (p: Point, ev: PointerEvent) => Record<string, unknown> | null, options: { threshold?: number; onClick?: () => void } = {}) => {
    if (e.button !== 0 || !layer) return;
    e.stopPropagation();
    // (No text selection from a double-click on a stop.)
    e.preventDefault();
    const gesture = photoGesture();
    const box = (e.currentTarget as Element).closest("svg")!.getBoundingClientRect();
    startPointerDrag(e, {
      threshold: options.threshold ?? 0,
      cursor: "grabbing",
      onStart: () => gesture.begin(),
      onMove: (ev) => {
        const patch = onMove({ x: ev.clientX - box.left, y: ev.clientY - box.top }, ev);
        if (patch) gesture.apply((d) => setEffectParams(d, layer.id, patch));
      },
      onEnd: () => gesture.end(),
      onCancel: () => gesture.cancel(),
      onClick: options.onClick,
    });
  };

  const pressEnd = (which: "start" | "end") => (e: React.PointerEvent) => {
    const other = which === "start" ? line.end : line.start;
    drag(e, (_p, ev) => {
      let to = round(docPoint(ev.clientX, ev.clientY));
      if (ev.shiftKey) to = constrainLine(other, to, 15);
      return { [which]: to };
    });
  };

  const pressLine = (e: React.PointerEvent) => {
    if (!layer || !shape || !widget) return;
    const box = (e.currentTarget as Element).closest("svg")!.getBoundingClientRect();
    const at = alongLine({ x: e.clientX - box.left, y: e.clientY - box.top }, a, b).t;
    const from = docPoint(e.clientX, e.clientY);
    // A click adds a stop there; a drag moves the whole gradient.
    drag(
      e,
      (_p, ev) => {
        const p = docPoint(ev.clientX, ev.clientY);
        const dx = p.x - from.x;
        const dy = p.y - from.y;
        return { start: round({ x: line.start[0] + dx, y: line.start[1] + dy }), end: round({ x: line.end[0] + dx, y: line.end[1] + dy }) };
      },
      {
        threshold: 3,
        onClick: () => {
          const added = addStopOnLine(shape.gradient, Math.max(0, Math.min(1, at)), shape.reverse);
          usePhoto.getState().commit((d) => setEffectParams(d, layer.id, { gradient: added.gradient }));
          useGradientWidget.setState({ stop: added.index });
        },
      },
    );
  };

  const pressStop = (index: number) => (e: React.PointerEvent) => {
    if (!shape) return;
    useGradientWidget.setState({ stop: index });
    const base = shape.gradient;
    // A stop at an end is that end's: its circle moves the end, unless it's dragged along the line.
    drag(
      e,
      (p) => {
        const { t, distance } = alongLine(p, a, b);
        const moved = dragStop(base, index, t, shape.reverse, distance > STOP_OFF);
        useGradientWidget.setState({ stop: moved.index < 0 ? null : moved.index });
        return { gradient: moved.gradient };
      },
      { threshold: 2 },
    );
  };

  const pressMid = (index: number) => (e: React.PointerEvent) => {
    if (!shape) return;
    const base = shape.gradient;
    drag(e, (p) => ({ gradient: dragMid(base, index, alongLine(p, a, b).t, shape.reverse) }), { threshold: 1 });
  };

  const stopColour = widget && picking !== null ? widget.stops.find((s) => s.index === picking) : undefined;

  return (
    <svg className="pointer-events-none absolute inset-0 size-full overflow-visible" data-gradient-widget={layer?.id ?? "drawing"}>
      {/* The line: dark under light, so it reads on any picture. */}
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="black" strokeOpacity={0.45} strokeWidth={3} />
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="white" strokeWidth={1.25} data-gradient-line={`${line.start.join(",")}>${line.end.join(",")}`} />
      {drawing && (
        <>
          <circle cx={a.x} cy={a.y} r={4} fill="white" stroke="black" strokeOpacity={0.5} />
          <circle cx={b.x} cy={b.y} r={4} fill="none" stroke="white" strokeWidth={1.5} />
        </>
      )}
      {widget && shape && (
        <>
          {/* The line's hit area: a click adds a stop (the + pointer), a drag moves it all. */}
          <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={12} className="pointer-events-auto cursor-copy" onPointerDown={pressLine} data-gradient-hit="line" />
          {(["start", "end"] as const).map((which) => {
            const p = which === "start" ? a : b;
            // A stop at this end fills its circle with its colour.
            const at = which === "start" ? (shape.reverse ? 1 : 0) : shape.reverse ? 0 : 1;
            const stop = shape.gradient.colours.find((s) => s.at === at);
            return (
              <g
                key={which}
                className="pointer-events-auto cursor-move"
                onPointerDown={pressEnd(which)}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  const index = stop ? shape.gradient.colours.indexOf(stop) : -1;
                  if (index >= 0) useGradientWidget.setState({ stop: index, picking: index });
                }}
                data-gradient-end={which}
                data-at={(which === "start" ? line.start : line.end).join(",")}
              >
                <circle cx={p.x} cy={p.y} r={11} fill="transparent" />
                <circle cx={p.x} cy={p.y} r={7.5} fill={stop?.colour ?? "none"} stroke="black" strokeOpacity={0.5} strokeWidth={3} />
                <circle cx={p.x} cy={p.y} r={7.5} fill="none" stroke="white" strokeWidth={1.5} />
              </g>
            );
          })}
          {widget.mids.map((m) => (
            <path
              key={`mid${m.index}`}
              d={`M${m.at.x} ${m.at.y - 4.5}L${m.at.x + 4.5} ${m.at.y}L${m.at.x} ${m.at.y + 4.5}L${m.at.x - 4.5} ${m.at.y}Z`}
              fill="white"
              stroke="black"
              strokeOpacity={0.5}
              className="pointer-events-auto cursor-ew-resize"
              onPointerDown={pressMid(m.index)}
              data-gradient-mid={m.index}
            />
          ))}
          {widget.stops.map((s) => {
            const atEnd = stopAtEnd(shape.gradient.colours[s.index].at);
            const on = selected === s.index;
            return (
              <g
                key={`stop${s.index}`}
                className={cn("pointer-events-auto", atEnd ? "cursor-move" : "cursor-ew-resize")}
                onPointerDown={atEnd ? undefined : pressStop(s.index)}
                onPointerEnter={() => setHover(s.index)}
                onPointerLeave={() => setHover(null)}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  useGradientWidget.setState({ stop: s.index, picking: s.index });
                }}
                data-gradient-stop={s.index}
                data-colour={s.colour}
                data-selected={on || undefined}
              >
                {!atEnd && <circle cx={s.at.x} cy={s.at.y} r={9} fill="transparent" />}
                <circle cx={s.at.x} cy={s.at.y} r={atEnd ? 4 : 5.5} fill={s.colour} stroke={on ? "var(--brand)" : "white"} strokeWidth={on || hover === s.index ? 2.5 : 1.5} pointerEvents={atEnd ? "none" : undefined} />
              </g>
            );
          })}
          {stopColour && layer && <StopColour key={picking} layerId={layer.id} index={stopColour.index} at={stopColour.at} colour={stopColour.colour} />}
        </>
      )}
    </svg>
  );
}

/** A stop's colour picked (a double-click on it): the app's colour picker by it, one undo step a pick or a drag. */
function StopColour({ layerId, index, at, colour }: { layerId: string; index: number; at: Point; colour: string }) {
  const [gesture] = useState(() => photoGesture());
  const setColour = (hex: string) =>
    gesture.apply((d) => {
      const l = findLayer(d, layerId);
      return isGradientFill(l) ? setEffectParams(d, layerId, { gradient: setGradientStop(l.effect.params.gradient as Gradient, "colour", index, hex) }) : d;
    });
  return (
    <foreignObject x={at.x} y={at.y} width={1} height={1} className="overflow-visible">
      <Popover open onOpenChange={(open) => !open && useGradientWidget.setState({ picking: null })}>
        <PopoverTrigger asChild>
          <span className="block size-px" />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-60 p-2.5" onOpenAutoFocus={(e) => e.preventDefault()} data-gradient-stop-colour={index}>
          <ColorPicker
            value={colour}
            edit={{
              begin: () => gesture.begin(),
              set: setColour,
              end: () => gesture.end(),
            }}
          />
        </PopoverContent>
      </Popover>
    </foreignObject>
  );
}

export const gradientKit: ToolKit = {
  Options: GradientOptionsBar,
  press,
  Overlay: GradientOverlay,
};
