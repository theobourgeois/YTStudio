/**
 * The mixer's own keys while it's the window in front, FL Studio's (`docs/fl-studio/mixer.md`).
 * Pure, so they're tested; `workspace.tsx` runs them. "Ctrl" is Ctrl or ⌘.
 */

export type MixerKeyAction =
  /** S: solo the current track; Alt+S with every track routed to and from it. */
  | { type: "solo"; linked: boolean }
  /** Ctrl+L: the rack's selected channels to the current track; Ctrl+Shift+L: to it and the next ones. */
  | { type: "route"; starting: boolean }
  /** Alt+L: select (in the rack) the channels routed to the current track. */
  | { type: "selectChannels" }
  /** Alt+← / →: move the selected tracks. */
  | { type: "move"; direction: -1 | 1 }
  /** ← / →: select the track before or after. */
  | { type: "select"; direction: -1 | 1 }
  | { type: "selectAll" | "rename" };

type KeyLike = Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">;

export function resolveMixerKey(e: KeyLike): MixerKeyAction | null {
  const command = e.metaKey || e.ctrlKey;
  // By position, so Alt (which types other characters on a Mac) doesn't hide the key.
  const letter = /^Key([A-Z])$/.exec(e.code)?.[1] ?? "";
  const horizontal = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : null;

  if (e.key === "F2" && !command && !e.altKey && !e.shiftKey) return { type: "rename" };
  if (horizontal !== null && !command && !e.shiftKey) return e.altKey ? { type: "move", direction: horizontal } : { type: "select", direction: horizontal };
  if (letter === "S" && !command && !e.shiftKey) return { type: "solo", linked: e.altKey };
  if (letter === "L" && command && !e.altKey) return { type: "route", starting: e.shiftKey };
  if (letter === "L" && e.altKey && !command && !e.shiftKey) return { type: "selectChannels" };
  if (letter === "A" && command && !e.altKey && !e.shiftKey) return { type: "selectAll" };
  return null;
}
