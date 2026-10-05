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
  export: (pixels: Uint8Array, req: ExportRequest) => {
    const q = new URLSearchParams({ name: req.name, width: String(req.width), height: String(req.height), bits: String(req.bits), format: req.format });
    if (req.quality) q.set("quality", String(req.quality));
    return request<ExportResult>(`${LAB_BASE}/exports?${q}`, { method: "POST", body: pixels as Uint8Array<ArrayBuffer>, headers: { "Content-Type": "application/octet-stream" } });
  },
  compare: (exportName: string, sourceKey: string) => request<CompareResult>(`${LAB_BASE}/exports/${encodeURIComponent(exportName)}/compare?source=${sourceKey}`),
};
