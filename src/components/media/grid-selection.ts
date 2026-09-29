/**
 * Selecting cards in a grid (the Media and Library tabs), like Finder:
 * click selects one, ⌘-click toggles one, ⇧-click selects a run from the last
 * clicked card, and dragging a box over empty space selects what it touches.
 */

export interface GridSelection {
  ids: readonly string[];
  /** Where a ⇧-click range starts: the last card clicked without ⇧. */
  anchor: string | null;
}

export const NO_SELECTION: GridSelection = { ids: [], anchor: null };

export interface ClickModifiers {
  /** ⌘ (Ctrl elsewhere): add or remove one card. */
  toggle: boolean;
  /** ⇧: select from the anchor to this card. */
  range: boolean;
}

/** The selection after clicking `id`; `order` is the cards as shown. */
export function clickSelect(sel: GridSelection, order: readonly string[], id: string, mods: ClickModifiers): GridSelection {
  const anchorAt = sel.anchor === null ? -1 : order.indexOf(sel.anchor);
  const at = order.indexOf(id);
  if (mods.range && anchorAt >= 0 && at >= 0) {
    const run = order.slice(Math.min(anchorAt, at), Math.max(anchorAt, at) + 1);
    return { ids: mods.toggle ? union(sel.ids, run) : run, anchor: sel.anchor };
  }
  if (mods.toggle || mods.range) {
    const ids = sel.ids.includes(id) ? sel.ids.filter((x) => x !== id) : [...sel.ids, id];
    return { ids, anchor: id };
  }
  return { ids: [id], anchor: id };
}

/** Drop what's no longer shown (deleted, filtered out, another folder). Same instance when nothing changed. */
export function pruneSelection(sel: GridSelection, order: readonly string[]): GridSelection {
  if (sel.ids.length === 0) return sel;
  const shown = new Set(order);
  const ids = sel.ids.filter((id) => shown.has(id));
  const anchor = sel.anchor !== null && shown.has(sel.anchor) ? sel.anchor : null;
  return ids.length === sel.ids.length && anchor === sel.anchor ? sel : { ids, anchor };
}

/** The selected ids in the order they're shown (what actions act on). */
export function orderedSelection(sel: GridSelection, order: readonly string[]): string[] {
  if (sel.ids.length === 0) return [];
  const chosen = new Set(sel.ids);
  return order.filter((id) => chosen.has(id));
}

/**
 * What a card's actions (its menu, dragging it) apply to: the whole selection
 * when the card is in it, else just the card.
 */
export function actionTargets(sel: GridSelection, order: readonly string[], id: string): string[] {
  return sel.ids.includes(id) ? orderedSelection(sel, order) : [id];
}

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The box between two points, whichever way it was dragged. */
export function boxBetween(a: { x: number; y: number }, b: { x: number; y: number }): Box {
  return { left: Math.min(a.x, b.x), top: Math.min(a.y, b.y), right: Math.max(a.x, b.x), bottom: Math.max(a.y, b.y) };
}

export function boxesOverlap(a: Box, b: Box): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/** The selection while a box is dragged over `hits`: those alone, or added to `base` (⌘/⇧ held). */
export function marqueeSelect(base: GridSelection, hits: readonly string[], additive: boolean): GridSelection {
  return { ids: additive ? union(base.ids, hits) : [...hits], anchor: hits.at(-1) ?? base.anchor };
}

function union(a: readonly string[], b: readonly string[]): string[] {
  const seen = new Set(a);
  return [...a, ...b.filter((id) => !seen.has(id))];
}
