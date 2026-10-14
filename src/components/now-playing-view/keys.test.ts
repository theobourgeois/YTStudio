import { describe, expect, it } from "vitest";
import { visualizerKey } from "./keys";

const key = (code: string, key = "", mods: Partial<{ shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; altKey: boolean }> = {}) =>
  visualizerKey({ code, key, shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, ...mods });

describe("visualizerKey", () => {
  it("moves between looks and songs on the arrows", () => {
    expect(key("ArrowRight", "ArrowRight")).toEqual({ kind: "look", step: 1 });
    expect(key("ArrowLeft", "ArrowLeft", { shiftKey: true })).toEqual({ kind: "song", step: -1 });
    expect(key("ArrowDown", "ArrowDown")).toEqual({ kind: "group", step: 1 });
  });

  it("punches on Z X C V, whatever the keyboard's layout says", () => {
    expect(key("KeyZ", "y")).toEqual({ kind: "pad", pad: "zoom" });
    expect(key("KeyV", "v")).toEqual({ kind: "pad", pad: "twist" });
  });

  it("turns the colours on the number row, 1 being the look's own", () => {
    expect(key("Digit1", "1")).toEqual({ kind: "hue", degrees: 0 });
    expect(key("Digit2", "2")).toEqual({ kind: "hue", degrees: 36 });
    expect(key("Digit0", "0")).toEqual({ kind: "hue", degrees: 324 });
  });

  it("leaves the app's own shortcuts alone", () => {
    expect(key("KeyR", "r", { metaKey: true })).toBeNull();
    expect(key("KeyQ", "q")).toBeNull();
    expect(key("Escape", "Escape")).toEqual({ kind: "close" });
  });
});
