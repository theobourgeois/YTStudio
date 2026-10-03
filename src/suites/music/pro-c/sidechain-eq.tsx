/**
 * Pro-C's side chain EQ (`docs/fabfilter/pro-c.md` 2.6): up to six of Pro-Q's bands shaping what the
 * detector hears (not the sound), on Pro-Q's scales and curves (`pro-q/geometry.ts`, `curveOf`). Double-
 * click the background for a band (its shape from where: a Low Cut at the far left, a High Cut at the
 * right, a Notch along the bottom, else a Bell); drag a dot for its frequency and gain (a cut's or notch's
 * height is its Q); the wheel over a dot for its Q (a cut's slope); Alt-click to bypass it; right-click
 * for its shape, slope, placement (stereo, mid or side) and Delete. A drag is one undo step.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "cn";
import { clamp } from "@shared/math";
import { PLACEMENT_NAMES, SHAPE_NAMES, frequencyText, gainText, qText, slopeText } from "@shared/music/pro-q";
import { EQ_MAX_FREQUENCY, EQ_MAX_Q, EQ_MIN_FREQUENCY, EQ_MIN_Q, hasGain, shapeSlopes, usesQ } from "@shared/music/pro-q-presets";
import { addSidechainBand, editSidechainBands } from "@shared/music/pro-c";
import { PRO_C_BANDS } from "@shared/music/pro-c-presets";
import { EQ_SHAPES, type EqBand, type EqPlacement, type MusicProject } from "@shared/music/types";
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { startPointerDrag } from "@/lib/pointer-drag";
import { prepare } from "../piano/draw";
import { alpha as eqAlpha, bandColour, curveOf } from "../pro-q/draw";
import { type EqView, bandAt, curveFrequencies, dbAt, dotOf, frequencyLines, hzAt, qAtHeight, shapeForClick, xOf, yOf, zeroY } from "../pro-q/geometry";
import { ShapeIcon } from "../pro-q/shape-icon";
import { songGesture, useMusic } from "../store";
import { readCompPalette } from "./draw";

const commit = (update: (song: MusicProject) => MusicProject) => useMusic.getState().commit(update);
/** The gain the scale shows either way of 0 dB. */
const RANGE = 24;
const PLACEMENTS: EqPlacement[] = ["stereo", "mid", "side"];

export function SidechainEq({ effectId, bands }: { effectId: string; bands: readonly EqBand[] }) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 500, height: 160 });
  const [selected, setSelected] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [menuBand, setMenuBand] = useState<number | null>(null);
  const view: EqView = useMemo(() => ({ width: size.width, height: size.height, low: EQ_MIN_FREQUENCY, high: EQ_MAX_FREQUENCY, range: RANGE, analyzerRange: 90, top: 10, bottom: 16 }), [size]);
  const frequencies = useMemo(() => curveFrequencies(view, 2), [view]);
  const bandsRef = useRef(bands);
  bandsRef.current = bands;

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setSize({ width: element.clientWidth, height: element.clientHeight }));
    observer.observe(element);
    setSize({ width: element.clientWidth, height: element.clientHeight });
    return () => observer.disconnect();
  }, []);
  // A band undone away: not selected.
  useEffect(() => {
    if (selected !== null && !bands.some((b) => b.id === selected)) setSelected(null);
  }, [bands, selected]);

  // Drawn when anything it shows changes.
  useEffect(() => {
    const element = canvas.current;
    const ctx = element && prepare(element, view.width, view.height);
    if (!element || !ctx) return;
    drawEq(ctx, view, frequencies, bands, selected, hover, element);
  }, [view, frequencies, bands, selected, hover]);

  const local = (e: { clientX: number; clientY: number }) => {
    const rect = box.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const edit = (id: number, change: (band: EqBand) => EqBand) => (s: MusicProject) => editSidechainBands(s, effectId, [id], change);

  // The wheel over a dot: its Q (a cut's slope, a step a notch). Scrolls in a row are one change.
  const wheel = useRef<{ gesture: ReturnType<typeof songGesture>; timer: ReturnType<typeof setTimeout> } | null>(null);
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const onWheel = (e: WheelEvent) => {
      const p = local(e);
      const band = bandAt(view, bandsRef.current, p.x, p.y);
      if (!band || e.deltaY === 0) return;
      e.preventDefault();
      const up = e.deltaY < 0;
      const change = (b: EqBand): EqBand => {
        if (!usesQ(b) || b.shape === "lowCut" || b.shape === "highCut") {
          const slopes = shapeSlopes(b.shape);
          const at = slopes.indexOf(b.slope);
          return { ...b, slope: slopes[clamp(at + (up ? 1 : -1), 0, slopes.length - 1)] };
        }
        return { ...b, q: Math.round(clamp(b.q * (up ? 1.12 : 1 / 1.12), EQ_MIN_Q, EQ_MAX_Q) * 1000) / 1000 };
      };
      if (!wheel.current) {
        const gesture = songGesture();
        gesture.begin();
        wheel.current = { gesture, timer: setTimeout(() => {}, 0) };
      }
      clearTimeout(wheel.current.timer);
      wheel.current.gesture.apply(edit(band.id, change));
      wheel.current.timer = setTimeout(() => {
        wheel.current?.gesture.end();
        wheel.current = null;
      }, 400);
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [view, effectId]); // eslint-disable-line react-hooks/exhaustive-deps

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const p = local(e);
    const band = bandAt(view, bands, p.x, p.y);
    if (!band) {
      setSelected(null);
      return;
    }
    setSelected(band.id);
    if (e.altKey) {
      commit(edit(band.id, (b) => ({ ...b, enabled: !b.enabled })));
      return;
    }
    const gesture = songGesture();
    const start = dotOf(view, band);
    const from = local(e);
    startPointerDrag(e, {
      threshold: 2,
      cursor: "grabbing",
      onStart: () => gesture.begin(),
      onMove(ev) {
        const at = local(ev);
        const fine = ev.shiftKey ? 0.15 : 1;
        const x = start.x + (at.x - from.x) * fine;
        const y = start.y + (at.y - from.y) * fine;
        const frequency = Math.round(clamp(hzAt(view, x), EQ_MIN_FREQUENCY, EQ_MAX_FREQUENCY) * 10) / 10;
        const db = clamp(dbAt(view, y), -RANGE, RANGE);
        gesture.apply(edit(band.id, (b) => (hasGain(b.shape) ? { ...b, frequency, gain: Math.round(db * 10) / 10 } : { ...b, frequency, q: Math.round(clamp(qAtHeight(db, RANGE), EQ_MIN_Q, EQ_MAX_Q) * 1000) / 1000 })));
      },
      onEnd: () => gesture.end(),
      onCancel: () => gesture.cancel(),
    });
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const p = local(e);
    if (bandAt(view, bands, p.x, p.y)) return;
    if (bands.length >= PRO_C_BANDS) return;
    const shape = shapeForClick(view, p.x, p.y);
    const frequency = Math.round(clamp(hzAt(view, p.x), EQ_MIN_FREQUENCY, EQ_MAX_FREQUENCY));
    const gain = hasGain(shape) ? Math.round(clamp(dbAt(view, p.y), -RANGE, RANGE) * 10) / 10 : 0;
    let made: number | null = null;
    commit((s) => {
      const { song, id } = addSidechainBand(s, effectId, { shape, frequency, gain, q: 1, slope: 12, placement: "stereo" });
      made = id;
      return song;
    });
    if (made !== null) setSelected(made);
  };

  const shown = bands.find((b) => b.id === (hover ?? selected)) ?? null;
  const menu = menuBand !== null ? (bands.find((b) => b.id === menuBand) ?? null) : null;
  return (
    <div className="relative min-w-0 flex-1 overflow-hidden" data-testid="pro-c-sidechain-eq">
      <ContextMenu onOpenChange={(open) => !open && setMenuBand(null)}>
        <ContextMenuTrigger
          asChild
          onContextMenu={(e) => {
            const band = bandAt(view, bands, local(e).x, local(e).y);
            if (!band) {
              e.preventDefault();
              return;
            }
            setSelected(band.id);
            setMenuBand(band.id);
          }}
        >
          <div
            ref={box}
            className={cn("absolute inset-0 touch-none", hover !== null ? "cursor-grab" : "cursor-crosshair")}
            onPointerDown={onPointerDown}
            onPointerMove={(e) => {
              const band = bandAt(view, bands, local(e).x, local(e).y);
              if ((band?.id ?? null) !== hover) setHover(band?.id ?? null);
            }}
            onPointerLeave={() => setHover(null)}
            onDoubleClick={onDoubleClick}
          >
            <canvas ref={canvas} className="absolute inset-0 size-full" />
          </div>
        </ContextMenuTrigger>
        {menu && (
          <ContextMenuContent className="w-48">
            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <ShapeIcon shape={menu.shape} className="mr-2 size-3.5" /> {SHAPE_NAMES[menu.shape]}
              </ContextMenuSubTrigger>
              <ContextMenuSubContent>
                <ContextMenuRadioGroup value={menu.shape} onValueChange={(shape) => commit(edit(menu.id, (b) => ({ ...b, shape: shape as EqBand["shape"], slope: shapeSlopes(shape as EqBand["shape"]).includes(b.slope) ? b.slope : 12 })))}>
                  {EQ_SHAPES.map((shape) => (
                    <ContextMenuRadioItem key={shape} value={shape}>
                      <ShapeIcon shape={shape} className="mr-2 size-3.5" /> {SHAPE_NAMES[shape]}
                    </ContextMenuRadioItem>
                  ))}
                </ContextMenuRadioGroup>
              </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuSub>
              <ContextMenuSubTrigger>Slope: {slopeText(menu.slope)}</ContextMenuSubTrigger>
              <ContextMenuSubContent>
                <ContextMenuRadioGroup value={String(menu.slope)} onValueChange={(slope) => commit(edit(menu.id, (b) => ({ ...b, slope: (slope === "brickwall" ? slope : Number(slope)) as EqBand["slope"] })))}>
                  {shapeSlopes(menu.shape).map((slope) => (
                    <ContextMenuRadioItem key={String(slope)} value={String(slope)}>
                      {slopeText(slope)}
                    </ContextMenuRadioItem>
                  ))}
                </ContextMenuRadioGroup>
              </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuSub>
              <ContextMenuSubTrigger>Placement: {PLACEMENT_NAMES[menu.placement]}</ContextMenuSubTrigger>
              <ContextMenuSubContent>
                <ContextMenuRadioGroup value={menu.placement} onValueChange={(placement) => commit(edit(menu.id, (b) => ({ ...b, placement: placement as EqPlacement })))}>
                  {PLACEMENTS.map((p) => (
                    <ContextMenuRadioItem key={p} value={p}>
                      {PLACEMENT_NAMES[p]}
                    </ContextMenuRadioItem>
                  ))}
                </ContextMenuRadioGroup>
              </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuSeparator />
            <ContextMenuCheckboxItem checked={menu.enabled} onSelect={() => commit(edit(menu.id, (b) => ({ ...b, enabled: !b.enabled })))}>
              Enabled
            </ContextMenuCheckboxItem>
            <ContextMenuItem variant="destructive" onSelect={() => commit((s) => editSidechainBands(s, effectId, [menu.id], null))}>
              Delete band
            </ContextMenuItem>
          </ContextMenuContent>
        )}
      </ContextMenu>

      {/* The band under the pointer (or selected): what it is. */}
      {shown && <BandReadout band={shown} view={view} />}
      {bands.length === 0 && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-[11px] text-[var(--comp-label)]">Double-click to shape what the compressor hears (up to {PRO_C_BANDS} bands)</div>
      )}
    </div>
  );
}

/** A band's values beside its dot. */
function BandReadout({ band, view }: { band: EqBand; view: EqView }) {
  const dot = dotOf(view, band);
  const left = clamp(dot.x + 12, 4, view.width - 150);
  const top = clamp(dot.y - 34, 2, view.height - 40);
  return (
    <div
      className="pointer-events-none absolute z-10 rounded-[5px] border border-[var(--comp-panel-edge)] bg-[var(--comp-bar)]/90 px-2 py-1 text-[10px] leading-[14px] whitespace-nowrap text-[var(--comp-text)] tabular-nums shadow-lg"
      style={{ left, top }}
      data-testid="pro-c-band-readout"
    >
      <div className="flex items-center gap-1 font-semibold" style={{ color: bandColour(band.id) }}>
        <ShapeIcon shape={band.shape} className="size-3" /> {SHAPE_NAMES[band.shape]}
        {band.placement !== "stereo" && <span className="text-[var(--comp-label)]">· {PLACEMENT_NAMES[band.placement]}</span>}
        {!band.enabled && <span className="text-[var(--comp-label)]">· off</span>}
      </div>
      <div>
        {frequencyText(band.frequency)}
        {hasGain(band.shape) ? ` · ${gainText(band.gain)}` : ""}
        {usesQ(band) && band.shape !== "lowCut" && band.shape !== "highCut" ? ` · Q ${qText(band.q)}` : ` · ${slopeText(band.slope)}`}
      </div>
    </div>
  );
}

function drawEq(ctx: CanvasRenderingContext2D, view: EqView, frequencies: Float64Array, bands: readonly EqBand[], selected: number | null, hover: number | null, element: Element) {
  const c = readCompPalette(element);
  const { width, height } = view;
  ctx.clearRect(0, 0, width, height);
  const bg = ctx.createLinearGradient(0, 0, 0, height);
  bg.addColorStop(0, c.bgTop);
  bg.addColorStop(1, c.bgBottom);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  // The grid: frequencies across, labelled along the bottom; gains every 6 dB, 0 brighter.
  ctx.font = `9px ${c.font}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  for (const line of frequencyLines(view)) {
    const x = Math.round(xOf(view, line.hz)) + 0.5;
    ctx.fillStyle = line.label ? c.gridStrong : c.grid;
    ctx.fillRect(x, view.top, 1, height - view.top - view.bottom);
    if (line.label && x > 10 && x < width - 10) {
      ctx.fillStyle = c.label;
      ctx.fillText(line.label, x, height - 3);
    }
  }
  for (const db of [-18, -12, -6, 6, 12, 18]) {
    ctx.fillStyle = c.grid;
    ctx.fillRect(0, Math.round(yOf(view, db)) + 0.5, width, 1);
  }
  ctx.fillStyle = c.gridStrong;
  ctx.fillRect(0, Math.round(zeroY(view)) + 0.5, width, 1);

  const enabled = bands.filter((b) => b.enabled);
  const xs = Array.from(frequencies, (hz) => xOf(view, hz));
  // Each band's own curve, faint (lit while it's selected or under the pointer).
  for (const band of bands) {
    const curve = curveOf(band, band.gain, frequencies);
    const lit = band.id === selected || band.id === hover;
    ctx.beginPath();
    for (let i = 0; i < xs.length; i++) {
      const y = yOf(view, clamp(curve[i], -RANGE * 1.3, RANGE * 1.3));
      if (i === 0) ctx.moveTo(xs[i], y);
      else ctx.lineTo(xs[i], y);
    }
    ctx.strokeStyle = eqAlpha(bandColour(band.id), band.enabled ? (lit ? 0.9 : 0.4) : 0.15);
    ctx.lineWidth = lit ? 1.5 : 1;
    ctx.stroke();
    if (lit && band.enabled) {
      ctx.lineTo(xs[xs.length - 1], zeroY(view));
      ctx.lineTo(xs[0], zeroY(view));
      ctx.closePath();
      ctx.fillStyle = eqAlpha(bandColour(band.id), 0.12);
      ctx.fill();
    }
  }
  // The whole EQ: what the detector hears through it, yellow.
  const sum = new Float64Array(frequencies.length);
  for (const band of enabled) {
    const curve = curveOf(band, band.gain, frequencies);
    for (let i = 0; i < sum.length; i++) sum[i] += curve[i];
  }
  ctx.save();
  ctx.beginPath();
  for (let i = 0; i < xs.length; i++) {
    const y = yOf(view, clamp(sum[i], -RANGE * 1.4, RANGE * 1.4));
    if (i === 0) ctx.moveTo(xs[i], y);
    else ctx.lineTo(xs[i], y);
  }
  ctx.strokeStyle = c.arc;
  ctx.lineWidth = 2;
  ctx.shadowColor = "rgba(0, 0, 0, 0.6)";
  ctx.shadowBlur = 4;
  ctx.stroke();
  ctx.restore();

  // The dots: each band's colour, ringed while it's selected; a bypassed one hollow.
  for (const band of bands) {
    const { x, y } = dotOf(view, band);
    const colour = bandColour(band.id);
    ctx.beginPath();
    ctx.arc(x, clamp(y, view.top, height - view.bottom), band.id === selected ? 6.5 : 5.5, 0, Math.PI * 2);
    ctx.fillStyle = band.enabled ? colour : "rgba(0, 0, 0, 0.5)";
    ctx.fill();
    ctx.lineWidth = band.id === selected ? 2 : 1;
    ctx.strokeStyle = band.id === selected ? c.knee : band.enabled ? "rgba(0, 0, 0, 0.55)" : colour;
    ctx.stroke();
    if (band.placement !== "stereo") {
      ctx.font = `700 8px ${c.font}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = band.enabled ? "rgba(0, 0, 0, 0.75)" : colour;
      ctx.fillText(band.placement === "mid" ? "M" : "S", x, clamp(y, view.top, height - view.bottom) + 0.5);
    }
  }
}
