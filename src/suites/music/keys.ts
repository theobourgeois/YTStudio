/** The music editor's keyboard shortcuts. Pure, so they're tested; `workspace.tsx` listens and runs them. */

export type MusicKeyAction = "togglePlay" | "undo" | "redo";

type KeyLike = Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">;

export function resolveMusicKey(e: KeyLike): MusicKeyAction | null {
  const command = e.metaKey || e.ctrlKey;
  if (e.altKey) return null;
  if (!command && !e.shiftKey && e.code === "Space") return "togglePlay";
  if (command && e.key.toLowerCase() === "z") return e.shiftKey ? "redo" : "undo";
  if (command && !e.shiftKey && e.key.toLowerCase() === "y") return "redo";
  return null;
}

/** Typing into a field: the keyboard is the field's. */
export function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || target.closest("input, textarea, select") !== null);
}
