/**
 * Shortcut labels for the computer the app runs on. The app was written on a Mac, so its menus, tooltips
 * and hints name keys with the Mac's glyphs ("⇧⌘L", "⌥-click"); on Windows and Linux every resolver takes
 * Ctrl for ⌘ (FL Studio's own keys there), so the same labels read "Ctrl+Shift+L", "Alt-click". Pure but
 * for `IS_MAC`, so it's tested.
 */

/** The page runs on a Mac (Electron's or a browser's): ⌘ is the command key, labels keep their glyphs. */
export const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);

const MODIFIERS: Record<string, string> = { "⌃": "Ctrl", "⌘": "Ctrl", "⌥": "Alt", "⇧": "Shift" };
/** Windows' order: Ctrl+Alt+Shift+key. */
const ORDER = ["Ctrl", "Alt", "Shift"];
const KEYS: Record<string, string> = { "⌫": "Del", "⌦": "Del", "↵": "Enter", "↩": "Enter", "⏎": "Enter", "⎋": "Esc" };
/** What joins a modifier with "+": a key ("⇧⌘L", "⌥⌫", "⌘,") or a word ("⌘click"); not punctuation ("⌘: copy", "⌥-click"). */
const JOINS = /[\p{L}\p{N}←→↑↓⌫⌦↵↩⏎⎋,.`[\]]/u;

/** `text` with its Mac key glyphs named as on Windows (`mac` false), or as it is on a Mac. */
export function keyLabel(text: string, mac = IS_MAC): string {
  if (mac) return text;
  return text
    .replace(/([⌃⌥⇧⌘]+)([^\s⌃⌥⇧⌘]?)/gu, (_match, mods: string, next: string) => {
      const names = ORDER.filter((name) => [...mods].some((glyph) => MODIFIERS[glyph] === name)).join("+");
      if (!next) return names;
      return JOINS.test(next) ? `${names}+${next}` : `${names}${next}`;
    })
    .replace(/[⌫⌦↵↩⏎⎋]/gu, (key) => KEYS[key]);
}

/** What the computer's file manager is called, for "Show in …" and drop hints. */
export const FILE_MANAGER = IS_MAC ? "Finder" : typeof navigator !== "undefined" && /Windows/.test(navigator.userAgent) ? "File Explorer" : "the file manager";
