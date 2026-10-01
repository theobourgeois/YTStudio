/**
 * The plugin picker's model, pure: which group a plugin goes in (from the category it reports: VST3's
 * "Fx|EQ", "Instrument|Synth"; Audio Units' "Effect", "Synth"), the picker's columns (pinned first, then
 * each group), what a search keeps, and where the arrow keys go.
 */
import type { EnginePlugin } from "@shared/music/engine";

/** A choice in the picker: a plugin, or one of ours (the Sampler). */
export interface PickerItem {
  id: string;
  name: string;
  /** Under the name: its maker and format ("FabFilter · VST3"). */
  detail: string;
  group: string;
  plugin: EnginePlugin | null;
}

export interface PickerColumn {
  title: string;
  items: PickerItem[];
}

/** Words of a category that only say it's an effect or an instrument, not which kind. */
const VAGUE = new Set(["fx", "instrument", "effect", "effects", "music effect", "musiceffect", "generator", "plugin", "other"]);
export const PINNED = "Pinned";
export const OTHER = "Other";

/** The group a plugin goes in: the first specific word of its category ("Fx|Dynamics" → "Dynamics"), else Other. */
export function pluginGroup(plugin: Pick<EnginePlugin, "category">): string {
  const parts = plugin.category.split(/[|/]/).map((p) => p.trim()).filter((p) => p && !VAGUE.has(p.toLowerCase()));
  const first = parts[0];
  if (!first) return OTHER;
  // "EQ", "Reverb", "Synth": as reported, capitalised.
  return first.length <= 3 ? first.toUpperCase() : first[0].toUpperCase() + first.slice(1);
}

export const pickerItem = (plugin: EnginePlugin): PickerItem => ({
  id: plugin.id,
  name: plugin.name,
  detail: [plugin.manufacturer, plugin.format === "AudioUnit" ? "AU" : plugin.format].filter(Boolean).join(" · "),
  group: pluginGroup(plugin),
  plugin,
});

/** Does an item match what's typed? Every word must be in its name, maker or group. */
export function matches(item: PickerItem, query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const text = `${item.name} ${item.detail} ${item.group}`.toLowerCase();
  return words.every((w) => text.includes(w));
}

/**
 * The picker's columns: the pinned items (also in their own groups), then a column per group (ours
 * first, in the order given; then by name, Other last), items by name, only those matching `query`.
 */
export function pickerColumns(items: readonly PickerItem[], pinned: readonly string[], query: string, firstGroups: readonly string[] = []): PickerColumn[] {
  const shown = items.filter((item) => matches(item, query));
  const byName = (a: PickerItem, b: PickerItem) => a.name.localeCompare(b.name);
  const groups = new Map<string, PickerItem[]>();
  for (const item of shown) groups.set(item.group, [...(groups.get(item.group) ?? []), item]);
  const order = (a: string, b: string) => {
    const [ia, ib] = [firstGroups.indexOf(a), firstGroups.indexOf(b)];
    if (ia >= 0 || ib >= 0) return (ia < 0 ? Infinity : ia) - (ib < 0 ? Infinity : ib);
    if (a === OTHER || b === OTHER) return a === OTHER ? 1 : -1;
    return a.localeCompare(b);
  };
  const columns = [...groups].sort(([a], [b]) => order(a, b)).map(([title, list]) => ({ title, items: list.sort(byName) }));
  const pins = shown.filter((item) => pinned.includes(item.id)).sort(byName);
  return pins.length ? [{ title: PINNED, items: pins }, ...columns] : columns;
}

/** Where the highlight is: a column, and an item in it. */
export interface PickerPosition {
  column: number;
  row: number;
}

/** The highlight after an arrow key: up and down in a column, left and right to the next column (the row kept where it can be). */
export function movePosition(columns: readonly PickerColumn[], at: PickerPosition, key: "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight"): PickerPosition {
  if (!columns.length) return at;
  const column = Math.min(at.column, columns.length - 1);
  const rows = columns[column].items.length;
  switch (key) {
    case "ArrowUp":
      return { column, row: Math.max(0, at.row - 1) };
    case "ArrowDown":
      return { column, row: Math.min(rows - 1, at.row + 1) };
    case "ArrowLeft":
    case "ArrowRight": {
      const next = Math.min(columns.length - 1, Math.max(0, column + (key === "ArrowLeft" ? -1 : 1)));
      return { column: next, row: Math.min(at.row, columns[next].items.length - 1) };
    }
  }
}
