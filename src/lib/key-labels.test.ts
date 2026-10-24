import { describe, expect, it } from "vitest";
import { keyLabel } from "./key-labels";

describe("keyLabel", () => {
  it("keeps a Mac's glyphs on a Mac", () => {
    expect(keyLabel("⇧⌘L", true)).toBe("⇧⌘L");
  });

  it("names modifiers as Windows does, in its order", () => {
    expect(keyLabel("⌘L", false)).toBe("Ctrl+L");
    expect(keyLabel("⇧⌘L", false)).toBe("Ctrl+Shift+L");
    expect(keyLabel("⌘⇧R", false)).toBe("Ctrl+Shift+R");
    expect(keyLabel("⇧⌥`", false)).toBe("Alt+Shift+`");
    expect(keyLabel("⌥⇧M", false)).toBe("Alt+Shift+M");
    expect(keyLabel("⌃R", false)).toBe("Ctrl+R");
    expect(keyLabel("⇧⌘←", false)).toBe("Ctrl+Shift+←");
    expect(keyLabel("⌥1", false)).toBe("Alt+1");
  });

  it("names Delete, Enter and Escape", () => {
    expect(keyLabel("⌥⌫", false)).toBe("Alt+Del");
    expect(keyLabel("↵", false)).toBe("Enter");
  });

  it("rewrites shortcuts inside a sentence, and joins clicks", () => {
    expect(keyLabel("Export (⌘R, ⌘⇧R for an MP3)", false)).toBe("Export (Ctrl+R, Ctrl+Shift+R for an MP3)");
    expect(keyLabel("⌘click", false)).toBe("Ctrl+click");
    expect(keyLabel("⌥-click to solo it alone, ⇧-click for solo safe", false)).toBe("Alt-click to solo it alone, Shift-click for solo safe");
    expect(keyLabel("drop to move (⌘: copy)", false)).toBe("drop to move (Ctrl: copy)");
    expect(keyLabel("Settings (⌘,)", false)).toBe("Settings (Ctrl+,)");
  });

  it("leaves text without glyphs alone", () => {
    expect(keyLabel("Shift+C", false)).toBe("Shift+C");
    expect(keyLabel("F5", false)).toBe("F5");
  });
});
