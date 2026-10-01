/** The music suite's own endpoints (the platform's are in `@/lib/api`). */
import type {
  CopyStatesRequest,
  EngineCommand,
  EngineCommands,
  EngineDevices,
  EngineEvent,
  EnginePlugin,
  EngineStatus,
  SetDeviceRequest,
  SetSongRequest,
  SetSongResponse,
} from "@shared/music/engine";
import { request } from "@/lib/api";

export const musicApi = {
  /** A command to the audio engine (starting it if needed); every one answers with its status. */
  engine: <C extends EngineCommand>(command: C, body: EngineCommands[C]) =>
    request<EngineStatus>(`/api/engine/${command}`, { method: "POST", body: JSON.stringify(body) }),
  listEnginePlugins: () => request<EnginePlugin[]>("/api/engine/plugins"),
  /** The song the engine plays: sent whole on every edit (it keeps playing through the change). */
  setSong: (body: SetSongRequest) => request<SetSongResponse>("/api/engine/song", { method: "POST", body: JSON.stringify(body) }),
  /** Write the song's plugins' states now (they're written every few seconds anyway). */
  saveStates: () => request<void>("/api/engine/states", { method: "POST" }),
  copyStates: (body: CopyStatesRequest) => request<{ copied: number }>("/api/engine/states/copy", { method: "POST", body: JSON.stringify(body) }),
  devices: () => request<EngineDevices>("/api/engine/devices"),
  setDevice: (body: SetDeviceRequest) => request<EngineDevices>("/api/engine/devices", { method: "POST", body: JSON.stringify(body) }),
  /** What the engine says on its own (where the song is, the meter). Returns how to stop listening. */
  onEngineEvent(listener: (event: EngineEvent) => void): () => void {
    const source = new EventSource("/api/engine/events");
    source.onmessage = (message) => listener(JSON.parse(message.data) as EngineEvent);
    return () => source.close();
  },
};
