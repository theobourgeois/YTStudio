/**
 * Every suite's assistant tools. The MCP server lists a chat's suite's tools (`suiteTools`); tool
 * names are unique across suites, so a step in any chat is known by its name alone (`toolSpec`).
 */
import { VIDEO_TOOLS } from "./assistant-tools.ts";
import { MUSIC_TOOLS } from "./music/tools.ts";
import type { SuiteId } from "./suites.ts";
import type { ToolSpec } from "./tool-spec.ts";

export const SUITE_TOOLS: Record<SuiteId, readonly ToolSpec[]> = {
  video: VIDEO_TOOLS,
  music: MUSIC_TOOLS,
};

const bySuite = Object.fromEntries(
  Object.entries(SUITE_TOOLS).map(([suite, tools]) => [suite, new Map(tools.map((t) => [t.name, t]))]),
) as Record<SuiteId, Map<string, ToolSpec>>;

const byName = new Map<string, ToolSpec>(Object.values(SUITE_TOOLS).flatMap((tools) => tools.map((t) => [t.name, t] as const)));

/** A suite's tools, in the order clients list them. */
export const suiteTools = (suite: SuiteId): readonly ToolSpec[] => SUITE_TOOLS[suite];

/** A tool of any suite. */
export function toolSpec(name: string): ToolSpec | undefined {
  return byName.get(name);
}

/** A tool of this suite (a call for another suite's tool is refused). */
export function suiteToolSpec(suite: SuiteId, name: string): ToolSpec | undefined {
  return bySuite[suite].get(name);
}

/** The suite a tool belongs to. */
export function toolSuite(name: string): SuiteId | undefined {
  return (Object.keys(bySuite) as SuiteId[]).find((suite) => bySuite[suite].has(name));
}
