/**
 * Off the main thread: the Object Selection tool's edge (`shared/photo/sam-refine.ts`). SAM's mask is read onto the
 * photo's pixels and its edge decided by their colours, which at a photo's full size takes most of a second: done
 * here, the page keeps drawing meanwhile.
 */
import { maskCoverage } from "@shared/photo/sam.ts";
import { type EdgeOptions, refineEdge } from "@shared/photo/sam-refine.ts";

export interface EdgeRequest {
  id: number;
  /** SAM's mask: 256² logits over the picture. */
  logits: Float32Array;
  /** The picture's pixels (RGBA, straight alpha). */
  data: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
  options: EdgeOptions;
}

export interface EdgeReply {
  id: number;
  /** The picture's coverage, 0..255; null when the work failed (`error` says why). */
  coverage: Uint8Array | null;
  error?: string;
}

self.onmessage = (event: MessageEvent<EdgeRequest>) => {
  const { id, logits, data, width, height, options } = event.data;
  const reply = (r: EdgeReply, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(r, transfer);
  try {
    const coverage = refineEdge(maskCoverage(logits, width, height), { width, height, data, scale: 1 }, options);
    reply({ id, coverage }, [coverage.buffer]);
  } catch (error) {
    reply({ id, coverage: null, error: error instanceof Error ? error.message : String(error) });
  }
};
