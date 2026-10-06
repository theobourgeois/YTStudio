import { describe, expect, it } from "vitest";
import { NOTHING, allLayers, clickLayer, edgeLayer, inStackOrder, stepLayer } from "./selection";

// The stack, bottom first.
const order = ["a", "b", "c", "d", "e"];

describe("selecting layers", () => {
  it("clicks one, toggles with ⌘, runs from the active one with Shift", () => {
    const one = clickLayer(NOTHING, order, "b", {});
    expect(one).toEqual({ ids: ["b"], active: "b" });
    const two = clickLayer(one, order, "d", { toggle: true });
    expect(two).toEqual({ ids: ["b", "d"], active: "d" });
    // Toggling the active one off makes the last one left active.
    expect(clickLayer(two, order, "d", { toggle: true })).toEqual({ ids: ["b"], active: "b" });
    expect(clickLayer(one, order, "e", { range: true })).toEqual({ ids: ["b", "c", "d", "e"], active: "b" });
    expect(clickLayer(clickLayer(one, order, "e", { range: true }), order, "a", { range: true })).toEqual({ ids: ["a", "b"], active: "b" });
    // ⌘⇧ adds the run to what's there.
    expect(clickLayer({ ids: ["e", "b"], active: "b" }, order, "a", { range: true, toggle: true }).ids.sort()).toEqual(["a", "b", "e"]);
    // Shift with nothing selected selects the one.
    expect(clickLayer(NOTHING, order, "c", { range: true })).toEqual({ ids: ["c"], active: "c" });
    expect(clickLayer(two, order, "a", {})).toEqual({ ids: ["a"], active: "a" });
  });

  it("selects all, steps through the stack and runs to its ends", () => {
    expect(allLayers({ ids: ["c"], active: "c" }, order)).toEqual({ ids: order, active: "c" });
    expect(allLayers(NOTHING, order).active).toBe("e");
    const c = { ids: ["c"], active: "c" };
    expect(stepLayer(c, order, 1, false)).toEqual({ ids: ["d"], active: "d" });
    expect(stepLayer(c, order, -1, false)).toEqual({ ids: ["b"], active: "b" });
    expect(stepLayer({ ids: ["e"], active: "e" }, order, 1, false)).toEqual({ ids: ["e"], active: "e" });
    expect(stepLayer(NOTHING, order, -1, false)).toEqual({ ids: ["e"], active: "e" });
    // Adding goes past the selection's top or bottom.
    expect(stepLayer({ ids: ["b", "c"], active: "b" }, order, 1, true)).toEqual({ ids: ["b", "c", "d"], active: "d" });
    expect(stepLayer({ ids: ["b", "c"], active: "c" }, order, -1, true)).toEqual({ ids: ["b", "c", "a"], active: "a" });
    expect(edgeLayer(c, order, "top", false)).toEqual({ ids: ["e"], active: "e" });
    expect(edgeLayer(c, order, "top", true)).toEqual({ ids: ["c", "d", "e"], active: "e" });
    expect(edgeLayer(c, order, "bottom", true)).toEqual({ ids: ["a", "b", "c"], active: "a" });
    expect(inStackOrder(["d", "a"], order)).toEqual(["a", "d"]);
  });
});
