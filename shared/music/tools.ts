/**
 * The music suite's tools for AI agents (see `shared/tool-spec.ts`; handlers in
 * `src/suites/music/tools.ts`). Only reading the song for now: add a tool with each feature.
 */
import { type ToolSpec, obj, tool } from "../tool-spec.ts";

export const MUSIC_TOOLS = [
  tool({
    name: "get_song",
    title: "Read the song",
    kind: "look",
    description: "The open song: its name, tempo and time signature. Start here.",
    inputSchema: obj({}),
  }),
] as const satisfies readonly ToolSpec[];

export type MusicToolName = (typeof MUSIC_TOOLS)[number]["name"];
