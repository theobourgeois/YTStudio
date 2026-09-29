/**
 * Refresh assets whose filmstrip/waveform are still being generated on the
 * server (`status: "processing"`) until they're ready.
 */
import type { StoreApi } from "zustand";
import type { MediaAsset } from "@shared/types";
import { ApiRequestError, api } from "@/lib/api";

const POLL_MS = 1000;

/** Stores with a poll loop running. */
const polling = new WeakSet<object>();

/**
 * Poll the store's processing assets (no-op when a poll loop is already running
 * for it). `fetch` gets one asset: project media by default.
 */
export async function pollProcessingAssets(
  store: StoreApi<{ assets: MediaAsset[] }>,
  fetch: (id: string) => Promise<MediaAsset> = api.getMedia,
) {
  if (polling.has(store)) return;
  polling.add(store);
  try {
    while (store.getState().assets.some((a) => a.status === "processing")) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      const pending = store.getState().assets.filter((a) => a.status === "processing");
      const gone = new Set<string>();
      const updated = await Promise.all(
        pending.map((a) =>
          fetch(a.id).catch((err) => {
            // Deleted on the server: stop polling it. Other errors: try again next tick.
            if (err instanceof ApiRequestError && err.status === 404) gone.add(a.id);
            return null;
          }),
        ),
      );
      const byId = new Map(updated.filter((a): a is MediaAsset => !!a).map((a) => [a.id, a]));
      store.setState({
        assets: store
          .getState()
          .assets.filter((a) => !gone.has(a.id))
          .map((a) => byId.get(a.id) ?? a),
      });
    }
  } finally {
    polling.delete(store);
  }
}
