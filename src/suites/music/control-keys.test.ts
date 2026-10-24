import { describe, expect, it } from "vitest";
import { resolveControlKey } from "./control-keys";

const key = (k: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
});

describe("a focused control's keys", () => {
  it("steps with the arrows: Ctrl finely, Shift and Page Up/Down coarsely", () => {
    expect(resolveControlKey(key("ArrowUp"))).toEqual({ type: "step", size: "normal", direction: 1 });
    expect(resolveControlKey(key("ArrowDown", { ctrlKey: true }))).toEqual({ type: "step", size: "fine", direction: -1 });
    expect(resolveControlKey(key("ArrowUp", { shiftKey: true }))).toEqual({ type: "step", size: "coarse", direction: 1 });
    expect(resolveControlKey(key("PageDown"))).toEqual({ type: "step", size: "coarse", direction: -1 });
  });

  it("turns with ← → only when it's a knob", () => {
    expect(resolveControlKey(key("ArrowRight"))).toBeNull();
    expect(resolveControlKey(key("ArrowRight"), { horizontal: true })).toEqual({ type: "step", size: "normal", direction: 1 });
  });

  it("goes to its ends, and resets only if it has a default", () => {
    expect(resolveControlKey(key("Home"))).toEqual({ type: "edge", edge: "min" });
    expect(resolveControlKey(key("End"))).toEqual({ type: "edge", edge: "max" });
    expect(resolveControlKey(key("Delete"))).toBeNull();
    expect(resolveControlKey(key("Delete"), { resets: true })).toEqual({ type: "reset" });
  });

  it("types its value in with Enter, or a number typed straight away", () => {
    expect(resolveControlKey(key("Enter"))).toEqual({ type: "typeIn" });
    expect(resolveControlKey(key("7"))).toEqual({ type: "typeIn", text: "7" });
    expect(resolveControlKey(key("-"))).toEqual({ type: "typeIn", text: "-" });
    expect(resolveControlKey(key("7"), { types: false })).toBeNull();
    // The editor's own shortcuts pass it.
    expect(resolveControlKey(key("z", { ctrlKey: true }))).toBeNull();
    expect(resolveControlKey(key("m"))).toBeNull();
  });
});
