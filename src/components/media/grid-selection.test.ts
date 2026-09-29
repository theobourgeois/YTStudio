import { describe, expect, it } from "vitest";
import {
  NO_SELECTION,
  actionTargets,
  boxBetween,
  boxesOverlap,
  clickSelect,
  marqueeSelect,
  orderedSelection,
  pruneSelection,
} from "./grid-selection.ts";

const order = ["a", "b", "c", "d", "e"];
const plain = { toggle: false, range: false };
const toggle = { toggle: true, range: false };
const range = { toggle: false, range: true };

describe("clickSelect", () => {
  it("selects one card on a plain click", () => {
    const sel = clickSelect({ ids: ["a", "b"], anchor: "a" }, order, "c", plain);
    expect(sel).toEqual({ ids: ["c"], anchor: "c" });
  });

  it("toggles one card with ⌘", () => {
    let sel = clickSelect(NO_SELECTION, order, "b", toggle);
    sel = clickSelect(sel, order, "d", toggle);
    expect(sel).toEqual({ ids: ["b", "d"], anchor: "d" });
    sel = clickSelect(sel, order, "b", toggle);
    expect(sel).toEqual({ ids: ["d"], anchor: "b" });
  });

  it("selects a run from the anchor with ⇧, either way", () => {
    const start = clickSelect(NO_SELECTION, order, "b", plain);
    expect(clickSelect(start, order, "d", range).ids).toEqual(["b", "c", "d"]);
    const back = clickSelect(clickSelect(start, order, "d", range), order, "a", range);
    expect(back).toEqual({ ids: ["a", "b"], anchor: "b" });
  });

  it("adds the run to the selection with ⌘⇧", () => {
    const sel = clickSelect({ ids: ["e"], anchor: "a" }, order, "b", { toggle: true, range: true });
    expect(sel.ids).toEqual(["e", "a", "b"]);
  });

  it("toggles when ⇧ has no anchor to start from", () => {
    expect(clickSelect(NO_SELECTION, order, "c", range)).toEqual({ ids: ["c"], anchor: "c" });
  });
});

describe("pruneSelection", () => {
  it("keeps the same instance when everything is still shown", () => {
    const sel = { ids: ["a", "c"], anchor: "c" };
    expect(pruneSelection(sel, order)).toBe(sel);
    expect(pruneSelection(NO_SELECTION, [])).toBe(NO_SELECTION);
  });

  it("drops cards that aren't shown", () => {
    expect(pruneSelection({ ids: ["a", "x"], anchor: "x" }, order)).toEqual({ ids: ["a"], anchor: null });
  });
});

describe("targets", () => {
  const sel = { ids: ["d", "a"], anchor: "a" };
  it("lists the selection in grid order", () => {
    expect(orderedSelection(sel, order)).toEqual(["a", "d"]);
  });

  it("acts on the selection from a selected card, else on the card alone", () => {
    expect(actionTargets(sel, order, "d")).toEqual(["a", "d"]);
    expect(actionTargets(sel, order, "b")).toEqual(["b"]);
  });
});

describe("marquee", () => {
  it("builds a box whichever way it's dragged", () => {
    expect(boxBetween({ x: 10, y: 50 }, { x: 0, y: 20 })).toEqual({ left: 0, top: 20, right: 10, bottom: 50 });
  });

  it("overlaps only when the boxes share area", () => {
    const a = { left: 0, top: 0, right: 10, bottom: 10 };
    expect(boxesOverlap(a, { left: 5, top: 5, right: 20, bottom: 20 })).toBe(true);
    expect(boxesOverlap(a, { left: 10, top: 0, right: 20, bottom: 10 })).toBe(false);
  });

  it("replaces the selection, or adds to it when ⌘/⇧ is held", () => {
    const base = { ids: ["a"], anchor: "a" };
    expect(marqueeSelect(base, ["c", "d"], false)).toEqual({ ids: ["c", "d"], anchor: "d" });
    expect(marqueeSelect(base, ["a", "c"], true)).toEqual({ ids: ["a", "c"], anchor: "c" });
    expect(marqueeSelect(base, [], false)).toEqual({ ids: [], anchor: "a" });
  });
});
