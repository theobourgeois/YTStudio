import { describe, expect, it } from "vitest";
import { resolveMixerKey } from "./keys";

const key = (code: string, mods: Partial<Record<"metaKey" | "ctrlKey" | "shiftKey" | "altKey", boolean>> = {}, key = code.replace(/^Key/, "").toLowerCase()) =>
  resolveMixerKey({ key, code, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...mods });

describe("the mixer's keys", () => {
  it("are FL Studio's: S solos, Alt+S solos the path, Ctrl+L routes, Alt+L selects the channels", () => {
    expect(key("KeyS")).toEqual({ type: "solo", linked: false });
    expect(key("KeyS", { altKey: true }, "ß")).toEqual({ type: "solo", linked: true });
    expect(key("KeyL", { metaKey: true })).toEqual({ type: "route", starting: false });
    expect(key("KeyL", { ctrlKey: true, shiftKey: true })).toEqual({ type: "route", starting: true });
    expect(key("KeyL", { altKey: true }, "¬")).toEqual({ type: "selectChannels" });
    expect(key("KeyA", { metaKey: true })).toEqual({ type: "selectAll" });
    expect(key("F2", {}, "F2")).toEqual({ type: "rename" });
  });

  it("select tracks with the arrows, and move them with Alt", () => {
    expect(key("ArrowLeft", {}, "ArrowLeft")).toEqual({ type: "select", direction: -1 });
    expect(key("ArrowRight", { altKey: true }, "ArrowRight")).toEqual({ type: "move", direction: 1 });
    expect(key("ArrowRight", { metaKey: true }, "ArrowRight")).toBeNull();
    expect(key("KeyS", { metaKey: true })).toBeNull();
    expect(key("KeyQ")).toBeNull();
  });
});
