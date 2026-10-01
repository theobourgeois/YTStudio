import { create } from "zustand";
import { toast } from "sonner";
import { errorMessage } from "@shared/errors";
import {
  DEFAULT_EXPORT_SETTINGS,
  EXPORT_FORMAT_NAMES,
  type ExportFormat,
  type ExportSettings,
  type MusicExportJob,
  normalizeExportSettings,
  safeFileName,
} from "@shared/music/export";
import { chooseSaveFile } from "@/lib/desktop";
import { musicApi } from "../api";
import { usePiano } from "../piano/store";
import { usePlaylist } from "../playlist/store";
import { useMusicPreferences } from "../preferences";
import { useMusic } from "../store";
import { useTransport } from "../transport";
import { useMusicUi } from "../ui";

const SETTINGS_KEY = "music-export-settings";
const FOLDER_KEY = "music-export-folder";
const POLL_MS = 150;

/**
 * A song's export, as FL Studio does it (`docs/fl-studio/export.md`): the save dialog first (the desktop
 * app), then the export window with its settings (remembered across songs), then Start. The song is
 * rendered as it was when Start was pressed; editing goes on meanwhile, only playing waits.
 */
interface SongExportState {
  settings: ExportSettings;
  /** The save dialog's file: the files go beside it, named after it. Null in a browser (they're downloaded). */
  destination: string | null;
  job: MusicExportJob | null;
  /** Start was pressed and the server hasn't answered yet. */
  starting: boolean;
  setSettings: (patch: Partial<ExportSettings>) => void;
  /**
   * ⌘R, ⌘⇧R or the toolbar's Export: where to save it (the save dialog, in the desktop app), then the
   * window, with `format` ticked. Nothing happens if the save dialog is cancelled.
   */
  begin: (format?: ExportFormat) => Promise<void>;
  /** The window's Change…: the save dialog again. */
  chooseDestination: () => Promise<boolean>;
  start: () => Promise<void>;
  abort: () => Promise<void>;
  /** Back to the settings, after an export (the window's Export again). */
  reset: () => void;
}

const busy = (job: MusicExportJob | null) => job !== null && (job.state === "rendering" || job.state === "encoding");

function storedSettings(): ExportSettings {
  try {
    return normalizeExportSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null"));
  } catch {
    return DEFAULT_EXPORT_SETTINGS;
  }
}

/** The song's name, as a file's (what the save dialog suggests, and a browser's download is called). */
export const songFileName = () => safeFileName(useMusic.getState().history?.doc.name || "Song");

/** The formats' extensions for the save dialog, the first audio one the dialog's own. */
function dialogOptions(formats: readonly ExportFormat[], name: string) {
  const first = formats.find((f) => f !== "mid") ?? formats[0] ?? "wav";
  const folder = localStorage.getItem(FOLDER_KEY);
  return {
    defaultPath: `${folder ? `${folder}/` : ""}${name}.${first}`,
    filters: [{ name: EXPORT_FORMAT_NAMES[first], extensions: [first] }],
  };
}

let polling: ReturnType<typeof setInterval> | null = null;

export const useSongExport = create<SongExportState>((set, get) => {
  /** Ask the save dialog; false if it was cancelled. Undefined: there's none (a browser). */
  async function ask(formats: readonly ExportFormat[]): Promise<boolean | undefined> {
    const asked = chooseSaveFile(dialogOptions(formats, songFileName()));
    if (!asked) return undefined;
    const file = await asked;
    if (!file) return false;
    localStorage.setItem(FOLDER_KEY, file.slice(0, Math.max(0, file.lastIndexOf("/"), file.lastIndexOf("\\"))));
    set({ destination: file });
    return true;
  }

  function follow(id: string) {
    if (polling) clearInterval(polling);
    polling = setInterval(async () => {
      try {
        const job = await musicApi.exportJob(id);
        if (get().job?.id !== id) return;
        set({ job });
        if (busy(job)) return;
        if (polling) clearInterval(polling);
        polling = null;
        useTransport.setState({ exporting: false });
        finished(job);
      } catch (err) {
        if (polling) clearInterval(polling);
        polling = null;
        useTransport.setState({ exporting: false });
        set({ job: get().job && { ...get().job!, state: "failed", error: errorMessage(err) } });
      }
    }, POLL_MS);
  }

  function finished(job: MusicExportJob) {
    if (job.state === "failed") toast.error("The export failed", { description: job.error ?? undefined });
    if (job.state !== "done") return;
    // A browser's single file downloads at once; several are listed in the window to download.
    if (job.files.length === 1 && job.files[0].path === null) download(job.id, job.files[0].name);
    if (!useMusicUi.getState().exportOpen) toast.success("Exported", { description: job.files.map((f) => f.name).join(", ") });
  }

  return {
    settings: storedSettings(),
    destination: null,
    job: null,
    starting: false,

    setSettings(patch) {
      const settings = normalizeExportSettings({ ...get().settings, ...patch });
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      set({ settings });
      // The resampling chosen here is Settings' "in exports" one.
      if (patch.resampling) useMusicPreferences.getState().setResampling({ exportResampling: patch.resampling });
    },

    async begin(format) {
      const ui = useMusicUi.getState();
      if (busy(get().job)) return ui.setExportOpen(true);
      if (format && !get().settings.formats.includes(format)) get().setSettings({ formats: [...get().settings.formats, format] });
      const formats = format ? [format, ...get().settings.formats.filter((f) => f !== format)] : get().settings.formats;
      if (get().job && !busy(get().job)) set({ job: null });
      if ((await ask(formats)) === false) return;
      ui.setExportOpen(true);
    },

    async chooseDestination() {
      return (await ask(get().settings.formats)) === true;
    },

    async start() {
      const { history, projectId, patternId } = useMusic.getState();
      if (!history || !projectId || get().starting || busy(get().job)) return;
      const settings = { ...get().settings, resampling: useMusicPreferences.getState().exportResampling };
      const selection = settings.mode === "song" ? usePlaylist.getState().time : usePiano.getState().time;
      set({ starting: true });
      try {
        const job = await musicApi.startExport({ projectId, song: history.doc, patternId, selection, settings, destination: get().destination });
        // The engine stops playing; the transport follows.
        useTransport.setState({ exporting: true, playing: false, pausedAt: null });
        set({ job, starting: false });
        follow(job.id);
      } catch (err) {
        set({ starting: false });
        toast.error("Couldn't export", { description: errorMessage(err) });
      }
    },

    async abort() {
      const id = get().job?.id;
      if (id && busy(get().job)) await musicApi.abortExport(id).catch(() => {});
    },

    reset() {
      if (!busy(get().job)) set({ job: null });
    },
  };
});

/** Download a file a browser's export kept on the server. */
export function download(id: string, name: string) {
  const link = document.createElement("a");
  link.href = musicApi.exportFileUrl(id, name);
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
}

/** Whether the job is still going. */
export const exportBusy = busy;
