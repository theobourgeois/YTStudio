/**
 * The open video's signals (what its sounds do over time, `shared/signals/`), loaded for whatever reacts
 * to sound: every file with sound its clips play is analysed if it isn't yet (old media), fetched once
 * ready, and read through the open video's `SignalReader` (`setSignalReader`), which the preview,
 * Properties and the canvas all use without asking.
 */
import { create } from "zustand";
import type { StoreApi } from "zustand";
import { type SignalStore, createSignalReader, setSignalReader, signalAssets } from "@shared/audio-signals";
import { SIGNALS_VERSION, type SignalData, decodeSignals } from "@shared/signals/format";
import type { MediaAsset, Project } from "@shared/types";
import { api } from "@/lib/api";
import { pollProcessingAssets } from "./asset-polling";
import { log } from "@/lib/log";

const logger = log("signals");

interface SignalsState {
  /** Loaded signals by media id (a new map whenever one is added). */
  data: SignalStore;
}

export const useSignals = create<SignalsState>(() => ({ data: new Map() }));

/** Signals being fetched, by their file's URL. */
const loading = new Map<string, Promise<SignalData | null>>();

/** Fetch and read a file's signals (once per file), or null when they can't be read. */
export function loadSignals(asset: MediaAsset): Promise<SignalData | null> {
  const signals = asset.signals;
  if (signals?.status !== "ready" || signals.version !== SIGNALS_VERSION) return Promise.resolve(null);
  const known = useSignals.getState().data.get(asset.id);
  if (known) return Promise.resolve(known);
  let pending = loading.get(signals.src);
  if (!pending) {
    pending = fetch(signals.src)
      .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(`${res.status}`))))
      .then((buffer) => {
        const data = decodeSignals(buffer);
        useSignals.setState((s) => ({ data: new Map(s.data).set(asset.id, data) }));
        return data;
      })
      .catch((err) => {
        logger.warn(`couldn't read the signals of ${asset.name}`, err);
        return null;
      })
      .finally(() => loading.delete(signals.src));
    loading.set(signals.src, pending);
  }
  return pending;
}

/** Stores already watched. */
const watched = new WeakSet<object>();

/**
 * Keep a video store's signals loaded: ask the server to analyse the files that have none (once a
 * session), follow those being analysed, fetch those ready; and keep the open video's reader current.
 * Idempotent per store.
 */
export function watchSignals(store: StoreApi<{ document: Project; assets: MediaAsset[] }>) {
  if (watched.has(store)) return;
  watched.add(store);
  const asked = new Set<string>();
  const check = () => {
    const { document, assets } = store.getState();
    const byId = new Map(assets.map((a) => [a.id, a]));
    // Forget other videos' signals.
    const data = useSignals.getState().data;
    if ([...data.keys()].some((id) => !byId.has(id))) {
      useSignals.setState({ data: new Map([...data].filter(([id]) => byId.has(id))) });
    }
    for (const id of signalAssets(document, (id) => !!byId.get(id)?.hasAudio)) {
      const asset = byId.get(id)!;
      const signals = asset.signals;
      if (signals?.status === "ready" && signals.version === SIGNALS_VERSION) void loadSignals(asset);
      else if (signals?.status === "processing") void pollProcessingAssets(store);
      else if (!asked.has(id)) {
        asked.add(id);
        api
          .analyseSignals(id)
          .then((updated) => {
            store.setState({ assets: store.getState().assets.map((a) => (a.id === updated.id ? updated : a)) });
            void pollProcessingAssets(store);
          })
          .catch((err) => logger.warn("couldn't ask for a file's signals", err));
      }
    }
  };
  const setReader = () => setSignalReader(createSignalReader(store.getState().document, useSignals.getState().data));
  store.subscribe((s, prev) => {
    if (s.document !== prev.document || s.assets !== prev.assets) check();
    if (s.document !== prev.document) setReader();
  });
  useSignals.subscribe((s, prev) => {
    if (s.data !== prev.data) setReader();
  });
  check();
  setReader();
}
