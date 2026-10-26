import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PiPianoKeys } from "react-icons/pi";
import { cn } from "cn";
import { EQ_DISPLAY_RANGES, hasGain } from "@shared/music/pro-q-presets";
import { type BandFilter, playedBand } from "@shared/music/pro-q-filters";
import { type ProQPatch, updateProQ } from "@shared/music/pro-q";
import type { EqBand, MusicProject, ProQ } from "@shared/music/types";
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { CURSOR } from "../cursors";
import { prepare } from "../piano/draw";
import { useMusic } from "../store";
import { useTransport } from "../transport";
import { proQOf } from "./actions";
import { BandControls } from "./band-controls";
import { BandMenuItems } from "./band-menu";
import { type DynamicLive, Ballistics, FALL_RATES, curveOf, drawScene, readEqPalette } from "./draw";
import { type EqView, curveFrequencies, dotOf, hzAt, xOf } from "./geometry";
import { ParameterDisplay } from "./parameter-display";
import { findPeaks, type SpectrumPeak } from "./peaks";
import { collisions } from "./match";
import { MatchPanel, useMatch } from "./match-panel";
import { Piano } from "./piano";
import { type DisplayContext, displayDoubleClick, displayPointerDown, displayWheel, hoverAt } from "./pointer";
import { hoverBand, leaveHover, useEqUi, useEqView } from "./store";

/** Room under the plot for the frequency scale; over it for the top bar; at the right for the scales and meter. */
const BOTTOM = 18;
const TOP = 6;
const SCALE_WIDTH = 46;
/** How long the pointer rests on the spectrum before Spectrum Grab holds it (Pro-Q's "a few seconds"). */
const GRAB_AFTER_MS = 1200;

/** The display range shown: the one set, grown to fit what the bands reach (Pro-Q's Auto-Adjust Display Range). */
function shownRange(pq: ProQ): number {
  let reach = 0;
  for (const b of pq.bands) if (hasGain(b.shape)) reach = Math.max(reach, Math.abs(b.gain * pq.gainScale), Math.abs((b.gain + b.range) * pq.gainScale));
  return EQ_DISPLAY_RANGES.find((r) => r >= Math.max(pq.displayRange, reach - 0.01)) ?? 30;
}

/**
 * Pro-Q's display (`docs/fabfilter/pro-q.md`): a canvas drawn every frame something moves (the analyzer
 * falls, dynamics move the curve), the band controls floating under the selection, the values beside the
 * band under the pointer, the display range at the top right, the piano at the bottom.
 */
export function Display({ effectId, pq, bypassed }: { effectId: string; pq: ProQ; bypassed: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 800, height: 400 });
  const windowView = useEqView(effectId);
  const hoveredId = useEqUi((s) => (s.hover?.effectId === effectId ? s.hover.band : null));
  const [typing, setTyping] = useState<number | null>(null);
  const [menuBand, setMenuBand] = useState<number | null>(null);
  const matching = useMatch(effectId);
  const matchRef = useRef<{ difference: Float64Array | null; proposal: readonly BandFilter[] } | null>(null);
  matchRef.current = matching.match ? { difference: matching.difference, proposal: matching.proposal } : null;

  const view: EqView = useMemo(
    () => ({
      width: Math.max(10, size.width - SCALE_WIDTH),
      height: size.height,
      low: windowView.low,
      high: windowView.high,
      range: shownRange(pq),
      analyzerRange: pq.analyzer.range,
      top: TOP,
      bottom: BOTTOM,
    }),
    [size, windowView.low, windowView.high, pq],
  );
  const viewRef = useRef(view);
  viewRef.current = view;
  const frequencies = useMemo(() => curveFrequencies(view, 2), [view.width, view.low, view.high]); // eslint-disable-line react-hooks/exhaustive-deps

  // Its size follows the window's.
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setSize({ width: element.clientWidth, height: element.clientHeight }));
    observer.observe(element);
    setSize({ width: element.clientWidth, height: element.clientHeight });
    return () => observer.disconnect();
  }, []);

  // ---- The frame loop: drawn when something changed, and while the analyzer has something to show ----
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const peaks = useRef<SpectrumPeak[]>([]);
  const ballistics = useRef({ pre: new Ballistics(), post: new Ballistics(), external: new Ballistics() });
  const dirty = useRef(true);
  useEffect(() => {
    dirty.current = true;
  });
  useEffect(() => {
    let frame = 0;
    const draw = () => {
      frame = requestAnimationFrame(draw);
      const element = canvas.current;
      const current = proQOf(effectId);
      if (!element || !current) return;
      const v = viewRef.current;
      const ui = useEqUi.getState();
      const state = useTransport.getState();
      const live = state.eq[effectId];
      const now = performance.now();
      const rate = FALL_RATES[current.analyzer.speed];
      const frozen = ui.views[effectId]?.freeze || ui.grab?.effectId === effectId;
      const b = ballistics.current;
      b.pre.update(current.analyzer.pre && live ? live.pre : null, now, rate, !!frozen);
      b.post.update(current.analyzer.post && live ? live.post : null, now, rate, !!frozen);
      const externalId = current.analyzer.external;
      b.external.update(externalId ? (state.eq[externalId]?.post ?? null) : null, now, rate, !!frozen);
      const moving = b.pre.visible || b.post.visible || b.external.visible || Object.keys(live?.bands ?? {}).length > 0;
      if (!dirty.current && !moving) return;
      dirty.current = false;
      const ctx = prepare(element, v.width + SCALE_WIDTH, v.height);
      if (!ctx) return;
      const liveGains = new Map<number, DynamicLive>();
      for (const [id, d] of Object.entries(live?.bands ?? {})) liveGains.set(Number(id), d);
      const solo = ui.solo?.effectId === effectId ? ui.solo.band : null;
      const grabbing = ui.grab?.effectId === effectId;
      drawScene(ctx, {
        view: v,
        palette: readEqPalette(element),
        bands: current.bands.map((band) => playedBand(band, current)),
        frequencies,
        selected: new Set(ui.views[effectId]?.selected ?? []),
        hover: ui.hover?.effectId === effectId ? ui.hover.band : null,
        live: liveGains,
        bypassed,
        solo,
        spectra: {
          pre: current.analyzer.pre && b.pre.visible ? b.pre.levels : null,
          post: current.analyzer.post && b.post.visible ? b.post.levels : null,
          external: externalId && b.external.visible ? b.external.levels : null,
          tilt: current.analyzer.tilt,
          grab: grabbing,
        },
        peaks: grabbing ? peaks.current : [],
        collisions: current.analyzer.collisions && externalId && b.post.visible && b.external.visible ? collisions(b.post.levels, b.external.levels) : null,
        match: matchRef.current,
        meter: live ? live.peak : [0, 0],
        pointerHz: pointer.current && !windowView.piano ? hzAt(v, pointer.current.x) : null,
        rubber: ui.rubber?.effectId === effectId ? ui.rubber : null,
        piano: windowView.piano,
        scaleWidth: SCALE_WIDTH,
      });
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [effectId, frequencies, bypassed, windowView.piano]);
  // The store's changes (a hover, a drag's rectangle, a selection) redraw it.
  useEffect(() => useEqUi.subscribe(() => (dirty.current = true)), []);
  useEffect(() => useMusic.subscribe(() => (dirty.current = true)), []);

  // ---- The pointer ----
  const ctx: DisplayContext = useMemo(
    () => ({
      effectId,
      view: () => viewRef.current,
      local: (e) => {
        const rect = box.current!.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
      },
      curveAt: (x) => {
        const current = proQOf(effectId);
        if (!current) return 0;
        const hz = hzAt(viewRef.current, x);
        let db = 0;
        const at = new Float64Array([hz]);
        for (const band of current.bands) if (band.enabled && band.placement === "stereo") db += curveOf(playedBand(band, current), playedBand(band, current).gain, at)[0];
        return db;
      },
      peakAt: (x, y) => {
        const v = viewRef.current;
        const current = proQOf(effectId);
        for (const peak of peaks.current) {
          const px = xOf(v, peak.hz);
          const tilt = current?.analyzer.tilt ?? 0;
          const py = v.top + (-(peak.db + tilt * Math.log2(peak.hz / 1000)) / v.analyzerRange) * (v.height - v.top - v.bottom);
          if (Math.abs(px - x) < 14 && Math.abs(py - y) < 24) return { hz: peak.hz, db: peak.db, q: peak.q };
        }
        return null;
      },
    }),
    [effectId],
  );
  const [cursor, setCursor] = useState("default");
  const grabTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onMove = (e: React.PointerEvent) => {
    const current = proQOf(effectId);
    if (!current) return;
    const p = ctx.local(e);
    pointer.current = p;
    dirty.current = true;
    const hit = hoverAt(ctx, current, p.x, p.y);
    const band = hit.kind === "band" || hit.kind === "range" ? hit.band.id : null;
    const ui = useEqUi.getState();
    // Off a band, its values stay a moment (the pointer may be on its way to them).
    if (band !== null) hoverBand(effectId, band);
    else if (ui.hover?.effectId === effectId) leaveHover();
    setCursor(hit.kind === "band" ? CURSOR.grabPoint : hit.kind === "range" ? CURSOR.moveV : hit.kind === "curve" ? "copy" : hit.kind === "scale" ? CURSOR.moveH : "default");
    // Resting on the spectrum a moment (away from the bands): Spectrum Grab holds it and labels its peaks.
    if (grabTimer.current) clearTimeout(grabTimer.current);
    const grabbing = ui.grab?.effectId === effectId;
    if (grabbing && !ui.grab!.permanent && hit.kind === "band") useEqUi.setState({ grab: null });
    if (!grabbing && current.analyzer.grab && (current.analyzer.post || current.analyzer.pre) && hit.kind === "none" && e.buttons === 0) {
      grabTimer.current = setTimeout(() => {
        const levels = (current.analyzer.post ? ballistics.current.post : ballistics.current.pre).levels;
        peaks.current = findPeaks(levels);
        if (peaks.current.length) useEqUi.setState({ grab: { effectId, permanent: false } });
      }, GRAB_AFTER_MS);
    }
  };
  const onLeave = () => {
    pointer.current = null;
    dirty.current = true;
    if (grabTimer.current) clearTimeout(grabTimer.current);
    const ui = useEqUi.getState();
    if (ui.hover?.effectId === effectId) leaveHover();
    if (ui.grab?.effectId === effectId && !ui.grab.permanent) useEqUi.setState({ grab: null });
  };
  // The wheel (not passive: it's ours, not the page's).
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const onWheel = (e: WheelEvent) => displayWheel(e, ctx);
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [ctx]);
  // A long press on the spectrum: permanent Spectrum Grab.
  const press = useRef<ReturnType<typeof setTimeout> | null>(null);

  const set = useCallback((patch: ProQPatch) => useMusic.getState().commit((s: MusicProject) => updateProQ(s, effectId, patch)), [effectId]);
  const hovered = hoveredId !== null ? (pq.bands.find((b) => b.id === hoveredId) ?? null) : null;
  const shownBand: EqBand | null = typing !== null ? (pq.bands.find((b) => b.id === typing) ?? null) : hovered;

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden" data-testid="pro-q-display">
      <ContextMenu onOpenChange={(open) => !open && setMenuBand(null)}>
        <ContextMenuTrigger
          asChild
          onContextMenu={(e) => {
            // A band's dot: its menu (acting on the selection, or on it alone). Pro-Q has none elsewhere.
            const current = proQOf(effectId);
            const p = ctx.local(e);
            const hit = current ? hoverAt(ctx, current, p.x, p.y) : null;
            if (!hit || (hit.kind !== "band" && hit.kind !== "range")) {
              e.preventDefault();
              return;
            }
            setMenuBand(hit.band.id);
          }}
        >
          <div
            ref={box}
            className="absolute inset-0 touch-none select-none"
            style={{ cursor }}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              const current = proQOf(effectId);
              const p = ctx.local(e);
              if (current && hoverAt(ctx, current, p.x, p.y).kind === "none" && current.analyzer.grab && (current.analyzer.pre || current.analyzer.post)) {
                press.current = setTimeout(() => {
                  peaks.current = findPeaks((current.analyzer.post ? ballistics.current.post : ballistics.current.pre).levels);
                  useEqUi.setState({ grab: { effectId, permanent: true } });
                }, 700);
              }
              displayPointerDown(e, ctx);
            }}
            onPointerUp={() => press.current && clearTimeout(press.current)}
            onPointerMove={(e) => {
              if (press.current && e.buttons) clearTimeout(press.current);
              onMove(e);
            }}
            onPointerLeave={onLeave}
            onDoubleClick={(e) => displayDoubleClick(e, ctx, (band) => setTyping(band.id))}
          >
            <canvas ref={canvas} className="absolute inset-0 size-full" />
          </div>
        </ContextMenuTrigger>
        {menuBand !== null && <BandMenuItems effectId={effectId} pq={pq} band={menuBand} />}
      </ContextMenu>

      {/* The display range, at the top right of the EQ scale. */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="absolute top-1.5 rounded-sm bg-black/40 px-1.5 py-0.5 text-[10px] font-semibold text-[var(--eq-curve)] hover:bg-black/60"
            style={{ right: SCALE_WIDTH + 2 }}
            aria-label="Display range"
          >
            {view.range} dB
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuRadioGroup value={String(pq.displayRange)} onValueChange={(v) => set({ displayRange: Number(v) as ProQ["displayRange"] })}>
            {EQ_DISPLAY_RANGES.map((r) => (
              <DropdownMenuRadioItem key={r} value={String(r)}>
                ±{r} dB{r <= 6 ? " (mastering)" : ""}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* The piano, in place of the frequency scale, and its button. */}
      {windowView.piano && <Piano effectId={effectId} pq={pq} view={view} bottom={BOTTOM} />}
      <button
        type="button"
        aria-label="Piano display"
        aria-pressed={windowView.piano}
        title="Piano display"
        className={cn("absolute bottom-0.5 left-1 rounded-sm p-0.5 text-[var(--eq-label)] hover:text-[var(--eq-text)]", windowView.piano && "text-[var(--eq-curve)]")}
        onClick={() => useEqUi.getState().setView(effectId, { piano: !windowView.piano })}
      >
        <PiPianoKeys className="size-3.5" />
      </button>

      {shownBand && <ParameterDisplay key={shownBand.id} effectId={effectId} band={shownBand} at={dotOf(view, playedBand(shownBand, pq))} typing={typing === shownBand.id} onDoneTyping={() => setTyping(null)} />}
      {windowView.selected.length > 0 && !matching.match && <BandControls effectId={effectId} pq={pq} view={view} bottom={BOTTOM} />}
      <MatchPanel effectId={effectId} pq={pq} />
    </div>
  );
}
