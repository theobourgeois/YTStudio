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
