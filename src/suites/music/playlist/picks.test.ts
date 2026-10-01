import { describe, expect, it } from "vitest";
import { pickMode, pickPattern } from "./picks";

const order = ["a", "b", "c", "d", "e"];
const picked = (r: { selection: Set<string> }) => [...r.selection].sort();

describe("selecting patterns in the Picker", () => {
  it("picks one with a click", () => {
    expect(pickPattern(order, new Set(["a", "b"]), "a", "d", "only")).toEqual({ selection: new Set(["d"]), anchor: "d" });
  });

  it("toggles one in or out with ⌘ / Ctrl, moving the anchor there", () => {
    const added = pickPattern(order, new Set(["a"]), "a", "c", "toggle");
    expect(picked(added)).toEqual(["a", "c"]);
    expect(added.anchor).toBe("c");
    expect(picked(pickPattern(order, new Set(["a", "c"]), "c", "a", "toggle"))).toEqual(["c"]);
  });

  it("takes the range from the last one clicked with Shift, either way, keeping the anchor", () => {
    expect(pickPattern(order, new Set(["b"]), "b", "d", "range")).toEqual({ selection: new Set(["b", "c", "d"]), anchor: "b" });
    expect(picked(pickPattern(order, new Set(["d"]), "d", "a", "range"))).toEqual(["a", "b", "c", "d"]);
    // No anchor (or one that's gone): just that one.
    expect(pickPattern(order, new Set(), null, "c", "range")).toEqual({ selection: new Set(["c"]), anchor: "c" });
    expect(pickPattern(order, new Set(), "gone", "c", "range")).toEqual({ selection: new Set(["c"]), anchor: "c" });
  });

  it("reads the mode from the keys held", () => {
    const keys = { metaKey: false, ctrlKey: false, shiftKey: false };
    expect(pickMode(keys)).toBe("only");
    expect(pickMode({ ...keys, metaKey: true })).toBe("toggle");
    expect(pickMode({ ...keys, ctrlKey: true, shiftKey: true })).toBe("toggle");
    expect(pickMode({ ...keys, shiftKey: true })).toBe("range");
  });
});
