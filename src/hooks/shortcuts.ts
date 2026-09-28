/**
 * Pure key -> action mapping for the global editor shortcuts (see `useShortcuts`).
 * Kept free of DOM/store access so it can be unit-tested.
 */

export type ShortcutAction =
  | "togglePlay"
  | "split"
  | "delete"
  | "undo"
  | "redo"
  | "prevFrame"
  | "nextFrame"
  | "back1s"
  | "forward1s"
  | "seekStart"
  | "seekEnd"
  | "zoomIn"
  | "zoomOut"
  | "deselect";

export type KeyLike = Pick<
  KeyboardEvent,
  "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey" | "repeat"
>;

/** Actions that make sense to auto-repeat while a key is held down. */
const REPEATABLE = new Set<ShortcutAction>([
  "undo",
  "redo",
  "prevFrame",
  "nextFrame",
  "back1s",
  "forward1s",
  "zoomIn",
  "zoomOut",
]);

export function resolveShortcut(e: KeyLike): ShortcutAction | null {
  const action = e.metaKey || e.ctrlKey ? resolveMod(e) : resolvePlain(e);
  if (!action || (e.repeat && !REPEATABLE.has(action))) return null;
  return action;
}

/** ⌘ (macOS) or Ctrl combos. */
function resolveMod(e: KeyLike): ShortcutAction | null {
  if (e.altKey || (e.metaKey && e.ctrlKey)) return null;
  const key = e.key.toLowerCase();
  if (key === "z") return e.shiftKey ? "redo" : "undo";
  if (e.shiftKey) return null;
  if (key === "y") return "redo";
  if (key === "b") return "split";
  return null;
}

/** Keys pressed without ⌘/Ctrl/Alt (Shift only where it's part of the binding). */
function resolvePlain(e: KeyLike): ShortcutAction | null {
  if (e.altKey) return null;
  switch (e.key) {
    case "ArrowLeft":
      return e.shiftKey ? "back1s" : "prevFrame";
    case "ArrowRight":
      return e.shiftKey ? "forward1s" : "nextFrame";
    // `+` needs Shift on most layouts, so Shift is irrelevant for zoom.
    case "=":
    case "+":
      return "zoomIn";
    case "-":
    case "_":
      return "zoomOut";
  }
  if (e.shiftKey) return null;
  switch (e.key) {
    case " ":
      return "togglePlay";
    case "s":
    case "S":
      return "split";
    case "Backspace":
    case "Delete":
      return "delete";
    case "Home":
      return "seekStart";
    case "End":
      return "seekEnd";
    case "Escape":
      return "deselect";
  }
  return null;
}

export const IS_MAC =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);

/** Human-readable labels for tooltips. */
export const SHORTCUT_LABELS = {
  undo: IS_MAC ? "⌘Z" : "Ctrl+Z",
  redo: IS_MAC ? "⇧⌘Z" : "Ctrl+Y",
};
