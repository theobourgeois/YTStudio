/** The music suite's own endpoints (the platform's are in `@/lib/api`). */
import type { EngineCommand, EngineCommands, EnginePlugin, EngineStatus } from "@shared/music/engine";
import { request } from "@/lib/api";

export const musicApi = {
  /** A command to the audio engine (starting it if needed); every one answers with its status. */
  engine: <C extends EngineCommand>(command: C, body: EngineCommands[C]) =>
    request<EngineStatus>(`/api/engine/${command}`, { method: "POST", body: JSON.stringify(body) }),
  listEnginePlugins: () => request<EnginePlugin[]>("/api/engine/plugins"),
};
