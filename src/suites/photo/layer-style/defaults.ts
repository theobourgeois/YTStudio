/**
 * Each effect's defaults on this computer (Photoshop's Make Default / Reset to Default): what a new one starts with,
 * kept in localStorage, never in the photo. Without any, the factory defaults (the definitions').
 */
import { defaultParams } from "@shared/photo/effects/params";
import { styleDefinition } from "@shared/photo/style/definitions";
import { styleParams } from "@shared/photo/style/style";
import type { EffectParamValue } from "@shared/photo/types";

const KEY = "photo-style-defaults";

function saved(): Record<string, Record<string, unknown>> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
}

/** A type's defaults: the user's (checked) or the factory's. */
export function styleDefaults(type: string): Record<string, EffectParamValue> {
  const def = styleDefinition(type);
  if (!def) return {};
  const mine = saved()[type];
  return mine ? styleParams(def, mine).params : defaultParams(def.params);
}

/** Make Default: these become the type's defaults on this computer. */
export function makeDefault(type: string, params: Record<string, EffectParamValue>) {
  const all = saved();
  all[type] = params;
  localStorage.setItem(KEY, JSON.stringify(all));
}
