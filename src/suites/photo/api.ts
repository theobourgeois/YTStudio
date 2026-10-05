/** The photo suite's client for its own routes (`/api/photo/...`), on the platform's `request`. */
import { request } from "@/lib/api";
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
