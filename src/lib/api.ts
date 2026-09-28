import type {
  CreateProjectRequest,
  ExportJob,
  ExportRequest,
  HealthResponse,
  MediaAsset,
  Project,
  ProjectSummary,
  UpdateProjectRequest,
} from "@shared/types";

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json", ...init.headers } : init?.headers,
  });
  if (!res.ok) throw new ApiRequestError(await errorMessage(res), res.status);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (body && typeof body.error === "string") return body.error;
  } catch {
    // not JSON
  }
  return `Request failed (${res.status})`;
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
          const msg =
            body && typeof (body as { error?: unknown }).error === "string"
              ? (body as { error: string }).error
              : `Upload failed (${xhr.status})`;
          reject(new ApiRequestError(msg, xhr.status));
        }
      };
      xhr.onerror = () => reject(new ApiRequestError("Network error during upload", 0));
      xhr.onabort = () => reject(new ApiRequestError("Upload cancelled", 0));
      signal?.addEventListener("abort", () => xhr.abort());
      xhr.send(file);
    });
  },

  startExport: (req: ExportRequest) =>
    request<ExportJob>("/api/exports", { method: "POST", body: JSON.stringify(req) }),
  getExport: (id: string) => request<ExportJob>(`/api/exports/${id}`),
  cancelExport: (id: string) => request<void>(`/api/exports/${id}`, { method: "DELETE" }),
};

/** Resolve a filmstrip frame URL for a 0-based index. */
export function filmstripFrameUrl(pattern: string, index: number): string {
  return pattern.replace("{i}", String(index + 1).padStart(3, "0"));
}
