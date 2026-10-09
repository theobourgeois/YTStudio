/**
 * The Serum player's look (`--serum-*`, dark in every theme, as a plugin's window keeps its own): Pro-C's controls
 * drawn in its tokens (as YT-L draws them in its own), and a hue for each kind of sound and each kind of mod source.
 */
import type { CSSProperties } from "react";
import type { SerumCategory } from "@shared/music/serum-presets";

/** Pro-C's knob and sliders read `--comp-*`: here they're the player's. */
export const SERUM_TOKENS = {
  "--comp-arc": "var(--serum-trace)",
  "--comp-knob": "var(--serum-knob)",
  "--comp-knob-light": "var(--serum-knob-light)",
  "--comp-knob-dark": "var(--serum-knob-dark)",
  "--comp-knob-edge": "var(--serum-knob-edge)",
  "--comp-label": "var(--serum-text-dim)",
  "--comp-text": "var(--serum-text)",
  "--comp-bar": "var(--serum-bar)",
  "--comp-panel-edge": "var(--serum-edge)",
  "--comp-ring": "var(--serum-trace)",
  "--comp-ring-hot": "var(--serum-hot)",
  "--comp-handle-top": "var(--serum-handle-top)",
  "--comp-handle-bottom": "var(--serum-handle-bottom)",
} as CSSProperties;

const CATEGORY_HUES: Record<SerumCategory, string> = {
  Bass: "var(--serum-cat-bass)",
  Lead: "var(--serum-cat-lead)",
  Pad: "var(--serum-cat-pad)",
  Pluck: "var(--serum-cat-pluck)",
  Keys: "var(--serum-cat-keys)",
  Synth: "var(--serum-cat-synth)",
  Arp: "var(--serum-cat-rhythm)",
  Seq: "var(--serum-cat-rhythm)",
  Chord: "var(--serum-cat-chord)",
  Vocal: "var(--serum-cat-voice)",
  Guitar: "var(--serum-cat-chord)",
  Orchestral: "var(--serum-cat-pad)",
  Drums: "var(--serum-cat-rhythm)",
  FX: "var(--serum-cat-other)",
  Other: "var(--serum-cat-other)",
};

/** A kind of sound's hue: its dot in the list, its chip. */
export const categoryHue = (category: SerumCategory) => CATEGORY_HUES[category];

/** A mod source's hue, as Serum colours its kinds: envelopes, LFOs, macros, the rest. */
export function sourceHue(source: string): string {
  if (/^Env \d/.test(source)) return "var(--serum-src-env)";
  if (/^LFO \d/.test(source)) return "var(--serum-src-lfo)";
  if (/^Macro \d/.test(source)) return "var(--serum-src-macro)";
  return "var(--serum-src-other)";
}
