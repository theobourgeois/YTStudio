/** The music suite's own endpoints (the platform's are in `@/lib/api`). */
import type {
  CopyStatesRequest,
  DetectTempoRequest,
  DetectedTempo,
  EngineCommand,
  EngineCommands,
  EngineDevices,
  EngineEvent,
  EngineParameter,
  EnginePlugin,
  EngineStatus,
  PluginPresets,
  PresetRequest,
  PreviewFileRequest,
  PreviewSampleRequest,
  RecordRequest,
  RecordResponse,
  SetDeviceRequest,
  SetSongRequest,
  SetSongResponse,
} from "@shared/music/engine";
import type { SerumLibraryResponse, SerumSound } from "@shared/music/serum-presets";
import type {
  AddBrowserRootRequest,
  BrowserItem,
  BrowserSearchResult,
  BrowserState,
  SetBrowserFavouriteRequest,
  UseBrowserFileRequest,
} from "@shared/music/browser";
import type { ExportSongRequest, MusicExportJob } from "@shared/music/export";
import type { MakeVisualizerRequest, VisualizerJob } from "@shared/music/visualizer";
import type { MusicModelName } from "@shared/music/models";
import type { StemJob, StemRequest } from "@shared/music/stems";
import type { HeardAudioJson } from "@shared/music/transcribe";
import type { ModelStatus } from "@shared/models";
import type { MediaAsset } from "@shared/types";
import type { ChannelEvidence, MixerSetupRequest, MixerSetupResult } from "@shared/music/mixer-setup";
import { request } from "@/lib/api";

const pathQuery = (path: string) => `path=${encodeURIComponent(path)}`;

export const musicApi = {
  mixerSetupSettings: () => request<{ configured: boolean }>("/api/music/mixer-setup/settings"),
  setMixerSetupKey: (key: string | null) => request<{ configured: boolean }>("/api/music/mixer-setup/settings", { method: "PUT", body: JSON.stringify({ key }) }),
  classifyMixer: (body: MixerSetupRequest) => request<MixerSetupResult>("/api/music/mixer-setup", { method: "POST", body: JSON.stringify(body) }),
  mixerSetupEvidence: (body: MixerSetupRequest) => request<ChannelEvidence[]>("/api/music/mixer-setup/evidence", { method: "POST", body: JSON.stringify(body) }),
  /** A command to the audio engine (starting it if needed); every one answers with its status. */
  engine: <C extends EngineCommand>(command: C, body: EngineCommands[C]) =>
    request<EngineStatus>(`/api/engine/${command}`, { method: "POST", body: JSON.stringify(body) }),
  /** Play and record the armed tracks (`stop` ends it); the takes come later as `take` events. */
  record: (body: RecordRequest) => request<RecordResponse>("/api/engine/record", { method: "POST", body: JSON.stringify(body) }),
  listEnginePlugins: () => request<EnginePlugin[]>("/api/engine/plugins"),
  /** A song's plugin's parameters that can be automated (a plugin channel's or a mixer effect's, by its id). */
  pluginParameters: (owner: "channel" | "effect", id: string) =>
    request<EngineParameter[]>(`/api/engine/parameters?owner=${owner}&id=${encodeURIComponent(id)}`),
  /** A song's plugin's presets: its own programs and the user's saved for it (FL's preset browser). */
  presets: (owner: "channel" | "effect", id: string) => request<PluginPresets>(`/api/engine/presets?owner=${owner}&id=${encodeURIComponent(id)}`),
  /** Choose a program, or save, load or delete a preset of the user's: the presets after. */
  preset: (body: PresetRequest) => request<PluginPresets>("/api/engine/presets", { method: "POST", body: JSON.stringify(body) }),
  /** The song the engine plays: sent whole on every edit (it keeps playing through the change). */
  setSong: (body: SetSongRequest) => request<SetSongResponse>("/api/engine/song", { method: "POST", body: JSON.stringify(body) }),
  /** Write the song's plugins' states now (they're written every few seconds anyway). */
  saveStates: () => request<void>("/api/engine/states", { method: "POST" }),
  copyStates: (body: CopyStatesRequest) => request<{ copied: number }>("/api/engine/states/copy", { method: "POST", body: JSON.stringify(body) }),
  devices: () => request<EngineDevices>("/api/engine/devices"),
  setDevice: (body: SetDeviceRequest) => request<EngineDevices>("/api/engine/devices", { method: "POST", body: JSON.stringify(body) }),
  /** The device's own settings panel (an ASIO driver's), shown by the engine. */
  deviceControlPanel: () => request<{ ok: boolean }>("/api/engine/devices/panel", { method: "POST" }),
  /** Serum's preset library, for the Serum player's browser (`docs/serum/player.md`). */
  serumPresets: () => request<SerumLibraryResponse>("/api/music/serum/presets"),
  /** Serum's stars for a preset (0 takes them away), written where Serum keeps them. */
  rateSerumPreset: (hash: string, rating: number) => request<void>("/api/music/serum/rating", { method: "POST", body: JSON.stringify({ hash, rating }) }),
  /** A preset of the library loaded onto a song's Serum channel, as Serum's own browser loads it: what it has on then. */
  loadSerumPreset: (projectId: string, channel: string, path: string) =>
    request<SerumSound>("/api/music/serum/load", { method: "POST", body: JSON.stringify({ projectId, channel, path }) }),
  /** What a song's Serum channel has on now: its preset and its macros. */
  serumSound: (projectId: string, channel: string) =>
    request<SerumSound>(`/api/music/serum/sound?projectId=${encodeURIComponent(projectId)}&channel=${encodeURIComponent(channel)}`),
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
  /** Hear one of the song's own media files (an audio clip's channel), as the Browser's are. */
  previewSample: (body: PreviewSampleRequest) => request<EngineStatus>("/api/engine/previewSample", { method: "POST", body: JSON.stringify(body) }),
  /** A media file's tempo, as heard (FL's Autodetect). */
  detectTempo: (body: DetectTempoRequest) => request<DetectedTempo>("/api/engine/tempo", { method: "POST", body: JSON.stringify(body) }),
  /** Where a Browser file is served (its waveform, and its bytes when it's added to the project). */
  browserFileUrl: (path: string) => `/api/browser/file?${pathQuery(path)}`,
  /** Export the song (`ExportSongRequest`): it renders on after the answer, which is the job. */
  startExport: (body: ExportSongRequest) => request<MusicExportJob>("/api/music/exports", { method: "POST", body: JSON.stringify(body) }),
  exportJob: (id: string) => request<MusicExportJob>(`/api/music/exports/${encodeURIComponent(id)}`),
  abortExport: (id: string) => request<MusicExportJob>(`/api/music/exports/${encodeURIComponent(id)}/abort`, { method: "POST" }),
  revealExport: (id: string) => request<void>(`/api/music/exports/${encodeURIComponent(id)}/reveal`, { method: "POST" }),
  /** Make visualizer: the song rendered and made into a video project. */
  startVisualizer: (body: MakeVisualizerRequest) => request<VisualizerJob>("/api/music/visualizer", { method: "POST", body: JSON.stringify(body) }),
  visualizerJob: (id: string) => request<VisualizerJob>(`/api/music/visualizer/${encodeURIComponent(id)}`),
  abortVisualizer: (id: string) => request<VisualizerJob>(`/api/music/visualizer/${encodeURIComponent(id)}/abort`, { method: "POST" }),
  /** Extract stems' and Convert to notes' models: whether one is downloaded, and its download (once the user says yes). */
  modelStatus: (name: MusicModelName) => request<ModelStatus>(`/api/music/models/${name}`),
  setUpModel: (name: MusicModelName) => request<ModelStatus>(`/api/music/models/${name}/setup`, { method: "POST" }),
  /** Extract stems: one of the song's files split on the server, a job polled until its stems are the project's media. */
  startStems: (body: StemRequest) => request<StemJob>("/api/music/stems", { method: "POST", body: JSON.stringify(body) }),
  stemJob: (id: string) => request<StemJob>(`/api/music/stems/${encodeURIComponent(id)}`),
  cancelStems: (id: string) => request<StemJob>(`/api/music/stems/${encodeURIComponent(id)}/cancel`, { method: "POST" }),
  /** What Convert to notes hears in one of the song's files (`heardFromJson` reads it). */
  hearNotes: (body: { projectId: string; sampleId: string }) => request<HeardAudioJson>("/api/music/notes", { method: "POST", body: JSON.stringify(body) }),
  /** Where a file an export kept on the server is downloaded from (a browser's export). */
  exportFileUrl: (id: string, name: string) => `/api/music/exports/${encodeURIComponent(id)}/files/${encodeURIComponent(name)}`,
  /** What the engine says on its own (where the song is, the meter). Returns how to stop listening. */
  onEngineEvent(listener: (event: EngineEvent) => void): () => void {
    const source = new EventSource("/api/engine/events");
    source.onmessage = (message) => listener(JSON.parse(message.data) as EngineEvent);
    return () => source.close();
  },
};
