/**
 * Decoded sources (docs/photo/architecture.md, "Sources"): an image file decoded once by the helper into a
 * tile-major raw file, a small preview and its layout, kept at `<base>.raw`, `<base>.preview` and `<base>.json`.
 * The base names the file, the tile size and the decoder (a new sharp decodes again), so a cache can be deleted
 * at any time. Concurrent requests for the same base share one decode.
 */
import { readJson, writeJson } from "../storage.ts";
import type { SourceLayout, TileSize } from "../../shared/photo/lab.ts";
import { type PhotoHelper, removeLeftovers } from "./helper.ts";
import { sha256 } from "./blobs.ts";

type DecodeResult = Omit<SourceLayout, "key">;

export class SourceDecoder {
  private readonly decoding = new Map<string, Promise<SourceLayout>>();

  constructor(readonly helper: PhotoHelper) {}

  /** `<folder>/<name>-<tile>-<decoder>`: where a source's decoded files go. */
  async base(folder: string, name: string, tile: TileSize): Promise<string> {
    const decoder = sha256(await this.helper.decoder()).slice(0, 8);
    return `${folder}/${name}-${tile}-${decoder}`;
  }

  /** The source decoded into tiles of `tile` (from the cache when it's there). */
  async layout(file: string, base: string, key: string, tile: TileSize): Promise<SourceLayout> {
    const cached = await readJson<SourceLayout>(`${base}.json`);
    if (cached) return { ...cached, key, decodeMs: 0 };
    let decoding = this.decoding.get(base);
    if (!decoding) {
      decoding = (async () => {
        const result = await this.helper.request<DecodeResult>("decode", { file, out: `${base}.raw`, preview: `${base}.preview`, tile });
        const layout: SourceLayout = { ...result, key };
        await writeJson(`${base}.json`, layout);
        return layout;
      })().finally(() => {
        this.decoding.delete(base);
        // A helper killed mid-decode (and retried) leaves its half-written files.
        void Promise.all([removeLeftovers(`${base}.raw`), removeLeftovers(`${base}.preview`)]).catch(() => {});
      });
      this.decoding.set(base, decoding);
    }
    return decoding;
  }
}
