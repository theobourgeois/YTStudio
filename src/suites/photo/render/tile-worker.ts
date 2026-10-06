/**
 * Off the main thread: hashing finished strokes' tiles (SHA-256 of their raw samples, or a constant value) and
 * uploading them and their manifest. Tiles wait here, as bytes, until the server has them: the GPU's copies can
 * be evicted, or the device lost, without losing a committed stroke (rendering.md, "Device loss").
 */
import { fromHalf } from "@shared/photo/half.ts";
import { constantRef } from "@shared/photo/surfaces.ts";

export type WorkerRequest =
  | { type: "hash"; id: number; tiles: ArrayBuffer[]; channels: number }
  | { type: "manifest"; id: number; json: string }
  | { type: "upload"; id: number; base: string; refs: string[]; manifest: { hash: string; json: string } }
  | { type: "bytes"; id: number; hash: string };

export type WorkerReply =
  | { type: "hash"; id: number; refs: string[]; ms: number }
  | { type: "manifest"; id: number; hash: string }
  | { type: "upload"; id: number; ok: true; ms: number; sent: number }
  | { type: "upload"; id: number; ok: false; error: string }
  | { type: "bytes"; id: number; bytes: ArrayBuffer | null };

const waiting = new Map<string, ArrayBuffer>();

const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");

/** `c:` and its values when every texel is the same (half floats), else null. */
function constant(tile: ArrayBuffer, channels: number): string | null {
  const texels = new Uint16Array(tile);
  for (let i = channels; i < texels.length; i += channels) {
    for (let c = 0; c < channels; c++) if (texels[i + c] !== texels[c]) return null;
  }
  return constantRef(Array.from(texels.subarray(0, channels), fromHalf));
}

async function put(url: string, body: BodyInit, type: string, attempts = 4): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { method: "PUT", body, headers: { "Content-Type": type } });
      if (res.ok) return;
      const text = await res.text();
      if (res.status < 500 || attempt >= attempts) throw new Error(`${res.status}: ${text}`);
    } catch (error) {
      if (attempt >= attempts) throw error;
    }
    await new Promise((r) => setTimeout(r, 200 * 2 ** attempt));
  }
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  const reply = (r: WorkerReply) => (self as unknown as Worker).postMessage(r);
  if (message.type === "hash") {
    const started = performance.now();
    const refs = await Promise.all(
      message.tiles.map(async (tile) => {
        const flat = constant(tile, message.channels);
        if (flat) return flat;
        const hash = hex(await crypto.subtle.digest("SHA-256", tile));
        waiting.set(hash, tile);
        return hash;
      }),
    );
    reply({ type: "hash", id: message.id, refs, ms: performance.now() - started });
  } else if (message.type === "manifest") {
    reply({ type: "manifest", id: message.id, hash: hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(message.json))) });
  } else if (message.type === "bytes") {
    // A copy: the original stays until it's uploaded.
    const bytes = waiting.get(message.hash);
    reply({ type: "bytes", id: message.id, bytes: bytes ? bytes.slice(0) : null });
  } else if (message.type === "upload") {
    const started = performance.now();
    try {
      const hashes = [...new Set(message.refs.filter((r) => waiting.has(r)))];
      // Four at a time.
      let next = 0;
      await Promise.all(
        Array.from({ length: 4 }, async () => {
          while (next < hashes.length) {
            const hash = hashes[next++];
            await put(`${message.base}/blobs/${hash}`, waiting.get(hash)!, "application/octet-stream");
          }
        }),
      );
      await put(`${message.base}/manifests/${message.manifest.hash}`, message.manifest.json, "application/json");
      for (const hash of hashes) waiting.delete(hash);
      reply({ type: "upload", id: message.id, ok: true, ms: performance.now() - started, sent: hashes.length });
    } catch (error) {
      reply({ type: "upload", id: message.id, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
};
