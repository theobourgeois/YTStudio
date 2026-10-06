import { useEffect, useState } from "react";
import type { ExportFormat } from "@shared/export-formats";
import { api } from "@/lib/api";

/** The formats this computer's ffmpeg can make (asked when `enabled` turns on); null until the server says. */
export function useExportFormats(enabled: boolean): ExportFormat[] | null {
  const [formats, setFormats] = useState<ExportFormat[] | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    api
      .exportFormats()
      .then((list) => alive && setFormats(list))
      .catch(() => alive && setFormats(null));
    return () => {
      alive = false;
    };
  }, [enabled]);

  return formats;
}
