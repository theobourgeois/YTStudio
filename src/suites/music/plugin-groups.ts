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
 * The picker's columns: the pinned items (only there, not again in their groups), then a column per group
 * (ours first, in the order given; then by name, Other last), items by name, only those matching `query`.
 */
export function pickerColumns(items: readonly PickerItem[], pinned: readonly string[], query: string, firstGroups: readonly string[] = []): PickerColumn[] {
  const shown = items.filter((item) => matches(item, query));
  const byName = (a: PickerItem, b: PickerItem) => a.name.localeCompare(b.name);
  const groups = new Map<string, PickerItem[]>();
  for (const item of shown) if (!pinned.includes(item.id)) groups.set(item.group, [...(groups.get(item.group) ?? []), item]);
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

/** Lines (a group's title or an item) a column of the picker holds before the next one starts. */
export const PICKER_ROWS = 14;
/** Columns side by side before the picker scrolls across instead. */
export const PICKER_COLUMNS = 4;

/** Lines that make one column, across the picker's whole width (two columns would leave the second empty). */
export const ONE_COLUMN_ROWS = 6;

/**
 * How big the picker is for these columns: a handful, one column across its width, as tall as they are; a
 * few more, two columns or more (at least two, so the second isn't left empty beside a wide first), just
 * tall enough for them, evened out; more than `PICKER_COLUMNS` of `PICKER_ROWS` hold, null (full size,
 * scrolling across).
 */
export function pickerSize(columns: readonly PickerColumn[]): { columns: number; rows: number } | null {
  const lines = columns.reduce((n, column) => n + 1 + column.items.length, 0);
  if (lines <= ONE_COLUMN_ROWS) return { columns: 1, rows: Math.max(1, lines) };
  const count = Math.max(2, Math.ceil(lines / PICKER_ROWS));
  if (count > PICKER_COLUMNS) return null;
  // A line spare in each: a group's title isn't left alone at a column's foot, so a column may end one short.
  return { columns: count, rows: Math.min(PICKER_ROWS, Math.ceil(lines / count) + 1) };
}

/** Every item in the order the picker shows them (group after group), each with its group: up and down go through this. */
export function pickerOrder(columns: readonly PickerColumn[]): { item: PickerItem; group: string }[] {
  return columns.flatMap((column) => column.items.map((item) => ({ item, group: column.title })));
}

/**
 * The item beside another, in the next column to the left or right of it as laid out: the one whose
 * top is nearest (by `rects`, the items' places on screen, in `pickerOrder`); null past the last column.
 */
export function besideIndex(rects: readonly { left: number; right: number; top: number }[], from: number, direction: -1 | 1): number | null {
  const here = rects[from];
  if (!here) return null;
  const across = rects.map((r, i) => ({ r, i })).filter(({ r }) => (direction > 0 ? r.left >= here.right - 1 : r.right <= here.left + 1));
  if (!across.length) return null;
  // The nearest column that way, then the item in it level with this one.
  const edge = direction > 0 ? Math.min(...across.map(({ r }) => r.left)) : Math.max(...across.map(({ r }) => r.left));
  const column = across.filter(({ r }) => Math.abs(r.left - edge) < 2);
  return column.reduce((best, c) => (Math.abs(c.r.top - here.top) < Math.abs(best.r.top - here.top) ? c : best)).i;
}

/** Which of this computer's plugins the Plugin manager lists. */
export type ManagerFilter = "all" | "instrument" | "effect" | "starred";

/**
 * The Plugin manager's rows (FL Studio's: every plugin found, a star on each): those of `filter` that match
 * `query` (as the picker matches), by name, then format.
 */
export function managerRows(plugins: readonly EnginePlugin[], starred: readonly string[], query: string, filter: ManagerFilter): EnginePlugin[] {
  const kept = plugins.filter(
    (p) =>
      (filter === "all" || (filter === "starred" ? starred.includes(p.id) : p.isInstrument === (filter === "instrument"))) && matches(pickerItem(p), query),
  );
  return kept.sort((a, b) => a.name.localeCompare(b.name) || a.format.localeCompare(b.format));
}

/** The plugins a picker offers: only the starred, as FL Studio's lists only its favourites (the rest are in the Plugin manager). */
export const starredPlugins = (plugins: readonly EnginePlugin[], starred: readonly string[]) => plugins.filter((p) => starred.includes(p.id));
