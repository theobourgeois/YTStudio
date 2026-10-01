import { describe, expect, it } from "vitest";
import { resolveBrowserKey } from "./keys";

const key = (key: string, mods: { meta?: boolean; ctrl?: boolean; shift?: boolean; alt?: boolean } = {}, code = "") => ({
  key,
  code: code || (/^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : key),
  metaKey: !!mods.meta,
  ctrlKey: !!mods.ctrl,
  shiftKey: !!mods.shift,
  altKey: !!mods.alt,
});

describe("resolveBrowserKey", () => {
  it("moves with the arrows, FL's way", () => {
    expect(resolveBrowserKey(key("ArrowDown"))).toEqual({ type: "move", direction: 1 });
    expect(resolveBrowserKey(key("ArrowUp"))).toEqual({ type: "move", direction: -1 });
    expect(resolveBrowserKey(key("ArrowRight"))).toEqual({ type: "arrow", direction: 1 });
    expect(resolveBrowserKey(key("ArrowLeft"))).toEqual({ type: "arrow", direction: -1 });
    expect(resolveBrowserKey(key("ArrowUp", { ctrl: true }))).toEqual({ type: "collapseAll" });
    expect(resolveBrowserKey(key("ArrowUp", { meta: true }))).toEqual({ type: "collapseAll" });
    expect(resolveBrowserKey(key("Home"))).toEqual({ type: "edge", direction: -1 });
    expect(resolveBrowserKey(key("PageDown"))).toEqual({ type: "page", direction: 1 });
  });

  it("searches with ⌘F, / or by typing a name", () => {
    expect(resolveBrowserKey(key("f", { meta: true }))).toEqual({ type: "search" });
    expect(resolveBrowserKey(key("/"))).toEqual({ type: "search" });
    expect(resolveBrowserKey(key("k"))).toEqual({ type: "type", text: "k" });
    expect(resolveBrowserKey(key("K", { shift: true }, "KeyK"))).toEqual({ type: "type", text: "K" });
    expect(resolveBrowserKey(key("8", {}, "Digit8"))).toEqual({ type: "type", text: "8" });
  });

  it("leaves Space (play) and ⌘R (reload) alone, and reads Ctrl+R as read again", () => {
    expect(resolveBrowserKey(key(" ", {}, "Space"))).toBeNull();
    expect(resolveBrowserKey(key("r", { meta: true }))).toBeNull();
    expect(resolveBrowserKey(key("r", { ctrl: true }))).toEqual({ type: "rescan" });
    expect(resolveBrowserKey(key("z", { meta: true }))).toBeNull();
  });

  it("has Enter and Esc", () => {
    expect(resolveBrowserKey(key("Enter"))).toEqual({ type: "enter" });
    expect(resolveBrowserKey(key("Escape"))).toEqual({ type: "escape" });
  });
});
