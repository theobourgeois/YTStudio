/** The layer stack as the Layers panel shows it: top first, while documents keep it bottom first. */

/**
 * Where a row dropped at `gap` (0 is above the top row, `count` below the bottom one) ends up, as a document index
 * (0 is the bottom): the row's own place doesn't count once it's lifted out.
 */
export function dropIndex(count: number, from: number, gap: number): number {
  const shown = count - 1 - from;
  const target = gap > shown ? gap - 1 : gap;
  return count - 1 - target;
}
