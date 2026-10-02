import { useEffect, useRef, useState } from "react";
import { PiHeadphones, PiPower, PiX } from "react-icons/pi";
import { cn } from "cn";
import { clamp } from "@shared/math";
import { editProQ, frequencyText, gainText, noteText, parseTyped, qText, updateBands } from "@shared/music/pro-q";
import { EQ_MAX_FREQUENCY, EQ_MAX_GAIN, EQ_MAX_Q, EQ_MIN_FREQUENCY, EQ_MIN_Q, hasGain, usesQ } from "@shared/music/pro-q-presets";
import type { EqBand } from "@shared/music/types";
import { startPointerDrag } from "@/lib/pointer-drag";
import { songGesture } from "../store";
import { deleteBands, editEq, solo } from "./actions";
import { bandColour } from "./draw";
import { ShapeIcon } from "./shape-icon";
import { hoverBand, keepHover, leaveHover, useEqUi, useEqView } from "./store";

type Field = "frequency" | "gain" | "q";

/**
 * Beside the band under the pointer, its values (Pro-Q's EQ parameter display): bypass, frequency, gain
 * and Q (double-click one to type it; Tab steps to the next), the shape, solo (hold the headphones; drag
 * across for the frequency, up and down for how loud the solo is), delete.
 */
export function ParameterDisplay({ effectId, band, at, typing, onDoneTyping }: { effectId: string; band: EqBand; at: { x: number; y: number }; typing: boolean; onDoneTyping: () => void }) {
  const piano = useEqView(effectId).piano;
  const soloing = useEqUi((s) => s.solo?.effectId === effectId && s.solo.band === band.id);
  const [field, setField] = useState<Field | null>(typing ? "frequency" : null);
  useEffect(() => setField(typing ? "frequency" : null), [typing]);
  const box = useRef<HTMLDivElement>(null);
  const fields: Field[] = ["frequency", ...(hasGain(band.shape) ? (["gain"] as const) : []), ...(usesQ(band) ? (["q"] as const) : [])];
  const set = (f: Field, text: string) => {
    const value = parseTyped(text, f);
    if (value === null) return;
    const patch =
      f === "frequency"
        ? { frequency: clamp(value, EQ_MIN_FREQUENCY, EQ_MAX_FREQUENCY) }
        : f === "gain"
          ? { gain: clamp(value, -EQ_MAX_GAIN, EQ_MAX_GAIN) }
          : { q: clamp(value, EQ_MIN_Q, EQ_MAX_Q) };
    editEq(effectId, (p) => updateBands(p, [band.id], patch));
  };
  const text = (f: Field) => (f === "frequency" ? frequencyText(band.frequency) : f === "gain" ? gainText(band.gain) : `Q: ${qText(band.q)}`);
  const left = at.x + 14;
  const top = at.y + 12;

  return (
    <div
      ref={box}
      className="absolute z-20 flex items-stretch gap-1 rounded-md border border-[var(--eq-panel-edge)] bg-[var(--eq-panel)]/95 p-1 text-[10px] text-[var(--eq-text)] shadow-lg"
      style={{ left, top, transform: left > (box.current?.parentElement?.clientWidth ?? 9999) - 160 ? "translateX(calc(-100% - 28px))" : undefined }}
      data-testid="pro-q-values"
      onPointerEnter={() => {
        keepHover();
        hoverBand(effectId, band.id);
      }}
      onPointerLeave={() => !typing && leaveHover()}
    >
      <div className="flex flex-col items-center justify-between gap-1">
        <button
          type="button"
          aria-label={band.enabled ? "Bypass the band" : "Enable the band"}
          aria-pressed={!band.enabled}
          className={cn("rounded-sm p-0.5", band.enabled ? "text-[var(--eq-curve)]" : "text-[var(--eq-label)]")}
          onClick={() => editEq(effectId, (p) => updateBands(p, [band.id], { enabled: !band.enabled }))}
        >
          <PiPower className="size-3" />
        </button>
        <ShapeIcon shape={band.shape} className="size-3.5" />
      </div>
      <div className="flex min-w-[78px] flex-col gap-px tabular-nums">
        {(["frequency", "gain", "q"] as const).map((f) =>
          !fields.includes(f) ? null : field === f ? (
            <input
              key={f}
              autoFocus
              aria-label={f === "q" ? "Q" : f[0].toUpperCase() + f.slice(1)}
              defaultValue={f === "frequency" ? String(Math.round(band.frequency * 100) / 100) : f === "gain" ? String(Math.round(band.gain * 100) / 100) : String(Math.round(band.q * 1000) / 1000)}
              className="h-4 w-20 rounded-sm bg-black/50 px-1 text-[10px] text-[var(--eq-text)] outline-none"
              onFocus={(e) => e.currentTarget.select()}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter" || e.key === "Tab") {
                  e.preventDefault();
                  set(f, e.currentTarget.value);
                  const next = fields[(fields.indexOf(f) + 1) % fields.length];
                  if (e.key === "Tab" && next !== fields[0]) setField(next);
                  else {
                    setField(null);
                    onDoneTyping();
                  }
                }
                if (e.key === "Escape") {
                  setField(null);
                  onDoneTyping();
                }
              }}
              onBlur={() => {
                setField(null);
                onDoneTyping();
              }}
            />
          ) : (
            <span key={f} className="cursor-text leading-4 whitespace-nowrap" onDoubleClick={() => setField(f)}>
              {text(f)}
              {f === "frequency" && piano && <span className="ml-1 text-[var(--eq-label)]">{noteText(band.frequency)}</span>}
              {f === "q" && <span className="ml-1 text-[var(--eq-label)]">⌘</span>}
            </span>
          ),
        )}
      </div>
      <div className="flex flex-col items-center justify-between gap-1">
        <button
          type="button"
          aria-label="Solo the band (hold)"
          title="Hold to hear what the band works on: drag across for its frequency, up and down for the level"
          className={cn("rounded-sm p-0.5", soloing ? "bg-[var(--eq-dynamic)] text-white" : "text-[var(--eq-label)] hover:text-[var(--eq-text)]")}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.stopPropagation();
            const from = band.frequency;
            let gain = 0;
            const gesture = songGesture();
            let moved = false;
            solo(effectId, band.id, 0);
            startPointerDrag(e, {
              threshold: 0,
              lock: true,
              onMove(_ev, travel) {
                if (!moved && Math.abs(travel.x) > 2) {
                  moved = true;
                  gesture.begin();
                }
                if (moved) {
                  const frequency = clamp(from * 2 ** (travel.x / 120), EQ_MIN_FREQUENCY, EQ_MAX_FREQUENCY);
                  gesture.apply((s) => editProQ(s, effectId, (p) => updateBands(p, [band.id], { frequency })));
                }
                const level = clamp(Math.round(-travel.y / 6), -30, 30);
                if (level !== gain) {
                  gain = level;
                  solo(effectId, band.id, gain);
                }
              },
              onEnd() {
                if (moved) gesture.end();
                solo(effectId, null);
              },
              onCancel() {
                if (moved) gesture.cancel();
                solo(effectId, null);
              },
              onClick() {
                solo(effectId, null);
              },
            });
          }}
        >
          <PiHeadphones className="size-3" />
        </button>
        <span className="size-2 rounded-full" style={{ background: bandColour(band.id) }} title={`Band ${band.id}`} />
      </div>
      <div className="flex flex-col justify-start">
        <button type="button" aria-label="Delete the band" className="rounded-sm p-0.5 text-[var(--eq-label)] hover:text-[var(--eq-text)]" onClick={() => deleteBands(effectId, [band.id])}>
          <PiX className="size-3" />
        </button>
      </div>
    </div>
  );
}
