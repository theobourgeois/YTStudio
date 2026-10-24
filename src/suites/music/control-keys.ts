/**
 * The keys of a focused knob, fader or LCD, the same on every one: the arrows step it (Ctrl finely, Shift
 * or Page Up/Down coarsely), Home and End take it to its ends, Delete resets it, and Enter (or simply
 * typing a number) types its value in. Pure, so it's tested; each control maps a step to its own units.
 */

export type ControlKey =
  | { type: "step"; size: "fine" | "normal" | "coarse"; direction: -1 | 1 }
  | { type: "edge"; edge: "min" | "max" }
  | { type: "reset" }
  /** `text`: what the field starts with (the character typed), else the value as it is. */
  | { type: "typeIn"; text?: string };

interface KeyLike {
  key: string;
  code?: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

interface ControlKeyOptions {
  /** ← → step it too (a knob's turn; a vertical fader's and an LCD's are only ↑ ↓). */
  horizontal?: boolean;
  /** Delete puts it back to its default (it has one). */
  resets?: boolean;
  /** It can be typed into. */
  types?: boolean;
}

/** What a key does to a focused control, or null if it isn't the control's. */
export function resolveControlKey(e: KeyLike, { horizontal = false, resets = false, types = true }: ControlKeyOptions = {}): ControlKey | null {
  const command = e.ctrlKey || e.metaKey;
  const up = e.key === "ArrowUp" || (horizontal && e.key === "ArrowRight");
  const down = e.key === "ArrowDown" || (horizontal && e.key === "ArrowLeft");
  if ((up || down) && !e.altKey) return { type: "step", size: command ? "fine" : e.shiftKey ? "coarse" : "normal", direction: up ? 1 : -1 };
  if (e.altKey || command) return null;
  if (e.key === "PageUp" || e.key === "PageDown") return { type: "step", size: "coarse", direction: e.key === "PageUp" ? 1 : -1 };
  if (e.key === "Home" || e.key === "End") return { type: "edge", edge: e.key === "Home" ? "min" : "max" };
  if (resets && (e.key === "Delete" || e.key === "Backspace")) return { type: "reset" };
  if (!types) return null;
  if (e.key === "Enter" || e.key === "F2") return { type: "typeIn" };
  if (!e.shiftKey && /^[0-9.,-]$/.test(e.key)) return { type: "typeIn", text: e.key };
  return null;
}

