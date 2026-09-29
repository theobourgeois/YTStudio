import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export type FfmpegStatus = "checking" | "available" | "missing" | "offline";

/** Asks the server whether ffmpeg is installed; re-checks whenever `enabled` turns on. */
export function useFfmpegStatus(enabled: boolean): FfmpegStatus {
  const [status, setStatus] = useState<FfmpegStatus>("checking");

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    setStatus("checking");
    api
      .health()
      .then((h) => alive && setStatus(h.ffmpeg.available ? "available" : "missing"))
      .catch(() => alive && setStatus("offline"));
    return () => {
      alive = false;
    };
  }, [enabled]);

  return status;
}
