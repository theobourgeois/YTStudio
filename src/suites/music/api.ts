/** The music suite's own endpoints (the platform's are in `@/lib/api`). */
import type {
  CopyStatesRequest,
  EngineCommand,
  EngineCommands,
  EngineDevices,
  EngineEvent,
  EnginePlugin,
  EngineStatus,
  PreviewFileRequest,
  SetDeviceRequest,
  SetSongRequest,
  SetSongResponse,
} from "@shared/music/engine";
import type {
  AddBrowserRootRequest,
  BrowserItem,
  BrowserSearchResult,
  BrowserState,
  SetBrowserFavouriteRequest,
  UseBrowserFileRequest,
} from "@shared/music/browser";
import type { MediaAsset } from "@shared/types";
import { request } from "@/lib/api";

const pathQuery = (path: string) => `path=${encodeURIComponent(path)}`;

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
  /** The Browser's folders and favourites (the same in every project). */
  browser: () => request<BrowserState>("/api/browser"),
  addBrowserRoot: (body: AddBrowserRootRequest) => request<BrowserState>("/api/browser/roots", { method: "POST", body: JSON.stringify(body) }),
  removeBrowserRoot: (path: string) => request<BrowserState>(`/api/browser/roots?${pathQuery(path)}`, { method: "DELETE" }),
  setBrowserFavourite: (body: SetBrowserFavouriteRequest) =>
    request<BrowserState>("/api/browser/favourites", { method: "POST", body: JSON.stringify(body) }),
  rescanBrowser: () => request<BrowserState>("/api/browser/rescan", { method: "POST" }),
  listBrowserFolder: (path: string) => request<BrowserItem[]>(`/api/browser/list?${pathQuery(path)}`),
  searchBrowser: (q: string, limit?: number) =>
    request<BrowserSearchResult>(`/api/browser/search?q=${encodeURIComponent(q)}${limit ? `&limit=${limit}` : ""}`),
  /** One of the Browser's files as the project's media (copied the first time). */
  useBrowserFile: (body: UseBrowserFileRequest) => request<MediaAsset>("/api/browser/use", { method: "POST", body: JSON.stringify(body) }),
  revealBrowserFile: (path: string) => request<void>("/api/browser/reveal", { method: "POST", body: JSON.stringify({ path }) }),
  /** Hear one of the Browser's files (cutting off the last); `engine("stopPreview", {})` stops it. */
  previewFile: (body: PreviewFileRequest) => request<EngineStatus>("/api/browser/preview", { method: "POST", body: JSON.stringify(body) }),
  /** Where a Browser file is served (its waveform, and its bytes when it's added to the project). */
  browserFileUrl: (path: string) => `/api/browser/file?${pathQuery(path)}`,
  /** What the engine says on its own (where the song is, the meter). Returns how to stop listening. */
  onEngineEvent(listener: (event: EngineEvent) => void): () => void {
    const source = new EventSource("/api/engine/events");
    source.onmessage = (message) => listener(JSON.parse(message.data) as EngineEvent);
    return () => source.close();
  },
};
