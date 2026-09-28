import { useEffect, useState } from "react";
import type { WaveformData } from "@shared/types";

/** Module-level cache: each waveform JSON is fetched once per URL. */
const loaded = new Map<string, WaveformData>();
const pending = new Map<string, Promise<WaveformData | null>>();

function load(url: string): Promise<WaveformData | null> {
  let p = pending.get(url);
  if (!p) {
    p = fetch(url)
      .then((res) => (res.ok ? (res.json() as Promise<WaveformData>) : null))
      .then((data) => {
        if (data && Array.isArray(data.peaks) && data.peaksPerSecond > 0) {
          loaded.set(url, data);
          return data;
        }
        return null;
      })
      .catch(() => null);
    pending.set(url, p);
  }
  return p;
}

export function useWaveformData(url: string | null): WaveformData | null {
  const cached = url ? (loaded.get(url) ?? null) : null;
  const [, setVersion] = useState(0);
  useEffect(() => {
    if (!url || loaded.has(url)) return;
    let alive = true;
    void load(url).then((data) => {
      if (alive && data) setVersion((v) => v + 1);
    });
    return () => {
      alive = false;
    };
  }, [url]);
  return cached;
}
