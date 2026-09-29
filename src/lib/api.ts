import type {
  ApiError,
  CreateProjectRequest,
  ExportJob,
  ExportRequest,
  FontFamily,
  HealthResponse,
  ImportWebMediaRequest,
  MediaAsset,
  Project,
  ProjectSummary,
  SetUpEngineRequest,
  TranscribeRequest,
  TranscriptionEngineId,
  TranscriptionEngineInfo,
  TranscriptionJob,
  UpdateProjectRequest,
  WebClip,
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
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

  listProjects: () => request<ProjectSummary[]>("/api/projects"),
  createProject: (body: CreateProjectRequest = {}) =>
    request<ProjectSummary>("/api/projects", { method: "POST", body: JSON.stringify(body) }),
  getProject: (id: string) => request<Project>(`/api/projects/${id}`),
  /** Save the project document. Returns the refreshed summary (void for keepalive saves on unload). */
  saveProject: (id: string, project: Project, keepalive = false) =>
    request<ProjectSummary>(`/api/projects/${id}`, {
      method: "PUT",
      body: JSON.stringify(project),
      keepalive,
    }),
  updateProject: (id: string, body: UpdateProjectRequest) =>
    request<ProjectSummary>(`/api/projects/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteProject: (id: string) => request<void>(`/api/projects/${id}`, { method: "DELETE" }),

  listMedia: (projectId: string) =>
    request<MediaAsset[]>(`/api/media?projectId=${encodeURIComponent(projectId)}`),
  getMedia: (id: string) => request<MediaAsset>(`/api/media/${id}`),
  deleteMedia: (id: string) => request<void>(`/api/media/${id}`, { method: "DELETE" }),

  /** Upload a file with progress (0..1). Resolves with the probed asset. */
  uploadMedia(
    projectId: string,
    file: File,
    onProgress?: (fraction: number) => void,
    signal?: AbortSignal,
  ): Promise<MediaAsset> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(
        "POST",
        `/api/media?projectId=${encodeURIComponent(projectId)}&name=${encodeURIComponent(file.name)}`,
      );
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
        if (xhr.status >= 200 && xhr.status < 300) resolve(body as MediaAsset);
        else {
          reject(new ApiRequestError(serverMessage(body, `Upload failed (${xhr.status})`), xhr.status));
        }
      };
      xhr.onerror = () => reject(new ApiRequestError("Network error during upload", 0));
      xhr.onabort = () => reject(new ApiRequestError("Upload cancelled", 0));
      signal?.addEventListener("abort", () => xhr.abort());
      xhr.send(file);
    });
  },

  searchWeb: (query: string, signal?: AbortSignal) =>
    request<WebClip[]>(`/api/web/search?q=${encodeURIComponent(query)}`, { signal }),
  /** What's at a pasted link (title, duration...), without downloading it. */
  resolveWebLink: (url: string, signal?: AbortSignal) =>
    request<WebClip>(`/api/web/resolve?url=${encodeURIComponent(url)}`, { signal }),
  /** A clip's audio (the server downloads it on the first request, then serves it from its cache). */
  webAudio: async (url: string, signal?: AbortSignal) =>
    (await send(`/api/web/audio?url=${encodeURIComponent(url)}`, { signal })).blob(),
  importWebMedia: (body: ImportWebMediaRequest) =>
    request<MediaAsset>("/api/web/import", { method: "POST", body: JSON.stringify(body) }),

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
};

/** Resolve a filmstrip frame URL for a 0-based index. */
export function filmstripFrameUrl(pattern: string, index: number): string {
  return pattern.replace("{i}", String(index + 1).padStart(3, "0"));
}
