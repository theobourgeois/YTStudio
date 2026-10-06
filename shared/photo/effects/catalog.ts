/**
 * The filters as the Filter menu, the Filter Gallery and the assistant list them: every filter and generator
 * definition's presets, by category. A new filter is a definition with a category and presets: every one of those
 * places picks it up, with no UI of its own.
 */
import type { EffectParamValue } from "../types.ts";
import { type EffectDefinition, FILTER_CATEGORIES, FILTERS, type FilterCategory, GENERATORS } from "./index.ts";
import type { EffectPreset } from "./params.ts";

/** One look: a definition (a filter, applied to a layer; or a generator, a new layer) and one of its presets. */
export interface FilterEntry {
  /** `type/preset`: unique, stable (the gallery's cards, Last Filter). */
  key: string;
  def: EffectDefinition & { category: FilterCategory };
  preset: EffectPreset;
}

const listed = (def: EffectDefinition): def is EffectDefinition & { category: FilterCategory } => !!def.category && !!def.presets?.length;

/** Every filter's and generator's presets, by category (in `FILTER_CATEGORIES`' order), filters first. */
export const FILTER_ENTRIES: readonly FilterEntry[] = FILTER_CATEGORIES.flatMap((category) =>
  [...FILTERS, ...GENERATORS].filter(listed).filter((def) => def.category === category).flatMap((def) => def.presets!.map((preset) => ({ key: `${def.type}/${preset.id}`, def, preset }))),
);

/** The categories that have something in them. */
export const filterCategories = (): FilterCategory[] => FILTER_CATEGORIES.filter((c) => FILTER_ENTRIES.some((e) => e.def.category === c));

export const filterEntry = (key: string): FilterEntry | undefined => FILTER_ENTRIES.find((e) => e.key === key);

/** A definition's preset by id (undefined when it has none of that name). */
export const effectPreset = (def: EffectDefinition, id: string): EffectPreset | undefined => def.presets?.find((p) => p.id === id);

/** The entries in `category` (every one when null) with every word of `query` in their names, look or category. */
export function searchFilters(query: string, category: FilterCategory | null = null): FilterEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return FILTER_ENTRIES.filter((e) => {
    if (category && e.def.category !== category) return false;
    const text = `${e.def.label} ${e.preset.label} ${e.preset.description} ${e.def.category}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });
}

/** An entry's parameters for a canvas. */
export const entryParams = (entry: FilterEntry, canvas: { width: number; height: number }): Record<string, EffectParamValue> => entry.preset.params(canvas);

/** The presets of every filter and generator, for the model: `type: id (Label: description), …`. */
export function describePresets(kind: "filter" | "generator"): string {
  return FILTER_ENTRIES.filter((e) => e.def.kind === kind)
    .reduce<string[]>((lines, e) => {
      const line = `${e.preset.id} (${e.preset.label}: ${e.preset.description})`;
      const head = `${e.def.type} presets: `;
      const at = lines.findIndex((l) => l.startsWith(head));
      if (at < 0) lines.push(head + line);
      else lines[at] += `; ${line}`;
      return lines;
    }, [])
    .join("\n");
}
