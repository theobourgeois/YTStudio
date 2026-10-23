/** A rectangle in the page (CSS pixels). */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where two rectangles overlap, or null. */
export function intersect(a: Box, b: Box): Box | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
}

/** What's left of `rect` with `hole` taken out: up to four rectangles (the bands above and below it, then beside it). */
export function subtract(rect: Box, hole: Box): Box[] {
  const cut = intersect(rect, hole);
  if (!cut) return [rect];
  const parts: Box[] = [];
  const bottom = rect.y + rect.height;
  const right = rect.x + rect.width;
  if (cut.y > rect.y) parts.push({ x: rect.x, y: rect.y, width: rect.width, height: cut.y - rect.y });
  if (cut.y + cut.height < bottom) parts.push({ x: rect.x, y: cut.y + cut.height, width: rect.width, height: bottom - cut.y - cut.height });
  if (cut.x > rect.x) parts.push({ x: rect.x, y: cut.y, width: cut.x - rect.x, height: cut.height });
  if (cut.x + cut.width < right) parts.push({ x: cut.x + cut.width, y: cut.y, width: right - cut.x - cut.width, height: cut.height });
  return parts;
}

/**
 * The parts of a plugin's body that show: inside `within` (its frame and the desktop), not under any of
 * `over` (the windows in front of it, menus, toasts). Empty when it's all hidden.
 */
export function visibleParts(body: Box, within: Box[], over: Box[]): Box[] {
  let parts: Box[] = [body];
  for (const clip of within) parts = parts.flatMap((part) => intersect(part, clip) ?? []);
  for (const hole of over) parts = parts.flatMap((part) => subtract(part, hole));
  return parts;
}

/** A rectangle snapped out to whole pixels, so a fraction's change doesn't move the plugin's view again. */
export const rounded = (box: Box): Box => {
  const x = Math.floor(box.x);
  const y = Math.floor(box.y);
  return { x, y, width: Math.ceil(box.x + box.width) - x, height: Math.ceil(box.y + box.height) - y };
};

/** A plugin's place in the page: its body, and the parts of it that show. */
export interface Place {
  key: string;
  body: Box;
  visible: Box[];
}

const sameBox = (a: Box, b: Box) => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
const inside = (a: Box, b: Box) => a.x >= b.x && a.y >= b.y && a.x + a.width <= b.x + b.width && a.y + a.height <= b.y + b.height;

/**
 * Places whose parts linger: each plugin shows what shows now and what showed in the last `ms` while it stayed
 * where it is. WebKit draws a window that comes in front of a plugin a frame or two after the page knows of it
 * (its own process paints), so the plugin goes behind it a little late rather than leave a hole there till then.
 * What comes into view, and a plugin that moves, show at once.
 */
export function lingering<P extends Place>(ms: number): (places: P[], now: number) => P[] {
  let seen = new Map<string, { at: number; body: Box; visible: Box[] }[]>();
  return (places, now) => {
    const next = new Map<string, { at: number; body: Box; visible: Box[] }[]>();
    const result = places.map((place) => {
      const kept = (seen.get(place.key) ?? []).filter((e) => now - e.at < ms && sameBox(e.body, place.body));
      // (Newest last; an older showing of the same parts goes, the new one standing for it.)
      const same = JSON.stringify(place.visible);
      const entries = [...kept.filter((e) => JSON.stringify(e.visible) !== same), { at: now, body: place.body, visible: place.visible }];
      next.set(place.key, entries);
      const all = entries.flatMap((e) => e.visible);
      const visible = all.filter((part, i) => !all.some((other, j) => j !== i && inside(part, other) && (!sameBox(part, other) || j < i)));
      return { ...place, visible };
    });
    seen = next;
    return result;
  };
}
