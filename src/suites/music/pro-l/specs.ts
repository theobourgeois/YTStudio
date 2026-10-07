/**
 * YT-L's automatable controls as its window turns them (`PRO_L_CONTROL_SPECS`): a knob's fraction, its value said
 * and typed (dB, ms, %), and its edit (rounded, so the song keeps tidy numbers).
 */
import { PRO_L_CONTROL_SPECS, setProLControl } from "@shared/music/pro-l";
import type { AutomationTarget, MusicProject, ProLControl, ProLState } from "@shared/music/types";

const TIMES = new Set<ProLControl>(["attack", "release", "hold"]);
const PERCENTS = new Set<ProLControl>(["linkTransients", "linkRelease"]);

/** A value rounded as the song keeps it: dB to a tenth, times to three figures, percentages to whole ones. */
export function rounded(control: ProLControl, value: number): number {
  if (TIMES.has(control)) return value <= 0 ? 0 : Number(value.toPrecision(3));
  if (PERCENTS.has(control)) return Math.round(value * 100) / 100;
  return Math.round(value * 10) / 10;
}

/** The value as it's put in the typing field ("−0.1", "275", "75"). */
export function typedText(control: ProLControl, value: number): string {
  if (TIMES.has(control)) return String(Number((value * 1000).toPrecision(3)));
  if (PERCENTS.has(control)) return String(Math.round(value * 100));
  return value.toFixed(1);
}

/** What's typed, in the control's units (null: not a value): times in ms ("2s" in seconds), links in %. */
export function parseTyped(control: ProLControl, text: string): number | null {
  const t = text.trim().toLowerCase().replace(",", ".").replace("−", "-");
  const n = Number.parseFloat(t);
  if (!Number.isFinite(n)) return null;
  if (TIMES.has(control)) return /\ds$/.test(t) && !t.endsWith("ms") ? n : n / 1000;
  if (PERCENTS.has(control)) return n / 100;
  return n;
}

/** A YT-L's control as a knob or slider's props: its fraction, words, typing, automation target and edit. */
export function controlProps(effectId: string, proL: ProLState, control: ProLControl) {
  const spec = PRO_L_CONTROL_SPECS[control];
  const target: AutomationTarget = { kind: "proL", effect: effectId, control };
  return {
    label: spec.name,
    value: spec.fromControl(spec.get(proL)),
    defaultValue: spec.fromControl(spec.defaultValue),
    format: (f: number) => spec.format(spec.toControl(f)),
    typed: (f: number) => typedText(control, spec.toControl(f)),
    parse: (text: string) => {
      const value = parseTyped(control, text);
      return value === null ? null : spec.fromControl(value);
    },
    target,
    edit: (song: MusicProject, f: number) => setProLControl(song, effectId, control, rounded(control, spec.toControl(f))),
  };
}
