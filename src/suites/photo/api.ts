/** The photo suite's client for its own routes (`/api/photo/...`), on the platform's `request`. */
import { request } from "@/lib/api";
import type { MediaAsset } from "@shared/types";
import type { OnlinePlaceRequest, OnlineSearch, OnlineSource, WebFilter } from "@shared/photo/online";
import type { CompareResult, ExportRequest, ExportResult, HelperStatus, SourceInfo, SourceLayout, TileSize } from "@shared/photo/lab.ts";

export const LAB_BASE = "/api/photo/lab";

export const labApi = {
  helper: () => request<HelperStatus>(`${LAB_BASE}/helper`),
  sources: () => request<SourceInfo[]>(`${LAB_BASE}/sources`),
  /** Uploads an image file (its bytes are the body). */
  addSource: (file: Blob, name: string) =>
    request<SourceInfo>(`${LAB_BASE}/sources?name=${encodeURIComponent(name)}`, { method: "POST", body: file, headers: { "Content-Type": "application/octet-stream" } }),
  /** Decodes the source into tiles of `tile` on the server (once), and says how. */
  layout: (key: string, tile: TileSize) => request<SourceLayout>(`${LAB_BASE}/sources/${key}/layout?tile=${tile}`),
  urls: (key: string, tile: TileSize) => ({ raw: `${LAB_BASE}/sources/${key}/raw?tile=${tile}`, preview: `${LAB_BASE}/sources/${key}/preview?tile=${tile}` }),
  beginExport: (req: ExportRequest) =>
    request<{ id: string }>(`${LAB_BASE}/exports`, { method: "POST", body: JSON.stringify(req) }),
  exportRows: (id: string, from: number, rows: Uint8Array) =>
    request<void>(`${LAB_BASE}/exports/${id}/rows?from=${from}`, { method: "PUT", body: rows as Uint8Array<ArrayBuffer>, headers: { "Content-Type": "application/octet-stream" } }),
  finishExport: (id: string) => request<ExportResult>(`${LAB_BASE}/exports/${id}/finish`, { method: "POST" }),
  compare: (exportName: string, sourceKey: string) => request<CompareResult>(`${LAB_BASE}/exports/${encodeURIComponent(exportName)}/compare?source=${sourceKey}`),
};

/** What a finished export says: its file, and where a browser downloads it from. */
export interface PhotoExportResult extends ExportResult {
  path: string;
  download: string;
}

/** The photo suite's own routes: a project's images as tiles, and exports. */
export const photoApi = {
  layout: (projectId: string, mediaId: string, tile: TileSize) =>
    request<SourceLayout>(`/api/photo/projects/${projectId}/media/${mediaId}/layout?tile=${tile}`),
  urls: (projectId: string, mediaId: string, tile: TileSize) => ({
    raw: `/api/photo/projects/${projectId}/media/${mediaId}/raw?tile=${tile}`,
    preview: `/api/photo/projects/${projectId}/media/${mediaId}/preview?tile=${tile}`,
  }),
  /** A scene map kept in the package's cache (docs/photo/effects/scene-maps.md), or null. */
  sceneMap: async (projectId: string, key: string): Promise<ArrayBuffer | null> => {
    const res = await fetch(`/api/photo/projects/${projectId}/scene/${key}`);
    return res.status === 200 ? res.arrayBuffer() : null;
  },
  putSceneMap: (projectId: string, key: string, data: Uint8Array) =>
    request<void>(`/api/photo/projects/${projectId}/scene/${key}`, { method: "PUT", body: data as Uint8Array<ArrayBuffer>, headers: { "Content-Type": "application/octet-stream" } }),
  beginExport: (body: ExportRequest & { projectId: string; destination?: string | null }) =>
    request<{ id: string }>("/api/photo/exports", { method: "POST", body: JSON.stringify(body) }),
  exportRows: (id: string, from: number, rows: Uint8Array) =>
    request<void>(`/api/photo/exports/${id}/rows?from=${from}`, { method: "PUT", body: rows as Uint8Array<ArrayBuffer>, headers: { "Content-Type": "application/octet-stream" } }),
  finishExport: (id: string) => request<PhotoExportResult>(`/api/photo/exports/${id}/finish`, { method: "POST" }),
  /** A finished export (kept to download) made one of the project's images instead: a merge's render. */
  adoptExport: (id: string, projectId: string) => request<MediaAsset>(`/api/photo/exports/${id}/adopt?projectId=${projectId}`, { method: "POST" }),
  cancelExport: (id: string) => request<void>(`/api/photo/exports/${id}`, { method: "DELETE" }),
  compare: (id: string, projectId: string, mediaId: string) =>
    request<CompareResult>(`/api/photo/exports/${id}/compare?projectId=${projectId}&mediaId=${mediaId}`),
  /** The Online panel: a page of `source`'s results for `query` (a link reads that page's pictures). */
  searchOnline: (source: OnlineSource, query: string, page = 0, filter: WebFilter = "any", signal?: AbortSignal) =>
    request<OnlineSearch>(`/api/photo/online/search?source=${source}&q=${encodeURIComponent(query)}&page=${page}&filter=${filter}`, { signal }),
  /** A result downloaded into the project's media (the copy already there if it was placed before). */
  placeOnline: (projectId: string, body: OnlinePlaceRequest) =>
    request<MediaAsset>(`/api/photo/projects/${projectId}/online/place`, { method: "POST", body: JSON.stringify(body) }),
};
