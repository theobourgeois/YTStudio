/**
 * The mixer's own keys while it's the window in front, FL Studio's (`docs/fl-studio/mixer.md`).
 * Pure, so they're tested; `workspace.tsx` runs them. "Ctrl" is Ctrl or ⌘.
 */

export type MixerKeyAction =
  /** S: solo the selected tracks (or unsolo them), the other solos kept; Alt+S: solo them alone. */
  | { type: "solo"; alone: boolean }
  /** Ctrl+L: the rack's selected channels to the current track; Ctrl+Shift+L: to it and the next ones. */
  | { type: "route"; starting: boolean }
  /** Alt+L: select (in the rack) the channels routed to the current track. */
  | { type: "selectChannels" }
  /** Alt+← / →: move the selected tracks. */
  | { type: "move"; direction: -1 | 1 }
  /** ← / →: select the track before or after. */
  | { type: "select"; direction: -1 | 1 }
  | { type: "selectAll" | "rename" }
  /** Ctrl+G: the selected tracks to a new bus. */
  | { type: "bus" }
  /** Escape: only the current track stays selected. */
  | { type: "deselect" }
  /** Alt+Delete (or Alt+Backspace): delete the selected tracks (never the master). */
  | { type: "delete" }
  /** ↑ / ↓: the selected tracks' faders up or down a step (Ctrl: a fine one). */
  | { type: "volume"; direction: -1 | 1; fine: boolean }
  /** M: mute (or unmute) the selected tracks. */
  | { type: "mute" }
  /** A digit: go to that insert (two typed quickly make one number: 1 then 2 is insert 12). */
  | { type: "digit"; digit: number };

type KeyLike = Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">;

export function resolveMixerKey(e: KeyLike): MixerKeyAction | null {
  const command = e.metaKey || e.ctrlKey;
  // By position, so Alt (which types other characters on a Mac) doesn't hide the key.
  const letter = /^Key([A-Z])$/.exec(e.code)?.[1] ?? "";
  const horizontal = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : null;
  const vertical = e.key === "ArrowUp" ? 1 : e.key === "ArrowDown" ? -1 : null;
  const digit = /^(?:Digit|Numpad)(\d)$/.exec(e.code)?.[1];

  if (letter === "N" && command && e.shiftKey && !e.altKey) return { type: "rename" };
  if (e.key === "F2" && !command && !e.altKey && !e.shiftKey) return { type: "rename" };
  if (e.key === "Escape" && !command && !e.altKey && !e.shiftKey) return { type: "deselect" };
  if ((e.key === "Delete" || e.key === "Backspace") && e.altKey && !command && !e.shiftKey) return { type: "delete" };
  if (horizontal !== null && !command && !e.shiftKey) return e.altKey ? { type: "move", direction: horizontal } : { type: "select", direction: horizontal };
  if (vertical !== null && !e.altKey && !e.shiftKey) return { type: "volume", direction: vertical, fine: command };
  if (letter === "M" && !command && !e.altKey && !e.shiftKey) return { type: "mute" };
  if (digit !== undefined && !command && !e.altKey && !e.shiftKey) return { type: "digit", digit: Number(digit) };
  if (letter === "S" && !command && !e.shiftKey) return { type: "solo", alone: e.altKey };
  if (letter === "L" && command && !e.altKey) return { type: "route", starting: e.shiftKey };
  if (letter === "L" && e.altKey && !command && !e.shiftKey) return { type: "selectChannels" };
  if (letter === "A" && command && !e.altKey && !e.shiftKey) return { type: "selectAll" };
  if (letter === "G" && command && !e.altKey && !e.shiftKey) return { type: "bus" };
  return null;
}
