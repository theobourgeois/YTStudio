/**
 * Tools that share a place in the strip and a key, Photoshop's way (ux.md, "Keys"): the Marquees (M), the Lassos (L),
 * Quick Selection and the Magic Wand (W). Shift + the key steps through a group; a right-click on its button lists
 * it. Pure, so it's tested.
 */

/** The tools of the strip (ux.md, "Workspace"); more arrive with what they edit. */
export type PhotoTool = "move" | "marquee" | "ellipse" | "lasso" | "polygonLasso" | "quickSelect" | "magicWand" | "brush" | "eraser" | "hand" | "zoom";

export type ToolGroup = "marquee" | "lasso" | "wand";

export const TOOL_GROUPS: Record<ToolGroup, readonly PhotoTool[]> = {
  marquee: ["marquee", "ellipse"],
  lasso: ["lasso", "polygonLasso"],
  wand: ["quickSelect", "magicWand"],
};

export const groupOf = (tool: PhotoTool): ToolGroup | null => (Object.keys(TOOL_GROUPS) as ToolGroup[]).find((g) => TOOL_GROUPS[g].includes(tool)) ?? null;

/** The tools that make selections (their options bar, the canvas's Select menu on a right-click). */
export const isSelectionTool = (tool: PhotoTool) => groupOf(tool) !== null;

/** A group's key: the group's tool (the one used last), or with `cycle` (Shift) the next of it once it's in use. */
export function groupKey(group: ToolGroup, groupTool: PhotoTool, inUse: PhotoTool, cycle: boolean): PhotoTool {
  const tools = TOOL_GROUPS[group];
  return cycle && inUse === groupTool ? tools[(tools.indexOf(groupTool) + 1) % tools.length] : groupTool;
}
