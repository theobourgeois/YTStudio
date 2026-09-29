import type { Clip, MediaAsset } from "@shared/types";

export type MediaFilter = "all" | "video" | "audio" | "image";

export function filterAssets(assets: MediaAsset[], filter: MediaFilter): MediaAsset[] {
  return filter === "all" ? assets : assets.filter((a) => a.kind === filter);
}

/** How many timeline clips use each asset. */
export function clipCountByAsset(clips: Clip[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const c of clips) counts.set(c.assetId, (counts.get(c.assetId) ?? 0) + 1);
  return counts;
}

/**
 * Deterministic pseudo-random bar heights (0.2..1) used to decorate audio tiles,
 * so every track gets its own stable "waveform" without fetching peaks.
 */
export function decorativePeaks(seed: string, count: number): number[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return Array.from({ length: count }, (_, i) => {
    h = (Math.imul(h, 1103515245) + 12345) >>> 0;
    const noise = (h >>> 8) / 0xffffff;
    // Taper towards the ends so the shape reads as a waveform.
    const envelope = Math.sin(((i + 0.5) / count) * Math.PI);
    return 0.2 + 0.8 * envelope * (0.35 + 0.65 * noise);
  });
}
