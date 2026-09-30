/** Every preset, transitions first, in the order the Effects tab shows them. */
import type { PresetDefinition } from "../presets.ts";
import { EFFECT_PRESETS } from "./effects.ts";
import { TRANSITION_PRESETS } from "./transitions.ts";

export const PRESET_LIBRARY: PresetDefinition[] = [...TRANSITION_PRESETS, ...EFFECT_PRESETS];
