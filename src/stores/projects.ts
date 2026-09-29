import { create } from "zustand";
import { toast } from "sonner";
import type { ProjectStatus, ProjectSummary } from "@shared/types";
import { errorMessage } from "@shared/errors";
import { api } from "@/lib/api";
import { projectIdFromUrl, setUrlProject } from "@/lib/route";
import { discardPendingSave, flushAutosave, onProjectSaved, useEditor } from "./editor";

/**
 * The workspace: every video is a project that is either `active` (being worked
 * on) or `settled` (done and put away). Opening a project loads it into the
 * editor store; the URL tracks which one is open.
 */
interface ProjectsState {
  projects: ProjectSummary[];
  loaded: boolean;
  loadError: string | null;

  /** Load the list and open the project from the URL (or the most recent active one). */
  init: () => Promise<void>;
  open: (projectId: string) => void;
  /** Create a new project, open it, and optionally import files into it. */
  create: (files?: File[]) => Promise<void>;
  settle: (projectId: string) => Promise<void>;
  unsettle: (projectId: string) => Promise<void>;
  /** Copy a project (and its media) into a new active one. */
  duplicate: (projectId: string) => Promise<void>;
  remove: (projectId: string) => Promise<void>;
}

const byRecent = (a: ProjectSummary, b: ProjectSummary) => b.updatedAt - a.updatedAt;
const bySettled = (a: ProjectSummary, b: ProjectSummary) => (b.settledAt ?? 0) - (a.settledAt ?? 0);

export function activeProjects(projects: ProjectSummary[]) {
  return projects.filter((p) => p.status === "active").sort(byRecent);
}

export function settledProjects(projects: ProjectSummary[]) {
  return projects.filter((p) => p.status === "settled").sort(bySettled);
}

let initStarted = false;


export const useProjects = create<ProjectsState>((set, get) => {
  const upsert = (summary: ProjectSummary) =>
    set({ projects: [summary, ...get().projects.filter((p) => p.id !== summary.id)] });

  /** Open the most recent active project other than `exceptId`, or show the empty state. */
  const openNext = async (exceptId: string) => {
    const next = activeProjects(get().projects).find((p) => p.id !== exceptId);
    if (next) get().open(next.id);
    else {
      setUrlProject(null);
      await useEditor.getState().closeProject();
    }
  };

  const setStatus = async (projectId: string, status: ProjectStatus) => {
    try {
      upsert(await api.updateProject(projectId, { status }));
    } catch (err) {
      toast.error(status === "settled" ? "Couldn't settle video" : "Couldn't unsettle video", {
        description: errorMessage(err),
      });
      return false;
    }
    return true;
  };

  return {
    projects: [],
    loaded: false,
    loadError: null,

    async init() {
      if (initStarted) return;
      initStarted = true;
      try {
        const projects = await api.listProjects();
        set({ projects, loaded: true, loadError: null });
      } catch (err) {
        initStarted = false;
        set({ loadError: errorMessage(err) });
        return;
      }
      onProjectSaved(upsert);
      window.addEventListener("popstate", () => {
        const id = projectIdFromUrl();
        if (id && get().projects.some((p) => p.id === id)) void useEditor.getState().openProject(id);
        else void useEditor.getState().closeProject();
      });

      const fromUrl = projectIdFromUrl();
      const initial = get().projects.some((p) => p.id === fromUrl)
        ? fromUrl
        : (activeProjects(get().projects)[0]?.id ?? null);
      setUrlProject(initial, { replace: true });
      if (initial) await useEditor.getState().openProject(initial);
    },

    open(projectId) {
      setUrlProject(projectId);
      void useEditor.getState().openProject(projectId);
    },

    async create(files) {
      let summary: ProjectSummary;
      try {
        summary = await api.createProject();
      } catch (err) {
        toast.error("Couldn't create a new video", { description: errorMessage(err) });
        return;
      }
      upsert(summary);
      setUrlProject(summary.id);
      await useEditor.getState().openProject(summary.id);
      if (files?.length && useEditor.getState().projectId === summary.id) {
        const assets = await useEditor.getState().importFiles(files);
        useEditor.getState().addAssetsToTimeline(assets.map((a) => a.id));
      }
    },

    async settle(projectId) {
      if (!(await setStatus(projectId, "settled"))) return;
      const wasOpen = useEditor.getState().projectId === projectId;
      const name = get().projects.find((p) => p.id === projectId)?.name ?? "Video";
      toast.success(`Settled “${name}”`, {
        action: {
          label: "Undo",
          onClick: () => {
            void get().unsettle(projectId);
            if (wasOpen) get().open(projectId);
          },
        },
      });
      if (wasOpen) await openNext(projectId);
    },

    async unsettle(projectId) {
      await setStatus(projectId, "active");
    },

    async duplicate(projectId) {
      let summary: ProjectSummary;
      try {
        // Copy the latest edits, not the last autosave.
        if (useEditor.getState().projectId === projectId) await flushAutosave();
        summary = await api.duplicateProject(projectId);
      } catch (err) {
        toast.error("Couldn't duplicate video", { description: errorMessage(err) });
        return;
      }
      upsert(summary);
      toast.success(`Duplicated as “${summary.name}”`, {
        action: { label: "Open", onClick: () => get().open(summary.id) },
      });
    },

    async remove(projectId) {
      try {
        await api.deleteProject(projectId);
      } catch (err) {
        toast.error("Couldn't delete video", { description: errorMessage(err) });
        return;
      }
      discardPendingSave(projectId);
      set({ projects: get().projects.filter((p) => p.id !== projectId) });
      if (useEditor.getState().projectId === projectId) await openNext(projectId);
    },
  };
});
