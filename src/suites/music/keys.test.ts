import { describe, expect, it } from "vitest";
import { resolveMusicKey } from "./keys";

const key = (key: string, mods: Partial<Record<"metaKey" | "ctrlKey" | "shiftKey" | "altKey", boolean>> = {}, code = "") => ({
  key,
  code,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
});

describe("music keys", () => {
  it("plays with Space, and undoes and redoes with the usual keys", () => {
    expect(resolveMusicKey(key(" ", {}, "Space"))).toBe("togglePlay");
    expect(resolveMusicKey(key("z", { metaKey: true }))).toBe("undo");
    expect(resolveMusicKey(key("Z", { metaKey: true, shiftKey: true }))).toBe("redo");
    expect(resolveMusicKey(key("y", { ctrlKey: true }))).toBe("redo");
  });

  it("leaves other keys alone", () => {
    expect(resolveMusicKey(key("z"))).toBeNull();
    expect(resolveMusicKey(key(" ", { shiftKey: true }, "Space"))).toBeNull();
    expect(resolveMusicKey(key("z", { metaKey: true, altKey: true }))).toBeNull();
  });
});
