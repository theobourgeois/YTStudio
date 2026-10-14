import { type ReactNode, useEffect, useState } from "react";
import { FX_RANGES, type Frame, type LiveFx } from "@shared/live-looks";
import { cn } from "cn";
import { useVisualizerPrefs } from "./prefs";

/** vaudio's readout: a 0..1 value as three digits ("038"), a signed one as itself ("-0.18"). */
const readout = (v: number, signed: boolean) => (signed ? v.toFixed(2) : String(Math.round(v * 100)).padStart(3, "0"));

const DISTORT: { key: keyof LiveFx; label: string }[] = [
  { key: "warp", label: "Fluid warp" },
  { key: "swirl", label: "Swirl" },
  { key: "ripple", label: "Ripples" },
  { key: "kaleido", label: "Kaleidoscope" },
  { key: "pixelate", label: "Pixelate" },
  { key: "lens", label: "Lens" },
  { key: "fold", label: "Mirror fold" },
];

const FEEDBACK: { key: keyof LiveFx; label: string }[] = [
  { key: "feedback", label: "Feedback" },
  { key: "trails", label: "Trail length" },
  { key: "echoZoom", label: "Echo zoom" },
  { key: "echoSpin", label: "Echo spin" },
  { key: "echoHue", label: "Echo hue" },
];

/**
 * Every setting the player plays over any look (D): vaudio's Distort and Feedback panels, kept in this browser
 * (`useVisualizerPrefs.fx`), and the frame (repeat, mirror, turn, zoom), eased over a beat. Wash puts it all back.
 */
export function PlayPanel({ frame, onFrame, onWash }: { frame: () => Frame; onFrame: (frame: Frame) => void; onWash: () => void }) {
  const fx = useVisualizerPrefs((s) => s.fx);
  const setFx = useVisualizerPrefs((s) => s.setFx);
  // The frame changes outside React too (the keys, the chooser's reframings): read a few times a second.
  const [shown, setShown] = useState(frame);
  useEffect(() => {
    const id = setInterval(() => setShown(frame()), 250);
    return () => clearInterval(id);
  }, [frame]);
  const reframe = (change: Partial<Frame>) => {
    const next = { ...shown, ...change };
    setShown(next);
    onFrame(next);
  };
  const slider = (key: keyof LiveFx, label: string) => {
    const [min, max] = FX_RANGES[key];
    return <Slider key={key} label={label} value={fx[key]} min={min} max={max} step={0.01} show={(v) => readout(v, min < 0)} onChange={(v) => setFx({ [key]: v })} />;
  };
  return (
    <div
      data-play-panel
      className="pointer-events-auto absolute top-16 right-4 bottom-36 w-72 overflow-y-auto rounded-lg bg-black/75 px-5 py-4 ring-1 ring-white/10 backdrop-blur-md"
    >
      <Section title="Distort">{DISTORT.map((d) => slider(d.key, d.label))}</Section>
      <Section title="Feedback">{FEEDBACK.map((d) => slider(d.key, d.label))}</Section>
      <Section title="Frame">
        <div>
          <Label>Repeat</Label>
          <div className="mt-1.5 grid grid-cols-4 gap-1">
            {([1, 2, 3, 4] as const).map((n) => (
              <Choice key={n} on={shown.repeat === n} onClick={() => reframe({ repeat: n })}>
                {n === 1 ? "1" : `${n}×${n}`}
              </Choice>
            ))}
          </div>
        </div>
        <div>
          <Label>Mirror</Label>
          <div className="mt-1.5 grid grid-cols-2 gap-1">
            <Choice on={!shown.mirror} onClick={() => reframe({ mirror: false })}>
              Off
            </Choice>
            <Choice on={shown.mirror} onClick={() => reframe({ mirror: true })}>
              On
            </Choice>
          </div>
        </div>
        <Slider label="Spin" value={shown.spin} min={-45} max={45} step={1} show={(v) => `${v > 0 ? "+" : ""}${v}°/s`} onChange={(v) => reframe({ spin: v })} />
        <Slider label="Zoom" value={shown.zoom} min={0.5} max={1.25} step={0.05} show={(v) => `${Math.round(v * 100)}%`} onChange={(v) => reframe({ zoom: v })} />
      </Section>
      <button type="button" onClick={onWash} className="mt-1 h-8 w-full rounded-md bg-white/10 text-[11px] tracking-[0.14em] text-white/80 uppercase ring-1 ring-white/15 hover:bg-white/15">
        Wash (⌫)
      </button>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-4">
      <h3 className="mb-3 flex items-center gap-3 text-[11px] tracking-[0.18em] text-white/70 uppercase">
        {title}
        <span className="h-px flex-1 bg-white/15" />
      </h3>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Label({ children }: { children: ReactNode }) {
  return <span className="text-[10px] tracking-[0.14em] text-white/55 uppercase">{children}</span>;
}

function Slider(props: { label: string; value: number; min: number; max: number; step: number; show: (v: number) => string; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <div className="flex items-baseline justify-between">
        <Label>{props.label}</Label>
        <span className="font-mono text-[11px] text-white/85">{props.show(props.value)}</span>
      </div>
      <input
        type="range"
        aria-label={props.label}
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
        className="mt-1 h-4 w-full cursor-pointer accent-white"
      />
    </label>
  );
}

function Choice({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn("h-7 rounded text-[11px] ring-1 ring-white/15", on ? "bg-white text-black" : "bg-white/5 text-white/75 hover:bg-white/10")}
    >
      {children}
    </button>
  );
}
