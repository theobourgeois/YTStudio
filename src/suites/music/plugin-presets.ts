import { useCallback, useEffect, useState } from "react";
import { create } from "zustand";
import { toast } from "sonner";
import { errorMessage } from "@shared/errors";
import type { PluginPresets, PresetRequest } from "@shared/music/engine";
import { musicApi } from "./api";

/**
 * Each song plugin's presets changed this many times (its window's arrows, a request): what shows them
 * asks for them again. Fed by the engine's "preset" events (`engine-sync.ts`), by owner id.
 */
export const usePresetVersions = create<{ versions: Readonly<Record<string, number>> }>(() => ({ versions: {} }));

export function presetsChanged(id: string) {
  const { versions } = usePresetVersions.getState();
  usePresetVersions.setState({ versions: { ...versions, [id]: (versions[id] ?? 0) + 1 } });
}

/** A `PresetRequest` without whose it is (each kind of it). */
type Action = PresetRequest extends infer R ? (R extends unknown ? Omit<R, "owner" | "id"> : never) : never;

/**
 * A song plugin's presets (FL's preset browser) while its plugin is loaded, kept up to date, and what
 * changes them. Null until they're known.
 */
export function usePluginPresets(owner: "channel" | "effect", id: string, loaded: boolean) {
  const [presets, setPresets] = useState<PluginPresets | null>(null);
  const version = usePresetVersions((s) => s.versions[id] ?? 0);
  useEffect(() => {
    if (!loaded) return setPresets(null);
    let current = true;
    musicApi.presets(owner, id).then(
      (next) => current && setPresets(next),
      () => current && setPresets(null),
    );
    return () => {
      current = false;
    };
  }, [owner, id, loaded, version]);
  const run = useCallback(
    async (action: Action) => {
      try {
        setPresets(await musicApi.preset({ owner, id, ...action } as PresetRequest));
      } catch (err) {
        toast.error("Couldn't change the preset", { description: errorMessage(err) });
      }
    },
    [owner, id],
  );
  return { presets, run };
}
