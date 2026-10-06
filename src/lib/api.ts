import type { AssistantProvider, ChatSnapshot } from "@shared/assistant";
import type { SuiteDocument, SuiteId } from "@shared/suites";
import type { ToolResult } from "@shared/tool-spec";
import type {
  ApiError,
  AssistantStatus,
  CreateLibraryFolderRequest,
  CreateProjectRequest,
  ExportJob,
  ExportRequest,
  FontFamily,
  HealthResponse,
  ImportFileRequest,
  ImportWebMediaRequest,
  Library,
  LibraryEntry,
  LibraryFolder,
  LibraryItem,
  MediaAsset,
  Project,
  ProjectLocation,
  ProjectSummary,
  ProjectPreview,
  TextLayoutAt,
  ProjectTemplates,
  SaveClipsToLibraryRequest,
  SaveMediaToLibraryRequest,
  MusicAnalysis,
  SceneCuts,
  SendChatMessageRequest,
  SoundAnalysis,
  UpdateLibraryFolderRequest,
  UpdateLibraryItemRequest,
  SetUpEngineRequest,
  TranscribeRequest,
  TranscriptionEngineId,
  TranscriptionEngineInfo,
  TranscriptionJob,
  UpdateProjectRequest,
  UseLibraryItemRequest,
  UseLibraryItemResponse,
  WebClip,
  WebDownloadProgress,
  WebMediaKind,
} from "@shared/types";

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Fetch, throwing an `ApiRequestError` with the server's message for a failed response. */
async function send(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(path, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json", ...init.headers } : init?.headers,
  });
  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // not JSON
    }
    throw new ApiRequestError(serverMessage(body, `Request failed (${res.status})`), res.status);
  }
  return res;
}

/** A JSON request. Suites build their own endpoints' clients on it (`src/suites/<suite>/api.ts`). */
export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await send(path, init);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** The `{ error }` message of a failed response's body (see `ApiError`), or `fallback`. */
function serverMessage(body: unknown, fallback: string): string {
  const error = (body as Partial<ApiError> | null)?.error;
  return typeof error === "string" ? error : fallback;
}

export const api = {
  health: () => request<HealthResponse>("/api/health"),

  projectPreview: (id: string) => request<ProjectPreview>(`/api/projects/${id}/preview`),
  prepareProjectPreview: (id: string, revision: number, inputs: { texts?: Record<string, TextLayoutAt[]> } = {}) =>
    request<ProjectPreview>(`/api/projects/${id}/preview`, { method: "POST", body: JSON.stringify({ ...inputs, revision }) }),
  listProjects: () => request<ProjectSummary[]>("/api/projects"),
  createProject: (body: CreateProjectRequest = {}) =>
    request<ProjectSummary>("/api/projects", { method: "POST", body: JSON.stringify(body) }),
  getProject: (id: string) => request<Project>(`/api/projects/${id}`),
  /** Any suite's document (`suite` says which, for its type). */
  getDocument: <S extends SuiteId>(_suite: S, id: string) => request<SuiteDocument<S>>(`/api/projects/${id}`),
  /** Save any suite's document. Returns the refreshed summary. */
  saveDocument: <S extends SuiteId>(_suite: S, id: string, doc: SuiteDocument<S>, keepalive = false) =>
    request<ProjectSummary>(`/api/projects/${id}`, { method: "PUT", body: JSON.stringify(doc), keepalive }),
  /** Save the project document. Returns the refreshed summary (void for keepalive saves on unload). */
  saveProject: (id: string, project: Project, keepalive = false) =>
    request<ProjectSummary>(`/api/projects/${id}`, {
      method: "PUT",
      body: JSON.stringify(project),
      keepalive,
    }),
  updateProject: (id: string, body: UpdateProjectRequest) =>
    request<ProjectSummary>(`/api/projects/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  duplicateProject: (id: string) =>
    request<ProjectSummary>(`/api/projects/${id}/duplicate`, { method: "POST" }),
  /** Put its package in the Trash (a missing one is only forgotten). */
  deleteProject: (id: string) => request<void>(`/api/projects/${id}`, { method: "DELETE" }),
  /** Remove it from the recents; its package stays where it is. */
  forgetProject: (id: string) => request<void>(`/api/projects/${id}/recent`, { method: "DELETE" }),
  /** A package from anywhere on this computer (its folder, or a file in it), added to the recents. */
  openProjectFile: (path: string) => request<ProjectSummary>("/api/projects/open", { method: "POST", body: JSON.stringify({ path }) }),
  /** A tab opened it (it's the latest) / closed it (its package takes its name, if it was renamed meanwhile). */
  projectOpened: (id: string) => request<ProjectSummary>(`/api/projects/${id}/opened`, { method: "POST" }),
  projectClosed: (id: string) => request<ProjectSummary>(`/api/projects/${id}/closed`, { method: "POST" }),
  /** Show its package in Finder. */
  revealProject: (id: string) => request<void>(`/api/projects/${id}/reveal`, { method: "POST" }),
  /** Its card's picture, drawn by the tab (a JPEG or PNG, at most 4 MB): for suites the server can't render. */
  saveCover: (projectId: string, image: Blob) =>
    request<void>(`/api/projects/${projectId}/cover`, {
      method: "PUT",
      body: image,
      headers: { "Content-Type": image.type || "application/octet-stream" },
    }),
  /** Where new projects are saved. */
  getProjectLocation: () => request<ProjectLocation>("/api/projects/location"),
  setProjectLocation: (path: string) => request<ProjectLocation>("/api/projects/location", { method: "PUT", body: JSON.stringify({ path }) }),
  /** Each suite's starting point (what new projects start as). */
  getTemplates: () => request<ProjectTemplates>("/api/projects/templates"),
  saveTemplate: (id: string) => request<ProjectTemplates>(`/api/projects/${id}/template`, { method: "POST" }),
  clearTemplate: (suite: SuiteId) => request<ProjectTemplates>(`/api/projects/templates/${suite}`, { method: "DELETE" }),

  listMedia: (projectId: string) =>
    request<MediaAsset[]>(`/api/media?projectId=${encodeURIComponent(projectId)}`),
  getMedia: (id: string) => request<MediaAsset>(`/api/media/${id}`),
  /** Copy a file on this computer into a project's media. */
  importFile: (body: ImportFileRequest) =>
    request<MediaAsset>("/api/media/import-file", { method: "POST", body: JSON.stringify(body) }),
  /** URL of a media file's frame at source time `t`, `width` px wide (a JPEG). */
  mediaFrameUrl: (id: string, t: number, width: number) =>
    `/api/media/${id}/frame?t=${Math.round(t * 1000) / 1000}&w=${Math.round(width)}`,
  analyseSound: (id: string, opts: { from: number; to: number; threshold: number; min: number }, signal?: AbortSignal) =>
    request<SoundAnalysis>(
      `/api/media/${id}/sound?from=${opts.from}&to=${opts.to}&threshold=${opts.threshold}&min=${opts.min}`,
      { signal },
    ),
  analyseMusic: (id: string, opts: { from: number; to: number }, signal?: AbortSignal) =>
    request<MusicAnalysis>(`/api/media/${id}/music?from=${opts.from}&to=${opts.to}`, { signal }),
  detectScenes: (id: string, threshold: number, signal?: AbortSignal) =>
    request<SceneCuts>(`/api/media/${id}/scenes?threshold=${threshold}`, { signal }),
  /** Start making a media file's reversed copy (for clips played backwards), if it isn't made yet. */
  reverseMedia: (id: string) => request<MediaAsset>(`/api/media/${id}/reversed`, { method: "POST" }),
  /** Start analysing a file's signals (if they aren't made yet): poll the asset until they're ready. */
  analyseSignals: (id: string) => request<MediaAsset>(`/api/media/${id}/signals`, { method: "POST" }),
  deleteMedia: (id: string) => request<void>(`/api/media/${id}`, { method: "DELETE" }),

  /** Upload a file with progress (0..1). Resolves with the probed asset. */
  uploadMedia: (projectId: string, file: File, onProgress?: (fraction: number) => void, signal?: AbortSignal) =>
    upload<MediaAsset>(
      `/api/media?projectId=${encodeURIComponent(projectId)}&name=${encodeURIComponent(file.name)}`,
      file,
      onProgress,
      signal,
    ),

  searchWeb: (query: string, signal?: AbortSignal) =>
    request<WebClip[]>(`/api/web/search?q=${encodeURIComponent(query)}`, { signal }),
  /** What's at a pasted link (title, duration...), without downloading it. */
  resolveWebLink: (url: string, signal?: AbortSignal) =>
    request<WebClip>(`/api/web/resolve?url=${encodeURIComponent(url)}`, { signal }),
  /** A clip's audio (the server downloads it on the first request, then serves it from its cache). */
  webAudio: async (url: string, signal?: AbortSignal) =>
    (await send(`/api/web/audio?url=${encodeURIComponent(url)}`, { signal })).blob(),
  webDownloadProgress: (url: string, kind: WebMediaKind) =>
    request<WebDownloadProgress>(`/api/web/progress?url=${encodeURIComponent(url)}&kind=${kind}`),
  importWebMedia: (body: ImportWebMediaRequest) =>
    request<MediaAsset>("/api/web/import", { method: "POST", body: JSON.stringify(body) }),

  getLibrary: () => request<Library>("/api/library"),
  createLibraryFolder: (body: CreateLibraryFolderRequest) =>
    request<LibraryFolder>("/api/library/folders", { method: "POST", body: JSON.stringify(body) }),
  updateLibraryFolder: (id: string, body: UpdateLibraryFolderRequest) =>
    request<LibraryFolder>(`/api/library/folders/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteLibraryFolder: (id: string) => request<void>(`/api/library/folders/${id}`, { method: "DELETE" }),
  /** Import a file into a Library folder (null: the top level), with progress (0..1). */
  uploadToLibrary: (folderId: string | null, file: File, onProgress?: (fraction: number) => void) =>
    upload<LibraryEntry>(
      `/api/library/items?folderId=${encodeURIComponent(folderId ?? "")}&name=${encodeURIComponent(file.name)}`,
      file,
      onProgress,
    ),
  saveMediaToLibrary: (body: SaveMediaToLibraryRequest) =>
    request<LibraryEntry>("/api/library/items/media", { method: "POST", body: JSON.stringify(body) }),
  saveClipsToLibrary: (body: SaveClipsToLibraryRequest) =>
    request<LibraryEntry>("/api/library/items/clips", { method: "POST", body: JSON.stringify(body) }),
  updateLibraryItem: (id: string, body: UpdateLibraryItemRequest) =>
    request<LibraryItem>(`/api/library/items/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteLibraryItem: (id: string) => request<void>(`/api/library/items/${id}`, { method: "DELETE" }),
  /** Copy an item's media into a project (the server reuses copies already there). */
  useLibraryItem: (id: string, body: UseLibraryItemRequest) =>
    request<UseLibraryItemResponse>(`/api/library/items/${id}/use`, { method: "POST", body: JSON.stringify(body) }),
  getLibraryMedia: (id: string) => request<MediaAsset>(`/api/library/media/${id}`),

  listFonts: () => request<FontFamily[]>("/api/fonts"),

  startExport: (req: ExportRequest) =>
    request<ExportJob>("/api/exports", { method: "POST", body: JSON.stringify(req) }),
  getExport: (id: string) => request<ExportJob>(`/api/exports/${id}`),
  cancelExport: (id: string) => request<void>(`/api/exports/${id}`, { method: "DELETE" }),

  listTranscriptionEngines: () => request<TranscriptionEngineInfo[]>("/api/transcription/engines"),
  /** Local: starts installing (poll the list). Cloud: checks and saves the API key. */
  setUpTranscriptionEngine: (id: TranscriptionEngineId, body: SetUpEngineRequest = {}) =>
    request<TranscriptionEngineInfo>(`/api/transcription/engines/${id}/setup`, { method: "POST", body: JSON.stringify(body) }),
  forgetTranscriptionKey: (id: TranscriptionEngineId) =>
    request<TranscriptionEngineInfo>(`/api/transcription/engines/${id}/setup`, { method: "DELETE" }),
  startTranscription: (req: TranscribeRequest) =>
    request<TranscriptionJob>("/api/transcription/jobs", { method: "POST", body: JSON.stringify(req) }),
  getTranscription: (id: string) => request<TranscriptionJob>(`/api/transcription/jobs/${id}`),
  cancelTranscription: (id: string) => request<void>(`/api/transcription/jobs/${id}`, { method: "DELETE" }),

  assistantStatus: () => request<AssistantStatus>("/api/assistant/status"),
  getChat: (projectId: string) => request<ChatSnapshot>(`/api/assistant/chats/${projectId}`),
  setChatModel: (projectId: string, provider: AssistantProvider, model: string, effort: string | null) =>
    request<ChatSnapshot>(`/api/assistant/chats/${projectId}`, { method: "PATCH", body: JSON.stringify({ provider, model, effort }) }),
  sendChatMessage: (projectId: string, body: SendChatMessageRequest) =>
    request<void>(`/api/assistant/chats/${projectId}/messages`, { method: "POST", body: JSON.stringify(body) }),
  stopChat: (projectId: string) => request<void>(`/api/assistant/chats/${projectId}/stop`, { method: "POST" }),
  resetChat: (projectId: string) => request<ChatSnapshot>(`/api/assistant/chats/${projectId}`, { method: "DELETE" }),
  /** The tab's stream of tool calls and chat updates. */
  assistantEventsUrl: (tab: string, projectId: string | null) =>
    `/api/assistant/events?tab=${encodeURIComponent(tab)}&project=${encodeURIComponent(projectId ?? "")}`,
  focusTab: (tab: string) => request<void>(`/api/assistant/tabs/${encodeURIComponent(tab)}/focus`, { method: "POST" }),
  postToolResult: (callId: string, tab: string, result: ToolResult) =>
    request<void>(`/api/assistant/calls/${callId}/result`, { method: "POST", body: JSON.stringify({ tab, result }) }),
  postToolProgress: (callId: string, tab: string, fraction: number | null, label?: string) =>
    request<void>(`/api/assistant/calls/${callId}/progress`, { method: "POST", body: JSON.stringify({ tab, fraction, label }) }),
};

/** POST a file as the raw body, with upload progress (0..1). */
function upload<T>(url: string, file: File, onProgress?: (fraction: number) => void, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // ignore
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body as T);
      else {
        reject(new ApiRequestError(serverMessage(body, `Upload failed (${xhr.status})`), xhr.status));
      }
    };
    xhr.onerror = () => reject(new ApiRequestError("Network error during upload", 0));
    xhr.onabort = () => reject(new ApiRequestError("Upload cancelled", 0));
    signal?.addEventListener("abort", () => xhr.abort());
    xhr.send(file);
  });
}

/** Resolve a filmstrip frame URL for a 0-based index. */
export function filmstripFrameUrl(pattern: string, index: number): string {
  return pattern.replace("{i}", String(index + 1).padStart(3, "0"));
}
