/**
 * The music suite's tools (`shared/music/tools.ts`), run in the tab. `MusicToolName` makes
 * TypeScript insist every tool has a handler here.
 */
import type { MusicToolName } from "@shared/music/tools";
import type { MusicProject } from "@shared/music/types";
import { type ToolResult, textResult } from "@shared/tool-spec";
import { api } from "@/lib/api";
import type { ToolRunContext } from "../types";
import { songContext } from "./context";
import { useMusic } from "./store";

type Handler = (input: Record<string, unknown>, song: MusicProject, ctx: ToolRunContext) => Promise<ToolResult>;

const TOOLS: Record<MusicToolName, Handler> = {
  async get_song(_input, song) {
    return textResult(songContext(song).context);
  },
};

/** The song a call acts on: its chat's (loaded if it isn't open), or the open one. */
async function songFor(ctx: ToolRunContext): Promise<MusicProject> {
  const open = useMusic.getState();
  const projectId = ctx.chat ?? open.projectId;
  if (!projectId) throw new Error("No song is open in the editor. Ask the user to open one.");
  if (projectId === open.projectId && open.song) return open.song;
  return api.getDocument("music", projectId);
}

export async function runMusicTool(name: string, input: Record<string, unknown>, ctx: ToolRunContext): Promise<ToolResult> {
  const handler = (TOOLS as Record<string, Handler | undefined>)[name];
  if (!handler) return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  return handler(input, await songFor(ctx), ctx);
}
