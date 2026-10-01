/** Ids for everything the app makes (projects, media, clips, channels...): `<prefix>_<12 hex digits>`. */
export function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}
