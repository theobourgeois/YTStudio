import { describe, expect, it } from "vitest";
import type { EnginePlugin } from "@shared/music/engine";
import { OTHER, PINNED, matches, movePosition, pickerColumns, pickerItem, pluginGroup } from "./plugin-groups";

const plugin = (name: string, category: string, manufacturer = "Maker"): EnginePlugin => ({ id: `VST3-${name}`, name, format: "VST3", manufacturer, category, isInstrument: false });

describe("the plugin picker", () => {
  it("groups a plugin by the specific word of its category, else Other", () => {
    expect(pluginGroup({ category: "Fx|EQ" })).toBe("EQ");
    expect(pluginGroup({ category: "Fx|Reverb|Stereo" })).toBe("Reverb");
    expect(pluginGroup({ category: "Instrument|Synth" })).toBe("Synth");
    expect(pluginGroup({ category: "dynamics" })).toBe("Dynamics");
    expect(pluginGroup({ category: "Fx" })).toBe(OTHER);
    expect(pluginGroup({ category: "Effect" })).toBe(OTHER);
    expect(pluginGroup({ category: "" })).toBe(OTHER);
  });

  it("puts the pinned first (and in their groups too), then the groups by name, Other last, filtered by what's typed", () => {
    const items = [plugin("Pro-Q 4", "Fx|EQ", "FabFilter"), plugin("Pro-R 2", "Fx|Reverb", "FabFilter"), plugin("EchoBoy", "Fx|Delay", "Soundtoys"), plugin("AUPeakLimiter", "Effect")].map(pickerItem);
    const columns = pickerColumns(items, ["VST3-Pro-R 2"], "");
    expect(columns.map((c) => c.title)).toEqual([PINNED, "Delay", "EQ", "Reverb", OTHER]);
    expect(columns[0].items.map((i) => i.name)).toEqual(["Pro-R 2"]);
    expect(pickerColumns(items, [], "fabfilter").map((c) => c.title)).toEqual(["EQ", "Reverb"]);
    expect(pickerColumns(items, [], "fab rev").flatMap((c) => c.items.map((i) => i.name))).toEqual(["Pro-R 2"]);
    expect(pickerColumns(items, [], "", ["Reverb"]).map((c) => c.title)[0]).toBe("Reverb");
    expect(matches(items[2], "delay")).toBe(true);
    expect(items[0].detail).toBe("FabFilter · VST3");
  });

  it("moves the highlight with the arrows: in a column, and across, keeping the row where it can", () => {
    const columns = [
      { title: "A", items: [1, 2, 3].map((n) => pickerItem(plugin(`a${n}`, "Fx|A"))) },
      { title: "B", items: [pickerItem(plugin("b1", "Fx|B"))] },
    ];
    expect(movePosition(columns, { column: 0, row: 0 }, "ArrowDown")).toEqual({ column: 0, row: 1 });
    expect(movePosition(columns, { column: 0, row: 2 }, "ArrowDown")).toEqual({ column: 0, row: 2 });
    expect(movePosition(columns, { column: 0, row: 2 }, "ArrowRight")).toEqual({ column: 1, row: 0 });
    expect(movePosition(columns, { column: 1, row: 0 }, "ArrowRight")).toEqual({ column: 1, row: 0 });
    expect(movePosition(columns, { column: 1, row: 0 }, "ArrowLeft")).toEqual({ column: 0, row: 0 });
    expect(movePosition(columns, { column: 0, row: 0 }, "ArrowUp")).toEqual({ column: 0, row: 0 });
  });
});
