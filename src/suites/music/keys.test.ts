import { describe, expect, it } from "vitest";
import { resolveMusicKey } from "./keys";

type Mods = Partial<Record<"metaKey" | "ctrlKey" | "shiftKey" | "altKey", boolean>>;
const press = (key: string, code: string, mods: Mods = {}) => resolveMusicKey({ key, code, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...mods });

describe("music keys", () => {
  it("plays with Space, shows the rack with F6, and undoes and redoes with the usual keys", () => {
    expect(press(" ", "Space")).toEqual({ type: "togglePlay" });
    expect(press("F6", "F6")).toEqual({ type: "toggleRack" });
    expect(press("z", "KeyZ", { metaKey: true })).toEqual({ type: "undo" });
    expect(press("Z", "KeyZ", { metaKey: true, shiftKey: true })).toEqual({ type: "redo" });
    expect(press("y", "KeyY", { ctrlKey: true })).toEqual({ type: "redo" });
    expect(press("k", "KeyK", { ctrlKey: true })).toEqual({ type: "toggleGraph" });
  });

  it("mutes the first ten channels with 1…0, and solos them with Ctrl", () => {
    expect(press("1", "Digit1")).toEqual({ type: "mute", index: 0 });
    expect(press("0", "Digit0")).toEqual({ type: "mute", index: 9 });
    expect(press("3", "Digit3", { metaKey: true })).toEqual({ type: "solo", index: 2 });
    expect(press("#", "Digit3", { shiftKey: true })).toBeNull();
  });

  it("selects with the arrows, moves with Alt, clones and deletes with Alt+C and Alt+Del", () => {
    expect(press("ArrowDown", "ArrowDown")).toEqual({ type: "select", direction: 1, extend: false });
    expect(press("ArrowUp", "ArrowUp", { shiftKey: true })).toEqual({ type: "select", direction: -1, extend: true });
    expect(press("ArrowUp", "ArrowUp", { altKey: true })).toEqual({ type: "move", direction: -1 });
    // On a Mac, Alt+C types "ç": the key is known by where it is.
    expect(press("ç", "KeyC", { altKey: true })).toEqual({ type: "clone" });
    expect(press("Backspace", "Backspace", { altKey: true })).toEqual({ type: "delete" });
    expect(press("Delete", "Delete")).toBeNull();
  });

  it("copies, cuts, pastes and shifts the selected channel's steps", () => {
    expect(press("c", "KeyC", { metaKey: true })).toEqual({ type: "copy" });
    expect(press("x", "KeyX", { ctrlKey: true })).toEqual({ type: "cut" });
    expect(press("v", "KeyV", { metaKey: true })).toEqual({ type: "paste" });
    expect(press("ArrowRight", "ArrowRight", { metaKey: true, shiftKey: true })).toEqual({ type: "rotate", direction: 1 });
    expect(press("ArrowLeft", "ArrowLeft", { metaKey: true })).toBeNull();
  });

  it("leaves other keys alone", () => {
    expect(press("z", "KeyZ")).toBeNull();
    expect(press(" ", "Space", { shiftKey: true })).toBeNull();
    expect(press("z", "KeyZ", { metaKey: true, altKey: true })).toBeNull();
    expect(press("a", "KeyA")).toBeNull();
  });
});
