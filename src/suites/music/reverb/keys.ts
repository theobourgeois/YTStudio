/**
 * The Reverb window's keys while it's in front (`docs/reverb/reverb.md` 4.8): F Freeze (a tap toggles the
 * song's; held, it's momentary), ← → the previous / next preset, Tab the Decay / Shape display, A A/B.
 * Others go on to the editor (Space plays). Pure: the workspace runs what it says.
 */
export type ReverbKeyAction = { type: "freeze" } | { type: "preset"; by: 1 | -1 } | { type: "display" } | { type: "ab" };

export function resolveReverbKey(e: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">): ReverbKeyAction | null {
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  switch (e.key) {
    case "f":
    case "F":
      return e.shiftKey ? null : { type: "freeze" };
    case "ArrowLeft":
      return e.shiftKey ? null : { type: "preset", by: -1 };
    case "ArrowRight":
      return e.shiftKey ? null : { type: "preset", by: 1 };
    case "Tab":
      return { type: "display" };
    case "a":
    case "A":
      return e.shiftKey ? null : { type: "ab" };
    default:
      return null;
  }
}

/** How long F is held before it's momentary rather than a toggle (ms). */
export const HOLD_MS = 300;
