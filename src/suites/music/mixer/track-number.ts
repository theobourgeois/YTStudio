/** A track number typed in: 0, "M", "master" or "---" for the master, 1… for an insert; null if it isn't one of the `count` tracks. */
export function parseTrackNumber(typed: string, count: number): number | null {
  const text = typed.trim().toLowerCase();
  if (text === "m" || text === "master" || /^-+$/.test(text)) return 0;
  if (!/^\d+$/.test(text)) return null;
  const number = Number(text);
  return number < count ? number : null;
}
