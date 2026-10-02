import { useEffect, useRef, useState } from "react";
import { CURVE_NAMES } from "@shared/music/automation";
import { DEFAULT_LFO } from "@shared/music/project";
import { type Automation, CURVE_TYPES, type CurveType, EQ_SHAPES } from "@shared/music/types";
import { drawCurve } from "./automation/draw-curve";
import { prepare } from "./piano/draw";
import { AUTOMATION } from "./playlist/draw";
import { ContextMenuItem } from "@/components/ui/context-menu";
import type { GallerySection } from "@/gallery/types";
import { CENTS, Knob, PERCENT, cents, panText, percent } from "./knob";
import { Lcd } from "./lcd";
import { Fader } from "./mixer/fader";
import { Led } from "./mixer/led";
import { ModeLights } from "./mode-switch";
import { EqKnob } from "./pro-q/knob";
import { ShapeIcon } from "./pro-q/shape-icon";
import { type OttRow, drawRow, ottColours } from "./ott/draw";
import { type DialScene, drawDial, wheelColours } from "./pitch-wheel/draw";

/** A knob with a value of its own (nothing in the song). */
function LooseKnob(props: Omit<React.ComponentProps<typeof Knob>, "value" | "onBegin" | "onDrag" | "onEnd" | "onCancel" | "onSet"> & { initial: number }) {
  const { initial, ...knob } = props;
  const [value, setValue] = useState(initial);
  const noop = () => {};
  return <Knob {...knob} value={value} onBegin={noop} onDrag={setValue} onEnd={noop} onCancel={noop} onSet={setValue} />;
}

function LooseLcd({ initial, derived }: { initial: number; derived?: boolean }) {
  const [value, setValue] = useState(initial);
  const noop = () => {};
  return (
    <Lcd
      value={value}
      min={1}
      max={64}
      label="Pattern length"
      derived={derived}
      menu={<ContextMenuItem>Auto</ContextMenuItem>}
      onBegin={noop}
      onChange={setValue}
      onEnd={noop}
      onCancel={noop}
    />
  );
}

/** A fader with a value of its own. */
function LooseFader({ initial, selected, automated, armed }: { initial: number; selected?: boolean; automated?: boolean; armed?: boolean }) {
  const [value, setValue] = useState(initial);
  const noop = () => {};
  return <Fader className="h-28" label="Volume" value={value} selected={selected} automated={automated} armed={armed} onBegin={noop} onDrag={setValue} onEnd={noop} onCancel={noop} onSet={setValue} />;
}

/** A mixer track's arm light (`mixer/arm-button.tsx`, which is the song's): red, lit while armed. */
function LooseArm() {
  const [armed, setArmed] = useState(true);
  return (
    <button type="button" aria-pressed={armed} className="group grid place-items-center" style={{ "--mixer-led": "var(--mixer-arm)" } as React.CSSProperties} onClick={() => setArmed(!armed)}>
      <Led on={armed} size={13} />
    </button>
  );
}
/** One curve type between two points (low to high, then high to low), as an automation clip draws it. */
function CurveCard({ curve, tension }: { curve: CurveType; tension: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = canvas.current && prepare(canvas.current, 132, 44);
    if (!c) return;
    const automation: Automation = {
      id: "auto",
      name: curve,
      color: null,
      target: { kind: "main" },
      length: 384,
      points: [
        { tick: 0, value: 0.1, tension: 0, curve: "single" },
        { tick: 192, value: 0.9, tension, curve },
        { tick: 384, value: 0.2, tension, curve },
      ],
      min: 0,
      max: 1,
      lfo: DEFAULT_LFO,
    };
    c.fillStyle = AUTOMATION.body;
    c.fillRect(0, 0, 132, 44);
    drawCurve(c, automation, { x0: 4, pxPerTick: 124 / 384, top: 2, height: 40 }, 4, 128, { line: AUTOMATION.content, point: AUTOMATION.title }, true, 384);
  }, [curve, tension]);
  return (
    <figure className="flex flex-col items-center gap-1">
      <canvas ref={canvas} className="rounded-sm" style={{ width: 132, height: 44 }} />
      <figcaption className="text-[10px] text-muted-foreground">
        {CURVE_NAMES[curve]}
        {tension ? ` (${tension > 0 ? "+" : ""}${tension})` : ""}
      </figcaption>
    </figure>
  );
}

function Curves() {
  return (
    <div className="grid grid-cols-4 gap-3">
      {CURVE_TYPES.map((curve) => (
        <CurveCard key={curve} curve={curve} tension={0} />
      ))}
      <CurveCard curve="single" tension={0.6} />
      <CurveCard curve="stairs" tension={0.5} />
    </div>
  );
}

function LooseModeLights() {
  const [mode, setMode] = useState<"pattern" | "song">("song");
  return <ModeLights mode={mode} onChange={setMode} />;
}

function Controls() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <span className="w-28 text-xs text-muted-foreground">knobs</span>
        <LooseKnob initial={0.78} min={0} max={1} defaultValue={0.78} label="Volume" format={percent} unit={PERCENT} />
        <LooseKnob initial={-0.4} min={-1} max={1} defaultValue={0} label="Pan" format={panText} unit={PERCENT} bipolar />
        <LooseKnob initial={0} min={-24} max={24} defaultValue={0} label="Pitch" format={cents} unit={CENTS} bipolar />
        <LooseKnob initial={0.3} min={0} max={1} defaultValue={0} label="Big" format={percent} unit={PERCENT} size={36} />
        <LooseKnob initial={0.55} min={0} max={1} defaultValue={0.78} label="Automated" format={percent} unit={PERCENT} automated />
      </div>
      <div className="flex items-center gap-4">
        <span className="w-28 text-xs text-muted-foreground">LCDs</span>
        <LooseLcd initial={16} />
        <LooseLcd initial={4} derived />
      </div>
      <div className="flex items-center gap-4">
        <span className="w-28 text-xs text-muted-foreground">PAT / SONG</span>
        <LooseModeLights />
      </div>
      <div className="flex items-center gap-4">
        <span className="w-28 text-xs text-muted-foreground">mixer faders</span>
        <LooseFader initial={0.8} />
        <LooseFader initial={0.4} selected />
        <LooseFader initial={1} />
        <LooseFader initial={0.6} automated />
        <LooseFader initial={0.7} armed />
      </div>
      <div className="flex items-center gap-4">
        <span className="w-28 text-xs text-muted-foreground">arm (recording)</span>
        <LooseArm />
      </div>
    </div>
  );
}

/** A Pro-Q knob that turns (not on a song): its fraction kept here. */
function LooseEqKnob({ initial, label, ends, size, bipolar, ring, disabled }: { initial: number; label: string; ends?: [string, string]; size?: number; bipolar?: boolean; ring?: boolean; disabled?: boolean }) {
  const [value, setValue] = useState(initial);
  return (
    <EqKnob
      value={value}
      defaultValue={initial}
      label={label}
      ends={ends}
      size={size}
      bipolar={bipolar}
      disabled={disabled}
      format={(v) => `${Math.round(v * 100)}%`}
      typed={(v) => String(Math.round(v * 100))}
      parse={(t) => (Number.isFinite(Number(t)) ? Number(t) / 100 : null)}
      onBegin={() => {}}
      onDrag={setValue}
      onEnd={() => {}}
      onCancel={() => {}}
      onSet={setValue}
      ring={ring ? { from: value, to: Math.max(0, value - 0.2), live: Math.max(0, value - 0.08), onBegin: () => {}, onDrag: () => {}, onEnd: () => {}, onCancel: () => {} } : undefined}
    />
  );
}

/** Pro-Q's controls on its panel's colours: FREQ, GAIN with the dynamic ring (range in red, where it is now in yellow), Q, a disabled one, the shapes. */
function EqControls() {
  return (
    <div className="flex flex-wrap items-end gap-6 rounded-xl bg-[var(--eq-panel)] p-4 text-[var(--eq-text)]">
      <LooseEqKnob initial={0.55} label="FREQ" ends={["10 Hz", "30 kHz"]} size={50} />
      <LooseEqKnob initial={0.7} label="GAIN" ends={["−30", "+30"]} size={58} bipolar ring />
      <LooseEqKnob initial={0.45} label="Q" ends={["0.025", "40"]} size={50} />
      <LooseEqKnob initial={0.5} label="OFF" size={50} disabled />
      <div className="flex gap-3 text-[var(--eq-curve)]">
        {EQ_SHAPES.map((shape) => (
          <span key={shape} title={shape} className="flex flex-col items-center gap-1 text-[9px] text-[var(--eq-label)]">
            <ShapeIcon shape={shape} className="size-5 text-[var(--eq-text)]" />
            {shape}
          </span>
        ))}
      </div>
    </div>
  );
}

/** One of OTT's display rows, as it's drawn (`ott/draw.ts`). */
function OttRowSample({ row, label }: { row: OttRow; label: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current;
    const ctx = element && prepare(element, 340, 36);
    if (element && ctx) drawRow(ctx, 340, 36, row, label, ottColours(element));
  }, [row, label]);
  return <canvas ref={canvas} className="block rounded-sm" style={{ width: 340, height: 36 }} />;
}

/** OTT's display rows: at rest, with sound (the level in white, what comes out in yellow), hot, and with a compressor off. */
function OttRows() {
  const knees = { upKnee: -46, downKnee: -39 };
  return (
    <div className="flex flex-col gap-1">
      <OttRowSample label="H" row={{ ...knees, upward: true, downward: true, level: null, output: null, hot: false }} />
      <OttRowSample label="M" row={{ ...knees, upward: true, downward: true, level: -24, output: -12, hot: true }} />
      <OttRowSample label="L" row={{ upKnee: -60, downKnee: -52, upward: false, downward: true, level: -50, output: -40, hot: false }} />
    </div>
  );
}

/** A Pitch Wheel dial in one state, drawn as its window draws it (`pitch-wheel/draw.ts`). */
function WheelCard({ label, scene }: { label: string; scene: Omit<DialScene, "size" | "colours" | "now" | "trail"> & { trail?: number[] } }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const size = 180;
  useEffect(() => {
    const element = canvas.current;
    const ctx = element && prepare(element, size, size);
    if (!element || !ctx) return;
    const now = performance.now();
    const trail = (scene.trail ?? []).map((value, i, all) => ({ value, at: now - (all.length - 1 - i) * 20 }));
    drawDial(ctx, { ...scene, size, now, trail, colours: wheelColours(element, scene.name === "TIMBRE" ? "timbre" : "pitch") });
  });
  return (
    <div className="flex flex-col items-center gap-1 rounded-sm bg-surface-1 p-2">
      <canvas ref={canvas} style={{ width: size, height: size }} />
      <span className="text-[10px] text-muted-foreground">{label}</span>
    </div>
  );
}

const WHEEL_AT_REST = { range: 24, name: "PITCH", pointer: 0, target: 0, actual: 0, voices: [], input: 0, closed: false, dragging: false } as const;

function Wheels() {
  return (
    <div className="grid grid-cols-4 gap-3">
      <WheelCard label="at rest" scene={WHEEL_AT_REST} />
      <WheelCard label="swinging past (low gravity), sound in" scene={{ ...WHEEL_AT_REST, pointer: 5.4, target: 5, actual: 8.6, trail: [2, 4, 6, 7.5, 8.3, 8.6], input: 0.4, dragging: true }} />
      <WheelCard label="Multi: three voices" scene={{ ...WHEEL_AT_REST, range: 12, pointer: 0, target: 0, actual: 0, voices: [0, 4, 7], input: 0.3 }} />
      <WheelCard label="Timbre, closed" scene={{ ...WHEEL_AT_REST, name: "TIMBRE", range: 12, closed: true }} />
    </div>
  );
}

/** The music suite's controls, for the component gallery (`src/gallery/`). */
export const MUSIC_SECTIONS: GallerySection[] = [
  { id: "music-controls", title: "Music: knobs, LCDs, PAT / SONG, faders and the arm light", source: "suites/music/knob.tsx, lcd.tsx, mode-switch.tsx, mixer/fader.tsx, mixer/arm-button.tsx", render: () => <Controls /> },
  { id: "music-wheels", title: "Music: Pitch Wheel's dials (at rest, swinging, Multi's voices, closed)", source: "suites/music/pitch-wheel/draw.ts", render: () => <Wheels /> },
  { id: "music-curves", title: "Music: automation curve types (FL's), with points and tension handles", source: "suites/music/automation/draw-curve.ts", render: () => <Curves /> },
  { id: "music-pro-q", title: "Music: Pro-Q's knobs (the dynamic ring on GAIN) and its shapes", source: "suites/music/pro-q/knob.tsx, shape-icon.tsx", render: () => <EqControls /> },
  { id: "music-ott", title: "Music: OTT's display rows (upward brown, downward green; a band at rest, sounding and hot, its upward off)", source: "suites/music/ott/draw.ts", render: () => <OttRows /> },
];
