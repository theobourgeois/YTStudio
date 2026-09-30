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
    expect(resolveShortcut(key("k"))).toBe("pause");
    expect(resolveShortcut(key("l"))).toBe("play");
    expect(resolveShortcut(key("q"))).toBe("trimStart");
    expect(resolveShortcut(key("w"))).toBe("trimEnd");
    expect(resolveShortcut(key("n"))).toBe("toggleSnapping");
    expect(resolveShortcut(key("t"))).toBe("textTool");
    expect(resolveShortcut(key("v"))).toBe("selectTool");
    expect(resolveShortcut(key("\\"))).toBe("zoomFit");
    expect(resolveShortcut(key("Z", { shiftKey: true }))).toBe("zoomFit");
    expect(resolveShortcut(key("?", { shiftKey: true }))).toBe("showShortcuts");
    expect(resolveShortcut(key("Backspace", { shiftKey: true }))).toBe("rippleDelete");
    expect(resolveShortcut(key("x"))).toBeNull();
  });

  it("marks In and Out like Premiere", () => {
    expect(resolveShortcut(key("i"))).toBe("markIn");
    expect(resolveShortcut(key("o"))).toBe("markOut");
    expect(resolveShortcut(key("I", { shiftKey: true }))).toBe("goToIn");
    expect(resolveShortcut(key("O", { shiftKey: true }))).toBe("goToOut");
    // ⌥X types "≈" on a Mac: it goes by the physical key.
    expect(resolveShortcut(key("≈", { altKey: true, code: "KeyX" }))).toBe("clearMarks");
    expect(resolveShortcut(key("u", { metaKey: true }))).toBe("makeSubclip");
    expect(resolveShortcut(key("i", { repeat: true }))).toBeNull();
  });

  it("goes to the previous / next clip start or end with ⌘← / ⌘→", () => {
    expect(resolveShortcut(key("ArrowLeft", { metaKey: true }))).toBe("prevEdit");
    expect(resolveShortcut(key("ArrowRight", { ctrlKey: true }))).toBe("nextEdit");
    expect(resolveShortcut(key("ArrowRight", { metaKey: true, repeat: true }))).toBe("nextEdit");
    expect(resolveShortcut(key("ArrowRight", { metaKey: true, shiftKey: true }))).toBeNull();
  });

  it("jumps between keyframes with [ and ]", () => {
    expect(resolveShortcut(key("["))).toBe("prevKeyframe");
    expect(resolveShortcut(key("]"))).toBe("nextKeyframe");
    expect(resolveShortcut(key("]", { repeat: true }))).toBe("nextKeyframe");
  });

  it("steps frames with arrows and seconds with shift+arrows", () => {
    expect(resolveShortcut(key("ArrowLeft"))).toBe("prevFrame");
    expect(resolveShortcut(key("ArrowRight"))).toBe("nextFrame");
    expect(resolveShortcut(key("ArrowLeft", { shiftKey: true }))).toBe("back1s");
    expect(resolveShortcut(key("ArrowRight", { shiftKey: true }))).toBe("forward1s");
    expect(resolveShortcut(key("ArrowUp"))).toBe("prevEdit");
    expect(resolveShortcut(key("ArrowDown"))).toBe("nextEdit");
  });

  it("nudges and moves clips with Alt + arrows", () => {
    expect(resolveShortcut(key("ArrowLeft", { altKey: true }))).toBe("nudgeLeft");
    expect(resolveShortcut(key("ArrowRight", { altKey: true }))).toBe("nudgeRight");
    expect(resolveShortcut(key("ArrowLeft", { altKey: true, shiftKey: true }))).toBe("nudgeLeftMore");
    expect(resolveShortcut(key("ArrowUp", { altKey: true }))).toBe("moveUp");
    expect(resolveShortcut(key("ArrowDown", { altKey: true }))).toBe("moveDown");
    expect(resolveShortcut(key("s", { altKey: true }))).toBeNull();
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
      expect(resolveShortcut(key("k", mod))).toBe("split");
      expect(resolveShortcut(key("x", mod))).toBe("cut");
      expect(resolveShortcut(key("c", mod))).toBe("copy");
      expect(resolveShortcut(key("v", mod))).toBe("paste");
      expect(resolveShortcut(key("d", mod))).toBe("duplicate");
      expect(resolveShortcut(key("r", mod))).toBe("speed");
      expect(resolveShortcut(key("a", mod))).toBe("selectAll");
    }
  });

  it("copies and pastes effects with ⌥⌘C / ⌥⌘V, by physical key (⌥ changes the character on a Mac)", () => {
    expect(resolveShortcut(key("ç", { metaKey: true, altKey: true, code: "KeyC" }))).toBe("copyEffects");
    expect(resolveShortcut(key("√", { metaKey: true, altKey: true, code: "KeyV" }))).toBe("pasteEffects");
    expect(resolveShortcut(key("c", { ctrlKey: true, altKey: true, code: "KeyC" }))).toBe("copyEffects");
    expect(resolveShortcut(key("c", { altKey: true, code: "KeyC" }))).toBeNull();
  });

  it("adds an adjustment layer with ⌥⌘Y and a solid with ⌥⇧⌘Y (After Effects' keys; ⌘Y stays redo)", () => {
    expect(resolveShortcut(key("¥", { metaKey: true, altKey: true, code: "KeyY" }))).toBe("newAdjustmentLayer");
    expect(resolveShortcut(key("Á", { metaKey: true, altKey: true, shiftKey: true, code: "KeyY" }))).toBe("newSolid");
    expect(resolveShortcut(key("y", { ctrlKey: true, altKey: true, code: "KeyY" }))).toBe("newAdjustmentLayer");
    expect(resolveShortcut(key("y", { metaKey: true, code: "KeyY" }))).toBe("redo");
    expect(resolveShortcut(key("Ç", { metaKey: true, altKey: true, shiftKey: true, code: "KeyC" }))).toBe("newCamera");
    expect(resolveShortcut(key("©", { altKey: true, code: "KeyG" }))).toBe("nest");
  });

  it("ignores combos that aren't ours", () => {
    expect(resolveShortcut(key("s", { metaKey: true }))).toBeNull(); // save
    expect(resolveShortcut(key("=", { metaKey: true }))).toBeNull(); // browser zoom
    expect(resolveShortcut(key(" ", { ctrlKey: true }))).toBeNull();
    expect(resolveShortcut(key("z", { metaKey: true, altKey: true }))).toBeNull();
    expect(resolveShortcut(key("z", { metaKey: true, ctrlKey: true }))).toBeNull();
    expect(resolveShortcut(key("b", { metaKey: true, shiftKey: true }))).toBeNull();
    expect(resolveShortcut(key("\\", { metaKey: true }))).toBe("toggleSidebar");
    expect(resolveShortcut(key("i", { metaKey: true }))).toBe("toggleAssistant");
    expect(resolveShortcut(key("s", { shiftKey: true }))).toBeNull();
    expect(resolveShortcut(key(" ", { shiftKey: true }))).toBeNull();
    expect(resolveShortcut(key("c", { metaKey: true, shiftKey: true }))).toBeNull();
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
