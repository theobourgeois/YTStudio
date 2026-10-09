/**
 * The open projects as tabs, Photoshop's way: the ids in the order they sit in the strip. Pure, so the store
 * (`useProjects`) only keeps the list and these decide what it becomes.
 */

/** `id` in the strip, at the end if it isn't there yet (the same list if it is). */
export function withTab(tabs: readonly string[], id: string): readonly string[] {
  return tabs.includes(id) ? tabs : [...tabs, id];
}

/** The strip without `id` (the same list if it isn't there). */
export function withoutTab(tabs: readonly string[], id: string): readonly string[] {
  return tabs.includes(id) ? tabs.filter((t) => t !== id) : tabs;
}

/**
 * Which tab to show when `id` is closed: the one that slides into its place (its right neighbour), else the
 * one before it, else none (the Home screen).
 */
export function tabAfterClose(tabs: readonly string[], id: string): string | null {
  const at = tabs.indexOf(id);
  if (at < 0) return null;
  return tabs[at + 1] ?? tabs[at - 1] ?? null;
}

/** The tab `step` places from `current` (wrapping round), or the first/last when `current` isn't a tab. */
export function cycleTab(tabs: readonly string[], current: string | null, step: 1 | -1): string | null {
  if (!tabs.length) return null;
  const at = current ? tabs.indexOf(current) : -1;
  if (at < 0) return step > 0 ? tabs[0] : tabs[tabs.length - 1];
  return tabs[(at + step + tabs.length) % tabs.length];
}

/** `id` moved to place `to` (clamped), the others keeping their order. */
export function moveTab(tabs: readonly string[], id: string, to: number): readonly string[] {
  const from = tabs.indexOf(id);
  if (from < 0) return tabs;
  const target = Math.max(0, Math.min(tabs.length - 1, to));
  if (target === from) return tabs;
  const next = tabs.filter((t) => t !== id);
  next.splice(target, 0, id);
  return next;
}

/** A saved strip, checked: only strings, no repeats, and only projects that still exist. */
export function restoreTabs(saved: unknown, exists: (id: string) => boolean): string[] {
  if (!Array.isArray(saved)) return [];
  const seen = new Set<string>();
  for (const id of saved) if (typeof id === "string" && exists(id)) seen.add(id);
  return [...seen];
}

/**
 * Whether the strip shows: always while a project is open, and on the Home screen while there are tabs to go back
 * to; never when Settings hides it (`hidden`: the menu row starts the window).
 */
export function tabsVisible(tabCount: number, home: boolean, hidden = false): boolean {
  return !hidden && (!home || tabCount >= 1);
}
