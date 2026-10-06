import { create } from "zustand";
import { toast } from "sonner";
import { errorMessage } from "@shared/errors";
import { type VisualizerOptions, normalizeVisualizerOptions } from "@shared/handoff";
import { type VisualizerChoice, type VisualizerJob, type VisualizerSources, visualizerSources } from "@shared/music/visualizer";
import type { SignalRole } from "@shared/types";
import { useProjects } from "@/stores/projects";
import { musicApi } from "../api";
import { useMusic } from "../store";
import { useTransport } from "../transport";
import { useMusicUi } from "../ui";

const OPTIONS_KEY = "music-visualizer-options";
const POLL_MS = 150;

/**
 * Make visualizer (docs/visualizer/README.md, V5): the window's choices (which stems and channels' notes
 * go over, what each is, the video's look and shape), then the song rendered on the server and made into
 * a video project, which opens in a tab of its own. The song is taken as it is when Make is pressed.
 */
interface VisualizerState {
  /** The video's look, aspect ratio and frame rate, remembered across songs. */
  video: VisualizerOptions;
  /** Stems and channels turned off in the window (track and channel ids): everything else goes over. */
  off: string[];
  /** Roles chosen in the window, by track or channel id ("none": nothing in particular). */
  roles: Record<string, SignalRole | "none">;
  job: VisualizerJob | null;
  /** Make was pressed and the server hasn't answered yet. */
  starting: boolean;
  /** Open the window, its choices fresh for the song. */
  open: () => void;
  close: () => void;
  setVideo: (patch: Partial<VisualizerOptions>) => void;
  setOn: (id: string, on: boolean) => void;
  setRole: (id: string, role: SignalRole | "none") => void;
  /** The choice for these sources, as the window shows it. */
  choiceFor: (sources: VisualizerSources) => VisualizerChoice;
  /** Make it (the window's Make): toasts if it can't start, opens the video when it's made. */
  make: () => Promise<void>;
  /** Make it and resolve when it has ended, however it ended (the assistant's); throws if it couldn't start. */
  run: (choice?: Partial<VisualizerChoice>, open?: boolean) => Promise<VisualizerJob>;
  abort: () => Promise<void>;
}

const busy = (job: VisualizerJob | null) => job !== null && (job.state === "rendering" || job.state === "making");

function storedOptions(): VisualizerOptions {
  try {
    return normalizeVisualizerOptions(JSON.parse(localStorage.getItem(OPTIONS_KEY) ?? "null"));
  } catch {
    return normalizeVisualizerOptions(null);
  }
}

/** Open the video made (in a tab of its own). */
async function openVideo(job: VisualizerJob) {
  if (!job.project) return;
  const projects = useProjects.getState();
  projects.setSummary(job.project);
  await projects.open(job.project.id);
}

let polling: ReturnType<typeof setInterval> | null = null;

export const useVisualizer = create<VisualizerState>((set, get) => {
  /** Follow a job until it ends; `then` runs once it has. */
  function follow(id: string, then: (job: VisualizerJob) => void) {
    if (polling) clearInterval(polling);
    const ended = (job: VisualizerJob) => {
      if (polling) clearInterval(polling);
      polling = null;
      useTransport.setState({ exporting: false });
      then(job);
    };
    polling = setInterval(async () => {
      try {
        const job = await musicApi.visualizerJob(id);
        if (get().job?.id !== id) return;
        set({ job });
        if (!busy(job)) ended(job);
      } catch (err) {
        const job = get().job && { ...get().job!, state: "failed" as const, error: errorMessage(err) };
        set({ job });
        if (job) ended(job);
      }
    }, POLL_MS);
  }

  async function launch(choice: VisualizerChoice, then: (job: VisualizerJob) => void): Promise<VisualizerJob> {
    const { history, projectId, patternId } = useMusic.getState();
    if (!history || !projectId) throw new Error("No song is open.");
    if (get().starting || busy(get().job)) throw new Error("A visualizer is being made already.");
    set({ starting: true });
    try {
      const job = await musicApi.startVisualizer({ projectId, song: history.doc, patternId, choice });
      // The engine renders it as an export: playing stops meanwhile.
      useTransport.setState({ exporting: true, playing: false, pausedAt: null });
      set({ job, starting: false });
      follow(job.id, then);
      return job;
    } catch (err) {
      set({ starting: false });
      throw err;
    }
  }

  const currentSources = () => {
    const { history, patternId } = useMusic.getState();
    if (!history) throw new Error("No song is open.");
    return visualizerSources(history.doc, patternId);
  };

  return {
    video: storedOptions(),
    off: [],
    roles: {},
    job: null,
    starting: false,

    open() {
      if (!busy(get().job)) set({ off: [], roles: {}, job: null });
      useMusicUi.getState().setVisualizerOpen(true);
    },

    close() {
      if (busy(get().job)) void get().abort();
      useMusicUi.getState().setVisualizerOpen(false);
    },

    setVideo(patch) {
      const video = normalizeVisualizerOptions({ ...get().video, ...patch });
      localStorage.setItem(OPTIONS_KEY, JSON.stringify(video));
      set({ video });
    },

    setOn(id, on) {
      const off = get().off.filter((x) => x !== id);
      set({ off: on ? off : [...off, id] });
    },

    setRole(id, role) {
      set({ roles: { ...get().roles, [id]: role } });
    },

    choiceFor(sources) {
      const { off, roles, video } = get();
      return {
        stems: sources.stems.map((s) => s.trackId).filter((id) => !off.includes(id)),
        channels: sources.channels.map((c) => c.channelId).filter((id) => !off.includes(id)),
        roles,
        video,
      };
    },

    async make() {
      try {
        await launch(get().choiceFor(currentSources()), (job) => {
          if (job.state === "failed") toast.error("Couldn't make the visualizer", { description: job.error ?? undefined });
          if (job.state !== "done") return;
          useMusicUi.getState().setVisualizerOpen(false);
          set({ job: null });
          void openVideo(job);
        });
      } catch (err) {
        toast.error("Couldn't make the visualizer", { description: errorMessage(err) });
      }
    },

    async run(choice = {}, open = false) {
      const chosen = { ...get().choiceFor(currentSources()), ...choice };
      return new Promise<VisualizerJob>((resolve, reject) => {
        launch(chosen, (job) => {
          if (job.state === "done" && open) void openVideo(job);
          resolve(job);
        }).catch(reject);
      });
    },

    async abort() {
      const id = get().job?.id;
      if (id && busy(get().job)) await musicApi.abortVisualizer(id).catch(() => {});
    },
  };
});

/** Whether a visualizer is being made. */
export const visualizerBusy = busy;
