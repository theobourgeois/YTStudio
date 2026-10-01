/**
 * Selecting patterns in the Picker, as lists select: a click picks one, ⌘ (Ctrl) toggles one, Shift
 * picks the range from the last one clicked. Pure, so it's tested; the Picker keeps the result in the
 * Playlist's store (UI state, not the song).
 */

export type PickMode = "only" | "toggle" | "range";

export interface PatternPick {
  selection: Set<string>;
  /** Where the next Shift+click's range starts. */
  anchor: string;
}

/** What a click on pattern `id` selects, given the patterns' order and what's selected now. */
export function pickPattern(order: readonly string[], selection: ReadonlySet<string>, anchor: string | null, id: string, mode: PickMode): PatternPick {
  if (mode === "toggle") {
    const next = new Set(selection);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return { selection: next, anchor: id };
  }
  const from = anchor === null ? -1 : order.indexOf(anchor);
  const to = order.indexOf(id);
  if (mode === "only" || from < 0 || to < 0) return { selection: new Set([id]), anchor: id };
  return { selection: new Set(order.slice(Math.min(from, to), Math.max(from, to) + 1)), anchor: anchor! };
}

/** How a click picks: ⌘ or Ctrl toggles, Shift takes a range. */
export const pickMode = (e: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }): PickMode => (e.metaKey || e.ctrlKey ? "toggle" : e.shiftKey ? "range" : "only");
