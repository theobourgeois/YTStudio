import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";
import { PiCaretDown, PiCaretRight } from "react-icons/pi";
import { cn } from "cn";
import { clamp } from "@shared/math";
import {
  envelopeOutline,
  envelopeText,
  lfoText,
  SERUM_DEFAULT_LFO_SHAPE,
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { startPointerDrag } from "@/lib/pointer-drag";
import { Knob } from "../knob";
import { addPoint, movePoint, pointAt, removePoint, shapePath } from "./shape-model";
import { useSerumUi } from "./store";

/** Whether the envelopes and LFOs are shown: this computer's choice (they're hidden at first, §3.5). */
const SHOWN_KEY = "vaudio.music.serum.envelopesShown";
const NORMAL = { scale: 100, unit: "%" };

/** One drag of a live control, or of several at once (an envelope's point): begun, moved, ended as one undo step. */
const setControls = (channelId: string, values: Record<string, number>, gesture: "begin" | "drag" | "end" | "set", label: string) =>
  useSerumUi.getState().setControls(channelId, values, gesture, label);

/** Behind "Envelopes and LFOs" (`docs/serum/player.md` §3.5): Serum's 4 envelopes and 10 LFOs, those in use open. */
export function EnvelopesAndLfos({ channelId, envelopes, lfos, routes }: { channelId: string; envelopes: SerumEnvelope[]; lfos: SerumLfo[]; routes: SerumModRoute[] }) {
  const [shown, setShown] = useState(() => localStorage.getItem(SHOWN_KEY) === "1");
  const toggle = () => {
    localStorage.setItem(SHOWN_KEY, shown ? "0" : "1");
    setShown(!shown);
  };
  if (!envelopes.length) return null;
  return (
    <section className="border-t border-line px-3 py-2.5" aria-label="Envelopes and LFOs">
      <button type="button" aria-expanded={shown} className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground" onClick={toggle}>
        {shown ? <PiCaretDown className="size-3" /> : <PiCaretRight className="size-3" />} Envelopes and LFOs
      </button>
      {shown && (
        <div className="mt-2 flex flex-col gap-1.5" data-testid="serum-envelopes">
          {envelopes.map((env) => (
            <EnvelopeCard key={env.index} channelId={channelId} env={env} drives={sourceDrives(routes, `Env ${env.index}`)} />
          ))}
          {lfos.map((lfo) => (
            <LfoCard key={lfo.index} channelId={channelId} lfo={lfo} drives={[...sourceDrives(routes, `LFO ${lfo.index}`), ...sourceDrives(routes, `LFO ${lfo.index} Y`)]} />
          ))}
        </div>
      )}
    </section>
  );
}

/** A card that's open when its source is in use, folded otherwise (a click opens it anyway). */
function Card({ title, used, drives, children, testId }: { title: string; used: boolean; drives: string; children: React.ReactNode; testId: string }) {
  const [open, setOpen] = useState(used);
  useEffect(() => setOpen(used), [used]);
  return (
    <div className="rounded-sm border border-line" data-testid={testId} data-used={used}>
      <button type="button" aria-expanded={open} className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-[11px]" onClick={() => setOpen(!open)}>
        {open ? <PiCaretDown className="size-3 shrink-0" /> : <PiCaretRight className="size-3 shrink-0" />}
        <span className="font-medium">{title}</span>
        <span className="min-w-0 truncate text-muted-foreground">{drives}</span>
      </button>
      {open && <div className="border-t border-line px-2 py-2">{children}</div>}
    </div>
  );
}

const describeDrives = (index: number, kind: "env" | "lfo", used: boolean, drives: string[]) =>
  kind === "env" && index === 1 ? `the notes' level${drives.length ? `, ${drives.join(", ")}` : ""}` : used ? drives.join(", ") || "in use" : "not in use";

const ENV_LABELS: Record<SerumEnvelopeField, string> = {
  attack: "Attack",
  hold: "Hold",
  decay: "Decay",
  sustain: "Sustain",
  release: "Release",
  attackCurve: "Atk curve",
  decayCurve: "Dec curve",
  releaseCurve: "Rel curve",
};

const GRAPH_HEIGHT = 72;

export function EnvelopeCard({ channelId, env, drives }: { channelId: string; env: SerumEnvelope; drives: string[] }) {
  const svg = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(320);
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setWidth(el.clientWidth || 320));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const stage = width / 4.2;
  const pad = 4;
  const h = GRAPH_HEIGHT - pad * 2;
  const { points } = envelopeOutline(env, stage);
  const xy = ([x, y]: [number, number]) => [pad + x, pad + (1 - y) * h] as const;
  const c = env.controls;
  const name = `Env ${env.index}`;
  const latest = () => useSerumUi.getState().channels[channelId]?.sound?.envelopes.find((e) => e.index === env.index)?.controls ?? c;

  /** A handle's drag: each field's position from where the drag began, `dx` and `dy` in pixels. */
  const drag = (e: ReactPointerEvent, fields: { x?: SerumEnvelopeField; y?: "sustain" }, label: string) => {
    e.stopPropagation();
    const start = latest();
    const values = (dx: number, dy: number) => {
      const out: Record<string, number> = {};
      if (fields.x) out[start[fields.x].param] = clamp(start[fields.x].value + dx / stage, 0, 1);
      if (fields.y) out[start.sustain.param] = Math.sqrt(clamp(start.sustain.value ** 2 - dy / h, 0, 1));
      return out;
    };
    let last = values(0, 0);
    startPointerDrag(e, {
      threshold: 0,
      cursor: "grabbing",
      onStart: () => setControls(channelId, last, "begin", label),
      onMove: (_ev, travel) => {
        last = values(travel.x, travel.y);
        setControls(channelId, last, "drag", label);
      },
      onEnd: () => setControls(channelId, last, "end", label),
      onCancel: () => setControls(channelId, values(0, 0), "end", label),
    });
  };
  // With no hold (most envelopes) its point sits on the attack's: drawn a little after it, so both can be taken (a drag
  // moves a control by how far it goes, not to where it is).
  const handles: { at: [number, number]; fields: { x?: SerumEnvelopeField; y?: "sustain" }; label: string }[] = [
    { at: points[1], fields: { x: "attack" }, label: `${name} attack` },
    { at: [Math.max(points[2][0], points[1][0] + 10), points[2][1]], fields: { x: "hold" }, label: `${name} hold` },
    { at: points[3], fields: { x: "decay", y: "sustain" }, label: `${name} decay and sustain` },
    { at: points[5], fields: { x: "release" }, label: `${name} release` },
  ];
  const curveKnob = (field: "attackCurve" | "decayCurve" | "releaseCurve") => (
    <ControlKnob key={field} channelId={channelId} label={`${name} ${ENV_LABELS[field].toLowerCase()}`} short={ENV_LABELS[field]} control={c[field]} format={(v) => envelopeText(env.index, field, v)} latest={() => latest()[field].value} />
  );
  return (
    <Card title={name} used={env.used} drives={describeDrives(env.index, "env", env.used, drives)} testId={`serum-env-${env.index}`}>
      <svg ref={svg} className="h-[72px] w-full rounded-sm bg-sunken" role="group" aria-label={`${name}'s shape: drag its points`}>
        <path d={`M ${points.map((p) => xy(p).join(" ")).join(" L ")}`} fill="none" className="stroke-brand" strokeWidth={1.5} />
        {handles.map(({ at, fields, label }) => {
          const [x, y] = xy(at);
          return (
            <circle
              key={label}
              cx={x}
              cy={y}
              r={4.5}
              className="cursor-grab fill-background stroke-brand"
              strokeWidth={1.5}
              role="slider"
              aria-label={label}
              aria-valuenow={Math.round(c[fields.x!].value * 100)}
              onPointerDown={(e) => drag(e, fields, label)}
            />
          );
        })}
      </svg>
      <div className="mt-1.5 grid grid-cols-5 gap-1 text-center text-[10px] text-muted-foreground">
        {(["attack", "hold", "decay", "sustain", "release"] as const).map((field) => (
          <div key={field} data-field={field}>
            <div>{ENV_LABELS[field]}</div>
            <div className="text-[11px] tabular-nums text-foreground">{envelopeText(env.index, field, c[field].value)}</div>
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex justify-end gap-3">{(["attackCurve", "decayCurve", "releaseCurve"] as const).map(curveKnob)}</div>
    </Card>
  );
}

/** A knob for one of Serum's live controls (0 to 1), its text as Serum shows it. */
function ControlKnob({ channelId, label, short, control, format, latest }: { channelId: string; label: string; short: string; control: { param: string; value: number }; format: (v: number) => string; latest: () => number }) {
  const set = (value: number, gesture: "begin" | "drag" | "end" | "set") => setControls(channelId, { [control.param]: value }, gesture, label);
  return (
    <div className="flex flex-col items-center gap-0.5" data-control={short}>
      <Knob
        value={control.value}
        min={0}
        max={1}
        defaultValue={control.value}
        label={label}
        format={format}
        unit={NORMAL}
        size={24}
        onBegin={() => set(latest(), "begin")}
        onDrag={(v) => set(v, "drag")}
        onEnd={() => set(latest(), "end")}
        onCancel={() => set(latest(), "end")}
        onSet={(v) => set(v, "set")}
      />
      <span className="text-[10px] text-muted-foreground">{short}</span>
      <span className="text-[10px] tabular-nums">{format(control.value)}</span>
    </div>
  );
}

const LFO_LABELS: Record<SerumLfoField, string> = { rate: "Rate", smooth: "Smooth", rise: "Rise", delay: "Delay", phase: "Phase" };
const MODES: { value: SerumLfoMode; label: string }[] = [
  { value: "retrigger", label: "Retrigger" },
  { value: "free", label: "Free" },
  { value: "envelope", label: "Envelope" },
];
const SHAPE_HEIGHT = 64;

export function LfoCard({ channelId, lfo, drives }: { channelId: string; lfo: SerumLfo; drives: string[] }) {
  const busy = useSerumUi((s) => s.channels[channelId]?.busy ?? false);
  const name = `LFO ${lfo.index}`;
  const latest = () => useSerumUi.getState().channels[channelId]?.sound?.lfos.find((l) => l.index === lfo.index) ?? lfo;
  const editLfo = (change: Omit<Extract<SerumSoundEdit, { kind: "lfo" }>, "kind" | "lfo">, label: string) =>
    void useSerumUi.getState().edit(channelId, [{ kind: "lfo", lfo: lfo.index, ...change }], label).catch(() => {});
  return (
    <Card title={name} used={lfo.used} drives={describeDrives(lfo.index, "lfo", lfo.used, drives)} testId={`serum-lfo-${lfo.index}`}>
      {lfo.type ? (
        <p className="py-2 text-[11px] text-muted-foreground">A {lfo.type} LFO: its motion is Serum's own, not a drawn shape.</p>
      ) : (
        <ShapeEditor
          label={`${name}'s shape`}
          points={lfo.shape}
          disabled={busy}
          onChange={(points) => editLfo({ shape: points }, `${name}: shape`)}
          onReset={lfo.customShape ? () => editLfo({ shape: null }, `${name}: Serum's shape`) : undefined}
        />
      )}
      <div className="mt-2 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <Select value={lfo.mode} disabled={busy} onValueChange={(mode) => editLfo({ mode: mode as SerumLfoMode }, `${name}: ${mode}`)}>
            <SelectTrigger size="sm" className="h-6 w-28 text-[11px]" aria-label={`${name} mode`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODES.map((m) => (
                <SelectItem key={m.value} value={m.value}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <button
            type="button"
            disabled={busy}
            aria-pressed={lfo.sync}
            title="Synced to the tempo"
            className={cn("h-6 rounded-sm border border-line px-1.5 text-[11px]", lfo.sync ? "pressed text-foreground" : "text-muted-foreground hover:text-foreground")}
            onClick={() => editLfo({ sync: !lfo.sync }, `${name}: ${lfo.sync ? "free rate" : "synced"}`)}
          >
            Sync
          </button>
        </div>
        {(["rate", "smooth", "rise", "delay", "phase"] as const).map((field) => (
          <ControlKnob
            key={field}
            channelId={channelId}
            label={`${name} ${LFO_LABELS[field].toLowerCase()}`}
            short={LFO_LABELS[field]}
            control={lfo.controls[field]}
            format={(v) => lfoText(lfo, field, v) ?? (v === lfo.controls[field].value ? lfo.controls[field].text : undefined) ?? `${Math.round(v * 100)}%`}
            latest={() => latest().controls[field].value}
          />
        ))}
      </div>
    </Card>
  );
}

/**
 * An LFO's shape, drawn as Serum draws it (y from the top): drag a point (the ends up and down only), double-click to
 * add one, right-click one to take it away. A change is a reload, made when the drag ends.
 */
function ShapeEditor({ label, points, disabled, onChange, onReset }: { label: string; points: SerumLfoPoint[]; disabled: boolean; onChange: (points: SerumLfoPoint[]) => void; onReset?: () => void }) {
  const svg = useRef<SVGSVGElement>(null);
  const [dragged, setDragged] = useState<SerumLfoPoint[] | null>(null);
  const shown = dragged ?? points;
  const [width, setWidth] = useState(320);
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setWidth(el.clientWidth || 320));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const pad = 5;
  const w = width - pad * 2;
  const h = SHAPE_HEIGHT - pad * 2;
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
      if (i > 0 && i < points.length - 1) onChange(removePoint(points, i));
      return;
    }
    let next = points;
    startPointerDrag(e, {
      threshold: 2,
      cursor: "grabbing",
      onMove: (ev) => {
        const [mx, my] = local(ev);
        next = movePoint(points, i, mx, my);
        setDragged(next);
      },
      onEnd: () => {
        setDragged(null);
        if (next !== points) onChange(next);
      },
      onCancel: () => setDragged(null),
    });
  };
  return (
    <div className="relative">
      <svg
        ref={svg}
        className={cn("h-16 w-full rounded-sm bg-sunken", disabled && "opacity-60")}
        role="img"
        aria-label={label}
        data-points={JSON.stringify(shown)}
        onPointerDown={press}
        onContextMenu={(e) => e.preventDefault()}
        onDoubleClick={(e) => {
          if (disabled) return;
          const [x, y] = local(e);
          const added = addPoint(points, x, y);
          if (added) onChange(added.points);
        }}
      >
        <g transform={`translate(${pad} ${pad})`}>
          <path d={shapePath(shown, w, h)} fill="none" className="stroke-brand" strokeWidth={1.5} />
          {shown.map(([x, y], i) => (
            <circle key={i} cx={x * w} cy={y * h} r={3.5} className="cursor-grab fill-background stroke-brand" strokeWidth={1.25} />
          ))}
        </g>
      </svg>
      {onReset && (
        <button type="button" className="absolute top-1 right-1 rounded-sm px-1 text-[10px] text-muted-foreground hover:text-foreground" title={`Back to Serum's own triangle (${JSON.stringify(SERUM_DEFAULT_LFO_SHAPE)})`} onClick={onReset}>
          Reset
        </button>
      )}
    </div>
  );
}
