/**
 * The Browser's keys while its list has the focus (`docs/fl-studio/browser.md`), FL's where it has them.
 * Pure, so they're tested; the panel runs them. "Ctrl" is Ctrl or ⌘, but for a Mac's ⌃R (⌘R reloads the
 * page): elsewhere Ctrl+R is FL's export, which wins.
 */
import { IS_MAC } from "@/lib/key-labels";

export type BrowserKeyAction =
  /** The row above or below: selected, and played if it's a file; `send`: also sent to the selected channel (Shift, FL's). */
  | { type: "move"; direction: -1 | 1; send: boolean }
  /** → opens a folder or goes into it, ← closes it or goes out. */
  | { type: "arrow"; direction: -1 | 1 }
  /** The first or last row. */
  | { type: "edge"; direction: -1 | 1 }
  | { type: "page"; direction: -1 | 1 }
  /** Enter: open a folder, or send a file to the selected channel (FL's "replace the channel"). */
  | { type: "enter" }
  /** Stop the preview, or clear the search. */
  | { type: "escape" }
  | { type: "search" }
  /** A character typed with nothing to take it: it starts a search. */
  | { type: "type"; text: string }
  | { type: "rescan" | "collapseAll" | "selectAll" };

type KeyLike = Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">;

export function resolveBrowserKey(e: KeyLike, mac = IS_MAC): BrowserKeyAction | null {
  const command = e.metaKey || e.ctrlKey;
  const plain = !command && !e.altKey && !e.shiftKey;
  const vertical = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : null;
  const letter = /^Key([A-Z])$/.exec(e.code)?.[1] ?? "";

  if (vertical !== null) {
    if (plain) return { type: "move", direction: vertical, send: false };
    // FL's Shift+Up/Down: the next sample, straight onto the selected channel (try them in the beat).
    if (e.shiftKey && !command && !e.altKey) return { type: "move", direction: vertical, send: true };
    // Ctrl+Up: FL's "Collapse structure".
    if (command && !e.altKey && !e.shiftKey && vertical < 0) return { type: "collapseAll" };
    return null;
  }
  if (plain && (e.key === "ArrowLeft" || e.key === "ArrowRight")) return { type: "arrow", direction: e.key === "ArrowLeft" ? -1 : 1 };
  if (plain && (e.key === "Home" || e.key === "End")) return { type: "edge", direction: e.key === "Home" ? -1 : 1 };
  if (plain && (e.key === "PageUp" || e.key === "PageDown")) return { type: "page", direction: e.key === "PageUp" ? -1 : 1 };
  if (plain && e.key === "Enter") return { type: "enter" };
  if (plain && e.key === "Escape") return { type: "escape" };
  if (command && !e.altKey && !e.shiftKey && letter === "F") return { type: "search" };
  if (command && !e.altKey && !e.shiftKey && letter === "A") return { type: "selectAll" };
  if (mac && e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && letter === "R") return { type: "rescan" };
  if (plain && e.key === "/") return { type: "search" };
  // Typing a name searches for it. Space is play, as everywhere.
  if (!command && !e.altKey && e.key.length === 1 && e.key !== " ") return { type: "type", text: e.key };
  return null;
}
