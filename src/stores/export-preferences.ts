import { create } from "zustand";
import {
  DEFAULT_EXPORT_FORMAT,
  DEFAULT_EXPORT_QUALITY,
  type ExportFormat,
  type ExportQuality,
  exportFormat,
  isExportFormat,
  isExportQuality,
} from "@shared/export-formats";

const KEY = "editor-export";

interface Stored {
  format: ExportFormat;
  quality: ExportQuality;
  alpha: boolean;
}

function load(): Stored {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Record<keyof Stored, unknown>>;
    return {
      format: isExportFormat(raw.format) ? raw.format : DEFAULT_EXPORT_FORMAT,
      quality: isExportQuality(raw.quality) ? raw.quality : DEFAULT_EXPORT_QUALITY,
      alpha: raw.alpha === true,
    };
  } catch {
    return { format: DEFAULT_EXPORT_FORMAT, quality: DEFAULT_EXPORT_QUALITY, alpha: false };
  }
}

interface ExportPreferencesState extends Stored {
  setFormat: (format: ExportFormat) => void;
  setQuality: (quality: ExportQuality) => void;
  setAlpha: (alpha: boolean) => void;
}

/**
 * What the export window last made (its format, quality and transparency), kept in this browser as Premiere keeps
 * the last export settings. Transparency is remembered apart from the format, and asked for only of formats that
 * can carry it (`exportRequestSettings`).
 */
export const useExportPreferences = create<ExportPreferencesState>((set, get) => {
  const save = (patch: Partial<Stored>) => {
    set(patch);
    const { format, quality, alpha } = get();
    localStorage.setItem(KEY, JSON.stringify({ format, quality, alpha }));
  };
  return {
    ...load(),
    setFormat: (format) => save({ format }),
    setQuality: (quality) => save({ quality }),
    setAlpha: (alpha) => save({ alpha }),
  };
});

/** The remembered settings as an export request says them: transparent only where the format can be. */
export function exportRequestSettings(): Stored {
  const { format, quality, alpha } = useExportPreferences.getState();
  return { format, quality, alpha: alpha && exportFormat(format).alpha };
}
