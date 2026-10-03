import { describe, expect, it } from "vitest";
import { resolveReverbKey } from "./keys";

const key = (k: string, mods: Partial<KeyboardEvent> = {}) => ({ key: k, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods });

describe("the Reverb window's keys", () => {
  it("freezes, steps presets, switches the display and A/B", () => {
    expect(resolveReverbKey(key("f"))).toEqual({ type: "freeze" });
    expect(resolveReverbKey(key("ArrowLeft"))).toEqual({ type: "preset", by: -1 });
    expect(resolveReverbKey(key("ArrowRight"))).toEqual({ type: "preset", by: 1 });
    expect(resolveReverbKey(key("Tab"))).toEqual({ type: "display" });
    expect(resolveReverbKey(key("a"))).toEqual({ type: "ab" });
  });

  it("leaves everything else, and anything with a modifier, to the editor", () => {
    expect(resolveReverbKey(key(" "))).toBeNull();
    expect(resolveReverbKey(key("f", { metaKey: true }))).toBeNull();
    expect(resolveReverbKey(key("a", { ctrlKey: true }))).toBeNull();
    expect(resolveReverbKey(key("ArrowLeft", { shiftKey: true }))).toBeNull();
  });
});
