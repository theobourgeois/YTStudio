/**
 * Which layers are selected, Photoshop's way (docs/photo/ux.md, "Selecting layers"), pure so it's tested: a click
 * picks one, ⌘ (Ctrl) toggles one, Shift selects the run from the active layer; ⌥[ / ⌥] step through the stack and
 * ⌥, / ⌥. go to its ends, Shift adding as they go. `order` is the stack's ids, bottom first (the document's).
 */

export interface LayerSelection {
  ids: string[];
  /** The one acted on alone, and where a Shift range starts: one of `ids`, or null. */
  active: string | null;
}

export const NOTHING: LayerSelection = { ids: [], active: null };

/** A click on a layer (in the Layers panel, or on the canvas): alone, toggled (`toggle`: ⌘) or a range (`range`: Shift). */
export function clickLayer(sel: LayerSelection, order: readonly string[], id: string, mods: { toggle?: boolean; range?: boolean }): LayerSelection {
  if (mods.range && sel.active && order.includes(sel.active)) {
    const a = order.indexOf(sel.active);
    const b = order.indexOf(id);
    if (b < 0) return sel;
    const run = order.slice(Math.min(a, b), Math.max(a, b) + 1);
    // ⌘⇧ adds the run to what's selected; Shift alone makes it the selection.
    const ids = mods.toggle ? [...sel.ids.filter((x) => !run.includes(x)), ...run] : run;
    return { ids, active: sel.active };
  }
  if (mods.toggle || mods.range) {
    if (sel.ids.includes(id)) {
      const ids = sel.ids.filter((x) => x !== id);
      return { ids, active: sel.active === id ? (ids.at(-1) ?? null) : sel.active };
    }
    return { ids: [...sel.ids, id], active: id };
  }
  return { ids: [id], active: id };
}

/** Every layer (⌥⌘A), the active one kept. */
export function allLayers(sel: LayerSelection, order: readonly string[]): LayerSelection {
  return { ids: [...order], active: sel.active && order.includes(sel.active) ? sel.active : (order.at(-1) ?? null) };
}

/**
 * ⌥] (up, `1`) / ⌥[ (down, `-1`): the next layer from the active one, alone; with `add` (Shift), the next one past
 * the selection's top (or bottom) joins it. At the end of the stack nothing changes; with nothing selected, the top.
 */
export function stepLayer(sel: LayerSelection, order: readonly string[], direction: 1 | -1, add: boolean): LayerSelection {
  if (order.length === 0) return sel;
  const at = sel.ids.map((id) => order.indexOf(id)).filter((i) => i >= 0);
  if (at.length === 0) return { ids: [order.at(-1)!], active: order.at(-1)! };
  const from = add ? (direction === 1 ? Math.max(...at) : Math.min(...at)) : order.indexOf(sel.active ?? "");
  const next = order[(from < 0 ? Math.max(...at) : from) + direction];
  if (!next) return sel;
  return add ? { ids: [...sel.ids.filter((x) => x !== next), next], active: next } : { ids: [next], active: next };
}

/** ⌥. (`top`) / ⌥, (`bottom`): that end of the stack, alone; with `add` (Shift), everything from the selection to it. */
export function edgeLayer(sel: LayerSelection, order: readonly string[], to: "top" | "bottom", add: boolean): LayerSelection {
  const end = to === "top" ? order.at(-1) : order[0];
  if (!end) return sel;
  const at = sel.ids.map((id) => order.indexOf(id)).filter((i) => i >= 0);
  if (!add || at.length === 0) return { ids: [end], active: end };
  const run = to === "top" ? order.slice(Math.min(...at)) : order.slice(0, Math.max(...at) + 1);
  return { ids: [...sel.ids.filter((x) => !run.includes(x)), ...run], active: end };
}

/** The selected ids in stack order, bottom first (what edits of several layers are given). */
export const inStackOrder = (ids: readonly string[], order: readonly string[]) => order.filter((id) => ids.includes(id));
