/**
 * Pro-C's automatable controls as its window turns them (`PRO_C_CONTROL_SPECS`): a knob's fraction, its
 * value said and typed (dB, ms, %, a ratio), its edit (rounded, so the song keeps tidy numbers), and the
 * reverse-linked pairs an Alt-drag moves together (`docs/fabfilter/pro-c.md` 2.1).
 */
import { clamp } from "@shared/math";
import { PRO_C_CONTROL_SPECS, findProC, setProCControl } from "@shared/music/pro-c";
import { slopeOf } from "@shared/music/pro-c-presets";
import type { AutomationTarget, MusicProject, ProCControl, ProCState } from "@shared/music/types";

const TIMES = new Set<ProCControl>(["attack", "release", "hold"]);
const PERCENTS = new Set<ProCControl>(["mix", "drive"]);

/** A value rounded as the song keeps it: dB to a tenth, times to three figures, percentages to whole ones. */
export function rounded(control: ProCControl, value: number): number {
  if (control === "ratio") return value;
  if (TIMES.has(control)) return value <= 0 ? 0 : Number(value.toPrecision(3));
  if (PERCENTS.has(control)) return Math.round(value * 100) / 100;
  return Math.round(value * 10) / 10;
}

/** The value as it's put in the typing field ("−18.0", "10", "4", "∞"). */
export function typedText(control: ProCControl, value: number): string {
  if (control === "ratio") {
    const ratio = value >= 1 - 1e-9 ? Infinity : 1 / (1 - value);
    return Number.isFinite(ratio) ? String(Math.round(ratio * 10) / 10) : "∞";
  }
  if (TIMES.has(control)) return String(Number((value * 1000).toPrecision(3)));
  if (PERCENTS.has(control)) return String(Math.round(value * 100));
  if (control === "dry" && value <= PRO_C_CONTROL_SPECS.dry.toControl(0) + 1e-9) return "off";
  return value.toFixed(1);
}

/** What's typed, in the control's units (null: not a value): times in ms ("2s" in seconds), ratios as "4" or "∞", "off" for Dry. */
export function parseTyped(control: ProCControl, text: string): number | null {
  const t = text.trim().toLowerCase().replace(",", ".").replace("−", "-");
  if (control === "ratio") {
    if (t === "∞" || t === "inf" || t === "infinity") return 1;
    const ratio = Number.parseFloat(t.replace(/:1$/, ""));
    return Number.isFinite(ratio) && ratio >= 1 ? slopeOf(ratio) : null;
  }
  if (control === "dry" && (t === "off" || t === "-inf")) return PRO_C_CONTROL_SPECS.dry.toControl(0);
  const n = Number.parseFloat(t);
  if (!Number.isFinite(n)) return null;
  if (TIMES.has(control)) return /\ds$/.test(t) && !t.endsWith("ms") ? n : n / 1000;
  if (PERCENTS.has(control)) return n / 100;
  return n;
}

/** A Pro-C's control as a knob or slider's props: its fraction, words, typing, automation target and edit. */
export function controlProps(effectId: string, proC: ProCState, control: ProCControl) {
  const spec = PRO_C_CONTROL_SPECS[control];
  const target: AutomationTarget = { kind: "proC", effect: effectId, control };
  return {
    label: spec.name,
    value: spec.fromControl(spec.get(proC)),
    defaultValue: spec.fromControl(spec.defaultValue),
    format: (f: number) => spec.format(spec.toControl(f)),
    typed: (f: number) => typedText(control, spec.toControl(f)),
    parse: (text: string) => {
      const value = parseTyped(control, text);
      return value === null ? null : spec.fromControl(value);
    },
    target,
    edit: (song: MusicProject, f: number) => setProCControl(song, effectId, control, rounded(control, spec.toControl(f))),
  };
}

/** Reverse-linked pairs (Alt-drag): Wet ↔ Dry, Input ↔ Output, and Threshold ↔ Drive (24 dB of drive across its travel). */
const PARTNERS: Partial<Record<ProCControl, { partner: ProCControl; scale: number }>> = {
  wet: { partner: "dry", scale: 1 },
  dry: { partner: "wet", scale: 1 },
  input: { partner: "output", scale: 1 },
  output: { partner: "input", scale: 1 },
  threshold: { partner: "drive", scale: 1 / 24 },
};

/**
 * The edit that moves `control`'s partner the other way as it's dragged (null if it has none): taken
 * from the song as the drag starts, so each move sets both from where they began.
 */
export function linkedEdit(effectId: string, control: ProCControl) {
  const link = PARTNERS[control];
  if (!link) return undefined;
  return (start: MusicProject) => {
    const proC = findProC(start, effectId)?.proC;
    const spec = PRO_C_CONTROL_SPECS[control];
    const partner = PRO_C_CONTROL_SPECS[link.partner];
    const from = proC ? spec.get(proC) : 0;
    const partnerFrom = proC ? partner.get(proC) : 0;
    const [lo, hi] = [partner.toControl(0), partner.toControl(1)];
    return (song: MusicProject, fraction: number) => {
      const moved = spec.toControl(fraction) - from;
      // (Threshold down, more compression, drives the Character harder.)
      const value = clamp(partnerFrom - moved * link.scale, lo, hi);
      return setProCControl(song, effectId, link.partner, rounded(link.partner, value));
    };
  };
}
