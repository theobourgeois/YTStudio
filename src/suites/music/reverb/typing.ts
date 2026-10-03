/** Typing a Reverb control's value (its knob's double-click): in its units, as a fraction of its knob, and back. */
import { clamp } from "@shared/math";
import { REVERB_CONTROL_SPECS } from "@shared/music/reverb";
import { REVERB_MS_CONTROLS } from "@shared/music/reverb-presets";
import type { ReverbControl } from "@shared/music/types";

/** A typed value in the control's units ("40 ms", "2.4 s", "6.5k", "-6"), as a fraction of its knob; null if it isn't one. */
export function parseControl(control: ReverbControl, text: string): number | null {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*(ms|s|k|khz|hz|db|%|x)?\s*$/i.exec(text.trim());
  const spec = REVERB_CONTROL_SPECS[control];
  if (!m) return control === "decay" && /^(inf|∞)/i.test(text.trim()) ? 1 : null;
  let v = Number(m[1]);
  const unit = (m[2] ?? "").toLowerCase();
  if (unit === "k" || unit === "khz") v *= 1000;
  if (unit === "%") v /= 100;
  if (REVERB_MS_CONTROLS.includes(control)) v = unit === "s" ? v : v / 1000;
  else if (unit === "ms") v /= 1000;
  return clamp(spec.fromControl(v), 0, 1);
}
/** What the typing box starts with: the value in its units. */
export const typedControl = (control: ReverbControl, fraction: number) => {
  const v = REVERB_CONTROL_SPECS[control].toControl(fraction);
  return REVERB_MS_CONTROLS.includes(control) ? String(Math.round(v * 1000)) : String(Math.round(v * 1000) / 1000);
};

