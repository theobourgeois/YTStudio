import { describe, expect, it } from "vitest";
import {
  type DockLayout,
  type DockNode,
  dockPanel,
  dropZone,
  floatPanel,
  groupOf,
  groups,
  movePanel,
  normalizeLayout,
  panelsOf,
  removePanel,
  resizePair,
  setSizes,
  showPanel,
} from "./model";

type P = "media" | "effects" | "properties" | "program" | "timeline";
const PANELS: P[] = ["media", "effects", "properties", "program", "timeline"];

/** The video editor's usual layout: a left group of tabs beside the monitor, the timeline below. */
const editing = (): DockLayout<P> => ({
  root: {
    type: "split",
    id: "outer",
    direction: "column",
    sizes: [600, 300],
    children: [
      {
        type: "split",
        id: "top",
        direction: "row",
        sizes: [344, 856],
        children: [
          { type: "group", id: "left", panels: ["media", "effects", "properties"], active: "media" },
          { type: "group", id: "monitor", panels: ["program"], active: "program" },
        ],
      },
      { type: "group", id: "bottom", panels: ["timeline"], active: "timeline" },
    ],
  },
  floating: [],
});

/** The tree without ids or sizes: what's where. */
function shape(node: DockNode<P> | null): unknown {
  if (!node) return null;
  if (node.type === "group") return node.panels;
  return { [node.direction]: node.children.map(shape) };
}

describe("showPanel", () => {
  it("brings a panel's tab to the front, and leaves the layout alone when it's already there", () => {
    const layout = editing();
    const shown = showPanel(layout, "properties");
    expect(groupOf(shown, "properties")!.active).toBe("properties");
    expect(showPanel(shown, "properties")).toBe(shown);
    expect(showPanel(layout, "program")).toBe(layout);
  });
});

describe("removePanel", () => {
  it("closes a group left empty and folds its split away", () => {
    const layout = removePanel(editing(), "program");
    expect(shape(layout.root)).toEqual({ column: [["media", "effects", "properties"], ["timeline"]] });
  });

  it("shows the next tab when the one in front goes", () => {
    const layout = removePanel(editing(), "media");
    expect(groupOf(layout, "effects")!.active).toBe("effects");
  });
});

describe("movePanel", () => {
  it("puts a panel among another group's tabs, at an index, in front", () => {
    const layout = movePanel(editing(), "properties", "monitor", "center", 0);
    expect(groupOf(layout, "program")!.panels).toEqual(["properties", "program"]);
    expect(groupOf(layout, "program")!.active).toBe("properties");
    expect(groupOf(layout, "media")!.panels).toEqual(["media", "effects"]);
  });

  it("reorders a group's own tabs", () => {
    const layout = movePanel(editing(), "media", "left", "center", 2);
    expect(groupOf(layout, "media")!.panels).toEqual(["effects", "properties", "media"]);
  });

  it("puts a panel beside a group in a split going the same way, sharing that group's room", () => {
    // Properties to the right of the monitor: the top row gets a third column.
    const layout = movePanel(editing(), "properties", "monitor", "right");
    expect(shape(layout.root)).toEqual({ column: [{ row: [["media", "effects"], ["program"], ["properties"]] }, ["timeline"]] });
    const top = layout.root!.type === "split" ? layout.root!.children[0] : null;
    expect(top?.type === "split" && top.sizes).toEqual([344, 428, 428]);
  });

  it("splits a group the other way in a split of its own", () => {
    const layout = movePanel(editing(), "effects", "monitor", "bottom");
    expect(shape(layout.root)).toEqual({ column: [{ row: [["media", "properties"], { column: [["program"], ["effects"]] }] }, ["timeline"]] });
  });

  it("splits the root when the target is the root", () => {
    const layout: DockLayout<P> = { root: { type: "group", id: "g", panels: ["media", "program"], active: "media" }, floating: [] };
    expect(shape(movePanel(layout, "media", "g", "left").root)).toEqual({ row: [["media"], ["program"]] });
  });

  it("does nothing for a panel dropped on its own side when it's alone, or on a group that's gone", () => {
    const layout = editing();
    expect(movePanel(layout, "program", "monitor", "left")).toBe(layout);
    expect(movePanel(layout, "program", "nope", "center")).toBe(layout);
  });

  it("moves a panel away from its group's side, the group's other tabs staying", () => {
    const layout = movePanel(editing(), "media", "left", "top");
    expect(shape(layout.root)).toEqual({ column: [{ row: [{ column: [["media"], ["effects", "properties"]] }, ["program"]] }, ["timeline"]] });
  });

  it("closes the group a moved panel leaves empty, and tidies the splits", () => {
    const layout = movePanel(editing(), "timeline", "left", "center");
    expect(shape(layout.root)).toEqual({ row: [["media", "effects", "properties", "timeline"], ["program"]] });
  });

  it("keeps every panel exactly once whatever is moved where", () => {
    let layout = editing();
    const zones = ["left", "right", "top", "bottom", "center"] as const;
    for (let i = 0; i < 60; i++) {
      const panel = PANELS[(i * 7) % PANELS.length];
      const all = groups(layout.root);
      const target = all[(i * 3) % all.length];
      layout = movePanel(layout, panel, target.id, zones[i % zones.length]);
      expect([...panelsOf(layout)].sort()).toEqual([...PANELS].sort());
      for (const g of groups(layout.root)) expect(g.panels).toContain(g.active);
    }
  });
});

describe("floating", () => {
  it("floats a panel out and docks it back into the group it came from", () => {
    const floated = floatPanel(editing(), "effects");
    expect(floated.floating).toEqual([{ panel: "effects", from: "left" }]);
    expect(groupOf(floated, "effects")).toBeNull();
    const docked = dockPanel(floated, "effects");
    expect(docked.floating).toEqual([]);
    expect(groupOf(docked, "effects")!.id).toBe("left");
  });

  it("docks into the first group when its own is gone", () => {
    const floated = floatPanel(editing(), "program");
    expect(groups(floated.root).some((g) => g.id === "monitor")).toBe(false);
    expect(groupOf(dockPanel(floated, "program"), "program")!.id).toBe("left");
  });

  it("starts a layout again when everything was floating", () => {
    let layout = editing();
    for (const p of PANELS) layout = floatPanel(layout, p);
    expect(layout.root).toBeNull();
    expect(shape(dockPanel(layout, "program").root)).toEqual(["program"]);
  });
});

describe("sizes", () => {
  it("sets a split's weights, and leaves the layout alone when they're the same", () => {
    const layout = setSizes(editing(), "top", [500, 700]);
    const top = layout.root!.type === "split" ? layout.root!.children[0] : null;
    expect(top?.type === "split" && top.sizes).toEqual([500, 700]);
    expect(setSizes(layout, "top", [500, 700])).toBe(layout);
  });

  it("moves the border between two children, neither going under its minimum", () => {
    expect(resizePair([300, 700, 200], 0, 100, [200, 300, 100])).toEqual([400, 600, 200]);
    expect(resizePair([300, 700], 0, 600, [200, 300])).toEqual([700, 300]);
    expect(resizePair([300, 700], 0, -200, [200, 300])).toEqual([200, 800]);
  });
});

describe("dropZone", () => {
  const rect = { x: 0, y: 0, width: 100, height: 100 };
  it("is among the tabs in the middle, beside it nearer an edge", () => {
    expect(dropZone(rect, { x: 50, y: 50 })).toBe("center");
    expect(dropZone(rect, { x: 10, y: 50 })).toBe("left");
    expect(dropZone(rect, { x: 90, y: 40 })).toBe("right");
    expect(dropZone(rect, { x: 50, y: 5 })).toBe("top");
    expect(dropZone(rect, { x: 60, y: 95 })).toBe("bottom");
  });
});

describe("normalizeLayout", () => {
  it("keeps a good layout as it is", () => {
    const layout = editing();
    expect(normalizeLayout(JSON.parse(JSON.stringify(layout)), PANELS, layout)).toEqual(layout);
  });

  it("drops unknown and repeated panels, and adds the missing ones to the first group", () => {
    const raw = {
      root: {
        type: "split",
        direction: "row",
        sizes: [1, "x"],
        children: [
          { type: "group", id: "a", panels: ["media", "ghost", "media"], active: "ghost" },
          { type: "group", id: "b", panels: ["program"], active: "program" },
          { type: "nonsense" },
        ],
      },
      floating: [{ panel: "timeline", from: "b" }, { panel: "program" }],
    };
    const layout = normalizeLayout(raw, PANELS, editing());
    expect(shape(layout.root)).toEqual({ row: [["media", "effects", "properties"], ["program"]] });
    expect(groupOf(layout, "media")!.active).toBe("media");
    expect(layout.floating).toEqual([{ panel: "timeline", from: "b" }]);
    expect(layout.root!.type === "split" && layout.root!.sizes).toEqual([1, 1]);
  });

  it("falls back for anything that isn't a layout", () => {
    const fallback = editing();
    expect(normalizeLayout(null, PANELS, fallback)).toBe(fallback);
    expect(normalizeLayout("nope", PANELS, fallback)).toBe(fallback);
    expect(normalizeLayout({ root: { type: "group", panels: [] } }, PANELS, fallback)).toBe(fallback);
  });
});
