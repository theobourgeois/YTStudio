import { describe, expect, it } from "vitest";
import { resolveShortcut, type KeyLike } from "./shortcuts.ts";

const key = (k: string, mods: Partial<KeyLike> = {}): KeyLike => ({
  key: k,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  repeat: false,
  ...mods,
});

describe("resolveShortcut", () => {
  it("maps plain keys", () => {
    expect(resolveShortcut(key(" "))).toBe("togglePlay");
    expect(resolveShortcut(key("s"))).toBe("split");
    expect(resolveShortcut(key("S"))).toBe("split");
    expect(resolveShortcut(key("Backspace"))).toBe("delete");
    expect(resolveShortcut(key("Delete"))).toBe("delete");
    expect(resolveShortcut(key("Home"))).toBe("seekStart");
    expect(resolveShortcut(key("End"))).toBe("seekEnd");
    expect(resolveShortcut(key("Escape"))).toBe("deselect");
    expect(resolveShortcut(key("x"))).toBeNull();
  });

  it("steps frames with arrows and seconds with shift+arrows", () => {
    expect(resolveShortcut(key("ArrowLeft"))).toBe("prevFrame");
    expect(resolveShortcut(key("ArrowRight"))).toBe("nextFrame");
    expect(resolveShortcut(key("ArrowLeft", { shiftKey: true }))).toBe("back1s");
    expect(resolveShortcut(key("ArrowRight", { shiftKey: true }))).toBe("forward1s");
  });

  it("zooms with =/+ and -, regardless of shift", () => {
    expect(resolveShortcut(key("="))).toBe("zoomIn");
    expect(resolveShortcut(key("+", { shiftKey: true }))).toBe("zoomIn");
    expect(resolveShortcut(key("-"))).toBe("zoomOut");
  });

  it("maps ⌘ and Ctrl combos", () => {
    for (const mod of [{ metaKey: true }, { ctrlKey: true }]) {
      expect(resolveShortcut(key("z", mod))).toBe("undo");
      expect(resolveShortcut(key("Z", { ...mod, shiftKey: true }))).toBe("redo");
      expect(resolveShortcut(key("y", mod))).toBe("redo");
      expect(resolveShortcut(key("b", mod))).toBe("split");
    }
  });

  it("ignores combos that aren't ours", () => {
    expect(resolveShortcut(key("s", { metaKey: true }))).toBeNull(); // save
    expect(resolveShortcut(key("=", { metaKey: true }))).toBeNull(); // browser zoom
    expect(resolveShortcut(key(" ", { ctrlKey: true }))).toBeNull();
    expect(resolveShortcut(key("z", { metaKey: true, altKey: true }))).toBeNull();
    expect(resolveShortcut(key("z", { metaKey: true, ctrlKey: true }))).toBeNull();
    expect(resolveShortcut(key("b", { metaKey: true, shiftKey: true }))).toBeNull();
    expect(resolveShortcut(key("s", { shiftKey: true }))).toBeNull();
    expect(resolveShortcut(key(" ", { shiftKey: true }))).toBeNull();
    expect(resolveShortcut(key("ArrowLeft", { altKey: true }))).toBeNull();
  });

  it("drops auto-repeat for toggles but keeps it for stepping, zoom and history", () => {
    expect(resolveShortcut(key(" ", { repeat: true }))).toBeNull();
    expect(resolveShortcut(key("s", { repeat: true }))).toBeNull();
    expect(resolveShortcut(key("Backspace", { repeat: true }))).toBeNull();
    expect(resolveShortcut(key("ArrowRight", { repeat: true }))).toBe("nextFrame");
    expect(resolveShortcut(key("=", { repeat: true }))).toBe("zoomIn");
    expect(resolveShortcut(key("z", { metaKey: true, repeat: true }))).toBe("undo");
  });
});
