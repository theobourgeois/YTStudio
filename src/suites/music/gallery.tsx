import { useEffect, useRef, useState } from "react";
import { CURVE_NAMES } from "@shared/music/automation";
import { DEFAULT_LFO } from "@shared/music/project";
import { type Automation, CURVE_TYPES, type CurveType } from "@shared/music/types";
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

/** The music suite's controls, for the component gallery (`src/gallery/`). */
export const MUSIC_SECTIONS: GallerySection[] = [
  { id: "music-controls", title: "Music: knobs, LCDs, PAT / SONG, faders and the arm light", source: "suites/music/knob.tsx, lcd.tsx, mode-switch.tsx, mixer/fader.tsx, mixer/arm-button.tsx", render: () => <Controls /> },
  { id: "music-curves", title: "Music: automation curve types (FL's), with points and tension handles", source: "suites/music/automation/draw-curve.ts", render: () => <Curves /> },
];
