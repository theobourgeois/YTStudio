/**
 * The Reverb's display (`docs/reverb/reverb.md` 4.6): DECAY (how long each frequency lasts) and SHAPE (the
 * reverb over time), a canvas drawn each frame something moves, with their gestures. On DECAY: a band's
 * dot dragged (frequency and multiplier; Shift fine, Alt one axis; several selected scale together), its
 * Q by the wheel, Alt-click bypasses it, a double-click on the empty display makes one (a notch near the
 * bottom), the curve dragged moves Decay, the Post EQ's handles drag; on SHAPE: the pre-delay's edge
 * dragged sideways, the slope dragged (Decay), the early cluster sideways (Distance), a double-click plays
 * a click through it. Right-click: its menu.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "cn";
import { clamp } from "@shared/math";
import { MULTIPLIER_TEXT, addDecayBand, decayCurve, editDecayBands, formatDecay, formatHz, naturalT60, reverbT60, shapeEnvelope, updateReverb } from "@shared/music/reverb";
import { REVERB_OCTAVES, naturalCurve } from "@shared/music/reverb-modes";
import { spectrumFrequency } from "@shared/music/pro-q-presets";
import { BAND_Q_RANGE, HIGH_CUT_RANGE, HIGH_SHELF_RANGE, INIT_REVERB, LOW_CUT_RANGE, LOW_SHELF_RANGE, MAX_PREDELAY, MAX_SHELF_GAIN, REVERB_DECAY_RANGE, isInfinite } from "@shared/music/reverb-presets";
import type { MusicProject, Reverb, ReverbBandShape } from "@shared/music/types";
import { ContextMenu, ContextMenuCheckboxItem, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu";
import { startPointerDrag } from "@/lib/pointer-drag";
import { prepare } from "../piano/draw";
import { songGesture, useMusic, useSong } from "../store";
import { auditionReverb, copyReverbCurve, pasteReverbCurve, setReverb } from "./actions";
import { drawDecay, drawShape, readVerbPalette } from "./draw";
import { type Plot, type PostHandle, bandPoint, freqX, hitBand, hitPost, levelY, multiplierAt, newBandAt, onCurve, shapeSpan, timeX, xFreq, xTime, yDb, yT60 } from "./geometry";
import { fall, latest } from "./live";
import { useVerbUi } from "./store";

/** Room round the plot: the scales at the left and right, the frequencies under it. */
const PAD = { left: 40, right: 30, top: 10, bottom: 20 };
const SHAPES: { shape: ReverbBandShape; label: string }[] = [
  { shape: "lowShelf", label: "Low shelf" },
  { shape: "bell", label: "Bell" },
  { shape: "highShelf", label: "High shelf" },
  { shape: "notch", label: "Notch" },
];

type Target = { kind: "band"; id: number } | { kind: "post"; handle: PostHandle } | { kind: "curve" } | { kind: "predelay" } | { kind: "slope" } | { kind: "early" } | null;

/** The label over what's touched. */
interface Readout {
  x: number;
  y: number;
  text: string;
}

export function ReverbDisplay({ effectId, reverb }: { effectId: string; reverb: Reverb }) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 760, height: 260 });
  const [hover, setHover] = useState<Target>(null);
  const [readout, setReadout] = useState<Readout | null>(null);
  const [menuTarget, setMenuTarget] = useState<Target>(null);
  const bpm = useSong((s) => s.settings.tempo);
  const selected = useVerbUi((s) => s.selected[effectId]) ?? NO_BANDS;
  const view = reverb.view.display;
  const plot: Plot = { left: PAD.left, top: PAD.top, width: Math.max(40, size.width - PAD.left - PAD.right), height: Math.max(40, size.height - PAD.top - PAD.bottom) };
  const t60 = useMemo(() => reverbT60(reverb), [reverb]);
  const natural = useMemo(() => REVERB_OCTAVES.map((f) => reverb.decay * naturalCurve(reverb.mode, reverb.decay, f)), [reverb.decay, reverb.mode]);
  const shape = useMemo(() => shapeEnvelope(reverb, bpm), [reverb, bpm]);

  const scene = useRef({ reverb, t60, natural, shape, plot, size, hover, selected, view });
  scene.current = { reverb, t60, natural, shape, plot, size, hover, selected, view };
  const dirty = useRef(true);
  useEffect(() => {
    dirty.current = true;
  });

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setSize({ width: element.clientWidth, height: element.clientHeight }));
    observer.observe(element);
    setSize({ width: element.clientWidth, height: element.clientHeight });
    return () => observer.disconnect();
  }, []);

  // Drawn every frame the analyzer moves, or when something changed.
  useEffect(() => {
    let frame = 0;
    const draw = () => {
      frame = requestAnimationFrame(draw);
      const element = canvas.current;
      if (!element) return;
      const s = scene.current;
      const now = performance.now();
      const live = latest(effectId, now);
      const spectrum = s.view === "decay" && s.reverb.view.analyzer ? fall(effectId, now, (i) => decayCurve(s.t60, spectrumFrequency(i))) : null;
      if (!dirty.current && !spectrum) return;
      dirty.current = false;
      const ctx = prepare(element, s.size.width, s.size.height);
      if (!ctx) return;
      const palette = readVerbPalette(element);
      if (s.view === "decay")
        drawDecay(ctx, {
          width: s.size.width,
          height: s.size.height,
          plot: s.plot,
          palette,
          reverb: s.reverb,
          t60: s.reverb.bandsBypass ? reverbT60({ ...s.reverb, bands: [] }) : s.t60,
          natural: s.natural,
          showNatural: s.reverb.view.natural,
          spectrum,
          frozen: s.reverb.freeze || isInfinite(s.reverb.decay) || !!live?.frozen,
          selected: s.selected,
          hover: s.hover?.kind === "band" ? s.hover.id : s.hover?.kind === "post" ? s.hover.handle : null,
          bypassed: s.reverb.bandsBypass,
        });
      else
        drawShape(ctx, {
          width: s.size.width,
          height: s.size.height,
          plot: s.plot,
          palette,
          shape: s.shape,
          span: shapeSpan(s.reverb),
          log: s.reverb.view.logTime,
          duck: s.reverb.duck,
          hover: s.hover?.kind === "predelay" || s.hover?.kind === "slope" || s.hover?.kind === "early" ? s.hover.kind : null,
        });
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [effectId]);

  /** What's under a point of the display. */
  const targetAt = (x: number, y: number): Target => {
    if (view === "decay") {
      const band = hitBand(reverb, plot, x, y);
      if (band !== null) return { kind: "band", id: band };
      const handle = hitPost(reverb, plot, x, y);
      if (handle) return { kind: "post", handle };
      if (!reverb.freeze && !isInfinite(reverb.decay) && onCurve(t60, plot, x, y)) return { kind: "curve" };
      return null;
    }
    const span = shapeSpan(reverb);
    const log = reverb.view.logTime;
    if (Math.abs(timeX(plot, shape.predelay, span, log) - x) <= 5) return { kind: "predelay" };
    const t = xTime(plot, x, span, log);
    if (t > shape.lateBuilt) {
      const db = shape.lateDb - (60 * (t - shape.lateBuilt)) / Math.max(0.05, shape.t60[5]);
      if (Math.abs(levelY(plot, db) - y) <= 7) return { kind: "slope" };
    }
    if (shape.early.length && t >= shape.early[0].at - 0.005 && t <= Math.max(...shape.early.map((e) => e.at)) + 0.005 && y > plot.top + plot.height * 0.3) return { kind: "early" };
    return null;
  };
  const local = (e: { clientX: number; clientY: number }) => {
    const rect = box.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const selectBands = (ids: number[]) => useVerbUi.setState({ selected: { ...useVerbUi.getState().selected, [effectId]: ids } });

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const { x, y } = local(e);
    const target = targetAt(x, y);
    if (!target) {
      if (view === "decay") selectBands([]);
      return;
    }
    e.preventDefault();
    const gesture = songGesture();
    const start = { x, y };
    const base = reverb;
    const span = shapeSpan(reverb);
    const log = reverb.view.logTime;
    let axis: "x" | "y" | null = null;
    let fine = e.shiftKey;
    // Dragged: where the pointer is, slowed by Shift, held to one axis by Alt.
    const at = (ev: PointerEvent) => {
      const p = local(ev);
      const k = fine ? 0.1 : 1;
      let dx = (p.x - start.x) * k;
      let dy = (p.y - start.y) * k;
      if (ev.altKey) {
        axis ??= Math.abs(dx) > Math.abs(dy) ? "x" : "y";
        if (axis === "x") dy = 0;
        else dx = 0;
      } else axis = null;
      return { dx, dy };
    };

    if (target.kind === "band") {
      const id = target.id;
      const band = base.bands.find((b) => b.id === id)!;
      const ids = e.shiftKey ? (selected.includes(id) ? selected.filter((b) => b !== id) : [...selected, id]) : selected.includes(id) ? selected : [id];
      selectBands(ids);
      const origin = bandPoint(base, band, plot);
      startPointerDrag(e, {
        threshold: 2,
        onStart: () => gesture.begin(),
        onMove(ev) {
          fine = ev.shiftKey;
          const { dx, dy } = at(ev);
          const frequency = Math.round(xFreq(plot, origin.x + dx));
          const multiplier = multiplierAt(base, frequency, origin.y + dy, plot);
          const ratio = multiplier / band.multiplier;
          gesture.apply((s) =>
            editDecayBands(s, effectId, ids, (b) => (b.id === id ? { ...b, frequency, multiplier } : { ...b, multiplier: clamp(base.bands.find((x) => x.id === b.id)!.multiplier * ratio, 0.25, 4) })),
          );
          setReadout({ x: freqX(plot, frequency), y: origin.y + dy, text: `${MULTIPLIER_TEXT(multiplier)} → ${formatDecay(naturalT60(base, frequency) * multiplier)} at ${formatHz(frequency)}` });
        },
        onEnd() {
          gesture.end();
          setReadout(null);
        },
        onCancel() {
          gesture.cancel();
          setReadout(null);
        },
        onClick() {
          // Alt-click: bypass the band.
          if (e.altKey) useMusic.getState().commit((s) => editDecayBands(s, effectId, [id], (b) => ({ ...b, enabled: !b.enabled })));
        },
      });
      return;
    }

    const drag = (move: (s: MusicProject, d: { dx: number; dy: number }, p: { x: number; y: number }) => MusicProject, say: (p: { x: number; y: number }) => string) =>
      startPointerDrag(e, {
        threshold: 2,
        onStart: () => gesture.begin(),
        onMove(ev) {
          fine = ev.shiftKey;
          const d = at(ev);
          const p = { x: start.x + d.dx, y: start.y + d.dy };
          gesture.apply((s) => move(s, d, p));
          setReadout({ x: p.x, y: p.y, text: say(p) });
        },
        onEnd() {
          gesture.end();
          setReadout(null);
        },
        onCancel() {
          gesture.cancel();
          setReadout(null);
        },
      });

    switch (target.kind) {
      case "post": {
        const handle = target.handle;
        drag(
          (s, _d, p) => {
            const f = xFreq(plot, p.x);
            if (handle === "lowCut") return updateReverb(s, effectId, { lowCut: clamp(Math.round(f), LOW_CUT_RANGE[0], LOW_CUT_RANGE[1]) });
            if (handle === "highCut") return updateReverb(s, effectId, { highCut: clamp(Math.round(f), HIGH_CUT_RANGE[0], HIGH_CUT_RANGE[1]) });
            const range = handle === "lowShelf" ? LOW_SHELF_RANGE : HIGH_SHELF_RANGE;
            const gain = clamp(Math.round(yDb(plot, p.y) * 2 * 10) / 10, -MAX_SHELF_GAIN, MAX_SHELF_GAIN);
            return updateReverb(s, effectId, { output: { [handle]: { frequency: clamp(Math.round(f), range[0], range[1]), gain } } });
          },
          (p) => (handle === "lowCut" || handle === "highCut" ? `${handle === "lowCut" ? "Low Cut" : "High Cut"} ${formatHz(xFreq(plot, p.x))}` : `${handle === "lowShelf" ? "Low shelf" : "High shelf"} ${formatHz(xFreq(plot, p.x))}, ${(yDb(plot, p.y) * 2).toFixed(1)} dB`),
        );
        return;
      }
      case "curve": {
        // Dragged up or down: Decay scaled by how far, in the display's log time.
        const from = yT60(plot, start.y);
        drag(
          (s, _d, p) => updateReverb(s, effectId, { decay: clamp(Math.round(base.decay * (yT60(plot, p.y) / from) * 100) / 100, REVERB_DECAY_RANGE[0], REVERB_DECAY_RANGE[1]) }),
          (p) => `Decay ${formatDecay(clamp(base.decay * (yT60(plot, p.y) / from), REVERB_DECAY_RANGE[0], REVERB_DECAY_RANGE[1]))}`,
        );
        return;
      }
      case "predelay":
        drag(
          (s, _d, p) => updateReverb(s, effectId, { sync: false, predelay: clamp(Math.round(xTime(plot, p.x, span, log) * 1000) / 1000, 0, MAX_PREDELAY) }),
          (p) => `Pre-delay ${Math.round(clamp(xTime(plot, p.x, span, log), 0, MAX_PREDELAY) * 1000)} ms`,
        );
        return;
      case "slope": {
        // The slope through where it's dragged: −60 dB in T60 from where the late sound is built.
        const decayAt = (p: { x: number; y: number }) => {
          const t = Math.max(shape.lateBuilt + 0.01, xTime(plot, p.x, span, log));
          const db = Math.min(shape.lateDb - 0.5, -72 * ((p.y - plot.top) / plot.height));
          const t60At = (60 * (t - shape.lateBuilt)) / (shape.lateDb - db);
          return clamp(Math.round((base.decay * t60At) / Math.max(0.05, shape.t60[5]) * 100) / 100, REVERB_DECAY_RANGE[0], REVERB_DECAY_RANGE[1]);
        };
        drag((s, _d, p) => updateReverb(s, effectId, { decay: decayAt(p) }), (p) => `Decay ${formatDecay(decayAt(p))}`);
        return;
      }
      case "early":
        drag(
          (s, d) => updateReverb(s, effectId, { distance: clamp(Math.round((base.distance + d.dx / plot.width) * 100) / 100, 0, 1) }),
          (p) => `Distance ${Math.round(clamp(base.distance + (p.x - start.x) / plot.width, 0, 1) * 100)}%`,
        );
        return;
    }
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const { x, y } = local(e);
    if (view === "shape") return auditionReverb(effectId);
    if (targetAt(x, y)) return;
    if (x < plot.left || x > plot.left + plot.width || y < plot.top || y > plot.top + plot.height) return;
    let made: number | null = null;
    useMusic.getState().commit((s) => {
      const r = addDecayBand(s, effectId, newBandAt(reverb, plot, x, y));
      made = r.id;
      return r.song;
    });
    if (made !== null) selectBands([made]);
  };

  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (view !== "decay") return;
    const { x, y } = local(e);
    const band = hitBand(reverb, plot, x, y);
    if (band === null) return;
    e.preventDefault();
    const by = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    useMusic.getState().commit((s) => editDecayBands(s, effectId, [band], (b) => ({ ...b, q: clamp(Math.round(b.q * by * 100) / 100, BAND_Q_RANGE[0], BAND_Q_RANGE[1]) })));
  };

  const cursor =
    hover?.kind === "band" || hover?.kind === "post" ? "cursor-grab" : hover?.kind === "curve" || hover?.kind === "slope" ? "cursor-ns-resize" : hover?.kind === "predelay" || hover?.kind === "early" ? "cursor-ew-resize" : view === "shape" ? "cursor-default" : "cursor-crosshair";
  const band = menuTarget?.kind === "band" ? reverb.bands.find((b) => b.id === menuTarget.id) : undefined;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={box}
          className={cn("absolute inset-0 touch-none select-none", cursor)}
          data-testid="reverb-display"
          data-view={view}
          onPointerDown={onPointerDown}
          onPointerMove={(e) => {
            const { x, y } = local(e);
            const next = targetAt(x, y);
            if (JSON.stringify(next) !== JSON.stringify(hover)) setHover(next);
          }}
          onPointerLeave={() => setHover(null)}
          onDoubleClick={onDoubleClick}
          onWheel={onWheel}
          onContextMenu={(e) => setMenuTarget(targetAt(local(e).x, local(e).y))}
        >
          <canvas ref={canvas} className="absolute inset-0 size-full" />
          {/* The bands' dots for tests and the keyboard-less: invisible buttons over each. */}
          {view === "decay" &&
            reverb.bands.map((b) => {
              const p = bandPoint(reverb, b, plot);
              return <span key={b.id} data-testid={`reverb-band-${b.id}`} data-multiplier={b.multiplier} data-frequency={b.frequency} className="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2" style={{ left: p.x, top: p.y }} />;
            })}
          {readout && (
            <span className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[160%] rounded-sm border border-[var(--verb-panel-edge)] bg-[var(--verb-bar)]/95 px-1.5 py-0.5 text-[10px] whitespace-nowrap text-[var(--verb-text)] tabular-nums shadow-md" style={{ left: readout.x, top: readout.y }}>
              {readout.text}
            </span>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {band ? (
          <>
            {SHAPES.map((s) => (
              <ContextMenuCheckboxItem key={s.shape} checked={band.shape === s.shape} onSelect={() => useMusic.getState().commit((song) => editDecayBands(song, effectId, [band.id], (b) => ({ ...b, shape: s.shape })))}>
                {s.label}
              </ContextMenuCheckboxItem>
            ))}
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => useMusic.getState().commit((song) => editDecayBands(song, effectId, [band.id], (b) => ({ ...b, enabled: !b.enabled })))}>{band.enabled ? "Bypass band" : "Enable band"}</ContextMenuItem>
            <ContextMenuItem onSelect={() => useMusic.getState().commit((song) => editDecayBands(song, effectId, [band.id], null))}>Delete band</ContextMenuItem>
          </>
        ) : (
          <>
            <ContextMenuItem onSelect={() => setReverb(effectId, { bands: [] })}>Reset decay bands</ContextMenuItem>
            <ContextMenuItem onSelect={() => setReverb(effectId, { lowCut: INIT_REVERB.lowCut, highCut: INIT_REVERB.highCut, output: { lowShelf: INIT_REVERB.output.lowShelf, highShelf: INIT_REVERB.output.highShelf, studio: false } })}>Reset Post EQ</ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuCheckboxItem checked={reverb.view.natural} onSelect={() => setReverb(effectId, { view: { natural: !reverb.view.natural } })}>
              Show natural curve
            </ContextMenuCheckboxItem>
            <ContextMenuCheckboxItem checked={reverb.view.analyzer} onSelect={() => setReverb(effectId, { view: { analyzer: !reverb.view.analyzer } })}>
              Show analyzer
            </ContextMenuCheckboxItem>
            <ContextMenuCheckboxItem checked={reverb.view.logTime} onSelect={() => setReverb(effectId, { view: { logTime: !reverb.view.logTime } })}>
              Log time (Shape)
            </ContextMenuCheckboxItem>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => copyReverbCurve(effectId)}>Copy curve</ContextMenuItem>
            <ContextMenuItem disabled={!useVerbUi.getState().copiedCurve} onSelect={() => pasteReverbCurve(effectId)}>
              Paste curve
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

const NO_BANDS: number[] = [];
