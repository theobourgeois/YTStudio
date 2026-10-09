import { cn } from "cn";
import type { SerumOscillator } from "@shared/music/serum-sound";
import { Caption, CompKnob } from "../pro-c/knob";
import { SerumSection } from "./section";
import { oscillatorLabel, useSerumUi } from "./store";

/** A level as Serum shows it: the knob's place, its gain the square ("75% · -5.0 dB"). */
const levelText = (v: number) => (v <= 0 ? "0% · -∞ dB" : `${Math.round(v * 100)}% · ${(40 * Math.log10(v)).toFixed(1)} dB`);

/** Its pitch, when it isn't where it starts: "-1 oct", "+7 st". */
const pitchText = (o: SerumOscillator) => [o.octave && `${o.octave > 0 ? "+" : ""}${o.octave} oct`, o.semi && `${o.semi > 0 ? "+" : ""}${o.semi} st`].filter(Boolean).join(" ");

/**
 * Serum's five oscillators side by side (A, B, C, Noise, Sub): what each plays, its level, and Mute and Solo, as a
 * mixer's. Mute is Serum's own switch for it; Solo turns the others off until it's pressed again, which puts them back.
 * All live, each an undo step.
 */
export function OscillatorsSection({ channelId, oscillators }: { channelId: string; oscillators: SerumOscillator[] }) {
  const solo = useSerumUi((s) => s.channels[channelId]?.solo ?? null);
  if (!oscillators.length) return null;
  return (
    <SerumSection title="Oscillators" label="Oscillators" testId="serum-oscillators">
      <div className="grid grid-cols-5 gap-1.5">
        {oscillators.map((osc) => (
          <OscillatorCard key={osc.index} channelId={channelId} osc={osc} soloed={solo?.index === osc.index} />
        ))}
      </div>
    </SerumSection>
  );
}

function OscillatorCard({ channelId, osc, soloed }: { channelId: string; osc: SerumOscillator; soloed: boolean }) {
  const on = osc.enabled.value >= 0.5;
  const label = oscillatorLabel(osc.name);
  const set = (value: number, gesture: "begin" | "drag" | "end" | "set") => useSerumUi.getState().setControl(channelId, osc.level.param, value, gesture, `${label} level`);
  const latest = () => useSerumUi.getState().channels[channelId]?.sound?.oscillators.find((o) => o.index === osc.index)?.level.value ?? osc.level.value;
  const pitch = pitchText(osc);
  return (
    <div
      className={cn("flex min-w-0 flex-col rounded-[4px] border bg-[var(--serum-panel)] px-2 pt-1.5 pb-2", soloed ? "border-[var(--serum-trace)]/70" : "border-black/50")}
      role="group"
      aria-label={label}
      data-oscillator={osc.name}
      data-on={on}
    >
      <div className="flex items-center gap-1">
        <span className={cn("text-[12px] font-semibold", on ? "text-[var(--serum-text)]" : "text-[var(--serum-text-dim)]")}>{osc.name}</span>
        <div className="ml-auto flex gap-0.5">
          <button
            type="button"
            aria-pressed={!on}
            aria-label={`Mute ${label}`}
            title={on ? `Mute ${label} (Serum's own switch)` : `Unmute ${label}`}
            className={cn("grid h-4 w-4 place-items-center rounded-[3px] text-[9.5px] font-bold outline-none", !on ? "bg-[var(--serum-hot)] text-black" : "bg-[var(--serum-tab)] text-[var(--serum-text-dim)] hover:text-[var(--serum-text)]")}
            onClick={() => useSerumUi.getState().muteOscillator(channelId, osc.index)}
          >
            M
          </button>
          <button
            type="button"
            aria-pressed={soloed}
            aria-label={`Solo ${label}`}
            title={soloed ? "Unsolo: the others as they were" : `Solo ${label}: the others off`}
            className={cn("grid h-4 w-4 place-items-center rounded-[3px] text-[9.5px] font-bold outline-none", soloed ? "bg-[var(--serum-trace)] text-black" : "bg-[var(--serum-tab)] text-[var(--serum-text-dim)] hover:text-[var(--serum-text)]")}
            onClick={() => useSerumUi.getState().soloOscillator(channelId, osc.index)}
          >
            S
          </button>
        </div>
      </div>
      <div className={cn("mt-0.5 min-w-0", !on && "opacity-45")}>
        <div className="truncate text-[11px] text-[var(--serum-text)]" title={osc.plays}>
          {osc.plays || osc.kind}
        </div>
        <div className="truncate text-[10px] text-[var(--serum-text-dim)]">{[osc.kind, pitch].filter(Boolean).join(" · ")}</div>
      </div>
      <div className={cn("mt-1.5 flex justify-center", !on && "opacity-45")}>
        <CompKnob
          value={osc.level.value}
          defaultValue={osc.index === 3 ? 0.25 : 0.75}
          label={`${label} level`}
          format={levelText}
          size={38}
          onBegin={() => set(latest(), "begin")}
          onDrag={(v) => set(v, "drag")}
          onEnd={() => set(latest(), "end")}
          onCancel={() => set(latest(), "end")}
          onSet={(v) => set(v, "set")}
          caption={<Caption className="text-[9.5px] tracking-normal normal-case">Level</Caption>}
        />
      </div>
    </div>
  );
}
