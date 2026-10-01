/**
 * A mixer track's delay, as its strip and inspector show it (FL's track delay, `docs/fl-studio/mixer.md`):
 * what its plugins say they delay its sound by, and its manual offset. The engine compensates for both
 * (`Song::compensate`); these are only what's shown.
 */
import type { EngineEffects } from "@shared/music/engine";
import type { MixerTrack } from "@shared/music/types";

/** The samples a track's effects delay its sound by: those loaded and on (a bypassed effect isn't run). */
export function pluginDelay(track: MixerTrack, loaded: EngineEffects["loaded"]): number {
  let delay = 0;
  for (const effect of track.effects) if (effect?.enabled) delay += loaded.find((e) => e.effect === effect.id)?.latency ?? 0;
  return delay;
}

/** "20.0 ms (882 samples)". */
export function delayText(samples: number, sampleRate: number): string {
  const ms = sampleRate > 0 ? (samples / sampleRate) * 1000 : 0;
  return `${ms.toFixed(1)} ms (${samples} ${samples === 1 ? "sample" : "samples"})`;
}

/** "+5 ms", "−2.5 ms". */
export const offsetText = (ms: number) => `${ms > 0 ? "+" : ms < 0 ? "−" : ""}${Math.abs(ms)} ms`;
