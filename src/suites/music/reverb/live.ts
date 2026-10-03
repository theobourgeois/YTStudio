/**
 * What each Reverb is doing, as the engine says it (`EngineReverbState`, about 25 times a second): kept
 * outside React, as Pro-C's history is, so its window's canvases and meters read it every frame without
 * re-rendering. The tail's spectrum falls between events at each frequency's own T60, as Pro-R 2's does.
 */
import type { EngineReverbState } from "@shared/music/engine";

export interface VerbLive {
  state: EngineReverbState;
  /** When it came (`performance.now()` ms). */
  at: number;
  /** The analyzer as drawn: dB at each of the engine's points, held and falling. */
  spectrum: Float32Array | null;
  /** When the spectrum was last moved on (ms). */
  fellAt: number;
}

const lives = new Map<string, VerbLive>();

/** The engine said what its Reverbs did (`EngineTransport.reverbs`). */
export function takeReverbs(states: Record<string, EngineReverbState> | undefined, now = performance.now()) {
  if (!states) return;
  for (const [id, state] of Object.entries(states)) {
    const before = lives.get(id);
    let spectrum = before?.spectrum ?? null;
    if (state.spectrum) {
      // A new measurement: what's louder takes over at once; the rest keeps falling (`fall`).
      if (!spectrum || spectrum.length !== state.spectrum.length) spectrum = Float32Array.from(state.spectrum);
      else for (let i = 0; i < spectrum.length; i++) spectrum[i] = Math.max(spectrum[i], state.spectrum[i]);
    }
    lives.set(id, { state, at: now, spectrum, fellAt: before?.fellAt ?? now });
  }
}

/**
 * The analyzer moved on to `now`: each point falls 60 dB in its frequency's T60 (`t60At(i)`, seconds),
 * so a band that rings too long is seen hanging. Returns the spectrum to draw, or null.
 */
export function fall(id: string, now: number, t60At: (i: number) => number): Float32Array | null {
  const live = lives.get(id);
  if (!live?.spectrum) return null;
  const dt = Math.max(0, (now - live.fellAt) / 1000);
  live.fellAt = now;
  if (dt > 0) for (let i = 0; i < live.spectrum.length; i++) live.spectrum[i] = Math.max(-150, live.spectrum[i] - (60 * dt) / Math.max(0.05, t60At(i)));
  return live.spectrum;
}

/** What it said last, if it's recent (within `within` ms): stopped, the meters fall to nothing. */
export function latest(id: string, now = performance.now(), within = 400): EngineReverbState | null {
  const live = lives.get(id);
  return live && now - live.at <= within ? live.state : null;
}
