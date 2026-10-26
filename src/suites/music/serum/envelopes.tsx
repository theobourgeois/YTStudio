import { type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject, useEffect, useRef, useState } from "react";
import { PiArrowLineRight, PiArrowsClockwise, PiInfinity } from "react-icons/pi";
import { cn } from "cn";
import { clamp } from "@shared/math";
import {
  envelopeSeconds,
  envelopeText,
  envelopeValueOf,
  lfoText,
  type SerumEnvelope,
  type SerumEnvelopeField,
  type SerumLfo,
  type SerumLfoField,
  type SerumLfoMode,
  type SerumLfoPoint,
  type SerumModRoute,
  type SerumSoundEdit,
  sourceDrives,
} from "@shared/music/serum-sound";
import { PPQ } from "@shared/music/types";
import { startPointerDrag } from "@/lib/pointer-drag";
import { CURSOR } from "../cursors";
import { Caption, CompKnob } from "../pro-c/knob";
import { useSong } from "../store";
import { useTransport } from "../transport";
import { envelopePosition, envelopeTimes, lfoPosition, notesNow } from "./motion";
import { scopeOf } from "./scope";
import { addPoint, curvedStage, curveThrough, movePoint, pointAt, removePoint, segmentCurveThrough, shapePath, withCurve } from "./shape-model";
import { SerumSection } from "./section";
import { useSerumUi } from "./store";

const DISPLAY_HEIGHT = 128;

/** One drag of live controls (several at once for an envelope's point): begun, moved, ended as one undo step. */
const setControls = (channelId: string, values: Record<string, number>, gesture: "begin" | "drag" | "end" | "set", label: string) =>
  useSerumUi.getState().setControls(channelId, values, gesture, label);

/**
 * The player's Envelopes and LFOs tab (`docs/serum/player.md` §3.5): the envelopes and LFOs the sound uses (Env 1
 * always; the rest only when something is routed from them), each a tab as in Serum's window, drawn as Serum draws
 * them, with a line running through while the channel plays.
 */
export function EnvelopesAndLfos({ channelId, envelopes, lfos, routes }: { channelId: string; envelopes: SerumEnvelope[]; lfos: SerumLfo[]; routes: SerumModRoute[] }) {
  if (!envelopes.length) return null;
  return (
    <SerumSection label="Envelopes and LFOs">
      <div className="flex flex-col gap-2" data-testid="serum-envelopes">
        <SerumShapes channelId={channelId} envelopes={envelopes.filter((e) => e.used)} lfos={lfos.filter((l) => l.used)} routes={routes} />
      </div>
    </SerumSection>
  );
}

/** The envelopes' tabs over their display, then the LFOs' (none if none is used), on Serum's dark panel. */
export function SerumShapes({ channelId, envelopes, lfos, routes }: { channelId: string; envelopes: SerumEnvelope[]; lfos: SerumLfo[]; routes: SerumModRoute[] }) {
  const [envTab, setEnvTab] = useState(1);
  const [lfoTab, setLfoTab] = useState<number | null>(null);
  const env = envelopes.find((e) => e.index === envTab) ?? envelopes[0];
  const lfo = lfos.find((l) => l.index === lfoTab) ?? lfos[0];
  const drives = (source: string) => [...sourceDrives(routes, source), ...sourceDrives(routes, `${source} Y`)];
  return (
    <>
      {env && (
        <Panel
          tabs={envelopes.map((e) => ({ id: e.index, label: `Env ${e.index}`, count: drives(`Env ${e.index}`).length, title: e.index === 1 ? "Every note's level" : drives(`Env ${e.index}`).join(", ") }))}
          on={env.index}
          onTab={setEnvTab}
          label="Envelopes"
        >
          <EnvelopeView key={env.index} channelId={channelId} env={env} />
        </Panel>
      )}
      {lfo && (
        <Panel tabs={lfos.map((l) => ({ id: l.index, label: `LFO ${l.index}`, count: drives(`LFO ${l.index}`).length, title: drives(`LFO ${l.index}`).join(", ") }))} on={lfo.index} onTab={setLfoTab} label="LFOs">
          <LfoView key={lfo.index} channelId={channelId} lfo={lfo} />
        </Panel>
      )}
    </>
  );
}

/** Serum's tabbed panel: a tab a source, its count of destinations in a ring, the one shown pointing down into it. */
function Panel({ tabs, on, onTab, label, children }: { tabs: { id: number; label: string; count: number; title: string }[]; on: number; onTab: (id: number) => void; label: string; children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-sm border border-black/40 bg-[var(--serum-panel)] text-[var(--serum-text)]" role="group" aria-label={label}>
      <div className="flex gap-px bg-black/30" role="tablist" aria-label={label}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={tab.id === on}
            title={tab.title || undefined}
            className={cn(
              "relative flex h-7 min-w-0 flex-1 items-center justify-between gap-1 px-2 text-[11.5px] font-medium",
              tab.id === on ? "bg-[var(--serum-tab-on)] text-[var(--serum-text)]" : "bg-[var(--serum-tab)] text-[var(--serum-text-dim)] hover:text-[var(--serum-text)]",
            )}
            onClick={() => onTab(tab.id)}
          >
            <span className="truncate">{tab.label}</span>
            <span className="flex size-4 shrink-0 items-center justify-center rounded-full border-[1.5px] border-[var(--serum-trace)] text-[9px] text-[var(--serum-value)]">{tab.count || ""}</span>
            {tab.id === on && <span className="absolute -bottom-1 left-1/2 size-2 -translate-x-1/2 rotate-45 bg-[var(--serum-tab-on)]" />}
          </button>
        ))}
      </div>
      {children}
    </div>
  );
}

/** The display's box, measured (its drawing is in pixels). */
function useWidth(ref: RefObject<SVGSVGElement | null>, fallback = 360) {
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setWidth(el.clientWidth || fallback));
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, fallback]);
  return width;
}

/**
 * A line run through a display at the frame rate while the channel plays (`position` from what the engine says of its
 * notes: null hides it), set straight on the element rather than through React.
 */
function usePlayhead(channelId: string, line: RefObject<SVGLineElement | null>, position: () => number | null) {
  const latest = useRef(position);
  latest.current = position;
  useEffect(() => {
    let frame = 0;
    const draw = () => {
      const x = latest.current();
      const el = line.current;
      if (el) {
        el.style.visibility = x === null ? "hidden" : "visible";
        if (x !== null) {
          el.setAttribute("x1", x.toFixed(1));
          el.setAttribute("x2", x.toFixed(1));
        }
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [channelId, line]);
}

/** The channel's notes as the engine said them, run on to now; null before it's said any. */
function notesOf(channelId: string) {
  const said = scopeOf(channelId);
  if (!said?.scope.notes) return null;
  return notesNow(said.scope.notes, (performance.now() - said.at) / 1000);
}

/** Times for an envelope's display: a round span a little longer than the envelope, and its grid's step. */
function envelopeSpan(seconds: number): { span: number; step: number } {
  const span = [0.25, 0.5, 1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64].find((s) => s >= seconds * 1.12) ?? 64;
  const step = span <= 0.5 ? 0.1 : span <= 1 ? 0.25 : span <= 4 ? 1 : span <= 8 ? 2 : span <= 16 ? 4 : 8;
  return { span, step };
}
const secondsLabel = (s: number) => (s < 1 ? `${Math.round(s * 1000)} ms` : `${Number(s.toFixed(2))} s`);

const ENV_LABELS: Record<SerumEnvelopeField, string> = { attack: "ATK", hold: "HOLD", decay: "DEC", sustain: "SUS", release: "REL", attackCurve: "ATK curve", decayCurve: "DEC curve", releaseCurve: "REL curve" };

/**
 * An envelope as Serum draws it: a time axis in seconds, the shape filled under its line (attack, hold, decay, then
 * the release from the decay's end), its points dragged in time (the decay's up and down too: the sustain), its curve
 * handles bending a stage, its values in a strip, its knobs below. All live.
 */
export function EnvelopeView({ channelId, env }: { channelId: string; env: SerumEnvelope }) {
  const svg = useRef<SVGSVGElement>(null);
  const line = useRef<SVGLineElement>(null);
  const width = useWidth(svg);
  const times = envelopeTimes(env);
  const total = times.attack + times.hold + times.decay + times.release;
  // Its span is kept while a point is dragged, so the axis doesn't slide under the pointer.
  const [frozen, setFrozen] = useState<{ span: number; step: number } | null>(null);
  const { span, step } = frozen ?? envelopeSpan(total);
  const pad = 6;
  const w = width - pad * 2;
  const h = DISPLAY_HEIGHT - pad * 2 - 12;
  const x = (seconds: number) => pad + (seconds / span) * w;
  const y = (level: number) => pad + (1 - level) * h;
  const c = env.controls;
  const level = c.sustain.value ** 2;
  const t1 = times.attack;
  const t2 = t1 + times.hold;
  const t3 = t2 + times.decay;
  const t4 = t3 + times.release;
  const stages: [number, number, number, number, number][] = [
    [0, t1, 0, 1, c.attackCurve.value],
    [t1, t2, 1, 1, 0.5],
    [t2, t3, 1, level, c.decayCurve.value],
    [t3, t4, level, 0, c.releaseCurve.value],
  ];
  let path = `M ${x(0)} ${y(0)}`;
  for (const [from, to, y0, y1, curve] of stages) for (let k = 1; k <= 24; k++) path += ` L ${x(from + ((to - from) * k) / 24).toFixed(1)} ${y(curvedStage(y0, y1, k / 24, curve)).toFixed(1)}`;
  const name = `Env ${env.index}`;
  const latest = () => useSerumUi.getState().channels[channelId]?.sound?.envelopes.find((e) => e.index === env.index)?.controls ?? c;
  usePlayhead(channelId, line, () => {
    const notes = notesOf(channelId);
    const at = notes && envelopePosition(env, notes);
    return at === null || at === undefined ? null : x(Math.min(at, span));
  });

  /** A drag of a point: its time (and the sustain for the decay's) from where it began. */
  const dragPoint = (e: ReactPointerEvent, field: "attack" | "hold" | "decay" | "release", label: string) => {
    e.stopPropagation();
    const start = latest();
    const startSeconds = envelopeSeconds(start[field].value);
    const startLevel = start.sustain.value ** 2;
    const values = (dx: number, dy: number) => {
      const out: Record<string, number> = { [start[field].param]: envelopeValueOf(field, Math.max(0, startSeconds + (dx / w) * span)) };
      if (field === "decay") out[start.sustain.param] = Math.sqrt(clamp(startLevel - dy / h, 0, 1));
      return out;
    };
    let last = values(0, 0);
    setFrozen({ span, step });
    startPointerDrag(e, {
      threshold: 0,
      cursor: CURSOR.grabPoint,
      onStart: () => setControls(channelId, last, "begin", label),
      onMove: (_ev, travel) => {
        last = values(travel.x, travel.y);
        setControls(channelId, last, "drag", label);
      },
      onEnd: () => {
        setControls(channelId, last, "end", label);
        setFrozen(null);
      },
      onCancel: () => {
        setControls(channelId, values(0, 0), "end", label);
        setFrozen(null);
      },
      onClick: () => setFrozen(null),
    });
  };
  /** A drag of a curve handle: the stage bent so its middle follows the pointer. */
  const dragCurve = (e: ReactPointerEvent, stage: 0 | 2 | 3, field: "attackCurve" | "decayCurve" | "releaseCurve", label: string) => {
    e.stopPropagation();
    const [, , y0, y1, curve] = stages[stage];
    const startMiddle = curvedStage(y0, y1, 0.5, curve);
    const param = c[field].param;
    let last = c[field].value;
    startPointerDrag(e, {
      threshold: 0,
      cursor: CURSOR.tension,
      onStart: () => setControls(channelId, { [param]: last }, "begin", label),
      onMove: (_ev, travel) => {
        last = curveThrough(y0, y1, startMiddle - travel.y / h);
        setControls(channelId, { [param]: last }, "drag", label);
      },
      onEnd: () => setControls(channelId, { [param]: last }, "end", label),
      onCancel: () => setControls(channelId, { [param]: curve }, "end", label),
    });
  };

  const ticks: number[] = [];
  for (let s = step; s < span - 1e-9; s += step) ticks.push(s);
  const points: { at: [number, number]; field: "attack" | "hold" | "decay" | "release"; label: string }[] = [
    { at: [t1, 1], field: "attack", label: `${name} attack` },
    // With no hold (most envelopes) its point sits on the attack's: drawn a little after it, so both can be taken.
    { at: [Math.max(t2, t1 + (8 / w) * span), 1], field: "hold", label: `${name} hold` },
    { at: [t3, level], field: "decay", label: `${name} decay and sustain` },
    { at: [t4, 0], field: "release", label: `${name} release` },
  ];
  const curves: { stage: 0 | 2 | 3; field: "attackCurve" | "decayCurve" | "releaseCurve" }[] = [
    { stage: 0, field: "attackCurve" },
    { stage: 2, field: "decayCurve" },
    { stage: 3, field: "releaseCurve" },
  ];
  const gradient = `serum-env-fill-${env.index}`;
  return (
    <div data-testid={`serum-env-${env.index}`} data-used={env.used}>
      <svg ref={svg} className="block w-full bg-[var(--serum-display)]" style={{ height: DISPLAY_HEIGHT }} role="group" aria-label={`${name}'s shape: drag its points`}>
        <defs>
          <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--serum-trace)" stopOpacity="0.32" />
            <stop offset="1" stopColor="var(--serum-trace)" stopOpacity="0.06" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={pad} x2={pad + w} y1={y(f)} y2={y(f)} stroke="var(--serum-display-grid)" />
        ))}
        {ticks.map((s) => {
          const major = Math.abs(s / step - Math.round(s / step)) < 1e-6 && (step >= 1 ? true : Math.abs(s - Math.round(s)) < 1e-6);
          return (
            <g key={s}>
              <line x1={x(s)} x2={x(s)} y1={pad} y2={pad + h} stroke={major ? "var(--serum-display-grid-strong)" : "var(--serum-display-grid)"} />
              <text x={x(s) - 3} y={pad + h + 10} textAnchor="end" fontSize="9" fill="var(--serum-text-dim)">
                {secondsLabel(s)}
              </text>
            </g>
          );
        })}
        <path d={`${path} L ${x(t4)} ${y(0)} Z`} fill={`url(#${gradient})`} stroke="none" />
        <path d={path} fill="none" stroke="var(--serum-trace)" strokeWidth={1.5} />
        <line ref={line} y1={pad} y2={pad + h} stroke="var(--serum-text)" strokeOpacity={0.75} strokeWidth={1} style={{ visibility: "hidden" }} data-playhead />
        {curves.map(({ stage, field }) => {
          const [from, to, y0, y1, curve] = stages[stage];
          if (Math.abs(y1 - y0) < 1e-6 || x(to) - x(from) < 10) return null;
          return (
            <circle
              key={field}
              cx={x((from + to) / 2)}
              cy={y(curvedStage(y0, y1, 0.5, curve))}
              r={3}
              fill="var(--serum-display)"
              stroke="var(--serum-trace)"
              strokeWidth={1.25}
              className="cursor-ns-resize"
              role="slider"
              aria-label={`${name} ${ENV_LABELS[field].toLowerCase()}`}
              aria-valuenow={Math.round(c[field].value * 100)}
              onPointerDown={(e) => dragCurve(e, stage, field, `${name} ${ENV_LABELS[field].toLowerCase()}`)}
            />
          );
        })}
        {points.map(({ at, field, label }) => (
          <circle
            key={field}
            cx={x(Math.min(at[0], span))}
            cy={y(at[1])}
            r={4}
            fill="var(--serum-trace)"
            stroke="var(--serum-display)"
            strokeWidth={1.5}
            className="cursor-grab"
            role="slider"
            aria-label={`${label} point`}
            aria-valuenow={Math.round(c[field].value * 100)}
            onPointerDown={(e) => dragPoint(e, field, label)}
          />
        ))}
      </svg>
      <div className="grid grid-cols-5 border-y border-black/40 bg-[var(--serum-display)] py-1 text-center text-[11px] text-[var(--serum-value)] tabular-nums">
        {(["attack", "hold", "decay", "sustain", "release"] as const).map((field) => (
          <span key={field} data-field={field}>
            {envelopeText(env.index, field, c[field].value)}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-5 justify-items-center py-2">
        {(["attack", "hold", "decay", "sustain", "release"] as const).map((field) => (
          <ControlKnob key={field} channelId={channelId} label={`${name} ${field}`} short={ENV_LABELS[field]} control={c[field]} format={(v) => envelopeText(env.index, field, v)} latest={() => latest()[field].value} />
        ))}
      </div>
    </div>
  );
}

/** A knob for one of Serum's live controls (0 to 1), labelled as Serum labels it. */
function ControlKnob({ channelId, label, short, control, format, latest }: { channelId: string; label: string; short: string; control: { param: string; value: number }; format: (v: number) => string; latest: () => number }) {
  const set = (value: number, gesture: "begin" | "drag" | "end" | "set") => setControls(channelId, { [control.param]: value }, gesture, label);
  return (
    <div className="flex flex-col items-center" data-control={short}>
      <CompKnob
        value={control.value}
        defaultValue={control.value}
        label={label}
        format={format}
        size={38}
        onBegin={() => set(latest(), "begin")}
        onDrag={(v) => set(v, "drag")}
        onEnd={() => set(latest(), "end")}
        onCancel={() => set(latest(), "end")}
        onSet={(v) => set(v, "set")}
        caption={<Caption className="text-[9.5px]">{short}</Caption>}
      />
    </div>
  );
}

const LFO_LABELS: Record<SerumLfoField, string> = { rate: "RATE", smooth: "SMOOTH", rise: "RISE", delay: "DELAY", phase: "PHASE" };
const MODES: { value: SerumLfoMode; label: string; icon: ReactNode; title: string }[] = [
  { value: "free", label: "Free", icon: <PiInfinity />, title: "Runs on, whatever the notes" },
  { value: "retrigger", label: "Retrig", icon: <PiArrowsClockwise />, title: "Starts again with each note" },
  { value: "envelope", label: "Envelope", icon: <PiArrowLineRight />, title: "Runs once with each note" },
];
/** Serum's LFO grid: 8 by 8. */
const GRID = 8;

/**
 * An LFO as Serum's window shows it: its modes down the left, its shape on an 8 × 8 grid (points dragged, added by a
 * double-click, taken away by a right-click, segments bent by their curve handles: each a reload when let go), a line
 * running through it while the channel plays, and its knobs below (live).
 */
export function LfoView({ channelId, lfo }: { channelId: string; lfo: SerumLfo }) {
  const busy = useSerumUi((s) => s.channels[channelId]?.busy ?? false);
  const tempo = useSong((s) => s.settings.tempo);
  const name = `LFO ${lfo.index}`;
  const latest = () => useSerumUi.getState().channels[channelId]?.sound?.lfos.find((l) => l.index === lfo.index) ?? lfo;
  const editLfo = (change: Omit<Extract<SerumSoundEdit, { kind: "lfo" }>, "kind" | "lfo">, label: string) =>
    void useSerumUi.getState().edit(channelId, [{ kind: "lfo", lfo: lfo.index, ...change }], label).catch(() => {});
  const release = useSerumUi((s) => {
    const env1 = s.channels[channelId]?.sound?.envelopes[0];
    return env1 ? envelopeSeconds(env1.controls.release.value) : 0.1;
  });
  const position = () => {
    const notes = notesOf(channelId);
    if (!notes) return null;
    const transport = useTransport.getState();
    const songBeats = transport.playing ? (transport.tick + (((performance.now() - transport.at) / 1000) * tempo * PPQ) / 60) / PPQ : null;
    return lfoPosition(lfo, notes, { tempo, release, songBeats, clock: performance.now() / 1000 });
  };
  return (
    <div className="flex" data-testid={`serum-lfo-${lfo.index}`} data-used={lfo.used}>
      <div className="flex w-[104px] shrink-0 flex-col gap-0.5 border-r border-black/40 p-1.5" role="radiogroup" aria-label={`${name} mode`}>
        {MODES.map((m) => (
          <button
            key={m.value}
            type="button"
            role="radio"
            aria-checked={lfo.mode === m.value}
            disabled={busy}
            title={m.title}
            className={cn(
              "flex h-7 items-center justify-between rounded-sm px-2 text-[11.5px] font-medium",
              lfo.mode === m.value ? "bg-[var(--serum-tab-on)] text-[var(--serum-value)]" : "text-[var(--serum-text)] hover:bg-[var(--serum-tab)]",
            )}
            onClick={() => lfo.mode !== m.value && editLfo({ mode: m.value }, `${name}: ${m.value}`)}
          >
            {m.label}
            <span className="text-[13px] opacity-80">{m.icon}</span>
          </button>
        ))}
        <button
          type="button"
          disabled={busy}
          aria-pressed={lfo.sync}
          title="The rate in the song's beats (BPM), or free in Hz"
          className={cn(
            "mt-auto h-6 rounded-sm border border-black/40 text-[10px] font-bold tracking-wide",
            lfo.sync ? "bg-[var(--serum-tab-on)] text-[var(--serum-value)]" : "bg-[var(--serum-tab)] text-[var(--serum-text-dim)]",
          )}
          onClick={() => editLfo({ sync: !lfo.sync }, `${name}: ${lfo.sync ? "free rate" : "synced"}`)}
        >
          BPM
        </button>
      </div>
      <div className="min-w-0 flex-1">
        {lfo.type ? (
          <p className="flex items-center justify-center bg-[var(--serum-display)] text-[11px] text-[var(--serum-text-dim)]" style={{ height: DISPLAY_HEIGHT }}>
            A {lfo.type} LFO: its motion is Serum's own, not a drawn shape.
          </p>
        ) : (
          <ShapeEditor
            channelId={channelId}
            label={`${name}'s shape`}
            points={lfo.shape}
            disabled={busy}
            position={position}
            onChange={(points, label) => editLfo({ shape: points }, `${name}: ${label}`)}
          />
        )}
        <div className="flex items-center justify-between border-y border-black/40 bg-[var(--serum-display)] px-2 py-1 text-[11px] text-[var(--serum-value)]">
          <span>{lfo.type ?? (lfo.customShape ? "Custom" : "Default")}</span>
          {lfo.customShape && !lfo.type && (
            <button type="button" disabled={busy} className="text-[var(--serum-text-dim)] hover:text-[var(--serum-text)]" title="Back to Serum's own triangle" onClick={() => editLfo({ shape: null }, `${name}: Serum's shape`)}>
              Reset
            </button>
          )}
          <span className="text-[var(--serum-text-dim)]">
            Grid {GRID}
          </span>
        </div>
        <div className="grid grid-cols-5 justify-items-center py-2">
          {(["rate", "rise", "delay", "smooth", "phase"] as const).map((field) => (
            <ControlKnob
              key={field}
              channelId={channelId}
              label={`${name} ${field}`}
              short={LFO_LABELS[field]}
              control={lfo.controls[field]}
              format={(v) => lfoText(lfo, field, v) ?? (v === lfo.controls[field].value ? lfo.controls[field].text : undefined) ?? `${Math.round(v * 100)}%`}
              latest={() => latest().controls[field].value}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/** An LFO's shape on Serum's grid, y from the top as Serum draws it. A change is a reload, made when the drag ends. */
function ShapeEditor({
  channelId,
  label,
  points,
  disabled,
  position,
  onChange,
}: {
  channelId: string;
  label: string;
  points: SerumLfoPoint[];
  disabled: boolean;
  position: () => number | null;
  onChange: (points: SerumLfoPoint[], what: string) => void;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const line = useRef<SVGLineElement>(null);
  const [dragged, setDragged] = useState<SerumLfoPoint[] | null>(null);
  const shown = dragged ?? points;
  const width = useWidth(svg, 300);
  const pad = 6;
  const w = width - pad * 2;
  const h = DISPLAY_HEIGHT - pad * 2;
  usePlayhead(channelId, line, () => {
    const at = position();
    return at === null ? null : pad + at * w;
  });
  const local = (e: { clientX: number; clientY: number }) => {
    const box = svg.current!.getBoundingClientRect();
    return [(e.clientX - box.left - pad) / w, (e.clientY - box.top - pad) / h] as const;
  };
  const press = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (disabled) return;
    const [x, y] = local(e);
    // Within 8 px of a point, measured on the screen.
    const i = pointAt(points.map(([px, py]): SerumLfoPoint => [px * w, py * h]), x * w, y * h, 8);
    if (i < 0) return;
    if (e.button === 2) {
      e.preventDefault();
      if (i > 0 && i < points.length - 1) onChange(removePoint(points, i), "point removed");
      return;
    }
    let next = points;
    startPointerDrag(e, {
      threshold: 2,
      cursor: CURSOR.grabPoint,
      onMove: (ev) => {
        const [mx, my] = local(ev);
        next = movePoint(points, i, mx, my);
        setDragged(next);
      },
      onEnd: () => {
        setDragged(null);
        if (next !== points) onChange(next, "point moved");
      },
      onCancel: () => setDragged(null),
    });
  };
  /** A segment's curve handle dragged: the segment bent so its middle follows the pointer. */
  const bend = (e: ReactPointerEvent, i: number) => {
    if (disabled) return;
    e.stopPropagation();
    const [, y0] = points[i];
    const [, y1] = points[i + 1];
    let next = points;
    startPointerDrag(e, {
      threshold: 1,
      cursor: CURSOR.tension,
      onMove: (ev) => {
        const [, my] = local(ev);
        next = withCurve(points, i, segmentCurveThrough(y0, y1, clamp(my, 0, 1)));
        setDragged(next);
      },
      onEnd: () => {
        setDragged(null);
        if (next !== points) onChange(next, "curve");
      },
      onCancel: () => setDragged(null),
    });
  };
  const curve = shapePath(shown, w, h);
  const middle = (i: number) => {
    const [x0, y0, c = 0.5] = shown[i];
    const [x1, y1] = shown[i + 1];
    const power = 2 ** ((c - 0.5) * 6);
    return [((x0 + x1) / 2) * w, (y0 + (y1 - y0) * 0.5 ** power) * h] as const;
  };
  const gradient = `serum-lfo-fill-${label.replace(/\W/g, "")}`;
  return (
    <svg
      ref={svg}
      className={cn("block w-full bg-[var(--serum-display)]", disabled && "opacity-70")}
      style={{ height: DISPLAY_HEIGHT }}
      role="img"
      aria-label={label}
      data-points={JSON.stringify(shown)}
      onPointerDown={press}
      onContextMenu={(e) => e.preventDefault()}
      onDoubleClick={(e) => {
        if (disabled) return;
        const [x, y] = local(e);
        const added = addPoint(points, x, y);
        if (added) onChange(added.points, "point added");
      }}
    >
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--serum-trace)" stopOpacity="0.32" />
          <stop offset="1" stopColor="var(--serum-trace)" stopOpacity="0.05" />
        </linearGradient>
      </defs>
      <g transform={`translate(${pad} ${pad})`}>
        {Array.from({ length: GRID - 1 }, (_, k) => (k + 1) / GRID).map((f) => (
          <g key={f}>
            <line x1={f * w} x2={f * w} y1={0} y2={h} stroke={f === 0.5 ? "var(--serum-display-grid-strong)" : "var(--serum-display-grid)"} />
            <line x1={0} x2={w} y1={f * h} y2={f * h} stroke={f === 0.5 ? "var(--serum-display-grid-strong)" : "var(--serum-display-grid)"} />
          </g>
        ))}
        <path d={`${curve} L ${w} ${h} L 0 ${h} Z`} fill={`url(#${gradient})`} />
        <path d={curve} fill="none" stroke="var(--serum-trace)" strokeWidth={1.5} />
        {shown.slice(0, -1).map((_, i) => {
          const [mx, my] = middle(i);
          return Math.abs(shown[i][1] - shown[i + 1][1]) < 1e-6 ? null : (
            <circle key={`c${i}`} cx={mx} cy={my} r={3} fill="var(--serum-display)" stroke="var(--serum-trace)" strokeWidth={1.25} className="cursor-ns-resize" onPointerDown={(e) => bend(e, i)} data-curve={i} />
          );
        })}
        {shown.map(([x, y], i) => (
          <circle key={i} cx={x * w} cy={y * h} r={3.5} fill="var(--serum-trace)" stroke="var(--serum-display)" strokeWidth={1.25} className="cursor-grab" />
        ))}
      </g>
      <line ref={line} y1={pad} y2={pad + h} stroke="var(--serum-text)" strokeOpacity={0.75} strokeWidth={1} style={{ visibility: "hidden" }} data-playhead />
    </svg>
  );
}
