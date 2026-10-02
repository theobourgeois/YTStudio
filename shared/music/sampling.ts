/**
 * Drawing a function of ticks as straight lines between points, close enough to it: what the engine is
 * sent of anything that changes over time (automation lanes, Gross Beat's envelopes), so it only has to
 * read along lines.
 */
import { PPQ } from "./types.ts";

/** How far a lane may be from the control it draws (in its own units: a gain, a plugin's 0..1), between its points. */
const LANE_TOLERANCE = 1e-3;
/** A lane is looked at every `step` ticks at least (a beat, or closer for an LFO), then closer where it bends, down to `LANE_FINEST`. */
export const LANE_FINEST = 1 / 8;
/** Just before a tick: the value a control arrives at, before it jumps. */
const JUST_BEFORE = 1e-6;

/**
 * A function of the song's ticks drawn as straight lines between points, from `from` to `to`, counted from
 * `from`: looked at every `step` ticks and more closely where a straight line would be further than
 * `tolerance` from it (in its own units), then thinned where the lines are straight. At each of `breaks` (where it may
 * jump) it has two points on the tick: what it arrives at, and what it jumps to.
 */
export function sampleLane(
  value: (tick: number) => number[],
  breaks: readonly number[],
  from: number,
  to: number,
  step = PPQ,
  tolerance = LANE_TOLERANCE,
): { ticks: number[]; values: number[] } {
  const edges = [from, ...breaks.filter((b) => b > from && b < to), to];
  const ticks: number[] = [];
  const values: number[] = [];
  for (let e = 0; e + 1 < edges.length; e++) {
    const a = edges[e];
    const b = edges[e + 1];
    // One run of points without jumps: sampled, refined, thinned.
    const run: { tick: number; value: number[] }[] = [];
    const steps = Math.max(1, Math.ceil((b - a) / step));
    let previous = { tick: a, value: value(a) };
    run.push(previous);
    // Looked at in quarters, not only the middle: an S (a smooth or double curve, half a wave) crosses its
    // straight line there, as if it were one.
    const refine = (left: { tick: number; value: number[] }, right: { tick: number; value: number[] }) => {
      if (right.tick - left.tick <= LANE_FINEST) return;
      const span = right.tick - left.tick;
      const middle = { tick: left.tick + span / 2, value: value(left.tick + span / 2) };
      const off = (at: number, got: number[]) => got.some((v, i) => Math.abs(v - (left.value[i] + (right.value[i] - left.value[i]) * at)) > tolerance);
      if (!off(0.5, middle.value) && !off(0.25, value(left.tick + span / 4)) && !off(0.75, value(left.tick + (span * 3) / 4))) return;
      refine(left, middle);
      run.push(middle);
      refine(middle, right);
    };
    for (let k = 1; k <= steps; k++) {
      const tick = k === steps ? b : a + ((b - a) * k) / steps;
      const next = { tick, value: value(k === steps ? b - JUST_BEFORE : tick) };
      refine(previous, next);
      run.push(next);
      previous = next;
    }
    for (const point of thin(run, tolerance)) {
      // Rounded (what's sent to the engine on every edit is smaller): far finer than a sample, or a gain heard.
      const tick = Math.round((point.tick - from) * 1e4) / 1e4;
      const rounded = point.value.map((v) => Math.round(v * 1e6) / 1e6);
      const n = rounded.length;
      // Where the last run ended on the value this one starts at, there's no jump: one point does.
      if (ticks.length && ticks[ticks.length - 1] === tick && rounded.every((v, c) => v === values[values.length - n + c])) continue;
      ticks.push(tick);
      values.push(...rounded);
    }
  }
  return { ticks, values };
}

/** Douglas–Peucker: the points of a polyline that keep it within `tolerance` of what it was. */
function thin(run: { tick: number; value: number[] }[], tolerance: number): { tick: number; value: number[] }[] {
  if (run.length <= 2) return run;
  const keep = new Uint8Array(run.length);
  keep[0] = keep[run.length - 1] = 1;
  const stack: [number, number][] = [[0, run.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    let worst = -1;
    let at = -1;
    for (let k = i + 1; k < j; k++) {
      const f = (run[k].tick - run[i].tick) / (run[j].tick - run[i].tick || 1);
      let off = 0;
      for (let c = 0; c < run[k].value.length; c++) off = Math.max(off, Math.abs(run[k].value[c] - (run[i].value[c] + (run[j].value[c] - run[i].value[c]) * f)));
      if (off > worst) {
        worst = off;
        at = k;
      }
    }
    if (worst > tolerance) {
      keep[at] = 1;
      stack.push([i, at], [at, j]);
    }
  }
  return run.filter((_, i) => keep[i]);
}
