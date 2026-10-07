/**
 * Adaptive resolution (After Effects'): while the picture moves (scrubbing, playing, dragging), a frame
 * should take the GPU about this long at most, so the preview keeps up with the hand; heavier edits draw
 * at a fraction of their pixels (`ADAPTIVE_LEVELS`) until it holds still for `SETTLE_MS`, then in full.
 */
export const FRAME_BUDGET_MS = 30;
export const ADAPTIVE_LEVELS = [1, 0.75, 0.5, 0.375, 0.25];
export const SETTLE_MS = 200;

/** The largest adaptive level at which a frame costing `fullCost` ms in full fits the budget (the GPU's cost goes with the pixels). */
export function adaptiveLevel(fullCost: number): number {
  return ADAPTIVE_LEVELS.find((level) => fullCost * level * level <= FRAME_BUDGET_MS) ?? ADAPTIVE_LEVELS[ADAPTIVE_LEVELS.length - 1];
}

/**
 * The adaptive level to draw moving frames at next (now `current`), after one at `level` took the GPU
 * `cost` ms: down at once to what fits, up a step only when the step up fits too (each step at most
 * doubles the pixels and a bit), so it never swings between two.
 */
export function nextAdaptiveLevel(current: number, level: number, cost: number): number {
  if (cost > FRAME_BUDGET_MS) return Math.min(current, adaptiveLevel(cost / (level * level)));
  if (cost < FRAME_BUDGET_MS * 0.4) {
    const up = ADAPTIVE_LEVELS[Math.max(0, ADAPTIVE_LEVELS.indexOf(level) - 1)] ?? 1;
    return Math.max(current, up);
  }
  return current;
}
