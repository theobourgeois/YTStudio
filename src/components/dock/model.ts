/**
 * A docked layout, Premiere's way (`docs/windows.md`): panels in groups of tabs, groups side by side or
 * one above the other in splits, any of them floated out as a window. The UI (`dock-area.tsx`) draws it
 * and calls these edits; they're pure, return the same layout when nothing changes, and are tested.
 */
import { createId } from "@shared/ids";

/** Panels side by side (`row`) or one above the other (`column`), each sized by its weight in `sizes`. */
export interface DockSplit<P extends string = string> {
  type: "split";
  id: string;
  direction: "row" | "column";
  children: DockNode<P>[];
  /** One weight per child: they share the room in these proportions (no smaller than their minimums). */
  sizes: number[];
}

/** Panels as tabs, one showing. */
export interface DockGroup<P extends string = string> {
  type: "group";
  id: string;
  panels: P[];
  active: P;
}

export type DockNode<P extends string = string> = DockSplit<P> | DockGroup<P>;

/** A panel floated out of the layout, and the group it came from (where "Dock" puts it back). */
export interface FloatingPanel<P extends string = string> {
  panel: P;
  from: string | null;
}

export interface DockLayout<P extends string = string> {
  /** Null once every panel is floating. */
  root: DockNode<P> | null;
  floating: FloatingPanel<P>[];
}

/** Where a panel dropped on a group goes: beside it on a side (a new group), or among its tabs. */
export type DropZone = "left" | "right" | "top" | "bottom" | "center";

const newId = () => createId("dock");

/** Every group, in reading order (left to right, top to bottom). */
export function groups<P extends string>(node: DockNode<P> | null): DockGroup<P>[] {
  if (!node) return [];
  return node.type === "group" ? [node] : node.children.flatMap((c) => groups(c));
}

/** The group a docked panel is in (null if it's floating or nowhere). */
export function groupOf<P extends string>(layout: DockLayout<P>, panel: P): DockGroup<P> | null {
  return groups(layout.root).find((g) => g.panels.includes(panel)) ?? null;
}

export const isFloating = <P extends string>(layout: DockLayout<P>, panel: P) => layout.floating.some((f) => f.panel === panel);

/** Every panel the layout has, docked or floating. */
export function panelsOf<P extends string>(layout: DockLayout<P>): P[] {
  return [...groups(layout.root).flatMap((g) => g.panels), ...layout.floating.map((f) => f.panel)];
}

/** Rebuild the tree with `fn` applied to every node, bottom up (`fn` returns the same node to keep it). */
function mapNode<P extends string>(node: DockNode<P>, fn: (node: DockNode<P>) => DockNode<P> | null): DockNode<P> | null {
  if (node.type === "group") return fn(node);
  let changed = false;
  const children: DockNode<P>[] = [];
  const sizes: number[] = [];
  node.children.forEach((child, i) => {
    const next = mapNode(child, fn);
    if (next !== child) changed = true;
    if (next) {
      children.push(next);
      sizes.push(node.sizes[i]);
    }
  });
  return fn(changed ? { ...node, children, sizes } : node);
}

/**
 * The tree tidied: no empty groups or splits, no split with one child (the child takes its place), and
 * no split directly inside another going the same way (its children join the outer one, weights scaled).
 */
function tidy<P extends string>(node: DockNode<P> | null): DockNode<P> | null {
  if (!node) return null;
  return mapNode(node, (n) => {
    if (n.type === "group") return n.panels.length ? n : null;
    if (n.children.length === 0) return null;
    if (n.children.length === 1) return n.children[0];
    if (!n.children.some((c) => c.type === "split" && c.direction === n.direction)) return n;
    const children: DockNode<P>[] = [];
    const sizes: number[] = [];
    n.children.forEach((c, i) => {
      if (c.type === "split" && c.direction === n.direction) {
        const total = c.sizes.reduce((a, b) => a + b, 0) || 1;
        c.children.forEach((cc, j) => {
          children.push(cc);
          sizes.push((n.sizes[i] * c.sizes[j]) / total);
        });
      } else {
        children.push(c);
        sizes.push(n.sizes[i]);
      }
    });
    return { ...n, children, sizes };
  });
}

/** Show a panel: make it its group's tab in front. (A floating one is already showing.) */
export function showPanel<P extends string>(layout: DockLayout<P>, panel: P): DockLayout<P> {
  const group = groupOf(layout, panel);
  if (!group || group.active === panel || !layout.root) return layout;
  return { ...layout, root: mapNode(layout.root, (n) => (n === group ? { ...group, active: panel } : n)) };
}

/** The layout without `panel` anywhere (its group closes if it was its only panel). */
export function removePanel<P extends string>(layout: DockLayout<P>, panel: P): DockLayout<P> {
  const floating = layout.floating.filter((f) => f.panel !== panel);
  const group = groupOf(layout, panel);
  if (!group) return floating.length === layout.floating.length ? layout : { ...layout, floating };
  const panels = group.panels.filter((p) => p !== panel);
  const at = group.panels.indexOf(panel);
  const active = group.active === panel ? panels[Math.min(at, panels.length - 1)] : group.active;
  const root = tidy(mapNode(layout.root!, (n) => (n === group ? { ...group, panels, active } : n)));
  return { root, floating };
}

/**
 * `panel` dropped on the group `groupId`: among its tabs (`center`, at `index`, else last), or beside it
 * in a new group of its own (a side). Taken from wherever it was, docked or floating. Nothing happens
 * if the group is gone, or the panel is its only one and it's dropped on one of its own sides.
 */
export function movePanel<P extends string>(layout: DockLayout<P>, panel: P, groupId: string, zone: DropZone, index?: number): DockLayout<P> {
  const target = groups(layout.root).find((g) => g.id === groupId);
  if (!target) return layout;
  const home = groupOf(layout, panel);
  if (home === target) {
    if (zone !== "center") {
      if (target.panels.length === 1) return layout;
    } else {
      const without = target.panels.filter((p) => p !== panel);
      const at = Math.max(0, Math.min(index ?? without.length, without.length));
      const panels = [...without.slice(0, at), panel, ...without.slice(at)];
      if (panels.every((p, i) => p === target.panels[i]) && target.active === panel) return layout;
      return { ...layout, root: mapNode(layout.root!, (n) => (n === target ? { ...target, panels, active: panel } : n)) };
    }
  }
  const removed = removePanel(layout, panel);
  // Its group changed (or it was the only one): find it again by id.
  const into = groups(removed.root).find((g) => g.id === groupId);
  if (!into || !removed.root) return layout;
  if (zone === "center") {
    const at = Math.max(0, Math.min(index ?? into.panels.length, into.panels.length));
    const panels = [...into.panels.slice(0, at), panel, ...into.panels.slice(at)];
    return { ...removed, root: mapNode(removed.root, (n) => (n === into ? { ...into, panels, active: panel } : n)) };
  }
  const fresh: DockGroup<P> = { type: "group", id: newId(), panels: [panel], active: panel };
  const direction = zone === "left" || zone === "right" ? "row" : "column";
  const before = zone === "left" || zone === "top";
  const beside: DockSplit<P> = { type: "split", id: newId(), direction, children: before ? [fresh, into] : [into, fresh], sizes: [1, 1] };
  // `tidy` folds the new split into a parent going the same way, halving the target's share between the two.
  return { ...removed, root: tidy(mapNode(removed.root, (n) => (n === into ? beside : n))) };
}

/** Float a docked panel out as a window (remembering its group, to dock it back there). */
export function floatPanel<P extends string>(layout: DockLayout<P>, panel: P): DockLayout<P> {
  if (isFloating(layout, panel)) return layout;
  const from = groupOf(layout, panel);
  if (!from) return layout;
  const removed = removePanel(layout, panel);
  return { ...removed, floating: [...removed.floating, { panel, from: from.id }] };
}

/** Dock a floating panel back: among the tabs of the group it came from, or of the first group if that's gone. */
export function dockPanel<P extends string>(layout: DockLayout<P>, panel: P): DockLayout<P> {
  const floating = layout.floating.find((f) => f.panel === panel);
  if (!floating) return layout;
  const all = groups(layout.root);
  const into = all.find((g) => g.id === floating.from) ?? all[0];
  const rest = layout.floating.filter((f) => f !== floating);
  if (!into) return { root: { type: "group", id: newId(), panels: [panel], active: panel }, floating: rest };
  return movePanel({ ...layout, floating: rest }, panel, into.id, "center");
}

/** A split's weights, set (as the sizes its children were dragged to). */
export function setSizes<P extends string>(layout: DockLayout<P>, splitId: string, sizes: number[]): DockLayout<P> {
  if (!layout.root) return layout;
  const root = mapNode(layout.root, (n) => {
    if (n.type !== "split" || n.id !== splitId || sizes.length !== n.children.length) return n;
    if (sizes.every((s, i) => s === n.sizes[i])) return n;
    return { ...n, sizes: [...sizes] };
  });
  return root === layout.root ? layout : { ...layout, root };
}

/**
 * The sizes (px) of a split's children after the border between `index` and `index + 1` moved by
 * `delta` px: only those two change, and neither goes below its minimum.
 */
export function resizePair(sizes: readonly number[], index: number, delta: number, mins: readonly number[]): number[] {
  const a = sizes[index];
  const b = sizes[index + 1];
  if (a === undefined || b === undefined) return [...sizes];
  const lo = (mins[index] ?? 0) - a;
  const hi = b - (mins[index + 1] ?? 0);
  const d = Math.max(Math.min(delta, hi), Math.min(lo, 0));
  const next = [...sizes];
  next[index] = a + d;
  next[index + 1] = b - d;
  return next;
}

/**
 * Where a panel dragged over a group (of `rect`) at `point` would land: its middle is among its tabs,
 * nearer an edge is beside it on that side.
 */
export function dropZone(rect: { x: number; y: number; width: number; height: number }, point: { x: number; y: number }): DropZone {
  const u = (point.x - rect.x) / rect.width;
  const v = (point.y - rect.y) / rect.height;
  if (u > 0.3 && u < 0.7 && v > 0.3 && v < 0.7) return "center";
  const edges: [DropZone, number][] = [
    ["left", u],
    ["right", 1 - u],
    ["top", v],
    ["bottom", 1 - v],
  ];
  return edges.reduce((best, e) => (e[1] < best[1] ? e : best))[0];
}

/** The part of a group's rectangle a drop in `zone` takes (drawn while dragging). */
export function zoneRect(rect: { x: number; y: number; width: number; height: number }, zone: DropZone) {
  const { x, y, width, height } = rect;
  if (zone === "left") return { x, y, width: width / 2, height };
  if (zone === "right") return { x: x + width / 2, y, width: width / 2, height };
  if (zone === "top") return { x, y, width, height: height / 2 };
  if (zone === "bottom") return { x, y: y + height / 2, width, height: height / 2 };
  return rect;
}

/**
 * A layout from anything (a saved one, from an older version): unknown panels and repeats are dropped,
 * broken nodes too, and panels it doesn't have go into the group of their `homes` panel (a panel added since,
 * beside the one it belongs with), else its first group, so every one of `panels` is somewhere exactly once.
 * Anything that isn't a layout at all gives `fallback`.
 */
export function normalizeLayout<P extends string>(raw: unknown, panels: readonly P[], fallback: DockLayout<P>, homes: Partial<Record<P, P>> = {}): DockLayout<P> {
  if (!raw || typeof raw !== "object") return fallback;
  const seen = new Set<P>();
  const known = (p: unknown): p is P => typeof p === "string" && (panels as readonly string[]).includes(p) && !seen.has(p as P);
  const id = (v: unknown) => (typeof v === "string" && v ? v : newId());

  const node = (n: unknown): DockNode<P> | null => {
    if (!n || typeof n !== "object") return null;
    const o = n as Record<string, unknown>;
    if (o.type === "group") {
      const list = Array.isArray(o.panels) ? o.panels.filter((p): p is P => known(p) && (seen.add(p as P), true)) : [];
      if (!list.length) return null;
      return { type: "group", id: id(o.id), panels: list, active: list.includes(o.active as P) ? (o.active as P) : list[0] };
    }
    if (o.type === "split" && (o.direction === "row" || o.direction === "column") && Array.isArray(o.children)) {
      const children: DockNode<P>[] = [];
      const sizes: number[] = [];
      o.children.forEach((c, i) => {
        const child = node(c);
        if (!child) return;
        const s = Array.isArray(o.sizes) ? Number(o.sizes[i]) : NaN;
        children.push(child);
        sizes.push(Number.isFinite(s) && s > 0 ? s : 1);
      });
      return { type: "split", id: id(o.id), direction: o.direction, children, sizes };
    }
    return null;
  };

  const r = raw as Record<string, unknown>;
  let root = tidy(node(r.root));
  const floating: FloatingPanel<P>[] = [];
  for (const f of Array.isArray(r.floating) ? r.floating : []) {
    const panel = (f as Record<string, unknown> | null)?.panel;
    if (!known(panel)) continue;
    seen.add(panel);
    const from = (f as Record<string, unknown>).from;
    floating.push({ panel, from: typeof from === "string" ? from : null });
  }
  if (!root && !floating.length) return fallback;
  const missing: P[] = [];
  for (const panel of panels.filter((p) => !seen.has(p))) {
    const home = homes[panel];
    const group = home ? groups(root).find((g) => g.panels.includes(home)) : undefined;
    if (group) root = mapNode(root!, (n) => (n === group ? { ...group, panels: [...group.panels, panel] } : n));
    else missing.push(panel);
  }
  if (missing.length) {
    const first = groups(root)[0];
    if (first) root = mapNode(root!, (n) => (n === first ? { ...first, panels: [...first.panels, ...missing] } : n));
    else root = { type: "group", id: newId(), panels: [...missing], active: missing[0] };
  }
  return { root, floating };
}
